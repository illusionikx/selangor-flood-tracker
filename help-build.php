<?php
/* Bakes the Help screenshots into img/help/. Run it by hand, never in a request:

     php help-build.php

   Herd must serve the app at https://flood-exp.test, because headless Chrome loads the live app.

   For each picture this opens `help-shot.html` in headless Chrome. One run gives two answers: a PNG
   of the window, and a JSON line in the page with the clip box and the box of each labeled control.
   GD then crops the PNG to the clip, scales it down if it is wider than MAX_W, and writes a WebP.
   The control boxes go into img/help/marks.json, in percent of the picture. `js/help.js` reads that
   file and puts a numbered marker on each control. So a marker and its control come from the same
   page load, and they cannot drift apart.

   Four pictures at two widths, eight files. Light theme only, on the repository owner's call of
   2026-10-19. The pictures show test mode, so the alerts in them are fake. Help says so under each
   one.

   Run this again after a change to any surface a picture shows. Nothing checks that the pictures
   are current. */

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PAGE   = 'https://flood-exp.test/help-shot.html';
const OUT    = __DIR__ . '/img/help';
const SHOTS  = ['main', 'panel', 'viewer', 'wall'];
/* [width, height, device scale]. 1280 is a common laptop window. 390 is a common phone. Both take a
   scale of 2, so a picture stays sharp on a high-density screen. The panel window is taller, because
   the card runs past 800px and the camera picture sits near its foot. */
const SIZES  = [
  'desktop' => ['main' => [1280, 800], 'panel' => [1280, 1300], 'viewer' => [1280, 800],
                'wall' => [1280, 800], 'dpr' => 2],
  'phone'   => ['main' => [390, 844],  'panel' => [390, 1500],  'viewer' => [390, 844],
                'wall' => [390, 844], 'dpr' => 2],
];
const MAX_W   = 1600;   // pixels. The main desktop picture is 2560 wide at scale 2, and Help draws
                        // it at about 600.
const QUALITY = 80;

if (!function_exists('imagewebp')) exit("GD has no WebP support.\n");
$tmp = sys_get_temp_dir() . '/help-shot-' . getmypid();
@mkdir($tmp, 0777, true);
@mkdir(OUT, 0777, true);
$null = PHP_OS_FAMILY === 'Windows' ? 'NUL' : '/dev/null';
$all = [];

foreach (SIZES as $width => $sz) foreach (SHOTS as $shot) {
    [$vw, $vh] = $sz[$shot];
    $name = "$shot-$width";
    $png  = "$tmp/$name.png";
    /* The window is larger than the frame on both axes. Chrome enforces a minimum window width, and
       the viewport comes out shorter than the window. See the note in help-shot.html. */
    $winW = max($vw, 600) + 40;
    $winH = $vh + 200;
    // A new profile for each run, so no preference or service worker carries over from the last.
    $cmd = escapeshellarg(CHROME) . ' --headless=new --disable-gpu --ignore-certificate-errors'
         . ' --hide-scrollbars --user-data-dir=' . escapeshellarg("$tmp/profile-$name")
         . " --force-device-scale-factor={$sz['dpr']} --window-size=$winW,$winH"
         . ' --virtual-time-budget=120000 --screenshot=' . escapeshellarg($png)
         . ' --dump-dom ' . escapeshellarg(PAGE . "?shot=$shot&w=$vw&h=$vh") . " 2>$null";
    echo "$name ... ";
    $dom = (string) shell_exec($cmd);
    preg_match('~<pre id="out">(.*?)</pre>~s', $dom, $m) || exit("no answer from the page\n");
    $j = json_decode(html_entity_decode($m[1]), true);
    if (!is_array($j)) exit("the answer is not JSON\n");
    if (!empty($j['error'])) exit("{$j['error']}\n");
    if (!is_file($png)) exit("Chrome wrote no screenshot\n");

    $img = imagecreatefrompng($png);
    if ($j['vw'] !== $vw || $j['vh'] !== $vh) exit("the frame is {$j['vw']} x {$j['vh']}, not $vw x $vh\n");
    $s = imagesx($img) / $winW;   // image pixels per CSS pixel, read off the file itself
    [$x0, $y0, $x1, $y1] = $j['clip'];
    $img = imagecrop($img, ['x' => (int) round($x0 * $s), 'y' => (int) round($y0 * $s),
                            'width'  => (int) round(($x1 - $x0) * $s),
                            'height' => (int) round(($y1 - $y0) * $s)]);
    if (!$img) exit('the clip box is empty: ' . json_encode($j['clip']) . "\n");
    if (imagesx($img) > MAX_W) $img = imagescale($img, MAX_W, -1, IMG_BICUBIC);
    imagewebp($img, OUT . "/$name.webp", QUALITY);

    $all[$name] = [
        'w' => imagesx($img), 'h' => imagesy($img),
        // The clip's own width in CSS pixels. Help draws a picture no wider than this, so a cropped
        // panel is never stretched past the size it has in the app.
        'cssW' => (int) round($x1 - $x0),
        'marks' => $j['marks'],
    ];
    printf("%d x %d, %d KB, %d marks\n", imagesx($img), imagesy($img),
           filesize(OUT . "/$name.webp") / 1024, count($j['marks']));
}

file_put_contents(OUT . '/marks.json',
    json_encode($all, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
echo "wrote img/help/marks.json\n";

// The six Chrome profiles and the PNGs. A profile holds tens of megabytes of cache.
$it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($tmp, FilesystemIterator::SKIP_DOTS),
                                    RecursiveIteratorIterator::CHILD_FIRST);
foreach ($it as $f) $f->isDir() ? @rmdir($f->getPathname()) : @unlink($f->getPathname());
@rmdir($tmp);
