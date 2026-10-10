//! v2：原生阅读非 PDF 文档（markdown / HTML / EPUB / 纯文本与源码）。
//!
//! 应用前端本身就是 WebView，因此这些格式可以在应用内直接渲染，完全不经 PDFium。
//! 本模块是它们的统一入口：
//!
//! - 先按扩展名判定文档类型；
//! - 读取字节后统一做编码探测（UTF-8 / GBK 系 / UTF-16 带 BOM），
//!   避免中文 txt、源码在中文 Windows 上整篇乱码；
//! - markdown 用 pulldown-cmark 转 HTML；
//! - EPUB 解 zip、按 OPF spine 顺序拼接正文，图片内联成 data URL；
//! - HTML 原样返回（前端必须放进不带 allow-scripts 的沙箱 iframe）；
//! - 纯文本 / 源码原样返回，由前端等宽 + 行号显示。
//!
//! 边界：MOBI / AZW3 的格式规范 Amazon 从未公开，无可靠原生解析方案，
//! 因此不走本模块，仍由 ebook.rs 经 Calibre 转 PDF。

use serde::Serialize;
use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::path::Path;

use crate::error::{AppError, AppResult};

/// 单文件体积上限。超过后前端会卡死、内存也会暴涨，直接拒绝并提示。
const MAX_DOC_BYTES: u64 = 64 * 1024 * 1024;

const MARKDOWN_EXTS: &[&str] = &["md", "markdown", "mdown", "mkd"];
const HTML_EXTS: &[&str] = &["html", "htm", "xhtml"];
const TEXT_EXTS: &[&str] = &[
    "txt", "log", "ini", "cfg", "csv", "tsv", "json", "xml", "yaml", "yml", "toml", "properties",
];
const CODE_EXTS: &[&str] = &[
    "c", "h", "hpp", "cpp", "cc", "cxx", "cs", "java", "kt", "kts", "py", "rb", "go", "rs", "php",
    "js", "mjs", "cjs", "jsx", "ts", "tsx", "sql", "sh", "bash", "zsh", "bat", "cmd", "ps1", "css",
    "scss", "less", "vue", "svelte", "swift", "lua", "pl", "dart", "gradle",
];

/// 前端渲染所需的一整份文档，序列化为 camelCase。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDocPayload {
    /// "markdown" | "html" | "epub" | "text" | "code"
    pub kind: String,
    pub title: String,
    pub file_name: String,
    pub file_size_bytes: u64,
    /// 实际使用的解码方式，供界面提示（如 "utf-8" / "gbk" / "utf-16le"）
    pub encoding: String,
    /// code 类文档的扩展名（如 "cpp"、"php"），其余为 null
    pub language: Option<String>,
    /// markdown / html / epub 渲染用
    pub html: Option<String>,
    /// text / code 纯文本
    pub text: Option<String>,
    /// markdown 原始源码（供编辑修改）；其余格式为 null
    pub source: Option<String>,
}

/// 统一入口：按扩展名分发到 markdown / HTML / EPUB / 纯文本 / 源码。
#[tauri::command]
pub async fn read_text_doc(path: String) -> AppResult<TextDocPayload> {
    let p = Path::new(&path);
    if !p.is_file() {
        return Err(AppError::SourceNotFound { path });
    }
    let size = p.metadata().map(|m| m.len()).unwrap_or(0);
    if size > MAX_DOC_BYTES {
        return Err(AppError::FileTooLarge {
            limit_mb: (MAX_DOC_BYTES / (1024 * 1024)) as u32,
        });
    }

    let file_name = p
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .ok_or(AppError::CannotDetermineSourceName)?;
    let stem = p
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| file_name.clone());
    let ext = p
        .extension()
        .map(|s| s.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();

    let mut payload = TextDocPayload {
        kind: String::new(),
        title: stem,
        file_name,
        file_size_bytes: size,
        encoding: "utf-8".into(),
        language: None,
        html: None,
        text: None,
        source: None,
    };

    if ext == "epub" {
        let bytes = std::fs::read(p)?;
        let (html, title) = read_epub(&bytes)?;
        payload.kind = "epub".into();
        if let Some(t) = title.filter(|t| !t.trim().is_empty()) {
            payload.title = t;
        }
        payload.html = Some(html);
        return Ok(payload);
    }

    let bytes = std::fs::read(p)?;
    let (content, encoding) = decode_bytes(&bytes);
    payload.encoding = encoding;

    if MARKDOWN_EXTS.contains(&ext.as_str()) {
        payload.kind = "markdown".into();
        payload.html = Some(markdown_to_html(&content));
        // 保留原始源码，前端编辑器据此修改并保存
        payload.source = Some(content);
    } else if HTML_EXTS.contains(&ext.as_str()) {
        payload.kind = "html".into();
        payload.html = Some(content);
    } else if CODE_EXTS.contains(&ext.as_str()) {
        payload.kind = "code".into();
        payload.language = Some(ext);
        payload.text = Some(content);
    } else if TEXT_EXTS.contains(&ext.as_str()) {
        payload.kind = "text".into();
        payload.text = Some(content);
    } else {
        return Err(AppError::UnsupportedFormat {
            format: if ext.is_empty() { "无扩展名".into() } else { ext },
        });
    }

    Ok(payload)
}

/// 编辑器实时预览用：把 markdown 源码渲染成 HTML（与打开时完全一致的渲染规则）。
#[tauri::command]
pub fn render_markdown(text: String) -> String {
    markdown_to_html(&text)
}

/// 把编辑后的内容按 UTF-8 写回磁盘（当前用于 markdown 保存）。
#[tauri::command]
pub fn save_text_doc(path: String, content: String) -> AppResult<()> {
    let p = Path::new(&path);
    if !p.is_file() {
        return Err(AppError::SourceNotFound { path });
    }
    std::fs::write(p, content.as_bytes())?;
    Ok(())
}

// ---------- 编码探测 ----------

/// 先看 BOM，再尝试严格 UTF-8；都不成立才交给 chardetng 猜（中文场景通常是 GBK 系）。
fn decode_bytes(bytes: &[u8]) -> (String, String) {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return (String::from_utf8_lossy(rest).into_owned(), "utf-8".into());
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        let (s, _, _) = encoding_rs::UTF_16LE.decode(rest);
        return (s.into_owned(), "utf-16le".into());
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        let (s, _, _) = encoding_rs::UTF_16BE.decode(rest);
        return (s.into_owned(), "utf-16be".into());
    }
    if let Ok(s) = std::str::from_utf8(bytes) {
        return (s.to_string(), "utf-8".into());
    }
    let mut detector = chardetng::EncodingDetector::new();
    detector.feed(bytes, true);
    let enc = detector.guess(None, true);
    let (s, _, _) = enc.decode(bytes);
    (s.into_owned(), enc.name().to_ascii_lowercase())
}

// ---------- markdown ----------

fn markdown_to_html(src: &str) -> String {
    use pulldown_cmark::{html, Options, Parser};

    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TASKLISTS);
    opts.insert(Options::ENABLE_FOOTNOTES);

    let mut out = String::with_capacity(src.len() + src.len() / 2);
    html::push_html(&mut out, Parser::new_ext(src, opts));
    out
}

// ---------- 路径工具（zip 内路径） ----------

fn normalize_path(p: &str) -> String {
    let replaced = p.replace('\\', "/");
    let mut segs: Vec<&str> = Vec::new();
    for seg in replaced.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                segs.pop();
            }
            s => segs.push(s),
        }
    }
    segs.join("/")
}

fn parent_dir(p: &str) -> String {
    let normalized = normalize_path(p);
    match normalized.rfind('/') {
        Some(i) => normalized[..i].to_string(),
        None => String::new(),
    }
}

fn join_path(base_dir: &str, rel: &str) -> String {
    if rel.starts_with('/') {
        normalize_path(rel)
    } else if base_dir.is_empty() {
        normalize_path(rel)
    } else {
        normalize_path(&format!("{}/{}", base_dir, rel))
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(h), Some(l)) = (hi, lo) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// ---------- EPUB ----------

fn read_epub(bytes: &[u8]) -> AppResult<(String, Option<String>)> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| AppError::Damaged)?;

    // 归一化路径 → zip 内实际条目名（epub 内部路径可能带百分号转义）
    let mut index: HashMap<String, String> = HashMap::new();
    for name in zip.file_names() {
        index
            .entry(normalize_path(&percent_decode(name)))
            .or_insert_with(|| name.to_string());
    }

    let container = read_entry(&mut zip, &index, "META-INF/container.xml").ok_or(AppError::Damaged)?;
    let container = String::from_utf8_lossy(&container).into_owned();
    let opf_path = find_rootfile_path(&container).ok_or(AppError::Damaged)?;

    let opf_dir = parent_dir(&opf_path);
    let opf_bytes = read_entry(&mut zip, &index, &opf_path).ok_or(AppError::Damaged)?;
    let opf = String::from_utf8_lossy(&opf_bytes).into_owned();
    let (manifest, spine) = parse_opf(&opf);
    let title = find_dc_title(&opf);

    let mut sections: Vec<String> = Vec::new();
    for idref in &spine {
        let Some(item) = manifest.get(idref) else {
            continue;
        };
        let doc_path = join_path(&opf_dir, &item.href);
        let Some(raw) = read_entry(&mut zip, &index, &doc_path) else {
            continue;
        };
        let doc = String::from_utf8_lossy(&raw).into_owned();
        let body = extract_body(&doc);
        let doc_dir = parent_dir(&doc_path);
        sections.push(inline_images(body, &doc_dir, &mut zip, &index));
    }

    if sections.is_empty() {
        return Err(AppError::Damaged);
    }

    let mut out = String::new();
    for (i, body) in sections.iter().enumerate() {
        out.push_str("<section class=\"epub-section\" data-index=\"");
        out.push_str(&i.to_string());
        out.push_str("\">");
        out.push_str(body);
        out.push_str("</section>");
    }
    Ok((out, title))
}

struct ManifestItem {
    href: String,
    media_type: String,
}

fn read_entry(
    zip: &mut zip::ZipArchive<Cursor<&[u8]>>,
    index: &HashMap<String, String>,
    path: &str,
) -> Option<Vec<u8>> {
    let key = normalize_path(&percent_decode(path));
    let actual = index.get(&key)?;
    let mut file = zip.by_name(actual).ok()?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).ok()?;
    Some(buf)
}

fn find_rootfile_path(xml: &str) -> Option<String> {
    for seg in xml.split('<') {
        let seg = seg.trim_start();
        if !tag_named(seg, "rootfile") {
            continue;
        }
        if let Some(v) = attr_in_tag(seg, "full-path") {
            return Some(normalize_path(&percent_decode(&v)));
        }
    }
    None
}

/// 判断 `<'<' 切开的片段是否为指定标签（后一个字符必须是空白 / '>' / '/'）。
fn tag_named(seg: &str, name: &str) -> bool {
    match seg.strip_prefix(name) {
        Some(rest) => matches!(
            rest.chars().next(),
            None | Some(' ') | Some('\t') | Some('\r') | Some('\n') | Some('>') | Some('/')
        ),
        None => false,
    }
}

/// 从 element 里解析 manifest（id → item）与 spine 顺序。
fn parse_opf(xml: &str) -> (HashMap<String, ManifestItem>, Vec<String>) {
    let mut manifest = HashMap::new();
    let mut spine = Vec::new();

    for seg in xml.split('<') {
        let seg = seg.trim_start();
        if tag_named(seg, "itemref") {
            if let Some(idref) = attr_in_tag(seg, "idref") {
                spine.push(idref);
            }
        } else if tag_named(seg, "item") {
            let id = attr_in_tag(seg, "id");
            let href = attr_in_tag(seg, "href");
            let media_type = attr_in_tag(seg, "media-type");
            if let (Some(id), Some(href)) = (id, href) {
                manifest.insert(
                    id,
                    ManifestItem {
                        href,
                        media_type: media_type.unwrap_or_default(),
                    },
                );
            }
        }
    }

    // 只保留正文文档（有些 OPF 会把封面、CSS 也列进 manifest）
    manifest.retain(|_, it| {
        let mt = it.media_type.to_ascii_lowercase();
        mt.is_empty() || mt.contains("xhtml") || mt.contains("html")
    });

    (manifest, spine)
}

/// 在已按 '<' 切开的片段里取 `name="value"`（兼容单引号，值做 XML 反转义）。
fn attr_in_tag(seg: &str, name: &str) -> Option<String> {
    let bytes = seg.as_bytes();
    let pat = name.as_bytes();
    let mut i = 0;
    while i + pat.len() + 2 < bytes.len() {
        let matched = &bytes[i..i + pat.len()] == pat
            && bytes[i + pat.len()] == b'='
            && (bytes[i + pat.len() + 1] == b'"' || bytes[i + pat.len() + 1] == b'\'');
        if matched {
            let quote = bytes[i + pat.len() + 1];
            let start = i + pat.len() + 2;
            let mut end = start;
            while end < bytes.len() && bytes[end] != quote {
                end += 1;
            }
            let raw = String::from_utf8_lossy(&bytes[start..end]).into_owned();
            return Some(unescape_xml(&raw));
        }
        i += 1;
    }
    None
}

fn unescape_xml(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

fn find_dc_title(xml: &str) -> Option<String> {
    for (open, close) in [("<dc:title", "</dc:title"), ("<title", "</title")] {
        let Some(pos) = xml.find(open) else { continue };
        let rest = &xml[pos..];
        let Some(gt) = rest.find('>') else { continue };
        let after = &rest[gt + 1..];
        let Some(end) = after.find(close) else { continue };
        let t = unescape_xml(after[..end].trim());
        if !t.is_empty() {
            return Some(t);
        }
    }
    None
}

/// 取 `<body>` 内部内容；没有 body 就整段返回（有些 epub 是 HTML 片段）。
fn extract_body(html: &str) -> &str {
    let lower = html.to_ascii_lowercase();
    let Some(start) = lower.find("<body") else {
        return html;
    };
    let Some(gt) = html[start..].find('>') else {
        return html;
    };
    let content_start = start + gt + 1;
    match lower[content_start..].find("</body") {
        Some(end) => &html[content_start..content_start + end],
        None => &html[content_start..],
    }
}

fn image_mime(path: &str) -> Option<&'static str> {
    let ext = normalize_path(path)
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "svg" => Some("image/svg+xml"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}

/// 把正文里指向 epub 内部图片资源的引用换成 data URL。
/// 只处理能解析成 zip 条目且扩展名是图片的引用，因此 `<a href="chapter2.xhtml">` 不会被误伤。
fn inline_images(
    body: &str,
    doc_dir: &str,
    zip: &mut zip::ZipArchive<Cursor<&[u8]>>,
    index: &HashMap<String, String>,
) -> String {
    use base64::Engine as _;

    let mut out = body.to_string();
    for attr in ["src", "href"] {
        for value in attr_values(&out, attr) {
            let trimmed = value.trim();
            if trimmed.is_empty()
                || trimmed.starts_with("data:")
                || trimmed.starts_with("http:")
                || trimmed.starts_with("https:")
                || trimmed.starts_with('#')
            {
                continue;
            }
            let Some(mime) = image_mime(trimmed) else {
                continue;
            };
            let target = join_path(doc_dir, &percent_decode(trimmed));
            let Some(bytes) = read_entry(zip, index, &target) else {
                continue;
            };
            let data_url = format!(
                "data:{};base64,{}",
                mime,
                base64::engine::general_purpose::STANDARD.encode(&bytes)
            );
            for quote in ['"', '\''] {
                out = out.replace(
                    &format!("{attr}={quote}{value}{quote}"),
                    &format!("{attr}={quote}{data_url}{quote}"),
                );
            }
        }
    }
    out
}

/// 扫出 `attr="value"` / `attr='value'` 的所有取值。
fn attr_values(html: &str, attr: &str) -> Vec<String> {
    let bytes = html.as_bytes();
    let pat = attr.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i + pat.len() + 2 < bytes.len() {
        let matched = &bytes[i..i + pat.len()] == pat
            && bytes[i + pat.len()] == b'='
            && (bytes[i + pat.len() + 1] == b'"' || bytes[i + pat.len() + 1] == b'\'');
        if matched {
            let quote = bytes[i + pat.len() + 1];
            let start = i + pat.len() + 2;
            let mut end = start;
            while end < bytes.len() && bytes[end] != quote {
                end += 1;
            }
            out.push(String::from_utf8_lossy(&bytes[start..end]).into_owned());
            i = end + 1;
            continue;
        }
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_utf8_and_utf8_bom() {
        assert_eq!(decode_bytes("你好".as_bytes()), ("你好".into(), "utf-8".into()));
        let mut bom = vec![0xEF, 0xBB, 0xBF];
        bom.extend_from_slice("你好".as_bytes());
        assert_eq!(decode_bytes(&bom).0, "你好");
    }

    #[test]
    fn decodes_gbk_chinese() {
        let original = "你好世界，这是一个中文 GBK 编码的测试文件，用于验证编码探测。";
        let (bytes, _, _) = encoding_rs::GBK.encode(original);
        let (s, enc) = decode_bytes(&bytes);
        assert_eq!(s, original);
        assert_ne!(enc, "utf-8", "GBK 字节不可能是合法 UTF-8，应走探测分支");
    }

    #[test]
    fn markdown_renders_tables_and_headings() {
        let html = markdown_to_html("# 标题\n\n| a | b |\n| - | - |\n| 1 | 2 |\n");
        assert!(html.contains("<h1>标题</h1>"));
        assert!(html.contains("<table>"));
    }

    #[test]
    fn normalizes_and_joins_zip_paths() {
        assert_eq!(normalize_path("OEBPS/../META-INF/./x.xml"), "META-INF/x.xml");
        assert_eq!(join_path("OEBPS/Text", "img/a.png"), "OEBPS/Text/img/a.png");
        assert_eq!(join_path("OEBPS", "../a.png"), "a.png");
        assert_eq!(join_path("OEBPS", "/a.png"), "a.png");
    }

    #[test]
    fn parses_opf_manifest_and_spine_order() {
        let opf = r#"<package><metadata><dc:title>书名 &amp; 副标题</dc:title></metadata>
        <manifest><item id="c2" href="Text/2.xhtml" media-type="application/xhtml+xml"/>
        <item id="css" href="s.css" media-type="text/css"/>
        <item id="c1" href="Text/1.xhtml" media-type="application/xhtml+xml"/></manifest>
        <spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>"#;
        let (manifest, spine) = parse_opf(opf);
        assert_eq!(spine, vec!["c1", "c2"]);
        assert_eq!(manifest.get("c1").unwrap().href, "Text/1.xhtml");
        assert!(!manifest.contains_key("css"));
        assert_eq!(find_dc_title(opf).as_deref(), Some("书名 & 副标题"));
    }

    #[test]
    fn extracts_body_inner_html() {
        let doc = "<html><head><title>x</title></head><BODY class=\"a\"><p>hi</p></BODY></html>";
        assert_eq!(extract_body(doc), "<p>hi</p>");
        assert_eq!(extract_body("<p>frag</p>"), "<p>frag</p>");
    }

    #[test]
    fn finds_rootfile_and_percent_decodes() {
        let c = r#"<container><rootfiles><rootfile full-path="OEBPS%20x/content.opf"/></rootfiles></container>"#;
        assert_eq!(find_rootfile_path(c).as_deref(), Some("OEBPS x/content.opf"));
    }

    // ---------- EPUB 端到端（真实 zip，此前零覆盖） ----------

    /// 在内存里构造一个 epub：manifest 故意逆序、spine 正序；标题带 XML 实体；
    /// ch1 引用一张 1×1 PNG 用于验证 data URL 内联。
    fn build_sample_epub() -> Vec<u8> {
        use base64::Engine as _;

        let png = base64::engine::general_purpose::STANDARD
            .decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
            )
            .unwrap();

        let container = r#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#;

        let opf = r#"<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>原生阅读验证书 &amp; 附录</dc:title>
    <dc:identifier id="id">urn:uuid:test</dc:identifier>
  </metadata>
  <manifest>
    <item id="c2" href="Text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="Styles/main.css" media-type="text/css"/>
    <item id="c1" href="Text/ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>"#;

        let ch1 = r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>ch1</title></head>
<body><h1>第一章</h1><p>正文一</p><img src="../Images/dot.png" alt="dot"/></body></html>"#;

        let ch2 = r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>ch2</title></head>
<body><blockquote>第二章引用</blockquote></body></html>"#;

        fn put(zip: &mut zip::ZipWriter<Cursor<Vec<u8>>>, name: &str, data: &[u8]) {
            use std::io::Write as _;
            let opts = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            zip.start_file(name, opts).unwrap();
            zip.write_all(data).unwrap();
        }

        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        put(&mut zip, "mimetype", b"application/epub+zip");
        put(&mut zip, "META-INF/container.xml", container.as_bytes());
        put(&mut zip, "OEBPS/content.opf", opf.as_bytes());
        put(&mut zip, "OEBPS/Styles/main.css", b"h1 { color: red }");
        put(&mut zip, "OEBPS/Text/ch1.xhtml", ch1.as_bytes());
        put(&mut zip, "OEBPS/Text/ch2.xhtml", ch2.as_bytes());
        put(&mut zip, "OEBPS/Images/dot.png", &png);
        zip.finish().unwrap().into_inner()
    }

    #[test]
    fn reads_epub_zip_end_to_end() {
        let bytes = build_sample_epub();
        let (html, title) = read_epub(&bytes).expect("真实 zip 应能解析");
        assert_eq!(title.as_deref(), Some("原生阅读验证书 & 附录"));

        // 正文按 spine 顺序（ch1 → ch2），而不是 manifest 里的逆序
        let p1 = html.find("第一章").expect("缺少第一章");
        let p2 = html.find("第二章引用").expect("缺少第二章");
        assert!(p1 < p2, "spine 顺序应为 ch1 在前");

        assert!(html.contains("data-index=\"0\""));
        assert!(html.contains("data-index=\"1\""));
        // 图片内联成 data URL，且 alt 属性未被误伤
        assert!(html.contains("data:image/png;base64,iVBORw0KGgo"));
        assert!(html.contains("alt=\"dot\""));
        // 不在 spine 里的 CSS 不应混进正文
        assert!(!html.contains("color: red"));
    }

    #[test]
    fn read_text_doc_dispatches_epub_and_serializes_camel_case() {
        let bytes = build_sample_epub();
        let dir = std::env::temp_dir().join("pdfe-reader-verify");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("native reading 验证.epub");
        std::fs::write(&path, &bytes).unwrap();

        let payload =
            tauri::async_runtime::block_on(read_text_doc(path.to_string_lossy().into_owned()))
                .expect("epub 应能通过命令层打开");

        assert_eq!(payload.kind, "epub");
        assert_eq!(payload.title, "原生阅读验证书 & 附录");
        assert_eq!(payload.file_name, "native reading 验证.epub");
        assert_eq!(payload.file_size_bytes, bytes.len() as u64);
        assert_eq!(payload.encoding, "utf-8"); // epub 分支不做编码探测
        assert!(payload.text.is_none());
        assert!(payload.source.is_none()); // 非 markdown 不暴露源码
        assert!(payload.html.as_deref().unwrap().contains("第一章"));

        // 前端 ipc.ts 依赖 camelCase 字段名，序列化契约必须稳定
        let v = serde_json::to_value(&payload).unwrap();
        for key in [
            "fileName",
            "fileSizeBytes",
            "encoding",
            "language",
            "html",
            "text",
            "source",
        ] {
            assert!(v.get(key).is_some(), "序列化缺少字段 {key}");
        }

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn read_text_doc_dispatches_all_native_kinds() {
        let dir = std::env::temp_dir().join("pdfe-reader-verify-kinds");
        std::fs::create_dir_all(&dir).unwrap();

        let read = |name: &str| {
            let path = dir.join(name);
            tauri::async_runtime::block_on(read_text_doc(path.to_string_lossy().into_owned()))
        };

        let cases: &[(&str, &[u8], &str, Option<&str>)] = &[
            ("a.md", b"# t\n\npara\n", "markdown", None),
            ("a.html", b"<h1>hi</h1>", "html", None),
            ("a.txt", b"hello", "text", None),
            ("a.rs", b"fn main() {}", "code", Some("rs")),
        ];
        for (name, data, kind, lang) in cases {
            std::fs::write(dir.join(name), data).unwrap();
            let p = read(name).unwrap_or_else(|e| panic!("{name} 应能打开：{e:?}"));
            assert_eq!(&p.kind, kind, "{name} 的 kind 不符");
            assert_eq!(p.language.as_deref(), *lang, "{name} 的 language 不符");
            if matches!(*kind, "code" | "text") {
                assert!(p.text.is_some() && p.html.is_none(), "{name} 应走纯文本");
            } else {
                assert!(p.html.is_some() && p.text.is_none(), "{name} 应走 HTML 渲染");
            }
        }

        // 中文 Windows 常见的 GBK txt 必须被探测出来，而不是按 UTF-8 乱码
        let (gbk, _, _) = encoding_rs::GBK.encode("中文 GBK 文本");
        std::fs::write(dir.join("gbk.txt"), &gbk).unwrap();
        let p = read("gbk.txt").unwrap();
        assert_eq!(p.text.as_deref(), Some("中文 GBK 文本"));
        assert_ne!(p.encoding, "utf-8");

        // 不支持的扩展名应明确报错，而不是静默乱猜
        std::fs::write(dir.join("a.mobi"), b"x").unwrap();
        let err = read("a.mobi").unwrap_err();
        assert_eq!(err.code(), "unsupported_format");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn markdown_exposes_source_and_saves_round_trip() {
        let dir = std::env::temp_dir().join("pdfe-reader-md-edit");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("note.md");
        let original = "# 标题\n\n正文\n";
        std::fs::write(&path, original.as_bytes()).unwrap();

        let payload =
            tauri::async_runtime::block_on(read_text_doc(path.to_string_lossy().into_owned()))
                .unwrap();
        assert_eq!(payload.kind, "markdown");
        assert_eq!(payload.source.as_deref(), Some(original));
        assert!(payload.text.is_none(), "markdown 仍不走纯文本通道");

        // 预览渲染与打开时的渲染一致
        assert_eq!(
            Some(render_markdown(payload.source.clone().unwrap())),
            payload.html
        );

        // 写回后再读，内容应被更新
        let edited = "# 改过的标题\n\n新正文\n";
        save_text_doc(path.to_string_lossy().into_owned(), edited.into()).unwrap();
        let again =
            tauri::async_runtime::block_on(read_text_doc(path.to_string_lossy().into_owned()))
                .unwrap();
        assert_eq!(again.source.as_deref(), Some(edited));

        // 路径不存在时应明确报错，而不是静默创建
        let missing = dir.join("nope.md");
        let err = save_text_doc(missing.to_string_lossy().into_owned(), "x".into()).unwrap_err();
        assert_eq!(err.code(), "source_not_found");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
