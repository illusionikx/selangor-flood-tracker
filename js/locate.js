// Geolocation. map.locate() wraps the Geolocation API — permission prompt, timeout and
// zoom-to-fit included.

import { state } from './state.js';
import { el, popWidth } from './util.js';
import { map, focusOn } from './map.js';
import { herePopup } from './popup.js';
import { alerts } from './alerts.js';

const btn = el('locate');
let layer, marker, at;
let wantPopup = false;   // only pop up when the user asked; never on the landing auto-locate

export function findMe(setView) {
  btn.className = 'icon busy';
  btn.title = 'Finding your location…';
  map.locate({ setView, maxZoom: 13, enableHighAccuracy: true, timeout: 10000 });
}

btn.onclick = () => {
  wantPopup = true;
  if (!at) return findMe(true);       // no fix yet — prompt for one
  focusOn(at, 13);                    // already have one: recentre and show what is around you
  marker.openPopup();
};

map.on('locationfound', e => {
  at = state.hereAt = e.latlng;
  btn.className = 'icon on';
  btn.title = `Recentre on my location (±${Math.round(e.accuracy)} m)`;
  if (layer) layer.remove();

  marker = L.marker(e.latlng, { icon: L.divIcon({
    className: '', iconSize: [30, 30], iconAnchor: [15, 15], html: '<span class="pin me"><i class="i i-person"></i></span>',
  }) }).bindPopup(() => herePopup(e, state.data.length > 0),
    { minWidth: popWidth('here'), maxWidth: popWidth('here') });

  layer = L.layerGroup([
    L.circle(e.latlng, { radius: e.accuracy, color: '#1a73e8', weight: 1, fillOpacity: .12 }),
    marker,
  ]).addTo(map);

  if (wantPopup) marker.openPopup();
  if (state.data.length) alerts();   // re-sort the alert list nearest-first now that we know where you are
});

map.on('locationerror', e => {
  btn.className = 'icon';
  // Real reason, not a guess: "User denied Geolocation", "Timeout expired", …
  btn.title = /denied/i.test(e.message)
    ? 'Location blocked — allow it in your browser’s site settings, then click again'
    : `Couldn’t get your location: ${e.message}. Click to retry`;
});
