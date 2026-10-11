//! v2：批量处理队列集成测试。
//!
//! 直接调用命令背后的 pub 纯函数与枚举，覆盖：
//! - [`apply_op_logic`] 的 Compress / Encrypt / Decrypt 三条路径；
//! - [`BatchOp`] 的内部标签（`{ kind, ... }`）serde 反序列化；
//! - 非法输入的错误码（压缩 → `damaged`，加密空密码 → `password_empty`）。

use pdfe_lib::batch::{apply_op_logic, BatchOp};
use pdfe_lib::compress::CompressLevel;
use pdfe_lib::security::EncryptOptions;
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

/// Compress：产物仍能被 pdfium 正常打开且页数不变。
#[test]
fn compress_op_produces_loadable_pdf() {
    let source = make_blank_pdf();
    let op = BatchOp::Compress {
        level: CompressLevel::Standard,
    };
    let out = apply_op_logic(&source, &op).unwrap();
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
    let out = apply_op_logic(&source, &op).unwrap();

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
    let out = apply_op_logic(&source, &BatchOp::Decrypt).unwrap();
    assert_eq!(out, source);
}

/// BatchOp 内部标签反序列化：三种操作。
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
}

/// 非法字节 → damaged（压缩路径）。
#[test]
fn compress_op_reports_damaged() {
    let op = BatchOp::Compress {
        level: CompressLevel::Standard,
    };
    let err = apply_op_logic(b"%PDF-1.4 broken", &op).unwrap_err();
    assert_eq!(err.code(), "damaged");
}

/// 加密两密码全空 → password_empty。
#[test]
fn encrypt_op_rejects_empty_passwords() {
    let op = BatchOp::Encrypt {
        options: enc_opts("", ""),
    };
    let err = apply_op_logic(b"%PDF-1.4", &op).unwrap_err();
    assert_eq!(err.code(), "password_empty");
}
