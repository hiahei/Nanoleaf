$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$assetRoot = Join-Path $projectRoot 'assets'
New-Item -ItemType Directory -Path $assetRoot -Force | Out-Null

function New-NanoleafBitmap([int]$size) {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
    $scale = $size / 256.0
    $graphics.ScaleTransform($scale, $scale)

    $backgroundPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $backgroundPath.AddArc(10, 10, 108, 108, 180, 90)
    $backgroundPath.AddArc(138, 10, 108, 108, 270, 90)
    $backgroundPath.AddArc(138, 138, 108, 108, 0, 90)
    $backgroundPath.AddArc(10, 138, 108, 108, 90, 90)
    $backgroundPath.CloseFigure()
    $backgroundBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        [System.Drawing.PointF]::new(18, 18),
        [System.Drawing.PointF]::new(238, 238),
        [System.Drawing.Color]::FromArgb(255, 23, 53, 47),
        [System.Drawing.Color]::FromArgb(255, 7, 23, 19)
    )
    $graphics.FillPath($backgroundBrush, $backgroundPath)

    $panels = @(
        @{ Points = @([System.Drawing.Point]::new(128,25), [System.Drawing.Point]::new(211,73), [System.Drawing.Point]::new(175,111), [System.Drawing.Point]::new(92,63)); Color = [System.Drawing.Color]::FromArgb(255, 84, 218, 178) },
        @{ Points = @([System.Drawing.Point]::new(231,128), [System.Drawing.Point]::new(183,211), [System.Drawing.Point]::new(144,175), [System.Drawing.Point]::new(192,92)); Color = [System.Drawing.Color]::FromArgb(255, 62, 187, 216) },
        @{ Points = @([System.Drawing.Point]::new(128,231), [System.Drawing.Point]::new(45,183), [System.Drawing.Point]::new(81,144), [System.Drawing.Point]::new(164,192)); Color = [System.Drawing.Color]::FromArgb(255, 130, 215, 164) },
        @{ Points = @([System.Drawing.Point]::new(25,128), [System.Drawing.Point]::new(73,45), [System.Drawing.Point]::new(112,81), [System.Drawing.Point]::new(64,164)); Color = [System.Drawing.Color]::FromArgb(255, 246, 167, 167) }
    )
    $outline = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(190, 231, 255, 247), 3)
    foreach ($panel in $panels) {
        $brush = New-Object System.Drawing.SolidBrush($panel.Color)
        $graphics.FillPolygon($brush, $panel.Points)
        $graphics.DrawPolygon($outline, $panel.Points)
        $brush.Dispose()
    }

    $center = @([System.Drawing.Point]::new(128,91), [System.Drawing.Point]::new(165,128), [System.Drawing.Point]::new(128,165), [System.Drawing.Point]::new(91,128))
    $centerBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 11, 39, 32))
    $centerOutline = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 214, 255, 240), 4)
    $graphics.FillPolygon($centerBrush, $center)
    $graphics.DrawPolygon($centerOutline, $center)
    $dotBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $graphics.FillEllipse($dotBrush, 120, 120, 16, 16)

    $dotBrush.Dispose()
    $centerOutline.Dispose()
    $centerBrush.Dispose()
    $outline.Dispose()
    $backgroundBrush.Dispose()
    $backgroundPath.Dispose()
    $graphics.Dispose()
    return $bitmap
}

$sizes = @(16, 32, 48, 64, 128, 256)
$pngs = @()
try {
    foreach ($size in $sizes) {
        $bitmap = New-NanoleafBitmap $size
        $stream = New-Object System.IO.MemoryStream
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        $pngs += ,([pscustomobject]@{ Size = $size; Bytes = $stream.ToArray() })
        $stream.Dispose()
        $bitmap.Dispose()
    }

    $iconPath = Join-Path $assetRoot 'nanoleaf.ico'
    $iconStream = New-Object System.IO.FileStream($iconPath, [System.IO.FileMode]::Create)
    $writer = New-Object System.IO.BinaryWriter($iconStream)
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$pngs.Count)
    $offset = 6 + (16 * $pngs.Count)
    foreach ($png in $pngs) {
        $dimension = if ($png.Size -eq 256) { 0 } else { $png.Size }
        $writer.Write([byte]$dimension)
        $writer.Write([byte]$dimension)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]32)
        $writer.Write([uint32]$png.Bytes.Length)
        $writer.Write([uint32]$offset)
        $offset += $png.Bytes.Length
    }
    foreach ($png in $pngs) { $writer.Write($png.Bytes) }
    $writer.Flush()
    $writer.Dispose()
    $iconStream.Dispose()
    Write-Output "Created $iconPath"
} finally {
    foreach ($png in $pngs) { if ($png) { } }
}
