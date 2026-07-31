# Camera on the alert path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the 90 camera archives to the rivers they point at. Stop the app calling a 24 km lens "nearest". Stop it calling a two-day-old picture "current".

**Architecture:** Four independent changes over one shared idea — a camera borrows the alert state of the river beside it. Client side, a new `js/clip.js` owns a 3-hour loop in the station panel, and `camAlert()` in `js/stations.js` answers "is this picture showing trouble". Server side, `?shots=` gains a tier per frame by replaying the live forecast function at a past sample index.

**Tech Stack:** PHP 8 (no framework), ES modules (no build step, no bundler), SQLite via PDO, Leaflet. No new dependencies in either language.

## Global Constraints

Copied verbatim from `CLAUDE.md` and the spec. Every task inherits these.

- **No build step.** Keep relative import specifiers with the `.js` extension. There is no resolver.
- **No new dependency**, browser or Composer. `vendor/` is hand-managed and `lib/` is server-only.
- **Traffic-light hues are status only.** River blue, rainfall violet, siren pink, gauge taupe and camera cyan name a kind. They must never signal severity.
- **Bump `?v=` on every stylesheet link in `index.html`** when any `css/*.css` file changes. Herd serves `max-age=10800`.
- **Hard-reload after a `js/` change.** ES module imports carry no cache guard.
- **All times are 24-hour and Malaysian.** Format anything built from a unix timestamp with `timeZone: 'Asia/Kuala_Lumpur'`. No `hour12` anywhere.
- **`isIgnored()` gates every alert surface.** Pins, heat, panel, ticker, toast — and now the camera triangle.
- **`-9999` means "no reading".** Never treat it as a level.
- **Never `rm .history.db`** to test a cold start. Never `rm -rf shots/`. To re-test capture, `rm shots/.last`.
- **Keep the refresh path inside the `flock` on `.refresh.lock`.**
- **Prose in files follows Simplified Technical English.** Active voice, one instruction per sentence, 20 words maximum, no semicolons, no contractions. Check with `python "C:/Users/illus/.claude/skills/ste-writing/ste-lint.py" < FILE`.
- **Update `docs/FEATURES.md` as part of the change**, not afterward.

**Constants introduced (exact values):**

| name | value | home |
|---|---|---|
| `CAM_MAX_KM` | `5` | `js/config.js` |
| `CAM_ALERT_KM` | `2` | `js/config.js` **and** `api.php` (both sides need it — comment each to point at the other) |
| `CLIP_WIN` | `3 * 3600` | `js/config.js` |
| `CLIP_MS` | `1000` | `js/config.js` |

**Verification ritual** — run after every task that touches the named layer:

```bash
php -l api.php && php -l sources.php && php -l shots.php     # any PHP change
php shots-test.php                                            # any shots.php change — must stay green
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done   # any js change
for f in js/*.js css/*.css; do \
  curl -sk -o /dev/null -w "%{content_type} $f\n" "https://flood-exp.test/$f"; done | grep -v 'javascript\|css'
```

The last one prints nothing when every file serves. Herd answers a missing file with `index.html` and
HTTP 200, so check the content type and never the status.

---

### Task 1: Cap the nearest camera at 5 km

The app offers a lens up to 24 km away and calls it nearest. A lens that far shows a different river.

**Files:**
- Modify: `js/config.js` — add one constant near `FLASH_MS`
- Modify: `js/stations.js:10-11` — `nearestCam`
- Check: `scratch/cam-range.php` (throwaway, delete after)

**Interfaces:**
- Consumes: nothing
- Produces: `CAM_MAX_KM` (number, km) exported from `js/config.js`. `nearestCam(from)` keeps its signature `(from: {lat,lng}) => station | null` and now returns `null` past the cap.

- [ ] **Step 1: Write the check that proves the current behavior is wrong**

Create `scratch/cam-range.php`:

```php
<?php
/* Throwaway. How far away is the camera each station currently calls "nearest"? */
$d = json_decode(file_get_contents(__DIR__ . '/../.cache.json'), true);
$st = $d['stations'] ?? [];
$km = function (array $a, array $b): float {
    $x = ($a['lat'] - $b['lat']) * 111;
    $y = ($a['lng'] - $b['lng']) * 111 * cos(deg2rad($a['lat']));
    return sqrt($x * $x + $y * $y);
};
$cams = array_values(array_filter($st, fn($s) => $s['kind'] === 'camera' && !empty($s['image']) && !empty($s['online'])));
$oth  = array_values(array_filter($st, fn($s) => $s['kind'] !== 'camera'));
$far = 0; $worst = 0; $keep = 0;
foreach ($oth as $s) {
    $best = INF;
    foreach ($cams as $c) $best = min($best, $km($s, $c));
    $worst = max($worst, $best);
    $best <= 5 ? $keep++ : $far++;
}
printf("cameras %d  stations %d\nkeep a link at 5km: %d\nlose one: %d\nfarthest 'nearest' today: %.1f km\n",
    count($cams), count($oth), $keep, $far, $worst);
```

- [ ] **Step 2: Run it and record the numbers**

Run: `php scratch/cam-range.php`
Expected, against the payload this plan was written from:

```
cameras 90  stations 591
keep a link at 5km: 441
lose one: 150
farthest 'nearest' today: 24.0 km
```

The 24.0 km is the defect. If your payload differs, use your own numbers in the commit message.

- [ ] **Step 3: Add the constant**

In `js/config.js`, directly above `export const FLASH_MS`:

```js
/* How far a camera may be and still be offered as this station's nearest view. It reached 24 km
   before this cap, which is a different river with different weather over it. 441 of 591 stations
   keep a link at 5 km; the 150 that lose one now say "no camera nearby", which is true and was not.
   CAM_ALERT_KM is a tighter, separate question — see stations.js. */
export const CAM_MAX_KM = 5;
```

- [ ] **Step 4: Apply the cap in the one place every surface reads**

In `js/stations.js`, replace the import line and `nearestCam`:

```js
import { state } from './state.js';
import { distKm, hasInfo } from './util.js';
import { CAM_MAX_KM } from './config.js';
```

```js
/* The cap lives here and nowhere else. camNear(), camLink() and the "you are here" card all call
   this, so one number keeps the three surfaces saying the same thing. Past the cap the callers
   already have the right words: "no camera nearby". */
export const nearestCam = from => state.data.reduce((best, c) =>
  c.kind === 'camera' && c.image && c.online && distKm(from, c) <= CAM_MAX_KM &&
  (!best || distKm(from, c) < distKm(from, best)) ? c : best, null);
```

- [ ] **Step 5: Syntax-check and look at the page**

Run: the `node --check` loop from the verification ritual. Expected: no `FAIL` lines.

Then hard-reload `https://flood-exp.test` and check two stations by eye:

1. A station with a camera on its own mast still shows **Show webcam**.
2. A station in a remote district now shows **no camera nearby** instead of a link reading `Nearest webcam · 14.2 km`.

- [ ] **Step 6: Commit**

```bash
rm -f scratch/cam-range.php
git add js/config.js js/stations.js
git commit -m "The nearest webcam is now within 5 km, or there is not one

nearestCam() returned the closest camera at any distance. The farthest it
offered was 24 km, which is a different river with different weather over
it, presented as this station's own view.

441 of 591 stations keep a link. 150 now say no camera nearby, which is
what was already true."
```

---

### Task 2: `camAlert()` — the alert a camera stands next to

**Files:**
- Modify: `js/config.js` — add `CAM_ALERT_KM`
- Modify: `js/stations.js` — add `camAlert`, extend the import

**Interfaces:**
- Consumes: `CAM_MAX_KM` from Task 1 (untouched here)
- Produces: `camAlert(cam) => { tier: 'now'|'soon', station: Station, km: number } | null`, exported from `js/stations.js`. Tasks 3 and 7 both call it.

- [ ] **Step 1: Add the constant**

In `js/config.js`, directly under `CAM_MAX_KM`:

```js
/* How close an alert must be before the picture is allowed to claim it. Separate from CAM_MAX_KM
   on purpose: 5 km answers "which camera do I offer", 2 km answers "does this frame show the
   trouble". So the app can offer a camera at 4.8 km and draw no warning on it, which is correct.
   api.php carries the same 2 for the timeline join. Change both together. */
export const CAM_ALERT_KM = 2;
```

- [ ] **Step 2: Add the helper**

In `js/stations.js`, extend the imports and append:

```js
import { distKm, hasInfo, isHot, isIgnored, tier, TIER_RANK } from './util.js';
import { CAM_MAX_KM, CAM_ALERT_KM } from './config.js';
```

```js
/* The worst alert within CAM_ALERT_KM of a camera, or null. Distance breaks a tie between two of
   the same tier.
   `stale` is excluded rather than ranked last. A stale alert stays in the panel, where a sentence
   explains that the telemetry died and the situation may have changed either way. A colored glyph
   on a photograph has no room for that sentence, and a warning nobody can qualify is the wrong
   claim to put on a picture.
   isIgnored() is applied here, not by the callers. PREFS.ignored is the one alarm-suppression
   control in this app and it already holds past the district filter, on the ticker and on the
   toast. This is a sixth surface and it obeys the same rule. */
export const camAlert = cam => state.data.reduce((best, s) => {
  if (!isHot(s) || isIgnored(s)) return best;
  const t = tier(s);
  if (t === 'stale') return best;
  const km = distKm(cam, s);
  if (km > CAM_ALERT_KM) return best;
  return !best || TIER_RANK[t] < TIER_RANK[best.tier] || (t === best.tier && km < best.km)
    ? { tier: t, station: s, km } : best;
}, null);
```

- [ ] **Step 3: Confirm the exports it leans on exist**

Run:

```bash
grep -n "export const isHot\|export const isIgnored\|export const tier\|export const TIER_RANK" js/util.js
```

Expected: four lines. `js/alerts.js` already imports `TIER_RANK`, so the export is there. Export it
if your grep says otherwise. Do not duplicate the map.

- [ ] **Step 4: Syntax-check**

Run: the `node --check` loop. Expected: no `FAIL` lines.

- [ ] **Step 5: Prove it fires, using test mode**

`js/test.js` fakes a flood in the copy of the payload the client holds. Open the page, turn on test mode,
then in the console:

```js
const { camAlert } = await import('./js/stations.js');
const { state } = await import('./js/state.js');
state.data.filter(s => s.kind === 'camera').map(c => [c.name, camAlert(c)]).filter(r => r[1]);
```

Expected: at least one row, each carrying `tier`, `station` and a `km` at or under 2.

- [ ] **Step 6: Commit**

```bash
git add js/config.js js/stations.js
git commit -m "A camera can now name the alert it is standing next to

camAlert() returns the worst tier within 2 km, nearest breaking a tie. It
drops stale, because a stale alert needs the sentence the panel gives it and
a glyph on a photograph has no room for one. It honors PREFS.ignored, which
every other alert surface already does."
```

---

### Task 3: Draw the triangle

**Files:**
- Modify: `js/popup.js` — `camImg()` gains the glyph, plus a new `camWarn()`
- Modify: `js/ui.js:512-536` — the lightbox opener
- Modify: `js/stations.js` — nothing. Task 2 finished it
- Modify: `css/map.css` — `.camwarn`
- Modify: `index.html` — bump `?v=`

**Interfaces:**
- Consumes: `camAlert(cam)` from Task 2
- Produces: `camWarn(cam) => string` (HTML, empty when there is no alert), exported from `js/popup.js`. Task 7 reuses it.

- [ ] **Step 1: Add the glyph builder to `js/popup.js`**

Extend the imports:

```js
import { nearestOf, nearestCam, camAlert } from './stations.js';
```

Add above `camImg`:

```js
/* The warning that rides a camera picture. Empty string when nothing near it is on alert, so it
   costs nothing to interpolate unconditionally.
   The disc is not decoration. A bare glyph lands on whatever the camera happens to be pointing at,
   and half this footage is bright sky or wet concrete. The pins carry a disc for the same reason. */
export const camWarn = cam => {
  const a = camAlert(cam);
  if (!a) return '';
  const what = a.tier === 'now'
    ? `${a.station.name} at danger`
    : `${a.station.name} forecast to reach danger${a.station.eta ? ` in ${a.station.eta} h` : ''}`;
  return `<i class="camwarn i i-warning t-${a.tier}" title="${what} · ${a.km.toFixed(1)} km away"></i>`;
};
```

- [ ] **Step 2: Put it inside the picture**

Replace `camImg` in `js/popup.js`:

```js
// Spinner lives on the wrapper; the img clears it on load, or swaps itself out on failure.
export const camImg = (c, alt) => `<div class="shotwrap">
  <img class="shot" src="${camSrc(c)}" alt="${alt}" data-name="${c.name}"
       onload="this.parentNode.classList.add('done')"
       onerror="this.parentNode.classList.add('done');
                this.replaceWith(Object.assign(document.createElement('div'),
                  {className:'muted',textContent:'image unavailable'}))">${camWarn(c)}</div>`;
```

- [ ] **Step 3: Put it in the lightbox too**

In `js/ui.js`, extend the imports with `byId` and `camWarn`:

```js
import { byId } from './stations.js';
import { camWarn } from './popup.js';
```

Inside the lightbox click handler, after `el('lbTitle').textContent = …` and before `showModal()`:

```js
  /* The same warning as the card, on the full-size view. The camera id is read back out of the
     proxied URL — `?cam=<n>` is the proxy's own shape, and the table's "show image" button builds
     the same URL, so both openers are covered by one rule. The static build hotlinks upstream and
     matches nothing here, which is correct: it has no archive and no payload behind it either. */
  const n = /[?&]cam=(\d+)/.exec(src || '')?.[1];
  const c = n ? byId('camera-' + n) : null;
  lightbox.querySelector('.camwarn')?.remove();
  if (c) lightbox.querySelector('.stage').insertAdjacentHTML('beforeend', camWarn(c));
```

- [ ] **Step 4: Style it**

Append to `css/map.css`:

```css
/* The alert marker on a camera picture. Top left, because the bottom carries the timestamp overlay
   JPS burns into its own frames and the right is where the lightbox close button lands.
   Absolute inside .shotwrap and inside .stage — both are already positioned. */
.camwarn {
  position: absolute; top: 8px; left: 8px; z-index: 2;
  width: 28px; height: 28px; font-size: 18px;
  display: grid; place-items: center; border-radius: 50%;
  background: rgb(0 0 0 / .55); pointer-events: auto; cursor: help;
}
.camwarn.t-now  { color: var(--s-danger); }
.camwarn.t-soon { color: var(--s-warning); }
```

- [ ] **Step 5: Confirm `.shotwrap` and `.stage` are positioned**

Run:

```bash
grep -n "position" css/map.css css/chrome.css | grep -i "shotwrap\|stage"
grep -n -B2 -A6 "^\.shotwrap\|^\.stage" css/*.css
```

If either lacks `position: relative`, add it in the same rule block that already exists. Do not
create a second rule for the same selector.

- [ ] **Step 6: Bump the stylesheet version**

In `index.html`, raise the `?v=` number on **every** `<link rel="stylesheet">`. They move together.

- [ ] **Step 7: Verify**

Run: the `node --check` loop and the content-type loop. Expected: no output from either.

Then turn on test mode and check by eye:

1. A camera card near the faked flood shows a red triangle on a dark disc, top left.
2. Hovering it names the station, the state and the distance.
3. Opening that camera full screen shows the same triangle on the large picture.
4. Ignoring the alerting station through its ⋮ menu removes the triangle on the next poll.
5. A camera far from any alert shows no triangle at all.

- [ ] **Step 8: Commit**

```bash
git add js/popup.js js/ui.js css/map.css index.html
git commit -m "A camera picture says when the river beside it is in trouble

A warning glyph on a dark disc, top left of the still and of the full-size
view. Red where a river is at danger, amber where one is forecast to reach
it, nothing where the alert is stale. The disc is there because half this
footage is bright sky."
```

---

### Task 4: `frameTiers()` — score a frame against the past, with a real test

This is the only non-trivial logic in the change, and the only part with a runnable check.

**Files:**
- Modify: `shots.php` — add `frameTiers()`
- Modify: `shots-test.php` — add a second section

**Interfaces:**
- Consumes: nothing
- Produces:
  `frameTiers(array $frames, array $samples, ?float $mark, float $riseEta, callable $assess): array`
  Returns `[frameTs => 'now'|'soon']`, holding only frames that were inside an alert.
  `$frames` and `$samples` are both ascending. `$samples` is `[[ts, level], …]` for **one** river.
  `$assess` has api.php's signature: `(array $pts, int $i, ?float $mark) => [?float rate, ?float eta]`.

- [ ] **Step 1: Write the failing test**

Append to `shots-test.php`, before the final exit line:

```php
/* --- frameTiers -------------------------------------------------------------------------------
 * The tier a frame was taken under. A wrong answer here paints a calm afternoon red, or leaves a
 * flood gray, and either one is a lie told by a color on a photograph.
 * The fake $assess below returns an ETA straight from a table, so this tests the join — which
 * sample a frame lands on, and the on-delay — and not the forecast maths. api.php's own assess()
 * is tested by the map every time it runs.
 */
echo "\nframeTiers:\n";

$mark    = 3.0;
$samples = [[1000, 1.0], [2000, 1.5], [3000, 2.0], [4000, 3.2], [5000, 3.4]];
//            i=0         i=1          i=2          i=3          i=4
// Fake forecast: index 2 and 3 are inside the cutoff, everything else is not.
$eta  = [0 => null, 1 => null, 2 => 1.0, 3 => 0.5, 4 => 0.2];
$fake = fn(array $pts, int $i, ?float $m) => [null, $eta[$i] ?? null];

$t = frameTiers([500, 1500, 2500, 3500, 4500], $samples, $mark, 3.0, $fake);

$ok('a frame older than every sample is unscored', !isset($t[500]));
$ok('a frame on a calm sample is unscored',        !isset($t[1500]));
// 2500 lands on index 1, whose own eta is null. One sample of climb is not a forecast.
$ok('one sample inside the cutoff is not soon',    !isset($t[2500]));
// 3500 lands on index 2: eta 1.0 and the sample before it 1.0. Two in a row is the on-delay.
$ok('two samples inside the cutoff is soon',       ($t[3500] ?? null) === 'soon');
// 4500 lands on index 3, level 3.2, at or over the mark. Observed beats forecast.
$ok('a level at the mark is now',                  ($t[4500] ?? null) === 'now');

$ok('no danger mark scores nothing', frameTiers([4500], $samples, null, 3.0, $fake) === []);
$ok('no samples score nothing',      frameTiers([4500], [], $mark, 3.0, $fake) === []);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `php shots-test.php`
Expected: a fatal error, `Call to undefined function frameTiers()`. That is the failure you want.
If the retention section above it already failed, stop and fix that first — it must stay green.

- [ ] **Step 3: Write the function**

Append to `shots.php`:

```php
/* --- the alert tier a frame was taken under ------------------------------------------------------
 * Cameras hold a year of frames. `.history.db` holds 30 days of levels. Where the two overlap, a
 * frame can be scored against what the river was doing at the moment the shutter went.
 *
 * `$assess` is api.php's own forecast function, passed in rather than copied. That is the whole
 * point: the past has to be judged by the rule the present is judged by, or the timeline and the
 * map disagree about the same river. It is a parameter and not an import because this file must
 * stay loadable by shots-test.php, which has no payload, no database and no network.
 * ponytail: one seam, one parameter. If a third caller ever needs it, move assess() into its own
 * file and import it in both places.
 *
 * Walks both lists together, so a camera with 170 frames and 1400 samples costs one pass, not
 * 170 searches.
 */
function frameTiers(array $frames, array $samples, ?float $mark, float $riseEta, callable $assess): array
{
    $out = [];
    if (!$samples || $mark === null) return $out;
    $n = count($samples);
    $i = 0;
    foreach ($frames as $ts) {
        while ($i + 1 < $n && $samples[$i + 1][0] <= $ts) $i++;
        if ($samples[$i][0] > $ts) continue;               // the frame predates every sample
        // Observed beats forecast. A river at its mark is not "expected to reach" anything.
        if ($samples[$i][1] >= $mark) { $out[$ts] = 'now'; continue; }
        $eta  = $assess($samples, $i, $mark)[1];
        $prev = $i > 0 ? $assess($samples, $i - 1, $mark)[1] : null;
        // Both inside the cutoff: the same on-delay the live flag uses. One sample is a spike.
        if ($eta !== null && $eta <= $riseEta && $prev !== null && $prev <= $riseEta) $out[$ts] = 'soon';
    }
    return $out;
}
```

- [ ] **Step 4: Run the test again**

Run: `php shots-test.php`
Expected: every line reads `ok`, both the retention section and the seven new assertions, and the
script exits 0.

- [ ] **Step 5: Lint**

Run: `php -l shots.php && php -l shots-test.php`
Expected: `No syntax errors detected` twice.

- [ ] **Step 6: Commit**

```bash
git add shots.php shots-test.php
git commit -m "A stored frame can be scored against the river it was watching

frameTiers() walks a camera's frames and a river's samples together and
returns the tier each frame was taken under. It takes api.php's own assess()
as a parameter, so the past is judged by the rule the present is judged by,
and shots-test.php can still run with no payload and no database.

Seven assertions cover the join and the on-delay, not the forecast maths."
```

---

### Task 5: `?shots=` returns a tier, and the timeline keeps working

The payload shape changes here. Its one existing consumer changes with it, in the same commit.

**Files:**
- Modify: `api.php` — hoist `$slope` and `$assess` to named functions, extend the `?shots=` handler
- Modify: `js/timeline.js:362-380` — parse the new shape

**Interfaces:**
- Consumes: `frameTiers()` from Task 4
- Produces:
  - `GET api.php?shots=<id>` returns `[[ts, tier, stationId], …]`, ascending by `ts`.
    `tier` is `"now"`, `"soon"` or `null`. `stationId` is a string like `river-123`, or `null`.
  - `js/timeline.js` exports an unchanged `openTimeline(src)`. Internally `all` stays a bare array
    of timestamps, and a new module-level `tierAt` is a `Map<number, {tier, id}>`. Task 6 reads it.

- [ ] **Step 1: Hoist the forecast to named functions**

In `api.php`, cut the `$slope` and `$assess` closures out of the refresh path and paste them as
plain functions **above** the `?cam=` handler, so the early-returning endpoints can reach them.
Keep the bodies byte for byte. Only the heads change:

```php
function slope(array $pts, int $at): ?float {
```

```php
function assess(array $pts, int $i, ?float $mark): array {
```

Inside `assess`, `$slope(...)` becomes `slope(...)`, and the `use ($slope)` clause goes.

Then in the refresh path, the two call sites become `assess($points, $last, $mark)` and
`assess($points, $last - 1, $mark)[1]`.

- [ ] **Step 2: Prove the hoist changed no behavior**

Run:

```bash
php -l api.php
grep -c 'assess(' api.php          # expect 4: the definition and three calls
grep -n 'use ($slope)' api.php     # expect no output
curl -sk https://flood-exp.test/api.php \
  | php -r '$d=json_decode(stream_get_contents(STDIN),true);
            $r=array_filter($d["stations"],fn($s)=>$s["kind"]==="river"&&$s["rate"]!==null);
            echo count($r)," rivers carry a rate, ",
                 count(array_filter($r,fn($s)=>$s["rising"]))," rising\n";'
```

Expected: the same two counts as before the edit. Record them before you start Step 1 so you have
something to compare against. A hoist that changes either number is a hoist that changed the maths.

- [ ] **Step 3: Add the constant and extend the handler**

Near `const SITE_M` in `api.php`:

```php
/* How close a river must be to a camera before its alert is allowed onto that camera's frames.
   js/config.js carries the same 2 for the live warning glyph. Change both together. */
const CAM_ALERT_KM = 2;
```

Replace the `?shots=` handler:

```php
/* ?shots=<id> — which frames exist, and what the river beside the camera was doing when each one
   was taken. The client asks once, when a lightbox opens, and again when a camera card opens.
   Shape is [[ts, tier, stationId], …]. `tier` is "now", "soon" or null.
   Three things leave a tier null, and all three show as an uncolored tick rather than a wrong one:
   the frame is older than the 30 days of levels we keep, no river sits within CAM_ALERT_KM, or the
   river publishes no danger mark to be measured against. Sirens are a fourth: they alert live but
   are never sampled into .history.db, so their past cannot be replayed at all. */
if (isset($_GET['shots'])) {
    header('Content-Type: application/json');
    header('Cache-Control: max-age=60');
    $id     = (int)$_GET['shots'];
    $frames = shotList($id);
    $rows   = array_map(fn($ts) => [$ts, null, null], $frames);

    $st  = is_file(CACHE) ? (json_decode(file_get_contents(CACHE), true)['stations'] ?? []) : [];
    $cam = null;
    foreach ($st as $s) if ($s['kind'] === 'camera' && $s['id'] === 'camera-' . $id) { $cam = $s; break; }

    if ($cam && $frames && is_file(HIST)) {
        $km = function (array $a, array $b): float {
            $x = ($a['lat'] - $b['lat']) * 111;
            $y = ($a['lng'] - $b['lng']) * 111 * cos(deg2rad($a['lat']));
            return sqrt($x * $x + $y * $y);
        };
        $db  = new PDO('sqlite:' . HIST);
        $sel = $db->prepare('SELECT ts, level FROM level WHERE station = ? AND ts >= ? ORDER BY ts');
        $best = [];   // frameTs => [rank, tier, stationId] — worst tier wins across nearby rivers
        foreach ($st as $r) {
            if ($r['kind'] !== 'river' || empty($r['danger']) || $km($cam, $r) > CAM_ALERT_KM) continue;
            $sel->execute([$r['id'], $frames[0]]);
            $samples = array_map(fn($x) => [(int)$x['ts'], (float)$x['level']], $sel->fetchAll(PDO::FETCH_ASSOC));
            foreach (frameTiers($frames, $samples, (float)$r['danger'], RISE_ETA, 'assess') as $ts => $t) {
                $rank = $t === 'now' ? 0 : 1;
                if (!isset($best[$ts]) || $rank < $best[$ts][0]) $best[$ts] = [$rank, $t, $r['id']];
            }
        }
        /* Only the worst-tier station rides along, so the client can drop a tick raised by a sensor
           the reader has ignored. It falls to uncolored rather than to the second-worst river.
           ponytail: two hot rivers within 2 km of one camera is rare. Build the fallback if it is
           not, which means sending a tier per station and letting the client pick. */
        foreach ($rows as $k => $row) {
            if (isset($best[$row[0]])) $rows[$k] = [$row[0], $best[$row[0]][1], $best[$row[0]][2]];
        }
    }
    echo json_encode($rows);
    exit;
}
```

- [ ] **Step 4: Check the new shape over the wire**

Run:

```bash
php -l api.php
curl -sk "https://flood-exp.test/api.php?shots=1" | head -c 200
```

Expected: something of the form `[[1784858204,null,null],[1785151460,null,null],…]`. All three slots
present on every row. `null` tiers are the normal case on a calm day — that is not a failure.

Run the retention check too, because `shots.php` is loaded by this path:

`php shots-test.php` — expected: all `ok`.

- [ ] **Step 5: Teach the timeline the new shape without changing anything else**

In `js/timeline.js`, add a module-level declaration beside `let all = [];`:

```js
let tierAt = new Map();   // frame ts -> {tier, id}, for the tick colors. Empty is the calm case.
```

In `reset()`, clear it alongside `all`:

```js
  tierAt = new Map();
```

In `openTimeline`, replace the fetch and the guard:

```js
  let rows = [];
  try {
    rows = await (await fetch(`api.php?shots=${id}`)).json();
  } catch { rows = []; }
  // Still the camera we opened? An impatient close-and-open-another beats a slow fetch otherwise.
  if (cam !== id || !Array.isArray(rows)) return;
  /* Rows are [ts, tier, stationId]. A bare number is the shape this endpoint returned before the
     tiers landed, and a response cached for its 60 seconds can still be that old — so read both
     rather than blank the scrubber for a minute after every deploy. */
  all = rows.map(r => Array.isArray(r) ? r[0] : r);
  tierAt = new Map(rows.filter(r => Array.isArray(r) && r[1]).map(r => [r[0], { tier: r[1], id: r[2] }]));
  if (all.length < 2) return;
```

Everything downstream — `thin`, `setRange`, `srcOf`, `paint`, `drawTicks` — keeps working on bare
timestamps and needs no edit in this task.

- [ ] **Step 6: Verify the lightbox still plays**

Run: the `node --check` loop. Expected: no `FAIL` lines.

Hard-reload, open a camera full screen, and check three things:

1. The scrubber appears and the clip plays on open, exactly as before.
2. The range buttons still switch windows.
3. The tick strip still draws one mark per frame.

No mark carries a color yet. That is Task 6.

- [ ] **Step 7: Commit**

```bash
git add api.php js/timeline.js
git commit -m "Every stored frame now arrives with the tier it was taken under

?shots= returns [ts, tier, stationId] in place of a bare timestamp. The tier
comes from replaying assess() at the sample the frame landed on, which
needed assess() and slope() hoisted out of the refresh path into named
functions the early endpoints can reach.

timeline.js reads both shapes, because a response cached for its 60 seconds
can still be the old one after a deploy. No mark carries a color yet."
```

---

### Task 6: Color the tick strip

**Files:**
- Modify: `js/timeline.js` — `drawTicks()`
- Modify: `css/chrome.css:933-946` — the tick rules
- Modify: `index.html` — bump `?v=`

**Interfaces:**
- Consumes: `tierAt` from Task 5, `isIgnored` and `byId`
- Produces: nothing new

- [ ] **Step 1: Import what the filter needs**

At the top of `js/timeline.js`, extend or add:

```js
import { byId } from './stations.js';
import { isIgnored } from './util.js';
```

Check for a cycle first: `js/stations.js` imports `state.js`, `util.js` and `config.js` only, so
`timeline.js → stations.js` adds no loop. Run `grep -n "^import" js/stations.js js/util.js` and
confirm neither one reaches back into `timeline.js`.

- [ ] **Step 2: Color the marks**

Replace `drawTicks()`:

```js
/* A ruler under the scrubber: one mark per frame. Marks taken while a river within CAM_ALERT_KM was
   at danger, or forecast to reach it, carry that tier as a color — so the strip answers "when did
   this start" without playing the whole clip.
   The reader's own ignore list is applied here rather than on the server, which never learns it. A
   tick raised by an ignored sensor falls back to plain, not to the next worst river. */
function drawTicks() {
  ticks.innerHTML = frames.map((ts, i) => {
    const a  = tierAt.get(ts);
    const st = a ? byId(a.id) : null;
    const on = !!a && !(st && isIgnored(st));
    const why = on ? ` · ${a.tier === 'now' ? 'at danger' : 'forecast'}` : '';
    return `<i data-i="${i}" title="${stamp(ts)}${why}" class="${on ? 't-' + a.tier : ''}"
               style="left:${i / scrub.max * 100}%"></i>`;
  }).join('') + (frames.length
    ? `<i class="now" data-i="${frames.length}" title="live" style="left:100%"></i>` : '');
}
```

`st` can be `null` when the tier came from a station that has since left the payload. That is not an
error and it must not suppress the color — a frame taken while a river was at danger was still taken
while a river was at danger. Only a station that is present **and** ignored turns the mark plain.

- [ ] **Step 3: Style the colored marks**

In `css/chrome.css`, directly under the `.tlticks i.now::before` rule:

```css
/* A frame taken while the river was in trouble. Taller and colored, so the strip shows when it
   started without anyone playing the clip. The `.now` mark keeps the accent and is a different
   thing entirely — that one means "the present", not "at danger". */
.tlticks i.t-now::before  { height: 100%; top: 0; width: 2px; background: var(--s-danger); }
.tlticks i.t-soon::before { height: 100%; top: 0; width: 2px; background: var(--s-warning); }
```

- [ ] **Step 4: Bump the stylesheet version**

In `index.html`, raise `?v=` on every `<link rel="stylesheet">`.

- [ ] **Step 5: Verify**

Run: the `node --check` loop and the content-type loop. Expected: no output from either.

Then, to see a colored tick you need history that crossed a danger mark. Two honest ways:

```bash
# Which cameras have a river within 2km that has ever been sampled at or over its danger mark?
curl -sk https://flood-exp.test/api.php | php -r '
$d=json_decode(stream_get_contents(STDIN),true);$s=$d["stations"];
$km=fn($a,$b)=>sqrt((($a["lat"]-$b["lat"])*111)**2+(($a["lng"]-$b["lng"])*111*cos(deg2rad($a["lat"])))**2);
foreach($s as $c){ if($c["kind"]!=="camera")continue;
  foreach($s as $r){ if($r["kind"]==="river"&&!empty($r["danger"])&&$km($c,$r)<=2)
    echo $c["id"]," <- ",$r["id"]," danger ",$r["danger"],"\n"; } }' | head
```

Take a camera id from that list, then read its frames back:

```bash
curl -sk "https://flood-exp.test/api.php?shots=<id>" | php -r '
$r=json_decode(stream_get_contents(STDIN),true);
$n=count(array_filter($r,fn($x)=>$x[1]!==null));
echo count($r)," frames, $n carry a tier\n";'
```

On a calm month `$n` is 0 and every tick stays gray. That is the correct answer, not a broken
feature. Confirm the coloring path itself by hand in the console:

```js
const t = await import('./js/timeline.js');   // open a lightbox first
// then, in the console, force one tick and redraw through the UI:
document.querySelectorAll('.tlticks i')[2].classList.add('t-now');
```

Expected: that mark turns full height and red, and stays 11px wide to click.

Also check the ignore path: ignore the river the tier came from, reopen the lightbox, and confirm
the marks go plain.

- [ ] **Step 6: Commit**

```bash
git add js/timeline.js css/chrome.css index.html
git commit -m "The tick strip says when the river was in trouble, not just when a frame exists

Marks taken while a river within 2 km was at danger turn red, forecast turns
amber, and the reader's ignore list is applied client-side because the
server never learns it. A month with no flood in it colors nothing, which
is the right answer rather than a broken strip."
```

---

### Task 7: The station panel plays the last 3 hours

**Files:**
- Create: `js/clip.js`
- Modify: `js/config.js` — `CLIP_WIN`, `CLIP_MS`
- Modify: `js/popup.js` — `camImg()` gains `data-clip` and a caption slot
- Modify: `js/map.js` — `openSide()` starts the clip, `closeSide()` stops it
- Modify: `css/map.css` — `.clipcap`
- Modify: `index.html` — bump `?v=`

**Interfaces:**
- Consumes: `camSrc` and the new constants from `js/config.js`, `noSec` and `ago` from `js/util.js`
- Produces: `start(root, cam)` and `stop()`, exported from `js/clip.js`

- [ ] **Step 1: Add the constants**

In `js/config.js`, under `CAM_ALERT_KM`:

```js
/* The station panel plays what it has of the last three hours, at a frame a second. Capture runs
   every 30 minutes (SHOT_EVERY in shots.php), so a full window is six frames and a six-second lap.
   Past three hours a picture is not current, which is the same word the cards use for a reading
   past a day. */
export const CLIP_WIN = 3 * 3600;
export const CLIP_MS  = 1000;
```

- [ ] **Step 2: Write the module**

Create `js/clip.js`:

```js
/* The station panel's camera clip: what we have of the last three hours, a frame a second.
 *
 * A card used to show one still and call it current at any age. Three hours is the line, because
 * that is the question a flood camera is opened with — "is it like this now" — and a picture from
 * yesterday answers a different one.
 *
 * No controls. The lightbox holds the transport, the scrubber and the compare divider, and two
 * places to learn one control is one too many. This is a picture that moves.
 *
 * The hard part is not the timer. `render()` rebuilds the open card on every poll, so the <img>
 * this module is writing to is replaced under it every few minutes. Restarting on each rebuild
 * would jump back to frame 0 while someone watched, so `start()` rebinds to the new nodes and keeps
 * its place instead. That is the whole reason this is a module with state rather than four lines in
 * popup.js.
 */
import { CLIP_WIN, CLIP_MS, camSrc } from './config.js';
import { noSec, parseMY, ago } from './util.js';

let id = null;      // camera id the running loop belongs to, or null
let shots = [];     // frame timestamps inside the window, ascending
let at = 0;         // position in `shots`; shots.length is the live still
let timer = null;
let img = null, cap = null, live = '';

export function stop() {
  clearInterval(timer);
  timer = null;
  id = null;
  shots = [];
  at = 0;
  img = cap = null;
}

// The live still is the last position, the same way the lightbox scrubber treats it: the clip is
// "how did it get to this", and a lap that stopped 30 minutes short of now never showed the this.
const srcAt = i => i >= shots.length ? live : `api.php?shot=${id}&t=${shots[i]}`;

function tick() {
  at = (at + 1) % (shots.length + 1);
  if (img) img.src = srcAt(at);
}

/* Bind to whatever nodes the card holds right now. Called on a fresh card and on every rebuild of
   the same card, so it must never reset `at`. */
function bind(box) {
  img = box.querySelector('img.shot');
  cap = box.querySelector('.clipcap');
  if (img && timer) img.src = srcAt(at);
}

export async function start(root, cam) {
  const box = root?.querySelector('[data-clip]');
  if (!box) return stop();
  const want = box.dataset.clip;
  if (want === id) return bind(box);     // same camera, same loop, new nodes
  stop();
  id = want;
  live = camSrc(cam);
  bind(box);

  let rows = [];
  try {
    rows = await (await fetch(`api.php?shots=${id}`)).json();
  } catch { rows = []; }
  if (id !== want || !Array.isArray(rows)) return;   // the reader moved on while we fetched

  const cut = Date.now() / 1000 - CLIP_WIN;
  shots = rows.map(r => Array.isArray(r) ? r[0] : r).filter(ts => ts >= cut);

  /* Fewer than two frames is not a clip. Keep the live still the card already drew — it came from
     JPS when the card opened, and an empty window means this server did not capture, not that the
     camera stopped. Reaching into the archive for an older frame here would replace a live picture
     with a stale one. */
  if (shots.length < 2) {
    shots = [];
    if (cap) cap.textContent = idle(cam);
    return;
  }

  if (cap) cap.textContent = `LAST 3 HOURS · ${shots.length} frames`;
  // Warm the whole lap before it starts. Six frames off local disk, served immutable for a year, so
  // every lap after the first is free — and without this the first lap flickers on every swap.
  await Promise.all(shots.map(ts => {
    const im = new Image();
    im.src = `api.php?shot=${id}&t=${ts}`;
    return im.decode().catch(() => {});
  }));
  if (id !== want) return;
  at = 0;
  if (img) img.src = srcAt(0);
  timer = setInterval(tick, CLIP_MS);
}

/* What the caption says when there is no clip: when this picture was taken, and whether that is
   still current. NOT CURRENT is the word the cards already print on a reading over a day old. */
function idle(cam) {
  const d = parseMY(cam.shot);
  if (!d) return 'LATEST IMAGE';
  const old = Date.now() - d > CLIP_WIN * 1000;
  return `${old ? 'NOT CURRENT' : 'LATEST IMAGE'} · ${noSec(cam.shot)}${old ? ` · ${ago(d)}` : ''}`;
}
```

- [ ] **Step 3: Confirm the helpers exist with those names**

Run:

```bash
grep -n "export const noSec\|export const ago\|export const parseMY" js/util.js
```

Expected: three lines. Check `ago`'s signature — if it takes a Date and returns a string like
`411.0h ago`, the code above is right. If it takes something else, adapt the one call in `idle()`
and nothing else.

- [ ] **Step 4: Give the picture a caption slot and a hook**

In `js/popup.js`, replace `camImg` (this replaces the version in Task 3, and keeps the glyph):

```js
/* Spinner lives on the wrapper; the img clears it on load, or swaps itself out on failure.
   `data-clip` is the hook js/clip.js looks for — it carries the numeric camera id the proxy uses,
   not the station id, because that is what ?shots= and ?shot= both take. */
export const camImg = (c, alt) => `<div class="shotwrap" data-clip="${c.id.split('-')[1]}">
  <img class="shot" src="${camSrc(c)}" alt="${alt}" data-name="${c.name}"
       onload="this.parentNode.classList.add('done')"
       onerror="this.parentNode.classList.add('done');
                this.replaceWith(Object.assign(document.createElement('div'),
                  {className:'muted',textContent:'image unavailable'}))">${camWarn(c)}
  <p class="clipcap"></p></div>`;
```

- [ ] **Step 5: Start and stop it with the panel**

First find the two local names this snippet assumes. Run:

```bash
grep -n "^import" js/map.js
grep -n "sideBody" js/map.js | head -3
```

The plan writes the body element as `sideBody`. Use whatever `map.js` actually calls it. If `byId`
is not already imported from `./stations.js`, add it to the existing import rather than writing a
second one.

Then import the module:

```js
import * as clip from './clip.js';
```

At the end of `openSide()`, after the body is in the DOM and the head has been lifted out:

```js
  /* The card holds at most one camera, and `data-clip` carries its proxy id. `start()` is
     idempotent by that id, which is what makes this safe to call again on every poll — render()
     re-runs openSide() for whatever is on screen, and a clip that restarted there would jump back
     to frame 0 while somebody was watching it. */
  const n = sideBody.querySelector('[data-clip]')?.dataset.clip;
  const cam = n ? byId(`camera-${n}`) : null;
  cam ? clip.start(sideBody, cam) : clip.stop();
```

In `closeSide()`, first line:

```js
  clip.stop();
```

- [ ] **Step 6: Style the caption**

Append to `css/map.css`:

```css
/* Under the picture, not over it. An overlay would land on the timestamp JPS burns into its own
   frames, and this caption is read once rather than watched. */
.clipcap {
  margin: 4px 0 0; font-size: 11px; color: var(--muted);
  text-align: center; letter-spacing: .02em;
}
.clipcap:empty { display: none; }
```

- [ ] **Step 7: Bump the stylesheet version**

In `index.html`, raise `?v=` on every `<link rel="stylesheet">`.

- [ ] **Step 8: Verify**

Run: the `node --check` loop and the content-type loop. Expected: no output from either.

Then hard-reload and check five things by eye:

1. Open a camera card. The caption reads either `LAST 3 HOURS · N frames` or `LATEST IMAGE · <time>`.
2. Where it reads `LAST 3 HOURS`, the picture changes about once a second and returns to the live
   still at the end of each lap.
3. Leave the card open across a poll — over five minutes. The clip does **not** jump back to the
   first frame, and the caption does not flicker.
4. Close the card and open another camera. The first clip stops. The new one starts from its own
   first frame.
5. On a camera with nothing captured in three hours, the card shows the live still and says so.

For point 3 you can force a poll instead of waiting: call `load()` from the console.

This machine holds 10 frames per camera, the newest about two days old, so expect state 5 on most
cameras here. That is the fallback working, not the clip failing. To see a real clip, either wait
for the archive to fill or run the capture path by hand:

```bash
rm shots/.last && curl -sk https://flood-exp.test/api.php > /dev/null   # one capture, then repeat
```

Never delete `shots/` itself. It is a year of history that cannot rebuild.

- [ ] **Step 9: Commit**

```bash
git add js/clip.js js/config.js js/popup.js js/map.js css/map.css index.html
git commit -m "A camera card plays its last three hours instead of one undated still

Three hours at a frame a second, no controls, ending on the live still. Past
three hours the picture is not current, which is the word the cards already
use for a reading past a day — and the fallback keeps the live still rather
than reaching into the archive for something older.

The module keeps its place across a rebuild. render() redraws the open card
every poll, and restarting there would jump back to frame 0 while somebody
was watching it."
```

---

### Task 8: Write it down

**Files:**
- Modify: `docs/FEATURES.md` — append one section
- Modify: `CLAUDE.md` — one file-table row, two gotchas

**Interfaces:** none.

- [ ] **Step 1: Append the feature section**

Add to `docs/FEATURES.md`, after the last section. Cover, in this order:

1. **What it does** — the four changes, one line each.
2. **Why the two radii are different numbers.** 5 km answers which camera to offer. 2 km answers
   whether the frame shows the trouble. The app can offer a camera at 4.8 km and draw no triangle.
3. **What the 5 km cap removed** — 150 of 591 stations lost a camera link that pointed up to 24 km
   away. Record the count. A future reader will ask if you measured it.
4. **Why the fallback keeps the live still** and does not show an older archived frame.
5. **Why `stale` draws no triangle** — a stale alert needs the sentence the panel gives it.
6. **What the timeline cannot say.** The app never samples sirens, so nothing can replay their past.
   Levels retain 30 days and frames retain a year, so the month and year ranges stay mostly
   uncolored. The static Pages build has no PHP. All three show as an uncolored tick, never a wrong
   one.
7. **Trade-offs accepted** — the 1.5 MB preload on first open, and the single worst-tier station id
   rather than a full per-station tier map.
8. **Not built** — a control on the panel clip, a higher capture rate near an alert, a siren history
   table, a second-worst fallback when the worst station is ignored.

- [ ] **Step 2: Update `CLAUDE.md`**

Add one row to the file table, in `js/` order:

```
| `js/clip.js` | the station panel's 3-hour camera clip — no controls, that is the lightbox's job |
```

Add two gotchas to the gotcha list:

```
- **`?shots=` returns `[ts, tier, stationId]`, not a bare timestamp.** Both readers (`timeline.js`,
  `clip.js`) accept a bare number too, because the response is cached for 60 seconds and a deploy
  can leave the old shape in flight. Do not remove that fallback while the cache header stands.
- **`clip.start()` must stay idempotent by camera id.** `render()` calls `openSide()` on every poll
  for the card on screen, and a clip that restarted there would jump back to frame 0 while somebody
  was watching it. It rebinds to the fresh nodes and keeps its place. Same rule as `openSide()`
  itself, for the same reason.
```

- [ ] **Step 3: Check the prose**

Run:

```bash
python "C:/Users/illus/.claude/skills/ste-writing/ste-lint.py" < docs/FEATURES.md
python "C:/Users/illus/.claude/skills/ste-writing/ste-lint.py" < CLAUDE.md
```

Aim for 0. Ignore `long_paragraph` counts raised by lists and tables of more than six rows — the
checker counts each row as a sentence, which is a known false positive.

- [ ] **Step 4: Run every check one last time**

```bash
php -l api.php && php -l sources.php && php -l shots.php
php shots-test.php
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
for f in js/*.js css/*.css; do \
  curl -sk -o /dev/null -w "%{content_type} $f\n" "https://flood-exp.test/$f"; done | grep -v 'javascript\|css'
curl -sk https://flood-exp.test/api.php \
  | php -r 'echo json_encode(json_decode(stream_get_contents(STDIN),true)["sources"]),"\n";'
```

Expected: no lint errors, `shots-test.php` all `ok`, no `FAIL` lines, no content-type output, and
every `parsed` counter in `sources` above 0. A `parsed: 0` means a scraped table moved and is not
caused by this work — but do not ship on top of it without knowing.

- [ ] **Step 5: Commit**

```bash
git add docs/FEATURES.md CLAUDE.md
git commit -m "Write down the camera alert path, and what it cannot say

Records the two radii and why they are different numbers, the 150 stations
that lost a camera link, and the three cases that leave a tick uncolored
rather than wrong."
```

---

### Task 9: Cluster sirens inside each tier of the alert list

Added after the plan was approved. It shares no code with the camera work and can land at any point.

**Files:**
- Modify: `js/alerts.js:117-120` — the comparator
- Modify: `docs/FEATURES.md` — one paragraph

**Interfaces:**
- Consumes: `tier`, `TIER_RANK`, `distKm` — all already imported by `js/alerts.js`
- Produces: nothing

- [ ] **Step 1: Read what the comparator does today**

Run: `sed -n '113,121p' js/alerts.js`

It sorts by tier, then by distance when the reader's position is known, and otherwise puts sirens
**first** and then sorts by `ratio`. Note that siren-first default. Step 2 reverses it.

- [ ] **Step 2: Group the kinds inside the tier**

Replace the comparator:

```js
  /* Tier before anything else. Nearest-first is the more useful order *within* a tier, but across
     tiers it would put a forecast two streets away above a river already over its danger mark on
     the other side of town — and only one of those is happening. Stale sinks to the bottom whatever
     the distance: it is the one group you cannot act on.
     Sirens then cluster inside their tier, after the rivers. Reading a list that alternates between
     a water level and a triggered siren means changing units on every row, and the two want
     different things from the reader — a level is a number to judge, a siren is already a decision
     somebody else made. Grouping costs the strict nearest-first order inside a tier, which is why
     it sits below tier and not above it.
     This reverses the old no-location default, which led with sirens. Swap the two operands to put
     sirens back on top. */
  write(hot
    .sort((a, b) => TIER_RANK[tier(a)] - TIER_RANK[tier(b)]
      || (a.kind === 'siren') - (b.kind === 'siren')
      || (hereAt ? distKm(hereAt, a) - distKm(hereAt, b)
                 : (b.ratio || 0) - (a.ratio || 0)))
```

- [ ] **Step 3: Syntax-check**

Run: the `node --check` loop. Expected: no `FAIL` lines.

- [ ] **Step 4: Prove the grouping with real rows**

Turn on test mode, open the alert panel, and read the order. Expected: inside `HAPPENING NOW` every
river comes first, then every siren. `FORECAST` holds no sirens at all, because `isHot()` only ever
marks a siren critical. Stale still sinks to the bottom.

Check the no-location case too. Deny geolocation, or clear `hereAt` from the console, and confirm
the list still groups and no longer leads with sirens.

- [ ] **Step 5: Write it down**

Add a paragraph to `docs/FEATURES.md` covering three points. What changed. Why grouping sits below
tier and not above it. That the old siren-first default is gone, and how to restore it.

- [ ] **Step 6: Commit**

```bash
git add js/alerts.js docs/FEATURES.md
git commit -m "The alert list groups its sirens instead of interleaving them

Inside a tier the rivers come first and the sirens follow. A list that
alternates between the two changes units on every row, and it asks the
reader to judge a number and obey a decision in the same breath.

Grouping sits below tier, never above it. A sounding siren must not fall
under a river that is only forecast to reach its mark."
```

---

## Notes for whoever executes this

**Task order matters in two places.** Task 5 changes the `?shots=` payload shape, so it must land
before Task 6 and Task 7, which both read it. Task 2 must land before Task 3. Tasks 1 and 4 depend
on nothing and can go first or last.

**The one runnable check is `php shots-test.php`.** Task 4 adds seven assertions to it. Every task
after that must leave it green. There is no other test suite in this repo and this plan does not add
one — see `CLAUDE.md` for why that is deliberate.

**A calm day hides most of this.** The colored ticks need a river that crossed its danger mark
inside the last 30 days. The triangle needs one on alert right now. Use `js/test.js` test mode
for the live surfaces. For the historical ones, accept an uncolored strip as the correct answer and
verify the coloring path by adding the class by hand in the console.

**This machine has a thin archive** — 10 frames per camera, newest about two days old, because
capture only runs when somebody polls the app. The 3-hour clip will show its fallback state on
almost every camera here. That is the feature working.
