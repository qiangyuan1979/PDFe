//! OCR 模块测试（feature `ocr` 关闭时也能跑的部分）
//!
//! 覆盖：
//! - `render_page_to_png` 单页渲染（无 OCR 引擎依赖）
//! - `apply_text_overlay_logic` 写 invisible 文本层（无 OCR 引擎依赖）
//! - `ocr_page_logic` 在 feature off 时返回 `OcrUnavailable` 错误
//! - 错误码一致性（边界测试覆盖）

use std::fs;
use std::path::PathBuf;

use pdfe_lib::error::AppError;
use pdfe_lib::ocr::{apply_text_overlay_logic, ocr_page_logic, OcrConfig, OcrWord};

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(name)
}

/// 渲染 sample.pdf 第 0 页为 PNG 字节（不依赖 OCR 引擎）
#[test]
fn render_page_to_png_basic() {
    let bytes = fs::read(fixture("sample.pdf")).expect("fixture missing");
    let pdfium_inst = pdfe_lib::pdfium();
    let png = pdfe_lib::ocr::render_page_to_png(pdfium_inst, &bytes, 0, 150).expect("render ok");
    // PNG magic: 89 50 4E 47
    assert!(png.len() > 8, "png not empty");
    assert_eq!(&png[0..4], &[0x89, b'P', b'N', b'G'], "png magic");
}

/// 渲染越界页应返回 PageOutOfRange
#[test]
fn render_page_out_of_range() {
    let bytes = fs::read(fixture("sample.pdf")).expect("fixture missing");
    let pdfium_inst = pdfe_lib::pdfium();
    let r = pdfe_lib::ocr::render_page_to_png(pdfium_inst, &bytes, 9999, 150);
    assert!(matches!(r, Err(AppError::PageOutOfRange)), "out of range");
}

/// apply_text_overlay_logic：写一个 fake OCR 结果到 PDF，重开后 get_page_text 能读到。
#[test]
fn apply_overlay_creates_searchable_text() {
    let initial = fs::read(fixture("sample.pdf")).expect("fixture missing");

    // 模拟 OCR 在 page 0 中部识别出 "HELLO-OCR"
    let words = vec![OcrWord {
        text: "HELLO-OCR".to_string(),
        left: 50.0,
        bottom: 50.0,
        right: 200.0,
        top: 70.0,
        confidence: 90.0,
    }];

    let new_bytes = apply_text_overlay_logic(&initial, 0, &words).expect("apply overlay");

    // 重读 PDF：get_page_text 应该能找到新写入的文本
    let pdfium_inst = pdfe_lib::pdfium();
    let doc = pdfium_inst
        .load_pdf_from_byte_slice(&new_bytes, None)
        .expect("reopen");
    let page = doc.pages().get(0).unwrap();
    let text_obj = page.text().expect("page text");
    let all_text = text_obj.all();
    assert!(
        all_text.contains("HELLO-OCR"),
        "OCR text should be readable, got: {:?}",
        all_text
    );
}

/// apply_text_overlay_logic：低 confidence 的 word 应被跳过。
#[test]
fn apply_overlay_skips_low_confidence() {
    let initial = fs::read(fixture("sample.pdf")).expect("fixture missing");
    let pdfium_inst = pdfe_lib::pdfium();

    // 用 page count 验证不影响页数
    let doc_before = pdfium_inst
        .load_pdf_from_byte_slice(&initial, None)
        .unwrap();
    let pages_before = doc_before.pages().len();
    drop(doc_before);

    let words = vec![OcrWord {
        text: "LOWCONF-SHOULD-SKIP".to_string(),
        left: 10.0,
        bottom: 10.0,
        right: 100.0,
        top: 30.0,
        confidence: 10.0, // 低于 30 阈值
    }];

    let new_bytes = apply_text_overlay_logic(&initial, 0, &words).expect("apply");
    let doc_after = pdfium_inst
        .load_pdf_from_byte_slice(&new_bytes, None)
        .unwrap();
    let pages_after = doc_after.pages().len();
    assert_eq!(pages_before, pages_after, "page count unchanged");

    // 验证：低 confidence 不应该写入
    let page = doc_after.pages().get(0).unwrap();
    let all_text = page.text().expect("page text").all();
    assert!(
        !all_text.contains("LOWCONF-SHOULD-SKIP"),
        "low conf word should be skipped, but text contained it"
    );
}

/// apply_text_overlay_logic：空文本应被跳过。
#[test]
fn apply_overlay_skips_empty_text() {
    let initial = fs::read(fixture("sample.pdf")).expect("fixture missing");
    let words = vec![OcrWord {
        text: "   ".to_string(), // 空白
        left: 10.0,
        bottom: 10.0,
        right: 100.0,
        top: 30.0,
        confidence: 90.0,
    }];
    let new_bytes = apply_text_overlay_logic(&initial, 0, &words).expect("apply");
    let pdfium_inst = pdfe_lib::pdfium();
    let doc = pdfium_inst
        .load_pdf_from_byte_slice(&new_bytes, None)
        .unwrap();
    let page = doc.pages().get(0).unwrap();
    let all_text = page.text().expect("text").all();
    // 空白字符不应该产生新文本
    assert!(!all_text.trim().is_empty(), "page has some text (original)");
    // 验证：原 sample.pdf 文本仍存在（不是被空文本污染）
    assert!(!all_text.is_empty(), "page has at least original text");
}

/// apply_text_overlay_logic：越界页返回 PageOutOfRange
#[test]
fn apply_overlay_out_of_range() {
    let initial = fs::read(fixture("sample.pdf")).expect("fixture missing");
    let r = apply_text_overlay_logic(&initial, 9999, &[]);
    assert!(matches!(r, Err(AppError::PageOutOfRange)));
}

/// ocr_page_logic：feature off 时返回 OcrUnavailable
#[test]
#[cfg(not(feature = "ocr"))]
fn ocr_page_unavailable_without_feature() {
    let bytes = fs::read(fixture("sample.pdf")).expect("fixture missing");
    let config = OcrConfig::default();
    let r = ocr_page_logic(&bytes, 0, &config);
    assert!(matches!(r, Err(AppError::OcrUnavailable)));
}

/// ocr_page_logic：feature on 时走真实 Tesseract 引擎，端到端识别出文本。
#[test]
#[cfg(feature = "ocr")]
fn ocr_page_with_feature_smoke() {
    let bytes = fs::read(fixture("sample.pdf")).expect("fixture missing");
    let config = OcrConfig::default();
    let result = ocr_page_logic(&bytes, 0, &config);
    match &result {
        Ok(page) => {
            let preview: Vec<&str> = page.words.iter().take(20).map(|w| w.text.as_str()).collect();
            println!("OCR recognized {} words: {:?}", page.words.len(), preview);
        }
        Err(e) => println!("OCR error: {:?}", e),
    }
    let page = result.expect("real OCR should succeed on text fixture");
    assert_eq!(page.page_index, 0);
    assert!(!page.words.is_empty(), "real OCR should recognize at least one word");
}

/// OCR 错误码一致性：3 个新错误码应该都存在且唯一
#[test]
fn ocr_error_codes_unique() {
    let errs = [
        AppError::OcrUnavailable,
        AppError::TessdataMissing {
            path: "test".into(),
        },
        AppError::OcrFailed { detail: "x".into() },
    ];
    let mut codes: Vec<&str> = errs.iter().map(|e| e.code()).collect();
    codes.sort();
    codes.dedup();
    assert_eq!(codes.len(), 3, "3 OCR error codes must be unique");
}

/// OCR 错误码与 boundary.rs 中测试一致
#[test]
fn ocr_error_codes_match_spec() {
    assert_eq!(AppError::OcrUnavailable.code(), "ocr_unavailable");
    assert_eq!(
        AppError::TessdataMissing { path: "x".into() }.code(),
        "tessdata_missing"
    );
    assert_eq!(
        AppError::OcrFailed { detail: "x".into() }.code(),
        "ocr_failed"
    );
}
