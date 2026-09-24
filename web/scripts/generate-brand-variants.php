<?php
/**
 * One-off brand asset generator — InKart finalized identity.
 *
 * Reads the finalized source PNGs from public/brand/ and derives:
 *   - monochrome-WHITE variants (wordmark + glyph turned white, the
 *     terracotta dot PRESERVED by hue classification — geometry untouched)
 *   - favicon / app icons built from the standalone iK symbol on a clean
 *     white square (no redesign, no cropping of the dot)
 *
 * Server-side generation means no CSS filters (brightness/invert/…) are
 * ever applied to the brand assets in the app. Re-run only if the source
 * logo files change:  php scripts/generate-brand-variants.php  (from web/)
 */

$jobs = [
    __DIR__ . '/../public/brand/inkart-logo-primary.png',
    __DIR__ . '/../public/brand/inkart-symbol.png',
];

foreach ($jobs as $src) {
    $im = imagecreatefrompng($src);
    if (!$im) {
        fwrite(STDERR, "Cannot read $src\n");
        exit(1);
    }
    imagealphablending($im, false);
    imagesavealpha($im, true);

    $w = imagesx($im);
    $h = imagesy($im);
    $dotPixels = 0;
    $whitePixels = 0;

    for ($y = 0; $y < $h; $y++) {
        for ($x = 0; $x < $w; $x++) {
            $c = imagecolorat($im, $x, $y);
            $a = ($c >> 24) & 0x7F;
            if ($a === 127) {
                continue; // fully transparent
            }
            $r = ($c >> 16) & 0xFF;
            $g = ($c >> 8) & 0xFF;
            $b = $c & 0xFF;

            // HSL classification: is this pixel part of the terracotta dot?
            $rn = $r / 255;
            $gn = $g / 255;
            $bn = $b / 255;
            $max = max($rn, $gn, $bn);
            $min = min($rn, $gn, $bn);
            $d = $max - $min;
            $l = ($max + $min) / 2;
            $s = ($d === 0.0) ? 0.0 : $d / (1 - abs(2 * $l - 1));
            $hue = 0.0;
            if ($d > 0) {
                if ($max === $rn) {
                    $hue = fmod(($gn - $bn) / $d, 6);
                } elseif ($max === $gn) {
                    $hue = ($bn - $rn) / $d + 2;
                } else {
                    $hue = ($rn - $gn) / $d + 4;
                }
                $hue *= 60;
                if ($hue < 0) {
                    $hue += 360;
                }
            }

            // Terracotta window (orange hue, clearly saturated, mid lightness).
            $isDot = $s >= 0.30 && $l >= 0.18 && $l <= 0.85 && $hue >= 8 && $hue <= 50;

            if ($isDot) {
                $dotPixels++;
            } else {
                // Turn the charcoal ink into pure white, keeping the exact
                // original alpha channel (antialiasing is preserved).
                $white = imagecolorallocatealpha($im, 255, 255, 255, $a);
                imagesetpixel($im, $x, $y, $white);
                $whitePixels++;
            }
        }
    }

    $dst = str_replace('.png', '-white.png', $src);
    imagepng($im, $dst, 9);
    imagedestroy($im);
    printf("%s -> %s (dot px: %d, white px: %d)\n", basename($src), basename($dst), $dotPixels, $whitePixels);
}

// ---- Favicon / app icons from the standalone symbol --------------------
$sym = imagecreatefrompng(__DIR__ . '/../public/brand/inkart-symbol.png');

function makeIcon($sym, int $size, float $padRatio, string $dst): void
{
    $im = imagecreatetruecolor($size, $size);
    imagealphablending($im, true);
    // Clean white square background (the finalized app-icon direction).
    imagefill($im, 0, 0, imagecolorallocate($im, 255, 255, 255));
    $sw = imagesx($sym);
    $sh = imagesy($sym);
    $inner = (int) floor($size * (1 - 2 * $padRatio));
    $scale = min($inner / $sw, $inner / $sh);
    $dw = (int) floor($sw * $scale);
    $dh = (int) floor($sh * $scale);
    $dx = (int) floor(($size - $dw) / 2);
    $dy = (int) floor(($size - $dh) / 2);
    imagecopyresampled($im, $sym, $dx, $dy, 0, 0, $dw, $dh, $sw, $sh);
    imagepng($im, $dst, 9);
    imagedestroy($im);
    printf("icon -> %s (%dx%d)\n", basename($dst), $size, $size);
}

makeIcon($sym, 512, 0.14, __DIR__ . '/../src/app/icon.png');
makeIcon($sym, 180, 0.12, __DIR__ . '/../src/app/apple-icon.png');
imagedestroy($sym);

echo "Done.\n";
