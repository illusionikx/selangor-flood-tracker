# Water as the subject of the map — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make water the subject of this map. Draw the sea, bring back the small water behind a zoom
rule, and paint water on both themes.

**Architecture:** The mechanism does not change. `water-build.php` asks Overpass, writes `water.json`,
and `js/map.js` draws that file on a canvas pane under the pins. This plan changes what the file
holds and how the layer paints it. The file grows from two features to seven. Three features carry
rivers, one per zoom band. Three carry water bodies the same way. One carries the sea.

**Tech Stack:** PHP 8 with curl, Overpass API, Leaflet 1.9 with its canvas renderer, plain CSS custom
properties. No build step. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-09-water-as-subject-design.md`

## Global Constraints

- Write every comment and every document in Simplified Technical English. See `CLAUDE.md`.
- Never write a hex color into a JavaScript file. Read `--water` from CSS. See `CLAUDE.md`.
- The dark `--water` stays at `#15364e`. Do not change it in any task.
- Water keeps hue 238 in OKLCh. No status hue enters the map.
- Run `water-build.php` by hand. It must never run in a request path.
- Pass `--cached` to `water-build.php` in every step of this plan. Overpass is a free service.
- The browser contacts this origin and the Esri tiles. Add no third host.
- Commit after every task.
- The headless check command is one line. Use it exactly:

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --ignore-certificate-errors --virtual-time-budget=40000 --window-size=1200,900 --dump-dom \
  https://flood-exp.test/map-limits-test.html | perl -0777 -ne 'print $1 if /<pre id="out">([^<]*)</s'
```

## File structure

| file | responsibility after this plan |
|---|---|
| `water-build.php` | asks Overpass twice, walks ways into chains, closes the sea, stamps a band, writes seven features |
| `water.json` | seven features. Three river bands, three body bands, one sea |
| `js/map.js` | one canvas renderer, three band groups, one sea layer, a `zoomend` handler, a repaint on theme change |
| `css/base.css` | `--water` on both themes |
| `map-limits-test.html` | asserts the bands, the sea, and both themes |
| `docs/FEATURES.md` | one entry for the whole change |
| `CLAUDE.md` | the file table row for `water.json`, and the gotcha index |

---

### Task 1: One way-walker, used by both the lake code and the coastline code

`rings()` walks member ways into closed rings and throws away anything that does not close. The
coastline needs the open chain that `rings()` throws away. So the walk becomes its own function and
`rings()` filters what it returns.

The walk also gains two join cases. Today it only appends to the end of the chain. A coastline walk
that starts in the middle of the shore must also grow backwards, or it stops at the first end and
leaves the rest of the shore in the pool.

**Files:**
- Modify: `water-build.php:141-159`

**Interfaces:**
- Produces: `chains(array $ways): array` returns every walked chain, closed or open. Each chain is a
  list of `[lon, lat]` pairs.
- Produces: `rings(array $ways): array` keeps the chains that close. Signature and meaning unchanged.

- [ ] **Step 1: Record what the current bake produces**

```bash
cd /d/Herd/flood-exp
php water-build.php --cached
```

Write down the printed line. It must read `866 rivers, 1185 water bodies`.

- [ ] **Step 2: Replace `rings()` with `chains()` plus a filter**

Replace `water-build.php:134-159` with this.

```php
/**
 * Chain member ways end to end, and return every chain.
 *
 * A large lake outline is several ways, and each one on its own is an open line. A coastline is the
 * same shape of problem over a much longer chain. So walk each chain end to end and flip a way when
 * it joins backwards. A chain grows at both ends, because the first way taken out of the pool can
 * sit anywhere along the chain.
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
```

- [ ] **Step 3: Rebake and compare the counts**

```bash
php water-build.php --cached
```

Expected: the river count is exactly `866`. Rivers are ways and this walk never touches them.

Expected: the water body count is `1185` or higher. The two new join cases can only close a ring
that stayed open before. They can never open one that closed.

If the body count fell, stop. The walk has a fault and the plan cannot continue.

- [ ] **Step 4: Record the delta in the file**

If the body count rose, add this comment above `chains()`, with the real number in place of `N`.

```php
// The backwards join cases closed N lake outlines that the append-only walk left open.
```

If the count did not move, add this comment instead.

```php
// The backwards join cases closed no lake outline that the append-only walk left open. They exist
// for the coastline, which is one chain that the walk can enter in the middle.
```

- [ ] **Step 5: Commit**

```bash
git add water-build.php water.json
git commit -m "refactor: one way-walker for lakes and the coastline

rings() threw away the open chains. The coastline is an open chain, so
the walk becomes chains() and rings() filters what it returns.

The walk also grows a chain backwards now. A coastline walk that starts
in the middle of the shore stops at one end otherwise, and leaves the
rest of the shore in the pool.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The sea and the estuary

One more Overpass query for `natural=coastline`. The build walks it with `chains()`. The closed
chains are islands. The one open chain is the mainland shore, cut where it leaves the query box. The
build closes that chain out to the west, which is where the Strait of Malacca is.

Measured on 2026-09-09: the query returns 276 ways, 15,235 points and exactly two open chain ends.

**Files:**
- Modify: `water-build.php` — a second query, a sea builder, a third output feature

**Interfaces:**
- Consumes: `chains()` from Task 1.
- Produces: a third feature in `water.json` with the property `t` set to `sea`. Its geometry is a
  `MultiPolygon` holding one polygon. Ring 0 is the sea. Every later ring is an island.

- [ ] **Step 1: Add the signed area helper**

`areaKm2()` returns a size and drops the sign. A hole has to wind against its outer ring, so the sea
builder needs the sign. Add this next to `areaKm2()` in `water-build.php`.

```php
/**
 * The signed shoelace of a ring, in square degrees.
 *
 * Only the SIGN is used. It says which way the ring winds. Leaflet fills a polygon with the nonzero
 * rule, so an island has to wind against the sea around it or it paints as more sea.
 */
function signedArea(array $ring): float {
    $s = 0.0;
    for ($i = 0, $j = count($ring) - 1; $i < count($ring); $j = $i++)
        $s += $ring[$j][0] * $ring[$i][1] - $ring[$i][0] * $ring[$j][1];
    return $s / 2;
}
```

- [ ] **Step 2: Add the coastline query and the sea builder**

Add this after the `rings()` function.

```php
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
```

- [ ] **Step 3: Fetch the coastline**

Add this after the block that fetches the water query, next to the `$RAW` line.

```php
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
```

- [ ] **Step 4: Write the third feature**

Replace the `$json = json_encode(...)` call with this.

```php
$json = json_encode(['type' => 'FeatureCollection', 'features' => [
    ['type' => 'Feature', 'properties' => ['t' => 'sea'],
     'geometry' => ['type' => 'MultiPolygon', 'coordinates' => [$seaPoly]]],
    ['type' => 'Feature', 'properties' => ['t' => 'line'],
     'geometry' => ['type' => 'MultiLineString', 'coordinates' => $lines]],
    ['type' => 'Feature', 'properties' => ['t' => 'area'],
     'geometry' => ['type' => 'MultiPolygon', 'coordinates' => $areas]],
]]);
```

Add the sea to the printed line.

```php
printf("water-build: %d rivers, %d water bodies, %d islands, %d points, %d KB on disk, about %d KB gzipped\n",
       count($lines), count($areas), count($seaPoly) - 1, $points,
       strlen($json) / 1024, strlen(gzencode($json, 9)) / 1024);
```

- [ ] **Step 5: Rebake and read the counts**

```bash
php water-build.php --cached
```

Expected: the run does not call `fail()`. The island count is 1 or more. The gzipped size is about
420 KB, which is the 402 KB before this task plus the sea.

A `fail()` on the open chain count means the coastline broke into fragments. Print the count of each
chain and find which two do not join.

- [ ] **Step 6: Prove the sea covers water and not land**

```bash
php -r '
$g = json_decode(file_get_contents("water.json"), true);
$p = null;
foreach ($g["features"] as $f) if ($f["properties"]["t"] === "sea") $p = $f["geometry"]["coordinates"][0];
if (!$p) { echo "no sea feature\n"; exit(1); }
function inRing($ring, $x, $y) {
    $in = false;
    for ($i = 0, $j = count($ring) - 1; $i < count($ring); $j = $i++) {
        if (($ring[$i][1] > $y) !== ($ring[$j][1] > $y) &&
            $x < ($ring[$j][0] - $ring[$i][0]) * ($y - $ring[$i][1]) /
                 ($ring[$j][1] - $ring[$i][1]) + $ring[$i][0]) $in = !$in;
    }
    return $in;
}
$probe = [["open sea west of Klang", 101.05, 3.02, true],
          ["Kuala Lumpur", 101.6869, 3.1390, false],
          ["Shah Alam", 101.5183, 3.0733, false]];
$bad = 0;
foreach ($probe as [$name, $x, $y, $want]) {
    $got = inRing($p[0], $x, $y);
    printf("%-24s want %s got %s\n", $name, $want ? "sea" : "land", $got ? "sea" : "land");
    if ($got !== $want) $bad++;
}
exit($bad ? 1 : 0);'
```

Expected: three lines, every `want` matching every `got`, and exit code 0.

A land point reported as sea means the closing ring wound the wrong way round the shore. Swap the
order of the two `[$west, ...]` points in `sea()` and run this step again.

- [ ] **Step 7: Commit**

```bash
git add water-build.php water.json
git commit -m "feat: bake the sea and the estuary from natural=coastline

OpenStreetMap maps the open sea as a directed line, not as a shape, so
Overpass cannot answer with one. This walks the coastline into
chains, takes the single open chain as the mainland shore, and closes it
against a meridian west of every point returned. Islands become holes.

The Klang tidal channels arrive with it, because that water is coastline
and not natural=water.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The size floors become zoom bands

`MIN_AREA_KM2` and `MIN_RIVER_KM` delete a shape today. They stop deleting. Each shape gets a band
from its own size, and `js/map.js` draws the band the zoom admits.

Measured on 2026-09-09: the whole set is 2,775 rivers and 6,394 bodies, at 543 KB gzipped against
402 KB for the cut set. The floors bought a picture and not a file size. The picture they bought is
zoom 10, where 2,775 rivers draw as a blue web.

**Files:**
- Modify: `water-build.php` — two more constants, a band function, six output features

**Interfaces:**
- Produces: six features. `t` is `line` or `area`. `b` is `0`, `1` or `2`.
- Produces: band 0 holds what the map draws today. Band 1 holds the next size down. Band 2 holds the
  rest.

- [ ] **Step 1: Turn the floors into band edges**

Replace the two floor constants and their comment block in `water-build.php:38-47` with this.

```php
/* THE SIZE FLOORS ARE BAND EDGES NOW, AND THEY NO LONGER DELETE A SHAPE.
   They deleted one until 2026-09-09. The reason was never the file size. Measured across five
   settings, the whole set holds 3.2 times the shapes for 35 percent more bytes. The reason was the
   picture: 2,775 rivers drew as a blue web over the whole state at zoom 10, and answered no question
   a reader had.
   A zoom answers that instead. Band 0 is what the map drew under the old floors, and it draws at
   every zoom. Band 1 joins it at zoom 11 and band 2 at zoom 13. See `BAND_MIN` in js/map.js.
   Tune these against the counts this script prints, never against a guess. */
const MIN_AREA_KM2 = 0.01;   // band 0. One hectare. The median body in the box is 0.0037 km².
const MIN_RIVER_KM = 1.0;    // band 0. A river shorter than a kilometre is a drain at zoom 10.
const MID_AREA_KM2 = 0.002;  // band 1. Below this a body waits for zoom 13.
const MID_RIVER_KM = 0.3;    // band 1. Below this a river waits for zoom 13.
```

- [ ] **Step 2: Add the band function**

Add this next to `lineKm()`.

```php
/** The band a shape belongs to, from its own size. 0 draws always, 1 from zoom 11, 2 from zoom 13. */
function band(float $size, float $hi, float $mid): int {
    return $size >= $hi ? 0 : ($size >= $mid ? 1 : 2);
}
```

- [ ] **Step 3: Stamp a band instead of cutting**

Replace the trim block at `water-build.php:207-254`. Keep every line that is not shown here.

```php
$lines = [[], [], []]; $areas = [[], [], []]; $points = 0;

foreach ($els as $el) {
    $isRiver = ($el['tags']['waterway'] ?? '') === 'river';

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
```

Delete the `$cut` array and the line that printed it. Nothing is cut any more.

- [ ] **Step 4: Write the seven features**

Replace the `$json = json_encode(...)` call from Task 2 with this.

```php
/* Seven features. A GeoJSON property belongs to a feature and not to one geometry inside it, so a
   band is a feature of its own. js/map.js reads `t` and `b` and nothing else. */
$feat = [['type' => 'Feature', 'properties' => ['t' => 'sea'],
          'geometry' => ['type' => 'MultiPolygon', 'coordinates' => [$seaPoly]]]];
for ($b = 0; $b < 3; $b++) {
    $feat[] = ['type' => 'Feature', 'properties' => ['t' => 'line', 'b' => $b],
               'geometry' => ['type' => 'MultiLineString', 'coordinates' => $lines[$b]]];
    $feat[] = ['type' => 'Feature', 'properties' => ['t' => 'area', 'b' => $b],
               'geometry' => ['type' => 'MultiPolygon', 'coordinates' => $areas[$b]]];
}
$json = json_encode(['type' => 'FeatureCollection', 'features' => $feat]);
```

Replace the printed line with this.

```php
printf("water-build: %d islands, %d points, %d KB on disk, about %d KB gzipped\n",
       count($seaPoly) - 1, $points, strlen($json) / 1024, strlen(gzencode($json, 9)) / 1024);
for ($b = 0; $b < 3; $b++)
    printf("water-build:   band %d: %d rivers, %d water bodies\n", $b, count($lines[$b]), count($areas[$b]));
```

- [ ] **Step 5: Rebake and check the counts against the measurement**

```bash
php water-build.php --cached
```

Expected, from the measurement in the spec:

| band | rivers | water bodies |
|---|---|---|
| 0 | 866 | 1185 |
| 1 | 470 | 3051 |
| 2 | 1439 | 2158 |

Expected: about 560 KB gzipped.

The three river counts must add to 2,775. The three body counts must add to 6,394.

- [ ] **Step 6: Commit**

```bash
git add water-build.php water.json
git commit -m "feat: the water size floors become zoom bands

MIN_AREA_KM2 and MIN_RIVER_KM deleted 1,909 rivers and 5,209 water
bodies. Measured across five settings, the whole set costs 35% more
gzipped for 3.2 times the shapes, so the floors never bought bytes. They
bought zoom 10 not looking like a blue web.

A zoom answers that instead. Each shape carries a band from its own
size. js/map.js draws the band the zoom admits.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The map draws the sea and the bands

`setWater()` draws one layer on the dark theme. It becomes four layers: the sea, and one group per
band. A `zoomend` handler adds and removes a group.

**Files:**
- Modify: `js/map.js:440-492` and `js/map.js:494-509`
- Modify: `map-limits-test.html:49-53` and `map-limits-test.html:182-213`

**Interfaces:**
- Consumes: `water.json` with seven features, from Task 3.
- Produces: `export const waterBands` from `js/map.js`. An array of three `L.LayerGroup`, indexed by
  band. `map.hasLayer(waterBands[b])` answers whether that band draws.

- [ ] **Step 1: Write the failing assertions**

Replace `map-limits-test.html:49-53` with this.

```javascript
/* HALF the band-0 edges water-build.php states, on purpose. This asserts that the edges EXIST, never
   that they hold one value. Raising either constant must not turn this page red, and deleting them
   must. Hard-coding the real numbers here would put a copy of a PHP constant in a JavaScript file,
   with nothing to keep the two together. */
const FLOOR_RIVER_KM = 0.5, FLOOR_AREA_KM2 = 0.005;

/* The zoom each band starts at, restated from js/map.js. Three views probe three answers. */
const BAND_MIN = [0, 11, 13];

/* Open sea west of the Klang estuary, and two places nobody can mistake for water. */
const SEA_AT = [3.02, 101.05], LAND_AT = [3.1390, 101.6869];
```

Replace `map-limits-test.html:205-213` with this.

```javascript
  const water = await (await fetch('water.json')).json();
  const feat = (t, b) => water.features.find(f => f.properties.t === t && f.properties.b === b);

  // --- the bands -----------------------------------------------------------------------------

  const lines0 = feat('line', 0).geometry.coordinates;
  const areas0 = feat('area', 0).geometry.coordinates;
  const shortest = Math.min(...lines0.map(lineKm));
  const smallest = Math.min(...areas0.map(p => areaKm2(p[0])));
  ok('no band 0 river under the edge', shortest >= FLOOR_RIVER_KM,
     lines0.length + ' rivers, shortest ' + shortest.toFixed(2) + ' km, edge ' + FLOOR_RIVER_KM);
  ok('no band 0 water body under the edge', smallest >= FLOOR_AREA_KM2,
     areas0.length + ' bodies, smallest ' + smallest.toFixed(4) + ' km2, edge ' + FLOOR_AREA_KM2);

  /* Every band has to carry shapes. A bake that stamped every shape band 0 would pass the two
     assertions above and put the deleted water back on zoom 10, which is the fault the bands exist
     to stop. */
  for (let b = 0; b < 3; b++)
    ok('band ' + b + ' carries shapes',
       feat('line', b).geometry.coordinates.length > 0 &&
       feat('area', b).geometry.coordinates.length > 0,
       feat('line', b).geometry.coordinates.length + ' rivers, ' +
       feat('area', b).geometry.coordinates.length + ' bodies');

  /* Band 2 must hold water smaller than band 0 refuses. Otherwise the bands are a relabelling of one
     set and the small water never came back. */
  const small2 = Math.min(...feat('area', 2).geometry.coordinates.map(p => areaKm2(p[0])));
  ok('band 2 holds water the old floor cut', small2 < FLOOR_AREA_KM2,
     'smallest band 2 body ' + small2.toFixed(5) + ' km2');

  // --- the sea -------------------------------------------------------------------------------

  const seaRings = water.features.find(f => f.properties.t === 'sea').geometry.coordinates[0];
  ok('the sea is one polygon with islands as holes', seaRings.length > 1,
     'ring 0 plus ' + (seaRings.length - 1) + ' islands');

  /* Ray casting, so this reads the shape rather than a claim about it. A sea that swallowed the
     whole box and a sea that never closed both draw as a plausible picture. */
  const inRing = (ring, x, y) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
      if ((ring[i][1] > y) !== (ring[j][1] > y) &&
          x < (ring[j][0] - ring[i][0]) * (y - ring[i][1]) / (ring[j][1] - ring[i][1]) + ring[i][0])
        inside = !inside;
    return inside;
  };
  ok('open water is inside the sea', inRing(seaRings[0], SEA_AT[1], SEA_AT[0]),
     SEA_AT[1] + ', ' + SEA_AT[0]);
  ok('Kuala Lumpur is outside the sea', !inRing(seaRings[0], LAND_AT[1], LAND_AT[0]),
     LAND_AT[1] + ', ' + LAND_AT[0]);

  // --- the zoom rule -------------------------------------------------------------------------

  const { waterBands } = await import('./js/map.js');

  /* The floor is computed from the coverage circle and the window, so it is not a literal. Read it.
     `setZoom` rather than `setView`, because the pan box can refuse a centre and then the assertions
     below would report a band rule that is really a pan limit. */
  const zmin = map.getMinZoom();

  /* Both answers have to be exercised, or this block only ever proves that a band draws. The floor
     has to sit under band 1 for the "stays off" case to run at all. If the circle ever pushes the
     floor past 11, this line goes red and says why the block below lost its teeth. */
  ok('the zoom floor sits under band 1', zmin < BAND_MIN[1],
     'floor ' + zmin + ', band 1 starts at ' + BAND_MIN[1]);

  for (const z of [zmin, 12, 15]) {
    map.setZoom(z);
    await settle(400);
    for (let b = 0; b < 3; b++)
      ok('zoom ' + z + ' band ' + b + (z >= BAND_MIN[b] ? ' draws' : ' stays off'),
         map.hasLayer(waterBands[b]) === (z >= BAND_MIN[b]),
         'hasLayer ' + map.hasLayer(waterBands[b]));
  }
```

- [ ] **Step 2: Run the check and watch it fail**

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --ignore-certificate-errors --virtual-time-budget=40000 --window-size=1200,900 --dump-dom \
  https://flood-exp.test/map-limits-test.html | perl -0777 -ne 'print $1 if /<pre id="out">([^<]*)</s'
```

Expected: `THREW` with a message naming `waterBands`, because `js/map.js` does not export it yet.

- [ ] **Step 3: Replace the water layer**

Replace `js/map.js:440-492` with this.

```javascript
/* Three bands, and the zoom each one starts at. A shape carries its band from its own size, stamped
   at bake time. See water-build.php. Band 0 is what this map drew when the sizes were floors that
   deleted a shape. 2,775 rivers at one zoom is a blue web, and these three numbers are what stops it
   without deleting the water that answers a question close in. */
const BAND_MIN = [0, 11, 13];

/* A river thins with its band. Band 2 holds 1,439 rivers, and a 1.4 px line on all of them is the
   same web at zoom 13 that the floors used to remove from zoom 10. */
const BAND_WEIGHT = [1.4, 1.1, 0.8];

/* One group per band, made here so `waterBands[b]` is a stable reference before the fetch lands. */
export const waterBands = [L.layerGroup(), L.layerGroup(), L.layerGroup()];

let waterGeo, seaLayer, asking;

/* Read at paint time, never at import time. The token differs by theme and a reader can change the
   theme while the page is open. One colour for the sea, a pond and a river: a drawn pond beside a
   drawn sea has to be the same water. A pond is a fill with no stroke, because an outline on a shape
   this small is most of the shape. */
const waterStyle = f => {
  const c = getComputedStyle(document.documentElement).getPropertyValue('--water').trim();
  return f.properties.t === 'line'
    ? { color: c, weight: BAND_WEIGHT[f.properties.b], opacity: 1 }
    : { stroke: false, fillColor: c, fillOpacity: 1 };
};

// Canvas rather than SVG: 9,169 shapes is 9,169 DOM nodes to carry through every pan and zoom.
function buildWater() {
  const renderer = L.canvas({ pane: 'water' });
  for (const f of waterGeo.features) {
    const layer = L.geoJSON(f, { renderer, interactive: false, style: waterStyle });
    if (f.properties.t === 'sea') { seaLayer = layer.addTo(map); continue; }
    waterBands[f.properties.b].addLayer(layer);
  }
  syncBands();
}

/* The zoom decides which bands draw. Leaflet adds and removes the group, so there is no redraw of
   this app's own and no per-frame work. */
function syncBands() {
  const z = map.getZoom();
  waterBands.forEach((g, b) => {
    if (z >= BAND_MIN[b]) { if (!map.hasLayer(g)) g.addTo(map); }
    else if (map.hasLayer(g)) map.removeLayer(g);
  });
}
map.on('zoomend', syncBands);

/* A theme swap changes `--water`, and the layers hold the old colour until something restyles them.
   `setStyle` takes the same function the build used, so there is one definition of the paint. */
function paintWater() {
  seaLayer?.setStyle(waterStyle);
  for (const g of waterBands) g.eachLayer(l => l.setStyle(waterStyle));
}

function ensureWater() {
  if (waterGeo) { paintWater(); return; }
  if (asking) return;
  asking = true;
  /* Past the first paint. This file is about 560 KB gzipped, against 271 KB for the whole of the
     rest of the landing, so fetching it inline more than doubles what a reader waits for. It draws
     water the basemap omits, over a map that already works, so it can arrive late.
     requestIdleCallback yields to anything the browser would rather do first, and the setTimeout is
     the fallback for Safari, which does not implement it. */
  /* Called as a method on `window`, never lifted off it. `requestIdleCallback` is a `Window`
     operation, so invoking a detached reference gives it the wrong receiver and it throws. That
     throw would land during module evaluation, because applyTheme() runs at the top level of
     js/ui.js, which js/app.js imports statically. So every reader would lose the whole app, not just
     the water. */
  const later = fn => window.requestIdleCallback
    ? window.requestIdleCallback(fn)
    : setTimeout(fn, 1200);
  try {
    later(() => fetch('water.json')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(g => { waterGeo = g; buildWater(); })
      .catch(() => {}));
  } catch {
    /* Nothing about the water may take the app down. This runs inside module evaluation, so an
       exception here stops js/ui.js and with it everything js/app.js does. A plainer map is the
       documented outcome of a water failure, and that has to hold for a synchronous throw too, not
       only for a rejected fetch. */
  }
}
```

Replace the last line of `setBasemap()` at `js/map.js:508`.

```javascript
  ensureWater();
```

- [ ] **Step 4: Run the check and watch it pass**

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --ignore-certificate-errors --virtual-time-budget=40000 --window-size=1200,900 --dump-dom \
  https://flood-exp.test/map-limits-test.html | perl -0777 -ne 'print $1 if /<pre id="out">([^<]*)</s'
```

Expected: `PASS`.

- [ ] **Step 5: Look at the map with your own eyes**

Open `https://flood-exp.test/` and check three things the assertions cannot measure.

1. The Strait of Malacca is water and not grey.
2. Zoom 10 looks like the map did before this change.
3. Zoom 13 shows small water and does not look like a web.

The spec names a fourth risk. The sea fill covers the basemap under it, and Esri draws a shoreline
from its own data. Look at the estuary and the islands at zoom 12. Report any place where the two
shorelines disagree by more than a pin width.

- [ ] **Step 6: Commit**

```bash
git add js/map.js map-limits-test.html
git commit -m "feat: draw the sea, and gate the small water on the zoom

Four layers instead of one. The sea always draws. Band 0 always draws.
Band 1 joins it at zoom 11 and band 2 at zoom 13, through a zoomend
handler that adds and removes a layer group.

A river thins with its band, or band 2 is the blue web at zoom 13 that
the old size floors removed from zoom 10.

paintWater() restyles on a theme swap. The layer held the old colour
otherwise, because the build reads --water once.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Water draws on the light theme

The light theme draws no water at all today. `--water` has a dark value only, and `setBasemap()`
passed the theme to `setWater()`. Task 4 removed that test. This task supplies the value.

`#8cc6ec` is L 0.80, C 0.08, H 238 in OKLCh. Hue 238 is the hue the palette rule pins to water. It
sits 1.50:1 against Esri's land tone `#e8e8e8`, which is the separation the dark theme already
holds at 1.49:1.

**Files:**
- Modify: `css/base.css` — the light theme block, and the `--water` comment in the dark block
- Modify: `map-limits-test.html` — a theme assertion

**Interfaces:**
- Consumes: `waterStyle` and `paintWater()` from Task 4.
- Produces: `--water` resolves on both themes.

- [ ] **Step 1: Write the failing assertion**

Add this to `map-limits-test.html`, after the zoom rule block from Task 4.

```javascript
  // --- both themes ---------------------------------------------------------------------------

  /* The light theme drew no water at all until 2026-09-09. `--water` had one value and
     setBasemap() passed the theme to the layer. A missing token falls back to nothing, and the
     layer then paints in Leaflet's own default blue with no error anywhere. */
  /* `setTheme` writes the reader's own preference, and a person can open this page in their own
     browser. So take the pick back at the end. */
  const { setTheme } = await import('./js/map.js');
  const { PREFS } = await import('./js/state.js');
  const wasTheme = PREFS.theme;
  const seen = {};
  for (const t of ['light', 'dark']) {
    setTheme(t);
    await settle(300);
    seen[t] = getComputedStyle(document.documentElement).getPropertyValue('--water').trim();
    ok('the ' + t + ' theme states --water', /^#[0-9a-f]{6}$/i.test(seen[t]), seen[t] || '(empty)');
  }
  /* One value shared by both themes means one of them inherited the other. That draws a dark navy
     sea on white paper, or a pale blue one on a near-black map, and neither throws. */
  ok('each theme states its own water', seen.light !== seen.dark,
     'light ' + seen.light + ', dark ' + seen.dark);
  setTheme(wasTheme);
```

- [ ] **Step 2: Run the check and watch it fail**

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --ignore-certificate-errors --virtual-time-budget=40000 --window-size=1200,900 --dump-dom \
  https://flood-exp.test/map-limits-test.html | perl -0777 -ne 'print $1 if /<pre id="out">([^<]*)</s'
```

Expected: `FAIL the light theme states --water   (empty)`.

- [ ] **Step 3: Add the light value**

Add this to the `:root` block in `css/base.css`, next to the `--mask-bg` line.

```css
  /* The sea, the rivers and the ponds js/map.js draws over the light basemap. Read from here by
     name, so no hex lands in a JavaScript file.
     **L 0.80, C 0.08, hue 238 in OKLCh.** Hue 238 is where the palette rule above pins water. The
     lightness holds this value 1.50:1 against Esri's own land tone #e8e8e8, and the dark theme holds
     1.49:1 against its own land. So the two themes separate water from land by the same amount.
     **This theme drew no water at all until 2026-09-09.** Esri's Light Gray Canvas paints the sea
     #d0cfd4 against land #e8e8e8, which separates them and does not make the sea blue. A hydrology
     map cannot leave that grey.
     Below `--k-river` #66b2ff in chroma, because a river pin has to win over its own water. The pin
     also carries a stroke, which is what holds it on a fill this pale. */
  --water: #8cc6ec;
```

Correct the stale half of the dark comment at `css/base.css:386-395`. Replace the two sentences that
name the tint and `index.html` with this.

```css
     This value was the finished output of an SVG tint that keyed on the basemap's own water tone.
     That tint was deleted on 2026-08-27 with the move to Esri, so nothing has to match it now. See
     css/map.css for why it went and why it must not come back.
```

Delete the sentence reading `Light has no value here on purpose.` The light theme has a value now.

- [ ] **Step 4: Run the check and watch it pass**

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --ignore-certificate-errors --virtual-time-budget=40000 --window-size=1200,900 --dump-dom \
  https://flood-exp.test/map-limits-test.html | perl -0777 -ne 'print $1 if /<pre id="out">([^<]*)</s'
```

Expected: `PASS`.

- [ ] **Step 5: Look at the light theme**

Open `https://flood-exp.test/`, switch to the light theme, and check two things.

1. A river pin still reads against the water under it.
2. `#8cc6ec` is not so strong that it fights the status pins over it.

If the water shouts, take the lightness up to 0.83 and rebuild the hex from OKLCh at hue 238. Record
the new number in the comment. Take the value off a rendered picture, which is the method
`water-build.php` states for its own tolerance.

- [ ] **Step 6: Commit**

```bash
git add css/base.css map-limits-test.html
git commit -m "feat: draw water on the light theme

The light theme drew none. --water had a dark value only, and Esri's
Light Gray Canvas paints the sea #d0cfd4 against land #e8e8e8, which
separates them and does not make the sea blue.

#8cc6ec is L 0.80, C 0.08, hue 238 in OKLCh. It holds 1.50:1 against
that land tone, which is the 1.49:1 the dark theme already holds. The
dark value does not move.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The documents

`CLAUDE.md` states that a feature is documented as part of the change. This task writes one entry for
the whole change, because the five tasks above are one story.

**Files:**
- Modify: `docs/FEATURES.md` — one new section at the end
- Modify: `CLAUDE.md` — the `water.json` and `water-build.php` rows, and the gotcha index
- Modify: `docs/GOTCHAS.md` — two new entries
- Modify: `docs/VERIFY.md` — the `map-limits-test.html` description
- Modify: `js/map.js` — no stale comment is left

- [ ] **Step 1: Write the FEATURES.md entry**

Append a section headed `## Water becomes the subject of the map, 2026-09-09`. State these things,
and state the reasoning for each.

1. What a reader sees. The sea and the estuary draw. Small water returns from zoom 11 and zoom 13.
   Water draws on the light theme.
2. The measurement that killed the size floors. Five settings, 3.2 times the shapes for 35 percent
   more bytes. The floors bought a picture and not a file size.
3. The measurement that shaped the sea. 276 coastline ways, 15,235 points, two open chain ends.
4. The measurement that shaped the colour. Esri paints land `#e8e8e8` and sea `#d0cfd4` on the light
   Canvas, and `#4d4d4f` and `#232227` on the dark one. Neither sea is blue.
5. The negative result. No free Esri hydrography overlay exists. `Reference/World_Hydro_Reference_Overlay`
   answers 404, and the `Reference` folder holds boundaries, places and transportation only. So water
   emphasis has to come from this app's own baked data.
6. What was not done, and why. The dark `--water` stays at `#15364e`, although the measurement
   argues for raising it. The file is not split in two. MapLibre did not come back.

- [ ] **Step 2: Correct the CLAUDE.md rows**

Rewrite the `water.json` row to state seven features, three bands, the sea, and the new size. Rewrite
the `water-build.php` row to state two Overpass queries and the band edges. Say that
`MIN_AREA_KM2` and `MIN_RIVER_KM` are band edges and no longer cut a shape.

Add the `map-limits-test.html` row's new duties: the bands, the sea, and both themes.

- [ ] **Step 3: Write the two gotchas**

Append to `docs/GOTCHAS.md`, and add the first line of each to the index in `CLAUDE.md`.

The first gotcha: an island has to wind against the sea around it. Leaflet fills a canvas polygon
with the nonzero rule. An island that winds the same way as the sea paints as more sea and nothing
reports it. `sea()` forces the winding from `signedArea()` rather than trusting the tag order.

The second gotcha: a band is a feature and not a property on one geometry. A GeoJSON property belongs
to a feature. A band stamped on a `MultiLineString` coordinate lands nowhere a reader can find. So
each band is a feature of its own.

- [ ] **Step 4: Correct the VERIFY.md description**

The `map-limits-test.html` paragraph names two water floors. It guards bands, a sea polygon and two
themes now. Rewrite that paragraph and state the new silent faults. A sea that swallows the box still
draws as a plausible picture. A bake that stamps every shape band 0 still passes the size assertions.

- [ ] **Step 5: Check for stale comments**

```bash
cd /d/Herd/flood-exp
grep -n "242 KB\|6,635\|6635\|Voyager\|dark theme only" js/map.js css/base.css css/map.css
```

Expected: no output. Every one of those was true before this change and is false now.

- [ ] **Step 6: Run the writing check**

```bash
for f in docs/FEATURES.md docs/GOTCHAS.md docs/VERIFY.md CLAUDE.md; do
  echo "== $f"; python "C:/Users/illus/.claude/ste-lint.py" < "$f"
done
```

Aim for a total of 0, apart from the `long_paragraph` count that the tables raise.

- [ ] **Step 7: Run all eight checks**

Run every command in `docs/VERIFY.md`. The map card is in `paint-check.html` and `m3-check.html`, and
this change moved layers on that map.

Expected: eight passes.

- [ ] **Step 8: Commit**

```bash
git add docs/ CLAUDE.md js/map.js css/base.css
git commit -m "docs: record water as the subject of the map

One entry for the whole change, with the four measurements it rests on
and the one negative result. Two gotchas: an island has to wind against
the sea around it, and a band is a feature rather than a property on a
geometry.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the engineer

**Overpass answers 504 under load, and that is routine.** `water-build.php` writes nothing when it
happens. Run it again. The mirror at `https://overpass.kumi.systems/api/interpreter` sometimes
answers when the main endpoint does not.

**Pass `--cached` in every step of this plan.** Two raw answers already sit in the system temporary
directory. `water-build-raw.json` holds the water query and `water-build-coast.json` holds the
coastline after Task 2 runs once.

**Every `isPointInFill` probe in `map-limits-test.html` has to be on screen.** Leaflet clips a
polygon to the viewport, so a point off the edge reads as outside whatever the map says. The sea
assertions in this plan use ray casting over the raw JSON instead, so they do not carry that rule.

**`build.mjs` copies `water.json` by name.** The name does not change, so the Pages build needs no
edit.
