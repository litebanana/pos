Add-Type -AssemblyName System.Drawing
$outputDirectory = Join-Path $PSScriptRoot '../public/icons'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
foreach ($size in @(180, 192, 512)) {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#6650d8'))
    $scale = $size / 64.0
    $graphics.ScaleTransform($scale, $scale)
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 2.6)
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#d8f397'))
    $points = [System.Drawing.PointF[]]@((New-Object System.Drawing.PointF(18, 26)), (New-Object System.Drawing.PointF(46, 26)), (New-Object System.Drawing.PointF(42, 18)), (New-Object System.Drawing.PointF(22, 18)))
    $graphics.FillPolygon($brush, $points)
    $graphics.DrawLine($pen, 20, 31, 20, 46)
    $graphics.DrawLine($pen, 20, 46, 44, 46)
    $graphics.DrawLine($pen, 44, 46, 44, 31)
    $graphics.DrawRectangle($pen, 28, 35, 8, 11)
    $graphics.DrawLine($pen, 18, 26, 46, 26)
    foreach ($offset in @(18, 25, 32, 39)) { $graphics.DrawArc($pen, $offset, 23, 7, 10, 0, 180) }
    $fileName = if ($size -eq 180) { 'apple-touch-icon.png' } else { "icon-$size.png" }
    $bitmap.Save((Join-Path $outputDirectory $fileName), [System.Drawing.Imaging.ImageFormat]::Png)
    if ($size -eq 512) { $bitmap.Save((Join-Path $outputDirectory 'maskable-512.png'), [System.Drawing.Imaging.ImageFormat]::Png) }
    $brush.Dispose()
    $pen.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}
