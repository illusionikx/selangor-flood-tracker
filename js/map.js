// The Leaflet map itself: basemap/theme, the shared marker cluster, and the view helpers that
// every panel uses to jump to a station.

import { KINDS, TILES, CARTO_KEY, CARTO_STYLE, FLASH_MS } from './config.js';
import { state, PREFS, save } from './state.js';
import { el, distKm } from './util.js';
import { byId } from './stations.js';
import { PinLayer, resetSprites } from './pins.js';

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

/* maxZoom on the map, not just on the tile layer. The pin layer is added below at module load,
   before `setBasemap()` has run, and every zoom question it asks — the cluster radius, the
   unclustered floor — is answered against the map rather than against a layer that is not there yet.
   Leaflet.markercluster used to throw "Map has no maxZoom specified" on the same line for the same
   reason, and that plugin is gone. */
/* **15 IS THE CEILING, AND IT WAS 18 AND THEN 16.** The repository owner asked on 2026-09-03 for the
   map to stop where every mark stands on its own.
   **16 was the measured answer, and 15 is the instruction that followed it.** Left to
   `maxClusterRadius` alone, zoom 15 still merged 6 of the 460 sites and zoom 16 merged none. So the
   first pass set the ceiling to 16. The repository owner then asked for zoom 15 to cluster nothing,
   which is `disableClusteringAtZoom` on the cluster below. With that option set, 15 is the first
   zoom that merges nothing, so 15 is where the map stops.
   **Two sites OVERLAP at 15, and that is the price of the instruction.** The closest pair on the map
   stands 55 m apart. That is 23px at zoom 16 and 11.5px at zoom 15, against a 27px disc. So at 16
   their edges touched and at 15 one disc covers the middle of the other. Neither hides the other,
   and either can be clicked. No pair is closer, because `api.php` folds sensors within `SITE_M`
   (50 m) into one site before a marker is ever built.
   **The basemap reaches 16, so one level of it is now unused.** Esri caches its Canvas tiles to zoom
   16 over this area, and 17 and 18 both answered with one shared `Map data not yet available` plate.
   That plate is gone with the two levels above 16. The tile layers still declare `maxNativeZoom` —
   see setBasemap() — because it is the guard the day this ceiling goes up again.
   `maxBoundsViscosity: 1` is a hard wall rather than a rubber band. Leaflet's default of 0 lets a
   drag leave the bounds and then springs back when the finger lifts, which reads as the map fighting
   the reader. The bounds themselves arrive with border.json — see setLimits() below. */
export const map = L.map('map', {
  maxZoom: 15, attributionControl: false, zoomControl: false, maxBoundsViscosity: 1,
}).setView(PREFS.center || [3.2, 101.4], PREFS.zoom || 9);
L.control.zoom({ position: 'bottomright' }).addTo(map);
/* **The two zoom buttons were the last `title` on the page, and Leaflet writes them.** Every other
   one in this app went on 2026-08-26, because a `title` opens on no phone and a second tooltip
   shape beside the styled one reads as a fault. These share one control with `#locate`, which draws
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
  /* **The location card selects nothing since 2026-09-15.** `#navLocate` was the item it marked, and
     a reader deleted that item. A station card and a weather card select nothing either. */
  railActive(!cls.contains('side') ? null
           : side.key === '@alerts' ? 'railAlerts' : null);
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
  /* **A native close is a close, so it runs `closeSide()` and not a bare class removal.** The class
     alone left `side.key` set. Escape or the back gesture on the alert list kept `@alerts`, and the
     next `alerts()` call reopened that list by itself. A first fix makes that call, so on a phone
     the location button popped the list open. Measured at 360px on 2026-09-15.
     `closeSide()` also stops a clip and clears the selected pin, which the bare removal skipped. */
  if (!pane.open) closeSide();
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

/* Esri's basemaps: Topographic on the light theme, Dark Gray Canvas on the dark one. CARTO served
   this map until 2026-08-27, and its keyless tiles now arrive with `API KEY REQUIRED` burned into
   the picture. See TILES in js/config.js.
   **An ArcGIS tile path is `{z}/{y}/{x}` — the row comes before the column.** That is the reverse
   of the XYZ order every other provider uses, and it fails silently: the tiles still load, they are
   simply the wrong part of the world. There is no `{s}`, because the host has no subdomains, and no
   `{r}`, because Esri caches no retina tile to ask for.
   Canvas takes two layers, because Esri publishes its ground and its place names as separate
   services. Topographic bakes its names into the ground, so the light theme takes one layer. */
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const tileURL = svc => `${ESRI}/${svc}/MapServer/tile/{z}/{y}/{x}`;

/* CARTO, which draws the moment `CARTO_KEY` holds a key. See that constant in js/config.js.
   **The path order is `{z}/{x}/{y}` here and `{z}/{y}/{x}` above.** Esri is the odd one out, and
   the wrong order fails silently: the tiles still load and they are the wrong part of the world.
   **No `{s}`.** CARTO answers on `a` to `d` and on the bare host as well, measured 2026-09-08.
   Four subdomains split one HTTP/2 connection into four, and index.html warms one origin.
   **`{r}` is real here, and `detectRetina` must stay OFF.** CARTO caches a `@2x` tile and Esri
   caches none. Leaflet fills `{r}` with `@2x` whenever `devicePixelRatio` is above 1, with no option
   needed. `detectRetina` does something else: it asks for the NEXT zoom at half the tile size. At
   125% scaling that drew every place name at half its size, measured on 2026-09-14.
   **`CARTO_STYLE` in js/config.js names the style per theme.** `_nolabels` and `_only_labels` split
   the ground from the place names, which is the same split Esri publishes as `_Base` and
   `_Reference`. */
const CARTO = 'https://basemaps.cartocdn.com';
const cartoURL = (k, part, r = '{r}') =>
  `${CARTO}/${CARTO_STYLE[k]}_${part}/{z}/{x}/{y}${r}.png?key=${CARTO_KEY}`;

/* **The ground takes `@2x` only at 2x scaling and above. The place names take it at any scaling
   above 1x.** The ground carries no text. Measured on 2026-09-14 at 125% scaling, on the dark theme
   at zoom 12: a 1x ground cut the landing tiles from 1,225 KB to 491 KB, and the two grounds side
   by side were hard to tell apart. A 1x label layer drew every place name soft, so the names keep
   `{r}`. A phone or a 4K screen at 2x or more still gets the sharp ground.
   Read each time a layer is built, so a theme swap picks up a window moved to another screen. */
const groundR = () => devicePixelRatio >= 2 ? '{r}' : '';

/* One provider, picked once at module load. Nothing switches provider at run time, because the key
   cannot change while the page is open. ponytail: delete the Esri half the day CARTO is settled. */
const PROVIDER = CARTO_KEY
  ? { ground: k => cartoURL(k, 'nolabels', groundR()), names: k => cartoURL(k, 'only_labels'),
      opt: { maxZoom: 18 } }
  : { ground: k => tileURL(TILES[k].ground), names: k => TILES[k].names && tileURL(TILES[k].names),
      opt: { maxZoom: 18, maxNativeZoom: 16 } };

/* The credit names the provider that actually draws, because a licence term is not a comment.
   index.html states CARTO, which is where this is going. So the Esri fallback rewrites it.
   **The class is what lets css/map.css invert the dark ground.** That inversion makes a dark
   Voyager out of a light one. The Esri fallback is already dark, and an inversion of it draws a
   white map. So the rule names this class, and the fallback never takes it. */
if (CARTO_KEY) document.documentElement.classList.add('carto');
else for (const a of document.querySelectorAll('.tileprov')) {
  a.textContent = 'Esri';
  a.href = 'https://www.esri.com/';
}

let tiles, labels;

const isDark = () => document.documentElement.dataset.theme === 'dark';

/* **This map draws no sea, lake or pond of its own since 2026-09-14.** It drew all three from
   `water.json`, and the repository owner removed them. A water tint and river lines on the dark
   theme went on 2026-09-15. See docs/FEATURES.md.
   The place names, under everything this app reports. CARTO and Esri both publish them as a service
   of their own, so they are a second tile layer rather than part of the ground. It takes no pointer
   events, because a tile pane that answers a click sits between the reader and every pin.
   **THERE IS NO `mask` PANE ANY MORE, AND THERE MUST NOT BE ONE AGAIN.** It held the shading over
   everything outside the coverage area, at z-index 270. The repository owner deleted that shading on
   2026-09-23. The ground stops at the coverage area now, so there is nothing outside it left to
   shade. */
map.createPane('labels');
map.getPane('labels').style.zIndex = 260;
map.getPane('labels').style.pointerEvents = 'none';

/* **THE COVERAGE AREA IS ONE RECTANGLE, AND IT WAS A CIRCLE UNTIL 2026-09-23.** The map used to run
   on forever. A reader could zoom out to the whole world, and the pins then sat on a continent with
   no line to say which part of it this app answers for. The repository owner asked for a limit on
   2026-09-02, took a circle with everything outside it shaded, and replaced both on 2026-09-23. The
   shading is deleted and the shape is a rectangle.
   **Selangor is taller than it is wide, so a rectangle on its land wastes the least ground.** The
   circle measured 191 km on both axes. The rectangle measures 141 km north to south and 127 km east
   to west. That is a third less ground, and the map pays CARTO per tile.
   **ONE BOX ANSWERS ALL FOUR QUESTIONS NOW, and the circle answered them from three.** This box is
   the pan limit, the zoom floor, which tiles the map asks for, and whether a reader's own fix is
   inside. The circle needed a second, wider box for the tiles, because the ground had to reach past
   the circle for the shading to lie over it. With no shading there is nothing to reach past: the
   ground stops where the pan stops, so a reader can never travel to an edge the ground does not fill.
   **`MARGIN` is what a reader sees past the border.** The box edge is the edge of the map now, so a
   border flush against it reads as a map that was cut off. A tenth of each axis is about 13 km north
   and south and 12 km east and west. */
const MARGIN = 0.1;

/* The coverage box, once border.json has answered. **The three states are not the same.** While this
   is `undefined` the map asks for no tile at all. Once it is `false` the map asks for every tile. See
   `Ground` below. */
export let cover;

/* Whether a point sits inside the coverage area. This box is the shape the map stops the pan at and
   the ground fills, so it is the shape that answers "can this map say anything about where you are".
   **It answers yes until border.json lands, and yes if that file never lands.** A map with no box has
   no outside. The failure path already draws the whole ground, and a reader inside the area must not
   be refused because a 4 KB file was slow. `coverReady` is how a caller waits for the real answer.
   See `findMe()` in js/locate.js, which holds a restored fix until this resolves. */
export const inCover = ll => !cover || cover.contains(ll);

/* **THE GROUND FILLS THE COVERAGE BOX AND NOTHING OF IT DRAWS OUTSIDE.** CARTO counts every tile.
   The repository owner asked for fewer tile calls on 2026-09-14, and for the ground to stop at the
   coverage area on 2026-09-23.
   **A tile that touches the box loads whole, and the clip cuts off the part past the edge.** So the
   ground always reaches the box edge. An earlier version dropped every tile the circle did not hold
   and drew no clip, and the ground then stopped at whichever tile edge came last. That ragged block
   read as a page that had not finished loading.
   **The clip sits on each zoom level, in that level's own pixels, and an SVG mask stood here first.**
   `.coverframe` painted the page colour past the edge. Leaflet scales an SVG during a zoom and
   redraws it when the zoom ends. So a zoom out showed the ground past the edge until then, and a
   reader saw it on 2026-09-15. A level shrinks with its own clip, so the two cannot part.
   **The map asks for no tile until border.json answers.** `cover` is `undefined` until then. The
   answer clips the levels already built and redraws both layers. A failure sets `false`, and the
   whole ground draws.
   `_isValidTile`, `_tileCoordsToBounds` and `_onCreateLevel` are private Leaflet 1.9 methods, and
   `_levels` is private state. Check all four on an upgrade. */
const Ground = L.TileLayer.extend({
  _isValidTile(c) {
    if (!L.TileLayer.prototype._isValidTile.call(this, c)) return false;
    if (cover === false) return true;
    return !!cover && cover.intersects(this._tileCoordsToBounds(c));
  },
  _onCreateLevel(level) { clipLevel(this, level); },
});

// The box in one level's own pixels: projected at that level's zoom, less that level's origin.
function clipLevel(layer, level) {
  if (!cover) return;
  const [a, b] = [cover.getNorthWest(), cover.getSouthEast()]
    .map(ll => layer._map.project(ll, level.zoom).subtract(level.origin));
  level.el.style.clipPath =
    `polygon(${a.x}px ${a.y}px, ${b.x}px ${a.y}px, ${b.x}px ${b.y}px, ${a.x}px ${b.y}px)`;
}

/* The zoom floor and the pan limit, both off the coverage box. Re-run on every resize, because
   `getBoundsZoom()` answers for the window this map has right now: the level that fits the box on a
   desktop leaves half of it off a phone.
   **ONE box answers both, and that is what keeps the floor honest.** The floor is the zoom that fits
   the box, and the box is what a drag may not leave. So the two cannot disagree. Two numbers can, and
   an early version had them: a floor of `getBoundsZoom(cover) - 1` beside a pan box of
   `cover.pad(0.25)` reports a floor the box then refuses, because a level out doubles the ground on
   screen while a quarter pad adds half of it. `getMinZoom()` still answers the number it was given,
   and nothing errors.
   **The box is taller than it is wide, so a wide window shows bare container beside it at the
   floor.** `getBoundsZoom()` fits both axes and takes the tighter one, and the height is what binds
   here. The ground draws no tile outside the box, and nothing shades the rest since 2026-09-23. So
   those two strips are the Leaflet container itself. That is the accepted cost of a floor that shows
   the whole area at once. Raise the floor to `getBoundsZoom(cover, true)` to remove the strips, and
   accept that a wide window can then never hold the whole area. */
function setLimits() {
  if (!cover) return;
  map.setMaxBounds(cover);
  map.setMinZoom(map.getBoundsZoom(cover));
}

/* Fetched inline rather than deferred to an idle callback. It is 4 KB gzipped, and it carries the
   zoom floor, so a reader who lands zoomed out would otherwise see the world for as long as the
   browser felt like waiting. A failure is silent and leaves an unlimited map, which is the state this
   replaces. */
/* Exported so a caller can wait for the box rather than race it. It never rejects: the catch at the
   foot of this chain is the last link, so `coverReady.then(...)` runs on a failed fetch too, with
   `inCover()` then answering yes for every point. */
export const coverReady = fetch('border.json')
  .then(r => r.ok ? r.json() : Promise.reject(r.status))
  .then(geo => {
    /* **THE LAND RING, NEVER `bounds` AND NEVER THE WHOLE OUTLINE.** `bounds` on this file is the
       extent of Selangor's own relation, and that relation follows the maritime boundary west to
       longitude 100.39. Reading it puts 44 km of the Strait of Malacca inside the box, and the map
       then pays CARTO for tiles of open water. `border-build.php` drops every member way tagged
       `maritime=yes` and closes the arc with a chord, so this ring is Selangor's land with a straight
       west edge. Only that script can do it, because OpenStreetMap states `maritime=yes` on the member
       WAY and the geometry this file could read carries no tags at all.
       A file with no land ring is a file this app cannot use. It takes the failure path below rather
       than guess a box. */
    const ring = geo.features.find(f => f.properties.t === 'land')?.geometry.coordinates[0];
    if (!ring?.length) throw new Error('border.json carries no land ring');
    /* The ring's own extent. Measured 2026-09-23: west 100.8295, south 2.5953, east 101.9698, north
       3.8704, which is 127 km by 141 km. `L.latLngBounds` takes latitude first and GeoJSON states
       longitude first, so the pairs are swapped on the way in. */
    let [w, s, e, n] = [180, 90, -180, -90];
    for (const [x, y] of ring) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
    cover = L.latLngBounds([s, w], [n, e]).pad(MARGIN);
    // No tile was asked for before this line, and a level built before it has no clip. See `Ground`.
    for (const l of [tiles, labels]) if (l) {
      for (const level of Object.values(l._levels)) clipLevel(l, level);
      l.redraw();
    }
    setLimits();
  })
  // A failed box draws the whole ground, because a map with no ground is worse than every tile.
  .catch(() => { if (cover === undefined) { cover = false; tiles?.redraw(); labels?.redraw(); } });

function setBasemap() {
  const key = isDark() ? 'dark' : 'light';
  if (tiles) map.removeLayer(tiles);
  if (labels) map.removeLayer(labels);
  /* **`maxNativeZoom`, never `maxZoom` alone.** Esri's canvas cache stops at zoom 16 over this
     area. Zoom 17 and 18 both answer with one shared `Map data not yet available` plate — measured,
     the light and the dark service return the identical file — and that is a second watermark, of
     the kind this whole change exists to remove. `maxNativeZoom` stretches the zoom-16 tile across
     the two zooms above it instead. So the app keeps its own zoom range and only the ground goes
     soft. Every pin, label and heat blob is drawn by this app and stays sharp.
     CARTO caches to zoom 20, so its half of `PROVIDER` states no `maxNativeZoom` at all. */
  const opt = PROVIDER.opt;
  tiles = new Ground(PROVIDER.ground(key), opt).addTo(map);
  // A ground that bakes in its own place names states none. A second copy draws every name twice.
  const names = PROVIDER.names(key);
  labels = names ? new Ground(names, { ...opt, pane: 'labels' }).addTo(map) : null;
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
  /* **A pin sprite is a picture, so a theme swap has to throw the cache away.** The disc edge is
     `--surface`, the heart is `--fav` and the rise ring is `--s-danger`, and all three move with the
     shade. A DOM pin re-read its tokens on its own and a bitmap cannot.
     **`pins` is declared below this function and is safe to touch.** Nothing in this module calls
     `applyTheme()` at evaluation time. `js/ui.js` makes the first call, and that module imports this
     one, so the whole file has run by then. */
  resetSprites();
  pins.redraw();
  return t;
}

// --- the pins ------------------------------------------------------------------------------------

/* **EVERY STATION PIN AND EVERY CLUSTER CHIP IS DRAWN ON ONE CANVAS, AND EACH WAS A DOM NODE.**
   `js/pins.js` holds the layer and states the measurement: 103 frames against 230 over one scripted
   gesture, with the 95th-percentile frame falling from 140 ms to 25 ms. A canvas layer costs what
   drawing no marks at all costs.
   **Leaflet.markercluster is gone with it**, along with its script tag and its stylesheet. The
   clustering it did is 30 lines of greedy grid in `pins.js`, at the same radius, and this app used
   about a tenth of what that plugin offers.
   **The chip carries a count and no kind hue**, which is what the plugin's `iconCreateFunction` drew
   here before. A cluster is usually mixed, so a type colour would lie about it. It turns red where a
   child is at its danger mark or sounding, and dashed where it holds more than one kind. */
export const marks = {};                 // lead kind -> site markers, whether currently shown or not
for (const k of Object.keys(KINDS)) marks[k] = [];

// site key -> its marker. One pin can now stand for several stations, so a marker can no longer be
// found by looking in its own kind's bucket — a river gauge's pin may be filed under `siren` if a
// sounding siren shares the mast and leads it.
export const siteMark = new Map();

export const shown = k => document.querySelector(`#layers input[data-kind="${k}"]`)?.checked;

/* Screen pixels, two bands: city and state. **24 and 18 since 2026-09-14, and they were 34 and 26.**
   A reader asked for less clustering on the day the station pins grew to a 26.8px disc. Measured
   over 458 sites, markers hidden in a chip: 202 against 264 at zoom 12, 94 against 129 at 13, and
   46 against 70 at 14. Zoom 9 to 11 move less, because most sites there stand closer together than
   either radius. The cost is overlap: two pins 18 to 27px apart draw one disc over the edge of the
   other. Both still take a press, because the hit test picks the nearer middle.
   **A third band held 14px from zoom 15, and it is deleted rather than left.** `UNCLUSTER_Z` stops
   the grouping before that band can be reached, so it was a dead rung in a ladder of thresholds and
   the next person to tune it would read it as a live one. */
const CLUSTER_R = z => (z >= 13 ? 18 : 24);
/* **NOTHING CLUSTERS FROM ZOOM 15, WHICH IS THE MAP'S OWN CEILING.** The repository owner asked for
   that on 2026-09-03. Measured before it: 6 markers of 460 still merged at 15 on the radius alone,
   and the 15 densest views drew 11 chips between them. It reads as the first UNCLUSTERED zoom, which
   is also how markercluster's own `disableClusteringAtZoom` behaved once its source was read. See
   docs/VERIFY.md for the sweep. */
const UNCLUSTER_Z = 15;

export const pins = new PinLayer({ radius: CLUSTER_R, off: UNCLUSTER_Z }).addTo(map);

/* **The selected pin stays a DOM marker, and it is the only one left.** `markSel()` swaps that pin
   for a teardrop with its own CSS — a size, a red and an anchor at its tip — and none of that is
   worth a second code path on the canvas. One marker is not a cost.
   **Favorites are on the canvas now, and they used to be here.** They stood outside the cluster
   because a star swallowed by a chip is a star that did not work. They still do: `loose` marks them
   and `pins.js` never groups a loose item. The heart is drawn into the sprite.
   The name stays `favLayer`, because what its tenants share is that they stand outside the cluster. */
export const favLayer = L.layerGroup().addTo(map);

export function syncCluster(alsoShow) {
  favLayer.clearLayers();
  const items = [];
  for (const [k, list] of Object.entries(marks)) {
    if (!(shown(k) || k === alsoShow)) continue;
    for (const m of list) {
      if (m === selPin) { favLayer.addLayer(m); continue; }
      /* `pin` is the appearance descriptor `render.js` writes beside the icon. A marker with none is
         not a station pin and cannot be drawn from a sprite, so it falls back to the DOM layer. */
      if (m.options.pin) items.push({ marker: m, pin: m.options.pin, loose: !!m.options.fav });
      else favLayer.addLayer(m);
    }
  }
  pins.setItems(items);
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
let selPin = null, selWas = null, selKey = null;

export function markSel(key) {
  const pin = key ? siteMark.get(key) : null;
  if (pin === selPin) return;
  const moved = key !== selKey;
  selKey = key;
  if (selPin) selPin.setIcon(selWas);
  selPin = pin;
  if (pin) {
    selWas = pin.options.icon;
    /* **BUILT FRESH, and it used to be the station's own html patched twice.** That worked while a
       station pin was a bare glyph: swap the class, re-point the `<use>` at the teardrop, done.
       A station pin is a DISC now — a `<circle>` with the glyph knocked out of it — so re-pointing
       the `<use>` left a teardrop cut out of a coloured disc, which is not what a selected pin is.
       **NOTHING IS CARRIED OVER, AND THE COLOUR USED TO BE.** This lifted the station's `--c`, so
       the mark wore that station's kind hue or its danger red. The repository owner asked for one
       red on 2026-09-03. `.pin.sel` in `css/map.css` states it, off `--sel`, and that rule beats
       `.pin`'s own `var(--c)`. So an inline `--c` here would be read by nothing.
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
    pin.setIcon(L.divIcon({ className: '', iconSize: [32, 32], iconAnchor: [16, 29.3],
      html: `<span class="pin sel">${pinGlyph('place')}</span>` }));
  }
  /* **Move it out of the cluster, and move the last one back in.** `syncCluster()` reads `selPin`,
     so one re-sort answers both halves and neither is written twice.
     **It runs when the KEY changes, and the early return above never promised that.** Every poll
     builds new markers, so the marker for an open card is never the one this function marked last.
     A card left open therefore re-sorted four hundred pins twice on every poll, found 2026-09-15.
     A rebuild that keeps the key re-sorts on its own: `render()` calls `syncCluster()` a few lines
     after this, and a weather rebuild moves no station pin. */
  if (moved) syncCluster();
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
  /* **THE FIRST CIRCLE IS THE PIN'S SHADOW, AND IT REPLACED A CSS `filter`.** `.pin` cast
     `drop-shadow(0 1px 1px …)` for every mark on the map. A CSS filter forces its element onto a
     render surface of its own, and Leaflet scales the whole marker pane through a zoom, so all 260
     of them re-rasterized on every frame of it. Measured over one scripted gesture — six zoom steps
     and two pans, three runs of each condition taken alternately, medians: 87 frames in 4.2 s with
     the filter and 120 without it, with the 95th-percentile frame falling from 193 ms to 110 ms.
     A circle is not a filter, so this costs the compositor nothing and draws the same picture: it is
     the disc again, one and a third pixels lower, in black at 38%. The white stroke on the disc
     above covers all but the sliver at the foot, which is what a 1px drop shadow showed anyway.
     **`.pin:not(.disc)` still carries the CSS filter**, and `render.js` is what writes that class.
     So the four marks that are not a station disc keep it: "you are here", a searched place, the
     selected teardrop and a weather pin. There are at most a handful of those on screen at once. */
  return disc
    ? `<svg class="pinglyph disc" viewBox="0 0 40 40"><circle class="sh" cx="20" cy="21.3" r="17.6"/>` +
      `<circle cx="20" cy="20" r="17.5"/>` +
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
