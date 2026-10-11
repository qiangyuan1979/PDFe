//! M8 / P8：扫描版 OCR（Tesseract，可选 feature）
//!
//! 能力：
//! - 渲染指定页为 PNG（高 DPI）
//! - 调 Tesseract 识别文字
//! - 把识别结果写回为不可见文本层（"searchable PDF"）
//!
//! 启用方式：cargo build --features ocr
//! 默认关闭：避免 C++ 依赖（libtesseract + cmake）和 ~50MB 二进制膨胀。
//!
//! 错误码：
//! - `ocr_unavailable`：feature 未启用
//! - `tessdata_missing`：tessdata 文件不存在
//! - `ocr_failed`：识别过程失败

use pdfium_render::prelude::*;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::document::{pdfium, AppState, DocumentInfo};
use crate::error::{AppError, AppResult};
use crate::pages::load_doc;

/// 单个 OCR 识别结果：单词 + PDF 坐标矩形（左下原点）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrWord {
    pub text: String,
    pub left: f32,
    pub bottom: f32,
    pub right: f32,
    pub top: f32,
    /// 识别置信度 0.0–1.0
    pub confidence: f32,
}

/// 单页 OCR 结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrPageResult {
    pub page_index: u32,
    pub words: Vec<OcrWord>,
}

/// OCR 配置
#[derive(Debug, Clone)]
pub struct OcrConfig {
    /// 渲染 DPI（默认 300，扫描版推荐）
    pub dpi: u32,
    /// Tesseract 语言（默认 "eng"）
    pub lang: String,
    /// tessdata 目录（None = 用 Tesseract 默认搜索路径）
    pub tessdata_dir: Option<String>,
}

impl Default for OcrConfig {
    fn default() -> Self {
        Self {
            dpi: 300,
            lang: "eng".to_string(),
            tessdata_dir: None,
        }
    }
}

/// 纯函数版本：渲染指定页为 PNG 字节。
pub fn render_page_to_png(
    pdfium_inst: &Pdfium,
    bytes: &[u8],
    page_index: u32,
    dpi: u32,
) -> AppResult<Vec<u8>> {
    let doc = pdfium_inst.load_pdf_from_byte_slice(bytes, None)?;
    let pages = doc.pages();
    if page_index >= pages.len() as u32 {
        return Err(AppError::PageOutOfRange);
    }
    let page = pages.get(page_index as u16)?;
    // dpi → scale: 72 是 PDF 点的基准 DPI
    let scale = dpi as f32 / 72.0;
    let bitmap = page.render_with_config(
        &PdfRenderConfig::new()
            .set_target_width((page.width().value * scale) as i32)
            .set_target_height((page.height().value * scale) as i32),
    )?;
    let img = bitmap.as_image();
    let mut buf = std::io::Cursor::new(Vec::new());
    img.write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| AppError::OcrFailed {
            detail: format!("encode png: {}", e),
        })?;
    Ok(buf.into_inner())
}

/// 纯函数：把 OCR 结果写入 PDF 页作为不可见文本层（"searchable PDF"）。
///
/// **当前实现**：用 pdfium-render 的 `create_text_object` 在 OCR 词位置
/// 插入一个文本对象，render mode 设为 `Invisible`（不可见但可复制/搜索）。
///
/// 字体：复用 `watermark::load_font_for_text` 自动回退逻辑。
pub fn apply_text_overlay_logic(
    bytes: &[u8],
    page_index: u32,
    words: &[OcrWord],
) -> AppResult<Vec<u8>> {
    use pdfium_render::prelude::{PdfColor, PdfPoints};

    let pdfium_inst = pdfium();
    let mut doc = load_doc(pdfium_inst, bytes)?;
    let total = doc.pages().len() as u32;
    if page_index >= total {
        return Err(AppError::PageOutOfRange);
    }

    // 收集所有不同 word 文本，预先解析 font_token（每页一个字体即可）
    let sample = words.first().map(|w| w.text.as_str()).unwrap_or("A");
    let font_token = crate::watermark::load_font_for_text(&mut doc, sample).map_err(|e| {
        AppError::OcrFailed {
            detail: format!("load font: {}", e),
        }
    })?;

    {
        let pages = doc.pages_mut();
        let mut page = pages.get(page_index as u16)?;
        let objects = page.objects_mut();

        for w in words {
            if w.confidence < 30.0 || w.text.trim().is_empty() {
                continue;
            }

            let font_size = (w.top - w.bottom).max(2.0);
            let x = w.left.max(0.0);
            let y = w.bottom.max(0.0);

            // create_text_object 返回 PdfPageObject 枚举（Text 变体）
            let mut page_obj = match objects.create_text_object(
                PdfPoints::new(x),
                PdfPoints::new(y),
                &w.text,
                font_token,
                PdfPoints::new(font_size),
            ) {
                Ok(o) => o,
                Err(e) => {
                    eprintln!("ocr text overlay: create_text_object failed: {}", e);
                    continue;
                }
            };

            // 用透明填充色使文字视觉上不可见，但 PDF 内部 text operator 正常存在，
            // 确保可搜索/可选择。pdfium-render 0.8.37 的 set_render_mode(Invisible)
            // 会破坏文本对象导致 garbage 输出，改用此方案。
            if let Some(text_obj) = page_obj.as_text_object_mut() {
                let _ = text_obj.set_fill_color(PdfColor::new(0, 0, 0, 0));
            }
        }
    }

    doc.save_to_bytes().map_err(|e| AppError::OcrFailed {
        detail: format!("save pdf: {}", e),
    })
}

/// 纯函数版本：OCR 单页并返回结果。
///
/// **功能开关**：
/// - 启用 `ocr` feature 时调用 Tesseract
/// - 关闭 feature 时返回 `OcrUnavailable` 错误
pub fn ocr_page_logic(
    bytes: &[u8],
    page_index: u32,
    config: &OcrConfig,
) -> AppResult<OcrPageResult> {
    // 验证输入
    let pdfium_inst = pdfium();
    let doc = pdfium_inst
        .load_pdf_from_byte_slice(bytes, None)
        .map_err(|_| AppError::Damaged)?;
    let total = doc.pages().len() as u32;
    if page_index >= total {
        return Err(AppError::PageOutOfRange);
    }
    drop(doc);

    // 渲染为 PNG
    let png_bytes = render_page_to_png(pdfium_inst, bytes, page_index, config.dpi)?;

    // 调 Tesseract（仅在 ocr feature 启用时）
    #[cfg(feature = "ocr")]
    {
        ocr_with_tesseract(&png_bytes, &config, page_index, bytes)
    }

    #[cfg(not(feature = "ocr"))]
    {
        let _ = png_bytes;
        let _ = (config, page_index);
        Err(AppError::OcrUnavailable)
    }
}

#[cfg(feature = "ocr")]
fn ocr_with_tesseract(
    png_bytes: &[u8],
    config: &OcrConfig,
    page_index: u32,
    pdf_bytes: &[u8],
) -> AppResult<OcrPageResult> {
    use std::path::Path;
    use tesseract::Tesseract;

    // tessdata 路径校验
    if let Some(dir) = &config.tessdata_dir {
        let lang_file = format!("{}.traineddata", config.lang);
        let p = Path::new(dir).join(&lang_file);
        if !p.exists() {
            return Err(AppError::TessdataMissing {
                path: p.to_string_lossy().into_owned(),
            });
        }
    }

    let mut tess =
        Tesseract::new(config.tessdata_dir.as_deref(), Some(config.lang.as_str())).map_err(|e| {
            AppError::OcrFailed {
                detail: format!("init tesseract: {}", e),
            }
        })?;

    tess = tess
        .set_image_from_mem(png_bytes)
        .map_err(|e| AppError::OcrFailed {
            detail: format!("set image: {}", e),
        })?;

    // 取识别结果 + 坐标
    // tesseract-rs 0.15 提供 get_data().get_words(...)
    let text = tess.get_text().map_err(|e| AppError::OcrFailed {
        detail: format!("get text: {}", e),
    })?;

    // hOCR 输出含每个 word 的 bbox
    let hocr = tess.get_hocr_text(0).unwrap_or_default();

    let words = parse_hocr_words(&hocr, &text, pdf_bytes, page_index, &config)?;

    Ok(OcrPageResult { page_index, words })
}

#[cfg(feature = "ocr")]
fn parse_hocr_words(
    hocr: &str,
    full_text: &str,
    pdf_bytes: &[u8],
    page_index: u32,
    config: &OcrConfig,
) -> AppResult<Vec<OcrWord>> {
    // Primary path: parse hOCR string into word list (pure, testable)
    let mut words = parse_hocr_words_core(hocr, config.dpi);

    // Fallback: if hOCR parsing yielded nothing but full_text is non-empty,
    // split text into words with rough position estimates (needs PDF page size)
    if words.is_empty() && !full_text.trim().is_empty() {
        let pdfium_inst = pdfium();
        let doc = pdfium_inst.load_pdf_from_byte_slice(pdf_bytes, None)?;
        let page = doc.pages().get(page_index as u16)?;
        let page_w = page.width().value as f32;
        let page_h = page.height().value as f32;
        for (i, line) in full_text.lines().enumerate() {
            for (j, w) in line.split_whitespace().enumerate() {
                let x = page_w * 0.05 + (j as f32) * page_w * 0.05;
                let y = page_h * (0.9 - (i as f32) * 0.05);
                words.push(OcrWord {
                    text: w.to_string(),
                    left: x,
                    bottom: y,
                    right: x + page_w * 0.04,
                    top: y + page_h * 0.04,
                    confidence: 0.0,
                });
            }
        }
    }

    Ok(words)
}

// 仅在 ocr feature 开启时由 parse_hocr_words_core 调用；测试模块也会直接调用。
#[cfg(any(test, feature = "ocr"))]
fn strip_html_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}

/// Pure function: parse hOCR string into OcrWord list using only dpi for scaling.
///
/// No PDF dependency, no tesseract dependency. Works purely on the hOCR string.
/// Returns empty vec if no valid ocrx_word entries are found.
// 仅在 ocr feature 开启时由 parse_hocr_words 调用；测试模块也会直接调用。
#[cfg(any(test, feature = "ocr"))]
fn parse_hocr_words_core(hocr: &str, dpi: u32) -> Vec<OcrWord> {
    let mut words = Vec::new();
    let mut idx = 0;
    let scale = 72.0 / dpi as f32;

    while let Some(start) = hocr[idx..].find("ocrx_word") {
        let abs = idx + start;
        // find title=
        if let Some(t_pos) = hocr[abs..].find("title='") {
            let t_abs = abs + t_pos + 7;
            if let Some(t_end) = hocr[t_abs..].find('\'') {
                let title = &hocr[t_abs..t_abs + t_end];
                // parse bbox and confidence
                let mut parts = title.split(';');
                let bbox_str = parts.next().unwrap_or("").trim();
                let conf_str = parts.next().unwrap_or("").trim();
                let conf = conf_str
                    .replace("x_wconf ", "")
                    .parse::<f32>()
                    .unwrap_or(0.0);
                let nums: Vec<f32> = bbox_str
                    .replace("bbox ", "")
                    .split_whitespace()
                    .filter_map(|s| s.parse().ok())
                    .collect();
                if nums.len() == 4 {
                    let (left, bottom, right, top) = (nums[0], nums[1], nums[2], nums[3]);
                    let left_pt = left * scale;
                    let bottom_pt = bottom * scale;
                    let right_pt = right * scale;
                    let top_pt = top * scale;

                    // find word text: after '>TEXT</span>'
                    let after_title = t_abs + t_end + 1;
                    if let Some(gt_pos) = hocr[after_title..].find('>') {
                        let text_start = after_title + gt_pos + 1;
                        if let Some(lt_pos) = hocr[text_start..].find("</span>") {
                            let raw = &hocr[text_start..text_start + lt_pos];
                            let cleaned = strip_html_tags(raw).trim().to_string();
                            if !cleaned.is_empty() {
                                words.push(OcrWord {
                                    text: cleaned,
                                    left: left_pt,
                                    bottom: bottom_pt,
                                    right: right_pt,
                                    top: top_pt,
                                    confidence: conf,
                                });
                            }
                        }
                    }
                }
                idx = t_abs + t_end;
            } else {
                idx = abs + 1;
            }
        } else {
            idx = abs + 1;
        }
    }

    words
}

// ============================================================================
// Tauri commands（条件注册）
// ============================================================================

#[cfg(feature = "ocr")]
#[tauri::command]
pub async fn ocr_page(
    _state: State<'_, AppState>,
    doc_id: u64,
    page_index: u32,
    lang: Option<String>,
    dpi: Option<u32>,
) -> AppResult<OcrPageResult> {
    let _gate = crate::document::pdfium_gate();
    let docs = _state.docs.lock().unwrap();
    let entry = docs.get(&doc_id).ok_or(AppError::NotFound)?;
    let config = OcrConfig {
        dpi: dpi.unwrap_or(300),
        lang: lang.unwrap_or_else(|| "eng".to_string()),
        tessdata_dir: None,
    };
    ocr_page_logic(&entry.bytes, page_index, &config)
}

#[cfg(feature = "ocr")]
#[tauri::command]
pub async fn ocr_apply_text_overlay(
    state: State<'_, AppState>,
    doc_id: u64,
    page_index: u32,
    words: Vec<OcrWord>,
) -> AppResult<DocumentInfo> {
    let _gate = crate::document::pdfium_gate();
    push_snapshot_bytes(&state, doc_id)?;
    let docs = state.docs.lock().unwrap();
    let entry = docs.get(&doc_id).ok_or(AppError::NotFound)?;
    let new_bytes = apply_text_overlay_logic(&entry.bytes, page_index, &words)?;
    crate::pages::commit_and_return(&state, doc_id, new_bytes)
}

#[cfg(feature = "ocr")]
fn push_snapshot_bytes(state: &AppState, doc_id: u64) -> AppResult<()> {
    crate::document::push_snapshot(state, doc_id);
    Ok(())
}

// ============================================================================
// Feature=off 时的 stub：保持 invoke_handler 引用稳定
// ============================================================================

#[cfg(not(feature = "ocr"))]
#[tauri::command]
pub async fn ocr_page(
    _state: State<'_, AppState>,
    _doc_id: u64,
    _page_index: u32,
    _lang: Option<String>,
    _dpi: Option<u32>,
) -> AppResult<OcrPageResult> {
    Err(AppError::OcrUnavailable)
}

#[cfg(not(feature = "ocr"))]
#[tauri::command]
pub async fn ocr_apply_text_overlay(
    _state: State<'_, AppState>,
    _doc_id: u64,
    _page_index: u32,
    _words: Vec<OcrWord>,
) -> AppResult<DocumentInfo> {
    Err(AppError::OcrUnavailable)
}

// ============================================================================
// Unit tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ------------------------------------------------------------------
    // strip_html_tags
    // ------------------------------------------------------------------

    #[test]
    fn test_strip_html_tags_plain_text() {
        assert_eq!(strip_html_tags("hello world"), "hello world");
    }

    #[test]
    fn test_strip_html_tags_simple_tag() {
        assert_eq!(strip_html_tags("hello <b>world</b>"), "hello world");
    }

    #[test]
    fn test_strip_html_tags_nested_tags() {
        assert_eq!(strip_html_tags("<div><span>text</span></div>"), "text");
    }

    #[test]
    fn test_strip_html_tags_empty_input() {
        assert_eq!(strip_html_tags(""), "");
    }

    #[test]
    fn test_strip_html_tags_only_tags() {
        assert_eq!(strip_html_tags("<p></p><br/>"), "");
    }

    #[test]
    fn test_strip_html_tags_malformed_unclosed() {
        // Unclosed '<' — everything after it is treated as inside a tag
        assert_eq!(strip_html_tags("hello <world"), "hello ");
    }

    #[test]
    fn test_strip_html_tags_extra_closing() {
        // Lone '>' outside a tag toggles in_tag off (no-op) and is not appended
        assert_eq!(strip_html_tags("hello > world"), "hello  world");
    }

    // ------------------------------------------------------------------
    // parse_hocr_words_core
    // ------------------------------------------------------------------

    fn approx(a: f32, b: f32) -> bool {
        (a - b).abs() < 1e-3
    }

    #[test]
    fn test_parse_hocr_empty_input() {
        let words = parse_hocr_words_core("", 300);
        assert!(words.is_empty());
    }

    #[test]
    fn test_parse_hocr_no_ocrx_word() {
        let hocr = "<html><body><p>no words here</p></body></html>";
        let words = parse_hocr_words_core(hocr, 300);
        assert!(words.is_empty());
    }

    #[test]
    fn test_parse_hocr_single_word() {
        let hocr = r#"<span class='ocrx_word' id='word_1' title='bbox 100 200 300 250; x_wconf 95'>Hello</span>"#;
        let words = parse_hocr_words_core(hocr, 300);
        assert_eq!(words.len(), 1);

        let w = &words[0];
        assert_eq!(w.text, "Hello");
        // scale = 72/300 = 0.24
        assert!(approx(w.left, 100.0 * 0.24));
        assert!(approx(w.bottom, 200.0 * 0.24));
        assert!(approx(w.right, 300.0 * 0.24));
        assert!(approx(w.top, 250.0 * 0.24));
        assert!(approx(w.confidence, 95.0));
    }

    #[test]
    fn test_parse_hocr_multiple_words() {
        let hocr = r#"
<span class='ocrx_word' id='word_1' title='bbox 10 20 50 40; x_wconf 80'>First</span>
<span class='ocrx_word' id='word_2' title='bbox 60 20 100 40; x_wconf 90'>Second</span>
<span class='ocrx_word' id='word_3' title='bbox 110 20 150 40; x_wconf 70'>Third</span>
"#;
        let words = parse_hocr_words_core(hocr, 300);
        assert_eq!(words.len(), 3);
        assert_eq!(words[0].text, "First");
        assert_eq!(words[1].text, "Second");
        assert_eq!(words[2].text, "Third");
        assert!(approx(words[0].confidence, 80.0));
        assert!(approx(words[1].confidence, 90.0));
        assert!(approx(words[2].confidence, 70.0));
    }

    #[test]
    fn test_parse_hocr_different_dpi() {
        let hocr = r#"<span class='ocrx_word' id='word_1' title='bbox 72 72 144 144; x_wconf 50'>test</span>"#;
        // With 72 DPI, 1 pixel = 1 point
        let words = parse_hocr_words_core(hocr, 72);
        assert_eq!(words.len(), 1);
        assert!(approx(words[0].left, 72.0));
        assert!(approx(words[0].bottom, 72.0));
        assert!(approx(words[0].right, 144.0));
        assert!(approx(words[0].top, 144.0));

        // With 144 DPI, 1 pixel = 0.5 points
        let words2 = parse_hocr_words_core(hocr, 144);
        assert_eq!(words2.len(), 1);
        assert!(approx(words2[0].left, 36.0));
        assert!(approx(words2[0].bottom, 36.0));
    }

    #[test]
    fn test_parse_hocr_missing_confidence_defaults_zero() {
        // No x_wconf in title — should default to 0.0
        let hocr = r#"<span class='ocrx_word' id='word_1' title='bbox 10 20 30 40'>NoConf</span>"#;
        let words = parse_hocr_words_core(hocr, 300);
        assert_eq!(words.len(), 1);
        assert_eq!(words[0].text, "NoConf");
        assert!(approx(words[0].confidence, 0.0));
    }

    #[test]
    fn test_parse_hocr_malformed_bbox_skipped() {
        // bbox with only 3 numbers — should be skipped
        let hocr =
            r#"<span class='ocrx_word' id='word_1' title='bbox 10 20 30; x_wconf 50'>Bad</span>"#;
        let words = parse_hocr_words_core(hocr, 300);
        assert!(words.is_empty());
    }

    #[test]
    fn test_parse_hocr_word_with_inner_html() {
        // Word text contains inner tags (like <em> or <strong>)
        let hocr = r#"<span class='ocrx_word' id='word_1' title='bbox 10 20 50 40; x_wconf 85'>Hel<b>lo</b></span>"#;
        let words = parse_hocr_words_core(hocr, 300);
        assert_eq!(words.len(), 1);
        assert_eq!(words[0].text, "Hello");
    }

    #[test]
    fn test_parse_hocr_empty_word_text_skipped() {
        let hocr =
            r#"<span class='ocrx_word' id='word_1' title='bbox 10 20 30 40; x_wconf 50'>  </span>"#;
        let words = parse_hocr_words_core(hocr, 300);
        assert!(words.is_empty());
    }
}
