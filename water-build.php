<?php
/**
 * php water-build.php — rebakes water.json, the water the dark basemap does not draw.
 *
 * A grey canvas basemap draws almost no small water. Measured on CARTO's dark_all, which served
 * this map until 2026-08-27: a 0.0017 square kilometer retention pond has zero water pixels at
 * zoom 13, 14 and 15 alike. Esri's dark canvas, which replaced it, drops the same class of water.
 * The box holds 6,489 water bodies with a median area of 0.0037 square kilometers, so this is most
 * of them. See docs/FEATURES.md.
 *
 * So this bakes the geometry once and js/map.js draws it. Rivers become lines and everything else
 * becomes filled shapes, both in `--water`.
 *
 * A second fault applied to CARTO alone and is recorded because it shaped this file. That style
 * drew a river as a one-pixel antialiased line, whose pixels landed in the same tones as roads, so
 * the SVG tint in index.html could not reach it. That tint is deleted. See css/map.css.
 *
 * Run this by hand and commit the result. It is not part of any request path. Overpass is a free
 * service with no funding for a poller, and this data changes about as often as a river moves.
 * A 504 under load is routine. This script writes nothing when that happens, so retry.
 */

const TOL_DEG  = 0.00006;  // Douglas-Peucker tolerance, about 6.6 m, which is about 1.4 px at the
                           // deepest zoom this map reaches. Tolerance controls the detail *within*
                           // a shape and never which shapes are present.
                           //
                           // It was 0.0003, about 33 m, and a reader read a lake as a low-poly
                           // shape. The comment here claimed 33 m was finer than a pixel at zoom
                           // 18. Both halves were wrong. `js/map.js` stops the map at zoom 15,
                           // where one pixel covers about 4.8 m at this latitude, and 33 m is 55 px
                           // at zoom 18.
                           //
                           // 17 m was the first repair and a reader rejected it as well. So the
                           // value comes off rendered pictures rather than off arithmetic. Take a
                           // screenshot at zoom 15 against a build at `--tol=0` and compare, and
                           // measure any new value the same way.

/* The size floors, and they REVERSE part of the reason above. The header says this file exists
   because the basemap hides small water. That is still true close in. It stopped being the whole
   truth at zoom 10, where the unfiltered set drew 2,775 rivers as a blue web over the whole state
   and answered no question a reader had. A drain behind a house is not a flood risk a reader reads
   off a map of six thousand of them.
   So the floors cut the shapes that only ever added texture. Anything at or above them still draws
   at every zoom, exactly as before. The repository owner asked for this on 2026-09-02.
   Tune these against the counts this script prints, never against a guess. */
const MIN_AREA_KM2 = 0.01;   // one hectare. The median body in the box is 0.0037 km².
const MIN_RIVER_KM = 1.0;    // a river shorter than a kilometre is a drain at this map's zooms.
/* Coordinate rounding, in decimal places. 4 is about 11 m and 5 is about 1.1 m. This is a FLOOR
   under the tolerance above, not a second tolerance: a grid coarser than the tolerance turns a
   smooth curve into a staircase, whatever Douglas-Peucker left. So keep the grid under the
   tolerance. `--dp=5` overrides it for one run. */
define('COORD_DP', (int) (preg_replace('/^--dp=/', '', implode(' ', preg_grep('/^--dp=/', $argv))) ?: 4));
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
 * Area of a closed ring in square kilometres.
 *
 * The shoelace formula in degrees, with longitude scaled by the cosine of the ring's own middle
 * latitude. A degree of longitude is 111 km at the equator and 111 km times that cosine everywhere
 * else, so an unscaled shoelace overstates every shape by about 0.1% here and by a great deal
 * further north. The sign says which way the ring winds, and nothing here cares, so take the size.
 */
function areaKm2(array $ring): float {
    $n = count($ring);
    if ($n < 4) return 0.0;
    $lat = 0.0;
    foreach ($ring as $p) $lat += $p[1];
    $k = 111.32 * cos($lat / $n * M_PI / 180);
    $sum = 0.0;
    for ($i = 0, $j = $n - 1; $i < $n; $j = $i++)
        $sum += ($ring[$j][0] * $k) * ($ring[$i][1] * 110.57)
              - ($ring[$i][0] * $k) * ($ring[$j][1] * 110.57);
    return abs($sum) / 2;
}

/** Length of an open line in kilometres, summed segment by segment. */
function lineKm(array $pts): float {
    $km = 0.0;
    for ($i = 1; $i < count($pts); $i++) {
        $k = 111.32 * cos(($pts[$i][1] + $pts[$i - 1][1]) / 2 * M_PI / 180);
        $km += hypot(($pts[$i][0] - $pts[$i - 1][0]) * $k,
                     ($pts[$i][1] - $pts[$i - 1][1]) * 110.57);
    }
    return $km;
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

/* Two flags, and both exist to tune the tolerance by hand. `--tol=0.0001` overrides TOL_DEG for one
   run. `--cached` reuses the last raw Overpass answer out of the system temp directory, so trying a
   third tolerance costs that free service nothing. A run with no flag behaves as it always did. */
$RAW = sys_get_temp_dir() . '/water-build-raw.json';
$tol = TOL_DEG;
foreach (array_slice($argv, 1) as $a) if (str_starts_with($a, '--tol=')) $tol = (float) substr($a, 6);
$body = (in_array('--cached', $argv, true) && is_file($RAW)) ? file_get_contents($RAW) : null;
if ($body !== null) echo "water-build: reusing the cached Overpass answer\n";

if ($body === null) {
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
file_put_contents($RAW, $body);
}

$els = json_decode($body, true)['elements'] ?? null;
if (!is_array($els)) fail('Overpass returned no elements — the query or the service changed');

// --- trim ----------------------------------------------------------------------------------------

$lines = []; $areas = []; $points = 0;
$cut = ['pond' => 0, 'river' => 0];   // what the two floors above took, printed at the end

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
            $poly = []; $kept = 0;
            foreach (array_merge([$ring], rings($inner)) as $r) {
                $c = clean(simplify($r, $tol));
                if (count($c) < 4) continue;
                if ($c[0] !== end($c)) $c[] = $c[0];      // rounding can unclose a ring
                $poly[] = $c; $kept += count($c);
            }
            $inner = [];                                   // holes belong to the first ring only.
            // Cleared BEFORE the floor below, or a cut first ring hands its holes to the second.
            // The floor reads the OUTER ring alone. A lake with a wooded island in it is still a
            // lake the size of its own shore.
            if ($poly && areaKm2($poly[0]) < MIN_AREA_KM2) { $cut['pond']++; continue; }
            if ($poly) { $areas[] = $poly; $points += $kept; }
        }
        continue;
    }

    $g = [];
    foreach ($el['geometry'] ?? [] as $p) if ($p) $g[] = [$p['lon'], $p['lat']];
    if (count($g) < 2) continue;
    $c = clean(simplify($g, $tol));
    if (count($c) < 2) continue;

    if ($isRiver) {
        if (lineKm($c) < MIN_RIVER_KM) { $cut['river']++; continue; }
        $lines[] = $c; $points += count($c); continue;
    }
    if (count($c) < 4) continue;
    if ($c[0] !== end($c)) $c[] = $c[0];
    if (areaKm2($c) < MIN_AREA_KM2) { $cut['pond']++; continue; }
    $areas[] = [$c]; $points += count($c);
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
printf("water-build: the floors cut %d rivers under %.2f km and %d bodies under %.4f km2\n",
       $cut['river'], MIN_RIVER_KM, $cut['pond'], MIN_AREA_KM2);
echo "water-build: commit water.json. js/map.js fetches it by name, so there is no ?v= to bump.\n";
