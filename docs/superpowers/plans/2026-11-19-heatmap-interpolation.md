# Rain Heatmap Interpolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw the rain wash as one continuous field of narrow color bands, interpolated from all rain gauges, wet and dry.

**Architecture:** `SoftHeat._field()` keeps its grid, its bucket index, `smoothGrid()` and `regionPath()`. A new layer option, `interp`, changes how a grid node gets its value. The value is a distance-weighted mean of every gauge near the node, and a dry gauge enters as zero. The wash is the area where that value is above a floor. The bands are 13 classes on the same value grid.

**Tech Stack:** Plain ES modules, `Float32Array`, canvas `Path2D`. No new dependency and no new host.

**Spec:** The owner's messages of 2026-11-19. The owner showed a model map with a continuous banded field and asked for that look. The owner accepted interpolation between gauges and asked for a challenge of the idea. The eight improvements in the reply are the design below.

## Global Constraints

- The rain layer alone changes. The water layer keeps its reach form, because a river level between two stations has no meaning.
- The data stays the JPS gauges. No radar and no model enter.
- Interpolate the weight (the class position from `RAIN_STOPS`), not the millimeters.
- A dry gauge supplies the value zero. Only a gauge that passes `heatOk()` and is not doubted enters, wet or dry.
- A gauge keeps its own reading: the pixel at each gauge shows the class of that gauge.
- Ground more than `COVER_KM` from every live rain gauge stays bare.
- The fill is flat bands with one-pixel antialiased edges. No blur reaches the picture.
- The Settings slider stays the one opacity control, with its 80% cap.
- A redraw at zoom 12 on the test payload stays under 60 ms.
- The legend tip and the About Method section say that the map estimates rain between gauges.
- The commit rule of the global `CLAUDE.md` holds.

## Decisions this plan reverses

| Recorded rule | Where | New rule |
|---|---|---|
| "Do not replace any of this with interpolation" | `docs/GOTCHAS.md`, the rain heat entries | The rain wash is an interpolated field, on the owner's decision of 2026-11-19 |
| "A dry gauge can deny ground, never supply a value" | The same entries | A dry gauge supplies zero |
| "Any new heat layer must go through `thinHeat()`" | `CLAUDE.md`, Conventions | The rain layer takes every gauge. A normalized mean cannot stack. The water layer still thins |
| A rain gauge speaks for 6 km (`RAIN_KM`) | `js/config.js`, the legend tip, About | A gauge influences ground up to 12 km. Ground past 10 km from every gauge is bare |

Each entry gets a dated line with the old rule, the new rule and the owner's decision.

## Review Focus

- A lone wet gauge with no neighbor: the value must fall with distance in rings, and must not paint one flat disc. Task 1 owns the test.
- A very heavy gauge beside light gauges: the pixel at the heavy gauge must still show very heavy after smoothing. Task 1 owns the test.
- Two gauges 50 m apart with unlike readings: the field must stay finite and show a value between the two. Task 1 owns the test.
- All gauges dry: the layer must draw nothing and must not throw. Task 1 owns the test.
- Zoom 15: the redraw must stay in budget with the 400 px cap lifted. Task 1 times it.

---

### Task 0: Commit the present work first

The working tree holds seven finished parts:

- The stale gate
- The flat classed wash
- The contour engine
- The smooth shapes
- The doubled steps
- The dark colors
- The names pane

All checks pass except the two old `map-limits-test.html` box assertions.

- [ ] **Step 1: Ask the owner for the word to commit.** One commit for that unit gives the interpolation work a clean base and a way back.

### Task 1: The interpolated field

**Files:** `js/config.js`, `js/heat.js`, `js/render.js`, `heat-test.html`

**Interfaces:**
- `js/config.js`:
  - `INTERP_KM = 12`. A gauge influences a node up to this distance.
  - `PRIOR_KM = 6`. The distance at which a lone gauge's value falls to half. The source is the Klang watershed influence range of about 6.3 km.
  - `COVER_KM = 10`. Ground farther than this from every live rain gauge is bare.
  - `RAIN_FLOOR = 0.125`. The wash exists where the value is above it. It is half way between a dry gauge (0) and the lightest rain (0.25).
- `rainHeat` takes `interp: true` and `groundKm: INTERP_KM`. The water layer does not take the option.
- `render()` passes every rain point to `rainHeat.setLatLngs()`, with no `thinHeat()`. The dry points still go to `setDry()`.

**The node rule, for a layer with `interp`.** Three symbols: `d` is the distance from the node to a gauge. `R` is `INTERP_KM` in pixels. `D0` is `PRIOR_KM` in pixels.

1. Each gauge inside `R` has the weight `w = taper(d / R) / (d² + 1)`. `taper` is the present `ramp()` from 0.5, so the weight reaches zero at `R` with no step.
2. The prior is a constant weight `w0 = 1 / D0²` for the value zero. It stands for "far from a gauge, assume no rain".
3. The value is `V = Σ(w × reading) / (Σw + w0)`. A dry gauge has the reading 0. At a gauge, `w` is very large, so `V` equals that gauge's reading.
4. The cover margin is `COVER_KM` in pixels minus the distance to the nearest gauge, wet or dry.
5. Smooth `V` with `smoothGrid()` at a sigma of `0.05 × R`. This removes the ring target around each gauge.
6. Put each gauge's reading back near the gauge: `V = Vs + (Vraw - Vs) × g`. `g` is 1 at a gauge and falls to 0 at two sigma from it.
7. The wash field is `F0 = min((V - RAIN_FLOOR) × R, cover margin)`. Smooth the cover margin before the `min`, as the reach margin is smoothed today.
8. Each class field is `Fk = min(F0, (V - edge) × R)`, as today.

**Why a prior.** A mean of one value is that value. With no prior, a lone wet gauge therefore paints one flat disc out to the mask. The prior makes the value fall with distance, so a lone gauge draws a hill with rings. A lone light gauge then reaches about 7 km, and a lone very heavy gauge reaches the 10 km mask.

**The 400 px cap does not apply to this layer.** The cap protected a blob whose cost grew with its radius. Here the cost of a node is the number of gauges inside `R`, and that number does not grow with zoom. `blobPx()` and `_fade` skip a layer with `interp`.

- [ ] **Step 1: Write the failing tests in `heat-test.html`.** Replace the rain assertions that describe a reach circle and a halfway line. Keep the `heatOk`, `classOf`, `smoothGrid`, pane, dark-color and opacity tests.

```js
// Exact at a gauge: one gauge at each of weights 0.3, 0.6 and 1. The pixel at the gauge holds its class color.
// A lone gauge at 0.6: the class at 2 km is not above the class at the gauge, and the class at 6 km
//   is below the class at the gauge. The wash ends before 10.5 km.
// Two equal gauges 8 km apart: the midpoint class is at most one band under the gauge class.
// A wet gauge (0.9) and a dry gauge 6 km apart: the pixel at the dry gauge is empty,
//   the pixel 1 km from the wet gauge is painted, and the classes fall in order along the line.
// A very heavy gauge (1) with four light gauges (0.3) 3 km around it: the pixel at the heavy gauge
//   holds the top color.
// Two gauges 50 m apart at 0.9 and 0.3: the pixel between them is painted in a legend color.
// All gauges dry: every probed pixel has alpha 0, and nothing throws.
// Bare ground: a pixel 11 km from the only gauge has alpha 0.
```

- [ ] **Step 2: Run `heat-test.html`.** Expected: FAIL, because the reach form draws a flat disc.
- [ ] **Step 3: Add the constants, the `interp` branch in the node loop, and the cap exemption.** The bucket size becomes `R` plus the smoothing margin, as today.
- [ ] **Step 4: Change `render()` to pass every rain point.**
- [ ] **Step 5: Run `heat-test.html`.** Expected: PASS.
- [ ] **Step 6: Time the redraw** at zoom 10, 12, 14 and 15 in test mode, median of 10. If zoom 12 exceeds 60 ms, raise the grid cell to 12 px and time again. Record all figures.
- [ ] **Step 7: Measure on the live payload.** Record how much of the coverage box paints, and the number of wet and dry gauges that fed the field.

### Task 2: Thirteen bands

**Files:** `js/config.js`, `css/chrome.css`, `index.html`, `heat-test.html`

**Interfaces:**
- `RAIN_CLASSES` and `RAIN_CLASSES_DARK` take 13 classes. The edges in mm an hour are 0, 2.5, 5, 7.5, 10, 15, 20, 25, 30, 37.5, 45, 52.5 and above 60.
- The weight edges are `RAIN_FLOOR`, then 0.3125 to 0.9375 in steps of 0.0625, then 0.999.
- Each new color is the OKLab midpoint of its two neighbors, in both sets. The 7 present colors stay.
- The legend ramp takes the 13 hard stops. The four JPS words stay under their edges. The tip states the mm steps.

- [ ] **Step 1: Write the failing test:** 13 classes in both sets, with the same edges. `classOf()` puts 2 mm, 3 mm, 12 mm and 61 mm in the right bands.
- [ ] **Step 2: Run it.** Expected: FAIL on the count.
- [ ] **Step 3: Compute the colors, and set the classes and the legend.**
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Compute the contrast between neighbor bands.** A ratio under 1.08:1 between two neighbors makes the band edge hard to see. In that case, tell the owner that 13 is too many.

### Task 3: Say what the map does

**Files:** `index.html`, `docs/FEATURES.md`, `docs/GOTCHAS.md`, `CLAUDE.md`, `docs/HEATMAP-WHITEPAPER.md`, `docs/VERIFY.md`

- [ ] **Step 1: Rewrite the rain legend tip.** Exact copy for the third paragraph: `The map estimates the rain between gauges. Each estimate is a mean of the gauges near it, and a nearer gauge counts for more. A gauge that reports no rain counts as zero. Ground more than 10 km from every gauge stays bare. A reading older than one day counts for nothing.`
- [ ] **Step 2: Rewrite the About Method section.** It states three facts. The rain map is an estimate between gauges. A storm cell between two gauges can be absent from the map. The water map makes no estimate.
- [ ] **Step 3: Add the dated lines to the four reversed entries.** Add one gotcha: the prior, the put-back near a gauge, and the cap exemption, with the fault each one prevents.
- [ ] **Step 4: Update the paper.** The Status section states the interpolation. The section on feathering keeps its research text, and a note says that the owner chose interpolation with knowledge of that research.
- [ ] **Step 5: Update `docs/VERIFY.md`.** The spacing sweep text names `GATE` and `RAIN_KM` for the water layer alone.

### Task 4: Look at it, the full pass, then the owner

- [ ] **Step 1: Look at the map.** Use both themes, at 1536 px and 360 px, at zoom 9, 11 and 13. Use test mode and live data. Save no screenshot in the repository.
- [ ] **Step 2: Run the full pass on both targets.** Run `npm run build:check`, then the six render checks with and without `?base=/site/`. Run `heat-test.html` and `map-limits-test.html` on the source.
- [ ] **Step 3: Show the owner.** Three numbers are tunable by eye, and the report names them: `PRIOR_KM`, `COVER_KM` and the band count.
- [ ] **Step 4: Commit after the owner says the result is good.**

## After this plan

- The rain total layer (3 h, 24 h, 72 h) from the first plan uses this engine. Totals vary more slowly across ground, so interpolation is most defensible there.
- The two old `map-limits-test.html` box assertions still fail. They need their own look.

## Considered and not chosen

- **Kriging.** It needs a fitted model of how rain varies with distance, per hour. The research found small gains over simpler methods at an hourly step.
- **Plain inverse-distance weighting with no prior and no smoothing.** It draws ring targets, and a lone gauge paints a flat disc.
- **A fade of opacity with distance from a gauge.** It puts certainty and value in one channel. That was the fault of the old soft wash.
- **Radar or a weather model as the source.** It adds a host and changes what the app is. The owner chose the gauges.
