// Geolocation. map.locate() wraps the Geolocation API — permission prompt, timeout and
// zoom-to-fit included.

import { state, PREFS, save } from './state.js';
import { el } from './util.js';
import { map, focusOn, openSide, ping, pinGlyph } from './map.js';
import { herePopup } from './popup.js';
import { alerts } from './alerts.js';

const btn = el('locate');
let layer, marker, at, acc;
let wantPopup = false;   // only pop up when the user asked; never on the landing auto-locate

/* One writer for the button's three states, so no attribute survives a transition it does not
   belong to. A tip left over from a failure would name a fault on a button that has since found
   you.
   The words ride on `data-tip` rather than on a `title`, because a `title` opens on no phone. That
   is the rule `js/sparktip.js` exists for, and it names anything holding the attribute, on hover
   and on tap alike, so this needs no listener of its own.
   The label is the accessible name. A colour and a hover are two things a screen reader cannot
   reach, so a failure has to arrive as text as well. */
const setBtn = (cls, label, tip) => {
  btn.className = cls ? `icon ${cls}` : 'icon';
  btn.setAttribute('aria-label', tip || label);
  if (tip) { btn.dataset.tip = tip; btn.removeAttribute('title'); }
  else { delete btn.dataset.tip; btn.title = label; }
};

/* Two settings in two places refuse a location, and naming the wrong one sends the reader in a
   circle. That circle happened here. One Windows desktop held the grant for this site and held its
   own location service disabled at the same time. Both accuracy settings timed out, and the first
   words this app tried named the browser alone.
   The Permissions API answers the site half, so `granted` beside a failed fix is proof that the
   device is the half at fault. A browser that answers nothing gets both halves.
   Windows is the one platform that failed this way here, so it is the one platform whose path this
   names. A reader told to open the settings for a device still has to find them. */
const WIN = /Windows/.test(navigator.userAgent);

export const failTip = (code, perm) =>
  perm === 'granted'
    ? `Location is off for this device. ${WIN
        ? 'Open Settings, then Privacy and security, then Location.'
        : 'Turn it on in the device settings.'}`
    : perm === 'denied' || code === 1
      ? 'Location is off for this site. Allow it in your browser.'
      : 'No location came back. Check that location is on for this site, and for this device.';

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

  setBtn('busy', 'Finding your location…');
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
  setBtn('on', `Recenter on my location (±${Math.round(accuracy)} m)`);
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

/* The glyph carries the state and the tip carries the reason, so nothing opens by itself. A panel
   card came first and it was too much furniture for a button that did not answer. It also had to
   stay off the landing auto-locate, because a card nobody asked for lands on whatever they were
   reading — the button has no such problem, so the amber shows on that path too.
   Leaflet forwards the code and prefixes the message with its own words, so this reads `e.code`
   and never the sentence. */
map.on('locationerror', async e => {
  setBtn('fail', 'Location unavailable', failTip(e.code, await sitePerm()));
});
