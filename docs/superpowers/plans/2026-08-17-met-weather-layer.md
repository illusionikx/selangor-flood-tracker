# MET weather layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a map mode. It draws MET Malaysia nowcast points and hides every flood station. A point opens a panel of half-hour weather cards.

**Architecture:** A refresh already parses the MET nowcast. The same pass filters those points to `BOX`. It joins a temperature through a baked district table. It reads the last hour out of `.history.db`. It stores the result as one `page` row. `api.php?wx=1` echoes that row. A deferred `js/wx.js` polls it, draws the pins and fills the panel.

**Tech Stack:** PHP 8.3, sqlite through PDO, Leaflet 1.9, plain ES modules. No build step. No test framework.

**Spec:** [`docs/superpowers/specs/2026-08-17-met-weather-layer-design.md`](../specs/2026-08-17-met-weather-layer-design.md)

## Global Constraints

- **Prose in files follows Simplified Technical English.** Active voice. One instruction per sentence. 20 words maximum. No semicolons. No contractions. American spelling. Check with `python "C:/Users/illus/.claude/ste-lint.py" < FILE`.
- **Traffic-light colors mean status and nothing else.** This layer is the one documented exception. It holds only while weather mode draws no station pin.
- **No hex outside `css/base.css`.** Colors reach JavaScript as `var(--token)`.
- **A pin resolves `--c` inside the `:root[data-theme="dark"], .pin` block.** A token missing from that block draws one pin off palette.
- **`index.html` gives `js/wx.js` no `modulepreload` line.** That module loads on demand.
- **Bump `?v=` on every stylesheet link after any change to a CSS file.**
- **Never call `file_get_contents()` on an upstream URL.** Use curl.
- **`WX_THIN_PX` is 40.** `WX_PAST` is 3600 seconds.
- **The `?wx=1` body carries no per-request field.** A moving field breaks the 304.

---

### Task 1: The Nominatim bake

**Files:**
- Create: `wx-build.php`
- Create: `wx-places.json`
- Modify: `sources.php` (append a new section at the end)

**Interfaces:**
- Produces: `wxSlug(string $name): string` and `wxInBox(array $pts, array $box): array` in `sources.php`. `wx-places.json` maps a slug to `{"district": string, "state": string}`.

- [ ] **Step 1: Add the two pure helpers to `sources.php`**

Append at the end of the file:

```php
/* --- MET nowcast, as a map layer ------------------------------------------------------------- */

/**
 * A stable key for one MET nowcast point.
 *
 * The name is the only identity MET publishes. A coordinate is a float and it moves when MET nudges
 * a marker, so it cannot key a database row. A rename orphans the history for that point instead,
 * and RETAIN prunes the orphan 30 days later.
 */
function wxSlug(string $name): string {
    $s = strtolower(trim(preg_replace('/\s+/', ' ', $name)));
    return trim(preg_replace('/[^a-z0-9]+/', '-', $s), '-');
}

/**
 * The points inside the coverage box.
 *
 * `$box` is [west, north, east, south], the order api.php states for BOX.
 */
function wxInBox(array $pts, array $box): array {
    [$w, $n, $e, $s] = $box;
    return array_values(array_filter($pts, fn($p) =>
        $p['lng'] >= $w && $p['lng'] <= $e && $p['lat'] <= $n && $p['lat'] >= $s));
}
```

- [ ] **Step 2: Check it parses**

Run: `php -l sources.php`
Expected: `No syntax errors detected`

- [ ] **Step 3: Write `wx-build.php`**

```php
<?php
/**
 * php wx-build.php — rebakes wx-places.json, the district behind each weather point.
 *
 * MET gives a nowcast point a name and a coordinate. It gives no district. metDaily() keys its rows
 * by district name, so the two feeds cannot join without one.
 *
 * A station must not supply that district. A temperature taken that way reads as the station
 * reporting it. No station in this payload holds a weather reading. Nominatim answers instead, and
 * it belongs to nobody in this app.
 *
 * Run this by hand and commit the result. Nominatim allows one request each second, so fifty
 * lookups cannot ride a refresh. Towns do not move. A new MET point shows no temperature until
 * somebody runs this again. That is a missing row, never a wrong one.
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
```

- [ ] **Step 4: Check it parses**

Run: `php -l wx-build.php`
Expected: `No syntax errors detected`

- [ ] **Step 5: Run the bake**

Run: `php wx-build.php`
Expected: about 50 lines, then `wrote wx-places.json with 50 rows`. It takes about 100 seconds, because it waits 2 seconds between calls.

- [ ] **Step 6: Check the three rungs each answered**

Run:

```bash
php -r '$j=json_decode(file_get_contents("wx-places.json"),true);
printf("rows: %d\n", count($j));
foreach (["petaling-jaya","bukit-bintang","bentong","putrajaya"] as $k)
  printf("  %-16s %s\n", $k, $j[$k]["district"] ?? "MISSING");'
```

Expected:

```
rows: 50
  petaling-jaya    petaling
  bukit-bintang    kuala lumpur
  bentong          bentong
  putrajaya        putrajaya
```

If `bukit-bintang` reads anything other than `kuala lumpur`, the `city` rung did not fire. Re-read `place()` before going on.

- [ ] **Step 7: Commit**

```bash
git add sources.php wx-build.php wx-places.json
git commit -m "Bake the district behind each MET weather point

Nominatim answers the district for a coordinate. No station supplies it,
because a temperature taken through the district of a station reads as
that station reporting a temperature.

Run by hand, never in a request. Nominatim allows one request each second.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Build the weather rows and store them

**Files:**
- Modify: `api.php` — the constants, the three functions, the `--selftest` assertions, and the refresh write

**Interfaces:**
- Consumes: `wxSlug()`, `wxInBox()` from Task 1.
- Produces: `wxPlaces(): array`, `wxPast(PDO $db, array $ids, int $anchor): array`, `wxRows(array $pts, array $box, array $places, array $metDay, array $past): array`. Constants `WX_KEY`, `WX_PAST`, `WX_PLACES`. A `page` row keyed `wx:box` holding `{"points":[…]}`.

- [ ] **Step 1: Add the constants**

In `api.php`, directly under `const BOX = [100.72, 3.95, 102.02, 2.50];`:

```php
/* The weather layer. `wx:box` reuses the reserved-prefix pattern `place:` and `gazdone:` already
   follow, so the layer needs no store of its own.
   WX_PAST anchors on MET's own issue time and never on `now`. A window measured from `now` would
   drop a sample as the clock moved, which changes the body between two issues and breaks the ETag
   on ?wx=1 — the same fault `cacheAge` caused on the payload. */
const WX_KEY    = 'wx:box';
const WX_PAST   = 3600;
const WX_PLACES = __DIR__ . '/wx-places.json';
```

- [ ] **Step 2: Add the three functions**

In `api.php`, directly above the `--selftest` block so the assertions can reach them:

```php
/** The baked district table. An absent or broken file costs the temperature and nothing else. */
function wxPlaces(): array {
    $j = is_file(WX_PLACES) ? json_decode((string)file_get_contents(WX_PLACES), true) : null;
    return is_array($j) ? $j : [];
}

/**
 * The archived rungs for each point, in the hour before `$anchor`.
 *
 * One query for every point, because 50 separate reads on one table is 50 round trips for nothing.
 * The caller filters each point against its own stamp afterwards.
 */
function wxPast(PDO $db, array $ids, int $anchor): array {
    if (!$ids) return [];
    $in = implode(',', array_fill(0, count($ids), '?'));
    $q  = $db->prepare("SELECT station, ts, level FROM level
                        WHERE station IN ($in) AND ts >= ? AND ts < ? ORDER BY ts");
    $q->execute([...array_map(fn($i) => 'wx-' . $i, $ids), $anchor - WX_PAST, $anchor]);
    $out = [];
    foreach ($q as $r) $out[substr((string)$r['station'], 3)][] = [(int)$r['ts'], (int)$r['level']];
    return $out;
}

/**
 * One row per weather point, ready to publish.
 *
 * The temperature joins on the baked district and on nothing else. A point with no baked row, or a
 * district MET does not publish, carries no temperature. The panel then draws no temperature block.
 */
function wxRows(array $pts, array $box, array $places, array $metDay, array $past): array {
    $out = [];
    foreach (wxInBox($pts, $box) as $p) {
        $id  = wxSlug($p['name']);
        $mine = array_values(array_filter($past[$id] ?? [], fn($s) => $s[0] < $p['stamp']));
        $row = ['id'    => $id,          'n'      => $p['name'],
                'lat'   => $p['lat'],    'lng'    => $p['lng'],
                'stamp' => $p['stamp'],  'rungs'  => $p['rungs'],
                'clocks'=> $p['clocks'], 'past'   => $mine];
        $d = strtolower((string)($places[$id]['district'] ?? ''));
        if ($d !== '' && isset($metDay[$d])) $row += $metDay[$d];
        $out[] = $row;
    }
    return $out;
}
```

- [ ] **Step 3: Write the failing assertions**

In the `--selftest` block, directly before the closing summary, add:

```php
    echo "\nwxSlug():\n";
    $ok('a plain name slugs',             wxSlug('Petaling Jaya') === 'petaling-jaya');
    $ok('case and runs collapse',         wxSlug('  KUALA   Kubu  Bharu ') === 'kuala-kubu-bharu');
    $ok('punctuation becomes one dash',   wxSlug('MET MALAYSIA (HQ)') === 'met-malaysia-hq');
    $ok('no leading or trailing dash',    wxSlug('- Sepang -') === 'sepang');

    echo "\nwxInBox():\n";
    $mkp = fn($n, $la, $ln) => ['name' => $n, 'lat' => $la, 'lng' => $ln, 'stamp' => $now,
                                'rungs' => [0, 0, 0, 0, 0, 0, 0],
                                'clocks' => [null, '01', '02', '03', '04', '05', '06']];
    $pts = [$mkp('Petaling Jaya', 3.100, 101.645), $mkp('Kota Bharu', 6.133, 102.238),
            $mkp('Teluk Intan', 4.021, 101.020),   $mkp('Muar', 2.046, 102.568)];
    $names = array_column(wxInBox($pts, BOX), 'name');
    $ok('a point inside is kept',         $names === ['Petaling Jaya']);
    $ok('a point north of the box goes',  !in_array('Teluk Intan', $names, true));
    $ok('a point east of the box goes',   !in_array('Kota Bharu', $names, true));
    $ok('a point south of the box goes',  !in_array('Muar', $names, true));

    echo "\nwxRows():\n";
    $one  = $mkp('Petaling Jaya', 3.100, 101.645);
    $day  = ['petaling' => ['tmin' => 24, 'tmax' => 32]];
    $rows = wxRows([$one], BOX, ['petaling-jaya' => ['district' => 'petaling']], $day, []);
    $ok('one point in the box makes one row', count($rows) === 1);
    $ok('the slug rides on the row',          $rows[0]['id'] === 'petaling-jaya');
    $ok('a baked district joins a temperature', ($rows[0]['tmax'] ?? null) === 32);
    $bare = wxRows([$one], BOX, [], $day, []);
    $ok('no baked row means no temperature',  !isset($bare[0]['tmax']));
    $miss = wxRows([$one], BOX, ['petaling-jaya' => ['district' => 'nowhere']], $day, []);
    $ok('a district MET lacks means no temperature', !isset($miss[0]['tmax']));
    /* The archive is anchored on the issue, so a sample stamped at or after it belongs to the
       forecast half and never to the past half. */
    $arch = ['petaling-jaya' => [[$now - 1800, 1], [$now - 60, 2], [$now, 0], [$now + 60, 1]]];
    $back = wxRows([$one], BOX, [], [], $arch);
    $ok('the past holds only samples before the issue', count($back[0]['past']) === 2);
    $ok('the past keeps its order',       $back[0]['past'][0][0] === $now - 1800);
```

- [ ] **Step 4: Run the assertions to verify they fail**

Run: `php api.php --selftest 2>&1 | tail -30`
Expected: the three new blocks each print `FAIL` lines. That holds only if you skipped Step 2 to work test-first. If you already applied Step 2, the lines read `ok`. Go on either way.

- [ ] **Step 5: Run the assertions to verify they pass**

Run: `php api.php --selftest 2>&1 | tail -30`
Expected: every new line reads `ok`, and the final summary reports no failures.

- [ ] **Step 6: Write the `wx:box` row during a refresh**

In `api.php`, find the line `$metDay = metDaily($page('met-day'));`. Directly after the block that builds `$metPts` and `$metDay`, add:

```php
/* The weather layer, built in the pass that already parsed the nowcast. Two writes, both cheap.
   The archive first, because MET publishes no past and this app has to record one. `ts` is MET's
   own issue stamp and never the poll time, which is the rule readTs() states for every other
   writer to this table. The (station, ts) primary key dedupes a re-read of one issue to one row.
   The row second. ?wx=1 then echoes it and parses nothing. */
$wxPts = wxInBox($metPts, BOX);
if ($wxPts) {
    $put = $db->prepare('INSERT OR IGNORE INTO level (station, ts, level) VALUES (?, ?, ?)');
    $db->beginTransaction();
    foreach ($wxPts as $p) $put->execute(['wx-' . wxSlug($p['name']), $p['stamp'], $p['rungs'][0]]);
    $db->commit();

    $ids    = array_map(fn($p) => wxSlug($p['name']), $wxPts);
    $anchor = max(array_column($wxPts, 'stamp'));
    $rows   = wxRows($metPts, BOX, wxPlaces(), $metDay, wxPast($db, $ids, $anchor));
    pageRow($db, WX_KEY, $now, json_encode(['points' => $rows]));
}
```

Read `pageRow()` first and match its signature. Where it takes another shape, write the row with the prepared `INSERT OR REPLACE INTO page (url, ts, body)` statement the gazetteer drip already uses.

- [ ] **Step 7: Rebuild and check the row landed**

Run:

```bash
php -r '$d=new PDO("sqlite:.history.db"); $d->exec("UPDATE page SET ts=0");'
curl -sk 'https://flood-exp.test/api.php?force=1' > /dev/null
php -r '$d=new PDO("sqlite:.history.db");
$b=$d->query("SELECT body FROM page WHERE url=\"wx:box\"")->fetchColumn();
$j=json_decode($b,true); printf("points: %d\n", count($j["points"] ?? []));
$t=array_filter($j["points"],fn($p)=>isset($p["tmax"]));
printf("with a temperature: %d\n", count($t));
print_r(array_slice($j["points"],0,1));'
```

Expected: `points: 50`. `with a temperature: 0` is correct today, because the MET forecast feed answers an empty array. The printed row must carry `id`, `n`, `lat`, `lng`, `stamp`, `rungs`, `clocks` and `past`.

- [ ] **Step 8: Check the archive fills**

Run:

```bash
php -r '$d=new PDO("sqlite:.history.db");
printf("archived rows: %d\n", $d->query("SELECT COUNT(*) FROM level WHERE station LIKE \"wx-%\"")->fetchColumn());
foreach($d->query("SELECT station,ts,level FROM level WHERE station LIKE \"wx-%\" LIMIT 3") as $r)
  printf("  %-22s %s  %d\n", $r["station"], date("Y-m-d H:i", $r["ts"]), $r["level"]);'
```

Expected: 50 rows after one refresh, one per point. Each carries the issue time from MET, never the current minute.

- [ ] **Step 9: Commit**

```bash
git add api.php
git commit -m "Build the weather rows and archive each nowcast

MET publishes no past, so a refresh records one. The stamp is MET's own
issue time, so the primary key dedupes a re-read of one issue.

The temperature joins on the baked district alone. A point with no baked
row carries no temperature.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The `?wx=1` endpoint

**Files:**
- Modify: `api.php` (a new handler beside the `?place=` handler)

**Interfaces:**
- Consumes: the `wx:box` row from Task 2.
- Produces: `GET api.php?wx=1` answering `{"points":[…]}` with a stable `ETag`.

- [ ] **Step 1: Add the handler**

In `api.php`, directly after the closing brace of the `if (isset($_GET['place'])) { … }` block:

```php
/* The weather layer, straight off the row a refresh already wrote. This handler parses nothing and
   cannot reach MET, so it cannot be slow and it cannot fail in a new way.
   The connect is caught for the reason ?place= states: Content-Type is already sent, so an
   uncaught PDOException would put a PHP fatal-error page inside a response a client parses as JSON.
   An empty answer is a real state on a server that has never refreshed. js/wx.js hides the drawer
   section on it rather than drawing an empty map. */
if (isset($_GET['wx'])) {
    header('Content-Type: application/json');
    $body = '{"points":[]}';
    try {
        $db  = new PDO('sqlite:' . HIST, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $sel = $db->prepare('SELECT body FROM page WHERE url = ?');
        $sel->execute([WX_KEY]);
        $hit = $sel->fetchColumn();
        if (is_string($hit) && $hit !== '') $body = $hit;
    } catch (\Throwable $e) {
        // No cache is a worse answer than a cached one and a better answer than a broken one.
    }
    /* The body holds MET's data and nothing else, so the hash moves only when MET reissues. That is
       about every 30 minutes against a poll every 8.5, so about three polls in four cost one 304.
       Never add a field here that changes without the data changing. */
    $etag = '"' . md5($body) . '"';
    header('ETag: ' . $etag);
    header('Cache-Control: max-age=60');
    if (trim((string)($_SERVER['HTTP_IF_NONE_MATCH'] ?? '')) === $etag) {
        http_response_code(304);
        exit;
    }
    echo $body;
    exit;
}
```

- [ ] **Step 2: Check it parses**

Run: `php -l api.php`
Expected: `No syntax errors detected`

- [ ] **Step 3: Verify the endpoint answers**

Run:

```bash
curl -sk -o /dev/null -w '%{http_code} %{content_type} %{size_download}b\n' "https://flood-exp.test/api.php?wx=1"
curl -sk "https://flood-exp.test/api.php?wx=1" | php -r '$j=json_decode(stream_get_contents(STDIN),true);
printf("points: %d, first: %s\n", count($j["points"]), $j["points"][0]["n"] ?? "-");'
```

Expected: `200 application/json` with a body of a few kilobytes, then `points: 50, first: <a town name>`.

- [ ] **Step 4: Verify the 304 fires**

Run:

```bash
E=$(curl -sk -D - -o /dev/null "https://flood-exp.test/api.php?wx=1" | tr -d '\r' | awk '/^ETag:/{print $2}')
echo "etag: $E"
curl -sk -o /dev/null -w 'second request: %{http_code} %{size_download}b\n' \
     -H "If-None-Match: $E" "https://flood-exp.test/api.php?wx=1"
```

Expected: `second request: 304 0b`. Anything else means the body carries a field that moves on every read. Find it before going on.

- [ ] **Step 5: Verify the ETag survives a poll that changed nothing**

Run the same two commands again after 30 seconds. Expected: the same ETag and another 304.

- [ ] **Step 6: Commit**

```bash
git add api.php
git commit -m "Answer the weather layer at api.php?wx=1

The handler reads one page row and echoes it. It parses nothing and it
cannot reach MET.

The ETag hashes a body that holds MET data alone, so it moves only when
MET reissues. A poll between two issues costs one 304.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The color tokens

**Files:**
- Create: `wx-probe.html` (temporary, deleted in this task)
- Modify: `css/base.css`

**Interfaces:**
- Produces: `--wx-clear`, `--wx-rain`, `--wx-heavy` inside the `:root[data-theme="dark"], .pin` block of `css/base.css`.

- [ ] **Step 1: Write the probe page**

Create `wx-probe.html` in the repo root, so Herd serves it and the real stylesheets load by relative path:

```html
<!-- TEMPORARY probe, deleted at the end of this task. Not part of the app. -->
<meta charset="utf-8">
<link rel="stylesheet" href="css/icons.css">
<link rel="stylesheet" href="css/base.css">
<link rel="stylesheet" href="css/map.css">
<style>
  body { margin: 0; font: 13px Roboto, system-ui, sans-serif; }
  .half { padding: 14px 18px; }
  .half.lt { background: #eef1f4; color: #1f1f1f; }
  .half.dk { background: #1b1d20; color: #e8eaed; }
  h2 { font: 600 12px/1 Roboto, sans-serif; letter-spacing: .08em; text-transform: uppercase;
       opacity: .55; margin: 14px 0 8px; }
  .row { display: flex; align-items: center; gap: 26px; margin: 6px 0 14px; }
  .name { width: 120px; font-size: 11px; opacity: .7; }
  .tile { padding: 6px 12px; border-radius: 8px; display: inline-flex; gap: 10px;
          align-items: center; }
  .lt .tile { background: #d7dde3; }   /* about the CARTO light land tone */
  .dk .tile { background: #2a2c30; }   /* about the CARTO dark land tone */
</style>

<div class="half lt" id="lt"></div>
<div class="half dk" id="dk" data-theme="dark"></div>

<script>
/* pinGlyph(), copied from js/map.js so the probe cannot flatter the real thing. */
const sprite = document.body.appendChild(
  Object.assign(document.createElementNS('http://www.w3.org/2000/svg', 'svg'), { id: 'glyphs' }));
sprite.setAttribute('aria-hidden', 'true');
const built = new Set();
function pinGlyph(name) {
  if (!built.has(name)) {
    built.add(name);
    const url = getComputedStyle(document.documentElement).getPropertyValue('--i-' + name);
    const body = url.match(/<svg[^>]*>(.*)<\/svg>/s);
    if (!body) return '';
    sprite.insertAdjacentHTML('beforeend', `<symbol id="g-${name}" viewBox="0 -960 960 960">${
      body[1].replaceAll('<path ', "<path vector-effect='non-scaling-stroke' ")}</symbol>`);
  }
  return `<svg class="pinglyph"><use href="#g-${name}"/></svg>`;
}

/* Candidates, in the order clear / rain / heavy. Heavy must not be DARKER than rain: `.pin` uses
   one palette on both themes because a pin has to win over the basemap, and a dark pin on the dark
   tile loses. Intensity differs by saturation here, never by lightness. */
const SETS = {
  'D  muted warm':  ['#d8a93f', '#7c93a8', '#4d84b8'],
  'F  stronger':    ['#d8a93f', '#8aa6bd', '#3f8fd6'],
  'G  cooler rain': ['#d8a93f', '#93a9bb', '#2f7fc9'],
};
const pin = (g, c) => `<span class="pin" style="--c:${c}">${pinGlyph(g)}</span>`;

function build(host) {
  let h = '<h2>candidates at map size &mdash; clear, night, rain, heavy</h2>';
  for (const [label, c] of Object.entries(SETS))
    h += `<div class="row"><span class="name">${label}</span><span class="tile">`
       + pin('sunny', c[0]) + pin('clear_night', c[0])
       + pin('rainy', c[1]) + pin('rainy', c[2]) + '</span></div>';

  h += '<h2>the status set &mdash; none of the above may be confusable with these</h2>';
  h += '<div class="row"><span class="name">status</span><span class="tile">';
  for (const t of ['--s-normal', '--s-alert', '--s-warning', '--s-danger', '--s-none'])
    h += pin('water_drop', `var(${t})`);
  h += '</span><span class="name">kinds</span><span class="tile">';
  for (const t of ['--k-river', '--k-rainfall', '--k-siren', '--k-gauge', '--k-camera'])
    h += pin('water_drop', `var(${t})`);
  h += '</span></div>';
  host.innerHTML = h;
}
build(document.getElementById('lt'));
build(document.getElementById('dk'));
</script>
```

- [ ] **Step 2: Screenshot it and look**

Run:

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --ignore-certificate-errors --virtual-time-budget=6000 --hide-scrollbars \
  --window-size=980,700 --screenshot=wx-probe.png https://flood-exp.test/wx-probe.html
```

Open `wx-probe.png`. Pick the row where all four pins stay legible on **both** halves. The clear pin must read plainly duller than the `--s-alert` drop below it. Reject any row whose heavy pin reads dimmer than its rain pin on the dark half.

- [ ] **Step 3: Write the chosen values into `css/base.css`**

Find the map-palette block whose selector is `:root[data-theme="dark"], .pin`. Add inside it, using the three values chosen in Step 2:

```css
  /* The weather layer. Natural sky colors, which is the one documented exception to the status
     rule above, and it holds on one condition: weather mode draws no station pin, so nothing
     status-colored shares the map and an amber glyph cannot read as a station in trouble.
     The status set is saturated and this set is muted, so the two also separate by vividness.
     Gold #f2b705 was measured and rejected. It sits within a shade of --s-alert on the light theme
     and matches #ffc000 on the dark one.
     One set on both themes, like every other token in this block, because a pin has to win over
     the basemap. Heavy differs from rain by SATURATION, never by lightness: a darker heavy pin
     disappears into the dark tile. */
  --wx-clear: #d8a93f; --wx-rain: #7c93a8; --wx-heavy: #4d84b8;
```

- [ ] **Step 4: Delete the probe**

```bash
rm -f wx-probe.html wx-probe.png
```

- [ ] **Step 5: Confirm the tokens resolve**

Run:

```bash
grep -n -- "--wx-clear" css/base.css
grep -c "data-theme=\"dark\"\], \.pin" css/base.css
```

Expected: one line for the tokens, and the tokens must sit inside the block the second grep names. A token outside that block draws every weather pin in the accent blue.

- [ ] **Step 6: Commit**

```bash
git add css/base.css
git commit -m "Add the weather pin palette

Natural sky colors, which is the documented exception to the status rule.
It holds because weather mode draws no station pin.

Gold was measured and rejected. It sits within a shade of --s-alert on
the light theme and matches the dark theme value.

Heavy differs from rain by saturation. A darker pin loses on the dark tile.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The map layer

**Files:**
- Create: `js/wx.js`
- Modify: `js/config.js`, `js/popup.js`, `js/heat.js`, `js/render.js`, `js/ui.js`, `index.html`, `css/map.css`

**Interfaces:**
- Consumes: `api.php?wx=1` from Task 3, the tokens from Task 4.
- Produces: `js/wx.js` exporting `syncWx(): void` and `tick(): Promise<void>`. `card(p)` stays module-private, because `tick()` is its only caller. `config.js` exporting `WX_THIN_PX: number` and `FEED_WX: string`, and `WEATHER[n].pin`. `popup.js` exporting `wxIcon(rung, { clock, pin }): string`.

- [ ] **Step 1: Add the config**

In `js/config.js`, replace the `WEATHER` array with:

```js
/* The three rungs MET publishes. `word` fills the narrow "now" column, so it has to be one word at
   about 64px. `line` opens the worst-rung sentence, which is why the two differ.
   `pin` is the map's own ladder and it exists because `rainy_heavy` carries no cloud. Beside
   `rainy` at a 31px pin it reads as hatching rather than as more of one thing, so the map states
   heavy by color instead. The card keeps the streaks: at `wxbig` size they read, and the card has
   no color ladder to carry intensity with. */
export const WEATHER = [
  { icon: 'sunny', night: 'clear_night', pin: 'sunny', word: 'Clear', line: '' },
  { icon: 'rainy',       pin: 'rainy', word: 'Rain',  line: 'Rain' },
  { icon: 'rainy_heavy', pin: 'rainy', word: 'Heavy', line: 'Heavy rain' },
];

/* How close two weather pins may draw before the map keeps only the first. A pin draws 31.2px
   wide, so 40 leaves about 9px of air. Measured at latitude 3.1: this thins hard at zoom 11 and
   below, which is the Klang valley overview, and changes almost nothing above zoom 12.
   `Serdang` and `Seri Kembangan` stand 80 m apart and measure 16px apart even at zoom 15, so one
   of them always wins and the other never draws. That is right. Two points 80 m apart report one
   weather. */
export const WX_THIN_PX = 40;
```

Then, directly under the existing `export const FEED = STATIC ? 'api.json' : 'api.php';`:

```js
// The weather layer rides its own endpoint, so a reader who never opens it pays nothing. The
// static bake writes the same body to wx.json — see .github/workflows/pages.yml.
export const FEED_WX = STATIC ? 'wx.json' : 'api.php?wx=1';
```

- [ ] **Step 2: Teach `wxIcon()` a clock and a ladder**

In `js/popup.js`, replace the `night` and `wxIcon` definitions with:

```js
/* `clock` is "HH:MM" in Malaysian time, or absent for the hour in Malaysia now. A stack of cards
   reaches three hours out and can cross 19:00, so each card reads its own clock rather than one
   hour for all of them. Night runs 19:00 to 06:59. Near the equator the sun moves by under half an
   hour across the year, so a fixed pair of hours needs no almanac. */
const night = clock => {
  const h = clock ? +clock.slice(0, 2) : +MYT_H.format(new Date());
  return h >= 19 || h < 7;
};

/* One glyph name for a rung. Only a clear sky has a night form.
   `pin` picks the map's ladder — see WEATHER in config.js for why the two differ at rung 2. */
export const wxIcon = (r, { clock, pin } = {}) => {
  const w = WEATHER[r] || WEATHER[0];
  if (night(clock) && w.night) return w.night;
  return (pin && w.pin) || w.icon;
};
```

`js/popup.js:444` holds `const stamp = t => {`. That line carries no `export` today. Change that line to `export const stamp = t => {`. `js/wx.js` imports it. Verified 2026-08-17.

- [ ] **Step 3: Add the drawer section**

In `index.html`, directly after the closing `</details>` of `#heatsect`:

```html
    <!-- Weather is a mode and not a third heatmap: it takes the map over and hides every station,
         where the two heatmaps add a wash under them. Its own section for that reason, and the
         summary carries the state so a collapsed section still says the stations are hidden.
         No `checked` attribute, and `autocomplete="off"` — PREFS.wx is the one source of truth and
         syncWx() in js/wx.js writes the box from it, never the reverse. -->
    <details id="wxsect" class="sect">
      <summary><i class="i i-sunny"></i>Weather<b id="wxN"></b></summary>
      <label class="chip"><input type="checkbox" id="wxLayer" autocomplete="off">
        <i class="glyph i i-sunny"></i>MET nowcast map</label>
    </details>
```

In the same file, inside `#legend` and directly after the closing `</div>` of the `#lgRain` section:

```html
  <!-- The weather key. Three colors and two glyphs, because the map states rain and heavy rain with
       one cloud in two colors — see WEATHER in js/config.js. -->
  <div id="lgWx" class="lgsec">
    <div class="title">Weather</div>
    <div class="wxkey muted">
      <span><i class="i i-sunny" style="color:var(--wx-clear)"></i>Clear</span>
      <span><i class="i i-rainy" style="color:var(--wx-rain)"></i>Rain</span>
      <span><i class="i i-rainy" style="color:var(--wx-heavy)"></i>Heavy</span>
    </div>
  </div>
```

Bump `?v=` on every stylesheet link in `index.html`.

- [ ] **Step 4: Add the CSS**

Append to `css/map.css`:

```css
/* One card per half hour MET publishes, built like the weather card's own `Later` cell: a glyph on
   the left, the word beside it, and the clock under the pair.
   The cards STACK and never run sideways. A sideways strip hides the later hours behind a swipe,
   and a hidden hour on a flood map helps nobody. A full-width card also lets the word sit beside
   its glyph, which is what the `Later` cell already draws. */
.wxsteps { display: grid; gap: 6px; }
/* `.wxsub` is `width: var(--g)`, which is 28px and narrower than "14:30". The card's own two titles
   are narrower than the glyph box and these are wider, so the width comes off here. Left, not
   centred: the clock lines up under the glyph above it. */
.wxsteps .wxsub { width: auto; text-align: left; }
/* The step happening now. The chip labels it and the outline finds it, so a reader scanning nine
   cards lands on the right one before reading any of them.
   `.wxline` already carries `flex: 1` inside `.wxrow`, so the chip lands hard right with no rule
   of its own. */
.wxcol.now { outline: 2px solid var(--accent); outline-offset: -2px; }
.wxnow { flex: none; font-size: 9px; letter-spacing: .06em; color: var(--accent);
  border: 1px solid var(--accent); border-radius: 4px; padding: 1px 5px; }
/* The temperature, above the cards. `.wxtemp` already stacks high over low. */
.wxtoday { margin-bottom: 8px; }
/* The legend key. One row per rung, glyph then word. */
.wxkey { display: flex; gap: 12px; font-size: 11px; }
.wxkey span { display: inline-flex; align-items: center; gap: 4px; }
```

- [ ] **Step 5: Write `js/wx.js`**

```js
// The MET weather layer: a map of nowcast points, and the panel one of them opens.
//
// Loaded on demand. A reader who never opens weather mode loads none of this and fetches none of
// its data, which is why the points ride ?wx=1 and not the payload every poll already carries.

import { FEED_WX, WX_THIN_PX, WEATHER, MET_NAME } from './config.js';
import { PREFS, save } from './state.js';
import { map, pinGlyph, openSide, side, focusOn } from './map.js';
import { wxIcon, stamp } from './popup.js';
import { askJson } from './ask.js';
import { el } from './util.js';

const layer = L.layerGroup();
let pts = [];    // the last answer from ?wx=1
let gen = 0;     // a stale fetch must never paint over a newer one — the rule clip.js states

/* Every clock this app prints is Malaysian, because JPS and MET both stamp that way and a mixed
   panel is a panel nobody can read. */
const MYT_HM = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hour12: false,
});
const hhmm = ms => MYT_HM.format(new Date(ms));

/* Keep a point only where no kept point stands within WX_THIN_PX of it, in screen pixels.
   Thinning and not clustering: a cluster badge reading 6 cannot say WHICH weather. Weather is a
   field, so a point 240 m from another agrees with it and dropping it at a low zoom loses nothing.
   Greedy over the payload's own order, which is stable, so two renders at one zoom keep the same
   points and the map does not flicker between them. */
function thin(list) {
  const kept = [], at = [];
  for (const p of list) {
    const q = map.latLngToLayerPoint([p.lat, p.lng]);
    if (at.every(k => q.distanceTo(k) >= WX_THIN_PX)) { kept.push(p); at.push(q); }
  }
  return kept;
}

const tone = r => (r >= 2 ? 'heavy' : r === 1 ? 'rain' : 'clear');

function paint() {
  layer.clearLayers();
  if (!PREFS.wx) return;
  for (const p of thin(pts)) {
    const r = p.rungs[0];
    L.marker([p.lat, p.lng], {
      icon: L.divIcon({
        // Matches `.pin`'s box in map.css, the same way render.js does — Leaflet positions the
        // marker off this and not off the CSS.
        className: '', iconSize: [39, 39], iconAnchor: [19.5, 19.5],
        html: `<span class="pin" style="--c:var(--wx-${tone(r)})">${
          pinGlyph(wxIcon(r, { pin: true }))}</span>`,
      }),
    })
      .on('click', () => { openSide('@wx-' + p.id, card(p)); focusOn([p.lat, p.lng], 12); })
      .addTo(layer);
  }
}

/* Provenance, and only provenance. This app prints a timestamp inside a menu and nowhere else, and
   the third line is here for the same reason: which half of the strip this app observed is a fact
   about the plumbing, not about the weather. */
const dots = p => `<button class="icon dots" popovertarget="mnu-wx"
    title="Details" aria-label="Details about this forecast"><i class="i i-more_vert"></i></button>
  <div id="mnu-wx" class="menu surface" popover>
    <div class="mi info"><span>
      <small class="muted">Issued ${stamp(p.stamp * 1000)}</small><br>
      <small class="muted">Via ${MET_NAME}</small><br>
      <small class="muted">Earlier times were read here. Later times come from MET.</small>
    </span></div>
  </div>`;

/* One card per half hour, built like the weather card's `Later` cell: glyph, then the word beside
   it, then the clock under the pair.
   The word is written out rather than left on `data-tip` alone. The weather card can leave it
   there, because a reader takes in its two glyphs at once. Nine glyphs in a stack would each need
   a tap to name, and `data-tip` opens one at a time.
   `w.line` reads "Heavy rain" where `w.word` reads "Heavy", and a full-width card has room for the
   longer one. Rung 0 has no `line`, so `word` answers there.
   `aria-hidden` on the glyph, because the word beside it already says the same thing and a screen
   reader must not say it twice. */
const stepCard = (rung, clock, now) => {
  const w = WEATHER[rung] || WEATHER[0];
  return `<div class="wxcol${now ? ' now' : ''}">
      <div class="wxrow">
        <i class="i wxbig i-${wxIcon(rung, { clock })}" aria-hidden="true"></i>
        <span class="wxline">${w.line || w.word}</span>
        ${now ? '<b class="wxnow">NOW</b>' : ''}
      </div>
      <span class="wxsub">${clock}</span>
    </div>`;
};

function card(p) {
  const temp = p.tmax == null ? '' : `<div class="wxrow wxtoday">
      <span class="wxtemp" data-tip="Max ${p.tmax}° · Min ${p.tmin}°">
        <span>${p.tmax}°</span><span>${p.tmin}°</span></span>
      <span class="wxline">Today</span>
    </div>`;

  const cards = [
    ...p.past.map(([ts, r]) => stepCard(r, hhmm(ts * 1000), false)),
    stepCard(p.rungs[0], hhmm(p.stamp * 1000), true),
    ...p.rungs.slice(1).map((r, i) => stepCard(r, p.clocks[i + 1], false)),
  ].join('');

  /* `.pophead` first, always. openSide() lifts it out into #sideHead, and that seam is what keeps
     the place name off the scrolling body. */
  return `<div class="pophead">
      <b class="popname">${p.n}</b>
      <span class="popsub muted">${MET_NAME}</span>
      ${dots(p)}
    </div>
    <div class="sensor">
      <div class="sensorhead">
        <i class="glyph i i-${wxIcon(p.rungs[0])}" style="color:var(--k-weather)"></i>
        <b>Weather</b>
      </div>
      ${temp}
      <div class="wxsteps">${cards}</div>
    </div>`;
}

/* Reads the preference and writes the control, the summary and the layer. It never reads the
   control back. A browser restores a checkbox across a reload without firing `change`, so an
   invariant repaired inside a change handler is repaired on none of the paths the browser takes —
   the rule syncHeat() exists to state. */
export function syncWx() {
  const on = !!PREFS.wx;
  el('wxLayer').checked = on;
  el('wxN').textContent = on ? 'on · stations hidden' : 'off';
  on ? layer.addTo(map) : layer.remove();
}

/* One poll of the weather endpoint. render() calls this while the mode is on.
   A failed fetch keeps the last answer. A poll that missed is not a forecast of clear skies. */
export async function tick() {
  syncWx();
  if (!PREFS.wx) { paint(); return; }
  const mine = ++gen;
  try {
    const j = await askJson(FEED_WX);
    if (mine !== gen) return;
    pts = j.points || [];
  } catch { /* keep pts */ }
  if (mine !== gen) return;
  /* Nothing to draw and nothing to blame the reader for. A server that has never refreshed has no
     row yet, and the static bake may have skipped the file. Say so on the section rather than
     leaving an empty map under a control that reads "on". */
  el('wxsect').classList.toggle('loadfail', pts.length === 0);
  paint();
  if (side.key?.startsWith('@wx-')) {
    const p = pts.find(x => '@wx-' + x.id === side.key);
    if (p) openSide(side.key, card(p));
  }
}

// The pins are sized in screen pixels, so the set that survives thinning changes with the zoom.
map.on('zoomend', paint);
```

- [ ] **Step 6: Suppress the heat layers while weather is on**

In `js/heat.js`, replace the body of `syncHeat()` with:

```js
export function syncHeat() {
  const wet = PREFS.heatLayer === 'water', rainy = PREFS.heatLayer === 'rain';
  el('heat').checked = wet;
  el('rainHeat').checked = rainy;
  /* Weather mode takes the map, so both canvases come off — but PREFS.heatLayer is NOT written.
     That is the whole of "turn the previous heatmap back on": the reader's choice never left, so
     leaving weather mode restores it with no state to remember. The summary names what is stored
     rather than what is drawn, because the pref is what the two boxes above report. */
  const show = !PREFS.wx;
  el('heatN').textContent = !show ? 'hidden by weather'
    : wet ? 'water level' : rainy ? 'rainfall' : 'off';
  wet && show   ? heat.addTo(map)     : heat.remove();
  rainy && show ? rainHeat.addTo(map) : rainHeat.remove();
  el('lgWater').style.display = wet && show ? '' : 'none';
  el('lgRain').style.display  = rainy && show ? '' : 'none';
  // The legend box holds three sections now, so one function decides whether the box itself shows.
  el('lgWx').style.display = show ? 'none' : '';
  el('legend').style.display = !show || wet || rainy ? '' : 'none';
  heatScale();   // sizes whichever is on, and re-applies opacity
  heatOpacity();
}
```

- [ ] **Step 7: Guard `render()` and start the tick**

In `js/render.js`, wrap the site marker loop. Find `for (const [key, members] of sites) {` and change it to:

```js
  /* Weather mode takes the map: no station pin and no heat. The counts above still run, because
     they describe the station set and the drawer still reports it — see #shown, which says in
     words that the stations are hidden. */
  if (!PREFS.wx) for (const [key, members] of sites) {
```

Directly above the `syncHeat();` call, add:

```js
  /* Deferred, and rejection-handled, exactly like the table and the wall below. This runs on every
     poll and has no surface to report an import failure on. */
  if (PREFS.wx) import('./wx.js').then(m => m.tick(), () => {});
```

In `counts()`, replace the `el('shown').textContent = …` assignment with:

```js
  /* Weather mode hides every station, so the station tally would read "0 of 729" and explain
     nothing. This line is the one the eye lands on to ask why the map is empty, so it answers. */
  el('shown').textContent = PREFS.wx
    ? 'Weather map · flood stations hidden'
    : `${total} of ${state.data.length} stations on the map` +
      (pins && pins < total ? ` · ${pins} pins` : '') +
      (el('favOnly').checked ? ' · favorites only' : '') +
      (nIgn ? ` · ${nIgn} ignored` : '');
```

Check the imports in `render.js` for `PREFS`. `render()` already reads `PREFS.hidden` at its top, so that import needs no change.

- [ ] **Step 8: Wire the control**

In `js/ui.js`, beside the other drawer chip handlers, add:

```js
/* The weather mode toggle. The pref is written first and the module reads it, so the box can never
   be the source of truth — the rule syncHeat() and syncWx() both state.
   A failed import puts the pref back and marks the section, the same shape the test toggle and the
   two dialogs already use. lazy() rethrows on purpose, because it does not know which surface a
   caller owns, and this one owns #wxsect. */
el('wxLayer').onchange = async e => {
  PREFS.wx = e.target.checked;
  save();
  el('wxsect').classList.remove('loadfail');
  try {
    const m = await lazy(() => import('./wx.js'), el('wxsect'));
    await m.tick();
  } catch {
    PREFS.wx = false;
    save();
    e.target.checked = false;
    el('wxsect').classList.add('loadfail');
  }
  syncHeat();
  render();
};
```

Check the imports in `ui.js` for `lazy`, `syncHeat`, `render`, `PREFS` and `save`. Add each one the file lacks.

- [ ] **Step 9: Syntax-check every module**

Run:

```bash
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
```

Expected: no output.

- [ ] **Step 10: Check every file still serves**

Run:

```bash
for f in js/*.js css/*.css; do
  curl -sk -o /dev/null -w "%{content_type} $f\n" "https://flood-exp.test/$f"; done | grep -v 'javascript\|css'
```

Expected: no output. Herd answers a missing file with `index.html` and a 200. So the type is the test, and the status is not.

- [ ] **Step 11: Look at it**

Open `https://flood-exp.test/` with a hard reload. Open the drawer, open Weather, tick **MET nowcast map**.

Confirm each of these:
- Every station pin disappears and weather pins appear.
- A weather pin opens a panel of cards, one per half hour, stacked down. Each card holds a glyph, a word and a clock.
- The card for the current half hour carries the `NOW` chip and an outline.
- The heatmap section summary reads `hidden by weather`, and the water or rainfall box stays ticked.
- `#shown` reads `Weather map · flood stations hidden`.
- The legend shows the weather key alone.
- Zooming out to zoom 10 thins the pins. Zooming to 13 brings them back.
- Unticking the box brings the stations back **and** the heatmap that was on before.
- A reload with the box ticked comes back in weather mode.

- [ ] **Step 12: Commit**

```bash
git add js/wx.js js/config.js js/popup.js js/heat.js js/render.js js/ui.js index.html css/map.css
git commit -m "Draw the MET weather layer on the map

Weather mode hides every station and both heatmaps. PREFS.heatLayer is
never written, so leaving the mode restores the heatmap that was on.

The pins thin by screen distance rather than cluster. A cluster badge
reading 6 cannot say which weather.

The map states heavy rain by color, because rainy_heavy carries no cloud
and reads as hatching at a 31px pin.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Leave the mode on a jump

**Files:**
- Modify: `js/map.js`

**Interfaces:**
- Consumes: `PREFS.wx` from Task 5.

- [ ] **Step 1: Clear the mode inside `flashTo()`**

In `js/map.js`, at the top of `flashTo()` and above the `state.pinned` line, add:

```js
  /* A jump to a station is a request for the station map, so weather mode ends here. One place,
     because every jump in this app already reaches this function: the go-to box, the table, the
     alert rows, the ticker and the menu rows.
     PREFS.heatLayer was never written while the mode was on, so syncHeat() inside the rerender
     below brings back whatever heatmap the reader had. Nothing here has to remember it. */
  if (PREFS.wx) { PREFS.wx = false; save(); }
```

Check the imports in `map.js` for `PREFS` and `save`. `applyTheme()` already reads `PREFS`, so `save` is the one to look for.

- [ ] **Step 2: Syntax-check**

Run: `node --check <(sed 's/$//' js/map.js) 2>/dev/null || (cp js/map.js /tmp/m.mjs && node --check /tmp/m.mjs)`
Expected: no output.

- [ ] **Step 3: Verify by hand**

Turn weather mode on. Open the go-to box, search for a station, pick it.

Expected: the mode turns off, the station pins return, the previous heatmap returns, the card opens and the pin flashes. Repeat from the all-stations table and from an alert row.

- [ ] **Step 4: Commit**

```bash
git add js/map.js
git commit -m "Leave weather mode on a jump to a station

flashTo() clears the mode. Every jump in this app already reaches that
function, so the exit lives in one place.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The static build, the checks and the docs

**Files:**
- Modify: `.github/workflows/pages.yml`, `CLAUDE.md`, `docs/FEATURES.md`

- [ ] **Step 1: Bake `wx.json`**

In `.github/workflows/pages.yml`, directly after the `Poll the three sources` step:

```yaml
      # The weather layer. `php api.php` above already wrote the `wx:box` row, so this only lifts
      # it out. `|| true` because nothing optional may fail the bake: a failed weather file must
      # leave the map updating, and js/wx.js marks its own section when the file is absent.
      - name: Bake the weather layer
        run: |
          php -r '$d = new PDO("sqlite:.history.db");
                  $b = $d->query("SELECT body FROM page WHERE url = \"wx:box\"")->fetchColumn();
                  file_put_contents("wx.json",
                    is_string($b) && $b !== "" ? $b : "{\"points\":[]}");' || true
```

In the `Stage the site` step, beside the `img/` line:

```bash
          # The weather layer. Conditional for the reason img/ is: a missing file must never stop
          # the map updating, and the app hides its own weather section when the file is absent.
          [ -f wx.json ] && cp wx.json site/ || true
```

- [ ] **Step 2: Add the checks to `CLAUDE.md`**

In the `## Verify` section, add:

```bash
# The weather layer. `points` must hold about 50 rows. A fall means BOX, metPoints() or the MET
# page moved. `temp` reads 0 while api.data.gov.my/weather/forecast answers an empty array, which
# it did on 2026-08-17 — read it beside `metday.parsed` before calling it a fault.
curl -sk "https://flood-exp.test/api.php?wx=1" | php -r '$j=json_decode(stream_get_contents(STDIN),true);
$p=$j["points"] ?? []; printf("points: %d, temp: %d, past: %d\n", count($p),
  count(array_filter($p, fn($x)=>isset($x["tmax"]))),
  count(array_filter($p, fn($x)=>($x["past"] ?? []) !== [])));'

# The ETag must not move between two MET issues. A 200 here means the body carries a field that
# changes without the data changing, and every poll then ships the full body for as long as a tab
# stays open — the fault `cacheAge` caused on the payload.
E=$(curl -sk -D - -o /dev/null "https://flood-exp.test/api.php?wx=1" | tr -d '\r' | awk '/^ETag:/{print $2}')
curl -sk -o /dev/null -w 'must be 304: %{http_code}\n' -H "If-None-Match: $E" \
     "https://flood-exp.test/api.php?wx=1"

# No weather row may borrow a district from a station. Every district must come from
# wx-places.json, which wx-build.php bakes from Nominatim.
php -r '$j=json_decode(file_get_contents("wx-places.json"),true);
$d=new PDO("sqlite:.history.db");
$w=json_decode($d->query("SELECT body FROM page WHERE url=\"wx:box\"")->fetchColumn(),true);
$bad=0; foreach($w["points"] ?? [] as $p){ if(!isset($p["tmax"])) continue;
 if(!isset($j[$p["id"]])){ $bad++; echo "  NOT BAKED: ",$p["id"],"\n"; } }
echo $bad ? "FAIL: $bad rows\n" : "OK: every temperature came from the baked table\n";'

# The weather archive. One row per point per MET issue, stamped with MET's own issue time. A row
# stamped with the poll minute means something bypassed the stamp rule.
php -r '$d=new PDO("sqlite:.history.db");
printf("rows: %d, points: %d, newest: %s\n",
  $d->query("SELECT COUNT(*) FROM level WHERE station LIKE \"wx-%\"")->fetchColumn(),
  $d->query("SELECT COUNT(DISTINCT station) FROM level WHERE station LIKE \"wx-%\"")->fetchColumn(),
  date("Y-m-d H:i", (int)$d->query("SELECT MAX(ts) FROM level WHERE station LIKE \"wx-%\"")->fetchColumn()));'
```

- [ ] **Step 3: Add the file rows to the `## Files` table in `CLAUDE.md`**

```
| `js/wx.js` | the MET weather layer: the map mode, the pins, and the half-hour panel. Deferred |
| `wx-build.php` | `php wx-build.php` — bakes `wx-places.json` from Nominatim. Run by hand, never in a request |
| `wx-places.json` | the district behind each weather point, baked and committed |
```

- [ ] **Step 4: Add the gotchas to `CLAUDE.md`**

Append to the gotcha list:

```
- **MET publishes no past, and the weather panel needs one.** A nowcast marker holds the current
  word and six forward steps at 30 minutes each. It never answers what happened an hour ago. So a
  refresh writes one `level` row per point, keyed `wx-<slug>`, stamped with **MET's own issue time
  and never the poll time** — the rule `readTs()` states for every other writer to that table. The
  `(station, ts)` primary key then dedupes a re-read of one issue to one row, and `RETAIN` prunes
  it with everything else. There is no schema change.
  **`WX_PAST` anchors on the issue stamp, not on `now`.** A window measured from `now` drops a
  sample as the clock moves, which changes the `?wx=1` body between two MET issues and kills the
  304 — the same fault `cacheAge` caused on the payload. Never put a field in that body that moves
  without the data moving.
- **No station may supply a weather point's district.** `metDaily()` keys its rows by district and
  a nowcast point carries none, so the join needs one from somewhere. The nearest station is the
  tempting answer and it is wrong twice. It reads as that station reporting a temperature, and no
  station in this payload holds a weather reading. And it is measurably wrong at the edge: the
  nearest station to `Bentong` sits 20.9 km away in Hulu Selangor, so a Pahang town would print a
  Selangor temperature. `wx-build.php` bakes the district from Nominatim instead, through
  `district` then `city` then `state` — Kuala Lumpur is a federal territory with no daerah, so
  `city` answers there, and Putrajaya answers on `state`.
- **`rainy_heavy` carries no cloud, so the map states heavy rain by color.** Rendered at 31px
  beside `rainy` it reads as hatching rather than as more of one thing. `WEATHER[].pin` is the
  map's ladder and `WEATHER[].icon` is the card's: the card keeps the streaks, because at `wxbig`
  size they read and the card has no color ladder to carry intensity with.
  **The weather pins are the one documented exception to the color rule**, and it holds on one
  condition: weather mode draws no station pin, so nothing status-colored shares the map and an
  amber glyph cannot read as a station in trouble. The status set is saturated and this set is
  muted, so the two also separate by vividness. Gold `#f2b705` was measured and rejected — it sits
  within a shade of `--s-alert` on the light theme and matches `#ffc000` on the dark one.
  **Heavy differs from rain by saturation and never by lightness.** `.pin` uses one palette on both
  themes because a pin has to win over the basemap, so a darker heavy pin disappears into the dark
  tile.
- **Weather mode never writes `PREFS.heatLayer`.** `syncHeat()` reads `PREFS.wx` as one more input
  and drops both canvases while the mode is on. So leaving the mode restores the reader's heatmap
  with nothing remembered and nothing to get wrong. Do not add a "previous layer" field.
  **`PREFS.wx` persists across a reload**, which means a reader can land on a map with no flood
  stations on it. `#shown` states `Weather map · flood stations hidden` and the drawer summary
  reads `on · stations hidden`. Those two lines are the whole of what says why, so do not delete
  either one.
- **Two MET points stand 80 m apart and never separate.** `Serdang` and `Seri Kembangan` measure
  16 screen pixels apart at zoom 15, so `WX_THIN_PX` keeps one of them at every zoom a reader uses.
  That is right — two points 80 m apart report one weather — but somebody who knows both names will
  only ever find one. The layer thins rather than clusters for the same family of reason: a cluster
  badge reading 6 cannot say WHICH weather.
```

- [ ] **Step 5: Add the feature entry to `docs/FEATURES.md`**

Append a section. Cover what the layer does. Cover why the points ride `?wx=1` and not the payload. Cover why the archive exists. Cover why Nominatim answers the district and no station does. Cover why the panel reuses the `Later` cell. List the five items the spec ships unverified. Link the spec.

- [ ] **Step 6: Check the prose**

Run:

```bash
python "C:/Users/illus/.claude/ste-lint.py" < CLAUDE.md
python "C:/Users/illus/.claude/ste-lint.py" < docs/FEATURES.md
```

Expected: no rise in any count except `long_paragraph`, which counts each table row and each list item as a sentence.

- [ ] **Step 7: Run every check**

Run:

```bash
php -l api.php && php -l sources.php && php -l wx-build.php
php api.php --selftest | tail -5
php shots-test.php | tail -3
```

Expected: no syntax errors, and both checks report no failures.

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/pages.yml CLAUDE.md docs/FEATURES.md
git commit -m "Bake the weather layer on Pages and document it

The bake lifts the wx:box row into wx.json. It is conditional, because a
missing weather file must never stop the map updating.

Five gotchas: MET publishes no past, no station may supply a district,
rainy_heavy carries no cloud, the mode never writes PREFS.heatLayer, and
two points 80 m apart never separate.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

---

### Task 8: One Layers section

**Files:**
- Modify: `index.html` — the two `<details>` become one, and `#kinds` swaps its glyph
- Modify: `css/base.css` — the `hr` selector follows the renamed section
- Modify: `js/heat.js` — `syncHeat()` writes the one summary
- Modify: `js/wx.js` — `syncWx()` writes no summary, and the failure surface moves
- Modify: `js/ui.js` — the failure surface moves

**Interfaces:**
- Consumes: `PREFS.wx` and `PREFS.heatLayer` from Task 5.
- Produces: `#layersect`, `#layerN`, `#wxHint`. `#heatsect`, `#wxsect`, `#heatN` and `#wxN` are gone.

**Why:** weather mode forces both heatmaps off, so exactly one of the three ever paints. Two
sections said otherwise. A reader had to open both to learn what the map draws.

- [ ] **Step 1: Replace both `<details>` in `index.html` with one**

Delete the whole `<details id="heatsect">` block and the whole `<details id="wxsect">` block. Put
this in their place:

```html
    <!-- One section, because the three layers in it answer one question: what does the map paint.
         Weather mode forces both heatmaps off, so exactly one of the three ever paints.
         No `checked` attribute on any box. `PREFS.heatLayer` and `PREFS.wx` are the source of
         truth, and syncHeat() and syncWx() write the boxes from them. A hard-coded state here is a
         second source that can only disagree. It disagrees during the window before the deferred
         module runs. `autocomplete="off"` stops the other writer. A browser restores a checkbox
         across a reload without firing `change`. Every checkbox a preference owns carries it. -->
    <details id="layersect" class="sect" open>
      <summary><i class="i i-layers"></i>Layers<b id="layerN"></b></summary>
      <label class="chip"><input type="checkbox" id="heat" autocomplete="off">
        <i class="glyph i i-water_drop"></i>Water-level heatmap</label>
      <label class="chip"><input type="checkbox" id="rainHeat" autocomplete="off">
        <i class="glyph i i-rainy"></i>Rainfall heatmap</label>
      <!-- Weather is a mode rather than a wash, because it hides every station. It rides here
           because it is the third answer to the one question this section asks. -->
      <label class="chip"><input type="checkbox" id="wxLayer" autocomplete="off">
        <i class="glyph i i-sunny"></i>MET nowcast map <span id="wxHint" class="hint"></span></label>
      <!-- Under a rule because these two are not a fourth layer. The three above are one
           mutually-exclusive choice about what the map paints. These filter the pins. -->
      <hr>
      <label class="chip"><input type="checkbox" id="risingOnly" autocomplete="off">
        <i class="glyph i i-warning"></i>Rising stations only <span id="risingHint" class="hint"></span></label>
      <!-- A view filter, like the district picker and unlike the ignored list. It hides pins and
           changes no alert. Two things say it is on: this panel, and the `· favorites only` note
           in #shown below. That is the pair the ignored list uses. It needs no standing pill the
           way the rising filter does. That one is a lone checkbox with no list under it saying
           what it took away, and this one has exactly that list. -->
      <label class="chip"><input type="checkbox" id="favOnly" autocomplete="off">
        <i class="glyph i i-favorite"></i>Favorites only <span id="favHint" class="hint"></span></label>
    </details>
```

- [ ] **Step 2: Give `#kinds` a glyph of its own**

`i-layers` now belongs to the Layers section. In `index.html`, change the `#kinds` summary line
from `<i class="i i-layers"></i>Sensor kinds` to:

```html
      <summary><i class="i i-apps"></i>Sensor kinds<b id="kindN"></b></summary>
```

`apps` is a grid, which suits a row of one chip per kind. Confirm `--i-apps` exists in
`css/icons.css` before relying on it.

- [ ] **Step 3: Follow the rename in `css/base.css`**

One selector names the old section. Change `#heatsect hr` to `#layersect hr`. The declarations
stay as they are.

- [ ] **Step 4: Write the one summary from `syncHeat()`**

In `js/heat.js`, replace the `el('heatN').textContent = ...` assignment with:

```js
  /* One summary for the whole section, written here because this function already reads both
     preferences. Two writers on one line age apart, which is the fault this function exists to
     prevent. syncWx() writes no summary.
     It names the layer on screen rather than the preference behind it. A reader who opens the
     drawer during weather mode wants to know what the map draws. */
  el('layerN').textContent = !show ? 'weather'
    : wet ? 'water level' : rainy ? 'rainfall' : 'off';
```

Bump `?v=` on every stylesheet link in `index.html`, because `css/base.css` changed.

- [ ] **Step 5: Take the summary and the failure surface out of `js/wx.js`**

In `syncWx()`, delete the `el('wxN').textContent = ...` line. Nothing replaces it.

In `tick()`, replace the `el('wxsect').classList.toggle('loadfail', ...)` line with:

```js
  /* The chip says so, not the section. `.loadfail` prints a dialog-sized message, and this section
     also holds two heatmaps that work. `.hint` is the small slot the two filter chips below
     already use for the same job. */
  el('wxHint').textContent = pts.length === 0 ? 'no data yet' : '';
```

- [ ] **Step 6: Move the failure surface in `js/ui.js`**

In the `#wxLayer` handler, replace the three `el('wxsect')` references. The `remove` becomes a
cleared hint. The `lazy()` box becomes the label around the chip. The `add` becomes a written
hint.

```js
el('wxLayer').onchange = async e => {
  PREFS.wx = e.target.checked;
  save();
  el('wxHint').textContent = '';
  try {
    const m = await lazy(() => import('./wx.js'), e.target.closest('label'));
    await m.tick();
  } catch {
    PREFS.wx = false;
    save();
    e.target.checked = false;
    el('wxHint').textContent = 'could not load';
  }
  syncHeat();
  render();
};
```

Keep the comment block above that handler. Its last sentence names `#wxsect` as the surface this
caller owns. Update it. The surface is `#wxHint` now.

- [ ] **Step 7: Confirm nothing still names the old ids**

Run:

```bash
grep -rn "heatsect\|wxsect\|heatN\|wxN" js/*.js css/*.css index.html \
  && echo "FAIL: an old id survives" || echo "OK: no old id remains"
grep -c 'id="layerN"\|id="wxHint"\|id="layersect"' index.html
```

Expected: `OK: no old id remains`, then `3`.

- [ ] **Step 8: Syntax-check and serve-check**

```bash
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
for f in js/*.js css/*.css; do
  curl -sk -o /dev/null -w "%{content_type} $f\n" "https://flood-exp.test/$f"; done | grep -v 'javascript\|css'
```

Expected: no output from either.

- [ ] **Step 9: Look at it**

Load `https://flood-exp.test/` with a hard reload and open the drawer. Confirm each of these:
- One section reads `Layers`, holding three layer chips, a rule, then the two filter chips.
- `Sensor kinds` draws the grid glyph and no longer shares one with `Layers`.
- With nothing on, the summary reads `off`. With water-level heat on it reads `water level`.
- Ticking `MET nowcast map` makes the summary read `weather`, and the water-level box stays ticked.
- Unticking it puts the summary back to `water level`, and the heatmap returns.

- [ ] **Step 10: Commit**

Commit `index.html`, `css/base.css`, `js/heat.js`, `js/wx.js` and `js/ui.js` together. Use the
subject `Merge the heatmap and weather sections into one Layers section`.

State three things in the body. Exactly one of the three layers ever paints, so two sections misled
a reader. `syncHeat()` writes the one summary, because it already reads both preferences. Merging
the sections merged no state, so leaving weather mode still restores the heatmap.

End with the `Co-Authored-By` trailer this repo uses.

## Self-review

**Spec coverage.** Every section of the spec maps to a task. Goal and the point set to Task 2. Delivery and the ETag to Tasks 2 and 3. The archive to Task 2. Temperature to Tasks 1 and 2. The map to Tasks 4 and 5. The panel to Task 5. Exits to Task 6. The static build, the checks and the file list to Task 7.

**One gap the plan does not close.** The spec names five items that ship unverified. Four of them close in no task here. The upstream that answers them returns an empty array. Task 7 Step 5 writes them down. **This plan does not test the temperature join.**

**Type consistency.** Five PHP names keep one spelling across Tasks 1, 2 and 7: `wxSlug()`, `wxInBox()`, `wxPlaces()`, `wxPast()` and `wxRows()`. Three module exports keep one spelling across Tasks 5, 6 and 7: `syncWx()`, `tick()` and `card()`. Five constants each appear with one name: `WX_KEY`, `WX_PAST`, `WX_PLACES`, `WX_THIN_PX` and `FEED_WX`.

**Two steps tell the worker to read before writing.** Task 2 Step 6 depends on the signature of `pageRow()`. Task 5 Step 8 depends on the imports already in `ui.js`. Both say so rather than guess.
