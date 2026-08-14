// Geolocation. map.locate() wraps the Geolocation API — permission prompt, timeout and
// zoom-to-fit included.

import { state, PREFS, save } from './state.js';
import { el } from './util.js';
import { map, focusOn, openSide, ping, pinGlyph } from './map.js';
import { herePopup, hereFail } from './popup.js';
import { alerts } from './alerts.js';

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

/* The ripple the jump-to-station flash uses, in the location blue rather than the alert red — a red
   ring round your own position reads as a warning about you.
   Arriving is the part with no feedback: the button goes blue the moment a fix lands, but the map
   then pans and zooms to a marker that was already sitting there before you asked, so on the second
   click nothing on screen changes except the view. This is what says "there — that one is you". */
const flashMe = () => ping(at, 'me');

btn.onclick = () => {
  wantPopup = true;
  if (!at) return findMe(true);       // no fix yet — prompt for one
  showHere();                         // already have one: recentre and show what is around you
  focusOn(at, 13);
  flashMe();
};

// One path for both a live fix and a restored one: everything downstream should not be able to tell
// the difference, because there isn't one worth telling.
function place(latlng, accuracy, setView) {
  at = state.hereAt = latlng;
  acc = accuracy;
  btn.className = 'icon on';
  btn.title = `Recenter on my location (±${Math.round(accuracy)} m)`;
  if (layer) layer.remove();

  marker = L.marker(latlng, { icon: L.divIcon({
    /* A map pin, so it reads as a marker rather than as one more sensor glyph — and `home_pin`
       rather than a plain teardrop, because the shape inside it is what says *whose* pin.
       A pin points at its **tip**: the anchor is the bottom-centre of the box, not the middle, or
       the mark would sit half its own height north of you. That is the whole difference between
       this and the crosshair it replaced, which was the point it marked. */
    // 44, not 48: Material draws the glyph inside its viewBox with a little air, so the pin's tip
    // sits ~8% of the box above its bottom edge. Anchoring to the box would float the mark.
    className: '', iconSize: [48, 48], iconAnchor: [24, 44],
    html: `<span class="pin me">${pinGlyph('home_pin')}</span>`,
  }) }).on('click', showHere);

  // Coloured from `.mecircle` in map.css rather than through Leaflet's `color` option, for the same
  // reason the mast ring is: those options become SVG presentation attributes, which cannot resolve
  // a token — and "you" is one colour across the pin, this circle and the arrival ripple.
  layer = L.layerGroup([
    L.circle(latlng, { radius: accuracy, className: 'mecircle', weight: 1, fillOpacity: .12 }),
    marker,
  ]).addTo(map);

  if (setView) focusOn(latlng, 13);   // map.locate() does this itself; a restored fix has to ask
  // Only when the user asked. The landing auto-locate places the marker without moving the view, and
  // a ripple over a corner of the map nobody is looking at is a flicker with no referent.
  if (wantPopup) { showHere(); flashMe(); }
  if (state.data.length) alerts();   // re-sort the alert list nearest-first now that we know where you are
  // A fix can land while the table is open — it has a "my location" row that could not exist a
  // moment ago. Redraw so the row appears rather than waiting for the next thing to touch it.
  // A dialog can only be open because its opener already imported the module, so this resolves
  // from the module map with no request — the same shape js/render.js uses on every poll, with the
  // same rejection handler: this has no surface to report a failure on, and a fix can land many
  // times while a failed dialog sits open, so a bare `.then()` here would raise one unhandled
  // rejection per fix.
  if (el('dataBox').open) import('./table.js').then(m => m.dataTable(), () => {});
}

map.on('locationfound', e => {
  PREFS.fix = [+e.latlng.lat.toFixed(5), +e.latlng.lng.toFixed(5), Math.round(e.accuracy), Date.now()];
  save();
  place(e.latlng, e.accuracy, false);   // locate() already moved the view if it was asked to
});

/* Whether this site holds the grant. The card needs it to tell a site that refuses from a device
   that refuses, and those take a reader to two different screens. The catch covers a browser with
   no Permissions API, and one that rejects a name it does not know. Both leave the answer null,
   and the card then names both halves. */
const sitePerm = async () => {
  try { return (await navigator.permissions.query({ name: 'geolocation' })).state; }
  catch { return null; }
};

map.on('locationerror', async e => {
  btn.className = 'icon';
  btn.title = 'Show my location';
  /* Only where the reader asked, the same gate the arrival ripple takes. The landing auto-locate is
     a question nobody asked, and a card that opens by itself replaces what the reader opened.
     Leaflet forwards the code and prefixes the message with its own words, so the card reads
     `e.code` and never the sentence. */
  if (wantPopup) openSide('@here', hereFail(e.code, await sitePerm()));
});
