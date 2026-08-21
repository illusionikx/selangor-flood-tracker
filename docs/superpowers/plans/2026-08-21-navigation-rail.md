# Navigation Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the five app bar controls into an M3 navigation rail above 600px and an M3 navigation bar below it.

**Architecture:** Two new tokens, `--rail-w` and `--navbar-h`, carry the width the rail takes and the height the bar takes. The map card and every furniture box read them. The search moves into `#pane` as a third box. The locate button moves to the zoom cluster on the map. `syncPane()` writes the active item.

**Tech Stack:** Plain HTML, CSS and ES modules. No build step. M3 numbers come from bczak/m3you. Checks run in headless Chrome.

**Spec:** `docs/superpowers/specs/2026-08-21-navigation-rail-design.md`

## Global Constraints

- No build step. Keep relative import specifiers with the `.js` extension.
- Bump `?v=` on any stylesheet you touch, in `index.html`.
- Write no hex color into a JS file. Read a token.
- Reserve traffic-light hues for station status. Do not paint a control with one.
- Every M3 number comes from the reference repo. Cite the file in a comment.
- Prose in a file follows Simplified Technical English. Run
  `python "C:/Users/illus/.claude/ste-lint.py" < FILE` before you report a doc as done.
- `--rail-w` is 96px above 600px and 0 below. `--navbar-h` is 0 above 600px and 64px below.
- The map card is the main pane. It gives up width to the rail and height to the bar.

## How to run a check

Every task ends with one of the headless checks. Define this once per shell:

```bash
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
chk() { "$CHROME" --headless=new --disable-gpu --ignore-certificate-errors \
  --virtual-time-budget=240000 --window-size=1600,1000 --dump-dom \
  "https://flood-exp.test/$1" \
  | perl -0777 -ne 'print $1 if /<pre id="out">(.*?)<\/pre>/s'; }
```

`m3-check.html` ran at 180000 before this work. It gains about 40 assertions here, so the budget
rises to 240000. A short budget truncates the check rather than fails it. Read the last line. No
`PASS` means the run did not finish.

Syntax-check the modules after any change under `js/`:

```bash
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
```

## File structure

| file | what changes |
|---|---|
| `index.html` | the rail, the bar, the search moves into `#pane`, `#locate` moves to the map, the `?v=` bumps, `viewport-fit=cover` |
| `css/base.css` | `--rail-w`, `--navbar-h`, two color bridge lines |
| `css/chrome.css` | the rail, the bar, the search occupant, every furniture offset |
| `css/icons.css` | one line leaves the explicit mask list |
| `js/map.js` | `syncPane()` reads a third body class and writes the active item |
| `js/ui.js` | `setFind()` writes the new class, and one handler serves both controls |
| `js/alerts.js` | write the count into a badge, never over the whole button |
| `m3-check.html` | the rail, the bar, the third occupant, the furniture sweep |
| `docs/FEATURES.md` | the record of what shipped and why |
| `CLAUDE.md` | the file table, the gotchas, the Conventions, the Verify block |

---

### Task 1: The search becomes a third box in `#pane`

The rail cannot hold a 300px field, so the search moves first. The app bar is still there to open
it. After this task `#find` still sits in the app bar. It opens the pane rather than expanding in
place.

**Files:**
- Modify: `index.html:288-293` (move `#gotoBox`), `index.html:994` (insert before `#bar`)
- Modify: `css/chrome.css:1515-1531` (the swap), `:1611` (the header), `:1152` (`#barBody`),
  `:1156-1161` (the display pair), `:1723-1747` (the old box), `:2528-2540` (the old phone rules)
- Modify: `js/map.js:50-57` (`syncPane()`), `:78-80` (the `close` listener)
- Modify: `js/ui.js:965-985` (`setFind()`)
- Test: `m3-check.html:268`

**Interfaces:**
- Consumes: nothing from an earlier task.
- Produces: body class `find`. Elements `#findpane`, `#findHead`, `#findBody`, `#findClose`.
  `setFind(open: boolean)` keeps its name and its signature.

- [ ] **Step 1: Add the failing assertions to `m3-check.html`**

Above the occupant loop at line 268, add:

```js
  is(!!d.getElementById('findpane'), true,
     'the search is a box inside the pane, because a 96px rail cannot hold a 300px field');
```

Then extend the loop itself:

```js
  for (const [id, cls, name] of [['bar', 'drawer', 'filters'], ['side', 'side', 'station panel'],
                                 ['findpane', 'find', 'search']]) {
```

- [ ] **Step 2: Run the check and watch it fail**

Run: `chk m3-check.html | tail -20`
Expected: FAIL on `the search is a box inside the pane`, and FAIL on every `search:` line.

- [ ] **Step 3: Move the markup**

Delete `index.html:288-293` and the comment block above it. Insert this immediately before
`<div id="bar" class="paneswap">` at line 994:

```html
<!-- The search is a pane occupant and not a bar control. A 96px navigation rail cannot hold a 300px
     field, and `#pane` is the search view M3 states at compact width and a side sheet above it.
     Same three parts as `#bar`: a header that does not scroll, and a body that does. -->
<div id="findpane" class="paneswap">
  <div id="findHead">
    <div class="apptop">
      <button id="findClose" class="icon" title="Back" aria-label="Back"
        ><i class="i i-arrow_back"></i></button>
      <span class="apsp"></span>
    </div>
    <div class="apflex"><h2>Go to</h2></div>
  </div>
  <div id="findBody" class="scroll">
    <div id="gotoBox">
      <input id="goto" type="text" autocomplete="off" placeholder="Go to a station…"
             role="combobox" aria-expanded="false" aria-controls="gotoHits" aria-autocomplete="list"
             aria-label="Go to a station">
      <!-- No `.surface` any more. The list floated over the map before. It sits inside the pane
           now, so a second background and a second shadow draw a card inside a card. -->
      <ul id="gotoHits" class="picklist" role="listbox" hidden></ul>
    </div>
  </div>
</div>
```

- [ ] **Step 4: Teach `syncPane()` the third class**

In `js/map.js`, change the `want` line inside `syncPane()`:

```js
  const want = cls.contains('drawer') || cls.contains('side') || cls.contains('find');
```

And the `close` listener below it:

```js
pane.addEventListener('close', () => {
  if (!pane.open) document.body.classList.remove('drawer', 'side', 'find');
});
```

- [ ] **Step 5: Rename the body class in `js/ui.js`**

In `setFind()`, change the first line, and add the one-occupant rule under it:

```js
function setFind(open) {
  document.body.classList.toggle('find', open);
  /* One pane holds one occupant, so opening the search replaces whatever was there. The other two
     do the same to each other already — see `setDrawer()` and the `sideopen` listener. */
  if (open) { closeSide(); document.body.classList.remove('drawer'); }
  findBtn.setAttribute('aria-expanded', open);
```

Leave the rest of the function unchanged. Add a back button handler beside `findBtn.onclick`:

```js
el('findClose').onclick = () => setFind(false);
```

- [ ] **Step 6: Move the CSS**

In `css/chrome.css`, join `#findpane` to the swap rules at 1515-1531. Change each selector and
leave every declaration alone:

```css
#bar, #side, #findpane { opacity: 0; }
body.drawer #bar, body.side #side, body.find #findpane { /* keep every declaration exactly as it stands */ }
```

Do the same inside the two `@starting-style` blocks and the `body:not(.ready)` rule.

Join `#findHead` to the header rule at 1611 and `#findBody` to `#barBody` at 1152:

```css
#barHead, #sideHead, #findHead { /* keep every declaration exactly as it stands */ }
#barBody, #findBody { /* keep every declaration exactly as it stands */ }
```

Add the display pair beside the ones at 1156-1161:

```css
#findpane { display: none; }
body.find #findpane { display: flex; flex-direction: column; }
body:is(.drawer, .side) #findpane { display: none; }
```

Delete `#gotoBox`, `body.finding #gotoBox`, `body.finding #find` and `#gotoHits` at 1723-1747.
Delete `body.finding #ticker`, `body.finding #gotoBox`, `body.finding #goto`, `#gotoBox::after`
and `#gotoHits` at 2528-2540. Put this in place of all of it:

```css
/* The field fills the pane body. It was a 300px box that opened where its button stood, and both
   numbers belonged to a bar this control has left. */
#gotoBox { position: relative; }
#goto {
  width: 100%; padding: 10px 12px; font: inherit;
  color: var(--on-surface); background: var(--surface);
  border: 1px solid var(--outline); border-radius: var(--md-sys-shape-corner-full);
}
#goto:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
#gotoHits { margin: 8px 0 0; padding: 0; list-style: none; }
```

- [ ] **Step 7: Extend the `--pane-w` rule**

At `css/chrome.css:1541`, add the third class:

```css
@media (min-width: 601px) {
  body:is(.drawer, .side, .find) { --pane-w: var(--pane); }
}
```

- [ ] **Step 8: Bump the stylesheet version**

Raise `css/chrome.css?v=` by one in `index.html`.

- [ ] **Step 9: Syntax-check and run the check**

Run the `node --check` loop, then `chk m3-check.html | tail -20`
Expected: PASS, with the three `search:` lines green.

- [ ] **Step 10: Look at the page**

Open `https://flood-exp.test/` at 1400px. Press the search button. The pane opens on the trailing
edge with the field in it. Type `bandar`. Rows appear. Press one. A station card replaces the
search in the same pane. Repeat at 360px, where the pane is a full-screen dialog.

- [ ] **Step 11: Commit**

```bash
git add index.html css/chrome.css js/map.js js/ui.js m3-check.html
git commit -m "Open the search in the pane rather than in the app bar

A navigation rail is 96px wide and the search field is 300px. So the field
moves into #pane, beside the filters and the station card. The body class is
find, and syncPane() reads it with the other two."
```

---

### Task 2: The locate button moves to the zoom cluster

`#locate` acts on the map. A navigation rail holds destinations. This app already states the rule.
A control the reader reaches for while looking at the map goes on the map.

**Files:**
- Modify: `index.html:303` (remove), `index.html:1095` (insert above `#paint`)
- Modify: `css/chrome.css:233-242` (the glyph states), `:1187-1188` (the placement)
- Modify: `css/icons.css` (the explicit mask list)
- Test: `m3-check.html:846`, `paint-check.html`

**Interfaces:**
- Consumes: nothing from an earlier task.
- Produces: `#locate` as a `.mapbtn`, stacked above `#paint` in one column.

- [ ] **Step 1: Add the failing assertions to `m3-check.html`**

At the `FURNITURE` array on line 846, add `#locate`:

```js
    const FURNITURE = ['#legend', '#paint', '#locate', '#credit', '#pills', '#toast',
                       '.leaflet-control-zoom', '.leaflet-control-scale'];
```

Add two assertions under the clash test:

```js
    const lb = r(d.getElementById('locate')), pb = r(d.getElementById('paint'));
    is(Math.round(lb.left), Math.round(pb.left),
       label + ': locate and layers share one column in the zoom cluster');
    is(lb.bottom <= pb.top + 0.5, true, label + ': and locate sits above layers');
```

- [ ] **Step 2: Run the check and watch it fail**

Run: `chk m3-check.html | tail -20`
Expected: FAIL. `#locate` is still an app bar `.icon`, so its box is nowhere near `#paint`.

- [ ] **Step 3: Move the markup**

Delete line 303 of `index.html` and the comment above it. Insert this above
`<button id="paint" …>` at 1095:

```html
<!-- On the map, not in the app bar. It acts on the map, and the rail beside it holds destinations.
     Stacked above `#paint` in one column, so the two read as one cluster with the zoom buttons. -->
<button id="locate" class="mapbtn" title="Show my location" aria-label="Show my location"
  ><i class="i i-my_location"></i></button>
```

- [ ] **Step 4: Rewrite the glyph states**

`#locate` carried its glyph on `::before`, which needed the explicit mask list in `css/icons.css`.
It carries a real `<i>` child now, so the class supplies the mask. Put this in place of
`css/chrome.css:233-242`:

```css
/* Three states, and `setBtn()` in js/locate.js writes all three. The words ride `data-tip` and the
   state rides the glyph. A broken control changes its glyph, never its hue: an amber glyph on a
   flood map reads as an alert on the water. */
#locate.busy { pointer-events: none; }
#locate.busy .i { animation: pulse 1s infinite; }
#locate.on .i { --i: var(--i-near_me); color: var(--accent); }
#locate.fail .i { --i: var(--i-location_disabled); }
```

Remove `#locate::before` from the explicit selector list in `css/icons.css`. That list exists for a
box whose `content` is already spoken for. This element has a child now.

- [ ] **Step 5: Place it above `#paint`**

Put this in place of `css/chrome.css:1187-1188`:

```css
/* One column with the zoom control. `#paint` keeps the bottom slot beside the zoom buttons and
   `#locate` stacks above it. `--fab` plus 8px is the step between the two.
   **State the `--fab` fallback.** That variable is declared on `.mapbtn` itself, so a rule written
   here cannot inherit it and `var(--fab)` alone resolves to nothing. */
#paint, #locate { position: absolute; z-index: 401;
  right: calc(48px + var(--pane-w) + var(--seam)); }
#paint  { bottom: calc(36px + var(--gap) + var(--navbar-h)); }
#locate { bottom: calc(36px + var(--gap) + var(--navbar-h) + var(--fab, 60px) + 8px); }
```

`--navbar-h` does not exist until Task 3. `var()` with no fallback and no declaration makes the
whole `calc()` invalid, so add the two tokens now, in `css/base.css` beside `--hdr: 64px`:

```css
  --rail-w: 0px;
  --navbar-h: 64px;
```

Task 3 adds the comment above them and the 601px override. Declaring them early is what keeps this
the `calc()` in this task valid on its own commit.

- [ ] **Step 6: Bump the stylesheet versions**

Raise `css/base.css?v=`, `css/chrome.css?v=` and `css/icons.css?v=` by one each in `index.html`.

- [ ] **Step 7: Run both checks**

Run: `chk m3-check.html | tail -20` then `chk paint-check.html | tail -20`
Expected: PASS on both.

- [ ] **Step 8: Look at the page**

Open the app at 1400px. The locate button sits above the layers button, and both stand above the
zoom pair. Press it. The three states still draw: the pulse, the filled crosshair, and the
struck-through crosshair after a failed fix.

- [ ] **Step 9: Commit**

```bash
git add index.html css/base.css css/chrome.css css/icons.css m3-check.html
git commit -m "Put the locate button on the map beside the layers button

It acts on the map, and a navigation rail holds destinations. It carries a
real <i> child now rather than a pseudo-element, so the mask comes from the
class and the explicit list in icons.css loses a line."
```

---

### Task 3: The tokens and an empty rail column

This task takes the width without filling it. The map narrows, the leading furniture steps aside,
and the rail draws as an empty `--surface` column. No button moves yet.

**Files:**
- Modify: `css/base.css:97` (the comment on the two tokens)
- Modify: `css/chrome.css:45-48` (the 601px block), `:28-34` (`#map`), `:374` (`#pills`),
  `:1388-1391` (`#legend`), plus a new rail section
- Modify: `index.html` (insert `<nav id="rail">` after `</header>`)
- Test: `m3-check.html:463`

**Interfaces:**
- Consumes: `--rail-w` and `--navbar-h`, declared in Task 2 Step 5.
- Produces: element `#rail`. `--rail-w` reads 96px above 600px.

- [ ] **Step 1: Add the failing assertions to `m3-check.html`**

Beside the map card block at line 463, add:

```js
  const RAIL = parseFloat(cs(d.documentElement).getPropertyValue('--rail-w'));
  const railEl = d.getElementById('rail');
  is(RAIL, VW > 600 ? 96 : 0, 'the rail is 96px above 600px and takes no width below it');
  is(Math.round(r(mapBox).left), Math.round(RAIL + GAP),
     'the map card starts after the rail plus the window margin');
  if (RAIL) {
    const rb = r(railEl);
    is([rb.left, rb.width].map(Math.round).join(','), '0,96',
       'the rail is flush with the leading edge and 96px wide');
    is(Math.round(rb.top), Math.round(hdr), 'and it starts under the app bar');
    is(cs(railEl).paddingTop + ' ' + cs(railEl).paddingBottom, '44px 20px',
       'M3 padding-block 44px 20px, from NavigationRail/navigation-rail.css');
  }
```

- [ ] **Step 2: Run the check and watch it fail**

Run: `chk m3-check.html | tail -20`
Expected: FAIL on `the rail is 96px above 600px`. It reads 0, because no 601px override exists.

- [ ] **Step 3: Comment the tokens and add the override**

In `css/base.css`, above the two lines Task 2 added:

```css
  /* The rail takes width from the map above 600px. The bar takes height from it below. Each is 0 at
     the width the other one draws, so one expression on `#map` covers both. */
```

In `css/chrome.css`, extend the `:root` line inside the existing `@media (min-width: 601px)` block
at line 46:

```css
  :root { --gap: 16px; --seam: 8px; --rail-w: 96px; --navbar-h: 0px; }
```

- [ ] **Step 4: Add the empty rail**

Insert this immediately after `</header>` in `index.html`:

```html
<!-- M3's navigation rail, collapsed variant. Every number comes from
     https://github.com/bczak/m3you/blob/development/src/components/NavigationRail/navigation-rail.css
     It is a `<nav>` and never a dialog, so it does not join the roll call in m3-check.html and needs
     an assertion block of its own there.
     Empty in this commit. The items arrive with the buttons that leave the app bar. -->
<nav id="rail" aria-label="Main"></nav>
```

- [ ] **Step 5: Style the container**

Add this to `css/chrome.css`, under the top app bar section:

```css
/* --- navigation rail ---------------------------------------------------------------------------
   M3's collapsed rail: 96px wide, `padding-block: 44px 20px`, on the surface tone. It stands under
   the app bar and beside the map card, so it takes the height that is left.
   **No divider on the edge facing the map.** This app separates surfaces by space, and `--gap` is
   already the seam between the two. The app bar and the pane each lost the same rule. */
#rail {
  position: absolute; z-index: 600; top: var(--hdr); bottom: 0; left: 0;
  box-sizing: border-box; width: var(--rail-w);
  display: flex; flex-direction: column; overflow-y: auto; scrollbar-width: none;
  padding-block: 44px 20px;
  background: var(--md-sys-color-surface);
}
@media (max-width: 600px) { #rail { display: none; } }
```

- [ ] **Step 6: Give the map and the leading furniture the term**

Put this in place of the `#map` inset at `css/chrome.css:30`:

```css
  inset: calc(var(--hdr) + var(--gap)) calc(var(--pane-w) + var(--seam))
         calc(var(--navbar-h) + var(--gap)) calc(var(--rail-w) + var(--gap));
```

`#legend` is the only furniture box on the leading edge. Put this in place of lines 1390-1391:

```css
  left: calc(12px + var(--gap) + var(--rail-w));
  bottom: calc(30px + var(--gap) + var(--navbar-h)); width: 288px;
  max-width: calc(100vw - var(--rail-w) - var(--pane-w) - var(--seam) - var(--gap) - 128px);
```

`#pills` centres on the strip of map that is visible, so it takes half of each term. Put this in
place of line 374:

```css
  left: calc(50% + var(--rail-w) / 2 - var(--pane-w) / 2);
```

- [ ] **Step 7: Bump the stylesheet versions**

Raise `css/base.css?v=` and `css/chrome.css?v=` by one each in `index.html`.

- [ ] **Step 8: Run the check**

Run: `chk m3-check.html | tail -20`
Expected: PASS. The furniture clash sweep must stay empty at every band.

- [ ] **Step 9: Look at the page**

Open the app at 1400px, 900px and 700px. An empty column stands on the leading edge. The map card
starts after it. The legend clears it. No two boxes overlap.

- [ ] **Step 10: Commit**

```bash
git add index.html css/base.css css/chrome.css m3-check.html
git commit -m "Take the leading edge for the navigation rail

--rail-w and --navbar-h carry what the rail and the bar take from the map.
The map card, the legend and the pills read them. The rail is empty in this
commit, so nothing on the app bar has moved yet."
```

---

### Task 4: The rail items, and the app bar controls go

**Files:**
- Modify: `index.html:256-334` (the header), `index.html` (`#rail`, `#appMenu`)
- Modify: `css/chrome.css:122-127` (delete `.hactions`), plus the rail item rules
- Modify: `js/ui.js` (the handlers)
- Modify: `js/alerts.js:287-293` (write into a child)
- Test: `m3-check.html`, `title-test.html`

**Interfaces:**
- Consumes: `#rail` from Task 3. `setFind()` and body class `find` from Task 1.
- Produces: classes `.railitem`, `.railpill`, `.raillabel`, `.railbadge`, `.railsp`. Ids
  `railFilters`, `railAlerts`, `railFind`, `railTable`, `railCams`, `railHelp`, `railAbout`,
  `railApps`. `#appMenu` keeps its id and holds `#themeRow` alone.

- [ ] **Step 1: Add the failing assertions to `m3-check.html`**

Inside the `if (RAIL)` block from Task 3, add:

```js
    const items = [...railEl.querySelectorAll('.railitem')];
    is(items.map(b => b.id).join(','),
       'railFilters,railAlerts,railFind,railTable,railCams,railHelp,railAbout',
       'seven rail items, in the order the spec states');
    const first = items[0];
    is(Math.round(r(first).height), 64, 'M3 item min-height 64px');
    is(cs(first.querySelector('.i')).fontSize, '24px', 'M3 icon 24px');
    is(cs(first.querySelector('.raillabel')).fontSize,
       cs(d.documentElement).getPropertyValue('--md-sys-typescale-title-small-size').trim(),
       'M3 label title-small');
    const pill = r(items[0].querySelector('.railpill'));
    is([pill.width, pill.height].map(Math.round).join(','), '56,32',
       'M3 active indicator 56 by 32');
    is(!!railEl.querySelector('hr'), true,
       'a divider separates the five destinations from Help and About');
    is(railEl.querySelector('hr').previousElementSibling.id, 'railCams',
       'and it sits after Cameras');
    is(railEl.lastElementChild.id, 'railApps', 'the theme button is the last thing in the rail');
    is(!!d.querySelector('header .hactions'), false,
       'the app bar carries no control group any more');
    is(d.querySelectorAll('header button').length, 0, 'and no button at all above 600px');
```

- [ ] **Step 2: Run the check and watch it fail**

Run: `chk m3-check.html | tail -20`
Expected: FAIL on `seven rail items`, which reads as an empty string.

- [ ] **Step 3: Fill the rail**

Put this in place of `<nav id="rail" aria-label="Main"></nav>`:

```html
<nav id="rail" aria-label="Main">
  <button class="railitem" id="railFilters" aria-controls="pane" aria-expanded="false"
    ><span class="railpill"><i class="i i-menu"></i></span
    ><span class="raillabel">Filters</span></button>
  <!-- alerts.js writes the colour and the count. It writes into `.railbadge` alone, never over the
       whole button, or the label and the pill go with it. -->
  <button class="railitem" id="railAlerts" aria-controls="pane" aria-expanded="false"
    ><span class="railpill"><i class="i i-warning"></i><b class="railbadge"></b></span
    ><span class="raillabel">Alerts</span></button>
  <button class="railitem" id="railFind" aria-controls="pane" aria-expanded="false"
    ><span class="railpill"><i class="i i-search"></i></span
    ><span class="raillabel">Search</span></button>
  <button class="railitem" id="railTable"
    ><span class="railpill"><i class="i i-list_alt"></i></span
    ><span class="raillabel">Table</span></button>
  <button class="railitem" id="railCams"
    ><span class="railpill"><i class="i i-photo_camera"></i></span
    ><span class="raillabel">Cameras</span></button>
  <hr>
  <button class="railitem" id="railHelp"
    ><span class="railpill"><i class="i i-info"></i></span
    ><span class="raillabel">Help</span></button>
  <button class="railitem" id="railAbout"
    ><span class="railpill"><i class="i i-flood"></i></span
    ><span class="raillabel">About</span></button>
  <span class="railsp"></span>
  <!-- The theme picker keeps its own button. It is a setting rather than a destination, so it sits
       under the spacer and takes no rail item. The `.menu` class on the popover is what the
       delegated placement handler in js/ui.js keys on, so this needs no positioning code. That
       handler places a menu by the edge it opens FROM, and this button is in the left half and the
       bottom half — which is `#paint`'s own case. -->
  <button id="railApps" class="icon" title="Theme" aria-label="Theme"
          popovertarget="appMenu"><i class="i i-dark_mode"></i></button>
</nav>
```

Move the whole `<div id="appMenu" class="menu surface" popover>` block out of the header and put it
immediately after `</nav>`. Delete the four `.mi` buttons for Station table, All cameras, Help and
About from it, and delete the `<hr>` above `#themeRow`. The menu keeps `#themeRow` alone.

- [ ] **Step 4: Empty the app bar**

In `index.html`, delete the whole `<div class="hactions">…</div>` block and the `#menu` button at
line 257 with its comment. The header keeps the `<h1>`, `#netstats` and `#ticker`.

- [ ] **Step 5: Style the items**

Add this to `css/chrome.css`, under the `#rail` rule:

```css
/* One item, from NavigationRail/navigation-rail.css: `min-height: 64px`, a 24px icon, a
   `title-small` label, and a 56 by 32 indicator pill. The pill is `.railpill` rather than a third
   absolutely positioned element, because this app has one glyph per item and no state layer to
   stack under it. */
#rail .railitem {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 4px; width: 100%; min-height: 64px; padding: 0;
  border: 0; background: none; cursor: pointer;
  color: var(--md-sys-color-on-surface-variant);
  transition: color var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-standard);
}
#rail .railitem + .railitem { margin-top: 4px; }
#rail .railpill {
  position: relative; display: grid; place-items: center;
  width: 56px; height: 32px; border-radius: 16px;
  transition: background-color var(--md-sys-motion-duration-short2)
              var(--md-sys-motion-easing-standard);
}
#rail .railitem .i { font-size: 24px; }
#rail .raillabel {
  font-size: var(--md-sys-typescale-title-small-size);
  line-height: var(--md-sys-typescale-title-small-line-height);
  font-weight: var(--md-sys-typescale-title-small-weight);
}
#rail .railitem:hover { color: var(--md-sys-color-on-surface); }
#rail .railitem:focus-visible {
  outline: 2px solid var(--md-sys-color-primary); outline-offset: 2px;
  border-radius: var(--md-sys-shape-corner-medium);
}
/* The count rides the corner of the pill, the way the app bar badge rode the button. `:empty`
   removes it, because a zero-width pill still draws its own background. */
#rail .railbadge {
  position: absolute; top: -2px; right: 6px; min-width: 16px; padding: 0 4px;
  font-size: 10px; font-weight: 500; line-height: 16px; text-align: center;
  color: var(--surface); background: var(--c, var(--muted)); border-radius: 999px;
}
#rail .railbadge:empty { display: none; }
#rail hr {
  width: 56px; height: 1px; margin: 12px auto; border: 0;
  background: var(--md-sys-color-outline-variant);
}
#rail .railsp { flex: 1; }
#rail #railApps { margin: 0 auto; flex: none; }
@media (prefers-reduced-motion: reduce) {
  #rail .railitem, #rail .railpill { transition: none; }
}
```

Delete the `header .hactions` rule at `css/chrome.css:122-127` and its comment.

- [ ] **Step 6: Move the handlers**

In `js/ui.js`, point every handler that named a header button at its rail item:

```js
el('railFilters').onclick = () => setDrawer(!document.body.classList.contains('drawer'));
el('railFind').onclick    = () => setFind(!document.body.classList.contains('find'));
el('railAlerts').onclick  = toggleAlerts;
el('railHelp').onclick    = () => { closeSide(); helpBox.scrollTop  = 0; helpBox.showModal(); };
el('railAbout').onclick   = () => { closeSide(); aboutBox.scrollTop = 0; aboutBox.showModal();
                                    paintDev(); };
```

`railTable` and `railCams` are a rename and never a copy. Change the two assignment lines at
`js/ui.js:237` and `js/ui.js:262` and leave every line of both bodies alone:

```js
el('railTable').onclick = async () => {   // was el('data')
el('railCams').onclick  = async () => {   // was el('cams')
```

Delete the old `menu.onclick`, `findBtn.onclick`, `el('alertBtn').onclick`,
`el('cams').onclick`, `el('help').onclick` and `el('about').onclick` lines. Replace every remaining
reference to `findBtn` inside `setFind()` with `el('railFind')`, and every reference to `menu`
inside `setDrawer()` with `el('railFilters')`. Delete the `const menu = el('menu')` and
`const findBtn = el('find')` declarations, or repoint them at the new ids.

- [ ] **Step 7: Stop `alerts.js` writing over the whole button**

Put this in place of `js/alerts.js:287-293`:

```js
  /* The rail item holds a pill, a glyph, a badge and a label. So this writes the count into the
     badge alone. Writing `innerHTML` on the button takes the label and the pill with it, and the
     item then draws as a bare number under nothing. */
  const btn = el('railAlerts');
  btn.style.setProperty('--c', c);
  btn.querySelector('.railbadge').textContent = live.length || '';
  const what = live.length ? `${live.length} station${live.length > 1 ? 's' : ''} on alert`
                           : 'On alert — all clear';
  btn.title = what;
  btn.setAttribute('aria-label', what);
```

Search `js/` for every other reader of `alertBtn` and repoint it. `js/map.js` syncs `aria-expanded`
on it from `openSide()` and `closeSide()`.

```bash
grep -rn "alertBtn\|'find'\|'menu'\|'data'\|'cams'\|'help'\|'about'" js/
```

- [ ] **Step 8: Bump the stylesheet version**

Raise `css/chrome.css?v=` by one in `index.html`.

- [ ] **Step 9: Syntax-check, then run both checks**

Run the `node --check` loop, then `chk m3-check.html | tail -20` and
`chk title-test.html | tail -20`
Expected: PASS on both. The wordmark ladder is a container query on the title rail, and that rail
still caps at 300px, so `title-test.html` must not move above 600px. Read the result rather than
assume it.

- [ ] **Step 10: Look at the page**

Open the app at 1400px. Seven labelled items stand in the rail. Press each one. Filters, Alerts and
Search open the pane. Table and Cameras open their dialogs. Help and About open their panes. The
theme button at the foot opens the picker beside itself, and the picker grows upward.

- [ ] **Step 11: Commit**

```bash
git add index.html css/chrome.css js/ui.js js/alerts.js m3-check.html
git commit -m "Move the app bar controls into the navigation rail

Five destinations, a divider, then Help and About. The theme picker keeps its
own button under the spacer, because a setting is not a destination.
alerts.js writes the count into a badge now rather than over the whole
button, which would take the label with it."
```

---

### Task 5: The selected state

**Files:**
- Modify: `css/base.css:29-42` (the color bridge)
- Modify: `css/chrome.css` (the active rules)
- Modify: `js/map.js:50-79` (`syncPane()`), and beside `openSide()`
- Modify: `js/ui.js` (the two dialogs report themselves)
- Test: `m3-check.html`

**Interfaces:**
- Consumes: the `.railitem` ids from Task 4.
- Produces: `railActive(id: string | null)`, exported from `js/map.js`. It sets
  `aria-current="page"` on the one item named and clears every other item.

- [ ] **Step 1: Add the failing assertions to `m3-check.html`**

Inside the `if (RAIL)` block, add:

```js
    const active = () => [...railEl.querySelectorAll('[aria-current="page"]')].map(b => b.id);
    d.body.classList.remove('drawer', 'side', 'find');
    await settled();
    is(active().join(','), '', 'a bare map selects no rail item');
    d.body.classList.add('drawer');
    await settled();
    is(active().join(','), 'railFilters', 'the filters light their own item and nothing else');
    /* **Compare against a probe, never against a hex.** `getComputedStyle` reports a background as
       `rgb(...)` and a custom property as whatever the author wrote, so the two never match as
       strings. A throwaway span painted with the same token settles both through the same engine.
       This app moved its palette four times, so no check here may hold a copy of a colour. */
    const probe = d.createElement('span');
    probe.style.background = 'var(--md-sys-color-secondary-container)';
    d.body.appendChild(probe);
    is(cs(d.getElementById('railFilters').querySelector('.railpill')).backgroundColor,
       cs(probe).backgroundColor,
       'and the indicator takes the selected fill this app already uses');
    probe.remove();
    d.body.classList.remove('drawer');
    await settled();
    is(active().join(','), '', 'and closing it clears the item');
```

- [ ] **Step 2: Run the check and watch it fail**

Run: `chk m3-check.html | tail -20`
Expected: FAIL on `the filters light their own item`, which reads as an empty string.

- [ ] **Step 3: Add the two bridge lines**

In `css/base.css`, under the existing bridge at line 38:

```css
  /* M3 paints a selected navigation indicator in `secondary-container`, which is a low-chroma tint
     of its own tonal palette. This app holds one surface tone, and it already declines
     `surface-container-high` for the same reason. So the indicator takes the selected language this
     app already has: `.seg label:has(:checked)` fills with `--accent` and inks with `--surface`.
     `--accent` is not a status hue, so the colour language is unbroken. */
  --md-sys-color-secondary-container: var(--accent);
  --md-sys-color-on-secondary-container: var(--surface);
```

- [ ] **Step 4: Paint the active item**

Add this to `css/chrome.css`, under the rail item rules:

```css
#rail .railitem[aria-current="page"] { color: var(--md-sys-color-on-surface); }
#rail .railitem[aria-current="page"] .railpill {
  background: var(--md-sys-color-secondary-container);
}
#rail .railitem[aria-current="page"] .i { color: var(--md-sys-color-on-secondary-container); }
#rail .railitem[aria-current="page"] .raillabel { font-weight: 700; }
```

- [ ] **Step 5: Publish which card is on screen**

`syncPane()` sees the body class alone, and the `side` class covers three different cards. Only the
alert list is a rail destination. So `js/map.js` has to say which one is open. Beside `openSide()`:

```js
/* Which card `#side` holds. The `side` body class covers a station card, a weather card AND the
   alert list, and only the last of those is a rail destination.
   Module scope and no export. `syncPane()` is in this file and is the only reader. */
let openKey = null;
```

Set `openKey = key` inside `openSide()`, where it already stores that key. Set
`openKey = null` inside `closeSide()`.

- [ ] **Step 6: Write the active item from `syncPane()`**

Add this above `syncPane()` in `js/map.js`:

```js
/* **One writer, and it is the one that already watches the fact.** `syncPane()` runs from a
   MutationObserver on the body class, so it sees every open and every close whoever caused it. A
   call at each button would have to be remembered at seven sites, which is the argument
   `syncHeat()` already makes about a preference.
   An item is active while the surface it opens is on screen. A bare map selects nothing, and so do
   a station card and a weather card. The map is what this app draws, and it is always there. */
export function railActive(id) {
  for (const b of document.querySelectorAll('#rail .railitem'))
    if (id === b.id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
}
```

Call it at the top of `syncPane()`, before the early return:

```js
function syncPane() {
  const cls = document.body.classList;
  const want = cls.contains('drawer') || cls.contains('side') || cls.contains('find');
  railActive(cls.contains('drawer') ? 'railFilters'
           : cls.contains('find')   ? 'railFind'
           : cls.contains('side') && openKey === '@alerts' ? 'railAlerts' : null);
  if (!want) { pane.close(); return; }
  // the rest of the function is unchanged
}
```

- [ ] **Step 7: Let the two dialogs report themselves**

In `js/ui.js`, import `railActive` from `./map.js` and wrap the two openers:

```js
el('railTable').onclick = async () => {
  railActive('railTable');
  closeSide();
  // A retry after a failed open must not still carry the last failure's banner over the fresh rows.
  dataBox.classList.remove('loadfail');
  dataBox.showModal();
  el('dataFind').focus();
  try {
    await lazy(() => withTable(m => m.dataTable()), dataBox);
  } catch {
    el('dataFind').blur();
    dataBox.classList.add('loadfail');
  }
};
dataBox.addEventListener('close', () => railActive(null));

el('railCams').onclick = async () => {
  railActive('railCams');
  closeSide();
  el('camFind').value = '';
  // Same reset as the table opener above: a retry must not carry the last failure's banner forward.
  camBox.classList.remove('loadfail');
  camBox.showModal();
  try {
    await lazy(() => withWall(m => m.open()), camBox);
  } catch {
    camBox.classList.add('loadfail');
  }
};
camBox.addEventListener('close', () => railActive(null));
```

`railActive()` leads each handler rather than trails it. `lazy()` awaits a dynamic import, so a
trailing call runs after the module lands and the item stays dark for that whole time.

Help and About take no active state. Each opens a document and returns. They sit in the rail
because the repository owner asked for them there, and neither is a view of the map.

- [ ] **Step 8: Bump the stylesheet versions**

Raise `css/base.css?v=` and `css/chrome.css?v=` by one each in `index.html`.

- [ ] **Step 9: Syntax-check and run the check**

Run the `node --check` loop, then `chk m3-check.html | tail -20`
Expected: PASS.

- [ ] **Step 10: Look at the page**

Open the app at 1400px. Press Filters. The pill fills. Press a pin on the map. The pane swaps to a
station card and no item is lit. Press Alerts. The alert pill fills. Press a row in the list. It
swaps to a station card and the pill clears.

- [ ] **Step 11: Commit**

```bash
git add css/base.css css/chrome.css js/map.js js/ui.js m3-check.html
git commit -m "Light the rail item for whatever is on screen

syncPane() already watches the body class, so it writes the active item too.
One writer. A bare map, a station card and a weather card select nothing,
because the map is the thing this app draws and it is always there."
```

---

### Task 6: The navigation bar below 600px

**Files:**
- Modify: `index.html:3` (`viewport-fit=cover`), and insert `<nav id="navbar">`
- Modify: `css/chrome.css` (the bar, and every remaining bottom-strip offset)
- Modify: `js/map.js` (`railActive()` writes both controls)
- Modify: `js/ui.js` (one handler serves both controls)
- Modify: `js/alerts.js` (write both badges)
- Test: `m3-check.html`

**Interfaces:**
- Consumes: `--navbar-h` from Task 2, `railActive()` from Task 5.
- Produces: ids `navFilters`, `navAlerts`, `navFind`, `navTable`, `navCams`. Class `.navitem`. The
  five reuse `.railpill`, `.raillabel` and `.railbadge`.

- [ ] **Step 1: Add the failing assertions to `m3-check.html`**

In the 360px pass, add:

```js
  const bar = d.getElementById('navbar');
  is(!!bar, true, 'a navigation bar draws below 600px');
  is(Math.round(r(bar).height), 64, 'M3 navigation bar 64px');
  is([...bar.querySelectorAll('.navitem')].map(b => b.id).join(','),
     'navFilters,navAlerts,navFind,navTable,navCams',
     'five items, which is what M3 caps a navigation bar at');
  is(Math.round(r(bar).bottom), VH, 'and it sits on the bottom edge');
  is(Math.round(r(mapBox).bottom), VH - 64 - GAP, 'the map card stops above it');
  is(cs(d.getElementById('rail')).display, 'none', 'the rail does not draw at this width');
```

Add `#navbar` to the `FURNITURE` array so the clash sweep covers it.

- [ ] **Step 2: Run the check and watch it fail**

Run: `chk m3-check.html | tail -20`
Expected: FAIL on `a navigation bar draws below 600px`.

- [ ] **Step 3: Set the viewport for the safe area**

Put this in place of line 3 of `index.html`:

```html
<!-- `viewport-fit=cover` is what makes `env(safe-area-inset-bottom)` non-zero. The navigation bar
     below 600px reserves that inset under its items. Without this tag the bar sits under the iOS
     home indicator. -->
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
```

- [ ] **Step 4: Add the bar**

Insert this immediately after the `</nav>` that closes the rail:

```html
<!-- M3's navigation bar, below 600px alone. Every number comes from
     https://github.com/bczak/m3you/blob/development/src/components/NavigationBar/navigation-bar.css
     Five items, which is what M3 caps this component at. Help, About and Theme go to `#apps`, which
     returns to the app bar at this width.
     It reuses `.railpill`, `.raillabel` and `.railbadge`. One indicator, drawn once. -->
<nav id="navbar" aria-label="Main">
  <button class="navitem" id="navFilters" aria-controls="pane" aria-expanded="false"
    ><span class="railpill"><i class="i i-menu"></i></span
    ><span class="raillabel">Filters</span></button>
  <button class="navitem" id="navAlerts" aria-controls="pane" aria-expanded="false"
    ><span class="railpill"><i class="i i-warning"></i><b class="railbadge"></b></span
    ><span class="raillabel">Alerts</span></button>
  <button class="navitem" id="navFind" aria-controls="pane" aria-expanded="false"
    ><span class="railpill"><i class="i i-search"></i></span
    ><span class="raillabel">Search</span></button>
  <button class="navitem" id="navTable"
    ><span class="railpill"><i class="i i-list_alt"></i></span
    ><span class="raillabel">Table</span></button>
  <button class="navitem" id="navCams"
    ><span class="railpill"><i class="i i-photo_camera"></i></span
    ><span class="raillabel">Cameras</span></button>
</nav>
```

Add a second theme button at the end of `<header>`, with the id `apps`:

```html
<!-- The overflow button returns to the app bar below 600px, where there is no rail to hold it. It
     targets the same `#appMenu`, and only one of the two buttons ever draws. -->
<button id="apps" class="icon" title="Menu" aria-label="Menu"
        popovertarget="appMenu"><i class="i i-apps"></i></button>
```

Put the `#help` and `#about` rows and the `<hr>` back into `#appMenu`, above `#themeRow`. Do not
bring `#data` and `#cams` back. Table and Cameras are items in both navigation components, so those
two rows can never draw at either width.

Below 600px the menu then holds Help, About and Theme. Above 600px Help and About are rail items,
so hide those two rows and the header button there:

```css
/* Two buttons target one menu, and only one of them draws. The rail holds Help and About as items
   above 600px, so the menu keeps the theme row alone there. */
@media (min-width: 601px) {
  header #apps, #appMenu #help, #appMenu #about, #appMenu hr { display: none; }
}
@media (max-width: 600px) { #rail { display: none; } }
```

The second query already exists from Task 3. Do not add it twice.

- [ ] **Step 5: Style the bar**

```css
/* --- navigation bar ----------------------------------------------------------------------------
   M3's navigation bar, from NavigationBar/navigation-bar.css. **`min-height` and not `height`.**
   The safe area extends the bar downward that way, rather than being absorbed into the content box
   under `box-sizing: border-box`, which clips the labels. */
#navbar { display: none; }
@media (max-width: 600px) {
  #navbar {
    position: absolute; z-index: 600; right: 0; bottom: 0; left: 0;
    box-sizing: border-box; display: flex; align-items: stretch; justify-content: flex-start;
    min-height: 64px; padding-block: 4px;
    padding-bottom: calc(4px + env(safe-area-inset-bottom, 0px));
    background: var(--md-sys-color-surface-container);
  }
  #navbar .navitem {
    display: flex; flex: 1 1 0; min-width: 0; flex-direction: column;
    align-items: center; justify-content: center; gap: 4px;
    padding: 0; border: 0; background: none; cursor: pointer;
    color: var(--md-sys-color-on-surface-variant);
  }
  #navbar .navitem .i { font-size: 24px; }
  #navbar .navitem[aria-current="page"] .railpill {
    background: var(--md-sys-color-secondary-container);
  }
  #navbar .navitem[aria-current="page"] .i { color: var(--md-sys-color-on-secondary-container); }
  #navbar .navitem[aria-current="page"] .raillabel { font-weight: 700; }
}
```

`.railpill`, `.raillabel` and `.railbadge` name `#rail` today. Widen each selector to
`#rail, #navbar` so one indicator serves both components.

- [ ] **Step 6: Give every remaining bottom-strip box the term**

`#paint` and `#locate` took `--navbar-h` in Task 2, and `#legend` in Task 3. The rest:

```css
#credit { bottom: calc(8px + var(--gap) + var(--navbar-h)); }
```

`#pills` adds `--navbar-h` to its own `bottom` in the same shape. `#paintmenu` is a bottom sheet
below 600px, so its rule takes `bottom: var(--navbar-h)`. The Leaflet controls live inside the map
container, so they follow the card for free.

- [ ] **Step 7: Make one handler serve both controls**

In `js/ui.js`, put this in place of the seven single assignments:

First turn the two openers from Task 5 into named declarations. Change the assignment line and
leave both bodies alone:

```js
async function openTable() {   // was el('railTable').onclick = async () => {
async function openWall() {    // was el('railCams').onclick  = async () => {
```

Both end in `}` rather than `};` after this. Then bind everything through one table:

```js
/* One handler per action, bound to both controls. The rail draws above 600px and the bar below it,
   and only one of the two is ever on screen. Two copies of a handler is two things to change, and
   this app has paid for that shape before. See the two repairs `syncHeat()` records. */
const NAV = {
  Filters: () => setDrawer(!document.body.classList.contains('drawer')),
  Alerts:  toggleAlerts,
  Find:    () => setFind(!document.body.classList.contains('find')),
  Table:   openTable,
  Cams:    openWall,
};
for (const [name, fn] of Object.entries(NAV))
  for (const p of ['rail', 'nav']) { const b = el(p + name); if (b) b.onclick = fn; }
```

`el(p + name)` builds `railFilters` and `navFilters` from one string, which is why the ids share a
suffix. The `if (b)` guard is what lets one loop serve a document that holds one component or both.

Help and About stay bound to `railHelp` and `railAbout` alone. Below 600px they are rows in
`#appMenu`, and those rows keep the handlers they already have.

- [ ] **Step 8: Widen `railActive()`**

In `js/map.js`, match by suffix so one call writes both components:

```js
export function railActive(id) {
  const want = id && id.replace(/^rail/, '');
  for (const b of document.querySelectorAll('#rail .railitem, #navbar .navitem'))
    if (want && b.id.endsWith(want)) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
}
```

- [ ] **Step 9: Write both badges from `alerts.js`**

```js
  for (const btn of document.querySelectorAll('#railAlerts, #navAlerts')) {
    btn.style.setProperty('--c', c);
    btn.querySelector('.railbadge').textContent = live.length || '';
    btn.title = what;
    btn.setAttribute('aria-label', what);
  }
```

Move the `what` computation above the loop.

- [ ] **Step 10: Bump the stylesheet version**

Raise `css/chrome.css?v=` by one in `index.html`.

- [ ] **Step 11: Syntax-check and run the check**

Run the `node --check` loop, then `chk m3-check.html | tail -20`
Expected: PASS at both widths. The clash sweep must stay empty with `#navbar` in it.

- [ ] **Step 12: Look at the page**

Open the app at 360px. Five labelled items sit along the bottom. The map card stops above them. The
credit line, the legend and the two map buttons all clear the bar. Press Filters. The pane covers
the bar, which is the accepted cost. Press the back arrow. The bar returns.

- [ ] **Step 13: Commit**

```bash
git add index.html css/chrome.css js/ui.js js/map.js js/alerts.js m3-check.html
git commit -m "Draw a navigation bar below 600px

M3 states no rail under 600px, and 96px of a 360px screen is 27% of it. The
bar holds the same five destinations. One handler serves both controls, so
the two shapes cannot drift. The viewport meta gains viewport-fit=cover, or
the safe area inset reads 0 on iOS."
```

---

### Task 7: The record

**Files:**
- Modify: `docs/FEATURES.md`
- Modify: `CLAUDE.md` (the file table, the gotcha list, the Conventions, the Verify block)

**Interfaces:**
- Consumes: every task above.
- Produces: nothing that code reads.

- [ ] **Step 1: Write the FEATURES.md entry**

Append a section titled `The app bar controls moved into a navigation rail`. State what shipped and
why. Cover all of this:

- The five destinations, the divider, Help and About, and the theme button under the spacer.
- Why `#locate` went to the map and not into the rail.
- Why the search became a pane occupant, and what the 300px field cost in a 96px rail.
- Why the active indicator reads above 600px alone, and the two presses that costs on a phone.
- The two color bridge lines, and why this plan declines the tint M3 states.
- What was not built: the expanded 220px rail, the modal rail, a `Map` item, a rail slot for
  `#locate`, and a second copy of the bar inside `#pane`.

- [ ] **Step 2: Update the file table in CLAUDE.md**

`m3-check.html` gains the rail and the bar in its own description. No new file ships, so no new row.

- [ ] **Step 3: Add the gotchas**

Three are worth writing down, and each one costs real time to find twice:

- `alerts.js` wrote `innerHTML` over the whole alert button. A rail item holds a label and a pill as
  well, so the write has to name a child.
- `.mapbtn` declares `--fab` on itself. A rule that places `#locate` above `#paint` cannot
  inherit it, so it states the fallback. Without one the whole `calc()` is invalid and the button
  falls to the top of the page.
- Below 600px `#pane` covers the navigation bar. So the bar is a launcher at that width and never a
  state display, and the active indicator reads above 600px alone.

- [ ] **Step 4: Update the Conventions section**

The M3 paragraph lists four components and seven variants. It gains the navigation rail and the
navigation bar. State that the rail is the collapsed variant, and that a compact window takes the
bar because M3 states no rail under 600px.

- [ ] **Step 5: Update the Verify block**

Raise the `m3-check.html` budget from 180000 to 240000, and say why. The note under it already
warns that a short budget truncates the check rather than fails it.

- [ ] **Step 6: Lint the prose**

```bash
python "C:/Users/illus/.claude/ste-lint.py" < docs/FEATURES.md
python "C:/Users/illus/.claude/ste-lint.py" < CLAUDE.md
```

Aim for 0, apart from the `long_paragraph` counts a list of more than six items raises.

- [ ] **Step 7: Run every check one last time**

```bash
php -l api.php && php -l sources.php
php shots-test.php
php api.php --selftest
for c in m3-check title-test paint-check narrow-test heat-test; do
  printf '%-14s ' "$c"; chk "$c.html" | tail -1; done
```

Expected: PASS on all seven.

- [ ] **Step 8: Commit**

```bash
git add docs/FEATURES.md CLAUDE.md
git commit -m "Write down the navigation rail and what it cost

The five destinations, the divider, and the theme button that is not a
destination. Why the locate button went to the map, why the search went to
the pane, and why the active indicator reads above 600px alone."
```
