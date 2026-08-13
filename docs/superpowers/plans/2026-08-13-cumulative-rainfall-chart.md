# Cumulative Rainfall Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw rain totals for five nested windows — 1 hour, 3 hours, today, 24 hours, 72 hours — as horizontal bars under the rain area graph on a station card and in the table popover.

**Architecture:** `api.php` computes all five totals and publishes them as one `acc` blob per rainfall station. Three come straight off a JPS feed. Two come from differencing `cumulativeRainfall`, a year-to-date odometer stored as its own series in the existing `level` table. The client draws what it is handed and calculates nothing.

**Tech Stack:** PHP 8 with pdo_sqlite, ES modules with no build step, plain CSS. No new dependency on either side.

**Spec:** `docs/superpowers/specs/2026-08-12-cumulative-rainfall-chart-design.md`

## Global Constraints

- **No threshold marks.** The chart answers how much rain fell and never how dangerous it is. The spec records three rejected sources for a mark. Do not add one.
- **No new alert.** This moves no count, no icon badge, no ticker item and no toast.
- **The server scores everything.** Never re-derive a total or a status in the browser.
- **An asterisk marks any value this app worked out.** None on a value read from a feed.
- **A window with no honest answer publishes `null`.** Never a zero, never a short sum.
- **Prose rules:** active voice, one instruction per sentence, 20 words maximum, no semicolons, no contractions, American spelling. Check any file you write with `python "C:/Users/illus/.claude/ste-lint.py" < FILE`.
- **`?v=` bump:** touching any file in `css/` requires bumping that file's `?v=` in `index.html`.
- **Commit style:** the subject states the finding, not the change. See `git log`.

## File Structure

| file | change | responsibility |
|---|---|---|
| `api.php` | modify | `ACC_READ` constant, `accWindow()`, `accHours()`, selftest block, odometer load, `acc` build |
| `js/config.js` | modify | `ACC_ROWS` — the five window keys and their labels |
| `js/popup.js` | modify | `rainAcc()`, the one new exported template; one call site |
| `js/table.js` | modify | one call site, one import addition |
| `css/base.css` | modify | `.acc` block, shared by both surfaces |
| `index.html` | modify | bump `css/base.css?v=` |
| `docs/FEATURES.md` | modify | what was built and why |
| `CLAUDE.md` | modify | the file table, the data-source notes and one new gotcha |

---

### Task 1: The two accumulation functions and their checks

Pure arithmetic with no upstream call, so `php api.php --selftest` is the whole test cycle.

**Files:**
- Modify: `api.php` — add `ACC_READ` beside `READ`/`RETAIN` (near line 205), add two functions above the selftest block (near line 940), add assertions inside the selftest block

**Interfaces:**
- Produces: `accWindow(array $odo, int $now, int $win): ?array` returning `[mm, spanHours]` or `null`. `accHours(array $points, int $now, int $hours): ?float` returning the sum or `null`. Both consumed by Task 2.

- [ ] **Step 1: Add the constant**

In `api.php`, directly under `const RETAIN = 30 * 86400;`:

```php
/* Seconds of odometer history loaded per poll. The longest window is 72 hours and a baseline has to
   sit behind it, so this carries 8 hours of margin. A poll that arrives late still finds a sample
   older than the far end of the window rather than reporting nothing. */
const ACC_READ = 80 * 3600;
```

- [ ] **Step 2: Write the two functions**

In `api.php`, immediately above the comment block that introduces `--selftest` (near line 939):

```php
/* Rain over a window, as the difference of two odometer readings.
 *
 * `cumulativeRainfall` only ever climbs, so the rain between two samples is one subtraction. That is
 * the whole reason this reads an odometer instead of adding up `hourly` buckets. A sum loses the
 * rain in every gap and reports a small number with nothing to say it is short — the archive on a
 * development box has held 9 of the last 24 clock hours, which a sum would render as a dry day. A
 * difference cannot lose rain. A missed poll widens the window instead, and the widening is
 * measurable, so this returns the span it actually covered and the card prints it.
 *
 * $odo must be ascending by timestamp, which is what the `ORDER BY ts` on the load gives.
 *
 * Returns [mm, spanHours], or null where the archive cannot answer:
 *   - nothing stored for this station yet
 *   - no sample at or before the far end of the window
 *   - the odometer went backwards, which is the 1 January reset
 *   - both ends landed on one sample, so there is no span to measure
 */
function accWindow(array $odo, int $now, int $win): ?array {
    if (!$odo) return null;
    $last = end($odo);
    $cut  = $now - $win;
    $base = null;
    foreach ($odo as $p) {
        if ($p[0] > $cut) break;
        $base = $p;
    }
    if ($base === null || $base[0] === $last[0]) return null;
    if ($last[1] < $base[1]) return null;                 // the odometer reset
    return [round($last[1] - $base[1], 1), round(($last[0] - $base[0]) / 3600, 1)];
}

/* Rain over the last N whole clock hours, added from one reading per hour.
 *
 * The fallback for a feed that publishes no 3 hour total of its own. `hourlyRainfall` is a ROLLING
 * hour, so one reading per clock hour is the most that can be added without counting the same rain
 * twice. That is the same rule RAIN_BUCKET states for the graph.
 *
 * Null unless every hour in the window carries a reading. A short sum is indistinguishable from
 * light rain, and this app must never report a dry hour it did not see.
 */
function accHours(array $points, int $now, int $hours): ?float {
    $bucket = [];
    foreach ($points as [$ts, $v]) $bucket[intdiv($ts, 3600)] = $v;   // ascending, so the newest wins
    $top = intdiv($now, 3600);
    $sum = 0.0;
    for ($i = 0; $i < $hours; $i++) {
        if (!isset($bucket[$top - $i])) return null;
        $sum += $bucket[$top - $i];
    }
    return round($sum, 1);
}
```

- [ ] **Step 3: Write the failing assertions**

Inside the `--selftest` block in `api.php`, after the `stationUpdated():` group and before the block prints its total, add:

```php
    echo "\naccWindow():\n";
    $odo = [[$now - 80 * 3600, 1000.0], [$now - 72 * 3600, 1010.0],
            [$now - 24 * 3600, 1050.0], [$now, 1080.0]];
    $ok('24h is the difference over 24h',   accWindow($odo, $now, 24 * 3600) === [30.0, 24.0]);
    $ok('72h is the difference over 72h',   accWindow($odo, $now, 72 * 3600) === [70.0, 72.0]);
    /* The point of the odometer. The baseline is 30 hours back rather than 24, and the answer says
       so instead of claiming a 24 hour figure it does not have. */
    $ok('a stale baseline reports its real span',
        accWindow([[$now - 30 * 3600, 1000.0], [$now, 1012.0]], $now, 24 * 3600) === [12.0, 30.0]);
    $ok('no baseline in range gives null',
        accWindow([[$now - 2 * 3600, 1000.0], [$now, 1005.0]], $now, 24 * 3600) === null);
    /* A year-to-date total resets on 1 January. Publishing the negative would draw a bar backwards
       and poison a reader's idea of a wet week. */
    $ok('a reset gives null, never a negative',
        accWindow([[$now - 25 * 3600, 2400.0], [$now, 12.0]], $now, 24 * 3600) === null);
    $ok('one sample cannot answer',
        accWindow([[$now - 25 * 3600, 1000.0]], $now, 24 * 3600) === null);
    $ok('an empty archive gives null',      accWindow([], $now, 24 * 3600) === null);
    /* A genuinely dry day is 0 mm and must not be confused with an unanswerable window. The chart
       draws a zero bar for one and an em dash for the other. */
    $ok('a dry window is zero, not null',
        accWindow([[$now - 25 * 3600, 1000.0], [$now, 1000.0]], $now, 24 * 3600) === [0.0, 25.0]);

    echo "\naccHours():\n";
    $h3 = [[$now - 2 * 3600, 4.0], [$now - 3600, 6.0], [$now, 2.0]];
    $ok('three whole hours add up',         accHours($h3, $now, 3) === 12.0);
    /* The reason KL's 3 hour bar can go blank. Two hours of rain plus one hour of silence is not a
       3 hour total, and reporting it as one would call a gap dry. */
    $ok('a missing hour gives null',
        accHours([[$now - 2 * 3600, 4.0], [$now, 2.0]], $now, 3) === null);
    $ok('an empty history gives null',      accHours([], $now, 3) === null);
    $ok('the newest reading in an hour wins',
        accHours([[$now - 2 * 3600, 4.0], [$now - 3600, 6.0], [$now - 3000, 9.0], [$now, 2.0]],
                 $now, 3) === 15.0);
    $ok('three dry hours are zero, not null',
        accHours([[$now - 2 * 3600, 0.0], [$now - 3600, 0.0], [$now, 0.0]], $now, 3) === 0.0);
```

- [ ] **Step 4: Run the check**

```bash
php -l api.php && php api.php --selftest
```

Expected: the two new groups print, every line reads `ok`, and the block's final total reports no failures.

- [ ] **Step 5: Prove the assertions can fail**

Temporarily change `if ($last[1] < $base[1]) return null;` to `if (false) return null;` and run `php api.php --selftest` again.

Expected: `FAIL a reset gives null, never a negative`. Restore the line and confirm the check is green again.

- [ ] **Step 6: Commit**

```bash
git add api.php
git commit -m "$(cat <<'EOF'
A sum of hourly buckets renders a 15 hour gap as a dry day

accWindow() reads rain as the difference of two odometer readings.
cumulativeRainfall only climbs, so a missed poll widens the window rather
than losing the rain inside it, and the widening is measurable. The
function returns the span it actually covered so the card can print 26
hours instead of claiming 24.

accHours() is the fallback for a feed that publishes no 3 hour total. It
refuses to answer unless every clock hour in the window carries a
reading, because a short sum reads as light rain.

Both are arithmetic on a few integers, so --selftest covers them offline.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The payload carries `acc`

**Files:**
- Modify: `api.php` — the Selangor rainfall build (near line 1837), the history bulk load (near line 1827), the rainfall history loop (near line 1990)

**Interfaces:**
- Consumes: `accWindow()` and `accHours()` from Task 1.
- Produces: `s.acc` on every rainfall station, an object with keys `h1`, `h3`, `day`, `h24`, `h72` in that order. Each value is `[mm, derived, spanHours]` or `null`. `derived` is `0` or `1`. `spanHours` is a float on an odometer window and `null` otherwise. Consumed by Task 3.

- [ ] **Step 1: Read the two fields the feed already sends**

In `api.php`, in the Selangor rainfall station build, replace:

```php
        'hourly'   => $d['hourlyRainfall']     ?? null,
        'daily'    => $d['dailyRainfall']      ?? null,
```

with:

```php
        'hourly'   => $d['hourlyRainfall']     ?? null,
        // Both are already in the detail response and were both discarded until now. `hour3` saves
        // adding up clock hours, and `cumulative` is a year-to-date odometer — see accWindow().
        // Neither reaches the browser: the acc block below reads them and then drops them.
        'hour3'    => $d['threeHoursRainfall'] ?? null,
        'cumulative' => $d['cumulativeRainfall'] ?? null,
        'daily'    => $d['dailyRainfall']      ?? null,
```

- [ ] **Step 2: Load the odometer series**

In `api.php`, directly after the `$hist` bulk load loop and before `$samples = [];`:

```php
/* The odometer series, on its own clock. `$hist` loads READ, which is 24 hours and right for a
   trend, and short for a 72 hour total. So the cumulative keys take a second read at ACC_READ.
   The `#c` suffix keeps them in the one table with no schema change, and RETAIN prunes them with
   everything else. No station id ends in `#c`, so these rows can never be mistaken for a reading. */
$odo = [];
foreach ($db->query('SELECT station, ts, level FROM level WHERE station LIKE \'%#c\' AND ts >= '
                    . ($now - ACC_READ) . ' ORDER BY ts') as $r) {
    $odo[$r['station']][] = [(int)$r['ts'], (float)$r['level']];
}
```

- [ ] **Step 3: Build `acc` inside the rainfall history loop**

In `api.php`, replace the whole body of the rainfall history loop:

```php
foreach ($stations as &$s) {
    if ($s['kind'] !== 'rainfall' || !isset($s['hourly'])) continue;
    $key = $s['id'];
    $ts  = readTs($s['updated'] ?? null, $now);
    $s['history'] = sparkPoints(
        array_merge($hist[$key] ?? [], [[$ts, (float)$s['hourly']]]), $now, RAIN_BUCKET,
        false, fn($v) => rainStatus($v));
    $samples[$key] = [$ts, (float)$s['hourly']];
}
unset($s);
```

with:

```php
foreach ($stations as &$s) {
    if ($s['kind'] !== 'rainfall' || !isset($s['hourly'])) continue;
    $key = $s['id'];
    $ts  = readTs($s['updated'] ?? null, $now);
    // This poll's own reading is not in the table yet, so it is appended to every series read here.
    $pts = array_merge($hist[$key] ?? [], [[$ts, (float)$s['hourly']]]);
    $s['history'] = sparkPoints($pts, $now, RAIN_BUCKET, false, fn($v) => rainStatus($v));
    $samples[$key] = [$ts, (float)$s['hourly']];

    /* Five nested windows, computed here because the client works nothing out. Each entry is
       [mm, derived, spanHours], and null where nothing can answer honestly. `derived` marks a total
       this app worked out rather than read off a feed, and the card prints an asterisk on it.
       The five keys are declared up front so the order is fixed whatever any of them resolves to. */
    $acc = ['h1' => null, 'h3' => null, 'day' => null, 'h24' => null, 'h72' => null];
    $acc['h1'] = [round((float)$s['hourly'], 1), 0, null];
    if (($s['daily'] ?? null) !== null) $acc['day'] = [round((float)$s['daily'], 1), 0, null];

    // Selangor publishes a 3 hour total. KL publishes none, so those 37 stations add clock hours
    // and go blank rather than report a short sum.
    if (($s['hour3'] ?? null) !== null) {
        $acc['h3'] = [round((float)$s['hour3'], 1), 0, null];
    } elseif (($sum = accHours($pts, $now, 3)) !== null) {
        $acc['h3'] = [$sum, 1, null];
    }

    // 24 and 72 hours need the odometer, which only Selangor publishes.
    if (($s['cumulative'] ?? null) !== null) {
        $series = array_merge($odo[$key . '#c'] ?? [], [[$ts, (float)$s['cumulative']]]);
        foreach (['h24' => 86400, 'h72' => 259200] as $k => $win) {
            if (($w = accWindow($series, $now, $win)) !== null) $acc[$k] = [$w[0], 1, $w[1]];
        }
        $samples[$key . '#c'] = [$ts, (float)$s['cumulative']];
    }

    $s['acc'] = $acc;
    unset($s['hour3'], $s['cumulative']);   // read here, never sent to a browser
}
unset($s);
```

- [ ] **Step 4: Lint and rebuild the payload**

```bash
php -l api.php && php api.php --selftest > /dev/null && echo "selftest green"
php api.php > /dev/null && echo "payload rebuilt"
```

Expected: no syntax error, selftest green, payload written.

- [ ] **Step 5: Inspect what landed**

```bash
php -r '
$p = json_decode(file_get_contents(".cache.json"), true);
$n = $has = 0; $leak = [];
foreach ($p["stations"] as $s) {
  if ($s["kind"] !== "rainfall") continue;
  $n++;
  if (isset($s["acc"])) $has++;
  foreach (["hour3", "cumulative"] as $k) if (array_key_exists($k, $s)) $leak[$k] = true;
}
echo "rainfall $n, with acc $has, leaked fields: ", $leak ? implode(",", array_keys($leak)) : "none", "\n";
foreach ($p["stations"] as $s) {
  if ($s["kind"] === "rainfall" && isset($s["acc"])) {
    echo $s["source"], " ", $s["id"], " ", json_encode($s["acc"]), "\n";
    if (!isset($first[$s["source"]])) { $first[$s["source"]] = 1; if (count($first) === 2) break; }
  }
}'
```

Expected: every rainfall station carries `acc`, no `hour3` or `cumulative` leaked into the payload, `h1` and `day` hold numbers, `h24` and `h72` are `null` on this first run because the `#c` series starts empty.

- [ ] **Step 6: Confirm the odometer is being stored**

```bash
php -r '
$db = new PDO("sqlite:.history.db");
$r = $db->query("SELECT COUNT(*) n, COUNT(DISTINCT station) s FROM level WHERE station LIKE \"%#c\"")->fetch();
echo "odometer rows {$r["n"]} across {$r["s"]} stations\n";'
```

Expected: about 193 rows across 193 stations after one poll. **`h24` and `h72` stay `null` for 24 and 72 hours** while the series fills. `cumulativeRainfall` has never been sampled and cannot be backfilled, so this wait is unavoidable.

- [ ] **Step 7: Commit**

```bash
git add api.php
git commit -m "$(cat <<'EOF'
Three of the five totals were in the feed all along and nobody read them

The Selangor detail endpoint publishes threeHoursRainfall and
cumulativeRainfall beside the hourlyRainfall this app already reads. Both
were discarded on every poll since the proxy was written.

So the 3 hour total is now a field rather than a calculation, and 24 and
72 hours are a difference of two cumulativeRainfall samples. Those ride
in the level table under a `#c` suffix, which needs no schema change and
lets RETAIN prune them with everything else.

KL publishes neither, so its 37 stations add clock hours for 3 hours and
answer nothing for 24 and 72. Both feeds mark a worked-out total derived.

The odometer series starts empty today and cannot be backfilled, so the
two long windows report null until the archive reaches back that far.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The chart

**Files:**
- Modify: `js/config.js` — add `ACC_ROWS` at the end
- Modify: `js/popup.js` — import `ACC_ROWS`, add `rainAcc()` after `rainBars()`
- Modify: `css/base.css` — add the `.acc` block after the `.spark` rules
- Modify: `index.html` — bump `css/base.css?v=`

**Interfaces:**
- Consumes: `s.acc` from Task 2.
- Produces: `rainAcc(acc)` exported from `js/popup.js`, returning an HTML string or `''`. `ACC_ROWS` exported from `js/config.js` as an array of `[key, label]` pairs. Both consumed by Task 4.

- [ ] **Step 1: Add the row table**

At the end of `js/config.js`:

```js
/* The five windows of the rainfall accumulation chart, in the order they are drawn.
   Each window contains the one above it, so the bars normally grow down the list. There is one
   exception and it is real: near midnight "Today" is younger than "3 hours", because at 01:00 today
   holds one hour of rain and the 3 hour window reaches back into yesterday. The dip stays. */
export const ACC_ROWS = [
  ['h1',  '1 hour'],
  ['h3',  '3 hours'],
  ['day', 'Today'],
  ['h24', '24 hours'],
  ['h72', '72 hours'],
];
```

- [ ] **Step 2: Import it**

In `js/popup.js`, change the first import to add `ACC_ROWS`:

```js
import { KINDS, SOURCES, SPARK_H, NO_INFO, ALERT_TITLE, RIVER_COLOR, RAIN_COLOR,
         GAUGE_COLOR, RAIN_STOPS, NEAR_MAX_KM, camSrc, WEATHER, MET_NAME,
         ACC_ROWS } from './config.js';
```

- [ ] **Step 3: Write the template**

In `js/popup.js`, at the end of the file after `rainBars()`:

```js
/* Rain totalled over five nested windows, as horizontal bars.

   This answers how much rain fell. It never answers how dangerous that is. `rainBars()` directly
   above already draws the JPS intensity classes across its plot, and `rainState()` above that
   prints the word — so the severity question is answered twice on this card before these bars
   start. There is deliberately no threshold mark here. The spec records three sources that were
   tried for one and why each failed, and anything proposing a fourth has to answer that section
   first: docs/superpowers/specs/2026-08-12-cumulative-rainfall-chart-design.md

   A window with no honest answer keeps its row and draws an em dash, so the five are always in the
   same place and a reader never has to work out which one is missing. An asterisk marks a total
   this app worked out rather than read off a feed. */
export function rainAcc(acc) {
  if (!acc) return '';
  const rows = ACC_ROWS.map(([k, label]) => [label, acc[k]]);
  if (!rows.some(([, r]) => r)) return '';
  // The scale is the largest total, so the widest bar always fills the width. With no mark to hold,
  // the axis needs no other rule.
  const hi = Math.max(...rows.map(([, r]) => r ? r[0] : 0));
  if (!hi) return '<div class="muted">No rain in the last 72 hours</div>';

  const star = rows.some(([, r]) => r && r[1]);
  const row = ([label, r]) => {
    if (!r) return `<div class="accrow"><span class="acck">${label}</span>
      <span class="accbar"></span><span class="accv muted">—</span></div>`;
    const [mm, derived, span] = r;
    // The span rides in the readout rather than on the row, because it is the answer to "why does
    // this say 24 hours when the archive has a hole in it" and not something to read at a glance.
    const tip = `${label} · ${mm} mm${span ? ` · measured over ${span} h` : ''}`;
    return `<div class="accrow" data-tip="${tip}"><span class="acck">${label}</span>
      <span class="accbar"><i style="width:${(mm / hi * 100).toFixed(1)}%"></i></span>
      <span class="accv">${mm} mm${derived ? '<sup>*</sup>' : ''}</span></div>`;
  };

  return `<div class="acc">${rows.map(row).join('')}${
    star ? '<div class="muted">* Value derived from archived readings.</div>' : ''}</div>`;
}
```

- [ ] **Step 4: Style it**

In `css/base.css`, after the `.spark .axis span` rule and before `.sparktip`:

```css
/* The rainfall accumulation chart. A grid rather than a flex row, so the labels line up down one
   column and the numbers down another whatever any of them holds, and the bar takes what is left.
   Horizontal bars rather than an SVG: five values need no plot area, no axis and no path. */
.acc { margin: 6px 0 2px; }
.accrow { display: grid; grid-template-columns: 58px 1fr auto; align-items: center; gap: 8px;
  min-height: 20px; }
.acck { color: var(--muted); font-size: 12px; }
.accbar { height: 8px; border-radius: 4px; background: var(--hover); overflow: hidden; }
/* Rainfall violet, the kind colour. Never a status hue: this bar says how much, not how bad. */
.accbar i { display: block; height: 100%; border-radius: 4px; background: var(--k-rainfall); }
.accv { font-size: 12px; font-variant-numeric: tabular-nums; }
.accv sup { color: var(--muted); }
```

- [ ] **Step 5: Bump the stylesheet**

In `index.html`, raise the number on the `css/base.css` link by one. It reads `?v=114` at the time of writing, so it becomes `?v=115`.

- [ ] **Step 6: Check the modules parse**

```bash
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done; echo "modules checked"
```

Expected: no `FAIL` line.

- [ ] **Step 7: Commit**

```bash
git add js/config.js js/popup.js css/base.css index.html
git commit -m "$(cat <<'EOF'
Five totals need no plot area, no axis and no path

rainAcc() draws the five nested windows as horizontal bars in a grid. The
labels line up down one column and the numbers down another, and the bar
takes what is left.

No threshold mark. rainBars() directly above already carries the JPS
intensity classes and rainState() above that prints the word, so this
card answers the severity question twice before these bars start. The
spec records the three sources tried for a mark and why each failed.

A window with no answer keeps its row and draws an em dash, so a reader
never has to work out which of the five is missing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Both call sites

**Files:**
- Modify: `js/popup.js` — `sensorBody()`, near line 344 and the return near line 385
- Modify: `js/table.js` — the util import near line 9, and `trend()` near line 296

**Interfaces:**
- Consumes: `rainAcc()` from Task 3.

- [ ] **Step 1: Wire the station card**

In `js/popup.js`, inside `sensorBody()`, directly under the line that reads
`const rain = s.kind === 'rainfall' ? rainBars(s.history) : '';` add:

```js
  /* Totals under the graph. Not on a stale station: one gauge in the payload holds 27 mm in an hour
     stamped last October, and `hasInfo()` calls it online because `hourly` is not null. Drawing
     that as today's rain is the one thing this chart must never do. */
  const acc = s.kind === 'rainfall' && !isStale(s) ? rainAcc(s.acc) : '';
```

Then change the last line of the return from:

```js
    ${spark}${rain}`;
```

to:

```js
    ${spark}${rain}${acc}`;
```

- [ ] **Step 2: Wire the table popover**

In `js/table.js`, add `isStale` to the util import:

```js
import { el, dkey, distKm, hasInfo, color, statusColor, scalePos, levelStops, leads, gaugeTone,
         gaugeColor, isStale } from './util.js';
```

Add `rainAcc` to the popup import:

```js
import { sparkline, rainBars, sirenBand, rateHtml, etaText, gaugeState, rainAcc } from './popup.js';
```

Then change the last line of `trend` from:

```js
    : m.kind === 'rainfall' ? rainBars(m.history) : '');
```

to:

```js
    : m.kind === 'rainfall' ? rainBars(m.history) : '')
  // Same totals as the station card, under the same graph. Same stale guard for the same reason.
  + (m.kind === 'rainfall' && !isStale(m) ? rainAcc(m.acc) : '');
```

- [ ] **Step 3: Check the modules parse**

```bash
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done; echo "modules checked"
```

Expected: no `FAIL` line.

- [ ] **Step 4: Check every file still serves**

```bash
for f in js/*.js css/*.css; do
  curl -sk -o /dev/null -w "%{content_type} $f\n" "https://flood-exp.test/$f"; done \
  | grep -v 'javascript\|css' || echo "every file serves the right type"
```

Expected: the confirmation line. Herd answers a missing file with `index.html` and HTTP 200, so the content type is what proves the path.

- [ ] **Step 5: Look at the page**

Open `https://flood-exp.test`, hard-reload with Ctrl+Shift+R, and open a rainfall station.

Expected: five labelled rows under the rain graph. `1 hour`, `3 hours` and `Today` carry numbers. `24 hours` and `72 hours` draw an em dash until the odometer fills. The footnote appears only if a row carries an asterisk. Open the all-stations table, point at a rainfall row, and confirm the same five rows appear in the popover.

- [ ] **Step 6: Commit**

```bash
git add js/popup.js js/table.js
git commit -m "$(cat <<'EOF'
One gauge holds 27 mm in an hour and its stamp reads last October

Both surfaces draw the accumulation chart, and both refuse it on a stale
station. hasInfo() calls that gauge online because hourly is not null, so
without the guard the card would draw last October's rain as today's.

The card and the table popover share one function, the way they already
share rainBars().

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Documentation

**Files:**
- Modify: `docs/FEATURES.md` — append the feature and the reasoning
- Modify: `CLAUDE.md` — the data-source notes, the `api.php` notes and one new gotcha

- [ ] **Step 1: Append to `docs/FEATURES.md`**

Add a section covering: the five windows and why nested windows answer different questions; the three totals the feed already published and nobody read; the odometer and why a difference beats a sum; the asterisk rule; and the three rejected threshold sources with the 1.7-year against 216-year measurement. Point at the spec for the full record.

- [ ] **Step 2: Update `CLAUDE.md`**

Three edits:

1. In the JPS Selangor API field notes, record that the rainfall detail also carries `threeHoursRainfall`, `cumulativeRainfall` and the four `sp*` class thresholds, and that this app now reads the first two.
2. In the `api.php` section, describe the `acc` blob and the `#c` odometer series.
3. Add a gotcha stating that `cumulativeRainfall` is a year-to-date odometer, that 24 and 72 hour totals are a difference and never a sum of `hourly` buckets, and that a sum renders a gap in the archive as a dry spell with no alarm behind it.

- [ ] **Step 3: Check the prose**

```bash
python "C:/Users/illus/.claude/ste-lint.py" < docs/FEATURES.md
python "C:/Users/illus/.claude/ste-lint.py" < CLAUDE.md
```

Expected: no `contraction`, `passive_voice`, `banned_word`, `banned_modal` or `long_sentence` violations from the added text. Ignore `long_paragraph`, which counts each table row and list item as a sentence.

- [ ] **Step 4: Run every check in the repo**

```bash
php -l api.php && php -l sources.php
php api.php --selftest
php shots-test.php
curl -sk https://flood-exp.test/api.php \
  | php -r 'echo json_encode(json_decode(stream_get_contents(STDIN),true)["sources"]),"\n";'
for f in js/*.js; do
  case $(basename $f) in timeline.js|table.js|wall.js|test.js|clip.js) continue;; esac
  grep -q "modulepreload\" href=\"$f\"" index.html || echo "MISSING modulepreload: $f"
done
```

Expected: both lints clean, both checks green, every source reporting a non-zero `parsed`, and no missing `modulepreload` line. No new module was added, so that last check should stay silent.

- [ ] **Step 5: Commit**

```bash
git add docs/FEATURES.md CLAUDE.md
git commit -m "$(cat <<'EOF'
The rainfall detail carried three unread fields since the proxy was built

Records what the accumulation chart is, and the two findings behind it
that are worth more than the feature.

The Selangor rainfall detail publishes threeHoursRainfall,
cumulativeRainfall and four per-station class thresholds. Every one was
fetched and discarded on every poll.

And a mark saying how rare a total is has no honest source here. A curve
fitted between the two published warning levels joins a 1.7 year event to
a 216 year one. MSMA is the right instrument and only 11 of 230 stations
stand on a gauge with the record it needs.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage.** Goal and both surfaces are Task 4. The five windows and their sources are Task 2. The odometer, its two guards and `ACC_READ` are Tasks 1 and 2. The KL 3 hour fallback with its all-or-nothing rule is Tasks 1 and 2. The asterisk rule and the single footnote line are Tasks 2 and 3. The empty state, the scale rule and `data-tip` are Task 3. Stale stations are Task 4. The checks list is Task 1, less the stale assertion, which is a DOM condition rather than arithmetic and is verified in Task 4 Step 5. Every item in "Not built" is satisfied by omission.

**Placeholders.** None. Every code step carries the code and every check step carries its command and expected output.

**Type consistency.** `accWindow()` returns `[mm, spanHours]` and Task 2 unpacks it as `$w[0]` and `$w[1]`. `accHours()` returns a float and Task 2 uses it directly. The payload row is `[mm, derived, spanHours]` in Task 2 and destructured in that order in Task 3. `ACC_ROWS` pairs are `[key, label]` in Task 3 and mapped in that order.

**One known gap, stated rather than hidden.** `h24` and `h72` publish `null` for every station for the first 24 and 72 hours after Task 2 ships. `cumulativeRainfall` has never been sampled and no backfill is possible from the `hourly` history. Task 2 Step 6 says so and the empty state already covers it.
