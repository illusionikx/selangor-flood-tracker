// The MET weather layer: a map of nowcast points, and the panel one of them opens.
//
// Loaded on demand. A reader who never opens weather mode loads none of this and fetches none of
// its data. That is why the points ride ?wx=1 and not the payload every poll already carries.

import { FEED_WX, WX_THIN_PX, WEATHER, wxSky, MET_NAME } from './config.js';
import { PREFS } from './state.js';
import { map, pinGlyph, openSide, side, focusOn } from './map.js';
import { wxIcon, wxTone, stamp } from './popup.js';
import { askJson } from './ask.js';
import { el, ago } from './util.js';

/* Mirrors MET_STALE in api.php. That constant stops a refresh from writing a row of stale
   points. It cannot stop an already-written row from aging once every point in it turns
   stale. tick() below reads this to warn a reader when that has happened. */
const STALE_S = 7200;

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

function paint() {
  layer.clearLayers();
  if (PREFS.mapLayer !== 'weather') return;
  for (const p of thin(pts)) {
    const r = p.rungs[0];
    L.marker([p.lat, p.lng], {
      icon: L.divIcon({
        // Matches `.pin`'s box in map.css, the same way render.js does. Leaflet positions the
        // marker off this and not off the CSS.
        className: '', iconSize: [39, 39], iconAnchor: [19.5, 19.5],
        html: `<span class="pin" style="--c:${wxTone(r, { pin: true, sky: p.sky })}">${
          pinGlyph(wxIcon(r, { pin: true, sky: p.sky }))}</span>`,
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
const stepCard = (rung, clock, now, sky) => {
  const w = wxSky(rung, sky) || WEATHER[rung] || WEATHER[0];
  return `<div class="wxcol${now ? ' now' : ''}">
      <div class="wxrow">
        <i class="i wxbig i-${wxIcon(rung, { clock, sky })}"
           style="color:${wxTone(rung, { clock, sky })}" aria-hidden="true"></i>
        <span class="wxline">${w.line || w.word}</span>
        ${now ? '<b class="wxnow">NOW</b>' : ''}
      </div>
      <span class="wxsub">${clock}</span>
    </div>`;
};

function card(p) {
  /* The day's two ends, as a card of the same shape as the half-hour cards under it. Low on the
     left and high on the right, because that is the order a scale runs in and the pair then needs
     no words. The arrow is what says which is which, so `.wxsub` states the day rather than
     repeating either end. `aria-label` carries the words for a reader who hears the card. */
  const temp = p.tmax == null ? '' : `<div class="wxcol wxtoday">
      <div class="wxtemps">
        <span class="wxt" aria-label="Low ${p.tmin} degrees">
          <i class="i i-arrow_downward" aria-hidden="true"></i>${p.tmin}°</span>
        <span class="wxt" aria-label="High ${p.tmax} degrees">
          <i class="i i-arrow_upward" aria-hidden="true"></i>${p.tmax}°</span>
      </div>
      <span class="wxsub">Today</span>
    </div>`;

  const cards = [
    /* The last two readings and no more. The card is a forecast, and the half hour behind it is
       there to say which way the weather is going. An hour of it pushed the steps that have not
       happened yet under the fold. */
    ...p.past.slice(-2).map(([ts, r]) => stepCard(r, hhmm(ts * 1000), false, p.sky)),
    stepCard(p.rungs[0], hhmm(p.stamp * 1000), true, p.sky),
    ...p.rungs.slice(1).map((r, i) => stepCard(r, p.clocks[i + 1], false, p.sky)),
  ].join('');

  /* `.pophead` first, always. openSide() lifts it out into #sideHead, and that seam is what keeps
     the place name off the scrolling body.

     `dots(p)` comes first inside it too. css/map.css reserves the ⋮'s corner with a rule that only
     matches a title after it, `.dots ~ .popname`. popup.js's own goName() states the same rule and
     obeys it the same way.

     Both lines below are block `<div>`s, matching goName() and region() in popup.js. A padding-
     right on an inline box only clears its own last line. On a wrapped title, the ⋮ still overlaps
     every line above the last one. */
  return `<div class="pophead">
      ${dots(p)}
      <div class="popname">${p.n}</div>
      <div class="muted">${MET_NAME}</div>
    </div>
    <div class="sensor">
      <div class="sensorhead">
        <i class="glyph i i-${wxIcon(p.rungs[0], { sky: p.sky })}"
           style="color:${wxTone(p.rungs[0], { sky: p.sky })}"></i>
        <b>Weather</b>
      </div>
      ${temp}
      <div class="wxsteps">${cards}</div>
    </div>`;
}

/* Reads the preference and writes the control and the layer. syncHeat() writes the summary now,
   because it already reads both preferences. It never reads the control back. A browser
   restores a checkbox across a reload without firing `change`. So an invariant repaired inside a
   change handler is repaired on none of the paths the browser takes. This is the rule syncHeat()
   exists to state. */
export function syncWx() {
  /* The box is NOT written here any more. render() writes both layer boxes from `PREFS.mapLayer`,
     so the pair has one writer and cannot be drawn both-on. This module is deferred and may never
     load, which is a second reason the boxes cannot depend on it. */
  const on = PREFS.mapLayer === 'weather';
  on ? layer.addTo(map) : layer.remove();
}

/* One poll of the weather endpoint. render() calls this while the mode is on.
   A failed fetch keeps the last answer. A poll that missed is not a forecast of clear skies. */
export async function tick() {
  syncWx();
  if (PREFS.mapLayer !== 'weather') { paint(); return; }
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
     already use for the same job.

     A non-empty answer can still be old. See STALE_S above for why a stored row can age with
     nobody rewriting it. So the chip states the age instead of staying blank when that has
     happened. Stating old weather with confidence is worse than stating nothing. An offline gauge
     draws grey instead of a flat line, for the same reason. */
  const now = Date.now() / 1000;
  const newest = pts.reduce((m, p) => Math.max(m, p.stamp), 0);
  el('wxHint').textContent = pts.length === 0 ? 'no data yet'
    : now - newest > STALE_S ? `MET last issued ${ago(newest * 1000)}` : '';
  paint();
  if (side.key?.startsWith('@wx-')) {
    const p = pts.find(x => '@wx-' + x.id === side.key);
    if (p) openSide(side.key, card(p));
  }
}

// The pins are sized in screen pixels, so the set that survives thinning changes with the zoom.
map.on('zoomend', paint);
