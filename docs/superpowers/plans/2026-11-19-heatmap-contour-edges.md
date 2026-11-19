# Heatmap Lock and Contour Edges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw every edge of the locked flat wash as a smooth, antialiased contour where the data puts it, and keep the 80% opacity cap.

**Architecture:** `_field()` keeps its coarse 4 px grid, and the grid holds three continuous fields in place of colors. A second pass samples those fields at full canvas resolution with bilinear interpolation. It turns each field into a signed distance in pixels, and it sets each pixel's coverage from that distance across one pixel. The edge is then the true contour of the field, smooth between cells and antialiased over one pixel. No blur enters.

**Tech Stack:** Plain ES modules and canvas `ImageData`. No new dependency.

**Spec:** The owner's instruction of 2026-11-19 has four parts. Use the stepped form and the default ramp. Limit opacity to 80%. A later message changed the form to flat, so that the owner controls the opacity. Antialias the edges. Smooth the shapes like topography contours, and keep accuracy. The research is `docs/HEATMAP-WHITEPAPER.md`. This plan replaces Task 5 of `2026-11-19-heatmap-revamp.md`.

## Global Constraints

- The form is flat. A class is a color and nothing else, and the Settings slider is the one opacity control. The rain ramp is blue to purple, `RAIN_CLASSES`. The water wash keeps yellow, orange and red.
- No wash pixel is more opaque than 80% on screen. The open question below decides how.
- An edge is antialiased across one pixel and no more. A wider soft band is feathering, and the owner removed it.
- Accuracy: a smoothed edge sits within 1.5 px of the exact contour of the field. Every pixel more than 2 px from an edge takes exactly the class that `classOf()` gives for the field there.
- The reach does not change: 6 km for rain, 5 km for water.
- The halfway rule between a wet and a dry gauge, `thinHeat()` and the stale gate do not change.
- A redraw at 1536 x 864 costs at most 60 ms on the reference machine. Measure it before and after.
- The commit rule of the global `CLAUDE.md` holds. Phase 1 and this plan close as one commit, after the owner sees the result.

## Owner answers, 2026-11-19

1. The 80% cap applies to the top class. The steps are 50%, 60%, 70% and 80%. The Settings slider stays as it is, at 75% by default.
2. The default ramp is blue to purple, `RAIN_BUPU`.
3. The edge method is whichever draws faster. Task 2 builds both methods on the same field grids, times both, and keeps the faster one.
4. Contour lines: the owner wants to see them first. Task 2 builds them behind a lab switch. The owner decides after a look.

## Review Focus

- Two gauges of unlike class, close together: the class edge between them must be one smooth curve, with no step at each 4 px cell. Task 2 owns the test.
- A dry gauge beside a wet one: the halfway line must stay within 1.5 px of the line that the cell rule gives. Task 2 owns the test.
- A lone gauge: the reach edge must be a circle of radius `r` within 1 px, at 8 angles. Task 2 owns the test.
- Zoom 14 and 15, where the 400 px cap and `_fade` apply: the edge must stay one pixel wide. Task 3 owns the check.
- A high-DPI screen at 125%: the canvas is in CSS pixels, so the edge must not become two device pixels of blur. Task 3 owns the check.

---

### Task 1: Lock the flat form and the 80% cap (DONE 2026-11-19, with the flat form)

**Files:**
- Code: `js/heat.js`, `js/config.js`, `css/chrome.css`, `index.html`
- Checks: `heat-test.html`, `heat-lab.html`
- Docs: `CLAUDE.md`, `docs/FEATURES.md`, `docs/GOTCHAS.md`, `docs/HEATMAP-WHITEPAPER.md`

**Interfaces:**
- No per-class opacity exists. The slider maximum is 80%, in `HEAT_OPACITY_MAX` and in the `max` of `#washOpacity`.
- Both layers take `classes`, `crisp: true` and `alphas` as fixed options in their constructors.
- `heatForm()`, `setHeatForm()`, the module-scope call, `body.heat-classed` and `body.heat-bupu` are deleted.
- `heat-lab.html` stays until the owner decides on contour lines. It loses the form and ramp buttons, and it gains a lines switch in Task 2.

- [ ] **Step 1: Rewrite `heat-test.html`.** Delete the soft-form assertions that a crisp form cannot meet: the soft edge, the two join solidity figures, and the handover. Keep reach, denial, stacking, dry reach, `heatOk` and `classOf`. Add one assertion: no pixel on a line through four classes has alpha above `0.8 * 255`, plus 1 for rounding.
- [ ] **Step 2: Run it.** Expected: FAIL on the 80% assertion, because the top class draws at 255.
- [ ] **Step 3: Make the options fixed, and delete the flag and the soft path.** `_field()` loses the `_grad` branch. Grep for `RAIN_HEAT` and the `gradient` options. If no other file reads them, delete them. The stepped CSS rules become the plain `.ramp` rules, in `RAIN_BUPU`.
- [ ] **Step 4: Run `heat-test.html`.** Expected: PASS.
- [ ] **Step 5: Rewrite the doc entries that this reverses.** Each rewritten entry states the old rule, the date, and the owner's decision. The entries are:
  - The color ruling of 2026-08-26
  - "A heat blob's alpha is its colour as well as its size"
  - "A rim facing empty ground and a join between two blobs are different edges"
  - "A heat layer's weight is its alpha" Update the `heat-lab.html` row in `CLAUDE.md`. Update the About Method copy and the Status section of the paper.

### Task 2: Contour edges

**Files:** `js/heat.js`, `heat-test.html`

**Interfaces:**
- `_field()` writes three `Float32Array` grids, one value per 4 px cell:
  - `V`, the blended weight `wsum / sum`, or `NaN` where no reading reaches.
  - `R`, the reach margin in pixels, `r - d` to the nearest reading. It is negative outside every disc.
  - `G`, the dry margin, `wnear - dnear` scaled to `[-1, 1]` as `(wnear - dnear) / (wnear + dnear)`. It is `1` where no dry gauge reaches.
- `export function edgeCover(f, gx, gy) -> number` in `js/heat.js`. Pure. It takes a field value and its two gradient parts in pixel units. It returns `clamp(0.5 + f / hypot(gx, gy), 0, 1)`, which is the pixel's coverage across a one-pixel edge. A zero gradient returns `f > 0 ? 1 : 0`.
- Two painters read the same three grids. Both are built, and the slower one is deleted in Step 6.
  - `_pixels(ctx, V, R, G, cw, ch)` is the pixel pass below.
  - `_paths(ctx, V, R, G, cw, ch)` runs marching squares on each mask field. It turns the crossings into closed paths with linear interpolation. It fills each band with the canvas, which antialiases a path fill. A band is the class path and the next class path in one `evenodd` fill. The reach and the dry margin clip every band.
- Option `lines` (boolean, default false). It strokes each class edge and the reach as a 1 px line, in the class color darkened by 25%. The lab sets it from `?heatlines=1`, and nothing else does.

**The pixel rule.** For each canvas pixel:

1. Sample `V`, `R` and `G` with bilinear interpolation, at the pixel center in cell units. Take each gradient from the same bilinear patch, so no extra sampling is needed.
2. The ground coverage is `cR = edgeCover(R)` multiplied by `cG = edgeCover(G)`. A pixel on the wash must be inside the reach and on the wet side, so the two terms multiply.
3. For each class edge `e_k` with `k >= 1`, the class coverage is `ck = edgeCover(V - e_k)`. The classes nest, so `c1 >= c2 >= c3`.
4. The band weights are `1 - c1`, `c1 - c2`, `c2 - c3` and `c3`. The color is the band-weighted mix of the class colors. The alpha is `cR * cG`, because every class draws at one opacity and the canvas carries it.
5. Write the pixel straight to the layer canvas. The upscale with `drawImage` goes, because the pass already runs at full resolution.

**Why this keeps accuracy.** The contour of a bilinear field passes through the same points as the cell rule at every cell center. Between centers it curves where the old rule stepped. So it moves the edge only inside one cell, and a one-cell move is 4 px at most. The 1.5 px limit holds because the edges follow fields that are smooth at the scale of a cell: a circle of 158 px radius, and a blend kernel that spans the radius. The test measures it and does not assume it.

**Why this is not feathering.** Coverage falls from 1 to 0 across one pixel, from the distance to the contour. A pixel 1 px inside an edge is solid. The old soft rim fell over 2.35 km.

- [ ] **Step 1: Write the failing tests in `heat-test.html`.**

```js
const { edgeCover } = await import('./js/heat.js');
ok('edgeCover: on the line is half',  edgeCover(0, 1, 0) === 0.5, '');
ok('edgeCover: 1 px in is solid',     edgeCover(1, 1, 0) === 1, '');
ok('edgeCover: 1 px out is empty',    edgeCover(-1, 1, 0) === 0, '');
ok('edgeCover: steep field, 0.25 px', edgeCover(0.5, 2, 0) === 1, '');
ok('edgeCover: flat field is a step', edgeCover(0.1, 0, 0) === 1 && edgeCover(-0.1, 0, 0) === 0, '');

// A lone gauge: the 50% alpha crossing sits at r, within 1 px, at 8 angles.
// Two unlike gauges 1.21 r apart: along 20 parallel lines, the class edge crossings fit
// one smooth curve. The second difference of the crossing positions stays under 1 px.
// No run of more than 2 pixels on any line holds a color between two classes.
// A wet and a dry gauge: the 50% alpha crossing sits at the halfway line within 1.5 px.
// Every probe 3 px or more from an edge holds the class that classOf() gives.
```

- [ ] **Step 2: Run it.** Expected: `ERROR`, `edgeCover` is not exported.
- [ ] **Step 3: Implement `edgeCover`, the three grids, `_pixels` and `_paths`.** The cell loop keeps its bucket index. It stops writing color and writes the three grids. A temporary option `painter: 'pixels' | 'paths'` picks one.
- [ ] **Step 4: Run `heat-test.html` once with each painter.** Expected: PASS both times, earlier assertions included.
- [ ] **Step 5: Time both painters.** Time `_redraw()` with `performance.now()` at 1536 x 864, rain on, test mode, at zoom 10, 12 and 14. Take the median of 10 runs per painter per zoom, and the same for today's form. Record all nine figures in `docs/FEATURES.md`.
- [ ] **Step 6: Keep the faster painter, and delete the other one and the `painter` option.** Faster means the lower median at zoom 12, the usual view. If the winner exceeds 60 ms there, say so to the owner before the next task.
- [ ] **Step 7: Add the lines switch to `heat-lab.html`.** Both frames run the chosen painter. The left frame has no lines, and the right frame has lines.

### Task 3: Look at it, then the full pass

**Files:** `docs/FEATURES.md`, `docs/GOTCHAS.md`

- [ ] **Step 1: Look at the map** in both themes at 1536 px and 360 px, on rain and on water, at zoom 10, 12 and 14. Use Playwright at a device scale of 1.25 as well. Save no screenshot in the repository.
- [ ] **Step 2: Measure the darkest rain class against both basemaps** at its 80% step and the 75% slider. Record the contrast. If the dark theme reads weakly, put it to the owner.
- [ ] **Step 3: Run the full pass on both targets.** Run `npm run build:check`, then the six render checks with and without `?base=/site/`. Run `heat-test.html` and `map-limits-test.html` on the source.
- [ ] **Step 4: Write the `docs/FEATURES.md` entry.** State the contour method, the timing, and the reason the edge is one pixel. Add a gotcha: the pixel pass reads the fields, never the colors, so a future upscale of colors brings the staircase back.
- [ ] **Step 5: Show the owner.** Commit Phase 1 and this plan as one unit only after the owner says the result is good.

## After this plan

- The owner decides on contour lines from the lab. If the answer is yes, `lines` becomes a fixed option. If the answer is no, the option and its stroke go. Then `heat-lab.html` and its `CLAUDE.md` row are deleted.
