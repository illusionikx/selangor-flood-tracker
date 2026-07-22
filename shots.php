<?php
// The camera archive: capture, retention and lookup. Split out of api.php the way sources.php
// is — it is the one part of the proxy with a rule complicated enough to be worth a test, and
// api.php cannot be required without running a refresh. `shots-test.php` exercises pruneShots().
//
// Needs HOST and fetchAll() from api.php; it is required from there, never on its own.

/* --- Camera archive ------------------------------------------------------------------------------
 *
 * A river level has a graph; a camera had only "now". The archive gives it the same thing — what
 * this bend looked like six hours ago, and the night before.
 *
 * Every number here is a bandwidth decision, not a preference. JPS serves these stills at 175–390 KB
 * (measured, avg ~250 KB) and there are 90 of them. Pulling all 90 on every 5-minute poll would be
 * ~6.5 GB a day taken from one government server by one address — the same shape as the stampede the
 * refresh lock exists to prevent, and the fastest way to lose access to the feed the whole page runs
 * on. So capture is decoupled from the poll: once every SHOT_EVERY, whoever happens to be refreshing.
 * That is ~1.1 GB/day, and it is the ceiling on how dense the 6-hour tier can be.
 *
 * Frames are stored at 720p, which is what JPS actually serves: every camera measured came back
 * 1280x720. So SHOT_W is the native width and nothing is normally downscaled — it exists for the day
 * a camera starts publishing something larger.
 *
 * And at that size the frame is stored as **whichever of the two encodings is smaller**, which is
 * usually the original bytes untouched. Re-encoding 1280x720 CCTV to WebP q60 measured *larger* than
 * the JPEG it came from on half the cameras (181 KB vs 165, 169 vs 153) — paying a generation loss
 * to grow the file. That is not a fact about WebP, it is a fact about noisy night-time CCTV at this
 * resolution, so the rule compares the two rather than asserting a winner: it stays right if JPS
 * changes its encoder, and it re-derives itself for free if SHOT_W is ever lowered, where the
 * re-encode does win by a wide margin.
 */
const SHOTS      = __DIR__ . '/shots';
const SHOT_EVERY = 1800;    // 30 min between captures — see above
const SHOT_W     = 1280;    // 720p — the native width of every camera measured
const SHOT_Q     = 60;
const SHOT_MIN   = 4096;    // bytes: JPS answers a dead camera with a ~2 KB placeholder, not a 404
/* Retention, as [frames younger than this, keep one per]. `0` means keep every frame. Applied on
 * age, so a frame thins itself as it gets older — kept every 30 min for a day, then six-hourly for a
 * week, and so on down to weekly for a year. Anything past the last tier is deleted.
 * The first two tiers are the same density while SHOT_EVERY is 30 min; they are both written out
 * because the tiers are the *policy* and the capture rate is a bandwidth cap that may change. */
const SHOT_TIERS = [
    [6 * 3600,     0],           // 6 hours — every frame we have
    [24 * 3600,    1800],        // a day   — every 30 min
    [7 * 86400,    6 * 3600],    // a week  — every 6 hours
    [30 * 86400,   12 * 3600],   // a month — every 12 hours
    [365 * 86400,  7 * 86400],   // a year  — weekly
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

/* Thin one camera's archive down to SHOT_TIERS. Bucket keys carry their step, because two tiers
   dividing by different numbers could otherwise land on the same integer and silently delete each
   other's frames. The list is ascending, so the newest frame in a bucket is the one left standing —
   for a 12-hour bucket that is the end of the period, which is what "what did it look like that
   evening" means. */
function pruneShots(int $id, int $now): void {
    $keep = [];
    foreach (shotList($id) as $ts) {
        $age = $now - $ts;
        $step = null;
        foreach (SHOT_TIERS as [$maxAge, $every]) if ($age <= $maxAge) { $step = $every; break; }
        if ($step === null) { @unlink(shotFile($id, $ts)); continue; }   // past the last tier
        $b = $step ? "$step:" . intdiv($ts, $step) : "0:$ts";
        if (isset($keep[$b])) @unlink(shotFile($id, $keep[$b]));
        $keep[$b] = $ts;
    }
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
        /* Identical to the frame before it means the camera has not refreshed since the last
           capture — several of them stall for hours. Storing it anyway would put a frame on the
           timeline that claims to be a new observation and is not, and would make a dead camera
           look like a still scene. Encoding is deterministic — the same source picks the same
           format and produces the same bytes — so hashing the stored file is an exact test. */
        $have = shotList($id);
        if ($have && md5_file(shotFile($id, end($have))) === md5($bytes)) continue;
        file_put_contents("$dir/$now.$ext", $bytes);
        $written++;
    }
    return $written;
}
