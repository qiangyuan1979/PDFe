//! 文件关联（0.4.1）相关测试：启动期从命令行挑选待打开文件。
//!
//! 「文件关联」把 .pdf 登记为本应用的打开候选后，Windows 通过命令行参数把文件
//! 路径传给 exe。`pick_file_arg` 负责从中挑出真正要打开的文件，这里覆盖它的
//! 正常路径、边界与异常输入。
use pdfe_lib::cli::pick_file_arg;

fn args(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

/// 只有 exe 自身路径时，没有文件可打开。
#[test]
fn no_arguments_yields_none() {
    assert_eq!(pick_file_arg(&args(&["pdfe.exe"]), |_| true), None);
}

/// 存在多个候选时取第一个（资源管理器通常只传一个）。
#[test]
fn first_existing_path_is_picked() {
    let a = args(&["pdfe.exe", "C:\\docs\\a.pdf", "C:\\docs\\b.pdf"]);
    assert_eq!(
        pick_file_arg(&a, |_| true),
        Some("C:\\docs\\a.pdf".to_string())
    );
}

/// 以 `-` 开头的开关（WebView2 / 打包器可能追加）必须被跳过。
#[test]
fn switches_are_skipped() {
    let a = args(&["pdfe.exe", "--no-sandbox", "C:\\docs\\a.pdf"]);
    assert_eq!(
        pick_file_arg(&a, |_| true),
        Some("C:\\docs\\a.pdf".to_string())
    );
}

/// 失效路径必须被跳过，不能抢占后面真实存在的文件。
#[test]
fn missing_files_are_skipped() {
    let a = args(&["pdfe.exe", "C:\\gone.pdf", "C:\\docs\\b.pdf"]);
    let picked = pick_file_arg(&a, |p| p == "C:\\docs\\b.pdf");
    assert_eq!(picked, Some("C:\\docs\\b.pdf".to_string()));
}

/// exe 自身路径永远不被当成待打开文档。
#[test]
fn exe_path_is_never_treated_as_document() {
    let a = args(&["C:\\app\\pdfe.exe"]);
    assert_eq!(pick_file_arg(&a, |_| true), None);
}

/// 只有开关、没有文件时返回 None。
#[test]
fn non_file_arguments_yield_none() {
    let a = args(&["pdfe.exe", "--flag", "-x"]);
    assert_eq!(pick_file_arg(&a, |_| true), None);
}
