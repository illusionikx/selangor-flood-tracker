// The two heatmaps — water level, and rainfall — on one set of sizing and opacity controls.
// Flooding is catchment-scale, so a hotspot should mean "this part of Selangor", not "this station",
// and rain arrives over the same sort of area.
//
// **Read "gauge" in this file as a rainfall station.** It measures `hourly`, in mm/h, and it is the
// only kind either layer's rain half ever reads. A **flood gauge** is a different kind — `gauge` in
// the payload, `Flood gauge` on screen, `depth` in metres over a flood-prone spot. It feeds the
// *water level* layer beside the rivers, and nothing here paints, denies or thins it. The two names
// collide badly in one place: `api.php` records that a flood gauge reading negative means **dry
// ground**, so "a dry gauge" says one thing here and another thing there. Say which one.
//
// **A flood gauge is never evidence about rain, in either direction, and this is the rule to keep.**
// It measures what the drainage failed to carry away. Where the drainage is good, rain falls as hard
// as anywhere and the gauge stays clear. Where runoff arrives from upstream, the gauge goes under
// with no rain overhead at all. So a clear flood gauge cannot deny the wash above it, and a
// submerged one cannot paint. Only a rainfall station reports rain.

import { HEAT_KM, HEAT_MAX_PX, INTERP_KM, PRIOR_KM, COVER_KM, RAIN_FLOOR,
         RAIN_CLASSES, RAIN_CLASSES_DARK, WATER_CLASSES } from './config.js';
import { PREFS } from './state.js';
import { map } from './map.js';
import { el, setBox } from './util.js';

/* `radius` and `blur` size simpleheat's sprite, which `SoftHeat._redraw()` does not use — it paints
   the field itself. They stay because `_updateOptions()` reads them on add. No layer here sets a
   `gradient`, and `_redraw()` reads no colour table, so the field is the only thing that paints.
   maxZoom is not a display limit — leaflet.heat divides every weight by 2^(maxZoom - zoom), so any
   value inside our zoom range dims the blobs as you zoom out. 0 pins the factor at 1. */
const BASE = { radius: 70, blur: 55, maxZoom: 0 };

/* **A reading is a class, and a class is one flat colour.** Both layers are this class. It computes
   a field over the viewport and gives each cell the class its blended reading falls in. Water
   passes no dry gauges, so the dry side costs it nothing — a river reading low says nothing about
   the river beside it, and rain is the only reading here that argues with a neighbour.

   Four traps from the soft wash stay true, and the history is in docs/GOTCHAS.md. Never stamp a
   blob and composite it: every Porter-Duff `over` adds alpha, so a second blob made the same rain
   look heavier. Never erase with `destination-out` to take a dry gauge's ground back: it is a claim
   about the canvas and ate the neighbours' paint. Never fill a canvas radial gradient as a square:
   it clamps past its last stop and cut hard rectangles out of the wash. And never derive a colour
   from an alpha: simpleheat's `_colorize()` does, and a fading brush then walks down the legend. */

/* Two kernels, because a cell asks two questions and one curve cannot answer both. Both hold full
   strength across the inner fraction named here, then smoothstep to nothing at the radius.

   `BLEND` sizes the say each reading gets in the class the cell takes. It falls off early on
   purpose. A gauge most of a radius away must not argue as loudly as the one underfoot.

   `GATE` sizes the weight a gauge has when a wet gauge and a dry one argue over a cell. It is what
   `FEATHER` was before 2026-11-19, when the same 0.2 also shaped a soft rim. The rim is gone and the
   gate keeps the number, because the halfway line between a wet and a dry gauge is measured with
   it, and heat-test.html asserts that line.
   **Both are shared by the two layers and neither is a rain setting.** That works because the two
   networks land at nearly the same spacing once measured in radii. Rainfall at 6 km reads
   1.21 / 1.66 / 1.95 for median, 90th percentile and widest. Water at 5 km reads
   1.18 / 1.68 / 1.99. **If a change ever pulls those two rows apart, `GATE` becomes a per-layer
   option beside `groundKm`.** The spacing sweep in docs/VERIFY.md prints both rows. Re-run it after
   any change to `HEAT_KM`. They describe the reach form, which the water layer alone uses since
   2026-11-19. The rain layer is an interpolated field and has no spacing to measure. */
const BLEND = 0.45, GATE = 0.2;

/* **How far the wash rounds a corner, as a fraction of the reach.** The wash is the positive part of
   a margin field, and that field is a `min()` of other fields, so wherever two of them meet the wash
   has a corner: a cusp where two reach circles cross, and a pointed end where a halfway line meets a
   circle or another halfway line. `_field()` blurs the margin field on the grid before it traces it.
   A blurred field crosses zero along a rounded curve. This is "union, then smooth" applied to the
   SHAPE and never to the picture: the fill stays one flat colour and the edge stays one pixel wide.
   The blur scales with the reach, because a fixed pixel radius would eat small shapes at low zoom.
   **What it costs in accuracy.** A straight edge does not move. A circle of radius R shrinks by about
   sigma² / (2R), which is 0.8 px at zoom 12. At a corner the edge moves by up to `SMOOTH * r`, inward
   at a pointed end and outward in a notch, and that is the price of a rounded corner.
   **The distance field must stay true out to 3 sigma beyond the reach**, or the blur drags the edge
   outward. Clamped at 8 px past the reach, a sigma of 16 px pushed a straight edge out by 3 px. */
const SMOOTH = 0.1;

/* The blur of the rain estimate, as a fraction of its reach `R`. It removes the ring target a weighted
   mean draws round each gauge. See `_interp()`. */
const INTERP_SIGMA = 0.05;

/* The classes a layer paints with right now. A layer with a `dark` set uses it on the dark theme,
   read off the root's `data-theme`, which `applyTheme()` in js/map.js stamps with the RESOLVED shade.
   Every other layer, and every layer on the light theme, uses its own `classes`. */
export const classesFor = layer =>
  layer.options.dark && document.documentElement.dataset.theme === 'dark' ? layer.options.dark : layer.options.classes;

/* Blur a grid in place with three passes of a box filter on each axis, which approximates a Gaussian
   of `sigma` cells. The box widths are the standard three-pass choice, so that the three together
   have the stated variance. At the border the edge value repeats, so nothing from outside the grid
   enters. A sigma under half a cell moves nothing the grid can show, so it returns at once. */
export function smoothGrid(F, cw, ch, sigma) {
  if (sigma < 0.5) return;
  const n = 3, ideal = Math.sqrt(12 * sigma * sigma / n + 1);
  let wl = Math.floor(ideal); if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  const tmp = new Float32Array(Math.max(cw, ch));
  const box = (start, stride, len, rad) => {
    let s = 0;
    for (let j = -rad; j <= rad; j++) s += F[start + Math.min(Math.max(j, 0), len - 1) * stride];
    const k = 1 / (2 * rad + 1);
    for (let i = 0; i < len; i++) {
      tmp[i] = s * k;
      s += F[start + Math.min(i + rad + 1, len - 1) * stride] - F[start + Math.max(i - rad, 0) * stride];
    }
    for (let i = 0; i < len; i++) F[start + i * stride] = tmp[i];
  };
  for (let pass = 0; pass < n; pass++) {
    const rad = ((pass < m ? wl : wu) - 1) >> 1;
    for (let y = 0; y < ch; y++) box(y * cw, 1, cw, rad);
    for (let x = 0; x < cw; x++) box(x, cw, ch, rad);
  }
}

/* Smoothstep from 1 at the core edge `k` to 0 at the radius. Hoisted out of `_field()` on purpose:
   the inner loop runs about half a million times per paint, and a closure per point there is half a
   million allocations for two multiplies of work. */
function ramp(t, k) { const u = (t - k) / (1 - k); return 1 - u * u * (3 - 2 * u); }

/* The class a weight falls in: the last one whose edge it is strictly above, and class 0 for
   anything at or under the second edge. See RAIN_CLASSES in config.js for why the edge is strict. */
export function classOf(v, classes) {
  let k = 0;
  for (let i = 1; i < classes.length; i++) if (v > classes[i][0]) k = i;
  return k;
}

/* **This layer stamps no gradients any more, and it must not start again without reading this.**
   A canvas radial gradient does not stop at its last stop, it *clamps* to it, so every pixel beyond
   `r` keeps whatever the outermost colour was. Filled as a square rather than as a disc, the four
   corners outside the circle — 21% of the box — therefore carried full strength, and the eraser
   that once used one cut hard rectangles out of the wash, axis-aligned and about 2r on a side. That
   reads as a tiling or a canvas-tile fault and is neither. `_field()` computes every pixel now, so
   there is no sprite and no disc to get wrong. A `stamp()` helper guarded the trap while the pass
   existed and went with it. */

/* The positive part of a field on a grid, as one path. Marching squares: each cell between four
   nodes is a polygon of the corners above zero and of the zero crossings on its edges, with the
   crossing placed by linear interpolation. A cell with four positive corners joins a run of
   rectangles for its row, so only the cells on an edge cost a polygon. Every subpath runs the same
   way round, so two neighbours' shared edge cancels under the nonzero rule and the fill leaves no
   seam. A saddle cell, two opposite corners positive, is read from its centre: joined if the mean
   is above zero, and two triangles if it is not. A node sits at the centre of its grid cell, so the
   cell between four nodes starts `S / 2` in from the grid's own origin. */
function regionPath(F, cw, ch, S) {
  const p = new Path2D(), O = S / 2;
  const X = [0, 0, 0, 0], Y = [0, 0, 0, 0], f = [0, 0, 0, 0];
  for (let gy = 0; gy < ch - 1; gy++) {
    let run = -1;
    const y = gy * S + O;
    for (let gx = 0; gx < cw - 1; gx++) {
      const i = gy * cw + gx, a = F[i], b = F[i + 1], c = F[i + cw + 1], d = F[i + cw];
      if (a > 0 && b > 0 && c > 0 && d > 0) { if (run < 0) run = gx; continue; }
      if (run >= 0) { p.rect(run * S + O, y, (gx - run) * S, S); run = -1; }
      if (!(a > 0 || b > 0 || c > 0 || d > 0)) continue;
      const x = gx * S + O;
      X[0] = x; X[1] = x + S; X[2] = x + S; X[3] = x;
      Y[0] = y; Y[1] = y; Y[2] = y + S; Y[3] = y + S;
      f[0] = a; f[1] = b; f[2] = c; f[3] = d;
      const saddle = (a > 0) === (c > 0) && (b > 0) === (d > 0) && (a > 0) !== (b > 0);
      if (saddle && a + b + c + d <= 0) {
        for (let k = 0; k < 4; k++) {
          if (!(f[k] > 0)) continue;
          const j = (k + 1) & 3, m = (k + 3) & 3;
          const tj = f[k] / (f[k] - f[j]), tm = f[k] / (f[k] - f[m]);
          p.moveTo(X[k] + tm * (X[m] - X[k]), Y[k] + tm * (Y[m] - Y[k]));
          p.lineTo(X[k], Y[k]);
          p.lineTo(X[k] + tj * (X[j] - X[k]), Y[k] + tj * (Y[j] - Y[k]));
          p.closePath();
        }
        continue;
      }
      let first = true;
      for (let k = 0; k < 4; k++) {
        const j = (k + 1) & 3;
        if (f[k] > 0) { if (first) { p.moveTo(X[k], Y[k]); first = false; } else p.lineTo(X[k], Y[k]); }
        if ((f[k] > 0) !== (f[j] > 0)) {
          const t = f[k] / (f[k] - f[j]), qx = X[k] + t * (X[j] - X[k]), qy = Y[k] + t * (Y[j] - Y[k]);
          if (first) { p.moveTo(qx, qy); first = false; } else p.lineTo(qx, qy);
        }
      }
      p.closePath();
    }
    if (run >= 0) p.rect(run * S + O, y, (cw - 1 - run) * S, S);
  }
  return p;
}

/* Bucket a list of `[x, y, ...]` points into a square grid of side `bs`, so a node tests its own
   bucket and the eight around it and not every point on the map. A bucket is addressed by
   `by * nbx + bx`, with one bucket of margin on every side. */
function bucket(list, bs, w, h) {
  const nbx = Math.ceil(w / bs) + 3, nby = Math.ceil(h / bs) + 3, bins = new Array(nbx * nby);
  for (let i = 0; i < list.length; i++) {
    const bx = Math.floor(list[i][0] / bs) + 1, by = Math.floor(list[i][1] / bs) + 1;
    if (bx < 0 || by < 0 || bx >= nbx || by >= nby) continue;
    const k = by * nbx + bx;
    (bins[k] || (bins[k] = [])).push(list[i]);
  }
  return { bins, nbx, nby };
}

/* Fill the classes of a wash, lowest first, each over the last. `F0` is where the wash exists and
   `V` is the value that picks the class. `Fk` is the margin of class k: positive where the wash
   exists and the value is above that class's edge, scaled by `scale` so that a unit of value weighs
   about as much as a unit of distance. The lowest class is the whole wash. */
function fillClasses(ctx, cls, F0, V, cw, ch, S, scale) {
  const n = cw * ch, Fk = new Float32Array(n);
  ctx.fillStyle = cls[0][1];
  ctx.fill(regionPath(F0, cw, ch, S));
  for (let k = 1; k < cls.length; k++) {
    const e = cls[k][0];
    for (let i = 0; i < n; i++) { const t = (V[i] - e) * scale; Fk[i] = F0[i] < t ? F0[i] : t; }
    ctx.fillStyle = cls[k][1];
    ctx.fill(regionPath(Fk, cw, ch, S));
  }
}

const SoftHeat = L.HeatLayer.extend({
  /* **A layer that has been added and then removed still has a canvas and no map, and the vendored
     `redraw()` reads `this._map._animating` with no guard for it.** Leaflet nulls `_map` on remove.
     `_heat` is built on the first add and never torn down. So `!this._heat` short-circuits for a
     layer that was never added, which is why this hid for so long, and throws for one that was.
     `render()` calls `setLatLngs()` on both layers unconditionally, and `setLatLngs()` ends in
     `redraw()`. So switching a heatmap OFF made the next poll throw partway through `render()`.
     Everything after that line stopped: the markers, the cluster, the alert panel and `#shown`. The
     map froze on the last good poll until somebody reloaded, with only `js/oops.js` to say why.
     Fixed here rather than in `vendor/leaflet-heat.js`, so the vendored file stays a vendored file
     and the three patches in it stay the only edits to it. `heatScale()` states the same rule from
     the other side, with `map.hasLayer()`. */
  redraw() { return this._map ? L.HeatLayer.prototype.redraw.call(this) : this; },

  /* The canvas goes in the `heat` pane, under the place names, and not in `overlayPane`. These are
     the vendored `onAdd()` and `onRemove()` with that one pane changed. See the pane in js/map.js. */
  onAdd(map) {
    this._map = map;
    if (!this._canvas) this._initCanvas();
    map.getPane('heat').appendChild(this._canvas);
    map.on('moveend', this._reset, this);
    if (map.options.zoomAnimation && L.Browser.any3d) map.on('zoomanim', this._animateZoom, this);
    this._reset();
  },
  onRemove(map) {
    map.getPane('heat').removeChild(this._canvas);
    map.off('moveend', this._reset, this);
    if (map.options.zoomAnimation) map.off('zoomanim', this._animateZoom, this);
  },

  setDry(latlngs) { this._dry = latlngs; return this.redraw(); },

  /* Paint the readings as shapes, and every edge is a contour of a field.
     **The layer computes fields on a 4 px grid, then draws their contours as paths.** A cell is not
     coloured. Fields are sampled at every node of the grid:
       `v`   the blended reading: every gauge in reach, weighted by how near it is, **normalised**.
             A weighted mean, so two gauges reading the same thing give that thing back.
       `F0`  where the wash exists. Positive inside the reach of a wet gauge and on the wet side of
             any dry gauge, negative elsewhere. It is `min(reach margin, ownership margin)`, both in
             pixels. The reach margin is `r` minus the distance to the nearest wet gauge. The
             ownership margin changes sign on the halfway rule: a dry gauge owns the ground nearer
             to it than to a wet one.
       `Fk`  where class k or higher holds, for each class edge: `min(F0, (v - edge) * r)`.
     Each region is the positive part of its field, found by marching squares with linear
     interpolation. So an edge sits where the field crosses zero, between two nodes and not on a
     node, which is what makes it a smooth curve and keeps it exact to a fraction of a cell. A cell
     whose four nodes are positive joins a run of rectangles, so only the cells on an edge cost a
     polygon. The class regions are filled one over the next, lowest first, so the canvas
     antialiases every edge over one pixel and nothing is blurred.
     **Never fill the cells one by one as separate paths.** Two abutting antialiased fills leave a
     hairline seam. One path with one winding is rasterised as a whole, so a shared edge cancels. */
  _field(ctx, pts, dry, r) {
    /* 8 px and not 4. Both fields are nearly linear inside a cell, so a coarser grid costs almost no
       accuracy: the reach margin is a distance, whose linear interpolation is off a circle of
       radius r by about CELL² / (8 r), which is 0.05 px at CELL 8 and r 158. What the grid cost was
       path building, which grows with the number of cells on an edge and in a run. Measured on the
       live-shaped test payload (58 wet and 125 dry gauges, a 2037 x 1002 canvas), medians: 4 px took
       82 / 138 / 53 ms at zoom 10 / 12 / 14, and 8 px took 19 / 34 / 13 ms. */
    const CELL = 8, O = CELL / 2, BIG = 1e6;
    const w = this._canvas.width, h = this._canvas.height;
    const cw = Math.ceil(w / CELL), ch = Math.ceil(h / CELL), n = cw * ch;
    const cls = classesFor(this);
    const sigmaPx = SMOOTH * r;
    // True distance out to 3 sigma past the reach, so that the blur below sees no clamp. See SMOOTH.
    const r2 = r * r, reach = r + 3 * sigmaPx + 2 * CELL, gscale = r / 4;

    /* Bucket the readings into a grid a little over one radius across, so a cell tests its own
       bucket and the eight around it rather than every reading on the map. Anything within `r` of
       a cell has to be in one of those nine, so nothing is missed. The two extra cells of margin
       are for the reach margin: a node just outside the reach still needs its true distance to the
       nearest gauge, or the edge between it and the node inside would land in the wrong place.
       **This is not a premature optimisation, it is the difference between usable and frozen.**
       Without it the cost is cells × readings, and `thinHeat()` packs readings one radius apart —
       so zooming out shrinks the radius and multiplies the readings at the same time. Measured on
       a full viewport at that spacing: 52 ms with 30 readings, 785 ms with 638, and 3.0 s with
       2,655, against a flat 35 ms indexed at every one of those. A flood is exactly when a lot of
       stations report at once and exactly when the map must not seize. */
    const bs = reach;
    const A = bucket(pts, bs, w, h), B = bucket(dry, bs, w, h);
    const nbx = A.nbx, nby = A.nby, bins = A.bins, dbins = B.bins;

    const F0 = new Float32Array(n), V = new Float32Array(n);
    for (let gy = 0; gy < ch; gy++) {
      const py = gy * CELL + O, cby = Math.floor(py / bs) + 1;
      for (let gx = 0; gx < cw; gx++) {
        const px = gx * CELL + O, cbx = Math.floor(px / bs) + 1;
        let sum = 0, wsum = 0, wnear = 0, dnear = 0, dmin2 = Infinity, vnear = BIG;
        for (let by = cby - 1; by <= cby + 1; by++) {
          if (by < 0 || by >= nby) continue;
          for (let bx = cbx - 1; bx <= cbx + 1; bx++) {
            if (bx < 0 || bx >= nbx) continue;
            const k = by * nbx + bx, b = bins[k], q = dbins[k];
            if (b) for (let i = 0; i < b.length; i++) {
              const dx = px - b[i][0], dy = py - b[i][1], dd = dx * dx + dy * dy;
              if (dd < dmin2) { dmin2 = dd; vnear = b[i][2]; }
              if (dd >= r2) continue;
              const t = Math.sqrt(dd) / r;
              const f = t > BLEND ? ramp(t, BLEND) : 1;
              if (f > 0) { sum += f; wsum += f * b[i][2]; }
              wnear += (t > GATE ? ramp(t, GATE) : 1) / (dd + 1);
            }
            /* The gauges reporting no rain, read at the same radius and through the same kernel as
               the ones reporting rain. **A station saying "none" is one reading, and it covers the
               same ground as a station saying "12 mm".** */
            if (q) for (let i = 0; i < q.length; i++) {
              const dx = px - q[i][0], dy = py - q[i][1], dd = dx * dx + dy * dy;
              if (dd >= r2) continue;
              const t = Math.sqrt(dd) / r;
              dnear += (t > GATE ? ramp(t, GATE) : 1) / (dd + 1);
            }
          }
        }
        const i = gy * cw + gx;
        const margin = r - Math.min(Math.sqrt(dmin2), reach);
        /* Who owns this ground when a dry gauge also reaches it: by inverse square distance to each
           side, which is Shepard's weighting. A gauge's own point is a singularity, so **at a wet
           gauge the wet side owns the cell whole, and at a dry gauge the dry side does.** Halfway
           between the two the margin is zero, and its contour is the halfway line. The margin is in
           pixels, scaled so that it stays comparable to the reach margin: near the line it is
           about a quarter of the gauge spacing per unit. It only gates ground that a wet gauge
           reaches. Outside the reach the reach margin alone decides, so a dry gauge cannot drag the
           reach edge inward. */
        /* With no dry gauge in reach there is nothing to own, so the margin is `BIG` and the reach
           margin alone decides. It was clamped to `gscale` for a while, and the clamp bit a shape
           whose radius is under four cells: a plateau at a quarter of `r` is a clip at 4 px on a
           16 px circle, and the edge came out 2.5 px inward. */
        let own = BIG;
        if (dnear) own = (wnear - dnear) / (wnear + dnear) * gscale;
        F0[i] = margin > 0 && own < margin ? own : margin;
        /* A node outside the reach has no blended reading, and the smoothing below pulls the edge
           out over such nodes. They take the reading of the nearest wet gauge, so the ground the
           blur adds takes that gauge's class and not the top one. A node with no gauge near at all
           holds `BIG`, and its margin is far below zero, so it never reaches the wash. */
        V[i] = sum ? wsum / sum : vnear;
      }
    }
    smoothGrid(F0, cw, ch, sigmaPx / CELL);

    fillClasses(ctx, cls, F0, V, cw, ch, CELL, r);
  },

  /* **The rain wash: an estimate between gauges.** It replaced the reach form on 2026-11-19 on the
     owner's decision. See INTERP_KM and its neighbours in config.js for the distances.
     A node takes `V`, a distance-weighted mean of the weights of every gauge within `R`, wet and dry:
       `w = taper(d / R) / (d² + 1)` for each gauge, a dry gauge reading 0,
       `V = Σ(w × reading) / (Σw + w0)`, where `w0` is a constant weight on the value 0.
     **`w0` is the prior, and it is why a lone gauge draws a hill and not a disc.** A mean of one value
     is that value, so without it a lone wet gauge paints one flat disc out to the mask. With it the
     value falls to half at `PRIOR_KM`, and a lone light gauge reaches about 7 km and a lone very
     heavy one reaches the 10 km mask.
     `V` is the CLASS POSITION from `RAIN_STOPS`, never millimetres. Rain is skewed, so a mean of
     millimetres lets one 60 mm gauge carry high values far out. The positions are already
     compressed: 10, 30 and 60 mm are evenly spaced.
     **The smoothing and the put-back.** `V` is blurred, because a weighted mean draws a ring target
     round every gauge. Blurring also lowers every peak, and a gauge must keep its own reading, so
     near a gauge `V` is pulled back to that gauge's reading: fully within 1.5 cells, and falling to
     nothing at two sigma. Without it a 60 mm gauge among light ones drew heavy and not very heavy.
     The cost is a plateau of about 12 px round each gauge, which is under half a kilometre at
     zoom 12.
     **A dry gauge is evidence.** It supplies the value 0, so the field falls toward it in rings and
     a hole opens round it, as wide as its neighbours' pull allows.
     The wash exists where `V` is above `RAIN_FLOOR` and the node is within `COVER_KM` of a gauge.
     The cover margin is blurred before the `min()`, as the reach margin of the other form is.
     **No 400 px cap here.** The cap protected a blob whose cost grew with its radius. This cost is
     the number of gauges within `R`, and that number does not grow with zoom. */
  _interp(ctx, pts, dry, R) {
    /* The cell is a twelfth of the reach, between 8 and 16 px, and not the fixed 8 of the reach form.
       The cost of a node is the number of gauges near it, and the reach grows with zoom, so a fixed
       cell makes the middle zooms slow. Measured on the test payload (134 wet and 191 dry gauges, a
       2136 x 1356 canvas), medians at zoom 11 / 12: a fixed 8 px took 91 / 155 ms, and a twentieth
       of the reach took 91 / 45 ms. The field is smooth at the scale of a cell, so a coarser grid
       costs no visible accuracy. A cell also sets the plateau round a gauge, 1.5 cells, which is
       why the cell must not grow on a short reach. */
    const CELL = Math.max(8, Math.min(16, Math.round(R / 12))), O = CELL / 2;
    const w = this._canvas.width, h = this._canvas.height;
    const cw = Math.ceil(w / CELL), ch = Math.ceil(h / CELL), n = cw * ch;
    const cls = classesFor(this);
    const kmpx = R / INTERP_KM, D0 = PRIOR_KM * kmpx, covpx = COVER_KM * kmpx;
    const sigma = INTERP_SIGMA * R, w0 = 1 / (D0 * D0), r2 = R * R;
    // True distance to the nearest gauge out past the cover margin and its blur, or the blur drags
    // the edge. The bucket is that wide, so a node always finds the gauge that sets its margin.
    const reach = Math.max(R, covpx * (1 + 3 * SMOOTH) + 2 * CELL), far = covpx * (1 + 3 * SMOOTH) + 2 * CELL;
    const all = pts.concat(dry.map(p => [p[0], p[1], 0]));
    const { bins, nbx, nby } = bucket(all, reach, w, h);

    const V = new Float32Array(n), Vn = new Float32Array(n), Dm = new Float32Array(n), C = new Float32Array(n);
    for (let gy = 0; gy < ch; gy++) {
      const py = gy * CELL + O, cby = Math.floor(py / reach) + 1;
      for (let gx = 0; gx < cw; gx++) {
        const px = gx * CELL + O, cbx = Math.floor(px / reach) + 1;
        let sw = 0, swv = 0, dmin2 = Infinity, vn = 0;
        for (let by = cby - 1; by <= cby + 1; by++) {
          if (by < 0 || by >= nby) continue;
          for (let bx = cbx - 1; bx <= cbx + 1; bx++) {
            if (bx < 0 || bx >= nbx) continue;
            const b = bins[by * nbx + bx];
            if (!b) continue;
            for (let i = 0; i < b.length; i++) {
              const dx = px - b[i][0], dy = py - b[i][1], dd = dx * dx + dy * dy;
              if (dd < dmin2) { dmin2 = dd; vn = b[i][2]; }
              if (dd >= r2) continue;
              const t = Math.sqrt(dd) / R, wgt = (t > 0.5 ? ramp(t, 0.5) : 1) / (dd + 1);
              sw += wgt; swv += wgt * b[i][2];
            }
          }
        }
        const i = gy * cw + gx, d = Math.sqrt(dmin2);
        V[i] = swv / (sw + w0); Vn[i] = vn; Dm[i] = d;
        C[i] = covpx - Math.min(d, far);
      }
    }
    // Blur the estimate, then put each gauge's own reading back near it.
    const Vs = Float32Array.from(V);
    smoothGrid(Vs, cw, ch, sigma / CELL);
    const full = 1.5 * CELL, fade = Math.max(2 * sigma, full + CELL);
    for (let i = 0; i < n; i++) {
      const d = Dm[i], gf = d <= full ? 1 : d >= fade ? 0 : 1 - (d - full) / (fade - full);
      Vs[i] += (Vn[i] - Vs[i]) * gf;
    }
    smoothGrid(C, cw, ch, SMOOTH * covpx / CELL);
    const F0 = new Float32Array(n);
    for (let i = 0; i < n; i++) { const e = (Vs[i] - RAIN_FLOOR) * R; F0[i] = e < C[i] ? e : C[i]; }
    fillClasses(ctx, cls, F0, Vs, cw, ch, CELL, R);
  },

  _redraw() {
    if (!this._map || !this._canvas || !this._heat) return;
    // An interpolated layer is sized on the ground and never capped. See `_interp()`.
    const interp = this.options.interp;
    const r = interp ? Math.max(10, kmPx(this.options.groundKm)) : blobPx(this.options.groundKm);
    const pad = this._pad(), size = this._map.getSize();
    // Same padded canvas and same one-radius bleed margin the stock layer uses — see PATCH 3 in
    // vendor/leaflet-heat.js. A raw container point is not a canvas point here.
    const bounds = new L.Bounds(L.point([-r, -r])._subtract(pad), size.add(pad).add([r, r]));
    const ctx = this._canvas.getContext('2d');
    ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    ctx.save();
    ctx.globalAlpha = 1;

    /* Both answers, projected into the one space the field is computed in. A gauge reporting no
       rain is carried the same way as one reporting rain, out to the same `bounds` and read at the
       same radius — see `_field()`, which decides who owns each pixel. Water passes no dry gauges,
       so `dry` is empty there and the layer is unchanged: a river reading low says nothing about
       the river beside it. */
    const near = [], dry = [];
    for (const ll of this._latlngs) {
      const p = this._map.latLngToContainerPoint(L.latLng(ll[0], ll[1]));
      if (bounds.contains(p))
        near.push([p.x + pad.x, p.y + pad.y, Math.max(0, Math.min(1, +ll[2] || 0))]);
    }
    for (const ll of this._dry ?? []) {
      const p = this._map.latLngToContainerPoint(L.latLng(ll[0], ll[1]));
      if (bounds.contains(p)) dry.push([p.x + pad.x, p.y + pad.y]);
    }
    if (near.length) interp ? this._interp(ctx, near, dry, r) : this._field(ctx, near, dry, r);
    ctx.restore();
    this._frame = null;   // this override never calls the stock _redraw, which used to clear it
  },
});

/* `groundKm` is how far one of this layer's blobs may reach, and it is an option on the layer so
   that the paint, the gate and `thinHeat()` cannot end up measured against three different rulers.
   The two layers differ because the two readings differ: a river level speaks for a catchment, an
   hour of rain speaks for a few streets. See HEAT_KM in config.js. An interpolated layer takes
   `INTERP_KM` here, as the distance past which no gauge speaks. */
export const heat = new SoftHeat([], {
  ...BASE,
  groundKm: HEAT_KM,
  /* Classes are the thresholds, not arbitrary fractions: render.js weights each point by where it
     sits on its own alert / warning / danger scale, so yellow means "past alert", orange "past
     warning" and red "at danger" — the same reading the pin and the meter give, in the same
     colours. Nothing is drawn below the alert slot.
     **This keeps three classes while the pin above it draws two, and that is settled.** The
     three-colour rule of 2026-08-26 covers a sensor, and a wash paints ground. */
  classes: WATER_CLASSES,
});

/* Rainfall as a second layer rather than another weight on the first. They answer different
   questions — "how high is the water" and "how hard is it coming down" — and a station carrying both
   would have summed a river level with the rain falling on it into one number that answers neither.
   Two layers also means either can be read alone, which is the point of the two chips.
   Colours are `RAIN_CLASSES`, as real values rather than the tokens the pins use, because a canvas
   cannot resolve a `var()`. One set for both themes: a wash is composited *over* the basemap at low
   alpha rather than read against it. Anything above 0 mm is drawn, so drizzle paints the lightest
   class rather than nothing.
   **It keeps four classes while the rainfall pin draws three, and that is settled.** Do not fold
   class 3 to amber here. */
export const rainHeat = new SoftHeat([], {
  ...BASE,
  groundKm: INTERP_KM,
  interp: true,
  classes: RAIN_CLASSES,
  dark: RAIN_CLASSES_DARK,
});

const LAYERS = [heat, rainHeat];

/* A theme change repaints the wash, because the colours are baked into the path fills and no CSS
   reaches them. `data-theme` is the one place the resolved shade lives, so this watches it and
   nothing else. It runs after the repaint of the base map, which is the order the reader sees. */
new MutationObserver(() => { for (const l of LAYERS) if (l._map) l.redraw(); })
  .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

/* leaflet.heat composites overlapping blobs, so N stations reporting the same thing paint something
   stronger than any of them reported. Density is the right model for "how many things are here";
   both these layers plot an *intensity* — a position on a threshold scale, or millimetres in an
   hour — and two gauges both reading 4 mm still means 4 mm, not 8.
   Measured on the live rain network: 233 gauges, a median of 4 inside one blob and up to 14, which
   stacks light rain (weight 0.26) to 0.97 — solid red across a state where nothing worse than light
   rain was reported. That is the bug this fixes.
   The fix is to keep the strongest reading and drop anything its own blob already covers, which is
   precisely "the highest reading within a blob radius" — what the colour is supposed to mean. After
   it, no kept point has another inside the radius, so the worst case is the reading itself again.
   Blobs still overlap softly at their edges, because the brush has faded to nothing by then.
   Water is thinned too. It has one point on a calm day, so this changes nothing visible today — but
   the flaw is identical and only shows up once a lot of stations alert at once, which is the one
   moment the map has to be right.
   `km` is the caller's blob size and must be the one the layer is drawn at, or the thinning reaches
   a different distance from the paint and the stacking comes back in the ring between the two.
   ponytail: O(n·kept), 233 × 102 here — a fraction of a millisecond. Grid-index it if the network
   ever gets an order of magnitude denser. */
export function thinHeat(points, km = HEAT_KM) {
  const kept = [];
  for (const p of [...points].sort((a, b) => b[2] - a[2])) {
    const clash = kept.some(k =>
      Math.hypot((k[1] - p[1]) * Math.cos(p[0] * Math.PI / 180), k[0] - p[0]) * 111 < km);
    if (!clash) kept.push(p);
  }
  return kept;
}

// A canvas sizes in screen pixels, which would make a blob cover less ground the further you zoom
// in. Recomputing per zoom pins each blob to a fixed distance on the ground.
function kmPx(km) {
  const c = map.getCenter();
  const east = L.latLng(c.lat, c.lng + km / (111 * Math.cos(c.lat * Math.PI / 180)));
  return Math.abs(map.latLngToLayerPoint(east).x - map.latLngToLayerPoint(c).x);
}

/* The radius one blob is drawn at. `_redraw()` and `heatScale()` both go through it, so the paint
   and the fade that warns the cap is biting cannot end up measured against different rulers. */
function blobPx(km) { return Math.max(10, Math.min(HEAT_MAX_PX, kmPx(km))); }

/* `paint` is false for the one caller that has a repaint coming anyway. Leaflet fires `zoomend` and
   then `moveend` for every zoom, and the vendored layer's own `_reset` paints on that `moveend`.
   `_redraw()` reads the radius when it runs, so the later paint takes the new one. The fade is a
   style on the canvas, and `heatOpacity()` at the foot of this function writes it either way.
   Measured over an 18-step wheel gesture with the chip on rainfall, three runs each way, taken
   alternately, medians: `_redraw` ran 32 times for 628 ms with the second paint, and 16 times for
   336 ms without it. Blocked main-thread time fell from 3,661 ms to 1,983 ms. The long tasks fell
   from 43 to 28, and the longest from 141 ms to 121 ms. Three rain gauges reported that day, so a
   busy network pays more.
   The comment on the `zoomend` line below stated this rule while the code broke it. */
function heatScale(paint = true) {
  for (const l of LAYERS) {
    /* Only a layer that is on the map. `setOptions()` ends in `redraw()`, which reads
       `this._map._animating` — and Leaflet nulls `_map` when it removes a layer, so sizing a layer
       that is off throws. It survived because the layer that is off has usually never been added,
       and a layer with no canvas returns from `redraw()` one test earlier. Switching the heat chip
       from rainfall to water is what reaches it: that leaves rainHeat added-then-removed, holding a
       canvas and no map. `syncHeat()` adds and removes before it calls this, so a layer just
       switched on is on the map by now and still gets sized. */
    if (!map.hasLayer(l)) continue;
    const px = kmPx(l.options.groundKm);
    /* Fill cost grows with the square of the radius, so a blob cannot keep pace with its ground
       distance forever. `blobPx()` caps it. Past the cap the blob would silently start covering
       less ground — a hotspot that means something different at each zoom — so fade it out over the
       next two zoom levels instead of lying about its size. Per layer, because the cap is, and the
       two ground distances differ. */
    l._fade = l.options.interp || px <= HEAT_MAX_PX ? 1 : Math.max(0, 1 - Math.log2(px / HEAT_MAX_PX) / 2);
    if (paint) l.redraw();   // the radius is read inside _redraw(), so there is no option to set
  }
  heatOpacity();
}

/* leaflet.heat has no opacity option, so we fade its canvas directly. It is recreated whenever the
   layer is re-added, hence the re-apply after every render.
   **75% is the DEFAULT and a reader can move it, from Settings.** The control rode under both ramps
   on the legend until 2026-08-24, and a reader cut it there. 75% is the figure it existed to reach:
   a pin, a river and a road all read through the wash, and the wash still states its own class. It
   is back as a row in Settings on 2026-08-25, on a reader's instruction. The map is where a reader
   judges the wash, so the legend was the wrong home for a control they set once.
   `_fade` is a separate term and stays. That one is the layer telling a reader its blob has stopped
   covering the ground it names, and it multiplies this number rather than replaces it.
   **Since 2026-11-19 this is the ONLY opacity the wash has, and it stops at 80%.** A class carries a
   colour and no opacity of its own, so the slider is the whole control, and the owner capped it. A
   stored value from before the cap reads as the cap. */
export const HEAT_OPACITY = 0.75;
export const HEAT_OPACITY_MAX = 0.8;
export function heatOpacity() {
  const o = Math.min(PREFS.heatOpacity ?? HEAT_OPACITY, HEAT_OPACITY_MAX);
  for (const l of LAYERS) if (l._canvas) l._canvas.style.opacity = o * (l._fade ?? 1);
}

/* Puts the map, the legend and the segmented button on `PREFS.heatLayer`. One string
   with three values, so exactly one scale is ever on screen — never a stack of two ramps to read
   against each other.
   This runs at startup as well as on every render, and a render is a whole poll away — so a reader
   whose pref is rainfall used to get the wrong legend, and the wrong layer, for as long as the first
   payload took.
   **It reads the pref and writes the boxes, never the reverse.** A checkbox is state this app does
   not own: a browser restores form state across a reload without firing `change`, so an invariant
   repaired inside the change handler is repaired on none of the paths the browser takes. That is
   how the pair reached both-on and stayed there — the legend drew both ramps, the two layers
   composited into a colour neither scale defines, and the summary went on naming the one the reader
   had picked, because it alone was written from the handler. Deriving the pair from one string
   makes both-on unrepresentable whoever wrote the DOM. `syncPins()` in render.js is this same shape
   at a second site, for the pin filter, and it exists because of this entry.
   The control is now a segmented button holding three radios, so the browser refuses both-on as
   well. That is a second guard rather than a replacement: a radio restored across a reload is still
   form state this app does not own. */
export function syncHeat() {
  const wet = PREFS.heatLayer === 'water', rainy = PREFS.heatLayer === 'rain';
  /* One write, because the three are one M3 single-select segmented button. Checking a radio
     unchecks its siblings, so there is no second box left holding a state this preference denies. */
  for (const id of ['heatOff', 'heat', 'rainHeat'])
    setBox(id, id === (wet ? 'heat' : rainy ? 'rainHeat' : 'heatOff'));
  /* **The chip states its own value, because that is what an M3 menu chip does.** A chip that opens
     a menu carries the answer as its label and a trailing arrow as the promise. So the map says what
     it paints with nothing opened. Written from the preference, never read back from it, which is
     the rule every control this function owns already obeys. */
  el('heatChipLabel').textContent = wet ? 'Water level' : rainy ? 'Rainfall' : 'Heatmap';
  /* The glyph names the same value, off the two kinds' own icons — the rule the layer chip already
     obeys. `gradient` is the layer with nothing chosen, so it stands for the whole menu. */
  el('heatChipIcon').className = `i glyph i-${wet ? 'water_drop' : rainy ? 'rainy' : 'gradient'}`;
  /* Two things take the wash off the map, and NEITHER writes PREFS.heatLayer. That is the whole of
     "turn the previous heatmap back on": the reader's choice never left, so restoring it needs no
     state remembered anywhere.
     Weather mode takes the map outright. `Stations` is the reader switching the station layer off,
     and the heatmap is a choice about that layer, so its chip leaves the map with it and the wash
     goes with them. A wash still drawn under a switched-off Stations is a layer with its control hidden,
     which is worse than a control with nothing under it. */
  const show = PREFS.mapLayer === 'stations';
  /* No summary line here any more. This choice left the drawer for a chip on the map, and that chip
     states the answer in its own label. So what the map paints is on screen without opening
     anything, which is what the drawer summary was for. */
  wet && show   ? heat.addTo(map)     : heat.remove();
  rainy && show ? rainHeat.addTo(map) : rainHeat.remove();
  el('lgWater').style.display = wet && show ? '' : 'none';
  el('lgRain').style.display  = rainy && show ? '' : 'none';
  // The legend box holds three sections now, so one function decides whether the box itself shows.
  el('lgWx').style.display = PREFS.mapLayer === 'weather' ? '' : 'none';
  /* **`show` once meant "not weather mode", and this line and the one above both used it that
     way.** Then Stations gained a switch, and `show` came to mean "the wash can draw" instead. With
     Stations off and weather off, the old test drew the box with all three of its sections hidden,
     which is an empty plate on the map. Both lines ask what they mean now: the weather key while
     weather is the layer, a ramp while a wash is actually drawn, and nothing otherwise. */
  el('legend').style.display =
    PREFS.mapLayer === 'weather' || ((wet || rainy) && show) ? '' : 'none';
  heatScale();   // sizes whichever is on, and re-applies opacity
  heatOpacity();
}

// No redraw call here: leaflet.heat repaints on the moveend that follows every zoomend, so setting
// the size and the fade first is enough. Painting as well painted the canvas twice per zoom.
map.on('zoomend', () => heatScale(false));
