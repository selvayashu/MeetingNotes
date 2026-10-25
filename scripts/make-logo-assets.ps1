# Builds the logo/icon files in /public from the brand sheet design/Logo.png.
#   powershell -ExecutionPolicy Bypass -File scripts/make-logo-assets.ps1
#
# The sheet is an opaque 880x560 image: the top panel holds the primary lockup on navy. We cut it out with a
# soft colour key (so anti-aliased edges stay smooth on any background), and make a light-mode copy by
# swapping the white parts for navy. If you ever get a vector/SVG or larger logo, replace this script's input.
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$src  = Join-Path $root 'design\Logo.png'
$out  = Join-Path $root 'public'

# Brand colours measured from the sheet.
$BG     = @(11, 17, 32)      # #0B1120 navy panel
$ORANGE = @(249, 115, 22)    # #F97316
$WHITE  = @(248, 250, 252)   # #F8FAFC
$NAVY   = $BG

# Regions of the top panel (pixels): whole lockup, and the hexagon mark on its own.
$LOCKUP = @{ x = 277; y = 137; w = 328; h = 119 }
$MARK   = @{ x = 277; y = 137; w = 106; h = 119 }
$PAD = 6

$sheet = New-Object System.Drawing.Bitmap $src

# Soft key: express each pixel as "foreground F over the navy background at alpha a", picking the foreground
# (orange or white) that explains the pixel best. Returns @(alpha 0..1, index of foreground).
function KeyPixel($c) {
    $v = @(($c.R - $BG[0]), ($c.G - $BG[1]), ($c.B - $BG[2]))
    $best = $null
    $i = 0
    foreach ($F in @($ORANGE, $WHITE)) {
        $d = @(($F[0] - $BG[0]), ($F[1] - $BG[1]), ($F[2] - $BG[2]))
        $dd = $d[0]*$d[0] + $d[1]*$d[1] + $d[2]*$d[2]
        $a = ($v[0]*$d[0] + $v[1]*$d[1] + $v[2]*$d[2]) / $dd
        $a = [math]::Max(0, [math]::Min(1, $a))
        $r0 = $v[0] - $a*$d[0]; $r1 = $v[1] - $a*$d[1]; $r2 = $v[2] - $a*$d[2]
        $res = $r0*$r0 + $r1*$r1 + $r2*$r2
        if ($best -eq $null -or $res -lt $best.res) { $best = @{ a = $a; i = $i; res = $res } }
        $i++
    }
    return $best
}

# Cut a region out as a transparent bitmap. $whiteTo recolours the white parts (use $NAVY for light mode).
function CutOut($r, $whiteTo) {
    $w = $r.w + 2*$PAD; $h = $r.h + 2*$PAD
    $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    for ($y = 0; $y -lt $h; $y++) {
        for ($x = 0; $x -lt $w; $x++) {
            $sx = $r.x + $x - $PAD; $sy = $r.y + $y - $PAD
            if ($sx -lt 0 -or $sy -lt 0 -or $sx -ge $sheet.Width -or $sy -ge 392) { continue }
            $k = KeyPixel ($sheet.GetPixel($sx, $sy))
            if ($k.a -lt 0.03) { continue }
            $col = if ($k.i -eq 0) { $ORANGE } else { $whiteTo }
            $bmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb([int][math]::Round($k.a * 255), $col[0], $col[1], $col[2]))
        }
    }
    return $bmp
}

function Save($bmp, $name) {
    $bmp.Save((Join-Path $out $name), [System.Drawing.Imaging.ImageFormat]::Png)
    "{0,-22} {1} x {2}" -f $name, $bmp.Width, $bmp.Height
}

$lockDark  = CutOut $LOCKUP $WHITE;  Save $lockDark  'logo-dark.png'    # for dark backgrounds
$lockLight = CutOut $LOCKUP $NAVY;   Save $lockLight 'logo-light.png'   # for light backgrounds
$markDark  = CutOut $MARK   $WHITE;  Save $markDark  'mark-dark.png'
$markLight = CutOut $MARK   $NAVY;   Save $markLight 'mark-light.png'

# App icons: the mark centred on a navy tile. `fill` is how much of the tile the mark covers; the maskable
# 512 icon keeps it inside the central safe zone so Android's circle/squircle masks never clip it.
function Tile($size, $fill, $name) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::FromArgb(255, $NAVY[0], $NAVY[1], $NAVY[2]))
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $target = $size * $fill
    $scale = $target / [math]::Max($markDark.Width, $markDark.Height)
    $dw = $markDark.Width * $scale; $dh = $markDark.Height * $scale
    $g.DrawImage($markDark, [float](($size - $dw) / 2), [float](($size - $dh) / 2), [float]$dw, [float]$dh)
    $g.Dispose()
    Save $bmp $name
    $bmp.Dispose()
}
Tile 512 0.56 'icon-512.png'
Tile 192 0.56 'icon-192.png'
Tile 180 0.66 'apple-touch-icon.png'
Tile 32  0.86 'favicon-32.png'

$sheet.Dispose()
