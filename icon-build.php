<?php
/* Bakes the app icons from icon.svg, and prints the mask rule for css/icons.css.
   Run after replacing icon.svg:  php icon-build.php

   `icon.svg` is the bare glyph on transparency — one shape, no colour decisions in it. Everything
   below is derived from it, so there is one drawing and nothing to keep in step by hand:

     - icon-512.png / icon-192.png: the glyph in brand blue on transparency, at FILL of the canvas.
       The favicon and the manifest's icons.
     - icon-180.png:  the same glyph on an opaque white tile, for iOS only — see IOS_BG.
     - `--i-flood`:   the same paths as a mask, painting in whatever currentColor is.

   There is no SVG rasteriser on this machine (no Imagick, and `convert` on Windows is not
   ImageMagick), so every PNG is a headless-Chrome screenshot; 192 is GD downsampling the 512. */

const INK  = '#1a73e8';          // --accent. The glyph's own colour now that there is no plate
                                 // behind it: white would vanish in a light tab strip, black in a
                                 // dark one, and this is the colour the header's mark already is.
const FILL = 0.86;               // glyph width as a share of the canvas. Larger than it was, because
                                 // a transparent icon has no plate to sit inside — the margin used
                                 // to be the maskable safe zone, and there is no maskable any more.

/* iOS does not honour an alpha channel in a home-screen icon; it flattens it, and the colour it
   flattens onto is not ours to choose — historically black, which is precisely the plate that was
   just taken off. So iOS gets its own opaque tile rather than a guess: white, because that is the
   app's own light surface and the one background the blue mark was picked to sit on.
   180px is the size iOS asks for, and it rounds the corners itself — hence a smaller FILL, so the
   glyph clears the squircle's bite. */
const IOS_BG   = '#ffffff';
const IOS_FILL = 0.66;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

$svg = file_get_contents(__DIR__ . '/icon.svg');
preg_match('/viewBox="\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/', $svg, $v)
    || exit("icon.svg has no viewBox\n");
preg_match_all('/<path\b[^>]*\sd="([^"]+)"/', $svg, $m) || exit("icon.svg has no <path>\n");

[, $vx, $vy, $vw, $vh] = array_map('floatval', $v);
$paths = implode('', array_map(fn($d) => "<path d='$d'/>", $m[1]));

/* --- the PNGs ---------------------------------------------------------------------------------- */
/* One renderer, two calls, so the tile and the icon can never drift apart in anything but the two
   things that are meant to differ: the plate and the margin. `$bg` null means transparent —
   `--default-background-color=00000000` is the whole story there, since without it Chrome paints its
   own opaque white page behind the SVG and the screenshot comes back plated anyway. */
$bake = function (int $px, float $fill, ?string $bg, string $out) use ($vx, $vy, $vw, $vh, $paths) {
    $scale = $px * $fill / $vw;
    $tmp = __DIR__ . '/.icon-build.svg';
    file_put_contents($tmp, sprintf(
        "<svg xmlns='http://www.w3.org/2000/svg' width='%1\$d' height='%1\$d' viewBox='0 0 %1\$d %1\$d'>"
      . "%2\$s<g transform='translate(%3\$.3f,%4\$.3f) scale(%5\$.5f)' fill='%6\$s'>%7\$s</g></svg>",
        $px,
        $bg ? "<rect width='$px' height='$px' fill='$bg'/>" : '',
        ($px - $vw * $scale) / 2 - $vx * $scale,
        ($px - $vh * $scale) / 2 - $vy * $scale,
        $scale, INK, $paths));

    exec(sprintf('"%s" --headless --disable-gpu --hide-scrollbars --default-background-color=00000000 '
               . '--window-size=%d,%d --screenshot="%s" "%s" 2>&1',
               CHROME, $px, $px, __DIR__ . "/$out", 'file:///' . str_replace('\\', '/', $tmp)));
    unlink($tmp);
    file_exists(__DIR__ . "/$out") || exit("chrome wrote nothing — check CHROME\n");
    echo "$out — glyph ", round($vw * $scale), "px wide\n";
};

$bake(512, FILL, null, 'icon-512.png');
$bake(180, IOS_FILL, IOS_BG, 'icon-180.png');

// GD throws the alpha channel away unless told twice: blending off so the copy writes source alpha
// rather than compositing onto the new canvas's opaque black, and savealpha so it survives the PNG.
$s = imagecreatefrompng(__DIR__ . '/icon-512.png');
$d = imagecreatetruecolor(192, 192);
imagealphablending($d, false);
imagesavealpha($d, true);
imagecopyresampled($d, $s, 0, 0, 0, 0, 192, 192, 512, 512);
imagepng($d, __DIR__ . '/icon-192.png', 9);
echo "icon-192.png — downsampled from 512\n";
echo "now bump ?v= on the two <link> tags in index.html and the two icon srcs in manifest.json —\n",
     "the file names do not change, and a browser will hold the old favicon for far longer than\n",
     "Herd's three-hour max-age otherwise.\n";

/* --- the mask ------------------------------------------------------------------------------- */
/* Single quotes inside so the whole thing survives the double-quoted url(), same as every other
   icon in icons.css. Only `#` has to be escaped; the path data is already URL-safe. */
$mask = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='$vx $vy $vw $vh'>$paths</svg>";
echo "\n  --i-flood: url(\"data:image/svg+xml,", str_replace('#', '%23', $mask), "\");\n";
