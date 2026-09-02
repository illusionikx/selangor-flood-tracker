// The Leaflet map itself: basemap/theme, the shared marker cluster, and the view helpers that
// every panel uses to jump to a station.

import { KINDS, TILES, FLASH_MS } from './config.js';
import { state, PREFS, save } from './state.js';
import { el, distKm } from './util.js';
import { byId } from './stations.js';

/* One promise, shared by every call. Callbacks on one promise run in the order they were
   registered, so a stop() registered after a start() still runs after it. That is what closes the
   gap a deferred import opens: a reader can close a card before the module arrives, and without
   this the stop would find nothing and the start would then play a clip on a closed card.
   No skeleton here. The card already shows a still, which CLAUDE.md names as one of the two
   allowed shapes for a picture path.
   `.then(fn, onImportFailed)` rather than a trailing `.catch`. A rejection handler passed as the
   second argument sees only the import failing. An error thrown inside `fn` is a bug in the clip
   itself and has to surface in the console rather than vanish.
   Clearing `clipMod` on a failure matters too. The cache holds the promise, not the module, so a
   single rejected import would otherwise be cached for the session and every later card open would
   quietly do nothing. */
let clipMod;
const withClip = fn => (clipMod ??= import('./clip.js')).then(fn, err => {
  clipMod = null;
  console.warn('clip.js did not load', err);
});

// maxZoom on the map, not just the tile layer: markercluster is added below at module load, before
// setBasemap() has run, and it throws "Map has no maxZoom specified" if no layer declares one yet.
/* `maxBoundsViscosity: 1` is a hard wall rather than a rubber band. Leaflet's default of 0 lets a
   drag leave the bounds and then springs back when the finger lifts, which reads as the map fighting
   the reader. The bounds themselves arrive with border.json — see setLimits() below. */
export const map = L.map('map', {
  maxZoom: 18, attributionControl: false, zoomControl: false, maxBoundsViscosity: 1,
}).setView(PREFS.center || [3.2, 101.4], PREFS.zoom || 9);
L.control.zoom({ position: 'bottomright' }).addTo(map);
/* **The two zoom buttons were the last `title` on the page, and Leaflet writes them.** Every other
   one in this app went on 2026-08-26, because a `title` opens on no phone and a second tooltip
   shape beside the styled one reads as a fault. These sit on the map, beside `#locate`, which draws
   a styled tip. So the pair disagreed at the one place a reader meets them together.
   Moved here rather than patched into `vendor/leaflet.js`. That file already carries three edits
   this app has to keep, and a fourth for a cosmetic rule is one more thing a version bump loses.
   Leaflet writes its own `aria-label` beside the `title`, so a screen reader loses nothing. It also
   writes both once, at `addTo()`, and never again — there is nothing here to keep in step. */
for (const a of document.querySelectorAll('.leaflet-control-zoom a')) {
  a.dataset.tip = a.title;
  a.removeAttribute('title');
}

/* --- the supporting pane --------------------------------------------------------------------- */

/* **One `<dialog>`, two variants, and the window class picks the method.** M3's canonical
   supporting-pane layout hides the supporting pane in a compact window and navigates to it as a
   full-screen destination. So below 600px this opens with `showModal()`, which is the only way to
   get the top layer, a real focus trap and an inert page behind it. Above 600px it opens with
   `show()`: a non-modal dialog is a plain positioned box, which is what a standard side sheet
   beside a live map has to be.
   **A `MutationObserver` on the body class rather than a call at each site.** The pane is open when
   one of its occupants is, and three functions write those classes — `openSide()`, `closeSide()`
   and `setFind()` in ui.js. Watching the fact beats remembering three calls, which is the same
   argument the size observer below makes.
   Crossing 600px with the pane open closes and reopens it under the other method. See the `close`
   listener below for the trap that hides in those two lines. */
const pane = el('pane'), narrow = matchMedia('(max-width: 600px)');
let paneModal = false;

/* **One writer, and it is the one that already watches the fact.** `syncPane()` runs from a
   MutationObserver on the body class, so it sees every open and every close whoever caused it. A
   call at each button would have to be remembered at seven sites, which is the argument
   `syncHeat()` already makes about a preference.
   An item is active while the surface it opens is on screen. A bare map selects nothing, and so do
   a station card and a weather card. The map is what this app draws, and it is always there. */
/* **One call writes both components, and it matches on the SUFFIX.** The rail draws above 600px and
   the navigation bar below it. Their ids differ by one prefix, `railFilters` against `navFilters`,
   so stripping it names the destination rather than the control. Writing only the component on
   screen needs a width test here, and this function is called from four writers that have none. */
export function railActive(id) {
  const want = id && id.replace(/^rail/, '');
  for (const b of document.querySelectorAll('#rail .railitem, #navbar .navitem'))
    if (want && b.id.endsWith(want)) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
}
/* `aria-expanded` rides both controls too, for the same reason. `el()` answers one id, so this takes
   the pair by suffix the way `railActive()` does. */
const navPair = name => document.querySelectorAll(`#rail${name}, #nav${name}`);

/* A dialog is a rail destination too, and `syncPane()` cannot see one from a body class alone.
   `railSync()` checks for one here, before it falls back to the drawer, the search and the alert
   list. */
const DIALOG_ITEM = { dataBox: 'railTable', camBox: 'railCams' };

/* **One function reads every input. Every writer calls this function, never `railActive()`
   directly.**
   `narrow` is a `matchMedia` listener. A modal dialog does not block it.
   `syncPane()` used to compute its own answer from the body class alone.
   So crossing 600px with the wall open cleared `railCams` from under it.
   The table and camera openers then tried to out-race that clear with a microtask yield.
   That fixed one path and left this one open.
   A derivation reads the live DOM instead, so it cannot go stale.
   Whichever writer runs last reads the same truth, so their order stops mattering. */
export function railSync() {
  const cls = document.body.classList;
  /* **The search is a FAB now, so it states `aria-expanded` and never `aria-current`.** A FAB is an
     action and a rail item is a destination, and only a destination can be the current one. It is
     derived here with everything else, rather than written inside `setFind()`. `setDrawer()` clears
     the `find` class directly below 600px, so a write in `setFind()` alone goes stale on that path.
     This runs above the dialog scan, because a dialog opening over the search does not close it. */
  for (const b of navPair('Find')) b.setAttribute('aria-expanded', String(cls.contains('find')));
  /* **There is no Filters item.** It opened `#bar`, and a reader deleted that panel on 2026-08-26. */
  for (const d of document.querySelectorAll('dialog[open]'))
    if (DIALOG_ITEM[d.id]) return railActive(DIALOG_ITEM[d.id]);
  /* **The location item is selected while its own card is the pane's occupant.** A reader asked for
     that on 2026-08-25. `@here` is the key `js/locate.js` opens under, and it is the one card in
     this pane that a navigation destination names. A station card and a weather card select
     nothing, because neither is a destination this bar carries.
     It is written as `railLocate`, the way every branch here is, and `railActive()` strips that
     prefix and matches on the suffix. So the missing rail twin costs nothing: the loop finds
     `#navLocate` and no rail item, which is the answer above 600px anyway. */
  railActive(!cls.contains('side') ? null
           : side.key === '@alerts' ? 'railAlerts'
           : side.key === '@here' ? 'railLocate' : null);
}

function syncPane() {
  const cls = document.body.classList;
  /* **`find` opens this pane at compact width alone.** Above 600px the search is M3's docked search
     view: a card that floats over the map's top-left corner, outside this dialog entirely. Below it
     the search is M3's full-screen search view, which is what this pane is there. So the class means
     two different surfaces, and only one of them is a pane occupant. */
  const want = cls.contains('side') || (cls.contains('find') && narrow.matches);
  railSync();
  if (!want) { pane.close(); return; }
  if (pane.open && paneModal === narrow.matches) return;
  pane.close();
  paneModal = narrow.matches;
  if (paneModal) { pane.showModal(); return; }
  /* **`show()` runs the dialog focusing steps too, and on a desktop that is wrong.** The pane would
     take focus into its first control before a reader has touched anything. A modal full-screen
     dialog SHOULD take focus, so only this branch puts it back. */
  const had = document.activeElement;
  pane.show();
  if (had && had !== document.body) had.focus({ preventScroll: true });
}

/* Escape and the Android back gesture both reach a modal dialog as `cancel`. Either way the element
   closes itself, so the body classes have to follow or the observer reopens the pane on the next
   class write with nothing having changed.
   **`close` is fired asynchronously, and that is why this tests the element and not a flag.** The
   spec queues the event as a task rather than firing it inside `close()`. A boolean set around the
   call is therefore already back to false when the handler runs. Measured: the event from one close
   landed AFTER the next open, so the handler cleared a class the pane was open for, and the pane
   never opened again for the rest of the session. `pane.open` cannot lie about that. It is false
   only when the element is genuinely shut, which is the one case that should clear the classes. */
pane.addEventListener('close', () => {
  if (!pane.open) document.body.classList.remove('side');
  /* **`find` is only this pane's to clear at compact width.** Above 600px the search is a docked
     card outside this dialog, and `syncPane()` closes the pane precisely BECAUSE the search opened.
     Clearing the class here then took the card away in the same frame it arrived, and the press
     read as a button that does nothing. Measured: `body` went to `find` and back to bare inside one
     tick, with no error anywhere. */
  if (!pane.open && narrow.matches) document.body.classList.remove('find');
});
new MutationObserver(syncPane)
  .observe(document.body, { attributes: true, attributeFilter: ['class'] });
narrow.addEventListener('change', syncPane);
/* **This has to run before js/ui.js's `wide` listener on the same crossing, and it does — by import
   order, not by luck.** `app.js` imports `ui.js`, and `ui.js` imports this module before its own
   top-level code runs. So this listener registers first and fires first on the same crossing.
   Crossing OUT of 600px with `find` open, that order closes `#pane` here before `place()` in ui.js
   moves `#findpane` out of it. Reversed, the move would pull the focused field out of a dialog
   `showModal()` still holds open, and everything outside a modal dialog is inert while it stays
   open. Nothing enforces the order beyond that import graph, so a reordered import would silently
   strand it. */

/* **The map's box changes without the window changing, so Leaflet has to be told.** Opening the
   supporting pane takes `--side` off the map's own width. Leaflet listens to `window.resize` and
   nothing else, so without this it keeps its old size: the tiles stop where the old edge was and
   every `latLngToContainerPoint` answers for a container that is no longer there.
   A `ResizeObserver` rather than a call at each site. The pane is one cause of a resize and the
   window, the breakpoint and a rotate are others, and an observer on the box catches every one with
   no call site to remember. Coalesced on a frame, because the observer can fire more than once for
   one change. `invalidateSize()` keeps the CENTRE by default, which is what a narrowing map wants:
   whatever the reader was looking at stays in the middle of the strip that is left.
   Measured at 711 stations: one call costs under a millisecond, so there is nothing here to
   throttle beyond the frame.

   **`debounceMoveend` is not a nicety here, and the heat layer is why.** The map card transitions
   its width, so this runs on every frame of a 300ms travel — about 18 of them. Leaflet fires
   `moveend` from each call unless told otherwise. `SoftHeat` repaints its whole field on that event,
   measured at 33 to 38ms for a full viewport, so eighteen of them is 630ms of main-thread work
   inside a 300ms animation. This app's own `moveend` handler writes the centre to `localStorage`,
   which would run eighteen times for one press.
   With the debounce both happen once, 200ms after the travel. The tiles keep up regardless: a grid
   layer redraws on `move`, which still fires per call. The heat canvas rides the overlay pane, so it
   stays glued to the ground during the travel and only the newly revealed strip waits for the
   repaint. */
let sized;
new ResizeObserver(() => {
  cancelAnimationFrame(sized);
  sized = requestAnimationFrame(() => {
    map.invalidateSize({ debounceMoveend: true });
    /* The zoom floor is measured against the window, so it moves with the box. **After
       `invalidateSize()`, never before it.** `getBoundsZoom()` reads `map.getSize()`, and that
       answers for the old box until the line above tells Leaflet about the new one. */
    setLimits();
  });
}).observe(el('map'));

map.on('moveend zoomend', () => {
  const c = map.getCenter();
  Object.assign(PREFS, { center: [+c.lat.toFixed(5), +c.lng.toFixed(5)], zoom: map.getZoom() });
  save();
});

// --- basemap & theme ---------------------------------------------------------------------------

/* Esri's Canvas basemaps. CARTO served this map until 2026-08-27, and its keyless tiles now arrive
   with `API KEY REQUIRED` burned into the picture. See TILES in js/config.js.
   **An ArcGIS tile path is `{z}/{y}/{x}` — the row comes before the column.** That is the reverse
   of the XYZ order every other provider uses, and it fails silently: the tiles still load, they are
   simply the wrong part of the world. There is no `{s}`, because the host has no subdomains, and no
   `{r}`, because Esri caches no retina tile to ask for.
   Two layers per theme, because Esri publishes the ground and the place names as separate services.
   `_Base` is the ground and `_Reference` is the labels. */
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
const tileURL = (k, part) => `${ESRI}/${TILES[k]}_${part}/MapServer/tile/{z}/{y}/{x}`;
let tiles, labels;

const isDark = () => document.documentElement.dataset.theme === 'dark';

// The water the basemap does not draw, in two parts, for two different reasons.
//
// A river is a one-pixel antialiased line, so from zoom 12 its pixels land in the same tones as
// roads and buildings — measured, the tone a river peaks at is only 20-27% river, so the tint in
// index.html cannot key on it. And CARTO drops small water from its style outright: a 0.0017 km²
// retention pond has zero water pixels at zoom 13, 14 and 15 alike, so there is nothing on the
// tile to recolour at all. The tint still owns the sea and the large lakes, which are neither.
// `water.json` is baked by water-build.php from OpenStreetMap. See docs/FEATURES.md.
//
// Its own pane, between the tiles (200) and the overlays (400), so heat blobs, pins and the "you
// are here" circle all still draw over the water rather than under it.
map.createPane('water');
map.getPane('water').style.zIndex = 250;

/* The place names, above the water this app draws and under everything it reports. Esri publishes
   them as a service of their own, so they are a second tile layer rather than part of the ground.
   The pane exists to put them over the water: at the tile pane's own 200 a drawn river would cover
   the name of the town it runs through. It takes no pointer events, because a tile pane that
   answers a click sits between the reader and every pin under it. */
map.createPane('labels');
map.getPane('labels').style.zIndex = 260;
map.getPane('labels').style.pointerEvents = 'none';

/* **Everything outside the coverage area is shaded, and the same file sets the zoom floor and the
   pan limit.** The map used to run on forever. A reader could zoom out to the whole world, and the
   pins then sat on a continent with no line to say which part of it this app answers for. The
   repository owner asked for all three on 2026-09-02.
   `border.json` is Selangor's own outline, baked by border-build.php. Kuala Lumpur and Putrajaya are
   enclaves inside it, and that script fills them in by dropping the relation's inner rings. So one
   shape covers all three of this app's states and nothing here has to union anything.
   Its own pane above the place names, so a town outside the area is shaded with the ground it sits
   on. Under the overlay pane at 400, so the heat wash, the pins and the "you are here" circle all
   still draw over it. It takes no pointer events, for the reason the labels pane states. */
map.createPane('mask');
map.getPane('mask').style.zIndex = 270;
map.getPane('mask').style.pointerEvents = 'none';

/* The diagonal stripes, as an SVG pattern in a hidden sprite. `css/map.css` paints the two shapes
   inside it, so the theme swap costs no JavaScript and no re-read of a token. The pattern measures
   in `userSpaceOnUse`, which is screen pixels at rest, so a stripe is the same width at every zoom.
   A hidden `<svg>` in the document is enough: `fill: url(#hatch)` resolves against the whole
   document rather than against the SVG the path lives in. `js/map.js` already appends one sprite
   this way for the pin glyphs, further down. */
const hatch = document.body.appendChild(
  Object.assign(document.createElementNS('http://www.w3.org/2000/svg', 'svg'), { id: 'hatchdef' }));
hatch.setAttribute('aria-hidden', 'true');
hatch.innerHTML =
  '<defs><pattern id="hatch" width="9" height="9" patternUnits="userSpaceOnUse"'
  + ' patternTransform="rotate(45)">'
  + '<rect width="9" height="9" class="hatchbg"/>'
  + '<rect width="3" height="9" class="hatchline"/>'
  + '</pattern></defs>';

/* How far past the coverage the shaded ring reaches, in multiples of the coverage's own span. The
   pan limit below is 0.25 of that span, so three spans is about eleven times as far as a reader can
   ever travel. Nothing can reach the edge of it.
   **It is NOT a ring around the whole world, and one was tried first.** A world ring projects to
   coordinates in the tens of millions at zoom 9. Blink rasterizes a pattern fill over the path's own
   bounding box, gives up somewhere inside a box that size, and paints the rest flat. The symptom is
   a wide unstriped diagonal band lying across the map, which reads as a bug in the stripes rather
   than as a size limit. A finite ring near the shape cannot reach that state.
   **The fill rule punches the holes, and Leaflet's own default is the one that works.** `evenodd`
   asks how many rings a point sits inside and fills the odd answers, so a hole punches whichever way
   its points happen to wind. `nonzero` asks for the signed sum instead, so a hole wound the same way
   as the outer ring fills solid rather than clearing. OpenStreetMap states no winding, and this app
   cannot fix one it did not author. Do not set `fillRule` here. */
const MASK_SPANS = 3;

let cover;                       // the coverage bounds, once border.json has answered

/* The zoom floor and the pan limit, both off the coverage extent. Re-run on every resize, because
   `getBoundsZoom()` answers for the window this map has right now: the level that fits Selangor on
   a desktop leaves half of it off a phone.
   **One level looser than the fit.** The exact fit puts the state's edges hard against the window,
   with no ground around it, and a coastline with nothing on the seaward side reads as a crop.
   **ONE box answers both, and that is what keeps the floor honest.** `pad(0.5)` grows a box by half
   its size on each side, so `ROAM` is twice the coverage on both axes. The floor is the zoom that
   fits that box, and the box is what a drag may not leave. So the two cannot disagree.
   Two numbers can, and the first version had them. A floor of `getBoundsZoom(cover) - 1` beside a
   pan box of `cover.pad(0.25)` reports a floor the box then refuses, because a level out doubles
   the ground on screen while a quarter pad adds half of it. `getMinZoom()` still answers the number
   it was given, and nothing errors. Measured at six widths from 320 to 1920, this shape reaches its
   own floor at every one of them. */
const ROAM = 0.5;    // half the coverage span of margin on each side, so twice the span in all

function setLimits() {
  if (!cover) return;
  const box = cover.pad(ROAM);
  map.setMaxBounds(box);
  map.setMinZoom(map.getBoundsZoom(box));
}

/* Fetched inline rather than deferred to an idle callback, which is what the water below does.
   Two reasons. It is 4 KB gzipped against water.json's 165 KB. And it carries the zoom floor, so a
   reader who lands zoomed out would otherwise see the world for as long as the browser felt like
   waiting. A failure is silent and leaves an unlimited map, which is the state this replaces. */
fetch('border.json')
  .then(r => r.ok ? r.json() : Promise.reject(r.status))
  .then(geo => {
    const [w, s, e, n] = geo.bounds;
    cover = L.latLngBounds([[s, w], [n, e]]);
    const dx = (e - w) * MASK_SPANS, dy = (n - s) * MASK_SPANS;
    const outer = [[w - dx, s - dy], [e + dx, s - dy], [e + dx, n + dy], [w - dx, n + dy],
                   [w - dx, s - dy]];
    // One Polygon: that ring, then every coverage ring as a hole. `border-build.php` writes a
    // MultiPolygon of single-ring polygons, so the first ring of each is the whole of it.
    L.geoJSON({
      type: 'Feature', properties: {}, geometry: {
        type: 'Polygon',
        coordinates: [outer, ...geo.features[0].geometry.coordinates.map(p => p[0])],
      },
    }, {
      renderer: L.svg({ pane: 'mask' }),
      interactive: false,
      style: { className: 'covermask', stroke: false, fillOpacity: 1 },
    }).addTo(map);
    setLimits();
  })
  .catch(() => {});

let waterGeo, water, asking;

function setWater(on) {
  if (!on) { if (water) map.removeLayer(water); return; }
  if (water) { water.addTo(map); return; }

  // Fetched once, on the first dark theme of the session, and never at all on a light one.
  if (!waterGeo) {
    if (asking) return;
    asking = true;
    /* Past the first paint. This file is 242 KB gzipped, against 271 KB for the whole of the rest
       of the landing, so fetching it inline nearly doubles what a dark theme reader waits for. It
       draws rivers and ponds the basemap omits, which is decoration over a map that already works,
       so it can arrive late. requestIdleCallback yields to anything the browser would rather do
       first, and the setTimeout is the fallback for Safari, which does not implement it. */
    /* Called as a method on `window`, never lifted off it. `requestIdleCallback` is a `Window`
       operation, so invoking a detached reference gives it the wrong receiver and it throws. That
       throw would land during module evaluation, because applyTheme() runs at the top level of
       js/ui.js, which js/app.js imports statically. So a dark theme reader would lose the whole
       app, not just the water. Safari has no requestIdleCallback, hence the timer. */
    const later = fn => window.requestIdleCallback
      ? window.requestIdleCallback(fn)
      : setTimeout(fn, 1200);
    try {
      later(() => fetch('water.json')
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then(g => { waterGeo = g; if (isDark()) setWater(true); })
        .catch(() => {}));
    } catch {
      /* Nothing about the water may take the app down. This runs inside module evaluation, so an
         exception here stops js/ui.js and with it everything js/app.js does. A plainer map is the
         documented outcome of a water failure, and that has to hold for a synchronous throw too,
         not only for a rejected fetch. */
    }
    return;
  }

  // Built here rather than in the fetch, so `--water` is read at the moment the layer is drawn.
  // The token exists on the dark theme only, and this line is only ever reached on it.
  const c = getComputedStyle(document.documentElement).getPropertyValue('--water').trim();

  // Canvas rather than SVG: 6,635 shapes is 6,635 DOM nodes to carry through every pan and zoom.
  // One colour for both parts, and it is the colour the tint paints — a drawn pond beside a tinted
  // lake has to be the same water. A pond is a fill with no stroke, because an outline on a shape
  // this small is most of the shape. Opaque for the same reason the two must match exactly.
  water = L.geoJSON(waterGeo, {
    renderer: L.canvas({ pane: 'water' }),
    interactive: false,
    style: f => f.properties.t === 'area'
      ? { stroke: false, fillColor: c, fillOpacity: 1 }
      : { color: c, weight: 1.4, opacity: 1 },
  }).addTo(map);
}

function setBasemap() {
  const key = isDark() ? 'dark' : 'light';
  if (tiles) map.removeLayer(tiles);
  if (labels) map.removeLayer(labels);
  /* **`maxNativeZoom`, never `maxZoom` alone.** Esri's canvas cache stops at zoom 16 over this
     area. Zoom 17 and 18 both answer with one shared `Map data not yet available` plate — measured,
     the light and the dark service return the identical file — and that is a second watermark, of
     the kind this whole change exists to remove. `maxNativeZoom` stretches the zoom-16 tile across
     the two zooms above it instead. So the app keeps its own zoom range and only the ground goes
     soft. Every pin, label and heat blob is drawn by this app and stays sharp. */
  const opt = { maxZoom: 18, maxNativeZoom: 16 };
  tiles  = L.tileLayer(tileURL(key, 'Base'), opt).addTo(map);
  labels = L.tileLayer(tileURL(key, 'Reference'), { ...opt, pane: 'labels' }).addTo(map);
  setWater(key === 'dark');
}

// `PREFS.theme` is the one place this app keeps the reader's pick. The picker is three rows in
// Settings and the rail's button reports what is on screen. See the block under this line.
const sysDark = matchMedia('(prefers-color-scheme: dark)');
/* **Three choices, and the third one is Auto.** The repository owner cut Auto on 2026-08-24 and
   asked for it back on 2026-08-25, with the picker in Settings and the rail's button reporting the
   shade on screen.
   **Auto keeps following the device, and that is the whole of what it buys.** The listener below is
   live, so a phone that crosses into its own dark hours restyles this app while `auto` is the pick.
   What this reverses seeded the preference once from the same query and then stored the answer,
   which is a stored pick that merely started in the right place.
   **`auto` is the default and nothing is seeded any more.** That seed existed because no value meant
   "ask the device". One does now.
   **A stored `light` or `dark` is a theme the reader owns**, and the device never moves it. */
export const THEMES = ['auto', 'light', 'dark'];
if (!THEMES.includes(PREFS.theme)) { PREFS.theme = 'auto'; save(); }
/* **The listener lives here rather than in js/ui.js, because this module owns the theme.** A page
   that draws a map without the chrome still follows the device. `js/ui.js` adds a second listener of
   its own, for the rail button's glyph alone. Registration order runs this one first, because that
   module imports this one. */
sysDark.addEventListener('change', () => { if (PREFS.theme === 'auto') applyTheme(); });

export function setTheme(t) {
  PREFS.theme = t;
  save();
  applyTheme();
}

// Kept apart from `setTheme()`, because `js/ui.js` calls it once at module evaluation to paint the
// stored theme before anything draws. It returns the theme on screen, which is what the button reads
// to name its own next press.
export function applyTheme() {
  const t = PREFS.theme === 'auto' ? (sysDark.matches ? 'dark' : 'light')
          : PREFS.theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  // The standalone window's title bar. Same value the header paints itself, so an installed app
  // has no seam above its own header — see the --surface tokens in css/base.css.
  document.querySelector('meta[name=theme-color]').content = t === 'dark' ? '#202124' : '#ffffff';
  setBasemap();
  return t;
}

// --- clustering --------------------------------------------------------------------------------

// One cluster for everything, regardless of category. A badge shows just the total in a neutral
// chip — no kind icon or hue, because a cluster is usually mixed and a type colour would lie about
// it — turning red if any child is at danger / sounding, dashed if it holds more than one kind.
export const cluster = L.markerClusterGroup({
  // Tighten as you zoom rather than switching clustering off — several stations share exact
  // coordinates (a rainfall and a river gauge on the same mast), so they overlap at any zoom.
  // Those stay clustered to the end and fan out on click instead of hiding each other.
  // Screen pixels, three bands: street, city, state. The far band was 48 and is 34, measured
  // against the 459 sites in the payload. It covers zoom 0 to 12, across which the spacing
  // between two sites changes fourfold, so one number cannot suit both ends. 34 is picked for
  // the city end: it leaves 280 sites inside a neighbour's radius at zoom 12 against 335 at 48.
  // At zoom 10 it buys almost nothing — 434 against 452 — and no radius does.
  maxClusterRadius: z => z >= 15 ? 14 : z >= 13 ? 26 : 34,
  showCoverageOnHover: false,
  spiderfyOnMaxZoom: true,
  spiderfyDistanceMultiplier: 1.6,
  iconCreateFunction(c) {
    const kids = c.getAllChildMarkers();
    const kinds = new Set();
    let critical = false;
    for (const m of kids) { kinds.add(m.options.kind); critical ||= m.options.critical; }
    const mixed = kinds.size > 1;
    return L.divIcon({
      /* One pixel of air around `.cluster`'s 21px chip. Down 30% from 36/34, then a further 12.5%
         on 2026-08-26 when every mark on the map came down — the chip is a count, not a station,
         and at the old size it read as the largest mark on the map. Both numbers move together or
         the badge stops sitting over the pins it is hiding.
         **A cluster is the one mark the `scale(.7)` rule in css/map.css cannot reach**, because
         that rule names `.pin`. So this pair is edited by hand whenever the set moves. */
      className: '', iconSize: [22, 22],
      html: `<span class="cluster${critical ? ' danger' : ''}${mixed ? ' mixed' : ''}">${kids.length}</span>`,
    });
  },
}).addTo(map);

export const marks = {};                 // lead kind -> site markers, whether currently shown or not
for (const k of Object.keys(KINDS)) marks[k] = [];

// site key -> its marker. One pin can now stand for several stations, so a marker can no longer be
// found by looking in its own kind's bucket — a river gauge's pin may be filed under `siren` if a
// sounding siren shares the mast and leads it.
export const siteMark = new Map();

export const shown = k => document.querySelector(`#layers input[data-kind="${k}"]`)?.checked;

/* Favorites never cluster. A star swallowed by a chip is a star that did not work, and finding your
   own stations at a glance is the whole point of setting one. markercluster has no per-marker opt
   out, so they go on a plain layer group beside it. The split lives here because this function
   already walks `marks` and already gates on `shown(k)`, and layer visibility must stay in one
   place.
   **The open card's pin is the second tenant, and it arrived on 2026-08-26.** `markSel()` turns
   that pin into a teardrop, and a teardrop a cluster chip swallows says nothing at all. The reader
   is looking at the map to find the place the pane is describing, and a zoom out is how they look
   for it. It keeps the name `favLayer`, because what the two tenants share is that they stand
   outside the cluster. */
export const favLayer = L.layerGroup().addTo(map);

const loose = m => m.options.fav || m === selPin;

export function syncCluster(alsoShow) {
  cluster.clearLayers();
  favLayer.clearLayers();
  for (const [k, list] of Object.entries(marks)) {
    if (!(shown(k) || k === alsoShow)) continue;
    cluster.addLayers(list.filter(m => !loose(m)));
    for (const m of list) if (loose(m)) favLayer.addLayer(m);
  }
}

// --- mast area ---------------------------------------------------------------------------------

/* The radius api.php folded these sensors together with, drawn under the pin while you point at it:
   it answers "why is this one pin, and would that neighbour have joined it" without opening
   anything. Only for masts that actually hold several sensors — a ring round a lone station draws a
   boundary that grouped nothing.
   One ring, reused: hovering across a row of pins would otherwise leave a trail of them, since a
   marker torn down mid-hover never fires its mouseout. `interactive: false` so it can never swallow
   the click meant for the pin underneath, and a circle (metres) rather than a circleMarker (pixels),
   because the whole point is a fixed distance on the ground. */
let mastRing = null;

export function showMast(latlng) {
  hideMast();
  /* Colour comes from `.mastring` in map.css, not from the usual `color`/`fillColor` options: those
     become SVG *presentation attributes*, where `var(--k-mast)` means nothing — and the mast colour
     is a token now, with a value per theme. Any CSS rule outranks a presentation attribute, so a
     class is both the way to reach it and the way to keep it in step with the pins. */
  mastRing = L.circle(latlng, {
    radius: state.siteM, interactive: false, className: 'mastring',
    weight: 1, dashArray: '4 3', fillOpacity: .08,
  }).addTo(map);
}

export function hideMast() { mastRing?.remove(); mastRing = null; }

// --- selection mark ------------------------------------------------------------------------------

/* The pin whose card the supporting pane is showing turns into a teardrop. The pane names the place
   in words. The map draws four hundred pins and says nothing about which of them the words are
   about, and on a wide window the two sit side by side.
   **It REPLACES the pin rather than standing over it.** A second marker over the first was the
   first answer, and two marks on one point overlap however they are stacked. So there is one
   marker, and only its icon changes.
   **The tip is the anchor, and that is the whole geometry.** `place` is Material's `location_on`,
   the same drawing, so this needs no new icon. Its point sits 8% of the box above the bottom edge,
   which is 4px in a 48px box, so the anchor is [24, 44]. That is the number `showPlace()` below
   already states for the same glyph. A station pin is anchored at its MIDDLE instead, and
   `setIcon()` moves the anchor with the drawing, so the teardrop's tip lands where the pin's centre
   stood.
   **Only the DRAWING is swapped, and the pin's own markup carries everything else.** This re-points
   the first `<use>` at the teardrop and adds one class. So the colour, the offline fade, the rise
   ring, the danger halo and the favorite heart all survive. A rebuilt string carries the glyph and
   loses the rest, and losing the halo takes an alarm off the one pin a reader is looking at.
   The station glyph is the FIRST `<use>` in that markup, and the heart is the second. So a
   `String.replace()` on the first match is what names it.
   **A rebuild has to re-apply it.** `render()` throws every marker away on every poll, so the fresh
   marker for the open card draws its ordinary glyph. Both painters call this at the end, after
   `siteMark` is filled. It answers to a key rather than to a marker for the same reason.
   The restore reads the marker this app last marked, so a marker already thrown away takes a
   `setIcon()` that reaches nothing. That is safe: Leaflet redraws on `setIcon` only while the
   marker is on a map. */
let selPin = null, selWas = null;

export function markSel(key) {
  const pin = key ? siteMark.get(key) : null;
  if (pin === selPin) return;
  if (selPin) selPin.setIcon(selWas);
  selPin = pin;
  if (pin) {
    selWas = pin.options.icon;
    /* **BUILT FRESH, and it used to be the station's own html patched twice.** That worked while a
       station pin was a bare glyph: swap the class, re-point the `<use>` at the teardrop, done.
       A station pin is a DISC now — a `<circle>` with the glyph knocked out of it — so re-pointing
       the `<use>` left a teardrop cut out of a coloured disc, which is not what a selected pin is.
       Only the colour is carried over. `--c` is the one thing the old markup holds that this needs,
       and lifting it keeps the rule that a station at danger stays red while its card is open.
       **THE TIP IS AT 11/12 OF THE BOX, NOT AT THE FOOT OF IT, and that is the number to get right.**
       A teardrop is anchored at its tip, and `--i-place` does not paint to the bottom of its own
       viewBox: measured with `getBBox()`, the path ends at 33 of a 36px box, which is 0.9167. The
       old [24, 44] on a 48px box encoded exactly that ratio — 0.9167 × 48 is 44 — and a rewrite to
       25px used [12.5, 25], which put every selected mark 2px above its station.
       **So the anchor is `box × 0.9167`, and it moves whenever `.pin.sel`'s size does.** Both live
       in `css/map.css`, which states where 32 comes from. A wrong anchor here is silent: the mark
       still draws, it just stops pointing at the station it names.
       **29.3 is fractional on purpose.** Leaflet takes a fractional pixel, and rounding this to 29
       to keep it tidy is the same error the 25px rewrite made, in a smaller size. */
    const c = selWas.options.html.match(/--c:([^"]*)/)?.[1] || 'var(--accent)';
    pin.setIcon(L.divIcon({ className: '', iconSize: [32, 32], iconAnchor: [16, 29.3],
      html: `<span class="pin sel" style="--c:${c}">${pinGlyph('place')}</span>` }));
  }
  /* **Move it out of the cluster, and move the last one back in.** `loose()` above reads `selPin`,
     so one re-sort answers both halves and neither is written twice.
     It runs on a real change of selection alone, which the early return above is what guarantees.
     A poll re-opens the card on screen and reaches this function every time, and a re-sort of four
     hundred markers on the poll loop is a cost with nothing to buy.
     `render()` calls `syncCluster()` itself a few lines after this, so the poll that DOES change
     the selection pays for the sort twice. That is one extra call against a branch in the caller,
     and the branch is the thing that goes stale. */
  syncCluster();
}

// --- station panel ------------------------------------------------------------------------------

/* What used to be the map popup, moved out of the map.
   A Leaflet popup is positioned by the thing it points at, so where it landed depended on the pin,
   the zoom, the drawer, autoPan's nudge and whether the target was already on screen — the same
   click put it somewhere different each time. Worse, markercluster rebuilds marker DOM on every
   zoom and render() rebuilds every marker on every poll, so the popup was torn down under the
   reader twice over.
   This is a panel in the page: fixed to the right edge, opened in the same place every time, and
   nothing the map does can move or destroy it. `side.key` is the site it is showing, so a poll
   refreshes it in place instead of closing it — see the tail of render(). */
export const side = { key: null };

export function openSide(key, html, mastAt) {
  const body = el('sideBody');
  const moved = side.key !== key;
  side.key = key;
  body.innerHTML = html;
  /* Lift the place out of the scrolling box. The card is one string — the template has no idea it
     is being split — so the split happens here, on the one element that is always its first child.
     A column of readings whose station name has scrolled off is unreadable, and a five-sensor mast
     runs several screens. */
  /* **The card arrives as one string and FIVE pieces of it move.** M3's side sheet header is a
     title and its trailing actions, so that is what goes up: the place name, and the ⋮ with the
     popover it targets. The app bar's label block then takes the two supporting lines under it —
     the region, and one chip per sensor kind.
     `.pophead` is still the seam and still the card's first element. Only the slice taken from it
     changed. A card with no `.pophead` (or no name inside one) empties every slot rather than
     leaving the last station's name over the next one's readings. */
  const head = body.querySelector('.pophead');
  el('sideTitle').replaceChildren(...[head?.querySelector('.popname')].filter(Boolean));
  /* The row reads offer, favorite, ⋮. `querySelectorAll` answers in DOCUMENT order and never in
     selector order, so the order comes from `dots()` emitting the three in that sequence. The
     popover takes no room in the row. */
  el('sideActions').replaceChildren(
    ...(head ? head.querySelectorAll(':scope > .near, :scope > .fav, :scope > .dots, :scope > .menu') : []));
  /* **The region line is the app bar's supporting text.** `#sideHead` is M3's medium flexible top
     app bar now, and that component states a headline over an optional line under it. The card's
     own muted line is what that has always been: `Shah Alam, Selangor` under a station name, the
     accuracy radius under "Your Location", the point and its distance under a weather place.
     `:scope > .muted` and not `.muted`, because the alert list writes `· nearest first` INSIDE its
     `.popname`. A descendant search lifts that fragment out of the title it belongs to. */
  el('sideSub').replaceChildren(...[head?.querySelector(':scope > .muted')].filter(Boolean));
  /* **The kind chips are the app bar's second supporting line.** They stayed in the body on the
     argument that M3 puts supporting content there — which is the side SHEET's rule, and this
     header stopped being one. What they answer is `what is this place`, the same question the
     headline and the region line answer, so the three read as one block. On a five-sensor mast they
     used to sit under a region line the reader scrolled away from.
     A single-sensor card emits one bare `.badge` and a mast emits a `.badges` box, so both are
     named. */
  el('sideKinds').replaceChildren(
    ...(head ? head.querySelectorAll(':scope > .badge, :scope > .badges') : []));
  /* Every card now puts nothing else in `.pophead`, so the split empties it. An empty seam
     still draws its own bottom margin, which is 16px of nothing over the first reading. `:empty`
     cannot see this: the template leaves whitespace text nodes behind. */
  if (head && !head.firstElementChild) head.remove();
  if (moved) body.scrollTop = 0;   // a refresh of the same station keeps your place in it
  /* Clicking a second pin swaps text inside a panel that does not move, and one card of readings
     looks much like the next — so the swap is announced with a short wipe. Only on a real change of
     station (a poll's in-place refresh must not flash), and only when the panel is already up: on
     the way in it plays its own slide, which is announcement enough. Remove/reflow/add is how you
     restart a CSS animation; the offsetWidth read is the flush that makes the removal count. */
  if (moved && document.body.classList.contains('side')) {
    const box = el('side');
    box.classList.remove('swap'); box.offsetWidth; box.classList.add('swap');
  }
  // Only on a real open: render() calls openSide() on every poll to refresh the card in place.
  document.body.classList.add('side');
  mastAt ? showMast(mastAt) : hideMast();
  /* `siteMark` is the map from the key this function takes to the marker that opens it, so one
     lookup answers for a station pin and for a weather pin alike. A key with no pin marks nothing,
     and that covers `@here` and `@alerts`. The location card draws a crosshair of its own. */
  markSel(key);
  syncAlertBtn();
  /* The rail's own MutationObserver misses a same-occupant swap.
     Swapping from the alert list to a station card keeps the side class on.
     No mutation then fires. syncPane() never runs.
     Without it, the alert item stays lit through the swap.
     A direct call here catches it, both into and out of the alert list.
     It calls railSync(), so this reads side.key through the one derivation every writer shares. */
  railSync();

  /* The card holds at most one camera, and `data-clip` carries its proxy id. `start()` is
     idempotent by that id, which is what makes this safe to call again on every poll — render()
     re-runs openSide() for whatever is on screen, and a clip that restarted there would jump back
     to frame 0 while somebody was watching it. */
  const n = body.querySelector('[data-clip]')?.dataset.clip;
  const cam = n ? byId(`camera-${n}`) : null;
  cam ? withClip(m => m.start(body, cam)) : withClip(m => m.stop());
}

export function closeSide() {
  withClip(m => m.stop());
  side.key = null;
  /* Guarded the same way `openSide()` already guards its own write, above.
     A no-op `classList.remove()` still queues a mutation record and still wakes the observer for
     nothing. It is not load-bearing once `railSync()` re-derives from the live DOM. It is the
     honest repair of the thing that raced. */
  if (document.body.classList.contains('side')) document.body.classList.remove('side');
  hideMast();
  markSel(null);
  syncAlertBtn();
}

/* The app bar's warning glyph is a disclosure for one particular occupant of this panel, and the
   panel has half a dozen other ways to change what is in it — a pin, the table, "you are here", the
   × — so the button's state is synced from here rather than from the click that opened it. */
const syncAlertBtn = () => {
  for (const b of navPair('Alerts')) b.setAttribute('aria-expanded', side.key === '@alerts');
};

el('sideClose').onclick = closeSide;
/* Deliberately **no** `map.on('click', closeSide)`. A popup had to close that way because it was
   attached to a pin; a panel is not, and dismissing it on any stray click on the map made it
   disappear while being read — the "you are here" card worst of all, because locate.js draws an
   accuracy circle around you, and a circle is an L.Path, which unlike a Marker *does* bubble its
   clicks to the map. At a wide fix that circle is most of the viewport, so "click the map" and
   "click near where I am" were the same gesture.
   The card closes when the reader says so: this button, or a dialog taking over the screen (ui.js).
   Clicking another pin does not close it either — it replaces what is in it. */

// --- view helpers ------------------------------------------------------------------------------

// Centre on the strip of map you can actually see: the drawer covers the left, the station panel
// the right. Not on a phone, where the panel covers the map outright and there is no strip to aim at.
/* **Centre it. Nothing else.** This carried an offset for as long as the panels overlapped the map:
   the drawer covered a strip on the leading edge and the station panel one on the trailing edge, so
   a station centred in the container drew underneath one of them. The map is a pane now and its
   container ends where the supporting pane begins. The container IS the visible strip, so there is
   nothing left to compensate for and both terms are gone. */
export function focusOn(latlng, minZoom = 0) {
  map.setView(latlng, Math.max(map.getZoom(), minZoom));
}

// Fly to a station and ripple over it. If its layer is switched off, show it for the flash only —
// unless the user turns that layer on in the meantime.
export function flashTo(t) {
  // A target can be missing for any of three reasons — its layer is off, a district filter dropped
  // it, or rising-only did. All three are answered the same way now that render() groups by site:
  // pin it, rebuild, and drop the pin once the user navigates off. Pinning outranks every filter,
  // so the marker is guaranteed to exist afterwards.
  /* A jump to a station is a request for the station map, so weather mode ends here.
     One place, because every jump in this app reaches this function. The jumps are from
     the go-to box, table, alert rows, ticker and menu rows. PREFS.heatLayer was never
     written while the mode was on. So syncHeat() inside the rerender below brings back
     whatever heatmap the reader had. Nothing here has to remember it. */
  /* Leaving weather mode always needs a rebuild, whatever `state.pinned` holds. The mode
     emptied `siteMark`. A second jump to the station already pinned would find no marker
     and open no card. Nothing clears `state.pinned` when the mode turns on. */
  const wasWx = PREFS.mapLayer === 'weather';
  if (wasWx) { PREFS.mapLayer = 'stations'; save(); }
  if (wasWx || state.pinned !== t.id) { state.pinned = t.id; state.rerender(); }

  /* One way in: the marker's own click handler centres the map and fills the panel, so a jump from
     a list and a click on the pin cannot drift apart. Nothing has to wait for the map to settle or
     for a cluster to expand any more — the panel is a page element, not a thing anchored to a
     marker's DOM node, which is what the old moveend / zoomToShowLayer dance existed to work around. */
  const marker = siteMark.get(t.site || t.id);
  marker ? marker.fire('click') : focusOn([t.lat, t.lng], 13);

  ping([t.lat, t.lng], '', t.name);
  // Only arm this after the flash: the flight and zoomToShowLayer above move the map themselves.
  setTimeout(() => map.once('dragstart zoomstart', unpin), FLASH_MS);
}

/* An expanding ring over a point, then gone. Two callers with the same problem: the map has just
   moved you somewhere and nothing on screen says which of the pins now in front of you is the one
   you asked for. Non-interactive and behind the pins, so it can never eat the click on the thing it
   is pointing at. `tone` picks the colour — see .ping in map.css.
   `label` names the place over the ripple and fades with it. The panel already carries the name, but
   the panel is on the other edge of the screen: after a jump the reader is looking at the map, and
   the ring alone says "here" without saying what "here" is. It is not a popup — nothing is anchored
   to a marker, nothing survives the flash and nothing takes a click (see the panel note above). */
export function ping(latlng, tone = '', label = '') {
  /* Two markers, not one, because the ring and the name want opposite ends of the stack. The ring
     belongs *under* the pins, or it draws a circle over the thing it is pointing at. The name
     belongs over them, or the pin it is naming hides it — a station marker is 39px anchored at its
     middle, so anything within 20px of the point is behind the glyph. Both are `interactive: false`,
     which is what actually keeps the click on the pin; the z order is only about paint. */
  const mark = (html, z) => {
    const p = L.marker(latlng, { icon: L.divIcon({ className: '', iconSize: [0, 0], html }),
      interactive: false, zIndexOffset: z }).addTo(map);
    setTimeout(() => p.remove(), FLASH_MS);
  };
  mark(`<i class="ping ${tone}"></i>`, -1);
  if (label) mark(`<b class="pinglabel">${label}</b>`, 1000);
}

// "Navigated away" = a pan or zoom the user asked for, not the panel closing: you can close the
// card and still be looking at the pin it described.
function unpin() {
  if (!state.pinned) return;
  state.pinned = null;
  state.rerender();
}

/* **A pin's glyph is an inline `<svg><use>`, not a masked `<i>`.** A CSS mask keeps only the alpha
   of the picture and paints the box in `currentColor`, so there is no fill and no stroke to address
   — an outline had to be faked from a second copy of the shape, which is what the two reverted
   attempts in `css/map.css` were. A real `stroke` on a real path is one shape, even at every angle.
   ponytail: the symbols are lifted out of `css/icons.css` at first use, so the path data still lives
   in exactly one place and adding an icon is still one line there. Only the map pins take this path.
   Every other icon in the app is still a mask, because nothing else needs a second colour. */
const sprite = document.body.appendChild(
  Object.assign(document.createElementNS('http://www.w3.org/2000/svg', 'svg'), { id: 'glyphs' }));
sprite.setAttribute('aria-hidden', 'true');
const built = new Set();
export function pinGlyph(name, disc = false) {
  if (!built.has(name)) {
    built.add(name);
    const url = getComputedStyle(document.documentElement).getPropertyValue('--i-' + name);
    const body = url.match(/<svg[^>]*>(.*)<\/svg>/s);
    if (!body) return '';                    // an icon name with no rule in icons.css
    /* `vector-effect` is stamped on the path here rather than declared in the stylesheet, and that is
       not a style choice. It is one of the few SVG presentation properties that does **not**
       inherit, so a rule on `.pinglyph` lands on the outer `<svg>` — which paints nothing — and
       never reaches the path inside the `<use>` shadow tree. `fill`, `stroke`, `stroke-width` and
       `paint-order` all inherit and do cross that boundary, so they stay in map.css where they can
       be read and tuned. Without this the width is measured in the 960-unit viewBox instead of in
       screen pixels: about 33 units to the pixel at a station pin's size, so a stroke of 2 is
       invisible and only something past 100 shows up. */
    sprite.insertAdjacentHTML('beforeend', `<symbol id="g-${name}" viewBox="0 -960 960 960">${
      body[1].replaceAll('<path ', "<path vector-effect='non-scaling-stroke' ")}</symbol>`);
  }
  /* **A STATION PIN IS A DISC WITH THE GLYPH KNOCKED OUT OF IT, and `disc` is what asks for one.**
     The repository owner picked that shape on 2026-08-26. A filled circle carries far more of the
     kind's colour than a bare glyph does, which is what a muted palette needs to read at 29px.
     `<use>` honours `width`/`height` on a `<symbol>`, so the symbol's own 960 unit viewBox maps into
     this 40 unit one with no transform to keep in step. 24 of 40 is the glyph at 60% of the disc.
     **`stroke="none"` on the use is not decoration.** `.pinglyph` strokes every path in `--surface`
     for the bare form, and that rule inherits through the `<use>` shadow tree. Left on, a white
     glyph inside a disc wears a white outline and thickens into a blob.
     **Three callers do NOT pass `disc` and must not.** The favorite heart is a badge on the pin's
     corner rather than the mark itself. `.pin.me` and `.pin.place` are not stations: they are 48px,
     they wear `--me` and `--accent` from a different part of the palette, and white on either fails.
     So the map draws discs for stations and bare glyphs for the two marks that are not one. */
  return disc
    ? `<svg class="pinglyph disc" viewBox="0 0 40 40"><circle cx="20" cy="20" r="17.5"/>` +
      `<use href="#g-${name}" x="8" y="8" width="24" height="24" stroke="none"/></svg>`
    : `<svg class="pinglyph"><use href="#g-${name}"/></svg>`;
}

/* A place the reader searched for. One marker at a time, kept until another place replaces it — the
   same life the "you are here" pin has, and closing the search box does not clear it.
   A plain L.Marker, not an L.Path: paths bubble their clicks to the map and markers do not, and
   nothing about this pin may close the card someone is reading.
   The mark and the view are all this does. The answer to a place search is the list of stations near
   it, and that is drawn in the search box itself — see `nearPlace` in ui.js. This opened a card of
   its own at first, under the key `@place`, and there is deliberately no card here any more. */
let placeMark = null;
export function showPlace(latlng) {
  if (placeMark) placeMark.remove();
  placeMark = L.marker(latlng, { icon: L.divIcon({
    /* A pin points at its TIP, not its middle, and Material draws the glyph with a little air below
       it inside the viewBox. **The anchor is `box × 0.9167`**, the ratio `markSel()` above measures
       with `getBBox()` and states in full. 42 × 0.9167 is 38.5.
       **This box is NOT the "you are here" box any more**, and that comment stood here while both
       were 48. That mark keeps a 48px box anchored at its centre, because it is a dot rather than a
       teardrop. This one came down to 42 with the rest of the set on 2026-08-26. `.pin.place` in
       `css/map.css` states where 42 comes from, and both numbers move together. */
    className: '', iconSize: [42, 42], iconAnchor: [21, 38.5],
    html: `<span class="pin place">${pinGlyph('place')}</span>`,
  }) }).addTo(map);
  focusOn(latlng, 13);
  ping(latlng);   // the default accent ripple — `.ping.place` is gone, it painted the same colour
}
