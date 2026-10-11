//! v2：批量处理队列（后端单文件执行器）。
//!
//! 队列的编排（顺序、进度、失败重试、取消）全部由前端驱动；后端每次只处理**一个**
//! 文件，按路径读入 → 取明文 → 施加操作 → 写盘，因此命令无需 [`AppState`]（不依赖
//! 内存中已打开的文档）。
//!
//! 支持多种操作（复用既有 bytes 级纯函数），按数组顺序依次施加，构成操作链：
//! - **压缩**：`compress::compress_pdf_bytes_logic`
//! - **加密**：`security::encrypt_pdf_bytes_logic`
//! - **导出明文**：解密后原样写盘（`security::decrypt_pdf_bytes_logic` 的产物）
//! - **加文字水印**：`watermark::add_text_watermark_logic`
//! - **加页码**：`pagenum::add_page_numbers_logic`
//!
//! 空操作数组 = 导出明文副本。

use pdfium_render::prelude::Pdfium;
use serde::{Deserialize, Serialize};

use crate::compress::{compress_pdf_bytes_logic, CompressLevel};
use crate::error::{AppError, AppResult};
use crate::pagenum::{add_page_numbers_logic, PageNumberOpts};
use crate::security::{decrypt_pdf_bytes_logic, encrypt_pdf_bytes_logic, EncryptOptions};
use crate::watermark::{add_text_watermark_logic, TextWatermarkOpts};

/// 批量操作类型（前端以 `{ kind, ... }` 的形式传入）。
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BatchOp {
    /// 压缩：按档位重写为更小的 PDF。
    Compress { level: CompressLevel },
    /// 加密：AES-128 / Revision 4 加密副本。
    Encrypt { options: EncryptOptions },
    /// 导出明文副本：解密后原样输出（移除密码与权限）。
    Decrypt,
    /// 加文字水印：作用于全部页。
    Watermark { options: TextWatermarkOpts },
    /// 加页码：作用于全部页。
    PageNumbers { options: PageNumberOpts },
}

/// 单个文件的处理结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchFileResult {
    pub output_path: String,
    /// 源文件字节数。
    pub original_size: u64,
    /// 产物字节数。
    pub output_size: u64,
}

/// 纯函数：对**已解密**的 PDF 明文字节施加操作（可脱 Tauri 单测）。
///
/// `Decrypt` 是恒等映射——解密本身由命令层用 pdfium 完成。
pub fn apply_op_logic(pdfium: &Pdfium, plain: &[u8], op: &BatchOp) -> AppResult<Vec<u8>> {
    match op {
        BatchOp::Compress { level } => compress_pdf_bytes_logic(plain, *level),
        BatchOp::Encrypt { options } => encrypt_pdf_bytes_logic(plain, options),
        BatchOp::Decrypt => Ok(plain.to_vec()),
        BatchOp::Watermark { options } => add_text_watermark_logic(pdfium, plain, &[], options),
        BatchOp::PageNumbers { options } => add_page_numbers_logic(pdfium, plain, options),
    }
}

/// 处理一个文件：读入 → 取明文 → 按顺序施加操作链 → 写盘。
///
/// `ops` 为空表示仅导出明文副本。`password` 为源文件的打开密码；
/// 加密源文件必须提供，否则报 `password`。
#[tauri::command]
pub async fn batch_process_file(
    source_path: String,
    output_path: String,
    ops: Vec<BatchOp>,
    password: Option<String>,
) -> AppResult<BatchFileResult> {
    let _gate = crate::document::pdfium_gate();
    let pdfium = crate::document::pdfium();

    let source = std::fs::read(&source_path).map_err(AppError::Io)?;
    let original_size = source.len() as u64;
    // 统一先取明文：未加密文档经 pdfium 重序列化，加密文档用密码解密。
    let mut bytes = decrypt_pdf_bytes_logic(pdfium, &source, password.as_deref())?;
    for op in &ops {
        bytes = apply_op_logic(pdfium, &bytes, op)?;
    }
    std::fs::write(&output_path, &bytes).map_err(AppError::Io)?;

    Ok(BatchFileResult {
        output_path,
        original_size,
        output_size: bytes.len() as u64,
    })
}
