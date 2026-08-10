# All cameras, and the App menu — design

Date: 2026-08-10
Status: approved, ready to plan

## Problem

This app holds 93 cameras. 91 of them publish a picture. A reader reaches one camera at a time. The
reader taps a pin, reads the station panel, closes it, and taps the next pin. Nobody scans the state
that way.

The camera is also the one sensor that answers by itself. A river level needs a mark to compare
against. A picture of a flooded road needs nothing. So a page of pictures is the fastest read this
data supports, and the app does not offer one.

The app bar is the second problem. The right group holds seven buttons. At 360 pixels the group
fills the bar and the wordmark loses room. A new view cannot take an eighth button.

## Two stages

Stage 1 builds the App menu. Stage 2 builds the camera view. Stage 1 must land first, because it
holds the only way in to stage 2.

Each stage is a separate commit.

---

## Stage 1 — the App menu

### What changes

`#data` and `#about` leave the app bar. One new `#apps` button replaces both. The button opens a
popover menu with four items.

| item | label | action |
|---|---|---|
| table | All stations as a table | the current `#data` handler, moved without change |
| cameras | All cameras | opens `#camBox` (stage 2) |
| help | Help | `closeSide()`, then `showPane('tabHelp')`, then `aboutBox.showModal()` |
| about | About | the current `#about` handler, moved without change |

The bar goes from seven buttons to six: menu, find, alert, apps, locate, theme.

### Why the menu costs almost nothing

`css/chrome.css` already holds the `.menu` and `.mi` components. The sensor ⓘ menu uses them.

`js/ui.js` already places every `.menu` popover. The handler at `ui.js:530` listens for `toggle` in
the capture phase and keys off the class name. It reads the button through
`[popovertarget="<id>"]`. A new menu with `class="menu surface"` and `popover` gets placement,
light dismiss, Esc and the top layer with no new JavaScript.

Add nothing to that handler.

### Help and About stay one dialog

`showPane()` in `ui.js` already switches the two panes. The two menu items call it with different
arguments. The tabs stay inside `#aboutBox` as the way across.

Do not split `#aboutBox` into two dialogs. The panes cross-reference each other, and a reader who
opens Help and then wants About must not have to close and reopen.

Leave `aboutBox.onclose` as it is. It resets to the About pane, and each open sets the pane it
wants, so the reset changes nothing a reader sees.

### Icon

The menu button needs a glyph. A script builds `css/icons.css`, and adding an icon is one rule there.
Use `apps` from Material Symbols, the same source every other icon in the file comes from. See
`docs/FEATURES.md` for the fetch command.

`All cameras` needs a camera glyph in its row. The camera kind already has one, `--i-photo_camera`,
named by `KINDS.camera.icon` in `js/config.js`. Reuse it. Two glyphs for one kind teaches the reader
two things for one meaning.

Each menu item keeps the id of the button it replaces, so `#data` and `#about` still name their
handlers. The two new items take `#cams` and `#help`.

---

## Stage 2 — All cameras

### What it shows

Every camera station that carries an image. That is 91 of 93 today.

The drawer filter does not apply. `js/table.js:19` states the rule for the all-stations table, and
this view is the same shape: a view named "all" that quietly drops the districts you switched off is
the trap the empty map is. The reader switched those districts off on the map, and this is not the
map.

`PREFS.ignored` needs no work. `camAlert()` in `js/stations.js` applies `isIgnored()` inside itself,
so an ignored river puts no border on the camera next to it. The camera itself is never ignored,
because a camera raises no alarm of its own.

Order is by state, then district, then name. That is the order `js/table.js` groups by, and two
"everything" views must not sort two ways.

### Markup

One new dialog in `index.html`, next to `#dataBox`:

```html
<dialog id="camBox">
  <div class="modalhead">
    <form method="dialog"><button class="icon dclose" title="Close" aria-label="Close"
      ><i class="i i-close"></i></button></form>
  </div>
  <h2>All cameras</h2>
  <p class="muted" id="camCount"></p>
  <div id="camGrid"></div>
</dialog>
```

`#camCount` states the count and nothing else: `91 cameras`. It is the same line `#dataCount`
holds, in the same place, so the two views open the same way.

Put `display` on `#camBox[open]`, never on `#camBox`. A `<dialog>` that carries `display` on the
element itself lays out on the page while closed. See the gotcha in `CLAUDE.md`. `#dataBox` shows
the correct shape.

### The grid

```css
#camGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
```

One declaration does the whole responsive question. At 360 pixels the grid is one column. In a
desktop dialog it is four or five. No JavaScript measures anything.

### A tile

```html
<button class="camtile t-now" data-mast="3.0512,101.7621" data-cam="1287">
  <img loading="lazy" alt="">
  <span class="camname">Kg Sungai Serai</span>
  <span class="camsay"><i class="i i-warning"></i>Water level at danger, 3.42 m</span>
</button>
```

A `<button>`, not a `<div>`. Keyboard reach, Enter, Space and the focus ring all come free.

`data-mast` carries the site key, the same attribute `js/table.js` puts on a row. `data-cam` carries
the numeric camera id, the same value `data-clip` carries in `camImg()`. The two ids are different
things. Keep both.

The `alt` is empty on purpose. The tile is a button with a text label next to the picture. An `alt`
makes a screen reader say the place name twice.

### Playback: one timer, not 91

New module `js/wall.js`. One `setInterval` at `CLIP_MS` steps every armed tile by one frame.

Do not run 91 copies of `js/clip.js`. Three reasons:

1. `clip.js` carries a generation counter and a rebind path. Both exist because `render()` replaces
   the `<img>` inside the open card on every poll. This view never rebuilds (see below), so that
   whole class of bug cannot happen here. A copy of the machinery costs work and prevents nothing.
2. 91 timers at 1 Hz is 91 wakeups a second. One timer writing twelve `src` values is one wakeup.
3. Tiles that step together read as one deliberate thing. Tiles out of phase read as 91 pictures
   flickering.

Each armed tile keeps its own frame list and its own position. The timer owns the clock. The tile
owns the place in the lap.

Frames come from `api.php?shots=<id>`, filtered to the last `CLIP_WIN` (3 hours). Keep the
`Array.isArray(r)` guard that `clip.js` and `timeline.js` both carry. The response is a
`[ts, tier, stationId]` row, and a cached 60-second response can still hold the old bare-number
shape.

A tile with fewer than two frames in the window keeps its live still and never animates. That is
`clip.js`'s rule and the reason for it holds here: an empty window means this server did not
capture, not that the camera stopped.

### What loads, and when

An eager wall costs 91 calls to `?shots=` and about 550 frames. That is roughly 80 MB. Refuse it.

An `IntersectionObserver` arms a tile the first time the tile scrolls into view. Arming does three
things in order:

1. Fetch the frame list.
2. Warm the lap with `new Image()` and `decode()`, the same warm-up `clip.js` does. Frames come off
   local disk and the server marks them immutable, so every lap after the first costs nothing.
3. Add the tile to the tick.

A tile that leaves view drops out of the tick and keeps its position and its decoded frames. A
reader who scrolls back finds the lap where they left it.

The first screen holds about twelve tiles, so the first screen costs about 10 MB.

`loading="lazy"` on the still is the browser doing the same job for the one image every tile has.
Use it. Do not write JavaScript for that part.

### A poll repaints, it does not rebuild

`js/render.js` rebuilds the open station card and calls `dataTable()` when the table is open. This
view must not join that list. A rebuild drops every tile to frame 0 in the middle of a lap, which is
the exact failure `clip.js` exists to prevent.

`render()` calls `repaint()` from `wall.js` instead. `repaint()` walks the tiles that exist, runs
`camAlert()` again for each one, and swaps the `t-*` class and the `.camsay` text. It tears nothing
down and touches no `<img>`.

A camera that appears between two polls waits for the next open. A camera list that changes
mid-session is a JPS outage recovering, not weather.

### The border and the words

`camAlert(cam)` gives the tier. It is the same call the lightbox pill makes. Same 2 km reach, same
`isIgnored()`, same exclusion of stale stations. This view makes no new claim and widens no alert
surface, so it does not go through the alert design standard as a new surface. It is one existing
claim on a new screen.

| tier | class | color |
|---|---|---|
| now | `t-now` | `--s-danger` |
| soon | `t-soon` | `--s-warning` |

Those are the two classes and the two tokens the ticker and the alert panel already use. Take the
values from the tokens. Never write a hex into `js/wall.js`.

The border alone is not enough. `js/popup.js` states the rule: color alone is not a message. So an
alerting tile also prints the tier phrase in `.camsay`, with the warning glyph.

The phrase comes from `ALERT_TITLE` in `js/config.js`, the same table the alert panel and the
lightbox pill read. The reading follows the phrase where the kind has one, through `CAM_READ` in
`js/popup.js`.

Do not write the phrase again in `wall.js`. One river must not make two claims.

A quiet tile has no `.camsay` content and no border color.

### The name, and hover

A quiet tile shows nothing over the picture until a pointer enters it. An alerting tile shows its
phrase at all times, because the phrase is the message.

Hover-to-reveal is the special case. Put it behind `@media (hover: hover) and (min-width: 601px)`,
the same query `PLAYER_OVERLAY` uses in `css/chrome.css`, and for the same reason. Outside that
query the name stays visible. A device that reports `hover: hover` wrongly then shows too much,
which is the failure that leaves the reader able to work.

Do not write the rule the other way around. `docs/FEATURES.md` records what happened when the
overlay was the default.

### The click

```js
camBox.close();
flashTo(cam);
```

Two lines, and `js/table.js:424` already runs them. `flashTo()` unhides the camera layer if the
reader switched it off, and it fires the click on the marker itself. The station panel then opens
with the full card, the 3-hour clip and the ⓘ menu.

Wire the click as one delegated listener on `#camGrid`, keyed off `[data-mast]`. Do not bind per
tile. 91 listeners for one behavior is the thing delegation exists to stop.

### Closing stops the clock

`camBox.onclose` clears the interval, disconnects the observer and empties `#camGrid`. Nothing ticks
behind a closed dialog.

`ui.js` calls `closeSide()` before it opens the dialog, the same as `#data` and `#about` do today.

---

## What this does not build

- **No compare, no scrubber, no transport.** The lightbox holds those. Two places to learn one
  control is one too many, which is the reason `clip.js` has no controls either.
- **No warning pill on a tile.** The pill states the alert on one frame, and it needs a way to
  score the frame on screen. A tile has no scrubber, so it has no way to ask. The border and the
  phrase answer the live question, and `repaint()` keeps them current.
- **No search box.** The table has one. A reader looking for one named camera has a better tool one
  menu item away.
- **No sort control, no filter chips, no favorites-only mode.** Add one when a reader asks for it.
- **No server change.** `?shots=` and `?shot=` already answer everything this needs.

## Files

| file | change |
|---|---|
| `index.html` | `#apps` button and its menu, `#camBox` dialog, `#data` and `#about` buttons removed |
| `css/icons.css` | one rule for the `apps` glyph |
| `css/chrome.css` | `#camBox`, `#camGrid`, `.camtile`, `.camname`, `.camsay`, the hover query |
| `js/wall.js` | new. Build, arm, tick, repaint, stop |
| `js/ui.js` | menu item handlers, the delegated tile click, `camBox` open and close |
| `js/render.js` | one line: call `repaint()` when `#camBox` is open |
| `CLAUDE.md` | a row for `js/wall.js` in the file table |
| `docs/FEATURES.md` | a section on this view and the App menu |

`js/wall.js` imports `flashTo` from `js/map.js`, exactly as `js/table.js` does. `js/map.js` imports
neither, so this adds no cycle.

Bump `?v=` on every stylesheet link in `index.html`. Herd serves CSS with a three-hour max-age.

## Verification

```bash
# Syntax-check the modules, including the new one.
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done

# Every file still serves. Check the type, not the status.
for f in js/*.js css/*.css; do
  curl -sk -o /dev/null -w "%{content_type} $f\n" "https://flood-exp.test/$f"; done | grep -v 'javascript\|css'

php shots-test.php
php api.php --selftest
```

By hand, in the browser:

1. Open the App menu. Check all four items open what they name.
2. Open All cameras. Count the tiles against the payload. Expect 91.
3. Watch one tile for a full lap. Check the tile does not jump on a poll.
4. Scroll to the foot of the grid. Check the network panel shows requests arriving as you scroll.
5. Turn test mode on. `CAM_EVERY` floods every third site that holds a camera and a river, so
   borders and phrases appear without waiting for weather.
6. Narrow the window to 360 pixels. Check one column, a visible name on every tile, and a header
   that does not wrap.
7. Tab through the grid. Check the focus ring, and check Enter opens the station panel.
8. Switch the theme with the grid open. Check both borders against the tokens.
