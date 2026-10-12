//! M5：PDF 注释（annotations）管理
//!
//! 支持：高亮 / 下划线 / 删除线 / 便签 / 自由文本 / 矩形
//! 支持：列出注释、删除注释、清空页面注释
//!
//! 坐标约定：前端传归一化比例（0–1，CSS 左上原点），后端换算为 PDF 点（pt，左下原点）。

use pdfium_render::prelude::*;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::document::{pdfium as get_pdfium, push_snapshot, AppState, DocumentInfo};
use crate::error::{AppError, AppResult};
use crate::pages::{commit_and_return, load_doc, normalize_indices};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AnnotationKind {
    Highlight,
    Underline,
    Strikeout,
    StickyNote,
    FreeText,
    Square,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationInfo {
    pub index: u32,
    pub page_index: u32,
    pub kind: AnnotationKind,
    pub left: f32,
    pub bottom: f32,
    pub right: f32,
    pub top: f32,
    pub contents: String,
    pub color: String,
}

/// 归一化区域（0–1，CSS 坐标系：左上原点）
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionSpec {
    pub left: f32,
    pub top: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddAnnotationOpts {
    pub kind: AnnotationKind,
    pub region: RegionSpec,
    pub contents: String,
    /// "#RRGGBB"
    pub color: String,
    pub opacity: f32,
}

fn parse_color_hex(hex: &str) -> PdfColor {
    let h = hex.trim_start_matches('#');
    let byte = |s: &str| u8::from_str_radix(s, 16).unwrap_or(255);
    match h.len() {
        6 => PdfColor::new(byte(&h[0..2]), byte(&h[2..4]), byte(&h[4..6]), 255),
        _ => PdfColor::new(255, 255, 0, 255),
    }
}

fn color_to_hex(c: PdfColor) -> String {
    format!("#{:02x}{:02x}{:02x}", c.red(), c.green(), c.blue())
}

/// 归一化区域 → PDF 坐标 (left, bottom, right, top)
fn region_to_pdf_rect(
    page_w: f32,
    page_h: f32,
    r: &RegionSpec,
) -> (PdfPoints, PdfPoints, PdfPoints, PdfPoints) {
    let l = (r.left.clamp(0.0, 1.0) * page_w).max(0.0);
    let r_x = ((r.left + r.width).clamp(0.0, 1.0) * page_w).max(0.0);
    // CSS top → PDF：y 从顶向下，PDF y 从底向上
    let t = ((1.0 - r.top.clamp(0.0, 1.0)) * page_h).max(0.0);
    let b = ((1.0 - (r.top + r.height).clamp(0.0, 1.0)) * page_h).max(0.0);
    let left = PdfPoints::new(l.min(r_x));
    let right = PdfPoints::new(l.max(r_x));
    let bottom = PdfPoints::new(t.min(b));
    let top = PdfPoints::new(t.max(b));
    (left, bottom, right, top)
}

fn make_rect(page_w: f32, page_h: f32, r: &RegionSpec) -> PdfRect {
    let (left, bottom, right, top) = region_to_pdf_rect(page_w, page_h, r);
    PdfRect::new(bottom, left, top, right)
}

fn make_quad(page_w: f32, page_h: f32, r: &RegionSpec) -> PdfQuadPoints {
    let (left, bottom, right, top) = region_to_pdf_rect(page_w, page_h, r);
    // 左上 → 右上 → 右下 → 左下（PDF 坐标）
    PdfQuadPoints::new(left, top, right, top, right, bottom, left, bottom)
}

fn annotation_to_color(annot: &pdfium_render::prelude::PdfPageAnnotation<'_>) -> String {
    if let Ok(c) = annot.stroke_color() {
        color_to_hex(c)
    } else if let Ok(c) = annot.fill_color() {
        color_to_hex(c)
    } else {
        "#ffff00".to_string()
    }
}

fn map_kind(kind: PdfPageAnnotationType) -> Option<AnnotationKind> {
    match kind {
        PdfPageAnnotationType::Highlight => Some(AnnotationKind::Highlight),
        PdfPageAnnotationType::Underline => Some(AnnotationKind::Underline),
        PdfPageAnnotationType::Strikeout => Some(AnnotationKind::Strikeout),
        PdfPageAnnotationType::Text => Some(AnnotationKind::StickyNote),
        PdfPageAnnotationType::FreeText => Some(AnnotationKind::FreeText),
        PdfPageAnnotationType::Square => Some(AnnotationKind::Square),
        _ => None,
    }
}

// ---------- 纯函数（可测） ----------

/// 列出页面注释（纯函数版本）。
/// page_index = None 表示所有页。
pub fn list_annotations_logic(
    bytes: &[u8],
    page_index: Option<u32>,
) -> AppResult<Vec<AnnotationInfo>> {
    let pdfium = get_pdfium();
    let doc = load_doc(pdfium, bytes)?;
    let total = doc.pages().len() as u32;
    let range: Vec<u32> = match page_index {
        Some(p) if p < total => vec![p],
        Some(_) => return Err(AppError::PageOutOfRange),
        None => (0..total).collect(),
    };
    let mut out = Vec::new();
    let pages = doc.pages();
    for p_idx in range {
        let page = pages.get(p_idx as u16)?;
        let annots = page.annotations();
        let count = annots.len() as u32;
        for i in 0..count {
            let annot = match annots.get(i as usize) {
                Ok(a) => a,
                Err(_) => continue,
            };
            let Some(kind) = map_kind(annot.annotation_type()) else {
                continue;
            };
            let bounds = match annot.bounds() {
                Ok(b) => b,
                Err(_) => continue,
            };
            out.push(AnnotationInfo {
                index: i,
                page_index: p_idx,
                kind,
                left: bounds.left().value as f32,
                bottom: bounds.bottom().value as f32,
                right: bounds.right().value as f32,
                top: bounds.top().value as f32,
                contents: annot.contents().unwrap_or_default(),
                color: annotation_to_color(&annot),
            });
        }
    }
    Ok(out)
}

/// 添加注释（纯函数版本）：返回新 bytes。
pub fn add_annotation_logic(
    bytes: &[u8],
    page_index: u32,
    opts: &AddAnnotationOpts,
) -> AppResult<Vec<u8>> {
    let pdfium = get_pdfium();
    let mut doc = load_doc(pdfium, bytes)?;
    let total = doc.pages().len() as u32;
    if page_index >= total {
        return Err(AppError::PageOutOfRange);
    }
    let color = parse_color_hex(&opts.color);
    {
        let pages = doc.pages_mut();
        let mut page = pages.get(page_index as u16)?;
        let pw = page.width().value as f32;
        let ph = page.height().value as f32;
        let rect = make_rect(pw, ph, &opts.region);
        let annots = page.annotations_mut();
        match opts.kind {
            AnnotationKind::Highlight => {
                let mut annot = annots.create_highlight_annotation()?;
                let q = make_quad(pw, ph, &opts.region);
                annot
                    .attachment_points_mut()
                    .create_attachment_point_at_end(q)?;
                annot.set_contents(&opts.contents)?;
                let _ = annot.set_fill_color(color);
                let _ = annot.set_bounds(rect);
            }
            AnnotationKind::Underline => {
                let mut annot = annots.create_underline_annotation()?;
                let q = make_quad(pw, ph, &opts.region);
                annot
                    .attachment_points_mut()
                    .create_attachment_point_at_end(q)?;
                annot.set_contents(&opts.contents)?;
                let _ = annot.set_stroke_color(color);
                // /Rect 必须显式写出：否则为全零，读取端（list_annotations）拿不到边界，画布无法渲染。
                let _ = annot.set_bounds(rect);
            }
            AnnotationKind::Strikeout => {
                let mut annot = annots.create_strikeout_annotation()?;
                let q = make_quad(pw, ph, &opts.region);
                annot
                    .attachment_points_mut()
                    .create_attachment_point_at_end(q)?;
                annot.set_contents(&opts.contents)?;
                let _ = annot.set_stroke_color(color);
                // /Rect 必须显式写出：否则为全零，读取端（list_annotations）拿不到边界，画布无法渲染。
                let _ = annot.set_bounds(rect);
            }
            AnnotationKind::StickyNote => {
                let mut annot = annots.create_text_annotation(&opts.contents)?;
                let _ = annot.set_bounds(rect);
                let _ = annot.set_fill_color(color);
            }
            AnnotationKind::FreeText => {
                let mut annot = annots.create_free_text_annotation(&opts.contents)?;
                let _ = annot.set_bounds(rect);
                let _ = annot.set_stroke_color(color);
                let _ = annot.set_fill_color(PdfColor::new(0, 0, 0, 0));
            }
            AnnotationKind::Square => {
                let mut annot = annots.create_square_annotation()?;
                let _ = annot.set_bounds(rect);
                let _ = annot.set_stroke_color(color);
                annot.set_contents(&opts.contents)?;
            }
        }
    }
    Ok(doc.save_to_bytes()?)
}

/// 删除注释（纯函数版本）：返回新 bytes。
pub fn delete_annotation_logic(
    bytes: &[u8],
    page_index: u32,
    annotation_index: u32,
) -> AppResult<Vec<u8>> {
    let pdfium = get_pdfium();
    let mut doc = load_doc(pdfium, bytes)?;
    let total = doc.pages().len() as u32;
    if page_index >= total {
        return Err(AppError::PageOutOfRange);
    }
    {
        let pages = doc.pages_mut();
        let mut page = pages.get(page_index as u16)?;
        let annots = page.annotations_mut();
        if annotation_index >= annots.len() as u32 {
            return Err(AppError::AnnotationOutOfRange);
        }
        let annot = annots.get(annotation_index as usize)?;
        annots.delete_annotation(annot)?;
    }
    Ok(doc.save_to_bytes()?)
}

/// 扁平化注释（纯函数版本）：把注释合并进页面内容，合并后无法再单独编辑。
/// `pages` 为空表示全部页；无注释/表单字段的页返回 FLATTEN_NOTHINGTODO（视为成功）。
pub fn flatten_annotations_logic(bytes: &[u8], pages: &[u32]) -> AppResult<Vec<u8>> {
    let pdfium = get_pdfium();
    let mut doc = load_doc(pdfium, bytes)?;
    let total = doc.pages().len() as u32;
    let indices: Vec<u16> = if pages.is_empty() {
        (0..total)
            .map(|i| i as u16)
            .collect()
    } else {
        normalize_indices(pages, total)?
    };
    {
        let pages_col = doc.pages_mut();
        for idx in indices {
            let mut page = pages_col.get(idx)?;
            page.flatten()?;
        }
    }
    Ok(doc.save_to_bytes()?)
}

// ---------- 命令 ----------

#[tauri::command]
pub async fn list_annotations(
    state: State<'_, AppState>,
    doc_id: u64,
    page_index: Option<u32>,
) -> AppResult<Vec<AnnotationInfo>> {
    let _gate = crate::document::pdfium_gate();
    let _pdfium = get_pdfium();
    let docs = state.docs.lock().unwrap();
    let entry = docs.get(&doc_id).ok_or(AppError::NotFound)?;
    list_annotations_logic(&entry.bytes, page_index)
}

#[tauri::command]
pub async fn add_annotation(
    state: State<'_, AppState>,
    doc_id: u64,
    page_index: u32,
    opts: AddAnnotationOpts,
) -> AppResult<DocumentInfo> {
    let _gate = crate::document::pdfium_gate();
    push_snapshot(&state, doc_id);
    let _pdfium = get_pdfium();
    let new_bytes = {
        let docs = state.docs.lock().unwrap();
        let entry = docs.get(&doc_id).ok_or(AppError::NotFound)?;
        add_annotation_logic(&entry.bytes, page_index, &opts)?
    };
    commit_and_return(&state, doc_id, new_bytes)
}

#[tauri::command]
pub async fn delete_annotation(
    state: State<'_, AppState>,
    doc_id: u64,
    page_index: u32,
    annotation_index: u32,
) -> AppResult<DocumentInfo> {
    let _gate = crate::document::pdfium_gate();
    push_snapshot(&state, doc_id);
    let _pdfium = get_pdfium();
    let new_bytes = {
        let docs = state.docs.lock().unwrap();
        let entry = docs.get(&doc_id).ok_or(AppError::NotFound)?;
        delete_annotation_logic(&entry.bytes, page_index, annotation_index)?
    };
    commit_and_return(&state, doc_id, new_bytes)
}

#[tauri::command]
pub async fn clear_annotations(
    state: State<'_, AppState>,
    doc_id: u64,
    pages: Vec<u32>,
) -> AppResult<DocumentInfo> {
    let _gate = crate::document::pdfium_gate();
    push_snapshot(&state, doc_id);
    let pdfium = get_pdfium();
    let new_bytes = {
        let docs = state.docs.lock().unwrap();
        let entry = docs.get(&doc_id).ok_or(AppError::NotFound)?;
        let mut doc = load_doc(pdfium, &entry.bytes)?;
        let total = doc.pages().len() as u32;
        let indices = normalize_indices(&pages, total)?;
        {
            let pages_col = doc.pages_mut();
            for idx in indices.iter().rev() {
                let mut page = pages_col.get(*idx)?;
                let annots = page.annotations_mut();
                let n = annots.len();
                for _ in 0..n {
                    if let Ok(annot) = annots.get(0) {
                        let _ = annots.delete_annotation(annot);
                    } else {
                        break;
                    }
                }
            }
        }
        doc.save_to_bytes()?
    };
    commit_and_return(&state, doc_id, new_bytes)
}

/// 扁平化注释到页面内容（防篡改）。`pages` 为空表示全部页。
#[tauri::command]
pub async fn flatten_annotations(
    state: State<'_, AppState>,
    doc_id: u64,
    pages: Vec<u32>,
) -> AppResult<DocumentInfo> {
    let _gate = crate::document::pdfium_gate();
    push_snapshot(&state, doc_id);
    let _pdfium = get_pdfium();
    let new_bytes = {
        let docs = state.docs.lock().unwrap();
        let entry = docs.get(&doc_id).ok_or(AppError::NotFound)?;
        flatten_annotations_logic(&entry.bytes, &pages)?
    };
    commit_and_return(&state, doc_id, new_bytes)
}

/// 将文本内容（如注释摘要 Markdown）写入用户选定路径。
#[tauri::command]
pub fn export_text_file(output_path: String, contents: String) -> AppResult<String> {
    std::fs::write(&output_path, contents).map_err(AppError::Io)?;
    Ok(output_path)
}

#[cfg(test)]
mod tests {
    //! Unit tests for color parsing, region-to-PDF-rect conversion, and
    //! PdfPageAnnotationType -> AnnotationKind mapping.

    use super::*;

    /// parse_color_hex accepts both #RRGGBB and RRGGBB.
    #[test]
    fn parse_color_hex_with_and_without_hash() {
        let c1 = parse_color_hex("#ff8040");
        let c2 = parse_color_hex("ff8040");
        assert_eq!(c1.red(), c2.red());
        assert_eq!(c1.green(), c2.green());
        assert_eq!(c1.blue(), c2.blue());
        assert_eq!(c1.red(), 0xff);
        assert_eq!(c1.green(), 0x80);
        assert_eq!(c1.blue(), 0x40);
        assert_eq!(c1.alpha(), 255, "alpha is fully opaque by default");
    }

    /// parse_color_hex: short (non-6-char) inputs hit the catch-all branch
    /// and produce yellow (255, 255, 0).
    #[test]
    fn parse_color_hex_short_falls_back_to_yellow() {
        // 3-char short hex (#abc) takes the `_ => yellow` branch.
        let c = parse_color_hex("#abc");
        assert_eq!(c.red(), 255);
        assert_eq!(c.green(), 255);
        assert_eq!(c.blue(), 0);
    }

    /// color_to_hex roundtrips parse_color_hex for the basic RGB triple.
    #[test]
    fn color_to_hex_roundtrip() {
        // We can not construct a PdfColor directly without going through
        // parse_color_hex or a from-pdfium path. So we exercise the roundtrip
        // by parsing then formatting.
        let original = parse_color_hex("#123abc");
        let formatted = color_to_hex(original);
        let reparsed = parse_color_hex(&formatted);
        assert_eq!(original.red(), reparsed.red());
        assert_eq!(original.green(), reparsed.green());
        assert_eq!(original.blue(), reparsed.blue());
    }

    fn approx(a: f32, b: f32) {
        assert!((a - b).abs() < 1e-3, "approx {a} vs {b}");
    }

    /// region_to_pdf_rect: standard interior rectangle.
    #[test]
    fn region_to_pdf_rect_interior() {
        // Page 100x100 pt, region left=0.1 top=0.2 width=0.5 height=0.3
        let r = RegionSpec {
            left: 0.1,
            top: 0.2,
            width: 0.5,
            height: 0.3,
        };
        let (left, bottom, right, top) = region_to_pdf_rect(100.0, 100.0, &r);
        // x: 0.1 -> 10, right = 0.1+0.5 = 0.6 -> 60
        approx(left.value, 10.0);
        approx(right.value, 60.0);
        // y: top=0.2 -> pdf 80 (1 - 0.2 = 0.8 * 100); bottom = 1 - 0.5 = 0.5 * 100 = 50
        approx(top.value, 80.0);
        approx(bottom.value, 50.0);
    }

    /// region_to_pdf_rect clamps inputs to [0, 1].
    #[test]
    fn region_to_pdf_rect_clamps() {
        let r = RegionSpec {
            left: -0.5,
            top: 1.5,
            width: 2.0,
            height: 0.5,
        };
        let (left, bottom, right, top) = region_to_pdf_rect(100.0, 100.0, &r);
        // left clamped to 0, right clamped to 1 (1.0 * 100 = 100)
        assert_eq!(left.value, 0.0);
        assert_eq!(right.value, 100.0);
        // top = 1 - clamp(1.5)= 1 - 1 = 0; bottom = 1 - clamp(2.0)= 1 - 1 = 0
        // Both clamp to 0 -> min/max of 0
        assert_eq!(top.value, 0.0);
        assert_eq!(bottom.value, 0.0);
    }

    /// region_to_pdf_rect guarantees left <= right and bottom <= top.
    #[test]
    fn region_to_pdf_rect_invariant() {
        // Pathological: left > right (width=0 should still work)
        let r = RegionSpec {
            left: 0.5,
            top: 0.5,
            width: 0.0,
            height: 0.0,
        };
        let (left, bottom, right, top) = region_to_pdf_rect(100.0, 100.0, &r);
        assert!(left.value <= right.value);
        assert!(bottom.value <= top.value);
    }

    /// map_kind covers all supported annotation kinds.
    #[test]
    fn map_kind_supported() {
        assert_eq!(
            map_kind(PdfPageAnnotationType::Highlight),
            Some(AnnotationKind::Highlight)
        );
        assert_eq!(
            map_kind(PdfPageAnnotationType::Underline),
            Some(AnnotationKind::Underline)
        );
        assert_eq!(
            map_kind(PdfPageAnnotationType::Strikeout),
            Some(AnnotationKind::Strikeout)
        );
        assert_eq!(
            map_kind(PdfPageAnnotationType::Text),
            Some(AnnotationKind::StickyNote)
        );
        assert_eq!(
            map_kind(PdfPageAnnotationType::FreeText),
            Some(AnnotationKind::FreeText)
        );
        assert_eq!(
            map_kind(PdfPageAnnotationType::Square),
            Some(AnnotationKind::Square)
        );
    }

    /// map_kind returns None for unsupported kinds.
    #[test]
    fn map_kind_unsupported_returns_none() {
        assert_eq!(map_kind(PdfPageAnnotationType::Widget), None);
        assert_eq!(map_kind(PdfPageAnnotationType::Link), None);
        assert_eq!(map_kind(PdfPageAnnotationType::Popup), None);
    }
}
