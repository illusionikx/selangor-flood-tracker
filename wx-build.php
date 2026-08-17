<?php
/**
 * php wx-build.php — rebakes wx-places.json, the district behind each weather point.
 *
 * MET gives a nowcast point a name and a coordinate. It gives no district. metDaily() keys its rows
 * by district name, so the two feeds cannot join without one.
 *
 * No station may supply that district. A temperature taken through the district of a station reads
 * as that station reporting a temperature, and no station in this payload holds a weather reading.
 * Nominatim answers instead, and it belongs to nobody in this app.
 *
 * Run this by hand and commit the result. Nominatim allows one request each second, so fifty
 * lookups cannot ride a refresh. Towns do not move. A new MET point shows no temperature until
 * somebody runs this again, which is a missing row and never a wrong one.
 */

require_once __DIR__ . '/sources.php';

const UA      = 'flood-exp/1.0 (+https://github.com/illusionikx/selangor-flood-tracker)';
const REVERSE = 'https://nominatim.openstreetmap.org/reverse';
const PAUSE   = 2;                          // seconds between calls. The policy asks for one.
const OUT     = __DIR__ . '/wx-places.json';

function fail(string $why): never {
    fwrite(STDERR, "wx-build: $why\n");
    exit(1);
}

/** The coverage box, read from api.php so the two cannot drift apart. */
function box(): array {
    $src = file_get_contents(__DIR__ . '/api.php');
    if (!preg_match('/^const BOX = \[(.+?)\];/m', $src, $m))
        fail('BOX not found in api.php — has the constant been renamed?');
    $b = array_map('floatval', explode(',', $m[1]));
    if (count($b) !== 4) fail('BOX is not four numbers');
    return $b;
}

/** The MET nowcast URL, read from api.php for the same reason. */
function nowcastUrl(): string {
    $src = file_get_contents(__DIR__ . '/api.php');
    if (!preg_match("/^const MET_URL\s*=\s*'([^']+)'/m", $src, $m))
        fail('MET_URL not found in api.php');
    return $m[1];
}

function get(string $url): string {
    $c = curl_init($url);
    curl_setopt_array($c, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_USERAGENT => UA, CURLOPT_TIMEOUT => 30, CURLOPT_SSL_VERIFYPEER => false,
    ]);
    $b = curl_exec($c);
    $s = curl_getinfo($c, CURLINFO_RESPONSE_CODE);
    curl_close($c);
    return ($b === false || $s >= 400) ? '' : (string)$b;
}

/**
 * The district for one coordinate, through three rungs.
 *
 * Nominatim returns the daerah of Malaysia in `district`. Kuala Lumpur is a federal territory and
 * carries no daerah, so `city` answers there. Putrajaya answers on `state`.
 */
function place(float $lat, float $lng): ?array {
    $u = REVERSE . '?' . http_build_query([
        'format' => 'jsonv2', 'addressdetails' => 1, 'lat' => $lat, 'lon' => $lng,
    ]);
    $j = json_decode(get($u), true);
    $a = $j['address'] ?? null;
    if (!is_array($a)) return null;
    $d = $a['district'] ?? $a['city'] ?? $a['state'] ?? null;
    if ($d === null) return null;
    return ['district' => strtolower(trim($d)), 'state' => $a['state'] ?? ($a['city'] ?? '')];
}

$html = get(nowcastUrl());
if ($html === '') fail('the MET nowcast page did not answer');

$pts = wxInBox(metPoints($html), box());
if (!$pts) fail('no nowcast point fell inside BOX — check metPoints() and BOX');

printf("%d points in the box\n", count($pts));

$out = [];
foreach ($pts as $i => $p) {
    if ($i) sleep(PAUSE);
    $slug = wxSlug($p['name']);
    $hit  = place($p['lat'], $p['lng']);
    if ($hit === null) {
        printf("  %-30s NO DISTRICT\n", $p['name']);
        continue;
    }
    $out[$slug] = $hit;
    printf("  %-30s %-22s %s\n", $p['name'], $hit['district'], $hit['state']);
}

if (count($out) < count($pts) / 2)
    fail('fewer than half the points resolved — refusing to overwrite a good file');

ksort($out);
file_put_contents(OUT, json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
printf("\nwrote %s with %d rows\n", basename(OUT), count($out));
