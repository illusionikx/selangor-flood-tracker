<?php
// The camera archive: capture, retention and lookup. Split out of api.php like sources.php, because
// this is the one rule in the proxy worth a test and api.php cannot be required without running a
// refresh. `shots-test.php` exercises pruneShots().
// Needs HOST and fetchAll() from api.php. Required from there, never on its own.

/* --- Camera archive ------------------------------------------------------------------------------
 *
 * A river level has a graph. A camera had only "now". The archive gives it the same thing — what
 * this bend looked like six hours ago, and the night before.
 *
 * Every number here is a bandwidth decision. JPS serves 90 stills at 175–390 KB (avg ~250 KB), so
 * pulling all 90 every 5-minute poll is ~6.5 GB a day off one government server from one address —
 * the stampede the refresh lock exists to prevent, and the fastest way to lose the feed. So capture
 * is decoupled from the poll: once every SHOT_EVERY, by whoever happens to be refreshing. That is
 * ~1.1 GB/day, and the ceiling on how dense the 6-hour tier can be.
 *
 * Frames store at 720p, which is what JPS serves — every camera measured came back 1280x720. So
 * SHOT_W is the native width and nothing is normally downscaled. It exists for the day a camera
 * publishes something larger.
 *
 * At that size the frame stores as **whichever encoding is smaller**, which at SHOT_Q is usually
 * the original bytes untouched. Re-encoding 1280x720 CCTV to WebP measured *larger* than its source
 * JPEG on half the cameras even at q60 — a generation loss paid to grow the file. That is a fact
 * about noisy night-time CCTV, not about WebP, so the rule compares the two rather than naming a
 * winner. It stays right if JPS changes encoder, and re-derives itself if SHOT_W ever drops, where
 * the re-encode wins by a wide margin.
 *
 * Source stills average 245 KB (90 cameras, median 219, max 515), so the archive tops out near
 * 3.7 GB — 165 frames a camera, and flat from the first year on, because the last tier deletes as
 * fast as capture adds.
 */
const SHOTS      = __DIR__ . '/shots';
const SHOT_EVERY = 1800;    // 30 min between captures — see above
/* How old the newest stored frame may be and still stand in for a live picture. SHOT_EVERY is the
   gap between captures, not a ceiling on age: a camera whose capture keeps failing ages without
   bound, and one measured 5.9 days. Past this the archive is no longer tracking that camera, so a
   caller asking for "the newest frame" is better served by being told there is not one. */
const SHOT_FRESH = 2 * SHOT_EVERY;
const SHOT_W     = 1280;    // 720p — the native width of every camera measured
/* Deliberately high. With the smaller-of-the-two rule below, a quality this close to the source
   means the re-encode almost never wins, so what gets stored is the original JPEG byte for byte,
   with no generation loss. WebP takes over only where it beats the original, and at q82 that is a
   real saving rather than a coin toss.
   1080p was never on the table: JPS publishes 1280x720, so upscaling doubles the file for no extra
   detail. 720p is the ceiling, so quality is the only axis left. */
const SHOT_Q     = 82;
const SHOT_MIN   = 4096;    // bytes: JPS answers a dead camera with a ~2 KB placeholder, not a 404

/* The clip window a strip covers — see buildSheet() below for what a strip is. The same three hours
   js/config.js calls CLIP_WIN. Two files carry this number and both must move together, like
   CAM_ALERT_KM and SIREN_KM, and like the retention anchors here and in js/timeline.js. */
const CLIP_WIN = 3 * 3600;

/* --- the strip -------------------------------------------------------------------------------
 * A wall tile paints into about 200px. A station panel card paints into about 340px. Both used to
 * warm six or seven full 1280-wide frames per camera at ~214 KB each — over 600 requests and
 * several hundred megabytes for one scroll of the wall. Video players solve this with a sprite
 * sheet. NVRs solve it with a low-resolution sub stream for grid views. A strip is both: one
 * derived file per camera, every frame inside CLIP_WIN side by side in one image, each cell scaled
 * down first. A caller reads that one picture and steps through it with a CSS transform — no frame
 * list, no per-frame request, and no request at all after the first.
 *
 * SHEET_W x SHEET_H is 480x270, the 16:9 every camera publishes, at three-eighths of SHOT_W. The
 * widest consumer is the panel clip at about 340px, so 480 is roughly 1.4x. A wall tile is about
 * 200px, so 2.4x. Going wider costs real memory in the reader's browser: a decoded strip is about
 * SHEET_W * cells * SHEET_H * 4 bytes (RGBA), so a seven-cell strip at 480x270 is 2.6 MB decoded,
 * times up to sixteen live tiles on a five-column desktop grid. That is the ceiling this size was
 * chosen against. */
const SHEET_W = 480;
const SHEET_H = 270;

/* Lower than SHOT_Q's 82. A stored frame is the archive's one copy of that moment, worth bytes to
   keep faithful. A strip is a cache, rebuilt on demand whenever it goes stale, so a softer q70
   costs nothing that cannot be regenerated and cuts the bytes a scrolling wall moves. */
const SHEET_Q = 70;
/* Retention, as [frames younger than this, keep one per, the clock time the bucket aims at]. `0` in
 * the second slot keeps every frame. Applied on age, so a frame thins as it ages: every 30 min for
 * a day, three-hourly for a week, down to weekly for a year. Past the last tier it is deleted.
 * The steps give each scrubber window roughly the same count, ~50, which is under a minute at one
 * frame a second. A tier is what a range can play, so a tier twice as coarse as its window ends in
 * half the time and skips half of what happened — the week tier was 6-hourly for that reason and is
 * now 3. The first two tiers match in density while SHOT_EVERY is 30 min, and both are written out
 * because the tiers are the *policy* and the capture rate is a cap that may change.
 *
 * The third number is the **anchor**: the target time in UTC, modulo the step. A slot's target is
 * `anchor + slot * step`, and the frame kept is the last one taken *before* it. Without the anchor
 * the buckets fall on `floor(ts / step)`, which aligns to UTC midnight — at +8 that put the week on
 * 01:30, the month on 07:30 and 19:30, and the year on a Thursday. The targets nest: 16:00 is on
 * the 3-hour grid and Monday 16:00 on the 12-hour grid, so a frame keeps hitting its target as it
 * ages between tiers instead of drifting once per tier.
 * `thin()` in js/timeline.js repeats these numbers and the slot expression. Change one, change
 * both, or the ruler and the clip file one frame in two slots. */
const SHOT_TIERS = [
    [6 * 3600,     0,          0],           // 6 hours — every frame we have
    [24 * 3600,    1800,       0],           // a day   — every 30 min
    [7 * 86400,    3 * 3600,   7200],        // a week  — 01:00 MYT, then every 3 hours
    [30 * 86400,   12 * 3600,  28800],       // a month — 04:00 and 16:00 MYT
    [365 * 86400,  7 * 86400,  374400],      // a year  — Monday 16:00 MYT
];

/* --- the archive ---------------------------------------------------------------------------------
 * One directory per camera, one file per frame, named by the unix second it was captured. No index
 * table: the filename *is* the index, so listing is a scandir of ~170 entries and expiring a frame
 * is an unlink. ponytail — a `shot(camera, ts)` table in .history.db would buy a query nobody makes.
 */
function shotDir(int $id): string { return SHOTS . '/' . $id; }

/* A frame is one of two formats, so the extension is not knowable from the timestamp alone. Two
   stat calls rather than an index: at ~170 frames a camera, a manifest to keep in step with the
   directory would be one more thing that can disagree with what is actually on disk. */
const SHOT_EXT = ['webp', 'jpg'];

function shotFile(int $id, int $ts): ?string {
    foreach (SHOT_EXT as $e) if (is_file($f = shotDir($id) . "/$ts.$e")) return $f;
    return null;
}

/** Every stored frame for a camera, oldest first. */
function shotList(int $id): array {
    if ($id <= 0 || !is_dir($d = shotDir($id))) return [];
    $out = [];
    foreach (scandir($d) ?: [] as $f) if (preg_match('/^(\d+)\.(webp|jpg)$/', $f, $m)) $out[] = (int)$m[1];
    sort($out);
    return $out;
}

function sheetPath(int $id): string { return shotDir($id) . '/sheet.webp'; }

/* Build the strip for one camera, or reuse the one on disk. Returns the path, or null when there is
   nothing worth building: fewer than two frames inside CLIP_WIN (one frame is not a lap, the same
   floor the live clip and the wall apply), or no WebP encoder on this PHP. Always WebP, with no
   second-format fallback. Unlike a capture, this is never the only copy of anything, so a missing
   imagewebp means build no strip and let the callers fall back to what they do on a thin archive.
 *
 * Rebuild only when stale. A strip whose mtime is at or after the newest frame in the window
 * already shows everything that frame set can show, and re-encoding spends a decode-resize-encode
 * pass per cell to produce the same bytes. That cost lands once per camera per capture cycle, on
 * the first open after captureShots() writes a new frame. Every open before the next capture is a
 * plain file read.
 *
 * Runs from the ?sheet= handler in api.php, on request, never from captureShots(). That function
 * holds the flock on .refresh.lock the whole app depends on, and a strip build is a decode, a
 * resize and a re-encode per frame. Ninety cameras inside the lock would hold it for most of a
 * minute on every capture, which is the stampede the lock exists to prevent, in slow motion.
 * Building lazily costs at most one build per camera per thirty minutes, only for a camera someone
 * opens. */
function buildSheet(int $id, int $now): ?string {
    if (!function_exists('imagewebp')) return null;
    $cut = $now - CLIP_WIN;
    $frames = array_values(array_filter(shotList($id), fn($ts) => $ts >= $cut));
    if (count($frames) < 2) return null;

    $path = sheetPath($id);
    if (is_file($path) && filemtime($path) >= end($frames)) return $path;

    $n = count($frames);
    $canvas = imagecreatetruecolor(SHEET_W * $n, SHEET_H);
    if (!$canvas) return null;
    // A frame that fails to decode leaves its cell whatever imagecreatetruecolor() filled it with —
    // black. Nothing here paints a placeholder over it: the failure is rare (a truncated file on
    // disk) and a black cell for one frame in a lap is not worth a second code path to explain.
    foreach ($frames as $i => $ts) {
        $f = shotFile($id, $ts);
        $im = $f ? @imagecreatefromstring(file_get_contents($f)) : false;
        if (!$im) continue;
        imagecopyresampled($canvas, $im, $i * SHEET_W, 0, 0, 0, SHEET_W, SHEET_H, imagesx($im), imagesy($im));
        imagedestroy($im);
    }

    ob_start();
    imagewebp($canvas, null, SHEET_Q);
    $bytes = ob_get_clean();
    imagedestroy($canvas);
    if (!$bytes) return null;
    file_put_contents($path, $bytes);
    return $path;
}

/* How a frame gets stored: [bytes, extension], or null if the bytes are not a decodable image.
   Whichever encoding is smaller wins — see the note at the top. `imagesx` doubles as the validity
   check, so a truncated download or an HTML error page never reaches the archive. */
function encodeShot(string $raw): ?array {
    if (!($im = @imagecreatefromstring($raw))) return null;
    if (!function_exists('imagewebp')) return [$raw, 'jpg'];
    if (imagesx($im) > SHOT_W) {
        $small = imagescale($im, SHOT_W);
        imagedestroy($im);
        if (!$small) return null;
        $im = $small;
        // Downscaled: the original is a different picture now, so there is nothing to compare
        // against and the re-encode is the only candidate.
        ob_start();
        imagewebp($im, null, SHOT_Q);
        imagedestroy($im);
        return ($w = ob_get_clean()) ? [$w, 'webp'] : null;
    }
    ob_start();
    imagewebp($im, null, SHOT_Q);
    imagedestroy($im);
    $webp = ob_get_clean();
    return $webp && strlen($webp) < strlen($raw) ? [$webp, 'webp'] : [$raw, 'jpg'];
}

/* Thin one camera's archive down to SHOT_TIERS. Bucket keys carry their step, or two tiers dividing
   by different numbers land on the same integer and delete each other's frames. The slot a frame
   answers for is the **next target at or after it**, so the frame left standing is the last one
   taken before that target — the river as of 16:00, not the nearest picture to 16:00. With frames
   at 15:24 and 16:10 the nearest is 16:10, a photograph from after the moment it is labelled with.
   The list is ascending and re-setting a key does not move it, so "the last one before the target"
   is the last write winning. That is stable under repetition, which keeps this idempotent. */
function pruneShots(int $id, int $now): void {
    $keep = [];
    foreach (shotList($id) as $ts) {
        $age = $now - $ts;
        $step = $anchor = null;
        foreach (SHOT_TIERS as [$maxAge, $every, $at]) if ($age <= $maxAge) { [$step, $anchor] = [$every, $at]; break; }
        if ($step === null) { @unlink(shotFile($id, $ts)); continue; }   // past the last tier
        // intdiv(x + step - 1, step) is ceil() on positives: a frame lands on the target it precedes,
        // and a frame exactly on a target answers for that target rather than the one after it.
        $b = $step ? "$step:" . intdiv($ts - $anchor + $step - 1, $step) : "0:$ts";
        if (isset($keep[$b])) @unlink(shotFile($id, $keep[$b]));
        $keep[$b] = $ts;
    }
}

/* --- the alert tier a frame was taken under ------------------------------------------------------
 * Cameras hold a year of frames. `.history.db` holds 30 days of levels. Where the two overlap, a
 * frame scores against what the river was doing when the shutter went.
 *
 * `$assess` is api.php's own forecast function, passed in rather than copied: the past has to be
 * judged by the rule the present is judged by, or the timeline and the map disagree about one
 * river. A parameter and not an import, because this file must stay loadable by shots-test.php,
 * which has no payload, no database and no network.
 * ponytail: one seam, one parameter. If a third caller needs it, move assess() to its own file.
 *
 * Walks both lists together, so 170 frames against 1400 samples costs one pass, not 170 searches.
 */
function frameTiers(array $frames, array $samples, ?float $mark, float $riseEta, callable $assess): array
{
    $out = [];
    if (!$samples || $mark === null) return $out;
    $n = count($samples);
    $i = 0;
    foreach ($frames as $ts) {
        while ($i + 1 < $n && $samples[$i + 1][0] <= $ts) $i++;
        if ($samples[$i][0] > $ts) continue;               // the frame predates every sample
        // Observed beats forecast. A river at its mark is not "expected to reach" anything.
        if ($samples[$i][1] >= $mark) { $out[$ts] = 'now'; continue; }
        $eta  = $assess($samples, $i, $mark)[1];
        $prev = $i > 0 ? $assess($samples, $i - 1, $mark)[1] : null;
        // Both inside the cutoff: the same on-delay the live flag uses. One sample is a spike.
        if ($eta !== null && $eta <= $riseEta && $prev !== null && $prev <= $riseEta) $out[$ts] = 'soon';
    }
    return $out;
}

/* One frame per camera, at most once per SHOT_EVERY however often the payload refreshes.
   Returns how many frames were actually written. */
function captureShots(array $stations): int {
    $now = time();
    if (!is_dir(SHOTS) && !@mkdir(SHOTS, 0777, true)) return 0;
    $stamp = SHOTS . '/.last';
    if (is_file($stamp) && $now - (int)@file_get_contents($stamp) < SHOT_EVERY) return 0;
    // Claimed before the fetch, not after: a capture that dies half way must not have every
    // subsequent poll retry the whole 22 MB pull.
    @file_put_contents($stamp, $now);

    $urls = [];
    foreach ($stations as $s) {
        if ($s['kind'] !== 'camera' || empty($s['image'])) continue;
        // Same host check as ?cam=. These URLs come from our own payload, but the rule that this
        // server only ever fetches JPS is worth holding in both places rather than assumed in one.
        if (strcasecmp(parse_url($s['image'], PHP_URL_HOST) ?? '', HOST) !== 0) continue;
        $id = (int)explode('-', $s['id'])[1];
        if ($id > 0) $urls[$id] = preg_replace('#^http://#i', 'https://', $s['image']);
    }

    // Half the concurrency of the JSON fan-out: these are 250 KB each, not 2 KB, and this pass is
    // the one that could look like a scrape if it arrived all at once.
    $bodies = fetchAll($urls, 10, false);
    $written = 0;
    foreach ($urls as $id => $url) {
        pruneShots($id, $now);
        $raw = $bodies[$url] ?? '';
        if (strlen($raw) < SHOT_MIN || !($enc = encodeShot($raw))) continue;
        [$bytes, $ext] = $enc;
        if (!is_dir($dir = shotDir($id)) && !@mkdir($dir, 0777, true)) continue;
        /* Identical to the frame before means the camera has not refreshed since the last capture.
           Several stall for hours. Storing it would put a frame on the timeline that claims to be a
           new observation, and make a dead camera look like a still scene. Encoding is
           deterministic, so hashing the stored file is an exact test. */
        $have = shotList($id);
        if ($have && md5_file(shotFile($id, end($have))) === md5($bytes)) continue;
        file_put_contents("$dir/$now.$ext", $bytes);
        $written++;
    }
    return $written;
}
