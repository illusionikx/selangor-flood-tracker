# Table and camera wall on M3 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `#dataBox` (the all-stations table) and `#camBox` (the camera wall) onto Material
Design 3 at both widths, and repair four measured phone faults.

**Architecture:** No build step and no framework. The work is CSS in `css/chrome.css` and
`css/base.css`, markup in `index.html`, and the cell builder in `js/table.js`. Every M3 number comes
from the M3 Expressive component set, so a reviewer can grep it against a real file.

**Tech Stack:** Plain HTML, CSS and ES modules. Laravel Herd serves the app at
`https://flood-exp.test`. The check is `m3-check.html`, run in headless Chrome.

**Spec:** [`docs/superpowers/specs/2026-08-26-table-and-camera-m3-design.md`](../specs/2026-08-26-table-and-camera-m3-design.md)

## Global Constraints

- **Never write a hex colour into a JS file, and never copy one into a doc.** The palette lives in
  `css/base.css` and nowhere else. Use a token.
- **Traffic-light hues are for status only.** Green, amber, orange and red mean what a sensor
  reports. Never use one for a control state.
- **Bump `?v=` on every stylesheet link in `index.html` after any change to a CSS file.** Herd
  serves everything with `max-age=10800`.
- **Sentence case on every rendered string.** No contractions. No hedging. The ALL-CAPS blocks
  (`TRIGGERED`, `HAPPENING NOW`) are a deliberate visual language, not messages.
- **M3 reference:** https://github.com/bczak/m3you/tree/development/src/components
- **`--pane` is 16px for these two panels, at every width.** An app bar and a list item state 16dp.
  A dialog's own prose states 24dp, which is why `.docbox` keeps 24px above 600px.
- **Measure, never assume.** Read a value back off the rendered element. A resolved token is not a
  painted pixel.
- **Run the check after every task.** The command is in Task 1, Step 2.

## How to test in this repository

There is no test framework. The check is `m3-check.html`. It loads the app in two iframes, at 360px
and at 1200px, and asserts rendered pixels. Every task below adds assertions to that file **first**,
runs it to watch them fail, then writes the CSS or the JS.

Run it with this command. Use the Bash tool, from `d:/Herd/flood-exp`:

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --ignore-certificate-errors --virtual-time-budget=300000 --window-size=1600,1000 --dump-dom \
  https://flood-exp.test/m3-check.html | perl -0777 -ne 'print $1 if /<pre id="out">(.*?)<\/pre>/s'
```

**Read the last line.** No `PASS` means the run did not finish, whatever the counts above it say. A
short virtual-time budget truncates this check rather than fails it.

**A type-scale assertion is weak on its own, so never write one alone.** `title-small`,
`label-large` and `body-medium` all read 14px in `vendor/m3/tokens.css`. So a size assertion cannot
tell one from another, and it passes on the wrong scale. Every type assertion below therefore also
reads `textTransform` and `letterSpacing`. Those are the two properties this work actually changes:
every old heading in this table was 11px uppercase with `.06em` of letter-spacing.

**Two rules the harness already states, and both bite here:**

1. Assert motion as a DECLARATION, before `settle()`. Measure geometry after it. Headless virtual
   time does not run a transition faithfully.
2. Read geometry with the dialog OPEN. A closed `<dialog>` takes `display: none`, so every rect
   inside it reads zero and an assertion compares 0 against 0.

**The two panels fill themselves from deferred modules.** `js/table.js` and `js/wall.js` arrive
through `lazy()`. So a probe injects fixed markup rather than waiting for the live payload. That is
the pattern `CARD` already uses in `m3-check.html`, and its own comment says why: fixed markup cannot
move with the weather.

## File structure

| file | responsibility after this work |
|---|---|
| `index.html` | the two search bar rows, the two count lines |
| `css/base.css` | `#dataFind` and `#camFind` leave the `select, #goto` rule |
| `css/chrome.css` | every M3 number for both panels |
| `js/table.js` | the cell builder emits chips, the sort head emits a glyph |
| `js/ui.js` | the clear button on both search bars |
| `m3-check.html` | one block per surface, at both widths |
| `CLAUDE.md` | four divergences added, one rule deleted |
| `docs/FEATURES.md` | what shipped and why |

`css/icons.css` needs no change. It already holds `--i-search`, `--i-close`, `--i-arrow_upward` and
`--i-arrow_downward`.

---

### Task 1: One inset, and the bottom safe area

**Files:**
- Modify: `css/chrome.css` — the `#dataBox`, `#camBox`, `#camGrid`, `table.data` and phone blocks
- Modify: `index.html` — the `?v=` on the stylesheet links
- Test: `m3-check.html`

**Interfaces:**
- Consumes: nothing.
- Produces: `--pane`, declared on `#dataBox` and on `#camBox`. Every later task reads it back rather
  than writing a literal inset.

- [ ] **Step 1: Write the failing assertions**

Add this function to `m3-check.html`, above the runner at the foot of the file.

```js
/* **One panel states ONE inset.** Before this, `#dataBox` stated four: 16px to the headline, 16px
   to the filter, 20px to a row's name and 14px to that name on a phone. So the headline and the
   first column under it did not line up at either width.
   **Assert the two LEFT EDGES against each other, never against a literal.** A literal passes the
   day somebody moves the app bar and leaves the body behind, which is the exact drift this exists
   to catch. */
async function panelInset(frame, label) {
  const { d, w, cs, r, settle } = await ready(frame);
  say('--- one inset, ' + label + ' ---------------------------------------------');
  settle();

  for (const id of ['dataBox', 'camBox']) {
    const b = d.getElementById(id);
    b.showModal();
    const head = r(b.querySelector('.apflex'));
    const field = r(b.querySelector('.dtop input'));
    is(Math.round(field.left - head.left), 0, id + ': the filter starts on the headline');
    const body = id === 'dataBox'
      ? b.querySelector('table.data .chead th:first-child') || b.querySelector('table.data')
      : d.getElementById('camGrid');
    /* The table may hold no rows yet, because js/table.js is deferred. So read the box's own
       padding rather than a cell that may not exist. */
    const pad = id === 'dataBox'
      ? parseFloat(cs(b.querySelector('table.data')).paddingLeft)
      : parseFloat(cs(body).paddingLeft);
    is(pad, 16, id + ': the body inset is 16px');
    is(parseFloat(cs(b).getPropertyValue('--pane')), 16, id + ': --pane is 16px');
    b.close();
  }
}

/* **The bottom safe area.** Both panels take `100dvh` on a phone, so the last row and the tally sit
   under the iOS home indicator. `env(safe-area-inset-bottom)` reads 0 in headless Chrome, so this
   asserts that the DECLARATION reaches the element, not that the inset has a value. A machine with
   no notch cannot test a notch. */
async function safeArea() {
  const { d } = await ready('phone');
  say('--- the bottom safe area, phone ------------------------------------------');
  const css = [...d.styleSheets]
    .filter(s => (s.href || '').includes('chrome.css'))
    .flatMap(s => [...s.cssRules])
    .map(x => x.cssText).join('\n');
  is(/#camBox\s+#camCount[^}]*safe-area-inset-bottom/.test(css), true,
     'camCount reads the bottom safe area');
  is(/table\.data[^}]*safe-area-inset-bottom/.test(css), true,
     'the table reads the bottom safe area');
}
```

Call both from the runner. Put them beside the existing calls, inside the same `try`:

```js
await panelInset('phone', 'phone');
await panelInset('desk', 'desktop');
await safeArea();
```

- [ ] **Step 2: Run the check and watch it fail**

Run the command in "How to test" above.

Expected: `FAIL` on `--pane is 16px` for both panels at both widths, on both body insets, on both
safe-area rules, and on `the filter starts on the headline` at the desktop width.

- [ ] **Step 3: Declare the token on both panels**

In `css/chrome.css`, inside the existing `#dataBox { … }` block, add the token and its reason:

```css
  /* **One inset for the whole panel, and every box below the app bar reads it back.** This panel
     stated four: 16px to the headline, 16px to the filter field, 20px to a row's name and 14px to
     that name on a phone. So the headline and the first column under it did not line up.
     **16px at every width, and `.docbox` keeps 24px.** M3 states two insets and the content picks
     one: an app bar and a list item state 16dp, and a dialog's own prose states 24dp. This panel
     holds list content. `.docbox` holds paragraphs. */
  --pane: 16px;
```

Add the same two lines to the `#camBox { … }` block.

- [ ] **Step 4: Replace every literal inset with the token**

In `css/chrome.css`, make these exact replacements:

```css
/* was: #dataBox #dataFind { margin-inline: 16px; } */
#dataBox #dataFind { margin-inline: var(--pane); }
/* was: #dataBox #dataCount { margin-inline: 16px; } */
#dataBox #dataCount { margin-inline: var(--pane); }
/* was: #camBox #camFind { margin-inline: 16px; } */
#camBox #camFind { margin-inline: var(--pane); }

/* was: table.data td { padding: 10px 8px; ... } — the inline edge only */
table.data td.nm, table.data .chead th:first-child {
  position: sticky; left: 0; width: 220px; min-width: 220px; padding-left: var(--pane);
  background: var(--surface); border-right: 1px solid var(--outline);
}
/* was: table.data .dhead th { ... padding: 10px 20px 6px; ... } */
table.data .dhead th {
  position: sticky; top: 30px; z-index: 2; text-align: left; padding: 10px var(--pane) 6px;
  font-size: 11px; font-weight: 500; letter-spacing: .06em; text-transform: uppercase;
  background: var(--hover); border-bottom: 1px solid var(--outline);
}

/* was: #camGrid { flex: 1; overflow: auto; padding: 12px 20px 20px; ... } */
#camGrid {
  flex: 1; overflow: auto; padding: 0 var(--pane) var(--pane);
  display: grid; grid-auto-rows: min-content; gap: 6px;
  grid-template-columns: repeat(auto-fill, minmax(min(240px, 45%), 1fr));
}
/* was: #camBox[aria-busy="true"] .skeltiles { ... padding: 12px 20px 20px; ... }
   The skeleton must match the grid, or the tiles that replace it land on different columns. */
#camBox[aria-busy="true"] .skeltiles {
  display: grid; gap: 6px; padding: 0 var(--pane) var(--pane);
  grid-template-columns: repeat(auto-fill, minmax(min(240px, 45%), 1fr));
  grid-auto-rows: min-content;
}
```

**The top padding goes to 0 on `#camGrid`.** The app bar carries its own 12px below the headline, and
that space sits outside the scroller. So content stops under the bar rather than running up to it.
`.docbody` states the same three numbers.

- [ ] **Step 5: Add the bottom safe area, and delete the phone overrides**

Replace the whole `@media (max-width: 600px)` block that holds `#dataBox`:

```css
@media (max-width: 600px) {
  #dataBox { width: 100vw; height: 100dvh; max-width: none; border-radius: 0; border: 0; }
  /* **The bottom safe area, and only on a phone.** This panel takes the whole screen here, so the
     last row lands on the window edge and sits under the iOS home indicator. `--navbar-h` was the
     only token in this app reading that inset. Above 600px the panel never touches the edge.
     The three inline overrides that stood here are gone: `--pane` states the inset once now. */
  table.data { padding-bottom: env(safe-area-inset-bottom, 0px); }
}
```

Replace the matching `#camBox` phone block:

```css
@media (max-width: 600px) {
  #camBox { width: 100vw; height: 100dvh; max-width: none; border-radius: 0; border: 0; }
  /* See the note on the table above. The tally is the lowest thing in this panel, so it is the
     one that lands under the home indicator. The two padding overrides that stood here are gone:
     `--pane` is 16px at every width, so the grid needs no second value. */
  #camBox #camCount {
    padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px));
  }
}
```

- [ ] **Step 6: Move the compact prose inset to 16px**

In the phone block of `css/chrome.css`, change one number:

```css
  /* **16px, not 18px.** The app bar states its headline 16px in at every width. 24px under it reads
     as deliberate indentation for a paragraph, which is why `.docbox` keeps 24 above 600px. 18px
     under it reads as a mistake. This one number corrects About, Help and Settings at once. */
  .docbox { --pane: 16px; }
```

- [ ] **Step 7: Bump the cache-buster**

In `index.html`, raise the `?v=` on every `<link rel="stylesheet">`. Herd serves CSS with
`max-age=10800`, so an edit is invisible for three hours without it.

- [ ] **Step 8: Run the check and watch it pass**

Run the command in "How to test".

Expected: every assertion from Step 1 reads `ok`, and the last line reads `PASS`.

- [ ] **Step 9: Commit**

```bash
git add css/chrome.css index.html m3-check.html
git commit -F - <<'EOF'
State one inset per panel, and read the bottom safe area

The table and the camera wall each stated four insets: 16px to the
headline, 16px to the filter, 20px to a row's name and 14px on a phone.
So the headline and the first column under it did not line up.

`--pane` states it once, at 16px. M3 gives an app bar and a list item
16dp, and a dialog's own prose 24dp, so `.docbox` keeps 24 above 600px
and moves from 18px to 16px on a phone.

Both panels take the whole screen on a phone, so the last table row and
the camera tally sat under the iOS home indicator. Both read
env(safe-area-inset-bottom) now.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: The filter becomes an M3 search bar

**Files:**
- Modify: `index.html` — both `.dtop` blocks
- Modify: `css/base.css` — `#dataFind` and `#camFind` leave two rules
- Modify: `css/chrome.css` — the `.m3search` rules
- Modify: `js/ui.js` — the clear button
- Test: `m3-check.html`

**Interfaces:**
- Consumes: `--pane` from Task 1.
- Produces: the class `.m3search` on a row wrapping the leading glyph, the input and the clear
  button. Task 3 puts the count line under it.

- [ ] **Step 1: Write the failing assertions**

Add to `m3-check.html`, beside `panelInset()`:

```js
/* **M3's search bar**, and every number is
   https://github.com/bczak/m3you/blob/development/src/components/Search/search.css — a 56dp
   container at a full corner on `surface-container-high`, a 24dp leading glyph 16dp in, and
   `body-large` text.
   **A DIVERGENCE this app states out loud:** in M3 a search bar opens a search view. These two
   filter what is already on screen. The go-to box is a real search view and wears the same shape,
   so this app draws one search shape for two behaviors. */
async function searchBar(frame, label) {
  const { d, w, cs, r, settle } = await ready(frame);
  say('--- the search bar, ' + label + ' -----------------------------------------');
  settle();
  for (const [id, field] of [['dataBox', 'dataFind'], ['camBox', 'camFind']]) {
    const b = d.getElementById(id);
    b.showModal();
    const bar = b.querySelector('.m3search');
    is(Math.round(r(bar).height), 56, id + ': 56dp container');
    is(cs(bar).borderRadius, '28px', id + ': a full corner');
    const glyph = bar.querySelector('.i-search');
    is(!!glyph, true, id + ': a leading search glyph');
    is(Math.round(r(glyph).width), 24, id + ': the glyph is 24dp');
    is(Math.round(r(glyph).left - r(bar).left), 16, id + ': and it sits 16dp in');
    /* The clear button appears only once the field holds something. A control that is always
       there offers to clear an empty field. */
    const clear = bar.querySelector('[data-clear]');
    is(clear.hidden, true, id + ': the clear button is hidden while the field is empty');
    const input = d.getElementById(field);
    input.value = 'x';
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    is(clear.hidden, false, id + ': and it appears once the field holds something');
    /* Pressing it must clear the field AND rerun the filter, or the list stays filtered by a
       query the reader can no longer see. */
    clear.click();
    is(input.value, '', id + ': pressing it clears the field');
    is(clear.hidden, true, id + ': and it goes away again');
    b.close();
  }
}
```

Call it from the runner beside `panelInset`:

```js
await searchBar('phone', 'phone');
await searchBar('desk', 'desktop');
```

- [ ] **Step 2: Run the check and watch it fail**

Expected: `THREW` on `Cannot read properties of null` at the first `r(bar)`, because `.m3search` does
not exist yet. That counts as one failure and stops this block. That is correct at this point.

- [ ] **Step 3: Write the markup**

In `index.html`, replace the `#dataFind` input with this row. Keep the id and the `aria-label`, or
`js/table.js` and `js/ui.js` both lose their handle on it.

```html
    <!-- M3's search bar, from the M3 Expressive set's Search/search.css. A DIVERGENCE this app
         states out loud: in M3 a search bar opens a search view, and this one filters the list
         already on screen. The go-to box is a real search view and wears the same shape, so this
         app now draws one search shape for two behaviors. That is the cost of one shape. -->
    <div class="m3search">
      <i class="i i-search" aria-hidden="true"></i>
      <input id="dataFind" type="text" autocomplete="off"
             placeholder="Filter by name, district or basin" aria-label="Filter stations">
      <button type="button" class="icon m3clear" data-clear="dataFind"
              aria-label="Clear the filter" hidden><i class="i i-close"></i></button>
    </div>
```

Replace the `#camFind` input the same way:

```html
    <div class="m3search">
      <i class="i i-search" aria-hidden="true"></i>
      <input id="camFind" type="text" autocomplete="off"
             placeholder="Filter by name or district" aria-label="Filter cameras">
      <button type="button" class="icon m3clear" data-clear="camFind"
              aria-label="Clear the filter" hidden><i class="i i-close"></i></button>
    </div>
```

**The trailing ellipsis leaves both placeholders.** A placeholder is a label, not a sentence that
trails off.

- [ ] **Step 4: Take both fields out of the old rule**

In `css/base.css`, drop `#dataFind` and `#camFind` from the two selector lists. They become:

```css
select, #goto {
  width: 100%; padding: 8px 10px; margin-bottom: 10px; font: inherit; font-size: 13px;
  background: var(--surface); color: var(--on-surface);
  border: 1px solid var(--outline); border-radius: 8px;
}
select:focus-visible, #goto:focus-visible, .icon:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 1px;
}
```

- [ ] **Step 5: Write the component**

Add to `css/chrome.css`, beside the two panels:

```css
/* **M3's search bar.** Every number is
   https://github.com/bczak/m3you/blob/development/src/components/Search/search.css:
   a 56dp container at a full corner, `surface-container-high`, a 24dp leading glyph 16dp in, and
   `body-large` text. This app bridges `surface-container-high` onto `--hover`, which is its own
   container tone — the palette rule holds one surface tone and forbids inventing a second.
   **The row carries the surface, never the input.** That is the reference's own split, and it is
   what lets the glyph and the clear button sit inside one shape. */
#dataBox .m3search, #camBox .m3search {
  display: flex; align-items: center; gap: 16px;
  min-height: 56px; margin-inline: var(--pane); margin-bottom: 6px; padding: 0 16px;
  border-radius: 28px; background: var(--hover); color: var(--on-surface);
}
#dataBox .m3search .i-search, #camBox .m3search .i-search {
  flex: none; font-size: 24px; color: var(--muted);
}
/* The input paints nothing. The row around it is the control. */
#dataBox .m3search input, #camBox .m3search input {
  flex: 1; min-width: 0; margin: 0; padding: 0; border: 0; background: none;
  color: var(--on-surface); font: inherit;
  font-size: var(--md-sys-typescale-body-large-size);
  line-height: var(--md-sys-typescale-body-large-line-height);
}
#dataBox .m3search input:focus-visible, #camBox .m3search input:focus-visible { outline: none; }
/* The ring goes on the row, because the row is the shape a reader sees. */
#dataBox .m3search:focus-within, #camBox .m3search:focus-within {
  outline: 2px solid var(--accent); outline-offset: 1px;
}
#dataBox .m3search .m3clear, #camBox .m3search .m3clear { flex: none; font-size: 20px; }
/* `display: flex` on `.icon` beats the browser's own `[hidden]` rule, so it has to be said again.
   This is the third element in this app to need the restatement — `.link` and `.camwarn` carry it
   too. */
#dataBox .m3search .m3clear[hidden], #camBox .m3search .m3clear[hidden] { display: none; }

/* The old two-rule block for these fields is gone. It stated a width, a margin and a 8px corner
   that the row above now owns. */
```

Delete the three old rules: `#dataBox #dataFind { margin-inline: … }`,
`#dataBox #dataFind { margin-bottom: 6px }` and `#camBox #camFind { margin-inline: … }`. The
`.m3search` rule states all three.

- [ ] **Step 6: Wire the clear button**

Add to `js/ui.js`, near the two `oninput` handlers it already holds:

```js
/* One delegated handler for both search bars. It dispatches `input` rather than calling either
   filter directly: `dataFind` and `camFind` already have their own `oninput`, and a second caller
   is a second copy of the one that matters.
   **The button's own visibility is written from the field, never from the click.** A reader can
   also empty the field by hand, and a handler on the button alone never runs on that path. That is
   the rule this repo already states for every preference-owned control. */
const syncClear = f => {
  const b = document.querySelector(`[data-clear="${f.id}"]`);
  if (b) b.hidden = !f.value;
};
document.addEventListener('input', e => {
  if (e.target.matches('#dataFind, #camFind')) syncClear(e.target);
});
document.addEventListener('click', e => {
  const b = e.target.closest('[data-clear]');
  if (!b) return;
  const f = el(b.dataset.clear);
  f.value = '';
  f.dispatchEvent(new Event('input', { bubbles: true }));
  f.focus();
});
```

- [ ] **Step 7: Bump the cache-buster and run the check**

Raise `?v=` in `index.html`. Run the command in "How to test".

Expected: every assertion in `searchBar()` reads `ok`, and the last line reads `PASS`.

- [ ] **Step 8: Commit**

```bash
git add index.html css/base.css css/chrome.css js/ui.js m3-check.html
git commit -F - <<'EOF'
Draw both filter fields as M3 search bars

Both were a plain input sharing one rule with `select` and `#goto`, and
that rule matches no M3 component.

Each is now M3's search bar: a 56dp row at a full corner on this app's
own container tone, a 24dp leading glyph 16dp in, body-large text and a
trailing clear button.

A DIVERGENCE, stated in CLAUDE.md: in M3 a search bar opens a search
view, and these two filter the list already on screen. The go-to box is
a real search view and wears the same shape, so this app draws one
search shape for two behaviors.

The clear button writes itself from the field rather than from its own
click, because a reader can empty the field by hand.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: The count line, and the progress bar

**Files:**
- Modify: `css/chrome.css` — `#dataCount`, `#camCount`, `#camBar`
- Test: `m3-check.html`

**Interfaces:**
- Consumes: `--pane` from Task 1.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing assertions**

Add to `m3-check.html`:

```js
/* **The count is M3's list subheader**, the component the alert panel, the Notices pane and
   Settings already draw: `title-small` in `on-surface-variant`, 48dp, at the pane's own inset. One
   panel states one heading style. */
async function countLine() {
  const { d, cs, r, settle } = await ready('desk');
  say('--- the count line -------------------------------------------------------');
  settle();
  for (const [box, id] of [['dataBox', 'dataCount'], ['camBox', 'camCount']]) {
    const b = d.getElementById(box);
    b.showModal();
    const p = d.getElementById(id);
    p.textContent = '450 stations';
    const st = cs(p);
    const root = cs(d.documentElement);
    is(st.fontSize, root.getPropertyValue('--md-sys-typescale-title-small-size').trim(),
       id + ': title-small');
    is(Math.round(r(p).height), 48, id + ': 48dp');
    /* **The size alone cannot tell one scale from another here.** `title-small`, `label-large` and
       `body-medium` are all 14px in the vendored token set. So assert the two properties that
       actually change: this line was 12px `.muted` with no height, and every old table heading in
       this app was uppercase and letter-spaced. */
    is(st.textTransform, 'none', id + ': sentence case');
    is(st.letterSpacing, 'normal', id + ': and no letter-spacing');
    /* `on-surface-variant`, which this app bridges onto `--muted`. Compare against a probe carrying
       the token, never against a hex: the palette has moved four times and every copy went stale. */
    const probe = d.createElement('span');
    probe.style.color = root.getPropertyValue('--muted').trim();
    d.body.appendChild(probe);
    is(st.color, cs(probe).color, id + ': in on-surface-variant');
    probe.remove();
    b.close();
  }
}
```

- [ ] **Step 2: Run the check and watch it fail**

Expected: `FAIL` on `title-small` and on `48dp` for both count lines. `#dataCount` inherits
`.muted`'s 12px today, and neither line states a height.

- [ ] **Step 3: Write the component**

In `css/chrome.css`, replace both count rules:

```css
/* **M3's list subheader**, the same component the alert panel, the Notices pane and Settings draw:
   `title-small` in `on-surface-variant`, 48dp, at the pane's own inset. One panel states one
   heading style, and a count sitting at 12px under a 28px headline was a third size in one box.
   **The size has to be stated.** `.muted` carries a `font-size` of its own as well as the colour,
   and a declaration on the element beats anything the context passes down. That is the trap the
   rain chart's axis labels already record. */
#dataBox #dataCount, #camBox #camCount {
  display: flex; align-items: center;
  min-height: 48px; margin: 0; padding: 0 var(--pane);
  color: var(--muted);
  font-size: var(--md-sys-typescale-title-small-size);
  line-height: var(--md-sys-typescale-title-small-line-height);
  font-weight: 500;
}
/* The tally keeps its place UNDER the grid, and that divergence carries its own reason: a total
   belongs after the list, where a reader arrives at it having seen what it is totalling. `flex:
   none` so it keeps its height while `#camGrid` takes the rest. */
#camBox #camCount { flex: none; border-top: 1px solid var(--outline); background: var(--surface); }
```

Keep the phone rule from Task 1 that adds the safe area to `#camCount`.

- [ ] **Step 4: Give the progress bar M3's colour roles**

In `css/chrome.css`, change two declarations in `#camBar`. Keep every line of the comment above it —
it argues the seam placement, and that argument does not change.

```css
#camBar {
  position: relative; z-index: 1; flex: none; height: 4px; margin-bottom: -4px;
  /* M3's linear progress indicator: a 4dp track, the active indicator in `primary` and the track in
     `primary-container`. This app bridges the pair onto `--accent` and a low-weight mix of it.
     **Three parts of the M3 Expressive variant are declined.** The rounded ends, the 4dp gap
     between the active indicator and the track, and the stop indicator each shape a widget parked
     in a layout. This bar is the state of a boundary, which the comment above states in full. */
  background: color-mix(in srgb, var(--accent) 20%, transparent);
  opacity: 0; transition: opacity .15s;
}
```

The value is already correct. **State the reference in the comment, and change no pixel.** That is
the whole of this step: a number nobody can trace is a number that drifts.

- [ ] **Step 5: Bump the cache-buster and run the check**

Expected: `PASS`.

- [ ] **Step 6: Commit**

```bash
git add css/chrome.css m3-check.html
git commit -F - <<'EOF'
Head both count lines with M3's list subheader

The two counts drew at 12px under a 28px headline, which is a third type
size in one box. Both take title-small in on-surface-variant at 48dp
now, the component the alert panel and Settings already draw.

The size has to be stated: `.muted` carries a font-size as well as a
colour, and a declaration on the element beats an inherited value.

#camBar keeps every pixel and gains the reference for its colour roles.
It declines three parts of the M3 Expressive variant, and the comment
above it says which and why.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 4: The table's column structure

**Files:**
- Modify: `css/chrome.css` — `.chead`, `.dhead`, `td.nm`
- Modify: `js/table.js:37-45` — the head builder
- Test: `m3-check.html`

**Interfaces:**
- Consumes: `--pane` from Task 1.
- Produces: `.chead th` at 56px, and `.dhead th` sticking at 56px. Task 6 relies on neither.

- [ ] **Step 1: Write the failing assertions**

Add to `m3-check.html`. This probe injects a fixed head, because `js/table.js` is deferred and the
live payload must not move an assertion.

```js
/* The table's column structure. **A fixed head, never the live one**: `js/table.js` arrives through
   `lazy()`, and a probe that waits for the payload asserts on the weather. */
const HEAD = `<tr class="chead">
    <th data-sort="name" class="on up">Station</th>
    <th data-sort="river"><i class="i i-water_drop"></i>Water level</th>
  </tr>`;
const DROW = `<tr class="dhead"><th colspan="2">Gombak <span class="muted">12</span></th></tr>`;

async function tableHead(frame, label) {
  const { d, w, cs, r, settle } = await ready(frame);
  say('--- the table head, ' + label + ' -----------------------------------------');
  settle();
  const b = d.getElementById('dataBox');
  b.showModal();
  d.getElementById('dataHead').innerHTML = HEAD;
  d.getElementById('dataBody').innerHTML = DROW;
  const th = d.querySelector('.chead th[data-sort="river"]');

  /* **56dp, which is M3's minimum touch target.** This head was 30px, and a column head is a sort
     control. A phone reader tapped it and often missed. */
  is(Math.round(r(th).height), 56, label + ': the sort target is 56dp');

  /* `label-large`, in `on-surface-variant`. It was 11px uppercase with .06em of letter-spacing. */
  const root = cs(d.documentElement);
  is(cs(th).fontSize, root.getPropertyValue('--md-sys-typescale-label-large-size').trim(),
     label + ': label-large');
  is(cs(th).textTransform, 'none', label + ': sentence case, not uppercase');
  is(cs(th).letterSpacing, 'normal', label + ': and no letter-spacing');

  /* **The sort mark is a glyph now.** It was a CSS triangle drawn from borders, and that existed
     only because an uppercase letter-spaced cell cannot hold a glyph. Sentence case removes the
     reason. Assert `mask-image`, never the `--i` token: a rule that sets `--i` and never joins the
     mask list in css/icons.css draws an empty box, and that shipped once. */
  const mark = d.querySelector('.chead th.on .i-arrow_upward');
  is(!!mark, true, label + ': the sorted head carries an arrow glyph');
  is(cs(mark).maskImage !== 'none', true, label + ': and the glyph actually paints');

  /* **The district head sticks UNDER the column head, and the two numbers must agree.** `.dhead`
     stuck at `top: 30px`, which was `.chead`'s own height. The head is 56px now. Two numbers in two
     rules that must match is exactly the shape that goes stale, so assert them against each
     other. */
  const dh = d.querySelector('.dhead th');
  is(parseFloat(cs(dh).top), Math.round(r(th).height), label + ': the district head clears it');

  /* The name column on a phone. 220px is 61% of a 360px screen, and the table scrolls sideways
     behind it. */
  const want = w.innerWidth <= 600 ? 160 : 220;
  is(Math.round(r(d.querySelector('.chead th:first-child')).width), want,
     label + ': the name column is ' + want + 'px');
  b.close();
}
```

Call it at both widths.

- [ ] **Step 2: Run the check and watch it fail**

Expected: `FAIL` on the 56dp target, on `label-large`, on `sentence case`, on the arrow glyph, on
the district head's offset, and on the phone's name column width.

- [ ] **Step 3: Rewrite the column head rules**

In `css/chrome.css`, replace the `.chead` block:

```css
/* **56dp, which is M3's minimum touch target.** A column head is a sort control, and this one was
   30px. A phone reader tapped it and often missed.
   `label-large` in `on-surface-variant`, in sentence case. It was 11px uppercase with .06em of
   letter-spacing, which is this app's old table language rather than any M3 component. */
table.data .chead th {
  text-align: left; padding: 0 8px; cursor: pointer; user-select: none;
  height: 56px; white-space: nowrap;
  color: var(--muted);
  font-size: var(--md-sys-typescale-label-large-size);
  line-height: var(--md-sys-typescale-label-large-line-height);
  font-weight: 500;
  background: var(--surface); border-bottom: 1px solid var(--outline);
}
table.data .chead th:hover {
  background: color-mix(in srgb, var(--on-surface) var(--m3-state-hover), var(--surface));
}
table.data .chead th.on { color: var(--accent); }
/* **The sort mark is a real glyph now**, and the CSS triangle it replaces is gone. That triangle
   existed only because an uppercase, letter-spaced cell cannot hold one. `js/table.js` emits the
   `<i>`, so the direction is markup rather than two more classes here. */
table.data .chead th .i-arrow_upward, table.data .chead th .i-arrow_downward {
  font-size: 18px; margin-left: 4px; vertical-align: -.2em;
}
table.data .chead .i { margin-right: 5px; vertical-align: -.15em; }

/* **The district head sticks under the column head, so this number IS `.chead`'s height.** Change
   one and the other has to follow, or the district head parks over the column heads.
   M3's list subheader: `title-small` in `on-surface-variant`, 48dp, at the pane's inset. */
table.data .dhead th {
  position: sticky; top: 56px; z-index: 2; text-align: left;
  height: 48px; padding: 0 var(--pane);
  color: var(--muted);
  font-size: var(--md-sys-typescale-title-small-size);
  line-height: var(--md-sys-typescale-title-small-line-height);
  font-weight: 500; text-transform: none; letter-spacing: normal;
  background: var(--hover); border-bottom: 1px solid var(--outline);
}
table.data .dhead .muted { text-transform: none; letter-spacing: normal; margin-left: 6px; }
```

Delete the four old rules that drew the triangle: `.chead th.on::after`, `.chead th.up::after` and
`.chead th.down::after`.

- [ ] **Step 4: Narrow the name column on a phone**

Add to the `#dataBox` phone block from Task 1:

```css
  /* 220px is 61% of a 360px screen, and the table scrolls sideways behind this column, so a
     reading had about 140px to draw in. */
  table.data td.nm, table.data .chead th:first-child { width: 160px; min-width: 160px; }
```

- [ ] **Step 5: Emit the glyph from the head builder**

In `js/table.js`, the head builder writes `class="on up"` / `class="on down"` today. Change it to
emit the glyph. Read `js/table.js:37-45` and replace the class with the element:

```js
/* The sort mark is a glyph rather than two classes and a CSS triangle. `arrow_upward` means the
   smallest value is at the top, which is what an ascending sort puts there. */
.map(([key, label, icon]) => `<th data-sort="${key}"${key === sort.key ? ' class="on"' : ''}>${
  icon ? `<i class="i i-${icon}"></i>` : ''}${label}${
  key === sort.key ? `<i class="i i-arrow_${sort.up ? 'upward' : 'downward'}"></i>` : ''}</th>`)
```

**Read the real variable names off the file first.** This plan states the shape, and the file states
whether the flag is `sort.up`, `sort.dir` or something else.

- [ ] **Step 6: Bump the cache-buster and run the check**

Expected: `PASS`.

- [ ] **Step 7: Commit**

```bash
git add css/chrome.css js/table.js m3-check.html
git commit -F - <<'EOF'
Give the table head an M3 touch target and a real sort glyph

A column head is a sort control and it was 30px tall. M3 states a 48dp
minimum, and a phone reader tapped it and often missed. It is 56dp now,
at label-large in sentence case.

The sort mark was a triangle drawn from CSS borders, which existed only
because an uppercase letter-spaced cell cannot hold a glyph. Sentence
case removes the reason, so it is `arrow_upward` at 18dp.

The district head sticks under the column head, so its offset had to
follow. The check asserts the two against each other rather than
against a literal.

The name column drops to 160px on a phone. 220px is 61% of a 360px
screen, and the table scrolls sideways behind it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 5: A row takes M3's state layer

**Files:**
- Modify: `css/chrome.css` — `table.data tr[data-mast]`
- Test: `m3-check.html`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Write the failing assertion**

A `:hover` cannot be driven from a script. So walk the CSSOM, which is the shape `m3-check.html`
already uses for the navigation bar's own state layers.

```js
/* **M3's state layer**: the surface's own content colour at 8% on hover and 10% on press. This row
   took `var(--hover)` on hover and answered a press with nothing.
   **A `:hover` cannot be driven from a script**, so this walks the CSSOM. A control left out of the
   rule draws correctly and answers nothing, which is the fault this catches. */
async function rowState() {
  const { d } = await ready('desk');
  say('--- the table row state layer --------------------------------------------');
  const css = [...d.styleSheets]
    .filter(s => (s.href || '').includes('chrome.css'))
    .flatMap(s => [...s.cssRules]).map(x => x.cssText).join('\n');
  is(/tr\[data-mast\]:hover[^}]*--m3-state-hover/.test(css), true, 'a row answers a hover');
  is(/tr\[data-mast\]:active[^}]*--m3-state-press/.test(css), true, 'and a press');
  /* The percentages come from the vendored state scale. A hand-copied 8% drifts the day M3 moves
     it, and nothing on screen says so. */
  is(/--m3-state-hover:/.test([...d.styleSheets]
      .filter(s => (s.href || '').includes('base.css'))
      .flatMap(s => [...s.cssRules]).map(x => x.cssText).join('\n')), true,
     'the state scale is derived, not hand-copied');
}
```

- [ ] **Step 2: Run the check and watch it fail**

Expected: `FAIL` on `a row answers a hover` and on `and a press`.

- [ ] **Step 3: Write the rules**

Replace the two hover rules in `css/chrome.css`:

```css
table.data tr[data-mast] { cursor: pointer; }
/* **M3's state layer**, at the percentages `css/base.css` derives from the vendored state scale.
   This row took `var(--hover)` on hover and answered a press with nothing.
   **The sticky name cell has to take the same mix**, or the row lights up and its first column
   stays behind. That cell paints its own opaque background, because a sticky box with none lets
   the cells slide through it. */
table.data tr[data-mast]:hover > td {
  background: color-mix(in srgb, var(--on-surface) var(--m3-state-hover), var(--surface));
}
table.data tr[data-mast]:active > td {
  background: color-mix(in srgb, var(--on-surface) var(--m3-state-press), var(--surface));
}
table.data tr[data-mast]:hover td.nm {
  background: color-mix(in srgb, var(--on-surface) var(--m3-state-hover), var(--surface));
}
table.data tr[data-mast]:active td.nm {
  background: color-mix(in srgb, var(--on-surface) var(--m3-state-press), var(--surface));
}
```

**The `here` row is untouched.** It keeps its accent tint and its inset rail. That is a marker, not
a state, so the two never collide.

- [ ] **Step 4: Bump the cache-buster and run the check**

Expected: `PASS`.

- [ ] **Step 5: Commit**

```bash
git add css/chrome.css m3-check.html
git commit -F - <<'EOF'
Answer a pointer on a table row with M3's state layer

A row took `var(--hover)` on hover and answered a press with nothing.
It takes the surface's own content colour at 8% and 10% now, from the
percentages css/base.css derives from the vendored state scale.

The sticky name cell takes the same mix. It paints its own opaque
background, so without the rule the row lit up and its first column
stayed behind.

The `here` row is untouched. It is a marker, not a state.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 6: The cells become M3 assist chips

**Files:**
- Modify: `js/table.js:241` — `pill()` becomes `chip()`
- Modify: `js/table.js:343-385` — `cell()`
- Modify: `css/chrome.css` — the cell rules
- Test: `m3-check.html`

**Interfaces:**
- Consumes: nothing.
- Produces: the class `.mchip` on a cell's chip. Task 7 keeps `.tipbox`'s own badges out of it.

**One decision this plan makes, for the implementer to reject if wrong.** The chip's 18dp leading
icon is the **kind glyph, painted with the status hue**. Three reasons. It needs no new icon. The
alert panel already states that rule for its own rows, so this app repeats a component rather than
inventing one. And the label keeps `on-surface`, which is what holds the contrast a status-coloured
label loses against its own tint.

- [ ] **Step 1: Write the failing assertions**

Two halves. The CSS half runs in `m3-check.html`. The markup half is a node harness, because
`js/table.js` touches the DOM at module scope and node cannot load it.

Add to `m3-check.html`:

```js
/* **M3's assist chip**, the same component `#sideKinds` and the alert head draw: 32dp,
   `shape-corner-small`, a 1dp outline, `label-large`, an 18dp leading icon.
   **The colour splits M3's way.** The label takes `on-surface` and the 18dp leading icon takes the
   status hue. A chip whose label wears the status starts under 4.5:1 against its own tint, which is
   the contrast problem `.state` in css/base.css already records. */
const CELLS = `<tr data-mast="probe">
    <td class="nm">SUNGAI DAMANSARA</td>
    <td class="k"><div class="cv"><span class="mchip" style="--c:var(--s-alert)"
      ><i class="i i-rainy"></i>4 mm/h</span></div></td>
  </tr>`;

async function cellChips() {
  const { d, cs, r, settle } = await ready('desk');
  say('--- the table cell chips -------------------------------------------------');
  settle();
  const b = d.getElementById('dataBox');
  b.showModal();
  d.getElementById('dataBody').innerHTML = CELLS;
  const chip = d.querySelector('.mchip');
  is(Math.round(r(chip).height), 32, 'the chip is 32dp');
  is(cs(chip).borderRadius, '8px', 'shape-corner-small');
  is(cs(chip).borderTopWidth, '1px', 'a 1dp outline');
  const glyph = chip.querySelector('.i');
  is(Math.round(r(glyph).width), 18, 'an 18dp leading icon');
  /* The label is on-surface and the glyph carries the status. Compare the two against each other,
     never against a hex. */
  is(cs(chip).color === cs(glyph).color, false, 'the label is not painted by the status');
  is(Math.round(r(d.querySelector('td.k')).height), 52, 'so a chip cell is 52px');
  b.close();
}
```

Write the markup half as a node harness. Save nothing — run it from the Bash tool:

```bash
node --input-type=module -e "
import fs from 'fs';
const src = fs.readFileSync('js/table.js','utf8');
let bad=0; const is=(g,w,n)=>{const ok=g===w; if(!ok)bad++;
  console.log((ok?'ok   ':'FAIL ')+n+'  -> '+JSON.stringify(g)+(ok?'':'  want '+JSON.stringify(w)));};
is(/class=\"mchip\"/.test(src), true, 'the cell builder emits an assist chip');
is(/class=\"badge\"/.test(src), false, 'and no cell emits the old pill');
is(/const chip = /.test(src), true, 'the helper is named for the component it draws');
console.log(bad?'FAILURES: '+bad:'all pass'); process.exit(bad?1:0);"
```

- [ ] **Step 2: Run both and watch them fail**

Run the node harness. Expected: `FAIL` on all three.

Run the browser check. Expected: `FAIL` on the outline width and the glyph width, because `.mchip`
has no rules yet.

- [ ] **Step 3: Write the component**

Add to `css/chrome.css`:

```css
/* **M3's assist chip in a table cell.** 32dp, `shape-corner-small`, a 1dp outline, `label-large`
   and an 18dp leading icon, from
   https://github.com/bczak/m3you/blob/development/src/components/Chip/chip.css
   **This REVERSES a rule this repo used to hold**, which said the chip conversion stops at the
   pane because a 32dp chip in a table cell is a row height. The repository owner reversed it on
   2026-08-26, and the old rule is deleted rather than left to disagree with this one.
   **The colour splits M3's way, and the label is never painted by the status.** The label takes
   `on-surface` and the 18dp leading icon takes the status hue. A status-coloured label on a tint of
   itself starts under 4.5:1, which is the contrast problem `.state` in css/base.css records.
   **The cost, accepted:** the column scan was a column of filled colour bands, and it is a column
   of coloured glyphs at a fixed position now. */
table.data .mchip {
  display: inline-flex; align-items: center; gap: 8px;
  height: 32px; padding: 0 12px;
  border: 1px solid var(--outline); border-radius: var(--md-sys-shape-corner-small);
  color: var(--on-surface); background: none;
  font-size: var(--md-sys-typescale-label-large-size);
  line-height: var(--md-sys-typescale-label-large-line-height);
  font-weight: 500; white-space: nowrap;
}
table.data .mchip .i { flex: none; font-size: 18px; color: var(--c); }
/* A cell holds one chip and its own padding, so 32 + 2x10 is 52px — M3's own data table row. */
table.data td { padding: 10px 8px; border-bottom: 1px solid var(--outline); vertical-align: top; }
```

**Read `--md-sys-shape-corner-small` back off `vendor/m3/tokens.css` first.** If that file names it
something else, use the name the file states. Never hand-copy the pixel value.

- [ ] **Step 4: Rewrite the cell builder**

In `js/table.js`, replace `pill()` and the four cell branches. The status word leaves three cells,
and the reading takes its place as the label.

```js
/* **M3's assist chip.** The label carries the READING and the 18dp leading icon carries the status
   hue. The status WORD leaves the cell: `light`, `ankle deep` and the rest now live in the hover
   panel alone, which opens on a click and so answers a phone in one tap.
   The kind glyph is the leading icon. It needs no new icon, and the alert panel already paints a
   row's kind glyph with its tier colour, so this repeats a component rather than inventing one. */
const chip = (text, c, kind, hook = '') =>
  `<span class="mchip" style="--c:${c}"${hook}><i class="i i-${KINDS[kind].icon}"></i>${text}</span>`;
```

Then each branch of `cell()`:

```js
  if (m.kind === 'siren') {
    return wrap(!hasInfo(m) || !m.online ? chip('offline', NO_INFO, 'siren', hook)
      : m.status > 0 ? chip('triggered', statusColor(3), 'siren', hook)
      : chip('idle', statusColor(0), 'siren', hook));
  }
  // The camera keeps its button. A button is not a chip, and `Show image` is an action.
  if (m.kind === 'camera') {
    return wrap(m.image
      ? `<button class="shotbtn" data-shot="${camSrc(m)}"${hook}
           data-cap="Latest still from ${m.name}" data-name="${m.name}"
           ><i class="i i-photo_camera"></i>Show image</button>`
      : chip('offline', NO_INFO, 'camera', hook));
  }
  if (!hasInfo(m)) return wrap(chip('offline', NO_INFO, m.kind, hook));

  /* **The river keeps its meter AND gains a chip.** The repository owner chose that on 2026-08-26,
     with the cost stated: a river cell measures about 84px and every other cell about 52px, so the
     table reads at two row heights. Measured on the cached payload, 118 of 459 places hold a river,
     so about one row in four runs tall. */
  if (m.kind === 'river') {
    const bar = gauge(m, hook);
    return wrap(bar
      ? bar + chip(`${m.level} m`, color(m), 'river')
      : chip(`${m.level} m`, color(m), 'river', hook)
        + '<div class="val muted">No danger mark</div>');
  }
  if (m.kind === 'rainfall') {
    return wrap(chip(`${m.hourly} mm/h`, statusColor(Math.max(0, m.status)), 'rainfall', hook));
  }
  // A flood gauge: depth over a flood-prone spot, so negative is dry ground, not a missing reading.
  return wrap(chip(
    m.depth > 0 ? `${m.depth} m deep` : `${Math.abs(m.depth)} m below`,
    gaugeColor(m), 'gauge', hook));
```

**`RAIN` loses its use in `cell()` and keeps it in `tipVal()`.** The hover panel still states the
word. Do not delete the table.

**Import `KINDS` if `js/table.js` does not already hold it.** Read the import block first.

- [ ] **Step 5: Delete the rules the chip replaces**

In `css/chrome.css`, delete these. Each one styled the old pill inside a cell:

```
table.data .cv .badge { … }
table.data .cv b { … }
table.data .cv .val { … }
table.data .cv .val b { … }
table.data .cv .muted { … }
```

**Keep `table.data .tipbox .badge`.** The hover panel still draws pills, and Task 7 rules on them.
**Keep `table.data .cv + .cv { margin-top: 8px }`.** Two of one kind on one place still stack.

- [ ] **Step 6: Run both checks**

Run the node harness. Expected: `all pass`.

Run the browser check. Expected: `PASS`.

- [ ] **Step 7: Look at the page**

Open `https://flood-exp.test`, open the table, and read one screen of rows. Confirm two things by
eye. A river row is visibly taller than the rows around it, which is the accepted cost. And a column
of chips still scans, because the glyphs line up at a fixed position.

- [ ] **Step 8: Commit**

```bash
git add js/table.js css/chrome.css m3-check.html
git commit -F - <<'EOF'
Draw a table cell's status as an M3 assist chip

This reverses a rule this repo held, which said the chip conversion
stops at the pane because a 32dp chip in a table cell is a row height.
The repository owner reversed it on 2026-08-26.

The chip's label carries the READING and its 18dp leading icon carries
the status hue. So the status word leaves three cells and lives in the
hover panel alone, which opens on a click and answers a phone in one
tap.

The label is never painted by the status. A status-coloured label on a
tint of itself starts under 4.5:1, which is the contrast problem
`.state` already records.

The river cell keeps its meter and gains a chip, so it measures about
84px against 52px elsewhere. Measured: 118 of 459 places hold a river,
so about one row in four runs tall. That cost is accepted.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 7: The hover panel becomes M3's rich tooltip

**Files:**
- Modify: `css/chrome.css` — `.tipbox`
- Test: `m3-check.html`

**Interfaces:**
- Consumes: `.mchip` from Task 6, only to keep it out of this panel.
- Produces: nothing.

- [ ] **Step 1: Write the failing assertions**

```js
/* **M3's rich tooltip**: `surface-container`, a 12dp corner, a `title-small` subhead and
   `body-medium` rows. This panel already holds a head over rows and already lives in the top layer,
   so this is tokens and numbers only.
   **It must keep its own pills.** The panel sits inside a cell in the DOM, so the cell's rules reach
   it — the top layer changes where a thing paints, not what selectors match it. */
async function richTip() {
  const { d, cs, r, settle } = await ready('desk');
  say('--- the hover panel ------------------------------------------------------');
  settle();
  const b = d.getElementById('dataBox');
  b.showModal();
  d.getElementById('dataBody').innerHTML = `<tr><td class="k">
    <div id="probetip" class="tipbox surface" popover>
      <div class="tiphead">2 sensors here</div>
      <div class="tiprow"><span>SG. DAMANSARA</span><span class="tv">
        <span class="badge" style="--c:var(--s-alert)">light</span></span></div>
    </div></td></tr>`;
  const tip = d.getElementById('probetip');
  tip.showPopover();
  const root = cs(d.documentElement);
  is(cs(tip).borderRadius, '12px', 'a 12dp corner');
  is(cs(tip.querySelector('.tiphead')).fontSize,
     root.getPropertyValue('--md-sys-typescale-title-small-size').trim(), 'title-small subhead');
  is(cs(tip.querySelector('.tiprow')).fontSize,
     root.getPropertyValue('--md-sys-typescale-body-medium-size').trim(), 'body-medium rows');
  is(cs(tip.querySelector('.tiphead')).textTransform, 'none', 'sentence case, not uppercase');
  /* The panel keeps the word the cell gave up, so a pill in here must still draw. */
  is(Math.round(r(tip.querySelector('.badge')).height) > 0, true, 'and it still draws its pills');
  tip.hidePopover();
  b.close();
}
```

- [ ] **Step 2: Run the check and watch it fail**

Expected: `FAIL` on the corner, on both type scales and on `sentence case`.

- [ ] **Step 3: Write the rules**

In `css/chrome.css`, replace the `.tipbox` and `.tiphead` blocks:

```css
/* **M3's rich tooltip**: `surface-container`, a 12dp corner, a `title-small` subhead and
   `body-medium` rows. This app bridges `surface-container` onto `--hover`, its own container tone.
   Top layer, so the table's own scrolling cannot clip it. That was already true and is why this is
   a `popover`. */
.tipbox {
  position: fixed; margin: 0; inset: auto; display: none;
  min-width: 240px; max-width: min(320px, calc(100vw - 16px));
  border-radius: 12px;
  color: var(--on-surface);
  font-size: var(--md-sys-typescale-body-medium-size);
  line-height: var(--md-sys-typescale-body-medium-line-height);
}
.tipbox:popover-open { display: block; }
/* The subhead. It was 11px uppercase with .06em of letter-spacing, which is the old table language
   rather than any M3 component. */
.tipbox .tiphead {
  margin-bottom: 6px;
  color: var(--muted);
  font-size: var(--md-sys-typescale-title-small-size);
  line-height: var(--md-sys-typescale-title-small-line-height);
  font-weight: 500; text-transform: none; letter-spacing: normal;
}
```

Keep every other `.tipbox` rule as it stands. They place the rows and the graphs, and none of them
is an M3 number.

- [ ] **Step 4: Bump the cache-buster and run the check**

Expected: `PASS`.

- [ ] **Step 5: Commit**

```bash
git add css/chrome.css m3-check.html
git commit -F - <<'EOF'
Draw the table's hover panel as M3's rich tooltip

It already held a head over rows and already lived in the top layer, so
this is tokens and numbers: a 12dp corner, a title-small subhead and
body-medium rows.

The subhead was 11px uppercase with .06em of letter-spacing, which is
this app's old table language rather than any M3 component.

It keeps its own pills. The status word left the cell in the last
change, so this panel is now the only place that states it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 8: A camera tile becomes an M3 filled card

**Files:**
- Modify: `css/chrome.css` — `.camtile`
- Test: `m3-check.html`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Write the failing assertions**

```js
/* **M3's filled card**: `surface-container-highest`, a 12dp corner, no outline, and a state layer.
   **The 2px alert border stays, as a stated DIVERGENCE.** It is this app's status language, not a
   card outline. M3's outlined card states a 1dp neutral line, and 1dp of red around a 254px tile is
   much quieter than 2px. */
async function camCard() {
  const { d, cs, r, settle } = await ready('desk');
  say('--- the camera tile ------------------------------------------------------');
  settle();
  const b = d.getElementById('camBox');
  b.showModal();
  d.getElementById('camGrid').innerHTML =
    `<button class="camtile done" data-cam="1"><span class="camname">PROBE</span></button>
     <button class="camtile done t-now" data-cam="2"><span class="camname">PROBE</span></button>`;
  const tile = d.querySelector('.camtile');
  is(cs(tile).borderRadius, '12px', 'a 12dp corner');
  is(cs(tile).borderTopWidth, '2px', 'and 2px of border reserved');
  is(cs(tile).borderTopColor, 'rgba(0, 0, 0, 0)', 'transparent while the tile is quiet');
  /* The alert border keeps its token. Never a hex: the palette has moved four times. */
  const danger = cs(d.documentElement).getPropertyValue('--s-danger').trim();
  const probe = d.createElement('span');
  probe.style.color = danger;
  d.body.appendChild(probe);
  is(cs(d.querySelector('.camtile.t-now')).borderTopColor, cs(probe).color,
     'and the alert tier still paints it');
  probe.remove();
  b.close();
}

/* A `:hover` cannot be driven from a script, so the state layer is a CSSOM walk. */
async function camCardState() {
  const { d } = await ready('desk');
  const css = [...d.styleSheets]
    .filter(s => (s.href || '').includes('chrome.css'))
    .flatMap(s => [...s.cssRules]).map(x => x.cssText).join('\n');
  is(/\.camtile:hover[^}]*--m3-state-hover/.test(css), true, 'a tile answers a hover');
  is(/\.camtile:active[^}]*--m3-state-press/.test(css), true, 'and a press');
}
```

- [ ] **Step 2: Run the check and watch it fail**

Expected: `FAIL` on the 12dp corner (it draws 10px today), and on both state-layer rules.

- [ ] **Step 3: Write the rules**

In `css/chrome.css`, change `.camtile`'s corner and its container tone, and add the state layer.
**Keep every line of the existing comment.** It argues `isolation: isolate`, the transparent border
and the 16:9 ratio, and none of those arguments changes.

```css
.camtile {
  position: relative; isolation: isolate; display: block; padding: 0; overflow: hidden;
  cursor: pointer; aspect-ratio: 16 / 9; border: 2px solid transparent;
  /* **M3's filled card.** A 12dp corner on `surface-container-highest`, which this app bridges onto
     `--hover`, its own container tone. It drew a 10px corner and answered a pointer with nothing. */
  border-radius: 12px;
  background: var(--hover); color: var(--on-surface); text-align: left;
}
/* **M3's state layer**, at the percentages css/base.css derives from the vendored state scale.
   `box-shadow: inset` rather than a background: this tile's background is a photograph the moment
   one arrives, and a background mix would paint under it and show nothing. An inset shadow paints
   OVER the picture, which is where a state layer belongs. */
.camtile:hover {
  box-shadow: inset 0 0 0 100vmax color-mix(in srgb, var(--on-surface) var(--m3-state-hover), transparent);
}
.camtile:active {
  box-shadow: inset 0 0 0 100vmax color-mix(in srgb, var(--on-surface) var(--m3-state-press), transparent);
}
```

- [ ] **Step 4: Bump the cache-buster and run the check**

Expected: `PASS`.

- [ ] **Step 5: Look at the page**

Open the camera wall. Hover a tile that holds a picture and confirm the layer paints **over** the
photograph rather than under it. A layer that vanishes on a loaded tile means the mix went to
`background` rather than to an inset shadow.

- [ ] **Step 6: Commit**

```bash
git add css/chrome.css m3-check.html
git commit -F - <<'EOF'
Draw a camera tile as M3's filled card

The tile drew a 10px corner and answered a pointer with nothing. It
takes M3's filled card now: a 12dp corner on this app's own container
tone, and a state layer at 8% and 10%.

The layer is an inset box-shadow rather than a background mix. A tile's
background is a photograph the moment one arrives, so a background mix
paints underneath it and shows nothing.

The 2px alert border stays, as a divergence stated in CLAUDE.md. It is
this app's status language, not a card outline, and M3's outlined card
states a 1dp neutral line that cannot carry it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 9: Write the decisions down

**Files:**
- Modify: `CLAUDE.md` — four divergences added, one rule deleted
- Modify: `docs/FEATURES.md` — what shipped and why
- Test: the STE linter

**Interfaces:**
- Consumes: every task above.
- Produces: nothing.

- [ ] **Step 1: Delete the rule this work reverses**

In `CLAUDE.md`, find the sentence that says `.badge` is untouched in the all-stations table, because
a 32dp chip in a table cell is a row height. Delete it. Replace it with the reversal:

> **THE TABLE'S CELLS JOINED THIS RULE ON 2026-08-26, and that reverses what stood here.** The old
> rule kept `.badge` in a table cell, because a 32dp chip there is a row height. The repository owner
> reversed it. A cell draws `.mchip`, whose label is the READING and whose 18dp leading icon carries
> the status hue. So the status word leaves three cells and lives in the hover panel alone. That
> panel opens on a click, so a phone reader reaches the word in one tap.

**Never leave two rules that disagree.** A reader who finds the old one implements the old one.

- [ ] **Step 2: Add the four divergences**

Add each to the gotcha list in `CLAUDE.md`, in this app's own voice — the fault first, then the
measurement, then the rule:

1. A search bar in this app filters in place and opens no view. The go-to box is a real search view
   and wears the same shape. One shape, two behaviors, and that is the cost of one shape everywhere.
2. A camera tile is an M3 filled card carrying a 2px status border. That border is not a card
   outline. Do not convert it to an outlined card's 1dp line.
3. The table's row height is not uniform. A river cell keeps its meter and gains a chip, so it
   measures about 84px against 52px elsewhere. Measured on the cached payload: 118 of 459 places
   hold a river, so about one row in four runs tall.
4. `#camBar` declines three parts of the M3 Expressive linear progress indicator: the rounded ends,
   the 4dp gap and the stop indicator. Each shapes a widget parked in a layout, and this bar is the
   state of a boundary.

Add one more, because it is the rule a future reader needs most:

5. `--pane` is 16px for `#dataBox` and `#camBox` and 24px for `.docbox` above 600px. M3 states two
   insets and the content picks one. An app bar and a list item state 16dp. A dialog's own prose
   states 24dp.

- [ ] **Step 3: Update the file table**

In `CLAUDE.md`, the `m3-check.html` row lists what that file guards. Add the two surfaces and the
one-inset rule.

- [ ] **Step 4: Append to docs/FEATURES.md**

State what shipped and why, the trade-offs accepted, and the things deliberately not built. Name the
five decisions and the cost of each. Name the three alternatives that lost: one M3 list item per
place, an outlined card, and M3's outlined text field.

- [ ] **Step 5: Run the STE linter on both files**

```bash
python "C:/Users/illus/.claude/ste-lint.py" < CLAUDE.md
python "C:/Users/illus/.claude/ste-lint.py" < docs/FEATURES.md
```

Two counts are false positives, and this repo documents both. The checker reads a possessive
apostrophe as a contraction. It also counts each list item as a sentence, so a list of more than six
items raises a false `long_paragraph`. Every other count must read 0 for the text this task adds.

- [ ] **Step 6: Run every check one last time**

```bash
php -l api.php && php -l sources.php
```

Then the four headless checks that touch these surfaces:

```bash
for f in m3-check paint-check title-test narrow-test; do
  echo "=== $f ==="
  "/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
    --ignore-certificate-errors --virtual-time-budget=300000 --window-size=1600,1000 --dump-dom \
    "https://flood-exp.test/$f.html" | perl -0777 -ne 'print $1 if /<pre id="out">(.*?)<\/pre>/s' | tail -3
done
```

Expected: `PASS` on every one. `paint-check.html` matters here because Task 1 moved `--pane`, and
that file measures the map's own furniture against the panels.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md docs/FEATURES.md
git commit -F - <<'EOF'
Write down the table and camera wall M3 decisions

Five divergences added, and one rule deleted. The deleted rule kept
`.badge` in a table cell, and this work reverses it. Two rules that
disagree is worse than either one alone.

docs/FEATURES.md records the five decisions, the cost of each, and the
three alternatives that lost.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## What this plan does not do

- No change to the app bar or the back button. Both already match `#sideHead`.
- No change to the camera grid, the tile ratio or `grid-auto-rows: min-content`. Each carries a
  measured reason, and one records a fault that drew every tile over the two below it.
- No M3 list item conversion for table rows. The repository owner kept the columns.
- No change to `#lightbox` or `#warnBox`. Both are basic dialogs at every width and both keep the ×.
- No change to `js/wall.js`. The tile's markup does not move, only its rules.
