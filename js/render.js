// Rebuilds every marker and the heat layer from the current station set.

import { KINDS, MAST, HEAT_FLOOR, RAIN_STOPS } from './config.js';
import { state, PREFS } from './state.js';
import { el, color, ink, popWidth, popPan, dkey, isCritical, leads, hasInfo, isIgnored, ignoredIds,
         scalePos, levelStops, gaugeStops } from './util.js';
import { map, marks, siteMark, shown, syncCluster, focusOn, openStable,
         showMast, hideMast } from './map.js';
import { heat, rainHeat, heatScale, heatOpacity } from './heat.js';
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


export function render() {
  const hidden = new Set(PREFS.hidden || []);
  const risingOnly = syncRisingChip();
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
    const critical = members.some(isCritical);
    // A mast of several sensors gets the mast glyph whatever leads it, but only wears the mast
    // colour while nothing on it is signalling and the lead is actually reporting — a status colour
    // outranks it, and a mast with no reading must stay grey rather than look confident.
    const multi = members.length > 1;
    const quiet = multi && hasInfo(lead) && members.every(m => !(m.status > 0));
    const c = quiet ? MAST.color : color(lead);
    const marker = L.marker([lead.lat, lead.lng], {
      kind: lead.kind, critical,                          // read back by the cluster badge
      zIndexOffset: critical ? 1000 : rising ? 500 : 0,   // keep the urgent pins on top
      icon: L.divIcon({
        className: '', iconSize: [26, 26], iconAnchor: [13, 13],
        html: `<span class="pin${lead.online ? '' : ' off'}${rising ? ' rise' : ''}${
                     critical ? ' danger' : ''}" style="--c:${c};--ink:${ink(c)}"><i class="i i-${
               multi ? MAST.icon : KINDS[lead.kind].icon}"></i>${
               multi ? `<b class="n">${members.length}</b>` : ''}</span>`,
      }),
    });
    // Widest member wins: a site holding a camera needs the room whatever leads it.
    const wide = Math.max(...members.map(m => popWidth(m.kind)));
    marker.bindPopup(sitePopup(members), {
      minWidth: wide, maxWidth: wide,
      // Tall popups open above the pin, so leave room up top; bottom clears the zoom/credit strip.
      // On phones the padding widens to the alert-panel / legend band — see popPan().
      ...popPan(),
    });
    // Centre whatever was clicked; autoPan then nudges for the popup's height. The zoom re-runs
    // clustering, which tears the popup down again — so re-open it once the map has settled.
    marker.on('click', () => {
      focusOn([lead.lat, lead.lng], 13);
      openStable(marker);
    });
    /* Show the grouping radius while the mast is pointed at — and while its popup is open, which is
       the touch equivalent, since a finger has no hover. mouseout defers to the popup for the same
       reason: moving the mouse off a pin you have just opened should not pull the ring out from
       under the list it explains. */
    if (multi) {
      marker.on('mouseover popupopen', () => showMast([lead.lat, lead.lng]));
      marker.on('mouseout', () => { if (!marker.isPopupOpen()) hideMast(); });
      marker.on('popupclose', hideMast);
    }
    marks[lead.kind].push(marker);
    siteMark.set(key, marker);
  }

  syncCluster();
  heat.setLatLngs(points);
  rainHeat.setLatLngs(rainPoints);
  // ui.js keeps these two mutually exclusive, so the legend shows one scale or none — never a stack
  // of two ramps to read against each other. The opacity slider lives below both and serves either.
  const wet = el('heat').checked, rainy = el('rainHeat').checked;
  wet   ? heat.addTo(map)     : heat.remove();
  rainy ? rainHeat.addTo(map) : rainHeat.remove();
  el('lgWater').style.display = wet ? '' : 'none';
  el('lgRain').style.display = rainy ? '' : 'none';
  el('legend').style.display = wet || rainy ? '' : 'none';
  heatScale();   // sizes whichever is on, and re-applies opacity
  heatOpacity();
  counts();
  districts();
  ignoredPanel();
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

/* The sensors switched off from a popup's ⋮, listed so they can be switched back on.
   Always drawn, never hidden when empty — an ignored sensor is a muted alarm, and a muted alarm you
   cannot find is the failure ISA-18.2 spends a chapter on. This list plus the count on the line
   below the layer chips are the only two places on the page that say a sensor has been silenced, so
   neither of them gets to disappear. Row order is the order they were ignored in: it is a short
   list, and "the one I just switched off" is at the bottom where you left it. */
export function ignoredPanel() {
  const ids = ignoredIds();
  const rows = state.data.filter(s => ids.has(s.id));

  el('ignoredN').textContent = rows.length || '';
  el('ignoredList').innerHTML = rows.map(s => `<li>
      <i class="glyph i i-${KINDS[s.kind].icon}" style="color:${KINDS[s.kind].color}"></i>
      <span class="nm">${s.name}<br><span class="muted">${
        [s.district, s.state].filter(Boolean).join(', ') || 'district n/a'}</span></span>
      <button class="solo" data-unignore="${s.id}" title="Stop ignoring ${s.name}"
              aria-label="Stop ignoring ${s.name}">restore</button>
    </li>`).join('')
    || '<li class="none">Nothing ignored. Use the ⋮ on any sensor in a map popup.</li>';
  el('ignoredClear').disabled = !rows.length;
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
  const pins = Object.values(marks).reduce((n, l) => n + l.length, 0);
  // The ignored count rides here rather than only in its own panel: this line is the one the eye
  // lands on to ask "why is the map this empty", and a sensor you silenced last week is exactly the
  // answer it should give.
  const ign = ignoredIds();
  const nIgn = state.data.filter(s => ign.has(s.id)).length;
  el('shown').textContent = `${total} of ${state.data.length} stations on the map` +
    (pins && pins < total ? ` · ${pins} pins` : '') +
    (nIgn ? ` · ${nIgn} ignored` : '');
}
