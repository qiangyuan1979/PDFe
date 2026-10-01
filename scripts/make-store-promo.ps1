#requires -Version 5.1
<#
  Generates promotional 1920x1080 Microsoft Store images for PDFe by compositing the
  real application screenshots (docs/store-listing/screenshots) onto a branded backdrop.

  This script is intentionally ASCII-only: Windows PowerShell 5.1 decodes a BOM-less
  .ps1 file as ANSI, which would mangle CJK literals. All human-readable copy therefore
  lives in store-promo-copy.json (read explicitly as UTF-8).

  Usage: powershell -ExecutionPolicy Bypass -File scripts\make-store-promo.ps1
#>

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$here     = Split-Path -Parent $MyInvocation.MyCommand.Path
$root     = (Resolve-Path (Join-Path $here "..")).Path
$shotDir  = Join-Path $root "docs\store-listing\screenshots"
$copy     = (Get-Content -Raw -Encoding UTF8 (Join-Path $here "store-promo-copy.json")) | ConvertFrom-Json

$W       = [int]$copy.canvas.width
$H       = [int]$copy.canvas.height
$outDir  = Join-Path $root $copy.promoDir
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# --- card geometry (16:9 window, right aligned) ---------------------------
$cardW = 1050
$cardH = [int][Math]::Round($cardW * 9 / 16)
$cardX = $W - $cardW - 96
$cardY = [int][Math]::Round(($H - $cardH) / 2)
$cardR = 22

# --- text column geometry -------------------------------------------------
$padX  = 110
$colW  = 610
$wmY   = 300
$tagY  = 394
$hlY   = 442
$hlLh  = 82
$bulY  = 650
$bulLh = 60

# --- palette --------------------------------------------------------------
$deepBlue = [System.Drawing.Color]::FromArgb(255, 5, 18, 38)
$midBlue  = [System.Drawing.Color]::FromArgb(255, 0, 58, 120)
$brand    = [System.Drawing.Color]::FromArgb(255, 0, 103, 192)
$accent   = [System.Drawing.Color]::FromArgb(255, 76, 194, 255)
$white    = [System.Drawing.Color]::White
$bodyText = [System.Drawing.Color]::FromArgb(255, 205, 226, 255)
$mutedText = [System.Drawing.Color]::FromArgb(255, 143, 185, 232)

function Get-Family([string[]]$names) {
  foreach ($name in $names) {
    try { return New-Object System.Drawing.FontFamily $name } catch { }
  }
  return [System.Drawing.FontFamily]::GenericSansSerif
}

function New-Font($family, [single]$size, [System.Drawing.FontStyle]$style) {
  return New-Object System.Drawing.Font $family, $size, $style, ([System.Drawing.GraphicsUnit]::Pixel)
}

function Add-RoundedRect($path, [single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $d = $r * 2
  $path.AddArc([single]$x, [single]$y, [single]$d, [single]$d, 180, 90)
  $path.AddArc([single]($x + $w - $d), [single]$y, [single]$d, [single]$d, 270, 90)
  $path.AddArc([single]($x + $w - $d), [single]($y + $h - $d), [single]$d, [single]$d, 0, 90)
  $path.AddArc([single]$x, [single]($y + $h - $d), [single]$d, [single]$d, 90, 90)
  $path.CloseFigure()
}

function Draw-Backdrop($g, [int]$w, [int]$h) {
  $rect  = New-Object System.Drawing.Rectangle 0, 0, $w, $h
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $deepBlue, $brand, 32.0
  $blend = New-Object System.Drawing.Drawing2D.ColorBlend 3
  $blend.Colors    = @($deepBlue, $midBlue, $brand)
  $blend.Positions = @(0.0, 0.55, 1.0)
  $brush.InterpolationColors = $blend
  $g.FillRectangle($brush, $rect)
  $brush.Dispose()

  # soft diagonal light streak across the upper half
  $state = $g.Save()
  $g.TranslateTransform([single]($w / 2), [single]($h / 2))
  $g.RotateTransform(-28)
  $bandRect  = New-Object System.Drawing.Rectangle -1400, -170, 2800, 340
  $bandBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $bandRect, $white, $white, 90.0
  $bandBlend = New-Object System.Drawing.Drawing2D.ColorBlend 5
  $bandBlend.Colors    = @([System.Drawing.Color]::FromArgb(0, 255, 255, 255),
                           [System.Drawing.Color]::FromArgb(0, 255, 255, 255),
                           [System.Drawing.Color]::FromArgb(30, 255, 255, 255),
                           [System.Drawing.Color]::FromArgb(0, 255, 255, 255),
                           [System.Drawing.Color]::FromArgb(0, 255, 255, 255))
  $bandBlend.Positions = @(0.0, 0.4, 0.5, 0.6, 1.0)
  $bandBrush.InterpolationColors = $bandBlend
  $g.FillRectangle($bandBrush, $bandRect)
  $bandBrush.Dispose()
  $g.Restore($state)

  # radial glows: one cool accent top-right, one deep blue bottom-left
  Draw-Glow $g 1560 130 430 ([System.Drawing.Color]::FromArgb(58, 76, 194, 255))
  Draw-Glow $g 250 1000 540 ([System.Drawing.Color]::FromArgb(44, 0, 140, 255))

  # gentle vignette so the corners recede
  $vPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $vPath.AddRectangle((New-Object System.Drawing.RectangleF 0, 0, $w, $h))
  $vBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush $vPath
  $vBrush.CenterColor = [System.Drawing.Color]::FromArgb(0, 2, 10, 24)
  $vBrush.SurroundColors = @([System.Drawing.Color]::FromArgb(120, 2, 10, 24))
  $g.FillPath($vBrush, $vPath)
  $vBrush.Dispose(); $vPath.Dispose()
}

function Draw-Glow($g, [single]$cx, [single]$cy, [single]$r, $color) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddEllipse([single]($cx - $r), [single]($cy - $r), [single]($r * 2), [single]($r * 2))
  $brush = New-Object System.Drawing.Drawing2D.PathGradientBrush $path
  $brush.CenterColor = $color
  $brush.SurroundColors = @([System.Drawing.Color]::FromArgb(0, $color.R, $color.G, $color.B))
  $g.FillPath($brush, $path)
  $brush.Dispose(); $path.Dispose()
}

function Draw-CardShadow($g, [single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  for ($k = 22; $k -ge 1; $k--) {
    $alpha = [int][Math]::Round(30 / (1 + $k * 0.55))
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    Add-RoundedRect $path ($x - $k) ($y + 12 - $k) ($w + $k * 2) ($h + $k * 2) ($r + $k)
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($alpha, 0, 6, 18))
    $g.FillPath($brush, $path)
    $brush.Dispose(); $path.Dispose()
  }
}

function Get-FittedSize($g, $family, [string[]]$lines, [single]$start, [single]$min, [single]$maxWidth, [System.Drawing.FontStyle]$style) {
  $size = $start
  while ($size -ge $min) {
    $font = New-Font $family $size $style
    $ok = $true
    foreach ($line in $lines) {
      if ($g.MeasureString($line, $font).Width -gt $maxWidth) { $ok = $false; break }
    }
    $font.Dispose()
    if ($ok) { return $size }
    $size -= 1
  }
  return $min
}

$family    = Get-Family @("Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI")
$wordmark  = New-Font $family 46 ([System.Drawing.FontStyle]::Bold)
$tagFont   = New-Font $family 22 ([System.Drawing.FontStyle]::Regular)

foreach ($img in $copy.images) {
  $shotPath = Join-Path $shotDir $img.source
  if (-not (Test-Path $shotPath)) { throw "missing screenshot: $shotPath" }
  $shot = [System.Drawing.Image]::FromFile($shotPath)

  $bmp = New-Object System.Drawing.Bitmap $W, $H, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bmp.SetResolution(96, 96)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

  Draw-Backdrop $g $W $H

  # window card with drop shadow
  Draw-CardShadow $g $cardX $cardY $cardW $cardH $cardR
  $cardPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  Add-RoundedRect $cardPath $cardX $cardY $cardW $cardH $cardR
  $g.SetClip($cardPath)
  $g.DrawImage($shot, (New-Object System.Drawing.RectangleF $cardX, $cardY, $cardW, $cardH))
  $g.ResetClip()
  $borderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(72, 255, 255, 255)), 1.6
  $g.DrawPath($borderPen, $cardPath)
  $borderPen.Dispose(); $cardPath.Dispose()

  # wordmark + accent rule
  $g.DrawString($copy.wordmark, $wordmark, (New-Object System.Drawing.SolidBrush $white), [single]$padX, [single]$wmY)
  $rule = New-Object System.Drawing.Drawing2D.GraphicsPath
  Add-RoundedRect $rule ([single]$padX) ([single]($wmY + 68)) 64 6 3
  $g.FillPath((New-Object System.Drawing.SolidBrush $accent), $rule)
  $rule.Dispose()

  # tagline
  $g.DrawString($copy.tagline, $tagFont, (New-Object System.Drawing.SolidBrush $mutedText), [single]$padX, [single]$tagY)

  # headline (auto-shrunk so both lines fit the column)
  $hlLines = @($img.headline)
  $hlSize  = Get-FittedSize $g $family $hlLines 62 38 $colW ([System.Drawing.FontStyle]::Bold)
  $hlFont  = New-Font $family $hlSize ([System.Drawing.FontStyle]::Bold)
  $hlBrush = New-Object System.Drawing.SolidBrush $white
  for ($i = 0; $i -lt $hlLines.Count; $i++) {
    $g.DrawString($hlLines[$i], $hlFont, $hlBrush, [single]$padX, [single]($hlY + $i * $hlLh))
  }
  $hlFont.Dispose(); $hlBrush.Dispose()

  # feature bullets
  $bulLines = @($img.bullets)
  $bulSize  = Get-FittedSize $g $family $bulLines 26 19 ($colW - 40) ([System.Drawing.FontStyle]::Regular)
  $bulFont  = New-Font $family $bulSize ([System.Drawing.FontStyle]::Regular)
  $bulBrush = New-Object System.Drawing.SolidBrush $bodyText
  $dotBrush = New-Object System.Drawing.SolidBrush $accent
  for ($i = 0; $i -lt $bulLines.Count; $i++) {
    $y = $bulY + $i * $bulLh
    $g.FillEllipse($dotBrush, [single]($padX + 2), [single]($y + ($bulSize * 0.34)), 10, 10)
    $g.DrawString($bulLines[$i], $bulFont, $bulBrush, [single]($padX + 40), [single]$y)
  }
  $bulFont.Dispose(); $bulBrush.Dispose(); $dotBrush.Dispose()

  $outPath = Join-Path $outDir $img.output
  $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)

  $g.Dispose(); $bmp.Dispose(); $shot.Dispose()
  Write-Host ("wrote {0}  ({1}x{2})" -f $outPath, $W, $H)
}

$wordmark.Dispose(); $tagFont.Dispose()
Write-Host ("done: {0} image(s) -> {1}" -f @($copy.images).Count, $outDir)
