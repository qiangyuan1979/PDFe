<#
.SYNOPSIS
  把发布版 OCR 运行期依赖暂存到 src-tauri\ocr-runtime\，供打包时随应用分发。

.DESCRIPTION
  开发/测试环境通过 src-tauri\.cargo\config.toml 的 [env] 注入 VCPKG_ROOT /
  VCPKGRS_DYNAMIC / TESSDATA_PREFIX，cargo 启动的子进程能自动找到依赖。
  但发布版 exe 没有这层增强，必须随包分发：
    1. tesseract55.dll 及其 PE 依赖闭包（DLL 必须与 exe 同级，Windows 加载器
       在进程启动时即按 exe 目录解析静态导入，Rust 代码来不及改 PATH）
    2. tessdata 语言包（运行期由 lib.rs::configure_ocr_runtime 把 TESSDATA_PREFIX
       指向 exe 同级的 tessdata 目录）

  暂存结果：
    src-tauri\ocr-runtime\*.dll                  （17 个，平铺）
    src-tauri\ocr-runtime\tessdata\*.traineddata （语言包）

  该目录被 .gitignore 忽略，属于构建中间产物。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\prepare-ocr-runtime.ps1

.EXAMPLE
  # 指定 vcpkg 安装前缀与 tessdata 来源目录
  powershell -ExecutionPolicy Bypass -File scripts\prepare-ocr-runtime.ps1 `
    -VcpkgBin C:\vcpkg\installed\x64-windows\bin -TessdataDir C:\tessdata
#>
[CmdletBinding()]
param(
  # vcpkg x64-windows 动态库目录（含 tesseract55.dll 等）
  [string]$VcpkgBin = "C:\vcpkg\installed\x64-windows\bin",

  # 语言包来源目录（直接包含 *.traineddata）
  [string]$TessdataDir = "C:\tessdata",

  # 需要打包的语言包
  [string[]]$Languages = @("eng", "chi_sim")
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$tauriDir = Join-Path $repoRoot "src-tauri"
$stageDir = Join-Path $tauriDir "ocr-runtime"
$stageTessdata = Join-Path $stageDir "tessdata"

# tesseract55.dll 的 PE 依赖闭包（dumpbin /dependents 递归，限定 vcpkg bin 内）
# 顺序无关，仅用于复制；缺失任一都会导致发布版启动/识别失败。
$dlls = @(
  "tesseract55.dll",
  "leptonica-1.87.0.dll",
  "archive.dll",
  "bz2.dll",
  "gif.dll",
  "jpeg62.dll",
  "libcurl.dll",
  "liblzma.dll",
  "libpng16.dll",
  "libsharpyuv.dll",
  "libwebp.dll",
  "libwebpmux.dll",
  "lz4.dll",
  "openjp2.dll",
  "tiff.dll",
  "z.dll",
  "zstd.dll"
)

function Write-Step([string]$msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Assert-Path([string]$path, [string]$what) {
  if (-not (Test-Path $path)) { throw "$what 不存在：$path" }
}

Write-Host "PDFe OCR 运行期暂存" -ForegroundColor Green
Write-Host "  vcpkg bin : $VcpkgBin"
Write-Host "  tessdata  : $TessdataDir"
Write-Host "  语言      : $($Languages -join ', ')"
Write-Host "  暂存目录  : $stageDir"

Assert-Path $VcpkgBin "vcpkg bin 目录"
Assert-Path $TessdataDir "tessdata 来源目录"

# --- 1. 重置暂存目录 ---
Write-Step "1/2 复制 DLL 闭包（$($dlls.Count) 个）"
if (Test-Path $stageDir) { Remove-Item $stageDir -Recurse -Force }
New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

foreach ($dll in $dlls) {
  $src = Join-Path $VcpkgBin $dll
  Assert-Path $src "OCR 运行期 DLL"
  Copy-Item $src -Destination $stageDir
}
Write-Host "  已复制 $($dlls.Count) 个 DLL"

# --- 2. 复制语言包 ---
Write-Step "2/2 复制 tessdata 语言包"
New-Item -ItemType Directory -Path $stageTessdata -Force | Out-Null
foreach ($lang in $Languages) {
  $src = Join-Path $TessdataDir "$lang.traineddata"
  Assert-Path $src "语言包"
  Copy-Item $src -Destination $stageTessdata
  Write-Host "  $lang.traineddata"
}

$dllCount = (Get-ChildItem $stageDir -Filter *.dll).Count
Write-Host "`n完成：$stageDir（$dllCount DLL + $($Languages.Count) 语言包）" -ForegroundColor Green
