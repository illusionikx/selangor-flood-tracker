// The MET weather layer: a map of nowcast points, and the panel one of them opens.
//
// Loaded on demand. A reader who never opens weather mode loads none of this and fetches none of
// its data. That is why the points ride ?wx=1 and not the payload every poll already carries.

import { FEED_WX, WX_THIN_PX, WEATHER, MET_NAME } from './config.js';
import { PREFS } from './state.js';
import { map, pinGlyph, openSide, side, focusOn } from './map.js';
import { wxIcon, stamp } from './popup.js';
import { askJson } from './ask.js';
import { el } from './util.js';

const layer = L.layerGroup();
let pts = [];    // the last answer from ?wx=1
let gen = 0;     // a stale fetch must never paint over a newer one — the rule clip.js states

/* Every clock this app prints is Malaysian. JPS and MET both stamp that way. A mixed panel is a
   panel nobody can read. */
const MYT_HM = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hour12: false,
});
const hhmm = ms => MYT_HM.format(new Date(ms));

/* Keep a point only where no kept point stands within WX_THIN_PX of it, in screen pixels.
   Thinning and not clustering: a cluster badge reading 6 cannot say WHICH weather. Weather is a
   field, so a point 240 m from another agrees with it. Dropping it at a low zoom loses nothing.
   Greedy over the payload's own order, which is stable. So two renders at one zoom keep the same
   points, and the map does not flicker between them. */
function thin(list) {
  const kept = [], at = [];
  for (const p of list) {
    const q = map.latLngToLayerPoint([p.lat, p.lng]);
    if (at.every(k => q.distanceTo(k) >= WX_THIN_PX)) { kept.push(p); at.push(q); }
  }
  return kept;
}

const tone = r => (r >= 2 ? 'heavy' : r === 1 ? 'rain' : 'clear');

function paint() {
  layer.clearLayers();
  if (!PREFS.wx) return;
  for (const p of thin(pts)) {
    const r = p.rungs[0];
    L.marker([p.lat, p.lng], {
      icon: L.divIcon({
        // Matches `.pin`'s box in map.css, the same way render.js does. Leaflet positions the
        // marker off this and not off the CSS.
        className: '', iconSize: [39, 39], iconAnchor: [19.5, 19.5],
        html: `<span class="pin" style="--c:var(--wx-${tone(r)})">${
          pinGlyph(wxIcon(r, { pin: true }))}</span>`,
      }),
    })
      .on('click', () => { openSide('@wx-' + p.id, card(p)); focusOn([p.lat, p.lng], 12); })
      .addTo(layer);
  }
}

/* Provenance, and only provenance. This app prints a timestamp inside a menu and nowhere else. The
   third line is here for the same reason. Which half of the strip this app observed is a fact
   about the plumbing, not about the weather. */
const dots = p => `<button class="icon dots" popovertarget="mnu-wx"
    title="Details" aria-label="Details about this forecast"><i class="i i-more_vert"></i></button>
  <div id="mnu-wx" class="menu surface" popover>
    <div class="mi info"><span>
      <small class="muted">Issued ${stamp(p.stamp * 1000)}</small><br>
      <small class="muted">Via ${MET_NAME}</small><br>
      <small class="muted">Earlier times were read here. Later times come from MET.</small>
    </span></div>
  </div>`;

/* One card per half hour, built like the weather card's `Later` cell. It reads a glyph, then the
   word beside it, then the clock under the pair.
   The word is written out rather than left on `data-tip` alone. The weather card can leave it
   there, because a reader takes in its two glyphs at once. Nine glyphs in a stack would each need
   a tap to name, and `data-tip` opens one at a time.
   `w.line` reads "Heavy rain" where `w.word` reads "Heavy", and a full-width card has room for the
   longer one. Rung 0 has no `line`, so `word` answers there.
   `aria-hidden` on the glyph, because the word beside it already says the same thing. A screen
   reader must not say it twice. */
const stepCard = (rung, clock, now) => {
  const w = WEATHER[rung] || WEATHER[0];
  return `<div class="wxcol${now ? ' now' : ''}">
      <div class="wxrow">
        <i class="i wxbig i-${wxIcon(rung, { clock })}" aria-hidden="true"></i>
        <span class="wxline">${w.line || w.word}</span>
        ${now ? '<b class="wxnow">NOW</b>' : ''}
      </div>
      <span class="wxsub">${clock}</span>
    </div>`;
};

function card(p) {
  const temp = p.tmax == null ? '' : `<div class="wxrow wxtoday">
      <span class="wxtemp" data-tip="Max ${p.tmax}° · Min ${p.tmin}°">
        <span>${p.tmax}°</span><span>${p.tmin}°</span></span>
      <span class="wxline">Today</span>
    </div>`;

  const cards = [
    ...p.past.map(([ts, r]) => stepCard(r, hhmm(ts * 1000), false)),
    stepCard(p.rungs[0], hhmm(p.stamp * 1000), true),
    ...p.rungs.slice(1).map((r, i) => stepCard(r, p.clocks[i + 1], false)),
  ].join('');

  /* `.pophead` first, always. openSide() lifts it out into #sideHead, and that seam is what keeps
     the place name off the scrolling body. */
  return `<div class="pophead">
      <b class="popname">${p.n}</b>
      <span class="popsub muted">${MET_NAME}</span>
      ${dots(p)}
    </div>
    <div class="sensor">
      <div class="sensorhead">
        <i class="glyph i i-${wxIcon(p.rungs[0])}" style="color:var(--k-weather)"></i>
        <b>Weather</b>
      </div>
      ${temp}
      <div class="wxsteps">${cards}</div>
    </div>`;
}

/* Reads the preference and writes the control and the layer. syncHeat() writes the summary now,
   because it already reads both heat preferences. It never reads the control back. A browser
   restores a checkbox across a reload without firing `change`. So an invariant repaired inside a
   change handler is repaired on none of the paths the browser takes. This is the rule syncHeat()
   exists to state. */
export function syncWx() {
  const on = !!PREFS.wx;
  el('wxLayer').checked = on;
  on ? layer.addTo(map) : layer.remove();
}

/* One poll of the weather endpoint. render() calls this while the mode is on.
   A failed fetch keeps the last answer. A poll that missed is not a forecast of clear skies. */
export async function tick() {
  syncWx();
  if (!PREFS.wx) { paint(); return; }
  const mine = ++gen;
  try {
    const j = await askJson(FEED_WX);
    if (mine !== gen) return;
    pts = j.points || [];
  } catch { /* keep pts */ }
  if (mine !== gen) return;
  /* Nothing to draw and nothing to blame the reader for. A server that has never refreshed has no
     row yet, and the static bake may have skipped the file.
     The chip says so, not the section. `.loadfail` prints a dialog-sized message, and this section
     also holds two heatmaps that work. `.hint` is the small slot the two filter chips below
     already use for the same job. */
  el('wxHint').textContent = pts.length === 0 ? 'no data yet' : '';
  paint();
  if (side.key?.startsWith('@wx-')) {
    const p = pts.find(x => '@wx-' + x.id === side.key);
    if (p) openSide(side.key, card(p));
  }
}

// The pins are sized in screen pixels, so the set that survives thinning changes with the zoom.
map.on('zoomend', paint);
