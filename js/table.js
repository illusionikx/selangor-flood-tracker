// The whole station set as a table — every mast, under its district, with a badge per sensor.
//
// The map answers "what is happening near here". This answers "what is there", which is a different
// question and a bad fit for pins: you cannot scan 435 pins, and a mast holding six sensors shows
// one. Same grouping as the map (a mast is a mast in both), so switching between them doesn't
// re-teach you the shape of the data.

import { KINDS, KIND_RANK, NO_INFO, camSrc } from './config.js';
import { state } from './state.js';
import { el, dkey, distKm, hasInfo, color, statusColor, leads } from './util.js';
import { flashTo } from './map.js';


const rank = s => KIND_RANK.indexOf(s.kind);

/* Deliberately unfiltered by the drawer: this is "show me everything", and a table that quietly
   omitted the districts you switched off on the map would be the same trap as the empty map. The
   search box is the only filter here, and what it hides it hides in front of you.

   That also makes this the only place the 11 cameras JPS publishes with zero coordinates appear at
   all — they can't be drawn, but they exist, and a row is better than silence. Those rows carry no
   `data-mast`, so they don't offer a jump that would fly the map into the Atlantic. */
/* Sorting happens *within* each district, not across them. The district grouping is the point of
   this table — a flat 450-row list sorted by water level would answer a question the alert panel
   already answers better, and lose the one this view exists for ("what is there, and where"). */
let sortCol = 'nm', sortDir = 1;

function drawHead() {
  el('dataHead').innerHTML = `<tr class="chead">${
    [['nm', 'Location', ''], ...KIND_RANK.map(k =>
      [k, KINDS[k].one || KINDS[k].label,
       `<i class="i i-${KINDS[k].icon}" style="color:${KINDS[k].color}"></i>`])]
    .map(([key, label, icon]) => `<th data-sort="${key}"${
      sortCol === key ? ` class="on ${sortDir > 0 ? 'up' : 'down'}"` : ''
    } title="Sort by ${label}">${icon}${label}</th>`).join('')}</tr>`;
}
drawHead();

el('dataHead').onclick = e => {
  const key = e.target.closest('[data-sort]')?.dataset.sort;
  if (!key) return;
  // Names read forwards, readings read worst-first — the default nobody has to think about.
  sortDir = key === sortCol ? -sortDir : (key === 'nm' ? 1 : -1);
  sortCol = key;
  drawHead();
  dataTable();
};

/* How much a sensor "is" for sorting. One number per kind, so a column of gauges and a column of
   sirens both sort by the thing that matters in them. A mast without that kind sinks to the bottom
   whichever way the arrow points — an absent sensor is not a low reading. */
const sortKey = m => !m || !hasInfo(m) ? -Infinity : ({
  river:    m.danger ? m.level / m.danger : m.level,
  rainfall: m.hourly,
  siren:    m.online ? m.status + 1 : 0,
  gauge:    m.depth,
  camera:   m.image ? 1 : 0,
}[m.kind] ?? -Infinity);

const byCol = (a, b) => {
  if (sortCol === 'nm') return sortDir * a.lead.name.localeCompare(b.lead.name);
  const ka = sortKey(merge(a.members.filter(m => m.kind === sortCol)));
  const kb = sortKey(merge(b.members.filter(m => m.kind === sortCol)));
  if (ka === kb) return a.lead.name.localeCompare(b.lead.name);
  if (ka === -Infinity) return 1;            // missing sinks either way
  if (kb === -Infinity) return -1;
  return sortDir * (ka - kb);
};

/* Widening a site to 200 m means it can now hold two of the same kind — two rainfall gauges either
   end of a township. One cell, one answer: numbers average, states OR together. A camera cell offers
   the first feed there actually is.

   *Status* does not average, it takes the worst. A status code is a category, not a quantity — the
   mean of "normal" and "danger" is not "warning", it is nonsense — and a merged cell that rendered
   calmer than its worst member would be the one failure this app cannot have. So the number is the
   average and the colour is the worst, which is also how you would read it aloud. */
const avg = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

function merge(own) {
  if (own.length <= 1) return own[0];
  const live = own.filter(hasInfo);
  if (!live.length) return { ...own[0], n: own.length };
  const mean = f => {
    const v = live.map(m => m[f]).filter(x => x != null);
    return v.length ? +avg(v).toFixed(2) : null;
  };
  const withImage = own.find(m => m.image);
  return {
    ...live[0], n: own.length,
    online: own.some(m => m.online),
    status: Math.max(...live.map(m => m.status ?? 0)),
    level: mean('level'), danger: mean('danger'),
    hourly: mean('hourly'), daily: mean('daily'), depth: mean('depth'),
    ...(withImage ? { image: withImage.image, id: withImage.id } : {}),
  };
}

/* Masts, but looser than the map's. The map groups sensors that share a coordinate exactly, because
   a pin is a point. Here a "location" is a place you would name, and JPS scatters the sensors of one
   site over a couple of hundred metres — a river gauge on the bridge, the rainfall mast at the depot.
   Merging within SITE_KM makes one row of what is really one place.
   ponytail: greedy O(n²) over ~450 exact-coordinate groups, and only while this dialog is open. A
   spatial index would be more code than the loop it replaces. */
const SITE_KM = 0.2;

function siteGroups() {
  const exact = new Map();
  for (const s of state.data) {
    const k = s.site || s.id;
    exact.has(k) ? exact.get(k).push(s) : exact.set(k, [s]);
  }
  const groups = [];
  for (const members of exact.values()) {
    const head = members[0];
    // Same district too: two masts 200 m apart across a district line are still two places to a
    // reader scanning by district, and merging them would file one of them under the wrong heading.
    const near = head.lat && groups.find(g =>
      g.lead.lat && dkey(g.lead) === dkey(head) && distKm(g.lead, head) < SITE_KM);
    if (near) near.members.push(...members);
    else groups.push({ key: head.site || head.id, lead: head, members: [...members] });
  }
  return groups;
}

export function dataTable() {
  const q = el('dataFind').value.trim().toLowerCase();

  const districts = new Map();
  let shownMasts = 0, shownStations = 0;
  for (const site of siteGroups()) {
    const { key, members } = site;
    members.sort((a, b) => leads(a, b) || rank(a) - rank(b));
    const lead = site.lead = members[0];
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
    .map(d => `<tr class="dhead"><th colspan="${KIND_RANK.length + 1}">${d.district}
        <span class="muted">${d.state} · ${d.masts.length} location${d.masts.length > 1 ? 's' : ''}</span>
      </th></tr>` + d.masts
      .sort(byCol)
      .map(({ key, members, lead }) => `<tr${lead.lat && lead.lng ? ` data-mast="${key}"` : ''}>
        <td class="nm">
          <div class="popname">${lead.name}</div>
          <div class="muted">${lead.basin || 'basin n/a'}</div>
          ${lead.lat && lead.lng ? '' : '<div class="muted nomap">not on the map · no coordinates</div>'}
        </td>
        ${KIND_RANK.map(k => {
          const own = members.filter(m => m.kind === k);
          return `<td class="k">${own.length ? cell(own, lead) : '<span class="dash">—</span>'}</td>`;
        }).join('')}
      </tr>`).join('')).join('')
    || `<tr><td class="none muted" colspan="${KIND_RANK.length + 1}">Nothing matches that.</td></tr>`;
}

/* One cell per sensor kind, so a column reads as one measurement all the way down and a mast that
   has no siren shows a dash rather than a gap you have to interpret. oneLiner() is not reused here:
   it is written for a popup with 300px to spend, and "1.68 m · 34% of danger" in a 150px column
   wraps to three lines.

   Where the reading *is* a state — a siren, a flood gauge, rainfall intensity — the cell leads with
   a badge rather than a number, because that is the answer; the number is the evidence. Water level
   is the other way round: the level is the answer, and the status is carried in its colour. */
const pill = (text, c, tip = '') => `<span class="badge" style="--c:${c}">${text}${tip}</span>`;

// Rain intensity on the server's own rainStatus() cutoffs (>0 / >10 / >30 / >60 mm an hour), short
// enough for a column. Colour is the status ramp, not the violet rainfall hue — this is a status.
const RAIN = [['dry', 0], ['light', 1], ['moderate', 2], ['heavy', 3], ['very heavy', 3]];

/* What a cell is hiding: the sensors behind a merged reading, or a sensor whose own name differs from
   the place it sits at. Both used to cost a line under the badge; both are now one marker.

   A native popover, not `title`: a title tooltip can't be styled or laid out, and the app's own
   `.tip` popover can't be used here because the table is a scroll container that would clip it.
   `popover` puts the panel in the top layer — no clipping, no z-index — and brings click-to-open
   (so touch works), light dismiss and Esc with it. Only the placement needs JS, because CSS anchor
   positioning is still Chromium-only. Browsers without popover support leave `:popover-open`
   unmatched, so the panel stays `display: none` rather than dumping its contents into the cell. */
const shortVal = m => !hasInfo(m) ? 'no reading' : ({
  river:    `${m.level} m`,
  rainfall: `${m.hourly} mm/h`,
  siren:    m.online ? (m.status > 0 ? 'triggered' : 'idle') : 'not active',
  gauge:    m.depth > 0 ? `${m.depth} m of water` : 'dry',
  camera:   m.image ? 'has a feed' : 'no feed',
}[m.kind] || '—');

function summary(own, lead) {
  const named = own.length === 1 && own[0].name !== lead.name;
  if (own.length < 2 && !named) return '';
  const id = `sum-${own[0].id}`;
  return `<button class="sum" popovertarget="${id}"
      aria-label="What this cell covers"><i class="i i-info"></i></button>
    <div id="${id}" class="tipbox surface" popover>
      <div class="tiphead">${own.length > 1
        ? `${own.length} sensors here, summarised` : 'Recorded as'}</div>
      ${own.map(m => `<div class="tiprow"><span>${m.name}</span><b>${shortVal(m)}</b></div>`).join('')}
    </div>`;
}

function cell(own, lead) {
  const m = merge(own);
  const tip = summary(own, lead);
  const box = inner => `<div class="cv">${inner}</div>`;
  // Kinds with no badge to hang the marker on get their own line for it.
  const line = inner => `<div class="line">${inner}${tip}</div>`;

  // A siren always has something to say, including that it is out of contact — which is the one
  // thing "no reading" must never be allowed to look like.
  if (m.kind === 'siren') {
    return box(!hasInfo(m) || !m.online ? pill('not active', NO_INFO, tip)
      : m.status > 0 ? pill('triggered', statusColor(3), tip) : pill('idle', statusColor(0), tip));
  }
  if (m.kind === 'camera') {
    return box(m.image
      ? line(`<button class="shotbtn" data-shot="${camSrc(m)}"
           data-cap="Latest still from ${m.name}"><i class="i i-photo_camera"></i>Show image</button>`)
      : line('<span class="muted">no feed</span>'));
  }
  if (!hasInfo(m)) return box(line('<span class="muted">no reading</span>'));

  if (m.kind === 'river') {
    return box(line(`<b style="color:${color(m)}">${m.level} m</b>`) + (m.danger
      ? `<div class="val muted">${(m.level / m.danger * 100).toFixed(0)}% of danger</div>` : ''));
  }
  if (m.kind === 'rainfall') {
    const [label, tone] = RAIN[Math.max(0, m.status)] || RAIN[0];
    return box(`${pill(label, statusColor(tone), tip)}<div class="val">${
      m.hourly} mm<span class="muted">/h</span></div>`);
  }
  // Gauge: depth over a flood-prone spot, so negative is dry ground, not a missing reading.
  const label = m.depth <= 0 ? 'dry' : m.status >= 2 ? 'danger' : m.status === 1 ? 'warning' : 'water';
  return box(`${pill(label, m.depth <= 0 ? statusColor(0) : statusColor(m.status), tip)}<div class="val">${
    m.depth > 0 ? `${m.depth} m<span class="muted"> deep</span>`
                : `<span class="muted">${Math.abs(m.depth)} m below</span>`}</div>`);
}

// Jumping to a mast has to close the table first — it covers the map it is about to fly across.
/* CSS anchor positioning would do this, but it is Chromium-only — so the panel is placed by hand on
   open. `toggle` does not bubble, hence the capture phase. */
el('dataBody').addEventListener('toggle', e => {
  const box = e.target;
  if (e.newState !== 'open' || !box.matches('.tipbox')) return;
  const r = document.querySelector(`[popovertarget="${box.id}"]`).getBoundingClientRect();
  box.style.left = `${Math.max(8, Math.min(r.right - box.offsetWidth, innerWidth - box.offsetWidth - 8))}px`;
  // Below the marker, unless that would run off the bottom — then above it.
  box.style.top = r.bottom + box.offsetHeight + 8 < innerHeight
    ? `${r.bottom + 6}px` : `${r.top - box.offsetHeight - 6}px`;
}, true);

/* Hover opens it too, for mice. No `title` anywhere near this: a native tooltip would sit on top of
   the panel saying something vaguer than what is already on screen. The panel lives in the top layer,
   so it is not a descendant of the button and moving onto it counts as leaving — which is fine for
   something you only read. Click still works, and is the only way in on touch. */
const popFor = node => document.getElementById(node.getAttribute('popovertarget'));
// Only where hover is real. Touch fires a synthetic mouseover *before* the click, so on a phone this
// would open the panel and the click that followed would immediately toggle it shut again.
if (matchMedia('(hover: hover)').matches) {
  el('dataBody').addEventListener('mouseover', e => {
    const box = e.target.closest('.sum') && popFor(e.target.closest('.sum'));
    if (box && !box.matches(':popover-open')) box.showPopover();
  });
  el('dataBody').addEventListener('mouseout', e => {
    const b = e.target.closest('.sum');
    if (!b || b.contains(e.relatedTarget)) return;   // moving onto its own icon is not leaving
    const box = popFor(b);
    if (box?.matches(':popover-open')) box.hidePopover();
  });
}

el('dataBody').onclick = e => {
  if (e.target.closest('[data-shot], .sum, .tipbox')) return;   // their own handlers; row stays put
  const tr = e.target.closest('[data-mast]');
  if (!tr) return;
  const s = state.data.find(x => (x.site || x.id) === tr.dataset.mast);
  if (!s) return;
  el('dataBox').close();
  flashTo(s);
};
