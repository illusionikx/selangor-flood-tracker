# Water Wash: Less Spotty, Then River Lines

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A river in flood reads as one flooded river on the map, and not as separate spots round each station.

**Architecture:** Two parts, and each one ships alone. Part A changes three tuned numbers of the water wash, so that the hills of nearby stations join. Part B draws the river line itself between stations, colored by their readings, from a new baked file of named rivers.

**Tech Stack:** Plain ES modules, canvas, Leaflet. One new PHP build script that reads OpenStreetMap through Overpass, run by hand. No new host for the browser.

**Spec:** The owner's message and screenshot of 2026-11-24. Three stations at danger near Kuala Selangor drew as three bullseyes joined by a pale tail.

## What causes the spots

- The wash draws a hill round each point. It holds no river data.
- A falloff power of 1.5 puts the red bands within 1.2 km of a station. The rest of the reach is tail.
- Stepped opacity draws the tail at 35% and the cores at 70%.
- The blend is 0.1, so nearby hills join only a little.

## Global Constraints

- The color language holds: yellow, orange and red, with the dark red for water on the ground.
- A station keeps its own class at its own point.
- No class shows that no station in reach reported. The blend cap stays.
- A calm station draws no hill. In Part B it does end a colored stretch.
- A redraw stays under 60 ms on the test storm at every zoom from 9 to 15.
- The legend and About still say that the color is station state, and not the edge of a flood.
- The browser contacts no new host. `water-build.php` and the new script run by hand.
- The rain layer does not change.
- The commit rule of the global `CLAUDE.md` holds. Part A is one commit and Part B is one commit.

## Review Focus

- Two stations at warning on different rivers, 3 km apart: no danger class between them. Part A, Task 1 owns the test. It exists and must still pass at the new blend.
- A danger station with a calm station downstream on the same river: the line fades to nothing before the calm station, and no color passes it. Part B, Task 3 owns the test.
- A station whose `basin` names a river that the file does not hold: it draws its hill as today and no line. Part B, Task 2 owns the test.
- A river with one station: a short colored stretch each way, and no color to the river mouth. Part B, Task 3 owns the test.
- Two rivers that meet: the color of one does not run up the other. Part B, Task 3 owns the test.

---

# Part A: Tune the hills

No new code path. Three values change, and one calculation gets a fast form.

### Task A1: Pick the values

**Files:** `heat-tune.html`

**Interfaces:**
- `heat-tune.html` gains one data source, `Flood cluster`. It places three stations at danger 8 to 12 km apart, with two calm stations between them. This is the case in the owner's screenshot, and the test storm does not hold it.

- [ ] **Step 1: Add the `Flood cluster` source to the page.**
- [ ] **Step 2: The owner tunes the water layer on that source.** Start values: falloff power 3, blend 0.3, lowest band opacity 0.45. Falloff power 3 puts the red bands out to 2.4 km, and 4 puts them out to 2.9 km.
- [ ] **Step 3: The owner sends the copied parameters.**

### Task A2: Ship the values

**Files:** `js/heat.js`, `heat-test.html`, `docs/FEATURES.md`, `docs/GOTCHAS.md`

**Interfaces:**
- The water layer options `hillPow`, `blend` and `minDefault` take the owner's values.
- `_interp()` gets a fast form for the chosen power. Power 3 is `s * Math.sqrt(s)`, and power 4 is `s * s`, where `s = dd / D02`. Any other power keeps `Math.pow`.

- [ ] **Step 1: Run `heat-test.html`.** Expected: PASS. This is the base.
- [ ] **Step 2: Set the values and the fast form.**
- [ ] **Step 3: Run `heat-test.html`.** Expected: PASS. Three tests guard the rules that a higher blend can break. They are "two stations at warning never add up", "a station keeps its class" and "a lone hill is a circle". If one fails, lower the blend and tell the owner.
- [ ] **Step 4: Time the redraw** on the test storm at zoom 9 to 15, median of 9. Expected: under 60 ms.
- [ ] **Step 5: Look at the map** in both themes on the `Flood cluster` source and on live data.
- [ ] **Step 6: Write the docs entry, run the full pass, and commit.**

---

# Part B: Color the river between stations

The correct picture of a river in flood is the river. Japan's flood service colors the river line. The first water plan listed this as "the correct method" and did not build it. The app held no table of which station stands on which river. Two facts make it possible now:

- 100 of 201 river stations carry `basin`, and it is the river name: `SG. KLANG`, `SG. SELANGOR`. The Selangor feed publishes it.
- OpenStreetMap river ways carry `name`. `water-build.php` reads those ways already and drops the name.

A station with no `basin`, or with a name that no line matches, keeps its hill. So Part B adds to the wash and replaces nothing on day one.

### Task B1: Bake the named rivers

**Files:** Create `reach-build.php`, `reaches.json`. Modify `CLAUDE.md` (file table).

**Interfaces:**
- `php reach-build.php` writes `reaches.json`. Run by hand, never in a request. It takes `--cached` to reuse the last Overpass answer, as `water-build.php` does.
- `reaches.json` is `{ "rivers": { "<key>": [ [[lng, lat], ...], ... ] } }`. One entry for each river name, and each entry is a list of lines.
- `<key>` is the normalized name. `reachKey(name)` lowercases, changes `sungai` and `sg.` and `sg` to `sg`, and removes spaces and periods. `Sungai Klang` and `SG. KLANG` and `SG.KLANG` all give `sgklang`.
- Lines of one river that share an end point are joined into one line. The points keep the Douglas-Peucker tolerance of `water-build.php`.
- The script prints the count of rivers, the file size, and each `basin` value from `.cache.json` that found no river.

- [ ] **Step 1: Write `reach-build.php` with a `--selftest`.** The self-test checks `reachKey()` on six spellings and the join of three lines that share end points.
- [ ] **Step 2: Run `php reach-build.php --selftest`.** Expected: PASS.
- [ ] **Step 3: Run the bake.** Record the match count. If under 70 of the 100 named stations match, stop and report the unmatched names before any client work.
- [ ] **Step 4: Check the size.** Expected: under 150 KB gzipped. If over, raise the tolerance or keep only rivers that a station names.

### Task B2: Match stations to lines

**Files:** Create `js/reach.js`. Test in `heat-test.html`.

**Interfaces:**
- `export async function loadReaches() -> Promise<void>`. Fetches `reaches.json` once. It runs on the first time the water wash turns on, and never on landing.
- `export function reachKey(name: string) -> string`. The same rule as the PHP.
- `export function snap(station) -> { key, line, at } | null`. `line` is the index of the line in that river, and `at` is the distance in km along it. It returns null in four cases. The station has no `basin`. No river has that key. The file is not loaded. The nearest point of the river is more than 500 m from the station.
- A station that returns null keeps its hill and gets no line.

- [ ] **Step 1: Write the failing tests.** `reachKey` on the six spellings. `snap` on a station 100 m from a line (a result), 800 m from it (null), and with an unknown `basin` (null).
- [ ] **Step 2: Run `heat-test.html`.** Expected: `ERROR`, the module does not exist.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `heat-test.html`.** Expected: PASS.
- [ ] **Step 5: Measure on the live payload.** Count the stations that snap, by river. State the count in the docs entry.

### Task B3: Draw the stretches

**Files:** `js/reach.js`, `js/render.js`, `js/heat.js`, `heat-test.html`

**Interfaces:**
- `export function stretches(stations) -> [{ points: [[lat, lng], ...], value: number }]`. Pure. It takes every river station that passes `heatOk()`, calm ones included, with its `waterValue()`.
- Between two neighbor stations on one line, the value runs in a straight line from one reading to the other, by distance along the river. A calm station counts as 0. A stretch under the wash floor (0.125) is not returned.
- Past the last station on a line, the value falls as one hill does, by distance along the river, and ends at `WATER_INTERP_KM`.
- A stretch never leaves its own line. Two rivers that meet do not share color.
- The output is cut into pieces of one class each, so each piece has one color.
- The lines draw on the water layer's own canvas, after the hills, as round-capped strokes. The width is 5 px at zoom 9 and 9 px at zoom 13 and above. They take the layer's classes, its dark set and its opacity. In stepped mode a line draws at the highest band's opacity, because the line is the measurement and the hill is the guess.
- `render()` sends the river stations to the layer through `heat.setReach(list)`. The layer redraws once.

- [ ] **Step 1: Write the failing tests.**

```js
// On a straight test river 20 km long, with the layer on:
// Danger at km 5 and danger at km 15: the line is danger class at km 10.
// Danger at km 5 and calm at km 15: the line is painted at km 8, and bare at km 14 and at km 16.
// One station at warning at km 10: painted at km 12, bare at km 21 and past the reach.
// Two rivers that cross at km 10, danger on the first only: the second river is bare 2 km from the crossing.
// A station that does not snap: no line, and its hill is still painted.
```

- [ ] **Step 2: Run `heat-test.html`.** Expected: FAIL, `stretches` is not exported.
- [ ] **Step 3: Implement `stretches()`, `setReach()` and the stroke pass.**
- [ ] **Step 4: Run `heat-test.html`.** Expected: PASS.
- [ ] **Step 5: Time the redraw** with lines on, at zoom 9 to 15, median of 9. Expected: under 60 ms.

### Task B4: Say what it shows, then check

**Files:** `index.html`, `css/chrome.css`, `docs/FEATURES.md`, `docs/GOTCHAS.md`, `docs/HEATMAP-WHITEPAPER.md`, `heat-tune.html`

- [ ] **Step 1: Add one line to the water legend tip.** Exact copy: `A colored river line joins two stations on the same river. It shows their readings, and the river between them is an estimate.`
- [ ] **Step 2: Add the same fact to the About Method section.**
- [ ] **Step 3: Add a "River lines" switch to `heat-tune.html`**, so the owner can compare the wash with and without them.
- [ ] **Step 4: Check against the alert design standard.** The line spreads a status color along a channel. It raises no alarm and joins no count. Write the rule-by-rule result in the docs entry.
- [ ] **Step 5: Write the docs entries.** One gotcha: a stretch never leaves its own line, and why.
- [ ] **Step 6: Look at the map** in both themes at 1536 px and 360 px, on the `Flood cluster` source, the test storm and live data.
- [ ] **Step 7: Run the full pass on both targets. Show the owner. Commit after the owner says the result is good.**

## Open decisions for the owner

1. **Hills under the lines.** Keep the hill of a station that has a line, or shrink it? Recommended: keep it for the first version, and decide after seeing both on the tuning page.
2. **Order.** Recommended: Part A first. It takes one session, and it can make Part B unnecessary.
3. **Stations with no `basin`.** 101 of 201 have none. They come from the national portal and the Kuala Lumpur feed. Recommended: leave them on hills. A later task can match them by nearest river within 150 m.

## Not in this plan

- **Flow direction.** The color runs the same both ways from a station. A flood wave travels downstream, and OpenStreetMap ways point downstream by convention, so a later task can shorten the upstream side.
- **Tributaries.** A river in flood backs up its tributaries. This plan colors only the river that the station names.
- **The tidal guard.** It still needs the 24-hour high from the server.

## Considered and not chosen

- **Reuse `rivers.json` as it is.** It holds 2,775 lines with no names. A station can then match its river only by distance, and two rivers that run close together swap.
- **Replace the hills with lines.** Half the stations have no `basin`, and a flood gauge stands on a street, not on a river.
