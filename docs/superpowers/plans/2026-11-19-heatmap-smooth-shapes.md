# Heatmap Smooth Shapes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Round every sharp corner of the wash, and keep each edge within a stated distance of where the data puts it. Double the color steps, remove the contour lines, and give the dark theme its own rain colors.

**Architecture:** The wash is the positive part of a margin field on an 8 px grid. Today each field is a `min()` of other fields, so every place where two of them meet is a corner. The plan blurs each margin field on the grid before marching squares traces it. A blurred field crosses zero along a rounded curve. This is "union, then smooth", applied to the shape and never to the picture: the fill stays one flat color and the edge stays one pixel wide.

**Tech Stack:** Plain ES modules, `Float32Array`, canvas `Path2D`. No new dependency.

**Spec:** The owner's message of 2026-11-19: keep the contour lines, and the shapes are still not smooth where blobs overlap. The owner suggested a union and then a smoothing pass, and asked for a check and a plan first.

## What the check found

A look at the map at zoom 11 in test mode, on the dark theme, shows two kinds of corner:

1. **Notches where two reach circles overlap.** The reach margin is `r` minus the distance to the nearest gauge. Its zero line is a union of circles, so two circles meet at a cusp.
2. **Straight cuts with pointed ends where a dry gauge takes ground.** The halfway rule draws a straight bisector between a wet and a dry gauge. Several dry gauges make polygon shapes, and each bisector ends in a sharp point where it meets a circle or another bisector. The pale "light" class areas show this most.

The class edges between two wet gauges are already smooth, because the blended reading is a smooth field.

## Global Constraints

- The fill is flat, one color per class. The edge is antialiased across one pixel. No blur reaches the picture.
- The smoothing radius scales with the reach: `SMOOTH = 0.1`, so the blur is `0.1 r`. At zoom 12 that is about 16 px, or 0.6 km. A fixed pixel radius eats small shapes at low zoom.
- Accuracy away from a corner: a straight edge does not move. A circle of radius `R` shrinks by about `σ² / (2R)`, which is 0.8 px at zoom 12.
- Accuracy at a corner: the edge moves by at most `0.1 r`, inward at a pointed corner and outward in a notch. That is the price of a rounded corner, and the owner accepts it by approving this plan.
- A redraw at zoom 12 on the test payload stays under 60 ms. Today it takes 34 ms.
- The reach, the halfway rule, `thinHeat()`, the stale gate and the 80% opacity cap do not change.
- The commit rule of the global `CLAUDE.md` holds. The whole heatmap unit closes as one commit, after the owner sees the result.

## Review Focus

- A notch between two overlapping circles: the edge must fill the notch, and must not move out more than `0.1 r`. Task 1 owns the test.
- A lone circle at zoom 9, where `r` is about 20 px: the shape must keep its size within 1.5 px. Task 1 owns the test.
- A straight halfway line far from its ends: it must stay within 1.5 px of the halfway point. The existing test covers it.
- A gauge at the edge of the canvas: the blur must not pull in values from outside the grid. Task 1 clamps at the border.
- Zoom 14 and 15, where `r` reaches the 400 px cap: the blur grows to 40 px, and the redraw must stay in budget. Task 1 times it.

---

### Task 1: Smooth the margin fields

**Files:** `js/heat.js`, `heat-test.html`

**Interfaces:**
- `export function smoothGrid(F, cw, ch, sigmaCells) -> void` in `js/heat.js`. Pure. It blurs `F` in place with three passes of a box blur on each axis, which approximates a Gaussian of `sigmaCells`. At the grid border it repeats the edge value, so nothing outside the grid enters. A sigma under 0.5 cells returns at once, because a blur that small moves nothing.
- `const SMOOTH = 0.1` in `js/heat.js`, beside `BLEND` and `GATE`, with a comment that states the accuracy bounds above.
- In `_field()`, after the node loop: blur `F0` once. Build each class field `Fk` from the blurred `F0` and the class margin, then blur `Fk` before it is traced.

- [ ] **Step 1: Write the failing tests in `heat-test.html`.**

```js
const { smoothGrid } = await import('./js/heat.js');
// A step field: a straight edge must not move.
// A grid of 40 x 40 with F = x - 20. After smoothGrid with sigma 3, F at x = 20 stays 0 within 0.01.
// A corner field: F = min(x - 20, y - 20). After smoothGrid, F at (20, 20) is below 0, so the corner is cut.

// Two wet gauges 1.6 r apart. The strict union has a notch on the bisector, 0.6 r from the axis.
// The edge on the bisector must sit beyond 0.6 r (the notch is filled), and within 0.7 r (the bound).

// A lone gauge at zoom 9: the reach is a circle within 1.5 px of r, as at zoom 12.
```

- [ ] **Step 2: Run `heat-test.html`.** Expected: `ERROR`, `smoothGrid` is not exported.
- [ ] **Step 3: Implement `smoothGrid` and call it in `_field()`.** Use a box radius from the standard three-pass formula, so that three passes give the stated sigma.
- [ ] **Step 4: Run `heat-test.html`.** Expected: PASS, with every earlier assertion. The circle test at zoom 12 expects a shrink of about 0.8 px. If it fails, the code changes. The 1.5 px tolerance stays.
- [ ] **Step 5: Time the redraw** at zoom 10, 12 and 14 in test mode, 10 runs each, median. Record the figures in `docs/FEATURES.md`. If zoom 14 exceeds 60 ms, cap the blur at 3 cells and say so.

### Task 2: Double the ramp

The owner's message of 2026-11-19 asks for twice the color steps, so the wash reads smoother. Each class splits in half. The JPS edges at 10, 30 and 60 mm stay, and a half step goes between each pair. The new colors are the OKLab midpoints of the present ones, so every present color stays where it is.

**The cost, from the research.** One map-reading study measured 91.9% correct answers on four classes against 68.2% on eight. More steps look smoother and are harder to read a value from. The legend keeps the four JPS words at their own edges, so a reader still finds the class by name.

**Files:** `js/config.js`, `css/chrome.css`, `index.html` (legend ticks and tips), `heat-test.html`

**Interfaces:**
- `RAIN_CLASSES`, seven classes. The weight edges come from `RAIN_STOPS`: 25 at 0 mm, 50 at 10 mm, 75 at 30 mm and 100 at 60 mm.

| Class | Rain in the last hour | Weight edge | Color |
|---|---|---|---|
| Light, lower half | above 0 to 5 mm | 0 | `#b3cde3` |
| Light, upper half | above 5 to 10 mm | 0.375 | `#9fb1d5` |
| Moderate, lower half | above 10 to 20 mm | 0.5 | `#8c96c6` |
| Moderate, upper half | above 20 to 30 mm | 0.625 | `#8c77b7` |
| Heavy, lower half | above 30 to 45 mm | 0.75 | `#8856a7` |
| Heavy, upper half | above 45 to 60 mm | 0.875 | `#863991` |
| Very heavy | above 60 mm | 0.999 | `#810f7c` |

- The top class is open, so it cannot split. That makes seven classes and not eight.
- `WATER_CLASSES` takes five classes, on the owner's answer of 2026-11-19: alert `#ffd166`, half way to warning `#ffb847`, warning `#ff9f1c`, half way to danger `#ff7a3d`, and danger `#ff4d4d`. The half steps sit at weight 0.53 and 0.84, half way between the meter's own slots.
- The legend ramp takes the same hard stops. The tick words stay `light`, `moderate`, `heavy` and `very heavy`, placed under the JPS edges.

- [ ] **Step 1: Write the failing tests.** `classOf()` puts 5 mm in light lower and 6 mm in light upper. 10 mm stays light upper. 61 mm is very heavy. Two gauges of unlike reading show only legend colors between them, with the off-legend limit raised to two pixels for each edge crossed.
- [ ] **Step 2: Run `heat-test.html`.** Expected: FAIL on the class counts.
- [ ] **Step 3: Set the classes, the legend ramps and the tick positions.**
- [ ] **Step 4: Run `heat-test.html`.** Expected: PASS.

### Task 3: Remove the contour lines

The owner chose on 2026-11-19 to remove every line. With twice the steps, a line at every edge draws twice as many lines, and the color step is the edge.

**Files:** `js/heat.js`, `heat-lab.html` (delete), `CLAUDE.md`, `docs/FEATURES.md`, `docs/HEATMAP-WHITEPAPER.md`

- [ ] **Step 1: Delete `LINES`, `darken()`, the `segs` argument and the stroke pass.**
- [ ] **Step 2: Delete `heat-lab.html` and its row in `CLAUDE.md`.**
- [ ] **Step 3: Run `heat-test.html`.** Expected: PASS.

### Task 4: Look at it, the full pass, then the owner

- [ ] **Step 1: Look at the map** in both themes, at 1536 px and 360 px, at zoom 10, 11 and 13, in test mode. Save no screenshot in the repository.
- [ ] **Step 2: Run the full pass on both targets.** Run `npm run build:check`, then the six render checks with and without `?base=/site/`. Run `heat-test.html` and `map-limits-test.html` on the source.
- [ ] **Step 3: Write the `docs/FEATURES.md` entry and a gotcha.** The gotcha: blur the margin field, never the picture, and scale the blur with `r`.
- [ ] **Step 4: Show the owner.** Commit the whole heatmap unit only after the owner says the result is good.

### Task 5: Rain colors for the dark theme

On a dark ground the present ramp inverts: light rain reads at about 6:1 and very heavy rain at about 1.5:1, by a computed estimate. The class that matters most is the one least visible. The research says that lightness must reverse on a dark ground. The owner said yes on 2026-11-19.

**Files:** `js/config.js`, `js/heat.js`, `css/chrome.css`, `heat-test.html`

**Interfaces:**
- `RAIN_CLASSES_DARK` in `js/config.js`: the same seven edges, and seven colors made in OKLab. Each color keeps the hue and chroma of its light-theme twin. Its lightness runs from 0.45 for the lightest rain to 0.85 for very heavy rain. Task 5 writes the hex values into the file and into the plan's entry in `docs/FEATURES.md`.
- `classesFor(layer) -> classes` in `js/heat.js`. On the dark theme (`document.documentElement.dataset.theme === 'dark'`) it returns the dark set for the rain layer. In every other case it returns the layer's own classes. The water layer keeps one set. Its colors already read at 3.3:1 or more on the dark ground.
- A theme change must repaint the wash. Find the place where `applyTheme()` in `js/map.js` fires, and call `redraw()` on both layers from there.
- `:root[data-theme="dark"] #legend .ramp.rain` takes the dark hard stops.

- [ ] **Step 1: Write the failing test.** Set `data-theme="dark"` on the root of the test page. Paint one gauge at very heavy. Assert that the pixel holds the dark set's top color. Put the theme back after.
- [ ] **Step 2: Run `heat-test.html`.** Expected: FAIL, because the light color draws.
- [ ] **Step 3: Compute the seven colors, and add the constant, `classesFor()`, the repaint and the legend rule.**
- [ ] **Step 4: Run `heat-test.html`.** Expected: PASS.
- [ ] **Step 5: Compute the contrast of each dark class against the dark ground**, at 75% and 80%, and record it. Very heavy rain must read at 3:1 or more.

### Task 6: Place names over the wash

The owner asked on 2026-11-19 whether the wash can sit under the borders and the place names. The place names already come as their own tile layer, in the `labels` pane at z-index 260 (`js/map.js:305`). The heat canvas goes into Leaflet's `overlayPane` at z-index 400, because the vendored `onAdd()` names that pane. So the wash covers every name today.

**Files:**
- Code: `js/map.js`, `js/heat.js`
- Check: `heat-test.html`
- Docs: `docs/FEATURES.md`, `docs/GOTCHAS.md`

**Borders stay under the wash, on the owner's answer of 2026-11-19.** The ground tiles carry them, and CARTO's names layer has none. They show through the wash at its opacity, and the Settings slider lowers it.

**Interfaces:**
- A `heat` pane in `js/map.js`, created beside `labels`, at z-index 250, with no pointer events. 250 sits above the ground tiles (200) and below the names (260).
- `SoftHeat` overrides `onAdd()` and `onRemove()` to put its canvas in that pane. `vendor/leaflet-heat.js` stays unpatched. The override copies the vendored body and changes the one pane.
- No new tiles load. The names layer already loads on every landing.

- [ ] **Step 1: Write the failing test.** Turn the rain layer on. Assert that the heat canvas's parent is the `heat` pane. Assert that its z-index is below the z-index of the `labels` pane.
- [ ] **Step 2: Run `heat-test.html`.** Expected: FAIL, because the canvas sits in `overlayPane`.
- [ ] **Step 3: Add the pane and the override.**
- [ ] **Step 4: Run `heat-test.html`.** Expected: PASS.
- [ ] **Step 5: Look at both themes.** The dark theme inverts the `labels` pane with a filter (`css/map.css:79`). Make sure that the filter does not reach the new pane. A filter on the heat pane inverts the wash colors.
- [ ] **Step 6: Run `map-limits-test.html` and `paint-check.html`.** Both read panes and z-indexes.

## Owner answers, 2026-11-19

1. The water wash doubles too, from three classes to five.
2. All contour lines go.
3. The dark theme gets its own rain colors, in Task 5.

## Considered and not chosen

- **A smooth minimum between pairs of margins.** It rounds a corner where two margins meet and leaves everything else exact. It only sees two fields at a time, so a corner where three dry gauges meet keeps its point. The blur handles any number.
- **Morphological closing and opening on a raster mask.** This is the literal union-then-smooth. It needs a distance transform of the mask on every redraw. The blur of the margin field gives the same rounded curve for less work.
- **Smoothing the traced polygon, for example with Chaikin's corner cutting.** It rounds the drawn line but not the field. The class colors and the contour lines can then part by up to a cell.
