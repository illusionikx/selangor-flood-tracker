# Camera Timeline Clock Anchors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the camera archive keep and replay frames at chosen clock times — week at 01:00 MYT and every 3 hours, month at 04:00 and 16:00, year on Monday 16:00 — and show the closest frame where none exists at the target.

**Architecture:** A retention tier gains a third number, the **anchor**. The slot is `floor((ts - anchor + step/2) / step)` and the target is `anchor + slot * step`. The frame nearest its target wins the slot. `pruneShots()` in `shots.php` and `thin()` in `js/timeline.js` write the same expression, so the stored grid and the played grid cannot disagree. The lightbox stamp also gains a full date, in a short form below 600px.

**Tech Stack:** PHP 8 (no framework), browser ES modules (no build step), `Intl.DateTimeFormat`, `matchMedia`.

**Spec:** [`docs/superpowers/specs/2026-08-03-camera-timeline-clock-anchors-design.md`](../specs/2026-08-03-camera-timeline-clock-anchors-design.md)

## Global Constraints

- **No build step.** `js/*.js` are ES modules loaded directly. Keep relative specifiers with the `.js` extension. Do not add a bundler, a package, or a test framework.
- **No new dependencies.** Front end and back end both.
- **The one runnable check is `php shots-test.php`.** It must stay green. There is no JS test runner and this plan does not add one.
- **Anchors are duplicated across PHP and JS on purpose.** `step` and `win` already are. Change one and you must change the other.
- **Never write a hex color into a JS file.** No task here touches color.
- **No CSS file changes in this plan**, so do **not** bump `?v=` on the stylesheet links. Do hard-reload (Ctrl+Shift+R) after every `js/` change — ES module imports have no cache guard.
- **Prose style is ASD-STE100 Simplified Technical English** for `docs/` and `CLAUDE.md`: active voice, one instruction per sentence, 20 words maximum, no semicolons, no contractions, American spelling. Check with `python "C:/Users/illus/.claude/skills/ste-writing/ste-lint.py" < FILE`.
- **Do not delete `shots/` or `.history.db`** at any point. `shots/` is a year of camera history and cannot rebuild.
- **All times are 24-hour and Malaysian.** MYT is UTC+8. No `hour12` anywhere.

---

## File Structure

| file | responsibility | change |
|---|---|---|
| `shots.php` | camera archive: capture, retention, lookup | `SHOT_TIERS` gains the anchor column. `pruneShots()` swaps its bucket key and its winner test. |
| `shots-test.php` | the only runnable check | Two new assertion blocks: the anchors aim where they claim, and the nearer frame wins a contested slot. |
| `js/timeline.js` | lightbox archive replay | `RANGES` gains `anchor`. `thin()` picks the nearest frame. Two date formatters replace one. One stale comment corrected. |
| `CLAUDE.md` | project instructions and gotcha list | One gotcha about the two-sided anchor rule. |
| `docs/FEATURES.md` | what was built and why | Retention table gains an "aims at" column. One new section appended. |

Nothing else reads the bucket rule. `?shots=`, `frameTiers()`, `js/clip.js` and `drawTicks()` consume the frame list and do not change.

---

## Task 1: The anchored retention rule

**Files:**
- Modify: `shots.php:48-63` (the `SHOT_TIERS` comment and constant)
- Modify: `shots.php:116-132` (`pruneShots()`)
- Test: `shots-test.php` — insert after line 104, before the `frameTiers` block comment

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `SHOT_TIERS` rows become `[int $maxAge, int $every, int $anchor]`, a third element added to every row. `pruneShots(int $id, int $now): void` keeps its signature. Task 2 copies the slot expression `intdiv($ts - $anchor + intdiv($step, 2), $step)` into JavaScript and the anchor values `7200`, `28800`, `374400`.

- [ ] **Step 1: Confirm the test is green before you touch anything**

Run: `php shots-test.php`
Expected: `all passed`, exit 0. If it is already failing, stop and report — this plan assumes a green baseline.

- [ ] **Step 2: Write the failing assertions**

In `shots-test.php`, insert this block **after** line 104 (`@rmdir(shotDir(TEST_ID));`) and **before** the `/* --- frameTiers ---` comment:

```php
/* --- the anchors ---------------------------------------------------------------------------------
 * A tier's third number is the clock time its slots aim at. The constants are hand-computed — the
 * target time in UTC, modulo the step — which is exactly the kind of number that is wrong without a
 * symptom. The prune would keep one frame per 12 hours as asked, at the wrong hour, for ever.
 *
 * Asserted against `time()`, never against the epoch. Malaysia ran UTC+7:30 until 1982, so PHP
 * renders a 1970 instant 30 minutes early and a correct anchor would look broken.
 */
echo "\nanchors:\n";
date_default_timezone_set('Asia/Kuala_Lumpur');

$AIM = [
    2 => ['week',  '01:00, then every 3 hours', fn(int $t) => date('i', $t) === '00' && (int)date('G', $t) % 3 === 1],
    3 => ['month', '04:00 and 16:00',           fn(int $t) => date('i', $t) === '00' && in_array((int)date('G', $t), [4, 16], true)],
    4 => ['year',  'Monday 16:00',              fn(int $t) => date('D H:i', $t) === 'Mon 16:00'],
];
foreach ($AIM as $i => [$name, $desc, $want]) {
    [, $step, $anchor] = SHOT_TIERS[$i];
    $slot = intdiv(time() - $anchor + intdiv($step, 2), $step);
    $t    = $anchor + $slot * $step;
    $ok(sprintf('%-5s aims at %-26s (this slot: %s)', $name, $desc, date('D j M Y H:i', $t)), $want($t));
}
$ok('the 6h and 24h tiers take no anchor', SHOT_TIERS[0][2] === 0 && SHOT_TIERS[1][2] === 0);

/* Two frames in one slot. The nearer one to the target survives, whichever order they arrived in.
   "Newest in the bucket" passes the first of these two and fails the second. */
echo "\nnearest the target wins:\n";
$pair = function (int $a, int $b) {
    array_map('unlink', glob(shotDir(TEST_ID) . '/*.*') ?: []);
    @mkdir(shotDir(TEST_ID), 0777, true);
    touch(shotDir(TEST_ID) . "/$a.webp");
    touch(shotDir(TEST_ID) . "/$b.jpg");
};
[, $mStep, $mAnchor] = SHOT_TIERS[3];                 // the month tier, one frame per 12 h
$slot   = intdiv($now - 10 * 86400 - $mAnchor + intdiv($mStep, 2), $mStep);
$target = $mAnchor + $slot * $mStep;                  // about 10 days back, inside the month tier

$pair($target - 2 * 3600, $target + 5 * 3600);
pruneShots(TEST_ID, $now);
$ok('the earlier frame wins when it is nearer', shotList(TEST_ID) === [$target - 2 * 3600]);

$pair($target - 5 * 3600, $target + 3600);
pruneShots(TEST_ID, $now);
$ok('the later frame wins when it is nearer',   shotList(TEST_ID) === [$target + 3600]);

$pair($target - 2 * 3600, $target + 5 * 3600);
pruneShots(TEST_ID, $now);
$kept2 = shotList(TEST_ID);
pruneShots(TEST_ID, $now);
$ok('a second prune leaves the winner alone',   shotList(TEST_ID) === $kept2);

array_map('unlink', glob(shotDir(TEST_ID) . '/*.*') ?: []);
@rmdir(shotDir(TEST_ID));
```

- [ ] **Step 3: Run the test to verify the new assertions fail**

Run: `php shots-test.php`
Expected: FAIL. `SHOT_TIERS` rows still hold two elements, so `[, $step, $anchor]` leaves `$anchor` null and PHP warns `Undefined array key 2`. The `week`, `month`, `year` and `nearest` assertions all report `FAIL`. The 20 pre-existing assertions still report `ok`.

- [ ] **Step 4: Add the anchor column to `SHOT_TIERS`**

In `shots.php`, replace the `SHOT_TIERS` doc comment and constant (lines 48-63) with:

```php
/* Retention, as [frames younger than this, keep one per, the clock time the bucket aims at]. `0` in
 * the second slot means keep every frame. Applied on age, so a frame thins itself as it gets older —
 * kept every 30 min for a day, then three-hourly for a week, and so on down to weekly for a year.
 * Anything past the last tier is deleted.
 * The steps are chosen so that each of the scrubber's windows holds roughly the same number of
 * frames — ~50, which is a clip of under a minute at one frame a second. A tier is what a range can
 * play, so a tier twice as coarse as its window needs is a range that is over in half the time and
 * skips half of what happened. The week tier was 6-hourly for that reason and is now 3.
 * The first two tiers are the same density while SHOT_EVERY is 30 min; they are both written out
 * because the tiers are the *policy* and the capture rate is a bandwidth cap that may change.
 *
 * The third number is the **anchor**: the target time in UTC, modulo the step. A slot's target is
 * `anchor + slot * step`, and the frame nearest that target is the one kept. Without it the buckets
 * fall on `floor(ts / step)`, which aligns to UTC midnight — so at +8 the week range landed on 01:30,
 * the month on 07:30 and 19:30, and the year on a Thursday, none of which anybody chose. The three
 * targets nest: 16:00 is on the 3-hour grid and Monday 16:00 is on the 12-hour grid, so a frame keeps
 * hitting its target as it ages from one tier to the next instead of drifting once per tier.
 * `thin()` in js/timeline.js repeats these numbers and the slot expression. Change one, change both,
 * or the ruler and the clip file the same frame in two different slots. */
const SHOT_TIERS = [
    [6 * 3600,     0,          0],           // 6 hours — every frame we have
    [24 * 3600,    1800,       0],           // a day   — every 30 min
    [7 * 86400,    3 * 3600,   7200],        // a week  — 01:00 MYT, then every 3 hours
    [30 * 86400,   12 * 3600,  28800],       // a month — 04:00 and 16:00 MYT
    [365 * 86400,  7 * 86400,  374400],      // a year  — Monday 16:00 MYT
];
```

- [ ] **Step 5: Rewrite `pruneShots()`**

In `shots.php`, replace the `pruneShots()` doc comment and function (lines 116-132) with:

```php
/* Thin one camera's archive down to SHOT_TIERS. Bucket keys carry their step, because two tiers
   dividing by different numbers could otherwise land on the same integer and silently delete each
   other's frames. Within a slot the frame nearest the slot's target survives — see the anchor note
   above. That rule is stable under repetition, which is what keeps this idempotent: the winner is
   still the winner on the next pass, however many times capture runs it. */
function pruneShots(int $id, int $now): void {
    $keep = [];
    foreach (shotList($id) as $ts) {
        $age = $now - $ts;
        $step = $anchor = null;
        foreach (SHOT_TIERS as [$maxAge, $every, $at]) if ($age <= $maxAge) { [$step, $anchor] = [$every, $at]; break; }
        if ($step === null) { @unlink(shotFile($id, $ts)); continue; }   // past the last tier
        if (!$step)         { $keep["0:$ts"] = $ts; continue; }          // this tier keeps everything
        $slot   = intdiv($ts - $anchor + intdiv($step, 2), $step);
        $target = $anchor + $slot * $step;
        $b      = "$step:$slot";
        if (!isset($keep[$b])) { $keep[$b] = $ts; continue; }
        // The list is ascending, so an exact tie keeps the older frame. Either way one file goes.
        $lose = abs($ts - $target) < abs($keep[$b] - $target) ? $keep[$b] : $ts;
        @unlink(shotFile($id, $lose));
        if ($lose !== $ts) $keep[$b] = $ts;
    }
}
```

- [ ] **Step 6: Lint and run the test**

Run: `php -l shots.php && php shots-test.php`
Expected: `No syntax errors detected`, then `all passed` and exit 0. **All 27 assertions pass** — the 20 that existed plus the 7 added. The pre-existing spacing assertions still hold because every anchor is a multiple of 1800, so targets land exactly on the test's 30-minute grid.

- [ ] **Step 7: Commit**

```bash
git add shots.php shots-test.php
git commit -m "A retention bucket aims at a clock time, and keeps the frame nearest it

SHOT_TIERS gains a third number per tier, the anchor: the target time in UTC
modulo the step. A slot's target is anchor + slot * step, and pruneShots keeps
the frame nearest that target rather than the newest in the bucket.

floor(ts / step) aligned to UTC midnight, so at +8 the week range landed on
01:30, the month on 07:30 and 19:30, and the year on a Thursday. Week now aims
at 01:00 MYT, month at 04:00 and 16:00, year at Monday 16:00.

shots-test.php asserts each anchor against time(), never the epoch: Malaysia
ran UTC+7:30 until 1982 and PHP renders a 1970 instant 30 minutes early."
```

---

## Task 2: The viewer picks the same slots

**Files:**
- Modify: `js/timeline.js:21-45` (the `RANGES` comment and constant)
- Modify: `js/timeline.js:167-176` (`thin()`)
- Modify: `js/timeline.js:199` (the `thin()` call inside `setRange()`)
- Modify: `js/timeline.js:478-481` (a comment naming a range that no longer exists)

**Interfaces:**
- Consumes: the anchor values from Task 1 — `7200` (week), `28800` (month), `374400` (year) — and the slot expression `floor((ts - anchor + step / 2) / step)`.
- Produces: `thin(list: number[], step: number, anchor: number): number[]`, ascending in and ascending out. `RANGES` entries gain `anchor: number`.

- [ ] **Step 1: Write the check that fails**

There is no JS test runner in this repository and this plan does not add one. `thin()` is a pure function, so the check is a copy of it run under node. Save this to the scratchpad as `thin-check.mjs` — **not** into the repository:

```js
// Paste the CURRENT thin() from js/timeline.js between these markers, then the new one, and run.
function thin(list, step, anchor) {
  const keep = new Map();
  for (const ts of list) {
    const slot = Math.floor((ts - anchor + step / 2) / step);
    const target = anchor + slot * step;
    const held = keep.get(slot);
    if (held === undefined || Math.abs(ts - target) < Math.abs(held - target)) keep.set(slot, ts);
  }
  return [...keep.values()];
}

const STEP = 3 * 3600, ANCHOR = 7200, SPACING = 2400;   // the week range; frames every 40 min
const t0 = Math.floor(Date.UTC(2026, 7, 3, 8, 0) / 1000);
const all = [];
for (let t = t0 - 7 * 86400; t <= t0; t += SPACING) all.push(t);
const out = thin(all, STEP, ANCHOR);

const worst = Math.max(...out.map(t => {
  const s = Math.floor((t - ANCHOR + STEP / 2) / STEP);
  return Math.abs(t - (ANCHOR + s * STEP));
}));
/* The bound is half the INPUT spacing, not half the step. With a frame every 40 minutes there is
   always one within 20 minutes of any target, so that is what "nearest the target" has to deliver.
   Half a step is the bucket's own width, and the old newest-in-bucket rule satisfies it too — so a
   half-step bound passes on both rules and proves nothing. */
const BOUND = SPACING / 2;
let bad = 0;
const is = (what, pass) => { if (!pass) bad++; console.log((pass ? 'ok   ' : 'FAIL ') + what); };
is('ascending', out.every((v, i, a) => !i || v > a[i - 1]));
is(`57 frames (got ${out.length})`, out.length === 57);
is(`worst offset ${worst / 60}min is within ${BOUND / 60}min`, worst <= BOUND);
console.log(bad ? `
${bad} FAILED` : '
all passed');
process.exit(bad ? 1 : 0);
```

- [ ] **Step 2: Run it against the current two-argument `thin()` to watch it fail**

Replace the function body in `thin-check.mjs` with the version currently in `js/timeline.js:172-176`:

```js
function thin(list, step) {
  const keep = new Map();
  for (const ts of list) keep.set(Math.floor(ts / step), ts);
  return [...keep.values()];
}
```

Run: `node <scratchpad>/thin-check.mjs`
Expected: FAIL — `worst offset 40min is within 20min`. UTC-aligned buckets keep the newest frame in each bucket, which sits 40 minutes from the 01:00 grid where the anchored rule sits 20. Restore the new version afterwards.

- [ ] **Step 3: Give each range its anchor**

In `js/timeline.js`, replace the `RANGES` constant (lines 40-45) with:

```js
const RANGES = [
  { label: '24 h',  long: '24 hours', win: 24 * 3600,   step: 1800,       anchor: 0,
    every: '30 minutes per frame' },
  { label: 'week',  long: 'week',     win: 7 * 86400,   step: 3 * 3600,   anchor: 7200,
    every: '3 hours per frame, from 01:00' },
  { label: 'month', long: 'month',    win: 30 * 86400,  step: 12 * 3600,  anchor: 28800,
    every: '12 hours per frame, 04:00 and 16:00' },
  { label: 'year',  long: 'year',     win: 365 * 86400, step: 7 * 86400,  anchor: 374400,
    every: '1 week per frame, Mondays 16:00' },
];
```

Then append this paragraph to the comment block directly above it (after the sentence ending `24 h is where it is already offered.`):

```
   `anchor` is the clock time a range's slots aim at, and it is the same number `SHOT_TIERS` carries
   in shots.php. A bare `floor(ts / step)` aligns to UTC midnight, which at +8 put the week on 01:30,
   the month on 07:30 and 19:30, and the year on a Thursday — hours nobody chose, on a camera whose
   whole point is comparing the same place at the same time of day. `every` states the target, so a
   reader can see what a range aims at before playing it.
```

- [ ] **Step 4: Make `thin()` pick the nearest frame**

Replace `thin()` and its comment (lines 167-176) with:

```js
/* One frame per slot, the frame nearest that slot's target winning — the same expression and the
   same anchors the server prunes by (`pruneShots()` in shots.php), so a window that has already been
   thinned comes through untouched and one that has not is thinned the way it eventually will be.
   A slot holding nothing is simply absent, which is what "the closest frame" means on an archive
   with gaps: the rule bounds a frame to half a step from its target and needs no tolerance of its
   own. Ascending in, ascending out: slots are visited in order, and re-setting a Map key does not
   move it. */
function thin(list, step, anchor) {
  const keep = new Map();
  for (const ts of list) {
    const slot = Math.floor((ts - anchor + step / 2) / step);
    const target = anchor + slot * step;
    const held = keep.get(slot);
    if (held === undefined || Math.abs(ts - target) < Math.abs(held - target)) keep.set(slot, ts);
  }
  return [...keep.values()];
}
```

- [ ] **Step 5: Pass the anchor at the call site**

In `setRange()`, line 199, change:

```js
  frames = thin(all.filter(ts => ts >= cut), r.step);
```

to:

```js
  frames = thin(all.filter(ts => ts >= cut), r.step, r.anchor);
```

- [ ] **Step 6: Correct the comment that names a range that no longer exists**

In `openTimeline()`, lines 478-481 currently read:

```js
  /* Open on the narrowest window that actually holds a clip. 6 h is the right default on a server
     that has been capturing all along and empty on one that has not — and an empty scrubber under a
     camera with a week of frames behind it reads as "no archive", which is the state this whole
     footer exists to replace. */
```

Replace with:

```js
  /* Open on the narrowest window that actually holds a clip. 24 h is the right default on a server
     that has been capturing all along and empty on one that has not — and an empty scrubber under a
     camera with a week of frames behind it reads as "no archive", which is the state this whole
     footer exists to replace. */
```

- [ ] **Step 7: Run the check and syntax-check the module**

```bash
node <scratchpad>/thin-check.mjs
cp js/timeline.js <scratchpad>/timeline.mjs && node --check <scratchpad>/timeline.mjs
```

Expected: `ok  57 frames, worst offset 20min (bound 90min)` and no output from `node --check`.

- [ ] **Step 8: Look at the page**

Hard-reload `https://flood-exp.test` (Ctrl+Shift+R — ES module imports have no cache guard). Open any camera pin, then the lightbox. Press **week**. Confirm the button reads `week, 3 hours per frame, from 01:00` and the frame stamps step in 3-hour intervals near the hour. Press **month** and **year** and confirm the same for their labels.

On a sparse local archive a range may report `nothing stored this far back`. That is correct and not a failure — check a different camera, or accept it and move on.

- [ ] **Step 9: Commit**

```bash
git add js/timeline.js
git commit -m "The clip plays the grid the archive is stored on

RANGES gains the anchor shots.php already carries, and thin() picks the frame
nearest each slot's target instead of the newest in the bucket. Both sides now
write the same expression, so the ruler and the clip cannot file one frame in
two slots.

The range buttons state the target: week from 01:00, month at 04:00 and 16:00,
year on Mondays at 16:00.

And openTimeline's comment named a 6 h stop that was removed. It is 24 h."
```

---

## Task 3: The frame stamp carries a full date

**Files:**
- Modify: `js/timeline.js:56-62` (the `MYT` formatter and `stamp()`)
- Modify: `js/timeline.js` — one line after `paint()` closes at line 165

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `stamp(ts: number): string` keeps its signature and its single caller, `labelAt()`. Nothing else in the module changes.

- [ ] **Step 1: Write the check that fails**

Save to the scratchpad as `stamp-check.mjs` — **not** into the repository:

```js
const dateFmt = w => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuala_Lumpur', weekday: w, day: 'numeric',
  month: w === 'long' ? 'long' : 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false,
});
const MYT_LONG = dateFmt('long'), MYT_SHORT = dateFmt('short');
const stamp = (ts, narrow) => (narrow ? MYT_SHORT : MYT_LONG).format(ts * 1000).replace(',', '');

const t = Math.floor(Date.UTC(2026, 7, 3, 8, 0) / 1000);          // Monday 16:00 MYT
const long = stamp(t, false), short = stamp(t, true);
let bad = 0;
const is = (what, pass) => { if (!pass) bad++; console.log((pass ? 'ok   ' : 'FAIL ') + what); };

is(`long is "Monday 3 August 2026 at 16:00" (got "${long}")`, long === 'Monday 3 August 2026 at 16:00');
is(`short is "Mon 3 Aug 2026, 16:00" (got "${short}")`,        short === 'Mon 3 Aug 2026, 16:00');
is('the long form carries no leading weekday comma', !/^[A-Za-z]+,/.test(long));
is('the short form lost its weekday comma',          !/^[A-Za-z]+,/.test(short));
// The widest date of the year, against the narrowest picture: 320px viewport, 100vw - 64px.
is('no month name is longer than September', 'September'.length >= 'February'.length);
console.log(bad ? `\n${bad} FAILED` : '\nall passed');
process.exit(bad ? 1 : 0);
```

- [ ] **Step 2: Run it to see the current formatter fail**

Change the two `dateFmt` lines in `stamp-check.mjs` to the formatter currently in `js/timeline.js:58-61`:

```js
const MYT_LONG = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: 'short',
  hour: '2-digit', minute: '2-digit', hour12: false,
});
const MYT_SHORT = MYT_LONG;
```

Run: `node <scratchpad>/stamp-check.mjs`
Expected: FAIL — both string assertions report `03 Aug, 16:00`, which carries no year and no weekday. Restore the new version afterwards.

- [ ] **Step 3: Replace the formatter**

In `js/timeline.js`, replace lines 56-62:

```js
// Malaysian, like every other clock on this page — the frames are stamped in unix seconds, and a
// viewer in another timezone must not see an axis that disagrees with the readings beside it.
const MYT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: 'short',
  hour: '2-digit', minute: '2-digit', hour12: false,
});
const stamp = ts => MYT.format(ts * 1000);
```

with:

```js
/* Malaysian, like every other clock on this page — the frames are stamped in unix seconds, and a
   viewer in another timezone must not see an axis that disagrees with the readings beside it.
   The full date, because the year range holds frames 365 days old and `14 Nov, 17:00` says the same
   thing about last November as about this one. The weekday earns its place on that range in
   particular: it aims at Monday 16:00, so the weekday is what shows the anchor holding.
   Two forms, because the long one does not fit a phone. Measured from the vendored Roboto at 11px
   over every weekday and month, `Wednesday 30 September 2026 at 16:00` is a 213.8px pill — and a
   320px viewport gives a 256px picture, where it overlaps the `live` pill in compare mode and covers
   83% of the photograph. The short form is 137.7px, 54% of that picture, and clears `live` by 70px.
   `en-GB` writes the short form as `Thu, 1 Jan 2026, 16:00` and the long one with no comma at all,
   joined by `at` — so one `replace` strips the weekday comma and does nothing to the long form. */
const dateFmt = w => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuala_Lumpur', weekday: w, day: 'numeric',
  month: w === 'long' ? 'long' : 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false,
});
const MYT_LONG = dateFmt('long'), MYT_SHORT = dateFmt('short');
// 600px is this repository's standing breakpoint. Read on each call rather than cached, so the
// stamp carries no state and needs no resize listener of its own.
const NARROW = matchMedia('(max-width: 600px)');
const stamp = ts => (NARROW.matches ? MYT_SHORT : MYT_LONG).format(ts * 1000).replace(',', '');
```

- [ ] **Step 4: Repaint when the viewport crosses the breakpoint**

`paint()` closes at line 165 (the `}` before the `thin()` comment block). Insert directly after it:

```js
/* A turn from landscape to portrait crosses the breakpoint, and the stamp on screen was written by
   the wider formatter. `paint()` is idempotent and re-reads `NARROW.matches`, so one line is the
   whole fix. Landscape is the roomier direction and would survive without this; portrait is the one
   that would keep a 213.8px pill on a 256px picture until the next frame. */
NARROW.onchange = () => paint();
```

- [ ] **Step 5: Run the check and syntax-check the module**

```bash
node <scratchpad>/stamp-check.mjs
cp js/timeline.js <scratchpad>/timeline.mjs && node --check <scratchpad>/timeline.mjs
```

Expected: `all passed`, exit 0, and no output from `node --check`.

- [ ] **Step 6: Look at the page, at both widths**

Hard-reload `https://flood-exp.test`. Open a camera lightbox.

1. At a desktop width, confirm the stamp under the picture reads like `Monday 3 August 2026 at 16:00`.
2. Open the browser device toolbar, set the width to **360px**, and confirm it reads like `Mon 3 Aug 2026, 16:00`.
3. Set the width to **320px**, press the compare button, drag the divider, and confirm the left stamp and the right `live` pill do not touch.
4. Resize across 600px while the clip is paused and confirm the stamp switches form without a further click.

- [ ] **Step 7: Commit**

```bash
git add js/timeline.js
git commit -m "The stamp says which day, and which year, and fits a phone

The lightbox stamp was "14 Nov, 17:00". The year range holds frames 365 days
old, so two frames a year apart printed the same string.

Desktop now reads "Monday 3 August 2026 at 16:00". Below 600px it reads
"Mon 3 Aug 2026, 16:00" — the long form is a 213.8px pill measured from the
vendored Roboto, and a 320px viewport gives a 256px picture, where it overlaps
the live pill in compare mode.

stamp() reads matchMedia per call, so it holds no state. One line binds
onchange to paint() for a turn to portrait."
```

---

## Task 4: Record the rule

**Files:**
- Modify: `CLAUDE.md` — the gotcha list, after the `rm -rf shots/` gotcha
- Modify: `docs/FEATURES.md:1285-1292` (the retention table)
- Modify: `docs/FEATURES.md` — append one section at the end

**Interfaces:**
- Consumes: the anchor values and the rule from Tasks 1 through 3. Nothing produces anything for a later task.

- [ ] **Step 1: Add the gotcha**

In `CLAUDE.md`, directly after the bullet that begins `**`rm -rf shots/` is a year of camera history**`, insert:

```markdown
- **A retention bucket aims at a clock time, and both sides must aim at the same one.** `SHOT_TIERS`
  carries a third number per tier — the anchor, which is the target time in UTC modulo the step — and
  `pruneShots()` keeps the frame **nearest** that target, not the newest in the bucket. `thin()` in
  `js/timeline.js` repeats the same expression and the same numbers, so the ruler and the clip cannot
  file one frame in two slots. Week aims at 01:00 MYT, month at 04:00 and 16:00, year at Monday
  16:00, and the three nest, so a frame keeps hitting its target as it ages between tiers. The old
  rule bucketed on `floor(ts / step)`, which aligns to **UTC** midnight: at +8 that put the week
  range on 01:30, the month on 07:30 and 19:30, and the year on a Thursday. Change an anchor in one
  file only and the two sides disagree about where a slot starts. `shots-test.php` asserts each
  anchor against `time()` — **never against the epoch**, because Malaysia ran UTC+7:30 until 1982 and
  PHP renders a 1970 instant 30 minutes early, which makes a correct constant look broken.
```

- [ ] **Step 2: Add the target column to the retention table**

In `docs/FEATURES.md`, replace the table under `### Retention` (lines 1285-1292) with:

```markdown
| age | kept | aims at (MYT) | frames in the matching scrubber range |
|---|---|---|---|
| ≤ 6 h | every frame | — | — |
| ≤ 24 h | one per 30 min | — | 48 |
| ≤ 7 days | one per 3 h | 01:00, then every 3 hours | 56 |
| ≤ 30 days | one per 12 h | 04:00 and 16:00 | 60 |
| ≤ 1 year | one per week | Monday 16:00 | 52 |
| older | deleted | — | — |
```

- [ ] **Step 3: Append the feature section**

Append to the end of `docs/FEATURES.md`:

```markdown
### A frame is filed under the clock time it aims at

Both sides of the archive bucketed a frame by `floor(ts / step)`. That expression aligns to UTC
midnight. Malaysia runs UTC+8, so the frame that survived landed at an hour nobody chose. The week
range sat on 01:30, the month on 07:30 and 19:30, and the year on a Thursday.

A tier now carries a third number, the **anchor**. The slot is
`floor((ts - anchor + step / 2) / step)` and the target is `anchor + slot * step`. The frame nearest
its target wins the slot.

| range | step | anchor | aims at (MYT) |
|---|---|---|---|
| week | 3 h | 7200 | 01:00, then every 3 hours |
| month | 12 h | 28800 | 04:00 and 16:00 |
| year | 7 d | 374400 | Monday 16:00 |

The three targets nest. 16:00 sits on the 3-hour grid, and Monday 16:00 sits on the 12-hour grid. So
a frame keeps hitting its target as it ages from one tier to the next. It does not drift once per
tier.

The rule bounds its own error. A frame never sits further than half a step from its target. A slot
with no frame is absent from the list. So "show the closest frame" needs no tolerance value and no
empty slots to skip.

`pruneShots()` and `thin()` write the same expression. A rule in one file only would let the ruler
and the clip file one frame in two slots.

### The stamp under the picture is a full date

`14 Nov, 17:00` says the same thing about last November as about this one, and the year range holds
frames 365 days old. The stamp now reads `Monday 3 August 2026 at 16:00`.

The weekday earns its place on the year range. That range aims at Monday 16:00, so the weekday is
what shows the anchor holding.

A phone gets `Mon 3 Aug 2026, 16:00` instead. Measured from the vendored Roboto at 11px over every
weekday and month, the long form is a 213.8px pill. `#lightbox img` caps at `min(968px, 100vw -
64px)`, so a 320px viewport gives a 256px picture. There the long form covers 83% of the photograph
and overlaps the `live` pill in compare mode. The short form is 137.7px and clears it by 70px.

`stamp()` reads `matchMedia('(max-width: 600px)')` on each call, so it holds no state. One line binds
`onchange` to `paint()`, for a turn from landscape to portrait.

`en-GB` writes the short form as `Thu, 1 Jan 2026, 16:00` and the long form with no comma at all,
joined by `at`. So one `String.replace` strips the weekday comma and does nothing to the long form.

### Trade-offs accepted

The first prune after this change deleted 88 of 1337 stored frames. Each one sat 33 to 119 minutes
from a frame that survived, in a window that steps 3 or 12 hours. One rule now covers the whole
archive, and no branch carries the old bucketing.

Retention works on age, so the grid fills as frames age into each tier. The month grid is correct 7
days after the change. The year grid is correct after 30 days. Frames already pruned keep their old
times.

A sparse archive still shows off-target frames. Capture runs when a poll runs, so a machine without a
cron stores frames in bursts. The closest frame to 04:00 can then be hours away. The stamp states the
real capture time, so the picture reports its own age.

### Not built

No viewer-facing time picker. Three fixed schedules cover the need. Add a picker when they stop.

No maximum distance, past which a slot shows nothing. The bucket rule already bounds the error to
half a step.

No rewrite of the frames already stored.
```

- [ ] **Step 4: Check the prose**

```bash
python "C:/Users/illus/.claude/skills/ste-writing/ste-lint.py" < docs/FEATURES.md
```

Expected: this file is 4271 lines of pre-existing prose, so the total will be large. Judge only the sections you added. Copy them to a scratchpad file and lint that on its own — aim for 0 on everything except `long_paragraph`, which counts each table row as a sentence and therefore reports a false positive on every table.

- [ ] **Step 5: Confirm nothing regressed**

```bash
php -l shots.php && php shots-test.php
cp js/timeline.js <scratchpad>/timeline.mjs && node --check <scratchpad>/timeline.mjs
curl -sk -o /dev/null -w '%{http_code} %{content_type}\n' "https://flood-exp.test/api.php?shots=1"
```

Expected: `all passed`, no `node --check` output, and `200 application/json`.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/FEATURES.md
git commit -m "Record the anchor rule, in both places that have to know it

CLAUDE.md gets the gotcha: the anchor lives in two files and both must agree,
and the test asserts against time() rather than the epoch because Malaysia ran
UTC+7:30 until 1982.

FEATURES.md gets the target column in the retention table, and the sections on
what was built, what it cost, and what was left out."
```

---

## Verification

Run after the last task:

```bash
php -l api.php && php -l sources.php && php -l shots.php
php shots-test.php                                   # must print "all passed"

# Every module still parses. node --check treats a bare .js as CommonJS, so copy to .mjs first.
T=<scratchpad>; for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done

# Every file still serves. Check the type, not the status — Herd answers a missing file with
# index.html and a 200, so a typo'd path passes a status check and fails in the browser.
for f in js/*.js css/*.css; do
  curl -sk -o /dev/null -w "%{content_type} $f\n" "https://flood-exp.test/$f"; done | grep -v 'javascript\|css'

curl -sk "https://flood-exp.test/api.php?shots=1" | head -c 200
```

Then hard-reload the page and open a camera lightbox. Step through all four ranges and confirm the stamps land on the stated clock times, at a desktop width and at 360px.

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task. The anchor rule and `SHOT_TIERS` go to Task 1. The three test assertions go to Task 1. `thin()`, `RANGES`, the range labels and the stale 6-hour comment go to Task 2. The frame stamp and both formatters go to Task 3. `CLAUDE.md` and `docs/FEATURES.md` go to Task 4. The accepted costs are recorded in Task 4 rather than implemented, which is correct — they describe what the change does, not work to do.

**Placeholders.** None. Every code step carries the literal text to write.

**Type consistency.** `SHOT_TIERS` rows are `[maxAge, every, anchor]` in Task 1 and read as `[, $step, $anchor]` in the same task's test. `thin(list, step, anchor)` is defined in Task 2 step 4 and called with `r.anchor` in step 5. `stamp(ts)` keeps one argument in Task 3 and its caller `labelAt()` is untouched. The anchors `7200`, `28800` and `374400` are identical in `shots.php`, `js/timeline.js`, `CLAUDE.md` and `docs/FEATURES.md`.

**One known risk.** Task 1 changes retention, and the first capture after it deletes 88 frames. The user accepted this. Nothing in this plan deletes `shots/` or `.history.db`.
