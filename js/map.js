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
export const map = L.map('map', { maxZoom: 18, attributionControl: false, zoomControl: false })
  .setView(PREFS.center || [3.2, 101.4], PREFS.zoom || 9);
L.control.zoom({ position: 'bottomright' }).addTo(map);

/* --- the supporting pane --------------------------------------------------------------------- */

/* **One `<dialog>`, two variants, and the window class picks the method.** M3's canonical
   supporting-pane layout hides the supporting pane in a compact window and navigates to it as a
   full-screen destination. So below 600px this opens with `showModal()`, which is the only way to
   get the top layer, a real focus trap and an inert page behind it. Above 600px it opens with
   `show()`: a non-modal dialog is a plain positioned box, which is what a standard side sheet
   beside a live map has to be.
   **A `MutationObserver` on the body class rather than a call at each site.** The pane is open when
   one of its occupants is, and four functions write those classes — `setDrawer()`, `openSide()`,
   `closeSide()` and the breakpoint listener in ui.js. Watching the fact beats remembering four
   calls, which is the same argument the size observer below makes.
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
export function railActive(id) {
  for (const b of document.querySelectorAll('#rail .railitem'))
    if (id === b.id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
}

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
  for (const d of document.querySelectorAll('dialog[open]'))
    if (DIALOG_ITEM[d.id]) return railActive(DIALOG_ITEM[d.id]);
  railActive(cls.contains('drawer') ? 'railFilters'
           : cls.contains('find')   ? 'railFind'
           : cls.contains('side') && side.key === '@alerts' ? 'railAlerts' : null);
}

function syncPane() {
  const cls = document.body.classList;
  /* **`find` opens this pane at compact width alone.** Above 600px the search is M3's docked search
     view: a card that floats over the map's top-left corner, outside this dialog entirely. Below it
     the search is M3's full-screen search view, which is what this pane is there. So the class means
     two different surfaces, and only one of them is a pane occupant. */
  const want = cls.contains('drawer') || cls.contains('side')
            || (cls.contains('find') && narrow.matches);
  railSync();
  if (!want) { pane.close(); return; }
  if (pane.open && paneModal === narrow.matches) return;
  pane.close();
  paneModal = narrow.matches;
  if (paneModal) { pane.showModal(); return; }
  /* **`show()` runs the dialog focusing steps too, and on a desktop that is wrong.** Landing opens
     the filters, and the pane would take focus into the district filter box before a reader has
     touched anything. A modal full-screen dialog SHOULD take focus, so only this branch puts it
     back. */
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
  if (!pane.open) document.body.classList.remove('drawer', 'side');
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
  sized = requestAnimationFrame(() => map.invalidateSize({ debounceMoveend: true }));
}).observe(el('map'));

map.on('moveend zoomend', () => {
  const c = map.getCenter();
  Object.assign(PREFS, { center: [+c.lat.toFixed(5), +c.lng.toFixed(5)], zoom: map.getZoom() });
  save();
});

// --- basemap & theme ---------------------------------------------------------------------------

const tileURL = k => `https://{s}.basemaps.cartocdn.com/${TILES[k]}/{z}/{x}/{y}{r}.png`;
let tiles;

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
  // Only the dark basemap needs lifting; the light one would wash out.
  document.documentElement.dataset.lift = key === 'dark' ? 'yes' : 'no';
  if (tiles) map.removeLayer(tiles);
  tiles = L.tileLayer(tileURL(key), { maxZoom: 18 }).addTo(map);
  setWater(key === 'dark');
}

// Three choices, two themes. PREFS.theme holds what the reader picked — 'system', 'light' or 'dark'
// — and applyTheme() resolves it to one of the two. Anything that is not 'light' or 'dark' means
// system, so an absent pref is the default and a stored one from before this control existed still
// works.
const sysDark = matchMedia('(prefers-color-scheme: dark)');

// One-time clear, and the only thing that makes 'system' the default for a reader who has been here
// before. The old two-state toggle wrote a resolved 'light' or 'dark' back on every single load, so
// every stored value predating this control was copied from the system rather than chosen — and
// honouring it would leave Auto reachable by new visitors alone. `themePick` marks the pref as one
// somebody actually picked. A reader who had deliberately set dark under the old build loses that
// once, which is one tap in a control that is now on screen.
if (!PREFS.themePick) { delete PREFS.theme; PREFS.themePick = 1; save(); }

export function setTheme(t) {
  PREFS.theme = t;
  save();
  applyTheme();
}

// Separate from setTheme(), because the system can change the answer without the reader picking
// anything. It reads the pref every time, so the listener below is a no-op on 'light' or 'dark' and
// needs no test of its own. Returns the pick rather than the resolved theme: the control shows what
// was chosen, not what that resolved to today.
export function applyTheme() {
  const pick = PREFS.theme === 'light' || PREFS.theme === 'dark' ? PREFS.theme : 'system';
  const t = pick === 'system' ? (sysDark.matches ? 'dark' : 'light') : pick;
  document.documentElement.dataset.theme = t;
  // The standalone window's title bar. Same value the header paints itself, so an installed app
  // has no seam above its own header — see the --surface tokens in css/base.css.
  document.querySelector('meta[name=theme-color]').content = t === 'dark' ? '#202124' : '#ffffff';
  setBasemap();
  return pick;
}

sysDark.addEventListener('change', applyTheme);

// --- clustering --------------------------------------------------------------------------------

// One cluster for everything, regardless of category. A badge shows just the total in a neutral
// chip — no kind icon or hue, because a cluster is usually mixed and a type colour would lie about
// it — turning red if any child is at danger / sounding, dashed if it holds more than one kind.
export const cluster = L.markerClusterGroup({
  // Tighten as you zoom rather than switching clustering off — several stations share exact
  // coordinates (a rainfall and a river gauge on the same mast), so they overlap at any zoom.
  // Those stay clustered to the end and fan out on click instead of hiding each other.
  maxClusterRadius: z => z >= 15 ? 14 : z >= 13 ? 26 : 48,
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
      // Two pixels of air around `.cluster`'s 24px chip. Down 30% from 36/34 — the chip is a count,
      // not a station, and at the old size it read as the largest mark on the map. Both numbers move
      // together or the badge stops sitting over the pins it is hiding.
      className: '', iconSize: [25, 25],
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
   place. */
export const favLayer = L.layerGroup().addTo(map);

export function syncCluster(alsoShow) {
  cluster.clearLayers();
  favLayer.clearLayers();
  for (const [k, list] of Object.entries(marks)) {
    if (!(shown(k) || k === alsoShow)) continue;
    cluster.addLayers(list.filter(m => !m.options.fav));
    for (const m of list) if (m.options.fav) favLayer.addLayer(m);
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
  /* `.fav` first, so the heart lands to the left of the ⋮: `querySelectorAll` answers in document
     order, and `dots()` emits the button before it. The popover takes no room in the row. */
  el('sideActions').replaceChildren(
    ...(head ? head.querySelectorAll(':scope > .fav, :scope > .dots, :scope > .menu') : []));
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
  /* At phone width the two panels are 84vw each and the drawer is painted over this one, so only one
     of them may be open. The notice goes out as an event rather than a call because ui.js owns the
     drawer and ui.js already imports this module — importing setDrawer back would close the cycle.
     Only on a real open: render() calls openSide() on every poll to refresh the card in place. */
  if (!document.body.classList.contains('side')) {
    document.body.classList.add('side');
    document.dispatchEvent(new Event('sideopen'));
  }
  mastAt ? showMast(mastAt) : hideMast();
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
  syncAlertBtn();
}

/* The app bar's warning glyph is a disclosure for one particular occupant of this panel, and the
   panel has half a dozen other ways to change what is in it — a pin, the table, "you are here", the
   × — so the button's state is synced from here rather than from the click that opened it. */
const syncAlertBtn = () => el('railAlerts').setAttribute('aria-expanded', side.key === '@alerts');

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
export function pinGlyph(name) {
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
  return `<svg class="pinglyph"><use href="#g-${name}"/></svg>`;
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
    // Same box and same tip anchor as the "you are here" pin: a pin points at its tip, not its
    // middle, and Material draws the glyph with a little air below it inside the viewBox.
    className: '', iconSize: [48, 48], iconAnchor: [24, 44],
    html: `<span class="pin place">${pinGlyph('place')}</span>`,
  }) }).addTo(map);
  focusOn(latlng, 13);
  ping(latlng);   // the default accent ripple — `.ping.place` is gone, it painted the same colour
}
