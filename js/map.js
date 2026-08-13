// The Leaflet map itself: basemap/theme, the shared marker cluster, and the view helpers that
// every panel uses to jump to a station.

import { KINDS, TILES, FLASH_MS } from './config.js';
import { state, PREFS, save } from './state.js';
import { el, distKm } from './util.js';
import { byId } from './stations.js';
import * as clip from './clip.js';

// maxZoom on the map, not just the tile layer: markercluster is added below at module load, before
// setBasemap() has run, and it throws "Map has no maxZoom specified" if no layer declares one yet.
export const map = L.map('map', { maxZoom: 18, attributionControl: false, zoomControl: false })
  .setView(PREFS.center || [3.2, 101.4], PREFS.zoom || 9);
L.control.zoom({ position: 'bottomright' }).addTo(map);

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
    const later = window.requestIdleCallback || (fn => setTimeout(fn, 1200));
    later(() => fetch('water.json')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(g => { waterGeo = g; if (isDark()) setWater(true); })
      .catch(() => {}));   // No water is a plainer map, not a broken one. Every reading still draws.
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
  /* render() adds all 417 site markers in one addLayers() call, and that call blocks until it
     finishes. This breaks the work into chunks and yields between them, so the page keeps
     answering a tap while the markers arrive. The option only affects addLayers(), which is the
     call js/map.js makes. */
  chunkedLoading: true,
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
  el('sideHead').replaceChildren(...[body.querySelector('.pophead')].filter(Boolean));
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

  /* The card holds at most one camera, and `data-clip` carries its proxy id. `start()` is
     idempotent by that id, which is what makes this safe to call again on every poll — render()
     re-runs openSide() for whatever is on screen, and a clip that restarted there would jump back
     to frame 0 while somebody was watching it. */
  const n = body.querySelector('[data-clip]')?.dataset.clip;
  const cam = n ? byId(`camera-${n}`) : null;
  cam ? clip.start(body, cam) : clip.stop();
}

export function closeSide() {
  clip.stop();
  side.key = null;
  document.body.classList.remove('side');
  hideMast();
  syncAlertBtn();
}

/* The app bar's warning glyph is a disclosure for one particular occupant of this panel, and the
   panel has half a dozen other ways to change what is in it — a pin, the table, "you are here", the
   × — so the button's state is synced from here rather than from the click that opened it. */
const syncAlertBtn = () => el('alertBtn').setAttribute('aria-expanded', side.key === '@alerts');

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
export function focusOn(latlng, minZoom = 0) {
  const z = Math.max(map.getZoom(), minZoom);
  const cls = document.body.classList;
  const shift = (cls.contains('drawer') ? el('bar').offsetWidth / 2 : 0)
    - (cls.contains('side') && innerWidth > 600 ? el('side').offsetWidth / 2 : 0);
  map.setView(map.unproject(map.project(L.latLng(latlng), z).subtract([shift, 0]), z), z);
}

// Fly to a station and ripple over it. If its layer is switched off, show it for the flash only —
// unless the user turns that layer on in the meantime.
export function flashTo(t) {
  // A target can be missing for any of three reasons — its layer is off, a district filter dropped
  // it, or rising-only did. All three are answered the same way now that render() groups by site:
  // pin it, rebuild, and drop the pin once the user navigates off. Pinning outranks every filter,
  // so the marker is guaranteed to exist afterwards.
  if (state.pinned !== t.id) { state.pinned = t.id; state.rerender(); }

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
