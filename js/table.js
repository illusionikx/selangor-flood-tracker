// The whole station set as a table — every mast, under its district, with a badge per sensor.
//
// The map answers "what is happening near here". This answers "what is there", which is a different
// question and a bad fit for pins: you cannot scan 435 pins, and a mast holding six sensors shows
// one. Same grouping as the map (a mast is a mast in both), so switching between them doesn't
// re-teach you the shape of the data.

import { KINDS, KIND_RANK } from './config.js';
import { state } from './state.js';
import { el, dkey, hasInfo, color, leads } from './util.js';
import { oneLiner } from './stations.js';
import { flashTo } from './map.js';


const rank = s => KIND_RANK.indexOf(s.kind);

/* Deliberately unfiltered by the drawer: this is "show me everything", and a table that quietly
   omitted the districts you switched off on the map would be the same trap as the empty map. The
   search box is the only filter here, and what it hides it hides in front of you.

   That also makes this the only place the 11 cameras JPS publishes with zero coordinates appear at
   all — they can't be drawn, but they exist, and a row is better than silence. Those rows carry no
   `data-mast`, so they don't offer a jump that would fly the map into the Atlantic. */
export function dataTable() {
  const q = el('dataFind').value.trim().toLowerCase();

  // Stations → masts, masts → districts. Both groupings the user asked for, in that order, because
  // a district is a list of places and a place is a list of sensors.
  const masts = new Map();
  for (const s of state.data) {
    const k = s.site || s.id;
    masts.has(k) ? masts.get(k).push(s) : masts.set(k, [s]);
  }

  const districts = new Map();
  let shownMasts = 0, shownStations = 0;
  for (const [key, members] of masts) {
    members.sort((a, b) => leads(a, b) || rank(a) - rank(b));
    const lead = members[0];
    const hay = `${members.map(m => m.name).join(' ')} ${lead.district} ${lead.state} ${
      lead.basin || ''}`.toLowerCase();
    if (q && !hay.includes(q)) continue;

    shownMasts++;
    shownStations += members.length;
    const dk = dkey(lead);
    const row = districts.get(dk)
      || { state: lead.state || '—', district: lead.district || 'Unknown', masts: [] };
    row.masts.push({ key, members, lead });
    districts.set(dk, row);
  }

  el('dataCount').textContent = shownMasts
    ? `${shownStations} sensors at ${shownMasts} locations · ${districts.size} districts`
    : '';

  el('dataBody').innerHTML = [...districts.values()]
    .sort((a, b) => a.state.localeCompare(b.state) || a.district.localeCompare(b.district))
    .map(d => `<tr class="dhead"><th colspan="2">${d.district}
        <span class="muted">${d.state} · ${d.masts.length} location${d.masts.length > 1 ? 's' : ''}</span>
      </th></tr>` + d.masts
      .sort((a, b) => a.lead.name.localeCompare(b.lead.name))
      .map(({ key, members, lead }) => `<tr${lead.lat && lead.lng ? ` data-mast="${key}"` : ''}>
        <td class="nm">
          <div class="popname">${lead.name}</div>
          <div class="muted">${lead.basin || 'basin n/a'}</div>
          ${lead.lat && lead.lng ? '' : '<div class="muted nomap">not on the map · no coordinates</div>'}
        </td>
        <td class="sn">${members.map(m => `<div class="srow">
          <span class="badge" style="--c:${hasInfo(m) ? KINDS[m.kind].color : 'var(--muted)'}"
            ><i>${KINDS[m.kind].icon}</i>${KINDS[m.kind].one || KINDS[m.kind].label}</span>
          <span class="rd" style="color:${color(m)}">${
            hasInfo(m) ? oneLiner(m) || '—' : 'no reading'}</span>
          ${m.name !== lead.name ? `<span class="alt muted">${m.name}</span>` : ''}
        </div>`).join('')}</td>
      </tr>`).join('')).join('')
    || '<tr><td class="none muted">Nothing matches that.</td></tr>';
}

// Jumping to a mast has to close the table first — it covers the map it is about to fly across.
el('dataBody').onclick = e => {
  const tr = e.target.closest('[data-mast]');
  if (!tr) return;
  const s = state.data.find(x => (x.site || x.id) === tr.dataset.mast);
  if (!s) return;
  el('dataBox').close();
  flashTo(s);
};
