// Geolocation. map.locate() wraps the Geolocation API — permission prompt, timeout and
// zoom-to-fit included.

import { state, PREFS, save } from './state.js';
import { el } from './util.js';
import { map, focusOn, openSide } from './map.js';
import { herePopup } from './popup.js';
import { alerts } from './alerts.js';
import { dataTable } from './table.js';

const btn = el('locate');
let layer, marker, at, acc;
let wantPopup = false;   // only pop up when the user asked; never on the landing auto-locate

// The one non-station card the panel shows. Built fresh on every open so it reflects the latest
// poll; the `@` key keeps render()'s refresh pass off it, since it belongs to no site.
const showHere = () => openSide('@here', herePopup({ latlng: at, accuracy: acc }, state.data.length > 0));

/* A fix is worth keeping for a quarter of an hour. Every reload was re-asking the Geolocation API,
   which on a phone means waking the GPS for a position that has not meaningfully changed — and the
   whole map is a 4 km-radius question, so a 50 m drift changes none of its answers. Stored in the
   one prefs blob like every other setting.
   `maximumAge` says the same thing to the browser's own position cache, which is the layer that can
   actually skip the hardware; the stored copy is what survives the reload that clears it. */
const FIX_TTL = 15 * 60 * 1000;

export function findMe(setView) {
  const f = PREFS.fix;
  if (f && Date.now() - f[3] < FIX_TTL) return place(L.latLng(f[0], f[1]), f[2], setView);

  btn.className = 'icon busy';
  btn.title = 'Finding your location…';
  map.locate({ setView, maxZoom: 13, enableHighAccuracy: true, timeout: 10000, maximumAge: FIX_TTL });
}

btn.onclick = () => {
  wantPopup = true;
  if (!at) return findMe(true);       // no fix yet — prompt for one
  showHere();                         // already have one: recentre and show what is around you
  focusOn(at, 13);
};

// One path for both a live fix and a restored one: everything downstream should not be able to tell
// the difference, because there isn't one worth telling.
function place(latlng, accuracy, setView) {
  at = state.hereAt = latlng;
  acc = accuracy;
  btn.className = 'icon on';
  btn.title = `Recentre on my location (±${Math.round(accuracy)} m)`;
  if (layer) layer.remove();

  marker = L.marker(latlng, { icon: L.divIcon({
    className: '', iconSize: [30, 30], iconAnchor: [15, 15], html: '<span class="pin me"><i class="i i-person"></i></span>',
  }) }).on('click', showHere);

  layer = L.layerGroup([
    L.circle(latlng, { radius: accuracy, color: '#1a73e8', weight: 1, fillOpacity: .12 }),
    marker,
  ]).addTo(map);

  if (setView) focusOn(latlng, 13);   // map.locate() does this itself; a restored fix has to ask
  if (wantPopup) showHere();
  if (state.data.length) alerts();   // re-sort the alert list nearest-first now that we know where you are
  // A fix can land while the table is open — it has a "my location" row that could not exist a
  // moment ago. Redraw so the row appears rather than waiting for the next thing to touch it.
  if (el('dataBox').open) dataTable();
}

map.on('locationfound', e => {
  PREFS.fix = [+e.latlng.lat.toFixed(5), +e.latlng.lng.toFixed(5), Math.round(e.accuracy), Date.now()];
  save();
  place(e.latlng, e.accuracy, false);   // locate() already moved the view if it was asked to
});

map.on('locationerror', e => {
  btn.className = 'icon';
  // Real reason, not a guess: "User denied Geolocation", "Timeout expired", …
  btn.title = /denied/i.test(e.message)
    ? 'Location blocked — allow it in your browser’s site settings, then click again'
    : `Couldn’t get your location: ${e.message}. Click to retry`;
});
