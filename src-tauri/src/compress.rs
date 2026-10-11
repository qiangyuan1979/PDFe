//! v2：PDF 压缩。
//!
//! 两级压缩手段叠加：
//! 1. **图片降采样**（仅 Standard / Strong）：把内嵌的 DCTDecode（JPEG）图片按最长边
//!    重排到目标尺寸并以更低画质重编码；仅当新字节更小才替换，保证不会让文件反而变大。
//! 2. **结构优化**（所有档位）：`Document::compress()` 压缩未压缩流、`prune_objects()`
//!    删除不可达对象，最后用 `save_modern()`（对象流 + 交叉引用流）重写。
//!
//! 压缩只作用于**落盘副本**：内存中的文档保持原样，渲染/编辑/撤销重做不受影响。

use lopdf::{Dictionary, Document, Object};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::document::{pdfium as get_pdfium, AppState};
use crate::error::{AppError, AppResult};

/// 单张图片解码前的像素上限，避免超大图（解压炸弹）耗尽内存。
const MAX_IMAGE_PIXELS: u64 = 40_000_000;

/// 压缩档位。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CompressLevel {
    /// 轻：仅结构优化，不动图片。
    Light,
    /// 标准：图片最长边限制到 1600px，JPEG 画质 75。
    Standard,
    /// 强力：图片最长边限制到 1024px，JPEG 画质 55。
    Strong,
}

impl CompressLevel {
    /// 图片最长边上限；`None` 表示不处理图片。
    fn max_image_dim(self) -> Option<u32> {
        match self {
            CompressLevel::Light => None,
            CompressLevel::Standard => Some(1600),
            CompressLevel::Strong => Some(1024),
        }
    }

    /// 图片重编码时的 JPEG 画质。
    fn jpeg_quality(self) -> u8 {
        match self {
            CompressLevel::Light => 85,
            CompressLevel::Standard => 75,
            CompressLevel::Strong => 55,
        }
    }
}

/// 压缩结果：供前端展示压缩率。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressResult {
    pub output_path: String,
    /// 压缩前的源字节数（内存中的当前文档）。
    pub original_size: u64,
    /// 压缩后的字节数。
    pub compressed_size: u64,
}

/// 图片色彩空间：仅处理 DeviceRGB / DeviceGray 两种直接 Name。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ImageColor {
    Rgb,
    Gray,
}

/// 判断流字典是否为可直接重编码的 JPEG 图片 XObject。
///
/// 排除项：带 Alpha（SMask）/ 颜色键掩码（Mask）/ 显式解码数组（Decode / DecodeParms）
/// 的图片语义会随重编码改变；Filter 非单个 DCTDecode（如数组、或已 Flate 的位图）也不处理。
fn is_candidate_jpeg_image(dict: &Dictionary) -> bool {
    if !name_is(dict, b"Subtype", b"Image") {
        return false;
    }
    if !name_is(dict, b"Filter", b"DCTDecode") {
        return false;
    }
    for key in [
        b"SMask".as_slice(),
        b"Mask".as_slice(),
        b"Decode".as_slice(),
        b"DecodeParms".as_slice(),
    ] {
        if dict.has(key) {
            return false;
        }
    }
    true
}

/// 字典某键的 Name 值是否等于 `expected`（数组或缺失时返回 false）。
fn name_is(dict: &Dictionary, key: &[u8], expected: &[u8]) -> bool {
    dict.get(key)
        .and_then(Object::as_name)
        .map(|n| n == expected)
        .unwrap_or(false)
}

/// 从字典解析受支持的色彩空间；不支持时返回 `None`。
fn image_color_space(dict: &Dictionary) -> Option<ImageColor> {
    match dict.get(b"ColorSpace").ok()?.as_name().ok()? {
        b"DeviceRGB" => Some(ImageColor::Rgb),
        b"DeviceGray" => Some(ImageColor::Gray),
        _ => None,
    }
}

/// 把文档中可处理的 JPEG 图片降采样到 `max_dim`（最长边）并以 `quality` 重编码。
fn downsample_images(doc: &mut Document, max_dim: u32, quality: u8) {
    for object in doc.objects.values_mut() {
        let Object::Stream(stream) = object else {
            continue;
        };
        if !is_candidate_jpeg_image(&stream.dict) {
            continue;
        }
        let Some(color) = image_color_space(&stream.dict) else {
            continue;
        };
        let (width, height) = match (
            stream.dict.get(b"Width").and_then(Object::as_i64),
            stream.dict.get(b"Height").and_then(Object::as_i64),
        ) {
            (Ok(w), Ok(h)) if w > 0 && h > 0 => (w as u32, h as u32),
            _ => continue,
        };
        if (width as u64) * (height as u64) > MAX_IMAGE_PIXELS {
            continue;
        }

        let Ok(image) = image::load_from_memory_with_format(&stream.content, image::ImageFormat::Jpeg)
        else {
            continue;
        };

        let longest = width.max(height);
        let image = if longest > max_dim {
            let scale = max_dim as f32 / longest as f32;
            let new_w = ((width as f32 * scale).round() as u32).max(1);
            let new_h = ((height as f32 * scale).round() as u32).max(1);
            image.resize_exact(new_w, new_h, image::imageops::FilterType::Triangle)
        } else {
            image
        };
        let (enc_w, enc_h) = (image.width(), image.height());

        let mut out = Vec::new();
        let encoded = match color {
            ImageColor::Rgb => {
                let rgb = image.to_rgb8();
                let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality);
                enc.encode_image(&rgb).is_ok()
            }
            ImageColor::Gray => {
                let gray = image.to_luma8();
                let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality);
                enc.encode_image(&gray).is_ok()
            }
        };
        // 只有确实更小才替换：避免已高度优化的图片被重编码后反向膨胀。
        if !encoded || out.len() >= stream.content.len() {
            continue;
        }
        stream.set_content(out);
        stream.dict.set("Width", enc_w as i64);
        stream.dict.set("Height", enc_h as i64);
    }
}

/// 纯函数：把 PDF 字节压缩为新的字节（可脱 Tauri / pdfium 单测）。
///
/// 输入应为明文 PDF；加密文档请先经 `security::decrypt_pdf_bytes_logic` 解密。
pub fn compress_pdf_bytes_logic(bytes: &[u8], level: CompressLevel) -> AppResult<Vec<u8>> {
    let mut doc = Document::load_mem(bytes).map_err(|_| AppError::Damaged)?;

    if let Some(max_dim) = level.max_image_dim() {
        downsample_images(&mut doc, max_dim, level.jpeg_quality());
    }
    doc.compress();
    doc.prune_objects();

    let mut out = Vec::new();
    doc.save_modern(&mut out)
        .map_err(|e| AppError::PdfCompressFailed {
            detail: e.to_string(),
        })?;
    Ok(out)
}

/// 把当前文档压缩后另存到新路径，返回压缩前后的字节数。
///
/// 只写盘，不改内存 bytes。加密文档需提供原打开密码（否则报 `password`）。
#[tauri::command]
pub async fn compress_document(
    state: State<'_, AppState>,
    doc_id: u64,
    output_path: String,
    level: CompressLevel,
    password: Option<String>,
) -> AppResult<CompressResult> {
    let _gate = crate::document::pdfium_gate();
    let pdfium = get_pdfium();
    // 统一先取明文字节：未加密文档经 pdfium 重新序列化，加密文档用密码解密。
    let plain = {
        let docs = state.docs.lock().unwrap();
        let entry = docs.get(&doc_id).ok_or(AppError::NotFound)?;
        crate::security::decrypt_pdf_bytes_logic(pdfium, &entry.bytes, password.as_deref())?
    };
    let original_size = plain.len() as u64;
    let compressed = compress_pdf_bytes_logic(&plain, level)?;
    std::fs::write(&output_path, &compressed).map_err(AppError::Io)?;
    Ok(CompressResult {
        output_path,
        original_size,
        compressed_size: compressed.len() as u64,
    })
}

#[cfg(test)]
mod tests {
    //! Unit tests for level parameter mapping and PDF parsing guards.
    use super::*;

    /// 档位 → 图片上限 / 画质 的映射。
    #[test]
    fn level_parameters_are_stable() {
        assert_eq!(CompressLevel::Light.max_image_dim(), None);
        assert_eq!(CompressLevel::Standard.max_image_dim(), Some(1600));
        assert_eq!(CompressLevel::Strong.max_image_dim(), Some(1024));

        assert!(CompressLevel::Light.jpeg_quality() > CompressLevel::Standard.jpeg_quality());
        assert!(CompressLevel::Standard.jpeg_quality() > CompressLevel::Strong.jpeg_quality());
    }

    /// 非法字节 → damaged。
    #[test]
    fn invalid_bytes_report_damaged() {
        let err = compress_pdf_bytes_logic(b"not a pdf", CompressLevel::Light).unwrap_err();
        assert_eq!(err.code(), "damaged");
    }

    /// 色彩空间解析只接受 DeviceRGB / DeviceGray。
    #[test]
    fn color_space_detection() {
        let mut dict = Dictionary::new();
        dict.set("ColorSpace", Object::Name(b"DeviceRGB".to_vec()));
        assert_eq!(image_color_space(&dict), Some(ImageColor::Rgb));

        dict.set("ColorSpace", Object::Name(b"DeviceGray".to_vec()));
        assert_eq!(image_color_space(&dict), Some(ImageColor::Gray));

        dict.set("ColorSpace", Object::Name(b"DeviceCMYK".to_vec()));
        assert_eq!(image_color_space(&dict), None);
    }

    /// 候选图片判定：Subtype / Filter / 掩码字段。
    #[test]
    fn jpeg_candidate_detection() {
        let mut dict = Dictionary::new();
        dict.set("Subtype", Object::Name(b"Image".to_vec()));
        dict.set("Filter", Object::Name(b"DCTDecode".to_vec()));
        assert!(is_candidate_jpeg_image(&dict));

        // 带 SMask 的图片不处理。
        dict.set("SMask", Object::Reference((1, 0)));
        assert!(!is_candidate_jpeg_image(&dict));
        dict.remove(b"SMask");

        // 非 JPEG 流不处理。
        dict.set("Filter", Object::Name(b"FlateDecode".to_vec()));
        assert!(!is_candidate_jpeg_image(&dict));

        // 非图片 XObject 不处理。
        dict.set("Filter", Object::Name(b"DCTDecode".to_vec()));
        dict.set("Subtype", Object::Name(b"Form".to_vec()));
        assert!(!is_candidate_jpeg_image(&dict));
    }
}
