// Geolocation. map.locate() wraps the Geolocation API — permission prompt, timeout and
// zoom-to-fit included.

import { state, PREFS, save } from './state.js';
import { el, snack } from './util.js';
import { map, focusOn, openSide, ping, inCover, coverReady } from './map.js';
import { herePopup, outsidePopup } from './popup.js';
import { alerts } from './alerts.js';

/* **The button is the first cell of Leaflet's zoom control, above the plus.** A reader asked for one
   control on 2026-09-15. This module builds it there, so it rides the map card and follows the pane.
   `index.html` does not carry it. A node written there would sit in the page flow until this runs.
   **A press must not reach the map.** Leaflet stops propagation on its own two links alone, so a
   button added to the bar needs the same call. */
const zoomBar = document.querySelector('.leaflet-control-zoom');
zoomBar.insertAdjacentHTML('afterbegin', '<button id="locate" data-tip="Show my location" '
  + 'aria-label="Show my location"><i class="i i-my_location"></i></button>');
const btn = zoomBar.firstElementChild;
L.DomEvent.disableClickPropagation(btn);
let layer, marker, at, acc;
let wantPopup = false;   // only pop up when the user asked; never on the landing auto-locate

/* **A fix outside the coverage circle gets no jump and no ripple.** The map may not pan there, so a
   recentre would drag to the edge of the pan limit and stop, which reads as a control that failed
   halfway. The card says where the reader is instead — see `outsidePopup()` in js/popup.js.
   `out` is written in `place()` and read by the button, the card and the warning. One answer, from
   `inCover()`, so those three cannot disagree. */
let out = false;

/* The words, once, because two surfaces say them: the snackbar below and the button's own tip. The
   card states the same fact in its own sentence, and that one names what the map does cover. */
const OUTSIDE = 'You are outside the coverage area.';

/* **Said once, and the landing is where it lands.** `wantPopup` is false on the auto-locate, so
   nothing else on screen answers a reader whose position this map cannot use. Every later fix comes
   from a press, which opens the card, and a snackbar over a card that states the same fact is the
   second wording of one claim.
   The flag makes it once even so. A reader who refuses location on landing and grants it later
   reaches `place()` again, and a warning that repeats teaches a reader to dismiss it. */
let warned = false;

/* What `map.locate()` was asked to do with the view. Leaflet is told `setView: false` now and
   `place()` does the move, because Leaflet moves the view the moment a fix lands and this app has to
   read the fix first. A fix outside the circle is one this map must not travel to. */
let wantView = false;

/* One writer for the button's three states, so no attribute survives a transition it does not
   belong to. A tip left over from a failure would name a fault on a button that has since found
   you.
   The words ride on `data-tip` rather than on a `title`, because a `title` opens on no phone. That
   is the rule `js/sparktip.js` exists for, and it names anything holding the attribute, on hover
   and on tap alike, so this needs no listener of its own.
   The label is the accessible name. A colour and a hover are two things a screen reader cannot
   reach, so a failure has to arrive as text as well. */
// `#locate` in css/chrome.css sets the size and the shape, so the class carries the state alone.
/* **There is no navigation bar twin since 2026-09-15.** `#navLocate` carried the glyph, the words
   and the state below 600px, while this button did not draw there. A reader deleted it when the
   button joined the zoom control at every width. */
/* What state the control is in, and the words that state carries. `btn.onclick` reads both: two of
   the three states have nothing on screen that says why, and a snackbar is what says it. */
let mode = '', words = '';
const setBtn = (cls, label, tip) => {
  mode = cls || '';
  words = tip || label;
  btn.className = cls || '';
  btn.setAttribute('aria-label', words);
  /* **One channel for the words, and it is `data-tip`.** This wrote a `title` in the states that
     had no tip of their own, so the resting button carried a native tooltip and the failed one a
     styled one. Two shapes for one control. Every `title` in this app went the same way on
     2026-08-26, and the reason is the one this file already states: a `title` opens on no phone. */
  btn.dataset.tip = words;
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

/* The one non-station card the panel shows. Built fresh on every open so it reflects the latest
   poll; the `@` key keeps render()'s refresh pass off it, since it belongs to no site.

   Two cards under one key, one per map layer. Weather mode draws no station pin, so the four
   nearest sensors and the nearest camera name five places the map does not draw. It gets the same
   full forecast a weather pin opens instead, over the point nearest the fix — see `hereCard()` in
   wx.js. A smaller summary of the same forecast was the first answer here, and one fact does not
   get two looks.

   `wx.js` is deferred, and weather mode is the only way to reach this branch, so the import
   resolves from the module map with no request. That is the shape `place()` below already uses for
   the table. An empty answer means no MET point within `NEAR_MAX_KM`, and the station card prints
   the sentence that says so. A failed import falls through to the same place. */
export const showHere = async () => {
  // Outside the circle neither of the two cards below can answer. Both name sensors, and no sensor
  // this app carries is within reach of the reader.
  if (out) return openSide('@here', outsidePopup({ accuracy: acc }));
  if (PREFS.mapLayer === 'weather') {
    try {
      const html = (await import('./wx.js')).hereCard(at);
      if (html) return openSide('@here', html);
    } catch { /* fall through to the card below */ }
  }
  openSide('@here', herePopup({ latlng: at, accuracy: acc }, state.data.length > 0));
};

/* A fix is worth keeping for a quarter of an hour. Every reload was re-asking the Geolocation API,
   which on a phone means waking the GPS for a position that has not meaningfully changed — and the
   whole map is a 4 km-radius question, so a 50 m drift changes none of its answers. Stored in the
   one prefs blob like every other setting.
   `maximumAge` says the same thing to the browser's own position cache, which is the layer that can
   actually skip the hardware; the stored copy is what survives the reload that clears it. */
const FIX_TTL = 15 * 60 * 1000;

/* **Every fix waits for the coverage circle, and a restored one is why.** `place()` asks `inCover()`
   for the one answer three surfaces read, and that function answers yes until `border.json` lands. A
   stored fix resolves in the same tick this module is imported, which is long before a fetch can
   come back, so a reader outside the area would have been handed the inside behaviour on every
   reload. `coverReady` never rejects, and it carries the zoom floor too, so nothing on this map is
   usable before it anyway.
   A live fix takes the same road. Geolocation is slower than a 4 KB local file every time measured,
   and a race nobody can lose is still a race. */
export function findMe(setView) {
  const f = PREFS.fix;
  if (f && Date.now() - f[3] < FIX_TTL)
    return coverReady.then(() => place(L.latLng(f[0], f[1]), f[2], setView));

  setBtn('busy', 'Finding your location…');
  wantView = setView;
  // `setView: false`, always. See `wantView` above: this app reads the fix before it moves to it.
  map.locate({ enableHighAccuracy: true, timeout: 10000, maximumAge: FIX_TTL });
}

/* The ripple the jump-to-station flash uses, in the location blue rather than the alert red — a red
   ring round your own position reads as a warning about you.
   Arriving is the part with no feedback: the button goes blue the moment a fix lands, but the map
   then pans and zooms to a marker that was already sitting there before you asked, so on the second
   click nothing on screen changes except the view. This is what says "there — that one is you". */
const flashMe = () => ping(at, 'me');

/* **A press opens no card on a phone.** A reader asked for that on 2026-09-15. Below 600px the card
   is a full-screen dialog, so it covers the map that the press just moved. The recentre and the
   ripple answer the press there. A tap on the dot still opens the card. */
const phone = matchMedia('(max-width: 600px)');
const offerCard = () => { if (!phone.matches) showHere(); };

/* **Two of the three states answer with a snackbar, and both had nothing to say before.** The glyph
   carries the state and `data-tip` carries the reason, and a tip opens on hover. A phone has no
   hover. So a reader pressed, waited, and met a control that appeared to do nothing.
   **Busy refuses a second attempt.** `map.locate()` is already running, and a second call is a
   second wait rather than a faster one.
   **Fail says the reason and then tries again.** Without the retry, one refusal leaves the control
   dead for the rest of the session, and a reader who has just turned location on has no way back.
   The words are `failTip()`'s own, so the snackbar and the tip make one claim. */
btn.onclick = () => {
  if (mode === 'busy') return snack(words);
  wantPopup = true;
  if (mode === 'fail') { snack(words); return findMe(true); }
  if (!at) return findMe(true);       // no fix yet — prompt for one
  /* **Outside the circle the card is the whole answer, at every width.** There is no recentre and no
     ripple out here, so `offerCard()`'s desktop-only rule would leave a phone press doing nothing at
     all. The card is the only thing on screen that can say why. */
  if (out) return showHere();
  offerCard();                        // already have one: recentre and show what is around you
  focusOn(at, 13);
  flashMe();
};

// One path for both a live fix and a restored one: everything downstream should not be able to tell
// the difference, because there isn't one worth telling.
function place(latlng, accuracy, setView) {
  at = state.hereAt = latlng;
  acc = accuracy;
  out = !inCover(latlng);
  /* The button keeps the `on` class out here. The state is true — this app holds a fix — and the
     three classes are what the glyph and the ink read. What changes is what a press does, and the
     words are where that is stated. `fail` would be a lie: nothing failed. */
  setBtn('on', out ? OUTSIDE : `Recenter on my location (±${Math.round(accuracy)} m)`);
  if (layer) layer.remove();

  marker = L.marker(latlng, { icon: L.divIcon({
    /* `my_location`, the same crosshair the locate button wears, so the control and the mark it
       drops read as one thing.
       **A crosshair is anchored at its CENTRE, and a pin is anchored at its tip.** The mark IS the
       point here, rather than a teardrop hanging over it, so the anchor is the middle of the box.
       [24, 44] under a crosshair stands the mark 20px north of the fix. This held `home_pin` before,
       and that glyph took the tip anchor for the reason this line no longer has. */
    className: '', iconSize: [48, 48], iconAnchor: [24, 24],
    /* **A BARE DOT, drawn by `.pin.me::before` in map.css — there is no glyph here any more.** The
       repository owner asked for that on 2026-08-26. The box stays 48px and anchored at its centre:
       `.pin` is a centring grid, so the dot lands on the fix with no second number to keep in step,
       and the accuracy circle below still draws behind it. */
    html: '<span class="pin me"></span>',
  }) }).on('click', showHere);

  // Coloured from `.mecircle` in map.css rather than through Leaflet's `color` option, for the same
  // reason the mast ring is: those options become SVG presentation attributes, which cannot resolve
  // a token — and "you" is one colour across the pin, this circle and the arrival ripple.
  layer = L.layerGroup([
    L.circle(latlng, { radius: accuracy, className: 'mecircle', weight: 1, fillOpacity: .12 }),
    marker,
  ]).addTo(map);

  // Leaflet is told `setView: false` on every call now, so both paths move the view here or not at
  // all. Never to a fix outside the circle: the pan limit would stop the travel part way.
  if (setView && !out) focusOn(latlng, 13);
  /* Said once, and on the landing, which is the one path that opens no card. See `warned` above. */
  if (out && !wantPopup && !warned) { warned = true; snack(OUTSIDE); }
  // Only when the user asked. The landing auto-locate places the marker without moving the view, and
  // a ripple over a corner of the map nobody is looking at is a flicker with no referent.
  // Out of coverage the card opens at every width, because nothing else answers the press there.
  if (wantPopup) { if (out) showHere(); else { offerCard(); flashMe(); } }
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
  // `wantView`, not false: `locate()` is asked for no view of its own now, so this call owns the
  // move. `coverReady` for the reason findMe() states — `place()` must not run before the circle.
  coverReady.then(() => place(e.latlng, e.accuracy, wantView));
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
