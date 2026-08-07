// Rebuilds every marker and the heat layer from the current station set.

import { KINDS, MAST, HEAT_FLOOR, RAIN_STOPS } from './config.js';
import { state, PREFS, save } from './state.js';
import { el, color, dkey, atDanger, statusColor, leads, hasInfo, isIgnored, ignoredIds,
         favIds, isFav, scalePos, levelStops, gaugeStops } from './util.js';
import { marks, siteMark, shown, syncCluster, focusOn, side, openSide,
         showMast, hideMast, pinGlyph } from './map.js';
import { heat, rainHeat, syncHeat, thinHeat } from './heat.js';
import { sitePopup } from './popup.js';
import { dataTable } from './table.js';

state.rerender = () => render();

/* A filter that can legitimately match nothing must never silently empty the map — an empty map
   reads as "the app is broken", or worse during a flood, as "nothing is happening". So the chip
   turns itself off and says why: either nothing is climbing, or `rate` is null everywhere because
   the sample history hasn't reached an hour yet (a fresh install, or a wiped `.history.db`). */
function syncRisingChip() {
  const chip = el('risingOnly');
  const rising = state.data.filter(s => s.rising).length;
  const measurable = state.data.some(s => s.rate != null);

  chip.disabled = !rising;
  if (!rising) chip.checked = false;
  el('risingHint').textContent = rising ? `· ${rising}`
    : measurable ? '· none climbing' : '· needs an hour of history';
  return chip.checked;
}

/* A filter that empties the map and cannot be reasoned about reads as a bug, so the chip is dead
   while nothing is starred and says why. It also un-checks itself in that state, or a reader who
   cleared their favorites would come back to a blank map and a control they could not press.
   The un-check has to be saved, not just displayed. `el('favOnly').checked = !!PREFS.favOnly` in
   ui.js reads the stored preference on every load, so an un-check this function performs on the
   reader's behalf and never writes to PREFS is one the next reload silently reverses: clear every
   favorite, the chip goes off on screen but PREFS.favOnly stays true, then reload and the filter
   comes back on with no favorite behind it, hiding most of the map for no reason the reader chose. */
function syncFavChip() {
  const chip = el('favOnly');
  const n = state.data.filter(isFav).length;
  chip.disabled = !n;
  el('favHint').textContent = n ? '' : 'none starred';
  if (!n) {
    chip.checked = false;
    // Only on the way into the empty state. This branch runs on every poll for every reader who
    // has starred nothing — which is every new visitor — so writing here unguarded put a
    // localStorage write on the poll loop forever, for a preference that had not moved.
    if (PREFS.favOnly) { PREFS.favOnly = false; save(); }
  }
  return chip.checked;
}


export function render() {
  const hidden = new Set(PREFS.hidden || []);
  const risingOnly = syncRisingChip();
  const favOnly = syncFavChip();
  Object.keys(marks).forEach(k => marks[k] = []);
  siteMark.clear();
  // Every marker below is about to be replaced, and one torn down mid-hover never fires its
  // mouseout — so the ring it was showing would be left on the map with nothing under it.
  hideMast();
  const points = [];
  const rainPoints = [];
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
      if (risingOnly && !s.rising) continue;
      if (favOnly && !isFav(s)) continue;
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

    // Rainfall drives its own layer, on its own scale — see heat.js for why the two aren't summed.
    // The floor here is simply "is it raining": a class the reader is told about starts above 0 mm,
    // and a dry gauge painting the palest violet would make the whole state look wet.
    if (s.kind === 'rainfall' && hasInfo(s) && s.hourly > 0)
      rainPoints.push([s.lat, s.lng, scalePos(s.hourly, RAIN_STOPS) / 100]);

    if (!pinned && !shown(s.kind)) continue;
    const key = s.site || s.id;
    sites.has(key) ? sites.get(key).push(s) : sites.set(key, [s]);
  }
  state.perKind = perKind;

  for (const [key, members] of sites) {
    members.sort(leads);
    const lead = members[0];
    const rising = members.some(m => m.rising);
    const critical = members.some(atDanger);
    // A mast of several sensors gets the mast glyph whatever leads it, but only wears the mast
    // colour while nothing on it is signalling and the lead is actually reporting — a status colour
    // outranks it, and a mast with no reading must stay grey rather than look confident.
    const multi = members.length > 1;
    const quiet = multi && hasInfo(lead) && members.every(m => !(m.status > 0));
    /* A heart on the pin when **any** sensor here is a favorite — not when all of them are, which is
       the mast header button's rule. The two answer different questions. The button is a control and
       acts on every sensor at the mast, so it has to state exactly what one press will undo. This is
       an indication, and it says "something of yours is here". A mast where the reader favorited
       only the river must still be findable at a glance. */
    const fav = members.some(isFav);
    /* Danger outranks everything, and it is stated here rather than left to `leads()` picking the
       worst sensor and `color()` happening to return red for it. Anything at the top of its own
       scale — a river over its mark, a sounding siren, a flood gauge under water, rainfall in the
       top class — paints the whole place red, whichever of them is speaking for it. A pin the eye
       has to decode is a pin nobody reads in the ten seconds that matter. */
    const c = critical ? statusColor(3) : quiet ? MAST.color : color(lead);
    const marker = L.marker([lead.lat, lead.lng], {
      kind: lead.kind, critical, fav,                     // read back by the cluster badge and the split
      zIndexOffset: critical ? 1000 : rising ? 500 : 0,   // keep the urgent pins on top
      icon: L.divIcon({
        // Matches `.pin`'s box in map.css — Leaflet positions the marker off this, not off the CSS.
        className: '', iconSize: [39, 39], iconAnchor: [19.5, 19.5],
        /* Every pin is the glyph alone. A mast was a filled disc carrying a sensor count, and it
           is the same bare glyph as the rest now — the `layers` mark is what says "a stack stands
           here", and the count went with the plate it sat on. `.multi` still rides on the span,
           because the hover ring and the panel key both ask whether this pin is a mast. */
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
    /* Show the grouping radius while the mast is pointed at — and while its card is open, which is
       the touch equivalent, since a finger has no hover. mouseout defers to the panel for the same
       reason: moving the mouse off a pin you have just opened should not pull the ring out from
       under the list it explains. (openSide draws it; this is only the hover case.) */
    if (multi) {
      marker.on('mouseover', () => showMast([lead.lat, lead.lng]));
      marker.on('mouseout', () => { if (side.key !== key) hideMast(); });
    }
    marks[lead.kind].push(marker);
    siteMark.set(key, marker);
  }

  /* The open card, refreshed in place. A popup died with the marker it hung off, so every poll and
     every zoom closed whatever you were reading; the panel is a page element, so the only thing it
     needs from a rebuild is fresh numbers.
     If the place has left `sites` — a filter hid it, or the feeds dropped it — the card is left
     exactly as it was rather than closed. Nothing here may vanish on its own while it is being
     read, and a card that stops updating is not lying: every reading in it is stamped, and
     the sensor's info menu says how old it is. Closing is the reader's to do.
     Keys beginning `@` belong to the panel's non-station users (locate.js's "you are here"), which
     own their own contents and are not in `sites`. */
  const open = side.key && side.key[0] !== '@' && sites.get(side.key);
  if (open) openSide(side.key, sitePopup(open), open.length > 1 ? [open[0].lat, open[0].lng] : null);

  syncCluster();
  // Thinned, not raw: overlapping blobs composite, and these are intensities rather than counts.
  heat.setLatLngs(thinHeat(points));
  rainHeat.setLatLngs(thinHeat(rainPoints));
  syncHeat();   // layers + legend follow the chips; see heat.js
  counts();
  districts();
  ignoredPanel();
  favPanel();
  // Every poll rebuilds the map; the table has to follow or it sits on readings the map has already
  // replaced. Only while it is open — no point rendering 435 rows into a closed dialog.
  if (el('dataBox').open) dataTable();
}

/* The district filter: every district the feeds returned, grouped under its state, each with the
   number of stations it holds. Multi-select rather than a <select> because the useful actions are
   "hide these three" and "only this one", and a dropdown makes both a series of round trips.
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
   Always drawn, never hidden when empty — an ignored sensor is a muted alarm, and a muted alarm you
   cannot find is the failure ISA-18.2 spends a chapter on. This list plus the count on the line
   below the layer chips are the only two places on the page that say a sensor has been silenced, so
   neither of them gets to disappear. Row order is the order they were ignored in: it is a short
   list, and "the one I just switched off" is at the bottom where you left it.
   That promise means walking `ids` — a `Set` built by insertion order — rather than filtering
   `state.data`, the shape this had before: `state.data` is the merged payload's own order, which is
   arbitrary from a reader's chair and silently broke the promise above. `.filter(Boolean)` is
   load-bearing, not defensive filler: the feeds drop and restore stations between polls, and
   `PREFS` deliberately keeps an id through a poll where it is missing, so `find()` returning
   `undefined` here is routine, not a bug. */
export function ignoredPanel() {
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
   sensor: this panel manages the saved list, and a list that hid five of a mast's six entries could
   not be used to remove one of them. Row order is the order they were starred in — a short list, and
   "the one I just added" is at the bottom where it was left.
   Same reasoning as `ignoredPanel()` above: walk `ids` (insertion order), not `state.data` (merged
   payload order, arbitrary from a reader's chair). `.filter(Boolean)` drops any id the current
   payload does not carry — a normal state, not an error, since a station can be missing from one
   poll and back on the next. */
export function favPanel() {
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
    || '<li class="none">Nothing starred yet. Use the star on a mast, or the Details button on any '
     + 'sensor in a station’s card.</li>';
  el('favClear').disabled = !rows.length;
}

// What the filters actually left on the map. Counted per *station*, not per marker: several sensors
// now share one pin, and a chip reading "1" for a mast holding three sirens would be wrong about the
// thing the chip controls. state.perKind is the filtered tally, minus the layer switches themselves,
// so each chip's number is "what this layer would add".
export function counts() {
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
  el('shown').textContent = `${total} of ${state.data.length} stations on the map` +
    (pins && pins < total ? ` · ${pins} pins` : '') +
    (el('favOnly').checked ? ' · favorites only' : '') +
    (nIgn ? ` · ${nIgn} ignored` : '');
}
