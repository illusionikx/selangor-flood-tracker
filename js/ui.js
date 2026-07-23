// DOM wiring: drawer, theme, filters, layer chips, panels, lightbox and the delegated jumps.

import { KINDS } from './config.js';
import { state, PREFS, save } from './state.js';
import { el, distKm, dkey, ignoredIds } from './util.js';
import { map, setTheme, flashTo } from './map.js';
import { heatOpacity } from './heat.js';
import { byId } from './stations.js';
import { render, districts } from './render.js';
import { dataTable } from './table.js';
import { alerts } from './alerts.js';
import { ticker } from './ticker.js';
import { openTimeline, reset } from './timeline.js';
import { load } from './net.js';
import { paintTestChrome } from './test.js';

// --- theme ---------------------------------------------------------------------------------------

setTheme(PREFS.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
el('theme').onclick = () =>
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

// --- about dialog ------------------------------------------------------------------------------
// <dialog> handles the backdrop, Esc and focus; the only wiring needed is opening it and treating a
// click on the backdrop as a close, which the element does not do on its own.

const aboutBox = el('aboutBox');
el('about').onclick = () => aboutBox.showModal();
aboutBox.onclick = e => { if (e.target === aboutBox) aboutBox.close(); };

// --- test mode ------------------------------------------------------------------------------
// Toggling refetches rather than mutating what is on screen: turning it *off* has to undo a payload
// that was edited in place, and the only honest undo is the real payload again.

el('testMode').checked = state.test;      // always false on load — the flag is session-only
paintTestChrome();
el('testMode').onchange = () => {
  state.test = el('testMode').checked;
  paintTestChrome();
  load();
};
// The badge's own escape hatch: whoever is looking at a fake flood may not be whoever switched it
// on, and hunting through a dialog to stop it is a poor way to find that out.
el('testOff').onclick = () => {
  el('testMode').checked = false;
  el('testMode').onchange();
};

// --- all-stations table ------------------------------------------------------------------------

const dataBox = el('dataBox');
el('data').onclick = () => { dataTable(); dataBox.showModal(); el('dataFind').focus(); };
dataBox.onclick = e => { if (e.target === dataBox) dataBox.close(); };
el('dataFind').oninput = dataTable;

// --- drawer ------------------------------------------------------------------------------------

const phone = matchMedia('(max-width: 600px)');
const menu = el('menu');
// `remember: false` for opens and closes the layout forced rather than the user chose — otherwise a
// phone-width auto-close would overwrite the preference and there'd be nothing to restore later.
function setDrawer(open, pan = true, remember = true) {
  document.body.classList.toggle('drawer', open);
  menu.firstElementChild.className = `i i-${open ? 'menu_open' : 'menu'}`;
  menu.setAttribute('aria-expanded', open);
  // Keep whatever you were looking at centred in the *visible* half of the map.
  if (pan) map.panBy([(open ? -1 : 1) * el('bar').offsetWidth / 2, 0], { duration: .25 });
  if (remember) { PREFS.drawer = open; save(); }
}
menu.onclick = () => setDrawer(!document.body.classList.contains('drawer'));
/* Open on desktop unless the user has closed it — `!== false`, not `!!`, so an unset preference
   counts as open. The drawer holds every filter and the layer chips, and a first visit used to land
   on a bare map with all of that behind an unlabelled hamburger; there is room for it beside the map
   at this width, which is the whole reason it is a drawer rather than a sheet.
   Landing on a phone starts with the map and nothing over it: at that width the drawer *is* the
   screen, so opening one would hand the user a filter panel where they expected a map. Its own
   default is therefore still closed, and a desktop preference never leaks into it.
   `remember: false` — this is the layout deciding, so the preference survives for the desktop visit
   that set it. */
const wantDrawer = () => !phone.matches && PREFS.drawer !== false;
setDrawer(wantDrawer(), false, false);

// Crossing the breakpoint in either direction: shut at phone width, where the drawer *is* the whole
// screen and an open one hides the map it is filtering; back to the desktop default on the way out.
// Neither is remembered — the layout is deciding here, not the user, and overwriting the preference
// would leave nothing to restore.
phone.addEventListener('change', () => setDrawer(wantDrawer(), false, false));

// --- layer chips -------------------------------------------------------------------------------

for (const [k, v] of Object.entries(KINDS)) {
  el('layers').insertAdjacentHTML('beforeend',
    `<label class="chip" style="--c:${v.color}">
       <input type="checkbox" data-kind="${k}"${PREFS.layers[k] !== false ? ' checked' : ''}>
       <i class="glyph i i-${v.icon}"></i>${v.label}<b data-n="${k}"></b></label>`);
}
// A full re-render, not just syncCluster: pins are built per *site* from the sensors currently
// showing on it, so switching a layer changes which sensor leads a shared mast and what its popup
// holds. Rebuilding ~430 markers is the same work the poll does every five minutes.
document.querySelectorAll('#layers input').forEach(cb => cb.onchange = () => {
  PREFS.layers[cb.dataset.kind] = cb.checked;
  save();
  render();
});

// --- filters & heatmap controls ------------------------------------------------------------------

el('heatOpacity').value = PREFS.heatOpacity ?? 100;
el('heatOpacity').oninput = () => {
  heatOpacity();
  PREFS.heatOpacity = +el('heatOpacity').value;
  save();
};

/* The two heatmaps are **one** choice, so they are stored as one preference: `'water'`, `'rain'` or
   `''` for neither. A pair of booleans can hold a state the UI can no longer represent — both on —
   and a pref saved before this change is exactly that, which is what the `??` branch migrates.
   Water is the default because it is what this page is for; rain is what you switch to in order to
   ask where the water is coming from. */
const heatPref = PREFS.heatLayer ?? (PREFS.rainHeat ? 'rain' : PREFS.heat === false ? '' : 'water');
delete PREFS.heat; delete PREFS.rainHeat;   // dropped from the blob on the next save()
el('heat').checked = heatPref === 'water';
el('rainHeat').checked = heatPref === 'rain';
el('risingOnly').checked = !!PREFS.risingOnly;

el('heat').onchange = el('rainHeat').onchange = el('risingOnly').onchange = e => {
  /* One heatmap at a time. Stacked, they are two answers to two questions in one picture — and
     worse, leaflet.heat accumulates alpha across layers, so overlapping blobs blend into a colour
     that belongs to neither scale and reads as an intensity neither reading supports.
     Checkboxes rather than radios because "neither" has to stay reachable, and a radio group cannot
     be cleared by clicking. Switching one on switches the other off; switching the live one off
     leaves the map clean. */
  if (e.target === el('heat') && el('heat').checked) el('rainHeat').checked = false;
  if (e.target === el('rainHeat') && el('rainHeat').checked) el('heat').checked = false;

  PREFS.heatLayer = el('heat').checked ? 'water' : el('rainHeat').checked ? 'rain' : '';
  PREFS.risingOnly = el('risingOnly').checked;
  save();
  // Both heatmaps are display options, not filters — only the rising chip closes the drawer.
  applyFilter(e.target === el('risingOnly'));
};

// --- district filter ------------------------------------------------------------------------------
// render.js draws the list; this only interprets clicks on it. `hidden` holds the districts switched
// off, so a district the feeds add later shows up by default rather than silently missing.

function applyFilter(closeDrawer) {
  state.pinned = null;      // touching the filters means you meant them — drop any jump override
  render(); alerts();
  // On a phone the drawer is the map, so a filter you can't see the effect of is one you have to
  // close the drawer to judge. Only for the decisive actions — not each checkbox in a multi-select.
  if (closeDrawer && phone.matches) setDrawer(false, false, false);
}

function setHidden(keys, closeDrawer) {
  PREFS.hidden = [...keys];
  save();
  applyFilter(closeDrawer);
}

el('districtFind').oninput = districts;
el('districtList').onchange = e => {
  const k = e.target.dataset.d;
  if (!k) return;
  const keys = new Set(PREFS.hidden || []);
  e.target.checked ? keys.delete(k) : keys.add(k);
  setHidden(keys, false);
};
el('districtList').onclick = e => {
  const solo = e.target.closest('[data-solo]')?.dataset.solo;
  if (solo) setHidden(new Set(state.data.map(dkey).filter(k => k !== solo)), true);
};
el('districtAll').onclick = () => setHidden(new Set(), true);
el('districtNone').onclick = () => setHidden(new Set(state.data.map(dkey)), false);

// --- collapsible filter sections ------------------------------------------------------------------
// `open` is the element's own state, so there is nothing to sync — only to remember. Keyed by id in
// the same prefs blob as everything else. Districts default open, ignored closed.

for (const d of document.querySelectorAll('#bar .sect')) {
  d.open = PREFS.sect?.[d.id] ?? d.open;
  d.ontoggle = () => { (PREFS.sect ??= {})[d.id] = d.open; save(); };
}

// --- ignored sensors -------------------------------------------------------------------------------
// The ⋮ in a map popup adds one; this panel is the only way back. render.js draws the list.

function setIgnored(ids) {
  PREFS.ignored = [...ids];
  save();
  // A jump-pinned station outranks every filter, including this one — so drop the pin, or ignoring
  // the very station you just jumped to would leave it on the map.
  state.pinned = null;
  render(); alerts(); ticker();
}

// Delegated: the ⋮ menu is rebuilt with its popup on every poll, so there is nothing stable to bind.
document.addEventListener('click', e => {
  const id = e.target.closest('[data-ignore]')?.dataset.ignore;
  if (!id) return;
  setIgnored(ignoredIds().add(id));
  // Close the popup, not just the menu: the pin it belongs to has just gone, and a popup floating
  // over the spot where its own marker used to be is a ghost.
  map.closePopup();
});

el('ignoredList').onclick = e => {
  const id = e.target.closest('[data-unignore]')?.dataset.unignore;
  if (!id) return;
  const ids = ignoredIds();
  ids.delete(id);
  setIgnored(ids);
};
el('ignoredClear').onclick = () => setIgnored(new Set());

/* Placement for the ⋮ menu, by hand — CSS anchor positioning is Chromium-only, exactly as in the
   table's hover panels. `toggle` does not bubble, hence the capture phase. */
document.addEventListener('toggle', e => {
  const box = e.target;
  if (e.newState !== 'open' || !box.classList?.contains('menu')) return;
  const btn = document.querySelector(`[popovertarget="${box.id}"]`);
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  box.style.left = `${Math.max(8,
    Math.min(r.right - box.offsetWidth, innerWidth - box.offsetWidth - 8))}px`;
  // Below the button unless that runs off the bottom — popups near the foot of the map are common.
  box.style.top = r.bottom + box.offsetHeight + 8 < innerHeight
    ? `${r.bottom + 4}px` : `${r.top - box.offsetHeight - 4}px`;
}, true);

// --- alert panel ---------------------------------------------------------------------------------

const alertPanel = el('alerts'), alertTab = el('alertTab');
alertTab.onclick = () => {
  const open = alertPanel.classList.toggle('open');
  alertTab.setAttribute('aria-expanded', open);
  PREFS.alertsOpen = open;
  save();
};
// Same on landing for the alert panel: expanded it covers a third of a phone screen. It still
// springs open by itself when something *becomes* an alert (see alerts.js) — that is news, and news
// is worth the space; a list that was already there when you arrived is not.
if (!phone.matches && PREFS.alertsOpen !== false) alertPanel.classList.add('open');
alertTab.setAttribute('aria-expanded', alertPanel.classList.contains('open'));

// --- tap-to-open popovers (touch has no hover) -----------------------------------------------------

document.querySelectorAll('.info').forEach(info => info.onclick = e => {
  e.stopPropagation();
  info.classList.toggle('open');
});
const netChip = el('net');
netChip.onclick = e => {
  e.stopPropagation();
  if (!e.target.closest('#netstats')) netChip.classList.toggle('open');
};
document.addEventListener('click', () => {
  netChip.classList.remove('open');
  document.querySelectorAll('.info.open').forEach(i => i.classList.remove('open'));
});

// --- go to -----------------------------------------------------------------------------------
// A searchable select (select2-shaped): closed it reads as a plain select; focused it filters a
// grouped, scrollable list. Hand-rolled in ~50 lines rather than pulling in select2 — which needs
// jQuery — and rather than <datalist>, which ignores <optgroup> so it can't show the state/district
// headings and can't carry a synthetic "nearest to me" row. Matching is a plain substring over
// "name district state kind", so typing a district or a state lists it whole.

const NEAREST = { id: '@nearest', name: 'Nearest station to me', state: 'Your location' };
const gotoIn = el('goto'), gotoHits = el('gotoHits');
let hits = [], sel = -1;

const nearest = () => state.hereAt && state.data.reduce((best, s) =>
  s.lat && (!best || distKm(s, state.hereAt) < distKm(best, state.hereAt)) ? s : best, null);

function search() {
  const q = gotoIn.value.trim().toLowerCase();
  // No cap: an empty box lists all ~680, which is what a select does. Rendering them is ~5ms and
  // happens once per keystroke; virtualising a list nobody scrolls to the bottom of isn't worth it.
  hits = state.data
    .filter(s => s.name && s.lat && (!q ||
      `${s.name} ${s.district || ''} ${s.state || ''} ${KINDS[s.kind].label}`.toLowerCase().includes(q)))
    // Heading first: a group is only a group if its rows are adjacent.
    .sort((a, b) => group(a).localeCompare(group(b)) || a.name.localeCompare(b.name));
  if (state.hereAt && (!q || 'nearest station to me'.includes(q))) hits.unshift(NEAREST);
  draw(true);
}

// Grouped by state *and* district, because the district names alone are ambiguous: Kuala Lumpur and
// Selangor both have a Gombak.
const group = s => `${s.state || '—'} · ${s.district || 'district n/a'}`;

function draw(open = !gotoHits.hidden) {
  let last = null;
  gotoHits.innerHTML = hits.map((s, i) => {
    const d = s === NEAREST ? s.state : group(s);
    const head = d !== last ? `<li class="head" role="presentation">${d}</li>` : '';
    last = d;
    return `${head}<li role="option" data-i="${i}"${i === sel ? ' class="sel" aria-selected="true"' : ''}
      ><i class="glyph i i-${s === NEAREST ? 'my_location' : KINDS[s.kind].icon}" style="color:${s === NEAREST ? 'var(--accent)' : KINDS[s.kind].color}"
      ></i>${s.name}</li>`;
  }).join('') || '<li class="none">No station matches that</li>';
  gotoHits.hidden = !open;
  gotoIn.setAttribute('aria-expanded', open);
}

function pick(i) {
  const t = hits[i] === NEAREST ? nearest() : hits[i];
  if (!t) return;
  gotoIn.value = '';
  gotoIn.blur();
  sel = -1; draw(false);
  flashTo(t);
}

gotoIn.oninput = () => { sel = -1; search(); };
gotoIn.onfocus = search;
gotoIn.onblur = () => setTimeout(() => draw(false), 150);   // let a click on the list land first
gotoIn.onkeydown = e => {
  const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
  if (step) sel = Math.max(0, Math.min(hits.length - 1, sel + step));
  else if (e.key === 'Enter') return pick(sel < 0 ? 0 : sel);
  else if (e.key === 'Escape') { gotoIn.value = ''; return draw(false); }
  else return;
  e.preventDefault();
  draw();
  gotoHits.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
};
gotoHits.onmousedown = e => {
  const li = e.target.closest('[data-i]');
  if (li) pick(+li.dataset.i);
};

// --- delegated jumps -------------------------------------------------------------------------------

// Popups are rebuilt on every render, so the "nearest webcam" jump is delegated rather than bound.
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-cam]');
  const cam = btn && byId(btn.dataset.cam);
  if (cam) flashTo(cam);   // unhides the camera layer if it is switched off
});
// Same jump from anywhere outside the alert panel (which binds its own, plus a mobile collapse).
document.addEventListener('click', e => {
  const node = e.target.closest('[data-go]');
  if (!node || node.closest('#alertBody')) return;
  const t = byId(node.dataset.go);
  if (t) flashTo(t);
});

// --- lightbox --------------------------------------------------------------------------------------

// Two ways in: the still inside a popup, and the table's "show image" button, which has no <img>
// to click — it names the camera id and builds the same proxied URL.
const lightbox = el('lightbox');
document.addEventListener('click', e => {
  const img = e.target.closest('img.shot');
  const btn = e.target.closest('[data-shot]');
  if (!img && !btn) return;
  e.stopPropagation();
  const full = lightbox.querySelector('.stage > img');
  // Spin until it lands. `complete` covers the popup's already-cached still, which fires no load
  // event — without that check the spinner would sit there for ever over a picture that is ready.
  lightbox.classList.add('loading');
  const src = img ? img.src : btn.dataset.shot;   // data-shot is the resolved URL, proxied or direct
  full.src = src;
  if (full.complete) lightbox.classList.remove('loading');
  // The place, as the dialog's title. Both openers carry it as `data-name` rather than having this
  // strip a prefix off the alt text — "Latest still from X" is a caption, and parsing a caption back
  // into a name is a rule that breaks the day the caption is reworded.
  full.alt = (img ? img.alt : btn.dataset.cap) || '';
  el('lbTitle').textContent = (img || btn).dataset.name || full.alt;
  lightbox.showModal();
  openTimeline(src);   // no-op unless this is a proxied camera with an archive behind it
});
// A dead camera stops the spinner too — the broken image and its alt text say more than a spinner
// that never ends, which reads as "still trying".
lightbox.querySelector('.stage > img').onload =
lightbox.querySelector('.stage > img').onerror = () => lightbox.classList.remove('loading');

// Backdrop closes, like the other two dialogs; the × and Esc do the rest. Nothing inside needs an
// exemption any more — that was the price of the old tap-anywhere overlay, which could not tell a
// dismissal from a scrub, a play or a drag on the compare divider.
lightbox.onclick = e => { if (e.target === lightbox) lightbox.close(); };
lightbox.addEventListener('close', reset);

// --- splash ------------------------------------------------------------------------------------------

// Reconnecting retries by itself; the button is for "I fixed it, try now".
el('splashRetry').onclick = () => {
  el('splash').classList.remove('offline');
  el('splashWarn').hidden = true;
  el('splashMsg').textContent = 'retrying…';
  load();
};
addEventListener('online', () => {
  if (!el('splash').classList.contains('gone')) el('splashRetry').onclick();
});
