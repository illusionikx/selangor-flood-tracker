// DOM wiring: drawer, theme, filters, layer chips, panels, lightbox and the delegated jumps.

import { KINDS, MAST, camSrc, FEED, STATIC, NEAR_MAX_KM } from './config.js';
import { state, PREFS, PREFS_KEY, save } from './state.js';
import { el, distKm, dkey, ignoredIds, leads, favIds, isFav, squash, termsOf, matches
       } from './util.js';
import { map, setTheme, flashTo, closeSide, showPlace } from './map.js';
import { heatOpacity, syncHeat } from './heat.js';
import { byId } from './stations.js';
import { camWarn } from './popup.js';
import { render, districts } from './render.js';
import { dataTable } from './table.js';
import { alerts, toggleAlerts } from './alerts.js';
import { ticker } from './ticker.js';
import { openTimeline, reset } from './timeline.js';
import { load, feedRows, sourceRows, lastPayload } from './net.js';
import { paintTestChrome } from './test.js';
import * as wall from './wall.js';
import './sparktip.js';   // side effect only: one delegated readout for every graph on the page

// --- theme ---------------------------------------------------------------------------------------

setTheme(PREFS.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
el('theme').onclick = () =>
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

// --- about dialog ------------------------------------------------------------------------------
// <dialog> handles the backdrop, Esc and focus; the only wiring needed is opening it and treating a
// click on the backdrop as a close, which the element does not do on its own.

const aboutBox = el('aboutBox');
/* One handler closes the menu, whichever item was hit. Capture, not bubble: an item's own handler
   calls showModal(), and a dialog that opens while its opener is still in the top layer is a
   sequence worth not testing. Capture runs the parent first, so the menu is gone before the dialog
   arrives. */
const appMenu = el('appMenu');
appMenu.addEventListener('click', () => appMenu.hidePopover(), true);
// The station card closes when a dialog takes the screen — you have gone somewhere else, and coming
// back to a card you had forgotten was open is a surprise. That, and its own ×, are the only ways it
// shuts: nothing on the map dismisses it, and a poll never does. See map.js.
el('about').onclick = () => { closeSide(); showPane('tabAbout'); aboutBox.showModal(); };
el('help').onclick  = () => { closeSide(); showPane('tabHelp');  aboutBox.showModal(); };
aboutBox.onclick = e => { if (e.target === aboutBox) aboutBox.close(); };

/* Two panes, one dialog. `hidden` on the pane and `aria-selected` on the button are the whole state.
   Nothing is stored: the dialog resets to About on close, so it always opens where the design says.
   The scroll reset is not cosmetic — the panes are different lengths, and switching from the foot of
   About into Help would drop you into the middle of a sentence.
   ponytail: no roving tabindex. The ARIA practice makes a tab list one Tab stop and moves between
   tabs with the arrow keys; with exactly two tabs that only makes the second one harder to reach. */
const PANES = { tabAbout: 'paneAbout', tabHelp: 'paneHelp' };
function showPane(tabId) {
  for (const [t, p] of Object.entries(PANES)) {
    el(t).setAttribute('aria-selected', String(t === tabId));
    el(p).hidden = t !== tabId;
  }
  aboutBox.scrollTop = 0;
  if (tabId === 'tabAbout') paintDev();
}
aboutBox.querySelector('.tabs').onclick = e => {
  const b = e.target.closest('[role=tab]');
  if (b) showPane(b.id);
};
// The message a force leaves in #devMsg belongs to the dialog session that produced it, not to any
// one repaint — clearing it here, not in paintDev(), is what stops a poll landing mid-read from
// wiping a result nobody has seen yet. Close the dialog and it is gone; reopen and force a fresh one.
aboutBox.onclose = () => { showPane('tabAbout'); el('devMsg').textContent = ''; };

/* The same numbers the status dot shows, plus the ones it has no room for. Painted when the dialog
   opens and when the About pane comes back, because a poll may have landed while Help was on
   screen. There is nothing to tear down, so re-painting is the whole update. */
function paintDev() {
  const j = lastPayload();
  // net.js sets `last` to null on any fetch error, so a missing payload here can mean two different
  // things: nothing has ever arrived, or a poll ran and failed after an earlier one succeeded.
  // #netstats already tells these apart (it reports `status: offline` with the problem), so this
  // row must too, or a reader watching Developer sees "no payload yet" during a live outage.
  el('devstats').innerHTML = !j
    ? `<tr><td class="muted" colspan="2">${state.data.length ? 'last poll failed' : 'no payload yet'
        }</td></tr>`
    : [...feedRows(j), ...sourceRows(j)]
        .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
}
// A poll can land while the dialog sits open on the Developer section — #netstats re-renders every
// 30 seconds for the same reason: a frozen "last checked" reads as a page that has stopped. `poll`
// only fires once a payload actually exists, and only from a real fetch, never from a re-render the
// filters trigger — see the dispatch in net.js. Repainting only while the dialog is open matches
// openSide()'s own rule for the station panel: nothing redraws what nobody can see.
document.addEventListener('poll', () => { if (aboutBox.open) paintDev(); });

/* Refresh now exists only where there is something to refresh. The Pages build serves a baked
   api.json written by a cron job, so a force there is a 404 against a file that has no opinion. */
if (STATIC) el('devForce').hidden = true;

el('devRaw').href = FEED;

/* The server owns the rate limit — a guard in here guards nothing. This only reports what the
   server decided, and reloads the map either way so the button never leaves a stale number on
   screen next to the word "refreshed". */
el('devForce').onclick = async () => {
  const b = el('devForce');
  b.disabled = true;
  el('devMsg').textContent = 'Refreshing…';
  try {
    const r = await fetch(FEED + (FEED.includes('?') ? '&' : '?') + 'force=1', { cache: 'no-store' });
    const j = await r.json();
    // The dialog can close while the fetch is in flight. onclose already cleared #devMsg for the
    // next session, and a result landing after that must not write into it.
    if (aboutBox.open) el('devMsg').textContent = j.forced
      ? `refreshed in ${j.tookMs} ms`
      : `not refreshed — ${j.forceWhy || 'served from cache'}`;
    await load();
  } catch (e) {
    if (aboutBox.open) el('devMsg').textContent = 'Failed — ' + e.message;
  }
  b.disabled = false;
  // Not redundant with the `poll` listener above: on the catch path load() never ran, so no `poll`
  // event fired, and this is the only repaint that follows a failed force at all.
  paintDev();
};

/* Native confirm(), because this drops the ignored list and that is the one setting somebody chose
   deliberately. It fails in the safe direction — clearing it un-silences sensors, so it can only
   add alerts, never hide one — but "safe" is not "expected". */
el('devReset').onclick = () => {
  if (!confirm('Reset every setting to its default? This clears the theme, the district filter, '
      + 'the layer chips, the heatmap, the favorites and the ignored sensors.\n\n'
      + 'This cannot be undone.')) return;
  localStorage.removeItem(PREFS_KEY);
  location.reload();
};

/* Seven taps on the About logo inside five seconds. A rolling window of the last seven timestamps
   rather than a counter and a timer: there is no interval to arm, clear or leak, and the gesture
   stays open-ended — tap slowly for a minute and the oldest taps simply fall out of the window, so
   it never has to decide when to "give up" and reset. `slice(-7)` is the whole state machine.
   Deliberately not reachable any other way and deliberately undocumented in the UI. It sits inside
   the About dialog, which is the one surface here that carries no warning, no reading and no alarm —
   nothing a person could be relying on. An easter egg anywhere near the alert path would be a
   surprise on a screen whose entire job is that nothing on it is a surprise. */
const eggBox = el('eggBox');
const EGG_HOLD = 1500;   // ms the picture is click-proof after opening — see below
let taps = [], eggOk = true, eggAt = 0;
// The image is fetched eagerly at page load, so a 404 is known long before anyone earns the egg.
// Without this the gesture would open an empty box holding a broken-image glyph, which is a worse
// reward than no egg at all — and it means this can ship before the picture does.
eggBox.querySelector('img').onerror = () => { eggOk = false; };
aboutBox.querySelector('.logo').onclick = () => {
  taps = [...taps, Date.now()].slice(-7);
  if (eggOk && taps.length === 7 && taps[6] - taps[0] < 5000) {
    taps = [];
    eggAt = Date.now();
    eggBox.showModal();
  }
};
/* Clicks are ignored for EGG_HOLD after it opens. The gesture that opens this is seven fast clicks,
   so an eighth is usually already on its way when the dialog appears — without this, finding the
   secret is rewarded with one frame of it. The hold outlasts the .45s pop on purpose: it is not
   waiting for the animation, it is holding the picture still long enough to have been looked at,
   which is the only reason it is on screen.
   Esc is deliberately left alone. <dialog> closes on it natively and that stays true from the first
   millisecond — a modal you cannot leave when you want to is a trap, and this one is a joke. */
eggBox.onclick = () => {
  if (Date.now() - eggAt > EGG_HOLD) eggBox.close();
};

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
el('data').onclick = () => { closeSide(); dataTable(); dataBox.showModal(); el('dataFind').focus(); };
dataBox.onclick = e => { if (e.target === dataBox) dataBox.close(); };
el('dataFind').oninput = dataTable;

// --- all cameras ---------------------------------------------------------------------------

const camBox = el('camBox');
el('cams').onclick = () => {
  closeSide();
  el('camFind').value = '';
  wall.open();
  camBox.showModal();
};
camBox.onclick = e => { if (e.target === camBox) camBox.close(); };
/* Nothing ticks behind a closed dialog, and nothing holds 91 decoded frames after the reader has
   gone. `onclose` catches Esc, the ×, and the backdrop click above, which is every way out. */
camBox.onclose = () => wall.close();
/* One delegated listener. 91 listeners for one behavior is the thing delegation exists to stop.
   Read the id before closing: close() empties the grid, so the element is gone by the next line. */
el('camGrid').onclick = e => {
  const t = e.target.closest('[data-cam]');
  if (!t) return;
  const s = byId(`camera-${t.dataset.cam}`);
  camBox.close();
  if (s) flashTo(s);
};

/* The matcher is the go-to box's, which reads `I.K.B.N.`, `IKBN` and `I K B N` as one word and
   ignores word order. The plain substring test in js/table.js does neither, and this costs nothing
   extra because both live in js/util.js now.
 *
 * A filtered tile takes `hidden` and stays in the grid. It keeps its lap, its frame list and its
 * warmed images, so clearing the box brings it back where it was. The observer needs no code for
 * it either: the browser reports a `display: none` element as not intersecting, so the tile stops
 * ticking by itself and starts again when it returns.
 *
 * The kind label is deliberately not in the haystack. Every tile is a camera, so `camera` would
 * match all 91 and answer nothing. */
function camFilter() {
  const terms = termsOf(el('camFind').value);
  let shown = 0;
  for (const t of el('camGrid').children) {
    const ok = matches(t.dataset.hay, terms);
    t.hidden = !ok;
    if (ok) shown++;
  }
  wall.count(shown);
}
el('camFind').oninput = camFilter;

// --- drawer ------------------------------------------------------------------------------------

const phone = matchMedia('(max-width: 600px)');
const menu = el('menu');
// `remember: false` for opens and closes the layout forced rather than the user chose — otherwise a
// phone-width auto-close would overwrite the preference and there'd be nothing to restore later.
function setDrawer(open, pan = true, remember = true) {
  // Phones only: see the `sideopen` listener below for the other half of this and the reasoning.
  if (open && phone.matches) closeSide();
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

/* One panel at a time, at phone width only. Both are 84vw there and the drawer is drawn over the
   station panel, so a second one opening lands on top of the first — and above 600px there is room
   for the two on opposite edges, which is the layout they were built for. Each closes the other.
   The station panel's half arrives as an event because map.js owns openSide() and this module
   already imports map.js; a call back the other way would close the import cycle.
   `remember: false` and `pan: false` — the layout is deciding here, not the user, so the desktop
   preference survives, and there is no visible map to keep centred at this width. */
document.addEventListener('sideopen', () => { if (phone.matches) setDrawer(false, false, false); });

// --- panel tabs and swipe (phones) ---------------------------------------------------------------

/* At phone width each panel covers most of the map, and the only way out was a control in a far
   corner — the × at the top of #side, and for the drawer the hamburger in the app bar, which is not
   on the panel at all. The tab is on the edge the panel meets the map at, which is also the edge the
   swipe starts from, so the button and the gesture are the same place. */
el('barTab').onclick = () => setDrawer(false);
el('sideTab').onclick = closeSide;

/* Drag the panel off its own edge. `sign` is the direction that dismisses it: -1 for the drawer,
   +1 for the station panel. Touch only — a mouse has the tab and a drag with one is a selection.
   The first 8px decide the axis and nothing is moved before that: both panels scroll vertically, and
   a swipe that stole a scroll would cost more than the swipe is worth. A range input keeps its own
   drag (the drawer holds the heat opacity slider).
   The drag is written to the `translate` property, not to `transform`. Both boxes already carry a
   `transform` that places them — the panel's open/shut slide, the tab's offset by the panel width —
   and an inline transform would throw those away for the length of the drag. `translate` is a
   separate property that composes with it, so the finger only ever adds to where the box already is.
   Both stylesheets transition it, which is what carries a released panel home. */
function swipeOff(box, tab, sign, close) {
  let x0 = 0, y0 = 0, dx = 0, axis = 0, on = false;
  const move = v => { box.style.translate = tab.style.translate = v; };
  box.addEventListener('touchstart', e => {
    on = phone.matches && e.touches.length === 1 && !e.target.closest('input[type=range]');
    axis = dx = 0;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  }, { passive: true });
  box.addEventListener('touchmove', e => {
    if (!on) return;
    const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
    if (!axis) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      axis = Math.abs(mx) > Math.abs(my) ? 1 : -1;
      // The finger is the animation now — the tab moves with the panel, so they stay one edge.
      if (axis > 0) box.style.transition = tab.style.transition = 'none';
    }
    if (axis < 0) return;
    dx = Math.max(0, mx * sign);                     // travel toward the edge, never away from it
    move(`${dx * sign}px`);
  }, { passive: true });
  // Let go under a third of the way and the stylesheet's transition carries it back; past that it
  // closes, and the same transition carries it the rest of the way out.
  const drop = () => {
    if (!on) return;
    on = false;
    box.style.transition = tab.style.transition = '';
    move('');
    if (dx > box.offsetWidth * .3) close();
  };
  box.addEventListener('touchend', drop);
  box.addEventListener('touchcancel', drop);
}
swipeOff(el('bar'), el('barTab'), -1, () => setDrawer(false));
swipeOff(el('side'), el('sideTab'), 1, closeSide);

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
el('favOnly').checked = !!PREFS.favOnly;
// Which of the two is on, on the section's summary — the one thing a collapsed heatmap section
// otherwise stops saying.
const heatName = () => el('heatN').textContent =
  el('heat').checked ? 'water level' : el('rainHeat').checked ? 'rainfall' : 'off';
heatName();
// Before the first payload, not after it: render() is a whole poll away, and until it ran the map
// carried the water layer and the legend carried both ramps whatever the pref said.
syncHeat();

/* The rising filter hides most of the map, and unlike the district picker it is one checkbox with
   no list under it saying what it took away — a drawer you closed an hour ago is not an indication.
   So it gets a standing pill over the map with the way out on it, the same shape test mode uses.
   The same reasoning as the ignored-sensors panel: anything that suppresses stations has to say so
   somewhere you cannot miss, and has to be undoable from there. */
const risePill = () => document.body.classList.toggle('rising', el('risingOnly').checked);
risePill();
// Dispatching rather than calling the handler: it keys off `e.target` to work out which control
// moved, and it is the one place that persists, re-filters and closes the drawer on a phone.
el('riseOff').onclick = () => {
  el('risingOnly').checked = false;
  el('risingOnly').dispatchEvent(new Event('change'));
};

el('heat').onchange = el('rainHeat').onchange = el('risingOnly').onchange =
  el('favOnly').onchange = e => {
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
  PREFS.favOnly = el('favOnly').checked;
  heatName();
  risePill();
  save();
  // Both heatmaps are display options, not filters — only the two pin filters close the drawer.
  applyFilter(e.target === el('risingOnly') || e.target === el('favOnly'));
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
// The Details button in a station card adds one; this panel is the only way back. render.js draws the list.

function setIgnored(ids) {
  PREFS.ignored = [...ids];
  /* A starred sensor cannot also be a silenced one. Ignoring drops it from the favorites, and
     favoriting drops it from the ignored, so neither control can be left pointing at a sensor the
     other one owns. */
  PREFS.favs = (PREFS.favs || []).filter(id => !ids.has(id));
  save();
  // A jump-pinned station outranks every filter, including this one — so drop the pin, or ignoring
  // the very station you just jumped to would leave it on the map.
  state.pinned = null;
  render(); alerts(); ticker();
}

/* The mirror. It does **not** call `ticker()`, and that is the whole difference between the two:
   ignoring changes what alerts you, and starring changes only the order things are listed in. If a
   later change makes this line need `ticker()`, that is an alert-design decision and it goes through
   the standard in docs/FEATURES.md first. */
function setFavs(ids) {
  PREFS.favs = [...ids];
  PREFS.ignored = (PREFS.ignored || []).filter(id => !ids.has(id));
  save();
  state.pinned = null;
  render(); alerts();
}

// Delegated: the Details menu is rebuilt with its station card on every poll, so there is nothing stable to bind.
document.addEventListener('click', e => {
  const id = e.target.closest('[data-ignore]')?.dataset.ignore;
  if (!id) return;
  setIgnored(ignoredIds().add(id));
  // Close the card, not just the menu: the sensor it was describing has just been taken off the map.
  closeSide();
});

/* One handler for both controls. A mast's star sends every id it stands for, comma separated; a
   sensor's menu item sends one. The rule is the same either way: full means remove, anything less
   than full means add. That is what makes the mast star read filled only when every sensor there is
   starred, and what makes one press act on all of them.
   Delegated, because both controls are rebuilt with the station card on every poll. */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-fav]');
  if (!b) return;
  const list = b.dataset.fav.split(',');
  const ids = favIds();
  const full = list.every(id => ids.has(id));
  for (const id of list) full ? ids.delete(id) : ids.add(id);
  /* The sensor's star lives inside its own ⓘ menu — a `popover` — and `setFavs()` calls `render()`,
     which rebuilds the open card by replacing #sideBody wholesale (see openSide() in map.js). That
     destroys the open popover along with everything else on the card and mints a fresh, closed one
     with the same id. Left alone, the reader never sees the label flip to "Remove from favorites" —
     the confirmation the copy promises, and the reason this is a menu item rather than a bare icon —
     and focus falls back to <body> because the element it was on no longer exists.
     So the menu's id is captured before the rebuild, since the node itself will not survive it, and
     reopened by id afterward. The mast star has no popover ancestor: `closest('[popover]')` is null
     there, `menuId` stays undefined, and everything past the early return is skipped — the mast case
     was already fine, because that button lives directly on the card and needs no menu to reopen.
     Two guards past that. The element `menuId` names may not exist — render() only rebuilds a card
     that is actually open, and a poll landing in between could have moved the reader elsewhere — so
     this reads it back with getElementById() and does nothing on a miss rather than assume it is
     still there. And `showPopover()` throws on an already-open popover, so `:popover-open` is checked
     first; nothing here expects that to be true, since a fresh element parses as closed, but it costs
     one comparison to not have to find out by triggering an exception.
     The card itself is deliberately left alone by this whole handler — starring changes nothing on
     screen, so there is nothing to close. That is the opposite of the ignore handler just above,
     which deliberately calls closeSide(): ignoring removes the very sensor the card is describing, so
     the card is closed because what it was showing is gone.
     `showPopover()` called from script does not move focus by itself — only a popover opened by its
     own declarative invoker does that (and then only onto an `autofocus` descendant, which this menu
     has none of) — so the button just pressed is refocused by hand too, queried out of the reopened
     `menu` rather than the detached one this handler started with.
     Two paths past setFavs(), not one. render() rebuilds #sideBody wholesale for an ordinary station
     card, which destroys the open popover and mints a fresh, closed one with the same id — that is
     the reopen branch below. But render() deliberately skips every `@`-keyed card (`@here`; see
     openSide() in map.js), so there the menu this click is inside is never destroyed: it is still
     open, `:popover-open` is still true, and nothing above has touched its label or its heart. Left
     alone, a reader who favorites a sensor from "You are here" sees no confirmation at all — the menu
     item still reads "Add to favorites" beside a hollow grey heart after the press. So the still-open
     case gets its own branch: patch the glyph and the label in place, since no rebuild is coming to
     do it for us.
     The glyph swaps class as well as colour, because the heart carries the state in its fill: hollow
     for no, solid for yes. Colour alone would leave a solid heart sitting there through both. */
  const menuId = b.closest('[popover]')?.id;
  setFavs(ids);
  if (!menuId) return;
  const menu = document.getElementById(menuId);
  if (!menu) return;
  if (menu.matches(':popover-open')) {
    const item = menu.querySelector('[data-fav]');
    const on = item && ids.has(item.dataset.fav);
    const heart = item?.querySelector('.i-favorite, .i-favorite_outline');
    if (heart) {
      heart.className = `i i-favorite${on ? '' : '_outline'}`;
      heart.style.color = on ? 'var(--fav)' : 'var(--muted)';
    }
    const label = item?.querySelector('span');
    if (label) label.textContent = on ? 'Remove from favorites' : 'Add to favorites';
  } else {
    menu.showPopover();
    menu.querySelector('[data-fav]')?.focus();
  }
});

el('ignoredList').onclick = e => {
  const id = e.target.closest('[data-unignore]')?.dataset.unignore;
  if (!id) return;
  const ids = ignoredIds();
  ids.delete(id);
  setIgnored(ids);
};
el('ignoredClear').onclick = () => setIgnored(new Set());

el('favList').onclick = e => {
  const id = e.target.closest('[data-unfav]')?.dataset.unfav;
  if (!id) return;
  const ids = favIds();
  ids.delete(id);
  setFavs(ids);
};
el('favClear').onclick = () => setFavs(new Set());

/* Placement for the Details menu, by hand — CSS anchor positioning is Chromium-only, exactly as in the
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

// --- alert list ------------------------------------------------------------------------------
// Nothing more than a disclosure now — the list lives in #side and alerts.js owns both ends of it.
// No open/closed preference either: the panel is not permanent furniture any more, so there is no
// state to remember between visits, and nothing covers a third of a phone screen until asked.
el('alertBtn').onclick = toggleAlerts;

// --- tap-to-open popovers (touch has no hover) -----------------------------------------------------

document.querySelectorAll('.info').forEach(info => info.onclick = e => {
  e.stopPropagation();
  info.classList.toggle('open');
});
// The dot is 9px, so on touch it is the mark around it that opens the diagnostics — a 24px target
// rather than a 9px one, and the dot is a decoration on the mark anyway.
const netChip = el('net'), netMark = document.querySelector('header h1 .mark');
netMark.onclick = e => { e.stopPropagation(); netChip.classList.toggle('open'); };
// The popover is no longer inside the thing that opens it (see index.html), so it has to keep its
// own clicks off the close-everything handler below.
el('netstats').onclick = e => e.stopPropagation();
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
const gotoIn = el('goto'), gotoHits = el('gotoHits'), findBtn = el('find');
let hits = [], sel = -1;

/* The place the list is currently answering about, once the reader has picked one. Set by `pick()`,
   cleared by any edit to the box and by closing the control — a list of what is near somewhere the
   reader has typed away from is furniture with nothing under it, the same rule `expanded` follows.
   Declared here with `hits` and `sel`, above `setFind()`, rather than beside the place-lookup state
   it belongs with further down. `setFind()` clears it, and a `let` read before its own declaration
   throws rather than reading undefined — safe only while nothing calls `setFind()` during module
   evaluation, which is a promise about load order this file should not be making.
   There was a card here first: a copy of "You are here", pointed at the searched point and opened in
   `#side` under the key `@place`. It answered a question nobody asked. A reader who searches for a
   place wants the station that covers it, and the card made them read four sensor sections to reach
   the one line in each that was a jump. The stations belong in the list they were already looking
   at, where every other row already opens a station card with one press. */
let nearPlace = null;

/* The box lives in the app bar and is collapsed to its button until asked for — it is a control you
   reach for deliberately, unlike the layer chips or the alert panel, and as 300px of permanent map
   furniture it charged every visit for a search most of them never run. The button gives way to the
   field rather than sitting beside it (see chrome.css), so there is nothing to press to close: it
   closes on Escape, on picking a station, and on clicking away. The results list hangs below it. */
function setFind(open) {
  document.body.classList.toggle('finding', open);
  findBtn.setAttribute('aria-expanded', open);
  /* The box is `visibility: hidden` while shut — that is what keeps it out of the tab order — and
     you cannot focus a hidden element. Reading offsetWidth forces the style flush that applies the
     class, so by the next line the box is visible and the button that had focus is `display: none`
     with focus already returned to <body>. Both have to have happened before focus(), and neither
     has when this handler is entered. Not requestAnimationFrame: its callbacks run *before* the
     frame's style recalc, so the box is still hidden there and the focus is silently dropped. */
  if (open) { gotoIn.offsetWidth; return gotoIn.focus(); }
  gotoIn.value = '';
  sel = -1;
  /* The search is over, so the place question is over with it. Without this the next open would come
     back to a list of what is near a place the reader picked minutes ago, under a heading naming it,
     with an empty box above — `onfocus` calls search() and the `nearPlace` branch answers before the
     query is ever read. The pin stays on the map: it marks somewhere they asked about, and it lives
     until another place replaces it, exactly as the "you are here" pin does. */
  nearPlace = null;
  draw(false);
}
findBtn.onclick = () => setFind(true);

const nearest = () => state.hereAt && state.data.reduce((best, s) =>
  s.lat && (!best || distKm(s, state.hereAt) < distKm(best, state.hereAt)) ? s : best, null);

/* Matching ignores punctuation and word order. JPS writes the same place as `I.K.B.N.`, `IKBN` and
   `Ikbn` across its three feeds, and someone typing one of them means all three — a plain
   `includes()` found none of the others. Both sides have their punctuation stripped, so `ikbn`
   reaches `I.K.B.N.`; terms match in any order, so `lui sg` finds `KG. SG. LUI`, which the old
   substring test missed entirely.
   Squashing the haystack rather than spacing it is what makes one test enough: a term with no
   spaces that appears in the spaced text always appears in the squashed text too, so the squashed
   form is a superset and the spaced one need not be checked at all.
   Still substrings, not edit distance: `klang` must never quietly surface `Hulu Kelang`, because on
   this map those are different places — and it doesn't, since squashing removes spaces but never
   letters. No scoring either; the list is grouped under district headings, and a relevance order
   would fight the grouping rather than help it. */
const hay = s => squash(`${s.name} ${s.district || ''} ${s.state || ''} ${KINDS[s.kind].label}`);

/* One row per site, the same grouping `render()` draws pins from. The list used to show one row per
   sensor, so a six-sensor mast filled six rows and one pin, and a reader comparing the two had no
   way to tell that was one place. `leads()` names the row, and `render()` names the pin with the
   same call, so the two surfaces cannot print two names for one place. */
const sitesOf = list => {
  const m = new Map();
  for (const s of list) {
    const k = s.site || s.id;
    m.has(k) ? m.get(k).push(s) : m.set(k, [s]);
  }
  for (const ms of m.values()) ms.sort(leads);
  return m;
};

// A site matches when any sensor on it matches. The squashed haystacks join, so one test covers the
// whole mast — typing `camera` still finds every place that has one.
const siteHay = ms => ms.map(hay).join(' ');
const where = s => [s.district, s.state].filter(Boolean).join(', ') || 'district n/a';

// Grouped by state *and* district, because the district names alone are ambiguous: Kuala Lumpur and
// Selangor both have a Gombak.
const group = s => `${s.state || '—'} · ${s.district || 'district n/a'}`;

/* Which mast rows are open. Cleared whenever the query changes: a tree left half-open under a list
   that has been replaced is furniture with nothing under it.
   Keyed by group *and* site — not by site alone. A favorites row and a district row for one mast are
   still two rows: they occupy two different places in the list, and a reader who opens the one they
   can see has no way to know a second copy, somewhere else in the box, just opened with it. A shared
   key did exactly that: toggling the district copy spliced sensor rows into the favorites copy sitting
   above it too, growing a list the reader was not looking at and shifting every row below the one they
   actually clicked — which is the bug the chevron's index-stability fix (see rowHtml below) exists to
   avoid. Composing `g` and `key` into one string gives the favorites occurrence and the district
   occurrence independent state, so opening one never silently opens the other. */
const expanded = new Set();

/* The place lookup. Nothing leaves the browser until the reader picks the row at the foot of the
   list — Nominatim's usage policy names per-keystroke autocomplete, and an explicit row respects it
   outright.
   `gen` does not count how many lookups have started — it names *which query the list currently
   belongs to*. The first cut only bumped it inside `lookup()`, on the theory that a fetch is the
   only thing that needs invalidating. It missed the case where the reader edits the box while a
   fetch from an earlier query is still in flight: the `ask` row deliberately leaves the box open
   (see `pick()`), so there is nothing stopping a second edit before the first answer lands, and
   `oninput` cleared the *rendered* results but never touched `gen` — so a stale answer for query A
   could still pass `my === gen` and render under a box that now reads query B. Every edit has to
   invalidate an in-flight lookup as surely as starting a new one does, so `oninput` bumps `gen` too
   (see below). */
let places = [], pstate = '', gen = 0;

// Mirrors placeQuery()'s own limit in api.php. A client-side bound is a courtesy — it keeps the
// common case (a long paste) from ever leaving the browser — never the guard: the server enforces
// its own 80-character limit independently and answers a longer query with its own 400 regardless
// of what this constant says. Change one without the other and the two sides disagree about where
// the line is, which is exactly the 400-reported-as-an-outage bug this constant exists to avoid.
const PLACE_MAX = 80;

/* `p.name`, `p.detail`, the "Near …" heading a picked place sets and the echoed query below are the
   only interpolations in this file that come from outside JPS: OpenStreetMap via Nominatim is
   editable by anyone on earth, unlike the government feeds every neighboring row draws from, and a
   place named with a script payload would run in the reader's page the moment it hit `innerHTML`.
   The name survives a pick — it becomes the heading over the nearby stations — so escaping it once
   in the result row is not enough on its own. The echoed query rides along for
   the same reason — it lands in the identical `innerHTML` call — even though it is the reader's own
   typed text and the risk there is only ever self-inflicted. Scoped to these three call sites on
   purpose: sweeping every interpolation in this file is a separate change with its own review. */
const escHtml = s => String(s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function lookup(q) {
  const my = ++gen;
  places = [];
  pstate = 'Searching…';
  search();
  try {
    const r = await fetch(`api.php?place=${encodeURIComponent(q)}`, { cache: 'no-store' });
    const j = await r.json();
    if (my !== gen) return;
    places = j.places || [];
    pstate = places.length ? ''
      : r.status === 429 ? 'Too many searches just now — try again in a moment'
      // 400 is placeQuery() rejecting the query outright — too long, or invalid UTF-8 — and is a
      // problem with what the reader typed, not with reaching JPS or Nominatim. Reporting it as
      // "unavailable" blames this site's plumbing for the reader's own input.
      : r.status === 400 ? 'That search is too long — try a shorter place name.'
      : r.ok ? 'No place by that name in Selangor, Kuala Lumpur or Putrajaya'
      : 'Place search is unavailable';
  } catch {
    if (my !== gen) return;
    places = [];
    pstate = 'Place search is unavailable';
  }
  /* search() unshifts one row per place onto the very front of `hits` — "Results lead the list" in
     the comment above that call — which moves every row already in the list back by places.length,
     `sel` included. Left alone, `sel` still names the old numeric position, so after the shift it
     names whatever row now happens to sit there: an ordinary district row several rows past where
     the reader actually was, highlighted for no reason of their doing. The chevron handler
     (gotoHits.onmousedown) hits the same problem in the opposite direction — rowsFor() splices new
     rows in below the toggled one — and fixes it the same way: recompute the index the row of
     interest will occupy, rather than trust a number that predates the splice. Here the shift is
     uniform and known in advance, so a plain offset does the job. Guarded on `places.length` because
     an empty or failed answer pushes its message row onto the *foot* of the list instead (no shift
     at all — see rowHtml()'s note on that case), and guarded on `sel >= 0` because nothing is
     selected. */
  if (sel >= 0 && places.length) sel += places.length;
  search();
}

/* A site row, and its sensors under it when the row is open. One function, so the favorites group
   and the district groups cannot grow two different ideas of what an expanded mast looks like.
   A sensor row carries `lead`, the mast's own name, because a sensor named the same as its mast has
   nothing to add by repeating it.
   `xkey` — the composite `expanded` is keyed by — is computed once here and carried on the row object,
   so `rowHtml()` and the keyboard/mouse handlers all read the same string rather than three places
   rebuilding `${g}|${key}` and risking one of them drifting out of step with the others. */
function rowsFor(key, ms, g, sub) {
  const xkey = `${g}|${key}`;
  const out = [{ t: 'site', key, xkey, ms, g, sub }];
  if (ms.length > 1 && expanded.has(xkey))
    for (const s of ms) out.push({ t: 'sensor', s, key, g, lead: ms[0].name });
  return out;
}

function search() {
  const terms = termsOf(gotoIn.value);
  const sites = sitesOf(state.data.filter(s => s.name && s.lat));

  /* A place has been picked, so the question has changed: not "what matches what I typed" any more
     but "what is near where I picked". Nearest first — the whole point of the group is the order —
     and bounded by `NEAR_MAX_KM`, past which a station shares no catchment with the point asked
     about and naming it would be a worse answer than naming none.
     Rows are ordinary site rows, so a mast still opens its sensors and a press still flies the map:
     one row shape, one `pick()` branch, and nothing here to keep in step with the rest of the box.
     `nearPlace.name` is the one string in this list that came from Nominatim rather than JPS, so it
     is escaped on the way into the heading — see `escHtml` above. */
  if (nearPlace) {
    const at = L.latLng(nearPlace.lat, nearPlace.lon);
    const g = `Near ${escHtml(nearPlace.name)}`;
    hits = [...sites.entries()]
      .map(([key, ms]) => ({ key, ms, km: distKm(at, ms[0]) }))
      .filter(r => r.km <= NEAR_MAX_KM)
      .sort((a, b) => a.km - b.km)
      .flatMap(r => rowsFor(r.key, r.ms, g, `${r.km.toFixed(1)} km · ${where(r.ms[0])}`));
    if (!hits.length)
      hits = [{ t: 'msg', text: `No station within ${NEAR_MAX_KM} km of that place`, g }];
    return draw(true);
  }

  // No cap: an empty box lists all ~417 sites, which is what a select does. Rendering them is a few
  // milliseconds per keystroke, and virtualising a list nobody scrolls to the end of is not worth it.
  hits = [...sites.entries()]
    .filter(([, ms]) => !terms.length || matches(siteHay(ms), terms))
    // Heading first: a group is only a group if its rows are adjacent.
    .sort(([, a], [, b]) =>
      group(a[0]).localeCompare(group(b[0])) || a[0].name.localeCompare(b[0].name))
    .flatMap(([key, ms]) => rowsFor(key, ms, group(ms[0]), ''));

  /* Favorites lead an untouched box only. Once the reader types, the district headings are the
     answer, and a favorite that matches the query is already listed under its own district —
     printing it twice would put one place in two places in one list.
     A site is here when **any** sensor on it is starred, the same rule the pin badge and the map
     filter use, so all three surfaces answer one question — deliberately not the mast star's own
     rule of *every* sensor starred, which answers "is this whole mast one favorite", not "does this
     list belong here". */
  if (!terms.length) {
    const fav = [...sites.entries()].filter(([, ms]) => ms.some(isFav));
    hits.unshift(...fav.flatMap(([key, ms]) => rowsFor(key, ms, 'FAVORITES', where(ms[0]))));
  }

  // Below the favorites, not above: `unshift` would put "Nearest station to me" ahead of them, and a
  // permanent group belongs above a positional one.
  if (state.hereAt && (!terms.length || matches(squash('nearest station to me'), terms))) {
    const at = hits.findIndex(r => r.g !== 'FAVORITES');
    hits.splice(at < 0 ? hits.length : at, 0, { t: 'near', g: 'Your location' });
  }

  /* Results lead the list, the trigger row sits at its foot. A place is what the reader asked for
     when nothing local matched, so it belongs above; the offer to go and look is the last resort and
     belongs below.
     Nothing here on the GitHub Pages build: that build serves a baked api.json and `?place=` is a
     404 against a file with no opinion, exactly as "Refresh now" is. */
  if (!STATIC && terms.length) {
    if (places.length)
      hits.unshift(...places.map(p => ({ t: 'place', p, g: 'PLACES', sub: p.detail })));
    else if (pstate)
      hits.push({ t: 'msg', text: pstate, g: 'PLACES' });
    // The common case of the 80-character limit, caught here so it never reaches the server: a
    // long paste gets the same plain message the server's own 400 produces, without a round trip.
    // This is the courtesy half of the bound described on PLACE_MAX above — the server's own check
    // is what actually enforces it, including on the UTF-8 case this one does not catch.
    else if (gotoIn.value.trim().length > PLACE_MAX)
      hits.push({ t: 'msg', text: 'That search is too long — try a shorter place name.', g: 'PLACES' });
    else
      hits.push({ t: 'ask', g: 'PLACES' });
  }
  draw(true);
}

function draw(open = !gotoHits.hidden) {
  let last = null;
  gotoHits.innerHTML = hits.map((r, i) => {
    const head = r.g !== last ? `<li class="head" role="presentation">${r.g}</li>` : '';
    last = r.g;
    return head + rowHtml(r, i);
  }).join('') || '<li class="none">No station matches that</li>';
  gotoHits.hidden = !open;
  gotoIn.setAttribute('aria-expanded', open);
}

/* One row, whatever it stands for. The glyph is the mast's `layers` on a site of several sensors and
   the lead sensor's own glyph on a site of one — the same rule the pin follows, so a row and the pin
   it opens carry the same mark. */
function rowHtml(r, i) {
  const cls = i === sel ? ' class="sel" aria-selected="true"' : '';

  if (r.t === 'ask') return `<li role="option" data-i="${i}"${cls}
      ><i class="glyph i i-search" style="color:var(--accent)"></i
      ><span class="nm">Search the map for “${escHtml(gotoIn.value.trim())}”</span></li>`;

  /* Not an option and not selectable — pick() returns immediately on r.t === 'msg' — but it can
     still be the row `sel` is sitting on: the arrow keys walk every index in `hits` including this
     one, and Enter on the trigger row calls lookup(), which rebuilds `hits` with a "Searching…" row
     at the very index the trigger row just occupied, without sel ever moving off it. Dropping the
     `.sel` class here (the original bug) made the highlight vanish in both cases with no row on
     screen marked current. Showing it instead — without `role="option"`/`aria-selected`, since this
     is still not a real option — costs one class and keeps "where the keyboard is" visible even on a
     row that answers nothing back to Enter. */
  if (r.t === 'msg') return `<li class="none${i === sel ? ' sel' : ''}">${r.text}</li>`;

  if (r.t === 'place') return `<li role="option" data-i="${i}"${cls}
      ><i class="glyph i i-place" style="color:var(--accent)"></i
      ><span class="nm">${escHtml(r.p.name)}${
        r.sub ? `<br><small class="muted">${escHtml(r.sub)}</small>` : ''}</span></li>`;

  if (r.t === 'near') return `<li role="option" data-i="${i}"${cls}
      ><i class="glyph i i-my_location" style="color:var(--accent)"></i
      ><span class="nm">${NEAREST.name}</span></li>`;

  /* A sensor inside an open mast. Its own glyph and its own kind, because "which of the six" is the
     only question this row exists to answer. */
  if (r.t === 'sensor') {
    const k = KINDS[r.s.kind];
    return `<li role="option" data-i="${i}" class="sub${i === sel ? ' sel' : ''}"${
        i === sel ? ' aria-selected="true"' : ''}
      ><i class="glyph i i-${k.icon}" style="color:${k.color}"></i
      ><span class="nm">${k.one || k.label}${
        r.s.name !== r.lead ? `<br><small class="muted">${r.s.name}</small>` : ''
      }</span>${isFav(r.s) ? '<i class="i i-favorite fvm" role="img" aria-label="Favorite"></i>' : ''}</li>`;
  }

  const lead = r.ms[0], n = r.ms.length;
  const icon = n > 1 ? MAST.icon : KINDS[lead.kind].icon;
  const tint = n > 1 ? MAST.color : KINDS[lead.kind].color;
  const open = expanded.has(r.xkey);
  return `<li role="option" data-i="${i}"${cls}
      ><i class="glyph i i-${icon}" style="color:${tint}"></i
      ><span class="nm">${lead.name}${
        r.sub ? `<br><small class="muted">${r.sub}</small>` : ''}</span>${
      r.ms.some(isFav) ? '<i class="i i-favorite fvm" role="img" aria-label="Favorite"></i>' : ''}${
      /* No sensor count on the row. The mast glyph on the left already says this is a stack, the
         chevron on the right says it opens, and opening it lists the sensors themselves — which is
         the number, named. The station card dropped its own count for the same reason. */
      n > 1 ? `<button class="xp${open ? ' on' : ''}" data-x="${r.xkey}" tabindex="-1"
                aria-label="${open ? 'Hide' : 'Show'} the sensors at ${lead.name}"
          ><i class="i i-expand_more"></i></button>` : ''}</li>`;
}

function pick(i) {
  const r = hits[i];
  if (!r) return;
  /* The trigger row is the only thing here that does not close the box: the reader is still in the
     middle of the same search, and the answer arrives into the list they are looking at. */
  if (r.t === 'ask') {
    const q = gotoIn.value.trim();
    if (q.length >= 2) lookup(q);
    return;
  }
  if (r.t === 'msg') return;
  /* A searched place is not a destination — it is a second question. So this row is the one row in
     the box that opens no card and closes nothing: it drops the accent pin, moves the map, and hands
     the list back to the reader holding the stations near that point. The station they pick next is
     what actually flies the map, through the ordinary site branch below.
     The box keeps the place name so it is plain what the list is answering. Setting `.value` from
     script fires no `input` event, so the `nearPlace` set on the line above survives the assignment
     — the very thing `oninput` exists to clear.
     `gen++` for the same reason `oninput` bumps it: the reader may have picked one result while a
     lookup for a query they were still editing was in flight, and that answer must not paint its
     rows over the list this row just built. */
  if (r.t === 'place') {
    nearPlace = { name: r.p.name, lat: r.p.lat, lon: r.p.lon };
    gotoIn.value = r.p.name;
    places = [];
    pstate = '';
    gen++;
    sel = -1;
    showPlace(L.latLng(r.p.lat, r.p.lon));
    return search();
  }
  const t = r.t === 'near' ? nearest() : r.t === 'sensor' ? r.s : r.ms[0];
  if (!t) return;
  gotoIn.blur();
  setFind(false);   // the search is over — collapse it back to the button and give the bar its room
  flashTo(t);
  /* A sensor row and its mast row open the same card, because there is one card per site. So the
     sensor row says *which* sensor, by taking its block into view and marking it. flashTo() fires
     the marker's own click, which fills the panel synchronously, so the block is in the document by
     the time this line runs. */
  if (r.t !== 'sensor') return;
  const block = el('sideBody').querySelector(`[data-sensor="${t.id}"]`);
  if (!block) return;
  block.scrollIntoView({ block: 'nearest' });
  block.classList.remove('flash');
  block.offsetWidth;                 // restart the animation if the same block is picked twice
  block.classList.add('flash');
}

/* A place result belongs to the query that fetched it. Leaving stale hits under a changed query is
   the same lie a stale reading would be — and clearing `places`/`pstate` alone is not enough: a
   fetch from the query being edited away from can still be in flight (the `ask` row leaves the box
   open on purpose), and without bumping `gen` here too, that fetch's answer would still pass
   `my === gen` in lookup() and render under a box that has since moved on to a different query. See
   the comment on `gen`'s declaration above. */
gotoIn.oninput = () => {
  sel = -1;
  expanded.clear();
  places = [];
  pstate = '';
  nearPlace = null;
  gen++;
  search();
};
gotoIn.onfocus = search;
// Clicking away closes the whole thing, not just the list. The delay lets a click on a result land
// first — that fires `mousedown` → pick(), which closes it anyway; without the wait the field would
// be gone before the click completed.
gotoIn.onblur = () => setTimeout(() => setFind(false), 150);
gotoIn.onkeydown = e => {
  const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
  if (step) sel = Math.max(0, Math.min(hits.length - 1, sel + step));
  else if (e.key === 'Enter') return pick(sel < 0 ? 0 : sel);
  else if (e.key === 'Escape') return setFind(false);
  // The standard tree keys. The up and down arrows already walk visible rows only, because the
  // sub-rows are spliced into `hits` itself and not hidden with CSS.
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const r = hits[sel];
    if (!r || r.t !== 'site' || r.ms.length < 2) return;
    // `r.xkey`, not `r.key` — the row on screen is one occurrence of the mast, and only that
    // occurrence's chevron may open. See the comment on `expanded` above.
    e.key === 'ArrowRight' ? expanded.add(r.xkey) : expanded.delete(r.xkey);
    e.preventDefault();
    return search();
  }
  else return;
  e.preventDefault();
  draw();
  gotoHits.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
};
gotoHits.onmousedown = e => {
  /* Keep focus in the field. `gotoIn.onblur` closes the whole control after 150 ms, so a click that
     is meant to leave the list open has to stop the blur before it starts. pick() closes the box
     itself when it means to. */
  e.preventDefault();
  const x = e.target.closest('[data-x]');
  if (x) {
    const k = x.dataset.x;
    expanded.has(k) ? expanded.delete(k) : expanded.add(k);
    /* Re-point sel at the row the reader just clicked. Its sub-rows splice in *below* it, so
       expanding a row above the selected one shifts every index below by however many sensors it
       has — the old sel number would now land on a different row. The keyboard path (ArrowRight /
       ArrowLeft) never needs this: it always toggles the row at sel itself, and that row keeps its
       own index because its children are inserted after it, not before. */
    sel = +x.closest('[data-i]').dataset.i;
    return search();
  }
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
// Same jump from anywhere, the alert list included — it is inside #side now, and the card it opens
// takes the panel over, which is what a phone needed the old per-row handler to arrange by hand.
document.addEventListener('click', e => {
  const node = e.target.closest('[data-go]');
  if (!node) return;
  const t = byId(node.dataset.go);
  if (t) flashTo(t);
});

// --- lightbox --------------------------------------------------------------------------------------

// Two ways in: the still inside a popup, and the table's "show image" button, which has no <img>
// to click — it names the camera id and builds the same proxied URL.
const lightbox = el('lightbox');
document.addEventListener('click', e => {
  /* Resolve any click inside a `.shotwrap` to that wrapper's still. The warning glyph is a sibling
     of the img and takes its own pointer events, so a tap on it used to hit nothing at all — and on
     a phone it covered a corner of the picture it was warning about. It also needs a touch
     equivalent: the only explanation of the warning is a `title`, which no phone shows. Opening the
     lightbox is that equivalent, because the same warning is drawn there at full size.
     The table's `[data-shot]` button sits in no wrapper and keeps its own path. */
  const img = e.target.closest('img.shot')
           || e.target.closest('.shotwrap')?.querySelector('img.shot') || null;
  const btn = e.target.closest('[data-shot]');
  if (!img && !btn) return;
  e.stopPropagation();
  const full = lightbox.querySelector('.stage > img');
  // Spin until it lands. `complete` covers the popup's already-cached still, which fires no load
  // event — without that check the spinner would sit there for ever over a picture that is ready.
  lightbox.classList.add('loading');
  /* A clip frame's `src` names an archived shot, not the live picture, and the lightbox always
     opens on live. The wrapper carries `data-clip` with the camera's proxy id for exactly this:
     look the camera up and rebuild its live URL, rather than reading the clicked <img>'s current
     `src`. Only the table's "show image" button has no such wrapper, and keeps the old path. */
  const clipId = img?.closest('[data-clip]')?.dataset.clip;
  const clipCam = clipId ? byId(`camera-${clipId}`) : null;
  const src = clipCam ? camSrc(clipCam) : img ? img.src : btn.dataset.shot;
  full.src = src;
  if (full.complete) lightbox.classList.remove('loading');
  // The place, as the dialog's title. Both openers carry it as `data-name` rather than having this
  // strip a prefix off the alt text — "Latest still from X" is a caption, and parsing a caption back
  // into a name is a rule that breaks the day the caption is reworded.
  full.alt = (img ? img.alt : btn.dataset.cap) || '';
  /* The camera behind this still. Read back out of the proxied URL — `?cam=<n>` is the proxy's own
     shape, and the table's "show image" button builds the same URL, so both openers are covered by
     one rule. The static build hotlinks upstream and matches nothing here, which is correct: it has
     no archive and no payload behind it either. */
  const n = /[?&]cam=(\d+)/.exec(src || '')?.[1];
  const c = n ? byId('camera-' + n) : null;
  /* Place on the first line, district and state under it — the same order and the same words the
     station card puts in its `.pophead`, because it is the same question. A JPS camera is named for
     the road or the bridge it points at ("JAMBATAN SUNGAI DAMANSARA"), which places it only for
     somebody who already knows the area. The basin is left off: the card carries it, and it answers
     a question about the river rather than about where you are looking.
     `textContent` on both, not one interpolated string. These are upstream names. */
  const head = el('lbTitle');
  head.textContent = (img || btn).dataset.name || full.alt;
  const where = c && [c.district, c.state].filter(Boolean).join(', ');
  if (where) head.append(Object.assign(document.createElement('span'),
    { className: 'lbwhere', textContent: where }));
  lightbox.querySelector('.camwarn')?.remove();
  // `.player`, not `.stage`: on a phone the pill sits above the frame rather than in a corner of it,
  // and `.stage` is exactly the frame.
  if (c) lightbox.querySelector('.player').insertAdjacentHTML('beforeend', camWarn(c));
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
  el('splashMsg').textContent = 'Retrying…';
  load();
};
addEventListener('online', () => {
  if (!el('splash').classList.contains('gone')) el('splashRetry').onclick();
});
