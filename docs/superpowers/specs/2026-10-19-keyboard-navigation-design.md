# Keyboard shortcuts and arrow-key navigation, 2026-10-19

The repository owner asked for a desktop mode that a keyboard can drive. Two parts: a set of
single-key shortcuts with a glyph that names them, and arrow-key travel through the lists and the
map pins. The owner asked that accessibility and ease of use come first. This document states what
exists, what is broken, and what to build.

This document is a plan. Nothing in it is built. Every call marked "my call" is a default the owner
can reject.

## What is there now

The table states the measured condition on 2026-10-19.

| surface | keyboard reach today | source |
|---|---|---|
| navigation rail, chip row, dialogs | Tab reaches every button. Each has a focus ring. | `index.html`, `css/chrome.css` |
| map | Tab reaches it. Arrows pan. Plus and minus zoom. | Leaflet's own keyboard handler, on by default |
| map pins and cluster chips | none. Painted on a canvas with `pointer-events: none`. | `js/pins.js` |
| alert list rows | none. Rows are `<li data-go>`, click only. | `js/alerts.js:222`, `js/ui.js:1579` |
| all-stations table rows | none. Rows are `<tr data-mast>`, click only. | `js/table.js:186`, `js/table.js:429` |
| search results | Up and Down move. Right and Left fold. Enter picks. Escape closes. | `js/ui.js:1527` |
| camera viewer | YouTube keys on the dialog. Space, `k`, `,`, `.`, arrows, End. | `js/timeline.js:553` |
| chip menus with radios | arrows move inside a radio group. The browser does this. | `index.html:1410` |
| sensor kinds menu | checkboxes. Tab only. No arrow travel. | `index.html:1445` |
| camera wall tiles | `<button>` elements. Tab only, across up to 91 tiles. | `js/wall.js:206` |
| moving strip | `tabindex="-1"` and `aria-hidden`. Deliberate. | `js/ticker.js:69` |
| tooltips on `data-tip` | pointer only. Focus opens none. | `js/sparktip.js:64` |
| a key that opens a dialog | none. Every dialog needs a pointer or Tab travel to its button. | |

Four faults follow from that condition.

A keyboard reader cannot reach a station from the map. The pins are the main way into a station,
and the canvas gives them no focus. A screen reader gets nothing from the map at all.

A keyboard reader cannot reach a station from the alert list or the table. Both lists are click
only. The search box is the one list that works, and a reader must know a name to use it.

Every destination costs Tab travel. The rail has nine buttons, the toggle and the theme included. The chip row has five. A reader
who wants the table from the map presses Tab up to twelve times.

A focused control shows no tooltip. A collapsed rail item shows a glyph alone, and the words that
name it open on hover alone.

The Help pane states one decision against this work. "Not built" under the Settings entry in
`docs/FEATURES.md` reads: "No `?` keyboard shortcut sheet. The four bindings already print on the
buttons that use them." This design reverses that decision, and the entry in `docs/FEATURES.md`
must say so.

## Intent

A reader at a desk, with both hands on the keyboard, reaches every destination and every station
without a pointer. A screen reader user gets the same reach, and hears where they are. Every key
this app binds is printed in one place, and that place opens with one key.

## Goals

- Every station is reachable from the map, the alert list and the table by keyboard alone.
- Every destination in the rail opens with one key.
- One key opens the list of keys.
- A screen reader announces the station a keyboard lands on.
- Nothing a pointer reader does today changes.

## Non-goals

- No change below 600px. The shortcuts stay live there, because a tablet can carry a keyboard, but
  nothing is designed for that width.
- No modifier chords. No Ctrl, Alt or Meta binding. The browser and the operating system own those.
- No user-set keys. One fixed table.
- No vim keys. `h`, `j`, `k` and `l` stay free.
- No shortcut text inside tooltips. The rail labels stay as they are.

## Anti-goals

- A key that fires while a reader types in a field. That is the fault every shortcut set is known
  for.
- A key that fires under a modal dialog and changes the page behind it.
- A second focus style. Every new ring reuses the ring `css/chrome.css` already draws.
- A hidden feature. A key nobody can find is a key nobody uses.

## Constraints

- Material Design 3 is the reference. M3 states a navigation rail item answers Enter and Space, a
  menu answers Up, Down, Home and End, and a list of items answers the same four. Where M3 states
  no key, WAI-ARIA Authoring Practices supplies it.
- The pins stay on the canvas. Performance was measured and the canvas won. The keyboard path must
  not put 400 DOM nodes back.
- No new dependency. No build step at request time.
- Every rendered string follows the writing standard. Sentence case, no hedging, no plumbing words.
- The source runs unbuilt and the build ships. A check must read both targets.

## The shortcut table

Single keys, no modifier. Letters are case-insensitive, so Caps Lock does not turn them off. That
is the rule `js/timeline.js` already states.

| key | act | today's control |
|---|---|---|
| `/` | open the search and focus its field | `#railFind` |
| `a` | open or close the alert list | `#railAlerts` |
| `t` | open the all-stations table | `#railTable` |
| `c` | open the camera wall | `#railCams` |
| `s` | open Settings | `#railSettings` |
| `?` | open Help at the Keyboard section | `#railHelp` |
| `l` | show my location | `#locate` |
| `d` | switch between light and dark | `#railApps` |
| `Escape` | close what is open | the browser does this for every dialog and popover already |

My call on the letters: each is the first letter of the rail label where that letter is free.
`l` for location follows the Help row "Show my location". `d` names dark. `?` for help and `/`
for search are the keys Gmail, GitHub and YouTube use, and a reader who knows one knows this one.

Four conditions gate a key. All four must hold before the key fires.

1. Ctrl, Alt and Meta are up. Shift is allowed, because `?` is Shift+`/` on most layouts. The
   handler reads `e.key`, which already carries the shifted character.
2. The focus is not in an `<input>`, `<textarea>` or `contenteditable` element.
3. No modal dialog is open, except that `Escape` always passes to the browser. The camera viewer,
   Settings, Help, About, the table and the camera wall are modal. The map and the supporting pane
   above 600px are not.
4. The key is in the table.

Only `a` is a toggle, because the alert list is not modal. A modal dialog blocks every key under
rule 3, so `t`, `c` and `s` open and never close. Escape is the one way out, and the sheet says so.

The handler presses the control. It does not call the function behind it. So the button flashes,
`aria-expanded` follows, and the rail state follows, through the one path the pointer already
uses. That is the rule `js/timeline.js` states for the viewer keys.

The table names the rail ids. Below 600px the rail does not draw, but its buttons are in the DOM
and `.click()` on a hidden button runs its handler. The theme key presses `#railApps`, and
`syncThemeBtn()` writes both twins from the preference. So one id per key serves both widths.
`#locate` is built by `js/locate.js` at run time, so the handler looks it up on each press.

Each control in the table carries `aria-keyshortcuts` with its key. The sheet prints `?` as `?`,
not as Shift+`/`, and the check compares against `e.key` values. A screen reader announces it
with the label. `aria-keyshortcuts="?"` is valid. `aria-keyshortcuts="/"` is valid.

## The glyph and the sheet

The Help pane gets one new section, `Keyboard`, between `Getting around` and `On the map`. Its
heading leads with the `keyboard` glyph from Material Symbols. The top of `css/icons.css` states
the fetch. The glyph costs one line for the mask and one for the class. The section is a `.key` grid. Each
row leads with a `<kbd>` and states the act in one short sentence. `css/chrome.css` already styles
`.docbox kbd`.

The section states every key in the table above, and every key the viewer binds, and the arrow
travel below. `keys-test.html` reads `KEYS` from the module and compares it with the `<kbd>` rows,
so the sheet cannot drift from the code.

`?` opens Help and scrolls that section into view. `openHelp()` in `js/ui.js` takes an optional
section id. The heading gets `id="helpKeys"`.

My call: the glyph sits on the Help heading alone. A ninth rail item costs a slot that M3 does not give the
rail. A chip on the map row names a map control, and this is not one. The sheet is a
Help page, so it lives where Help lives.

## Arrow-key navigation

Five surfaces gain arrow travel. Each follows the WAI-ARIA pattern it names.

### The map pins

The pins are a canvas, so the keyboard gets a cursor, not a focus. The cursor is one drawn mark,
pin or cluster chip.

The cursor IS the selection mark, and the owner asked for that on 2026-10-19. `markSel()` in
`js/map.js` already swaps the selected pin for the red teardrop. The cursor calls `markSel()` on
each move, so the teardrop travels with the keyboard and the pane opens on the station the mark
already names. A second mark beside the teardrop puts two answers to "which station" on one map.

The teardrop gains a focus ring while the keyboard drives it. `.pin.sel.kb` adds a 2px stroke in
the primary colour around the teardrop's own outline, the same ring every focused control draws.
The stroke goes on the `<use>` glyph, because a mask clips a CSS outline on the box. When the cursor
clears, the class clears with it. A pointer-selected pin then draws the plain red teardrop it draws
today.

A cursor on a cluster chip has no pin to swap. The chip takes the ring alone. `pins.js` draws it on the
canvas from the same primary token. The chip's edge already copies the pin's edge the same way.

When the map container has focus:

| key | act |
|---|---|
| Shift+Arrow | move the cursor to the nearest drawn mark in that direction |
| Enter or Space | open the mark. A pin opens its station card. A chip zooms to its members. The selection mark is already on it. |
| Home | move the cursor to the drawn mark nearest the centre of the view |

Plain arrows keep panning. Leaflet owns them and nothing changes there. Shift+Arrow is free,
because Leaflet pans on it too and that press has no second meaning a reader loses.

The nearest mark in a direction: among the marks `pins.js` drew this frame, keep those whose angle
from the cursor is within 45 degrees of the arrow, and take the closest. When no mark is in that cone,
the cursor does not move. The live region then says "No station that way."

The first press needs a start point. If a site is selected, the cursor starts there. If no site is
selected, the cursor starts at the mark nearest the view centre.

`pins.js` exports one function, `drawn()`, that returns the marks of the last frame with their
container points. The cursor reads that and nothing else. The cluster grid, the sprites and the hit
test do not change.

A live region, `<div id="mapSay" aria-live="polite" class="sr-only">`, announces the mark the
cursor lands on. A pin says the station name, the kind and the reading, in the words the alert list
row already prints. A chip says the count, for example "12 stations. Press Enter to zoom in." The
map container gets `role="application"` and `aria-roledescription="Map"`. With that role a screen
reader hands the arrows to the page and not to its own cursor. `aria-describedby` on the container points
at a hidden sentence that names the keys.

A pointer press on the map, a drag or a zoom clears the cursor's ring. The selection itself stays
where the card is, which is what `markSel()` does today. A cursor moved past a station without
Enter leaves no card open, so the mark then clears with the ring.

### The alert list and the table

Every `<li data-go>` in the alert list and every `<tr data-mast>` in the table gains
`tabindex="0"` and `role="button"`. A table row with no coordinate carries no `data-mast` and
gains neither, because it opens nothing. A delegated `keydown` in `js/ui.js` sends Enter and Space
on those two shapes through the same click path the pointer uses. It skips a native `<button>`,
because `[data-banner]` and some `[data-go]` already ride buttons and a button presses itself on
those keys. That alone fixes the fault that a keyboard cannot reach a station from either list.

Inside `#sideBody .slist` and inside `#dataBody`, Up and Down move focus to the next or previous
focusable row. Home and End move to the first and the last. The scope is the rows alone, so a
station card in `#sideBody` is untouched. In the alert list, rows fold into `<details>` sections,
so travel skips a row whose section is closed. Right and Left on a focused alert row close or open
its section, the way the search list already does. The table has no sections, so Right and Left do
nothing there. A row carries `aria-setsize` and `aria-posinset` so a screen reader states
"3 of 40."

The table's header cells already take a click to sort. They gain `tabindex="0"` and the same
Enter-and-Space rule. `aria-sort` states the current sort.

### The camera wall

The grid is two-dimensional, so Up and Down move by one row of tiles. The column count comes from
the grid's own computed template, read once per key press. Left and Right move by one tile. Home
and End move to the first and the last tile. This is the WAI-ARIA grid pattern with one cell per
tile. The tiles are `<button>` already, so Enter and Space open the viewer with no new code.

### The sensor kinds menu

The menu holds checkboxes, so the browser gives it no arrow travel. Up and Down move focus between
rows. Home and End reach the ends. Space toggles the box, which the browser already does. This is
the M3 menu's own keyboard behaviour, and the three radio menus already have it from the browser.

### Focus on a tooltip

`js/sparktip.js` opens the `data-tip` label on `pointermove`. It gains a `focusin` listener that
opens the same label for a focused control, and a `focusout` listener that closes it. Every rail
item, chip and icon button then names itself to a keyboard reader. This is WCAG 1.4.13, content on
hover or focus.

## The focus ring

The owner showed the ring on a rail item on 2026-10-19 and asked for it to change with this work.
The ring is the rounded box that Tab draws around a control.

### What is wrong with it

Nineteen rules draw a ring today, across three files, and no two agree. Thickness is 2px in all.
The colour is `--accent` in eleven and `--md-sys-color-primary` in seven. The offset is 2px, 1px,
-2px or -6px. The radius is whatever the control has, except on the rail.

The rail is the case in the picture. `#rail .railitem:focus-visible` in `css/chrome.css:403`
forces `border-radius: corner-medium`, which is 12px. The expanded item is a 28px pill, so the ring
is a box with small corners around a control with large ones. The collapsed item is a 64px column
holding a 56 by 32 pill. The ring wraps the column and the label, and M3 lights the pill alone.
That is the same fault the state-layer comment at `css/chrome.css:411` already records for hover.

### The rule

One ring, from M3's focus indicator, written once in `css/base.css` as two tokens: `--focus-ring`
for the outline and `--focus-off` for the offset. The thickness, the colour role and the offset
come from the reference set, `bczak/m3you`. Where that repo states none, material-web's
`md-focus-ring` supplies them: 3px, `--md-sys-color-secondary`, 2px outward. The builder reads the
reference file and records which one answered. If the reference asks for `--md-sys-color-secondary`,
`css/base.css` gains a bridge line for it.

The ring follows the shape of the thing it marks. No rule sets a radius for the ring alone.

On the rail, the ring goes where the state layer goes. Collapsed, it wraps `.railpill` at the
pill's own 16px radius, and the item itself draws none. Expanded, it wraps the row at the row's
own 28px radius. That is two selectors, keyed on `body.railopen`, the same split the hover rules
already make. The navigation bar below 600px takes the pill rule.

Every one of the nineteen rules reads the two tokens. A rule that today insets the ring keeps a
negative offset where an outward ring clips, for example inside a scrolling list. Each keeps its
comment and says why.

### Two controls with no ring

The map container shows none. `.leaflet-container:focus-visible` takes the ring, inset so the
card's radius clips nothing.

A list row shows none, because it was never focusable. `.slist li:focus-visible` and
`#dataBody tr:focus-visible` take the ring, inset by 2px, the way `summary.sensorhead` draws it in
`css/map.css:202`.

### The check

`keys-test.html` focuses one control of each kind and reads the computed outline. It asserts that
every ring resolves to the same width and colour. On the rail it asserts that the ring sits on
`.railpill` while collapsed and on the item while expanded. It also asserts that the ring's radius
equals the radius of the box it wraps.

## Module layout

One new module, `js/keys.js`. It holds `KEYS`, the global handler, the map cursor and the row
travel. It imports from `map.js`, `pins.js`, `stations.js` and `ui.js`, and nothing imports it.
`app.js` imports it after `ui.js`. That keeps the graph acyclic. `ui.js` exports `openHelp`,
`openSettings` and `setFind`, which are module-local today.

`pins.js` gains `drawn()`. `ui.js` gains the delegated Enter-and-Space rule for rows, because the
rows are rebuilt on every poll and `ui.js` already owns every delegated handler. `sparktip.js`
gains the two focus listeners.

The wall and the table keep their arrow travel in their own files, because each knows its own
grid. Both are lazy chunks, so neither imports `keys.js`. The helper `rove(container, selector,
e)` lives in `util.js`, which both already import. It is the one DOM helper in that file, and its
comment says why.

`js/timeline.js` exports its `KEYS` table, so the check can compare it with the sheet. The module
is deferred, so the check imports it directly.

## Check

A ninth runnable check, `keys-test.html`, under `chrome --headless --dump-dom`. It reads both
targets, the source and `?base=/site/`. It asserts:

- each key in `KEYS` presses its control, by reading `aria-expanded` or `dialog.open` after a
  synthetic `keydown` on `document`.
- a key pressed with focus in `#goto` does nothing.
- a key pressed while `#helpBox` is modal does nothing.
- every `<kbd>` in the Keyboard section names a key in `KEYS` or in the viewer's table, and every
  key in both tables appears in the section.
- every control in `KEYS` carries `aria-keyshortcuts` with that key.
- a Shift+ArrowRight on the focused map moves the cursor to a mark east of the start, and the live
  region names a station.
- after that press the `.pin.sel` marker stands on that station and carries `.kb`, and its stroke
  resolves to the primary token. A pointer click on another pin leaves `.sel` without `.kb`.
- Enter on the cursor opens `#side` with that station.
- the first alert row and the first table row carry `tabindex="0"`, and Enter on each opens the
  card.
- ArrowDown in `#sideBody` moves focus to the next row and skips a closed section.
- ArrowDown in `#camGrid` moves focus by one column count.
- `.leaflet-container:focus-visible` resolves to a 2px outline.

`m3-check.html` gains one row for the Keyboard section's heading glyph, the way it checks the other
Help headings. `docs/VERIFY.md` lists the new check. The `CLAUDE.md` file table gains a row for
`keys-test.html` and for `js/keys.js`. The same file states nine checks where it states eight.

## Documentation

`docs/FEATURES.md` gains one entry, "The keyboard reaches every station." It states the table and
the reason for each letter. It states the map cursor and its cone. It states the accepted costs and
the list below of what was not built. The "Not built" line under the Settings entry gets a dated sentence that says
this entry reversed it.

The Help section is written in the house style. Each row: one `<kbd>`, one sentence, no "it".

## Trade-offs accepted

- Shift+Arrow for pin travel means a screen reader user learns one chord. The alternative, plain
  arrows on the pins, takes panning away from every keyboard reader.
- The cursor moves the selection mark before a card opens. A reader who arrows past five stations
  sees the teardrop hop five times with no card. The ring says why.
- A row with `role="button"` loses list semantics for a screen reader. The alternative, an
  `<button>` inside each `<li>`, changes every row's markup and every selector that reads it.
  My call: the row keeps its tag and gains the role.
- Single-letter keys fire on a phone with a hardware keyboard too. Nothing there is designed for
  them, and nothing there breaks.
- `d` switches the shade and leaves Auto, the same as the rail button it presses.

## Not built

- No shortcut text in tooltips or on rail labels. The sheet is the one place.
- No key for the heat layer, the kinds or the two filters. A chip row is five Tab presses from the
  map, and five more letters is a code to learn.
- No key to walk the pins without the map focused. The map has to be the thing a reader is looking
  at, which is what focus states.
- No roving tabindex on the rail. Eight buttons, each a Tab press, is what M3's own rail does.
- No arrow travel inside the station card. Its sections are `<details>`, and Tab through
  `<summary>` elements is the platform's own behaviour.

## As built, and where it differs from this plan

The build followed the plan with these changes. `docs/FEATURES.md` records each one with its reason.

- The ring colour is the accent. The plan named M3's `secondary`, and this app bridges no such role.
- `rove()` is not in `util.js`. The travel code is delegated on `document` inside `js/keys.js`, so the
  table and the wall import nothing and gain no new chunk edge.
- A table row takes `tabindex="0"` and no `role="button"`. That role removes the row and cell
  structure. A sortable heading takes `tabindex="0"` and `aria-sort`.
- `aria-setsize` and `aria-posinset` are not written. They are not valid on the button role.
- The Keyboard section prints the camera viewer's keys as text. The check does not import the
  viewer's `KEYS`. The lightbox is bound by that module at load.
- The alert list is rebuilt on every poll, so `js/keys.js` returns focus to the same row. The plan
  did not state this.

## Left to the builder

- The exact inset of the map's focus ring against the card's 12px corner.
- The angle cone. If 45 degrees leaves a mark unreachable in a test, widen it to 60 and record why.
- The words the live region speaks, written in the house style and checked against `reading()` in
  `js/alerts.js` so the two do not drift.
- How the check waits for `#locate`, which `js/locate.js` builds after the map.
