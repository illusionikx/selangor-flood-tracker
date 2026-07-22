// Rebuilds every marker and the heat layer from the current station set.

import { KINDS, RISE_ETA } from './config.js';
import { state, PREFS } from './state.js';
import { el, color, popWidth, dkey, isCritical, leads } from './util.js';
import { map, marks, siteMark, shown, syncCluster, focusOn, openStable } from './map.js';
import { heat, heatScale, heatOpacity } from './heat.js';
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
  const points = [];
  const perKind = Object.fromEntries(Object.keys(marks).map(k => [k, 0]));

  // Filter first, group second. A site is drawn from the sensors still showing on it, so switching
  // rainfall off on a mast that also carries a river gauge leaves the river pin exactly where it
  // was — rather than taking the whole place off the map because the mast's lead sensor was hidden.
  const sites = new Map();
  for (const s of state.data) {
    if (!s.lat || !s.lng) continue;
    const pinned = s.id === state.pinned;   // a jumped-to station outranks every filter
    if (!pinned) {
      if (hidden.has(dkey(s))) continue;
      if (risingOnly && !s.rising) continue;
    }

    // Counted before the layer check: the chip's number is "what this layer would add".
    perKind[s.kind]++;

    // Heat is its own layer with its own toggle, so a hidden river chip must not dim the heatmap.
    //
    // Weight = how close to danger, scaled by how soon it arrives — the same two facts the alert
    // definition is built from, so the hot spots and the alert panel can't tell different stories.
    // `s.rising` would have been the shorter way to write this, but it is that rule with a hard
    // edge at RISE_ETA: a station an hour out and one 2.9 hours out would glow identically, and one
    // 3.1 hours out would drop to nothing. The ramp spends the same doubling over the countdown.
    if (s.kind === 'river' && s.ratio) {
      const urgency = s.eta == null ? 0 : Math.max(0, 1 - s.eta / RISE_ETA);
      const w = Math.min(1, s.ratio * (1 + urgency));
      if (w > 0.1) points.push([s.lat, s.lng, w]);
    }

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
    const marker = L.marker([lead.lat, lead.lng], {
      kind: lead.kind, critical,                          // read back by the cluster badge
      zIndexOffset: critical ? 1000 : rising ? 500 : 0,   // keep the urgent pins on top
      icon: L.divIcon({
        className: '', iconSize: [26, 26], iconAnchor: [13, 13],
        html: `<span class="pin${lead.online ? '' : ' off'}${rising ? ' rise' : ''}${
                     critical ? ' danger' : ''}" style="--c:${color(lead)}"><i class="i i-${KINDS[lead.kind].icon}"></i>${
               members.length > 1 ? `<b class="n">${members.length}</b>` : ''}</span>`,
      }),
    });
    // Widest member wins: a site holding a camera needs the room whatever leads it.
    const wide = Math.max(...members.map(m => popWidth(m.kind)));
    marker.bindPopup(sitePopup(members), {
      minWidth: wide, maxWidth: wide,
      // Tall popups open above the pin, so leave room up top; bottom clears the zoom/credit strip.
      autoPanPaddingTopLeft: [16, 24], autoPanPaddingBottomRight: [16, 56],
    });
    // Centre whatever was clicked; autoPan then nudges for the popup's height. The zoom re-runs
    // clustering, which tears the popup down again — so re-open it once the map has settled.
    marker.on('click', () => {
      focusOn([lead.lat, lead.lng], 13);
      openStable(marker);
    });
    marks[lead.kind].push(marker);
    siteMark.set(key, marker);
  }

  syncCluster();
  heatScale();
  heat.setLatLngs(points);
  el('heat').checked ? heat.addTo(map) : heat.remove();
  // Legend (and its opacity slider) only mean anything while the heatmap is on.
  el('legend').style.display = el('heat').checked ? '' : 'none';
  heatOpacity();
  counts();
  districts();
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

  // Disabled rather than hidden: a button that comes and goes moves the rows under the pointer.
  el('districtAll').disabled = !hidden.size;
  el('districtNone').disabled = hidden.size >= tally.size;
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
  el('shown').textContent = `${total} of ${state.data.length} stations on the map` +
    (pins && pins < total ? ` · ${pins} pins` : '');
}
