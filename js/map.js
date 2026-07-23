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

// --- view helpers ------------------------------------------------------------------------------

// Centre on the visible half of the map: with the drawer open, dead-centre is under the panel.
export function focusOn(latlng, minZoom = 0) {
  const z = Math.max(map.getZoom(), minZoom);
  const shift = document.body.classList.contains('drawer') ? el('bar').offsetWidth / 2 : 0;
  map.setView(map.unproject(map.project(L.latLng(latlng), z).subtract([shift, 0]), z), z);
}

// Zooming re-runs clustering, which rebuilds markers and quietly drops any open popup. Re-open it
// once the map settles — cheap insurance whether the pan came from a click or a panel link.
export function openStable(marker) {
  marker.openPopup();
  map.once('moveend', () => { if (!marker.isPopupOpen()) marker.openPopup(); });
}

// Leaflet's autoPan gives up when a popup is taller than the map, leaving the top cut off.
// Nudge the view so the top edge is always readable — that is where the name and readings are.
function keepPopupVisible() {
  const pop = document.querySelector('.leaflet-popup');
  if (!pop) return;
  const r = pop.getBoundingClientRect();
  // Phones: drop the popup so its foot — the pin — sits just above the heat legend, filling the band
  // up towards the alert panel. Clamp the top so a band-taller popup can't slide under the header.
  // POP_LEGEND / POP_TOP pair with map.css's popup max-height and util.js popPan(); move them together.
  if (innerWidth <= 600) {
    const POP_TOP = 200, POP_LEGEND = 155;
    let shift = (innerHeight - POP_LEGEND) - r.bottom;      // pin down to just above the legend
    if (r.top + shift < POP_TOP) shift = POP_TOP - r.top;   // …unless that buries the header
    if (Math.abs(shift) > 2) map.panBy([0, -shift], { duration: .2 });
    return;
  }
  const box = map.getContainer().getBoundingClientRect();
  const gap = 12;
  let shift = 0;
  if (r.top < box.top + gap) shift = box.top + gap - r.top;                 // push content down
  else if (r.bottom > box.bottom - gap)                                     // or up, but never so
    shift = -Math.min(r.bottom - (box.bottom - gap), r.top - (box.top + gap));  // far the top clips
  if (Math.abs(shift) > 2) map.panBy([0, -shift], { duration: .2 });
}
map.on('popupopen', () => {
  keepPopupVisible();
  setTimeout(keepPopupVisible, 500);   // again once a camera still has loaded and changed the height
});

// Fly to a station and ripple over it. If its layer is switched off, show it for the flash only —
// unless the user turns that layer on in the meantime.
export function flashTo(t) {
  // A target can be missing for any of three reasons — its layer is off, a district filter dropped
  // it, or rising-only did. All three are answered the same way now that render() groups by site:
  // pin it, rebuild, and drop the pin once the user navigates off. Pinning outranks every filter,
  // so the marker is guaranteed to exist afterwards.
  if (state.pinned !== t.id) { state.pinned = t.id; state.rerender(); }

  /* Open only once the flight has landed. Opening mid-pan let the popup's own autoPan fire a panBy()
     while focusOn()'s setView animation was still running, and the two composed into an off-centre
     view. It only ever showed up when the target was *already* on screen: that is the case Leaflet
     animates (a short offset) rather than jumping straight there, and also the case markercluster's
     zoomToShowLayer answers synchronously, since the marker already has an icon in the viewport.
     Registered *before* focusOn, not after: a long jump resets the view instead of animating, which
     fires moveend from inside setView — a listener added afterwards would miss it and never open. */
  const marker = siteMark.get(t.site || t.id);
  // Inside a cluster the marker has no DOM node yet — expand down to it before opening the popup.
  if (marker) map.once('moveend', () => cluster.zoomToShowLayer(marker, () => openStable(marker)));
  focusOn([t.lat, t.lng], 13);

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

// "Navigated away" = a pan or zoom the user asked for. Not popupclose — markercluster tears popups
// down on every zoom, so that would fire while the user is still looking at the station.
function unpin() {
  if (!state.pinned) return;
  state.pinned = null;
  state.rerender();
}
