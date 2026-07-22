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
// own. Polls are irregular (the cache only refreshes when someone visits), so the baseline is the
// sample nearest an hour old, and we give up rather than guess if nothing lands in the window.
const TREND_WIN = 3600;
const TREND_MIN = 1200;   // 20 min — closer than this and rounding noise dominates the rate
const TREND_MAX = 10800;  // 3 h  — older than this says nothing about now
// "Rising" is not a rate, it is a forecast: at the rate it is climbing now, this station reaches its
// OWN danger mark within RISE_ETA hours. A fixed m/h can't do that job — 0.2 m/h is a quiet
// afternoon on a big river 4 m below danger, and an emergency on a drain 30 cm below it.
// The floor exists because levels are reported to the centimetre: over the shortest baseline we
// accept (20 min), a single 1 cm tick is already 0.03 m/h, so anything under 0.1 is rounding.
// Measured against our own samples in calm weather, 0.05 m/h — the previous bar — sat on the p90 of
// ordinary fluctuation and fired on 3 cm of movement, flagging ~1 station-hour in 10 as "rising".
const RISE_FLOOR = 0.10;  // m/hour — below this the rate is sensor rounding, not a climb
const RISE_ETA   = 3;     // hours to its own danger mark
// Sirens report a daily heartbeat (most stamp 08:00). Two missed days is out of contact, not idle.
const SIREN_STALE = 48 * 3600;
const SITE_M = 25;   // metres — stations this close are sensors on one mast, not separate places
const CACHE = __DIR__ . '/.cache.json';
const LOCK  = __DIR__ . '/.refresh.lock';   // held for the length of a rebuild; see below
const HIST  = __DIR__ . '/.history.db';
const READ  = 86400;         // seconds of history loaded per poll (trend + sparkline)
const RETAIN = 30 * 86400;   // seconds kept on disk; older samples are pruned


date_default_timezone_set('Asia/Kuala_Lumpur'); // upstream timestamps are local MYT, unlabelled

const HOST = 'infobanjirjps.selangor.gov.my';

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
    // Prefer TLS to upstream; fall back to what it actually advertised.
    $img = @file_get_contents(preg_replace('#^http://#i', 'https://', $url)) ?: @file_get_contents($url);
    if ($img === false) { http_response_code(502); exit; }
    header('Content-Type: image/jpeg');
    header('Cache-Control: max-age=60');
    echo $img;
    exit;
}

// ?shots=<id> — which frames exist. The client asks once, when a lightbox opens.
if (isset($_GET['shots'])) {
    header('Content-Type: application/json');
    header('Cache-Control: max-age=60');
    echo json_encode(shotList((int)$_GET['shots']));
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

header('Content-Type: application/json');
$t0 = microtime(true);

/** Age from when the payload was actually fetched — mtime doubles as a lock and gets touched. */
function cachedPayload(): array {
    $j = json_decode(@file_get_contents(CACHE), true) ?: [];
    return $j + ['cacheAge' => max(0, time() - strtotime($j['fetched'] ?? 'now'))];
}

function serveCache(array $extra = []): never {
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

if (is_file(CACHE)) {
    $age = time() - filemtime(CACHE);
    if ($age < TTL || !$mine) serveCache();   // fresh, or someone else is already rebuilding it
    // One upstream table takes ~10s to render, so blocking the page on the refresh would mean a
    // blank map for that long. Hand back the stale payload immediately, then refresh with the
    // connection already closed.
    if (function_exists('fastcgi_finish_request')) {
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
 */
function sparkPoints(array $points, int $now, int $bucket = SPARK_BUCKET, bool $peak = false): array {
    $out = [];
    foreach ($points as [$ts, $v]) {
        if ($now - $ts > SPARK_WIN) continue;
        $b = intdiv($ts, $bucket);
        if ($peak && isset($out[$b]) && $out[$b][1] >= $v) continue;
        $out[$b] = [$ts, round($v, 3)];
    }
    ksort($out);
    return array_values($out);
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
            CURLOPT_USERAGENT      => 'flood-exp/1.0',
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
        'status'   => (int)$s['status'],          // -1 none .. 4 very heavy
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
        'status'   => (int)$s['wL1Status'],       // -1 offline, 0 normal, 1 alert, 2 warning, 3 danger
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
    $s['history'] = sparkPoints(
        array_merge($hist[$key] ?? [], [[$now, (float)$s['hourly']]]), $now, RAIN_BUCKET);
    $samples[$key] = (float)$s['hourly'];
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
    $hist[$key] = array_merge($hist[$key] ?? [], [[$now, (float)$s['depth']]]);
    $s['history'] = sparkPoints($hist[$key], $now);
    $samples[$key] = (float)$s['depth'];
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
    $hist[$key] = array_merge($hist[$key] ?? [], [[$now, (float)$s['status']]]);
    $s['history'] = sparkPoints($hist[$key], $now, SPARK_BUCKET, true);
    $samples[$key] = (float)$s['status'];
}
unset($s);

// --- Sites -------------------------------------------------------------------------------------
// A rainfall gauge, a river gauge and sometimes a camera share one mast, and every feed publishes
// them as separate stations at the same coordinates — 113 coordinate pairs hold two or more, and
// another 46 pairs sit a few metres apart because two feeds typed the same mast slightly
// differently. They are one place, so they get one `site` key and the map draws one pin.
//
// Grouped greedily in build order, so the first station at a spot defines it. Measured on the live
// set: 0 m merges 113 sites, 25 m merges 161, and it barely moves again until 200 m — which starts
// swallowing genuinely separate installations. 25 m is that knee.
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
foreach ($stations as &$s) {
    if ($s['kind'] !== 'river') continue;
    $key = $s['id'];
    $lvl = $s['level'];
    $s['trend'] = $s['rate'] = $s['eta'] = null;
    $s['rising'] = false;
    $s['history'] = [];
    $s['ratio'] = ($lvl !== null && ($s['danger'] ?? null)) ? round($lvl / $s['danger'], 3) : null;
    if ($lvl === null) continue;

    $points = $hist[$key] ?? [];
    $base = null;
    foreach ($points as $p) {
        $age = $now - $p[0];
        if ($age < TREND_MIN || $age > TREND_MAX) continue;
        if (!$base || abs($age - TREND_WIN) < abs(($now - $base[0]) - TREND_WIN)) $base = $p;
    }
    if ($base) {
        $s['trend'] = round($lvl - $base[1], 3);
        $s['rate']  = round(($lvl - $base[1]) / (($now - $base[0]) / 3600), 3);
    }
    // A single high reading is not a rise: the three most recent samples must not dip either.
    // ponytail: non-decreasing, not strictly increasing — JPS refreshes slower than we poll, so
    // repeated identical readings are normal and must not cancel a real climb.
    $hist[$key] = array_merge($points, [[$now, $lvl]]);
    $tail = array_slice($hist[$key], -3);
    $climbing = $s['rate'] !== null && $s['rate'] >= RISE_FLOOR && count($tail) === 3
             && $tail[1][1] >= $tail[0][1] && $tail[2][1] >= $tail[1][1];

    // Hours to its own danger mark at the current rate. Reported whenever it is climbing at all, so
    // the popup can say "4 h away" on a station that isn't flagged — the flag is a cutoff on this
    // number, and a cutoff nobody can see the other side of is just an assertion.
    $mark = $s['danger'] ?? $s['warning'] ?? $s['alert'] ?? null;
    $s['eta'] = ($climbing && $mark !== null)
        ? round(max(0, ($mark - $lvl) / $s['rate']), 2)
        : null;
    $s['rising'] = $s['eta'] !== null && $s['eta'] <= RISE_ETA;
    // The SPHTN arrow no longer stands in at cold start: "Rising" is now a claim about reaching a
    // danger mark within hours, and a bare direction arrow is no evidence for that.
    // [unix seconds, metres] — the graph plots against the clock, so it needs the clock.
    $s['history'] = sparkPoints($hist[$key], $now);
    $samples[$key] = $lvl;
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
    'sourceUpdated' => $sourceTs ? date('c', $sourceTs) : null,
    'tookMs'   => (int)round((microtime(true) - $t0) * 1000),
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
foreach ($samples as $k => $v) $ins->execute([$k, $now, $v]);
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
