// The two heatmaps — water level, and rainfall — on one set of sizing and opacity controls.
// Flooding is catchment-scale, so a hotspot should mean "this part of Selangor", not "this gauge",
// and rain arrives over the same sort of area.

import { HEAT_KM, HEAT_MAX_PX, HEAT_ALERT, HEAT_WARNING, RAIN_HEAT } from './config.js';
import { PREFS } from './state.js';
import { map } from './map.js';
import { el } from './util.js';

// maxZoom is not a display limit — leaflet.heat divides every weight by 2^(maxZoom - zoom), so any
// value inside our zoom range dims the blobs as you zoom out. 0 pins the factor at 1.
const BASE = { radius: 70, blur: 55, maxZoom: 0 };

export const heat = L.heatLayer([], {
  ...BASE,
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
export const rainHeat = L.heatLayer([], {
  ...BASE,
  gradient: {
    0: RAIN_HEAT[1], 0.25: RAIN_HEAT[1], 0.5: RAIN_HEAT[2], 0.75: RAIN_HEAT[3], 1: RAIN_HEAT[4],
  },
});

const layers = [heat, rainHeat];

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
   ponytail: O(n·kept), 233 × 102 here — a fraction of a millisecond. Grid-index it if the network
   ever gets an order of magnitude denser. */
export function thinHeat(points) {
  const kept = [];
  for (const p of [...points].sort((a, b) => b[2] - a[2])) {
    const clash = kept.some(k =>
      Math.hypot((k[1] - p[1]) * Math.cos(p[0] * Math.PI / 180), k[0] - p[0]) * 111 < HEAT_KM);
    if (!clash) kept.push(p);
  }
  return kept;
}

let fade = 1;   // extra dimming once the blob can no longer cover its ground distance

// leaflet.heat sizes blobs in screen pixels, which makes them cover less ground the further you
// zoom in. Recomputing the radius per zoom pins each blob to a fixed distance on the ground.
function heatScale() {
  if (!layers.some(l => map.hasLayer(l))) return;   // nothing to size while both layers are off
  const c = map.getCenter();
  const east = L.latLng(c.lat, c.lng + HEAT_KM / (111 * Math.cos(c.lat * Math.PI / 180)));
  const px = Math.abs(map.latLngToLayerPoint(east).x - map.latLngToLayerPoint(c).x);
  // Blur cost grows with the square of the radius, so the blob can't keep pace with HEAT_KM forever.
  // Past the cap it would silently start covering less ground — a hotspot that means something
  // different at each zoom. Fade it out over the next two zoom levels instead of lying about size.
  const r = Math.max(10, Math.min(HEAT_MAX_PX, px));
  fade = px <= HEAT_MAX_PX ? 1 : Math.max(0, 1 - Math.log2(px / HEAT_MAX_PX) / 2);
  for (const l of layers) l.setOptions({ radius: r, blur: r * 0.8 });
  heatOpacity();
}

// leaflet.heat has no opacity option, so we fade its canvas directly. It is recreated whenever the
// layer is re-added, hence the re-apply after every render.
export function heatOpacity() {
  const pct = +el('heatOpacity').value;
  el('heatOpacityVal').textContent = pct + '%';
  for (const l of layers) if (l._canvas) l._canvas.style.opacity = pct / 100 * fade;
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
   makes both-on unrepresentable whoever wrote the DOM. `syncRisingChip()` and `syncFavChip()` in
   render.js re-assert their own chips on every poll for the same reason. */
export function syncHeat() {
  const wet = PREFS.heatLayer === 'water', rainy = PREFS.heatLayer === 'rain';
  el('heat').checked = wet;
  el('rainHeat').checked = rainy;
  // Which of the two is on, on the section's summary — the one thing a collapsed heatmap section
  // otherwise stops saying.
  el('heatN').textContent = wet ? 'water level' : rainy ? 'rainfall' : 'off';
  wet   ? heat.addTo(map)     : heat.remove();
  rainy ? rainHeat.addTo(map) : rainHeat.remove();
  el('lgWater').style.display = wet ? '' : 'none';
  el('lgRain').style.display = rainy ? '' : 'none';
  el('legend').style.display = wet || rainy ? '' : 'none';
  heatScale();   // sizes whichever is on, and re-applies opacity
  heatOpacity();
}

// No redraw call here: leaflet.heat repaints on the moveend that follows every zoomend, so setting
// the options first is enough. Calling redraw() as well painted the canvas twice per zoom.
map.on('zoomend', heatScale);
