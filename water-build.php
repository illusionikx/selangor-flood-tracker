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

/* THE SIZE FLOORS ARE BAND EDGES NOW, AND THEY NO LONGER DELETE A SHAPE.
   They deleted one until 2026-09-09. The reason was never the file size. Measured across five
   settings, the whole set holds 3.2 times the shapes for 35 percent more bytes. The reason was the
   picture: 2,775 rivers drew as a blue web over the whole state at zoom 10. It answered no question
   a reader had.
   A zoom answers that instead. Band 0 is what the map drew under the old floors, and it draws at
   every zoom. Band 1 joins it at zoom 11 and band 2 at zoom 13. See `BAND_MIN` in js/map.js.
   Tune these against the counts this script prints, never against a guess. */
const MIN_AREA_KM2 = 0.01;   // band 0. One hectare. The median body in the box is 0.0037 km².
const MIN_RIVER_KM = 1.0;    // band 0. A river shorter than a kilometre is a drain at zoom 10.
const MID_AREA_KM2 = 0.002;  // band 1. Below this a body waits for zoom 13.
const MID_RIVER_KM = 0.3;    // band 1. Below this a river waits for zoom 13.
/* Coordinate rounding, in decimal places. 4 is about 11 m and 5 is about 1.1 m. This is a FLOOR
   under the tolerance above, not a second tolerance: a grid coarser than the tolerance turns a
   smooth curve into a staircase, whatever Douglas-Peucker left. So keep the grid under the
   tolerance. `--dp=5` overrides it for one run. */
define('COORD_DP', (int) (preg_replace('/^--dp=/', '', implode(' ', preg_grep('/^--dp=/', $argv))) ?: 4));
const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const OUT      = __DIR__ . '/water.json';
const RIVERS   = __DIR__ . '/rivers.json';   // the river lines alone, which js/map.js draws

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

/**
 * The signed shoelace of a ring, in square degrees.
 *
 * Only the SIGN is used. It says which way the ring winds. RFC 7946 requires a polygon's holes to
 * wind opposite its exterior ring. So an island has to wind against the sea around it, to keep the
 * file correct for any consumer.
 */
function signedArea(array $ring): float {
    $s = 0.0;
    for ($i = 0, $j = count($ring) - 1; $i < count($ring); $j = $i++)
        $s += $ring[$j][0] * $ring[$i][1] - $ring[$i][0] * $ring[$j][1];
    return $s / 2;
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

/** The band a shape belongs to, from its own size. 0 draws always, 1 from zoom 11, 2 from zoom 13. */
function band(float $size, float $hi, float $mid): int {
    return $size >= $hi ? 0 : ($size >= $mid ? 1 : 2);
}

// The backwards join cases closed no lake outline that the append-only walk left open. They exist
// for the coastline, which is one chain that the walk can enter in the middle.

/**
 * Chain member ways end to end, and return every chain.
 *
 * A large lake outline is several ways, and each one on its own is an open line. A coastline is the
 * same shape of problem over a much longer chain. So walk each chain end to end and flip a way when
 * it joins backwards. A chain grows at both ends. The first way taken out of the pool can sit
 * anywhere along the chain.
 */
function chains(array $ways): array {
    $out = []; $pool = array_values($ways);
    while ($pool) {
        $cur = array_shift($pool);
        while ($cur[0] !== end($cur)) {
            $joined = false;
            foreach ($pool as $i => $w) {
                if (end($cur) === $w[0])       $cur = array_merge($cur, array_slice($w, 1));
                elseif (end($cur) === end($w)) $cur = array_merge($cur, array_slice(array_reverse($w), 1));
                elseif ($cur[0] === end($w))   $cur = array_merge($w, array_slice($cur, 1));
                elseif ($cur[0] === $w[0])     $cur = array_merge(array_reverse($w), array_slice($cur, 1));
                else continue;
                unset($pool[$i]); $pool = array_values($pool); $joined = true;
                break;
            }
            if (!$joined) break;               // an open chain: it runs off the edge, or it is broken
        }
        $out[] = $cur;
    }
    return $out;
}

/** The chains that close. A lake outline is one of these. */
function rings(array $ways): array {
    $out = [];
    foreach (chains($ways) as $c) if (count($c) > 3 && $c[0] === end($c)) $out[] = $c;
    return $out;
}

/**
 * Build the sea as one polygon with the islands as holes.
 *
 * OpenStreetMap maps the open sea as `natural=coastline`, a directed line with land on the left.
 * There is no sea shape to ask for. So this closes the shore against a meridian west of everything
 * the query returned. All three closing edges lie in open water.
 *
 * The result is one polygon. Ring 0 is the sea. Every later ring is an island, wound against ring 0.
 */
function sea(array $ways, float $tol): array {
    $open = []; $isles = [];
    foreach (chains($ways) as $c) {
        if (count($c) > 3 && $c[0] === end($c)) $isles[] = $c; else $open[] = $c;
    }
    if (count($open) !== 1)
        fail('the coastline walked into ' . count($open) . ' open chains, and one was expected');

    $shore = clean(simplify($open[0], $tol));
    if (count($shore) < 2) fail('the mainland shore holds too few points to close');

    /* Cut the chain back to its own latitude extremes, and keep the piece between them.
       Overpass returns a whole way when any part of it meets the box, so the shore overhangs the
       coverage area. An overhanging end carries a hook that turns back west past the end itself.
       A closing edge drawn at that end latitude then crosses the shore. The ring self-crosses
       there, and no fill rule can repair that.
       Cutting here makes both ends the extremes by construction. So each closing edge below meets
       the shore at its own endpoint and nowhere else. The check under this proves it. */
    $lats = array_column($shore, 1);
    $hi = array_search(max($lats), $lats, true);
    $lo = array_search(min($lats), $lats, true);
    $shore = $hi < $lo
        ? array_slice($shore, $hi, $lo - $hi + 1)
        : array_reverse(array_slice($shore, $lo, $hi - $lo + 1));
    if (count($shore) < 2) fail('the shore holds too few points between its own latitude extremes');

    /* The two closing edges run west at the shore's own end latitudes. The cut above puts no point
       beyond those latitudes, so the only danger left is a point that TIES one of them.
       `array_search` keeps the first of a tie, so a second point at the same latitude survives the
       cut. A tied point west of its own endpoint sits on the closing edge, and the ring then
       crosses itself. Test for that, because no probe of scattered points can find it. */
    $ends = [[0, $shore[0]], [count($shore) - 1, $shore[count($shore) - 1]]];
    foreach ($ends as [$at, $end])
        foreach ($shore as $i => $p)
            if ($i !== $at && $p[1] === $end[1] && $p[0] < $end[0])
                fail('a shore point ties an end latitude and sits west of it, so a closing edge crosses the shore');

    $west  = INF;
    foreach ($shore as $p) $west = min($west, $p[0]);
    foreach ($isles as $r) foreach ($r as $p) $west = min($west, $p[0]);
    $west -= 0.2;                              // clear of every point the query returned

    // Out to the meridian at the far end, up or down it, and back in at the near end.
    $ring   = $shore;
    $ring[] = [$west, end($shore)[1]];
    $ring[] = [$west, $shore[0][1]];
    $ring[] = $shore[0];

    $poly = [$ring];
    $sign = signedArea($ring) <=> 0;
    foreach ($isles as $r) {
        $c = clean(simplify($r, $tol));
        if (count($c) < 4) continue;
        if ($c[0] !== end($c)) $c[] = $c[0];
        if ((signedArea($c) <=> 0) === $sign) $c = array_reverse($c);
        $poly[] = $c;
    }
    return $poly;
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

/* The coastline is its own query and its own cache file. It answers a different question and it
   changes on a different clock, so a tolerance run must not refetch it. */
$RAWC  = sys_get_temp_dir() . '/water-build-coast.json';
$cq    = "[out:json][timeout:300];way[\"natural\"=\"coastline\"]($bbox);out geom;";
$cbody = (in_array('--cached', $argv, true) && is_file($RAWC)) ? file_get_contents($RAWC) : null;
if ($cbody === null) {
    echo "water-build: asking Overpass for the coastline in $bbox\n";
    $ch = curl_init(ENDPOINT);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => http_build_query(['data' => $cq]),
        CURLOPT_TIMEOUT        => 420,
        CURLOPT_USERAGENT      => 'klang-valley-flood-watch/1.0 (water-build.php, run by hand)',
    ]);
    $cbody = curl_exec($ch);
    $ccode = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    if ($cbody === false) fail('curl: ' . curl_error($ch));
    curl_close($ch);
    if ($ccode !== 200) fail("Overpass answered $ccode for the coastline — a 504 is routine, so retry");
    file_put_contents($RAWC, $cbody);
}
$cels = json_decode($cbody, true)['elements'] ?? null;
if (!is_array($cels)) fail('the coastline query returned no elements');

$cways = [];
foreach ($cels as $el) {
    $g = [];
    foreach ($el['geometry'] ?? [] as $p) if ($p) $g[] = [$p['lon'], $p['lat']];
    if (count($g) > 1) $cways[] = $g;
}
$seaPoly = sea($cways, $tol);

// --- trim ----------------------------------------------------------------------------------------

$lines = [[], [], []]; $areas = [[], [], []]; $points = 0;

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
                if ($c[0] !== end($c)) $c[] = $c[0];
                $poly[] = $c; $kept += count($c);
            }
            $inner = [];                       // holes belong to the first ring only
            if (!$poly) continue;
            // The band reads the OUTER ring alone. A lake with a wooded island in it is still a lake
            // the size of its own shore.
            $areas[band(areaKm2($poly[0]), MIN_AREA_KM2, MID_AREA_KM2)][] = $poly;
            $points += $kept;
        }
        continue;
    }

    $g = [];
    foreach ($el['geometry'] ?? [] as $p) if ($p) $g[] = [$p['lon'], $p['lat']];
    if (count($g) < 2) continue;
    $c = clean(simplify($g, $tol));
    if (count($c) < 2) continue;

    if ($isRiver) {
        $lines[band(lineKm($c), MIN_RIVER_KM, MID_RIVER_KM)][] = $c;
        $points += count($c);
        continue;
    }
    if (count($c) < 4) continue;
    if ($c[0] !== end($c)) $c[] = $c[0];
    $areas[band(areaKm2($c), MIN_AREA_KM2, MID_AREA_KM2)][] = [$c];
    $points += count($c);
}

if (!$lines[0] || !$areas[0]) fail('band 0 came back empty — refusing to write the file');

/* Seven features. A GeoJSON property belongs to a feature and not to one geometry inside it.
   So a band is a feature of its own. js/map.js reads `t` and `b` and nothing else. */
$feat = [['type' => 'Feature', 'properties' => ['t' => 'sea'],
          'geometry' => ['type' => 'MultiPolygon', 'coordinates' => [$seaPoly]]]];
for ($b = 0; $b < 3; $b++) {
    $feat[] = ['type' => 'Feature', 'properties' => ['t' => 'line', 'b' => $b],
               'geometry' => ['type' => 'MultiLineString', 'coordinates' => $lines[$b]]];
    $feat[] = ['type' => 'Feature', 'properties' => ['t' => 'area', 'b' => $b],
               'geometry' => ['type' => 'MultiPolygon', 'coordinates' => $areas[$b]]];
}
$json = json_encode(['type' => 'FeatureCollection', 'features' => $feat]);
file_put_contents(OUT, $json);
/* The three river bands alone. js/map.js draws them on the dark theme, and it reads nothing else
   from this build since 2026-09-14. About 241 KB gzipped, against 568 KB for the whole file. */
file_put_contents(RIVERS, json_encode(['type' => 'FeatureCollection', 'features' =>
    array_values(array_filter($feat, fn($f) => $f['properties']['t'] === 'line'))]));

printf("water-build: %d islands, %d points, %d KB on disk, about %d KB gzipped\n",
       count($seaPoly) - 1, $points, strlen($json) / 1024, strlen(gzencode($json, 9)) / 1024);
for ($b = 0; $b < 3; $b++)
    printf("water-build:   band %d: %d rivers, %d water bodies\n", $b, count($lines[$b]), count($areas[$b]));
echo "water-build: commit water.json. js/map.js fetches it by name, so there is no ?v= to bump.\n";
