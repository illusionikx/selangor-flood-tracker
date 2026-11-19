# Heatmap Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the two heat layers state only what the gauges measured, add a rain total layer, and publish the method in About.

**Architecture:** `SoftHeat` in `js/heat.js` keeps its field pass, its blend, its dry denial and `thinHeat()`. Three new layer options (`classes`, `crisp`, `alphas`) change how one cell takes its color and its alpha. A prototype flag switches those options on, and `heat-lab.html` shows the present form beside the new form. The owner decides at Gate A. Only then does a form become the default.

**Tech Stack:** Plain ES modules, Leaflet, the patched `vendor/leaflet-heat.js`, PHP 8 with sqlite for the outcome log. No new dependency.

**Spec:** `reports/Flood heatmap revamp research.md`. Task 4 moves it to `docs/HEATMAP-WHITEPAPER.md`.

## Global Constraints

- Class edges for hourly rain stay at 10, 30 and 60 mm/h (`RAIN_STOPS` in `js/config.js:343`).
- `RAIN_KM` stays 6 and `HEAT_KM` stays 5. Paint, denial and `thinHeat()` use one distance per layer.
- A dry gauge denies ground and never supplies a value. No task adds interpolation.
- A flood gauge is never rain evidence. The water layer gets no denial.
- `cov` stays a squared clamp of a sum in the soft form. Only the `crisp` option replaces it.
- No task puts trend, `eta` or `rising` into a heat color.
- No rain total carries a severity word or a status hue. The legend shows millimeters.
- Every heat color is a literal hex in JS, because a canvas cannot resolve a token. A gradient, its legend ramp and its doc entry move together.
- One string, `PREFS.heatLayer`, holds the heat choice. `syncHeat()` writes every control from it.
- Every string on screen is sentence case, with no hedge and none of the plumbing vocabulary.
- All prose in files follows the writing rules in the global `CLAUDE.md`.
- The owner's commit rule overrides the frequent commits of the skill. One commit closes one unit: Phase 1 after Gate A, then one per Phase 2 task group. Keep edits in the working tree until the owner sees the result.
- Fast checks run during the work. The full browser pass runs one time per unit, on both targets (`npm run build:check`, then `?base=/site/`).
- Each task appends its entry to `docs/FEATURES.md`. A new trap goes in `docs/GOTCHAS.md` and in the index in `CLAUDE.md`.
- The reference viewport is 1536 px wide. The phone width is 360 px. Both themes must pass.

## Review Focus

- A station online with a stamp older than one day: the wash must not paint it and must not let it deny ground. Task 1 owns the test.
- Two gauges of unlike class inside one reach: the classed form must draw only legend colors between them, never a fifth tint. Task 3 owns the test.
- A dry gauge beside a wet gauge in the crisp form: the wet gauge keeps full color at its own point, and the dry gauge keeps none. Task 3 owns the test.
- A rain total with a short window (`acc` span under 90% of the window): the total layer must leave that station out. Task 6 owns the test.
- A browser that holds an old `PREFS.heatLayer` value, or a value the new table does not know: `syncHeat()` must fall back to off and must not throw. Task 6 owns the test.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `js/util.js` | Modify | `heatOk(s)`, the one gate for every heat weight. `accPoint(s, win)` for the total layer |
| `js/config.js` | Modify | `RAIN_CLASSES`, `WATER_CLASSES`, `CLASS_ALPHAS`, `RAIN_BUPU`, later `ACC_STOPS`, `ACC_HEAT` |
| `js/heat.js` | Modify | `classOf()`, the three layer options, `heatForm()`, `setHeatForm()`, later the `HEATS` table and `accHeat` |
| `js/render.js` | Modify | The heat gate reads `heatOk()`. Later it fills the total layer |
| `index.html` | Modify | Legend tips, ticks, the reach line, the About Method section, later the menu rows and `lgAcc` |
| `css/chrome.css` | Modify | The stepped ramp rule, later `.ramp.acc` |
| `heat-test.html` | Modify | New assertion blocks. The present fourteen stay green on the soft form |
| `heat-lab.html` | Create | Two frames of the app side by side. Not a check, like `kind-color-lab.html` |
| `docs/HEATMAP-WHITEPAPER.md` | Create | The method paper that About links to |
| `api.php` | Modify (Task 8) | The outcome log and its `--selftest` cases |
| `paint-check.html` | Modify (Task 6) | The heat menu roll call gains the new rows |

---

# Phase 1: accuracy with no reversal, then the prototype

### Task 1: Stale readings leave the wash

**Files:**
- Modify: `js/util.js` (beside `isStale`, line 340)
- Modify: `js/render.js:128` and `js/render.js:148`
- Test: `heat-test.html`

**Interfaces:**
- Produces: `export const heatOk = s => boolean` in `js/util.js`. Its value is `hasInfo(s) && !isStale(s)`.

- [ ] **Step 1: Write the failing assertions in `heat-test.html`**, in a new block after the present ones. Read `parseMY()` in `js/util.js` first and build `updated` in the format it parses.

```js
const { heatOk } = await import('./js/util.js');
const stamp = ms => /* a string parseMY() reads, for Date.now() - ms */;
const g = (over) => ({ kind: 'rainfall', online: true, hourly: 4, updated: stamp(6e5), ...over });
ok('fresh gauge feeds heat',        heatOk(g({})) === true, '');
ok('two-day-old stamp feeds none',  heatOk(g({ updated: stamp(2 * 864e5) })) === false, '');
ok('offline gauge feeds none',      heatOk(g({ online: false })) === false, '');
ok('no reading feeds none',         heatOk(g({ hourly: null })) === false, '');
```

- [ ] **Step 2: Run `heat-test.html`** with the headless command in `docs/VERIFY.md`. Expected: an `ERROR` line, because `heatOk` is not exported.
- [ ] **Step 3: Add `heatOk` to `js/util.js`.** Replace `hasInfo(s)` with `heatOk(s)` at the two heat gates in `js/render.js` (the `near` weight and the rainfall branch). The dry side takes the same gate, because an old zero is no evidence of dry ground.
- [ ] **Step 4: Run `heat-test.html`.** Expected: every line starts `ok`, the present fourteen included.
- [ ] **Step 5: Measure the effect on the live payload.** Count the stations that `hasInfo()` passes and `heatOk()` drops, per kind, from `.cache.json`. Record the counts in the `docs/FEATURES.md` entry.

### Task 2: The legend states what the code does

**Files:**
- Modify: `index.html:1630-1678` (both legend sections)
- Modify: `heat-test.html:57`, `docs/GOTCHAS.md` near line 2222 (the stale `FEATHER (0.75)` text. The code holds 0.2)
- Modify: `CLAUDE.md` (the `MET_KM` index line says 15 and the code says 16.5)

- [ ] **Step 1: Search for every use of the old words.** Grep `violent` and `A dry gauge draws nothing` across `index.html`, `js/`, the six check pages and `docs/`. List each hit before any edit.
- [ ] **Step 2: Replace the copy.** Exact strings:
  - Tick and tip: `violent` becomes `very heavy`. The tip sentence becomes `Very heavy is above 60 mm.`
  - Rain tip, third paragraph: `Every rain gauge that reports counts. Each gauge speaks for 6 km. A gauge that reports no rain clears the color near it. Ground with no gauge in reach stays bare.`
  - Water tip, fourth paragraph: `A flood gauge past its 0.15 m mark goes straight to red. Water over a spot that floods is an observation, not a forecast.`
  - Both tips, last paragraph, add: `A reading older than one day colors nothing.`
- [ ] **Step 3: Make sure that the 0.15 m claim is true.** Read `gaugeStatus()`. Make sure that `status >= 1` starts at 0.15 m. If it starts at another mark, write that mark.
- [ ] **Step 4: Correct the three stale doc values** named under Files.
- [ ] **Step 5: Run `paint-check.html` and `m3-check.html` on the source.** Expected: no new `FAIL`. A check that asserts the old tick word fails here, and that check gets the new word.

### Task 3: The classed crisp form, behind a flag

**Files:**
- Modify: `js/config.js`, `js/heat.js`, `css/chrome.css`, `index.html` (legend ramps only)
- Create: `heat-lab.html`
- Test: `heat-test.html`

**Interfaces:**
- Produces in `js/config.js`:
  - `RAIN_CLASSES = [[0, RAIN_HEAT[1]], [0.5, RAIN_HEAT[2]], [0.75, RAIN_HEAT[3]], [0.999, RAIN_HEAT[4]]]`
  - `WATER_CLASSES = [[0, '#ffd166'], [HEAT_WARNING, '#ff9f1c'], [0.999, '#ff4d4d']]`
  - `CLASS_ALPHAS = [0.55, 0.7, 0.85, 1]`
  - `RAIN_BUPU = ['#b3cde3', '#8c96c6', '#8856a7', '#810f7c']` (ColorBrewer BuPu, the candidate ramp with no red)
- Produces in `js/heat.js`:
  - `export function classOf(v, classes) -> index`. It returns the last index whose edge is below `v`. Index 0 holds every `v` at or under the second edge.
  - Layer options `classes` (array or null), `crisp` (boolean), `alphas` (array or null). All three default to off, so the shipped map does not change.
  - `export function heatForm(search) -> { form: 'soft'|'flat'|'stepped', ramp: 'app'|'bupu' }`. Pure. It reads `heatform` and `heatramp` from a query string. An unknown value gives `soft` and `app`.
  - `export function setHeatForm({ form, ramp })`. It writes the options on both layers, sets `body.heat-classed`, and repaints.

**Cell rule for a layer with `classes`, in `_field()`:**
- Color: the hex of `classes[classOf(v, classes)]`, not `_grad[v]`. Parse the hex values one time per paint.
- With `crisp`, `cov` is 1 for any cell with a reading in reach.
- With `crisp`, `keep` becomes `keep >= 0.5 ? 1 : 0`. The boundary between a wet gauge and a dry gauge stays halfway.
- Alpha: `cov * keep * (alphas ? alphas[class] : 1) * 255`. The reading no longer sets the alpha.
- The `flat` form is `classes` and `crisp`, with `alphas` null. The `stepped` form adds `CLASS_ALPHAS`.

- [ ] **Step 1: Write the failing assertions**, as a second block in `heat-test.html` that runs after the present block and resets to `soft` at its end.

```js
const { setHeatForm, classOf, heatForm } = await import('./js/heat.js');
const { RAIN_CLASSES, RAIN_HEAT } = await import('./js/config.js');
ok('classOf light',      classOf(0.40, RAIN_CLASSES) === 0, '');
ok('classOf 10 mm edge', classOf(0.50, RAIN_CLASSES) === 0, '');   // 10 mm is light. JPS moderate is above 10
ok('classOf moderate',   classOf(0.60, RAIN_CLASSES) === 1, '');
ok('classOf very heavy', classOf(1,    RAIN_CLASSES) === 3, '');
ok('unknown flag is soft', heatForm('?heatform=x').form === 'soft', '');

setHeatForm({ form: 'flat', ramp: 'app' });
rainHeat.setDry([]); rainHeat.setLatLngs([[...WET, 0.6]]); rainHeat._redraw();
const core = pixAt(WET), rim = pixAt(east(-RAIN_KM * 0.9)), out = pixAt(east(-RAIN_KM * 1.08));
ok('flat: one alpha from core to rim', core.a === 255 && rim.a === 255, `${core.a} ${rim.a}`);
ok('flat: the class color exactly',    '#' + core.hex === RAIN_HEAT[2], core.hex);
ok('flat: nothing past the reach',     out.a === 0, String(out.a));

rainHeat.setLatLngs([[...WET, 0.95], [...east(RAIN_KM * 1.21), 0.35]]); rainHeat._redraw();
const legend = Object.values(RAIN_HEAT).map(h => h.slice(1));
const seam = [0.3, 0.5, 0.7, 0.9].map(f => pixAt(east(RAIN_KM * 1.21 * f)));
ok('flat: only legend colors between two gauges',
   seam.every(p => p.a === 0 || legend.includes(p.hex)), seam.map(p => p.hex).join(' '));

rainHeat.setLatLngs([[...WET, 0.9]]); rainHeat.setDry([DRY]); rainHeat._redraw();
ok('flat: a wet gauge keeps full color beside a dry one', alphaAt(WET) === 255, '');
ok('flat: a dry gauge keeps none',                        alphaAt(DRY) === 0, '');

setHeatForm({ form: 'stepped', ramp: 'app' });
rainHeat.setDry([]); rainHeat.setLatLngs([[...WET, 0.4]]); rainHeat._redraw();
ok('stepped: light rain draws at 0.55', Math.abs(alphaAt(WET) - 140) <= 2, String(alphaAt(WET)));
setHeatForm({ form: 'soft', ramp: 'app' });
```

- [ ] **Step 2: Run `heat-test.html`.** Expected: `ERROR`, because `setHeatForm` is not exported.
- [ ] **Step 3: Add the four constants to `js/config.js`**, each with a comment that names its pair (the gradient, the legend ramp).
- [ ] **Step 4: Implement `classOf`, the three options and the cell rule in `js/heat.js`.** A layer with null `classes` keeps the soft path byte for byte. The bilinear upscale stays, so a crisp edge is one cell (4 px) of antialias. The probes above sit more than one cell from every edge.
- [ ] **Step 5: Implement `heatForm` and `setHeatForm`.** Call `setHeatForm(heatForm(location.search))` one time at module scope in `js/heat.js`. `js/route.js` rewrites the path later, so the module reads the query first.
- [ ] **Step 6: Add the stepped legend.** In `css/chrome.css`, `body.heat-classed #legend .ramp` and `.ramp.rain` take hard-stop gradients of the class colors. A third rule, `body.heat-bupu #legend .ramp.rain`, takes `RAIN_BUPU`. The soft ramps stay as they are.
- [ ] **Step 7: Run `heat-test.html`.** Expected: every line `ok`.
- [ ] **Step 8: Create `heat-lab.html`.** It holds two `<iframe>` elements of `index.html`, the left with no flag and the right with the chosen flags. It holds four controls:
  - Form: `flat` or `stepped`.
  - Ramp: `app` or `bupu`.
  - Frame width: 768 px each, or 360 px each.
  - Reload.

  It prints no verdict. Both frames share `localStorage`, so one theme switch moves both. Put a comment at the top that names it "not a check and not part of the app".
- [ ] **Step 9: Make sure that the shipped map did not move.** Open the app with no flag. `heat-test.html` first block proves the soft form. Run `paint-check.html` on the source.
- [ ] **Step 10: Add the `heat-lab.html` row to the file table in `CLAUDE.md`** and the prototype entry to `docs/FEATURES.md`. State that the flag is temporary and that Task 5 removes it.

### Task 4: About gains a Method section, and the paper ships

**Files:**
- Modify: `index.html` (after the `Data sources` block, before `Credits`, near line 572)
- Create: `docs/HEATMAP-WHITEPAPER.md` (moved from `reports/Flood heatmap revamp research.md`)
- Modify: `.gitignore` (add `research_notes/` and `reports/`)

- [ ] **Step 1: Move the report** to `docs/HEATMAP-WHITEPAPER.md`. Add a `## Status` section at the top with two lists: what the app does today, and what waits for a decision. Compare each sentence in that section with the code before the save.
- [ ] **Step 2: Add the section to `#aboutBox`.** Exact copy:

```html
<h3>Method</h3>
<p class="muted">The heatmap colors the ground near a gauge. It models no rain and no water between
   gauges. A rain gauge speaks for 6 km, and a river or flood gauge for 5 km. A study of the upper
   Klang watershed measured about 6 km as the reach of one rain gauge.</p>
<p class="muted">A gauge that reports no rain clears the color near it. Ground with no gauge in
   reach stays bare. A reading older than one day colors nothing.</p>
<p class="muted">The rain colors are the intensity classes JPS uses. The map states no flood
   forecast from rain, because no published rain threshold exists for a flash flood in the Klang
   Valley.</p>
<div class="src">
  <a href="https://github.com/illusionikx/selangor-flood-tracker/blob/main/docs/HEATMAP-WHITEPAPER.md"
     target="_blank" rel="noopener">Heatmap method paper</a>
  <span class="muted">The research behind the heatmap, with its sources and its open questions.</span>
</div>
```

- [ ] **Step 3: Run `m3-check.html` and `route-test.html` on the source.** Expected: no new `FAIL`. The section uses only elements that About already holds.
- [ ] **Step 4: Add the `docs/FEATURES.md` entry.** It names the rule for this section: when a gate changes the heatmap, the same change updates this copy and the `Status` section of the paper.

### Gate A: the owner decides on the map

Run the full browser pass for Phase 1 on both targets. Then show `heat-lab.html` to the owner at 1536 px and at 360 px, in both themes, on rain and on water. The owner answers four questions. Each answer goes into `docs/FEATURES.md` with its date.

| Question | Options | Recorded decision it touches |
|---|---|---|
| A1. Form | `soft` (keep), `flat`, `stepped` | The rim and join design. "A heat layer's weight is its alpha" |
| A2. Classed color | Continuous gradient (keep), four flat classes | The ruling of 2026-08-26, in part |
| A3. Hourly ramp | App colors (keep), `RAIN_BUPU` with no red | The ruling of 2026-08-26, in full |
| A4. Water layer | Apply the A1 form, or keep soft until Task 7 | None |

Commit Phase 1 after the owner answers. Do not start Task 5 before the answers exist.

---

# Phase 2: build on the answers

### Task 5: Make the chosen form the default, and remove the flag

**Files:** `js/heat.js`, `js/config.js`, `css/chrome.css`, `index.html`, `heat-test.html`, `docs/GOTCHAS.md`, `docs/FEATURES.md`, `CLAUDE.md`

- [ ] **Step 1: If A1 is `soft` and A2 is "keep", delete the prototype.** Remove the three options, `heatForm` and `setHeatForm`. Remove the constants, the CSS rules and the second test block. Delete `heat-lab.html`. Then go to Step 6.
- [ ] **Step 2: Otherwise, set the chosen options as the layer defaults** in the two `new SoftHeat(...)` calls. Delete `heatForm`, the module-scope call and `body.heat-classed`. The stepped ramp rules become the plain `.ramp` rules.
- [ ] **Step 3: Rewrite the first block of `heat-test.html`.** Two groups of assertions describe the soft form: the soft edge, and the two join solidity figures. Replace them with the Task 3 probes. Keep the assertions on reach, denial, stacking and dry reach.
- [ ] **Step 4: If A3 chose `RAIN_BUPU`, replace `RAIN_HEAT`** and its three pairs: the gradient, `.ramp.rain`, and the tip sentence about the pin. Measure each class against both basemaps at 75% opacity and record the contrast.
- [ ] **Step 5: Add the two supports that a crisp edge needs.** A legend line under each ramp: `Each area shows its nearest gauges, up to 6 km.` (5 km for water). A class outline: a cell whose class differs from a 4-neighbor takes its class color darkened by 25%.
- [ ] **Step 6: Rewrite the doc entries that the decision reverses.** Each rewritten entry states the old rule, the date, and the owner's decision. The entries are:
  - "A heat blob's alpha is its colour as well as its size"
  - "A rim facing empty ground and a join between two blobs are different edges"
  - "A heat layer's weight is its alpha"
  - The color ruling entry
- [ ] **Step 7: Update the About Method copy and the paper `Status` section** to the shipped form.
- [ ] **Step 8: Run `heat-test.html`, then the full browser pass on both targets.**

### Task 6: The rain total layer

**Files:** `js/config.js`, `js/util.js`, `js/heat.js`, `js/render.js`, `js/ui.js:779-793`, `index.html`, `css/chrome.css`, `heat-test.html`, `paint-check.html:204`

**Interfaces:**
- `PREFS.heatLayer` gains three values: `acc3`, `acc24`, `acc72`. The present values keep their meaning.
- `js/config.js`:
  - `ACC_STOPS = { h3: [10, 30, 60, 100], h24: [20, 50, 100, 200], h72: [30, 80, 150, 300] }` in mm. These edges are bins and carry no severity. The owner can move them.
  - `ACC_HEAT = ['#b3cde3', '#8c96c6', '#8856a7', '#810f7c', '#4d004b']`, five classes, no status hue.
  - `ACC_HOURS = { h3: 3, h24: 24, h72: 72 }`
- `js/util.js`: `export function accPoint(s, win) -> [lat, lng, weight] | 'dry' | null`.
  - Four cases give `null`: `heatOk(s)` is false, `doubted(s)` is true, `s.acc?.[win]` is null, or the span is short. The span is the third element, and short is under 90% of `ACC_HOURS[win]`.
  - A total of 0 gives `'dry'`.
  - All other totals give the weight `(class index + 1) / 5`, with the class from `ACC_STOPS[win]`.
- `js/heat.js`:
  - `export const accHeat`, a third `SoftHeat` at `groundKm: RAIN_KM`, in the form that Gate A chose, with five classes.
  - `const HEATS = { water: {...}, rain: {...}, acc3: {...}, acc24: {...}, acc72: {...} }`. Each entry holds `layer`, `box` (the radio id), `label`, `icon`, `legend` (the section id) and, for totals, `win`. `syncHeat()` reads this table and holds no two-way choice. An unknown value reads as off.

- [ ] **Step 1: Write the failing assertions in `heat-test.html`.**

```js
const { accPoint } = await import('./js/util.js');
const a = (acc, over) => ({ kind: 'rainfall', online: true, hourly: 0, lat: 3.1, lng: 101.7,
                            updated: stamp(6e5), acc, ...over });
ok('35 mm in 3 h is class 3 of 5', accPoint(a({ h3: [35, 0, 3] }), 'h3')[2] === 0.6, '');
ok('a zero total is dry',          accPoint(a({ h3: [0, 0, 3] }), 'h3') === 'dry', '');
ok('a 48 h span is no 72 h total', accPoint(a({ h72: [120, 1, 48.3] }), 'h72') === null, '');
ok('a null window is left out',    accPoint(a({ h24: null }), 'h24') === null, '');
ok('a stale gauge is left out',    accPoint(a({ h3: [35, 0, 3] }, { updated: stamp(2 * 864e5) }), 'h3') === null, '');
```

- [ ] **Step 2: Run `heat-test.html`.** Expected: `ERROR`, `accPoint` is not exported.
- [ ] **Step 3: Add the constants and `accPoint`.** Run the test. Expected: `ok`.
- [ ] **Step 4: Add `accHeat` and the `HEATS` table. Rewrite `syncHeat()` on the table.** The legend title and ticks for a total come from the table: `Rain, last 3 h` and ticks `10 30 60 100 mm`.
- [ ] **Step 5: Fill the layer in `render()`.** Only the active window costs a loop: when `PREFS.heatLayer` starts with `acc`, collect `accPoint()` for that window, then `accHeat.setDry(dry)` and `accHeat.setLatLngs(thinHeat(points, RAIN_KM))`.
- [ ] **Step 6: Add the markup.**
  - Add three radio rows to `#heatMenu`, with the ids `acc3`, `acc24` and `acc72`.
  - Their labels are `Rain 3 h`, `Rain 24 h` and `Rain 72 h`. Their glyph is `rainy`.
  - Add one legend section, `#lgAcc`, with a ramp, ticks and a tip.
  - Tip copy: `The scale shows the rain total over the window, in millimeters. It names no flood risk. A gauge with a shorter record than the window is left out. Each gauge speaks for 6 km.`
  - Add `.ramp.acc` to `css/chrome.css`.
  - Bind the new radio ids in `js/ui.js:779`.
- [ ] **Step 7: Extend the roll call in `paint-check.html:204`** with the three rows, and add one case: a stored `heatLayer` of `'nonsense'` gives the chip label `Heatmap` and no throw.
- [ ] **Step 8: Measure on the live payload.** For each window, count the stations that paint, that deny, and that the short-span rule leaves out. Record the counts in `docs/FEATURES.md`.
- [ ] **Step 9: Write the alert design standard table for this layer** in `docs/FEATURES.md`, rule by rule, in the form of the example at `docs/FEATURES.md:7522`. The layer raises no alert, joins no count and states no severity.
- [ ] **Step 10: Update Help** (`Map controls`, `Glossary`), the About Method copy and the paper `Status` section. Run the full browser pass on both targets, at 1536 px and 360 px. Make sure that the chip row at 360 px still clears the strip below it.

### Task 7: The water layer decision, with a reach prototype

**Files:** `js/heat.js`, `heat-lab.html`. No shipped file changes before Gate B.

- [ ] **Step 1: Add a lab-only flag, `water=reach`.** With the flag, `js/heat.js` fetches `rivers.json` one time. After the water field paints, it strokes the river lines 5 px wide with the `destination-in` composite. The wash then shows only on a river line inside 5 km of a station at or past alert.
- [ ] **Step 2: Add the `reach` button and an `off` button to `heat-lab.html`**, so the owner sees three forms: the wash, the reach, and pins alone.
- [ ] **Step 3: State the known fault in the lab page.** The mask uses distance on the plane. A second river inside 5 km therefore takes the color too. A shipped form needs a station-to-river table.

**Gate B.** The owner picks one: keep the wash, ship the reach, or remove the water layer. "Ship the reach" reverses "the map draws no water of its own" and the assertion in `map-limits-test.html`. That choice gets its own plan, because it needs the station-to-river table and a new check. The other two choices are one small change each, recorded in `docs/FEATURES.md`.

### Task 8: The outcome log

**Files:** `api.php`, `docs/FEATURES.md`, `docs/GOTCHAS.md`

**Interfaces:**
- Table `event(station TEXT, ts INTEGER, kind TEXT, value REAL, rain TEXT, km REAL, h1 REAL, h3 REAL, h24 REAL, h72 REAL, PRIMARY KEY (station, ts))` in `.history.db`. `rain` is the id of the nearest rainfall station that `heatOk` accepts, inside 6 km. The four totals are its `acc` values at that poll, or null.
- Table `rainday(station TEXT, day TEXT, h1 REAL, h3 REAL, h24 REAL, PRIMARY KEY (station, day))`. One row per rainfall station per Malaysian day, with the highest value seen. It gives the days with heavy rain and no event, which a false alarm count needs.
- `function eventEdge(?float $before, float $now, float $mark): bool`. Its value is `$before !== null && $before < $mark && $now >= $mark`. A null `$before` is a first sample, and a first sample is no event.
- `RETAIN` does not prune either table.

- [ ] **Step 1: Add the failing cases to `php api.php --selftest`.** Read the top of `api.php` first: the selftest exits early, so `eventEdge` and its constants must stand above that exit.

```php
check('edge: rise through the mark',  eventEdge(0.05, 0.20, 0.15) === true);
check('edge: already over the mark',  eventEdge(0.20, 0.25, 0.15) === false);
check('edge: fall is no event',       eventEdge(0.20, 0.05, 0.15) === false);
check('edge: first sample is no event', eventEdge(null, 0.30, 0.15) === false);
```

- [ ] **Step 2: Run `php api.php --selftest`.** Expected: a fatal error, `eventEdge` is undefined.
- [ ] **Step 3: Implement `eventEdge` and the two tables.** Write an `event` row at the end of a refresh, inside the present lock. Two cases write a row:
  - A flood gauge depth rises through 0.15 m, and the frozen check does not doubt the gauge.
  - A siren status goes from 0 to 1, and its river check backs the siren.

  In the same pass, upsert `rainday` with `MAX()` for every rainfall station.
- [ ] **Step 4: Run `php api.php --selftest`.** Expected: all cases pass. Then run one refresh on the development machine and read both tables.
- [ ] **Step 5: Write the `docs/FEATURES.md` entry.** State what the log is for, that nothing on screen reads it, and the review date: the end of the monsoon season, March 2027. Add the gotcha that `RETAIN` must skip both tables.

---

# Phase 3: after one season of the log

No task in this phase starts before the March 2027 review. Each layer gets its own plan and goes through the alert design standard first.

| Layer | Starts when |
|---|---|
| Trend mark on the pin (river rate, rain building or easing) | The owner asks, after Gate B |
| Rain so far plus rain coming, from the MET rungs | A verification of the MET nowcast exists, or the log lets us score it |
| Ground wetness from 3-day and 30-day totals | The deployed archive holds 30 full days for most gauges |
| Count of observed signs per district | District shapes exist, and the log gives a false alarm rate |
| A rain threshold per place | The `event` and `rainday` tables hold one season, and a score of hits against false alarms supports a figure |

Seven things stay unbuilt, by decision:

- The return period
- The rain-to-trigger ratio
- Hours to danger for every river
- A weighted risk index
- A slope layer
- Interpolated isobands for the hourly reading
- Nearest-gauge cells
