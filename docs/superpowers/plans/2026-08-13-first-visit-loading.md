# First visit and panel-code loading — Implementation Plan (C of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut about 700 ms of import waterfall and 242 KB off a first visit, and load the five panel-only modules when a reader opens the panel rather than on landing.

**Architecture:** Tasks 1 and 2 are four small changes to `index.html` and `js/map.js`. Task 3 adds one loader and one shared skeleton. Tasks 4 to 6 convert nine static imports to dynamic ones, one surface at a time.

**Tech Stack:** Vanilla ES modules, no build step. `modulepreload`, `preconnect` and dynamic `import()` are native.

**Source spec:** `docs/superpowers/specs/2026-08-13-api-performance-design.md`, Sections 3 and 5.

## Run Plan B first

Plan B modifies `js/wall.js`, `js/net.js`, `js/ui.js` and `js/timeline.js`. This plan modifies the
same four. Execute `docs/superpowers/plans/2026-08-13-api-client-errors.md` to completion before
Task 3 here.

Tasks 1 and 2 touch neither set of files. Run them at any time.

## Measured baseline

| item | measured |
|---|---|
| landing weight | 271 KB gzipped: JS 156 KB, CSS 80 KB, payload 36 KB |
| JS modules | 21 files, 21 separate requests |
| import graph depth | 7 levels, nothing preloaded |
| the five panel-only modules | 44 KB gzipped: timeline 15.4, table 9.4, wall 8.9, test 5.6, clip 4.6 |
| `water.json` | 242 KB gzipped, fetched on landing for a dark theme reader |
| markers built by `render()` | 417 sites, added in one `addLayers()` call |

## Global Constraints

- **No build step. Add none.** The browser resolves the imports itself. Keep relative
  specifiers with the `.js` extension. Add no bundler, no package, no dependency.
- **No test framework, and no harness for the client.** Verify with `node --check`, the
  content-type sweep below, and by looking at the page.
- **No inline CSS or JS in `index.html`.** That file is markup only. Every rule goes in `css/`.
- **Bump `?v=` on any stylesheet you touch.** The server sends a three-hour `max-age`, so a reader
  keeps the old CSS without it. `js/` has no such guard, so a hard reload is the ritual there.
- **One skeleton look, not three.** The camera wall already has a shimmer. Reuse it. Two looks for
  one state is the failure this constraint exists to prevent.
- **Reduced motion is not optional.** Every animation added here needs its
  `@media (prefers-reduced-motion: reduce)` rule in the same commit.
- **A `<dialog>` sets `display` on `[open]`, never on the element.** The browser hides a closed
  dialog with its own rule, and any author rule setting `display` beats it.
- Prose and comments: active voice, sentences under 20 words, no semicolons, no contractions,
  American spelling.
- Never delete `.history.db` or anything under `shots/`. Never run `git clean`.
- Commit directly to `main`. Do not create a branch.

## File structure

| file | change |
|---|---|
| `index.html` | 16 `modulepreload` links, one `preconnect`, skeleton markup in three dialogs |
| `js/map.js` | `water.json` deferred, `chunkedLoading` set, `clip.js` loaded on demand |
| `js/lazy.js` | new. One loader that drives `aria-busy` and catches a failed import |
| `css/base.css` | the shared skeleton look, promoted out of the wall |
| `css/chrome.css` | the wall tile reads the shared look, plus the three skeleton placements |
| `js/net.js`, `js/ui.js`, `js/render.js`, `js/locate.js` | nine static imports become dynamic |

## Client verification, used by every task

```bash
cd d:/Herd/flood-exp
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
for f in js/*.js css/*.css; do
  curl -sk -o /dev/null -w "%{content_type} $f\n" "https://flood-exp.test/$f"; done \
  | grep -v 'javascript\|css'
```

Both must print nothing. A silent run is a pass.

---

### Task 1: Flatten the import waterfall and warm the tile host

**Files:**
- Modify: `index.html` — the head, above the stylesheet links

**Interfaces:**
- Consumes: nothing. Produces: nothing other code imports.

The browser finds each import level only after it parses the level above. The graph is 7 levels
deep, so the payload request waits for seven round trips. At a 100 ms round trip that is about
700 ms before the request leaves the browser.

- [ ] **Step 1: Confirm the depth and the module list**

```bash
cd d:/Herd/flood-exp
php -r '
$dep=[]; foreach(glob("js/*.js") as $f){ $n=basename($f);
  preg_match_all("#from \x27\./([a-z]+)\.js\x27#",file_get_contents($f),$m); $dep[$n]=array_map(fn($x)=>"$x.js",$m[1]); }
$d=function($n,$seen=[]) use (&$d,$dep){ if(in_array($n,$seen))return 0; $seen[]=$n; $r=0;
  foreach($dep[$n]??[] as $c) $r=max($r,1+$d($c,$seen)); return $r; };
echo "depth = ",$d("app.js"),"\n";'
ls js/*.js | wc -l
```

Expected: `depth = 7` and `21` modules.

- [ ] **Step 2: Add the preconnect and the preload links**

In `index.html`, find this line:

```html
<link rel="stylesheet" href="vendor/leaflet.css">
```

Insert all of this directly above it:

```html
<!-- The only third party this page contacts. Leaflet builds the first tile URL from js/map.js, and
     that happens after the module graph has loaded, so the browser would otherwise start its DNS,
     TCP and TLS work at the latest possible moment. The About pane's Credits already names CARTO
     for these tiles. -->
<link rel="preconnect" href="https://a.basemaps.cartocdn.com" crossorigin>
<!-- The import graph is seven levels deep and there is no build step to flatten it, so the browser
     discovers each level only after it parses the one above. That is seven round trips before
     js/net.js can ask for the payload. These links let it fetch all of them at once.
     The five panel-only modules are deliberately absent: timeline, table, wall, clip and test are
     loaded on demand by later tasks in this plan, and preloading one would fetch it on landing
     again, which is the whole thing those tasks remove.
     This list has no build step to generate it. The Verify block in CLAUDE.md carries a check that
     compares it against ls js/*.js. -->
<link rel="modulepreload" href="js/app.js">
<link rel="modulepreload" href="js/config.js">
<link rel="modulepreload" href="js/state.js">
<link rel="modulepreload" href="js/util.js">
<link rel="modulepreload" href="js/stations.js">
<link rel="modulepreload" href="js/map.js">
<link rel="modulepreload" href="js/heat.js">
<link rel="modulepreload" href="js/popup.js">
<link rel="modulepreload" href="js/sparktip.js">
<link rel="modulepreload" href="js/render.js">
<link rel="modulepreload" href="js/alerts.js">
<link rel="modulepreload" href="js/locate.js">
<link rel="modulepreload" href="js/ticker.js">
<link rel="modulepreload" href="js/toast.js">
<link rel="modulepreload" href="js/net.js">
<link rel="modulepreload" href="js/ui.js">
```

Plan B adds `js/ask.js`. If that file exists, add a link for it too and say so in your report.

- [ ] **Step 3: Confirm every link resolves**

```bash
cd d:/Herd/flood-exp
for f in $(grep -oP '(?<=modulepreload" href=")[^"]+' index.html); do
  printf '%-22s ' "$f"; curl -sk -o /dev/null -w '%{content_type}\n' "https://flood-exp.test/$f"
done
```

Expected: every line ends in a JavaScript content type. A `text/html` means a typo, which the server
answers with `index.html` and a 200 rather than a 404.

- [ ] **Step 4: Confirm nothing preloaded is meant to be lazy**

```bash
cd d:/Herd/flood-exp
for m in timeline table wall clip test; do
  grep -q "modulepreload\" href=\"js/$m.js\"" index.html && echo "WRONG: $m.js is preloaded" || echo "ok: $m.js absent"
done
```

Expected: five `ok` lines.

- [ ] **Step 5: Add the drift check to the Verify block**

`CLAUDE.md` has a `## Verify` section. Append this to the last bash block in it:

```bash
# Every module must carry a modulepreload link, except the five loaded on demand. There is no build
# step to generate that list, so it goes stale silently when somebody adds a module.
for f in js/*.js; do
  case $(basename $f) in timeline.js|table.js|wall.js|test.js|clip.js) continue;; esac
  grep -q "modulepreload\" href=\"$f\"" index.html || echo "MISSING modulepreload: $f"
done
```

- [ ] **Step 6: Look at the page**

Open `https://flood-exp.test` and hard reload with Ctrl+Shift+R. The map draws its stations and the
splash clears. In the browser network panel the JS modules start together rather than in a staircase.

State what you observed.

- [ ] **Step 7: Commit**

```bash
git add index.html CLAUDE.md
git commit -m "Seven round trips before the page could ask for any data

The import graph is seven levels deep and there is no build step to flatten
it, so the browser found each level only after parsing the one above. At a
100 ms round trip that is about 700 ms before js/net.js asks for anything.

The five panel-only modules stay out of the list on purpose. Later tasks
load them on demand, and preloading one would fetch it on landing again.

CARTO gets a preconnect. Leaflet builds the first tile URL after the whole
graph has loaded, so the DNS, TCP and TLS work started at the latest
possible moment."
```

---

### Task 2: Keep 242 KB off the first paint, and stop blocking on 417 markers

**Files:**
- Modify: `js/map.js` — the `cluster` options, and the `water.json` fetch

**Interfaces:**
- Consumes: `setWater(bool)` and the `cluster` object, both already in `js/map.js`.
- Produces: nothing other code imports.

`water.json` is 242 KB gzipped and loads on landing for every dark theme reader. The whole rest of
the landing is 271 KB. It draws rivers and ponds the basemap omits, and `js/map.js` states that a
map without it is a plainer map rather than a broken one.

- [ ] **Step 1: Set `chunkedLoading`**

In `js/map.js`, find:

```js
export const cluster = L.markerClusterGroup({
```

Add this as the first option inside that object:

```js
  /* render() adds all 417 site markers in one addLayers() call, and that call blocks until it
     finishes. This breaks the work into chunks and yields between them, so the page keeps
     answering a tap while the markers arrive. The option only affects addLayers(), which is the
     call js/map.js makes. */
  chunkedLoading: true,
```

- [ ] **Step 2: Defer the water fetch past the first render**

In `js/map.js`, find this line inside `setWater()`:

```js
    fetch('water.json')
```

Replace that line with:

```js
    /* Past the first paint. This file is 242 KB gzipped, against 271 KB for the whole of the rest
       of the landing, so fetching it inline nearly doubles what a dark theme reader waits for. It
       draws rivers and ponds the basemap omits, which is decoration over a map that already works,
       so it can arrive late. requestIdleCallback yields to anything the browser would rather do
       first, and the setTimeout is the fallback for Safari, which does not implement it. */
    const later = window.requestIdleCallback || (fn => setTimeout(fn, 1200));
    later(() => fetch('water.json')
```

Then find the end of that promise chain:

```js
      .catch(() => {});   // No water is a plainer map, not a broken one. Every reading still draws.
```

and close the callback by adding `)` before the semicolon:

```js
      .catch(() => {}));   // No water is a plainer map, not a broken one. Every reading still draws.
```

Read the whole `setWater()` function before and after this edit. The `asking` flag must still be
set before the deferred callback runs, or two theme switches inside the idle window start two
fetches. Report the state of that flag.

- [ ] **Step 3: Check the modules and the types**

Run the client verification block at the top of this plan. Both commands must print nothing.

- [ ] **Step 4: Confirm both changes on the page**

Open `https://flood-exp.test`, hard reload, and set the theme to Dark from the app bar menu.

1. The map draws its stations immediately.
2. The rivers and ponds appear shortly after, not at the same moment.
3. Panning during the first second stays responsive.

In the network panel, `water.json` starts after the module requests rather than beside them.

State what you observed for each.

- [ ] **Step 5: Commit**

```bash
git add js/map.js
git commit -m "A 242 KB decoration loaded before the map was usable

water.json draws the rivers and ponds the dark basemap omits. The rest of
the landing is 271 KB, so fetching it inline nearly doubled what a dark
theme reader waited for, and this file already says a map without it is a
plainer map rather than a broken one.

It now arrives after the first paint. requestIdleCallback where it exists,
a timer where it does not.

chunkedLoading yields between batches of the 417 markers, so a tap lands
while they arrive."
```

---

### Task 3: One loader, one skeleton, and test.js off the landing path

**Files:**
- Create: `js/lazy.js`
- Modify: `css/base.css`, `css/chrome.css`, `index.html`, `js/net.js`, `js/ui.js`

**Interfaces:**
- Produces: `lazy(load, box)` from `js/lazy.js`. Calls `load()`, marks `box` busy after 150 ms, and
  clears the mark whatever happens. Rethrows so a caller can show its own failure state.

- [ ] **Step 1: Write the loader**

Create `js/lazy.js`:

```js
// Load a module when a reader asks for the panel it serves, and say so while they wait.

/* One attribute drives both jobs. `aria-busy` is what a screen reader announces, and the CSS in
 * css/base.css draws the shimmer from the same attribute, so the two cannot drift apart. The
 * alternative is a class for the eye and an attribute for the reader, kept in step by hand.
 *
 * The 150 ms delay is the point of this function, not decoration. A same-origin import of a 9 KB
 * to 15 KB module takes about 10 ms to 40 ms warm. A skeleton that appears for 20 ms is a flash,
 * and a flash reads worse than no skeleton at all. Under 150 ms nothing is drawn. Over it, the
 * shimmer is already there before anyone perceives a wait.
 *
 * The mark is cleared in `finally`, so a failed import cannot leave a box shimmering forever. The
 * error is rethrown rather than swallowed: the caller knows which surface it owns and what to put
 * in it, and this function does not. */
export async function lazy(load, box) {
  const t = setTimeout(() => box?.setAttribute('aria-busy', 'true'), 150);
  try {
    return await load();
  } finally {
    clearTimeout(t);
    box?.removeAttribute('aria-busy');
  }
}
```

- [ ] **Step 2: Promote the skeleton out of the wall**

The wall already owns the only shimmer in this app, at `.camtile::before` in `css/chrome.css`. Read
that rule and its `@keyframes camskel` and its reduced-motion rule before you change anything.

In `css/base.css`, add this near the other `@keyframes` blocks:

```css
/* One skeleton look for every surface that waits. The camera wall had it first and still uses it,
   through the shared gradient and keyframes below. Two looks for one state is what this prevents.
   The gradient is a custom property because a wall tile draws it on a pseudo-element and the other
   surfaces draw it on real elements, and both must resolve the same value. */
:root {
  --skel-img: linear-gradient(100deg, transparent 30%,
    color-mix(in srgb, var(--on-surface) 12%, transparent) 50%, transparent 70%);
}
@keyframes skel { from { background-position: 100% 0; } to { background-position: -100% 0; } }
.skel {
  background-color: var(--hover);
  background-image: var(--skel-img);
  background-size: 200% 100%;
  animation: skel 1.4s ease-in-out infinite;
  border-radius: 6px;
}
/* A still skeleton for anyone who asked for less motion. The shimmer is decoration, and a grid of
   them animating at once is that many more reasons to honor the setting. */
@media (prefers-reduced-motion: reduce) { .skel { animation: none; } }
```

Then in `css/chrome.css`, replace the `.camtile::before` rule, its `@keyframes camskel` line and its
reduced-motion line with this, so the wall reads the shared gradient and the shared keyframes:

```css
.camtile::before {
  content: ''; position: absolute; inset: 0; z-index: 2;
  background-color: var(--hover);
  background-image: var(--skel-img);
  background-size: 200% 100%;
  animation: skel 1.4s ease-in-out infinite;
}
.camtile.done::before { content: none; animation: none; }
@media (prefers-reduced-motion: reduce) { .camtile::before { animation: none; } }
```

Bump the `?v=` on both `css/base.css` and `css/chrome.css` in `index.html`.

- [ ] **Step 3: Confirm the wall still shimmers**

Open `https://flood-exp.test`, hard reload, and open the camera wall. Tiles that have not loaded yet
carry the moving shimmer, and a loaded tile does not.

Then set your operating system to reduce motion and reload. The shimmer holds still rather than
moving. State what you observed for both.

- [ ] **Step 4: Take test.js off the landing path**

`js/ui.js` calls `paintTestChrome()` at module load. That call is a no operation: `state.test` starts
`false` in `js/state.js`, `js/ui.js` sets the checkbox from it on the line above, and the function
only toggles a class from that flag.

In `js/ui.js`, delete the import of `paintTestChrome` and delete this line:

```js
paintTestChrome();
```

Then change the toggle handler from:

```js
el('testMode').onchange = () => {
  state.test = el('testMode').checked;
  paintTestChrome();
  load();
};
```

to:

```js
el('testMode').onchange = async () => {
  state.test = el('testMode').checked;
  /* Loaded here and nowhere else. test.js is 5.6 KB for a mode a reader enters deliberately, and
     `state.test` is false on every landing, so nothing on the landing path needs this module.
     The box is disabled while the module arrives, which is the honest state: the toggle has been
     pressed and has not taken effect yet. */
  const b = el('testMode');
  b.disabled = true;
  try {
    const m = await lazy(() => import('./test.js'), b.closest('label') || b);
    m.paintTestChrome();
  } finally {
    b.disabled = false;
  }
  load();
};
```

Add to the imports in `js/ui.js`:

```js
import { lazy } from './lazy.js';
```

- [ ] **Step 5: Confirm test.js is off the landing path**

```bash
cd d:/Herd/flood-exp
grep -n "from './test.js'" js/*.js
grep -n "import('./test.js')" js/*.js
```

Expected: `js/net.js` still has a static import, and `js/ui.js` has the dynamic one. Step 6 below covers `js/net.js`.

- [ ] **Step 6: Take test.js off the poll path too**

In `js/net.js`, delete the static `seedTest` import and change:

```js
    if (state.test) seedTest(state.data);
```

to:

```js
    // Awaited, not fired and forgotten. render() below draws whatever state.data holds at that
    // moment, so a drill that arrives one tick late would draw the real payload first.
    if (state.test) (await import('./test.js')).seedTest(state.data);
```

- [ ] **Step 7: Check the modules and the types**

Run the client verification block at the top of this plan. Both commands must print nothing.

- [ ] **Step 8: Confirm test mode still works end to end**

Open `https://flood-exp.test`, hard reload, and confirm in the network panel that `js/test.js` is
**not** requested. Open the About dialog and turn on test mode. `js/test.js` is requested at that
moment, the amber test banner appears, and the map fills with faked alerts. Turn it off and the real
payload returns.

State what you observed at each step.

- [ ] **Step 9: Commit**

```bash
git add js/lazy.js js/net.js js/ui.js css/base.css css/chrome.css index.html
git commit -m "The skeleton moves out of the wall, and test mode stops loading on landing

lazy() drives aria-busy from one attribute, so the screen reader state and
the shimmer cannot drift. The 150 ms delay is the point: a warm import takes
10 ms to 40 ms, and a skeleton that appears for 20 ms is a flash.

paintTestChrome() ran at module load and did nothing there. state.test is
false on every landing and the function only toggles a class from it. So
5.6 KB loaded on every visit for a mode a reader enters deliberately."
```

---

### Task 4: The station card clip loads with the card

**Files:**
- Modify: `js/map.js` — the `clip` import and both call sites

**Interfaces:**
- Consumes: `lazy()` is not needed here. Produces: nothing.

**This task has an ordering hazard and no skeleton.**

No skeleton, because the card already shows a still picture. `CLAUDE.md` names a silent fallback to
something already visible as one of the two allowed shapes for a picture path, and lists the clip's
own strip probe among the three paths that are deliberately silent.

The hazard: `js/map.js` calls `clip.start()` when a card opens and `clip.stop()` when it closes. A
deferred import opens a gap between them. A reader can close the card inside that gap, so `stop()`
runs on a module that has not arrived, does nothing, and then `start()` resolves and plays a clip on
a closed card.

- [ ] **Step 1: Read both call sites**

```bash
cd d:/Herd/flood-exp
grep -n 'clip\.' js/map.js
```

Record every line. You need all of them before you change any.

- [ ] **Step 2: Replace the static import with one shared promise**

In `js/map.js`, delete:

```js
import * as clip from './clip.js';
```

and add, near the top of the file below the remaining imports:

```js
/* One promise, shared by every call. Callbacks on one promise run in the order they were
   registered, so a stop() registered after a start() still runs after it. That is what closes the
   gap a deferred import opens: a reader can close a card before the module arrives, and without
   this the stop would find nothing and the start would then play a clip on a closed card.
   No skeleton here. The card already shows a still, which CLAUDE.md names as one of the two
   allowed shapes for a picture path. */
let clipMod;
const withClip = fn => (clipMod ??= import('./clip.js')).then(fn).catch(() => {});
```

- [ ] **Step 3: Route both call sites through it**

Every line you recorded in Step 1 becomes a `withClip()` call. A call that reads
`clip.start(a, b)` becomes:

```js
withClip(m => m.start(a, b));
```

and `clip.stop()` becomes:

```js
withClip(m => m.stop());
```

Apply that to every site. Report each one you changed, with the line it replaced.

- [ ] **Step 4: Check the modules and the types**

Run the client verification block at the top of this plan. Both commands must print nothing.

- [ ] **Step 5: Confirm the clip and the hazard**

Open `https://flood-exp.test`, hard reload, and confirm `js/clip.js` is **not** requested on landing.

1. Click a camera pin. The card opens, the browser requests `js/clip.js`, and the clip starts playing.
2. Click another camera pin. The clip switches to that camera and does not restart the first.
3. Open a camera card and close it within about half a second, using the × on the card. No clip
   keeps playing behind the closed card. Repeat this five times.

Step 3 is the hazard. State exactly what you observed.

- [ ] **Step 6: Commit**

```bash
git add js/map.js
git commit -m "The clip module arrives with the card, not with the page

4.6 KB loaded on every landing for a player only a camera card uses.

Both calls share one promise. Callbacks on a promise run in the order they
were registered, so a stop registered after a start still runs after it. A
reader who closes a card before the module lands would otherwise leave a
clip playing behind a closed card."
```

---

### Task 5: The table and the wall load with their dialogs

**Files:**
- Modify: `js/ui.js`, `js/render.js`, `js/locate.js`, `index.html`, `css/chrome.css`

**Interfaces:**
- Consumes: `lazy()` from `js/lazy.js`.
- Produces: nothing.

**Eight call sites across three files, not five.** Two are inside `render()`, which runs on every
poll. One assigns the function as a reference rather than calling it, and that one needs different
treatment from all the others.

| site | shape |
|---|---|
| `js/ui.js` table opener | `dataTable()` inside a handler |
| `js/ui.js` `el('dataFind').oninput = dataTable` | **a direct function reference, not a call** |
| `js/ui.js` wall opener | `wall.open()` inside a handler |
| `js/ui.js` `camBox.onclose = () => wall.close()` | inside a handler |
| `js/ui.js` `wall.count(shown)` | inside the filter handler |
| `js/render.js` | `dataTable()` guarded on `dataBox.open` |
| `js/render.js` | `wall.paint()` guarded on `camBox.open` |
| `js/locate.js` | `dataTable()` guarded on `dataBox.open` |

**The reference assignment is the one to get right.** `el('dataFind').oninput = dataTable;` stores
the function itself. A dynamic import gives you a module object, not a binding, so there is nothing
to assign. It becomes a wrapper that loads on each keystroke and resolves from the module map after
the first:

```js
/* A wrapper, not the function itself. `dataTable` is no longer a static binding, so there is
   nothing to assign here. The dialog cannot be open unless its opener already imported the module,
   so this resolves from the module map with no request on every keystroke after the first. */
el('dataFind').oninput = () => import('./table.js').then(m => m.dataTable());
```

- [ ] **Step 1: Read all eight sites**

```bash
cd d:/Herd/flood-exp
grep -n "dataTable\|wall\." js/ui.js js/render.js js/locate.js
```

Record every line. The count must be eight. If you find more, report them before changing anything.

- [ ] **Step 2: Add the skeleton markup**

In `index.html`, inside `<dialog id="dataBox">`, add this directly above the
`<table class="data">` line:

```html
<div class="skelrows" aria-hidden="true">
  <i class="skel"></i><i class="skel"></i><i class="skel"></i><i class="skel"></i>
  <i class="skel"></i><i class="skel"></i><i class="skel"></i><i class="skel"></i>
</div>
```

Inside `<dialog id="camBox">`, add the same shape directly above `<div id="camGrid"></div>`:

```html
<div class="skeltiles" aria-hidden="true">
  <i class="skel"></i><i class="skel"></i><i class="skel"></i><i class="skel"></i>
  <i class="skel"></i><i class="skel"></i><i class="skel"></i><i class="skel"></i>
  <i class="skel"></i><i class="skel"></i><i class="skel"></i><i class="skel"></i>
</div>
```

`aria-hidden` on both, because `lazy()` already puts `aria-busy` on the dialog and a screen reader
does not need eight empty boxes read to it.

- [ ] **Step 3: Add the skeleton placement**

In `css/chrome.css`, add:

```css
/* Placement only. The look is `.skel` in css/base.css, shared with the camera tile.
   Both are drawn only while lazy() holds `aria-busy` on the dialog, and both are out of the flow
   the moment it clears, so the real content lands where it always did. */
.skelrows, .skeltiles { display: none; }
#dataBox[aria-busy="true"] .skelrows { display: grid; gap: 8px; padding: 12px; }
.skelrows .skel { height: 34px; }
#camBox[aria-busy="true"] .skeltiles {
  display: grid; gap: 6px; padding: 12px;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  grid-auto-rows: min-content;
}
/* The tile ratio, so the grid does not reflow when the real tiles replace these. `grid-auto-rows`
   above is not optional: a grid row does not follow its item's aspect-ratio, and an auto row
   measured a 110px tile at 27.86px on the live wall, which drew every tile over the two below it. */
.skeltiles .skel { aspect-ratio: 16 / 9; }
/* While the skeleton stands, the real content is not there yet. `.data` is the table itself, which
   `#dataBox` holds directly. There is no wrapper element around it. */
#dataBox[aria-busy="true"] .data, #camBox[aria-busy="true"] #camGrid { display: none; }
```

Bump the `?v=` on `css/chrome.css` in `index.html`.

- [ ] **Step 4: Convert the two openers in `js/ui.js`**

The table opener currently reads:

```js
el('data').onclick = () => { closeSide(); dataTable(); dataBox.showModal(); el('dataFind').focus(); };
```

Change it to:

```js
/* The dialog opens first and the module follows. A reader who pressed a button gets a response at
   once, and the skeleton stands in the box until the rows arrive. */
el('data').onclick = async () => {
  closeSide();
  dataBox.showModal();
  el('dataFind').focus();
  try {
    (await lazy(() => import('./table.js'), dataBox)).dataTable();
  } catch {
    el('dataFind').blur();
    dataBox.classList.add('loadfail');
  }
};
```

Convert the wall opener the same way: show `camBox` first, then
`(await lazy(() => import('./wall.js'), camBox)).open()`, with the same `catch`.

Report both lines as you changed them, and every other `wall.` call in `js/ui.js` that now needs the
module, including `wall.count(...)` and the `camBox.onclose` handler.

- [ ] **Step 5: Convert the two sites in `js/render.js`**

A guard on the open dialog already wraps both, so the browser holds the module by the time they run.
They must stay synchronous, because `render()` runs on every poll and making it `async` changes when
everything after it happens.

```js
  if (el('dataBox').open) dataTable();
  // The wall is painted, never rebuilt. See paint() in js/wall.js for what a rebuild costs.
  if (el('camBox').open) wall.paint();
```

becomes:

```js
  /* `.then()`, not `await`. A dialog can only be open because its opener already imported the
     module, so these resolve from the module map with no request. Making render() async would move
     everything after it into a later task on every poll. */
  if (el('dataBox').open) import('./table.js').then(m => m.dataTable());
  // The wall is painted, never rebuilt. See paint() in js/wall.js for what a rebuild costs.
  if (el('camBox').open) import('./wall.js').then(m => m.paint());
```

Delete both static imports from `js/render.js`.

- [ ] **Step 6: Convert the site in `js/locate.js`**

```js
  if (el('dataBox').open) dataTable();
```

becomes:

```js
  if (el('dataBox').open) import('./table.js').then(m => m.dataTable());
```

Delete the static import from `js/locate.js`.

- [ ] **Step 7: Add the failure state**

In `css/chrome.css`, add:

```css
/* A module that never arrives would otherwise leave a dialog shimmering forever. */
.loadfail .skelrows, .loadfail .skeltiles { display: none; }
.loadfail::after {
  content: 'Could not load this view. Check your connection and try again.';
  display: block; padding: 24px; text-align: center; color: var(--muted);
}
```

- [ ] **Step 8: Check the modules and the types**

Run the client verification block at the top of this plan. Both commands must print nothing.

- [ ] **Step 9: Confirm both dialogs**

Open `https://flood-exp.test`, hard reload, and confirm the browser requests neither
`js/table.js` nor `js/wall.js` on landing.

1. Open the all-stations table. It opens at once, the browser requests the module, and the rows arrive.
2. Leave it open through one poll, about five minutes, or press Refresh now. The rows update and the
   dialog does not reset.
3. Open the camera wall. It opens at once and the tiles arrive.
4. Filter the wall by name. The count line updates.
5. Set the browser network throttling to Offline, hard reload, then open the table. The failure
   message appears rather than an endless shimmer.

State what you observed for each.

- [ ] **Step 10: Commit**

```bash
git add js/ui.js js/render.js js/locate.js index.html css/chrome.css
git commit -m "The table and the wall arrive when a reader opens them

18.3 KB across two modules that only two dialogs use.

Both dialogs open before their module is asked for, so a press gets an
answer at once and the skeleton stands in the box until the content lands.

The two sites inside render() stay synchronous. A dialog can only be open
because its opener already imported the module, so .then resolves from the
module map with no request, and making render() async would move everything
after it into a later task on every poll."
```

---

### Task 6: The lightbox player loads with the lightbox

**Files:**
- Modify: `js/ui.js`, `index.html`, `css/chrome.css`

**Interfaces:**
- Consumes: `lazy()` from `js/lazy.js`.
- Produces: nothing.

`js/timeline.js` is the largest of the five at 15.4 KB. `js/ui.js` is its only importer.

**The layout constraint:** `#tl` is the control bar. On touch and at widths under 601px it sits in
the flow under the picture, so an absent bar shifts the picture when the real one arrives. The
skeleton must hold the same height. `#tl` also carries `hidden` in the markup, so the skeleton needs
a box of its own rather than borrowing that element.

- [ ] **Step 1: Read the call sites and the bar**

```bash
cd d:/Herd/flood-exp
grep -n 'openTimeline\|reset()' js/ui.js
grep -n 'id="tl"' -A4 index.html
grep -n '#tl {' -A12 css/chrome.css
```

Record all three. Measure the real height of that bar before you reserve it.

- [ ] **Step 2: Add the reserved bar**

In `index.html`, directly above `<div id="tl" hidden>`, add:

```html
<div id="tlskel" aria-hidden="true"><i class="skel"></i></div>
```

In `css/chrome.css`, add:

```css
/* Holds the control bar's box while js/timeline.js arrives. `#tl` sits in the flow on touch and
   under 601px, so an absent bar shifts the picture when the real one lands. Only drawn while
   lazy() holds `aria-busy` on the dialog. */
#tlskel { display: none; }
#lightbox[aria-busy="true"] #tlskel { display: block; padding: 8px 12px; }
#tlskel .skel { display: block; height: 32px; }
```

**Measure the real height rather than trusting the 32px above.** `#tl` is
`display: grid; gap: 2px; padding: 10px 0 2px`, and it holds two rows of 34px controls plus a range
row, so its height is not a number you can read off one declaration. Open the lightbox in a browser,
select `#tl` in the element inspector, read its computed height, and use that number. Report the
value you measured and the width you measured it at.

Bump the `?v=` on `css/chrome.css` in `index.html`.

- [ ] **Step 3: Convert the call sites**

Delete the static import of `openTimeline` and `reset` from `js/ui.js`.

Replace every call to `openTimeline(src)` with this:

```js
/* The picture opens first and the player follows. The frame is already on screen, so the reader
   sees the camera immediately and the controls arrive under it. */
try {
  (await lazy(() => import('./timeline.js'), el('lightbox'))).openTimeline(src);
} catch {
  el('lightbox').classList.add('loadfail');
}
```

Make the enclosing handler `async` if it is not already, and report which handler you changed.

The lightbox calls `reset()` when it closes. Route it the same way `js/map.js` routes the clip in
Task 4: one shared promise so a close registered after an open still runs after it. A `reset()` that
runs before the module arrives must not throw.

- [ ] **Step 4: Check the modules and the types**

Run the client verification block at the top of this plan. Both commands must print nothing.

- [ ] **Step 5: Confirm the lightbox**

Open `https://flood-exp.test`, hard reload, and confirm `js/timeline.js` is **not** requested on
landing.

1. Open a camera card and click its picture. The lightbox opens, the module is requested, and the
   scrubber appears under the frame.
2. Watch the picture as the bar arrives. It must not jump.
3. Narrow the browser window to under 601px and repeat. The picture must still not jump.
4. Close the lightbox and reopen it. It works the second time and requests nothing new.
5. Close it within about half a second of opening. Nothing keeps running behind it.

State what you observed for each. Step 2 and Step 3 are the layout constraint this task exists for.

- [ ] **Step 6: Commit**

```bash
git add js/ui.js index.html css/chrome.css
git commit -m "The player arrives with the lightbox it controls

15.4 KB, the largest of the five, loaded on every landing for a scrubber
only the lightbox uses.

The skeleton reserves the bar's own height. On touch and under 601px that
bar sits in the flow under the picture, so an absent one shifts the frame
when the real bar lands.

reset() shares one promise with the opener, so a close registered after an
open still runs after it."
```

---

## Done when

```bash
cd d:/Herd/flood-exp
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
for f in js/*.js css/*.css; do curl -sk -o /dev/null -w "%{content_type} $f\n" "https://flood-exp.test/$f"; done \
  | grep -v 'javascript\|css'

# no static import of the five remains
for m in timeline table wall clip test; do grep -n "from './$m.js'" js/*.js; done

# every other module carries a preload link
for f in js/*.js; do
  case $(basename $f) in timeline.js|table.js|wall.js|test.js|clip.js) continue;; esac
  grep -q "modulepreload\" href=\"$f\"" index.html || echo "MISSING modulepreload: $f"
done

# one skeleton look, one keyframes
grep -c 'camskel' css/*.css        # 0
grep -c '@keyframes skel' css/base.css   # 1
```

The first two blocks print nothing. The third prints nothing. The fourth prints `0` then `1`.

Then open the page, hard reload, and confirm in the network panel that landing requests 16 modules
and not 21, and that `js/timeline.js`, `js/table.js`, `js/wall.js`, `js/clip.js` and `js/test.js`
each arrive only when a reader opens its surface.

## Documentation

Append to `docs/FEATURES.md` as part of this work. State the measured landing weight before and
after. State why the 150 ms delay in `lazy()` exists. State that the two sites in `render()` stay
synchronous and why.

Add two gotchas to `CLAUDE.md`. The `modulepreload` list has no build step and goes stale silently,
and the Verify block carries the check for it. A skeleton needs its `aria-busy` on the dialog and
its look from `.skel`, because a second shimmer is the thing the shared class prevents.
