//! v2：批量处理队列集成测试。
//!
//! 直接调用命令背后的 pub 纯函数与枚举，覆盖：
//! - [`apply_op_logic`] 的 Compress / Encrypt / Decrypt / Watermark / PageNumbers 路径；
//! - 操作链的顺序施加（压缩 → 加密）；
//! - [`BatchOp`] 的内部标签（`{ kind, ... }`）serde 反序列化；
//! - 非法输入的错误码（压缩 → `damaged`，加密空密码 → `password_empty`，水印空文本 → `watermark_text_empty`）。

use pdfe_lib::batch::{apply_op_logic, BatchOp};
use pdfe_lib::compress::CompressLevel;
use pdfe_lib::pagenum::PageNumberOpts;
use pdfe_lib::security::EncryptOptions;
use pdfe_lib::watermark::{TextWatermarkOpts, WatermarkStyle};
use pdfium_render::prelude::*;

fn pdfium<'a>() -> &'a Pdfium {
    pdfe_lib::pdfium()
}

/// 单页空白 PDF（明文，作为各操作的输入）。
fn make_blank_pdf() -> Vec<u8> {
    let pdfium = pdfium();
    let mut doc = pdfium.create_new_pdf().unwrap();
    doc.pages_mut()
        .create_page_at_index(PdfPagePaperSize::a4(), 0)
        .unwrap();
    doc.save_to_bytes().unwrap()
}

fn enc_opts(user: &str, owner: &str) -> EncryptOptions {
    EncryptOptions {
        user_password: user.to_string(),
        owner_password: owner.to_string(),
        allow_print: true,
        allow_copy: true,
        allow_modify: false,
        allow_annotate: true,
    }
}

fn wm_opts(text: &str) -> TextWatermarkOpts {
    TextWatermarkOpts {
        text: text.to_string(),
        font_size: 24.0,
        color: "#ff0000".to_string(),
        style: WatermarkStyle {
            opacity: 50.0,
            rotation: 0.0,
            position: "center".to_string(),
            tiled: false,
            tile_spacing: 120.0,
            custom: None,
        },
    }
}

fn pn_opts() -> PageNumberOpts {
    PageNumberOpts {
        format: "{n} / {total}".to_string(),
        start: 1,
        font_size: 12.0,
        color: "#000000".to_string(),
        opacity: 100.0,
        position: "bottom-center".to_string(),
    }
}

/// Compress：产物仍能被 pdfium 正常打开且页数不变。
#[test]
fn compress_op_produces_loadable_pdf() {
    let source = make_blank_pdf();
    let op = BatchOp::Compress {
        level: CompressLevel::Standard,
    };
    let out = apply_op_logic(pdfium(), &source, &op).unwrap();
    let doc = pdfium()
        .load_pdf_from_byte_slice(&out, None)
        .expect("压缩产物应能被 pdfium 打开");
    assert_eq!(doc.pages().len(), 1);
}

/// Encrypt：产物已加密——需密码可打开，无密码打不开。
#[test]
fn encrypt_op_requires_password() {
    let source = make_blank_pdf();
    let op = BatchOp::Encrypt {
        options: enc_opts("secret", "owner"),
    };
    let out = apply_op_logic(pdfium(), &source, &op).unwrap();

    assert!(
        pdfium().load_pdf_from_byte_slice(&out, None).is_err(),
        "加密产物不应能在无密码时打开"
    );
    let doc = pdfium()
        .load_pdf_from_byte_slice(&out, Some("secret"))
        .expect("加密产物应能用打开密码打开");
    assert_eq!(doc.pages().len(), 1);
}

/// Decrypt：明文输入的恒等映射（解密本身由命令层用 pdfium 完成）。
#[test]
fn decrypt_op_is_identity() {
    let source = make_blank_pdf();
    let out = apply_op_logic(pdfium(), &source, &BatchOp::Decrypt).unwrap();
    assert_eq!(out, source);
}

/// Watermark：产物仍可打开、页数不变（水印为叠加对象）。
#[test]
fn watermark_op_produces_loadable_pdf() {
    let source = make_blank_pdf();
    let op = BatchOp::Watermark {
        options: wm_opts("仅供内部使用"),
    };
    let out = apply_op_logic(pdfium(), &source, &op).unwrap();
    let doc = pdfium()
        .load_pdf_from_byte_slice(&out, None)
        .expect("水印产物应能被 pdfium 打开");
    assert_eq!(doc.pages().len(), 1);
}

/// Watermark：空文本 → watermark_text_empty。
#[test]
fn watermark_op_rejects_empty_text() {
    let source = make_blank_pdf();
    let op = BatchOp::Watermark {
        options: wm_opts("  "),
    };
    let err = apply_op_logic(pdfium(), &source, &op).unwrap_err();
    assert_eq!(err.code(), "watermark_text_empty");
}

/// PageNumbers：产物仍可打开、页数不变。
#[test]
fn page_numbers_op_produces_loadable_pdf() {
    let source = make_blank_pdf();
    let op = BatchOp::PageNumbers {
        options: pn_opts(),
    };
    let out = apply_op_logic(pdfium(), &source, &op).unwrap();
    let doc = pdfium()
        .load_pdf_from_byte_slice(&out, None)
        .expect("页码产物应能被 pdfium 打开");
    assert_eq!(doc.pages().len(), 1);
}

/// 操作链：压缩后加密，结果需密码打开（证明两步都已生效）。
#[test]
fn chained_ops_apply_in_order() {
    let source = make_blank_pdf();
    let chain = [
        BatchOp::Compress {
            level: CompressLevel::Standard,
        },
        BatchOp::Encrypt {
            options: enc_opts("pw", "owner"),
        },
    ];
    let mut bytes = source.clone();
    for op in &chain {
        bytes = apply_op_logic(pdfium(), &bytes, op).unwrap();
    }
    assert!(
        pdfium().load_pdf_from_byte_slice(&bytes, None).is_err(),
        "链式结果应已加密（无密码打不开）"
    );
    let doc = pdfium()
        .load_pdf_from_byte_slice(&bytes, Some("pw"))
        .expect("链式结果应能用密码打开");
    assert_eq!(doc.pages().len(), 1);
}

/// BatchOp 内部标签反序列化：五种操作。
#[test]
fn batch_op_deserializes_internal_tag() {
    let c: BatchOp = serde_json::from_str(r#"{"kind":"compress","level":"strong"}"#).unwrap();
    match c {
        BatchOp::Compress { level } => assert_eq!(level, CompressLevel::Strong),
        _ => panic!("应为 Compress"),
    }

    let e: BatchOp = serde_json::from_str(
        r#"{"kind":"encrypt","options":{"userPassword":"u","ownerPassword":"","allowPrint":true,"allowCopy":false,"allowModify":false,"allowAnnotate":false}}"#,
    )
    .unwrap();
    match e {
        BatchOp::Encrypt { options } => {
            assert_eq!(options.user_password, "u");
            assert!(options.allow_print);
            assert!(!options.allow_copy);
        }
        _ => panic!("应为 Encrypt"),
    }

    let d: BatchOp = serde_json::from_str(r#"{"kind":"decrypt"}"#).unwrap();
    assert!(matches!(d, BatchOp::Decrypt));

    let w: BatchOp = serde_json::from_str(
        r##"{"kind":"watermark","options":{"text":"X","fontSize":18,"color":"#000000","style":{"opacity":40,"rotation":0,"position":"center","tiled":false,"tileSpacing":120}}}"##,
    )
    .unwrap();
    match w {
        BatchOp::Watermark { options } => {
            assert_eq!(options.text, "X");
            assert_eq!(options.font_size, 18.0);
            assert_eq!(options.style.opacity, 40.0);
            assert!(options.style.custom.is_none());
        }
        _ => panic!("应为 Watermark"),
    }

    let p: BatchOp = serde_json::from_str(
        r##"{"kind":"pageNumbers","options":{"format":"{n}/{total}","start":1,"fontSize":12,"color":"#000000","opacity":100,"position":"bottom-center"}}"##,
    )
    .unwrap();
    match p {
        BatchOp::PageNumbers { options } => {
            assert_eq!(options.format, "{n}/{total}");
            assert_eq!(options.start, 1);
            assert_eq!(options.font_size, 12.0);
        }
        _ => panic!("应为 PageNumbers"),
    }
}

/// PageNumberOpts：start 与 position 缺省时的默认值。
#[test]
fn page_number_opts_defaults() {
    let p: BatchOp = serde_json::from_str(
        r##"{"kind":"pageNumbers","options":{"fontSize":12,"color":"#000000","opacity":100}}"##,
    )
    .unwrap();
    match p {
        BatchOp::PageNumbers { options } => {
            assert_eq!(options.start, 1, "start 缺省应为 1");
            assert_eq!(options.format, "", "format 缺省为空（运行时回退 {{n}}）");
            assert_eq!(options.position, "bottom-center", "position 缺省为 bottom-center");
        }
        _ => panic!("应为 PageNumbers"),
    }
}

/// 非法字节 → damaged（压缩路径）。
#[test]
fn compress_op_reports_damaged() {
    let op = BatchOp::Compress {
        level: CompressLevel::Standard,
    };
    let err = apply_op_logic(pdfium(), b"%PDF-1.4 broken", &op).unwrap_err();
    assert_eq!(err.code(), "damaged");
}

/// 加密两密码全空 → password_empty。
#[test]
fn encrypt_op_rejects_empty_passwords() {
    let op = BatchOp::Encrypt {
        options: enc_opts("", ""),
    };
    let err = apply_op_logic(pdfium(), b"%PDF-1.4", &op).unwrap_err();
    assert_eq!(err.code(), "password_empty");
}
