// The MET weather layer: a map of nowcast points, and the panel one of them opens.
//
// Loaded on demand. A reader who never opens weather mode loads none of this and fetches none of
// its data. That is why the points ride ?wx=1 and not the payload every poll already carries.

import { FEED_WX, WX_THIN_PX, WEATHER, MET_NAME, NEAR_MAX_KM } from './config.js';
import { state, PREFS } from './state.js';
import { map, pinGlyph, openSide, side, focusOn, flashTo, ping } from './map.js';
import { wxIcon, wxTone, stamp, kindGlyph, wxItem, wxWhen, wxTemps, WX_NOW } from './popup.js';
import { askJson } from './ask.js';
import { el, distKm, titleCase } from './util.js';

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
        html: `<span class="pin" style="--c:${wxTone(r, { pin: true })}">${
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

/* One list item per half hour MET publishes.
   The word is written OUT rather than left on `data-tip` alone. The station card's weather section
   can leave it there, because a reader takes in its two glyphs at once. Nine glyphs in a stack
   would each need a tap to name, and `data-tip` opens one at a time.
   `w.line` reads "Heavy rain" where `w.word` reads "Heavy", and a full-width row has room for the
   longer one. Rung 0 has no `line`, so `word` answers there.

   M3's TWO-LINE list item, and `wxItem()` in `js/popup.js` builds it. The station card's weather
   section draws the same component, so the markup is stated once and neither surface can drift.
   The leading slot is the weather glyph in a tinted disc. The headline is the weather word. The
   supporting line is the clock, and `WX_NOW` replaces it on the step happening now.
   The word leads because this panel answers about weather. The clock says which half hour states
   it, which is what a supporting line is for.
   The trailing slot holds the day's two ends, on the one step that carries them. */
const stepCard = (rung, clock, now, temp = '') => {
  const w = WEATHER[rung] || WEATHER[0];
  return wxItem(wxIcon(rung, { clock }), wxTone(rung, { clock }), w.line || w.word,
    now ? WX_NOW : wxWhen(clock), temp, now);
};

/* `name` arrives ALREADY CASED, and the point's own name is cased in the default. `titleCase()`
   splits on a hyphen and capitalises each token, so a title holding markup came out with
   `class="I I-Near_me"` and `var(--Me)`. A CSS class is case-sensitive, so the glyph lost its mask
   and drew nothing. Only `hereCard()` passes a name, and that name is markup this app wrote. */
function card(p, name = titleCase(p.n), sub = MET_NAME) {
  /* The day's two ends, in the trailing slot of the step happening now. They had a card of their
     own above the stack, titled `Today`. That card carried one fact and took the height of a step,
     and a reader scanning the stack met it first. It is one day-scale number beside nine half-hour
     ones, so it rides the row a reader is already looking at instead.
     `wxTemps()` in `js/popup.js` builds it, because the station card's weather section draws the
     same pair in the same slot. */
  const temp = p.tmax == null ? '' : wxTemps(p.tmax, p.tmin);

  const cards = [
    /* The last two readings and no more. The card is a forecast, and the half hour behind it is
       there to say which way the weather is going. An hour of it pushed the steps that have not
       happened yet under the fold. */
    ...p.past.slice(-2).map(([ts, r]) => stepCard(r, hhmm(ts * 1000), false)),
    stepCard(p.rungs[0], hhmm(p.stamp * 1000), true, temp),
    ...p.rungs.slice(1).map((r, i) => stepCard(r, p.clocks[i + 1], false)),
  ].join('');

  /* `.pophead` first, always. openSide() splits it — the name goes up into the sheet's title and
     the rest leads the body — and that seam is what keeps
     the place name off the scrolling body.

     `dots(p)` comes first inside it too. css/map.css reserves the ⋮'s corner with a rule that only
     matches a title after it, `.dots ~ .popname`. popup.js's own goName() states the same rule and
     obeys it the same way.

     Both lines below are block `<div>`s, matching goName() and region() in popup.js. A padding-
     right on an inline box only clears its own last line. On a wrapped title, the ⋮ still overlaps
     every line above the last one. */
  return `<div class="pophead">
      ${dots(p)}
      <div class="popname">${name}</div>
      <div class="muted">${sub}</div>
    </div>
    <div class="sensor">
      ${/* **THE HEAD'S GLYPH IS FIXED, and it followed the rung for one revision.** A reader cut
            that on 2026-08-25. The head names the sensor, the same job the kind glyph does over a
            river or a siren. Those never move. Every item under it already states its own rung, so
            a head that moved with the first of them stated one step's weather twice and every
            other step's weather wrongly.
            `partly_cloudy_day` in `--k-weather`, which is the mark the Weather layer chip already
            draws. The rung ladder draws `sunny` for a clear sky, and that is a rung rather than a
            name for the whole layer. */''}
      <div class="sensorhead">
        ${kindGlyph('partly_cloudy_day', 'var(--k-weather)')}
        <b>Weather</b>
      </div>
      ${/* ONE SEGMENT PER HALF HOUR, the same `.sbody` shape every sensor on a station card draws.
            This panel and that card stand in one pane, one at a time, so a head over a segmented
            group in one and a head over loose content in the other is one component in two shapes.
            The steps were a `.wxsteps` grid of cards inside ONE segment. A segment is a block a
            reader takes in on its own, and every step here is one: a glyph, a word and a clock. So
            the group states that once rather than nesting a second set of cards inside it. */''}
      <ul class="sbody">${cards}</ul>
    </div>`;
}

/* The same card, over the reader's own fix rather than over a pin they pressed. Weather is a
   field, so the nearest point answers for the ground under them, and the card names which point
   that is and how far off it stands.
   `NEAR_MAX_KM` is the cap every "near this point" surface in this app already states. Past it the
   nearest point is a claim about somewhere else. This returns '' there, and locate.js falls back to
   the station card, which prints the one sentence that says so.
   The head is `#locate.on`'s own glyph, so the title and the button that opened it agree. That is
   the rule `herePopup()` states for the station-mode card. */
export function hereCard(at) {
  const p = pts.reduce((best, x) =>
    !best || distKm(at, x) < distKm(at, best) ? x : best, null);
  const km = p && distKm(at, p);
  if (!p || km > NEAR_MAX_KM) return '';
  return card(p, '<i class="i i-near_me" style="color:var(--me)"></i> Your Location',
    `${p.n} · ${km.toFixed(1)} km`);
}

/* Carry the open card across a layer switch, rather than close it. The two layers answer the same
   question about one place, so the reader who switches wants the other answer about that place.

   Going to weather, the point is the one the station card already named. `api.php` attaches a
   station to its nearest nowcast point and publishes the point's name as `met.at`. So a name match
   is the point the reader was already reading about, and not a second guess at it. Measured
   2026-08-20: all 675 stations carrying `met` name one of the 50 points `?wx=1` publishes.

   Going back, the nearest station of any kind. `flashTo()` is the one door to a station card in
   this app. It pins the target past every filter, so the card cannot open on a pin that is not
   there, and it pings the pin so the reader sees which station answered.

   `pts` has to be full before either direction can answer, which is why the weather side is called
   at the tail of `wxLayer`'s handler and not from a listener beside it. Returning false is the one
   case with no answer at all, and ui.js closes the card there. */
export function carry(key) {
  if (PREFS.mapLayer === 'weather') {
    const s = state.data.find(x => (x.site || x.id) === key && x.met?.at);
    const p = s && pts.find(q => q.n === s.met.at);
    if (!p) return false;
    /* The same three moves the point's own pin makes on a click, plus the ripple `flashTo()` draws
       on the way back. Without them the panel swapped its contents over a map that had not moved,
       and a reader who pressed a layer chip read that as nothing having happened. The ripple names
       the point, because the pin under it can be one the zoom thinned away. */
    openSide('@wx-' + p.id, card(p));
    focusOn([p.lat, p.lng], 12);
    ping([p.lat, p.lng], '', p.n);
    return true;
  }
  const p = pts.find(x => '@wx-' + x.id === key);
  const s = p && state.data.reduce((best, x) =>
    x.lat && (!best || distKm(p, x) < distKm(p, best)) ? x : best, null);
  if (!s) return false;
  flashTo(s);
  return true;
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

     **An age used to ride here too, and a reader cut it.** A stored row can go stale with nobody
     rewriting it, so the chip printed `MET last issued 15.9h ago` on one. The words are ours rather
     than the reader's, and a chip in a layer panel is not where somebody goes to ask how fresh a
     forecast is. The card states MET's own issue time on every point, which is the surface that
     question belongs on. Only the empty answer is left here, because no card can state that one. */
  el('wxHint').textContent = pts.length === 0 ? 'no data yet' : '';
  paint();
  if (side.key?.startsWith('@wx-')) {
    const p = pts.find(x => '@wx-' + x.id === side.key);
    if (p) openSide(side.key, card(p));
  } else if (side.key === '@here' && state.hereAt) {
    /* The location card is the second tenant that draws this forecast, so it refreshes on the same
       poll. A panel frozen on the issue it opened with, beside pins that moved, is the fault the
       offline-gauge rule already names. `openSide()` is idempotent and resets no scroll on an
       unchanged key, so a reader mid-card keeps their place. An empty answer leaves the card alone:
       the reader may have walked out of range, and a card that empties itself says less than the
       one already on screen. */
    const h = hereCard(state.hereAt);
    if (h) openSide('@here', h);
  }
}

// The pins are sized in screen pixels, so the set that survives thinning changes with the zoom.
map.on('zoomend', paint);
