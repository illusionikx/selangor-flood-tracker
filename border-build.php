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

// --- build ---------------------------------------------------------------------------------------

$outer = [];
foreach ($rel['members'] ?? [] as $m) {
    if (($m['role'] ?? '') === 'inner') continue;   // see the winding note on rings()
    $g = [];
    foreach ($m['geometry'] ?? [] as $p) if ($p) $g[] = [$p['lon'], $p['lat']];
    if (count($g) >= 2) $outer[] = $g;
}
if (!$outer) fail('the relation carries no outer way with geometry');

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

/* `bounds` rides on the file as [west, south, east, north], because js/map.js needs the extent
   before it needs the shape: the zoom floor and the pan limit come off it. Reading it here costs
   nothing and saves the client a pass over every point on every load. */
$json = json_encode(['type' => 'FeatureCollection', 'bounds' => $bounds, 'features' => [
    ['type' => 'Feature', 'properties' => ['t' => 'cover'],
     'geometry' => ['type' => 'MultiPolygon', 'coordinates' => $polys]],
]]);
file_put_contents(OUT, $json);

printf("border-build: %d ring(s), %d points, %d KB on disk, about %d KB gzipped\n",
       count($polys), $points, strlen($json) / 1024, strlen(gzencode($json, 9)) / 1024);
printf("border-build: bounds west %.4f south %.4f east %.4f north %.4f\n", ...$bounds);
echo "border-build: commit border.json. js/map.js fetches it by name, so there is no ?v= to bump.\n";
