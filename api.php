<?php
// Proxy + cache for infobanjirjps.selangor.gov.my (no CORS headers upstream, so we fetch server-side).
// ponytail: sqlite for level history, flat file for the payload cache (one blob, nothing to query).

require_once __DIR__ . '/sources.php';   // the two scraped upstreams (national portal + KL)
require_once __DIR__ . '/shots.php';     // the camera archive: capture, retention, lookup

const API   = 'https://infobanjirjps.selangor.gov.my/JPSAPI/api/';
const TTL   = 300;   // upstream updates hourly; 5 min is plenty
const SCRAPE_TTL = 900;  // scraped HTML pages: slow to render, and updated no faster than this
// The sparkline is drawn on a real time axis, so history is windowed by clock rather than by count.
// Thinned to one point per bucket: 12h of 5-minute polls would be 144 points on every one of 106
// river stations, which is a lot of payload for a graph 300px wide.
const SPARK_WIN    = 12 * 3600;
const SPARK_BUCKET = 900;    // 15 min — 48 points across the window at most
// Rainfall buckets by the clock hour instead. `hourlyRainfall` is a rolling one-hour total, so two
// samples 15 minutes apart describe overlapping windows — drawing them as separate periods would
// show the same rain two, three, four times over.
const RAIN_BUCKET  = 3600;
// Trend is a rate of rise (m/hour), the standard hydrological measure — JPS publishes none of its
// own. It is the MEDIAN OF EVERY PAIRWISE SLOPE in the window (Theil-Sen), not a chord between two
// samples. A chord is one bad reading away from nonsense: the two-point version reported 9.61 m/h
// on Sg. Kerayong, and the archive holds 846 steps of 0.5 m or more, 63 of which reverted on the
// next sample. A median tolerates roughly 29% corrupt points and costs ~200 divisions per station.
const TREND_MIN = 600;    // 10 min — the closest two samples may be and still form a usable pair
const TREND_MAX = 10800;  // 3 h  — older than this says nothing about now
// "Rising" is not a rate, it is a forecast: at the rate it is climbing now, this station reaches its
// OWN danger mark within RISE_ETA hours. A fixed m/h can't do that job — 0.2 m/h is a quiet
// afternoon on a big river 4 m below danger, and an emergency on a drain 30 cm below it.
// The floor exists because levels are reported to the centimetre: over the shortest pair we accept,
// a single 1 cm tick is already 0.06 m/h, so anything under 0.1 is rounding.
// Measured against our own samples in calm weather, 0.05 m/h — an earlier bar — sat on the p90 of
// ordinary fluctuation and fired on 3 cm of movement, flagging ~1 station-hour in 10 as "rising".
const RISE_FLOOR = 0.10;  // m/hour — below this the rate is sensor rounding, not a climb
const RISE_ETA   = 3;     // hours to its own danger mark
// A tide is a rise. It climbs at 0.5-0.7 m/h twice a day at the gates and jetties (PINTU AIR IJOK,
// BANDAR KLANG, TELUK PENYAMUN) and reaches danger never, so extrapolating one is a daily false
// alarm. The level must therefore beat its own 24-hour high: a tide stays inside yesterday's
// envelope and a flood breaks it. And it must hold for two consecutive polls — ISA-18.2's on-delay,
// because one poll of climb was 48 on/off flips across 53 firings.
const RISE_DAY = 86400;
// Sirens report a daily heartbeat (most stamp 08:00). Two missed days is out of contact, not idle.
const SIREN_STALE = 48 * 3600;
const SITE_M = 50;   // metres — stations this close are sensors on one mast, not separate places
/* How close a sensor must be to a camera before its alert is allowed onto that camera's frames.
   js/config.js carries the same 2 for the live warning glyph. Change both together. */
const CAM_ALERT_KM = 2;
/* The lowest rainfall reading that is JPS's top class. `rainStatus()` in sources.php scores
   `> 60` as class 4, and frameTiers() compares with `>=`, so the two agree only at a value the
   feed cannot publish between. JPS reports rainfall to one decimal, so 60.1 is that value. */
const RAIN_DANGER = 60.1;
const CACHE = __DIR__ . '/.cache.json';
const LOCK  = __DIR__ . '/.refresh.lock';   // held for the length of a rebuild; see below
const HIST  = __DIR__ . '/.history.db';
const READ  = 86400;         // seconds of history loaded per poll (trend + sparkline)
const RETAIN = 30 * 86400;   // seconds kept on disk; older samples are pruned

/* A forced refresh skips the file cache, so it costs a full ~270-request fan-out at JPS. This
   button is public, so the guard is here and not in the browser. One force per minute for the
   whole site caps the worst case at ~4.5 requests a second. A cold rebuild already fires 270 in
   about three seconds, which is 90 a second. The button cannot make a burst this site does not
   already make on its own. */
const FORCE_EVERY = 60;
const FORCE_STAMP = __DIR__ . '/.force.stamp';


date_default_timezone_set('Asia/Kuala_Lumpur'); // upstream timestamps are local MYT, unlabelled

const HOST = 'infobanjirjps.selangor.gov.my';

// slope and assess live here, above the early-returning endpoints, so ?shots= can reach assess too.
// Hoisted out of the refresh path unchanged below; only the function heads moved.

/** Theil-Sen: the median of every pairwise slope in the window, in m/hour. Null if no pair spans. */
function slope(array $pts, int $at): ?float {
    $win = [];
    foreach ($pts as $p) if ($at - $p[0] >= 0 && $at - $p[0] <= TREND_MAX) $win[] = $p;
    $n = count($win);
    $sl = [];
    for ($i = 0; $i < $n; $i++) for ($j = $i + 1; $j < $n; $j++) {
        $dt = $win[$j][0] - $win[$i][0];
        if ($dt >= TREND_MIN) $sl[] = ($win[$j][1] - $win[$i][1]) / ($dt / 3600);
    }
    if (!$sl) return null;
    sort($sl);
    $m = count($sl);
    return $m % 2 ? $sl[($m - 1) / 2] : ($sl[intdiv($m, 2) - 1] + $sl[intdiv($m, 2)]) / 2;
}

/**
 * Judge one sample: returns [rate m/h, hours to $mark] with the ETA null unless it is really
 * climbing. Takes an index rather than the latest point so the previous poll can be judged by the
 * same rules — which is the whole on-delay, with nothing persisted to do it.
 */
function assess(array $pts, int $i, ?float $mark): array {
    [$at, $lvl] = $pts[$i];
    $rate = slope(array_slice($pts, 0, $i + 1), $at);
    if ($rate === null || $rate < RISE_FLOOR || $i < 2 || $mark === null) return [$rate, null];
    // Strictly higher across three samples. The old test allowed equality at both steps, so a level
    // that had not moved in five polls still counted as climbing on a rate left over from an
    // earlier step — which is exactly how a closed water gate kept reporting a 0.9 h ETA.
    if ($lvl <= $pts[$i - 2][1]) return [$rate, null];
    $day = [];
    foreach ($pts as $p) if ($p[0] < $at && $at - $p[0] <= RISE_DAY) $day[] = $p[1];
    if ($day && $lvl < max($day)) return [$rate, null];   // still inside its own daily envelope
    return [$rate, round(max(0, ($mark - $lvl) / $rate), 2)];
}

// ?cam=<id> streams a CCTV still. Upstream advertises these over plain http, which an https page
// can't load, so we fetch server-side. Only ids we already hold a URL for — never an arbitrary URL.
if (isset($_GET['cam'])) {
    $cams = is_file(CACHE) ? (json_decode(file_get_contents(CACHE), true)['stations'] ?? []) : [];
    $url = null;
    foreach ($cams as $s) {
        if ($s['kind'] === 'camera' && $s['id'] === 'camera-' . (int)$_GET['cam']) { $url = $s['image'] ?? null; break; }
    }
    if (!$url || strcasecmp(parse_url($url, PHP_URL_HOST) ?? '', HOST) !== 0) {
        http_response_code(404);
        exit;
    }
    /* curl, never file_get_contents. JPS publishes two A records for this host and one of them
       (58.27.97.62) blackholes SYNs. curl races both and lands on the live one in ~10ms; PHP's
       stream wrapper tries addresses serially with no connect timeout of its own, so it sat out
       Windows' full 21s TCP timeout on roughly every other still — and the http fallback below
       made a bad draw 42s. Every other upstream call here already goes through fetchAll, which is
       the only reason this was the sole slow endpoint.
       Prefer TLS to upstream; fall back to what it actually advertised. */
    $try = fn($u) => fetchAll([$u], 1, false)[$u] ?? '';
    $img = $try(preg_replace('#^http://#i', 'https://', $url)) ?: $try($url);
    if ($img === '') { http_response_code(502); exit; }
    header('Content-Type: image/jpeg');
    /* 300s = POLL_MS in js/config.js, and the two must move together. A still cannot change faster
       than the payload that names it, so a shorter life buys nothing and costs a real request at
       JPS. It costs one per open card per lifetime: js/clip.js re-sets this src on every ~7s lap,
       and at 60s an open camera card sent a request a minute to the agency. Cards are opened most
       during a flood, which is when those servers can take it least. */
    header('Cache-Control: max-age=300');
    echo $img;
    exit;
}

/* ?shots=<id> — which frames exist, and what the river beside the camera was doing when each one
   was taken. The client asks once, when a lightbox opens, and again when a camera card opens.
   Shape is [[ts, tier, stationId], …]. `tier` is "now", "soon" or null.
   Rivers, gauges, sirens and rainfall, each against its own mark — the same four kinds the live
   warning glyph on a camera picture can name, so the picture and the strip under it agree whichever
   frame is on screen. Only the river gets `soon`, because only the river has a rate to project.
   Two things leave a tier null, and both show as an uncolored tick rather than a wrong one: the
   frame is older than the 30 days of levels we keep, or nothing with a mark sits within
   CAM_ALERT_KM. */
if (isset($_GET['shots'])) {
    header('Content-Type: application/json');
    header('Cache-Control: max-age=60');
    $id     = (int)$_GET['shots'];
    $frames = shotList($id);
    $rows   = array_map(fn($ts) => [$ts, null, null], $frames);

    $st  = is_file(CACHE) ? (json_decode(file_get_contents(CACHE), true)['stations'] ?? []) : [];
    $cam = null;
    foreach ($st as $s) if ($s['kind'] === 'camera' && $s['id'] === 'camera-' . $id) { $cam = $s; break; }

    if ($cam && $frames && is_file(HIST)) {
        $km = function (array $a, array $b): float {
            $x = ($a['lat'] - $b['lat']) * 111;
            $y = ($a['lng'] - $b['lng']) * 111 * cos(deg2rad($a['lat']));
            return sqrt($x * $x + $y * $y);
        };
        try {
            // Read-only. This connection must never be able to write .history.db, and a read-write
            // handle that is the last one open checkpoints the WAL on close.
            $db = new PDO('sqlite:' . HIST, null, null, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::SQLITE_ATTR_OPEN_FLAGS => PDO::SQLITE_OPEN_READONLY,
            ]);
            // Start a day before the first frame. assess() looks back RISE_DAY for the tide guard, so
            // a frame near the window's start needs that much history too, or the guard runs short.
            $sel = $db->prepare('SELECT ts, level FROM level WHERE station = ? AND ts >= ? ORDER BY ts');
            $best = [];   // frameTs => [rank, tier, stationId, distKm] — see the tie-break note below
            foreach ($st as $r) {
                /* Each kind against its own mark. A river and a gauge publish one; a siren is 0 or 1
                   in this table and 1 is the whole of "sounding"; rainfall is scored on JPS's own
                   class boundary. Anything else — a camera — has nothing to score. */
                $mark = match ($r['kind']) {
                    'river', 'gauge' => empty($r['danger']) ? null : (float)$r['danger'],
                    'siren'          => 1.0,
                    'rainfall'       => RAIN_DANGER,
                    default          => null,
                };
                if ($mark === null) continue;
                $d = $km($cam, $r);
                if ($d > CAM_ALERT_KM) continue;
                $sel->execute([$r['id'], $frames[0] - RISE_DAY]);
                $samples = array_map(fn($x) => [(int)$x['ts'], (float)$x['level']], $sel->fetchAll(PDO::FETCH_ASSOC));
                /* Only a river carries a forecast. Standing water, a sounding siren and rain falling
                   now are observed states with no rate to project — so those three are handed an
                   assess that never answers, which is what turns the `soon` half of frameTiers off.
                   The same split the live path makes: `isHot()` forecasts rivers and nothing else. */
                $tiers = $r['kind'] === 'river'
                    ? frameTiers($frames, $samples, $mark, RISE_ETA, 'assess')
                    : frameTiers($frames, $samples, $mark, 0, fn() => [null, null]);
                foreach ($tiers as $ts => $t) {
                    $rank = $t === 'now' ? 0 : 1;
                    /* Worse tier wins first. Nearer river breaks a tie. camAlert() in js/stations.js
                       ranks a camera's live glyph the same way. The two must agree, or a reader can
                       ignore the river named on screen and the frame's tick stays colored, because
                       the server named the other river in range. */
                    if (!isset($best[$ts]) || $rank < $best[$ts][0]
                        || ($rank === $best[$ts][0] && $d < $best[$ts][3])) {
                        $best[$ts] = [$rank, $t, $r['id'], $d];
                    }
                }
            }
            /* Only the worst-tier station rides along, so the client can drop a tick raised by a sensor
               the reader has ignored. It falls to uncolored rather than to the second-worst river.
               ponytail: two hot rivers within 2 km of one camera is rare. Build the fallback if it is
               not, which means sending a tier per station and letting the client pick. */
            foreach ($rows as $k => $row) {
                if (isset($best[$row[0]])) $rows[$k] = [$row[0], $best[$row[0]][1], $best[$row[0]][2]];
            }
        } catch (\Throwable $e) {
            // A broken read must not become a cached 200 with a fatal-error body. Fall back to the
            // plain frame list. The client already renders null tiers as an uncolored strip.
            $rows = array_map(fn($ts) => [$ts, null, null], $frames);
        }
    }
    echo json_encode($rows);
    exit;
}

/* ?shot=<id>&t=<unix> — one stored frame. Both parameters are cast to int before they touch the
   filesystem, so the path cannot be steered outside SHOTS: the same rule as ?cam=, which never
   proxies a URL it was handed. A stored frame never changes, so it is immutable for a year. */
if (isset($_GET['shot'])) {
    $id = (int)$_GET['shot'];
    $t  = (int)($_GET['t'] ?? 0);
    $f  = $id > 0 && $t > 0 ? shotFile($id, $t) : null;
    if (!$f) { http_response_code(404); exit; }
    // A frame is stored in whichever format was smaller, so the type comes off the file we found.
    header('Content-Type: ' . (str_ends_with($f, '.webp') ? 'image/webp' : 'image/jpeg'));
    header('Cache-Control: public, max-age=31536000, immutable');
    readfile($f);
    exit;
}

/**
 * May a forced refresh run now?
 *
 * @param int      $now       unix seconds
 * @param int|null $lastForce mtime of FORCE_STAMP, or null when no force has ever run
 * @return array{0: bool, 1: string} allowed, and why
 */
function forceAllowed(int $now, ?int $lastForce, int $window = FORCE_EVERY): array {
    if ($lastForce === null) return [true, 'first'];
    $since = $now - $lastForce;
    // A stamp in the future means a clock moved, not that someone forced a refresh in the future.
    // Refusing until it catches up would disable the button for as long as the skew lasts.
    if ($since < 0) return [true, 'clock moved'];
    return $since >= $window ? [true, 'ok'] : [false, 'rate limited'];
}

/**
 * Serve the cache instead of rebuilding? This one expression decides whether a request reaches JPS
 * at all, so the self-check exercises it directly rather than through a 270-request fan-out.
 */
function serveFromCache(int $age, bool $mine, bool $force): bool {
    return ($age < TTL && !$force) || !$mine;
}

/* `php api.php --selftest` — the guard above, checked offline. It lives here rather than in a
   second test file because the rule is arithmetic on two integers, and a separate test would need
   a third file to hold the function so both could import it. CLI only, and it exits before the
   first header. */
if (PHP_SAPI === 'cli' && in_array('--selftest', $argv ?? [], true)) {
    $fail = 0;
    $ok = function (string $what, bool $pass) use (&$fail) {
        if (!$pass) $fail++;
        echo ($pass ? '  ok   ' : '  FAIL ') . $what . "\n";
    };
    $now = 1800000000;

    echo "forceAllowed():\n";
    $ok('no stamp at all is allowed',            forceAllowed($now, null)[0] === true);
    $ok('a stamp 61s old is allowed',            forceAllowed($now, $now - 61)[0] === true);
    $ok('a stamp exactly 60s old is allowed',    forceAllowed($now, $now - 60)[0] === true);
    $ok('a stamp 59s old is refused',            forceAllowed($now, $now - 59)[0] === false);
    $ok('a stamp from this second is refused',   forceAllowed($now, $now)[0] === false);
    $ok('a refusal says why',                    forceAllowed($now, $now)[1] === 'rate limited');
    /* A stamp in the future would otherwise lock the button out until the clock caught up. Same
       hazard readTs() already guards against on a JPS reading, for the same reason: a clock we do
       not own moved. */
    $ok('a stamp from the future is allowed',    forceAllowed($now, $now + 3600)[0] === true);
    $ok('the window is honored when passed',     forceAllowed($now, $now - 10, 5)[0] === true);

    echo "\nserveFromCache():\n";
    $ok('a fresh cache is served',                 serveFromCache(10, true, false) === true);
    $ok('a force rebuilds a fresh cache',          serveFromCache(10, true, true) === false);
    $ok('a force that lost the lock is served',    serveFromCache(10, false, true) === true);
    $ok('a stale cache rebuilds',                  serveFromCache(TTL + 1, true, false) === false);
    $ok('a cache at exactly TTL rebuilds',         serveFromCache(TTL, true, false) === false);
    $ok('a stale cache that lost the lock waits',  serveFromCache(TTL + 1, false, false) === true);
    $ok('a forced loser never rebuilds',           serveFromCache(TTL + 1, false, true) === true);

    echo $fail ? "\n$fail FAILED\n" : "\nall ok\n";
    exit($fail ? 1 : 0);
}

header('Content-Type: application/json');
$t0 = microtime(true);

/** Age from when the payload was actually fetched — mtime doubles as a lock and gets touched. */
function cachedPayload(): array {
    $j = json_decode(@file_get_contents(CACHE), true) ?: [];
    /* `forced` and `forceWhy` describe the request that built this file, not the request reading
       it. PHP's array + is left-biased, so the defaults must sit on the LEFT to beat whatever the
       file holds. Every cached read passes through this function, on every exit, so no exit can
       replay a stale value again. */
    return ['forced' => false, 'forceWhy' => null] + $j
         + ['cacheAge' => max(0, time() - strtotime($j['fetched'] ?? 'now'))];
}

function serveCache(array $extra = []): never {
    // $extra is left-biased, so an explicit refusal passed in here still overrides. The defaults
    // for an ordinary poll live in cachedPayload() now, since every exit reads through it.
    echo json_encode($extra + cachedPayload(), JSON_UNESCAPED_SLASHES);
    exit;
}

/* Exactly one rebuild may be in flight at a time, process-wide.
 *
 * A cold rebuild fans out ~270 concurrent requests at JPS. Two visitors arriving on an expired
 * cache is 540, three is 810 — which is not a busy site, it is the shape of a flood from one
 * address, and the fastest way to have this server's IP blocked by the agency whose data the whole
 * page depends on. The window is real and not small: the rebuild takes ~3.5s warm and ~15s cold,
 * and every open tab polls on its own 5-minute timer, so their misses land wherever they land.
 *
 * `touch(CACHE)` used to claim the refresh, but only inside the `fastcgi_finish_request` branch —
 * and Herd's SAPI is `cgi-fcgi`, which does not have that function. So on the machine this actually
 * runs on, nothing claimed anything and every concurrent miss stampeded. A lock file is the fix
 * that does not depend on the SAPI.
 *
 * The loser of the race serves the stale payload rather than waiting: it is at most one poll old,
 * and a caller holding a connection open for 15s to receive data it already has is worse for
 * everyone than data that is five minutes stale. */
$lock = fopen(LOCK, 'c');
$mine = $lock && flock($lock, LOCK_EX | LOCK_NB);

/* The Developer section's "Refresh now". It expires the *file* cache and nothing else — the scraped
   pages keep their own 15-minute cache in the `page` table. The KL rainfall table takes about ten
   seconds upstream. Re-scraping it would triple the cost of one button press.
   It is not a second refresh path. It falls into the same lock. A loser still serves stale cache
   rather than queueing.
   GET only, because a cache-busting side effect does not belong on a method that is not idempotent.
   This does not stop a prefetch, which issues a GET like any other read. The rate limit does. */
$asked = ($_GET['force'] ?? '') === '1';
$force = $asked && ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET';
$forceWhy = $asked && !$force ? 'not a GET' : '';
if ($force) {
    [$allowed, $forceWhy] = forceAllowed(time(), is_file(FORCE_STAMP) ? filemtime(FORCE_STAMP) : null);
    if (!$allowed) $force = false;
}

if (is_file(CACHE)) {
    $age = time() - filemtime(CACHE);
    if (serveFromCache($age, $mine, $force)) {
        /* Name the reason that actually stopped this force, most specific first. A request refused
           before the lock knows why. One that reached the lock and lost does not. */
        $why = !$asked ? ''
             : (!$force ? $forceWhy
             : (!$mine  ? 'another refresh is running'
                        : 'cache is fresh'));
        serveCache($asked ? ['forced' => false, 'forceWhy' => $why] : []);
    }
    /* The stamp is spent here and not above, so a force the lock turned away keeps its budget.
       No fan-out happened, so charging it a minute would be charging it for nothing. */
    if ($force) touch(FORCE_STAMP);
    // One upstream table takes ~10s to render, so blocking the page on the refresh would mean a
    // blank map for that long. Hand back the stale payload immediately, then refresh with the
    // connection already closed.
    // A force is the one exception. Stale-while-revalidate suits an ordinary poll, because nobody
    // asked to see the rebuild. Refresh now exists so a reader can see what the rebuild produced,
    // so a forced request must wait in the foreground and get the real payload back.
    if (!$force && function_exists('fastcgi_finish_request')) {
        echo json_encode(cachedPayload(), JSON_UNESCAPED_SLASHES);
        fastcgi_finish_request();
        ignore_user_abort(true);
    }
    // CLI (and any SAPI without that call) just falls through and refreshes in the foreground.
} elseif (!$mine) {
    // True cold start with nothing to serve. Waiting is the only honest option — but wait on the
    // lock, so the arrivals queue behind one rebuild instead of each starting their own.
    flock($lock, LOCK_EX);
    if (is_file(CACHE)) serveCache();   // the winner finished while we waited; use what it wrote
}

/**
 * The last SPARK_WIN of samples, one per bucket, as [ts, level]. Keeping the newest sample in each
 * bucket rather than averaging: this is a level graph, and an average would smooth away exactly the
 * short sharp rise the graph exists to show.
 *
 * $peak keeps the highest value in the bucket instead of the newest — for sirens, where the samples
 * are 0/1 and a trigger that stopped inside one bucket is the single thing the graph exists to show.
 *
 * $score, where a kind has one, appends the status that sample was at: [ts, value, code]. The hover
 * readout on the graph colours itself by it and marks anything at the warning rung or above. It is
 * scored HERE and not in the browser for the same reason the live reading is — there is one
 * definition of a status in this app and it is this file's, through the same wlStatus()/rainStatus()
 * the feeds themselves go through. A client comparing a historical value to the marks beside it
 * would be a second definition, and the second one is always the one that drifts.
 * Kinds without a scorer keep the two-element shape, and every reader destructures [ts, value], so
 * the extra element is invisible to all of them.
 */
function sparkPoints(array $points, int $now, int $bucket = SPARK_BUCKET, bool $peak = false,
                     ?callable $score = null): array {
    $out = [];
    foreach ($points as [$ts, $v]) {
        if ($now - $ts > SPARK_WIN) continue;
        $b = intdiv($ts, $bucket);
        if ($peak && isset($out[$b]) && $out[$b][1] >= $v) continue;
        $r = round($v, 3);
        $out[$b] = $score ? [$ts, $r, $score($r)] : [$ts, $r];
    }
    ksort($out);
    return array_values($out);
}

/**
 * The timestamp a reading was taken, not the one we happened to poll on.
 *
 * These two are not the same clock and the gap is not small. Upstream changes a value every ~25 min
 * (median, measured over the archive) and we poll every ~8.5 min, so a level is a staircase: the
 * same number comes back four or five times, and storing each arrival at `now` puts the step at our
 * poll rather than at the measurement. Both ends of a rate then carry up to a poll interval of
 * error, which over a short baseline is a rate wrong by more than 100% — the source of every
 * phantom climb on a station whose level had not moved in five polls.
 *
 * Using the reading's own stamp also makes the (station, ts) primary key do real work: a repeated
 * reading is one row, not five. JPS stamps a reading to the UPCOMING slot (17:45 at 17:36), so a
 * stamp in the future is normal and is pulled back to now rather than treated as an error.
 */
function readTs(?string $updated, int $now): int {
    $d = $updated ? DateTime::createFromFormat('d/m/Y H:i:s', $updated) : false;
    return $d ? min($now, $d->getTimestamp()) : $now;
}

/** Fetch many URLs concurrently. Returns [url => decoded|null], or [url => body] when $json is off. */
function fetchAll(array $urls, int $concurrency = 20, bool $json = true): array {
    $mh = curl_multi_init();
    $out = $handles = [];
    $queue = array_values($urls);
    $add = function () use (&$queue, &$handles, $mh) {
        if (!$queue) return;
        $url = array_shift($queue);
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 25,
            // Contact URL in the UA: this box pulls ~1.1 GB/day off JPS from one residential IP,
            // which is the most conspicuous shape a web log has. Better their sysadmin can read
            // what it is than have to guess. Identifying yourself is the polite form and the safe
            // one; spoofing it would be neither.
            CURLOPT_USERAGENT      => 'flood-exp/1.0 (+https://github.com/illusionikx/selangor-flood-tracker)',
            CURLOPT_FOLLOWLOCATION => true,   // the national portal 301s to its canonical path
            CURLOPT_MAXREDIRS      => 3,
        ]);
        curl_multi_add_handle($mh, $ch);
        $handles[(int)$ch] = $url;
    };
    for ($i = 0; $i < $concurrency; $i++) $add();

    do {
        curl_multi_exec($mh, $running);
        curl_multi_select($mh, 0.5);
        while ($info = curl_multi_info_read($mh)) {
            $ch = $info['handle'];
            $body = curl_multi_getcontent($ch);
            $out[$handles[(int)$ch]] = $json ? json_decode($body, true) : $body;
            curl_multi_remove_handle($mh, $ch);
            curl_close($ch);
            $add();
            $running = 1; // keep looping while the queue drains
        }
    } while ($running > 0 || $queue);

    curl_multi_close($mh);
    return $out;
}


$lists = fetchAll([
    'rainfall' => API . 'StationRainfalls',
    'river'    => API . 'StationRiverLevels',
    'siren'    => API . 'StationSirens',
    'gauge'    => API . 'StationFloodGauges',
    'camera'   => API . 'CCTVS',
    'hotspot'  => API . 'Hotspots/GetHotspots',
]);
$get = fn($k) => $lists[API . $k] ?? [];

$rainfallList = $get('StationRainfalls');
$riverList    = $get('StationRiverLevels');

if (!$rainfallList && !$riverList) {
    // Upstream is down: serve the last good payload rather than a blank map, and say so.
    if (is_file(CACHE)) serveCache(['upstreamOk' => false, 'error' => 'upstream unreachable']);
    http_response_code(502);
    echo json_encode(['upstreamOk' => false, 'error' => 'upstream unreachable']);
    exit;
}

// Detail calls carry the actual mm / metres. Lists only carry status codes.
$detailUrls = [];
foreach ($rainfallList as $s) $detailUrls["rf-{$s['stationId']}"] = API . 'StationRainfalls/' . $s['stationId'];
foreach ($riverList as $s)    $detailUrls["wl-{$s['stationId']}"] = API . 'StationRiverLevels/' . $s['stationId'];
foreach ($get('CCTVS') as $s) $detailUrls["cam-{$s['stationId']}"] = API . 'CCTVS/' . $s['stationId'];
// Sirens are fetched purely for `statusLastUpdate`; the list carries no timestamp of any kind.
foreach ($get('StationSirens') as $s) $detailUrls["sn-{$s['stationId']}"] = API . 'StationSirens/' . $s['stationId'];
foreach ($get('StationFloodGauges') as $s) $detailUrls["fg-{$s['stationId']}"] = API . 'StationFloodGauges/' . $s['stationId'];
$now = time();

// Level history lives in sqlite (pdo_sqlite ships with PHP, so still no dependencies). The payload
// cache stays a flat file: it is one blob, always written and read whole, with nothing to query.
$db = new PDO('sqlite:' . HIST, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$db->exec('PRAGMA journal_mode=WAL');  // two concurrent cold refreshes no longer lose each other's samples
$db->exec('CREATE TABLE IF NOT EXISTS level (
    station TEXT    NOT NULL,
    ts      INTEGER NOT NULL,
    level   REAL    NOT NULL,
    PRIMARY KEY (station, ts)
) WITHOUT ROWID');  // the key also makes a retried poll idempotent — INSERT OR IGNORE and move on
$db->exec('CREATE TABLE IF NOT EXISTS page (url TEXT PRIMARY KEY, ts INTEGER, body TEXT) WITHOUT ROWID');

// The scraped pages ride along in the same concurrent batch, but on their own clock: the KL rainfall
// table takes ~10s to render upstream, against ~0.3s for a JSON call, and none of these sources
// updates faster than a quarter hour. Refetching them every 5 minutes would triple the cost of a
// poll for data that cannot have changed. A page that fails to fetch falls back to the last copy we
// stored — a slow upstream should cost freshness, never a whole region's worth of pins.
$extraUrls = nationalUrls() + klUrls();
$stored = [];
foreach ($db->query('SELECT url, ts, body FROM page') as $r) $stored[$r['url']] = $r;
$want = array_filter($extraUrls, fn($u) => ($stored[$u]['ts'] ?? 0) < $now - SCRAPE_TTL);

$raw = fetchAll($detailUrls + $want, 20, false);
$details = [];
foreach ($detailUrls as $u) $details[$u] = json_decode($raw[$u] ?? '', true);

$keep = $db->prepare('INSERT OR REPLACE INTO page (url, ts, body) VALUES (?, ?, ?)');
$pages = [];
foreach ($extraUrls as $k => $u) {
    $body = $raw[$u] ?? '';
    if ($body !== '') $keep->execute([$u, $now, $body]);
    $pages[$k] = $body !== '' ? $body : ($stored[$u]['body'] ?? '');
}
$page = fn(string $k) => $pages[$k] ?? '';

// One-off carry-over from the flat file, so trends survive the switch instead of going null for an
// hour. Deletes itself; drop this block once no deployment has a .history.json left.
if (is_file($old = __DIR__ . '/.history.json')) {
    $ins = $db->prepare('INSERT OR IGNORE INTO level (station, ts, level) VALUES (?, ?, ?)');
    $db->beginTransaction();
    foreach (json_decode(file_get_contents($old), true) ?: [] as $k => $points) {
        foreach ($points as $p) $ins->execute([$k, $p[0], $p[1]]);
    }
    $db->commit();
    unlink($old);
}

$hist = [];
foreach ($db->query('SELECT station, ts, level FROM level WHERE ts >= ' . ($now - READ) . ' ORDER BY ts') as $r) {
    $hist[$r['station']][] = [(int)$r['ts'], (float)$r['level']];
}
$samples = [];

$stations = [];

foreach ($rainfallList as $s) {
    $d = $details[API . 'StationRainfalls/' . $s['stationId']] ?? [];
    $stations[] = [
        'kind'     => 'rainfall',
        'id'       => 'rf-' . $s['stationId'],
        'name'     => $s['stationName'],
        'district' => $s['districtName'],
        'basin'    => $s['mainRiverBasin'],
        'lat'      => (float)$s['latitude'],
        'lng'      => (float)$s['longitude'],
        // -1 none .. 4 very heavy. The list publishes -1 on stations that are reporting a real
        // number — 144 of 233 rain gauges — so where there is a reading, the class comes from the
        // same rainStatus() the two scraped feeds already go through. See the note above the river
        // block below: one definition of a status, and it is this file's.
        'status'   => (int)$s['status'] < 0 && isset($d['hourlyRainfall'])
                        ? rainStatus((float)$d['hourlyRainfall']) : (int)$s['status'],
        'online'   => (int)$s['stationStatus'] === 1,
        'code'     => $s['station_Id'] ?? null,   // national JPS code — the key the other feeds share
        'source'   => 'selangor',
        'hourly'   => $d['hourlyRainfall']     ?? null,
        'daily'    => $d['dailyRainfall']      ?? null,
        'updated'  => $d['statusLastUpdate']   ?? null,
    ];
}

foreach ($riverList as $s) {
    $d   = $details[API . 'StationRiverLevels/' . $s['stationId']] ?? [];
    $key = 'wl-' . $s['stationId'];
    $lvl = isset($d['waterLevel1']) ? (float)$d['waterLevel1'] : null;

    $danger = $d['wL1SPDanger'] ?? null;
    $stations[] = [
        'kind'     => 'river',
        'id'       => $key,
        'name'     => $s['stationName'],
        'district' => $s['districtName'],
        'basin'    => $s['mainRiverBasin'],
        'lat'      => (float)$s['latitude'],
        'lng'      => (float)$s['longitude'],
        /* -1 offline, 0 normal, 1 alert, 2 warning, 3 danger. The list carries -1 on 15 stations
           that are online and reporting a level, so where there is a reading and a mark to measure
           it against, the code comes from wlStatus() — the same function the national portal's rows
           already go through, for the same reason: a status the reader can check against the number
           printed beside it beats one the feed asserts and the number contradicts. */
        'status'   => (int)$s['wL1Status'] < 0 && $lvl !== null
          ? wlStatus($lvl, $d['wL1SPAlert'] ?? null, $d['wL1SPWarning'] ?? null, $danger)
          : (int)$s['wL1Status'],
        'online'   => (int)$s['stationStatus'] === 1,
        'level'    => $lvl,
        'alert'    => $d['wL1SPAlert']  ?? null,
        'warning'  => $d['wL1SPWarning'] ?? null,
        'danger'   => $danger,
        'code'     => $s['station_Id'] ?? null,
        'source'   => 'selangor',
        'updated'  => $d['waterLevel1LastUpdate'] ?? null,
    ];
}

foreach ([['siren', 'StationSirens'], ['gauge', 'StationFloodGauges'], ['camera', 'CCTVS']] as [$kind, $ep]) {
    foreach ($get($ep) as $s) {
        $cam = $kind === 'camera' ? ($details[API . 'CCTVS/' . $s['stationId']] ?? []) : [];
        // Gauges report flood depth over the marked spot: negative is dry ground.
        $fg  = $kind === 'gauge' ? ($details[API . 'StationFloodGauges/' . $s['stationId']] ?? []) : [];
        // Siren detail exists only for the timestamp — the list says a siren is "online" forever,
        // including ones that last reported over a year ago.
        $sn  = $kind === 'siren' ? ($details[API . 'StationSirens/' . $s['stationId']] ?? []) : [];
        $updated = $fg['statusLastUpdate'] ?? $sn['statusLastUpdate'] ?? null;

        // A siren that hasn't checked in for two of its daily heartbeats is not idle, it is out of
        // contact — and "IDLE" on a dead siren is the most dangerous thing this map could print.
        // No timestamp at all is left alone: that is missing evidence, not evidence of failure.
        $stale = $kind === 'siren' && $updated
              && ($t = DateTime::createFromFormat('d/m/Y H:i:s', $updated))
              && $now - $t->getTimestamp() > SIREN_STALE;

        $stations[] = [
            'image'    => $cam['imageUrl'] ?? null,
            'shot'     => isset($cam['lastUpdate']) ? date('d/m/Y H:i:s', strtotime($cam['lastUpdate'])) : null,
            'depth'    => $fg['floodLevel'] ?? null,
            'warning'  => $fg['spWarning']  ?? null,
            'danger'   => $fg['spDanger']   ?? null,
            'kind'     => $kind,
            'id'       => $kind . '-' . $s['stationId'],
            'name'     => trim($s['stationName']),
            'district' => $s['districtName'],
            'basin'    => $s['mainRiverBasin'],
            'lat'      => (float)$s['latitude'],
            'lng'      => (float)$s['longitude'],
            'status'   => (int)($fg['status'] ?? $s['status'] ?? 0),
            'online'   => !$stale && (bool)($s['isOnline'] ?? ((int)($s['stationStatus'] ?? 0) === 1)),
            'reading'  => $s['lastReading'] ?? null,
            'source'   => 'selangor',
            'updated'  => $updated,
        ];
    }
}

/** SPHTN covers two federal territories and labels neither; only Putrajaya names itself. */
function klState(?string $district): string {
    return stripos($district ?? '', 'putrajaya') !== false ? 'Putrajaya' : 'Kuala Lumpur';
}

// --- KL (SPHTN) ------------------------------------------------------------------------------
// Adds Kuala Lumpur, which the Selangor API does not cover. Its catchment reaches into Selangor, so
// some of its stations are ones we already hold: same mast, different id space (the two feeds share
// no station codes at all), which is why the de-duplication is by position rather than by key.
$kl = klStations(['kl-wl' => $page('kl-wl'), 'kl-rf' => $page('kl-rf')]);
$klAdded = $klDupes = 0;
foreach ($kl as $s) {
    foreach ($stations as $have) {
        if ($have['kind'] === $s['kind'] && abs($have['lat'] - $s['lat']) < 0.002
                                         && abs($have['lng'] - $s['lng']) < 0.002) {
            $klDupes++;
            continue 2;   // ~200 m apart and the same kind: one mast, and we already have it
        }
    }
    $klAdded++;
    $stations[] = $s['kind'] === 'river' ? [
        'kind' => 'river', 'id' => 'kl-wl-' . $s['code'], 'name' => $s['name'],
        'district' => $s['district'], 'basin' => $s['basin'], 'lat' => $s['lat'], 'lng' => $s['lng'],
        'status' => wlStatus($s['level'], $s['alert'], $s['warning'], $s['danger']),
        'online' => $s['level'] !== null,
        'level' => $s['level'], 'alert' => $s['alert'], 'warning' => $s['warning'], 'danger' => $s['danger'],
        'code' => $s['code'], 'source' => 'kl', 'state' => klState($s['district']),
        'srcTrend' => $s['srcTrend'], 'updated' => $s['updated'],
    ] : [
        'kind' => 'rainfall', 'id' => 'kl-rf-' . $s['code'], 'name' => $s['name'],
        'district' => $s['district'], 'basin' => null, 'lat' => $s['lat'], 'lng' => $s['lng'],
        'status' => rainStatus($s['hourly']), 'online' => $s['hourly'] !== null,
        'hourly' => $s['hourly'], 'daily' => $s['daily'],
        'code' => $s['code'], 'source' => 'kl', 'state' => klState($s['district']),
        'updated' => $s['updated'],
    ];
}

// --- National portal -------------------------------------------------------------------------
// Authoritative per the operator's call, so its reading and thresholds win wherever the station code
// matches — at the cost of up to 30 min more lag than the state feeds, which is the trade we chose.
// It publishes no coordinates, so it can only ever correct a station another feed already placed;
// the ones it alone knows about are counted and dropped rather than pinned at a guessed location.
$nat = nationalLevels(array_map($page, array_keys(nationalUrls())));
$natUsed = [];
foreach ($stations as &$s) {
    $n = ($s['kind'] === 'river' && $s['code']) ? ($nat[$s['code']] ?? null) : null;
    if (!$n || $n['level'] === null) continue;
    $natUsed[$s['code']] = true;
    $s['level']   = $n['level'];
    $s['alert']   = $n['alert']   ?? $s['alert'];
    $s['warning'] = $n['warning'] ?? $s['warning'];
    $s['danger']  = $n['danger']  ?? $s['danger'];
    $s['updated'] = $n['updated'] ?? $s['updated'];
    $s['online']  = true;
    // The portal publishes values, not a status code, so status is re-derived from its own
    // thresholds — mixing its level with the state feed's status code would let the two disagree.
    $s['status']  = wlStatus($s['level'], $s['alert'], $s['warning'], $s['danger']);
    $s['source']  = 'national';
}
unset($s);

// --- Rainfall history --------------------------------------------------------------------------
// Rain now is the river's rise in an hour, so this is the earlier signal of the two — worth keeping
// even though nothing computes a trend from it. Same table, same window; only the bucket differs.
foreach ($stations as &$s) {
    if ($s['kind'] !== 'rainfall' || !isset($s['hourly'])) continue;
    $key = $s['id'];
    $ts  = readTs($s['updated'] ?? null, $now);
    $s['history'] = sparkPoints(
        array_merge($hist[$key] ?? [], [[$ts, (float)$s['hourly']]]), $now, RAIN_BUCKET,
        false, fn($v) => rainStatus($v));
    $samples[$key] = [$ts, (float)$s['hourly']];
}
unset($s);

// --- Gauge history -----------------------------------------------------------------------------
// Depth over a flood-prone spot is a level like any other, so it gets the same table, window and
// bucket as a river — a line between two readings is honest here, the water really was somewhere in
// between. No trend or ETA off it though: the thresholds are 0.15 m and 0.3 m, and a rate computed
// against numbers that small from a sensor rounding to centimetres would be mostly noise. The graph
// answers the question a gauge is actually asked — is this spot filling or draining.
foreach ($stations as &$s) {
    // Offline gauges are frozen on old flood readings — several still hold April's 3.55 m. Sampling
    // one every poll would draw a flat line at a number from months ago, which is the one thing a
    // graph of it must not do: a straight line reads as "steady", not as "nobody is listening".
    if ($s['kind'] !== 'gauge' || !isset($s['depth']) || !$s['online']) continue;
    $key = $s['id'];
    $ts  = readTs($s['updated'] ?? null, $now);
    $hist[$key] = array_merge($hist[$key] ?? [], [[$ts, (float)$s['depth']]]);
    $s['history'] = sparkPoints($hist[$key], $now, SPARK_BUCKET, false,
        fn($v) => gaugeStatus($v, $s['warning'] ?? null, $s['danger'] ?? null));
    $samples[$key] = [$ts, (float)$s['depth']];
}
unset($s);

// --- Siren history -------------------------------------------------------------------------------
// A siren is 0 or 1, so this is a log, not a trend — the popup draws it as a band, never a line.
// Worth keeping anyway: "silent for the last 12 hours" is the answer a siren pin is opened for, and
// until now the only evidence for it was a heartbeat timestamp. Out-of-contact sirens are skipped
// for the same reason offline gauges are — a flat IDLE band from a sensor nobody can hear is a lie.
// ponytail: full-resolution samples like every other kind; bucket to the hour if the table bloats.
foreach ($stations as &$s) {
    if ($s['kind'] !== 'siren' || !$s['online']) continue;
    $key = $s['id'];
    $ts  = readTs($s['updated'] ?? null, $now);
    $hist[$key] = array_merge($hist[$key] ?? [], [[$ts, (float)$s['status']]]);
    $s['history'] = sparkPoints($hist[$key], $now, SPARK_BUCKET, true);
    $samples[$key] = [$ts, (float)$s['status']];
}
unset($s);

// --- Sites -------------------------------------------------------------------------------------
// A rainfall gauge, a river gauge and sometimes a camera share one mast, and every feed publishes
// them as separate stations at the same coordinates — 113 coordinate pairs hold two or more, and
// another 46 pairs sit a few metres apart because two feeds typed the same mast slightly
// differently. They are one place, so they get one `site` key and the map draws one pin.
//
// Grouped greedily in build order, so the first station at a spot defines it. Measured on the live
// set (671 placed stations): 0 m leaves 546 pins, 25 m leaves 435, 50 m leaves 417, and past that it
// crawls — 414 at 75 m, 408 at 100 m — until 200 m starts swallowing genuinely separate
// installations. The distribution is bimodal: sensors are either bolted to one mast or hundreds of
// metres apart, so almost everything worth merging is already inside 25 m. 50 m buys the 18 masts
// that straddle a river or sit at opposite ends of one compound, and nothing else.
$sites = [];
foreach ($stations as &$s) {
    $s['site'] = null;
    if (!$s['lat'] || !$s['lng']) continue;
    foreach ($sites as $key => [$lat, $lng]) {
        $m = hypot($lat - $s['lat'], ($lng - $s['lng']) * cos(deg2rad($lat))) * 111000;
        if ($m <= SITE_M) { $s['site'] = $key; continue 2; }
    }
    $sites[$s['id']] = [$s['lat'], $s['lng']];   // its own id keys the site it starts
    $s['site'] = $s['id'];
}
unset($s);

// --- Trend -------------------------------------------------------------------------------------
// Runs last, over whichever reading won: a rate computed from a level we then overrode would be a
// rate for a number nobody is shown.
// slope and assess are named functions defined above, near ?cam=, so the ?shots= endpoint can reach
// them too. That endpoint returns early and never enters the refresh path below.

foreach ($stations as &$s) {
    if ($s['kind'] !== 'river') continue;
    $key = $s['id'];
    $lvl = $s['level'];
    $s['rate'] = $s['eta'] = null;
    $s['rising'] = false;
    $s['history'] = [];
    $s['ratio'] = ($lvl !== null && ($s['danger'] ?? null)) ? round($lvl / $s['danger'], 3) : null;
    if ($lvl === null) continue;

    $ts = readTs($s['updated'] ?? null, $now);
    $points = $hist[$key] ?? [];
    // Same stamp as the last sample means the same reading came back. Append nothing.
    if (!$points || end($points)[0] !== $ts) $points[] = [$ts, $lvl];
    $hist[$key] = $points;
    $last = count($points) - 1;

    // Hours to its own danger mark at the current rate. Reported whenever it is climbing at all, so
    // the popup can say "4 h away" on a station that isn't flagged — the flag is a cutoff on this
    // number, and a cutoff nobody can see the other side of is just an assertion.
    $mark = $s['danger'] ?? $s['warning'] ?? $s['alert'] ?? null;
    [$rate, $eta] = assess($points, $last, $mark);
    $s['rate'] = $rate === null ? null : round($rate, 3);
    $s['eta']  = $eta;
    // Two consecutive polls, both inside the cutoff. One is a spike.
    $prev = $last > 0 ? assess($points, $last - 1, $mark)[1] : null;
    $s['rising'] = $eta !== null && $eta <= RISE_ETA && $prev !== null && $prev <= RISE_ETA;
    // The SPHTN arrow no longer stands in at cold start: "Rising" is now a claim about reaching a
    // danger mark within hours, and a bare direction arrow is no evidence for that.
    // [unix seconds, metres, status] — the graph plots against the clock, so it needs the clock, and
    // the readout names the band each sample was in.
    $s['history'] = sparkPoints($points, $now, SPARK_BUCKET, false,
        fn($v) => wlStatus($v, $s['alert'] ?? null, $s['warning'] ?? null, $s['danger'] ?? null));
    $samples[$key] = [$ts, $lvl];
}
unset($s);

// --- State + district tidy-up -------------------------------------------------------------------
// No feed publishes a state, so it is taken from *which feed placed the pin*, which is knowledge we
// already have and not a guess from the name: the Selangor API only covers Selangor, SPHTN only
// covers KL and Putrajaya. Guessing from district names would be worse than useless here — KL has a
// Gombak constituency and Selangor has a Gombak district, and they are different places.
// It is stamped where the station is *built*, not here: `source` is later overwritten to 'national'
// wherever that portal's reading wins, which would have relabelled every matched KL river Selangor.
// Known imprecision: SPHTN publishes a few stations just over the KL border (Bentong is in Pahang)
// and they end up filed under Kuala Lumpur. Better a station in the wrong list than one nowhere.
//
// Case is normalised at the same time because the two feeds disagree — "HULU SELANGOR" against
// "Bukit Bintang" — and a filter list mixing both reads as two different data sets.
foreach ($stations as &$s) {
    $s['state'] ??= 'Selangor';                  // set by the SPHTN block; everything else is Selangor
    $s['district'] = $s['district']
        ? mb_convert_case(trim($s['district']), MB_CASE_TITLE, 'UTF-8')
        : null;
}
unset($s);

$byDistrict = [];
foreach ($stations as $s) {
    $d = $s['district'] ?: 'UNKNOWN';
    $byDistrict[$d]['total'] = ($byDistrict[$d]['total'] ?? 0) + 1;
    if ($s['kind'] === 'river' && $s['status'] > 0) $byDistrict[$d]['alerts'] = ($byDistrict[$d]['alerts'] ?? 0) + 1;
    if (!empty($s['rising'])) $byDistrict[$d]['rising'] = ($byDistrict[$d]['rising'] ?? 0) + 1;
}

// Freshness of the readings themselves (upstream stamps them "d/m/Y H:i:s"), not just of our fetch.
$sourceTs = 0;
foreach ($stations as $s) {
    if (empty($s['updated'])) continue;
    $d = DateTime::createFromFormat('d/m/Y H:i:s', $s['updated']);
    if ($d) $sourceTs = max($sourceTs, $d->getTimestamp());
}

$payload = json_encode([
    'fetched'  => date('c'),
    'stations' => $stations,
    'hotspots' => $get('Hotspots/GetHotspots') ?: [],
    'district' => $byDistrict,
    'cacheAge' => 0,
    'ttl'      => TTL,
    'upstreamOk' => true,
    'forced'   => $force,
    // forceWhy explains a refusal. A successful force has nothing to explain, so it publishes null
    // rather than the self-check label ('ok', 'first' or 'clock moved') forceAllowed() returned.
    'forceWhy' => $force ? null : ($forceWhy ?: null),
    'sourceUpdated' => $sourceTs ? date('c', $sourceTs) : null,
    'tookMs'   => (int)round((microtime(true) - $t0) * 1000),
    // Published so the map can draw the mast radius it actually grouped by, rather than keeping a
    // second copy of this number client-side for the two to drift apart.
    'siteM'    => SITE_M,
    'endpoints' => [
        'StationRainfalls'  => count($rainfallList),
        'StationRiverLevels'=> count($riverList),
        'StationSirens'     => count($get('StationSirens')),
        'StationFloodGauges'=> count($get('StationFloodGauges')),
        'CCTVS'             => count($get('CCTVS')),
    ],
    'details'  => ['requested' => count($detailUrls), 'ok' => count(array_filter($details))],
    // Scrapers fail by returning nothing, so the counts are the alarm: klAdded 0 or natMatched 0
    // means a table layout moved, not that the rivers went quiet.
    'sources'  => [
        'kl'       => ['parsed' => count($kl), 'added' => $klAdded, 'merged' => $klDupes],
        'national' => ['parsed' => count($nat), 'applied' => count($natUsed),
                       'unmapped' => count($nat) - count($natUsed)],
    ],
    'offline'  => count(array_filter($stations, fn($s) => !$s['online'])),
], JSON_UNESCAPED_SLASHES);

$ins = $db->prepare('INSERT OR IGNORE INTO level (station, ts, level) VALUES (?, ?, ?)');
$db->beginTransaction();
foreach ($samples as $k => [$ts, $v]) $ins->execute([$k, $ts, $v]);
$db->exec('DELETE FROM level WHERE ts < ' . ($now - RETAIN));
$db->commit();

file_put_contents(CACHE, $payload, LOCK_EX);
echo $payload;

/* Last, and still inside the refresh lock. The payload is already on the wire, so nothing the map
   needs is waiting on this — but with no `fastcgi_finish_request` under Herd the connection cannot
   actually be closed, so one poll in six takes a few seconds longer than the rest. That is the cost
   of not having a background worker; a cron on api.php would spend it where nobody is watching.
   `ignore_user_abort` so a client that gave up doesn't leave a half-written capture behind. */
ignore_user_abort(true);
flush();
captureShots($stations);
