// The two heatmaps — water level, and rainfall — on one engine, one set of sizing and one opacity
// control. Both are interpolated fields drawn as flat bands. Rain takes a distance-weighted MEAN of
// the gauges near each point, because rain is one field. Water takes the HIGHEST hill of the stations
// near each point, because a river level belongs to one channel and a mean would paint classes that
// no station reported. See `_interp()`.
//
// **Read "gauge" in this file as a rainfall station.** It measures `hourly`, in mm/h. A **flood
// gauge** is a different kind — `gauge` in the payload, `Flood gauge` on screen, `depth` in metres
// over a flood-prone spot. It feeds the *water level* layer beside the rivers, and since 2026-11-19
// water on the ground has a class of its own there. The two names collide in one place: `api.php`
// records that a flood gauge reading negative means **dry ground**, so "a dry gauge" says one thing
// here and another thing there. Say which one.
//
// **A flood gauge is never evidence about rain, in either direction, and this is the rule to keep.**
// It measures what the drainage failed to carry away. Where the drainage is good, rain falls as hard
// as anywhere and the gauge stays clear. Where runoff arrives from upstream, the gauge goes under
// with no rain overhead at all. So a clear flood gauge cannot lower the rain wash above it, and a
// submerged one cannot paint it. Only a rainfall station reports rain.

import { INTERP_KM, PRIOR_KM, COVER_KM, RAIN_FLOOR, WATER_INTERP_KM, WATER_PRIOR_KM,
         RAIN_CLASSES, RAIN_CLASSES_DARK, WATER_CLASSES, WATER_CLASSES_DARK } from './config.js';
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
   a field over the viewport and gives each node the class its value falls in.

   Four traps from the soft wash stay true, and the history is in docs/GOTCHAS.md. Never stamp a
   blob and composite it: every Porter-Duff `over` adds alpha, so a second blob made the same rain
   look heavier. Never erase with `destination-out` to take ground back: it is a claim about the
   canvas and ate the neighbours' paint. Never fill a canvas radial gradient as a square: it clamps
   past its last stop and cut hard rectangles out of the wash. And never derive a colour from an
   alpha: simpleheat's `_colorize()` does, and a fading brush then walks down the legend. */

/* **How far the wash rounds a corner, as a fraction of the reach.** The wash is the positive part of
   a margin field, and that field is a `min()` or a `max()` of other fields, so wherever two of them
   meet the wash has a corner: a cusp where two reach circles cross, and a ridge where two hills
   meet. `_interp()` blurs the field on the grid before it traces it.
   A blurred field crosses zero along a rounded curve. This is "union, then smooth" applied to the
   SHAPE and never to the picture: the fill stays one flat colour and the edge stays one pixel wide.
   The blur scales with the reach, because a fixed pixel radius would eat small shapes at low zoom.
   **What it costs in accuracy.** A straight edge does not move. A circle of radius R shrinks by about
   sigma² / (2R), which is 0.8 px at zoom 12. At a corner the edge moves by up to `SMOOTH * r`, inward
   at a pointed end and outward in a notch, and that is the price of a rounded corner.
   **The distance field must stay true out to 3 sigma beyond the reach**, or the blur drags the edge
   outward. Clamped at 8 px past the reach, a sigma of 16 px pushed a straight edge out by 3 px. */
/* The blur of the rain estimate, as a fraction of its reach `R`. It removes the ring target a weighted
   mean draws round each gauge. See `_interp()`.
   **`LOOK` holds the shape and look numbers, and each layer carries its own copy in its options.**
   `heat-tune.html` writes those options, one layer at a time. The app never does, so the values here
   are the shipped ones. `opacity` and `stepped` are null on a layer that follows the Settings
   controls. A number there overrides them for that layer alone. */
const LOOK = { smooth: 0.1, sigma: 0.05, opacityMin: null, cellDiv: 12, cellMin: 8, cellMax: 16,
               opacity: null, stepped: null,
               power: 2, dryWeight: 1, nugget: 0, outlier: 0, outlierK: 4, hillPow: 2, blend: 0 };

/* A node with no value to give, such as the cover margin of a layer that has none, holds this. */
const BIG = 1e6;

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

/* Smoothstep from 1 at the core edge `k` to 0 at the radius. Hoisted out of `_interp()` on purpose:
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
   reads as a tiling or a canvas-tile fault and is neither. `_interp()` computes every node now, so
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
/* Outlier damping for the rain layer. Each wet gauge is compared with the median of its `k` nearest
   neighbours within `R`, dry gauges included as 0. A gauge above that median moves toward it by
   `amount`, 0 to 1. A gauge below it stays: a low reading is not the spike this guards against.
   A gauge with no neighbour stays too, because nothing contradicts it. O(n²) over the stations on
   screen, which is about 400 at most. */
function damp(pts, dry, R, amount, k) {
  const all = pts.concat(dry.map(p => [p[0], p[1], 0])), r2 = R * R;
  return pts.map(p => {
    const near = [];
    for (const q of all) {
      if (q === p) continue;
      const dx = p[0] - q[0], dy = p[1] - q[1], dd = dx * dx + dy * dy;
      if (dd < r2) near.push([dd, q[2]]);
    }
    if (!near.length) return p;
    near.sort((a, b) => a[0] - b[0]);
    const v = near.slice(0, k).map(a => a[1]).sort((a, b) => a - b), m = v.length >> 1;
    const med = v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
    return p[2] > med ? [p[0], p[1], p[2] - amount * (p[2] - med)] : p;
  });
}

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
function fillClasses(ctx, cls, F0, V, cw, ch, S, scale, lo) {
  const n = cw * ch, Fk = new Float32Array(n), m = cls.length - 1;
  /* STEPPED style (`PREFS.heatStyle`, 2026-11-23). The canvas carries the top band's opacity, and
     class k is drawn at `lo + (1 - lo) * k / m` of it, where `lo` is the lowest band's opacity over
     the top one's. So the lowest band shows at the lowest opacity and the top band at the top one. A class lies over the one below it, so the region is erased first.
     Without the erase the lower colour would show through and mix. FLAT draws every class at 1. */
  const paint = (k, F) => {
    const path = regionPath(F, cw, ch, S);
    if (lo !== null) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1;
      ctx.fill(path);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = lo + (1 - lo) * k / m;
    } else ctx.globalAlpha = 1;
    ctx.fillStyle = cls[k][1];
    ctx.fill(path);
  };
  paint(0, F0);
  for (let k = 1; k <= m; k++) {
    const e = cls[k][0];
    for (let i = 0; i < n; i++) { const t = (V[i] - e) * scale; Fk[i] = F0[i] < t ? F0[i] : t; }
    paint(k, Fk);
  }
  ctx.globalAlpha = 1;
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

  /* **An interpolated wash, and the two layers differ in how stations combine.** It replaced the
     reach form on 2026-11-19 on the owner's decision. The distances are options on the layer.
     Every point of the screen grid takes a value `V`, and the wash exists where `V` is above
     `floor`. `V` is the CLASS POSITION of a station, never its raw reading, so a mean or a maximum
     is taken over a compressed, evenly spaced scale.

     **`combine: 'mean'` is the rain layer.** `V = Σ(w × reading) / (Σw + w0)` over every gauge
     within `R`, wet and dry, with `w = taper(d / R) / (d² + 1)` and a dry gauge reading 0.
     **`w0` is the prior, a constant weight on the value 0, and it is why a lone gauge draws a hill
     and not a disc.** A mean of one value is that value, so without it a lone wet gauge paints one
     flat disc out to the mask. With it the value falls to half at `priorKm`.
     A dry gauge is evidence: it supplies 0, so the field falls toward it in rings. Ground past
     `coverKm` from every gauge is bare, and the cover margin is blurred before the `min()`.

     **`combine: 'max'` is the water layer.** `V` is the highest of `value × hill(d)` over the
     stations within `R`, with `hill(d) = taper(d / R) / (1 + (d / D0)²)` and `D0 = priorKm`. Rain is
     one field, so a mean of gauges is a fair guess. A river level belongs to one channel. A mean
     painted classes between a danger station and a calm one that no sensor reported, and let a calm
     river lower a danger reading on a different river. A maximum cannot do either. A calm station
     draws nothing and lowers nothing, and two stations at warning never add up to a danger.
     There is no prior and no cover margin: a hill ends where it falls under `floor`.

     **The smoothing and the put-back, for both.** `V` is blurred, because a field of hills draws a
     ring target round every station. Blurring also lowers every peak, and a station must keep its
     own value, so near a station `V` is pulled back to that station's own value: fully within 1.5
     cells, and falling to nothing at two sigma. In `max` mode the station is the one whose hill wins
     at the node, so a higher neighbour is never lowered. The cost is a plateau of about 12 px round
     each station, which is under half a kilometre at zoom 12.
     **No 400 px cap here.** The cap protected a blob whose cost grew with its radius. This cost is
     the number of stations within `R`, and that number does not grow with zoom. */
  _interp(ctx, pts, dry, R) {
    /* The cell is a twelfth of the reach, between 8 and 16 px. The cost of a node is the number of
       stations near it, and the reach grows with zoom, so a fixed cell makes the middle zooms slow.
       Measured on the rain test payload (134 wet and 191 dry gauges, a 2136 x 1356 canvas), medians
       at zoom 11 / 12: a fixed 8 px took 91 / 155 ms, and a twelfth of the reach took 45 / 47 ms. The
       field is smooth at the scale of a cell, so a coarser grid costs no visible accuracy. A cell
       also sets the plateau round a station, 1.5 cells, which is why it must not grow on a short
       reach. */
    const CELL = Math.max(this.options.cellMin, Math.min(this.options.cellMax, Math.round(R / this.options.cellDiv))), O = CELL / 2;
    const w = this._canvas.width, h = this._canvas.height;
    const cw = Math.ceil(w / CELL), ch = Math.ceil(h / CELL), n = cw * ch;
    const cls = classesFor(this);
    const o = this.options, maxMode = o.combine === 'max';
    const kmpx = R / o.interpKm, D0 = o.priorKm * kmpx, D02 = D0 * D0, covpx = o.coverKm * kmpx;
    const SMOOTH = this.options.smooth, sigma = this.options.sigma * R, r2 = R * R;
    /* Five tuning knobs, added 2026-11-23 for `heat-tune.html`. Each default reproduces the shipped
       field exactly. `power` is the distance power of a rain weight, and `w0` follows it so that a
       lone gauge still halves at `priorKm`. `dryWeight` scales a dry gauge's weight. `nugget` lets
       the field leave a station's own value: 0 pins it, 1 leaves the blurred field alone.
       `outlier` pulls a rain gauge toward the median of its neighbours. `hillPow` is the water
       falloff power, and `blend` adds a share of the other hills to the highest one. */
    const P = o.power ?? 2, HP = o.hillPow ?? 2, blend = o.blend ?? 0;
    const w0 = 1 / Math.pow(D0, P), pin = 1 - (o.nugget ?? 0), dryW = o.dryWeight ?? 1;
    // True distance to the nearest gauge out past the cover margin and its blur, or the blur drags
    // the edge. The bucket is that wide, so a node always finds the gauge that sets its margin.
    const far = covpx * (1 + 3 * SMOOTH) + 2 * CELL, reach = Math.max(R, far);
    if (!maxMode && o.outlier > 0) pts = damp(pts, dry, R, o.outlier, o.outlierK ?? 4);
    const all = dry.length ? pts.concat(dry.map(p => [p[0], p[1], 0, dryW])) : pts;
    const { bins, nbx, nby } = bucket(all, reach, w, h);

    const V = new Float32Array(n), Vn = new Float32Array(n), Dm = new Float32Array(n), C = new Float32Array(n);
    if (maxMode) C.fill(BIG);
    for (let gy = 0; gy < ch; gy++) {
      const py = gy * CELL + O, cby = Math.floor(py / reach) + 1;
      for (let gx = 0; gx < cw; gx++) {
        const px = gx * CELL + O, cbx = Math.floor(px / reach) + 1;
        let sw = 0, swv = 0, dmin2 = Infinity, vn = 0, best = 0, bestV = 0, bestD = Infinity, hsum = 0, topV = 0;
        for (let by = cby - 1; by <= cby + 1; by++) {
          if (by < 0 || by >= nby) continue;
          for (let bx = cbx - 1; bx <= cbx + 1; bx++) {
            if (bx < 0 || bx >= nbx) continue;
            const b = bins[by * nbx + bx];
            if (!b) continue;
            for (let i = 0; i < b.length; i++) {
              const dx = px - b[i][0], dy = py - b[i][1], dd = dx * dx + dy * dy;
              if (maxMode) {
                if (dd >= r2) continue;
                const d = Math.sqrt(dd), t = d / R;
                // Two square roots stand in for `pow` at the shipped 1.5, which is several times slower.
                const s = dd / D02;
                const q = HP === 2 ? s : HP === 1.5 ? Math.sqrt(s) * Math.sqrt(Math.sqrt(s)) : Math.pow(s, HP / 2);
                const hv = b[i][2] * (t > 0.5 ? ramp(t, 0.5) : 1) / (1 + q);
                hsum += hv;
                if (b[i][2] > topV) topV = b[i][2];
                if (hv > best) { best = hv; bestV = b[i][2]; bestD = d; }
                continue;
              }
              if (dd < dmin2) { dmin2 = dd; vn = b[i][2]; }
              if (dd >= r2) continue;
              const t = Math.sqrt(dd) / R;
              const wgt = (t > 0.5 ? ramp(t, 0.5) : 1) * (b[i][3] ?? 1) / ((P === 2 ? dd : Math.pow(dd, P / 2)) + 1);
              sw += wgt; swv += wgt * b[i][2];
            }
          }
        }
        const i = gy * cw + gx;
        // The blend fills the gaps between stations, but it never goes above the highest station in
        // reach. So it can never paint a class that no station reported.
        if (maxMode) { V[i] = Math.min(topV, best + blend * (hsum - best)); Vn[i] = bestV; Dm[i] = bestD; continue; }
        const d = Math.sqrt(dmin2);
        V[i] = swv / (sw + w0); Vn[i] = vn; Dm[i] = d;
        C[i] = covpx - Math.min(d, far);
      }
    }
    // Blur the estimate, then put each station's own value back near it.
    const Vs = Float32Array.from(V);
    smoothGrid(Vs, cw, ch, sigma / CELL);
    const full = 1.5 * CELL, fade = Math.max(2 * sigma, full + CELL);
    for (let i = 0; i < n; i++) {
      const d = Dm[i], gf = pin * (d <= full ? 1 : d >= fade ? 0 : 1 - (d - full) / (fade - full));
      Vs[i] += (Vn[i] - Vs[i]) * gf;
      /* The nugget smooths over a station, but never out of its own band at its own spot. The owner
         chose that on 2026-11-23: a reading keeps its colour where it was measured. Only the nodes
         within the 1.5-cell plateau are held. A value above the band's lower edge is in the band. */
      if (pin < 1 && d <= full && Vs[i] < Vn[i]) {
        const k = classOf(Vn[i], cls);
        if (k > 0) Vs[i] = Math.max(Vs[i], Math.min(Vn[i], cls[k][0] + 1e-4));
      }
    }
    if (!maxMode) smoothGrid(C, cw, ch, SMOOTH * covpx / CELL);
    const F0 = new Float32Array(n);
    for (let i = 0; i < n; i++) { const e = (Vs[i] - o.floor) * R; F0[i] = e < C[i] ? e : C[i]; }
    fillClasses(ctx, cls, F0, Vs, cw, ch, CELL, R, stepRatio(this));
  },

  _redraw() {
    if (!this._map || !this._canvas || !this._heat) return;
    // The reach is sized on the ground and never capped. See `_interp()`.
    const r = Math.max(10, kmPx(this.options.groundKm)), pad = this._pad(), size = this._map.getSize();
    // Same padded canvas and same one-radius bleed margin the stock layer uses — see PATCH 3 in
    // vendor/leaflet-heat.js. A raw container point is not a canvas point here.
    const bounds = new L.Bounds(L.point([-r, -r])._subtract(pad), size.add(pad).add([r, r]));
    const ctx = this._canvas.getContext('2d');
    ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    ctx.save();
    ctx.globalAlpha = 1;

    /* The stations, projected into the one space the field is computed in. A gauge reporting no rain
       is carried the same way as one reporting rain, out to the same `bounds`. The water layer
       passes no dry list: a calm river is simply absent. A value goes up to 2, because water on
       the ground is 1.25 and a clamp at 1 would flatten it into danger. */
    const near = [], dry = [];
    for (const ll of this._latlngs) {
      const p = this._map.latLngToContainerPoint(L.latLng(ll[0], ll[1]));
      if (bounds.contains(p))
        near.push([p.x + pad.x, p.y + pad.y, Math.max(0, Math.min(2, +ll[2] || 0))]);
    }
    for (const ll of this._dry ?? []) {
      const p = this._map.latLngToContainerPoint(L.latLng(ll[0], ll[1]));
      if (bounds.contains(p)) dry.push([p.x + pad.x, p.y + pad.y]);
    }
    if (near.length) this._interp(ctx, near, dry, r);
    ctx.restore();
    this._frame = null;   // this override never calls the stock _redraw, which used to clear it
  },
});

/* `groundKm` is how far one of this layer's hills may reach, and it is an option on the layer beside
   its halving distance and its floor. The two layers differ because the two readings differ: a river
   level speaks for a catchment, an hour of rain speaks for a few streets. */
export const heat = new SoftHeat([], {
  ...BASE, ...LOOK,
  groundKm: WATER_INTERP_KM,
  interp: true,
  interpKm: WATER_INTERP_KM, priorKm: WATER_PRIOR_KM, coverKm: 0, floor: RAIN_FLOOR, combine: 'max',
  /* Tuned by the owner on 2026-11-23. A falloff power of 1.5 gives a hill a long tail, so a station
     at danger colours its whole reach. A blend of 0.1 joins nearby hills so the wash is less spotty.
     The blend is capped at the highest station in reach, so it never paints an unreported class. */
  hillPow: 1.5, blend: 0.1, minDefault: 0.35,
  /* Classes are the thresholds, not arbitrary fractions: `waterValue()` in js/util.js scores each
     station by where it sits on its own alert / warning / danger scale, so yellow means "past
     alert", orange "past warning" and red "at danger" — the same reading the pin and the meter give,
     in the same colours. The darkest class is water measured on the ground. Nothing is drawn below
     the alert mark.
     **This keeps ten classes while the pin above it draws two, and that is settled.** The
     three-colour rule of 2026-08-26 covers a sensor, and a wash paints ground. */
  classes: WATER_CLASSES,
  dark: WATER_CLASSES_DARK,
});

/* Rainfall as a second layer rather than another weight on the first. They answer different
   questions — "how high is the water" and "how hard is it coming down" — and a station carrying both
   would have summed a river level with the rain falling on it into one number that answers neither.
   Two layers also means either can be read alone, which is the point of the two chips.
   Colours are `RAIN_CLASSES`, as real values rather than the tokens the pins use, because a canvas
   cannot resolve a `var()`. Anything above 0 mm is drawn, so drizzle paints the lightest class
   rather than nothing.
   **It keeps thirteen classes while the rainfall pin draws three, and that is settled.** Do not
   fold a class to amber here. */
export const rainHeat = new SoftHeat([], {
  ...BASE, ...LOOK,
  groundKm: INTERP_KM,
  interp: true,
  interpKm: INTERP_KM, priorKm: PRIOR_KM, coverKm: COVER_KM, floor: RAIN_FLOOR, combine: 'mean',
  /* Tuned by the owner on 2026-11-23. A nugget of 0.5 lets the field smooth over a single gauge, so
     one odd reading draws a softer bullseye. */
  nugget: 0.5, minDefault: 0.3,
  classes: RAIN_CLASSES,
  dark: RAIN_CLASSES_DARK,
});

const LAYERS = [heat, rainHeat];

/* A theme change repaints the wash, because the colours are baked into the path fills and no CSS
   reaches them. `data-theme` is the one place the resolved shade lives, so this watches it and
   nothing else. It runs after the repaint of the base map, which is the order the reader sees. */
new MutationObserver(() => { for (const l of LAYERS) if (l._map) l.redraw(); })
  .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// A canvas sizes in screen pixels, which would make a hill cover less ground the further you zoom
// in. Recomputing per zoom pins each hill to a fixed distance on the ground.
function kmPx(km) {
  const c = map.getCenter();
  const east = L.latLng(c.lat, c.lng + km / (111 * Math.cos(c.lat * Math.PI / 180)));
  return Math.abs(map.latLngToLayerPoint(east).x - map.latLngToLayerPoint(c).x);
}

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
   **Since 2026-11-19 this is the ONLY opacity the wash has, and it stops at 80%.** A class carries a
   colour and no opacity of its own, so the slider is the whole control, and the owner capped it. A
   stored value from before the cap reads as the cap. */
export const HEAT_OPACITY = 0.75;
export const HEAT_OPACITY_MAX = 0.8;
/* Repaint both layers after the style preference changes. */
export function heatStyle() { for (const l of LAYERS) l.redraw(); }
/* The opacities of one layer. A layer option overrides the Settings value. The top is the slider
   that existed before stepped mode, and it keeps its 80% cap. The lowest band never goes above it. */
/* The stepped defaults, tuned by the owner on 2026-11-23. The highest band is 70% on both layers.
   The lowest band is 30% on rain and 35% on water, because water's lowest band is the alert yellow
   and it reads weakly on a light map. A reader's Settings value replaces both defaults. */
export const HEAT_OPACITY_TOP = 0.7;
export const minDefault = l => l.options.minDefault;
// Stepped is the default since 2026-11-23, so only a stored 'flat' turns it off.
const isStepped = l => l.options.stepped ?? PREFS.heatStyle !== 'flat';
// Flat and stepped keep separate preferences: `heatOpacity` for flat, `heatOpacityTop` for stepped.
const topOpacity = l => Math.min(l.options.opacity ?? (isStepped(l)
  ? PREFS.heatOpacityTop ?? HEAT_OPACITY_TOP : PREFS.heatOpacity ?? HEAT_OPACITY), HEAT_OPACITY_MAX);
// null for a flat layer, else the lowest band's opacity as a share of the top band's.
function stepRatio(l) {
  if (!isStepped(l)) return null;
  const top = topOpacity(l), low = Math.min(l.options.opacityMin ?? PREFS.heatOpacityMin ?? minDefault(l), top);
  return top > 0 ? low / top : 1;
}
export function heatOpacity() {
  for (const l of LAYERS)
    if (l._canvas) l._canvas.style.opacity = topOpacity(l);
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
