<?php
if (PHP_SAPI !== 'cli') exit;   // a command-line script, and never a page. Herd would otherwise run it for a visitor
/* Bakes the app icons from icon.svg and prints the mask rule for css/icons.css.
   Run after you replace icon.svg:  php icon-build.php

   icon.svg is the bare Breach glyph on transparency. It has one shape and no colour. Every file
   below comes from it, so the drawing lives in one place. The glyph already carries its own margin
   inside the 100 by 100 box, so a scale of 1 is the tile layout.

     icon-512.png, icon-192.png            volt tile with rounded corners, white glyph. Purpose `any`.
     icon-maskable-512.png, -192.png       full-bleed volt square, glyph at MASK_SCALE. Purpose `maskable`.
     icon-180.png                          full-bleed volt square for iOS. iOS rounds the corners itself.
     badge-96.png                          white glyph on transparency. Android reads only its alpha.
     favicon.svg                           the same rounded tile as vector.
     favicon.ico                           16, 32 and 48 pixel tiles for old browsers.
     --i-flood                             the glyph as a mask. It paints in currentColor.

   Never put a tile into icon.svg. js/alerts.js draws that file and fills it red with `source-in`
   for the alert favicon. A tile there comes out as a solid red square.

   This machine has no SVG rasterizer. Every PNG is a headless Chrome screenshot.
   GD makes the 192 pixel file and the ico sizes by downsampling the 512 pixel file. */

const VOLT  = '#0038FF';         // --brand-volt in css/base.css
const GLYPH = '#FFFFFF';
const RADIUS = 22.37;            // tile corner, as a share of the 100 unit box
const TILE_SCALE = 0.8;          // glyph on the rounded tile and the favicon. 72% of the tile width.
const MASK_SCALE = 0.67;         // maskable glyph. Its bounding circle stays inside the 80% safe zone.
const IOS_SCALE  = 0.85;         // iOS rounds the corners, so the glyph needs more margin than the tile
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

$svg = file_get_contents(__DIR__ . '/icon.svg');
preg_match('/viewBox="\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/', $svg, $v)
    || exit("icon.svg has no viewBox\n");
preg_match_all('/<path\b[^>]*\sd="([^"]+)"/', $svg, $m) || exit("icon.svg has no <path>\n");
[, $vx, $vy, $vw, $vh] = array_map('floatval', $v);
($vx == 0 && $vy == 0 && $vw == 100 && $vh == 100) || exit("icon.svg must use viewBox 0 0 100 100\n");
$paths = implode('', array_map(fn($d) => "<path fill-rule='evenodd' d='$d'/>", $m[1]));

/* One renderer. `$tile` is 'round', 'square' or null for no tile. `$scale` shrinks the glyph about
   the center of the box. A null tile means a transparent file. `--default-background-color=00000000`
   keeps Chrome from painting its own white page behind the SVG. */
$bake = function (int $px, string|null $tile, float $scale, string $glyph, string $out) use ($paths) {
    $bg = match ($tile) {
        'round'  => "<rect width='100' height='100' rx='" . RADIUS . "' fill='" . VOLT . "'/>",
        'square' => "<rect width='100' height='100' fill='" . VOLT . "'/>",
        default  => '',
    };
    $tmp = __DIR__ . '/.icon-build.svg';
    file_put_contents($tmp, "<svg xmlns='http://www.w3.org/2000/svg' width='$px' height='$px' viewBox='0 0 100 100'>"
        . "$bg<g transform='translate(50 50) scale($scale) translate(-50 -50)' fill='$glyph'>$paths</g></svg>");
    exec(sprintf('"%s" --headless --disable-gpu --hide-scrollbars --default-background-color=00000000 '
               . '--window-size=%d,%d --screenshot="%s" "%s" 2>&1',
               CHROME, $px, $px, __DIR__ . "/$out", 'file:///' . str_replace('\\', '/', $tmp)));
    unlink($tmp);
    file_exists(__DIR__ . "/$out") || exit("chrome wrote nothing. Check CHROME\n");
    echo "$out\n";
};

/* GD drops the alpha channel unless you ask twice. Blending off makes the copy keep the source
   alpha. Save-alpha keeps it in the PNG. */
$down = function (string $from, int $px) {
    $s = imagecreatefrompng(__DIR__ . "/$from");
    $d = imagecreatetruecolor($px, $px);
    imagealphablending($d, false);
    imagesavealpha($d, true);
    imagecopyresampled($d, $s, 0, 0, 0, 0, $px, $px, imagesx($s), imagesy($s));
    return $d;
};

$bake(512, 'round', TILE_SCALE, GLYPH, 'icon-512.png');
$bake(512, 'square', MASK_SCALE, GLYPH, 'icon-maskable-512.png');
$bake(180, 'square', IOS_SCALE, GLYPH, 'icon-180.png');
$bake(96, null, 1.0, GLYPH, 'badge-96.png');

imagepng($down('icon-512.png', 192), __DIR__ . '/icon-192.png', 9);
echo "icon-192.png (from 512)\n";
imagepng($down('icon-maskable-512.png', 192), __DIR__ . '/icon-maskable-192.png', 9);
echo "icon-maskable-192.png (from 512)\n";

/* favicon.svg: the same tile, as vector. */
$fav = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\" width=\"100\" height=\"100\">"
     . "<rect width=\"100\" height=\"100\" rx=\"" . RADIUS . "\" fill=\"" . VOLT . "\"/>"
     . "<g transform=\"translate(50 50) scale(" . TILE_SCALE . ") translate(-50 -50)\" fill=\"" . GLYPH . "\">"
     . str_replace("'", '"', $paths) . "</g></svg>\n";
file_put_contents(__DIR__ . '/favicon.svg', $fav);
echo "favicon.svg\n";

/* favicon.ico: three PNG entries. A PNG entry is valid in an ico since Windows Vista. */
$entries = [];
foreach ([16, 32, 48] as $px) {
    ob_start();
    imagepng($down('icon-512.png', $px), null, 9);
    $entries[$px] = ob_get_clean();
}
$head = pack('vvv', 0, 1, count($entries));
$dir = ''; $data = ''; $off = 6 + 16 * count($entries);
foreach ($entries as $px => $png) {
    $dir .= pack('CCCCvvVV', $px, $px, 0, 0, 1, 32, strlen($png), $off + strlen($data));
    $data .= $png;
}
file_put_contents(__DIR__ . '/favicon.ico', $head . $dir . $data);
echo "favicon.ico (16, 32, 48)\n";

echo "\nNow bump ?v= on the icon links in index.html and the icon srcs in manifest.json.\n",
     "The file names do not change. A browser keeps an old favicon much longer than the host max-age.\n";

/* --- the mask ------------------------------------------------------------------------------- */
/* Single quotes inside, so the whole value survives the double-quoted url(), the same as every
   other icon in icons.css. Only `#` needs escaping. The path data is already URL-safe. */
$mask = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>$paths</svg>";
echo "\n  --i-flood: url(\"data:image/svg+xml,", str_replace('#', '%23', $mask), "\");\n";
