// The Leaflet map itself: basemap/theme, the shared marker cluster, and the view helpers that
// every panel uses to jump to a station.

import { KINDS, MAST, TILES, FLASH_MS } from './config.js';
import { state, PREFS, save } from './state.js';
import { el, distKm } from './util.js';

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

function setBasemap() {
  const key = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  // Only the dark basemap needs lifting; the light one would wash out.
  document.documentElement.dataset.lift = key === 'dark' ? 'yes' : 'no';
  if (tiles) map.removeLayer(tiles);
  tiles = L.tileLayer(tileURL(key), { maxZoom: 18 }).addTo(map);
}

export function setTheme(t) {
  document.documentElement.dataset.theme = t;
  el('theme').firstElementChild.className = `i i-${t === 'dark' ? 'light_mode' : 'dark_mode'}`;
  PREFS.theme = t;
  save();
  setBasemap();
}

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
      className: '', iconSize: [36, 36],
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

export function syncCluster(alsoShow) {
  cluster.clearLayers();
  for (const [k, list] of Object.entries(marks)) {
    if (shown(k) || k === alsoShow) cluster.addLayers(list);
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
  mastRing = L.circle(latlng, {
    radius: state.siteM, interactive: false,
    color: MAST.color, weight: 1, dashArray: '4 3', fillColor: MAST.color, fillOpacity: .08,
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
  document.body.classList.add('side');
  mastAt ? showMast(mastAt) : hideMast();
}

export function closeSide() {
  side.key = null;
  document.body.classList.remove('side');
  hideMast();
}

el('sideClose').onclick = closeSide;
// Same dismissal a popup had: a click on the map itself means "not that one". Marker clicks never
// reach here — Leaflet stops them at the marker.
map.on('click', closeSide);

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

  const ping = L.marker([t.lat, t.lng], {
    icon: L.divIcon({ className: '', iconSize: [0, 0], html: '<i class="ping"></i>' }),
    interactive: false, zIndexOffset: -1,
  }).addTo(map);

  setTimeout(() => {
    ping.remove();
    // Only arm this after the flash: the flight and zoomToShowLayer above move the map themselves.
    map.once('dragstart zoomstart', unpin);
  }, FLASH_MS);
}

// "Navigated away" = a pan or zoom the user asked for, not the panel closing: you can close the
// card and still be looking at the pin it described.
function unpin() {
  if (!state.pinned) return;
  state.pinned = null;
  state.rerender();
}
