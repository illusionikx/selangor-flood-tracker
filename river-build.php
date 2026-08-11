<?php
/**
 * php river-build.php — rebakes rivers.json, the river geometry the dark basemap draws.
 *
 * CARTO's dark basemap draws a river as a one-pixel antialiased line, and the water tint in
 * index.html cannot reach it: at zoom 12 and above those pixels land in the same tones as roads
 * and buildings, so no filter can tell them apart. See docs/FEATURES.md. This script bakes the
 * real geometry once instead, and js/map.js draws it as a line of its own on the dark theme.
 *
 * Run this by hand and commit the result. It is not part of any request path. Overpass is a free
 * service with no funding for a poller, and this data changes about as often as a river moves.
 */

const TOL_DEG   = 0.0003;   // Douglas-Peucker tolerance, about 33 m. Finer than a screen pixel at
                            // zoom 18, which is the deepest this map goes.
const COORD_DP  = 4;        // About 11 m per unit. Two more digits cost 40% of the file for detail
                            // no zoom in this app can show.
const ENDPOINT  = 'https://overpass-api.de/api/interpreter';
const OUT       = __DIR__ . '/rivers.json';

/** The coverage box, read from api.php so the two cannot drift apart. */
function box(): array {
    $src = file_get_contents(__DIR__ . '/api.php');
    if (!preg_match('/^const BOX = \[(.+?)\];/m', $src, $m))
        fail('BOX not found in api.php — has the constant been renamed?');
    $b = array_map('floatval', explode(',', $m[1]));
    if (count($b) !== 4) fail('BOX is not four numbers');
    return $b;                                     // [west, north, east, south]
}

function fail(string $why): never {
    fwrite(STDERR, "river-build: $why\n");
    exit(1);
}

/** Douglas-Peucker. Keeps the shape of a bend, which an every-Nth-point thinner does not. */
function simplify(array $pts, float $tol): array {
    $n = count($pts);
    if ($n < 3) return $pts;
    [$ax, $ay] = $pts[0];
    [$bx, $by] = $pts[$n - 1];
    $dx = $bx - $ax; $dy = $by - $ay; $den = $dx * $dx + $dy * $dy;
    $far = 0.0; $at = 0;
    for ($i = 1; $i < $n - 1; $i++) {
        [$px, $py] = $pts[$i];
        $t = $den ? (($px - $ax) * $dx + ($py - $ay) * $dy) / $den : 0;
        $t = max(0, min(1, $t));
        $d = hypot($px - ($ax + $t * $dx), $py - ($ay + $t * $dy));
        if ($d > $far) { $far = $d; $at = $i; }
    }
    if ($far <= $tol) return [$pts[0], $pts[$n - 1]];
    return array_merge(
        simplify(array_slice($pts, 0, $at + 1), $tol),
        array_slice(simplify(array_slice($pts, $at), $tol), 1));
}

// --- fetch ---------------------------------------------------------------------------------------

[$w, $n, $e, $s] = box();
$query = sprintf('[out:json][timeout:300];way["waterway"="river"](%f,%f,%f,%f);out geom;', $s, $w, $n, $e);

echo "river-build: asking Overpass for rivers in $s,$w,$n,$e\n";

$ch = curl_init(ENDPOINT);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => http_build_query(['data' => $query]),
    CURLOPT_TIMEOUT        => 360,
    // Overpass asks every client to identify itself, and throttles the ones that do not.
    CURLOPT_USERAGENT      => 'klang-valley-flood-watch/1.0 (river-build.php, run by hand)',
]);
$body = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
if ($body === false) fail('curl: ' . curl_error($ch));
curl_close($ch);
if ($code !== 200) fail("Overpass answered $code");

$els = json_decode($body, true)['elements'] ?? null;
if (!is_array($els)) fail('Overpass returned no elements — the query or the service changed');

// --- trim ----------------------------------------------------------------------------------------

$lines = []; $points = 0;
foreach ($els as $el) {
    $pts = [];
    foreach ($el['geometry'] ?? [] as $p)
        if ($p) $pts[] = [round($p['lon'], COORD_DP), round($p['lat'], COORD_DP)];
    if (count($pts) < 2) continue;

    // Rounding can put two neighbours on the same point, and a zero-length segment draws nothing.
    $keep = [];
    foreach (simplify($pts, TOL_DEG) as $p) if (!$keep || $p !== end($keep)) $keep[] = $p;
    if (count($keep) < 2) continue;

    $points += count($keep);
    $lines[] = $keep;
}
if (!$lines) fail('no rivers survived the trim — refusing to write an empty file');

// One MultiLineString rather than a FeatureCollection: nothing reads a per-river property, and a
// wrapper object per line costs more than the geometry it wraps.
$json = json_encode(['type' => 'MultiLineString', 'coordinates' => $lines]);
file_put_contents(OUT, $json);

printf("river-build: %d rivers, %d points, %d KB on disk, about %d KB gzipped\n",
       count($lines), $points, strlen($json) / 1024, strlen(gzencode($json, 9)) / 1024);
echo "river-build: commit rivers.json. js/map.js fetches it by name, so there is no ?v= to bump.\n";
