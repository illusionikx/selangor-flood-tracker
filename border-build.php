<?php
/**
 * php border-build.php — bakes border.json, the outline of the coverage area.
 *
 * The map used to run on forever. A reader could zoom out to the whole world, and the pins then sat
 * on a continent with no way to tell which part of it this app answers for. js/map.js shades
 * everything outside this outline now, and it takes the zoom floor and the pan limit off the same
 * file. So one shape answers three questions and nothing holds a fourth copy of the coverage area.
 *
 * The shape is Selangor's own outer rings, from OpenStreetMap. Kuala Lumpur and Putrajaya are
 * enclaves inside Selangor, so they arrive as INNER rings of that relation. This script drops every
 * inner ring, which fills both of them back in. That is why it does not fetch their own relations.
 * See the winding note on `rings` below for what goes wrong when it does.
 *
 * Run this by hand and commit the result. It is not part of any request path. Overpass is a free
 * service with no funding for a poller, and a state border moves about once a generation. A 504
 * under load is routine. This script writes nothing when that happens, so retry.
 *
 * The three geometry helpers below are copied from water-build.php rather than shared. That file is
 * a standalone script that runs its whole job on include, so it cannot be required from here.
 */

const TOL_DEG  = 0.0005;   // Douglas-Peucker tolerance, about 55 m. Coarser than water-build.php's
                           // 33 m, because this draws one edge rather than 6,000 shapes, and no
                           // reader inspects a state border at zoom 18.
const COORD_DP = 4;        // About 11 m per unit, the same as water.json.
const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const OUT      = __DIR__ . '/border.json';

/* Two points that must land inside the result. Kuala Lumpur and Putrajaya are the enclaves this
   script fills in by dropping inner rings, so they are the exact thing a silent failure would lose.
   A wrong outline is not an error anywhere: the map still draws, and the shading simply eats a
   capital city. */
const INSIDE = [
    'Kuala Lumpur' => [101.6869, 3.1390],
    'Putrajaya'    => [101.6964, 2.9264],
];

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
    fwrite(STDERR, "border-build: $why\n");
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
 * A state border is split across hundreds of ways, and each one on its own is an open line. So walk
 * each chain end to end, flipping a way when it joins backwards, and keep only what actually closes.
 *
 * **Only the outer rings reach the file, and the winding rule is why.** SVG fills by the nonzero
 * rule. The mask is one world-sized ring with the coverage punched out of it as a hole. Two holes
 * that OVERLAP wind to -1 rather than to 0, so the overlap fills back in. Kuala Lumpur punched as
 * its own hole inside Selangor's hole is exactly that case, and it draws the capital shaded. One
 * hole per outer ring, with the inner rings dropped, cannot reach that state.
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

/**
 * Chain ways end to end WITHOUT requiring the result to close, and return the longest chain.
 *
 * `rings()` above keeps only what closes, which is right for a lake and wrong for the land half of
 * a state border. Dropping the sea ways leaves the land boundary as an open arc from one end of the
 * coast to the other, and that arc is the thing this needs.
 */
function longestChain(array $ways): array {
    $best = []; $pool = array_values($ways);
    while ($pool) {
        $cur = array_shift($pool);
        $grew = true;
        while ($grew) {
            $grew = false;
            foreach ($pool as $i => $w) {
                if (end($cur) === $w[0])       $cur = array_merge($cur, array_slice($w, 1));
                elseif (end($cur) === end($w)) $cur = array_merge($cur, array_slice(array_reverse($w), 1));
                elseif ($cur[0] === end($w))   $cur = array_merge($w, array_slice($cur, 1));
                elseif ($cur[0] === $w[0])     $cur = array_merge(array_reverse($w), array_slice($cur, 1));
                else continue;
                unset($pool[$i]); $pool = array_values($pool); $grew = true;
                break;
            }
        }
        if (count($cur) > count($best)) $best = $cur;
    }
    return $best;
}

/**
 * Area centroid of a closed ring, as [lng, lat].
 *
 * The mean of the points is NOT this, and the difference is the whole reason for the formula. A
 * border carries its vertices where it wiggles, so a mean is pulled toward the fiddly stretches and
 * away from the plain ones. The area centroid asks where the shape balances instead.
 */
function centroid(array $ring): array {
    $a = 0.0; $cx = 0.0; $cy = 0.0;
    for ($i = 0, $j = count($ring) - 1; $i < count($ring); $j = $i++) {
        $f = $ring[$j][0] * $ring[$i][1] - $ring[$i][0] * $ring[$j][1];
        $a += $f;
        $cx += ($ring[$j][0] + $ring[$i][0]) * $f;
        $cy += ($ring[$j][1] + $ring[$i][1]) * $f;
    }
    if (abs($a) < 1e-12) fail('the land ring has no area — the chain did not close');
    return [$cx / (3 * $a), $cy / (3 * $a)];
}

/** Distance in kilometres between two [lng, lat] pairs. */
function km(array $p, array $q): float {
    $k = 111.32 * cos(($p[1] + $q[1]) / 2 * M_PI / 180);
    return hypot(($p[0] - $q[0]) * $k, ($p[1] - $q[1]) * 110.57);
}

/** Ray casting. Answers whether a point sits inside any one of the rings. */
function inside(array $rings, array $pt): bool {
    [$x, $y] = $pt;
    foreach ($rings as $r) {
        $in = false;
        for ($i = 0, $j = count($r) - 1; $i < count($r); $j = $i++) {
            [$xi, $yi] = $r[$i]; [$xj, $yj] = $r[$j];
            if (($yi > $y) !== ($yj > $y)
                && $x < ($xj - $xi) * ($y - $yi) / ($yj - $yi) + $xi) $in = !$in;
        }
        if ($in) return true;
    }
    return false;
}

// --- fetch ---------------------------------------------------------------------------------------

[$w, $n, $e, $s] = box();
$bbox = sprintf('%f,%f,%f,%f', $s, $w, $n, $e);

/* `admin_level=4` is a state or a federal territory in Malaysia. The name filter keeps the answer to
   one relation, because the box also holds Perak, Pahang and Negeri Sembilan. */
$query = "[out:json][timeout:300];"
       . "relation[\"boundary\"=\"administrative\"][\"admin_level\"=\"4\"][\"name\"=\"Selangor\"]($bbox);"
       . "out geom;";

echo "border-build: asking Overpass for Selangor in $bbox\n";

$ch = curl_init(ENDPOINT);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => http_build_query(['data' => $query]),
    CURLOPT_TIMEOUT        => 420,
    // Overpass asks every client to identify itself, and throttles the ones that do not.
    CURLOPT_USERAGENT      => 'klang-valley-flood-watch/1.0 (border-build.php, run by hand)',
]);
$body = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
if ($body === false) fail('curl: ' . curl_error($ch));
curl_close($ch);
if ($code !== 200) fail("Overpass answered $code — a 504 is routine under load, so try again");

$els = json_decode($body, true)['elements'] ?? null;
if (!is_array($els)) fail('Overpass returned no elements — the query or the service changed');
$rel = null;
foreach ($els as $el) if (($el['type'] ?? '') === 'relation') { $rel = $el; break; }
if (!$rel) fail('no relation came back — check the name and the admin_level in the query');

printf("border-build: relation %d, %s\n", $rel['id'], $rel['tags']['name'] ?? '(no name)');

/* A second call, for the member ways' TAGS. `out geom` gives a relation's members with their
   geometry and their role, and with no tags at all. The sea boundary is what this needs to find,
   and OpenStreetMap marks it `maritime=yes` on the way. Measured 2026-09-02: 14 of Selangor's 136
   member ways carry it. */
echo "border-build: asking Overpass for the member way tags\n";
$ch = curl_init(ENDPOINT);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => http_build_query(
        ['data' => "[out:json][timeout:180];rel({$rel['id']});way(r);out tags;"]),
    CURLOPT_TIMEOUT        => 240,
    CURLOPT_USERAGENT      => 'klang-valley-flood-watch/1.0 (border-build.php, run by hand)',
]);
$tagBody = curl_exec($ch);
$tagCode = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
if ($tagBody === false) fail('curl: ' . curl_error($ch));
curl_close($ch);
if ($tagCode !== 200) fail("Overpass answered $tagCode on the tag query — try again");
$tagEls = json_decode($tagBody, true)['elements'] ?? null;
if (!is_array($tagEls)) fail('the tag query returned no elements');

$sea = [];
foreach ($tagEls as $w) if (($w['tags']['maritime'] ?? '') === 'yes') $sea[$w['id']] = true;
if (!$sea) fail('no member way is tagged maritime=yes — the tagging changed, so read it by hand '
              . 'before trusting a circle placed on this data');
printf("border-build: %d of %d member ways are sea\n", count($sea), count($tagEls));

// --- build ---------------------------------------------------------------------------------------

$outer = []; $land = [];
foreach ($rel['members'] ?? [] as $m) {
    if (($m['role'] ?? '') === 'inner') continue;   // see the winding note on rings()
    $g = [];
    foreach ($m['geometry'] ?? [] as $p) if ($p) $g[] = [$p['lon'], $p['lat']];
    if (count($g) < 2) continue;
    $outer[] = $g;
    if (!isset($sea[$m['ref']])) $land[] = $g;      // the same way, minus the sea boundary
}
if (!$outer) fail('the relation carries no outer way with geometry');
if (!$land)  fail('every member way is sea — the tag query and the geometry query disagree');

$raw = rings($outer);
if (!$raw) fail('no outer ring closed — the relation is broken upstream, so try again later');

$polys = []; $points = 0;
foreach ($raw as $r) {
    $c = clean(simplify($r, TOL_DEG));
    if (count($c) < 4) continue;
    if ($c[0] !== end($c)) $c[] = $c[0];            // rounding can unclose a ring
    $polys[] = [$c]; $points += count($c);
}
if (!$polys) fail('every ring collapsed under the tolerance — lower TOL_DEG');

/* The enclave check. A silent failure here shades a capital city, and nothing else in the app would
   ever say so. */
$flat = array_map(fn($p) => $p[0], $polys);
foreach (INSIDE as $name => $pt)
    if (!inside($flat, $pt)) fail("$name fell outside the outline — the inner rings were not dropped");

$bounds = [$polys[0][0][0][0], $polys[0][0][0][1], $polys[0][0][0][0], $polys[0][0][0][1]];
foreach ($polys as $p) foreach ($p[0] as [$x, $y]) {
    $bounds[0] = min($bounds[0], $x); $bounds[1] = min($bounds[1], $y);
    $bounds[2] = max($bounds[2], $x); $bounds[3] = max($bounds[3], $y);
}

/* --- the land ring, and the circle that sits on it ---------------------------------------------
   **The circle is placed and sized on LAND alone, and the whole outline is why it has to be.**
   Selangor's boundary reaches into the Strait of Malacca. A circle drawn from the whole shape sat
   with about 55% of its area on water, because the sea half pulls the centre west and sets the
   radius. The repository owner asked for a circle on the land on 2026-09-02.
   Dropping the sea ways leaves the land border as one open arc, from the north end of the coast to
   the south end. Closing that arc with a straight chord gives a polygon that is Selangor's land with
   a straight west edge. The real coast is inside that chord, so the ring is a little generous on the
   seaward side and exact everywhere else. That is the right way to be wrong here: a circle that
   covers a strip of shore is honest, and one that clips Klang is not. */
$arc = longestChain($land);
if (count($arc) < 4) fail('the land ways did not chain — the relation changed upstream');
$ring = clean(simplify($arc, TOL_DEG));
if ($ring[0] !== end($ring)) $ring[] = $ring[0];    // the chord that stands in for the coast

[$cx, $cy] = centroid($ring);
$radius = 0.0;
foreach ($ring as $p) $radius = max($radius, km([$cx, $cy], $p));

/* Both enclaves have to be inside the CIRCLE as well, not only inside the outline. The circle is
   what a reader sees, and a capital city outside it is shaded. */
foreach (INSIDE as $name => $pt)
    if (km([$cx, $cy], $pt) > $radius)
        fail(sprintf('%s is %.1f km out against a %.1f km radius — the land ring is wrong',
                     $name, km([$cx, $cy], $pt), $radius));

/* `bounds` rides on the file as [west, south, east, north]. `circle` is [lat, lng, km] and is what
   js/map.js actually draws: the client does no geometry, because the sea has to be excluded and
   only this script knows which ways are sea. The full outline stays in `features` so the check page
   can ask whether the circle still holds the land it was built from. */
$json = json_encode([
    'type' => 'FeatureCollection',
    'bounds' => $bounds,
    'circle' => [round($cy, 5), round($cx, 5), round($radius, 2)],
    'features' => [
        ['type' => 'Feature', 'properties' => ['t' => 'cover'],
         'geometry' => ['type' => 'MultiPolygon', 'coordinates' => $polys]],
        ['type' => 'Feature', 'properties' => ['t' => 'land'],
         'geometry' => ['type' => 'Polygon', 'coordinates' => [$ring]]],
    ],
]);
file_put_contents(OUT, $json);

printf("border-build: %d ring(s), %d points, %d KB on disk, about %d KB gzipped\n",
       count($polys), $points, strlen($json) / 1024, strlen(gzencode($json, 9)) / 1024);
printf("border-build: bounds west %.4f south %.4f east %.4f north %.4f\n", ...$bounds);
printf("border-build: land ring %d points, circle %.5f, %.5f radius %.2f km\n",
       count($ring), $cy, $cx, $radius);
echo "border-build: commit border.json. js/map.js fetches it by name, so there is no ?v= to bump.\n";
