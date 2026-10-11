//! v2：PDF 压缩集成测试。
//!
//! 直接调用命令背后的 pub 纯函数 `compress_pdf_bytes_logic`，覆盖：
//! - Light 档位只做结构优化，产物仍能被 pdfium 正常打开且页数不变；
//! - Standard / Strong 档位对内嵌 DCTDecode（JPEG）图片按最长边降采样；
//! - Light 档位不触碰图片；
//! - DeviceRGB 与 DeviceGray 两条重编码分支；
//! - 非法字节 → `damaged`。
//!
//! 说明：fixture 用 lopdf 手工构造，嵌入真实 JPEG（image crate 编码）作为图片 XObject，
//! 因为 pdfium 的 `create_image_object` 不产出 DCTDecode 流，无法用于覆盖降采样路径。

use lopdf::{dictionary, Document, Object, Stream};
use pdfe_lib::compress::{compress_pdf_bytes_logic, CompressLevel};
use pdfium_render::prelude::*;

fn pdfium<'a>() -> &'a Pdfium {
    pdfe_lib::pdfium()
}

/// 单页空白 PDF（用作结构优化的输入）。
fn make_blank_pdf() -> Vec<u8> {
    let pdfium = pdfium();
    let mut doc = pdfium.create_new_pdf().unwrap();
    doc.pages_mut()
        .create_page_at_index(PdfPagePaperSize::a4(), 0)
        .unwrap();
    doc.save_to_bytes().unwrap()
}

/// 用 image crate 生成一张高质量 JPEG（体积足够大，便于观察降采样后的收缩）。
fn make_jpeg(width: u32, height: u32, gray: bool) -> Vec<u8> {
    let mut out = Vec::new();
    let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 95);
    if gray {
        let img = image::GrayImage::from_fn(width, height, |x, y| {
            image::Luma([(((x * 3) ^ y) % 256) as u8])
        });
        enc.encode_image(&img).unwrap();
    } else {
        let img = image::RgbImage::from_fn(width, height, |x, y| {
            image::Rgb([(x % 256) as u8, (y % 256) as u8, ((x + y) % 256) as u8])
        });
        enc.encode_image(&img).unwrap();
    }
    out
}

/// 构造一个内嵌 DCTDecode 图片 XObject 的单页 PDF。
///
/// `color` 为 `DeviceRGB` 或 `DeviceGray`，需要与 `gray` 保持一致。
fn build_pdf_with_jpeg(width: u32, height: u32, color: &str, gray: bool) -> Vec<u8> {
    let jpeg = make_jpeg(width, height, gray);
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();

    let image_id = doc.add_object(Stream::new(
        dictionary! {
            "Type" => "XObject",
            "Subtype" => "Image",
            "Width" => width as i64,
            "Height" => height as i64,
            "ColorSpace" => color,
            "BitsPerComponent" => 8i64,
            "Filter" => "DCTDecode",
        },
        jpeg,
    ));

    let content_id = doc.add_object(Stream::new(
        dictionary! {},
        b"q 612 0 0 792 0 0 cm /Im0 Do Q".to_vec(),
    ));

    let page_id = doc.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
        "Resources" => dictionary! { "XObject" => dictionary! { "Im0" => image_id } },
        "Contents" => content_id,
    });

    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => vec![page_id.into()],
            "Count" => 1i64,
        }),
    );

    let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog_id);

    let mut out = Vec::new();
    doc.save_to(&mut out).unwrap();
    out
}

/// 从 PDF 字节中取出第一个图片 XObject 的（宽, 高, 原始流字节数）。
fn image_info(bytes: &[u8]) -> (i64, i64, usize) {
    let doc = Document::load_mem(bytes).unwrap();
    for object in doc.objects.values() {
        if let Object::Stream(stream) = object {
            let is_image = stream
                .dict
                .get(b"Subtype")
                .and_then(Object::as_name)
                .map(|n| n == b"Image")
                .unwrap_or(false);
            if !is_image {
                continue;
            }
            let width = stream.dict.get(b"Width").and_then(Object::as_i64).unwrap();
            let height = stream.dict.get(b"Height").and_then(Object::as_i64).unwrap();
            return (width, height, stream.content.len());
        }
    }
    panic!("图片 XObject 未找到");
}

/// Light：仅结构优化，产物仍能被 pdfium 打开且页数不变。
#[test]
fn light_level_reloads_and_keeps_pages() {
    let source = make_blank_pdf();
    let out = compress_pdf_bytes_logic(&source, CompressLevel::Light).unwrap();

    let doc = pdfium()
        .load_pdf_from_byte_slice(&out, None)
        .expect("压缩产物应能被 pdfium 打开");
    assert_eq!(doc.pages().len(), 1);
}

/// Standard：2000px 的 RGB JPEG 应被限制到 1600px（最长边）且字节数变小。
#[test]
fn standard_downsamples_large_rgb_jpeg() {
    let source = build_pdf_with_jpeg(2000, 2000, "DeviceRGB", false);
    let (w0, h0, len0) = image_info(&source);
    assert_eq!((w0, h0), (2000, 2000));

    let out = compress_pdf_bytes_logic(&source, CompressLevel::Standard).unwrap();
    let (w1, h1, len1) = image_info(&out);
    assert_eq!((w1, h1), (1600, 1600));
    assert!(len1 < len0, "重编码后图片应更小：{len1} < {len0}");

    // 产物仍是可打开的合法 PDF。
    let doc = pdfium()
        .load_pdf_from_byte_slice(&out, None)
        .expect("降采样产物应能被 pdfium 打开");
    assert_eq!(doc.pages().len(), 1);
}

/// Strong：最长边限制更小（1024px）。
#[test]
fn strong_level_caps_to_1024() {
    let source = build_pdf_with_jpeg(2000, 1200, "DeviceRGB", false);
    let out = compress_pdf_bytes_logic(&source, CompressLevel::Strong).unwrap();
    let (w1, h1, _) = image_info(&out);
    // 2000x1200 → 缩放至最长边 1024：1024 x 614（四舍五入）。
    assert_eq!(w1, 1024);
    assert_eq!(h1, 614);
}

/// Light：不触碰图片，宽高与内容长度保持原样。
#[test]
fn light_level_leaves_jpeg_untouched() {
    let source = build_pdf_with_jpeg(2000, 2000, "DeviceRGB", false);
    let (w0, h0, len0) = image_info(&source);

    let out = compress_pdf_bytes_logic(&source, CompressLevel::Light).unwrap();
    let (w1, h1, len1) = image_info(&out);
    assert_eq!((w1, h1), (w0, h0));
    assert_eq!(len1, len0);
}

/// DeviceGray 分支：灰度 JPEG 走 Luma 重编码路径，同样被降采样。
#[test]
fn gray_jpeg_downsamples_via_luma() {
    let source = build_pdf_with_jpeg(2400, 1800, "DeviceGray", true);
    let out = compress_pdf_bytes_logic(&source, CompressLevel::Standard).unwrap();
    let (w1, h1, _) = image_info(&out);
    // 2400x1800 → 最长边 1600：1600 x 1200（正好 2/3）。
    assert_eq!((w1, h1), (1600, 1200));
}

/// 非法字节 → damaged。
#[test]
fn invalid_bytes_report_damaged() {
    let err = compress_pdf_bytes_logic(b"%PDF-1.4 broken", CompressLevel::Standard).unwrap_err();
    assert_eq!(err.code(), "damaged");
}
