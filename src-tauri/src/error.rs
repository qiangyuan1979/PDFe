use serde::Serialize;
use std::collections::HashMap;

/// 应用统一错误类型。
/// - message 为英文（日志/调试用），用户可见文案由前端 i18n 根据 code 翻译。
/// - args 为可选变量，前端用 {name} 占位符替换。
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    // ------ 基础错误 ------
    #[error("Password required to open this document")]
    Password,
    #[error("Document is damaged and cannot be parsed")]
    Damaged,
    #[error("Document not found or already closed")]
    NotFound,
    #[error("Page index out of range")]
    PageOutOfRange,
    #[error("Operation denied by document security settings")]
    Security,
    #[error("File I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Internal error: {0}")]
    Internal(String),

    // ------ 撤销/重做 ------
    #[error("No operation to undo")]
    NothingToUndo,
    #[error("No operation to redo")]
    NothingToRedo,

    // ------ 保存 ------
    #[error("Document has no original path; please specify a save location")]
    NoSavePath,

    // ------ 页面操作 ------
    #[error("No pages selected for deletion")]
    NoPagesToDelete,
    #[error("Cannot delete all pages")]
    CannotDeleteAllPages,
    #[error("No pages selected for duplication")]
    NoPagesToDuplicate,
    #[error("No pages selected to move")]
    NoPagesToMove,
    #[error("No pages selected for extraction")]
    NoPagesToExtract,
    #[error("Invalid page range: {range}")]
    InvalidPageRange { range: String },

    // ------ 合并/拆分 ------
    #[error("At least one source file is required")]
    NeedAtLeastOneFile,
    #[error("Merge result is an empty document")]
    MergeResultEmpty,
    #[error("Pages per file cannot be zero")]
    PagesPerFileZero,
    #[error("Nothing to split")]
    NothingToSplit,

    // ------ 水印 ------
    #[error("Watermark text cannot be empty")]
    WatermarkTextEmpty,
    #[error("Invalid image dimensions")]
    InvalidImageSize,
    #[error("No pages to apply watermark to")]
    NoPagesForWatermark,
    #[error("No suitable Chinese font found in system (needs msyh/simhei/simsun)")]
    NoChineseFont,

    // ------ 注释 ------
    #[error("Annotation index out of range")]
    AnnotationOutOfRange,
    #[error("Text cannot be empty")]
    TextEmpty,

    // ------ 转换 ------
    #[error("No pages selected for export")]
    NoPagesToExport,
    #[error("DPI out of range ({min}–{max}): {dpi}")]
    DpiOutOfRange { dpi: u32, min: u32, max: u32 },
    #[error("Failed to construct image")]
    ImageConstructFailed,
    #[error("No images provided")]
    NoImagesProvided,
    #[error("Failed to read image: {path}")]
    ImageReadFailed { path: String },
    #[error("Failed to write PDF")]
    PdfWriteFailed,

    // ------ 搜索 ------
    #[error("Search failed")]
    SearchFailed,

    // ------ 水印去除 ------
    #[error("Invalid rectangle: zero or negative size")]
    InvalidRect,
    #[error("No candidate watermarks detected")]
    NoCandidates,

    // ------ 图片对象编辑 ------
    #[error("The object at the given index is not an image")]
    ObjectNotImage,

    // ------ Office / 电子书（外部工具） ------
    #[error("{tool} not found. Please install it first.")]
    ToolNotFound { tool: String },
    #[error("Unsupported file format: {format}")]
    UnsupportedFormat { format: String },
    #[error("Source file not found: {path}")]
    SourceNotFound { path: String },
    #[error("Failed to start {tool}: {detail}")]
    ToolStartFailed { tool: String, detail: String },
    #[error("{tool} exited with code {code}")]
    ToolFailed { tool: String, code: i32 },
    #[error("Unable to determine source file name")]
    CannotDetermineSourceName,
    #[error("No PDF was generated; please check the source file format")]
    NoPdfGenerated,

    // ------ OCR（Tesseract，可选 feature） ------
    #[error("OCR engine is unavailable: this build was compiled without the `ocr` feature")]
    OcrUnavailable,
    #[error("Tesseract tessdata file not found: {path}. Please install a language pack.")]
    TessdataMissing { path: String },
    #[error("OCR failed: {detail}")]
    OcrFailed { detail: String },

    // ------ 表单（AcroForm） ------
    #[error("Setting values for form field type `{kind}` is not yet supported")]
    FormFieldWriteUnsupported { kind: String },

    // ------ 安全 / 加密导出 ------
    #[error("Open password and permission password cannot both be empty")]
    PasswordEmpty,
    #[error("Failed to encrypt PDF: {detail}")]
    PdfEncryptFailed { detail: String },

    // ------ 原生阅读（非 PDF 文档） ------
    #[error("File is too large to open (limit {limit_mb} MB)")]
    FileTooLarge { limit_mb: u32 },
}

impl From<pdfium_render::prelude::PdfiumError> for AppError {
    fn from(e: pdfium_render::prelude::PdfiumError) -> Self {
        use pdfium_render::prelude::{PdfiumError, PdfiumInternalError};
        match e {
            PdfiumError::PdfiumLibraryInternalError(PdfiumInternalError::PasswordError) => {
                AppError::Password
            }
            PdfiumError::PdfiumLibraryInternalError(PdfiumInternalError::FormatError) => {
                AppError::Damaged
            }
            PdfiumError::PdfiumLibraryInternalError(PdfiumInternalError::FileError) => {
                AppError::NotFound
            }
            PdfiumError::PdfiumLibraryInternalError(PdfiumInternalError::SecurityError) => {
                AppError::Security
            }
            PdfiumError::PdfiumLibraryInternalError(PdfiumInternalError::PageError) => {
                AppError::PageOutOfRange
            }
            PdfiumError::IoError(io) => AppError::Io(io),
            other => AppError::Internal(other.to_string()),
        }
    }
}

impl AppError {
    /// 错误码，前端可据此做分支处理（如弹出密码框）和 i18n 翻译。
    pub fn code(&self) -> &'static str {
        match self {
            AppError::Password => "password",
            AppError::Damaged => "damaged",
            AppError::NotFound => "not_found",
            AppError::PageOutOfRange => "page_out_of_range",
            AppError::Security => "security",
            AppError::Io(_) => "io",
            AppError::Internal(_) => "internal",
            AppError::NothingToUndo => "nothing_to_undo",
            AppError::NothingToRedo => "nothing_to_redo",
            AppError::NoSavePath => "no_save_path",
            AppError::NoPagesToDelete => "no_pages_to_delete",
            AppError::CannotDeleteAllPages => "cannot_delete_all_pages",
            AppError::NoPagesToDuplicate => "no_pages_to_duplicate",
            AppError::NoPagesToMove => "no_pages_to_move",
            AppError::NoPagesToExtract => "no_pages_to_extract",
            AppError::InvalidPageRange { .. } => "invalid_page_range",
            AppError::NeedAtLeastOneFile => "need_at_least_one_file",
            AppError::MergeResultEmpty => "merge_result_empty",
            AppError::PagesPerFileZero => "pages_per_file_zero",
            AppError::NothingToSplit => "nothing_to_split",
            AppError::WatermarkTextEmpty => "watermark_text_empty",
            AppError::InvalidImageSize => "invalid_image_size",
            AppError::NoPagesForWatermark => "no_pages_for_watermark",
            AppError::NoChineseFont => "no_chinese_font",
            AppError::AnnotationOutOfRange => "annotation_out_of_range",
            AppError::TextEmpty => "text_empty",
            AppError::NoPagesToExport => "no_pages_to_export",
            AppError::DpiOutOfRange { .. } => "dpi_out_of_range",
            AppError::ImageConstructFailed => "image_construct_failed",
            AppError::NoImagesProvided => "no_images_provided",
            AppError::ImageReadFailed { .. } => "image_read_failed",
            AppError::PdfWriteFailed => "pdf_write_failed",
            AppError::InvalidRect => "invalid_rect",
            AppError::NoCandidates => "no_candidates",
            AppError::ObjectNotImage => "object_not_image",
            AppError::SearchFailed => "search_failed",
            AppError::ToolNotFound { .. } => "tool_not_found",
            AppError::UnsupportedFormat { .. } => "unsupported_format",
            AppError::SourceNotFound { .. } => "source_not_found",
            AppError::ToolStartFailed { .. } => "tool_start_failed",
            AppError::ToolFailed { .. } => "tool_failed",
            AppError::CannotDetermineSourceName => "cannot_determine_source_name",
            AppError::NoPdfGenerated => "no_pdf_generated",
            AppError::OcrUnavailable => "ocr_unavailable",
            AppError::TessdataMissing { .. } => "tessdata_missing",
            AppError::OcrFailed { .. } => "ocr_failed",
            AppError::FormFieldWriteUnsupported { .. } => "form_field_write_unsupported",
            AppError::PasswordEmpty => "password_empty",
            AppError::PdfEncryptFailed { .. } => "pdf_encrypt_failed",
            AppError::FileTooLarge { .. } => "file_too_large",
        }
    }

    /// 错误变量，前端用于 {name} 占位符替换。
    pub fn args(&self) -> HashMap<String, String> {
        let mut m = HashMap::new();
        match self {
            AppError::Io(e) => {
                m.insert("detail".into(), e.to_string());
            }
            AppError::Internal(msg) => {
                m.insert("detail".into(), msg.clone());
            }
            AppError::InvalidPageRange { range } => {
                m.insert("range".into(), range.clone());
            }
            AppError::DpiOutOfRange { dpi, min, max } => {
                m.insert("dpi".into(), dpi.to_string());
                m.insert("min".into(), min.to_string());
                m.insert("max".into(), max.to_string());
            }
            AppError::ToolNotFound { tool } => {
                m.insert("tool".into(), tool.clone());
            }
            AppError::UnsupportedFormat { format } => {
                m.insert("format".into(), format.clone());
            }
            AppError::SourceNotFound { path } => {
                m.insert("path".into(), path.clone());
            }
            AppError::ToolStartFailed { tool, detail } => {
                m.insert("tool".into(), tool.clone());
                m.insert("detail".into(), detail.clone());
            }
            AppError::ToolFailed { tool, code } => {
                m.insert("tool".into(), tool.clone());
                m.insert("code".into(), code.to_string());
            }
            AppError::ImageReadFailed { path } => {
                m.insert("path".into(), path.clone());
            }
            AppError::TessdataMissing { path } => {
                m.insert("path".into(), path.clone());
            }
            AppError::OcrFailed { detail } => {
                m.insert("detail".into(), detail.clone());
            }
            AppError::PdfEncryptFailed { detail } => {
                m.insert("detail".into(), detail.clone());
            }
            AppError::FormFieldWriteUnsupported { kind } => {
                m.insert("kind".into(), kind.clone());
            }
            AppError::FileTooLarge { limit_mb } => {
                m.insert("limitMb".into(), limit_mb.to_string());
            }
            _ => {}
        }
        m
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        // 是否带 args 直接由 args() 推导，避免与 args() 平行维护第二份名单。
        let args = self.args();
        let fields = if args.is_empty() { 2 } else { 3 };
        let mut s = serializer.serialize_struct("AppError", fields)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        if !args.is_empty() {
            s.serialize_field("args", &args)?;
        }
        s.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    //! Unit tests: error code() mapping + Display + Serialize shape.

    use super::*;

    /// Every AppError variant maps to a non-empty, snake_case error code.
    #[test]
    fn code_mapping_is_stable_and_unique() {
        // Static list of all variant constructors (one per arm).
        let codes: Vec<(&str, AppError)> = vec![
            ("password", AppError::Password),
            ("damaged", AppError::Damaged),
            ("not_found", AppError::NotFound),
            ("page_out_of_range", AppError::PageOutOfRange),
            ("security", AppError::Security),
            ("internal", AppError::Internal("x".into())),
            ("nothing_to_undo", AppError::NothingToUndo),
            ("nothing_to_redo", AppError::NothingToRedo),
            ("no_save_path", AppError::NoSavePath),
            ("no_pages_to_delete", AppError::NoPagesToDelete),
            ("cannot_delete_all_pages", AppError::CannotDeleteAllPages),
            ("no_pages_to_duplicate", AppError::NoPagesToDuplicate),
            ("no_pages_to_move", AppError::NoPagesToMove),
            ("no_pages_to_extract", AppError::NoPagesToExtract),
            (
                "invalid_page_range",
                AppError::InvalidPageRange { range: "1".into() },
            ),
            ("need_at_least_one_file", AppError::NeedAtLeastOneFile),
            ("merge_result_empty", AppError::MergeResultEmpty),
            ("pages_per_file_zero", AppError::PagesPerFileZero),
            ("nothing_to_split", AppError::NothingToSplit),
            ("watermark_text_empty", AppError::WatermarkTextEmpty),
            ("invalid_image_size", AppError::InvalidImageSize),
            ("no_pages_for_watermark", AppError::NoPagesForWatermark),
            ("no_chinese_font", AppError::NoChineseFont),
            ("annotation_out_of_range", AppError::AnnotationOutOfRange),
            ("text_empty", AppError::TextEmpty),
            ("no_pages_to_export", AppError::NoPagesToExport),
            (
                "dpi_out_of_range",
                AppError::DpiOutOfRange {
                    dpi: 50,
                    min: 36,
                    max: 600,
                },
            ),
            ("image_construct_failed", AppError::ImageConstructFailed),
            ("no_images_provided", AppError::NoImagesProvided),
            (
                "image_read_failed",
                AppError::ImageReadFailed { path: "p".into() },
            ),
            ("pdf_write_failed", AppError::PdfWriteFailed),
            ("invalid_rect", AppError::InvalidRect),
            ("no_candidates", AppError::NoCandidates),
            ("object_not_image", AppError::ObjectNotImage),
            ("search_failed", AppError::SearchFailed),
            (
                "tool_not_found",
                AppError::ToolNotFound { tool: "x".into() },
            ),
            (
                "unsupported_format",
                AppError::UnsupportedFormat { format: "f".into() },
            ),
            (
                "source_not_found",
                AppError::SourceNotFound { path: "p".into() },
            ),
            (
                "tool_start_failed",
                AppError::ToolStartFailed {
                    tool: "t".into(),
                    detail: "d".into(),
                },
            ),
            (
                "tool_failed",
                AppError::ToolFailed {
                    tool: "t".into(),
                    code: 1,
                },
            ),
            (
                "cannot_determine_source_name",
                AppError::CannotDetermineSourceName,
            ),
            ("no_pdf_generated", AppError::NoPdfGenerated),
            ("ocr_unavailable", AppError::OcrUnavailable),
            (
                "tessdata_missing",
                AppError::TessdataMissing { path: "x".into() },
            ),
            ("ocr_failed", AppError::OcrFailed { detail: "x".into() }),
            (
                "form_field_write_unsupported",
                AppError::FormFieldWriteUnsupported { kind: "k".into() },
            ),
            ("password_empty", AppError::PasswordEmpty),
            (
                "pdf_encrypt_failed",
                AppError::PdfEncryptFailed { detail: "d".into() },
            ),
            ("file_too_large", AppError::FileTooLarge { limit_mb: 64 }),
        ];

        // All codes must be non-empty.
        for (code, err) in &codes {
            assert_eq!(err.code(), *code, "code mismatch for {:?}", err);
            assert!(!code.is_empty(), "empty code");
            assert!(!code.contains(' '), "code must be snake_case: {}", code);
        }

        // All codes must be unique.
        let mut all_codes: Vec<&str> = codes.iter().map(|(c, _)| *c).collect();
        all_codes.sort();
        let len_before = all_codes.len();
        all_codes.dedup();
        assert_eq!(all_codes.len(), len_before, "duplicate codes detected");
    }

    /// Display strings contain key information for parameterized variants.
    #[test]
    fn display_strings_use_args() {
        let e = AppError::InvalidPageRange {
            range: "1-99".into(),
        };
        assert!(e.to_string().contains("1-99"), "Display should embed range");

        let e = AppError::DpiOutOfRange {
            dpi: 50,
            min: 36,
            max: 600,
        };
        let s = e.to_string();
        assert!(
            s.contains("50") && s.contains("36") && s.contains("600"),
            "Display should embed dpi/min/max"
        );

        let e = AppError::ToolFailed {
            tool: "soffice".into(),
            code: 7,
        };
        assert!(e.to_string().contains("soffice"));
        assert!(e.to_string().contains("7"));
    }

    /// args() exposes interpolatable variables for the frontend.
    #[test]
    fn args_exposes_variables() {
        let e = AppError::InvalidPageRange {
            range: "abc".into(),
        };
        let args = e.args();
        assert_eq!(args.get("range").map(|s| s.as_str()), Some("abc"));

        let e = AppError::DpiOutOfRange {
            dpi: 50,
            min: 36,
            max: 600,
        };
        let args = e.args();
        assert_eq!(args.get("dpi").map(|s| s.as_str()), Some("50"));
        assert_eq!(args.get("min").map(|s| s.as_str()), Some("36"));
        assert_eq!(args.get("max").map(|s| s.as_str()), Some("600"));

        let e = AppError::ToolFailed {
            tool: "x".into(),
            code: 1,
        };
        let args = e.args();
        assert_eq!(args.get("tool").map(|s| s.as_str()), Some("x"));
        assert_eq!(args.get("code").map(|s| s.as_str()), Some("1"));
    }

    /// Plain (non-parameterized) errors serialize without an "args" field.
    #[test]
    fn serialize_plain_no_args_field() {
        let e = AppError::NotFound;
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["code"], "not_found");
        assert!(v.get("args").is_none(), "plain errors should not have args");
    }

    /// Parameterized errors include "args" field for frontend interpolation.
    #[test]
    fn serialize_parameterized_has_args() {
        let e = AppError::InvalidPageRange { range: "x".into() };
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["code"], "invalid_page_range");
        assert_eq!(v["args"]["range"], "x");

        let e = AppError::DpiOutOfRange {
            dpi: 50,
            min: 36,
            max: 600,
        };
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["code"], "dpi_out_of_range");
        // args() exposes values as strings (frontend substitutes them into i18n templates)
        assert_eq!(v["args"]["dpi"], "50");
        assert_eq!(v["args"]["min"], "36");
        assert_eq!(v["args"]["max"], "600");
    }
}
