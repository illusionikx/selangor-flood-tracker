# All cameras and the App menu — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put every camera that publishes a picture on one page, each playing what the archive holds
of its last three hours, and move the view buttons into one App menu to make room for it.

**Architecture:** One new module, `js/wall.js`, builds a grid of tiles and drives them with a single
timer. An `IntersectionObserver` arms a tile the first time it scrolls into view, so a tile costs
nothing until a reader looks at it. A poll never rebuilds the grid. It calls `paint()`, which
rewrites the alert border and the alert phrase on the tiles that already exist. The App menu is a
native `popover` that reuses the `.menu` component and the placement handler both already in the
repository.

**Tech Stack:** Plain ES modules, no build step, no framework, no new dependency. Native `<dialog>`,
native `popover`, native `IntersectionObserver`, CSS grid.

**Spec:** [`docs/superpowers/specs/2026-08-10-all-cameras-design.md`](../specs/2026-08-10-all-cameras-design.md)

## Global Constraints

Every task inherits all of these.

- **No build step.** The browser resolves the `import`s. Keep relative specifiers and the `.js`
  extension. Nothing resolves a bare name.
- **No new dependency, and no test framework.** This repository has no client-side test runner, and
  adding one breaks the build-free rule. Verification is `node --check`, a content-type sweep and
  named browser checks. Do not install anything. Do not write a `package.json`.
- **No cycles.** `js/wall.js` imports only these six: `config.js`, `state.js`, `util.js`,
  `stations.js`, `popup.js` and `map.js`. It must not import `render.js` or `ui.js`.
- **No hex color in a JavaScript file.** Colors come from tokens in `css/base.css`. The one
  exception is a literal white over a photograph, which the CSS already does for `.camwarn`.
- **Bump `?v=` on `css/chrome.css` in `index.html`** in the first task that edits that stylesheet.
  It stands at `?v=125`. Take it to `126` once, not once per task.
- **Hard-reload the browser after every `js/` change.** ES module imports carry no `?v=`.
- **Sentence case in every string a reader sees.** No hedging. No words from our own vocabulary:
  no `proxy`, no `poll`, no `cold start`.
- **American spelling.**
- **Responsive at 600px**, and a touch equivalent for anything that answers to hover.
- **Commit messages follow this repository, not Conventional Commits.** One sentence, sentence case,
  stating what changed and why. Read `git log --oneline -10` for the voice. No `feat:` prefix.

---

## File structure

| file | responsibility after this plan |
|---|---|
| `js/wall.js` | **new.** Builds the grid, arms tiles, runs the one timer, paints alerts, tears down |
| `js/ui.js` | the App menu, the dialog open and close, the filter, the delegated tile click |
| `js/util.js` | gains three pure string helpers moved out of `js/ui.js` |
| `js/popup.js` | gains `camPhrase()`, which `camWarn()` then calls, so one river makes one claim |
| `js/render.js` | one line: call `paint()` while the dialog is open |
| `index.html` | the App menu, the `#camBox` dialog, two buttons removed from the app bar |
| `css/chrome.css` | the dialog, the grid, the tile, the name, the phrase, the hover query |

`js/wall.js` holds the grid and the clock. `js/ui.js` holds every binding, which is the rule the
file table in `CLAUDE.md` already states. The split is the same one `js/table.js` and `js/ui.js`
keep today.

---

## Task 1: The App menu

The app bar's right group holds seven buttons and fills the bar at 360 pixels. Two of them open a
dialog. Both move into one menu, which makes room for the third.

This task ships a menu with three items. Task 2 adds the fourth when the dialog it names exists.

**Files:**
- Modify: `index.html:180-186` (the `.hactions` group)
- Modify: `js/ui.js:29-34` (the About binding)
- Modify: `js/ui.js:178-181` (the table binding)
- Modify: `css/chrome.css` (one rule)

**Interfaces:**
- Consumes: `.menu` and `.mi` from `css/chrome.css:467`, and the delegated placement handler at
  `js/ui.js:530`. Change neither.
- Produces: a button `#apps`, a popover `#appMenu`, and the ids `#data`, `#help` and `#about` on
  menu items. Task 2 adds `#cams` to the same menu.

- [ ] **Step 1: Replace the two buttons with the menu**

In `index.html`, find these two lines inside `.hactions`:

```html
    <button id="data" class="icon" title="All stations as a table"
            aria-label="All stations as a table"><i class="i i-list_alt"></i></button>
    <button id="about" class="icon" title="Help and about"
            aria-label="Help and about"><i class="i i-info"></i></button>
```

Replace both with:

```html
    <!-- The two dialogs used to be two buttons here, and the right group filled the bar at 360px.
         `.menu` is the component the sensor menu uses, and the delegated handler in js/ui.js places
         every popover carrying that class, so this needs no positioning code of its own.
         `position: fixed` on `.menu` keeps the panel out of this flex row. -->
    <button id="apps" class="icon" title="Views" aria-label="Views"
            popovertarget="appMenu"><i class="i i-more_vert"></i></button>
    <div id="appMenu" class="menu surface" popover>
      <button class="mi" id="data"><i class="i i-list_alt"></i>All stations as a table</button>
      <button class="mi" id="help"><i class="i i-info"></i>Help</button>
      <button class="mi" id="about"><i class="i i-flood"></i>About</button>
    </div>
```

`i-more_vert` already exists in `css/icons.css` and no file uses it. Nothing needs a fetch, and
`css/icons.css` keeps its current `?v=`.

- [ ] **Step 2: Close the menu on any click inside it**

In `js/ui.js`, directly under `const aboutBox = el('aboutBox');` at line 29, add:

```js
/* One handler closes the menu, whichever item was hit. Capture, not bubble: an item's own handler
   calls showModal(), and a dialog that opens while its opener is still in the top layer is a
   sequence worth not testing. Capture runs the parent first, so the menu is gone before the dialog
   arrives. */
const appMenu = el('appMenu');
appMenu.addEventListener('click', () => appMenu.hidePopover(), true);
```

- [ ] **Step 3: Give Help its own way in**

In `js/ui.js`, replace line 33:

```js
el('about').onclick = () => { closeSide(); paintDev(); aboutBox.showModal(); };
```

with:

```js
el('about').onclick = () => { closeSide(); showPane('tabAbout'); aboutBox.showModal(); };
el('help').onclick  = () => { closeSide(); showPane('tabHelp');  aboutBox.showModal(); };
```

`showPane('tabAbout')` calls `paintDev()` itself, at `js/ui.js:49`, so the explicit call goes.

The tabs stay inside the dialog. They are the way across between the two panes, and a reader who
opens Help and then wants About must not have to close and reopen.

`showPane` is declared with `function`, so it hoists above these two lines. Leave it where it is.

- [ ] **Step 4: Leave the table binding alone**

`js/ui.js:179` reads:

```js
el('data').onclick = () => { closeSide(); dataTable(); dataBox.showModal(); el('dataFind').focus(); };
```

`#data` is now a menu item rather than a bar button. The id did not change, so this line needs no
edit. Read it and confirm it. Change nothing.

- [ ] **Step 5: Let a menu item hold a label**

In `css/chrome.css`, under the `.mi` rules near line 481, add:

```css
/* The sensor menu's items wrap to two lines and hold a `<small>`. These are one line each, and a
   label that wrapped in a four-item menu would read as four paragraphs. */
#appMenu .mi { align-items: center; white-space: nowrap; }
```

- [ ] **Step 6: Bump the stylesheet version**

In `index.html`, change `href="css/chrome.css?v=125"` to `href="css/chrome.css?v=126"`.

Herd serves every file with a three-hour max-age. Without this the rule above does not arrive.

- [ ] **Step 7: Syntax-check the modules**

```bash
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
```

Expected: no output. Any `FAIL` line is a parse error to fix before moving on.

- [ ] **Step 8: Check it in the browser**

Hard-reload `https://flood-exp.test`, then check each of these:

1. The app bar right group holds five buttons: find, alert, apps, locate, theme.
2. The ⋮ button opens a panel under itself with three rows.
3. Esc closes the panel. A click on the map closes it.
4. `All stations as a table` opens the table, and the panel closes with it.
5. `Help` opens the dialog on the Help pane.
6. `About` opens the dialog on the About pane, with the Developer section painted.
7. Inside the dialog, the two tabs still switch panes.
8. Narrow the window to 360 pixels. The bar does not wrap, and the panel stays on screen.

- [ ] **Step 9: Commit**

```bash
git add index.html js/ui.js css/chrome.css
git commit -m "Two dialogs become one menu, and Help gets its own way in"
```

---

## Task 2: The dialog, the grid and the tiles

A grid of live stills that opens, closes and answers a click. No motion yet, and no alert border
yet. This task is finished when a reader can open 91 pictures and tap one to reach its station.

**Files:**
- Create: `js/wall.js`
- Modify: `index.html` (a menu row, and a dialog after `#dataBox` at line 616)
- Modify: `js/ui.js` (the open path, the close path, the delegated click)
- Modify: `css/chrome.css` (the dialog, the grid, the tile, the name)
- Modify: `CLAUDE.md` (one row in the file table)

**Interfaces:**
- Consumes: `camSrc(s)` from `js/config.js`, `state.data` from `js/state.js`, `el()` from
  `js/util.js`, `byId()` from `js/stations.js`, `flashTo()` from `js/map.js`.
- Produces: `open()`, `close()` and `count(shown)` from `js/wall.js`. Task 3 adds the tick to the
  same module. Task 4 adds `paint()`. Task 5 calls `count(shown)` with a number.

- [ ] **Step 1: Add the menu row**

In `index.html`, inside `#appMenu`, add one line after the `#data` item:

```html
      <button class="mi" id="cams"><i class="i i-photo_camera"></i>All cameras</button>
```

`--i-photo_camera` is the camera kind's own glyph, named by `KINDS.camera.icon` in `js/config.js`.
Two glyphs for one kind teaches a reader two things for one meaning.

- [ ] **Step 2: Add the dialog**

In `index.html`, directly after the `</dialog>` that closes `#dataBox` at line 616, add:

```html
<!-- Every camera on one page. The same shell as #dataBox: a top that stays put, then the thing you
     came for. The filter and its count arrive with the filter itself. -->
<dialog id="camBox">
  <div class="dtop">
    <div class="modalhead">
      <h2>All cameras</h2>
      <form method="dialog"><button class="icon dclose" title="Close" aria-label="Close"
      ><i class="i i-close"></i></button></form>
    </div>
    <p id="camCount" class="muted"></p>
  </div>
  <div id="camGrid"></div>
</dialog>
```

- [ ] **Step 3: Write the module**

Create `js/wall.js`:

```js
/* Every camera the feeds publish, on one page.
 *
 * The station panel answers one camera at a time. 91 of the 93 cameras publish a picture, and
 * nobody scans a state by opening 91 cards. A camera is also the one sensor that needs no mark to
 * compare against — a picture of a flooded road answers by itself — so a page of pictures is the
 * fastest read this data supports.
 *
 * The grid is built once, on open. It is never rebuilt, and js/render.js calls paint() instead of
 * rebuilding it. A tile holds four things the payload does not: the frame it is showing, the frame
 * list it fetched, the images it warmed, and whether the observer reached it yet. A rebuild throws
 * all four away, which drops every visible tile back to the start of its lap.
 *
 * ponytail: one timer for the whole page, not one per tile. 91 timers at 1 Hz is 91 wakeups a
 * second where one will do, and tiles that step together read as one thing rather than as 91
 * pictures out of phase. If a tile ever needs its own rate, this is the line to revisit.
 */
import { CLIP_WIN, CLIP_MS, camSrc } from './config.js';
import { state } from './state.js';
import { el, squash } from './util.js';

/* Per-tile state, keyed by the element. Not in `dataset`: `at` moves once a second on every tile
   on screen, and a dataset write is a string round trip through the DOM for a number nothing
   outside this module reads. Clearing the map is also the whole teardown — see close(). */
const laps = new Map();
let timer = null;
let io = null;

/* Sorted by state, then district, then name. That is the order js/table.js groups by, and two
   views both named "all" must not sort two ways. */
const cameras = () => state.data
  .filter(s => s.kind === 'camera' && s.image)
  .sort((a, b) => `${a.state}|${a.district}|${a.name}`
    .localeCompare(`${b.state}|${b.district}|${b.name}`));

/* `data-cam` is the numeric id the proxy takes, the same value `data-clip` carries in camImg().
   `data-hay` is squashed here rather than at match time: it never changes, and the filter in
   js/ui.js runs on every keystroke.
   ponytail: no `data-mast`. js/table.js puts a site key on a row because a row is a mast. A tile
   is one camera, and the click resolves it by its own id. */
const tileHtml = c => `<button class="camtile" data-cam="${c.id.split('-')[1]}" data-hay="${
  squash(`${c.name} ${c.district || ''} ${c.state || ''}`)}"><img loading="lazy" alt="" src="${
  camSrc(c)}"><span class="camname">${c.name}</span></button>`;

export function open() {
  const cams = cameras();
  const grid = el('camGrid');
  grid.innerHTML = cams.map(tileHtml).join('');
  laps.clear();
  [...grid.children].forEach((t, i) => laps.set(t, {
    cam: cams[i], live: camSrc(cams[i]), shots: [], at: 0, ready: false, seen: false,
  }));
  count();
}

export function close() {
  clearInterval(timer);
  timer = null;
  io?.disconnect();
  io = null;
  laps.clear();
  el('camGrid').innerHTML = '';
}

/* The count line. `shown` is the number the filter left visible, and it defaults to all of them so
   open() and the filter write the same line through the same function.
   A filter that empties a view in silence reads as a broken view, so the empty case says so. */
export function count(shown = laps.size) {
  const total = laps.size;
  el('camCount').textContent = !total ? 'No cameras'
    : !shown ? 'No camera matches that name.'
    : shown === total ? `${total} cameras`
    : `${shown} of ${total} cameras`;
}
```

- [ ] **Step 4: Move `squash()` into `js/util.js`**

`js/wall.js` imports `squash` from `js/util.js`, and `js/ui.js` declares it today. Move it. It is a
pure string helper, which is what `js/util.js` holds.

Cut this line from `js/ui.js:634`:

```js
const squash = t => t.toLowerCase().replace(/[^a-z0-9]/g, '');
```

Add it to the end of `js/util.js`, exported, with the reason it exists:

```js
/* JPS writes one place as `I.K.B.N.`, `IKBN` and `I K B N`. Squashing reads all three as one word.
   Two callers now: the go-to box's matcher in js/ui.js, and the camera filter's haystack in
   js/wall.js. */
export const squash = t => t.toLowerCase().replace(/[^a-z0-9]/g, '');
```

Add `squash` to the existing `import { … } from './util.js'` list at `js/ui.js:5`.

- [ ] **Step 5: Wire the dialog**

In `js/ui.js`, directly under the table block that ends at line 181, add:

```js
// --- all cameras ---------------------------------------------------------------------------

const camBox = el('camBox');
el('cams').onclick = () => { closeSide(); wall.open(); camBox.showModal(); };
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
```

Add the import at the top of `js/ui.js`, under the other module imports near line 11:

```js
import * as wall from './wall.js';
```

`byId` and `flashTo` are already imported at lines 8 and 6. Confirm both before you rely on them.

- [ ] **Step 6: Style it**

Append to `css/chrome.css`, after the all-stations table block that ends near line 331:

```css
/* --- all cameras ----------------------------------------------------------------------------- */

/* The same shell as #dataBox. This one is for scanning too, so it takes the screen. */
#camBox {
  width: min(1060px, calc(100vw - 24px)); height: min(88vh, 900px); padding: 0;
  flex-direction: column; overflow: hidden;
  border: 1px solid var(--outline); border-radius: 12px;
  background: var(--surface); color: var(--on-surface); box-shadow: var(--shadow);
}
/* On `[open]`, never on the element. #dataBox above carries the full account of what a `display`
   on the element itself does to a closed dialog. */
#camBox[open] { display: flex; }
#camBox::backdrop { background: #0009; }
#camBox .dtop {
  flex: none; padding: 16px 20px 12px;
  border-bottom: 1px solid var(--outline); background: var(--surface);
}
#camBox h2 { font-size: 18px; font-weight: 500; }

/* One declaration answers the whole responsive question: one column at 360px, four or five in the
   dialog. No script measures anything. */
#camGrid {
  flex: 1; overflow: auto; padding: 12px 20px 20px;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px;
}

/* A <button>, so keyboard reach, Enter, Space and the focus ring all come free. */
.camtile {
  position: relative; display: block; padding: 0; overflow: hidden; cursor: pointer;
  aspect-ratio: 4 / 3; border: 2px solid var(--outline); border-radius: 10px;
  background: var(--hover); color: var(--on-surface); text-align: left;
}
.camtile > img { display: block; width: 100%; height: 100%; object-fit: cover; }
/* `display: block` above beats the browser's own `[hidden]` rule, so it has to be said again. The
   filter in js/ui.js sets `hidden`, and `.link` and `.camwarn` both carry the same restatement. */
.camtile[hidden] { display: none; }

/* Over the foot of the picture, on a gradient. In flow under it, the name would cost a row of
   height on every tile to label the quiet ones.
   The white is literal, like `.camwarn`'s. A token flips with the theme and the photograph does
   not. */
.camname {
  position: absolute; left: 0; right: 0; bottom: 0; padding: 14px 8px 6px;
  font: 500 12px/1.3 Roboto, sans-serif; color: #fff;
  background: linear-gradient(transparent, rgb(0 0 0 / .72));
  text-shadow: 0 1px 3px rgb(0 0 0 / .95);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  pointer-events: none;
}

/* Hover-to-reveal is the special case and lives behind both halves of the query, exactly as
   PLAYER_OVERLAY does and for the same reason. Outside it the name stays on. A device that reports
   `hover: hover` wrongly then shows too much, which is a failure a reader can still work with.
   `:focus-visible` too, or a keyboard reader tabs through 91 unnamed pictures. */
@media (hover: hover) and (min-width: 601px) {
  .camname { opacity: 0; transition: opacity .15s; }
  .camtile:hover .camname, .camtile:focus-visible .camname { opacity: 1; }
}

@media (max-width: 600px) {
  #camBox { width: 100vw; height: 100dvh; max-width: none; border-radius: 0; border: 0; }
  #camGrid { padding: 12px; }
}
```

- [ ] **Step 7: Add the file-table row**

In `CLAUDE.md`, in the `## Files` table, add a row directly under the `js/ui.js` row:

```
| `js/wall.js` | the camera wall: every camera on one page, one timer for all of them |
```

- [ ] **Step 8: Syntax-check the modules**

```bash
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
```

Expected: no output.

- [ ] **Step 9: Check every file still serves**

```bash
for f in js/*.js css/*.css; do
  curl -sk -o /dev/null -w "%{content_type} $f\n" "https://flood-exp.test/$f"; done | grep -v 'javascript\|css'
```

Expected: no output. Herd answers a missing file with `index.html` and a 200, so a status check
proves nothing and a type check proves the file is there.

- [ ] **Step 10: Check it in the browser**

Hard-reload, then:

1. Open ⋮ → `All cameras`. The dialog fills the screen and shows a grid of pictures.
2. The count line reads `91 cameras`. Compare it against the payload:
   `php -r '$p=json_decode(file_get_contents(".cache.json"),true);echo count(array_filter($p["stations"],fn($s)=>$s["kind"]==="camera"&&$s["image"])),"\n";'`
3. Hover a tile on a desktop. The name appears. Move away. It goes.
4. Tab into the grid. The focus ring shows, and the name appears on the focused tile.
5. Click a tile. The dialog closes, the map flies, the ripple lands and the station panel opens on
   that camera.
6. Reopen the dialog and press Esc. It closes.
7. Narrow to 360 pixels. One column, the name on every tile at all times, and no horizontal scroll.
8. Switch the theme with the dialog open. The surface and the outline follow.

- [ ] **Step 11: Commit**

```bash
git add index.html js/wall.js js/ui.js js/util.js css/chrome.css CLAUDE.md
git commit -m "Every camera lands on one page, and a tile takes you to its pin"
```

---

## Task 3: The laps

Each tile plays what the archive holds of its last three hours. One timer drives all of them, and a
tile costs nothing until a reader scrolls to it.

**Files:**
- Modify: `js/wall.js`

**Interfaces:**
- Consumes: `open()`, `close()` and the `laps` map from Task 2.
- Produces: nothing new that a later task imports. `open()` gains the observer and the timer.
  `close()` already tears both down.

- [ ] **Step 1: Add the observer and the tick**

In `js/wall.js`, add these three functions above `open()`:

```js
/* A tile is armed the first time it comes into view, and never again. Arming costs one call to
   ?shots= and one warm-up of the lap. Eager, this page is 91 of those calls and about 80 MB of
   frames, which is why nothing loads until a reader looks at it.
   `ready` is set before the first await. Two intersections can arrive before the fetch returns,
   and the flag is the only thing stopping the second one fetching again. */
async function arm(t, L) {
  L.ready = true;
  let rows = [];
  try { rows = await (await fetch(`api.php?shots=${t.dataset.cam}`)).json(); } catch { rows = []; }
  /* `?shots=` returns [ts, tier, stationId] rows and its answer is cached for 60 seconds, so a
     deploy leaves the old bare-number shape in flight. js/clip.js and js/timeline.js both carry
     this guard. Do not remove it while that cache header stands.
     On the GitHub Pages build there is no api.php at all: the fetch fails, `rows` stays empty, and
     the tile keeps the still it already drew. That is the same answer js/clip.js gives. */
  if (!Array.isArray(rows)) return;
  const cut = Date.now() / 1000 - CLIP_WIN;
  const shots = rows.map(r => Array.isArray(r) ? r[0] : r).filter(ts => ts >= cut);
  /* Fewer than two frames is not a lap. Keep the live still the tile already drew — an empty
     window means this server did not capture, not that the camera stopped, and reaching further
     back would replace a live picture with a stale one. */
  if (shots.length < 2) return;
  // Warm the whole lap before it starts. The frames come off local disk and the server marks them
  // immutable for a year, so every lap after the first costs nothing and the first does not flicker.
  await Promise.all(shots.map(ts => {
    const im = new Image();
    im.src = `api.php?shot=${t.dataset.cam}&t=${ts}`;
    return im.decode().catch(() => {});
  }));
  // close() clears the map, so this is the whole generation guard: the tile the fetch started for
  // is gone, and so is the reader who asked for it.
  if (!laps.has(t)) return;
  L.shots = shots;
}

function onSee(entries) {
  for (const e of entries) {
    const L = laps.get(e.target);
    if (!L) continue;
    L.seen = e.isIntersecting;
    if (e.isIntersecting && !L.ready) arm(e.target, L);
  }
}

/* The live still is the last position, the same way js/clip.js and the lightbox scrubber treat it:
   the lap is "how did it get to this", and one that stopped short of now never showed the this.
   A tile the filter hid reports as not intersecting, so `seen` goes false and its place freezes.
   The browser does that part — there is no filter check here. */
function tick() {
  for (const [t, L] of laps) {
    if (!L.seen || L.shots.length < 2) continue;
    L.at = (L.at + 1) % (L.shots.length + 1);
    const img = t.firstElementChild;
    if (img) img.src = L.at >= L.shots.length
      ? L.live : `api.php?shot=${t.dataset.cam}&t=${L.shots[L.at]}`;
  }
}
```

- [ ] **Step 2: Start them in `open()`**

In `js/wall.js`, replace the last line of `open()`:

```js
  count();
```

with:

```js
  count();
  /* `root` is the grid, because the grid scrolls and the page behind it does not. The margin arms
     a tile just before it arrives, so a lap is warm by the time a reader reaches it. */
  io = new IntersectionObserver(onSee, { root: grid, rootMargin: '200px' });
  for (const t of laps.keys()) io.observe(t);
  timer = setInterval(tick, CLIP_MS);
```

- [ ] **Step 3: Syntax-check the modules**

```bash
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
```

Expected: no output.

- [ ] **Step 4: Check the archive answers**

```bash
curl -sk "https://flood-exp.test/api.php?shots=1" | head -c 200
```

Expected: a JSON array whose first element is an array, such as `[[1754800000,null,"camera-1"],…]`.
If it is empty, this camera has no frames inside three hours and its tile will hold a still. Try
another id before you call the tile broken.

- [ ] **Step 5: Check it in the browser**

Hard-reload, open `All cameras`, then:

1. Watch the top row for 10 seconds. The pictures step together, once a second.
2. Open the network panel and clear it. Scroll to the foot of the grid. Requests arrive as you
   scroll rather than all at the start.
3. Scroll back up. The tiles you already passed do not refetch.
4. Count the requests on first open. Expect about a dozen `shots=` calls, not 91.
5. Leave the dialog open across a poll, about 8.5 minutes. No tile jumps back to its first frame.
6. Close the dialog. In the network panel, no further frame requests arrive.

- [ ] **Step 6: Commit**

```bash
git add js/wall.js
git commit -m "A tile plays its last three hours, and costs nothing until you scroll to it"
```

---

## Task 4: The alert border and the phrase

A camera near a river at its danger mark takes a red frame. One near a river forecast to reach it
takes an orange one. Both say so in words, because this app's own rule is that color alone is not a
message.

**Files:**
- Modify: `js/popup.js:39-55` (split the words out of `camWarn()`)
- Modify: `js/wall.js` (the tile markup, and `paint()`)
- Modify: `js/render.js:200` (one line)
- Modify: `css/chrome.css` (the border and the phrase)

**Interfaces:**
- Consumes: `camAlert(cam)` from `js/stations.js`, which returns `{ tier, station, km }` or `null`.
  `tier` is the string `now` or `soon`.
- Produces: `camPhrase(cam, a)` from `js/popup.js`, returning plain text such as
  `Water level at danger, 3.42 m`, or `''` when nothing near the lens is on alert.
  `paint()` from `js/wall.js`, taking no arguments and returning nothing.

- [ ] **Step 1: Split the words out of `camWarn()`**

In `js/popup.js`, replace the whole of `camWarn` at lines 45-55:

```js
export const camWarn = (cam, a = camAlert(cam)) => {
  if (!a) return '';
  const s = a.station;
  const [field, unit] = CAM_READ[s.kind] || [];
  const lv = !field ? null : 'level' in a ? a.level : s[field];
  const what = ALERT_TITLE[`${s.kind}|${a.tier}`]?.[0] || KINDS[s.kind].label;
  return `<span class="camwarn t-${a.tier}"><i class="i i-warning"></i><b>${
    what}${lv == null ? '' : `, ${lv}${unit}`}</b></span>`;
};
```

with:

```js
/* The words, with no markup around them. Two surfaces want them and they draw differently: the
   lightbox pill sits on the photograph, and a camera tile on the wall carries them under it. The
   phrase itself must stay one string in one place, or one river makes two claims. */
export const camPhrase = (cam, a = camAlert(cam)) => {
  if (!a) return '';
  const s = a.station;
  const [field, unit] = CAM_READ[s.kind] || [];
  // Gated on the kind having a reading at all, not on what was handed in: a siren's samples are 0
  // and 1, so an archive frame passes `level: 1` and a phrase that trusted it would print "1".
  const lv = !field ? null : 'level' in a ? a.level : s[field];
  const what = ALERT_TITLE[`${s.kind}|${a.tier}`]?.[0] || KINDS[s.kind].label;
  return `${what}${lv == null ? '' : `, ${lv}${unit}`}`;
};

export const camWarn = (cam, a = camAlert(cam)) => {
  const words = camPhrase(cam, a);
  return words
    ? `<span class="camwarn t-${a.tier}"><i class="i i-warning"></i><b>${words}</b></span>` : '';
};
```

The comment block above `CAM_READ` at lines 10-38 describes both functions. Leave it in place.

- [ ] **Step 2: Give the tile somewhere to say it**

In `js/wall.js`, change `tileHtml` so each tile carries an empty phrase slot:

```js
const tileHtml = c => `<button class="camtile" data-cam="${c.id.split('-')[1]}" data-hay="${
  squash(`${c.name} ${c.district || ''} ${c.state || ''}`)}"><img loading="lazy" alt="" src="${
  camSrc(c)}"><span class="camname">${c.name}</span><span class="camsay"><i class="i i-warning"
  ></i><b></b></span></button>`;
```

The glyph and the `<b>` are always in the markup. `paint()` writes text into the `<b>` and the
stylesheet hides the whole span on a tile with no tier class. That keeps `paint()` on `textContent`,
which cannot carry markup into the page.

- [ ] **Step 3: Write `paint()`**

Add to `js/wall.js`, after `count()`:

```js
/* What a poll changes, and nothing else. js/render.js calls this instead of rebuilding the grid,
   because a rebuild drops every visible tile back to the first frame of its lap and throws away
   the frames it warmed. It creates and destroys no element, and it touches no <img>.
 *
 * The name matches paint() in js/timeline.js, which does the same job for the lightbox: rewrite
 * the parts of an existing player that changed, rather than build a new one.
 *
 * `L.cam` is the station object from the payload the grid was built on, and a poll replaces that
 * object. It stays correct anyway: the only fields read here are the coordinate and the id, and a
 * camera does not move. camAlert() reduces over the live `state.data` for everything else.
 *
 * `hidden` is left alone, so a filter survives a poll with no work.
 *
 * The threshold is camAlert()'s, which is the lightbox pill's. Same 2 km, same isIgnored(), same
 * exclusion of stale stations. This surface makes no new claim and widens no alert set, so it does
 * not go through the alert design standard as a fifth surface. Widening camAlert() would. */
export function paint() {
  for (const [t, L] of laps) {
    const a = camAlert(L.cam);
    t.classList.toggle('t-now', a?.tier === 'now');
    t.classList.toggle('t-soon', a?.tier === 'soon');
    t.querySelector('.camsay b').textContent = a ? camPhrase(L.cam, a) : '';
  }
}
```

Add the two imports at the top of `js/wall.js`:

```js
import { camAlert } from './stations.js';
import { camPhrase } from './popup.js';
```

Call it at the end of `open()`, on the line after `count();`, so a grid is right the moment it
appears rather than at the first poll:

```js
  paint();
```

- [ ] **Step 4: Hook it into the poll**

In `js/render.js`, after line 200, add:

```js
  // The wall is painted, never rebuilt. See paint() in js/wall.js for what a rebuild costs.
  if (el('camBox').open) wall.paint();
```

Add the import at the top of `js/render.js`, under the `table.js` import at line 11:

```js
import * as wall from './wall.js';
```

`js/wall.js` imports `map.js`, `popup.js`, `stations.js`, `config.js`, `state.js` and `util.js`.
None of those imports `render.js`, so this adds no cycle. `js/table.js` already reaches `map.js` the
same way.

- [ ] **Step 5: Style the border and the phrase**

Append to the `--- all cameras ---` block in `css/chrome.css`, under the `.camname` rules:

```css
/* The same two tokens the ticker and the alert panel use, through the same two class names. Never
   a hex here — the palette has moved four times and every copy of it went stale. */
.camtile.t-now  { border-color: var(--s-danger); }
.camtile.t-soon { border-color: var(--s-warning); }

/* Under the name, and only on a tile with something to say. A border with no words is the
   ambiguity the lightbox pill was rewritten to remove: red against amber carrying the whole
   message. See js/popup.js. */
.camsay {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 1;
  display: flex; align-items: center; gap: 5px; padding: 5px 8px;
  font: 500 11px/1.25 Roboto, sans-serif; color: #fff;
  background: rgb(0 0 0 / .62); backdrop-filter: blur(3px);
  text-shadow: 0 1px 3px rgb(0 0 0 / .95);
  pointer-events: none;
}
.camsay b { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.camsay .i { flex: none; font-size: 15px; filter: drop-shadow(0 1px 3px rgb(0 0 0 / .95)); }
.camtile.t-now  .camsay .i { color: var(--s-danger); }
.camtile.t-soon .camsay .i { color: var(--s-warning); }
/* `display: flex` above beats the browser's `[hidden]` rule, and there is no `hidden` here to
   beat it with — a quiet tile simply has no tier class. */
.camtile:not(.t-now):not(.t-soon) .camsay { display: none; }
/* The phrase owns the foot of an alerting tile, so the name steps up out of its way. */
.camtile.t-now .camname, .camtile.t-soon .camname { bottom: 26px; }
```

- [ ] **Step 6: Syntax-check the modules**

```bash
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
```

Expected: no output.

- [ ] **Step 7: Check it in the browser**

Real weather often gives no alert at all, so use test mode. It is the toggle in the About pane.
`CAM_EVERY` in `js/test.js` floods every third site that holds both a camera and a river, so borders
appear without waiting.

1. Turn test mode on. Open `All cameras`.
2. Several tiles carry a red or an orange border.
3. Each bordered tile prints a phrase with a warning glyph, such as `Water level at danger, 3.42 m`.
4. Open the lightbox on one of those cameras from its station panel. The pill states the same
   phrase as the tile. If the two disagree, `camPhrase()` is being called twice with different
   arguments somewhere.
5. A quiet tile shows no phrase and no colored border.
6. Turn test mode off with the dialog still open. Wait for the next poll. The borders clear in
   place, and no tile restarts its lap.
7. Switch the theme. Both border colors follow.

- [ ] **Step 8: Commit**

```bash
git add js/popup.js js/wall.js js/render.js css/chrome.css
git commit -m "A camera near trouble takes a red frame, and says what the trouble is"
```

---

## Task 5: The filter

91 pictures is a lot to scan for one place. The filter narrows them, and a narrowed tile keeps its
lap.

**Files:**
- Modify: `index.html` (the input)
- Modify: `js/util.js` (two more helpers moved in)
- Modify: `js/ui.js` (the handler, and the moved helpers imported back)
- Modify: `css/chrome.css` (one rule)

**Interfaces:**
- Consumes: `count(shown)` from `js/wall.js`, and `data-hay` on each tile, both from Task 2.
- Produces: `termsOf(q)` and `matches(text, terms)` exported from `js/util.js`.

- [ ] **Step 1: Add the input**

In `index.html`, inside `#camBox .dtop`, add one line between the `.modalhead` div and the count:

```html
    <input id="camFind" type="text" autocomplete="off" placeholder="Filter by name or district…"
           aria-label="Filter cameras">
```

- [ ] **Step 2: Move the two matchers into `js/util.js`**

Cut these two lines from `js/ui.js`, where `squash` used to sit at line 634:

```js
const termsOf = q => q.trim().split(/\s+/).map(squash).filter(Boolean);
const matches = (text, terms) => terms.every(t => text.includes(t));
```

Add them to `js/util.js`, directly under the `squash` export from Task 2:

```js
/* Split on whitespace *only*, then strip punctuation inside each word. Splitting the query on
   punctuation instead turned `I.K.B.N` into four single-letter terms and matched 294 stations. */
export const termsOf = q => q.trim().split(/\s+/).map(squash).filter(Boolean);
export const matches = (text, terms) => terms.every(t => text.includes(t));
```

Add `termsOf` and `matches` to the `import { … } from './util.js'` list at `js/ui.js:5`. The go-to
box calls both and keeps working unchanged.

- [ ] **Step 3: Write the handler**

In `js/ui.js`, inside the `--- all cameras ---` block from Task 2, add:

```js
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
```

Then change the open handler so a reopen starts clean:

```js
el('cams').onclick = () => {
  closeSide();
  el('camFind').value = '';
  wall.open();
  camBox.showModal();
};
```

`wall.open()` calls `count()` with no argument, which reports every tile. That is correct, because
the line above empties the box.

Do not focus `#camFind`. The table focuses its box, because a table is a thing you filter. This is a
wall of pictures, and a focused input opens the keyboard over them on a phone.

- [ ] **Step 4: Style the input**

In `css/chrome.css`, in the `--- all cameras ---` block, next to the `#camBox h2` rule, add:

```css
#camBox #camFind { margin-bottom: 6px; }
```

- [ ] **Step 5: Syntax-check the modules**

```bash
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
```

Expected: no output.

- [ ] **Step 6: Check it in the browser**

1. Open `All cameras`. The count reads `91 cameras` and no field has focus.
2. Type `klang`. The grid narrows and the count reads `N of 91 cameras`.
3. Type a word that matches nothing. The count reads `No camera matches that name.` and the grid is
   empty. It does not go silently blank.
4. Clear the box. Every tile returns, and the ones that were playing carry on where they were
   rather than from the first frame.
5. Filter to one tile and watch it. It keeps playing.
6. Check the go-to box in the app bar still finds stations. Both matchers moved, and it is the
   other caller.
7. On a phone or a narrow window, open the dialog. No keyboard appears until you tap the field.

- [ ] **Step 7: Commit**

```bash
git add index.html js/util.js js/ui.js css/chrome.css
git commit -m "The wall takes a filter, and a hidden tile keeps its place"
```

---

## Task 6: The documentation

`CLAUDE.md` says to record a feature and its reasoning as part of the change, not as a follow-up.
This task is not optional. The work does not end without it.

**Files:**
- Modify: `docs/FEATURES.md` (a new section at the end)
- Modify: `CLAUDE.md` (the gotcha list)

- [ ] **Step 1: Write the feature section**

Append to `docs/FEATURES.md`:

```markdown
## Every camera on one page, and four buttons behind one

91 of the 93 cameras publish a picture, and the station panel answers one at a time. A camera is
also the one sensor that needs no mark to read it — a picture of a flooded road answers by itself —
so a page of pictures is the fastest read this data supports. `All cameras` is that page.

**The app bar had no room for it.** The right group held seven buttons and filled the bar at 360
pixels. Two of them opened a dialog, so both moved into one ⋮ menu with the new view and a Help
entry of its own. The menu is `.menu`, the component the sensor ⓘ already uses, and the delegated
handler in `js/ui.js` places every popover carrying that class — so the menu needed no positioning
code, no library and no new icon. `i-more_vert` was already in `css/icons.css` with no user.

**Help and About stay one dialog with two tabs.** Splitting the entry points is not splitting the
dialog. The panes cross-reference each other, and a reader who opens Help and then wants About must
not have to close and reopen.

**One timer drives 91 tiles, not 91 timers.** `js/clip.js` carries a generation counter and a
rebind path because `render()` replaces the open card's `<img>` under it on every poll. The wall is
built once and painted in place, so that whole class of problem never arises and none of that
machinery was copied. 91 timers at 1 Hz is also 91 wakeups a second where one will do, and tiles
that step together read as one deliberate thing rather than as 91 pictures out of phase.

**A tile costs nothing until a reader scrolls to it.** Eager, the page is 91 calls to `?shots=` and
about 550 frames, roughly 80 MB. An `IntersectionObserver` arms a tile the first time it comes into
view: fetch the list, warm the lap with `Image().decode()`, join the tick. Leaving view drops it out
and keeps its place. The first screen is about a dozen tiles and about 10 MB. `loading="lazy"` on
the still is the browser doing the same job for the one image every tile has.

**A poll paints, it does not rebuild.** `render()` calls `paint()`, which re-runs `camAlert()` per
tile and swaps the tier class and the phrase. It creates and destroys no element and touches no
`<img>`, so nothing jumps mid-lap. The name matches `paint()` in `js/timeline.js`, which does the
same job for the lightbox.

**The border makes no new claim.** `camAlert()` is the call the lightbox pill already makes — same
2 km, same `isIgnored()`, same exclusion of stale stations — so this is one existing claim on a new
screen rather than a fifth alert surface. Widening `camAlert()` would go through the alert design
standard. Adding a screen that reads it does not.

**The border alone was not enough.** Color alone is not a message, which is the finding that
rewrote the lightbox pill. So an alerting tile also prints the phrase, from `ALERT_TITLE` through
`camPhrase()` — the function the pill now calls too. One river cannot make two claims, because
there is one string.

**A filtered tile takes `hidden` and stays in the grid.** It keeps its lap, its frame list and its
warmed images, so clearing the box brings it back where it was. The observer needs no code for it:
the browser reports a `display: none` element as not intersecting, so the tile stops ticking by
itself. The kind label is left out of the haystack, because every tile is a camera and `camera`
would match all 91.

**The filter does not take focus on open.** The table focuses its box, because a table is a thing
you filter. This is a wall of pictures, and a focused input opens the keyboard over them on a phone.

**Not built:** no compare, no scrubber, no transport — the lightbox holds those, and two places to
learn one control is one too many. No warning pill on a tile, because a pill states one frame's
alert and a tile has no way to score the frame on screen. No sort control and no favorites-only
mode. Add one when a reader asks.
```

- [ ] **Step 2: Add the gotcha**

In `CLAUDE.md`, in the `## Gotchas that have already bitten` list, add:

```markdown
- **The camera wall is painted on a poll, never rebuilt.** `render()` calls `paint()` in
  `js/wall.js`, which swaps the tier class and the phrase on the tiles that already exist. A tile
  holds four things the payload does not: the frame it is showing, the frame list it fetched, the
  images it warmed, and whether the observer reached it. A rebuild throws all four away and drops
  every visible tile back to the start of its lap, which is the failure `js/clip.js` was written to
  prevent on one camera, arriving a dozen at a time. The filter obeys the same rule: a hidden tile
  stays in the grid. **Do not add `wall.open()` to the poll path** beside `dataTable()` — the table
  is safe to rebuild because a row is a pure function of the payload, and a tile is not.
```

- [ ] **Step 3: Check the writing**

```bash
python "C:/Users/illus/.claude/ste-lint.py" < docs/FEATURES.md
```

Aim for a low total. The checker counts each list item as a sentence, so a list of more than six
items raises a false `long_paragraph` count. Ignore that one. Fix anything else the checker names in
the text you added.

- [ ] **Step 4: Run both server-side checks**

Neither task touched PHP, so both must still pass unchanged.

```bash
php shots-test.php
php api.php --selftest
```

Expected: both green.

- [ ] **Step 5: Commit**

```bash
git add docs/FEATURES.md CLAUDE.md
git commit -m "The wall writes down why it paints instead of rebuilding"
```

---

## Self-review

**Spec coverage.** Every section of the spec maps to a task.

| spec section | task |
|---|---|
| Stage 1, the App menu | 1 |
| Help and About stay one dialog | 1 |
| Icon | 1, and the spec's `apps` glyph became `more_vert`, which the repository already holds |
| What it shows, order, filter rules | 2 |
| Markup, the grid, a tile | 2 |
| The click | 2 |
| Playback, one timer | 3 |
| What loads and when | 3 |
| The filter | 5 |
| A poll paints | 4 |
| The border and the words | 4 |
| The name and hover | 2 |
| Closing stops the clock | 2 |
| Files, verification | every task |

**Two deviations from the spec, both deliberate.**

1. The spec asks for a new `apps` glyph from Material Symbols. `css/icons.css` already holds
   `more_vert` and no file uses it. The menu takes that one, so nothing is fetched and
   `css/icons.css` keeps its `?v=`.
2. The spec puts `data-mast` on a tile, following `js/table.js`. A table row is a mast and a tile is
   one camera, and the click resolves the camera by its own id, so the attribute earns nothing.
   Dropped.

**Type consistency.** `camPhrase(cam, a)` returns a string in Task 4 and is called with the same two
arguments in `camWarn()` and in `paint()`. `count(shown)` is defined with a default in Task 2 and
called with a number in Task 5. `open()`, `close()`, `count()` and `paint()` are the four exports of
`js/wall.js`, and `js/ui.js` and `js/render.js` both import the module namespace as `wall`.

**Placeholders.** None. Every step carries the code it needs.
