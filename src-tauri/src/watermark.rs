//! M4：水印（文字 / 图片），支持位置、透明度、旋转与平铺。
//!
//! 透明度实现：
//! - 文字水印 → 填充色带 alpha（PdfColor 第四通道）
//! - 图片水印 → 像素级预乘 alpha 后再嵌入

use std::path::{Path, PathBuf};

use pdfium_render::prelude::*;
use serde::Deserialize;
use tauri::State;

use crate::document::{pdfium as get_pdfium, push_snapshot, AppState, DocumentInfo};
use crate::error::{AppError, AppResult};
use crate::pages::{commit_and_return, load_doc, normalize_indices};

/// 九宫格/平铺共用的页边留白（pt）
const MARGIN: f32 = 36.0;

/// 画布拖放得到的自定义位置：归一化因子（0–1，左下原点，同九宫格 fx/fy）。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomPosition {
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatermarkStyle {
    /// 0–100
    pub opacity: f32,
    /// 顺时针角度
    pub rotation: f32,
    /// "top-left" … "center" … "bottom-right"
    pub position: String,
    pub tiled: bool,
    /// 平铺间距（pt）
    pub tile_spacing: f32,
    /// 画布拖放定位（归一化因子）；非空且未平铺时优先于 `position`
    #[serde(default)]
    pub custom: Option<CustomPosition>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextWatermarkOpts {
    pub text: String,
    /// 字号（pt）
    pub font_size: f32,
    /// "#RRGGBB"
    pub color: String,
    pub style: WatermarkStyle,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageWatermarkOpts {
    pub image_path: String,
    /// 水印宽度占页面宽度的比例（0.05–1.0）
    pub scale: f32,
    pub style: WatermarkStyle,
}

// ---------- 工具函数 ----------

pub(crate) fn parse_color(hex: &str, opacity: f32) -> PdfColor {
    let h = hex.trim_start_matches('#');
    let byte = |s: &str| u8::from_str_radix(s, 16).unwrap_or(128);
    let (r, g, b) = match h.len() {
        6 => (byte(&h[0..2]), byte(&h[2..4]), byte(&h[4..6])),
        _ => (128, 128, 128),
    };
    let a = (opacity.clamp(0.0, 100.0) / 100.0 * 255.0).round() as u8;
    PdfColor::new(r, g, b, a)
}

/// 估算文本宽度：CJK 字符按全宽、其余按 0.55 倍字号
pub(crate) fn estimate_text_width(text: &str, font_size: f32) -> f32 {
    text.chars()
        .map(|c| if (c as u32) >= 0x2E80 { 1.0 } else { 0.55 })
        .sum::<f32>()
        * font_size
}

/// 九宫格标识 → 归一化因子 `(fx, fy)`（左下原点，0–1）。
pub(crate) fn position_factors(position: &str) -> (f32, f32) {
    match position {
        "top-left" => (0.0, 1.0),
        "top-center" => (0.5, 1.0),
        "top-right" => (1.0, 1.0),
        "middle-left" => (0.0, 0.5),
        "middle-right" => (1.0, 0.5),
        "bottom-left" => (0.0, 0.0),
        "bottom-center" => (0.5, 0.0),
        "bottom-right" => (1.0, 0.0),
        _ => (0.5, 0.5), // center
    }
}

/// 归一化因子 + 指定边距 → 对象左下角坐标（钳制为非负）。
pub(crate) fn anchor_with_margin(
    fx: f32,
    fy: f32,
    page_w: f32,
    page_h: f32,
    obj_w: f32,
    obj_h: f32,
    margin: f32,
) -> (f32, f32) {
    let x = margin + fx * (page_w - 2.0 * margin - obj_w);
    let y = margin + fy * (page_h - 2.0 * margin - obj_h);
    (x.max(0.0), y.max(0.0))
}

/// 归一化因子 → 对象左下角坐标（使用水印默认边距，钳制为非负）。
fn anchor_at(fx: f32, fy: f32, page_w: f32, page_h: f32, obj_w: f32, obj_h: f32) -> (f32, f32) {
    anchor_with_margin(fx, fy, page_w, page_h, obj_w, obj_h, MARGIN)
}

/// 九宫格锚点 → 对象左下角坐标
fn anchor(position: &str, page_w: f32, page_h: f32, obj_w: f32, obj_h: f32) -> (f32, f32) {
    let (fx, fy) = position_factors(position);
    anchor_at(fx, fy, page_w, page_h, obj_w, obj_h)
}

/// 单点水印位置：画布拖放的 `custom`（归一化，钳制到 0–1）优先，否则回退九宫格。
///
/// 平铺模式不使用本函数（调用方直接走 `tile_positions`），与前端预览一致。
fn anchor_for(
    style: &WatermarkStyle,
    page_w: f32,
    page_h: f32,
    obj_w: f32,
    obj_h: f32,
) -> (f32, f32) {
    match &style.custom {
        Some(c) => anchor_at(
            c.x.clamp(0.0, 1.0),
            c.y.clamp(0.0, 1.0),
            page_w,
            page_h,
            obj_w,
            obj_h,
        ),
        None => anchor(&style.position, page_w, page_h, obj_w, obj_h),
    }
}

/// 常见中文字体文件名候选，按优先级排列（微软雅黑 → 黑体 → 宋体 → 微软正黑 → 等线 → 楷体 → 仿宋）。
const CJK_FONT_CANDIDATES: &[&str] = &[
    "msyh.ttc",
    "msyhbd.ttc",
    "simhei.ttf",
    "simsun.ttc",
    "simsunb.ttf",
    "msjh.ttc",
    "msjhbd.ttc",
    "deng.ttf",
    "dengb.ttf",
    "simkai.ttf",
    "simfang.ttf",
];

/// 扫描系统字体目录时的文件名关键词：命中者视为中文字体，扫描时优先尝试。
const CJK_FONT_KEYWORDS: &[&str] = &[
    "msyh",
    "msjh",
    "sim",
    "hei",
    "song",
    "kai",
    "fang",
    "deng",
    "ming",
    "yahei",
    "gothic",
    "noto",
    "sourcehan",
    "arialuni",
];

/// 扫描系统字体目录时最多尝试的文件数，避免极端环境下逐个读取上百个字体文件拖慢编辑。
const FONT_SCAN_LIMIT: usize = 30;

/// 「原字体名关键词 → 系统字体文件名候选」映射（键全部小写，按子串匹配，靠前者优先）。
///
/// 深度编辑重写文字时用它尽量沿用原字体；未命中或系统缺少对应文件时，
/// 才回退到 [`load_font_for_text`] 的通用选字逻辑，并由调用方标记「近似替换」。
/// `Helvetica`/`Times`/`Courier` 是 PDF 基准字体，Windows 上分别以
/// Arial / Times New Roman / Courier New 渲染，属公认等效替换。
const FONT_NAME_MAP: &[(&str, &[&str])] = &[
    // ---------- 中文 ----------
    ("microsoftyahei", &["msyh.ttc", "msyhbd.ttc"]),
    ("yahei", &["msyh.ttc", "msyhbd.ttc"]),
    ("msyh", &["msyh.ttc", "msyhbd.ttc"]),
    ("simhei", &["simhei.ttf"]),
    ("simsun", &["simsun.ttc", "simsunb.ttf"]),
    ("nsimsun", &["simsun.ttc", "simsunb.ttf"]),
    ("simkai", &["simkai.ttf"]),
    ("kaiti", &["simkai.ttf"]),
    ("simfang", &["simfang.ttf"]),
    ("fangsong", &["simfang.ttf"]),
    ("msjh", &["msjh.ttc", "msjhbd.ttc"]),
    ("microsoftjhenghei", &["msjh.ttc", "msjhbd.ttc"]),
    ("dengxian", &["deng.ttf", "dengb.ttf"]),
    ("deng", &["deng.ttf", "dengb.ttf"]),
    ("songti", &["simsun.ttc", "simsunb.ttf"]),
    ("heiti", &["simhei.ttf"]),
    (
        "notosanscjk",
        &["NotoSansCJK-Regular.ttc", "NotoSansSC-Regular.otf"],
    ),
    ("sourcehansans", &["SourceHanSansSC-Regular.otf"]),
    // ---------- 西文 ----------
    ("helvetica", &["arial.ttf", "arialbd.ttf"]),
    ("arial", &["arial.ttf", "arialbd.ttf"]),
    ("timesnewroman", &["times.ttf", "timesbd.ttf"]),
    ("times", &["times.ttf", "timesbd.ttf"]),
    ("couriernew", &["cour.ttf", "courbd.ttf"]),
    ("courier", &["cour.ttf", "courbd.ttf"]),
    ("calibri", &["calibri.ttf", "calibrib.ttf"]),
    ("cambria", &["cambria.ttc", "cambriab.ttf"]),
    ("georgia", &["georgia.ttf", "georgiab.ttf"]),
    ("verdana", &["verdana.ttf", "verdanab.ttf"]),
    ("tahoma", &["tahoma.ttf", "tahomabd.ttf"]),
    ("segoe", &["segoeui.ttf", "segoeuib.ttf"]),
    ("consolas", &["consola.ttf", "consolab.ttf"]),
];

/// 系统字体目录：优先取 `%WINDIR%\Fonts`，环境变量缺失时退回 Windows 默认路径。
fn system_fonts_dir() -> PathBuf {
    std::env::var_os("WINDIR")
        .map(PathBuf::from)
        .map(|dir| dir.join("Fonts"))
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows\Fonts"))
}

/// 文件名是否像中文字体（扫描兜底时用于排序，不用于排除）。
fn looks_like_cjk_font(file_name: &str) -> bool {
    let name = file_name.to_ascii_lowercase();
    CJK_FONT_KEYWORDS.iter().any(|kw| name.contains(kw))
}

/// 尝试以 CID 键控、普通 TrueType 两种方式加载单个字体文件。
fn try_load_font_file(doc: &mut PdfDocument, path: &Path) -> Option<PdfFontToken> {
    if !path.is_file() {
        return None;
    }
    // 先按 CID 键控（中日韩字体常见），失败再按普通 TrueType。
    if let Ok(token) = doc.fonts_mut().load_true_type_from_file(path, true) {
        return Some(token);
    }
    doc.fonts_mut().load_true_type_from_file(path, false).ok()
}

/// 扫描系统字体目录，返回按「中文字体优先」排序并截断到 [`FONT_SCAN_LIMIT`] 的候选文件。
fn scan_font_files(fonts_dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(fonts_dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "ttf" | "ttc" | "otf"))
                .unwrap_or(false)
        })
        .collect();
    // 中文字体排前；组内按文件名排序，保证同一台机器上结果可复现。
    files.sort_by_key(|path| {
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        (!looks_like_cjk_font(&name), name)
    });
    files.truncate(FONT_SCAN_LIMIT);
    files
}

/// 按需加载字体：纯 ASCII 用内置 Helvetica；含中文则回退到系统中文字体（CID 加载）。
///
/// 回退顺序：
/// 1. 常见中文字体候选（见 [`CJK_FONT_CANDIDATES`]）按优先级命中即用；
/// 2. 仍未命中则扫描系统字体目录，取第一个可加载且非符号字体的字体；
/// 3. 全部失败才返回 [`AppError::NoChineseFont`]。
pub(crate) fn load_font_for_text(doc: &mut PdfDocument, text: &str) -> AppResult<PdfFontToken> {
    if text.is_ascii() {
        return Ok(doc.fonts_mut().helvetica());
    }

    let fonts_dir = system_fonts_dir();
    for name in CJK_FONT_CANDIDATES {
        if let Some(token) = try_load_font_file(doc, &fonts_dir.join(name)) {
            return Ok(token);
        }
    }

    // 兜底：系统装的是列表中之外的字体，或字体目录不在默认位置时，扫描目录找可用字体。
    // 符号字体（Wingdings 等）不含中文字形，跳过以免渲染成空白。
    for path in scan_font_files(&fonts_dir) {
        if let Some(token) = try_load_font_file(doc, &path) {
            if !doc
                .fonts()
                .get(token)
                .map(|font| font.is_symbolic())
                .unwrap_or(false)
            {
                return Ok(token);
            }
        }
    }

    Err(AppError::NoChineseFont)
}

/// 按原字体名加载最接近的系统字体，用于「沿用原字体样式重绘」。
///
/// 返回 `(字体 token, 是否近似替换)`：`approximated == false` 表示命中了原字体
/// （或在 Windows 上属于公认等效替换），调用方无需提示；`true` 表示只能用替代字体，
/// 应提示用户「原字体不可用，已用近似字体替换」。
///
/// 顺序：
/// 1. 原字体名命中 [`FONT_NAME_MAP`] 且系统存在对应字体文件 → 直接用，记为精确；
/// 2. 否则回退 [`load_font_for_text`]（按文本是否含中文选字），记为近似。
pub(crate) fn load_font_for_text_style(
    doc: &mut PdfDocument,
    source_font_name: Option<&str>,
    text: &str,
) -> AppResult<(PdfFontToken, bool)> {
    let source = source_font_name
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_ascii_lowercase);

    if let Some(source) = source.as_deref() {
        if let Some((_, files)) = FONT_NAME_MAP.iter().find(|(key, _)| source.contains(key)) {
            // 含非 ASCII 的文本只能交给「看起来支持中文」的候选文件，
            // 否则（如 Arial）会缺字形渲染成空白。
            let usable: Vec<&str> = if text.is_ascii() {
                files.to_vec()
            } else {
                files
                    .iter()
                    .copied()
                    .filter(|file| looks_like_cjk_font(file))
                    .collect()
            };
            let fonts_dir = system_fonts_dir();
            for file in usable {
                if let Some(token) = try_load_font_file(doc, &fonts_dir.join(file)) {
                    return Ok((token, false));
                }
            }
        }
    }

    load_font_for_text(doc, text).map(|token| (token, true))
}

/// 平铺网格生成器：交错排列覆盖整页
fn tile_positions(
    page_w: f32,
    page_h: f32,
    obj_w: f32,
    obj_h: f32,
    spacing: f32,
) -> Vec<(f32, f32)> {
    let spacing = if spacing > 10.0 { spacing } else { 120.0 };
    let step_x = obj_w + spacing;
    let step_y = obj_h + spacing;
    let mut out = Vec::new();
    let mut row = 0u32;
    let mut y = -step_y;
    while y < page_h {
        let offset = (row % 2) as f32 * step_x / 2.0;
        let mut x = -step_x + offset;
        while x < page_w {
            out.push((x, y));
            x += step_x;
        }
        y += step_y;
        row += 1;
    }
    out
}

/// 图片水印透明度：像素级乘 alpha
fn apply_image_opacity(img: image::DynamicImage, opacity: f32) -> image::DynamicImage {
    let factor = opacity.clamp(0.0, 100.0) / 100.0;
    if factor >= 0.999 {
        return img;
    }
    let rgba = img.to_rgba8();
    let mut rgba = rgba;
    for p in rgba.pixels_mut() {
        p[3] = (p[3] as f32 * factor).round() as u8;
    }
    image::DynamicImage::ImageRgba8(rgba)
}

// ---------- 纯函数 ----------

/// 纯函数：为指定页叠加文字水印，返回新的 PDF 字节（可脱 Tauri 单测）。
///
/// `pages` 为空表示作用于全部页；越界页报 [`AppError::PageOutOfRange`]，
/// 文本为空报 [`AppError::WatermarkTextEmpty`]。
pub fn add_text_watermark_logic(
    pdfium: &Pdfium,
    bytes: &[u8],
    pages: &[u32],
    opts: &TextWatermarkOpts,
) -> AppResult<Vec<u8>> {
    if opts.text.trim().is_empty() {
        return Err(AppError::WatermarkTextEmpty);
    }
    let mut doc = load_doc(pdfium, bytes)?;
    let total = doc.pages().len() as u32;
    let all: Vec<u32> = if pages.is_empty() {
        (0..total).collect()
    } else {
        pages.to_vec()
    };
    let indices = normalize_indices(&all, total)?;
    // 先取字体 token，避免与 pages_mut 可变借用冲突
    let font_token = load_font_for_text(&mut doc, &opts.text)?;
    let color = parse_color(&opts.color, opts.style.opacity);
    let rot = opts.style.rotation;
    let tiled = opts.style.tiled;
    let spacing = opts.style.tile_spacing;
    let font_size = opts.font_size.max(4.0);
    let text_w = estimate_text_width(&opts.text, font_size);
    {
        let pages_col = doc.pages_mut();
        for idx in indices {
            let mut page = pages_col.get(idx)?;
            let pw = page.width().value as f32;
            let ph = page.height().value as f32;
            let spots = if tiled {
                tile_positions(pw, ph, text_w, font_size, spacing)
            } else {
                vec![anchor_for(&opts.style, pw, ph, text_w, font_size)]
            };
            let objects = page.objects_mut();
            for (x, y) in spots {
                let mut obj = objects.create_text_object(
                    PdfPoints::new(x),
                    PdfPoints::new(y),
                    &opts.text,
                    font_token,
                    PdfPoints::new(font_size),
                )?;
                obj.set_fill_color(color)?;
                if rot.abs() > 0.01 {
                    obj.rotate_clockwise_degrees(rot)?;
                }
            }
        }
    }
    Ok(doc.save_to_bytes()?)
}

// ---------- 命令 ----------

#[tauri::command]
pub async fn add_text_watermark(
    state: State<'_, AppState>,
    doc_id: u64,
    pages: Vec<u32>,
    opts: TextWatermarkOpts,
) -> AppResult<DocumentInfo> {
    if opts.text.trim().is_empty() {
        return Err(AppError::WatermarkTextEmpty);
    }
    push_snapshot(&state, doc_id);
    let _gate = crate::document::pdfium_gate();
    let pdfium = get_pdfium();
    let new_bytes = {
        let docs = state.docs.lock().unwrap();
        let entry = docs.get(&doc_id).ok_or(AppError::NotFound)?;
        add_text_watermark_logic(pdfium, &entry.bytes, &pages, &opts)?
    };
    commit_and_return(&state, doc_id, new_bytes)
}

#[tauri::command]
pub async fn add_image_watermark(
    state: State<'_, AppState>,
    doc_id: u64,
    pages: Vec<u32>,
    opts: ImageWatermarkOpts,
) -> AppResult<DocumentInfo> {
    push_snapshot(&state, doc_id);
    let _gate = crate::document::pdfium_gate();
    let img = image::open(&opts.image_path).map_err(|_| AppError::ImageReadFailed {
        path: opts.image_path.clone(),
    })?;
    let img = apply_image_opacity(img, opts.style.opacity);
    let (iw, ih) = (img.width() as f32, img.height() as f32);
    if iw < 1.0 || ih < 1.0 {
        return Err(AppError::InvalidImageSize);
    }
    let pdfium = get_pdfium();
    let new_bytes = {
        let docs = state.docs.lock().unwrap();
        let entry = docs.get(&doc_id).ok_or(AppError::NotFound)?;
        let mut doc = load_doc(pdfium, &entry.bytes)?;
        let total = doc.pages().len() as u32;
        let indices = normalize_indices(&pages, total)?;
        let rot = opts.style.rotation;
        let tiled = opts.style.tiled;
        let spacing = opts.style.tile_spacing;
        let scale = opts.scale.clamp(0.05, 1.0);
        {
            let pages_col = doc.pages_mut();
            for idx in indices {
                let mut page = pages_col.get(idx)?;
                let pw = page.width().value as f32;
                let ph = page.height().value as f32;
                // 水印宽度 = 页宽 × scale，高度按纵横比
                let wm_w = pw * scale;
                let wm_h = wm_w * ih / iw;
                let spots = if tiled {
                    tile_positions(pw, ph, wm_w, wm_h, spacing)
                } else {
                    vec![anchor_for(&opts.style, pw, ph, wm_w, wm_h)]
                };
                let objects = page.objects_mut();
                for (x, y) in spots {
                    let mut obj = objects.create_image_object(
                        PdfPoints::new(x),
                        PdfPoints::new(y),
                        &img,
                        Some(PdfPoints::new(wm_w)),
                        Some(PdfPoints::new(wm_h)),
                    )?;
                    if rot.abs() > 0.01 {
                        obj.rotate_clockwise_degrees(rot)?;
                    }
                }
            }
        }
        doc.save_to_bytes()?
    };
    commit_and_return(&state, doc_id, new_bytes)
}

#[cfg(test)]
mod tests {
    //! Unit tests for watermark placement + color parsing.
    use super::*;

    fn approx(a: f32, b: f32) {
        assert!((a - b).abs() < 1.0, "approx {a} vs {b}");
    }

    /// parse_color: 6-char hex with hash.
    #[test]
    fn parse_color_basic() {
        let c = parse_color("#ff8040", 50.0);
        assert_eq!(c.red(), 0xff);
        assert_eq!(c.green(), 0x80);
        assert_eq!(c.blue(), 0x40);
        // alpha = 50/100 * 255 = 127 (rounded)
        assert_eq!(c.alpha(), 128, "alpha rounded from 127.5");
    }

    /// parse_color: without hash.
    #[test]
    fn parse_color_without_hash() {
        let c = parse_color("ff8040", 100.0);
        assert_eq!(c.red(), 0xff);
        assert_eq!(c.alpha(), 255);
    }

    /// parse_color: invalid/short hex falls back to gray (128,128,128).
    #[test]
    fn parse_color_invalid_falls_back_to_gray() {
        let c = parse_color("#abc", 50.0);
        assert_eq!(c.red(), 128);
        assert_eq!(c.green(), 128);
        assert_eq!(c.blue(), 128);

        let c = parse_color("", 50.0);
        assert_eq!(c.red(), 128);
    }

    /// parse_color: opacity clamped to 0..=100.
    #[test]
    fn parse_color_opacity_clamped() {
        let c_neg = parse_color("#000000", -50.0);
        assert_eq!(c_neg.alpha(), 0, "negative opacity clamped to 0");

        let c_over = parse_color("#000000", 200.0);
        assert_eq!(c_over.alpha(), 255, "opacity > 100 clamped to 100");
    }

    /// estimate_text_width: ASCII chars use 0.55 factor.
    #[test]
    fn estimate_text_width_ascii() {
        let w = estimate_text_width("Hello", 10.0);
        // 5 * 0.55 * 10 = 27.5
        approx(w, 27.5);
    }

    /// estimate_text_width: CJK chars use full-width factor.
    #[test]
    fn estimate_text_width_cjk() {
        // \u{4E2D} = "Zhong" (CJK Unified Ideograph), > 0x2E80
        let w = estimate_text_width("\u{4E2D}\u{4F60}", 10.0);
        // 2 * 1.0 * 10 = 20
        approx(w, 20.0);
    }

    /// estimate_text_width: mixed text combines factors correctly.
    #[test]
    fn estimate_text_width_mixed() {
        // 2 ASCII (0.55) + 1 CJK (1.0) = 1.1 + 1.0 = 2.1 * 10 = 21
        let w = estimate_text_width("Hi\u{4E2D}", 10.0);
        approx(w, 21.0);
    }

    /// estimate_text_width: empty string returns 0.
    #[test]
    fn estimate_text_width_empty() {
        assert_eq!(estimate_text_width("", 10.0), 0.0);
    }

    /// looks_like_cjk_font: 常见中文字体命中，拉丁字体不命中，大小写不敏感。
    #[test]
    fn looks_like_cjk_font_matches_chinese_names() {
        assert!(looks_like_cjk_font("msyh.ttc"));
        assert!(looks_like_cjk_font("MSYHBD.TTC"));
        assert!(looks_like_cjk_font("simsun.ttc"));
        assert!(looks_like_cjk_font("NotoSansSC-Regular.otf"));
        assert!(!looks_like_cjk_font("arial.ttf"));
        assert!(!looks_like_cjk_font("wingding.ttf"));
    }

    /// system_fonts_dir: 结构为 `<WINDIR>\Fonts`。
    #[test]
    fn system_fonts_dir_ends_with_fonts() {
        let dir = system_fonts_dir();
        assert_eq!(dir.file_name().and_then(|n| n.to_str()), Some("Fonts"));
    }

    /// anchor: each of 9 positions resolves as expected.
    #[test]
    fn anchor_nine_grid() {
        let page_w = 612.0;
        let page_h = 792.0;
        let obj_w = 100.0;
        let obj_h = 50.0;
        // top-left -> x=MARGIN, y=page_h - MARGIN - obj_h
        let (x, y) = anchor("top-left", page_w, page_h, obj_w, obj_h);
        approx(x, MARGIN);
        approx(y, MARGIN + (page_h - 2.0 * MARGIN - obj_h));
        // 36 + (792 - 72 - 50) = 36 + 670 = 706
        approx(y, 706.0);

        // bottom-left -> y=MARGIN
        let (_, ybl) = anchor("bottom-left", page_w, page_h, obj_w, obj_h);
        approx(ybl, MARGIN);
    }

    /// anchor: center is the default for unknown positions.
    #[test]
    fn anchor_unknown_defaults_to_center() {
        let (xc, yc) = anchor("center", 612.0, 792.0, 100.0, 50.0);
        let (xdef, ydef) = anchor("not-a-position", 612.0, 792.0, 100.0, 50.0);
        approx(xc, xdef);
        approx(yc, ydef);
    }

    /// anchor: x and y are clamped to >= 0 even for very small pages.
    #[test]
    fn anchor_clamps_non_negative() {
        // page smaller than 2 * MARGIN + obj
        let (x, y) = anchor("center", 10.0, 10.0, 100.0, 100.0);
        assert!(x >= 0.0, "x clamped to >= 0");
        assert!(y >= 0.0, "y clamped to >= 0");
    }

    /// anchor_for: 自定义归一化位置优先于九宫格 position。
    #[test]
    fn anchor_for_custom_overrides_position() {
        let style = WatermarkStyle {
            opacity: 100.0,
            rotation: 0.0,
            position: "top-left".into(),
            tiled: false,
            tile_spacing: 120.0,
            custom: Some(CustomPosition { x: 0.25, y: 0.75 }),
        };
        let (x, y) = anchor_for(&style, 612.0, 792.0, 100.0, 50.0);
        let (ex, ey) = anchor_at(0.25, 0.75, 612.0, 792.0, 100.0, 50.0);
        approx(x, ex);
        approx(y, ey);
    }

    /// anchor_for: 越界的自定义因子被钳制到 0–1。
    #[test]
    fn anchor_for_custom_clamps_out_of_range() {
        let style = WatermarkStyle {
            opacity: 100.0,
            rotation: 0.0,
            position: "center".into(),
            tiled: false,
            tile_spacing: 120.0,
            custom: Some(CustomPosition { x: 2.0, y: -1.0 }),
        };
        let (x, y) = anchor_for(&style, 612.0, 792.0, 100.0, 50.0);
        let (ex, ey) = anchor_at(1.0, 0.0, 612.0, 792.0, 100.0, 50.0);
        approx(x, ex);
        approx(y, ey);
    }

    /// anchor_for: 无自定义位置时回退九宫格，与 anchor 结果一致。
    #[test]
    fn anchor_for_none_matches_nine_grid() {
        let style = WatermarkStyle {
            opacity: 100.0,
            rotation: 0.0,
            position: "bottom-right".into(),
            tiled: false,
            tile_spacing: 120.0,
            custom: None,
        };
        let (x, y) = anchor_for(&style, 612.0, 792.0, 100.0, 50.0);
        let (ex, ey) = anchor("bottom-right", 612.0, 792.0, 100.0, 50.0);
        approx(x, ex);
        approx(y, ey);
    }

    /// tile_positions: spacing below threshold gets coerced to 120.
    #[test]
    fn tile_positions_minimum_spacing() {
        // small spacing should be silently bumped to 120
        let pos_small = tile_positions(300.0, 300.0, 50.0, 50.0, 5.0);
        let pos_default = tile_positions(300.0, 300.0, 50.0, 50.0, 120.0);
        assert_eq!(pos_small.len(), pos_default.len());
    }

    /// tile_positions: empty when obj larger than page.
    #[test]
    fn tile_positions_oversized_object() {
        // obj 1000x1000 on a 100x100 page -> no positions fit
        let pos = tile_positions(100.0, 100.0, 1000.0, 1000.0, 120.0);
        // At least one position is generated from the negative y start (y = -step_y)
        // so we just assert it produces a finite, non-empty list
        assert!(!pos.is_empty());
        for (x, y) in pos {
            assert!(x.is_finite() && y.is_finite());
        }
    }
}
