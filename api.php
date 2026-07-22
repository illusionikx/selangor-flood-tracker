<?php
// Proxy + cache for infobanjirjps.selangor.gov.my (no CORS headers upstream, so we fetch server-side).
// ponytail: flat files for cache/history. Move to sqlite if you ever want charts longer than a few hours.

const API   = 'https://infobanjirjps.selangor.gov.my/JPSAPI/api/';
const TTL   = 300;   // upstream updates hourly; 5 min is plenty
const KEEP  = 24;    // history points per station (~2h at 5min)
const CACHE = __DIR__ . '/.cache.json';
const HIST  = __DIR__ . '/.history.json';

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

header('Content-Type: application/json');
$t0 = microtime(true);

/** Re-emit a stored payload, stamped with how old it is. */
function serveCache(int $age, array $extra = []): never {
    $j = json_decode(file_get_contents(CACHE), true) ?: [];
    echo json_encode($j + ['cacheAge' => $age] + $extra, JSON_UNESCAPED_SLASHES);
    exit;
}

if (is_file(CACHE) && ($age = time() - filemtime(CACHE)) < TTL) {
    serveCache($age);
}

/** Fetch many URLs concurrently. Returns [url => decoded|null]. */
function fetchAll(array $urls, int $concurrency = 20): array {
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
            $out[$handles[(int)$ch]] = json_decode(curl_multi_getcontent($ch), true);
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
    if (is_file(CACHE)) serveCache(time() - filemtime(CACHE), ['upstreamOk' => false, 'error' => 'upstream unreachable']);
    http_response_code(502);
    echo json_encode(['upstreamOk' => false, 'error' => 'upstream unreachable']);
    exit;
}

// Detail calls carry the actual mm / metres. Lists only carry status codes.
$detailUrls = [];
foreach ($rainfallList as $s) $detailUrls["rf-{$s['stationId']}"] = API . 'StationRainfalls/' . $s['stationId'];
foreach ($riverList as $s)    $detailUrls["wl-{$s['stationId']}"] = API . 'StationRiverLevels/' . $s['stationId'];
foreach ($get('CCTVS') as $s) $detailUrls["cam-{$s['stationId']}"] = API . 'CCTVS/' . $s['stationId'];
foreach ($get('StationFloodGauges') as $s) $detailUrls["fg-{$s['stationId']}"] = API . 'StationFloodGauges/' . $s['stationId'];
$details = fetchAll($detailUrls);

$hist = is_file(HIST) ? (json_decode(file_get_contents(HIST), true) ?: []) : [];
$now  = time();

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
        'hourly'   => $d['hourlyRainfall']     ?? null,
        'daily'    => $d['dailyRainfall']      ?? null,
        'updated'  => $d['statusLastUpdate']   ?? null,
    ];
}

foreach ($riverList as $s) {
    $d   = $details[API . 'StationRiverLevels/' . $s['stationId']] ?? [];
    $key = 'wl-' . $s['stationId'];
    $lvl = isset($d['waterLevel1']) ? (float)$d['waterLevel1'] : null;

    // Upstream gives no trend on these endpoints, so we derive it from our own samples.
    $trend = null;
    if ($lvl !== null) {
        $points = $hist[$key] ?? [];
        if ($points) $trend = round($lvl - $points[0][1], 3);
        $points[] = [$now, $lvl];
        $hist[$key] = array_slice($points, -KEEP);
    }

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
        'trend'    => $trend,                     // metres change over our retained window
        'history'  => array_map(fn($p) => $p[1], $hist[$key] ?? []),
        'ratio'    => ($lvl !== null && $danger) ? round($lvl / $danger, 3) : null,
        'updated'  => $d['waterLevel1LastUpdate'] ?? null,
    ];
}

foreach ([['siren', 'StationSirens'], ['gauge', 'StationFloodGauges'], ['camera', 'CCTVS']] as [$kind, $ep]) {
    foreach ($get($ep) as $s) {
        $cam = $kind === 'camera' ? ($details[API . 'CCTVS/' . $s['stationId']] ?? []) : [];
        // Gauges report flood depth over the marked spot: negative is dry ground.
        $fg  = $kind === 'gauge' ? ($details[API . 'StationFloodGauges/' . $s['stationId']] ?? []) : [];
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
            'online'   => (bool)($s['isOnline'] ?? ((int)($s['stationStatus'] ?? 0) === 1)),
            'reading'  => $s['lastReading'] ?? null,
            'updated'  => $fg['statusLastUpdate'] ?? null,
        ];
    }
}

$byDistrict = [];
foreach ($stations as $s) {
    $d = $s['district'] ?: 'UNKNOWN';
    $byDistrict[$d]['total'] = ($byDistrict[$d]['total'] ?? 0) + 1;
    if ($s['kind'] === 'river' && $s['status'] > 0) $byDistrict[$d]['alerts'] = ($byDistrict[$d]['alerts'] ?? 0) + 1;
    if ($s['kind'] === 'river' && ($s['trend'] ?? 0) > 0.05) $byDistrict[$d]['rising'] = ($byDistrict[$d]['rising'] ?? 0) + 1;
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
    'offline'  => count(array_filter($stations, fn($s) => !$s['online'])),
], JSON_UNESCAPED_SLASHES);

file_put_contents(HIST, json_encode($hist), LOCK_EX);
file_put_contents(CACHE, $payload, LOCK_EX);
echo $payload;
