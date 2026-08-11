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
- Modify: `api.php:8-45` (constants), `api.php:942-957` (the page-cache block)
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

In `api.php`, replace lines 942 to 945:

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

In `api.php`, insert **after** the `$page = fn(string $k) => $pages[$k] ?? '';` line at 958. Not before it — the next step reads through that closure, and `$page` does not exist above this line.

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
- Modify: `api.php` — add `metNearest()` near `sirenBacked()` at line 211, and a join pass before the payload is built at line 1300
- Modify: `api.php:1324-1328` (the `sources` counters)
- Test: `api.php` `--selftest` block

**Interfaces:**
- Consumes: `$metPts`, `$metDay` from Task 4. `metSpan()` from Task 2.
- Produces: a `met` key on each station in `$stations`, shaped
  `['at'=>string, 'km'=>float, 'now'=>int, 'hr1'=>int, 'rung'=>int, 'from'=>?string, 'to'=>string, 'open'=>bool, 'tmin'=>int, 'tmax'=>int]`.
  Every key except `at` and `km` is optional. The whole key is absent when there is nothing to say.
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

In `api.php`, insert after `sirenBacked()` ends at line 221:

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

In `api.php`, find where `$payload = json_encode([` begins near line 1300. Insert this block immediately before it:

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

In `api.php`, replace the `sources` block at lines 1324 to 1328:

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
- Modify: `css/base.css:61-62` and `css/base.css:128-129` (the `--k-*` blocks)
- Modify: `css/map.css` (append after the `.sensorhead` rules at line 91)
- Modify: `index.html:32-35` (three `?v=` bumps)

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

and line 129 (the dark theme) to read:

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

Append to `css/map.css`, after the `.sensorhead` rules that end at line 91:

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

In `index.html`, change lines 32, 33 and 35:

```html
<link rel="stylesheet" href="css/icons.css?v=78">
<link rel="stylesheet" href="css/base.css?v=105">
<link rel="stylesheet" href="css/map.css?v=127">
```

Leave `css/chrome.css?v=135` alone. This task does not edit it.

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
        <span class="muted">${m.at} · ${m.km} km</span>
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
