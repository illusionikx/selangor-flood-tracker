# MET weather on the station card — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a three-column weather section on every station card. Take it from two MET Malaysia feeds. Add no alert surface and no browser third party.

**Architecture:** `sources.php` gains two parsers and one pure derivation function. `api.php` fetches both feeds inside the existing page cache. It joins them onto stations by distance and by district. It stamps one `met` object per station. `js/popup.js` renders that object as a `.sensor` block. No client code scores anything.

**Tech Stack:** PHP 8 with curl and sqlite. Vanilla ES modules. No build step. No test framework — the checks are `php api.php --selftest`, `php -l`, `node --check` and `curl`.

Spec: [`docs/superpowers/specs/2026-08-11-met-weather-design.md`](../specs/2026-08-11-met-weather-design.md)

## Global Constraints

Every task inherits all of these.

- **No new browser third party.** PHP reaches `www.met.gov.my` and `api.data.gov.my`. The browser reaches neither.
- **Never `file_get_contents()` an upstream URL.** Every outbound call goes through `fetchAll()` in `api.php`.
- **Everything on the refresh path stays inside the `flock` on `.refresh.lock`.**
- **`php api.php --selftest` must exit 0.** Run it after every task that touches PHP.
- **`php shots-test.php` must stay green.** Run it after any task that touches `api.php`.
- **Colour values live only in `css/base.css`,** two sets, one per theme. Never write a hex into a JS file.
- **`--k-weather` must not be a traffic-light hue.** Green, amber, orange and red belong to status.
- **Bump `?v=` in `index.html` for every CSS file you edit.** Hard-reload after any `js/` change.
- **Prose you write into files follows Simplified Technical English.** This covers code comments. Use active voice and one instruction per sentence. Keep to 20 words. Use no semicolons and no contractions. Use American spelling. Check with `python "C:/Users/illus/.claude/ste-lint.py" < FILE`.
- **No alert surface.** Do not touch `isHot()`, `isCritical()`, `atDanger()`, `alerts.js`, `ticker.js` or `toast.js`.
- **Constants:** `MET_URL` `https://www.met.gov.my/nowcasting/`, `MET_DAY_URL` `https://api.data.gov.my/weather/forecast/`, `MET_KM` `15.0`, `MET_STALE` `7200`, `MET_DAY_TTL` `21600`.

## File Structure

| file | change | responsible for |
|---|---|---|
| `sources.php` | modify | parsing both MET feeds, and deriving the rain span. No I/O, no joining. |
| `api.php` | modify | fetching, caching, joining onto stations, the `met` object, the counters |
| `css/icons.css` | modify | three new glyph masks |
| `css/base.css` | modify | the `--k-weather` token, two values |
| `css/map.css` | modify | the three-column grid inside the card |
| `js/config.js` | modify | `WEATHER` — the words and the glyph per rung |
| `js/popup.js` | modify | `metSection()`, and its call from both card builders |
| `index.html` | modify | the About pane, and three `?v=` bumps |
| `CLAUDE.md` | modify | files table, sources table, gotcha, Verify block |
| `docs/FEATURES.md` | modify | the entry and the reasoning |

`sources.php` holds no I/O by design. It receives page bodies and returns arrays. That is what lets `--selftest` check every parser offline.

---

### Task 1: Parse the nowcast page

**Files:**
- Modify: `sources.php` (append after `klLatLng()`, around line 153)
- Test: `api.php` `--selftest` block (insert after the `sirenBacked()` assertions, around line 690)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `metRung(string $word): int` — `0` clear, `1` rain, `2` heavy rain, `-1` unrecognized.
  - `metClock(string $ampm): ?string` — `"03:10 PM"` to `"15:10"`, `null` on a parse failure.
  - `metPoints(string $html): array` — list of `['name'=>string, 'lat'=>float, 'lng'=>float, 'rungs'=>int[7], 'clocks'=>array{0:null,1..6:string}, 'stamp'=>int]`.

- [ ] **Step 1: Write the failing test**

Insert into `api.php`, immediately before the final `exit($fail ? 1 : 0);` of the `--selftest` block:

```php
    /* The nowcast page bakes its data into L.marker() calls, so the parser is the only contract we
       have with it. A wording change must drop the marker, not read as clear weather — that is what
       the -1 rung is for, and what makes met.parsed fall when MET moves something. */
    echo "\nmetRung():\n";
    $ok('tiada hujan is clear',        metRung('Tiada Hujan') === 0);
    $ok('hujan is rain',               metRung('Hujan') === 1);
    $ok('hujan lebat is heavy',        metRung('Hujan Lebat') === 2);
    $ok('case does not matter',        metRung('  tiada   hujan ') === 0);
    $ok('an unknown word is refused',  metRung('Ribut Petir') === -1);

    echo "\nmetClock():\n";
    $ok('an afternoon time converts',  metClock('03:10 PM') === '15:10');
    $ok('a morning time converts',     metClock('09:40 AM') === '09:40');
    $ok('noon converts',               metClock('12:10 PM') === '12:10');
    $ok('midnight converts',           metClock('12:40 AM') === '00:40');
    $ok('rubbish is refused',          metClock('later') === null);

    echo "\nmetPoints():\n";
    $mk = fn(string $name, string $now, array $six) =>
        "lov[1] = L.marker([3.10220, 101.64480], {icon: cerahIcon}).addTo(mymap).bindPopup('"
        . "<span class=\"font-bold\">$name</span><br /><br /><span class=\"cuaca\">Sekarang: $now</span>"
        . "<br /><br /><span class=\"cuaca2\">Ramalan pada: <br />"
        . implode('', array_map(
            fn($v, $i) => '<span class="cuaca2">' . sprintf('%02d:10 PM', 3 + $i) . ": $v</span><br />",
            $six, array_keys($six)))
        . "<br /> <small>Tarikh kemaskini : 11/08/2026 02:40 PM</small>');";

    $one = metPoints($mk('Petaling Jaya', 'Tiada Hujan',
        ['Hujan', 'Hujan', 'Hujan Lebat', 'Tiada Hujan', 'Tiada Hujan', 'Tiada Hujan']));
    $ok('one marker parses',        count($one) === 1);
    $ok('the name comes through',   ($one[0]['name'] ?? '') === 'Petaling Jaya');
    $ok('the coordinate parses',    abs(($one[0]['lat'] ?? 0) - 3.1022) < 1e-6);
    $ok('seven rungs come out',     count($one[0]['rungs'] ?? []) === 7);
    $ok('now is the first rung',    ($one[0]['rungs'][0] ?? -9) === 0);
    $ok('heavy rain is read',       ($one[0]['rungs'][3] ?? -9) === 2);
    $ok('clocks are 24 hour',       ($one[0]['clocks'][1] ?? '') === '15:10');
    $ok('now carries no clock',     ($one[0]['clocks'][0] ?? 'x') === null);
    $ok('the stamp is a unix time', ($one[0]['stamp'] ?? 0) > 1000000000);

    /* A marker MET words differently must vanish, so the counter falls and somebody looks. */
    $bad = metPoints($mk('Nowhere', 'Ribut Petir',
        ['Hujan', 'Hujan', 'Hujan', 'Hujan', 'Hujan', 'Hujan']));
    $ok('an unreadable rung drops the marker', $bad === []);
    $ok('an empty page parses to nothing',     metPoints('') === []);
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `php api.php --selftest`
Expected: `PHP Fatal error: Uncaught Error: Call to undefined function metRung()`

- [ ] **Step 3: Write the parser**

Append to `sources.php`, after `klLatLng()`:

```php
/* --- MET Malaysia nowcast ------------------------------------------------------------------- */

/**
 * MET publishes three rungs in Bahasa. Test "tiada hujan" before "hujan", because the first
 * contains the second and the order is the whole rule.
 *
 * -1 means "MET wrote something this parser does not know". The caller drops the whole marker on
 * it. Reading an unknown word as clear would hide a layout change behind calm weather, which is the
 * one failure a scraper must not have.
 */
function metRung(string $word): int {
    $w = strtolower(trim(preg_replace('/\s+/', ' ', $word)));
    if (str_contains($w, 'tiada hujan')) return 0;
    if (str_contains($w, 'lebat'))       return 2;
    if (str_contains($w, 'hujan'))       return 1;
    return -1;
}

/** "03:10 PM" to "15:10". Everything this app prints is 24-hour and Malaysian. */
function metClock(string $ampm): ?string {
    $d = DateTime::createFromFormat('h:i A', trim(preg_replace('/\s+/', ' ', $ampm)));
    return $d ? $d->format('H:i') : null;
}

/**
 * Every point on the nowcast page. The page renders its Leaflet map on the server, so the data is
 * in 294 `L.marker(...)` statements and there is no second request to intercept.
 *
 * Returns one entry per readable marker. `rungs` holds seven values, index 0 being now and index 6
 * being three hours out. `clocks` is parallel to it, with index 0 null because now has no clock.
 *
 * A marker is dropped whole when any of its seven values is unreadable, when it carries fewer than
 * six forecast steps, or when its stamp will not parse. Dropping shows up as a falling
 * `sources.met.parsed`, which is the only alarm a silent scraper gets.
 */
function metPoints(string $html): array {
    $out = [];
    preg_match_all(
        "/L\.marker\(\[\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\][^)]*\)\s*\.addTo\([^)]*\)\s*\.bindPopup\('(.*?)'\)/s",
        $html, $ms, PREG_SET_ORDER);

    foreach ($ms as [, $lat, $lng, $pop]) {
        if (!preg_match('/font-bold[^>]*>([^<]+)</', $pop, $n)) continue;
        if (!preg_match('/Sekarang:\s*([^<]+)</', $pop, $now)) continue;
        if (!preg_match('/kemaskini\s*:\s*([\d\/]+\s+[\d:]+\s*[AP]M)/i', $pop, $st)) continue;

        preg_match_all('/(\d\d:\d\d\s*[AP]M)\s*:\s*([^<]+)</i', $pop, $steps, PREG_SET_ORDER);
        if (count($steps) < 6) continue;
        $steps = array_slice($steps, 0, 6);

        $rungs  = [metRung($now[1])];
        $clocks = [null];
        foreach ($steps as [, $when, $what]) {
            $rungs[]  = metRung($what);
            $clocks[] = metClock($when);
        }
        // Index 0 is deliberately null — now has no clock — so only steps 1 to 6 are tested.
        if (in_array(-1, $rungs, true) || in_array(null, array_slice($clocks, 1), true)) continue;

        $stamp = DateTime::createFromFormat('d/m/Y h:i A', preg_replace('/\s+/', ' ', trim($st[1])),
                                            new DateTimeZone('Asia/Kuala_Lumpur'));
        if (!$stamp) continue;

        $out[] = [
            'name'   => trim(preg_replace('/\s+/', ' ', $n[1])),
            'lat'    => (float)$lat,
            'lng'    => (float)$lng,
            'rungs'  => $rungs,
            'clocks' => $clocks,
            'stamp'  => $stamp->getTimestamp(),
        ];
    }
    return $out;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `php -l sources.php && php api.php --selftest`
Expected: `No syntax errors` then every new line reading `ok`, and the run exiting 0.

- [ ] **Step 5: Check the parser against the live page**

Run:
```bash
curl -sk -A "Mozilla/5.0" "https://www.met.gov.my/nowcasting/" -o /tmp/nc.html
php -r 'require "sources.php"; $p = metPoints(file_get_contents("/tmp/nc.html"));
echo count($p), " points\n"; print_r($p[0]);'
```
Expected: about 294 points. A count under 250 means the regex missed a shape. Do not continue on a low count.

- [ ] **Step 6: Commit**

```bash
git add sources.php api.php
git commit -m "A parser for the MET nowcast, and a rung it refuses to guess at"
```

---

### Task 2: Derive the rain span

**Files:**
- Modify: `sources.php` (append after `metPoints()`)
- Test: `api.php` `--selftest` block (append after the Task 1 assertions)

**Interfaces:**
- Consumes: `metPoints()` output shape from Task 1 — `rungs` int[7], `clocks` array with index 0 `null`.
- Produces: `metSpan(array $rungs, array $clocks): ?array` returning `['now'=>int, 'hr1'=>int, 'rung'=>int, 'from'=>?string, 'to'=>string, 'open'=>bool]`, or `null` when every rung is clear.

- [ ] **Step 1: Write the failing test**

Append to the `--selftest` block, after the Task 1 assertions:

```php
    /* The span is what the card sentence is built from, and it is the one piece of logic here that
       can be quietly wrong. It runs first-to-last, not first-unbroken-run: 17 of 137 wet markers on
       one live page held the worst rung in more than one block, and reporting only the first block
       hides a return of the rain. */
    echo "\nmetSpan():\n";
    $ck = [null, '15:10', '15:40', '16:10', '16:40', '17:10', '17:40'];

    $ok('all clear says nothing',
        metSpan([0, 0, 0, 0, 0, 0, 0], $ck) === null);

    $a = metSpan([0, 0, 0, 2, 2, 0, 0], $ck);
    $ok('a later block reports its start',   $a['from'] === '16:10');
    $ok('and the first dry step after it',   $a['to'] === '17:10');
    $ok('and is not open',                   $a['open'] === false);
    $ok('and carries the worst rung',        $a['rung'] === 2);
    $ok('and the rung now',                  $a['now'] === 0);
    $ok('and the rung one hour out',         $a['hr1'] === 0);

    $b = metSpan([2, 2, 0, 0, 0, 0, 0], $ck);
    $ok('rain now carries no start',         $b['from'] === null);
    $ok('and ends at the first dry step',    $b['to'] === '15:40');

    $c = metSpan([2, 2, 2, 2, 2, 2, 2], $ck);
    $ok('rain to the last step is open',     $c['open'] === true);
    $ok('and reports the final clock',       $c['to'] === '17:40');
    $ok('and still carries no start',        $c['from'] === null);

    /* The broken pattern. Rain at 16:10, dry at 16:40, raining again and still raining at the end. */
    $d = metSpan([0, 0, 0, 1, 0, 1, 1], $ck);
    $ok('a broken block spans first to last', $d['from'] === '16:10');
    $ok('and stays open past the window',     $d['open'] === true);
    $ok('and reports the final clock',        $d['to'] === '17:40');

    /* hr1 is step index 2, which is one hour out, and it is its own column on the card. */
    $e = metSpan([0, 0, 1, 2, 2, 0, 0], $ck);
    $ok('hr1 reads step index 2',            $e['hr1'] === 1);
    $ok('and does not change the worst rung', $e['rung'] === 2);
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `php api.php --selftest`
Expected: `Call to undefined function metSpan()`

- [ ] **Step 3: Write the derivation**

Append to `sources.php`, after `metPoints()`:

```php
/**
 * The two facts the card sentence needs, out of seven values.
 *
 * The span runs from the FIRST occurrence of the worst rung to the LAST, not across the first
 * unbroken run of it. Measured on one live page, 17 of 137 wet markers hold the worst rung in more
 * than one block — `[0,0,0,1,0,1,1]` is real. First-run logic reports "Rain 16:10 until 16:40" and
 * hides the return. Spanning first to last overstates one dry half hour and understates nothing,
 * which is the direction a flood app must be wrong in.
 *
 * `to` names the step AFTER the last wet one, because MET labels instants and the rain stops
 * somewhere between the two. Naming the later one has the reader wait slightly too long. Naming the
 * earlier one has them stop too early.
 *
 * `open` is true when the worst rung still holds at MET's final step. `to` then carries that final
 * clock, and the card says "past" rather than "until" — the outlook ended, not the rain.
 */
function metSpan(array $rungs, array $clocks): ?array {
    $worst = max($rungs);
    if ($worst < 1) return null;

    $at    = array_keys($rungs, $worst, true);
    $first = $at[0];
    $last  = end($at);
    $open  = $last === count($rungs) - 1;

    return [
        'now'  => $rungs[0],
        'hr1'  => $rungs[2],
        'rung' => $worst,
        'from' => $first === 0 ? null : $clocks[$first],
        'to'   => $open ? $clocks[$last] : $clocks[$last + 1],
        'open' => $open,
    ];
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `php -l sources.php && php api.php --selftest`
Expected: every new line reading `ok`, and the run exiting 0.

- [ ] **Step 5: Commit**

```bash
git add sources.php api.php
git commit -m "One span out of seven steps, measured first to last so a return of the rain still shows"
```

---

### Task 3: Parse the daily forecast

**Files:**
- Modify: `sources.php` (append after `metSpan()`)
- Test: `api.php` `--selftest` block (append after the Task 2 assertions)

**Interfaces:**
- Consumes: nothing.
- Produces: `metDaily(string $json): array` — a map of lowercase district name to `['tmin'=>int, 'tmax'=>int]`. District rows only.

- [ ] **Step 1: Write the failing test**

Append to the `--selftest` block:

```php
    /* The forecast call answers for three tiers of place. Only the district tier joins to a station,
       because api.php already normalizes `district`. A state row named "Selangor" would otherwise
       overwrite a district of the same name on some other feed's day. */
    echo "\nmetDaily():\n";
    $rows = json_encode([
        ['location' => ['location_id' => 'Ds057', 'location_name' => 'Petaling'],
         'min_temp' => 24, 'max_temp' => 34],
        ['location' => ['location_id' => 'St008', 'location_name' => 'Selangor'],
         'min_temp' => 20, 'max_temp' => 40],
        ['location' => ['location_id' => 'Tn066', 'location_name' => 'Pelabuhan Klang'],
         'min_temp' => 21, 'max_temp' => 41],
        ['location' => ['location_id' => 'Ds058', 'location_name' => 'Kuala Lumpur'],
         'min_temp' => 25, 'max_temp' => 33],
    ]);
    $day = metDaily($rows);
    $ok('district rows are kept',      isset($day['petaling']));
    $ok('the key is lowercased',       ($day['petaling']['tmax'] ?? 0) === 34);
    $ok('the minimum comes through',   ($day['petaling']['tmin'] ?? 0) === 24);
    $ok('a second district is kept',   ($day['kuala lumpur']['tmax'] ?? 0) === 33);
    $ok('state rows are dropped',      !isset($day['selangor']));
    $ok('town rows are dropped',       !isset($day['pelabuhan klang']));
    $ok('two districts in all',        count($day) === 2);
    $ok('rubbish parses to nothing',   metDaily('not json') === []);
    $ok('an empty body parses to nothing', metDaily('') === []);
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `php api.php --selftest`
Expected: `Call to undefined function metDaily()`

- [ ] **Step 3: Write the parser**

Append to `sources.php`:

```php
/* --- MET Malaysia daily forecast ------------------------------------------------------------ */

/**
 * Today's forecast temperatures, keyed by lowercase district name.
 *
 * The endpoint answers for three tiers of place — `Ds###` district, `St###` state, `Tn###` town.
 * Only the district tier is read, because `api.php` already normalizes a station's `district` and
 * that gives a join with no coordinates and no radius. A state row carries a name that collides
 * with a district on another feed, so keeping it would be a silent wrong answer.
 *
 * These two numbers are a FORECAST for the day. MET publishes no free observed temperature. The
 * card must print the word "today" beside them for that reason.
 */
function metDaily(string $json): array {
    $rows = json_decode($json, true);
    if (!is_array($rows)) return [];

    $out = [];
    foreach ($rows as $r) {
        $id   = $r['location']['location_id']   ?? '';
        $name = $r['location']['location_name'] ?? '';
        if (!str_starts_with($id, 'Ds') || $name === '') continue;
        if (!isset($r['min_temp'], $r['max_temp'])) continue;
        $out[strtolower(trim($name))] = ['tmin' => (int)$r['min_temp'], 'tmax' => (int)$r['max_temp']];
    }
    return $out;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `php -l sources.php && php api.php --selftest`
Expected: every new line reading `ok`, and the run exiting 0.

- [ ] **Step 5: Check against the live endpoint**

Run:
```bash
curl -skL "https://api.data.gov.my/weather/forecast/?filter=$(date +%F)@date" -o /tmp/wx.json
php -r 'require "sources.php"; $d = metDaily(file_get_contents("/tmp/wx.json"));
echo count($d), " districts\n"; print_r(array_slice($d, 0, 3, true));'
```
Expected: about 157 districts. Note the `-L`. The endpoint returns a 301 and gives 0 bytes without it.

- [ ] **Step 6: Commit**

```bash
git add sources.php api.php
git commit -m "The district tier of the daily forecast, and the two tiers it refuses"
```

---

### Task 4: Fetch both feeds through the page cache

**Files:**
- Modify: `api.php` constants block (after line 157), `api.php:1051-1066` (the page-cache block)
- Modify: `sources.php` (append `metUrls()`)

**Interfaces:**
- Consumes: `metPoints()`, `metDaily()` from Tasks 1 and 3.
- Produces:
  - `metUrls(int $now): array` — `['met-now' => MET_URL, 'met-day' => MET_DAY_URL . '?filter=…@date']`.
  - In `api.php` scope: `$metPts` (list from `metPoints()`, empty when the feed is stale or gone) and `$metDay` (map from `metDaily()`).

- [ ] **Step 1: Add the constants**

In `api.php`, after the `PLACE_*` block that ends around line 157, insert:

```php
/* MET Malaysia. Two products, two hosts, both reached from PHP only — the browser still talks to
   this origin and to CARTO and to nothing else.
   MET_KM is the radius a nowcast point may speak across. It comes from the decorrelation distance
   of rainfall, which grows with the period measured: about 7.8 km at 10 minutes and about 26.5 km
   at 3 hours. The card states a claim about a 3-hour window, so 15 km sits well inside it. A line
   that ever claims rain is falling AT THIS MOMENT needs a much tighter radius, near 3 km. Do not
   reuse this constant for one. */
const MET_URL     = 'https://www.met.gov.my/nowcasting/';
const MET_DAY_URL = 'https://api.data.gov.my/weather/forecast/';
const MET_KM      = 15.0;
const MET_STALE   = 7200;    // 2 h — an old projection is worse than none
const MET_DAY_TTL = 21600;   // 6 h — the forecast changes once a day
```

- [ ] **Step 2: Add `metUrls()` to `sources.php`**

Append to `sources.php`:

```php
/**
 * Both MET URLs, keyed for the page cache.
 *
 * The forecast is filtered to one day, which cuts the response from 585 KB to 103 KB. That puts a
 * date inside the cache key, so yesterday's row is dead the moment the date rolls. api.php prunes
 * those, the same way it prunes stale `place:` rows.
 */
function metUrls(int $now): array {
    return [
        'met-now' => MET_URL,
        'met-day' => MET_DAY_URL . '?filter=' . date('Y-m-d', $now) . '@date',
    ];
}
```

- [ ] **Step 3: Wire both into the existing page cache**

In `api.php`, replace lines 1051 to 1054:

```php
$extraUrls = nationalUrls() + klUrls();
$stored = [];
foreach ($db->query('SELECT url, ts, body FROM page') as $r) $stored[$r['url']] = $r;
$want = array_filter($extraUrls, fn($u) => ($stored[$u]['ts'] ?? 0) < $now - SCRAPE_TTL);
```

with:

```php
$extraUrls = nationalUrls() + klUrls() + metUrls($now);
$stored = [];
foreach ($db->query('SELECT url, ts, body FROM page') as $r) $stored[$r['url']] = $r;
// The daily forecast changes once a day, so it gets its own clock. Everything else keeps SCRAPE_TTL.
$ttlFor = fn(string $k) => $k === 'met-day' ? MET_DAY_TTL : SCRAPE_TTL;
$want = [];
foreach ($extraUrls as $k => $u) {
    if (($stored[$u]['ts'] ?? 0) < $now - $ttlFor($k)) $want[$k] = $u;
}
```

`$want` is now keyed by our own key rather than by URL. The next line already passes `$detailUrls + $want` to `fetchAll()`, which keys its result by URL, so this still works. Confirm by reading `fetchAll()` at `api.php:853`.

- [ ] **Step 4: Prune yesterday's forecast row**

In `api.php`, insert **after** the `$page = fn(string $k) => $pages[$k] ?? '';` line at 1067. Not before it — the next step reads through that closure, and `$page` does not exist above this line.

```php
// The forecast URL carries today's date, so a row a day old can never be read again. Two days of
// slack, so a clock that slips backward does not delete the row it is about to want.
$db->prepare('DELETE FROM page WHERE url LIKE ? AND ts < ?')
   ->execute([MET_DAY_URL . '%', $now - 2 * 86400]);
```

- [ ] **Step 5: Parse both, and drop a stale nowcast**

Immediately after the prune, insert:

```php
/* MET's own stamp decides whether the nowcast is worth having. A projection more than MET_STALE old
   describes weather that has already happened, and a card stating it would be worse than a card
   stating nothing — the same rule that renders an offline gauge grey rather than steady. */
$metPts = metPoints($page('met-now'));
$metPts = array_values(array_filter($metPts, fn($p) => $p['stamp'] >= $now - MET_STALE));
$metDay = metDaily($page('met-day'));
```

- [ ] **Step 6: Verify both feeds arrive**

Run:
```bash
php -l api.php && php -l sources.php
rm -f .cache.json
php api.php > /dev/null
php -r '$db = new PDO("sqlite:.history.db");
foreach ($db->query("SELECT url, ts, length(body) n FROM page") as $r)
  printf("%-72s %d %d\n", $r["url"], $r["ts"], $r["n"]);'
```
Expected: five rows. Three national or KL rows, plus one `met.gov.my/nowcasting/` row near 236000 bytes and one `api.data.gov.my` row near 103000 bytes.

- [ ] **Step 7: Run both existing checks**

Run: `php api.php --selftest && php shots-test.php`
Expected: both exit 0 with no `FAIL` line.

- [ ] **Step 8: Commit**

```bash
git add api.php sources.php
git commit -m "Both MET feeds ride the page cache, on two clocks and with the stale one dropped"
```

---

### Task 5: Join the feeds onto stations

**Files:**
- Modify: `api.php` — add `metNearest()` after `sirenBacked()` ends at line 234, and a join pass before the payload is built at line 1434
- Modify: `api.php:1464-1468` (the `sources` counters)
- Test: `api.php` `--selftest` block

**Interfaces:**
- Consumes: `$metPts`, `$metDay` from Task 4. `metSpan()` from Task 2.
- Produces: a `met` key on each station in `$stations`, shaped
  `['at'=>string, 'km'=>float, 'now'=>int, 'hr1'=>int, 'rung'=>int, 'from'=>?string, 'to'=>string, 'open'=>bool, 'tmin'=>int, 'tmax'=>int]`.
  **Every key is optional, including `at` and `km`.** A station beyond `MET_KM` still matches a
  district row, so it carries `tmin` and `tmax` with no point and no distance. Measured on live data:
  53 of 679 stations are in that state. Any reader of `met.at` must guard it. The whole key is absent
  only when there is nothing at all to say.
- Produces: `$metMatched` and `$metDayMatched` counters for the `sources` block.

- [ ] **Step 1: Write the failing test**

Append to the `--selftest` block:

```php
    /* The radius is the whole claim. A point inside it speaks for the station, a point outside it
       says nothing at all, and no station may take a value from a point it cannot reach. */
    echo "\nmetNearest():\n";
    $pts = [
        ['name' => 'Shah Alam',   'lat' => 3.0719, 'lng' => 101.5170],
        ['name' => 'Kuala Lumpur','lat' => 3.1593, 'lng' => 101.7114],
    ];
    // TAMAN SRI MUDA, 3.037984 / 101.534493 — about 4 km from Shah Alam.
    $near = metNearest(3.037984, 101.534493, $pts);
    $ok('the nearer point wins',       ($near[0]['name'] ?? '') === 'Shah Alam');
    $ok('the distance comes back',     $near[1] > 3.0 && $near[1] < 5.0);

    // F.D.C SEKINCHAN, 3.5 / 101.1 — far outside MET_KM of either point.
    $ok('a point out of reach is refused', metNearest(3.5, 101.1, $pts) === null);
    $ok('no points at all is refused',     metNearest(3.0379, 101.5344, []) === null);
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `php api.php --selftest`
Expected: `Call to undefined function metNearest()`

- [ ] **Step 3: Write the nearest-point join**

In `api.php`, insert after `sirenBacked()` ends at line 234:

```php
/**
 * The MET point nearest a station, or null when none is within MET_KM.
 *
 * This is Thiessen assignment, which is the same answer a Voronoi tessellation over the MET points
 * gives — a Voronoi cell holds exactly the area nearer its own seed than any other. So the polygons
 * are not built. `argmin` gives the identical result.
 *
 * Interpolation is not an option here and that is not a compromise. MET publishes a CATEGORY, and an
 * average of "Tiada Hujan" and "Hujan Lebat" is "Hujan", a reading MET never made. Kriging and
 * inverse distance weighting both beat Thiessen for areal rainfall in millimetres, and neither can
 * touch a category.
 *
 * Returns [point, km]. Equirectangular, like every other distance in this file.
 */
function metNearest(float $lat, float $lng, array $points): ?array {
    $best = null;
    $bestKm = INF;
    foreach ($points as $p) {
        $km = hypot($p['lat'] - $lat, ($p['lng'] - $lng) * cos(deg2rad($lat))) * 111;
        if ($km < $bestKm) { $bestKm = $km; $best = $p; }
    }
    return ($best !== null && $bestKm <= MET_KM) ? [$best, $bestKm] : null;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `php -l api.php && php api.php --selftest`
Expected: every new line reading `ok`, and the run exiting 0.

- [ ] **Step 5: Stamp the stations**

In `api.php`, find where `$payload = json_encode([` begins at line 1434. Insert this block immediately before it:

```php
/* Weather onto stations. Two joins, because the two feeds key differently. The nowcast joins by
   distance, since MET places its points by town and nothing links them to a station code. The
   forecast joins by district, which needs no coordinates at all.
   This adds no alert surface. Nothing here touches a status, a colour or a count. */
$metMatched = $metDayMatched = 0;

foreach ($stations as &$s) {
    $met = [];

    if ($metPts && $s['lat'] && $s['lng']) {
        $hit = metNearest($s['lat'], $s['lng'], $metPts);
        if ($hit) {
            [$p, $km] = $hit;
            /* `now` and `hr1` are carried whenever a point is in reach, because the card gives each
               of them a column and "clear" is an answer. Only the span keys — rung, from, to, open —
               depend on there being rain to describe, and metSpan() returns null when there is not.
               The `+` operator keeps the left side, so the two copies of `now` agree by construction. */
            $span = metSpan($p['rungs'], $p['clocks']);
            $met = ['at'  => $p['name'], 'km'  => round($km, 1),
                    'now' => $p['rungs'][0], 'hr1' => $p['rungs'][2]] + ($span ?: []);
            $metMatched++;
        }
    }

    /* Kuala Lumpur is one district to MET and thirteen constituencies to JPS — Segambut, Batu,
       Setiawangsa and the rest. Every one of them carries state "Kuala Lumpur", so the state is
       the key there. Match on state and district together everywhere else: district names repeat
       across states, which is the whole reason dkey() exists in js/util.js. */
    $dk = $s['state'] === 'Kuala Lumpur' ? 'kuala lumpur' : strtolower(trim((string)$s['district']));
    if (isset($metDay[$dk])) {
        $met += $metDay[$dk];
        $metDayMatched++;
    }

    if ($met) $s['met'] = $met;
}
unset($s);
```

The `+` operator on arrays keeps the left side, so `at` and `km` survive and the span keys land beside them. `$span ?: []` is what leaves the rain keys out when every rung reads clear.

- [ ] **Step 6: Add the counters**

In `api.php`, replace the `sources` block at lines 1464 to 1468:

```php
    'sources'  => [
        'kl'       => ['parsed' => count($kl), 'added' => $klAdded, 'merged' => $klDupes],
        'national' => ['parsed' => count($nat), 'applied' => count($natUsed),
                       'unmapped' => count($nat) - count($natUsed)],
    ],
```

with:

```php
    'sources'  => [
        'kl'       => ['parsed' => count($kl), 'added' => $klAdded, 'merged' => $klDupes],
        'national' => ['parsed' => count($nat), 'applied' => count($natUsed),
                       'unmapped' => count($nat) - count($natUsed)],
        'met'      => ['parsed' => count($metPts), 'matched' => $metMatched],
        'metday'   => ['parsed' => count($metDay), 'matched' => $metDayMatched],
    ],
```

- [ ] **Step 7: Verify the payload**

Run:
```bash
php -l api.php && rm -f .cache.json && php api.php > /dev/null
php -r '$p = json_decode(file_get_contents(".cache.json"), true);
print_r($p["sources"]);
$w = array_values(array_filter($p["stations"], fn($s) => isset($s["met"]["rung"])));
$t = array_values(array_filter($p["stations"], fn($s) => isset($s["met"]["tmax"])));
echo "with rain: ", count($w), "   with temperature: ", count($t), "\n";
if ($w) print_r($w[0]["met"]);
if ($t) print_r($t[0]["met"]);'
```
Expected: `met.parsed` near 294 and `met.matched` near 626. `metday.parsed` near 157 and `metday.matched` equal to the number of stations that carry a district. A `parsed` of 0 in either means a feed moved — stop and find out why before continuing.

- [ ] **Step 8: Check the coverage numbers the spec claims**

Run:
```bash
php -r '$p = json_decode(file_get_contents(".cache.json"), true);
$n = count($p["stations"]);
$m = count(array_filter($p["stations"], fn($s) => isset($s["met"]["at"])));
printf("%d of %d stations reached a MET point (%.0f%%)\n", $m, $n, 100 * $m / $n);
$far = array_filter($p["stations"], fn($s) => isset($s["met"]["km"]) && $s["met"]["km"] > 15);
echo "beyond MET_KM: ", count($far), "\n";'
```
Expected: about 626 of 679, which is 92%, and zero stations beyond `MET_KM`. A non-zero second number means the radius test is not being applied.

- [ ] **Step 9: Run both existing checks**

Run: `php api.php --selftest && php shots-test.php`
Expected: both exit 0.

- [ ] **Step 10: Commit**

```bash
git add api.php
git commit -m "Weather lands on a station by distance and by district, and counts itself twice"
```

---

### Task 6: The three glyphs, the token and the grid

**Files:**
- Modify: `css/icons.css` (append to the token block, near line 67 where `--i-rainy` already sits)
- Modify: `css/base.css:62` and `css/base.css:140` (the `--k-*` blocks)
- Modify: `css/map.css` (append after the `.sensorhead` rules that end at line 93)
- Modify: `index.html:33-36` (three `?v=` bumps)

**Interfaces:**
- Consumes: nothing.
- Produces: `--i-sunny`, `--i-rainy_heavy`, `--i-thermostat` in `css/icons.css`. `--k-weather` in both theme blocks of `css/base.css`. The classes `.wx`, `.wxcol`, `.wxnow`, `.wxout`, `.wxline` in `css/map.css`.

`--i-rainy` already exists at `css/icons.css:67`. Do not add it again.

- [ ] **Step 1: Add the three glyph masks**

In `css/icons.css`, beside `--i-rainy` at line 67, add three lines. These are Material Symbols at `fill=1`, fetched from `https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/<name>/fill1/24px.svg`, the same URL recorded at the top of that file:

```css
  --i-sunny: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 -960 960 960'><path d='M440-760v-160h80v160h-80Zm266 110-55-55 112-115 56 57-113 113Zm54 210v-80h160v80H760ZM440-40v-160h80v160h-80ZM254-652 140-763l57-56 113 113-56 54Zm508 512L651-255l54-54 114 110-57 59ZM40-440v-80h160v80H40Zm157 300-56-57 112-112 29 27 29 28-114 114Zm113-170q-70-70-70-170t70-170q70-70 170-70t170 70q70 70 70 170t-70 170q-70 70-170 70t-170-70Z'/></svg>");
  --i-rainy_heavy: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 -960 960 960'><path d='M338-204q-15 8-30.5 2.5T284-222L44-702q-8-15-2.5-30.5T62-756q15-8 30.5-2.5T116-738l240 480q8 15 2.5 30.5T338-204Zm187 0q-15 8-30.5 2.5T471-222L231-702q-8-15-2.5-30.5T249-756q15-8 30-2.5t23 20.5l241 480q8 15 2.5 30.5T525-204Zm187-1q-15 8-30.5 3T658-222L418-702q-8-15-2.5-30.5T436-756q15-8 30-2.5t23 20.5l241 480q8 15 2.5 30T712-205Zm155.5 3.5Q852-207 844-222L604-702q-8-15-2.5-30.5T622-756q15-8 30.5-2.5T676-738l240 480q8 15 2.5 30.5T898-204q-15 8-30.5 2.5Z'/></svg>");
  --i-thermostat: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 -960 960 960'><path d='M520-520v-80h200v80H520Zm0-160v-80h320v80H520ZM178.5-178.5Q120-237 120-320q0-48 21-89.5t59-70.5v-240q0-50 35-85t85-35q50 0 85 35t35 85v240q38 29 59 70.5t21 89.5q0 83-58.5 141.5T320-120q-83 0-141.5-58.5ZM200-320h240q0-29-12.5-54T392-416l-32-24v-280q0-17-11.5-28.5T320-760q-17 0-28.5 11.5T280-720v280l-32 24q-23 17-35.5 42T200-320Z'/></svg>");
```

Then add three classes to the class block, beside `.i-rainy` at line 124:

```css
.i-sunny { --i: var(--i-sunny); }
.i-rainy_heavy { --i: var(--i-rainy_heavy); }
.i-thermostat { --i: var(--i-thermostat); }
```

- [ ] **Step 2: Add the colour token**

In `css/base.css`, extend line 62 (the light theme) to read:

```css
  --k-gauge: #a06f5d; --k-camera: #23a3b1; --k-mast: #5d6deb; --k-weather: #4a7f8c;
```

and line 140 (the dark theme) to read:

```css
  --k-gauge: #d4a48f; --k-camera: #2fd6e8; --k-mast: #96a4ee; --k-weather: #7fb3c0;
```

A muted blue-grey. It must not be green, amber, orange or red — those belong to status, and this section states no status. It is deliberately not `--k-rainfall` violet, so a mast holding a rain gauge does not draw two violet sections side by side.

Add a comment above the light-theme line:

```css
  /* --k-weather is not a station kind. It colours the MET section on a card, which describes the
     place and not a sensor at it. It sits in this block because every colour value in this app
     does, and it must never take a traffic-light hue. */
```

- [ ] **Step 3: Add the grid**

Append to `css/map.css`, after the `.sensorhead` rules that end at line 93:

```css
/* The MET section. Three columns: the range for today, the weather now, then the hour ahead with
   the worst-rung line under it. `min-width: 0` on every cell, or a long word in the wide column
   pushes the two narrow ones out of shape — a grid item's default `min-width: auto` refuses to
   shrink below its content. */
.wx { display: grid; grid-template-columns: 1fr 1fr 3fr; gap: 8px; align-items: start; }
.wx > * { min-width: 0; }
.wxcol { display: flex; flex-direction: column; gap: 2px; font-size: 12px; line-height: 1.35; }
.wxcol .i { font-size: 15px; color: var(--k-weather); }
.wxnow { align-items: center; text-align: center; }
.wxout .wxline { color: var(--on-surface); }
.wx .muted { font-size: 11px; }
```

`--on-surface` is the ordinary body colour in `css/base.css`, at line 6 for the light theme and line 108 for the dark one. The `.wxline` rule lifts the worst-rung sentence out of `--muted` and up to body ink, because that line is the point of the section.

- [ ] **Step 4: Bump the three versions**

In `index.html`, change lines 33, 34 and 36:

```html
<link rel="stylesheet" href="css/icons.css?v=78">
<link rel="stylesheet" href="css/base.css?v=106">
<link rel="stylesheet" href="css/map.css?v=127">
```

Leave `css/chrome.css?v=139` alone. This task does not edit it.

- [ ] **Step 5: Verify every file still serves**

Run:
```bash
for f in css/icons.css css/base.css css/map.css; do
  curl -sk -o /dev/null -w "%{content_type} $f\n" "https://flood-exp.test/$f"; done
```
Expected: `text/css` for all three. Check the type and not the status. Herd answers a missing file with `index.html` and a 200.

- [ ] **Step 6: Commit**

```bash
git add css/icons.css css/base.css css/map.css index.html
git commit -m "Three glyphs, a colour that is not a status, and a grid that will not squash"
```

---

### Task 7: Render the section

**Files:**
- Modify: `js/config.js` (append `WEATHER`)
- Modify: `js/popup.js` — add `metSection()`, then call it from `popup()` at line 443 and `sitePopup()` at line 481

**Interfaces:**
- Consumes: `s.met` from Task 5. `--i-sunny`, `--i-rainy`, `--i-rainy_heavy`, `--i-thermostat` and `--k-weather` from Task 6.
- Produces:
  - In `js/config.js`: `WEATHER` — `[{ icon, word, line }, …]` indexed by rung.
  - In `js/popup.js`: `metSection(s)` returning an HTML string, or `''` when `s.met` is absent.

- [ ] **Step 1: Add the words**

Append to `js/config.js`:

```js
/* The three rungs MET publishes. `word` fills the narrow "now" column, so it has to be one word at
   about 64px. `line` opens the worst-rung sentence, which is why the two differ. */
export const WEATHER = [
  { icon: 'sunny',       word: 'Clear', line: '' },
  { icon: 'rainy',       word: 'Rain',  line: 'Rain' },
  { icon: 'rainy_heavy', word: 'Heavy', line: 'Heavy rain' },
];
```

- [ ] **Step 2: Write the section builder**

In `js/popup.js`, add `WEATHER` to the import from `./config.js` on line 4, then add this function above `popup()` at line 422:

```js
/* The MET section. One row of three columns, drawn once per card and never once per sensor — rain
   over a place is one fact, and sourceInfo() already taught this app what a per-place fact costs
   when it repeats down a six-sensor mast.
   This is not a sensor at this place. The head carries the point name and how far away it is, which
   is what lets a reader weigh a 14 km claim. */
function metSection(s) {
  const m = s.met;
  if (!m) return '';

  const w = r => WEATHER[r] || WEATHER[0];
  const head = w(m.rung ?? m.now ?? 0);

  /* Four shapes, and every one names both ends. `until` says the rain ends. `past` says the MET
     outlook ended, and never that the rain did.
     There is no "Raining now," prefix. The middle column states the weather now on every card, so
     the prefix repeated the cell beside it and cost the line a second row. */
  const rain = m.rung == null ? '' :
    `${w(m.rung).line}${m.from ? ` ${m.from}${m.open ? ',' : ''}` : ''} `
    + `${m.open ? 'past' : 'until'} ${m.to}`;

  const temp = m.tmax == null ? '' :
    `<div class="wxcol"><span><i class="i i-thermostat"></i> Today</span>
       <span>${m.tmin}–${m.tmax}°</span></div>`;

  const now = m.now == null ? '' :
    `<div class="wxcol wxnow"><i class="i i-${w(m.now).icon}"></i>
       <span>${w(m.now).word}</span></div>`;

  const out = m.hr1 == null ? '' :
    `<div class="wxcol wxout">
       <span><i class="i i-${w(m.hr1).icon}"></i> In 1 hour: ${w(m.hr1).word}</span>
       <span class="wxline">${rain}</span></div>`;

  return `<div class="sensor" data-sensor="@met">
      <div class="sensorhead">
        <i class="glyph i i-${head.icon}" style="color:var(--k-weather)"></i>
        <b>Weather</b>
        ${m.at ? `<span class="muted">${m.at} · ${m.km} km</span>` : ''}
      </div>
      <div class="wx">${temp}${now}${out}</div>
    </div>`;
}
```

That template produces exactly the four shapes in the spec, and nothing else:

| `from` | `open` | output |
|---|---|---|
| null | false | `Heavy rain until 16:10` |
| null | true | `Heavy rain past 17:40` |
| `16:10` | false | `Heavy rain 16:10 until 17:10` |
| `16:10` | true | `Heavy rain 16:10, past 17:40` |

The comma appears only in the last row. That is what the spec asks for, and it is the one shape where two clock times sit side by side with no word between them.

- [ ] **Step 3: Call it from both card builders**

In `js/popup.js`, change line 443 inside `popup()` from:

```js
    ${sensorBody(s)}`;
```

to:

```js
    ${metSection(s)}
    ${sensorBody(s)}`;
```

And in `sitePopup()`, change line 481 from:

```js
    ${hasCam ? '' : camLink(lead, nearestCam(lead))}
```

to:

```js
    ${metSection(lead)}
    ${hasCam ? '' : camLink(lead, nearestCam(lead))}
```

Both go after `.pophead` and before anything else. `.pophead` must stay the first element of the card. `openSide()` lifts it into `#sideHead`, and that seam must not move.

- [ ] **Step 4: Syntax-check the modules**

Run:
```bash
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
```
Expected: no output. `node --check` treats a bare `.js` as CommonJS, which is why each file is copied to `.mjs` first.

- [ ] **Step 5: Look at it**

Open `https://flood-exp.test` and hard-reload with Ctrl+Shift+R. ES module imports carry no `?v=` guard, so a plain reload may run the old module.

Open a station card and confirm:
- The Weather section sits directly under the place name and the badges.
- Three columns, roughly one fifth, one fifth and three fifths.
- The head reads a point name and a distance.
- The temperature reads `Today` over a range, and the word `Today` is present.
- The glyph is the blue-grey `--k-weather`, and no part of the section is green, amber, orange or red.

Then narrow the window under 600px and confirm the three columns still hold. `--side` becomes 84vw there, which leaves column 1 about 52px. If `24–34°` wraps, change `.wx` to two rows under a `@media (max-width: 600px)` query, with column 3 spanning the second row.

- [ ] **Step 6: Find a station with rain on it**

Run:
```bash
php -r '$p = json_decode(file_get_contents(".cache.json"), true);
foreach ($p["stations"] as $s) if (isset($s["met"]["rung"])) {
  printf("%-10s %-28s rung %d  from %-6s to %-6s open %d\n",
    $s["id"], $s["name"], $s["met"]["rung"], $s["met"]["from"] ?? "now",
    $s["met"]["to"], $s["met"]["open"]); }' | head
```
Open one of those stations on the map and read the third column. If nothing is raining anywhere, wait for weather or edit one `met` object in `.cache.json` by hand to check all four sentence shapes.

- [ ] **Step 7: Commit**

```bash
git add js/config.js js/popup.js
git commit -m "Three columns on the card, and a sentence that never claims an end MET did not publish"
```

---

### Task 7B: Forecast warnings in the alert panel, the ticker and a modal

**This task creates a new alert surface.** Everything else in this plan is passive information on a
card. This one puts MET warnings at the top of the alert panel and into the scrolling ticker. Read
the alert design standard in `docs/FEATURES.md` before you start. The rules below apply it.

**Files:**
- Modify: `sources.php` — add `metWarnings()`
- Modify: `api.php` — add two constants, fetch the feed, publish `warnings`
- Modify: `index.html` — a new `<dialog id="warnBox">`, and a `?v=` bump
- Modify: `js/alerts.js` — a section at the top of the `@alerts` panel
- Modify: `js/ticker.js` — warning tiles ahead of the station tiles
- Modify: `js/ui.js` — the delegated click that opens the modal
- Modify: `css/chrome.css` — styles for the section, the tile and the dialog

**Interfaces:**
- Consumes: the page-cache pattern from Task 4, and `metUrls()` in `sources.php`.
- Produces:
  - `metWarnings(string $json, int $now): array` — a list of
    `['title'=>string, 'text'=>string, 'from'=>string, 'to'=>string]`, newest first.
  - In the payload: a top-level `warnings` array, empty when nothing is live.
  - In `js/alerts.js`: `warnCard(list)` returning section HTML, or an empty string for an empty list.

#### What the feed is, measured

`https://api.data.gov.my/weather/warning` returns rows with exactly nine fields:

```
warning_issue{issued,title_bm,title_en}, valid_from, valid_to,
heading_en, text_en, instruction_en, heading_bm, text_bm, instruction_bm
```

**There is no geographic field.** The only place information sits inside `text_en` as free prose. A
live sample read `Strong southwesterly winds over 60 kmph with waves exceeding 4.5 metres are
expected over the waters of Phuket`. That warning is real, current, and useless on a Klang Valley
flood map.

Three more facts, measured on one live fetch. The feed carried seven rows and three were live. All
three were marine warnings. Two of the three repeated the first almost word for word. One row read
`No Advisory` and carried empty `valid_from` and `valid_to`.

#### The two filters, and the direction each one fails in

**Validity.** Keep a row only when both stamps parse and `valid_from <= now <= valid_to`. The
`No Advisory` row fails this and disappears, which is correct.

**Kind, in three tiers.** Match case-insensitively against `title_en` and `heading_en` joined.

*Tier one — always dropped.* Seismic rows and empty advisories say nothing about weather here:

```
earthquake   tsunami   gempa   no advisory   tiada
```

*Tier two — marine, kept only for the Straits of Melaka.* A row is marine when it names any of:

```
rough sea   strong wind   angin kencang   laut bergelora
```

A marine row survives **only** when its `text_en` or `text_bm` names the Straits of Melaka:

```
straits of melaka   straits of malacca   selat melaka
```

The reason is geography, not preference. **The Straits of Melaka is the Selangor coast, and Port
Klang stands on it**, so rough seas there reach the area this map covers. Waters off Phuket, Samui,
Condore, Layang-Layang, Palawan and Sulu do not. Measured against the live feed, this keeps one of
the three live marine warnings — the one reading `Northern Straits of Melaka` — and drops the other
two.

*Tier three — everything over land, kept only when it names somewhere this map covers.* Rain,
thunderstorm, flood and cyclone rows all reach this tier, and each must name one of:

```
selangor   kuala lumpur   putrajaya   lembah klang   klang valley   wilayah persekutuan
west coast   pantai barat
```

So both tiers end in the same shape: a marine row must name the Straits of Melaka, and a land row
must name one of these eight. One test, two word lists.

**The last pair is wider than the rest on purpose.** MET words some warnings by coast rather than by
state, and Selangor sits on the west coast of the peninsula. Without `west coast` a row reading
`heavy rain over the west coast of Peninsular Malaysia` covers this map and gets dropped silently —
the dangerous failure direction for an alert surface. The cost is a warning that also covers Perak
or Melaka now reaches the panel, which is the correct trade for a flood map.

**One gap remains, and it is deliberate.** A warning for the whole peninsula, worded `Peninsular
Malaysia` or `Semenanjung Malaysia` with no coast named, is still dropped. Record that in
`docs/FEATURES.md` as a known limitation, with the fix — add those two words — and the reason to
think before doing it: a peninsula-wide warning is usually about somewhere else.

**Dedupe.** Two rows are one warning when `title_en` and `text_en` both match. Keep the first.

#### Where the full text goes, and where the short text goes

Three surfaces, and they deliberately carry different amounts.

| surface | shows | on click |
|---|---|---|
| alert panel row | title, then the text shortened to one line | opens the modal |
| ticker tile | title, then the **full** text | opens the modal |
| modal | title, full text, and the validity window | closes |

The panel is a directory and its rows are scanned, so a row there gives a title and a clipped line.
The ticker has one line of its own and nothing below it to crowd, so it carries the whole sentence.
The modal is where a reader goes to read.

Shorten with CSS, never by cutting the string in JavaScript. `text-overflow: ellipsis` keeps the
whole sentence in the DOM for a screen reader and for anyone who copies it.

#### What must NOT change

The station alert path is untouched. `isHot()`, `isCritical()`, `atDanger()`, `tier()` and every
count in `alerts()` stay exactly as they are. A MET warning is not a station and must not enter
`live`, `hot`, `rising`, `danger`, `sirens` or `stale`.

All four of these keep reading the station count alone: `navigator.setAppBadge()`, `document.title`,
the tally glyphs, and the warning glyph colour.

A MET warning is a regional notice. A station reading is a measurement at a place. Merging the two
counts tells a reader that stations are in trouble when none is.

- [ ] **Step 1: Add the constants**

In `api.php`, beside the other MET constants:

```php
/* MET warnings. Short life, because a warning is worth having late and worthless stale. */
const MET_WARN_URL = 'https://api.data.gov.my/weather/warning';
const MET_WARN_TTL = 900;   // 15 min
```

In `sources.php`, add a third entry to `metUrls()`:

```php
        'met-warn' => MET_WARN_URL,
```

- [ ] **Step 2: Write the failing test**

Append to the `--selftest` block in `api.php`, before its final `exit(...)`:

```php
    /* The warning feed publishes no location at all. Every live row on the day this shipped was a
       marine warning for waters near Phuket and Samui, which is real weather and useless on this
       map. So the kind filter carries this surface, and it is an exclude list: an include list
       drops a warning MET rewords, and a dropped flood warning is the one failure this must never
       have. */
    echo "\nmetWarnings():\n";
    $wnow = 1786400000;
    $row = fn(string $title, string $text, int $from, int $to) => [
        'warning_issue' => ['title_en' => $title, 'issued' => ''],
        'valid_from' => date('Y-m-d\TH:i:s', $from),
        'valid_to'   => date('Y-m-d\TH:i:s', $to),
        'heading_en' => $title, 'text_en' => $text,
    ];
    $rain = $row('Thunderstorms Warning', 'Thunderstorms over Selangor', $wnow - 60, $wnow + 3600);
    $sea  = $row('Third Category Warning on Strong Winds and Rough Seas',
                 'Waves over the waters of Phuket', $wnow - 60, $wnow + 3600);
    $old  = $row('Thunderstorms Warning', 'Yesterday', $wnow - 7200, $wnow - 3600);
    $soon = $row('Thunderstorms Warning', 'Tomorrow', $wnow + 3600, $wnow + 7200);

    $w = metWarnings(json_encode([$rain, $sea, $old, $soon]), $wnow);
    $ok('a live rain warning survives',    count($w) === 1);
    $ok('and it carries its text',         ($w[0]['text'] ?? '') === 'Thunderstorms over Selangor');
    $ok('the parser drops a far sea warning', !array_filter($w, fn($x) => str_contains($x['text'], 'Phuket')));
    $ok('the parser drops an expired row', !array_filter($w, fn($x) => $x['text'] === 'Yesterday'));
    $ok('the parser drops a future row',   !array_filter($w, fn($x) => $x['text'] === 'Tomorrow'));

    /* The Straits of Melaka is the Selangor coast and Port Klang stands on it, so a marine warning
       naming those straits stays. One of the three live marine rows on the day this shipped read
       "Northern Straits of Melaka and Samui" and belongs here. The other two named only distant
       waters. Both halves of that split need a test, or the rule is one edit from silently
       dropping the coast or silently admitting the whole region. */
    $near = $row('Third Category Warning on Strong Winds and Rough Seas',
                 'Waves over the waters of Northern Straits of Melaka and Samui',
                 $wnow - 60, $wnow + 3600);
    $nearBm = $row('Amaran Angin Kencang dan Laut Bergelora', '', $wnow - 60, $wnow + 3600);
    $nearBm['text_bm'] = 'Ombak di perairan Utara Selat Melaka';

    $ok('a Straits of Melaka sea warning stays',
        count(metWarnings(json_encode([$near]), $wnow)) === 1);
    $ok('the Malay wording is matched too',
        count(metWarnings(json_encode([$nearBm]), $wnow)) === 1);
    $ok('a sea warning for other waters still drops',
        metWarnings(json_encode([$sea]), $wnow) === []);

    $dupe = metWarnings(json_encode([$rain, $rain, $rain]), $wnow);
    $ok('three identical rows collapse to one', count($dupe) === 1);

    $none = $row('No Advisory', '', $wnow, $wnow);
    $none['valid_from'] = '';
    $none['valid_to']   = '';
    $ok('a row with no validity is dropped', metWarnings(json_encode([$none]), $wnow) === []);
    $ok('rubbish parses to nothing',         metWarnings('not json', $wnow) === []);
    $ok('an empty body parses to nothing',   metWarnings('', $wnow) === []);

    /* A kind MET has not published before must still show, so long as it names somewhere here.
       The kind is not on any list. The place is what admits it. */
    $odd = $row('Flash Flood Warning', 'Flooding expected in Klang, Selangor', $wnow - 60, $wnow + 3600);
    $ok('an unknown kind still shows', count(metWarnings(json_encode([$odd]), $wnow)) === 1);

    /* The place test on a land row, both ways. This is the pair that would go unnoticed if the
       filter were edited: one half admits every state in the country, the other silences our own. */
    $away = $row('Thunderstorms Warning', 'Thunderstorms over Kelantan and Terengganu',
                 $wnow - 60, $wnow + 3600);
    $ok('a land warning naming nowhere here drops',
        metWarnings(json_encode([$away]), $wnow) === []);

    $kl = $row('Thunderstorms Warning', 'Thunderstorms over Kuala Lumpur', $wnow - 60, $wnow + 3600);
    $pj = $row('Thunderstorms Warning', 'Ribut petir di Putrajaya', $wnow - 60, $wnow + 3600);
    $lk = $row('Thunderstorms Warning', 'Hujan lebat di Lembah Klang', $wnow - 60, $wnow + 3600);
    $ok('Kuala Lumpur is matched', count(metWarnings(json_encode([$kl]), $wnow)) === 1);
    $ok('Putrajaya is matched',    count(metWarnings(json_encode([$pj]), $wnow)) === 1);
    $ok('Lembah Klang is matched', count(metWarnings(json_encode([$lk]), $wnow)) === 1);

    /* MET words some warnings by coast rather than by state, and Selangor is on the west coast.
       A row worded that way covers this map without naming it, so it has to pass. The peninsula-wide
       wording deliberately does not, and both halves need a test to hold that line. */
    $wc = $row('Continuous Rain Warning', 'Heavy rain over the west coast of Peninsular Malaysia',
               $wnow - 60, $wnow + 3600);
    $wcBm = $row('Amaran Hujan Berterusan', '', $wnow - 60, $wnow + 3600);
    $wcBm['text_bm'] = 'Hujan lebat di pantai barat Semenanjung Malaysia';
    $pen = $row('Continuous Rain Warning', 'Heavy rain over Peninsular Malaysia',
                $wnow - 60, $wnow + 3600);

    $ok('a west coast warning is matched',    count(metWarnings(json_encode([$wc]), $wnow)) === 1);
    $ok('pantai barat is matched too',        count(metWarnings(json_encode([$wcBm]), $wnow)) === 1);
    $ok('a peninsula wide warning still drops', metWarnings(json_encode([$pen]), $wnow) === []);
```

- [ ] **Step 3: Run it and watch it fail**

Run: `php api.php --selftest`
Expected: `Call to undefined function metWarnings()`

- [ ] **Step 4: Write the parser**

Append to `sources.php`:

```php
/* --- MET Malaysia warnings ------------------------------------------------------------------ */

/* Rows this map never shows. Seismic events and empty advisories say nothing about weather here. */
const WARN_DROP = ['earthquake', 'tsunami', 'gempa', 'no advisory', 'tiada'];

/* Rows about the sea. Most cover waters this map does not overlook, so they drop by default. */
const WARN_SEA = ['rough sea', 'strong wind', 'angin kencang', 'laut bergelora'];

/* The one stretch of sea that counts. The Straits of Melaka is the Selangor coast and Port Klang
   stands on it, so rough water there reaches the area this map covers. Waters off Phuket, Samui,
   Layang-Layang, Palawan and Sulu do not. A marine row survives only by naming these straits. */
const WARN_SEA_KEEP = ['straits of melaka', 'straits of malacca', 'selat melaka'];

/* The places this map covers. A warning over land must name one of them.
   The last pair is wider than the rest on purpose. MET words some warnings by coast rather than by
   state, and the west coast of the peninsula is where Selangor sits, so a row reading "the west
   coast of Peninsular Malaysia" reaches this map without naming it.
   A warning for the whole peninsula is still dropped. Add 'semenanjung' and 'peninsular' the day
   that trade goes the other way, and expect more warnings about other states when you do. */
const WARN_HERE = ['selangor', 'kuala lumpur', 'putrajaya', 'lembah klang', 'klang valley',
                   'wilayah persekutuan', 'west coast', 'pantai barat'];

/**
 * MET warnings that are live at $now, newest first.
 *
 * This function drops a row on any of five tests. It drops a row whose stamps do not parse. It
 * drops a row outside its own validity window. It drops a seismic row or an empty advisory. It
 * drops a row that names nowhere this map covers. It drops a row that repeats a title and text it
 * already kept.
 *
 * The place test uses one of two word lists. A marine row must name the Straits of Melaka, because
 * that water is the Selangor coast. Every other row must name a state or district here.
 */
function metWarnings(string $json, int $now): array {
    $rows = json_decode($json, true);
    if (!is_array($rows)) return [];

    $out = [];
    $seen = [];
    foreach ($rows as $r) {
        $title = trim((string)($r['warning_issue']['title_en'] ?? ''));
        $text  = trim((string)($r['text_en'] ?? ''));
        if ($title === '' && $text === '') continue;

        $from = strtotime((string)($r['valid_from'] ?? ''));
        $to   = strtotime((string)($r['valid_to'] ?? ''));
        if (!$from || !$to || $now < $from || $now > $to) continue;

        $hay = strtolower($title . ' ' . (string)($r['heading_en'] ?? ''));
        foreach (WARN_DROP as $bad) if (str_contains($hay, $bad)) continue 2;

        $sea = false;
        foreach (WARN_SEA as $s) if (str_contains($hay, $s)) { $sea = true; break; }

        // One place test, two word lists. Both English and Malay text are searched, because MET
        // words some rows in one language only.
        $where = strtolower($text . ' ' . (string)($r['text_bm'] ?? ''));
        $near = false;
        foreach ($sea ? WARN_SEA_KEEP : WARN_HERE as $k) {
            if (str_contains($where, $k)) { $near = true; break; }
        }
        if (!$near) continue;

        $key = $title . '|' . $text;
        if (isset($seen[$key])) continue;
        $seen[$key] = true;

        $out[] = ['title' => $title, 'text' => $text,
                  'from' => (string)$r['valid_from'], 'to' => (string)$r['valid_to']];
    }
    usort($out, fn($a, $b) => strcmp($b['from'], $a['from']));
    return $out;
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `php -l sources.php && php api.php --selftest`
Expected: every new line reading `ok`, and the run exiting 0.

- [ ] **Step 6: Fetch it and publish it**

In `api.php`, give the warning URL its own clock in the `$ttlFor` closure:

```php
$ttlFor = fn(string $k) => match ($k) {
    'met-day'  => MET_DAY_TTL,
    'met-warn' => MET_WARN_TTL,
    default    => SCRAPE_TTL,
};
```

Beside where `$metPts` and `$metDay` are parsed:

```php
$metWarn = metWarnings($page('met-warn'), $now);
```

In the payload, one new top-level key beside `sources`:

```php
    'warnings' => $metWarn,
```

and one more counter inside `sources`:

```php
        'metwarn'  => ['parsed' => count($metWarn)],
```

- [ ] **Step 7: The modal**

In `index.html`, beside the other dialogs, add:

```html
<dialog id="warnBox" aria-labelledby="warnBoxTitle">
  <div class="modalhead">
    <i class="i i-rainy_heavy" style="color:var(--k-weather)"></i>
    <h2 id="warnBoxTitle">Forecast Warning</h2>
    <button class="iconbtn" id="warnClose" aria-label="Close"><i class="i i-close"></i></button>
  </div>
  <div id="warnBody"></div>
</dialog>
```

Match the markup of the dialogs already in that file. Read one of them first and copy its shape,
including how its close button is wired.

**A `<dialog>`'s `display` goes on `[open]`, never on the element.** The browser hides a closed
dialog with `dialog:not([open]) { display: none }` in its own stylesheet, and any author rule that
sets `display` on the bare selector beats it — which lays the closed dialog out on the page, in the
tab order and read by screen readers, invisible only because the map paints over it. Write
`#warnBox[open] { display: flex }`, never `#warnBox { display: flex }`.

- [ ] **Step 8: The alert panel section**

In `js/alerts.js`, above `alerts()`:

```js
/* MET warnings, above every station in the panel.
   A warning is regional and a station reading is a measurement at one place. So this section is
   counted nowhere: the badge, the document title, the tally glyphs and the warning glyph all still
   read the station count alone. Merging them tells a reader that stations are in trouble when none
   is.
   The row clips its text with CSS rather than cutting the string, so the whole sentence stays in
   the DOM for a screen reader and for anyone who copies it. The modal is where it is read. */
function warnCard(list) {
  if (!list || !list.length) return '';
  return `<div class="alertgrp warngrp">
      <div class="alerthead">
        <i class="i i-rainy_heavy" style="--c:var(--k-weather)"></i>
        <b>Forecast Warning</b>
      </div>
      ${list.map((w, i) => `<button class="warnrow" data-warn="${i}">
        <b>${w.title}</b>
        <span class="warntext">${w.text}</span>
      </button>`).join('')}
    </div>`;
}
```

In `alerts()`, emit `warnCard(...)` as the **first element after the panel's `.pophead`**. The head
must stay first, because `openSide()` lifts it into `#sideHead` and that seam must not move.

**Find where the poll stores the raw payload before you write that line.** `state.data` is the
station array, not the payload. Read `js/state.js` and `js/net.js` and use whatever field holds the
whole response. If no such field exists, add one in `js/net.js` where the payload is unpacked, and
say so in your report.

- [ ] **Step 9: The ticker**

In `js/ticker.js`, build warning tiles carrying the **full** text and put them first:

```js
  const warns = warnList().map((w, i) => `<button class="tk-i tk-warn" data-warn="${i}" tabindex="-1">
      <i class="i i-rainy_heavy" style="--c:var(--k-weather)"></i>
      <b>${w.title}</b><span class="tk-why t-soon">${w.text}</span>
      <span class="tk-dot">•</span>
    </button>`);
```

Then `const items = warns.concat(hot.map(...))`.

The strip currently runs only when stations are hot. It must also run when there are no hot stations
and at least one warning. Find the guard that adds the `quiet` class and include the warning count.

A warning tile carries `data-warn` and no `data-go`, because a warning is not a station and there is
nowhere to jump. Confirm the delegated `[data-go]` handler in `js/ui.js` tolerates a `.tk-i` without
one.

- [ ] **Step 10: One delegated click for both surfaces**

In `js/ui.js`, add one delegated handler for `[data-warn]`. It serves the panel row and the ticker
tile alike, because both carry the same attribute:

```js
  const w = e.target.closest('[data-warn]');
  if (w) {
    const list = warnList();
    const it = list[+w.dataset.warn];
    if (it) {
      el('warnBody').innerHTML = `<h3>${it.title}</h3><p>${it.text}</p>
        <p class="muted">Valid ${it.from} to ${it.to}</p>`;
      el('warnBox').showModal();
    }
    return;
  }
```

Place it beside the other delegated handlers in that file and follow their shape. Wire `#warnClose`
to close the dialog the same way the other dialogs in this project do.

- [ ] **Step 11: The styles**

Add `.warngrp`, `.warnrow`, `.warntext`, `.tk-warn` and `#warnBox[open]` to `css/chrome.css`,
matching the shape of the existing `.alertgrp` and `.tk-i` rules.

`.warntext` gets the one-line clip:

```css
.warnrow .warntext { display: block; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; }
```

The ticker tile gets **no** clip — it carries the full sentence by design.

Use `var(--k-weather)` for every glyph here. **Do not use a status colour.** The traffic-light ramp
in this project means a reading stands at a published threshold. A regional notice is not that.

Bump `css/chrome.css`'s `?v=` in `index.html`.

- [ ] **Step 12: Verify**

```bash
php -l api.php && php -l sources.php
php api.php --selftest
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
  echo count($p["warnings"]), " live warnings\n"; print_r($p["warnings"]);'
```

On the day this was written the live feed held three marine warnings and no rain warning, and the
filter kept exactly one — the row naming the Northern Straits of Melaka. Expect a small number, and
expect zero on a calm day. **Zero is a correct result, not a broken feature.** Read the text of
whatever survives and confirm it names either the Straits of Melaka or the weather over land.

If nothing is live, hand-edit a row into `.cache.json` with a `valid_to` in the future to see all
three surfaces.

Confirm on screen, with a warning present:
- The section sits at the top of the alert panel, above the station groups.
- The panel row clips to one line and the ticker tile shows the whole sentence.
- Clicking either one opens the modal with the full text and the validity window.
- The station counts, the icon badge and the tab title are **unchanged** by the warning.

- [ ] **Step 13: Commit**

```bash
git add sources.php api.php index.html js/alerts.js js/ticker.js js/ui.js css/chrome.css
git commit -m "MET warnings lead the alert panel and the ticker, and count toward neither"
```

---

### Task 7C: Rebuild the weather cells

Task 7 shipped the section and it reads badly on screen. The three cells carry different amounts of
furniture, so nothing lines up. The temperature range crowds into one string. The glyphs are 15px
and lose to the text beside them. And the camera link below runs straight into the section with no
seam, so the weather and the nearest webcam read as one block.

This task rebuilds the three cells. It changes no data and no server code.

**Files:**
- Modify: `css/icons.css` — one new glyph
- Modify: `css/map.css` — the `.wx` rules, replaced
- Modify: `js/config.js` — `WEATHER` gains a night icon
- Modify: `js/popup.js` — `metSection()`, rebuilt
- Modify: `index.html` — two `?v=` bumps

**Interfaces:**
- Consumes: the `met` object from Task 5. Unchanged.
- Produces: no new export. `metSection(s)` keeps its signature and stays pure.

#### The shape

Every cell carries the same three parts, in the same order, so the rows line up across all three:
a subtitle, then a glyph line, then a value line.

```
 ☀  Weather                        Subang Jaya · 3.4 km
 ┌───────────────┬───────────────┬────────────────────────┐
 │ Today         │ Current       │ Later                  │  <- .wxsub, muted, 11px
 │  ↑ 34°        │      ☀        │      ☀                 │  <- glyph line, 26px weather glyph
 │  ↓ 24°        │    Clear      │    Clear, in 1 hour    │  <- value line
 │               │               │  Rain 18:40 until 19:10│  <- .wxline, only when rain is coming
 └───────────────┴───────────────┴────────────────────────┘
 ──────────────────────────────────────────────────────────  <- a real seam
   [camera] Bt.3, Shah Alam
            Nearest webcam · 0.6 km away
```

**Subtitles are `Today`, `Current` and `Later`**, one per cell, in `.muted` at 11px. They replace
the inline `In 1 hour:` prefix, which put a label inside a value and made the third cell wider than
the other two for no reason.

**The temperature splits into two lines**, each with its own arrow glyph. `arrow_upward` with the
maximum, `arrow_downward` with the minimum. Both already exist in `css/icons.css`. The en-dash range
`24–34°` is gone: two numbers with no labels made the reader work out which was which.

**The weather glyphs go to 26px.** The arrows stay small, at 14px, because they label a number
rather than carry a state. Add `.wxbig` for the weather glyph and leave `.wxcol .i` for the arrows.

#### Night

A clear sky at 22:00 must not draw a sun.

Add `clear_night` to `css/icons.css`, then pick between it and `sunny` at render time. This is the
only rung that changes: rain looks the same at every hour.

The hour is **Malaysian**, not the viewer's. Everything on this page is MYT because JPS stamps its
readings that way, and a reader in another timezone must not see a moon beside a reading stamped
14:00. `js/popup.js` already holds `MYT_CLOCK` for exactly this reason. Follow it.

Night runs from 19:00 to 06:59. Peninsular Malaysia sits near the equator, so sunrise and sunset
move by under half an hour across the year. A fixed pair of hours is honest here and needs no
almanac.

#### The seam

`metSection()` returns a `.sensor` block, and `camLink()` draws its card directly below with nothing
between them. Give the section its own class and a bottom rule.

- [ ] **Step 1: Add the night glyph**

In `css/icons.css`, beside the other weather tokens near line 68:

```css
  --i-clear_night: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 -960 960 960'><path d='M484-80q-84 0-157.5-32t-128-86.5Q144-253 112-326.5T80-484q0-146 93-257.5T410-880q-18 99 11 193.5T521-521q71 71 165.5 100T880-410q-26 144-138 237T484-80Z'/></svg>");
```

and beside the other mask classes near line 127:

```css
.i-clear_night { --i: var(--i-clear_night); }
```

- [ ] **Step 2: Give `WEATHER` a night icon**

In `js/config.js`, extend the rung-0 entry only. The other two rungs need no night form, because
rain looks the same at every hour:

```js
export const WEATHER = [
  { icon: 'sunny', night: 'clear_night', word: 'Clear', line: '' },
  { icon: 'rainy',       word: 'Rain',  line: 'Rain' },
  { icon: 'rainy_heavy', word: 'Heavy', line: 'Heavy rain' },
];
```

- [ ] **Step 3: Rebuild `metSection()`**

Replace the body of `metSection()` in `js/popup.js`. Keep the function name, the signature and the
early return.

```js
/* The hour in Malaysia, not the reader's. Every time on this page is MYT, because JPS stamps its
   readings that way, and a moon beside a reading stamped 14:00 is a contradiction. Night runs 19:00
   to 06:59 — near the equator the sun moves by under half an hour across the year, so a fixed pair
   of hours needs no almanac. */
const MYT_H = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', hour12: false,
});
const night = () => { const h = +MYT_H.format(new Date()); return h >= 19 || h < 7; };

/* One glyph name for a rung. Only a clear sky has a night form. */
const wxIcon = r => {
  const w = WEATHER[r] || WEATHER[0];
  return (night() && w.night) || w.icon;
};

/* The MET section. Three cells, each carrying a subtitle, a glyph line and a value line, so the
   three line up across the row.
   This is drawn once per card and never once per sensor. Rain over a place is one fact, and
   sourceInfo() already taught this app what a per-place fact costs when it repeats down a mast.
   The header carries the point and the distance, which is what lets a reader weigh a 14 km claim.
   This section is not a sensor at this place. */
function metSection(s) {
  const m = s.met;
  if (!m) return '';

  const w = r => WEATHER[r] || WEATHER[0];

  /* Four shapes, and every one names both ends. `until` says the rain ends. `past` says the MET
     outlook ended, and never that the rain did. */
  const rain = m.rung == null ? '' :
    `${w(m.rung).line}${m.from ? ` ${m.from}${m.open ? ',' : ''}` : ''} `
    + `${m.open ? 'past' : 'until'} ${m.to}`;

  const cell = (sub, glyph, value, extra = '') => `<div class="wxcol">
      <span class="wxsub">${sub}</span>
      ${glyph}
      <span class="wxval">${value}</span>
      ${extra}
    </div>`;

  /* Two lines with their own arrows. One range in one string made a reader work out which number
     was the maximum. */
  const temp = m.tmax == null ? '' : cell('Today',
    `<span class="wxtemp"><i class="i i-arrow_upward"></i>${m.tmax}°</span>`,
    `<span class="wxtemp"><i class="i i-arrow_downward"></i>${m.tmin}°</span>`);

  const now = m.now == null ? '' : cell('Current',
    `<i class="i wxbig i-${wxIcon(m.now)}"></i>`, w(m.now).word);

  const out = m.hr1 == null ? '' : cell('Later',
    `<i class="i wxbig i-${wxIcon(m.hr1)}"></i>`, w(m.hr1).word,
    rain ? `<span class="wxline">${rain}</span>` : '');

  return `<div class="sensor wxsec" data-sensor="@met">
      <div class="sensorhead">
        <i class="glyph i i-${wxIcon(m.rung ?? m.now ?? 0)}" style="color:var(--k-weather)"></i>
        <b>Weather</b>
        ${m.at ? `<span class="muted">${m.at} · ${m.km} km</span>` : ''}
      </div>
      <div class="wx">${temp}${now}${out}</div>
    </div>`;
}
```

Note `wxIcon(m.rung ?? m.now ?? 0)` on the header: a rainy header stays rainy, and a clear header
turns into a moon after dark.

- [ ] **Step 4: Replace the grid rules**

In `css/map.css`, replace the whole `.wx` block Task 6 added with this:

```css
/* The MET section. Three cells, each with a subtitle, a glyph line and a value line, so the rows
   line up across all three. `min-width: 0` sits on every cell. A grid item defaults to
   `min-width: auto`, which refuses to shrink below its content. Without it, a long word in the wide
   cell pushes the two narrow cells out of shape. */
.wx { display: grid; grid-template-columns: 1fr 1fr 3fr; gap: 10px; align-items: start; }
.wx > * { min-width: 0; }
.wxcol { display: flex; flex-direction: column; align-items: center; gap: 3px;
  font-size: 12px; line-height: 1.35; text-align: center; }
.wxsub { font-size: 11px; color: var(--muted); }
.wxval { font-weight: 500; }
/* The weather glyph carries the state, so it is the largest thing in the cell. The arrows only
   label a number and stay small. */
.wxbig { font-size: 26px; color: var(--k-weather); }
.wxcol .i { font-size: 14px; color: var(--k-weather); }
.wxtemp { display: inline-flex; align-items: center; gap: 3px; }
.wxline { color: var(--on-surface); font-size: 11px; }
/* A real seam. Without it the camera card below runs straight into this section and the two read
   as one block. */
.wxsec { padding-bottom: 12px; border-bottom: 1px solid var(--outline); }
```

Delete the old `.wxnow` and `.wxout` rules. Nothing emits those classes any more. Confirm with
`grep -rn "wxnow\|wxout" js/ css/` before you commit, and again after.

- [ ] **Step 5: Bump the versions**

In `index.html`, `css/icons.css` and `css/map.css` each move up by one. Read the current values
first and add one to each — do not assume. Leave `css/base.css` and `css/chrome.css` alone.

- [ ] **Step 6: Verify**

```bash
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
grep -rn "wxnow\|wxout" js/ css/ || echo "old classes gone"
for f in css/icons.css css/map.css; do
  curl -sk -o /dev/null -w "%{content_type} $f\n" "https://flood-exp.test/$f"; done
```

Then look at it. A browser is the only thing that can judge this task, because the whole task is
about how it reads. Confirm:

- The three subtitles sit on one line across the row.
- The two temperature lines each carry an arrow and line up under `Today`.
- The weather glyphs are clearly larger than the arrows.
- A rule separates the section from the camera card below it.
- The rain line, where present, sits under the `Later` value and is not clipped.

Check the night path by forcing it: temporarily make `night()` return `true`, reload, confirm the
moon draws in both the header and the clear cells, then put it back.

Check it under 600px as well. `--side` becomes 84vw there.

- [ ] **Step 7: Commit**

```bash
git add css/icons.css css/map.css js/config.js js/popup.js index.html
git commit -m "The weather cells line up, name themselves, and know it is night"
```

---

### Task 7D: Even cells, and no attribution line

Two changes the user asked for after seeing Task 7C on screen.

**Files:** `css/map.css`, `js/popup.js`, `index.html` (one `?v=` bump).

**1. The grid becomes even thirds.** `1fr 1fr 3fr` was set when the rain sentence ran inline. It now
wraps under the value, so the third cell floats in dead space on a clear day. Change the one rule:

```css
.wx { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; align-items: start; }
```

The rain sentence stays inside its own cell and wraps there. That is accepted.

**2. The header drops the point name and the distance.** Remove this from `metSection()`:

```js
        ${m.at ? `<span class="muted">${m.at} · ${m.km} km</span>` : ''}
```

The header then reads a glyph and the word `Weather`, and nothing else.

**The cost, recorded so it stays a decision and not an accident.** The section states the weather at
a station using the nearest MET point, which may be up to `MET_KM` away — 15 km. ULU YAM takes its
reading from a point 11.7 km off, over high ground. With the attribution gone, the card makes a
local claim and shows nothing a reader could weigh it against. The user chose this after the cost
was stated.

`at` and `km` stay in the payload. Nothing reads them now. Putting the line back is one template
line, which is why they are worth keeping.

**Do not** touch `js/alerts.js`, `js/ticker.js`, `js/toast.js`, or any server file. `metSection()`
stays pure.

**Prose gate:** hold `css/map.css`, `js/popup.js` and `index.html` at their current five numbers
(`passive_voice`, `banned_modal`, `contraction`, `long_sentence`, `nominalization`). Measure before
and after. Ignore `semicolon` and `long_paragraph`.

- [ ] **Step 1:** Change the one grid rule in `css/map.css`.
- [ ] **Step 2:** Delete the attribution span from `metSection()` in `js/popup.js`.
- [ ] **Step 3:** Bump `css/map.css`'s `?v=` in `index.html` by one. Read the current value first.
- [ ] **Step 4:** Syntax-check every module, then drive a browser and look at it. Confirm the three
  cells are even, the rain sentence wraps inside its cell without clipping, and the header carries
  no place name. Check a clear station and a rainy one, and check under 600px.
- [ ] **Step 5:** Commit.

```bash
git add css/map.css js/popup.js index.html
git commit -m "Three even cells, and a header that no longer names the point"
```

---

### Task 7E: The Later cell follows the rung

**Files:** `js/popup.js` only.

The third cell drew the rung one hour out, `hr1`, while the sentence under it described the worst
rain in the whole three-hour window. On BUKIT FRASER that put `Clear` directly above
`Rain 12:00, past 13:00`. Both statements were true — the sky is clear at the one-hour mark and the
rain arrives at noon — but a cell that argues with the line beneath it is the defect, not the data.

**The third cell now follows `rung`.** It then describes the same thing its own sentence does, so
the two cannot disagree. A station with no rain coming carries no `rung`, and the cell falls back to
clear, which is correct.

In `metSection()`, the `out` cell changes from `m.hr1` to `m.rung ?? 0` for both the glyph and the
word. The guard stays on `m.hr1`, because that field is what tells us a MET point is in reach at
all. Only what the cell displays changes.

```js
  const later = m.rung ?? 0;
  const out = m.hr1 == null ? '' : cell('Later',
    `<i class="i wxbig i-${wxIcon(later)}"></i>`, w(later).word,
    rain ? `<span class="wxline">${rain}</span>` : '');
```

Update the comment above `metSection()` to say the third cell reads the worst rung in the window,
and why. A comment describing `hr1` after the code reads `rung` is worse than no comment.

`hr1` stays in the payload. Nothing displays it now. It is the one field that answers "is it raining
in an hour" rather than "does it rain at all in three", and republishing it costs nothing.

**Do not** touch any other file, any server code, `js/alerts.js`, `js/ticker.js` or `js/toast.js`.
`metSection()` stays pure.

**Prose gate:** hold `js/popup.js` at passive 42, modal 19, contraction 43, long_sentence 11,
nominalization 2. Ignore `semicolon` and `long_paragraph`.

- [ ] **Step 1:** Make the change in `js/popup.js`.
- [ ] **Step 2:** Update the comment to match.
- [ ] **Step 3:** Syntax-check every module.
- [ ] **Step 4:** Drive a browser. Confirm on BUKIT FRASER that `Later` now reads `Rain` above
  `Rain 12:00, past 13:00`, and on a clear station that `Later` reads `Clear` with no sentence.
- [ ] **Step 5:** Commit.

```bash
git add js/popup.js
git commit -m "The Later cell reads the rung it is describing, so it stops arguing with its own line"
```

---

### Task 8: The About pane

**Files:**
- Modify: `index.html:335-345` (the `Where this data comes from` list) and the Credits block at line 345

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks read.

- [ ] **Step 1: Add the source block**

In `index.html`, after the `JPS Wilayah Persekutuan (SPHTN)` block that ends around line 344, insert a fourth `div.src` in the same shape as the three above it:

```html
  <div class="src">
    <a href="https://www.met.gov.my/nowcasting/" target="_blank" rel="noopener">MET Malaysia</a>
    <span class="muted">Weather, not water. Whether rain is falling near a station now, and whether
      more arrives in the next three hours. The temperature range for the day comes from the same
      department, through data.gov.my.</span>
  </div>
```

- [ ] **Step 2: Say what the weather does not do**

After the paragraph that begins `Each station popup names the feed its reading came from`, add:

```html
  <p class="muted">Weather sits beside the water and never changes it. The rain forecast joins no
     reading, overrides no station and raises no alert. The temperature is a forecast for the day,
     not a thermometer, which is why the card says today.</p>
```

- [ ] **Step 3: Credit MET**

In the Credits block, change the sentence ending `Flood data remains the property of JPS Malaysia.` to read:

```html
     Flood data remains the property of JPS Malaysia, and weather data of
     <a href="https://www.met.gov.my/" target="_blank" rel="noopener">MET Malaysia</a>.
```

`Material Symbols` is already credited in that same paragraph, so the three new glyphs need no change there.

- [ ] **Step 4: Run the full third-party sweep**

The pane claims the page loads nothing from a third party. A grep for known offenders is what let `basemaps.cartocdn.com` ship under a false claim, so list every absolute URL and classify each one:

```bash
grep -rhoE 'https?://[a-zA-Z0-9._-]+' index.html js/ css/ sw.js manifest.json \
  | sort -u
```

For each host, decide whether the browser fetches it or the page merely links to it. Expect exactly two fetched hosts — this origin, and `basemaps.cartocdn.com` for the tiles. `www.met.gov.my` and `api.data.gov.my` must appear as links only, inside `index.html`. If either shows up in a `js/` file, the design has been broken and the claim in the pane is now false.

- [ ] **Step 5: Check the pane**

Open `https://flood-exp.test`, open About, and read the whole pane top to bottom. Confirm the four sources read as four, that no sentence uses `proxy`, `nowcast`, `decorrelation` or `Thiessen`, and that every rendered string starts with a capital.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "The About pane names the fourth feed and says what the weather does not touch"
```

---

### Task 9: Documentation

**Files:**
- Modify: `CLAUDE.md` (files table, data sources table, gotcha list, Verify block)
- Modify: `docs/FEATURES.md` (append)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Add the data source rows**

In `CLAUDE.md`, add to the `## Data sources` table:

```markdown
| `met.gov.my/nowcasting` | rain now and every 30 min to +3 h, 294 points | HTML with baked-in JS |
| `api.data.gov.my/weather/forecast` | daily min and max temperature, by district | JSON |
```

Add a sentence under that table stating these two carry weather and join no water reading.

- [ ] **Step 2: Add the gotchas**

Append two entries to the gotcha list in `CLAUDE.md`:

```markdown
- **The MET nowcast page has no endpoint to find.** It renders its Leaflet map on the server and
  bakes all 294 points into `L.marker(...)` statements. There is no XHR to intercept, so `metPoints()`
  parses the JavaScript source with a regex. A marker whose wording this parser does not know is
  **dropped whole**, never read as clear weather — `metRung()` returns -1 and the marker vanishes, so
  `sources.met.parsed` falls and somebody looks. Reading an unknown word as "no rain" would hide a
  layout change behind calm weather, which is the one way a scraper must not fail.
- **A cutoff scaled to Voronoi cell size scales the wrong way, and `MET_KM` is flat for that reason.**
  Sabak Bernam sits in a 28.5 km cell, so a cell-scaled rule accepts a station 22.8 km from its
  point — the weakest claim on the map, admitted because MET built nothing nearby. Central Kuala
  Lumpur holds points 0.1 km apart, which are two MET offices and a convention centre, so the same
  rule silences stations 3 km out where the reading is most reliable. Point density records where MET
  chose to build and says nothing about weather. `MET_KM` is 15 km because a 3-hour rainfall field
  decorrelates at about 26 km. **A line that ever claims rain is falling at this moment needs about
  3 km instead** — the decorrelation distance falls with the period measured, and reusing `MET_KM`
  for an instantaneous claim would overstate it by five times.
```

- [ ] **Step 3: Add the Verify lines**

Append to the Verify block in `CLAUDE.md`:

```bash
# Are both weather feeds contributing? parsed:0 means MET moved something.
curl -sk https://flood-exp.test/api.php | php -r '$s=json_decode(stream_get_contents(STDIN),true)["sources"];
echo json_encode(["met"=>$s["met"],"metday"=>$s["metday"]]),"\n";'

# No station may hold a MET point beyond MET_KM.
php -r '$p=json_decode(file_get_contents(".cache.json"),true);
echo count(array_filter($p["stations"],fn($s)=>($s["met"]["km"]??0)>15))," beyond MET_KM\n";'
```

- [ ] **Step 4: Add the files table rows**

In the `## Files` table of `CLAUDE.md`, extend the `sources.php` row to mention the two MET parsers, and extend the `js/config.js` row to mention `WEATHER`.

- [ ] **Step 5: Write the FEATURES entry**

Append an entry to `docs/FEATURES.md`. Cover each of these, one short section per point:

- What the section shows, and where it sits on the card.
- Why the lead time is the part worth having. 232 rain gauges already measure the rain that fell.
- Why nearest point beats kriging here. MET publishes a category, and a category cannot be averaged.
- Where 15 km comes from. A 3-hour rainfall field decorrelates at about 26 km.
- Why the cell-scaled cutoff failed. It widens where the claim is weakest.
- Why the span runs first to last. 12% of wet markers hold the worst rung in more than one block.
- Why there is no alert surface and no map layer.
- That the temperature is a forecast, and that no free observed one exists.
- **What data.gov.my does and does not offer.** It publishes three weather endpoints: `forecast`,
  `warning` and `warning/earthquake`. It publishes **no nowcast**, which is why the 0-3 hour rain
  still comes from an HTML scrape of `met.gov.my/nowcasting` rather than from a clean JSON API.
  Record this so nobody re-searches for an endpoint that does not exist.
- **The `warning` endpoint, considered and declined.** `https://api.data.gov.my/weather/warning`
  returns real MET warnings with `valid_from`, `valid_to` and bilingual heading, text and
  instruction. Two reasons it is not wired up. It carries no coordinates, so nothing joins it to a
  station — one live sample covered "the waters of Phuket". And it would be a new alert surface,
  which goes through the alert design standard in this file before anything else. Raise it there
  the day somebody wants MET warnings on this map.

- [ ] **Step 6: Check the prose**

Run:
```bash
python "C:/Users/illus/.claude/ste-lint.py" < docs/FEATURES.md
python "C:/Users/illus/.claude/ste-lint.py" < CLAUDE.md
```
Aim for 0 in every category except `long_paragraph`, which counts each table row and list item as a sentence and reports a false positive on both files.

- [ ] **Step 7: Run every check one last time**

Run:
```bash
php -l api.php && php -l sources.php
php api.php --selftest
php shots-test.php
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
for f in js/*.js css/*.css; do
  curl -sk -o /dev/null -w "%{content_type} $f\n" "https://flood-exp.test/$f"; done | grep -v 'javascript\|css'
```
Expected: both selftests exit 0, no `FAIL` line, and no output from the last loop.

- [ ] **Step 8: Commit**

```bash
git add CLAUDE.md docs/FEATURES.md
git commit -m "The docs carry the two feeds, the flat radius, and why a cell-scaled one failed"
```
