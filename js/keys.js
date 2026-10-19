// The keyboard: one-key shortcuts, a cursor over the map pins, and arrow travel through rows.
//
// Nothing here owns a behavior. Every shortcut presses the same button a pointer presses, so the
// button flashes, `aria-expanded` follows and the rail state follows, through the one path that
// already exists. `js/timeline.js` states the same rule for the viewer keys. The module sits LAST
// in the import graph: nothing imports it, so no cycle can form. The two lazy chunks, the table and
// the camera wall, are reached by delegated listeners on `document` and import nothing from here.
//
// Written for the plan in docs/superpowers/specs/2026-10-19-keyboard-navigation-design.md.

import { map, pins, siteMark, side, markSel, setKb } from './map.js';

/* The shortcut table. Each key names the ids of the controls it presses. The first id is the one
   pressed, and every id in the list carries `aria-keyshortcuts`, because the rail and the app bar
   draw twins of one control and only one of them is on screen at a width. A control hidden by
   `display: none` still runs its `onclick` on `.click()`, so one id serves both widths.
   **`?` is Shift and `/` on most layouts, and the handler reads `e.key`, which already holds the
   shifted character.** So Shift is the one modifier it lets through. Ctrl, Alt and Meta belong to
   the browser and the operating system. Exported so `keys-test.html` can compare it with the Help
   section, and the Help section cannot drift from the code. */
export const KEYS = {
  '/': ['railFind', 'navFind'],
  a: ['railAlerts', 'navAlerts'],
  t: ['railTable', 'navTable'],
  c: ['railCams', 'navCams'],
  s: ['railSettings', 'menuSettings'],
  '?': ['railHelp', 'menuHelp'],
  l: ['locate'],
  d: ['railApps', 'navTheme'],
};

// `js/locate.js` builds `#locate` after the map, so it may not exist yet. Every press looks it up.
const tag = () => {
  for (const [key, ids] of Object.entries(KEYS))
    for (const id of ids) {
      const b = document.getElementById(id);
      b?.setAttribute('aria-keyshortcuts', key);
      /* `data-key` is the hint a reader SEES, and only the rail and the locate button carry it. The
         rail is the desktop surface, and a tap on a phone control opens a label, so a key printed
         there is noise. `css/chrome.css` draws it on the open rail, and `js/sparktip.js` adds it to
         the hover and focus label for a mouse or a keyboard. */
      if (id.startsWith('rail') || id === 'locate') b?.setAttribute('data-key', key);
    }
};
tag();

/* **Keyboard mode: the keycaps show only while the reader is using the keyboard.** The owner asked
   on 2026-10-19 for the hint not to show all the time. A key pressed outside a text field turns the
   mode on, and the next mouse or touch press turns it off. That is the same judgment the browser
   makes for `:focus-visible`. A mouse reader never sees the caps, and the hover label still names
   the key for them (js/sparktip.js). A key typed into a field is text and not navigation, so it
   leaves the mode alone. `.click()` from a shortcut fires no `pointerdown`, so a shortcut keeps the
   mode on. */
const kbmode = on => document.body.classList.toggle('kbmode', on);
document.addEventListener('keydown', e => { if (!typing(e.target)) kbmode(true); }, true);
document.addEventListener('pointerdown', () => kbmode(false), true);

/* A key never fires while a reader types. A radio or a checkbox takes a letter as nothing, so those
   two pass. */
const typing = t => !!t.closest?.(
  'input:not([type=radio]):not([type=checkbox]), textarea, select, [contenteditable]');

document.addEventListener('keydown', e => {
  if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
  if (typing(e.target)) return;
  /* A modal dialog owns the keyboard. The camera viewer, Settings, Help, About, the table and the
     wall are all modal, and a key that changed the page under one would act on what the reader
     cannot see. Escape is not in the table: the browser already closes every dialog and popover
     with it. `:modal` is false for the supporting pane above 600px, which is a `show()` dialog. */
  if (document.querySelector('dialog:modal')) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const ids = KEYS[k];
  if (!ids) return;
  // `locate.js` writes the button after load, so tag again: a press is also the moment to catch it.
  const b = document.getElementById(ids[0]);
  if (!b) return;
  e.preventDefault();       // `/` would otherwise be typed into the field the press just focused
  b.click();
  if (k === '?') document.getElementById('helpKeys')?.scrollIntoView({ block: 'start' });
});

// --- the map cursor ----------------------------------------------------------------------------

/* The pins are a canvas, so the keyboard gets a cursor and not a focus. The cursor IS the selection
   mark: `markSel()` swaps the pin it stands on for the red teardrop, and `setKb()` gives that
   teardrop the focus ring. A cluster chip has no teardrop, so `pins.setCursor()` draws the ring on
   the canvas. Plain arrows keep panning, because Leaflet owns them. Shift and an arrow is free. */
const box = map.getContainer();
box.setAttribute('role', 'application');
box.setAttribute('aria-roledescription', 'Map');
box.setAttribute('aria-label', 'Map of flood stations');
box.setAttribute('aria-describedby', 'mapKeys');

box.insertAdjacentHTML('afterend',
  '<p id="mapKeys" hidden>Arrow keys pan the map. Shift and an arrow key moves between stations. '
  + 'Enter opens the station. Press the question mark for every key.</p>'
  + '<div id="mapSay" class="sr-only" aria-live="polite" role="status"></div>');
const say = s => { document.getElementById('mapSay').textContent = s; };

const DIR = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
// A mark counts as "that way" when it is within 45 degrees of the arrow.
const COS = Math.cos(Math.PI / 4);

let cur = null;   // { marker, chip }: the mark the cursor stands on

const at = marker => map.latLngToContainerPoint(marker.getLatLng());
const first = d => d.g.items[0].marker;

/* The canvas regroups on every zoom and every `markSel()` that changes the key, so a group object
   held across one is stale. The marker is the stable thing, and the group is found again by it. */
const regroup = marker => pins.marks().find(d => first(d) === marker)?.g || null;

function clear() {
  if (!cur) return;
  cur = null;
  setKb(false);
  pins.setCursor(null);
  markSel(side.key);       // back to the open card's mark, or to none
}
map.on('mousedown dragstart zoomstart', clear);
box.addEventListener('focusout', e => { if (!box.contains(e.relatedTarget)) clear(); });

function land(d) {
  const marker = first(d), chip = d.g.n > 1;
  cur = { marker, chip };
  setKb(true);             // before markSel(), so the new teardrop is built with its ring
  if (chip) {
    markSel(null);
    pins.setCursor(regroup(marker));
    say(`${d.g.n} stations. Press Enter to zoom in.`);
  } else {
    pins.setCursor(null);
    markSel(marker.options.site);
    say(marker.options.say);
  }
}

function step(key) {
  const size = map.getSize();
  // Only what is on screen: a mark in the canvas's padding is a mark the reader cannot see.
  const seen = pins.marks().filter(d => d.x >= 0 && d.y >= 0 && d.x <= size.x && d.y <= size.y);
  const centre = { x: size.x / 2, y: size.y / 2 };
  const near = (from, list) => list.reduce((best, d) =>
    !best || Math.hypot(d.x - from.x, d.y - from.y) < Math.hypot(best.x - from.x, best.y - from.y)
      ? d : best, null);
  const marker = cur?.marker || siteMark.get(side.key);

  if (key === 'Home' || !marker) {
    const d = near(centre, seen);
    return d ? land(d) : say('No stations in view.');
  }
  const from = at(marker), dir = DIR[key];
  let best = null, bestDist = Infinity;
  for (const d of seen) {
    if (first(d) === marker) continue;
    const dx = d.x - from.x, dy = d.y - from.y, dist = Math.hypot(dx, dy);
    if (!dist || (dx * dir[0] + dy * dir[1]) / dist < COS) continue;
    if (dist < bestDist) { best = d; bestDist = dist; }
  }
  best ? land(best) : say('No station that way.');
}

// Capture and stop, so Leaflet's own handler never pans on the same press.
box.addEventListener('keydown', e => {
  if (e.ctrlKey || e.altKey || e.metaKey || e.target !== box) return;
  if (e.shiftKey && DIR[e.key]) { e.preventDefault(); e.stopImmediatePropagation(); return step(e.key); }
  if (e.key === 'Home' && !e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); return step('Home'); }
  if ((e.key === 'Enter' || e.key === ' ') && cur) {
    e.preventDefault(); e.stopImmediatePropagation();
    // The press a pointer makes on a chip, which `pins.js` states as `zoomToBoundsOnClick`.
    if (cur.chip) {
      const g = regroup(cur.marker);
      if (g) map.fitBounds(L.latLngBounds(g.items.map(it => it.marker.getLatLng())).pad(0.2),
        { maxZoom: map.getMaxZoom() });
      return;
    }
    cur.marker.fire('click');
  }
}, true);

// --- arrow travel through rows -----------------------------------------------------------------

/* Move focus along `sel`, from the element that holds it. `cols` is 1 for a list. A grid passes its
   column count, so Up and Down step a whole row and Left and Right step one tile. A row inside a
   closed section is not rendered, and `checkVisibility()` is how a closed `<details>` says so. */
function travel(e, sel, cols = 1) {
  const list = [...document.querySelectorAll(sel)].filter(r => r.checkVisibility());
  const i = list.indexOf(e.target);
  if (i < 0) return false;
  const k = e.key;
  let to;
  if (k === 'Home') to = 0;
  else if (k === 'End') to = list.length - 1;
  else if (k === 'ArrowDown') to = i + cols;
  else if (k === 'ArrowUp') to = i - cols;
  else if (cols > 1 && k === 'ArrowRight') to = i + 1;
  else if (cols > 1 && k === 'ArrowLeft') to = i - 1;
  else return false;
  e.preventDefault();
  if (to >= 0 && to < list.length) list[to].focus();
  return true;
}

const ROWS = '#sideBody .slist li[data-go], #sideBody details[data-sec] > summary';
const TABLE = '#dataBody tr[data-mast]';

document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
  const t = e.target;
  if (!(t instanceof Element)) return;

  /* Enter and Space on a row that is not a native button. A native button presses itself, so the
     test is `t === row` on the three shapes that are not one. Every one reaches the handler the
     pointer reaches, through `.click()`. */
  if ((e.key === 'Enter' || e.key === ' ') && t.matches('li[data-go], tr[data-mast], th[data-sort]')) {
    e.preventDefault();
    return t.click();
  }

  if (t.matches('#sideBody li[data-go]')) {
    const d = t.closest('details');
    if (e.key === 'ArrowLeft' && d?.open) {          // fold the section and stand on its heading
      e.preventDefault(); d.open = false; return d.querySelector('summary').focus();
    }
    return travel(e, ROWS);
  }
  if (t.matches('#sideBody details[data-sec] > summary')) {
    const d = t.parentElement;
    if (e.key === 'ArrowRight' && !d.open) { e.preventDefault(); return void (d.open = true); }
    if (e.key === 'ArrowLeft' && d.open) { e.preventDefault(); return void (d.open = false); }
    return travel(e, ROWS);
  }
  if (t.matches(TABLE)) return travel(e, TABLE);

  if (t.matches('#camGrid .camtile')) {
    const cols = getComputedStyle(t.parentElement).gridTemplateColumns.split(' ').length;
    return travel(e, '#camGrid .camtile', cols);
  }
  // The kinds menu holds checkboxes, which the browser gives no arrow travel of their own.
  if (t.matches('#kindMenu input')) return travel(e, '#kindMenu input');
});

/* The alert list is rebuilt on every poll, and a focused row is destroyed with it. Focus falls to
   `<body>`, and a reader arrowing down the list is thrown out of it. This puts focus back on the
   same station's row, the way `syncOpen()` in js/alerts.js puts back the folds. */
let lastRow = null;
document.addEventListener('focusin', e => {
  const t = e.target;
  lastRow = t.matches?.('#sideBody li[data-go]') ? `li[data-go="${t.dataset.go}"]`
          : t.matches?.(TABLE) ? `tr[data-mast="${t.dataset.mast}"]` : null;
});
for (const id of ['sideBody', 'dataBody']) {
  const host = document.getElementById(id);
  if (host) new MutationObserver(() => {
    if (lastRow && document.activeElement === document.body)
      host.querySelector(lastRow)?.focus({ preventScroll: true });
  }).observe(host, { childList: true, subtree: true });
}
