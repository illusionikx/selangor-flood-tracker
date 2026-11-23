# Water Level Heatmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw the water level wash as a field of bands with rings, like the rain wash. Give water on the ground its own top class.

**Architecture:** The water layer moves to the grid engine that draws rain, `_interp()` in `js/heat.js`, with one new option, `combine: 'max'`. Each station past its alert mark draws a hill: its own value at the station, lower with distance. A grid node takes the highest hill that reaches it, not a mean. The reach form (`_field()`, `thinHeat()`, `BLEND`, `GATE`) then has no user, and it is deleted.

**Tech Stack:** Plain ES modules, canvas `Path2D`. No new dependency and no new host.

**Spec:** The owner's messages of 2026-11-19. The water layer follows the rain layer, and the flood gauges merge into it. The research is `research_notes/Flood heatmap revamp research/water_gauge_fusion.md`. The owner then chose three answers, listed below.

## Owner answers, 2026-11-19

1. **Highest hill wins.** A node takes the highest value of the stations near it. A calm station draws nothing and lowers nothing.
2. **Water on the ground has its own top class**, above a river at its danger mark.
3. **A flood gauge reaches as far as a river station.** The research calls street flooding very local and advised a shorter reach. The owner chose the same reach, and the legend states it.

## Why not a mean, as for rain

Rain is one field, so a mean of gauges is a fair guess. A river level belongs to one channel. The research found three faults in a mean of water stations:

- It paints classes between a danger station and a calm one that no sensor reported.
- It lets a calm river lower a danger reading on a different river.
- No flood service draws such an area. They draw points, river lines or whole districts.

The highest-hill rule keeps the look and removes the first two faults. One limit stays, and the legend must state it: the color shows station state near a point. It is not the edge of a flood.

## Global Constraints

- One value scale: 0.25 at the alert mark, 0.625 at the warning mark, 1 at the danger mark, and 1.25 for water on the ground.
- A hill is `value × 1 / (1 + (d / D0)²)`, with a taper to zero at `R`. `D0` is 5 km and `R` is 10 km. A value therefore halves at 5 km.
- The wash exists where the field is above 0.125. A station exactly at its alert mark then colors 5 km, which is the reach it has today.
- A station keeps its own class at its own point. No neighbor lowers it.
- A station under its alert mark, and a dry flood gauge, draw nothing.
- Only a station that passes `heatOk()` enters. A doubted flood gauge does not enter. The ignore list and the two pin filters gate the layer, as today.
- The bands stay yellow, orange and red. The new top class is a darker red.
- The fill is flat bands with one-pixel antialiased edges. The Settings slider stays the one opacity control.
- A redraw stays under 60 ms on the test payload at every zoom from 9 to 15.
- The rain layer does not change.
- The commit rule of the global `CLAUDE.md` holds.

## Decisions this plan reverses

| Recorded rule | Where | New rule |
|---|---|---|
| The water layer is thinned by `thinHeat()` | `CLAUDE.md`, Conventions | No layer is thinned. A highest-value field cannot stack. `thinHeat()` is deleted |
| One flat disc of 5 km for each station | `js/config.js`, the legend tip | A hill of bands that falls with distance, out to 10 km |
| A flooded gauge and a river at danger share the top red | `js/render.js`, the legend tip | Water on the ground has its own class |
| "The water map makes no estimate" | About, committed today | The color falls with distance from a station. It is station state, not flood extent |

"The water layer has no denial and must not get one" stays true. A calm station still lowers nothing.

## Review Focus

- A danger station with a calm station 1 km away: the danger station's rings are whole on all sides. Task 2 owns the test.
- Two stations at warning, 4 km apart: the ground between them is not above warning. A highest-value field cannot add. Task 2 owns the test.
- A flooded gauge beside a river at danger: the top class shows at the gauge, and danger red shows at the river. Task 2 owns the test.
- A river with no thresholds: it does not enter. Task 2 owns the test.
- All stations calm, the usual day: the layer paints nothing and does not throw. Task 2 owns the test.

---

### Task 1: Move the engine's numbers to layer options

**Files:** `js/heat.js`, `js/config.js`, `heat-test.html`

**Interfaces:**
- A layer with `interp: true` carries five options: `interpKm`, `priorKm`, `coverKm`, `floor` and `combine`.
- `combine` is `'mean'` or `'max'`. `_interp()` reads all five from `this.options`.
- `js/config.js` adds `WATER_INTERP_KM = 10` and `WATER_PRIOR_KM = 5`. `RAIN_FLOOR` stays, and the water layer passes the same 0.125.

- [ ] **Step 1: Run `heat-test.html`.** Expected: PASS. This is the base.
- [ ] **Step 2: Change `_interp()` to read its options, and set them on the rain layer.** No behavior changes.
- [ ] **Step 3: Run `heat-test.html`.** Expected: PASS, with the same output.

### Task 2: The water layer as highest hills

**Files:** `js/util.js`, `js/render.js`, `js/heat.js`, `heat-test.html`

**Interfaces:**
- `export function waterValue(s) -> number` in `js/util.js`. Pure. It returns 0 for a station that draws nothing.
  - Five cases give 0. `heatOk(s)` is false. The kind is not `river` or `gauge`. A river has no `levelStops()`. A flood gauge is doubted. A flood gauge has `depth <= 0`.
  - 1.25 for a flood gauge with `status >= 1`.
  - For all other stations, take `w`, the present weight on `levelStops()` or `gaugeStops()`. A `w` under 0.38 gives 0. A `w` from 0.38 to 0.68 runs in a straight line from 0.25 to 0.625. A `w` from 0.68 to 1 runs in a straight line from 0.625 to 1. The first formula in the draft put the warning mark at 0.613 and not 0.625.
- `render()` sends each station with a value above 0 to `heat.setLatLngs()`. It sends no dry list for this layer.
- In `_interp()`, `combine: 'max'` changes the node value to the highest `value × hill(d)` of the stations within `R`. The prior and the cover margin do not apply. The smoothing and the put-back near a station stay.

- [ ] **Step 1: Write the failing tests.**

```js
const { waterValue } = await import('./js/util.js');
// A river at its alert mark gives 0.25. At warning, 0.625. At danger, 1. Under alert, 0.
// A river with no thresholds gives 0. A stale river gives 0.
// A flood gauge with status 1 gives 1.25. With depth -0.2, it gives 0. A doubted one gives 0.

// On the canvas, with the water layer:
// A lone station at 0.25: painted at 4 km, bare at 6 km.
// A lone station at 1: the class at 0 km is danger, the class falls by 3 km, and the wash ends by 10.5 km.
// A danger station with a calm station 1 km away: the class 2 km past the calm station equals
//   the class 2 km the other way.
// Two stations at 0.625, 4 km apart: no pixel between them is above the warning classes.
// A flooded gauge (1.25) 3 km from a danger river (1): top class at the gauge, danger class at the river.
// No station past alert: every probed pixel has alpha 0.
```

- [ ] **Step 2: Run `heat-test.html`.** Expected: `ERROR`, `waterValue` is not exported.
- [ ] **Step 3: Implement `waterValue()`, the `max` branch, the layer options and the `render()` change.**
- [ ] **Step 4: Run `heat-test.html`.** Expected: PASS.
- [ ] **Step 5: Measure on the live payload.** Count the stations with a value above 0 by kind, and the share of the canvas that paints. On a calm day the wash is nearly bare, and that is the data.
- [ ] **Step 6: Time the redraw** at zoom 9 to 15, on live data and in test mode, median of 9.

### Task 3: Ten bands, and delete the reach form

**Files:** `js/config.js`, `js/heat.js`, `js/render.js`, `css/chrome.css`, `index.html`, `heat-test.html`, `docs/VERIFY.md`

**Interfaces:**
- `WATER_CLASSES` takes 10 classes. Four bands run from alert to warning. Four run from warning to danger. One stands at danger. One stands above it, for water on the ground.
- The weight edges are 0, 0.34375, 0.4375, 0.53125, 0.625, 0.71875, 0.8125, 0.90625, 0.995 and 1.12.
- Each new color between two present colors is their OKLab midpoint. The top class is a darker red, `#a3122f`, and Step 5 can change it.
- The legend ramp takes the 10 hard stops. The tick words are `alert`, `warning`, `danger` and `flooded`.
- `_field()`, `thinHeat()`, `BLEND`, `GATE`, `HEAT_KM`, `HEAT_MAX_PX`, `blobPx()`, `_fade` and `setDry()` for water are deleted. Grep for each name before the delete.

- [ ] **Step 1: Rewrite the reach-form tests.** The assertions on the reach circle, the halfway line, the notch and the join describe a form that no layer uses. Delete them. Keep two shape promises, on the water layer: an edge is one pixel wide, and a class edge is one smooth curve.
- [ ] **Step 2: Run it.** Expected: FAIL on the class count.
- [ ] **Step 3: Compute the colors. Set the classes, the legend ramp and the ticks. Delete the reach form.**
- [ ] **Step 4: Run `heat-test.html`.** Expected: PASS.
- [ ] **Step 5: Compute the contrast.** Check each band against its neighbor, and the top class against both basemaps at 75% opacity. A dark red reads weakly on the dark theme. If the top class is under 3:1 there, give the dark theme its own top color, as rain has.
- [ ] **Step 6: Remove the spacing sweep from `docs/VERIFY.md`.** It measured blob spacing, and no blob exists.

### Task 4: Say what the map does, then check and show

**Files:** `index.html`, `docs/FEATURES.md`, `docs/GOTCHAS.md`, `CLAUDE.md`, `docs/HEATMAP-WHITEPAPER.md`

- [ ] **Step 1: Rewrite the water legend tip.** Exact copy for the body:

```
Each station scores its reading against its own marks. A small stream at its limit counts the same as a big river at its limit.
A station past its alert mark colors the ground around it. The color is strongest at the station and falls with distance, to nothing at 10 km. Where two stations reach the same ground, the higher one shows.
A station under its alert mark colors nothing, and it lowers nothing.
The darkest red is water on the ground: a flood gauge with water over its warning mark. That is a measurement, not a forecast.
The color shows the state of the stations near a point. It is not the edge of a flood.
A reading older than one day colors nothing.
```

- [ ] **Step 2: Rewrite the second paragraph of the About Method section.** It states three facts. The water map shows station state, and the color falls with distance from a station. It is not a flood extent. Water on the ground is a measurement and has its own color.
- [ ] **Step 3: Add the dated lines to the four reversed entries.** Add one gotcha: the highest-value rule, and why a mean is wrong for a river level.
- [ ] **Step 4: Write the `docs/FEATURES.md` entry.** Include the research findings and their evidence quality. Include a rule-by-rule table against the alert design standard. The wash spreads status colors over ground near stations. It raises no alarm and joins no count. State that the owner chose a flood gauge reach equal to a river station's, against the research advice.
- [ ] **Step 5: Look at the map.** Use both themes, at 1536 px and 360 px, at zoom 9, 11 and 13. Use test mode and live data.
- [ ] **Step 6: Run the full pass on both targets.**
- [ ] **Step 7: Show the owner.** Commit after the owner says the result is good.

## Not in this plan

- **A guard for tidal stations.** The research advised that a tidal station draw only at or above its own 24-hour high. The server holds that figure and the payload does not carry it. It needs a server change and its own plan.
- **A short reach for flood gauges.** The owner chose the river reach. One option on the layer changes it later.

## Considered and not chosen

- **A weighted mean, as for rain.** The first draft of this plan. The research found the three faults above.
- **Interpolation along the river network.** It is the correct method for a river level. It needs river geometry and a table of which station stands on which river.
- **One tint for each district from its worst station.** It is the Jakarta model and the most defensible area form. It gives no rings, and the owner asked for the banded look.
