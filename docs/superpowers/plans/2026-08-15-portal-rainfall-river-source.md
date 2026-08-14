# The national portal as rainfall and river source — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `publicinfobanjir.water.gov.my` the preferred source for rainfall and river readings,
place the stations it publishes from its own station search, and make every rainfall window exact
from the first poll.

**Architecture:** Two more scraped pages ride in the page cache that already holds three. A new
parser reads the rainfall table, a matcher joins its rows to stations this app already holds, and a
running total built from the table's own midnight column replaces the odometer that Kuala Lumpur
never published. Two backfills run at the end of a refresh, a few stations at a time, and never on a
reader's poll.

**Tech Stack:** PHP 8, `symfony/dom-crawler` through `lib/autoload.php`, sqlite through PDO,
`curl_multi` through `fetchAll()`. No new dependency. No build step. Assertions live in
`php api.php --selftest`.

**Spec:** [`docs/superpowers/specs/2026-08-14-portal-rainfall-river-source-design.md`](../specs/2026-08-14-portal-rainfall-river-source-design.md)

## Global Constraints

Every task's requirements include this section.

- **Never `rm .history.db`.** It holds the accumulated samples. To re-test the scrape path run
  `UPDATE page SET ts=0` instead. Copy the file first if deletion is unavoidable.
- **Never `rm -rf shots/`.** It is a year of camera history and it cannot rebuild.
- **Never `file_get_contents()` an upstream URL.** Always `fetchAll()`. One JPS A record blackholes
  SYNs and PHP's stream wrapper eats a 21 second OS timeout on it.
- **`session_write_close()` stays the first statement in `api.php`**, above the two `require_once`
  lines. Nothing goes above it.
- **Anything added to the refresh path stays inside the `flock` on `.refresh.lock`.**
- **No new fan-out on a reader's poll.** A backfill runs at the end of a refresh, rate limited by a
  stamp file through `forceAllowed()`, exactly as `captureShots()` does.
- **Every outbound call goes through `fetchAll()`**, which carries
  `CURLOPT_USERAGENT: flood-exp/1.0 (+https://github.com/illusionikx/selangor-flood-tracker)`.
- **Score a status server-side, never in the client.** Use `rainStatus()` and `wlStatus()` in
  `sources.php`.
- **No hex colour in a PHP or JS file.** The palette lives in `css/base.css`.
- **Prose follows Simplified Technical English.** Active voice, one instruction per sentence, 20
  words maximum, no semicolons, no contractions, American spelling. Check any document with
  `python "C:/Users/illus/.claude/ste-lint.py" < FILE`. Possessive `'s` counts as a false
  `contraction`, and a list of more than six items raises a false `long_paragraph`.
- **Commit messages are a plain sentence subject and a prose body.** No `feat:` prefix. End every
  commit message with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Update `docs/FEATURES.md` as part of the change that earns it**, never as a follow-up.
- **`-9999` means no reading.** Use `numOrNull()`, which nulls anything at or below −9990.
- **A scraper fails silently by design.** Every new source publishes a parse counter under
  `sources`, and every new page key must be able to appear in `sources.stale`.

## File Structure

| file | what changes |
|---|---|
| `sources.php` | Add the portal rainfall parser, the portal river URL set, the gazetteer parser and the 5 minute series parser. This file already owns every scraper, so nothing moves out of it. |
| `api.php` | Add the page keys, the matcher, the running total, the two backfill drips and their tables. The merge and the accumulation block already live here. |
| `js/popup.js` | One string changes. The Kuala Lumpur dash message stops being the usual case. |
| `CLAUDE.md` | The rainfall gotcha, the source table and the Verify block. |
| `docs/FEATURES.md` | One entry, appended by the last task. |

`sources.php` grows by about 150 lines and stays one file. It has one responsibility. It turns an upstream document into an
array, and every parser in this app already lives there.

`api.php` is 2,607 lines and already large. This plan adds about 200 lines to it. Do not restructure
it. The functions this plan adds are pure and sit beside the pure functions the file already groups
above the `--selftest` block, which is where `--selftest` can reach them.

## Sequencing

Tasks 1 to 6 change where a reading comes from. Tasks 7 to 9 add stations and history. Task 10 is the
gate. Each task ends green and shippable.

Tasks 7 and 8 both contact the portal for data no reader waits for. Land them last on purpose.
If the plan stops early, the map still holds every station it holds today with better numbers on it.

---

### Task 1: Read the portal rainfall table

**Files:**
- Modify: `sources.php` — add `portalRainUrls()`, `portalRows()` and `portalRain()` after
  `klLatLng()` at line 174
- Modify: `api.php:1067` — add a `portalRain()` block to `--selftest`
- Test: `php api.php --selftest`

**Interfaces:**
- Consumes: `crawl()`, `numOrNull()`, `myTime()` from `sources.php`
- Produces:
  - `portalRainUrls(array $states = ['SEL', 'WLH', 'PTJ']): array` — page key to URL, keys
    `prf-SEL`, `prf-WLH`, `prf-PTJ`
  - `portalRows(string $html): array` — a list of `[array $cells, Crawler $tds]`, only rows of
    exactly 13 cells
  - `portalRain(array $pages): array` — a list of station arrays with keys `code`, `name`,
    `district`, `updated`, `hourly`, `daily`, `days`, `graphId`

**Why this parser cannot use `filter('tr')`:** no data row on this page carries an opening `<tr>`.
The `<tbody>` holds one empty `<tr></tr>`, then about 31 stray closing tags, then every row as a bare
run of `<td>` cells ending in `</tr>`. Measured on the live page, `crawl($html)->filter('tr')` finds
4 elements and none holds a `td` child.

- [ ] **Step 1: Write the failing test**

Add this block to `api.php`, immediately before the `echo "\naccWindow():\n";` line in the
`--selftest` section. The fixture is one real row copied from the live page, with the same broken
shape.

```php
    echo "\nportalRain():\n";
    /* The live page's own shape: an empty row, stray closing tags, then bare cell runs. A fixture
       that supplies the missing <tr> would test a page this upstream does not serve. */
    $prfFixture = "<table><tbody><tr></tr></tr></tr>"
        . "<td data-th='No'>1</td><td data-th='Station ID'>0232331RF</td>"
        . "<td>S.M.K Bandar Kinrara (F2)</td><td>Petaling</td><td>15/08/2026 00:00:00</td>"
        . "<td>0.0</td><td>0.0</td><td>2.5</td><td>0.0</td><td>0.0</td><td>7.5</td>"
        . "<td><a href='/index.php/rf-graph/?stationid=27398'>7.5</a></td>"
        . "<td class='info'>0.0</a></td></tr>"
        // A row with no code, no graph link and a -9999 hour. All three happen upstream.
        . "<td data-th='No'>2</td><td data-th='Station ID'></td>"
        . "<td>Jave Setia (F2)</td><td>Petaling</td><td>15/08/2026 00:00:00</td>"
        . "<td>0.0</td><td>0.0</td><td>0.0</td><td>0.0</td><td>0.0</td><td>5.0</td>"
        . "<td>5.0</td><td class='info'>-9,999.00</td></tr>"
        // Twelve cells. A row this shape is a layout change, and it must be dropped.
        . "<td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td>"
        . "<td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td></tr>"
        . "</tbody></table>";

    $prf = portalRain(['prf-SEL' => $prfFixture]);
    $ok('two rows survive the width guard',  count($prf) === 2);
    $ok('the code comes off data-th',        $prf[0]['code'] === '0232331RF');
    $ok('the name is cell 2',                $prf[0]['name'] === 'S.M.K Bandar Kinrara (F2)');
    $ok('the district is cell 3',            $prf[0]['district'] === 'Petaling');
    $ok('the stamp is normalised',           $prf[0]['updated'] === '15/08/2026 00:00:00');
    /* The mapping the header block gets wrong. Cell 11 is today and cell 12 is the hour. Read in
       header order they land one column left, which puts today's total under last Tuesday's date. */
    $ok('cell 11 is the day, not a daily column', $prf[0]['daily'] === 7.5);
    $ok('cell 12 is the hour',               $prf[0]['hourly'] === 0.0);
    $ok('the six daily columns are kept',    $prf[0]['days'] === [0.0, 0.0, 2.5, 0.0, 0.0, 7.5]);
    $ok('yesterday is the last of the six',  end($prf[0]['days']) === 7.5);
    $ok('the graph id comes off the link',   $prf[0]['graphId'] === 27398);
    $ok('a missing code is null',            $prf[1]['code'] === null);
    $ok('a missing graph link is null',      $prf[1]['graphId'] === null);
    $ok('-9999 is no reading',               $prf[1]['hourly'] === null);
    $ok('an empty page yields nothing',      portalRain(['prf-SEL' => '']) === []);
    /* The form the endpoint serves without its two hidden inputs. It holds a table and no row, so
       pageHasData() lets it through and the parser has to answer for it. */
    $ok('a form page yields nothing',        portalRain(['prf-SEL' => '<table><tbody></tbody></table>']) === []);

    echo "\nportalRainUrls():\n";
    $ok('three states, three keys',          array_keys(portalRainUrls()) === ['prf-SEL', 'prf-WLH', 'prf-PTJ']);
    $ok('the hidden inputs ride in the url', str_contains(portalRainUrls()['prf-SEL'], 'loginStatus=0&language=1'));
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `php api.php --selftest`
Expected: a PHP fatal error, `Call to undefined function portalRain()`.

- [ ] **Step 3: Write the implementation**

Add to `sources.php`, after `klLatLng()` ends at line 174.

```php
/* The national portal's rainfall table. Three requests, one per state, and the two hidden inputs
   the search form carries. Without `loginStatus` and `language` the endpoint returns the form
   itself, which is why CLAUDE.md recorded this endpoint as returning no rows. */
const PRF = 'https://publicinfobanjir.water.gov.my/wp-content/themes/shapely/agency/searchresultrainfall.php';

function portalRainUrls(array $states = ['SEL', 'WLH', 'PTJ']): array {
    $u = [];
    foreach ($states as $s) {
        $u['prf-' . $s] = PRF . '?state=' . $s . '&district=ALL&station=ALL&loginStatus=0&language=1';
    }
    return $u;
}

/* Rows of exactly 13 cells, as [cell text, the cells themselves].
 *
 * NO DATA ROW ON THIS PAGE CARRIES AN OPENING <tr>. The tbody holds one empty row, then about 31
 * stray closing tags, then every row as a bare run of <td> cells ending in </tr>. Both parsers drop
 * a cell that sits outside a row, so crawl()->filter('tr') finds 4 elements here and none of them
 * holds a td child. The existing wrap cannot help: it supplies a missing table, and this page is
 * missing its rows instead.
 *
 * So the body is split on the closing tag and each chunk is wrapped as a row of its own. That is a
 * repair, and a repair needs a check that the shape it produced is the shape expected — which is
 * what the 13-cell guard is. Measured on the live Selangor page: 239 chunks, all 13 cells.
 *
 * 13 and not 14. The header block names 14 columns at colspan 1 and every data row holds 13 cells,
 * so a parser that trusts the headers reads every value one column to the left in silence. */
function portalRows(string $html): array {
    global $text;
    $out = [];
    foreach (explode('</tr>', $html) as $chunk) {
        if (!str_contains($chunk, '<td')) continue;
        $tds = crawl('<tr>' . $chunk . '</tr>')->filter('tr')->children('td');
        if (count($tds) !== 13) continue;
        $out[] = [$tds->each($text), $tds];
    }
    return $out;
}

/* Portal rainfall stations, one entry per row.
 *
 * 0 no. · 1 code · 2 name · 3 district · 4 updated · 5-10 six daily totals OLDEST first
 * 11 rainfall from midnight (today) · 12 total 1 hour (now)
 *
 * Only cells 0 and 1 carry `data-th`, so the rest are read by position under the width guard, the
 * same rule the SPHTN parser obeys. The mapping is measured, not read off the headers: against JPS
 * on the 150 stations that join, cell 12 matches the hourly reading on 96% and cell 11 matches the
 * daily on 95%. Read in header order those fall to 49% and 23%.
 *
 * `days` keeps all six because the last of them is yesterday's whole total, which is what bridges a
 * midnight in the running total. See portalOdo() in api.php.
 *
 * `graphId` rides in cell 11's link and is the key the 7 day series takes. A row without the link
 * keeps a null id and simply takes no history backfill. */
function portalRain(array $pages): array {
    $out = [];
    foreach ($pages as $html) {
        if (!$html) continue;
        foreach (portalRows($html) as [$c, $tds]) {
            $days = [];
            for ($i = 5; $i <= 10; $i++) $days[] = numOrNull($c[$i]);
            $href = $tds->eq(11)->filter('a')->count() ? ($tds->eq(11)->filter('a')->attr('href') ?? '') : '';
            $out[] = [
                'code'     => ($c[1] ?? '') === '' ? null : $c[1],
                'name'     => $c[2],
                'district' => $c[3],
                'updated'  => myTime($c[4] ?? ''),
                'days'     => $days,
                'daily'    => numOrNull($c[11]),
                'hourly'   => numOrNull($c[12]),
                'graphId'  => preg_match('/stationid=(\d+)/', $href, $m) ? (int)$m[1] : null,
            ];
        }
    }
    return $out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `php api.php --selftest`
Expected: every line in the `portalRain()` and `portalRainUrls()` blocks reads `ok`, and the script
exits 0.

- [ ] **Step 5: Check the parser against the live page**

Run:

```bash
php -r 'require "sources.php";
$u = portalRainUrls();
$p = [];
foreach ($u as $k => $url) {
    $c = curl_init($url);
    curl_setopt_array($c, [CURLOPT_RETURNTRANSFER=>1, CURLOPT_SSL_VERIFYPEER=>0,
        CURLOPT_TIMEOUT=>25, CURLOPT_FOLLOWLOCATION=>1,
        CURLOPT_USERAGENT=>"flood-exp/1.0 (+https://github.com/illusionikx/selangor-flood-tracker)"]);
    $p[$k] = curl_exec($c); curl_close($c);
}
$r = portalRain($p);
printf("%d rows, %d with a code, %d with a graph id, %d with an hour\n", count($r),
  count(array_filter($r, fn($s)=>$s["code"] !== null)),
  count(array_filter($r, fn($s)=>$s["graphId"] !== null)),
  count(array_filter($r, fn($s)=>$s["hourly"] !== null)));
// Task 3 scores its join against this file rather than fetching the pages a second time.
file_put_contents(".prf.json", json_encode($r));'
```

`.prf.json` is a scratch file for the Task 3 sweep. Add it to `.gitignore` in this task's commit,
beside the other dot files this app writes.

Expected: about 310 rows total, most carrying a code and a graph id. **Assert a range, never an
equality** — two fetches an hour apart returned 311 and then 310, and the Selangor page returned 239
on 15 August. A count near zero means the hidden inputs stopped working or the row shape moved.

- [ ] **Step 6: Commit**

```bash
echo '.prf.json' >> .gitignore
git add sources.php api.php .gitignore
git commit -F - <<'EOF'
Read the national portal's rainfall table

The endpoint returns the search form until the caller sends the two hidden
inputs the page carries. CLAUDE.md recorded it as returning headers and no
rows, which was a request one parameter short.

No data row carries an opening tr. The tbody holds one empty row, then about
31 stray closing tags, then every row as a bare run of td cells. crawl() finds
4 elements on the live page and none of them holds a td child, so the parser
this repo already has reads nothing here. Splitting the body on the closing tag
gives 239 chunks of exactly 13 cells each.

The cells do not follow the header block. 14 headers at colspan 1 against 13
cells, so reading the headers puts every value one column left. Measured
against JPS on the 150 stations that join, cell 12 matches the hourly reading
on 96% and cell 11 matches the daily on 95%. In header order those fall to 49%
and 23%.

Nothing reads these rows yet.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: Put the portal pages in the cache and publish their counters

**Files:**
- Modify: `api.php:1964` — add `portalRainUrls()` to `$extraUrls`
- Modify: `api.php:2552` — add a `portalrf` entry to `sources`
- Test: `php api.php --selftest`, then a live poll

**Interfaces:**
- Consumes: `portalRainUrls()`, `portalRain()` from Task 1
- Produces: `$prf` — the parsed portal rainfall rows, available to every later task in the refresh
  path. `sources.portalrf.parsed` in the payload.

Nothing reads a portal reading yet. This task proves the fetch, the cache, the failure path and the
counter, one change at a time.

- [ ] **Step 1: Write the failing test**

`pageHasData()` decides whether a body is the kind of document its key names. The portal rainfall
page is a table, so the `default` arm already covers it. Assert that rather than assume it. The
endpoint fails into a form page that holds a table and no row.

Add to `--selftest`, in the `pageHasData()` block if one exists, or immediately after the
`portalRainUrls()` block from Task 1.

```php
    echo "\npageHasData() on the portal pages:\n";
    $ok('a portal table with a row passes',  pageHasData('prf-SEL', "<table><td>x</td></tr>") === false);
    $ok('a real portal body passes',         pageHasData('prf-SEL', "<table><tr><td>x</td></tr></table>") === true);
    $ok('an empty body fails',               pageHasData('prf-SEL', '') === false);
```

Note the first assertion. A portal rainfall row carries no `<tr`, so `pageHasData()`'s `<tr` test
**fails on a page full of real rows**. That is the bug this step exists to find.

- [ ] **Step 2: Run the test to verify it fails**

Run: `php api.php --selftest`
Expected: the first assertion reads `FAIL`. It fails on purpose, because it states the trap:
a body carrying a real portal row holds no `<tr` at all, so the shared test refuses a page full of
data.

Now measure the other half of the trap against the live page:

```bash
curl -sk -A 'flood-exp/1.0 (+https://github.com/illusionikx/selangor-flood-tracker)' \
 'https://publicinfobanjir.water.gov.my/wp-content/themes/shapely/agency/searchresultrainfall.php?state=SEL&district=ALL&station=ALL&loginStatus=0&language=1' \
 | grep -c '<tr'
```

Expected: `4`. Four `<tr` in a page of 239 rows, every one of them in the header. So the default arm
passes here, and it passes on the header rather than on the data. **The empty form page carries that
same header**, so the default test cannot tell a full page from an empty one. Both halves have to
move together, which is what Step 3 does.

- [ ] **Step 3: Give the portal pages their own test**

Modify `pageHasData()` in `api.php:867`.

```php
function pageHasData(string $key, string $body): bool {
    if ($body === '') return false;
    return match (true) {
        $key === 'met-day', $key === 'met-warn' => json_decode($body) !== null,
        $key === 'met-now'                      => str_contains($body, 'map.setView'),
        /* The portal rainfall page carries no <tr> on a data row — see portalRows(). Its header
           holds four, and the empty form page holds the same four, so the shared test passes on a
           page with nothing in it. `data-th='No'` appears once per data row and nowhere else. */
        str_starts_with($key, 'prf-')           => str_contains($body, "data-th='No'"),
        default                                 => str_contains($body, '<tr'),
    };
}
```

Then correct the first assertion, the one that failed on purpose:

```php
    $ok('a portal page with a row passes',   pageHasData('prf-SEL', "<td data-th='No'>1</td>") === true);
    $ok('a portal form page fails',          pageHasData('prf-SEL', "<table><tr><th>No.</th></tr></table>") === false);
    $ok('an empty body fails',               pageHasData('prf-SEL', '') === false);
    $ok('the other tables keep the tr test',  pageHasData('nat-SEL', "<tr class='item'>") === true);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `php api.php --selftest`
Expected: all four lines read `ok`.

- [ ] **Step 5: Wire the pages into the refresh path**

At `api.php:1964`, extend the URL set:

```php
$extraUrls = nationalUrls() + klUrls() + metUrls($now) + portalRainUrls();
```

`$ttlFor()` at line 1968 needs no change — the `default` arm gives these pages `SCRAPE_TTL`, which
is what they want.

After the `$page = fn(string $k) => $pages[$k] ?? '';` line at `api.php:2044`, parse them:

```php
/* The national portal's rainfall table, parsed here so every later pass can read it. Nothing
   consumes a reading from it yet. */
$prf = portalRain(array_intersect_key($pages, portalRainUrls()));
```

At `api.php:2552`, add the counter beside the ones already there:

```php
        'portalrf' => ['parsed' => count($prf)],
```

- [ ] **Step 6: Verify the live poll**

Run:

```bash
php -l api.php && php -l sources.php
curl -sk 'https://flood-exp.test/api.php?force=1' -o /dev/null
curl -sk https://flood-exp.test/api.php \
  | php -r 'echo json_encode(json_decode(stream_get_contents(STDIN),true)["sources"]),"\n";'
```

Expected: `portalrf.parsed` reads about 310, and `stale` stays empty. Every other counter holds its
previous value — this task adds a source and changes no reading.

Then prove the failure path names the new keys:

```bash
php -r '$d=new PDO("sqlite:.history.db"); $d->exec("UPDATE page SET ts=0 WHERE url LIKE \"%searchresultrainfall%\"");'
```

Break the URL temporarily (add one character to `PRF`), force a refresh, and confirm `prf-SEL`,
`prf-WLH` and `prf-PTJ` appear in `sources.stale`. Put the URL back.

- [ ] **Step 7: Commit**

```bash
git add api.php
git commit -F - <<'EOF'
Fetch the portal rainfall pages, and give them their own emptiness test

Three more page keys in the cache that already holds the other scraped pages.
They take SCRAPE_TTL from the default arm, so a poll costs six requests at this
host rather than three, and nothing bypasses the cache.

pageHasData() could not answer for this page. Its default arm looks for a tr,
and no data row here carries one. The header holds four, and the empty form
page the endpoint serves without its hidden inputs holds the same four, so the
shared test passes on a page with nothing in it. These keys test for the
data-th attribute that appears once per data row instead.

Nothing reads a portal reading yet. The counter says the rows arrive.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: Join portal rows to the stations this app already holds

**Files:**
- Modify: `api.php` — add `portalKey()` and `portalMatch()` above the `--selftest` block, after
  `rainBacked()` ends at about line 1066
- Modify: `api.php:1067` — add a `portalMatch()` block to `--selftest`
- Test: `php api.php --selftest`

**Interfaces:**
- Consumes: `portalRain()` output from Task 1
- Produces:
  - `portalKey(string $name): string` — a name reduced to lower case with punctuation and spacing
    removed, for comparison only
  - `portalMatch(array $rows, array $stations, string $kind): array` — returns
    `['hit' => [stationId => rowIndex], 'used' => [rowIndex => true], 'clash' => [[stationId, codeRow, nameRow]]]`

**The three rules, strongest first.** Reject anything weaker.

1. **Station code.** 145 of 231 rainfall stations join this way.
2. **Equal name**, after `portalKey()`.
3. **Unique suffix.** The rainfall table drops the river prefix the gazetteer carries. Accept a
   suffix match only when exactly one candidate ends with it.

A near name is not evidence. 17 rainfall stations have a close name and no exact one. They keep their
current source. This is the rule `CAM_FIX` states, and the reason a coordinate this app invents is
worse than one it can show belongs to upstream.

**The collision the spec left to this plan.** 262 portal rows match only 252 distinct stations,
because 10 rows collide: two portal rows claim one station of ours, one on its code and one on its
name. **The code match wins, and the log names the loser rather than dropping it in silence.**

- [ ] **Step 1: Write the failing test**

Add to `--selftest`, after the `portalRain()` block.

```php
    echo "\nportalKey():\n";
    $ok('case and punctuation go',    portalKey('S.M.K Bandar Kinrara (F2)') === 'smkbandarkinraraf2');
    $ok('spacing goes',               portalKey('  Kg.  Melayu   Ampang ') === 'kgmelayuampang');
    $ok('two spellings meet',         portalKey('Sg. Klang') === portalKey('SG KLANG'));

    echo "\nportalMatch():\n";
    $stations = [
        ['id' => 'rf-1', 'kind' => 'rainfall', 'code' => '0232331RF', 'name' => 'Bandar Kinrara'],
        ['id' => 'rf-2', 'kind' => 'rainfall', 'code' => null,        'name' => 'Kg Melayu Ampang'],
        ['id' => 'rf-3', 'kind' => 'rainfall', 'code' => null,        'name' => 'Desa Pinggiran Putra (F2)'],
        ['id' => 'rf-4', 'kind' => 'rainfall', 'code' => null,        'name' => 'Taman Sri Muda'],
        ['id' => 'wl-9', 'kind' => 'river',    'code' => '0232331RF', 'name' => 'Bandar Kinrara'],
    ];
    $rows = [
        0 => ['code' => '0232331RF', 'name' => 'Anything At All'],
        1 => ['code' => null,        'name' => 'KG. MELAYU AMPANG'],
        2 => ['code' => null,        'name' => 'Sg.Langat di Desa Pinggiran Putra (F2)'],
        3 => ['code' => null,        'name' => 'Taman Sri Mudah'],
    ];
    $m = portalMatch($rows, $stations, 'rainfall');
    $ok('a code beats a name',            $m['hit']['rf-1'] === 0);
    $ok('an equal name joins',            $m['hit']['rf-2'] === 1);
    $ok('a unique suffix joins',          $m['hit']['rf-3'] === 2);
    $ok('a near name never joins',        !isset($m['hit']['rf-4']));
    $ok('a river is not matched here',    !isset($m['hit']['wl-9']));
    $ok('used names every joined row',    $m['used'] === [0 => true, 1 => true, 2 => true]);
    $ok('nothing clashes here',           $m['clash'] === []);

    /* The collision the accounting found: 262 rows match 252 stations, so 10 rows claim a station
       another row already took. The code match wins and the loser is logged. */
    $clashRows = [
        0 => ['code' => '0232331RF', 'name' => 'Somewhere Else'],
        1 => ['code' => null,        'name' => 'Bandar Kinrara'],
    ];
    $c = portalMatch($clashRows, $stations, 'rainfall');
    $ok('the code row wins a collision',  $c['hit']['rf-1'] === 0);
    $ok('the name row is not used',       !isset($c['used'][1]));
    $ok('the collision is logged',        $c['clash'] === [['rf-1', 0, 1]]);

    /* Two gazetteer-style names both ending in one suffix. Neither may join: a suffix that fits two
       candidates identifies nothing, and picking either invents a fact. */
    $twoWay = [
        ['id' => 'rf-5', 'kind' => 'rainfall', 'code' => null, 'name' => 'Kuala Lumpur'],
    ];
    $ambiguous = [
        0 => ['code' => null, 'name' => 'Sg. Klang di Kuala Lumpur'],
        1 => ['code' => null, 'name' => 'Sg. Gombak di Kuala Lumpur'],
    ];
    $a = portalMatch($ambiguous, $twoWay, 'rainfall');
    $ok('an ambiguous suffix joins nothing', $a['hit'] === []);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `php api.php --selftest`
Expected: a PHP fatal error, `Call to undefined function portalKey()`.

- [ ] **Step 3: Write the implementation**

Add to `api.php`, after `rainBacked()` ends at about line 1066 and before the `--selftest` block.

```php
/* A station name reduced for comparison. Comparison only — never stored, never rendered.
   The two feeds spell one place several ways: `Kg. Melayu Ampang`, `KG MELAYU AMPANG`,
   `Kg.Melayu  Ampang`. Case, punctuation and spacing carry no information here, so they go. */
function portalKey(string $name): string {
    return strtolower(preg_replace('/[^a-z0-9]/i', '', $name));
}

/* Which portal row belongs to which station this app already holds.
 *
 * Three rules, strongest first, and nothing weaker is accepted:
 *
 *   1. the national station code, which 145 of 231 rainfall stations carry on both sides
 *   2. an equal name under portalKey()
 *   3. a UNIQUE suffix — the rainfall table drops the river prefix the portal's own gazetteer
 *      carries, so `Desa Pinggiran Putra (F2)` is the tail of `Sg.Langat di Desa Pinggiran Putra
 *      (F2)`. Exactly one candidate may end with it. A suffix that fits two identifies neither.
 *
 * A NEAR NAME IS NOT EVIDENCE. 17 rainfall stations have a close name and no equal one, and they
 * keep the source they have. This is the rule CAM_FIX states from the other side: a value this app
 * invents is worse than one it can show belongs to upstream.
 *
 * TWO ROWS CAN CLAIM ONE STATION. Measured, 262 rows match 252 distinct stations, because 10 rows
 * collide — one wins on the code and another on the name. The code wins, and the loser goes in
 * `clash` rather than disappearing. A silent pick here is a reading swapped for another station's
 * reading, on a station somebody watches, with nothing to say it happened.
 *
 * Returns:
 *   hit    stationId => row index, the winner for each station
 *   used   row index => true, every row that found a home
 *   clash  [stationId, winning row, losing row], one entry per collision
 */
function portalMatch(array $rows, array $stations, string $kind): array {
    $mine = array_values(array_filter($stations, fn($s) => $s['kind'] === $kind));

    /* Three indexes, because evidence identifies a station only where it is unique on BOTH sides.
       A code two rows carry names neither of them. A code two of OUR stations carry is worse: it
       hands one station another station's rain. Both happen in the live feed. */
    $byCode = $byName = $mineByCode = [];
    foreach ($rows as $i => $r) {
        if (($r['code'] ?? '') !== '') $byCode[$r['code']][] = $i;
        $byName[portalKey($r['name'] ?? '')][] = $i;
    }
    foreach ($mine as $s) {
        if (($s['code'] ?? '') !== '') $mineByCode[$s['code']][] = $s['id'];
    }

    $cand = $clash = [];
    foreach ($mine as $s) {
        $key  = portalKey($s['name'] ?? '');
        $code = $s['code'] ?? '';

        // Rung 3. JAMBATAN S.K.C shares code 3813001 with Tanjung Malim, and taking the first row
        // gave it Tanjung Malim's rain. BATU 9 and BATU 20 share 3118104 on our own side.
        $codeRow = null;
        if ($code !== '') {
            $there = $byCode[$code] ?? [];
            $here  = $mineByCode[$code] ?? [];
            if (count($there) === 1 && count($here) === 1) $codeRow = $there[0];
            elseif ($there) $clash[] = ['code', $s['id'], $code];
        }

        /* Rung 2 is an equal name, and rung 1 is a suffix that exactly one row ends with. An
           ambiguous equal name REFUSES here. It never falls through to the suffix rule, because a
           name two rows carry proves ambiguity more strongly than a suffix proves identity. */
        $nameRow = null;
        $nameRung = 0;
        $named = $byName[$key] ?? [];
        if ($key !== '' && count($named) === 1) {
            $nameRow = $named[0];
            $nameRung = 2;
        } elseif (count($named) > 1) {
            $clash[] = ['name', $s['id'], $key];
        } elseif ($key !== '') {
            $ends = [];
            foreach ($rows as $i => $r) {
                $rk = portalKey($r['name'] ?? '');
                if ($rk !== $key && str_ends_with($rk, $key)) $ends[] = $i;
            }
            if (count($ends) === 1) { $nameRow = $ends[0]; $nameRung = 1; }
        }

        // The code wins, and this names the row it beat rather than dropping it in silence.
        if ($codeRow !== null && $nameRow !== null && $codeRow !== $nameRow) {
            $clash[] = [$s['id'], $codeRow, $nameRow];
        }
        $row = $codeRow ?? $nameRow;
        if ($row !== null) $cand[$s['id']] = [$row, $codeRow !== null ? 3 : $nameRung];
    }

    /* A portal row is one physical gauge, so it belongs to one station. Five rows were awarded to
       two stations each before this pass. The stronger rung wins, and two equal claims identify
       neither of them. */
    $perRow = [];
    foreach ($cand as $sid => [$row, $rung]) $perRow[$row][] = [$sid, $rung];

    $hit = $used = [];
    foreach ($perRow as $row => $claims) {
        usort($claims, fn($a, $b) => $b[1] <=> $a[1]);
        if (count($claims) > 1) {
            $clash[] = ['row', $row, array_column($claims, 0)];
            if ($claims[0][1] === $claims[1][1]) continue;
        }
        $hit[$claims[0][0]] = $row;
        $used[$row] = true;
    }
    return ['hit' => $hit, 'used' => $used, 'clash' => $clash];
}
```

**This block was rewritten after the live data broke the first version.** The original read
`$byCode[$code][0]`, tried a suffix when an equal name was ambiguous, and let two stations claim one
row. Measured on the live payload, that awarded five rows twice over: BATU 9 took BATU 20's rain and
JENDERAM HILIR took JENDERAM HULU's, which are different places one upstream of the other. The
corrected rule matches 179 stations of 230 across 179 distinct rows with nothing claimed twice,
against 183 matched with 5 wrong. **It costs four joins and removes five wrong readings.** A station
that stays on its old feed is the outcome the spec asks for.

- [ ] **Step 4: Run the test to verify it passes**

Run: `php api.php --selftest`
Expected: every line in the `portalKey()` and `portalMatch()` blocks reads `ok`.

- [ ] **Step 5: Check the join against the live payload**

Run:

```bash
php -r 'require "api.php";' 2>/dev/null; \
php -r '
require "sources.php";
$p = json_decode(file_get_contents(".cache.json"), true);
// portalKey() and portalMatch() live in api.php, which runs a request on include. Copy the two
// functions into this sweep rather than including that file.
function portalKey(string $n): string { return strtolower(preg_replace("/[^a-z0-9]/i", "", $n)); }
$rows = json_decode(file_get_contents(".prf.json"), true);   // written by the Task 1 live check
$mine = array_values(array_filter($p["stations"], fn($s) => $s["kind"] === "rainfall"));
$byCode = $byName = [];
foreach ($rows as $i => $r) { if ($r["code"]) $byCode[$r["code"]][] = $i; $byName[portalKey($r["name"])][] = $i; }
$c = $n = $sfx = $none = 0;
foreach ($mine as $s) {
  if ($s["code"] && isset($byCode[$s["code"]])) { $c++; continue; }
  $k = portalKey($s["name"]);
  if (count($byName[$k] ?? []) === 1) { $n++; continue; }
  $e = 0; foreach ($rows as $r) { $rk = portalKey($r["name"]); if ($rk !== $k && str_ends_with($rk, $k)) $e++; }
  if ($e === 1) $sfx++; else $none++;
}
printf("%d rainfall stations: %d by code, %d by name, %d by suffix, %d unmatched\n",
  count($mine), $c, $n, $sfx, $none);'
```

Expected: about 145 by code, and about 178 matched in total against 231 stations, leaving about 53
on the old feed. **Assert a range.** A large fall in the code count means the portal changed its
identifiers, not that a station went quiet.

- [ ] **Step 6: Commit**

```bash
git add api.php
git commit -F - <<'EOF'
Join portal rows to the stations already held

Three rules, strongest first: the national station code, an equal name, then a
suffix that exactly one candidate ends with. The rainfall table drops the river
prefix the portal's own gazetteer carries, which is what the suffix rule
recovers.

A near name never joins. 17 rainfall stations have a close name and no equal
one, and they keep the source they have. A value invented here is worse than
one that can be shown to belong upstream, which is the rule CAM_FIX already
states from the other side.

Two rows can claim one station. Measured, 262 rows match 252 distinct stations
because 10 rows collide, one winning on the code and another on the name. The
code wins and the loser is logged. A silent pick puts another station's reading
on a station somebody watches, with nothing to say it happened.

Nothing applies a match yet.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 4: Take the portal reading on every matched rainfall station

**Files:**
- Modify: `api.php` — add the portal rainfall override pass after the national river override at
  line 2271
- Modify: `api.php:2552` — extend the `portalrf` counter
- Test: a live poll, and the station accounting sweep

**Interfaces:**
- Consumes: `$prf` from Task 2, `portalMatch()` from Task 3
- Produces: matched rainfall stations carry `source: 'portal'`, and their `hourly`, `daily`,
  `updated` and `status` come from the portal. Adds `pdays` — the six daily columns — read by Task 6
  and never sent to a browser.

**This is the change a reader sees.** 178 rainfall stations change where their number comes from.
That is larger than the 133 new pins Task 8 adds. Each of those stations shows a reading today and
shows the portal figure afterwards, so a disagreement between two feeds becomes visible on a station
somebody watches.

- [ ] **Step 1: Record the before state**

Run and keep the output:

```bash
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
$r=array_filter($p["stations"],fn($s)=>$s["kind"]==="rainfall");
$src=[]; foreach($r as $s) $src[$s["source"]]++;
printf("%d rainfall, sources %s, %d with a null hour\n", count($r), json_encode($src),
  count(array_filter($r, fn($s)=>($s["hourly"] ?? null) === null)));'
```

Expected today: about 231 rainfall stations, sources `selangor` and `kl`, and a count of null hours.
**The null count must not rise after this task.** That is verification rule 5 in the spec.

- [ ] **Step 2: Write the override pass**

Insert after `unset($s);` at `api.php:2271`, immediately following the national river override and
before the rainfall history block.

```php
// --- National portal, rainfall ------------------------------------------------------------------
// The portal is the preferred rainfall source. It publishes a per-day running total the Selangor
// API does not and Kuala Lumpur has never had, which is what makes a 24 hour window exact rather
// than a sum of rolling hours. See portalOdo() and the accumulation block below.
//
// It publishes no coordinate, so this pass only ever corrects a station another feed already placed.
// The rows it alone knows about are placed in a later pass, from the portal's own station search.
$prfHit = portalMatch($prf, $stations, 'rainfall');
$prfUsed = 0;
/* Station id => graph id, for the history backfill at the end of this file. It cannot read
   $s['graphId'] there: the accumulation block below unsets that key before the payload goes out,
   and the backfill runs after the payload. Keep the map instead. */
$graphIds = [];
foreach ($stations as &$s) {
    $i = $prfHit['hit'][$s['id']] ?? null;
    if ($i === null) continue;
    $r = $prf[$i];
    if ($r['hourly'] === null && $r['daily'] === null) continue;   // a row with nothing to give
    $prfUsed++;
    $s['hourly']  = $r['hourly'] ?? $s['hourly'];
    $s['daily']   = $r['daily']  ?? $s['daily'];
    $s['updated'] = $r['updated'] ?? $s['updated'];
    $s['online']  = $s['hourly'] !== null;
    // One definition of a status, and it is this file's. Mixing the portal's reading with another
    // feed's status code lets the two disagree on one card.
    $s['status']  = rainStatus($s['hourly']);
    $s['source']  = 'portal';
    // The six daily columns and the graph id ride here for the passes below. Neither reaches a
    // browser: the accumulation block reads `pdays` and then drops it.
    $s['pdays']   = $r['days'];
    if ($r['graphId'] !== null) $graphIds[$s['id']] = $r['graphId'];
}
unset($s);
```

`graphId` no longer rides on the station at all, so only `pdays` needs dropping before the payload
goes out.

- [ ] **Step 3: Extend the counter**

At `api.php:2552`, replace the `portalrf` line from Task 2:

```php
        // `parsed` is the alarm for a layout change. `applied` is how many stations took a portal
        // reading. `clash` names every station two rows claimed — the code row won each one.
        'portalrf' => ['parsed' => count($prf), 'applied' => $prfUsed,
                       'clash'  => count($prfHit['clash'])],
```

- [ ] **Step 4: Drop the carried field before the payload goes out**

The accumulation block reads `pdays`, and no browser ever sees it. The rainfall history block
at `api.php:2276` already ends with an `unset()` of exactly this shape. Extend that line at
`api.php:2328`:

```php
    unset($s['hour3'], $s['cumulative'], $s['pdays']);   // read here, never sent to a browser
```

**A rainfall station that took no portal reading never gets that key**, so the `unset()` is safe on
every station. `unset()` on a missing key is silent in PHP.

**That line alone does not hold the guarantee, and an earlier version of this plan claimed it did.**
It runs inside `if ($s['kind'] !== 'rainfall' || !isset($s['hourly'])) continue;`. The override gate
above is an OR, so a portal row carrying a daily total and no hourly reading still sets `pdays`, and
`$s['hourly'] = $r['hourly'] ?? $s['hourly']` can fall back to a null the station already held. That
station skips the whole block, and six raw scraped values ride into `json_encode()`. The live payload
already holds one rainfall station with a persistently null hourly reading, so half of that
precondition stands today.

So add a second pass, immediately after the rainfall history loop's closing `unset($s);`:

```php
/* `pdays` rides on a station between the override pass and the block above, and no browser may
   ever see it. The block above drops it for every station it processes, and it skips a station
   holding no hourly reading, so this pass closes that gap. Widening the gate above instead would
   run the history body on a null reading, and `(float) null` would store a fabricated 0.0 mm
   sample on a gauge that reported nothing. */
foreach ($stations as &$s) unset($s['pdays']);
unset($s);
```

**Do not close this by widening the history loop's gate instead.** That body reads
`(float) $s['hourly']`, and `(float) null` is `0.0`, so the station would store a fabricated dry hour
it never reported. A latent leak traded for an invented reading is the wrong direction on a flood
map. The separate pass makes the guarantee unconditional rather than dependent on two gates agreeing
about one condition.

- [ ] **Step 5: Verify the live poll**

Run:

```bash
php -l api.php
curl -sk 'https://flood-exp.test/api.php?force=1' -o /dev/null
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
echo json_encode($p["sources"]["portalrf"]),"\n";
$r=array_filter($p["stations"],fn($s)=>$s["kind"]==="rainfall");
$src=[]; foreach($r as $s) $src[$s["source"]]++;
printf("%d rainfall, sources %s, %d with a null hour\n", count($r), json_encode($src),
  count(array_filter($r, fn($s)=>($s["hourly"] ?? null) === null)));
foreach ($r as $s) if (isset($s["pdays"]) || isset($s["graphId"])) { echo "LEAK ", $s["id"], "\n"; break; }'
```

Expected: `applied` about 178, `clash` about 10, sources now include `portal`, **the null hour count
did not rise**, and no `LEAK` line.

- [ ] **Step 6: Check the two feeds against each other**

The portal reading replaces a reading a reader already saw, so measure the disagreement rather than
assume it is small:

```bash
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
$n=0; foreach($p["stations"] as $s){ if($s["kind"]!=="rainfall"||$s["source"]!=="portal")continue;
  if(($s["hourly"]??null)>0) $n++; }
echo "$n portal stations reporting rain\n";'
```

Expected: a number consistent with the weather. **Score any comparison of the two feeds on stations
with rain in the window.** A dry station agrees with everything, and that is how a rolling field
passed for a disjoint one during this design.

- [ ] **Step 7: Commit**

```bash
git add api.php
git commit -F - <<'EOF'
Take the portal rainfall reading wherever it carries the station

About 178 of 231 rainfall stations change where their number comes from. That
is the real size of this change, larger than the pins it adds later. Each of
those stations shows a reading today and shows the portal figure now, so a
disagreement between the two feeds is visible on a station somebody watches.

The status is re-derived from the portal's own reading through rainStatus().
One definition of a status, and it is this file's. Mixing the portal's number
with another feed's status code lets the two disagree on one card.

The portal publishes no coordinate, so this pass only corrects a station
another feed already placed. The six daily columns and the graph id ride on the
station for the passes below and are dropped before the payload goes out.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 5: Build a running total from the portal's midnight column

**Files:**
- Modify: `api.php` — add `portalOdo()` above the `--selftest` block
- Modify: `api.php:1067` — add a `portalOdo()` block to `--selftest`
- Test: `php api.php --selftest`

**Interfaces:**
- Consumes: nothing. `portalOdo()` is pure arithmetic.
- Produces: `portalOdo(?float $prevOdo, ?float $prevDaily, float $daily, ?float $yesterday): ?float`
  — the next value of a total that only climbs, or null where the caller must restart it.

**Why a running total at all.** `accWindow()` subtracts two samples and needs a number that only
climbs. `cdaily` resets every day. So this app keeps its own running number and never stores `cdaily`
raw. `accWindow()`, `rainBacked()`, `ACC_READ`, `RETAIN` and the whole `acc` block then work
unchanged, which is a large amount of tested machinery preserved for about fifteen lines.

**Bridge one midnight, never several.** A gap longer than a day returns null and the caller restarts
the total. `accWindow()` already returns null on a total that goes backwards, so a dash appears for
a day and the archive recovers on its own. Bridging five more days buys a case only a day of downtime
reaches.

- [ ] **Step 1: Write the failing test**

Add to `--selftest`, immediately before the `echo "\naccWindow():\n";` line.

```php
    echo "\nportalOdo():\n";
    $ok('a first sample starts at today',   portalOdo(null, null, 7.5, null) === 7.5);
    $ok('a rise within a day adds the rise', portalOdo(100.0, 7.5, 12.0, null) === 104.5);
    $ok('no rise adds nothing',              portalOdo(100.0, 7.5, 7.5, null) === 100.0);
    /* The midnight bridge. The last reading taken yesterday was 7.5, yesterday's column closed at
       9.0, and today has 2.0 so far. The total owes 1.5 from yesterday plus today's 2.0. */
    $ok('a reset bridges through yesterday', portalOdo(100.0, 7.5, 2.0, 9.0) === 103.5);
    /* Yesterday's column is missing, so the bridge falls back to what was already counted. The
       rain between the last reading and midnight is lost, and a lost millimetre beats a wrong one. */
    $ok('no column bridges to the last read', portalOdo(100.0, 7.5, 2.0, null) === 102.0);
    /* Yesterday's column BELOW the last reading taken from it. Upstream corrected a number
       downwards. Owe nothing rather than subtract. */
    $ok('a shrinking column owes nothing',   portalOdo(100.0, 7.5, 2.0, 6.0) === 102.0);
    /* A mid-day reset, which happens about once per station per 20 days. It reads exactly like a
       midnight, and the bridge treats it as one. accWindow() sees a total that still climbs. */
    $ok('a mid-day glitch still climbs',     portalOdo(100.0, 30.0, 0.0, 30.0) === 100.0);
    $ok('a null daily cannot be counted',    portalOdo(100.0, 7.5, null, 9.0) === null);
```

Note the last assertion needs the signature to accept a null `$daily`, so declare it `?float $daily`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `php api.php --selftest`
Expected: a PHP fatal error, `Call to undefined function portalOdo()`.

- [ ] **Step 3: Write the implementation**

Add to `api.php`, after `rainBacked()` and beside `portalMatch()` from Task 3.

```php
/* The next value of a running rainfall total, built from the portal's own midnight column.
 *
 * `accWindow()` subtracts two samples, so it needs a number that only climbs. The portal publishes
 * `Rainfall from Midnight`, which resets every day. This app therefore keeps its own running number
 * and never stores the daily figure raw. Everything downstream — accWindow(), rainBacked(),
 * ACC_READ, RETAIN, the acc block — then works with no change at all.
 *
 * Within a day the total gains the rise since the last sample.
 *
 * ACROSS A MIDNIGHT the total gains two things: whatever the old day still owed, and the whole of
 * the new day so far. What the old day owed is yesterday's column minus the last reading this app
 * took from it. Nothing else reads a daily column. THE COLUMN IS OLDEST FIRST, so yesterday is the
 * LAST of the six — see portalRain().
 *
 * ONE MIDNIGHT, NEVER SEVERAL. A caller that missed a whole day cannot bridge it this way. It
 * restarts the total instead, accWindow() returns null on a total that goes backwards, and a dash
 * shows for a day while the archive recovers. Bridging five more columns buys a case only a day of
 * downtime reaches.
 *
 * THE RESET LANDS AT 00:05, NOT 00:00. The 00:00 record still carries the previous day's total.
 * This function never reads a clock, so that boundary costs it nothing — it compares two readings
 * and a fall is a reset whenever it happens. A mid-day glitch, measured at about one per station
 * per 20 days, takes the same path and still climbs.
 *
 * Returns the next total, or null where the caller has nothing to store.
 */
function portalOdo(?float $prevOdo, ?float $prevDaily, ?float $daily, ?float $yesterday): ?float {
    if ($daily === null) return null;
    if ($prevOdo === null || $prevDaily === null) return $daily;
    if ($daily >= $prevDaily) return round($prevOdo + ($daily - $prevDaily), 1);
    // A fall is a reset. Owe nothing rather than subtract where yesterday's column is missing or
    // sits below what this app already counted from it.
    $owed = max(0.0, ($yesterday ?? $prevDaily) - $prevDaily);
    return round($prevOdo + $owed + $daily, 1);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `php api.php --selftest`
Expected: every line in the `portalOdo()` block reads `ok`, and every existing assertion still reads
`ok`.

- [ ] **Step 5: Commit**

```bash
git add api.php
git commit -F - <<'EOF'
Build a running rainfall total from the portal's midnight column

accWindow() subtracts two samples, so it needs a number that only climbs. The
portal publishes a total from midnight, which resets every day. This app keeps
its own running number instead and never stores the daily figure raw, so
accWindow(), rainBacked(), ACC_READ and RETAIN all work with no change.

Within a day the total gains the rise since the last sample. Across a midnight
it gains what the old day still owed, read from yesterday's column, plus the
whole of the new day so far. The six columns are oldest first, so yesterday is
the last of them.

One midnight, never several. A caller that missed a whole day restarts the
total, accWindow() returns null on that, and a dash shows for a day while the
archive recovers.

The 00:05 boundary costs this nothing. It reads no clock, compares two
readings, and treats any fall as a reset. A mid-day glitch takes the same path
and still climbs.

Nothing stores a portal total yet.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 6: Make every window exact, and delete `accHours()`

**Files:**
- Modify: `api.php:2276-2330` — the rainfall history and accumulation block
- Modify: `api.php:1016-1035` — delete `accHours()`
- Modify: `api.php:1067` — delete the `accHours()` assertions from `--selftest`
- Modify: `js/popup.js:1253` — the message on an unanswerable long window
- Modify: `CLAUDE.md` — the accumulation gotcha
- Test: `php api.php --selftest`, then a live poll

**Interfaces:**
- Consumes: `portalOdo()` from Task 5, `pdays` from Task 4, `accWindow()` unchanged
- Produces: `acc.h24` and `acc.h72` answer on portal stations. `acc.h3` answers exactly rather than
  by a sum of rolling hours.

**What retires here.** `accHours()` adds one reading per clock hour. `hourlyRainfall` is a rolling
60 minute total, so a sum only tiles if the readings sit exactly one hour apart. They sit a median 46
minutes apart, and every boundary counts about 14 minutes of rain twice. Scored against the 3 hour
total Selangor publishes for itself, 14 of 176 stations were out by more than 5 mm, worst 60 mm.
**The error is zero on dry stations and large during heavy rain**, which is the worst shape this app
can carry.

- [ ] **Step 1: Write the failing test**

The exactness this task buys is a property of `accWindow()` over a portal series, and `accWindow()`
is already covered. What is not covered is the store-and-read cycle. Add to `--selftest` after the
`portalOdo()` block:

```php
    /* The cycle this task builds: a series of daily readings becomes a running total, and
       accWindow() reads an exact window off it. Two days of polls across one midnight. */
    $day = [[$now - 30 * 3600, 2.0, null], [$now - 26 * 3600, 6.0, null],
            [$now - 20 * 3600, 1.0, 9.0],  [$now - 2 * 3600, 4.5, 9.0]];
    $odoSeries = [];
    $run = $wasDaily = null;
    foreach ($day as [$ts, $d, $yest]) {
        $run = portalOdo($run, $wasDaily, $d, $yest);
        $wasDaily = $d;
        $odoSeries[] = [$ts, $run];
    }
    /* 2.0 at the first sample, +4.0 to 6.0, then a reset owing 3.0 and adding 1.0, then +3.5.
       Total 13.5 mm, and the 24 hour window covers the last three of those samples. */
    $ok('the running total only climbs',
        $odoSeries[3][1] >= $odoSeries[2][1] && $odoSeries[2][1] >= $odoSeries[1][1]);
    $ok('a midnight loses no rain',          $odoSeries[3][1] === 13.5);
    $ok('the 24h window reads it exactly',
        accWindow($odoSeries, $now, 24 * 3600, true) === [7.5, 26.0, false]);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `php api.php --selftest`
Expected: the three new lines read `ok` already, because `portalOdo()` and `accWindow()` both exist.
**This is a characterisation test, not a red test** — it pins the contract between two functions
that Task 5 and the existing code each satisfy alone. Record that it passed on the first run rather
than pretending it failed.

- [ ] **Step 3: Store the portal total and read the windows from it**

In the rainfall history block at `api.php:2276`, replace the `hour3` branch and the `cumulative`
branch. The block from line 2295 to line 2325 becomes:

```php
    /* The 3 hour window. Selangor publishes its own total, and it is read straight off the feed.
       Everything else measures it from the running total, which is exact.
       accHours() is gone. It added one rolling hour per clock hour, which only tiles where the
       readings sit exactly an hour apart. They sit a median 46 minutes apart, so every boundary
       counted about 14 minutes of rain twice — zero error on a dry station and up to 60 mm during
       heavy rain, which is the worst shape an error can take here. */
    if (($s['hour3'] ?? null) !== null) {
        $acc['h3'] = [round((float)$s['hour3'], 1), 0, null];
    }

    /* The running total. A portal station builds one from the midnight column — see portalOdo().
       A Selangor station that took no portal reading keeps using the year-to-date odometer the
       detail endpoint publishes. Both are numbers that only climb, so accWindow() reads either. */
    $run = null;
    if (($s['source'] ?? '') === 'portal' && ($s['daily'] ?? null) !== null) {
        // end() takes its argument by reference, so both series go into a variable first. Passing
        // an expression there is a PHP notice and a value this code would then read as null.
        $cSeries = $odo[$key . '#c'] ?? [];
        $dSeries = $odo[$key . '#d'] ?? [];
        $prev    = $cSeries ? end($cSeries) : null;
        $prevD   = $dSeries ? end($dSeries) : null;
        $run     = portalOdo(
            $prev[1]  ?? null,
            $prevD[1] ?? null,
            (float)$s['daily'],
            // Oldest first, so yesterday is the last of the six.
            ($s['pdays'] ?? []) ? end($s['pdays']) : null,
        );
        // The daily reading itself, so the next poll knows what it already counted. Its own suffix,
        // for the same reason `#c` has one: no station id ends in `#d`.
        if ($run !== null) $samples[$key . '#d'] = [$ts, (float)$s['daily']];
    } elseif (($s['cumulative'] ?? null) !== null) {
        $run = (float)$s['cumulative'];
    }

    if ($run !== null) {
        $series = array_merge($odo[$key . '#c'] ?? [], [[$ts, $run]]);
        foreach (['h3' => 10800, 'h24' => 86400, 'h72' => 259200] as $k => $win) {
            if ($acc[$k] !== null) continue;          // the feed already answered this window
            if (($w = accWindow($series, $now, $win, true)) !== null)
                $acc[$k] = [$w[0], $w[2] ? 2 : 1, $w[1]];
        }
        /* Nothing filters the pair. Both long windows anchor to the oldest sample there is, so a
           young archive answers both with one number over one span, each marked short. */
        $s['backed']  = rainBacked($s['hourly'] ?? null, $series, $now);
        $s['accFrom'] = $series[0][0];
        $samples[$key . '#c'] = [$ts, $run];
    }
```

**The `#d` series needs the same load as `#c`.** At `api.php:2089`, the odometer read selects
`station LIKE '%#c'`. Widen it:

```php
foreach ($db->query('SELECT station, ts, level FROM level WHERE (station LIKE \'%#c\' OR station LIKE \'%#d\') AND ts >= '
                    . ($now - ACC_READ) . ' ORDER BY ts') as $r) {
    $odo[$r['station']][] = [(int)$r['ts'], (float)$r['level']];
}
```

- [ ] **Step 4: Delete `accHours()` and its assertions**

Delete `accHours()` at `api.php:1016-1035` entirely. Then delete every `accHours(` line from
`--selftest`. Confirm nothing else calls it:

```bash
grep -rn "accHours" . --include=*.php --include=*.js --include=*.md
```

Expected: only `CLAUDE.md` and `docs/` matches remain, and Step 6 clears those.

- [ ] **Step 5: Run the test to verify it passes**

Run: `php api.php --selftest && php -l api.php`
Expected: every assertion reads `ok` and the file lints clean. **The `accWindow()` block must still
be there and still green** — this task changes what feeds it, not what it does.

- [ ] **Step 6: Change the message on an unanswerable window**

At `js/popup.js:1253`, the readout tells a reader why a long window is empty:

```js
  const blank = (k, label) => ODO[k] && !from
```

The message it produces is `Not measured. This gauge reports no running total.` **Every portal
station now has a running total, so this stops being the usual case and becomes the rare one.** The
words stay correct, so change nothing in the string. Confirm on the live payload instead that the
count of stations reaching it fell:

```bash
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
$r=array_filter($p["stations"],fn($s)=>$s["kind"]==="rainfall");
printf("%d rainfall, %d with no running total, %d answering h24, %d answering h72\n", count($r),
  count(array_filter($r, fn($s)=>!isset($s["accFrom"]))),
  count(array_filter($r, fn($s)=>($s["acc"]["h24"] ?? null) !== null)),
  count(array_filter($r, fn($s)=>($s["acc"]["h72"] ?? null) !== null)));'
```

Expected: the "no running total" count falls from about 53 toward the stations the portal does not
carry. On the first poll after this task, `h24` and `h72` answer only where the archive already holds
two samples, so **run this again after two polls** before judging it.

- [ ] **Step 7: Update `CLAUDE.md`**

The accumulation gotcha states that 38 Kuala Lumpur stations answer neither long window and never
will. That is no longer true, and the reason it changed belongs beside it. Rewrite that passage to
say:

- the portal supplies a per-day running total, so a station it carries answers both long windows
- `accHours()` is gone, and why a sum of rolling hours was wrong
- the remaining stations with no running total are the ones the portal does not carry
- the `#d` series is the previous daily reading, and it exists so the next poll knows what it
  already counted

Then run `python "C:/Users/illus/.claude/ste-lint.py" < CLAUDE.md` and keep the count at or below
where it started.

- [ ] **Step 8: Commit**

```bash
git add api.php js/popup.js CLAUDE.md
git commit -F - <<'EOF'
Measure every rainfall window exactly, and delete accHours()

accHours() added one rolling hour per clock hour. hourlyRainfall is a rolling
60 minute total, so a sum only tiles where the readings sit exactly an hour
apart. They sit a median 46 minutes apart, and every boundary counted about 14
minutes of rain twice. Scored against the 3 hour total Selangor publishes for
itself, 14 of 176 stations were out by more than 5 mm and the worst by 60 mm.
The error is zero on a dry station and large during heavy rain, which is the
worst shape an error can take here.

A portal station now builds a running total from the midnight column, stores it
under the existing #c suffix, and accWindow() reads an exact 3, 24 and 72 hour
window off it with no new arithmetic. A Selangor station the portal does not
carry keeps the year-to-date odometer it already used.

The #d suffix holds the previous daily reading, so the next poll knows what it
already counted. No station id ends in #d, which is the same reason #c has its
own suffix.

The Kuala Lumpur gauges stop being a permanent dash. The message that says a
gauge reports no running total stays correct and becomes rare.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 7: The coordinate gazetteer

**Files:**
- Modify: `sources.php` — add `gazUrl()` and `gazParse()`
- Modify: `api.php` — add the `station` table, `gazWanted()`, and the dripped backfill at the end of
  the refresh
- Modify: `api.php:1067` — add `gazParse()` and `gazWanted()` assertions
- Test: `php api.php --selftest`, then a live drip

**Interfaces:**
- Consumes: `$prf` from Task 2, `$prfHit` from Task 4
- Produces:
  - `gazUrl(string $q): string`
  - `gazParse(string $json): array` — a list of `['name' => …, 'district' => …, 'state' => …,
    'lat' => …, 'lng' => …]`
  - `gazWanted(array $names, array $done, int $cap): array` — the next prefixes to query
  - A `station` table in `.history.db`: `name TEXT PRIMARY KEY, lat REAL, lng REAL, district TEXT,
    state TEXT`
  - A `gazdone` row set in the `page` table, one per prefix already queried

**The endpoint.** `searchstation_control.php?q=` takes three characters or more and answers with a
flat array of `{"loc":[lat,lng],"title":"Name, District, State"}`. **It is a substring search, not a
prefix search** — `q=sg.` returned 1,208 rows on 15 August, including names where `sg.` appears in the
middle. It answers for the whole country, so filter every row to the three states this map covers.

**The prefix set comes from the data, not from a list.** Take the first three characters of every
portal station name that found no match in Task 3, lower case them, and keep the distinct ones. That
is about 35 queries for the roughly 163 unmatched names, and their union is the gazetteer this app
needs. **Do not query the alphabet.** A fixed list is a list somebody maintains, and it is wrong the
day the portal adds a station whose name starts with something else.

**The load rule.** About 35 queries is a burst at one government host, which is the shape of the
camera stampede. Take at most `GAZ_FILL` prefixes per refresh, at the end of a refresh, inside the
existing lock, rate limited through `forceAllowed()` at its own window. At 5 per refresh and 4
refreshes each hour the set completes in under two hours and no burst ever leaves this box.

- [ ] **Step 1: Write the failing test**

```php
    echo "\ngazParse():\n";
    $gazJson = '[{"loc":[3.1,101.6],"title":"Sg. Klang di Kuala Lumpur, Kuala Lumpur, Wilayah Persekutuan Kuala Lumpur"},'
             . '{"loc":[2.38,103.87],"title":"Sg. Paya Dato, Mersing, Johor"},'
             . '{"loc":[3.0,101.5],"title":"Desa Pinggiran Putra (F2), Sepang, Selangor"},'
             . '{"loc":[0,0],"title":"Broken, Nowhere, Selangor"}]';
    $g = gazParse($gazJson);
    $ok('every row is read',            count($g) === 3);
    $ok('the name is the first part',   $g[0]['name'] === 'Sg. Klang di Kuala Lumpur');
    $ok('the state is the last part',   $g[0]['state'] === 'Wilayah Persekutuan Kuala Lumpur');
    $ok('the district is the middle',   $g[0]['district'] === 'Kuala Lumpur');
    $ok('a Johor station is kept here', $g[1]['state'] === 'Johor');
    $ok('a zero coordinate is dropped', count(array_filter($g, fn($r) => $r['name'] === 'Broken')) === 0);
    $ok('bad json yields nothing',      gazParse('not json') === []);
    $ok('an empty body yields nothing', gazParse('') === []);

    echo "\ngazWanted():\n";
    $names = ['Bandar Kinrara', 'Bandar Utama', 'Kg Melayu Ampang', 'Sri Muda', 'sri kembangan'];
    $ok('three characters, lower case, distinct',
        gazWanted($names, [], 99) === ['ban', 'kgm', 'sri']);
    $ok('a short name is skipped',      gazWanted(['ab'], [], 99) === []);
    $ok('the cap is honoured',          count(gazWanted($names, [], 2)) === 2);
    $ok('a done prefix is not asked again', gazWanted($names, ['ban' => 1], 99) === ['kgm', 'sri']);
    $ok('a finished set asks for none',
        gazWanted($names, ['ban' => 1, 'kgm' => 1, 'sri' => 1], 99) === []);
```

Note `gazWanted()` strips whitespace before taking three characters, which is why
`Kg Melayu Ampang` gives `kgm` and not `kg `.

- [ ] **Step 2: Run the test to verify it fails**

Run: `php api.php --selftest`
Expected: a PHP fatal error, `Call to undefined function gazParse()`.

- [ ] **Step 3: Write the parser**

Add to `sources.php`, after `portalRain()`.

```php
/* The portal's own station search, which is the only place it publishes a coordinate.
   Three characters or more, and it is a SUBSTRING search rather than a prefix one — `q=sg.`
   returned 1,208 rows on 15 August, including names carrying `sg.` in the middle. It answers for
   the whole country, so a caller filters to the states it draws. */
const GAZ = 'https://publicinfobanjir.water.gov.my/wp-content/themes/enlighten/query/searchstation_control.php';

function gazUrl(string $q): string {
    return GAZ . '?' . http_build_query(['q' => $q]);
}

/* `{"loc":[lat,lng],"title":"Name, District, State"}` into something with named parts.
   The title is comma separated and the NAME ITSELF CAN HOLD A COMMA, so the split takes the last
   two parts as district and state and rejoins everything before them as the name.
   A zero coordinate is dropped. JPS publishes those on cameras too, and CAM_FIX exists because a
   coordinate this app invents is worse than none. */
function gazParse(string $json): array {
    $rows = json_decode($json, true);
    if (!is_array($rows)) return [];
    $out = [];
    foreach ($rows as $r) {
        $lat = (float)($r['loc'][0] ?? 0);
        $lng = (float)($r['loc'][1] ?? 0);
        if (!$lat || !$lng) continue;
        $parts = array_map('trim', explode(',', (string)($r['title'] ?? '')));
        if (count($parts) < 3) continue;
        $state    = array_pop($parts);
        $district = array_pop($parts);
        $out[] = [
            'name' => implode(', ', $parts), 'district' => $district, 'state' => $state,
            'lat'  => $lat, 'lng' => $lng,
        ];
    }
    return $out;
}
```

- [ ] **Step 4: Write the prefix picker**

**The four constants go at the top of `api.php`, beside `PLACE_EVERY` at line 230** — not beside the
function and not inside the drip. A PHP `const` is a compile-time declaration and cannot sit inside a
conditional block, which is where the drip lives.

```php
const GAZ_FILL  = 5;                              // prefixes per refresh
const GAZ_EVERY = 600;                            // seconds between drips, site-wide
const GAZ_STAMP = __DIR__ . '/.gaz.stamp';
const GAZ_KEY   = 'gazdone:';                     // one page row per prefix already queried
```

Then add the picker to `api.php`, beside `portalMatch()`.

```php
/* Which prefixes to ask the station search for next.
 *
 * The set comes from the data rather than from a list: the first three characters of every portal
 * name this app could not match, lower cased, distinct. About 35 queries cover the roughly 163
 * unmatched names, and their union is the whole gazetteer this app needs.
 *
 * DO NOT REPLACE THIS WITH A FIXED LIST. A list is a thing somebody maintains, and it is wrong the
 * day the portal publishes a station whose name starts with something else.
 *
 * Capped per call because about 35 requests sent together is a burst at one government host, which
 * is the shape of the camera stampede this app has a rule against.
 */
function gazWanted(array $names, array $done, int $cap): array {
    $want = [];
    foreach ($names as $n) {
        $k = strtolower(preg_replace('/\s+/', '', $n));
        if (strlen($k) < 3) continue;
        $p = substr($k, 0, 3);
        if (isset($done[$p]) || isset($want[$p])) continue;
        $want[$p] = true;
        if (count($want) >= $cap) break;
    }
    return array_keys($want);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `php api.php --selftest`
Expected: every line in the `gazParse()` and `gazWanted()` blocks reads `ok`.

- [ ] **Step 6: Add the table and the drip**

Beside the `page` table creation at `api.php:1957`:

```php
$db->exec('CREATE TABLE IF NOT EXISTS station (name TEXT PRIMARY KEY, lat REAL, lng REAL,
                                               district TEXT, state TEXT) WITHOUT ROWID');
```

**The drip runs after the echo, so it cannot report its own numbers.** This file builds the counters
at line 2528 and echoes them at 2568. The `level` insert at 2570 already sits past that point. So the counting happens **before** the echo and the fetching happens **after** it. Put
this block above the payload, next to the line that builds `$prfHit`:

```php
/* What the gazetteer holds and what it still owes, counted before the payload goes out. The drip
   itself runs at the end of this file, after the echo, so it cannot report on itself. */
$gazDone = [];
foreach ($stored as $su => $sr) {
    if (str_starts_with($su, GAZ_KEY)) $gazDone[substr($su, strlen(GAZ_KEY))] = 1;
}
// Only the rows that found no home. A matched row needs no coordinate: it already has one.
$gazNames = [];
foreach ($prf as $i => $r) if (!isset($prfHit['used'][$i])) $gazNames[] = $r['name'];
$gazAsk = gazWanted($gazNames, $gazDone, GAZ_FILL);
```

Then at the very end of the refresh path, after the `level` insert transaction at
`api.php:2570-2574` and still inside the lock, add the fetch:

```php
/* The gazetteer drip. At the END of a refresh, never on a reader's poll, and never as a burst —
   exactly the rule captureShots() obeys for the camera archive.
   forceAllowed() at its own window is the site-wide guard, the same one ?force=1 and ?place= use.
   A stamp file caps the rate however many readers arrive at once, and the refresh lock already
   stops two rebuilds running together. */
[$gazOk] = forceAllowed($now, is_file(GAZ_STAMP) ? filemtime(GAZ_STAMP) : null, GAZ_EVERY);
if ($gazOk) {
    $ask = $gazAsk;
    if ($ask) {
        touch(GAZ_STAMP);
        $urls = [];
        foreach ($ask as $p) $urls[$p] = gazUrl($p);
        $got = fetchAll($urls, 3, false);
        $put = $db->prepare('INSERT OR REPLACE INTO station (name, lat, lng, district, state)
                             VALUES (?, ?, ?, ?, ?)');
        $db->beginTransaction();
        foreach ($ask as $p) {
            foreach (gazParse($got[$urls[$p]] ?? '') as $g) {
                // Three states, because that is the map. The endpoint answers for the country.
                if (!preg_match('/selangor|kuala lumpur|putrajaya/i', $g['state'])) continue;
                $put->execute([$g['name'], $g['lat'], $g['lng'], $g['district'], $g['state']]);
            }
            // Stamped whether or not it answered, the same rule pageRow() states: a prefix that
            // never answers must not be asked again on every refresh forever.
            $keep->execute([GAZ_KEY . $p, $now, '1']);
        }
        $db->commit();
    }
}
```

Publish what it holds, beside the other counters at `api.php:2552`:

```php
        // `pending` is what the NEXT drip will ask for, capped at GAZ_FILL. It reaching 0 is the
        // backfill finishing, which is success — see watch.php in Task 10.
        'gaz' => ['stations' => (int)$db->query('SELECT COUNT(*) FROM station')->fetchColumn(),
                  'asked'    => count($gazDone), 'pending' => count($gazAsk)],
```

- [ ] **Step 7: Watch the drip fill**

Run four forced refreshes about ten minutes apart, then:

```bash
curl -sk https://flood-exp.test/api.php \
  | php -r 'echo json_encode(json_decode(stream_get_contents(STDIN),true)["sources"]["gaz"]),"\n";'
php -r '$d=new PDO("sqlite:.history.db");
foreach ($d->query("SELECT state, COUNT(*) n FROM station GROUP BY state") as $r) echo "$r[state] $r[n]\n";'
```

Expected: `asked` climbs by at most `GAZ_FILL` per drip, `stations` climbs, and only the three states
this map draws appear. **A drip that fires more than once per `GAZ_EVERY` means the stamp is not
written**, which is the one fault that turns this into the burst it exists to prevent. Check
`.gaz.stamp` exists and its mtime moves.

- [ ] **Step 8: Commit**

```bash
git add sources.php api.php
git commit -F - <<'EOF'
Fill a coordinate gazetteer from the portal's own station search

The station search is the only place the portal publishes a coordinate. Three
characters or more, and it is a substring search rather than a prefix one:
q=sg. returned 1,208 rows on 15 August, including names carrying it in the
middle. It answers for the whole country, so every row is filtered to the three
states this map draws.

The prefix set comes from the data. Take the first three characters of every
portal name that found no match, lower cased and distinct, which is about 35
queries for the roughly 163 unmatched names. A fixed list would be wrong the
day the portal publishes a station starting with something else.

The drip is the load rule. At most five prefixes per refresh, at the end of a
refresh, inside the existing lock, behind a stamp file through forceAllowed().
About 35 requests sent together is a burst at one government host, which is the
shape of the camera stampede this app has a rule against. A prefix is stamped
whether or not it answered, the same rule pageRow() states, so a dead query
cannot be asked again on every refresh forever.

Nothing places a station from this table yet.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 8: Place the stations the portal alone knows about

**Files:**
- Modify: `api.php` — add `gazPlace()`, `portalState()` and the two new-station passes
- Modify: `api.php:1067` — add `gazPlace()` assertions
- Test: `php api.php --selftest`, then a live poll and the district outlier sweep

**Interfaces:**
- Consumes: the `station` table from Task 7, `portalKey()` from Task 3, `$nat` from the existing
  national override at `api.php:2254`
- Produces:
  - `gazPlace(string $name, array $gaz): ?array` — `['lat' => …, 'lng' => …, 'district' => …,
    'state' => …]` or null
  - `portalState(string $s): string` — `Selangor`, `Kuala Lumpur` or `Putrajaya`
  - About 133 new stations on the map: 96 rainfall and 37 rivers.

**No new river fetch.** `nationalUrls()` already reads that table on every refresh and `$nat` already
holds every row keyed by station code. The rows that corrected nothing are the new set. A
second fetch of the same three pages doubles this app's cost at that host, for data it already
holds in memory.

**The two rules that place a station**, and nothing weaker:

1. **Equal name** under `portalKey()`.
2. **Unique suffix.** Exactly one gazetteer name ends with the portal name. 83 of the 133 place on
   an equal name and 50 on a unique suffix.

**30 rows place on neither, and this skips them.** It counts them and never pins them at a guessed
coordinate. A coordinate this app invents is worse than one it can show belongs to upstream.

**Rivers already take the portal reading.** 75 of 107 carry `source: national` today, so this half
adds 37 stations and changes no existing number. 22 of the 37 are the Kuala Lumpur rivers, which
closes that gap completely.

- [ ] **Step 1: Write the failing test**

```php
    echo "\ngazPlace():\n";
    $gaz = [
        ['name' => 'Sg.Langat di Desa Pinggiran Putra (F2)', 'lat' => 3.0, 'lng' => 101.5,
         'district' => 'Sepang', 'state' => 'Selangor'],
        ['name' => 'Bandar Kinrara',      'lat' => 3.05, 'lng' => 101.63,
         'district' => 'Petaling', 'state' => 'Selangor'],
        ['name' => 'Sg. Klang di Ampang', 'lat' => 3.15, 'lng' => 101.75,
         'district' => 'Kuala Lumpur', 'state' => 'Wilayah Persekutuan Kuala Lumpur'],
        ['name' => 'Sg. Gombak di Ampang','lat' => 3.20, 'lng' => 101.72,
         'district' => 'Gombak', 'state' => 'Selangor'],
    ];
    $ok('an equal name places',
        gazPlace('Bandar Kinrara', $gaz)['lat'] === 3.05);
    $ok('the district comes with it',
        gazPlace('Bandar Kinrara', $gaz)['district'] === 'Petaling');
    $ok('a unique suffix places',
        gazPlace('Desa Pinggiran Putra (F2)', $gaz)['lat'] === 3.0);
    /* Two gazetteer names end with `Ampang`. A suffix that fits two identifies neither, and picking
       one puts a pin on a river it does not belong to. */
    $ok('an ambiguous suffix places nothing', gazPlace('Ampang', $gaz) === null);
    $ok('an unknown name places nothing',     gazPlace('Nowhere At All', $gaz) === null);
    $ok('an empty gazetteer places nothing',  gazPlace('Bandar Kinrara', []) === null);
    $ok('an empty name places nothing',       gazPlace('', $gaz) === null);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `php api.php --selftest`
Expected: a PHP fatal error, `Call to undefined function gazPlace()`.

- [ ] **Step 3: Write the placer**

Add to `api.php`, beside `portalMatch()`.

```php
/* Where a portal station stands, from the gazetteer this app filled in Task 7.
 *
 * Two rules and nothing weaker:
 *   1. an equal name under portalKey()
 *   2. a UNIQUE suffix — exactly one gazetteer name may end with this one
 *
 * Measured over the 133 stations this places, 83 join on an equal name and 50 on a unique suffix.
 * 30 more rows join on neither and stay off the map. THEY ARE COUNTED, NEVER GUESSED AT. A
 * coordinate this app invents is worse than one it can show belongs to upstream, which is the rule
 * CAM_FIX states after ten rounds of arguing about single pins.
 */
function gazPlace(string $name, array $gaz): ?array {
    $k = portalKey($name);
    if ($k === '') return null;
    $equal = $ends = [];
    foreach ($gaz as $g) {
        $gk = portalKey($g['name']);
        if ($gk === $k) $equal[] = $g;
        elseif (str_ends_with($gk, $k)) $ends[] = $g;
    }
    $win = count($equal) === 1 ? $equal[0] : (count($ends) === 1 ? $ends[0] : null);
    if ($win === null) return null;
    return ['lat' => $win['lat'], 'lng' => $win['lng'],
            'district' => $win['district'], 'state' => $win['state']];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `php api.php --selftest`
Expected: every line in the `gazPlace()` block reads `ok`.

- [ ] **Step 5: Place the new rainfall stations**

Load the gazetteer once, near the odometer read at `api.php:2088`:

```php
$gaz = [];
foreach ($db->query('SELECT name, lat, lng, district, state FROM station') as $r) $gaz[] = $r;
```

Then, after the portal rainfall override from Task 4, add the new-station pass:

```php
/* Rows the portal alone knows about. Placed from the gazetteer, or counted and dropped.
   `state` decides which half of the map a station belongs to, and district names collide across
   states — Kuala Lumpur and Selangor both have a Gombak — so anything keyed by district must key by
   state and district together. See dkey() in js/util.js. */
$prfNew = $prfSkip = 0;
foreach ($prf as $i => $r) {
    if (isset($prfHit['used'][$i])) continue;
    $at = gazPlace($r['name'], $gaz);
    if ($at === null) { $prfSkip++; continue; }
    $prfNew++;
    $stations[] = [
        'kind'     => 'rainfall',
        'id'       => 'prf-' . ($r['code'] ?? md5($r['name'])),
        'name'     => $r['name'],
        'district' => $at['district'],
        'basin'    => null,
        'lat'      => $at['lat'], 'lng' => $at['lng'],
        'status'   => rainStatus($r['hourly']),
        'online'   => $r['hourly'] !== null,
        'hourly'   => $r['hourly'], 'daily' => $r['daily'],
        'code'     => $r['code'], 'source' => 'portal',
        'state'    => portalState($at['state']),
        'updated'  => $r['updated'],
        'pdays'    => $r['days'],
    ];
    // Same map the override pass fills, and for the same reason: the backfill runs after the
    // payload, and `pdays` is unset before then.
    if ($r['graphId'] !== null) $graphIds['prf-' . ($r['code'] ?? md5($r['name']))] = $r['graphId'];
}
```

**This builds the station id twice, so build it once.** Assign it to a variable above the
`$stations[]` append and use it in both places. Two copies of an id expression is two places to
change it.

Add the state normaliser beside `klState()` at `api.php:2210`:

```php
/* The gazetteer spells the federal territory in full. This app draws three states and names them
   the way every other station in the payload already does. */
function portalState(string $s): string {
    if (stripos($s, 'putrajaya') !== false) return 'Putrajaya';
    if (stripos($s, 'kuala lumpur') !== false) return 'Kuala Lumpur';
    return 'Selangor';
}
```

- [ ] **Step 6: Place the new rivers**

The river table is the one `nationalLevels()` already reads, and `$nat` already holds every row keyed
by station code. The rows that matched nothing are the new stations.

After the national river override at `api.php:2271`:

```php
/* The rivers the portal alone knows about. $nat is keyed by station code and $natUsed names every
   code that corrected a station this app already held, so the difference is the new set.
   22 of these are the Kuala Lumpur rivers the SPHTN table never placed, which is the gap this
   whole source exists to close. */
$natNew = $natSkip = 0;
foreach ($nat as $code => $n) {
    if (isset($natUsed[$code]) || $n['level'] === null) continue;
    $at = gazPlace($n['name'], $gaz);
    if ($at === null) { $natSkip++; continue; }
    $natNew++;
    $stations[] = [
        'kind'    => 'river',
        'id'      => 'pwl-' . $code,
        'name'    => $n['name'],
        'district'=> $at['district'],
        'basin'   => null,
        'lat'     => $at['lat'], 'lng' => $at['lng'],
        'status'  => wlStatus($n['level'], $n['alert'], $n['warning'], $n['danger']),
        'online'  => true,
        'level'   => $n['level'], 'alert' => $n['alert'],
        'warning' => $n['warning'], 'danger' => $n['danger'],
        'code'    => $code, 'source' => 'national',
        'state'   => portalState($at['state']),
        'updated' => $n['updated'],
    ];
}
```

**This pass must run after the national override**, not before. `$natUsed` is what it subtracts, and
that array is only filled by the override loop at `api.php:2256-2270`.

- [ ] **Step 7: Extend the counters**

```php
        'portalrf' => ['parsed' => count($prf), 'applied' => $prfUsed,
                       'clash'  => count($prfHit['clash']),
                       'placed' => $prfNew, 'unplaced' => $prfSkip],
        'national' => ['parsed' => count($nat), 'applied' => count($natUsed),
                       'placed' => $natNew, 'unplaced' => $natSkip,
                       'unmapped' => count($nat) - count($natUsed) - $natNew],
```

- [ ] **Step 8: Verify the placement**

Run:

```bash
php -l api.php
curl -sk 'https://flood-exp.test/api.php?force=1' -o /dev/null
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
echo json_encode($p["sources"]),"\n";
$k=[]; foreach($p["stations"] as $s) $k[$s["kind"]]++;
echo json_encode($k),"\n";'
```

Expected: about 96 rainfall placed and 29 unplaced, about 37 rivers placed and 1 unplaced, and river
plus rainfall counts near 471 against 338 before. **Assert ranges.**

Then run the district outlier sweep from `CLAUDE.md`, which is the sweep that found the shuffled
camera batch:

```bash
php -r '$p=json_decode(file_get_contents(".cache.json"),true);$g=[];
foreach($p["stations"] as $s){if(!$s["lat"]||!$s["lng"])continue;$g[$s["state"]."|".$s["district"]][]=$s;}
$m=function($a){sort($a);$n=count($a);return $n%2?$a[($n-1)/2]:($a[$n/2-1]+$a[$n/2])/2;};$o=[];
foreach($g as $k=>$r){if(count($r)<4)continue;$cl=$m(array_column($r,"lat"));$cn=$m(array_column($r,"lng"));
foreach($r as $s){$km=hypot($s["lat"]-$cl,($s["lng"]-$cn)*cos(deg2rad($cl)))*111;
if($km>25)$o[]=sprintf("%6.1f km  %-24s %-14s %s",$km,$k,$s["id"],$s["name"]);}}
rsort($o);echo implode("\n",$o),"\n";'
```

**Read the result as a shortlist to check by name, never as a list of faults.** A large district
reports real outliers: BUKIT FRASER is 27 km from the centre of Hulu Selangor and is correct.
**Any new `prf-` or `pwl-` station in that list is the thing to check.** A placement 80 km from its
own district is the shape the camera shuffle had, and it means a suffix matched the wrong gazetteer
row.

Also confirm every new station falls inside `BOX`, the coverage area:

```bash
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
foreach($p["stations"] as $s){ if(!str_starts_with($s["id"],"prf-")&&!str_starts_with($s["id"],"pwl-"))continue;
 if($s["lng"]<100.72||$s["lng"]>102.02||$s["lat"]>3.95||$s["lat"]<2.50) echo "OUTSIDE $s[id] $s[name] $s[lat],$s[lng]\n"; }
echo "checked\n";'
```

Expected: no `OUTSIDE` line.

- [ ] **Step 9: Commit**

```bash
git add api.php
git commit -F - <<'EOF'
Place the stations the portal alone knows about

About 133 new pins: 96 rainfall and 37 rivers. 22 of the rivers are the Kuala
Lumpur ones the SPHTN table never placed, which closes that gap completely.

Two rules place a station and nothing weaker: an equal name, or a suffix that
exactly one gazetteer name ends with. 83 place on an equal name and 50 on a
unique suffix. 30 rows place on neither, and they are counted rather than
pinned at a guessed coordinate. A coordinate invented here is worse than one
that can be shown to belong upstream.

The rivers need no new fetch. nationalUrls() already reads that table and $nat
already holds every row keyed by station code, so the rows that corrected
nothing are the new set.

Rivers already took the portal reading, with 75 of 107 carrying source national
today, so this half adds stations and changes no existing number.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 9: Seed the rainfall archive from the 7 day series

**Files:**
- Modify: `sources.php` — add `seriesUrl()` and `seriesParse()`
- Modify: `api.php` — add the history backfill drip
- Modify: `api.php:1067` — add `seriesParse()` assertions
- Test: `php api.php --selftest`, then a live drip

**Interfaces:**
- Consumes: `graphId` from Task 4 and Task 8, `portalOdo()` from Task 5
- Produces:
  - `seriesUrl(int $graphId): string`
  - `seriesParse(string $json): array` — a list of `[unix seconds, raw mm]`, ascending
  - A `histdone` row set in the `page` table, one per station already seeded

**`raw` is the disjoint 5 minute bucket. `clean` is not.** `clean` equals `chourly` on every record,
maximum error 0.00, so both name one rolling 60 minute total. Measured on a wet station over 860
records, twelve `raw` values reproduce `chourly` with a maximum error of 0.00, and `raw` summed from
midnight reproduces `cdaily`.

**Test this identity on a station with rain in the window.** An earlier pass ran it on a station
holding 15 non-zero buckets out of 1,815 and `clean` passed, because twelve zeros sum to a zero. A dry
station cannot tell a rolling window from a disjoint one.

**Disjoint buckets add up.** That is the whole reason this source solves what SPHTN cannot, and it is
what lets a backfill build a running total for the days before this app first saw the station.

- [ ] **Step 1: Write the failing test**

```php
    echo "\nseriesParse():\n";
    $sJson = '[{"tarikh":"2026-08-14 10:00:00","raw":"2.5","clean":"7.5","chourly":"7.5"},'
           . '{"tarikh":"2026-08-14 10:05:00","raw":"0.0","clean":"7.5","chourly":"7.5"},'
           . '{"tarikh":"2026-08-14 10:10:00","raw":"1.0","clean":"8.5","chourly":"8.5"}]';
    $sr = seriesParse($sJson);
    $ok('every record is read',        count($sr) === 3);
    $ok('the stamp becomes unix',      $sr[0][0] === strtotime('2026-08-14 10:00:00 +0800'));
    /* raw, never clean. clean equals chourly on every record, so both name one ROLLING 60 minute
       total. Summing a rolling window counts the same rain twelve times. */
    $ok('the value is raw',            $sr[0][1] === 2.5);
    $ok('a zero bucket is kept',       $sr[1][1] === 0.0);
    $ok('the series is ascending',     $sr[0][0] < $sr[1][0] && $sr[1][0] < $sr[2][0]);
    $ok('bad json yields nothing',     seriesParse('not json') === []);
    $ok('an empty body yields nothing', seriesParse('') === []);
```

**Confirm the field names against the live endpoint before writing the fixture.** Run:

```bash
curl -sk -A 'flood-exp/1.0 (+https://github.com/illusionikx/selangor-flood-tracker)' \
 'https://publicinfobanjir.water.gov.my/wp-content/themes/enlighten/query/getrainfalllast7days.php?station=27398' \
 | php -r '$j=json_decode(stream_get_contents(STDIN),true);
   echo count($j), " records\n"; echo json_encode($j[0] ?? null), "\n";'
```

Correct the fixture's key names to whatever that prints. **Do not guess a field name into a test.**

- [ ] **Step 2: Run the test to verify it fails**

Run: `php api.php --selftest`
Expected: a PHP fatal error, `Call to undefined function seriesParse()`.

- [ ] **Step 3: Write the parser**

Add to `sources.php`, after `gazParse()`. Correct the key names from Step 1 if they differ.

```php
const SERIES = 'https://publicinfobanjir.water.gov.my/wp-content/themes/enlighten/query/getrainfalllast7days.php';

function seriesUrl(int $graphId): string {
    return SERIES . '?' . http_build_query(['station' => $graphId]);
}

/* 7 days of 5 minute buckets, as [unix seconds, mm].
 *
 * `raw` AND NOTHING ELSE. `clean` equals `chourly` on every record with a maximum error of 0.00, so
 * both name one ROLLING 60 minute total, and summing a rolling window counts the same rain twelve
 * times over. `c15min` is the rolling 15 minutes. Measured on a wet station over 860 records,
 * twelve `raw` values reproduce `chourly` exactly, and `raw` summed from midnight reproduces
 * `cdaily`.
 *
 * SCORE ANY CHECK OF THIS ON A STATION WITH RAIN IN THE WINDOW. An earlier pass ran it on a station
 * holding 15 non-zero buckets out of 1,815 and `clean` passed, because twelve zeros sum to a zero.
 *
 * Stamps are Malaysian wall clock with no offset, the same as every other reading here.
 */
function seriesParse(string $json): array {
    $rows = json_decode($json, true);
    if (!is_array($rows)) return [];
    $out = [];
    foreach ($rows as $r) {
        $ts = strtotime(($r['tarikh'] ?? '') . ' +0800');
        if (!$ts) continue;
        $out[] = [$ts, (float)($r['raw'] ?? 0)];
    }
    usort($out, fn($a, $b) => $a[0] <=> $b[0]);
    return $out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `php api.php --selftest`
Expected: every line in the `seriesParse()` block reads `ok`.

- [ ] **Step 5: Add the drip**

**The four constants go at the top of `api.php`, beside the `GAZ_` set from Task 7.** A PHP `const`
cannot sit inside a conditional block.

```php
const HIST_FILL  = 5;                             // stations per refresh
const HIST_EVERY = 600;
const HIST_STAMP = __DIR__ . '/.hist.stamp';
const HIST_KEY   = 'histdone:';
```

**The counting happens before the payload and the fetching after it**, the same split the gazetteer
drip uses and for the same reason. Put this beside the `$gazAsk` block from Task 7:

```php
/* What the archive already seeded and which stations are next, counted before the payload goes out.
   `$graphIds` is the map the two placement passes filled — the station's own `graphId` key is
   unset before this point, which is why that map exists. */
$histDone = [];
foreach ($stored as $su => $sr) {
    if (str_starts_with($su, HIST_KEY)) $histDone[substr($su, strlen(HIST_KEY))] = 1;
}
$histTodo = [];
foreach ($graphIds as $id => $g) {
    if (isset($histDone[$id])) continue;
    $histTodo[$id] = $g;
    if (count($histTodo) >= HIST_FILL) break;
}
```

Then at the end of the refresh path, after the gazetteer fetch from Task 7 and still inside the lock:

```php
/* The history seed. One request per station, ONE TIME EVER, dripped exactly like the gazetteer.
   A full per-station fetch on every refresh costs 28 MB, which is about 2.7 GB each day at one
   government host. That is the camera stampede in slow motion, and it is the thing this app has a
   rule against. At 5 stations per refresh the 425 stations complete in about 21 hours.
   The seed is what makes a 24 hour and a 72 hour window answer on the FIRST poll rather than after
   two days of ordinary polling. */
[$histOk] = forceAllowed($now, is_file(HIST_STAMP) ? filemtime(HIST_STAMP) : null, HIST_EVERY);
if ($histOk) {
    $todo = $histTodo;
    if ($todo) {
        touch(HIST_STAMP);
        $urls = [];
        foreach ($todo as $id => $g) $urls[$id] = seriesUrl($g);
        $got = fetchAll($urls, 3, false);
        $ins2 = $db->prepare('INSERT OR IGNORE INTO level (station, ts, level) VALUES (?, ?, ?)');
        $db->beginTransaction();
        foreach ($todo as $id => $g) {
            $pts = seriesParse($got[$urls[$id]] ?? '');
            /* Disjoint buckets add up, so a running total is a running sum. This is the ONE place
               in this app that adds rainfall readings together, and it is allowed because these
               buckets do not overlap. Everything else takes a difference — see accWindow(). */
            $run = 0.0;
            foreach ($pts as [$ts2, $mm]) {
                $run = round($run + $mm, 1);
                $ins2->execute([$id . '#c', $ts2, $run]);
            }
            // Stamped whether or not it answered, the same rule pageRow() states.
            $keep->execute([HIST_KEY . $id, $now, '1']);
        }
        $db->commit();
    }
}
```

**The seeded total and the live total must join up.** The seed writes a total that starts at zero
seven days ago. `portalOdo()` continues from the last stored sample, which is the last seeded one, so
the join happens by construction. **Verify it in Step 6 rather than trusting it.**

Publish the counter, beside the `gaz` one:

```php
        // `pending` reaching 0 is the seed finishing, which is success — see watch.php in Task 10.
        'hist' => ['seeded' => count($histDone), 'pending' => count($histTodo)],
```

- [ ] **Step 6: Verify the seed and the join**

Run a forced refresh, then check one seeded station:

```bash
php -r '$d=new PDO("sqlite:.history.db");
$s=$d->query("SELECT station FROM level WHERE station LIKE \"%#c\" GROUP BY station
              ORDER BY COUNT(*) DESC LIMIT 1")->fetchColumn();
echo "$s\n";
$q=$d->prepare("SELECT ts, level FROM level WHERE station=? ORDER BY ts");
$q->execute([$s]); $r=$q->fetchAll(PDO::FETCH_NUM);
printf("%d samples, %.1f h deep, %.1f to %.1f mm\n", count($r),
  ($r[count($r)-1][0]-$r[0][0])/3600, $r[0][1], $r[count($r)-1][1]);
$back=0; for($i=1;$i<count($r);$i++) if($r[$i][1] < $r[$i-1][1]) $back++;
echo "backwards steps: $back  (must be 0)\n";'
```

Expected: about 1,815 samples, about 168 hours deep, a total that only climbs, and **zero backwards
steps**. A backwards step means the seed and the live total disagree. `accWindow()` then answers null on
every window for that station.

Then confirm the windows answer:

```bash
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
$r=array_filter($p["stations"],fn($s)=>$s["kind"]==="rainfall");
$w=["whole"=>0,"short"=>0,"none"=>0];
foreach($r as $s){ $a=$s["acc"]["h72"] ?? null;
  $w[$a===null?"none":($a[1]===2?"short":"whole")]++; }
echo "h72: ", json_encode($w), "\n";'
```

Expected: the `whole` count climbs as the drip progresses. A seeded station answers 72 hours whole
straight away, which is the point of the seed.

- [ ] **Step 7: Commit**

```bash
git add sources.php api.php
git commit -F - <<'EOF'
Seed the rainfall archive from the portal's 7 day series

One request per station, one time ever, dripped five per refresh behind a stamp
file. A full per-station fetch on every refresh costs 28 MB, which is about 2.7
GB each day at one government host, and that is the camera stampede in slow
motion. At five per refresh the 425 stations complete in about 21 hours.

The seed reads raw and nothing else. clean equals chourly on every record with
a maximum error of 0.00, so both name one rolling 60 minute total, and summing
a rolling window counts the same rain twelve times. Twelve raw values reproduce
chourly exactly on a wet station over 860 records, and raw summed from midnight
reproduces the table's own midnight cell.

Score any check of that on a station with rain in the window. An earlier pass
ran it on a station holding 15 non-zero buckets out of 1,815 and clean passed,
because twelve zeros sum to a zero.

Summing here is allowed because these buckets do not overlap. It is the one
place in this app that adds rainfall readings together, and every other window
still takes a difference.

A seeded station answers 24 and 72 hours whole on the first poll rather than
after two days.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 10: The verification sweeps and the documentation

**Files:**
- Modify: `CLAUDE.md` — the source table, the file table, the gotcha list and the Verify block
- Modify: `docs/FEATURES.md` — one appended entry
- Modify: `watch.php` — the new counters that mean a fault
- Test: every sweep in this task, plus the three runnable checks

**Interfaces:**
- Consumes: everything above
- Produces: the five verification sweeps the spec names, in `CLAUDE.md` where the next reader finds
  them

- [ ] **Step 1: Add the station accounting sweep to `CLAUDE.md`**

In the Verify block, after the existing source-counter line:

```bash
# The portal migration's accounting. A fall in `applied` means a join broke. A rise in the stations
# left on an old feed means the portal dropped rows. ASSERT A RANGE, NEVER AN EQUALITY — two fetches
# an hour apart returned 311 rainfall rows and then 310, and the Selangor page returned 239 on
# 15 August. A station or two of drift is upstream churn, not a fault.
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
$s=$p["sources"]; echo json_encode(["portalrf"=>$s["portalrf"],"national"=>$s["national"],
  "gaz"=>$s["gaz"],"hist"=>$s["hist"]]),"\n";
$k=[]; foreach($p["stations"] as $x) $k[$x["kind"]."/".$x["source"]]++;
ksort($k); echo json_encode($k),"\n";'
```

- [ ] **Step 2: Add the window agreement sweep**

```bash
# Does the portal's 3 hour window agree with the 3 hour total Selangor publishes for itself? This is
# the sweep that condemned accHours(): the old sum was out by more than 5 mm on 14 of 176 stations,
# worst 60 mm. The portal figure must beat that by a wide margin.
# SCORE IT ON STATIONS WITH RAIN IN THE WINDOW. A dry station agrees with everything, and that is how
# a rolling field passed for a disjoint one while this was designed.
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
$d=[]; foreach($p["stations"] as $s){ if($s["kind"]!=="rainfall")continue;
 $a=$s["acc"]["h3"] ?? null; if(!$a || $a[0]<=0) continue;   // wet only
 if(($a[1]??0)===0) continue;                                 // the feed answered, nothing to score
 $d[]=$a[0]; }
sort($d); $n=count($d);
printf("%d wet derived 3h windows, median %.1f mm, p90 %.1f mm\n", $n,
  $n?$d[(int)($n*.5)]:0, $n?$d[(int)($n*.9)]:0);'
```

- [ ] **Step 3: Add the no-lost-reading sweep**

```bash
# No station may lose a reading to this migration. The count of rainfall and river stations with a
# null reading must not rise. This is verification rule 5 in the spec.
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
$n=0; $t=0; foreach($p["stations"] as $s){ if(!in_array($s["kind"],["rainfall","river"]))continue; $t++;
 $v = $s["kind"]==="rainfall" ? ($s["hourly"]??null) : ($s["level"]??null); if($v===null)$n++; }
echo "$n of $t river and rainfall stations hold no reading\n";'
```

- [ ] **Step 4: Add the stale-key check**

```bash
# The portal pages must reach sources.stale when they fail, and the map must fall back rather than
# blank. Expire them, break the URL, force a refresh, and read the key back.
php -r '$d=new PDO("sqlite:.history.db"); $d->exec("UPDATE page SET ts=0");'
curl -sk 'https://flood-exp.test/api.php?force=1' \
  | php -r 'echo json_encode(json_decode(stream_get_contents(STDIN),true)["sources"]["stale"]),"\n";'
```

- [ ] **Step 5: Teach `watch.php` the new counters**

`watch.php` reports a change of state, never a state. Add the two counters whose zero means a fault:

- `sources.portalrf.parsed` at 0 means the rainfall table moved or the hidden inputs stopped working
- `sources.portalrf.applied` at 0 means every join broke

**Do not add `gaz.pending` or `hist.pending`.** Both reach 0 when the backfill finishes, which is the
healthy end state, and an alarm that fires on success is the cry-wolf failure the alert design
standard names. This mirrors the existing rule that `metwarn.parsed` reads 0 on a calm day.

Then run the existing `watch.php` check from `CLAUDE.md` and confirm the exit codes are still
`0, 1, 1, 0`, plus a new case:

```bash
curl -sk https://flood-exp.test/api.php \
  | php -r '$p=json_decode(stream_get_contents(STDIN),true);$p["sources"]["portalrf"]["parsed"]=0;echo json_encode($p);' \
  | php watch.php; echo "portalrf 0 -> $?  (must be 1)"
curl -sk https://flood-exp.test/api.php \
  | php -r '$p=json_decode(stream_get_contents(STDIN),true);$p["sources"]["gaz"]["pending"]=0;echo json_encode($p);' \
  | php watch.php; echo "gaz done  -> $?  (must be 0)"
```

- [ ] **Step 6: Update `CLAUDE.md`**

- **The source table** gains the portal rainfall endpoint and the station search. The header count
  changes: this app now reaches seven upstream hosts, not six, unless the station search counts under
  the host already listed. **It is the same host**, so the count stays six and the table gains two
  rows under it.
- **The file table** entry for `sources.php` gains the portal parsers.
- **The `## api.php` section** gains the two drips, their stamp files and their tables.
- **The gotcha list** gains three entries:
  1. The rainfall table has no opening `<tr>` on a data row, `crawl()` reads nothing from it, and the
     repair is to split on the closing tag. Include the measured numbers.
  2. `pageHasData()`'s `<tr` test passes on that page's header and on the empty form page alike, so
     those keys test `data-th='No'` instead.
  3. `raw` is the disjoint bucket and `clean` is not, and a dry station cannot tell the two apart.
- **The Verify block** gains the four sweeps from Steps 1 to 4.
- The accumulation gotcha was already rewritten in Task 6. Check it reads correctly beside the new
  entries.

Run `python "C:/Users/illus/.claude/ste-lint.py" < CLAUDE.md` and keep the count at or below where
it started.

- [ ] **Step 7: Append to `docs/FEATURES.md`**

One entry, covering what this does and **why**, including the trade-offs accepted and what was
deliberately not built:

- what: the portal becomes the preferred rainfall and river source, the map grows from 338 to about
  471 river and rainfall stations, and every rainfall window becomes exact
- why: Kuala Lumpur publishes no running total, its fallback was a sum of rolling hours that was
  wrong by up to 60 mm during heavy rain, and its river coverage was 26 of 48
- the trade accepted: about 178 rainfall stations change where their number comes from, so a
  disagreement between two feeds becomes visible on a station somebody watches
- deliberately not built: per-station rainfall thresholds from the portal, which measured identical
  to the constants already in use. Near-name matching, with 17 candidates and no evidence behind
  any. `cyearly` as an odometer, which measured flat. **The three official notice feeds**, which
  each need the alert design standard on their own and all held no rows when measured.

- [ ] **Step 8: Run every runnable check**

```bash
php -l api.php && php -l sources.php
php api.php --selftest
php shots-test.php
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --ignore-certificate-errors --virtual-time-budget=15000 --dump-dom \
  https://flood-exp.test/heat-test.html | perl -0777 -ne 'print $1 if /<pre id="out">([^<]*)</s'
```

Expected: all three runnable checks green, every module parses, and `heat-test.html` reads `PASS`.
**`heat-test.html` matters here**: this task adds about 133 stations, and `thinHeat()` spacing comes
off the station geometry. Re-run the spacing sweep from `CLAUDE.md` and confirm the two
rows have not pulled apart. If they have, `FEATHER` needs to become a per-layer option.

- [ ] **Step 9: Commit**

```bash
git add CLAUDE.md docs/FEATURES.md watch.php
git commit -F - <<'EOF'
Document the portal source, and add the sweeps that guard it

Four sweeps in the Verify block: the station accounting, the 3 hour window
agreement, the no-lost-reading count and the stale-key path. Every one of them
asserts a range rather than an equality, because two fetches an hour apart
returned 311 rainfall rows and then 310.

Three new gotchas. The rainfall table carries no opening tr on a data row and
crawl() reads nothing from it. pageHasData()'s tr test passes on that page's
header and on the empty form page alike, so those keys test for a data-th
attribute instead. raw is the disjoint bucket and clean is not, and a dry
station cannot tell the two apart.

watch.php learns the two counters whose zero is a fault. It does not learn the
backfill counters: both reach zero when the work finishes, and an alarm that
fires on success is the cry-wolf failure the alert design standard names.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## What this plan does not build

- **The three official notice feeds.** JPS publishes a flood alert, a weather alert and a media
  statement. A reader asked for all three on 2026-08-14 and agreed to defer them. Each needs the
  alert design standard on its own, all three pages held no rows when measured, and a parser that
  never meets one real row cannot tell a quiet feed from a moved layout. The reminder sits in
  `CLAUDE.md` beside the alert design standard convention.
- **Per-station rainfall thresholds from the portal.** Six stations across three states all return
  10, 30, 60 and 90. Those are constants, and `RAIN_STOPS` already hardcodes 10, 30 and 60.
- **Near-name matching.** 17 candidates, no evidence behind any of them.
- **`cyearly` as an odometer.** Measured flat at 766.5 across a window where 12 mm fell.
- **Dropping the JPS Selangor rainfall detail fetch.** `spLight`, `spModerate`, `spHeavy` and
  `spVeryHeavy` vary per station and exist nowhere else. That fetch stays.
