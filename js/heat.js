// Water-level heatmap. Flooding is catchment-scale, so a hotspot should mean "this part of
// Selangor", not "this gauge".

import { HEAT_KM, HEAT_MAX_PX } from './config.js';
import { map } from './map.js';
import { el } from './util.js';

export const heat = L.heatLayer([], {
  // maxZoom is not a display limit — leaflet.heat divides every weight by 2^(maxZoom - zoom), so
  // any value inside our zoom range dims the blobs as you zoom out. 0 pins the factor at 1.
  radius: 70, blur: 55, maxZoom: 0,
  // The whole ramp is spent on the last tenth of the way to danger (HEAT_FLOOR), so it opens at
  // amber, not blue: anything painted at all is already near its mark.
  // Gradient stops match the legend ramp in the panel — change both together.
  gradient: { 0: '#ffd166', 0.5: '#ff9f1c', 1: '#ff4d4d' },
});

let fade = 1;   // extra dimming once the blob can no longer cover its ground distance

// leaflet.heat sizes blobs in screen pixels, which makes them cover less ground the further you
// zoom in. Recomputing the radius per zoom pins each blob to a fixed distance on the ground.
export function heatScale() {
  if (!map.hasLayer(heat)) return;              // nothing to size while the layer is off
  const c = map.getCenter();
  const east = L.latLng(c.lat, c.lng + HEAT_KM / (111 * Math.cos(c.lat * Math.PI / 180)));
  const px = Math.abs(map.latLngToLayerPoint(east).x - map.latLngToLayerPoint(c).x);
  // Blur cost grows with the square of the radius, so the blob can't keep pace with 4km forever.
  // Past the cap it would silently start covering less ground — a hotspot that means something
  // different at each zoom. Fade it out over the next two zoom levels instead of lying about size.
  const r = Math.max(10, Math.min(HEAT_MAX_PX, px));
  fade = px <= HEAT_MAX_PX ? 1 : Math.max(0, 1 - Math.log2(px / HEAT_MAX_PX) / 2);
  heat.setOptions({ radius: r, blur: r * 0.8 });
  heatOpacity();
}

// leaflet.heat has no opacity option, so we fade its canvas directly. It is recreated whenever the
// layer is re-added, hence the re-apply after every render.
export function heatOpacity() {
  const pct = +el('heatOpacity').value;
  el('heatOpacityVal').textContent = pct + '%';
  if (heat._canvas) heat._canvas.style.opacity = pct / 100 * fade;
}

// No redraw call here: leaflet.heat repaints on the moveend that follows every zoomend, so setting
// the options first is enough. Calling redraw() as well painted the canvas twice per zoom.
map.on('zoomend', heatScale);
heat.addTo(map);
