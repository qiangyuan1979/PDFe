//! v2：添加页码（纯函数，供批量队列复用）。
//!
//! 在每页叠加一行页码文本，格式支持 `{n}`（当前页编号，从 `start` 起）与
//! `{total}`（总页数）。复用 [`crate::watermark`] 的字体加载、颜色解析与定位工具，
//! 因此同样支持中文（如 `第 {n} 页 / 共 {total} 页`）与九宫格定位。

use pdfium_render::prelude::*;
use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::watermark::{
    anchor_with_margin, estimate_text_width, load_font_for_text, parse_color, position_factors,
};

/// 页码距页面边缘的留白（pt）。
const PAGE_NUM_MARGIN: f32 = 24.0;

/// 页码选项（前端以 camelCase 传入）。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageNumberOpts {
    /// 页码格式，支持 `{n}` 与 `{total}`；空则默认 `"{n}"`。
    #[serde(default)]
    pub format: String,
    /// 首页页码编号（默认 1）。
    #[serde(default = "default_start")]
    pub start: u32,
    /// 字号（pt）
    pub font_size: f32,
    /// "#RRGGBB"
    pub color: String,
    /// 0–100
    pub opacity: f32,
    /// 九宫格位置（默认 bottom-center）
    #[serde(default = "default_position")]
    pub position: String,
}

fn default_start() -> u32 {
    1
}

fn default_position() -> String {
    "bottom-center".to_string()
}

/// 按格式渲染单页标签：替换 `{n}`（当前页编号）与 `{total}`（总页数）。
fn render_label(format: &str, n: u32, total: u32) -> String {
    let fmt = if format.trim().is_empty() {
        "{n}"
    } else {
        format
    };
    fmt.replace("{n}", &n.to_string())
        .replace("{total}", &total.to_string())
}

/// 纯函数：为每页叠加页码，返回新的 PDF 字节（可脱 Tauri 单测）。
pub fn add_page_numbers_logic(
    pdfium: &Pdfium,
    bytes: &[u8],
    opts: &PageNumberOpts,
) -> AppResult<Vec<u8>> {
    let mut doc = pdfium.load_pdf_from_byte_slice(bytes, None)?;
    let total = doc.pages().len() as u32;

    let font_size = opts.font_size.max(4.0);
    let color = parse_color(&opts.color, opts.opacity);
    let (fx, fy) = position_factors(&opts.position);
    let fmt = if opts.format.trim().is_empty() {
        "{n}"
    } else {
        opts.format.as_str()
    };
    // 用首个标签决定字体（纯数字 → Helvetica；含中文 → 系统中文字体）。
    let sample = render_label(fmt, opts.start, total.max(1));
    let font_token = load_font_for_text(&mut doc, &sample)?;

    {
        let pages_col = doc.pages_mut();
        for i in 0..total {
            let idx = u16::try_from(i).map_err(|_| AppError::PageOutOfRange)?;
            let mut page = pages_col.get(idx)?;
            let pw = page.width().value;
            let ph = page.height().value;
            let label = render_label(fmt, opts.start + i, total);
            let w = estimate_text_width(&label, font_size);
            let (x, y) = anchor_with_margin(fx, fy, pw, ph, w, font_size, PAGE_NUM_MARGIN);
            let objects = page.objects_mut();
            let mut obj = objects.create_text_object(
                PdfPoints::new(x),
                PdfPoints::new(y),
                &label,
                font_token,
                PdfPoints::new(font_size),
            )?;
            obj.set_fill_color(color)?;
        }
    }

    Ok(doc.save_to_bytes()?)
}

#[cfg(test)]
mod tests {
    //! Unit tests for page-number label rendering.
    use super::*;

    #[test]
    fn render_label_replaces_n_and_total() {
        assert_eq!(render_label("{n} / {total}", 3, 10), "3 / 10");
    }

    #[test]
    fn render_label_empty_format_defaults_to_n() {
        assert_eq!(render_label("", 5, 8), "5");
        assert_eq!(render_label("   ", 5, 8), "5");
    }

    #[test]
    fn render_label_supports_offset_and_cjk() {
        assert_eq!(render_label("第 {n} 页", 1, 3), "第 1 页");
        assert_eq!(render_label("- {n} -", 2, 3), "- 2 -");
    }

    #[test]
    fn render_label_empty_template() {
        assert_eq!(render_label("{total}", 1, 4), "4");
    }
}
