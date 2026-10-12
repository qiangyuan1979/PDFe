<#
.SYNOPSIS
  构建 PDFe 并打包为 MSIX，可选签名（自签名 / 指定 pfx / 不签名）。

.DESCRIPTION
  Tauri 2 不产出 MSIX，本脚本手工完成四条链路：
    1. 前端构建（npm run build）+ Rust release 构建（cargo build --release）
    2. 按 MSIX 要求的目录布局暂存：pdfe.exe + pdfium.dll + Assets\*.png + AppxManifest.xml
    3. makeappx pack 打为 .msix
    4. signtool sign 签名（MSIX 要求清单 Publisher 与证书 Subject 一致）

.EXAMPLE
  # 自签名 + 本机安装验证（首次会生成自签名证书）
  powershell -ExecutionPolicy Bypass -File scripts\build-msix.ps1 -Install

.EXAMPLE
  # 用已有正式证书签名，不安装
  powershell -ExecutionPolicy Bypass -File scripts\build-msix.ps1 -Sign Pfx -PfxPath C:\certs\pdfe.pfx -PfxPassword 你的密码

.EXAMPLE
  # 只出未签名包（交给 Partner Center 签名上架）
  powershell -ExecutionPolicy Bypass -File scripts\build-msix.ps1 -Sign None

.EXAMPLE
  # 复用已构建的 target\release，不重新编译
  powershell -ExecutionPolicy Bypass -File scripts\build-msix.ps1 -SkipBuild

.EXAMPLE
  # 出带 OCR 支持的包（先跑 prepare-ocr-runtime.ps1 生成 ocr-runtime 暂存目录）
  powershell -ExecutionPolicy Bypass -File scripts\prepare-ocr-runtime.ps1
  powershell -ExecutionPolicy Bypass -File scripts\build-msix.ps1 -Ocr

.EXAMPLE
  # 出提交 Microsoft Store 用的正式包：注入 Partner Center「产品标识」三个值
  # （Identity 的 Name / Publisher / PublisherDisplayName），由微软重签
  powershell -ExecutionPolicy Bypass -File scripts\build-msix.ps1 -Sign None `
    -IdentityName 12345KonnyYuan.PDFe `
    -Publisher "CN=d9e5f0b8-0000-0000-0000-000000000000" `
    -PublisherDisplayName "Konny Yuan"
#>
[CmdletBinding()]
param(
  # 跳过 npm/cargo 构建，复用 src-tauri\target\release
  [switch]$SkipBuild,

  # 签名方式：SelfSigned=本机自签名证书；Pfx=指定 .pfx；None=不签名
  [ValidateSet("SelfSigned", "Pfx", "None")]
  [string]$Sign = "SelfSigned",

  # -Sign Pfx 时必填
  [string]$PfxPath = "",
  [string]$PfxPassword = "",

  # 自签名证书的 Subject，必须与 AppxManifest.xml 的 Publisher 一致
  [string]$Publisher = "CN=PDFe Local Test",

  # MSIX 包标识名（Partner Center「产品标识 → 包/标识/名称」）
  # 默认值为本地侧载测试用；上架必须传 Partner Center 分配的值
  [string]$IdentityName = "konnyyuan.pdfe",

  # 发布者显示名称（Partner Center「包/属性/发布者显示名称」）
  [string]$PublisherDisplayName = "PDFe",

  # 签名后把证书信任到本机（LocalMachine\TrustedPeople，需管理员）并 Add-AppxPackage 安装验证
  [switch]$Install,

  # 打包 OCR 支持：启用 ocr feature，并把 src-tauri\ocr-runtime 下的 DLL+tessdata
  # 一并暂存进包内（DLL 与 exe 同级，tessdata 放 exe 同级 tessdata\）。
  # 需先运行 scripts\prepare-ocr-runtime.ps1 生成 ocr-runtime 暂存目录。
  [switch]$Ocr
)

$ErrorActionPreference = "Stop"

$cargoFeatures = if ($Ocr) { "custom-protocol,ocr" } else { "custom-protocol" }

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$tauriDir = Join-Path $repoRoot "src-tauri"
$confPath = Join-Path $tauriDir "tauri.conf.json"
$manifestTemplate = Join-Path $tauriDir "msix\AppxManifest.xml"
$pdfiumDll = Join-Path $tauriDir "pdfium\pdfium.dll"
$iconsDir = Join-Path $tauriDir "icons"

function Write-Step([string]$msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Assert-Path([string]$path, [string]$what) {
  if (-not (Test-Path $path)) { throw "$what 不存在：$path" }
}

# --- Windows SDK 工具定位（makeappx / signtool 默认不在 PATH）---
function Find-SdkTool([string]$name) {
  $onPath = Get-Command $name -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  $kitsRoot = "C:\Program Files (x86)\Windows Kits\10\bin"
  if (-not (Test-Path $kitsRoot)) { throw "未找到 Windows SDK：$kitsRoot，$name 不可用" }
  $found = Get-ChildItem $kitsRoot -Directory |
    Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } |
    Sort-Object { [version]$_.Name } -Descending |
    ForEach-Object { Join-Path $_.FullName "x64\$name" } |
    Where-Object { Test-Path $_ } |
    Select-Object -First 1
  if (-not $found) { throw "在 $kitsRoot 下找不到 x64\$name，请安装 Windows SDK" }
  return $found
}

# --- 读取 tauri.conf.json：productName / version ---
Assert-Path $confPath "tauri.conf.json"
$conf = Get-Content $confPath -Raw -Encoding UTF8 | ConvertFrom-Json
$exeName = "$($conf.productName).exe"
$versionRaw = $conf.version
$verParts = @($versionRaw -split '\.')
while ($verParts.Count -lt 4) { $verParts += "0" }
if ($verParts.Count -gt 4) { $verParts = $verParts[0..3] }
$version4 = $verParts -join '.'

Write-Host "PDFe MSIX 打包" -ForegroundColor Green
Write-Host "  仓库根    : $repoRoot"
Write-Host "  可执行文件: $exeName"
Write-Host "  版本      : $versionRaw -> $version4"
Write-Host "  签名方式  : $Sign"
Write-Host "  OCR       : $([bool]$Ocr)"

# --- 1. 构建 ---
if (-not $SkipBuild) {
  Write-Step "1/6 前端构建 (npm run build)"
  Push-Location $repoRoot
  try { npm run build; if ($LASTEXITCODE -ne 0) { throw "npm run build 失败" } }
  finally { Pop-Location }

  Write-Step "1/6 Rust release 构建 (cargo build --release --features $cargoFeatures)"
  Push-Location $tauriDir
  try { cargo build --release --features $cargoFeatures; if ($LASTEXITCODE -ne 0) { throw "cargo build --release --features $cargoFeatures 失败" } }
  finally { Pop-Location }
} else {
  Write-Step "1/6 跳过构建（-SkipBuild）"
}

$exePath = Join-Path $tauriDir "target\release\$exeName"
Assert-Path $exePath "release 可执行文件（先去掉 -SkipBuild 构建一次）"
Assert-Path $pdfiumDll "pdfium.dll"
Assert-Path $manifestTemplate "MSIX 清单模板"

# --- 2. 暂存 MSIX 目录布局 ---
Write-Step "2/6 暂存布局"
$msixRoot = Join-Path $tauriDir "target\msix"
$layoutDir = Join-Path $msixRoot "layout"
if (Test-Path $layoutDir) { Remove-Item $layoutDir -Recurse -Force }
$assetsDir = Join-Path $layoutDir "Assets"
New-Item -ItemType Directory -Path $assetsDir -Force | Out-Null

Copy-Item $exePath -Destination $layoutDir
# pdfium.dll 必须与 exe 同级（document.rs 优先在 exe 目录查找）
Copy-Item $pdfiumDll -Destination $layoutDir

if ($Ocr) {
  # OCR 运行期依赖：DLL 必须与 exe 同级（进程启动时由加载器解析静态导入），
  # tessdata 放同级 tessdata\ 目录（lib.rs::configure_ocr_runtime 据此设 TESSDATA_PREFIX）。
  $ocrStage = Join-Path $tauriDir "ocr-runtime"
  $ocrTessdataStage = Join-Path $ocrStage "tessdata"
  Assert-Path $ocrStage "OCR 暂存目录（先运行 scripts\prepare-ocr-runtime.ps1）"
  Assert-Path (Join-Path $ocrStage "tesseract55.dll") "OCR 运行期 DLL"
  Assert-Path (Join-Path $ocrTessdataStage "eng.traineddata") "OCR 语言包"
  Copy-Item (Join-Path $ocrStage "*.dll") -Destination $layoutDir
  Copy-Item -Path $ocrTessdataStage -Destination $layoutDir -Recurse
  $ocrDllCount = (Get-ChildItem $layoutDir -Filter *.dll).Count
  Write-Host "  已暂存 OCR 依赖（DLL 与 exe 同级，tessdata\ 语言包）；layout 内 DLL 共 $ocrDllCount 个"
}
$assetFiles = @(
  "Square150x150Logo.png", "Square44x44Logo.png", "StoreLogo.png",
  "Square71x71Logo.png", "Square310x310Logo.png", "Wide310x150Logo.png"
)
foreach ($a in $assetFiles) {
  $src = Join-Path $iconsDir $a
  Assert-Path $src "MSIX 图标资源"
  Copy-Item $src -Destination $assetsDir
}

# --- 3. 生成 AppxManifest.xml ---
Write-Step "3/6 生成 AppxManifest.xml"
$manifestXml = Get-Content $manifestTemplate -Raw -Encoding UTF8
# 逐个替换（PowerShell 不支持用反引号把 .Replace 链式调用续到下一行）
$manifestXml = $manifestXml.Replace("__IDENTITY_NAME__", $IdentityName)
$manifestXml = $manifestXml.Replace("__PUBLISHER__", $Publisher)
$manifestXml = $manifestXml.Replace("__PUBLISHER_DISPLAY_NAME__", $PublisherDisplayName)
$manifestXml = $manifestXml.Replace("__VERSION__", $version4)
$manifestXml = $manifestXml.Replace("__EXE__", $exeName)
# 占位符名可能含下划线（如 __IDENTITY_NAME__），字符类必须包含 _
if ($manifestXml -match "__[A-Z_]+__") { throw "清单中仍有未替换的占位符：$($Matches[0])" }
# 写 UTF-8 无 BOM：makeappx 对带 BOM 的清单会报错
[System.IO.File]::WriteAllText(
  (Join-Path $layoutDir "AppxManifest.xml"),
  $manifestXml,
  (New-Object System.Text.UTF8Encoding($false))
)
Write-Host "  IdentityName         = $IdentityName"
Write-Host "  Publisher            = $Publisher"
Write-Host "  PublisherDisplayName = $PublisherDisplayName"

# --- 4. makeappx pack ---
Write-Step "4/6 makeappx pack"
$makeappx = Find-SdkTool "makeappx.exe"
$msixPath = Join-Path $msixRoot "PDFe_${versionRaw}_x64.msix"
if (Test-Path $msixPath) { Remove-Item $msixPath -Force }
& $makeappx pack /d $layoutDir /p $msixPath /o
if ($LASTEXITCODE -ne 0) { throw "makeappx pack 失败" }
Write-Host "  产物: $msixPath" -ForegroundColor Green

# --- 5. 签名 ---
Write-Step "5/6 签名"
$cerPath = $null
switch ($Sign) {
  "None" {
    Write-Host "  跳过签名（-Sign None）：产物未签名，需由 Partner Center 签名后才可安装" -ForegroundColor Yellow
  }
  "Pfx" {
    if (-not $PfxPath) { throw "-Sign Pfx 需要同时提供 -PfxPath" }
    Assert-Path $PfxPath "代码签名证书 .pfx"
    $signtool = Find-SdkTool "signtool.exe"
    # 注意：不要用 $args（PowerShell 自动变量）
    $signArgs = @("sign", "/fd", "SHA256", "/f", $PfxPath)
    if ($PfxPassword) { $signArgs += @("/p", $PfxPassword) }
    $signArgs += $msixPath
    & $signtool @signArgs
    if ($LASTEXITCODE -ne 0) { throw "signtool sign 失败（常见原因：清单 Publisher 与证书 Subject 不一致）" }
  }
  "SelfSigned" {
    $existing = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert -ErrorAction SilentlyContinue |
      Where-Object { $_.Subject -eq $Publisher } | Select-Object -First 1
    if ($existing) {
      $cert = $existing
      Write-Host "  复用已存在的自签名证书：$($cert.Thumbprint)"
    } else {
      Write-Host "  生成自签名证书：$Publisher"
      $cert = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject $Publisher `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -KeyExportPolicy Exportable `
        -KeyAlgorithm RSA `
        -KeyLength 2048 `
        -NotAfter (Get-Date).AddYears(3)
    }
    $pfxOut = Join-Path $msixRoot "PDFe-SelfSigned.pfx"
    $cerPath = Join-Path $msixRoot "PDFe-SelfSigned.cer"
    $pfxPwd = "pdfe-local-test"   # 仅本机自签名测试用
    $securePwd = ConvertTo-SecureString -String $pfxPwd -Force -AsPlainText
    Export-PfxCertificate -Cert $cert -FilePath $pfxOut -Password $securePwd -Force | Out-Null
    Export-Certificate -Cert $cert -FilePath $cerPath -Force | Out-Null
    Write-Host "  导出: $pfxOut （口令 $pfxPwd）/ $cerPath"

    $signtool = Find-SdkTool "signtool.exe"
    & $signtool sign /fd SHA256 /f $pfxOut /p $pfxPwd $msixPath
    if ($LASTEXITCODE -ne 0) { throw "signtool sign 失败" }
  }
}

$signerThumbprint = $null
if ($Sign -ne "None") {
  $sig = Get-AuthenticodeSignature $msixPath
  $signerThumbprint = $sig.SignerCertificate.Thumbprint
  Write-Host "  签名状态: $($sig.Status) / 签名者: $($sig.SignerCertificate.Subject)"
  if ($sig.Status -ne "Valid" -and $sig.Status -ne "UnknownError") {
    Write-Warning "签名状态非 Valid（$($sig.Status)）——自签名证书尚未受本机信任时属预期，步骤 6 装入本机信任存储后即变 Valid"
  }
}

# --- 6. 安装验证（可选）---
Write-Step "6/6 安装验证"
if ($Install) {
  if ($Sign -eq "None") { throw "-Install 需要先签名（未签名的 MSIX 无法安装）" }
  if ($Sign -eq "SelfSigned") {
    # AppXSVC（AppX 部署服务）以服务账户运行，读不到 CurrentUser 的证书存储，
    # 所以自签名证书必须装进本机 LocalMachine\TrustedPeople 作为显式信任锚，
    # 否则 Add-AppxPackage 报 0x800B0109「应用包签名的根证书必须是受信任的证书」。
    $trusted = Get-ChildItem Cert:\LocalMachine\TrustedPeople -ErrorAction SilentlyContinue |
      Where-Object { $_.Thumbprint -eq $signerThumbprint }
    if ($trusted) {
      Write-Host "  本机 TrustedPeople 已信任证书 $signerThumbprint"
    } else {
      $importCmd = "Import-Certificate -FilePath '$cerPath' -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null"
      if (Test-Admin) {
        Import-Certificate -FilePath $cerPath -CertStoreLocation "Cert:\LocalMachine\TrustedPeople" | Out-Null
      } else {
        Write-Host "  写入 LocalMachine\TrustedPeople 需要管理员权限，正在请求提权（会弹出 UAC）…" -ForegroundColor Yellow
        $encoded = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($importCmd))
        Start-Process powershell -Verb RunAs -Wait -ArgumentList @(
          "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encoded)
      }
      $trusted = Get-ChildItem Cert:\LocalMachine\TrustedPeople -ErrorAction SilentlyContinue |
        Where-Object { $_.Thumbprint -eq $signerThumbprint }
      if (-not $trusted) {
        throw "未能把自签名证书装入 LocalMachine\TrustedPeople（UAC 被拒绝？）。请以管理员身份运行 PowerShell 后执行：`n  $importCmd"
      }
      Write-Host "  已把自签名证书装入 LocalMachine\TrustedPeople" -ForegroundColor Green
    }
  }
  Add-AppxPackage -Path $msixPath
  if ($Sign -eq "SelfSigned") {
    # 信任建立后复查：步骤 5 在证书尚未受本机信任时会显示 UnknownError
    Write-Host "  签名状态（装入信任后复查）: $((Get-AuthenticodeSignature $msixPath).Status)"
  }
  Write-Host "  安装完成。启动方式：开始菜单搜索 PDFe，或运行 explorer shell:appsFolder\${IdentityName}_*!App" -ForegroundColor Green
} else {
  Write-Host "  未加 -Install，跳过。手动安装："
  Write-Host "    Add-AppxPackage -Path `"$msixPath`""
}

Write-Host "`n完成：$msixPath" -ForegroundColor Green
