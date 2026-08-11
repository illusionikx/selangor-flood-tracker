<?php
/**
 * php water-build.php — rebakes water.json, the water the dark basemap does not draw.
 *
 * Two faults, one file. CARTO's dark basemap draws a river as a one-pixel antialiased line, whose
 * pixels land in the same tones as roads, so the tint in index.html cannot reach it. And CARTO
 * drops small water from its style outright: a 0.0017 square kilometer retention pond has zero
 * water pixels at zoom 13, 14 and 15 alike, so there is nothing on the tile to recolour. Measured
 * both ways — see docs/FEATURES.md.
 *
 * So this bakes the geometry once and js/map.js draws it. Rivers become lines and everything else
 * becomes filled shapes, both in the same colour the tint paints the sea.
 *
 * Run this by hand and commit the result. It is not part of any request path. Overpass is a free
 * service with no funding for a poller, and this data changes about as often as a river moves.
 * A 504 under load is routine. This script writes nothing when that happens, so retry.
 */

const TOL_DEG  = 0.0003;   // Douglas-Peucker tolerance, about 33 m. Finer than a screen pixel at
                           // zoom 18, which is the deepest this map goes. Tolerance controls the
                           // detail *within* a shape and never which shapes are present.
const COORD_DP = 4;        // About 11 m per unit. Two more digits cost 40% of the file for detail
                           // no zoom in this app can show.
const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const OUT      = __DIR__ . '/water.json';

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
    fwrite(STDERR, "water-build: $why\n");
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

/** Round, then drop the neighbours rounding has just made identical. */
function clean(array $pts): array {
    $out = [];
    foreach ($pts as $p) {
        $q = [round($p[0], COORD_DP), round($p[1], COORD_DP)];
        if (!$out || $q !== end($out)) $out[] = $q;
    }
    return $out;
}

/**
 * Chain a relation's member ways into closed rings.
 *
 * A large lake's outline is usually split across several ways, and each one on its own is an open
 * line. Closing them individually draws a lake as a handful of wedges. So walk each chain end to
 * end, flipping a way when it joins backwards, and keep only what actually closes.
 */
function rings(array $ways): array {
    $rings = []; $pool = array_values($ways);
    while ($pool) {
        $cur = array_shift($pool);
        while ($cur[0] !== end($cur)) {
            $joined = false;
            foreach ($pool as $i => $w) {
                if (end($cur) === $w[0])            $cur = array_merge($cur, array_slice($w, 1));
                elseif (end($cur) === end($w))      $cur = array_merge($cur, array_slice(array_reverse($w), 1));
                else continue;
                unset($pool[$i]); $pool = array_values($pool); $joined = true;
                break;
            }
            if (!$joined) break;                   // an open chain: the relation is broken upstream
        }
        if (count($cur) > 3 && $cur[0] === end($cur)) $rings[] = $cur;
    }
    return $rings;
}

// --- fetch ---------------------------------------------------------------------------------------

[$w, $n, $e, $s] = box();
$bbox  = sprintf('%f,%f,%f,%f', $s, $w, $n, $e);
$query = "[out:json][timeout:300];("
       . "way[\"waterway\"=\"river\"]($bbox);"
       . "way[\"natural\"=\"water\"]($bbox);"
       . "relation[\"natural\"=\"water\"]($bbox);"
       . "way[\"landuse\"=\"basin\"]($bbox);"       // how many detention ponds are tagged
       . "relation[\"landuse\"=\"basin\"]($bbox);"
       . ");out geom;";

echo "water-build: asking Overpass for water in $bbox\n";

$ch = curl_init(ENDPOINT);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => http_build_query(['data' => $query]),
    CURLOPT_TIMEOUT        => 420,
    // Overpass asks every client to identify itself, and throttles the ones that do not.
    CURLOPT_USERAGENT      => 'klang-valley-flood-watch/1.0 (water-build.php, run by hand)',
]);
$body = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
if ($body === false) fail('curl: ' . curl_error($ch));
curl_close($ch);
if ($code !== 200) fail("Overpass answered $code — a 504 is routine under load, so try again");

$els = json_decode($body, true)['elements'] ?? null;
if (!is_array($els)) fail('Overpass returned no elements — the query or the service changed');

// --- trim ----------------------------------------------------------------------------------------

$lines = []; $areas = []; $points = 0;

foreach ($els as $el) {
    $isRiver = ($el['tags']['waterway'] ?? '') === 'river';

    // A way carries its own geometry. A relation carries one list per member, tagged with a role.
    if ($el['type'] === 'relation') {
        $outer = []; $inner = [];
        foreach ($el['members'] ?? [] as $m) {
            $g = [];
            foreach ($m['geometry'] ?? [] as $p) if ($p) $g[] = [$p['lon'], $p['lat']];
            if (count($g) < 2) continue;
            if (($m['role'] ?? '') === 'inner') $inner[] = $g; else $outer[] = $g;
        }
        foreach (rings($outer) as $ring) {
            $poly = [];
            foreach (array_merge([$ring], rings($inner)) as $r) {
                $c = clean(simplify($r, TOL_DEG));
                if (count($c) < 4) continue;
                if ($c[0] !== end($c)) $c[] = $c[0];      // rounding can unclose a ring
                $poly[] = $c; $points += count($c);
            }
            if ($poly) $areas[] = $poly;
            $inner = [];                                   // holes belong to the first ring only
        }
        continue;
    }

    $g = [];
    foreach ($el['geometry'] ?? [] as $p) if ($p) $g[] = [$p['lon'], $p['lat']];
    if (count($g) < 2) continue;
    $c = clean(simplify($g, TOL_DEG));
    if (count($c) < 2) continue;
    $points += count($c);

    if ($isRiver) { $lines[] = $c; continue; }
    if (count($c) < 4) { $points -= count($c); continue; }
    if ($c[0] !== end($c)) $c[] = $c[0];
    $areas[] = [$c];
}

if (!$lines || !$areas) fail('rivers or water bodies came back empty — refusing to write the file');

// Two features rather than a GeometryCollection, because js/map.js styles them differently: a river
// is a stroke and a pond is a fill. `t` is the whole of what it reads.
$json = json_encode(['type' => 'FeatureCollection', 'features' => [
    ['type' => 'Feature', 'properties' => ['t' => 'line'],
     'geometry' => ['type' => 'MultiLineString', 'coordinates' => $lines]],
    ['type' => 'Feature', 'properties' => ['t' => 'area'],
     'geometry' => ['type' => 'MultiPolygon', 'coordinates' => $areas]],
]]);
file_put_contents(OUT, $json);

printf("water-build: %d rivers, %d water bodies, %d points, %d KB on disk, about %d KB gzipped\n",
       count($lines), count($areas), $points, strlen($json) / 1024, strlen(gzencode($json, 9)) / 1024);
echo "water-build: commit water.json. js/map.js fetches it by name, so there is no ?v= to bump.\n";
