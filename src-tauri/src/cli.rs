//! 启动期命令行处理。
//!
//! 文件关联生效后，双击 .pdf 或在资源管理器「打开方式 → PDFe」都会把文件路径
//! 作为命令行参数传给 exe。这里在启动时把它挑出来暂存，等前端挂载后再取走打开。
//!
//! 另外提供跳转 Windows「默认应用」设置页的命令：Windows 不允许应用自行静默
//! 把自己设为默认打开程序，只能由用户在该设置页里手动确认。

use std::sync::Mutex;

use crate::error::{AppError, AppResult};

/// Windows「默认应用」设置页的协议 URI。
const DEFAULT_APPS_URI: &str = "ms-settings:defaultapps";

/// 启动时从命令行挑出的待打开文件，前端挂载后通过 `take_pending_open` 取走。
#[derive(Default)]
pub struct PendingOpen(pub Mutex<Option<String>>);

/// 从完整 argv（首项为 exe 自身路径）中挑出要用本应用打开的文件。
///
/// - 跳过首项（exe 自身）与以 `-` 开头的开关（WebView2 / 打包器可能追加）；
/// - 只接受 `exists` 判定存在的路径（资源管理器可能传入失效路径）；
/// - 返回首个命中项。
pub fn pick_file_arg(args: &[String], exists: impl Fn(&str) -> bool) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|arg| !arg.starts_with('-') && exists(arg))
        .cloned()
}

/// 取走启动时暂存的文件路径；已取过或没有则为 null。
#[tauri::command]
pub fn take_pending_open(state: tauri::State<'_, PendingOpen>) -> Option<String> {
    state
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
}

/// 打开 Windows「默认应用」设置页，由用户把 PDFe 设为 .pdf 的默认程序。
#[tauri::command]
pub fn open_default_apps_settings() -> AppResult<()> {
    open_default_apps_settings_impl()
}

#[cfg(windows)]
fn open_default_apps_settings_impl() -> AppResult<()> {
    use std::os::windows::process::CommandExt;
    // CREATE_NO_WINDOW：cmd 仅用于转交协议 URI，不应闪出控制台窗口
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("cmd")
        .args(["/C", "start", "", DEFAULT_APPS_URI])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(AppError::from)?;
    Ok(())
}

#[cfg(not(windows))]
fn open_default_apps_settings_impl() -> AppResult<()> {
    Err(AppError::Internal("unsupported platform".into()))
}
