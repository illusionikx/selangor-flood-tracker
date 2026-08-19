// Rebuilds every marker and the heat layer from the current station set.

import { KINDS, MAST, HEAT_FLOOR, HEAT_KM, RAIN_KM, RAIN_STOPS } from './config.js';
import { state, PREFS, save } from './state.js';
import { el, color, dkey, atDanger, statusColor, leads, hasInfo, isIgnored, ignoredIds,
         favIds, isFav, scalePos, levelStops, gaugeStops } from './util.js';
import { marks, siteMark, shown, syncCluster, focusOn, side, openSide,
         showMast, hideMast, pinGlyph } from './map.js';
import { heat, rainHeat, syncHeat, thinHeat } from './heat.js';
import { sitePopup } from './popup.js';

state.rerender = () => render();
/* True once weather mode has run at least once this session. render() reads it below. It decides
   whether wx.js still needs a tick(), even after the weather layer has gone. It never resets. So a
   reader who leaves weather mode still gets the one extra tick that tears the layer down. */
let wxSeen = false;

/* The two pin filters are ONE choice, stored as one preference: `'fav'`, `'alert'` or `''` for
   neither. Each answers "show me only these", and two of those at once answers neither question.
   **A pair of booleans is what this must not go back to.** That shape can hold a state the panel
   cannot draw — both on — and this repo has the scar: the two heatmaps were a pair, two repairs
   inside the change handler both failed, and the fix was one string with one function writing both
   boxes from it. This is that shape at a second site. See `syncHeat()` in heat.js.
   **A filter that can legitimately match nothing must never silently empty the map.** An empty map
   reads as "the app is broken", and during a flood it reads worse, as "nothing is happening". So a
   chip with nothing behind it is dead and says why, and a preference with nothing behind it is
   cleared rather than displayed.
   That clear has to be SAVED, not just drawn. This function writes the boxes from the preference on
   every render, so a clear that only touched a box would be undone by the next render, and a clear
   that only touched the screen would come back on the next reload. */
function syncPins() {
  const rising = state.data.filter(s => s.rising).length;
  const starred = state.data.filter(isFav).length;

  // Only on the way into the empty state. This runs on every poll for every reader who has starred
  // nothing — which is every new visitor — so an unguarded write puts a localStorage write on the
  // poll loop forever, for a preference that has not moved.
  if ((PREFS.pinFilter === 'alert' && !rising) || (PREFS.pinFilter === 'fav' && !starred)) {
    PREFS.pinFilter = '';
    save();
  }
  el('risingOnly').checked = PREFS.pinFilter === 'alert';
  el('favOnly').checked = PREFS.pinFilter === 'fav';
  el('risingOnly').disabled = !rising;
  el('favOnly').disabled = !starred;
  /* The count alone, and nothing where there is none to state. The empty case used to carry a
     sentence, and the chip beside it is already dead and dimmed by `disabled`. One fact does not get
     two looks, and `#shown` under the map carries the standing indication either way. */
  el('risingHint').textContent = rising ? `· ${rising}` : '';
  el('favHint').textContent = starred ? `· ${starred}` : '';
  return PREFS.pinFilter;
}


export function render() {
  const hidden = new Set(PREFS.hidden || []);
  /* Written from the preference on every render and never read back off the box. That is the rule
     the two chips below and syncHeat() all obey. A browser restores a checkbox across a reload
     without firing `change`, so the control cannot be the source of truth. */
  /* Both layer boxes, written from the one preference that holds the choice. syncWx() no longer
     touches the weather box, so there is one writer for the pair.
     They are radios, so the browser already refuses both-on and refuses neither. This still writes
     both, because a radio restored across a reload is form state this app does not own, and because
     the rollback in the weather handler moves the preference without touching a box. */
  el('stations').checked = PREFS.mapLayer === 'stations';
  el('wxLayer').checked = PREFS.mapLayer === 'weather';
  const pinFilter = syncPins();
  Object.keys(marks).forEach(k => marks[k] = []);
  siteMark.clear();
  // Every marker below is about to be replaced, and one torn down mid-hover never fires its
  // mouseout — so the ring it was showing would be left on the map with nothing under it.
  hideMast();
  const points = [];
  const rainPoints = [];
  const dryPoints = [];   // rain gauges reporting zero — they erase, see heat.js
  const perKind = Object.fromEntries(Object.keys(marks).map(k => [k, 0]));

  // Filter first, group second. A site is drawn from the sensors still showing on it, so switching
  // rainfall off on a mast that also carries a river gauge leaves the river pin exactly where it
  // was — rather than taking the whole place off the map because the mast's lead sensor was hidden.
  const sites = new Map();
  for (const s of state.data) {
    if (!s.lat || !s.lng) continue;
    const pinned = s.id === state.pinned;   // a jumped-to station outranks every filter
    if (!pinned) {
      // Same escape hatch as a hidden district: a jump still shows the pin, so a station reached
      // from the table or the go-to box is never a flight to an empty patch of map.
      if (isIgnored(s)) continue;
      if (hidden.has(dkey(s))) continue;
      if (pinFilter === 'alert' && !s.rising) continue;
      if (pinFilter === 'fav' && !isFav(s)) continue;
    }

    // Counted before the layer check: the chip's number is "what this layer would add".
    perKind[s.kind]++;

    // Heat is its own layer with its own toggle, so a hidden river chip must not dim the heatmap.
    //
    // The weight IS the position on the station's own threshold scale — the same piecewise 38 / 68 /
    // 100 slots the popup meter draws, so the gradient's stops are the thresholds themselves: yellow
    // once past alert, orange past warning, red at danger. A blob's colour is now a fact you can name
    // ("that catchment is past its warning marks") instead of a temperature you have to interpret.
    // Whichever sensor at a place scores higher is the one that gets to speak, so a dry-looking river
    // next to a gauge already under water can't keep the area cold. hasInfo() gates it because an
    // offline gauge is frozen on whatever it read the day it died — often a flood.
    //
    // A tripped gauge goes straight to full red regardless of depth. Its warning mark is 15 cm: a
    // gauge that has crossed it is reporting water standing over a spot known to flood, which is an
    // observation, not a forecast, and it outranks anything a scale could say about the centimetres.
    const near = !hasInfo(s) ? 0
      : s.kind === 'river' ? (levelStops(s) ? scalePos(s.level, levelStops(s)) / 100 : 0)
      : s.kind === 'gauge' && s.depth > 0
        ? (s.status >= 1 ? 1 : scalePos(s.depth, gaugeStops(s)) / 100)
      : 0;
    // Below the alert slot nothing paints at all: there is nothing to act on down there, and a map
    // warm from end to end is a map nobody reads.
    if (near >= HEAT_FLOOR) points.push([s.lat, s.lng, near]);

    /* Rainfall drives its own layer, on its own scale — see heat.js for why the two aren't summed.
       A wet gauge paints. A gauge reporting no rain does not paint the palest violet. That makes
       the whole state look wet. It erases instead, and heat.js says how.
       `hasInfo()` gates the dry side as hard as the wet side, and for a stronger reason. A station
       that is offline, or that sent no number, does not say it is dry. Only a live zero denies rain.
       Both sides also sit under the same filters above. So a district switched off takes its wet
       gauges and its dry ones out together. It cannot leave one half of the argument standing.
       `backed === false` leaves out both sides for the same reason, one step further back. The
       station's own total denies the reading, so it cannot paint. It must not erase either. A
       reading nobody can stand behind is no evidence that the ground under it is dry.
       See `rainBacked()` in api.php and `raining()` in util.js. */
    if (s.kind === 'rainfall' && hasInfo(s) && s.backed !== false)
      s.hourly > 0 ? rainPoints.push([s.lat, s.lng, scalePos(s.hourly, RAIN_STOPS) / 100])
                   : dryPoints.push([s.lat, s.lng]);

    if (!pinned && !shown(s.kind)) continue;
    const key = s.site || s.id;
    sites.has(key) ? sites.get(key).push(s) : sites.set(key, [s]);
  }
  state.perKind = perKind;

  /* Two ways the station pins come off the map, and the counts above still run for both. They
     describe the station set rather than the pins, and #shown reports that set in words.
     Weather mode takes the map: no station pin and no heat. `Stations` is the reader switching the
     pins off on their own, with the wash left alone. `!== false`, so an unset preference counts as
     on. That is the test `PREFS.drawer` uses, and it is why a first visit lands on a map with pins
     rather than an empty one. */
  if (PREFS.mapLayer === 'stations') for (const [key, members] of sites) {
    members.sort(leads);
    const lead = members[0];
    const rising = members.some(m => m.rising);
    const critical = members.some(atDanger);
    // A mast of several sensors gets the mast glyph whatever leads it, but only wears the mast
    // colour while nothing on it is signalling and the lead is actually reporting — a status colour
    // outranks it, and a mast with no reading must stay grey rather than look confident.
    const multi = members.length > 1;
    const quiet = multi && hasInfo(lead) && members.every(m => !(m.status > 0));
    /* A heart on the pin when **any** sensor here is a favorite. It is not when all of them are,
    which is the mast header button's rule. The two answer different questions. The button is a
    control and acts on every sensor at the mast. So it has to state exactly what one press will
    undo. This is
       an indication, and it says "something of yours is here". A mast where the reader favorited
       only the river must still be findable at a glance. */
    const fav = members.some(isFav);
    /* Danger outranks everything, and it is stated here. It is not left to `leads()` electing the
    worst sensor and `color()` returning red for it. Anything at the top of its own scale paints the
    whole place red, whichever of them speaks for it. That covers a river over its mark and a
    sounding siren. It covers a flood gauge under water, and rainfall in the top class. A pin the eye
       has to decode is a pin nobody reads in the ten seconds that matter. */
    const c = critical ? statusColor(3) : quiet ? MAST.color : color(lead);
    const marker = L.marker([lead.lat, lead.lng], {
      kind: lead.kind, critical, fav,                     // read back by the cluster badge and the split
      zIndexOffset: critical ? 1000 : rising ? 500 : 0,   // keep the urgent pins on top
      icon: L.divIcon({
        // Matches `.pin`'s box in map.css — Leaflet positions the marker off this, not off the CSS.
        className: '', iconSize: [39, 39], iconAnchor: [19.5, 19.5],
        /* Every pin is the glyph alone. A mast was a filled disc carrying a sensor count. It is the
        same bare glyph as the rest now. The `layers` mark is what says "a stack stands here", and
        the count went with the plate it sat on. `.multi` still rides on the span. The hover ring
        and the panel key both ask whether this pin is a mast. */
        html: `<span class="pin${multi ? ' multi' : ''}${lead.online ? '' : ' off'}${
                     rising ? ' rise' : ''}${critical ? ' danger' : ''}" style="--c:${c}">${
               pinGlyph(multi ? MAST.icon : KINDS[lead.kind].icon)}${
               fav ? `<b class="fv">${pinGlyph('favorite')}</b>` : ''}</span>`,
      }),
    });
    // Fill the panel, then centre the pin in what is left of the map. Panel first: focusOn() reads
    // the panel's width to work out where "centre" is once it is open.
    marker.on('click', () => {
      openSide(key, sitePopup(members), multi ? [lead.lat, lead.lng] : null);
      focusOn([lead.lat, lead.lng], 13);
    });
    /* Show the grouping radius while the mast is pointed at. Show it while its card is open too.
    That is the touch equivalent, since a finger has no hover. The mouseout handler defers to the
    panel for the same reason. Moving the mouse off a pin you just opened must not pull the ring
    away. That ring explains the list under it. The openSide function draws it, and this is only the hover
    case. */
    if (multi) {
      marker.on('mouseover', () => showMast([lead.lat, lead.lng]));
      marker.on('mouseout', () => { if (side.key !== key) hideMast(); });
    }
    marks[lead.kind].push(marker);
    siteMark.set(key, marker);
  }

  /* The open card, refreshed in place. A popup died with the marker it hung off. So every poll and
  every zoom closed whatever you had open. The panel is a page element, so the only thing it needs
  from a rebuild is fresh numbers.
     If the place left `sites`, the card is left exactly as it was rather than closed. A filter hid
     it, or the feeds dropped it. Nothing here can vanish on its own while a reader has it open. A
     card that stops updating is not lying. Every reading in it is stamped, and the sensor's info
     menu says how old it is. Closing is the reader's to do.
     Keys beginning `@` belong to the panel's non-station users, such as locate.js's "you are here".
     They own their own contents and are not in `sites`. */
  const open = side.key && side.key[0] !== '@' && sites.get(side.key);
  if (open) openSide(side.key, sitePopup(open), open.length > 1 ? [open[0].lat, open[0].lng] : null);

  syncCluster();
  // Thinned, not raw: overlapping blobs composite, and these are intensities rather than counts.
  // Each at the distance its own layer paints, or the thinning and the paint disagree.
  heat.setLatLngs(thinHeat(points, HEAT_KM));
  // Both setters ask for a redraw and leaflet.heat coalesces the pair into one frame, so the order
  // is for a reader rather than for the canvas: the evidence against goes in beside the evidence
  // for, and neither call is the one that draws.
  rainHeat.setDry(dryPoints);
  rainHeat.setLatLngs(thinHeat(rainPoints, RAIN_KM));
  /* Weather mode must tear itself down when a reader leaves it, not just paint while inside it. The
     flashTo() helper moves `PREFS.mapLayer` back to `'stations'`. It calls state.rerender() on every
     jump to a station. The old check here read the preference alone, and that had already moved by
     the time this line ran. So tick() never fired, and the layer was left on screen.

     wxSeen fixes that. It stays true once weather mode has run once this session. So render() still
     calls tick() on the render right after the preference moves. The tick() call already handles
     that case. The syncWx() helper removes the layer whenever the preference is not `'weather'`.
     render() writes the box, above.

     `.then(m => m.tick()).catch(...)`, not a second argument to `.then()`. A second argument only
     catches the import failing. tick() is async, so its own rejection is a separate promise. A
     second `.then()` argument never sees that rejection. This is the same gap the withTimeline
     gotcha in CLAUDE.md records, at a new call site.

     A failed import must not leave a blank map under a checked box. The render() pass draws no
     station pin while the preference reads `'weather'`. So a wx.js that never loads draws nothing at
     all. The catch rolls back the same way js/ui.js's own toggle handler does. It puts the
     preference back to `'stations'` and saves it. It writes the reason into #wxHint. Then it renders
     once more, so the station pins return.

     The rollback checks the preference still reads `'weather'` before it runs. wxSeen never resets.
     So every later render calls import('./wx.js') again. A rejected dynamic import stays rejected in
     the module cache. So it keeps rejecting on every later render too.

     Without the guard, each later render rolls the preference back again and calls render() again.
     That repeats forever. The guard lets the rollback run once and then stop. */
  if (PREFS.mapLayer === 'weather') wxSeen = true;
  if (wxSeen) import('./wx.js').then(m => m.tick()).catch(() => {
    if (PREFS.mapLayer !== 'weather') return;
    PREFS.mapLayer = 'stations';
    save();
    el('wxHint').textContent = 'could not load';
    render();
  });
  syncHeat();   // layers + legend follow the chips; see heat.js
  counts();
  districts();
  ignoredPanel();
  favPanel();
  // Every poll rebuilds the map; the table has to follow or it sits on readings the map has already
  // replaced. Only while it is open — no point rendering 435 rows into a closed dialog.
  /* `.then()`, not `await`. A dialog can only be open because its opener already imported the
  module. So these resolve from the module map with no request. Making render() async would move
     everything after it into a later task on every poll.
     A rejection handler on both. This runs on every poll and has no surface to report a failure on.
     A bare `import().then()` here raises an unhandled rejection every poll, for as long as the
     reader leaves a failed dialog open. */
  if (el('dataBox').open) import('./table.js').then(m => m.dataTable(), () => {});
  // The wall is painted, never rebuilt. See paint() in js/wall.js for what a rebuild costs.
  if (el('camBox').open) import('./wall.js').then(m => m.paint(), () => {});
}

/* The district filter: every district the feeds returned, grouped under its state, each with the
   number of stations it holds. Multi-select rather than a <select>, because the useful actions are
   "hide these three" and "only this one". A dropdown makes both a series of round trips.
   Rebuilt from state.data on every render — 24 rows is not worth diffing. */
export function districts() {
  const q = el('districtFind').value.trim().toLowerCase();
  const hidden = new Set(PREFS.hidden || []);

  const tally = new Map();
  for (const s of state.data) {
    const row = tally.get(dkey(s))
      || { state: s.state || '—', district: s.district || 'Unknown', n: 0 };
    row.n++;
    tally.set(dkey(s), row);
  }

  let last = null;
  el('districtList').innerHTML = [...tally]
    .filter(([, r]) => !q || `${r.state} ${r.district}`.toLowerCase().includes(q))
    .sort(([, a], [, b]) => a.state.localeCompare(b.state) || a.district.localeCompare(b.district))
    .map(([k, r]) => {
      const head = r.state !== last ? `<li class="head">${r.state}</li>` : '';
      last = r.state;
      return `${head}<li>
        <label><input type="checkbox" data-d="${k}"${hidden.has(k) ? '' : ' checked'}
          ><span>${r.district}</span><b>${r.n}</b></label>
        <button class="solo" data-solo="${k}" title="Show only ${r.district}"
                aria-label="Show only ${r.district}">only</button>
      </li>`;
    }).join('') || '<li class="none">No district matches that</li>';

  // On the summary, so a collapsed section still says it is holding something back.
  el('districtN').textContent = hidden.size ? `${hidden.size} hidden` : '';
  // Disabled rather than hidden: a button that comes and goes moves the rows under the pointer.
  el('districtAll').disabled = !hidden.size;
  el('districtNone').disabled = hidden.size >= tally.size;
}

/* The sensors switched off from a station card's Details button, listed so they can be switched back on.
   Always drawn, never hidden when empty. An ignored sensor is a muted alarm. A muted alarm you
   cannot find is the failure ISA-18.2 spends a chapter on. This list and the count below the layer
   chips are the only two places that name a silenced sensor. So neither of them gets to
   disappear. Row order is the order they were ignored in. It is a short list, and "the one I just
   switched off" is at the bottom where you left it.
   That promise means walking `ids` — a `Set` built by insertion order — rather than filtering
   `state.data`, the shape this had before: `state.data` is the merged payload's own order, which is
   arbitrary from a reader's chair and silently broke the promise above. `.filter(Boolean)` is
   load-bearing, not defensive filler. The feeds drop and restore stations between polls. `PREFS`
   deliberately keeps an id through a poll where it is missing. So `find()` returning `undefined`
   here is routine, not a bug. */
function ignoredPanel() {
  const ids = ignoredIds();
  const rows = [...ids].map(id => state.data.find(s => s.id === id)).filter(Boolean);

  el('ignoredN').textContent = rows.length || '';
  el('ignoredList').innerHTML = rows.map(s => `<li>
      <i class="glyph i i-${KINDS[s.kind].icon}" style="color:${KINDS[s.kind].color}"></i>
      <span class="nm">${s.name}<br><span class="muted">${
        [s.district, s.state].filter(Boolean).join(', ') || 'district n/a'}</span></span>
      <button class="solo" data-unignore="${s.id}" title="Stop ignoring ${s.name}"
              aria-label="Stop ignoring ${s.name}">restore</button>
    </li>`).join('')
    || '<li class="none">Nothing ignored. Use the Details button on any sensor in a station’s '
     + 'card.</li>';
  el('ignoredClear').disabled = !rows.length;
}

/* The sensors starred from a station card, listed so they can be found and unstarred. One row per
sensor. This panel manages the saved list. A list that hid five of a mast's six entries cannot be
used to remove one of them. Row order is the order they were starred in. It is a short list, and
"the one I just added" is at the bottom where it was left.
   Same reasoning as `ignoredPanel()` above: walk `ids` (insertion order), not `state.data` (merged
   payload order, arbitrary from a reader's chair). `.filter(Boolean)` drops any id the current
   payload does not carry. That is a normal state, not an error. A station can be missing from one
   poll and back on the next. */
function favPanel() {
  const ids = favIds();
  const rows = [...ids].map(id => state.data.find(s => s.id === id)).filter(Boolean);

  el('favN').textContent = rows.length || '';
  el('favList').innerHTML = rows.map(s => `<li>
      <i class="glyph i i-${KINDS[s.kind].icon}" style="color:${KINDS[s.kind].color}"></i>
      <span class="nm">${s.name}<br><span class="muted">${
        [s.district, s.state].filter(Boolean).join(', ')} · ${
        KINDS[s.kind].one || KINDS[s.kind].label}</span></span>
      <button class="solo" data-unfav="${s.id}"
              aria-label="Remove ${s.name} from favorites">remove</button>
    </li>`).join('')
    /* One control, named once. There is no star on a card any more. The favorite is a row in the
    Details menu. It sits in the card's own corner and on every sensor listed under it. A message naming
       a control the reader cannot find is worse than no message. */
    || '<li class="none">Nothing starred yet. Use the Details button on a station, or on any sensor '
     + 'in its card.</li>';
  el('favClear').disabled = !rows.length;
}

// What the filters actually left on the map. Counted per *station*, not per marker: several sensors
// now share one pin, and a chip reading "1" for a mast holding three sirens would be wrong about the
// thing the chip controls. state.perKind is the filtered tally, minus the layer switches themselves,
// so each chip's number is "what this layer would add".
function counts() {
  const perKind = state.perKind || {};
  let total = 0;
  for (const k of Object.keys(marks)) {
    document.querySelector(`#layers [data-n="${k}"]`).textContent = perKind[k] ?? 0;
    if (shown(k)) total += perKind[k] ?? 0;
  }
  // On the section's summary, the same as the district filter's: collapsed, it still says what it
  // is holding back.
  const off = Object.keys(marks).filter(k => !shown(k)).length;
  el('kindN').textContent = off ? `${off} hidden` : '';
  const pins = Object.values(marks).reduce((n, l) => n + l.length, 0);
  // The ignored count rides here rather than only in its own panel: this line is the one the eye
  // lands on to ask "why is the map this empty", and a sensor you silenced last week is exactly the
  // answer it should give.
  const ign = ignoredIds();
  const nIgn = state.data.filter(s => ign.has(s.id)).length;
  /* Weather hides every station, so the tally would read "0 of 729" and explain nothing. This line
     is the one the eye lands on to ask why the map is empty, so it answers instead.
     There is no third branch any more. `PREFS.mapLayer` holds one of two values, so a map with no
     layer at all is unreachable and the line that named it had nothing left to say. */
  el('shown').textContent = PREFS.mapLayer === 'weather'
    ? 'Weather map · flood stations hidden'
    : `${total} of ${state.data.length} stations on the map` +
      (pins && pins < total ? ` · ${pins} pins` : '') +
      (PREFS.pinFilter === 'fav' ? ' · favorites only' : '') +
      (nIgn ? ` · ${nIgn} ignored` : '');
}
