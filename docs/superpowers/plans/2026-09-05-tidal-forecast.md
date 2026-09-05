# Tidal Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Withhold the `rising` forecast on a water level station that rises and falls with the sea.

**Architecture:** `api.php` derives a `tidal` flag per river on every refresh, from one SQL
aggregation over 15 days of `.history.db`. A pure function `tidalRange()` holds the rule. The
trend pass sets `eta` to null on a tidal station, so `rising` is false. The station card says why.

**Tech Stack:** PHP 8 with PDO sqlite, vanilla ES modules, no build step. Checks run through
`php api.php --selftest`, `php -l`, `node --check` and the STE linter.

**Spec:** `docs/superpowers/specs/2026-09-05-tidal-forecast-design.md`

## Global Constraints

- Prose in files follows Simplified Technical English. Run `python "C:/Users/illus/.claude/ste-lint.py" < FILE` on every document you write. Aim for 0. A list of more than six items raises a false `long_paragraph` count. Ignore that one.
- Use the Read, Edit, Write, Grep and Glob tools for files. Use Bash only for `php`, `node`, `git` and the linter. Put every command of one sweep in one call.
- No station list. The flag comes from the archive on every refresh.
- The `now` tier at the danger mark keeps firing on a tidal station. Only `eta` and `rising` go.
- A message on screen: sentence case, no hedge, none of our vocabulary, no number the reader does not need.
- Every constant carries a comment that states its number and why. Every hex and every threshold lives in one place.
- Commit on `main`. End every commit message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Docs are part of the change, not a follow-up. `docs/FEATURES.md` gets a section that states what shipped and why, with the trade-offs and what was deliberately not built.

---

### Task 1: `tidalRange()` and its constants

**Files:**
- Modify: `api.php:90-94` (constants, after `RISE_DAY`)
- Modify: `api.php:354-368` (add the function after `assess()`)
- Test: `api.php:1550-1557` (the `--selftest` block, new cases before `stationUpdated():`)

**Interfaces:**
- Produces: `function tidalRange(array $days): bool`. `$days` is a list of `[float range, int samples]`, one entry per calendar day. Constants `TIDE_WIN`, `TIDE_DAYS`, `TIDE_SAMPLES`, `TIDE_RANGE`, `TIDE_CEIL`.

- [ ] **Step 1: Write the failing selftest cases**

In `api.php`, after the line `$ok('no stamp at all opens a sweep',     forceAllowed($now, null, SIREN_TTL)[0] === true);` and before `echo "\nstationUpdated():\n";`, insert:

```php

    echo "\ntidalRange():\n";
    /* One entry per day: [range in metres, samples that day]. Eight samples is an ordinary day. */
    $days = fn(array $ranges, int $n = 8) => array_map(fn($r) => [$r, $n], $ranges);
    $tide  = $days([1.5, 2.5, 2.2, 1.8, 2.4, 1.6, 2.0, 2.3, 1.9, 2.5, 1.7, 2.1, 2.4, 1.8, 2.2]);
    $river = $days([0.03, 0.05, 0.09, 0.04, 0.06, 0.05, 0.07, 0.03, 0.08, 0.04, 0.05, 0.06, 0.04, 0.07, 0.05]);
    $ok('a tidal fortnight is tidal',                    tidalRange($tide) === true);
    $ok('a quiet river is not',                          tidalRange($river) === false);
    /* BATU 9 had one wet week: a median of 0.72 m and a lower quartile of 0.06 m. */
    $ok('eight wet days do not make a river tidal',      tidalRange($days(array_merge(array_fill(0, 7, 0.05), array_fill(0, 8, 0.72)))) === false);
    /* ULU YAM reads 32.5 m and 0.00 on one day. No tide here reaches 6 m. */
    $ok('a feed dropping to zero is not tidal',          tidalRange($days(array_fill(0, 15, 32.0))) === false);
    $ok('four days cannot answer',                       tidalRange($days([2.0, 2.0, 2.0, 2.0])) === false);
    $ok('five days can',                                 tidalRange($days([2.0, 2.0, 2.0, 2.0, 2.0])) === true);
    $ok('the floor is inclusive',                        tidalRange($days(array_fill(0, 15, TIDE_RANGE))) === true);
    $ok('the ceiling is exclusive',                      tidalRange($days(array_fill(0, 15, TIDE_CEIL))) === false);
    $ok('a day with three samples counts for nothing',   tidalRange($days(array_fill(0, 15, 2.0), 3)) === false);
    $ok('an empty archive is not tidal',                 tidalRange([]) === false);
```

- [ ] **Step 2: Run the selftest and watch it fail**

Run: `php api.php --selftest`
Expected: a PHP fatal error, `Call to undefined function tidalRange()`. The earlier sections print `ok` first.

- [ ] **Step 3: Add the constants**

In `api.php`, after the line `const RISE_DAY = 86400;`, insert:

```php
/* A TIDE IS A RISE, AND THE ENVELOPE ABOVE CANNOT HOLD IT. From neap to spring each high tide beats
   the one before it for seven days. So the 24-hour guard holds one week a fortnight and fails the
   next. Measured over 30 days of archive: 81 of 103 forecast firings were tidal, and 0 were correct.
   So a station that swings every day is TIDAL, and a tidal station gets no forecast. A straight line
   through a tide has no skill. The `now` tier at the danger mark still fires, because a king tide
   over Bahaya is a flood.
   The flag comes from the archive on every refresh, never from a list. A list needs maintaining, it
   is wrong the day JPS adds a gauge, and it says nothing about a river that is mildly tidal at the
   mouth.
   The statistic is the LOWER QUARTILE of the daily range over one spring-neap cycle. A tidal station
   swings on every day, so its smallest quartile is its neap days, and those still reach 0.67 m. An
   inland river reaches 0.36 m at most. A median would flag a wet week: BATU 9 hit 0.72 m on one.
   0.5 m sits in the middle of that gap. The ceiling drops a feed that reads 0.00 for hours. ULU YAM
   reads 32.5 m and 0.00 on one day, and no tide in Malaysia reaches 6 m.
   Five days is the floor the development archive can answer, because that machine sleeps. A fresh
   .history.db therefore forecasts on the tide for five days. That is the cost of having no list.
   A flashy inland river that swings 0.5 m on 12 of 15 days reaches the quartile too. It then loses
   its forecast tier until the fortnight ends and keeps its `now` tier. No such fortnight is in the
   archive to count, so the risk is stated here rather than measured.
   ponytail: a tidal station forecasts nothing. The upgrade is a low-water rule, which forecasts
   only when the trough sits 0.3 m over its normal low. It needs a flood in the archive to prove it.
   It also repairs the wet fortnight above, because a river in flood holds its trough high. */
const TIDE_WIN     = 15 * 86400;   // one spring-neap cycle is 14.8 days
const TIDE_DAYS    = 5;            // days with enough samples before the archive can answer
const TIDE_SAMPLES = 4;            // a day with fewer samples cannot hold a range
const TIDE_RANGE   = 0.5;          // m: a lower quartile at or above this is tidal
const TIDE_CEIL    = 6.0;          // m: and under this, or the feed is dropping out
```

- [ ] **Step 4: Add the function**

In `api.php`, after the closing brace of `function assess(...)` (the line `return [$rate, round(max(0, ($mark - $lvl) / $rate), 2)];` followed by `}`), insert:

```php

/** Does this station rise and fall with the sea? $days is [[range m, samples], ...], one per day.
 *  Pure, so --selftest can reach it. TIDE_RANGE above holds the numbers and the reasons.
 *  The lower quartile is the element at floor((n - 1) / 4) of the sorted ranges: the 4th smallest
 *  of 15 days, the 2nd smallest of 5. */
function tidalRange(array $days): bool {
    $r = [];
    foreach ($days as [$range, $n]) if ($n >= TIDE_SAMPLES) $r[] = (float)$range;
    if (count($r) < TIDE_DAYS) return false;
    sort($r);
    $q = $r[intdiv(count($r) - 1, 4)];
    return $q >= TIDE_RANGE && $q < TIDE_CEIL;
}
```

- [ ] **Step 5: Run the selftest and watch it pass**

Run: `php -l api.php && php api.php --selftest`
Expected: `No syntax errors detected`, then every line under `tidalRange():` reads `ok`, and the last line reports 0 failures. If any other section fails, stop: something else moved.

- [ ] **Step 6: Commit**

```bash
git add api.php
git commit -m "Add tidalRange(), the rule that names a tidal station

The lower quartile of the daily range over 15 days, at or above 0.5 m
and under 6 m, on five or more days with four or more samples. Pure,
with ten selftest cases. Nothing calls it yet.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Derive `tidal` on every refresh and withhold the forecast

**Files:**
- Modify: `api.php:3299-3302` (the `$hist` load; add the aggregation after it)
- Modify: `api.php:3847-3873` (the trend pass)
- Modify: `api.php:759-761` (the camera strip's river scorer)
- Test: the live payload, through the sweep in Step 5

**Interfaces:**
- Consumes: `tidalRange(array $days): bool` and `TIDE_WIN` from Task 1.
- Produces: `$tidal`, a map of station id to bool, in the refresh path. Every river in the payload carries `tidal` (bool). A tidal river carries `eta: null` and `rising: false`.

- [ ] **Step 1: Add the aggregation beside the history load**

In `api.php`, find:

```php
$hist = [];
foreach ($db->query('SELECT station, ts, level FROM level WHERE ts >= ' . ($now - READ) . ' ORDER BY ts') as $r) {
    $hist[$r['station']][] = [(int)$r['ts'], (float)$r['level']];
}
```

Insert directly after it:

```php
/* Which stations rise and fall with the sea. One aggregation over TIDE_WIN, grouped by station and
   Malaysian day. The 28800 is UTC+8, and Malaysia has no daylight saving. The day only buckets a
   swing, so the boundary hardly matters. It is there so a day is a day. Every station is grouped,
   not only rivers, because the id carries no kind. The trend pass reads the map for rivers alone.
   Measured: 890 station-days in 84 ms. `tidalRange()` holds the rule and the numbers. */
$tidal = [];
$tq = $db->prepare('SELECT station, (ts + 28800) / 86400 AS d, MAX(level) - MIN(level) AS r, COUNT(*) AS n'
    . ' FROM level WHERE station NOT LIKE \'%#%\' AND ts >= ? GROUP BY station, d');
$tq->execute([$now - TIDE_WIN]);
$tideDays = [];
foreach ($tq as $r) $tideDays[$r['station']][] = [(float)$r['r'], (int)$r['n']];
foreach ($tideDays as $id => $days) $tidal[$id] = tidalRange($days);
unset($tideDays);
```

- [ ] **Step 2: Set the flag and withhold the forecast in the trend pass**

In `api.php`, find in the trend pass:

```php
    $s['rate'] = $s['eta'] = null;
    $s['rising'] = false;
    $s['history'] = [];
```

Replace with:

```php
    $s['rate'] = $s['eta'] = null;
    $s['rising'] = false;
    $s['tidal'] = $tidal[$key] ?? false;
    $s['history'] = [];
```

Then find:

```php
    [$rate, $eta] = assess($points, $last, $mark);
    $s['rate'] = $rate === null ? null : round($rate, 3);
    $s['eta']  = $eta;
```

Replace with:

```php
    [$rate, $eta] = assess($points, $last, $mark);
    // A tidal station gets no forecast. A straight line through a tide has no skill. See TIDE_RANGE.
    // The rate stays: the tide really climbs at 0.7 m/h, and the card can say so.
    if ($s['tidal']) $eta = null;
    $s['rate'] = $rate === null ? null : round($rate, 3);
    $s['eta']  = $eta;
```

`$s['rising']` two lines down reads `$eta`, so it is false on a tidal station with no further edit.

- [ ] **Step 3: Make the camera strip agree**

In `api.php`, in the `?shots=` handler, find:

```php
                $tiers = $r['kind'] === 'river'
                    ? frameTiers($frames, $samples, $mark, RISE_ETA, 'assess')
                    : frameTiers($frames, $samples, $mark, 0, fn() => [null, null]);
```

Replace with:

```php
                // A tidal river takes the closure that never forecasts, the same as live. See TIDE_RANGE.
                $tiers = $r['kind'] === 'river' && empty($r['tidal'])
                    ? frameTiers($frames, $samples, $mark, RISE_ETA, 'assess')
                    : frameTiers($frames, $samples, $mark, 0, fn() => [null, null]);
```

`$r` is a station from the cached payload, which carries `tidal` once Step 2 has run one refresh.

- [ ] **Step 4: Lint, selftest, and rebuild the payload**

Run: `php -l api.php && php api.php --selftest && php api.php > /dev/null`
Expected: `No syntax errors detected`, 0 selftest failures, and `.cache.json` rewritten. The cold rebuild takes about 3 seconds.

- [ ] **Step 5: Sweep the payload**

Run:

```bash
php -r '$p=json_decode(file_get_contents(".cache.json"),true);
$t=[]; $r=0; foreach($p["stations"] as $s){ if($s["kind"]!=="river")continue; $r++;
 if(!array_key_exists("tidal",$s)) { echo "MISSING tidal on ",$s["name"],"\n"; }
 if(!empty($s["tidal"])) $t[]=$s["name"].(!empty($s["rising"])||$s["eta"]!==null?"  <-- STILL FORECASTS":""); }
sort($t); printf("%d of %d rivers tidal (expect 10 to 16):\n  %s\n", count($t), $r, implode("\n  ",$t));'
```

Expected: between 10 and 16 rivers, BANDAR KLANG, KG. RANTAU PANJANG, SELAT MUARA, TELUK PENYAMUN (JETI), RIMBA KDR and P/A PEKAN TG. KARANG among them, no `MISSING` line, and no `STILL FORECASTS` marker. Assert the range, never an equality. The flag is derived from 15 days of archive and a station can cross 0.5 m either way on a neap fortnight.

- [ ] **Step 6: Commit**

```bash
git add api.php
git commit -m "Withhold the forecast on a tidal station

One aggregation per refresh names the rivers that swing with the sea.
Each carries tidal in the payload, eta null and rising false. The now
tier still fires at the danger mark. The camera strip takes the same
rule, so an archived frame and the live card agree.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The card says why

**Files:**
- Modify: `js/popup.js:438-441` (in `sensorBody()`, after the `Reaches danger` metric)
- Modify: `css/map.css:96-97` (the `.popbody` rules)
- Test: `node --check js/popup.js`, then the card on `https://flood-exp.test`

**Interfaces:**
- Consumes: `s.tidal` (bool) on a river station, from Task 2.

- [ ] **Step 1: Add the note to the card**

In `js/popup.js`, find:

```js
  if (s.kind === 'river' && s.eta != null) body.push(metric('Reaches danger',
    etaText(s.eta), s.rising ? 'up' : ''));
```

Insert directly after it:

```js
  /* A tidal station carries no `Reaches danger` line, because api.php withholds `eta` there: a
     straight line through a tide has no skill, and the tide turns. This says why, in the reader's
     words, and it also says why the pin turns amber twice a month. One line across both columns. */
  if (s.kind === 'river' && s.tidal) body.push('<div class="note muted">Tidal. Rises and falls with the sea twice a day.</div>');
```

- [ ] **Step 2: Let the note span the grid**

In `css/map.css`, find:

```css
.popbody { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin-bottom: 8px; }
.popbody .v { text-align: right; }
```

Insert directly after it:

```css
/* A sentence in the Trend segment, not a key and a value. The tidal note is the one user. */
.popbody .note { grid-column: 1 / -1; }
```

- [ ] **Step 3: Check the syntax**

Run: `node --check js/popup.js`
Expected: no output, exit 0.

- [ ] **Step 4: Check the card by eye**

Open `https://flood-exp.test`. Open the go-to box, type `bandar klang`, pick the water level station. In the Trend segment, read `Tidal. Rises and falls with the sea twice a day.` on one line across the segment, and no `Reaches danger` row. Then open `ulu yam` and confirm the note is absent there.

- [ ] **Step 5: Commit**

```bash
git add js/popup.js css/map.css
git commit -m "Say on the card why a tidal station has no forecast

One muted line across the Trend segment. It also says why the pin
turns amber twice a month.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Documents

**Files:**
- Modify: `docs/FEATURES.md` (append a section at the end of the file)
- Modify: `docs/GOTCHAS.md:290-294` (the "A tide is a rise" entry)
- Modify: `CLAUDE.md:272-282` (the trend bullet) and `CLAUDE.md:431` (the gotcha index line)
- Modify: `docs/VERIFY.md:43-48` (add the sweep after the null-reading sweep)

**Interfaces:**
- Consumes: the measurements in the spec, and the sweep from Task 2 Step 5.

- [ ] **Step 1: Append the FEATURES.md section**

At the end of `docs/FEATURES.md`, after the last line of the `MapLibre GL under Leaflet buys nothing here` section, append:

```markdown

## A tidal station gets no forecast

Thirteen water level stations on the coast and in the Klang estuary rise and fall with the sea.
Each one climbs 0.5 to 0.7 m/h twice a day. The `rising` forecast extrapolated that climb to the
danger mark and fired. The tide then turned. Over 30 days of archive, 81 of 103 firings were tidal.
Not one was correct. Those firings were the `FORECAST` rows in the alert list, the app bar badge,
the ticker and the toast.

| station | daily swing | `rising` fired in 30 days |
|---|---|---|
| KG. RANTAU PANJANG (Klang) | 2.89 m | 21 |
| SELAT MUARA | 2.60 m | 16 |
| P/A PEKAN TG. KARANG | 2.32 m | 14 |
| RIMBA KDR | 2.12 m | 14 |
| BANDAR KLANG | 2.53 m | 11 |
| TELUK PENYAMUN (JETI) | 2.59 m | 5 |

**The 24-hour envelope leaked for a week each fortnight.** The guard asked that the level beat its
own 24-hour high. From neap to spring each high tide beats the one before it, for seven days. The
section "The forecast was wrong every time it fired" above measured that guard over 7.2 days and
called it sound. Over 30 days it is not.

### What shipped

`api.php` derives `tidal` for every river on every refresh. One SQL aggregation groups 15 days of
`.history.db` by station and Malaysian day, 890 station-days in 84 ms. `tidalRange()` reads the
per-day ranges. It drops a day with fewer than 4 samples, needs 5 days, takes the lower quartile,
and answers true between 0.5 m and 6 m. A tidal station gets `eta` null, so `rising` is false. The
`now` tier at the danger mark still fires. The camera strip takes the same rule. The card says
`Tidal. Rises and falls with the sea twice a day.` where the forecast row sat.

Measured on the archive: 0 firings on the tidal stations once the flag had five days of data.

**Why the lower quartile.** A tidal station swings on every day, so its smallest quartile is its
neap days, and those still reach 0.67 m. Every inland river stays at 0.36 m and under. A median
would flag a wet week: BATU 9 reached 0.72 m on one, with a lower quartile of 0.06 m.

**Why not a station list.** A list needs maintaining. It is wrong the day JPS adds a gauge. It says
nothing about a river that is mildly tidal at the mouth. The flag heals itself when a station
changes.

**Why a king tide still lists.** Selangor issued a state-wide high tide warning for 18 to 22
February 2026, with Port Klang predicted at 4.8 to 5.23 m. JPS tweeted BANDAR KLANG over Amaran at
05:45 on 17 February, which is that tide. A spring tide over a mark is a coastal hazard the state
warns about. So the observed tier stays. Only the straight-line forecast goes.

### Trade-offs accepted

- **No forecast tier at an estuary.** A river flood at BANDAR KLANG reaches the alert list at the
  danger mark and not before.
- **Five days of warm-up.** A fresh `.history.db` forecasts on the tide for five days.
- **A wet fortnight can flag an inland river.** A flashy river that swings 0.5 m on 12 of 15 days
  loses its forecast tier until the fortnight ends. It keeps `now`. No such fortnight is in the
  archive to count. The low-water rule below repairs it.

### Two faults found and left alone

- **PINTU AIR IJOK fired 11 times.** It is a water gate on a controlled pond, climbing 0.18 m in
  two days toward a close mark. A question about gates.
- **Eight firings were feeds dropping to 0.00 and back.** A reading that falls 32 m and returns is
  a 32 m/h climb to the rate, and both guards pass it. A ceiling on the rate is a separate design.

### Deliberately not built

- **A 30-day envelope for every station.** One constant, and it stops the tide on this archive. It
  also withholds the forecast from a river climbing toward danger for the second time in a month,
  until it beats the earlier peak. That is the monsoon case the forecast exists for.
- **A low-water rule.** A tidal station forecasts only when its trough sits 0.3 m above its normal
  low. Same false count in the replay, keeps a path for an estuary flood, and repairs the wet
  fortnight above. Deferred until a flood in the archive can prove it fires. The code names it.
- **The amber pin at Waspada and Amaran on a tide.** The marks belong to JPS, and the reader asked
  about the forecast rows alone.
- **Tide times on the card.** JUPEM publishes predictions through a phone app and no endpoint.

See `docs/superpowers/specs/2026-09-05-tidal-forecast-design.md` for the replay and the candidate
rules it rejected.
```

- [ ] **Step 2: Rewrite the GOTCHAS.md entry**

In `docs/GOTCHAS.md`, find:

```markdown
- **A tide is a rise, and three of these stations are tidal.** PINTU AIR IJOK is a water gate.
  BANDAR KLANG and TELUK PENYAMUN (JETI) are estuarine. They climb 0.5–0.7 m/h twice a day forever,
  so any rate-based forecast flags them daily. The guard is `level ≥ its own 24h high`, not a
  blocklist. A list needs maintaining. It is wrong the day JPS adds a gauge. It says nothing about
  rivers that are mildly tidal at the mouth. **Do not replace it with a station list.**
```

Replace with:

```markdown
- **A tide is a rise, thirteen of these stations are tidal, and the 24-hour envelope cannot hold
  them.** BANDAR KLANG, KG. RANTAU PANJANG, SELAT MUARA, TELUK PENYAMUN (JETI), RIMBA KDR and eight
  more swing 1 to 3 m twice a day. The envelope guard asks that the level beat its own 24-hour high.
  From neap to spring each high tide beats the one before it for seven days, so the guard holds one
  week a fortnight and fails the next. Measured over 30 days: 81 of 103 forecast firings were tidal.
  The guard is `tidalRange()` in `api.php` now. It derives `tidal` from the archive on every refresh,
  and a tidal station gets no forecast at all. **Do not replace it with a station list.** A list
  needs maintaining. It is wrong the day JPS adds a gauge. It says nothing about rivers that are
  mildly tidal at the mouth. PINTU AIR IJOK is not tidal. It is a gate, and it still fires.
```

- [ ] **Step 3: Update CLAUDE.md**

In `CLAUDE.md`, find:

```markdown
  chord between two samples. `rising` is a **forecast, not a rate**, and it needs all five of these.
  The rate is `≥ RISE_FLOOR` (0.1 m/h). The level is strictly above the sample two back. The level is
  at or above its own 24h high, which is what keeps a tide out. The `eta` — hours to its *own* danger
  mark at that rate — is within `RISE_ETA` (3 h). The same was true on the previous poll (on-delay).
```

Replace with:

```markdown
  chord between two samples. `rising` is a **forecast, not a rate**, and it needs all six of these.
  The rate is `≥ RISE_FLOOR` (0.1 m/h). The level is strictly above the sample two back. The level is
  at or above its own 24h high. The `eta` — hours to its *own* danger mark at that rate — is within
  `RISE_ETA` (3 h). The same was true on the previous poll (on-delay). **And the station is not
  tidal.** `tidalRange()` derives `tidal` from 15 days of archive on every refresh, and a tidal
  station gets `eta` null. The 24h envelope was the tide guard and it leaks for a week each
  fortnight — see the gotcha below.
```

Then find the index line:

```markdown
- A tide is a rise, and three of these stations are tidal.
```

Replace with:

```markdown
- A tide is a rise, thirteen of these stations are tidal, and the 24-hour envelope cannot hold...
```

- [ ] **Step 4: Add the sweep to VERIFY.md**

In `docs/VERIFY.md`, find:

```bash
echo "$n of $t river and rainfall stations hold no reading\n";'
```

Insert directly after it:

```bash

# Which rivers the payload marks tidal, and that none of them still forecasts. A RANGE, NEVER AN
# EQUALITY: the flag comes from 15 days of archive, and a station near 0.5 m can cross either way on
# a neap fortnight. Expect the coast among them: BANDAR KLANG, KG. RANTAU PANJANG, SELAT MUARA,
# TELUK PENYAMUN (JETI), RIMBA KDR, P/A PEKAN TG. KARANG. Under 10 on a machine that sleeps at night
# is the archive, not the rule: the flag needs five days with four samples each.
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
$t=[]; $r=0; foreach($p["stations"] as $s){ if($s["kind"]!=="river")continue; $r++;
 if(!empty($s["tidal"])) $t[]=$s["name"].(!empty($s["rising"])||$s["eta"]!==null?"  <-- STILL FORECASTS":""); }
sort($t); printf("%d of %d rivers tidal (expect 10 to 16):\n  %s\n", count($t), $r, implode("\n  ",$t));'
```

- [ ] **Step 5: Lint the four documents**

Run:

```bash
python "C:/Users/illus/.claude/ste-lint.py" < docs/FEATURES.md | grep -E '"total"|contraction|passive|banned_modal|semicolon'
python "C:/Users/illus/.claude/ste-lint.py" < docs/GOTCHAS.md | grep -E '"total"|contraction|passive|banned_modal|semicolon'
python "C:/Users/illus/.claude/ste-lint.py" < docs/VERIFY.md | grep -E '"total"|contraction|passive|banned_modal|semicolon'
```

Expected: the counts do not rise against a run on the committed files before your edit. Both files are old and long, so run the linter on `HEAD` first with `git show HEAD:docs/FEATURES.md | python ...` and compare. The new section itself must add no contraction, no passive voice, no banned modal and no semicolon outside a code block.

- [ ] **Step 6: Commit**

```bash
git add docs/FEATURES.md docs/GOTCHAS.md CLAUDE.md docs/VERIFY.md
git commit -m "Document the tidal flag and the envelope that leaked

FEATURES.md states what shipped, the replay numbers, the trade-offs
and what was left out. The GOTCHAS entry that trusted the 24-hour
envelope is rewritten. CLAUDE.md names the sixth condition on rising.
VERIFY.md gains the tidal sweep.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage.** The rule, its five constants and its seven checks: Task 1. The aggregation, the flag, the withheld `eta`, the camera strip: Task 2. The card line: Task 3. FEATURES, GOTCHAS, CLAUDE.md, VERIFY: Task 4. The two faults and the four things not built: Task 4 Step 1. The wet fortnight risk: Task 1 Step 3 comment and Task 4 Step 1.
- **Placeholders.** None. Every step carries its code.
- **Names.** `tidalRange(array $days): bool` in Task 1, called in Task 2 with `[[float, int], ...]`. `$tidal` keyed by station id in Task 2, read as `$tidal[$key]` in the trend pass where `$key = $s['id']`. `s.tidal` on the client in Task 3. `TIDE_WIN` in Task 2 Step 1, defined in Task 1 Step 3.
