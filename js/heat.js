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

import { HEAT_KM, RAIN_KM, HEAT_MAX_PX, HEAT_ALERT, HEAT_WARNING, RAIN_HEAT } from './config.js';
import { PREFS } from './state.js';
import { map } from './map.js';
import { el } from './util.js';

/* `radius` and `blur` size simpleheat's sprite, which `SoftHeat._redraw()` does not use — it paints
   the blobs itself. They stay because `_updateOptions()` runs on add and builds `_grad` out of
   `gradient` in the same call, and `_grad` is where the colours come from.
   maxZoom is not a display limit — leaflet.heat divides every weight by 2^(maxZoom - zoom), so any
   value inside our zoom range dims the blobs as you zoom out. 0 pins the factor at 1. */
const BASE = { radius: 70, blur: 55, maxZoom: 0 };

/* **A heat blob's colour must not be derived from its alpha, and this is the whole reason the layer
   paints itself.** simpleheat's `_colorize()` looks the gradient up by alpha, so alpha is a blob's
   extent and its colour at once, and any brush that fades walks down the legend.
   Measured on one gauge reading 27 mm/h, which is JPS's *heavy* class: heavy at the gauge,
   moderate 4 km out, light 6 km out. Three classes, one measurement, and a legend beside them
   saying those colours mean millimetres.
   Cutting it to 0.04 fixed the colour and broke the look, and softening the edge back with a
   `destination-out` pass fixed the look and broke the neighbours — see `SoftHeat._redraw()`, which
   paints the blobs itself and needs no sprite at all. The constant is gone with the sprite. This
   note stays because the trap does not: **anything that fades a heat blob before its colour is
   chosen fades it down the legend.** */

/* Both layers are this class. It paints each blob directly, in one colour taken from the layer's
   own gradient, with only its alpha fading out. Then a gauge reporting no rain takes back what it
   denies. Water passes no dry gauges, so that pass costs it nothing — a river reading low says
   nothing about the river beside it, and rain is the only reading here that argues with a neighbour.

   **Softening a blob by erasing it is the trap, and it was built and thrown away.** A
   `destination-out` pass is a claim about the canvas, not about one blob, so a blob's own soft edge
   ate whatever its neighbours had painted underneath. Measured on two gauges one blob apart, which
   is the closest `thinHeat()` ever leaves them: each one's centre was erased to alpha 5 of 177 by
   the *other* one's feather, and the ground between them stacked to 200 in a class neither gauge
   had reported. Painting is additive over a neighbour and erasing is not, so the fade has to be
   painted.

   The dry-gauge eraser stays a `destination-out` pass on purpose, and is the one thing here that
   *should* reach every blob under it: a dry reading denies the ground, not one neighbour's
   contribution to it. It also runs last, so the colour beneath is already settled. `destination-out`
   multiplies canvas alpha by one minus the brush, so overlapping erasers compound — two dry gauges
   over the same ground remove more of it than one does, which is two readings saying the same
   thing.

   The eraser's own alternative was to make every blob small enough that it could not reach a dry
   gauge, and that was built first and thrown away too. It cost the same ground everywhere — over
   Sabak Bernam, where the nearest other gauge is 12 km off and nothing disputes anything, as over
   Ampang where a dry gauge stands 1.6 km away. Sizing on the evidence keeps the reach where there
   is no evidence against it. */

/* Two kernels, because a cell asks two questions and one curve cannot answer both. Both hold full
   strength across the inner fraction named here, then smoothstep to nothing at the radius.

   `BLEND` sizes the say each reading gets in the mean. It falls off early on purpose. A gauge most
   of a radius away must not argue as loudly as the one underfoot.

   `FEATHER` sizes the coverage, which is only the soft outer edge of the wash. The halo is spent on
   alpha alone and the colour never moves, so a pale edge reads as "the edge of this reading" rather
   than as "lighter rain". **A rim facing empty ground and a join between two blobs are different
   edges, and the combine below is what tells them apart.** That is what lets this sit as low as it
   does. Coverage alone at 0.20 would hollow out every join.
   It is shorter than `BLEND`, and that is allowed: far ground takes its colour from a mix of
   readings and is nearly transparent while it does so. The two answer different questions.
   **This value is sized against station spacing measured in blob radii, so a radius moves it.** At
   9 km the rain network's 90th-percentile join sat at 1.48 radii and this stood at 0.50. At 6 km the
   same join is 1.66 radii, because thinning at a shorter distance keeps stations relatively further
   apart.
   **`BLEND` and `FEATHER` are shared by both layers and neither is a rain setting.** That works
   because the two networks land at nearly the same spacing once measured in radii. Rainfall at 6 km
   reads 1.21 / 1.66 / 1.95 for median, 90th percentile and widest. Water at 5 km reads
   1.18 / 1.68 / 1.99. Each radius was picked for its own network's density, so the ratio comes out
   in the same place. **If a change ever pulls those two rows apart, `FEATHER` becomes a per-layer
   option beside `groundKm` rather than staying a module constant.** The spacing sweep in CLAUDE.md
   prints both rows. Re-run it after any change to `RAIN_KM` or `HEAT_KM`.

   **One curve served both for a while, and it drew a border on every equidistant line.** The blend
   weight is down to 0.30 at 0.8 of a radius, which is right for a weight and wrong for coverage.
   `thinHeat()` only guarantees a radius between two gauges, so real spacings run past 1.5 of one.
   Measured on two gauges that agreed on the same rain: alpha 179 at each of them and 61 between
   them at 1.6 radii, 20 at 1.8. On an unequal pair the midpoint came out at 54 against ends of 242
   and 89 — darker than either gauge, which is a line drawn between two cells. */
const BLEND = 0.45, FEATHER = 0.2;

/* Smoothstep from 1 at the core edge `k` to 0 at the radius. Hoisted out of `_field()` on purpose:
   the inner loop runs about half a million times per paint, and a closure per point there is half a
   million allocations for two multiplies of work. */
function ramp(t, k) { const u = (t - k) / (1 - k); return 1 - u * u * (3 - 2 * u); }

/* **This layer stamps no gradients any more, and it must not start again without reading this.**
   A canvas radial gradient does not stop at its last stop, it *clamps* to it, so every pixel beyond
   `r` keeps whatever the outermost colour was. Filled as a square rather than as a disc, the four
   corners outside the circle — 21% of the box — therefore carried full strength, and the eraser
   that once used one cut hard rectangles out of the wash, axis-aligned and about 2r on a side. That
   reads as a tiling or a canvas-tile fault and is neither. `_field()` computes every pixel now, so
   there is no sprite and no disc to get wrong. A `stamp()` helper guarded the trap while the pass
   existed and went with it. */

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

  setDry(latlngs) { this._dry = latlngs; return this.redraw(); },

  /* Paint the readings as a field rather than as a pile of shapes. **Two gauges over one patch of
     ground still mean what they read, not the sum of what they read**, and no canvas composite
     operation can say that: every Porter-Duff `over` adds alpha, so a second blob made the same
     rain look heavier. Drawing the blobs as shapes is what produced 227 alpha where two 179 blobs
     met, in the class above what either gauge reported.
     So each cell asks the readings instead of being stamped by them:
       `v`   the blended reading — every gauge in reach, weighted by how near it is, **normalised**.
             A weighted mean, so two gauges reading the same thing give that thing back.
       `cov` whether any reading reaches this ground at all, as a union and never a max. It carries
             the soft edge, and it is why an isolated blob still fades out while an overlap does
             not brighten.
     Colour is `_grad[v]`, the ramp simpleheat builds from `options.gradient`, so the legend stays
     the one definition of what a colour means. Opacity is `v * cov`.
     `CELL` is the trade. The field is computed on a coarse grid and scaled up with the browser's
     own bilinear filter, which is what makes the transition between two gauges smooth for free.
     At 4 px that is about 59,000 cells against a viewport, a few milliseconds per `moveend`, and
     the smoothing hides the grid. Raise it and the edges go blocky. Lower it and the cost climbs
     with the square. */
  _field(ctx, pts, dry, r) {
    const CELL = 4, grad = this._heat._grad;
    const w = this._canvas.width, h = this._canvas.height;
    const cw = Math.ceil(w / CELL), ch = Math.ceil(h / CELL);
    const off = this._grid || (this._grid = document.createElement('canvas'));
    if (off.width !== cw || off.height !== ch) { off.width = cw; off.height = ch; }
    const octx = off.getContext('2d', { willReadFrequently: true });
    const img = octx.createImageData(cw, ch), d = img.data, r2 = r * r;

    /* Bucket the readings into a grid one radius across, so a cell tests its own bucket and the
       eight around it rather than every reading on the map. Anything within `r` of a cell has to
       be in one of those nine, so nothing is missed.
       **This is not a premature optimisation, it is the difference between usable and frozen.**
       Without it the cost is cells × readings, and `thinHeat()` packs readings one radius apart —
       so zooming out shrinks the radius and multiplies the readings at the same time. Measured on
       a full viewport at that spacing: 52 ms with 30 readings, 785 ms with 638, and 3.0 s with
       2,655, against a flat 35 ms indexed at every one of those. A flood is exactly when a lot of
       stations report at once and exactly when the map must not seize. */
    const nbx = Math.ceil(w / r) + 3, nby = Math.ceil(h / r) + 3;
    const index = list => {
      const bins = new Array(nbx * nby);
      for (let i = 0; i < list.length; i++) {
        const bx = Math.floor(list[i][0] / r) + 1, by = Math.floor(list[i][1] / r) + 1;
        if (bx < 0 || by < 0 || bx >= nbx || by >= nby) continue;
        const k = by * nbx + bx;
        (bins[k] || (bins[k] = [])).push(list[i]);
      }
      return bins;
    };
    const bins = index(pts), dbins = index(dry);

    for (let gy = 0; gy < ch; gy++) {
      const py = gy * CELL + CELL / 2, cby = Math.floor(py / r) + 1;
      for (let gx = 0; gx < cw; gx++) {
        const px = gx * CELL + CELL / 2, cbx = Math.floor(px / r) + 1;
        let sum = 0, wsum = 0, csum = 0, wnear = 0, dsum = 0, dnear = 0;
        for (let by = cby - 1; by <= cby + 1; by++) {
          if (by < 0 || by >= nby) continue;
          for (let bx = cbx - 1; bx <= cbx + 1; bx++) {
            if (bx < 0 || bx >= nbx) continue;
            const k = by * nbx + bx, b = bins[k], q = dbins[k];
            if (b) for (let i = 0; i < b.length; i++) {
              const dx = px - b[i][0], dy = py - b[i][1], dd = dx * dx + dy * dy;
              if (dd >= r2) continue;
              const t = Math.sqrt(dd) / r;
              const f = t > BLEND ? ramp(t, BLEND) : 1;
              if (f > 0) { sum += f; wsum += f * b[i][2]; }
              // Coverage is summed here and shaped below. Never take the largest — see `cov`.
              const c = t > FEATHER ? ramp(t, FEATHER) : 1;
              csum += c; wnear += c / (dd + 1);
            }
            /* The gauges reporting no rain, read at the same radius and through the same kernel as
               the ones reporting rain. **A station saying "none" is one reading, and it covers the
               same ground as a station saying "12 mm".** */
            if (q) for (let i = 0; i < q.length; i++) {
              const dx = px - q[i][0], dy = py - q[i][1], dd = dx * dx + dy * dy;
              if (dd >= r2) continue;
              const t = Math.sqrt(dd) / r;
              const c = t > FEATHER ? ramp(t, FEATHER) : 1;
              dsum += c; dnear += c / (dd + 1);
            }
          }
        }
        if (!sum) continue;
        /* Shape the summed coverage. **A rim facing empty ground and a join between two blobs must
           not fade alike**, and summing is what separates them: one gauge at half strength stays
           half covered, while two blobs meeting at half strength each read as fully covered.
           `max` cannot see the difference at all and drew a Voronoi border. A union
           (`1-(1-c1)(1-c2)…`) sees it and saturates too slowly to act on it — with `FEATHER` this
           low it hollows out every join.
           The clamp is squared rather than bare, because `min(1, sum)` breaks its first derivative
           where it bites. That is a crease along an iso-contour, which is the Voronoi fault again
           on a different line. `1-(1-s)²` has slope 0 at s=1 and meets the flat part smoothly.
           Squared is also the highest power that still fades the rim gently, since a higher one
           holds full opacity further out and hardens the edge it exists to soften. Measured against
           the whole gauge network at `RAIN_KM` 6: a join at the median spacing holds 100% of a
           gauge centre, and the softest tenth of joins sit at 42%. That tenth is the price of a
           6 km blob with a 2.35 km rim fade — the two blobs really are 10 km apart, so each one
           stops 3 km short of the ground between them. */
        const s = csum < 1 ? csum : 1, cov = 1 - (1 - s) * (1 - s);
        /* What the gauges reporting no rain take back, shaped exactly like `cov` because it is the
           same question asked of the other answer. `gate` is who owns this ground, by inverse
           square distance to each side — Shepard's weighting, and the reason it is used here is the
           one property that matters: a gauge's own point is a singularity, so **at a wet gauge the
           gate is 0 and its reading survives whole, and at a dry gauge it is 1 and the ground is
           denied whole.** Exactly halfway between a wet gauge and a dry one it is 0.5, which is the
           boundary rule this layer has always stated. With no wet gauge in reach it is 1, so a dry
           gauge denies its full radius.
           **That last case is why this moved out of a `destination-out` stamp.** The stamp took one
           scalar radius, `min(r, nearest_wet / 2)`, so a dry gauge with a wet neighbour to the east
           shrank to half that gap *in every direction* — including west, where nothing disputed it.
           Measured on the live network: 143 of 191 dry gauges were capped, at a median of 0.54 of
           the radius, and together they denied 35% of the ground they were entitled to deny. The
           cap existed to stop an eraser reaching across a wet gauge and taking its reading off the
           map, which is real — a dry gauge on the same pole erased its neighbour outright. The gate
           answers that per pixel instead of per gauge, so the protection stays and the reach comes
           back. */
        const ds = dsum < 1 ? dsum : 1, dcov = 1 - (1 - ds) * (1 - ds);
        const keep = dnear ? 1 - dcov * (dnear / (wnear + dnear)) : 1;
        const v = wsum / sum, o = (gy * cw + gx) * 4, g = Math.round(v * 255) * 4;
        d[o] = grad[g]; d[o + 1] = grad[g + 1]; d[o + 2] = grad[g + 2];
        // Colour is `_grad[v]` and the denial only touches alpha, so an erased edge fades at the
        // colour it already had. That was true of the old `destination-out` pass and stays true.
        d[o + 3] = Math.round(v * cov * keep * 255);
      }
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(off, 0, 0, w, h);
  },

  _redraw() {
    if (!this._map || !this._canvas || !this._heat?._grad) return;
    const r = blobPx(this.options.groundKm), pad = this._pad(), size = this._map.getSize();
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
    if (near.length) this._field(ctx, near, dry, r);
    ctx.restore();
    this._frame = null;   // this override never calls the stock _redraw, which used to clear it
  },
});

/* `groundKm` is how far one of this layer's blobs may reach, and it is an option on the layer so
   that the paint, the feather, the eraser and `thinHeat()` cannot end up measured against four
   different rulers. The two layers differ because the two readings differ: a river level speaks for
   a catchment, an hour of rain speaks for a few streets. See HEAT_KM and RAIN_KM in config.js. */
export const heat = new SoftHeat([], {
  ...BASE,
  groundKm: HEAT_KM,
  /* Stops are the thresholds, not arbitrary fractions: render.js weights each point by where it
     sits on its own alert / warning / danger scale, so yellow means "past alert", orange "past
     warning" and red "at danger" — the same reading the pin and the meter give, in the same
     colours. Nothing is drawn below the alert slot, so the flat run under it is never seen.
     The legend ramp in the panel is this gradient; change both together. */
  gradient: { 0: '#ffd166', [HEAT_ALERT]: '#ffd166', [HEAT_WARNING]: '#ff9f1c', 1: '#ff4d4d' },
});

/* Rainfall as a second layer rather than another weight on the first. They answer different
   questions — "how high is the water" and "how hard is it coming down" — and a station carrying both
   would have summed a river level with the rain falling on it into one number that answers neither.
   Two layers also means either can be read alone, which is the point of the two chips.
   Colours are RAIN_HEAT — the same classes the rainfall pins wear, as real values rather than the
   tokens the pins use, because this gradient is baked into an ImageData and a canvas cannot resolve
   a `var()`. One set for both themes: a blob is composited *over* the basemap at low alpha rather
   than read against it. The flat run below the first class *is* seen here, unlike the water layer:
   anything above 0 mm is drawn, so drizzle paints the lightest violet rather than nothing. */
export const rainHeat = new SoftHeat([], {
  ...BASE,
  groundKm: RAIN_KM,
  gradient: {
    0: RAIN_HEAT[1], 0.25: RAIN_HEAT[1], 0.5: RAIN_HEAT[2], 0.75: RAIN_HEAT[3], 1: RAIN_HEAT[4],
  },
});

const LAYERS = [heat, rainHeat];

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

function heatScale() {
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
    l._fade = px <= HEAT_MAX_PX ? 1 : Math.max(0, 1 - Math.log2(px / HEAT_MAX_PX) / 2);
    l.redraw();   // the radius is read inside _redraw(), so there is no option to set
  }
  heatOpacity();
}

// leaflet.heat has no opacity option, so we fade its canvas directly. It is recreated whenever the
// layer is re-added, hence the re-apply after every render.
export function heatOpacity() {
  const pct = +el('heatOpacity').value;
  el('heatOpacityVal').textContent = pct + '%';
  for (const l of LAYERS) if (l._canvas) l._canvas.style.opacity = pct / 100 * (l._fade ?? 1);
}

/* Puts the map, the legend, the two chips and the section summary on `PREFS.heatLayer`. One string
   with three values, so exactly one scale is ever on screen — never a stack of two ramps to read
   against each other. The opacity slider sits below both and serves either.
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
   at a second site, for the two pin filters, and it exists because of this entry. */
export function syncHeat() {
  const wet = PREFS.heatLayer === 'water', rainy = PREFS.heatLayer === 'rain';
  el('heat').checked = wet;
  el('rainHeat').checked = rainy;
  /* Two things take the wash off the map, and NEITHER writes PREFS.heatLayer. That is the whole of
     "turn the previous heatmap back on": the reader's choice never left, so restoring it needs no
     state remembered anywhere.
     Weather mode takes the map outright. `Stations` is the reader switching the station layer off,
     and the heatmap is a choice about that layer — it sits inside it in `#paintmenu` — so it goes
     with it. A wash still drawn under a switched-off Stations is a layer with its control hidden,
     which is worse than a control with nothing under it. */
  const show = PREFS.mapLayer === 'stations';
  /* No summary line here any more. This choice left the drawer for the map's own top-left corner,
     and the button there draws the active layer's own glyph. So what the map paints is on screen
     without opening anything, which is what the drawer summary was for. That glyph is CSS, off the
     three checkboxes this function writes, so there is nothing to keep in step from here. */
  wet && show   ? heat.addTo(map)     : heat.remove();
  rainy && show ? rainHeat.addTo(map) : rainHeat.remove();
  el('lgWater').style.display = wet && show ? '' : 'none';
  el('lgRain').style.display  = rainy && show ? '' : 'none';
  // The legend box holds three sections now, so one function decides whether the box itself shows.
  el('lgWx').style.display = PREFS.mapLayer === 'weather' ? '' : 'none';
  /* The opacity slider drives whichever canvas is on the map, through the LAYERS loop in
     heatOpacity() below. Weather mode and the "off" choice both leave neither canvas on the map.
     A slider left on screen there acts on nothing. That is worse than no slider at all. */
  el('heatOpacityRow').style.display = (wet || rainy) && show ? '' : 'none';
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
// the options first is enough. Calling redraw() as well painted the canvas twice per zoom.
map.on('zoomend', heatScale);
