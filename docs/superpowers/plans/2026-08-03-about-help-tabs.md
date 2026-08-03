# About and Help tabs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `#aboutBox` into an About pane and a Help pane, add a "How this was built" section and a Developer section, and give `api.php` a rate-limited `?force=1`.

**Architecture:** One `<dialog>` holds two panes. A `.tabs` row toggles `hidden` on the panes and `aria-selected` on the buttons. Explanatory content moves from About to Help. `net.js` exports the row builders behind `#netstats` so the Developer section shows the same numbers from the same code. `api.php` gains one pure guard function and one branch in the existing cache test.

**Tech Stack:** Plain ES modules, no build step. PHP 8 with no framework. Native `<dialog>`, `role="tablist"`.

## Global Constraints

Copied from the spec and from `CLAUDE.md`. Every task must hold all of these.

- **No build step.** Keep relative import specifiers with the `.js` extension. Nothing resolves them for you.
- **No new dependency**, browser-side or server-side.
- **Colour comes from tokens.** `--accent`, `--muted`, `--on-surface`, `--outline`, `--surface`, `--hover`. Write no hex into any new CSS rule. The values live in `css/base.css` and nowhere else.
- **Traffic-light colours mean status only.** Nothing in this change is a status, so nothing in this change uses `--s-*`.
- **Bump `?v=` on `css/chrome.css`** in `index.html` when you touch that file. It is at `?v=113` now, so it becomes `?v=114`.
- **Hard-reload after any `js/` change** (Ctrl+Shift+R). Module imports carry no cache guard.
- **Prose follows ASD-STE100 loosely.** Active voice. One instruction per sentence. Maximum 20 words. No semicolons. No contractions. American spelling. Check with `python "C:/Users/illus/.claude/skills/ste-writing/ste-lint.py" < FILE`. Ignore the `long_paragraph` count raised by any list over six items.
- **Responsive to 360px.** Breakpoint is 600px. Every hover affordance needs a touch equivalent.
- **`FEED` is `api.json` on the GitHub Pages build and `api.php` under Herd.** Anything that calls a PHP endpoint must check `STATIC` from `js/config.js` first.
- **Nothing added to the refresh path may leave the `flock` on `.refresh.lock`.**
- **Do not delete `.history.db` or `shots/`.** Neither can rebuild.
- **`php shots-test.php` must stay green** through every task.

---

## File Structure

| file | responsibility after this change |
|---|---|
| `index.html` | the tab strip, the two pane wrappers, all About and Help prose, the Developer markup |
| `css/chrome.css` | `.tabs` rules and `#devstats` rules, beside the existing `#aboutBox` block |
| `js/ui.js` | the tab listener, the close reset, the Developer painter, the three action buttons |
| `js/net.js` | `feedRows()` and `sourceRows()` exported, plus `lastPayload()`. `network()` keeps owning the status word. |
| `api.php` | `forceAllowed()`, the `--selftest` branch, and the `?force=1` arm of the cache test |
| `docs/FEATURES.md` | one appended entry |

`api.php` gains a self-check rather than a second test file. The guard is arithmetic on two integers. A separate test file needs a third file to hold the function, so that both files can import it. `php api.php --selftest` runs offline, exits before any header or network call, and adds no file. The trade-off: test code sits inside the production endpoint. It is about fifteen lines and it is unreachable from the web SAPI.

---

## Task 1: The tab shell

Two working tabs around the content that is already there. Help is empty at the end of this task. That is correct and it is the point: the mechanism is reviewable on its own.

**Files:**
- Modify: `index.html:187-328` (the `#aboutBox` dialog), `index.html:34` (the `?v=` bump)
- Modify: `css/chrome.css` — insert after line 156, the `#aboutBox h3:first-of-type` rule
- Modify: `js/ui.js:25-34` (the about dialog block)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - DOM ids `tabAbout`, `tabHelp`, `paneAbout`, `paneHelp`, and the class `.tabs`.
  - `showPane(tabId: string): void` in `js/ui.js`, module-scope, not exported. `tabId` is `'tabAbout'` or `'tabHelp'`.

- [ ] **Step 1: Add the tab strip and wrap the existing content in two panes**

In `index.html`, the `#aboutBox` dialog currently runs `<div class="modalhead">…</div>`, then `<h2 class="logo">`, then all the prose, then `</dialog>`.

Insert the strip immediately after the closing `</div>` of `.modalhead` (after line 198):

```html
  <!-- Two panes, one dialog. Its own row rather than a slot in .modalhead: the test-mode toggle,
       the close button and two tabs collide at 360px, and the tabs are the wider pair. The logo
       lives inside the About pane, not above both — it is that pane's heading, and above both it
       would cost 76px of scroll before the first line of help. -->
  <div class="tabs" role="tablist">
    <button role="tab" id="tabAbout" aria-controls="paneAbout" aria-selected="true">About</button>
    <button role="tab" id="tabHelp" aria-controls="paneHelp" aria-selected="false">Help</button>
  </div>
  <div id="paneAbout" role="tabpanel" aria-labelledby="tabAbout">
```

Then, immediately before the `</dialog>` that closes `#aboutBox` (line 328), insert:

```html
  </div>
  <div id="paneHelp" role="tabpanel" aria-labelledby="tabHelp" hidden></div>
```

Every existing child of the dialog from `<h2 class="logo">` to the last credits `<p>` is now inside `#paneAbout`. Do not reorder or edit any of it in this task.

- [ ] **Step 2: Style the strip**

In `css/chrome.css`, insert directly after the `#aboutBox h3:first-of-type` rule (line 156):

```css
/* The tab strip. A row of two text buttons with an underline on the selected one — the same shape
   every browser and editor uses, so it needs no label saying it is a tab strip. Tokens only: this
   sits on the dialog surface, which flips with the theme. */
#aboutBox .tabs {
  display: flex; gap: 4px;
  border-bottom: 1px solid var(--outline);
  margin-top: 4px;
}
#aboutBox .tabs button {
  appearance: none; background: none; border: 0; cursor: pointer;
  padding: 10px 14px; margin-bottom: -1px;
  font: inherit; font-size: 14px; color: var(--muted);
  border-bottom: 2px solid transparent;
}
#aboutBox .tabs button:hover { color: var(--on-surface); }
#aboutBox .tabs button[aria-selected="true"] {
  color: var(--on-surface); border-bottom-color: var(--accent);
}
#aboutBox .tabs button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
```

The `margin-bottom: -1px` pulls the selected underline onto the strip's own border so the two do not stack into a 3px rule.

- [ ] **Step 3: Bump the stylesheet version**

In `index.html` line 34, change `css/chrome.css?v=113` to `css/chrome.css?v=114`.

- [ ] **Step 4: Wire the tabs**

In `js/ui.js`, insert after line 34 (`aboutBox.onclick = …`):

```js
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
}
aboutBox.querySelector('.tabs').onclick = e => {
  const b = e.target.closest('[role=tab]');
  if (b) showPane(b.id);
};
aboutBox.onclose = () => showPane('tabAbout');
```

- [ ] **Step 5: Relabel the button that opens it**

In `index.html` line 181, change both attributes so the help section is findable:

```html
    <button id="about" class="icon" title="Help and about"
            aria-label="Help and about"><i class="i i-info"></i></button>
```

- [ ] **Step 6: Syntax-check the modules**

Run:

```bash
cd /d/Herd/flood-exp && T=$(mktemp -d) && for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done && for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done && echo "modules ok"
```

Expected: `modules ok`, with no `FAIL` line.

- [ ] **Step 7: Check every file still serves**

Herd answers a missing file with `index.html` and HTTP 200, so check the content type and not the status.

```bash
for f in js/*.js css/*.css; do curl -sk -o /dev/null -w "%{content_type} $f\n" "https://flood-exp.test/$f"; done | grep -v 'javascript\|css'
```

Expected: no output.

- [ ] **Step 8: Look at it**

Hard-reload `https://flood-exp.test` (Ctrl+Shift+R) and open the ⓘ button.

Expected, all of it:
- The strip shows `About` and `Help`. About is underlined.
- Clicking `Help` shows an empty pane and moves the underline.
- Clicking `About` brings the content back, scrolled to the top.
- Closing and reopening the dialog lands on About.
- Tab key reaches both buttons and each takes a visible focus ring.
- At 360px wide the strip and the test-mode row do not overlap.
- Both themes: the underline is the accent, the unselected label is muted.

- [ ] **Step 9: Commit**

```bash
git add index.html css/chrome.css js/ui.js
git commit -m "The About dialog holds two panes, and the second one is empty

The strip is its own row. The test-mode toggle, the close button and two tabs
do not fit on one line at 360px, and the tabs are the wider pair. The logo goes
inside the About pane rather than above both panes, because it is that pane's
heading and above both it would cost 76 pixels of scroll before the first line
of help.

Help is empty in this commit. The mechanism is worth reviewing before any prose
lands in it."
```

---

## Task 2: Move the legend and the alert rules into Help

Content only. Nothing new is written. Two blocks move, and the heat ramps go.

**Files:**
- Modify: `index.html` — the `#aboutBox` panes

**Interfaces:**
- Consumes: `#paneAbout`, `#paneHelp` from Task 1.
- Produces: `#paneHelp` holding two `<h3>` sections. Task 3 appends four more after them.

- [ ] **Step 1: Move "What puts a station on alert" into Help**

Cut from `#paneAbout` the whole block that currently starts at the comment `<!-- What the alarm means, stated where someone can find it. …` and runs through the `<p class="muted">` ending `…the panel keeps saying how many are silenced.</p>` (index.html lines 217-241 before Task 1 moved them).

Paste it into `#paneHelp`, unedited.

- [ ] **Step 2: Move "Reading the map" into Help, and rename the heading**

Cut from `#paneAbout` the `<h3>Reading the map</h3>`, the `<p class="muted">` under it, and the whole `<div class="key">` of pin examples that ends after the cluster row (lines 243-283 before Task 1).

Paste it into `#paneHelp` **above** the block from Step 1. Change one thing only:

```html
  <h3>How to read the map</h3>
```

The heading gains `How to` so it matches the section Task 3 puts above it. Nothing below the heading changes.

- [ ] **Step 3: Delete the heat ramps, keep the two paragraphs**

Still in what you just moved: the `<div class="ramps">` block (three lines, two `<span class="ramp">` swatches) is deleted outright. `#legend` on the map draws the same two scales from live values, and two copies of one scale drift apart.

The paragraph above it (`The two heatmaps answer different questions…`) and the paragraph below it (`<b>Rainfall</b> uses the intensity classes JPS publishes…`) both **stay**, and both move into Help with the rest. They say what each layer measures. Only the swatches go.

- [ ] **Step 4: Verify the About pane still reads in order**

`#paneAbout` must now run: logo, the two opening paragraphs, `.notice`, `<h3>Where this data comes from</h3>`, three `.src` blocks, the "Each station popup names the feed" paragraph, `<h3>Credits</h3>`, two paragraphs. Nothing else.

`#paneHelp` must run: `<h3>How to read the map</h3>` and its content, then `<h3>What puts a station on alert</h3>` and its content.

- [ ] **Step 5: Check the ramps CSS is now dead**

```bash
cd /d/Herd/flood-exp && grep -rn "ramps\|\.ramp" index.html css/chrome.css
```

Expected: hits in `css/chrome.css` only (the `#aboutBox .ramps` rules at lines 242-250), none in `index.html`.

Delete the `#aboutBox .ramps`, `#aboutBox .ramps > span`, `#aboutBox .ramps .ramp` and `#aboutBox .ramps .ramp.rain` rules from `css/chrome.css`. A rule with no element is a rule the next person copies for something like it.

Bump `css/chrome.css?v=114` to `?v=115` in `index.html`.

- [ ] **Step 6: Look at it**

Hard-reload and open the dialog.

Expected:
- About is roughly half its old length and ends at Credits.
- Help shows the pin legend and the alert tag list, with the real `.tg` and `.pin` styling intact.
- No colour ramp swatches anywhere in the dialog.
- The ramps still draw correctly in `#legend` on the map itself.
- At 360px the `.key` grid still collapses to one column.

- [ ] **Step 7: Commit**

```bash
git add index.html css/chrome.css
git commit -m "The legend and the alert rules move to the pane that explains things

Both blocks move unedited. Reading the map gains How to on its heading, to match
the section that lands above it next.

The heat ramps do not move, they go. #legend on the map draws the same two
scales from live values, and two copies of one scale drift apart. The two
paragraphs beside the swatches stay, because they say what each layer measures,
which the swatches never did. The dead CSS goes with them."
```

---

## Task 3: The four new Help sections

**Files:**
- Modify: `index.html` — `#paneHelp`

**Interfaces:**
- Consumes: `#paneHelp` from Task 2.
- Produces: nothing later tasks read.

- [ ] **Step 1: Add "How to use the map" above everything else in Help**

Insert as the first child of `#paneHelp`:

```html
  <!-- Only what a tap does not teach. There is no "tap a pin" row: a reader who opened this dialog
       has already tapped things, and a list that starts by explaining the obvious teaches the reader
       that the rest is not worth reading. -->
  <h3>How to use the map</h3>
  <div class="key">
    <span><b>Ignore a sensor</b></span>
    <span>Open its card and use the ⋮ menu. The sensor stays on the map and raises no alert. The
       drawer keeps the count, and gives it back.</span>

    <span><b>Check where a reading came from</b></span>
    <span>The same ⋮ menu names the feed. It prints the stamp on the last reading. It says whether
       the station still answers.</span>

    <span><b>Look back at a camera</b></span>
    <span>Tap the picture on a camera card. The player opens three hours back. Drag the divider to
       hold that frame against the live one.</span>

    <span><b>Show only what is climbing</b></span>
    <span>A chip in the drawer. It leaves only the stations climbing towards their danger mark.</span>

    <span><b>Show one district</b></span>
    <span>The Districts list in the drawer. The count on the heading says how many are on.</span>

    <span><b>Read a point on a graph</b></span>
    <span>Move the pointer over the graph. On a phone, hold a finger on it. The reading and its time
       appear above the line.</span>

    <span><b>See every station at once</b></span>
    <span>The list button in the app bar. The table sorts, filters, and groups by district.</span>

    <span><b>Install it</b></span>
    <span>The browser offers to install this site. It then opens without browser chrome. It still
       needs a connection.</span>

    <span><b>Drive the camera player</b></span>
    <span><kbd>k</kbd> or space plays. <kbd>,</kbd> and <kbd>.</kbd> step one frame.
       <kbd>End</kbd> returns to the live picture.</span>
  </div>
```

- [ ] **Step 2: Add the three reference sections at the foot of Help**

Insert after the "What puts a station on alert" block:

```html
  <h3>Words on this map</h3>
  <div class="key">
    <span><b>alert, warning, danger mark</b></span>
    <span>The three levels JPS publishes for one station. Every station has its own set, so a drain
       and a river are each measured against what floods them.</span>

    <span><b>rising</b></span>
    <span>Forecast to reach its own danger mark within three hours. It is a forecast, not a
       direction.</span>

    <span><b>mast</b></span>
    <span>One pole that carries more than one sensor.</span>

    <span><b>site</b></span>
    <span>Sensors within 50 metres of each other. The map draws one pin per site, not per
       sensor.</span>

    <span><b>stale</b></span>
    <span>The station was on alert, and has since gone quiet.</span>

    <span><b>offline</b></span>
    <span>No reading arrived. The pin goes grey, and it never takes a status colour.</span>

    <span><b>water level</b></span>
    <span>The height of the river against a fixed datum. It does not start at zero, which is why a
       calm station still shows a number in the thirties.</span>

    <span><b>flood-depth gauge</b></span>
    <span>The depth of water over a spot that floods. A negative reading is dry ground.</span>

    <span><b>intensity class</b></span>
    <span>The rainfall bands JPS publishes. They start above 0, 10, 30 and 60 mm in the last
       hour.</span>

    <span><b>frame</b></span>
    <span>One stored camera picture. The archive keeps recent frames close together and old ones
       far apart.</span>
  </div>

  <!-- Three rows, and only three. Everything else a reader might ask is already answered on the
       thing itself: a grey pin opens a card that says why it is grey, a silent siren says OUT OF
       CONTACT. A second copy of those sentences is a second copy to keep true. -->
  <h3>Why it does that</h3>
  <div class="key">
    <span><b>The map is empty and says it cannot load.</b></span>
    <span>This site refuses to draw a map it cannot refresh. During a flood, a water level from an
       hour ago is worse than none.</span>

    <span><b>The reading is twenty minutes old.</b></span>
    <span>JPS updates a station about every 25 minutes. The time in the ⋮ menu is when JPS took the
       reading, not when this site fetched it.</span>

    <span><b>The camera picture is not from now.</b></span>
    <span>A camera card plays the last three hours. The player opens three hours back. Press the
       live button to return to now.</span>
  </div>

  <h3>What it cannot tell you</h3>
  <div class="key">
    <span><b>Cameras, sirens and flood-depth gauges</b></span>
    <span>Selangor only. JPS publishes none of the three for Kuala Lumpur or Putrajaya.</span>

    <span><b>Rainfall from the national portal</b></span>
    <span>The portal publishes it, but not in a form this site can read. Rainfall comes from the
       other two feeds.</span>

    <span><b>History past twelve hours</b></span>
    <span>The graphs hold twelve hours. There is no longer record on screen.</span>

    <span><b>A notification</b></span>
    <span>This site sends none. It must be open to warn you.</span>

    <span><b>A rain forecast</b></span>
    <span>Every number on this map was measured. None of it was predicted.</span>

    <span><b>A station JPS does not publish</b></span>
    <span>It is not here. This site adds no station of its own.</span>
  </div>
```

- [ ] **Step 3: Style `<kbd>`**

`<kbd>` has no rule yet. In `css/chrome.css`, add beside the other `#aboutBox` rules:

```css
#aboutBox kbd {
  font: inherit; font-size: 12px; padding: 1px 6px;
  border: 1px solid var(--outline); border-radius: 4px; background: var(--hover);
}
```

Bump `css/chrome.css?v=115` to `?v=116` in `index.html`.

- [ ] **Step 4: Check the prose**

Extract just the new prose and lint it:

```bash
cd /d/Herd/flood-exp && python - <<'PY' > /tmp/help.txt
import re
h=open('index.html',encoding='utf8').read()
s=h[h.index('<h3>How to use the map</h3>'):h.index('</div>',h.index('<h3>What it cannot tell you</h3>'))]
print(re.sub(r'\s+',' ',re.sub(r'<[^>]+>',' ',s)))
PY
python "C:/Users/illus/.claude/skills/ste-writing/ste-lint.py" < /tmp/help.txt
```

Expected: `semicolon`, `contraction`, `banned_modal` and `marketing_adjective` all 0. Fix anything else the checker raises, except `long_paragraph`, which every list over six items raises falsely.

- [ ] **Step 5: Look at it**

Hard-reload and open Help.

Expected:
- Six `<h3>` sections in order: How to use the map, How to read the map, What puts a station on alert, Words on this map, Why it does that, What it cannot tell you.
- The `.key` grid puts the bold term left and the sentence right on a desktop.
- At 360px each `.key` collapses to one column with the term above its sentence.
- The `<kbd>` keys read as keys in both themes.

- [ ] **Step 6: Commit**

```bash
git add index.html css/chrome.css
git commit -m "Help says how to drive it, what the words mean, and what it will not do

Four sections, all in the .key grid the legend already uses, so there is no new
layout. How to use the map lists only what a tap does not teach — there is no
tap a pin row, because a list that opens by explaining the obvious teaches a
reader that the rest is not worth reading.

Why it does that holds three rows and not eight. The other five restated a
sentence the interface already prints at the point a reader asks. A grey pin
opens a card that says why it is grey. Two copies of that is two to keep true."
```

---

## Task 4: "How this was built"

**Files:**
- Modify: `index.html` — `#paneAbout`

**Interfaces:**
- Consumes: `#paneAbout` from Task 1.
- Produces: nothing later tasks read.

- [ ] **Step 1: Verify all four privacy claims before writing them**

Run every one. A claim that is false must not ship, and each of these can stop being true later.

```bash
cd /d/Herd/flood-exp
grep -rn "gtag\|plausible\|umami\|analytics\|googletagmanager" index.html js/ sw.js ; echo "--- analytics above, expect none ---"
grep -rn "document.cookie" js/ ; echo "--- cookies above, expect none ---"
grep -rohE "https?://[a-zA-Z0-9.-]+" index.html css/ js/ sw.js | sort -u ; echo "--- every distinct host above: classify each as fetched at runtime or a user-clicked link ---"
grep -rn "coords\|latitude\|longitude" js/locate.js | head
grep -n "lat\|lng\|coord" api.php | grep -i "_GET\|_POST" ; echo "--- api.php reading coordinates above, expect none ---"
```

Expected: the first two print nothing before their marker line. The third lists every host the page
can reach; check each one by hand. A host is fetched only if the code loads it without a click — a
`<script src>`, a `fetch`, a tile layer, an `<img>` — not merely linked from an `<a href>`.
`js/map.js:24` fetches map tiles from `basemaps.cartocdn.com` on every pan and zoom; that is the one
accepted third party, and it is already named in the Credits section below it. A grep for a host
prefix such as `cdn.` misses a host like `basemaps.cartocdn.com`, so do not narrow the pattern back
to a short list of known CDN names. `js/locate.js` uses the coordinates locally to draw a marker.
`api.php` accepts no coordinate parameter.

If any check fails, stop and report it. Do not soften the sentence — delete the claim it belongs to.

- [ ] **Step 2: Insert the section**

In `#paneAbout`, directly after the closing `</p>` of the `.notice` block and before `<h3>Where this data comes from</h3>`:

```html
  <!-- Under the notice, because both blocks answer one question: how much weight does this site
       carry. The complaint about the official portals is already two paragraphs up, with the
       evidence attached, so this does not repeat it. What About never said is that a machine wrote
       the code.
       The last three paragraphs each make a claim about privacy. The plan for this change carries
       a grep behind every one. The tile sentence is there because the credits below name CARTO,
       and a page that credits a third party while claiming to load nothing from one contradicts
       itself in a single screen. Anything that ever posts a coordinate must delete the last
       paragraph. -->
  <h3>How this was built</h3>
  <p class="muted">This site is vibe coded. An AI wrote most of it, over a few evenings. It exists
     because reading three government pages to answer one question about my own river was
     absurd.</p>
  <p class="muted">It started as Selangor alone. I work in Kuala Lumpur, so I added that too, and
     Putrajaya arrived on the same feed. A Selangor map became a Klang Valley one. The repository
     still carries the first name.</p>
  <p class="muted">So there is no team behind it, and no warranty. It can be wrong. The code is
     open. Read it, and tell me what I got wrong.</p>
  <p class="muted">It keeps no account, runs no analytics and sets no cookies. It loads no tracking
     script from anyone.</p>
  <p class="muted">The map tiles come from CARTO, so CARTO sees which tiles your browser asks for.
     Nothing else on this page is theirs.</p>
  <p class="muted">Your location, if you share it, stays in the browser. Nothing sends it
     anywhere.</p>

  <div class="src">
    <a href="https://github.com/illusionikx/selangor-flood-tracker" target="_blank"
       rel="noopener">Source code</a>
    <span class="muted">The whole site, and the scrapers behind it.</span>
  </div>
  <div class="src">
    <a href="https://github.com/illusionikx/selangor-flood-tracker/issues" target="_blank"
       rel="noopener">Report a mistake</a>
    <span class="muted">A wrong reading, a station in the wrong place, or a page that will not
      load.</span>
  </div>
```

`.src` is the existing pattern the three data-source links already use. This adds no CSS.

- [ ] **Step 3: Follow both links**

```bash
curl -sk -o /dev/null -w '%{http_code} source\n' https://github.com/illusionikx/selangor-flood-tracker
curl -sk -o /dev/null -w '%{http_code} issues\n' https://github.com/illusionikx/selangor-flood-tracker/issues
```

Expected: `200` for both. A `404` means the repository is private. Report it and stop. A Source code link that 404s is worse than no link, because the paragraph above it says "the code is open".

- [ ] **Step 4: Check the prose**

```bash
cd /d/Herd/flood-exp && python - <<'PY' > /tmp/built.txt
import re
h=open('index.html',encoding='utf8').read()
s=h[h.index('<h3>How this was built</h3>'):h.index('<h3>Where this data comes from</h3>')]
print(re.sub(r'\s+',' ',re.sub(r'<[^>]+>',' ',s)))
PY
python "C:/Users/illus/.claude/skills/ste-writing/ste-lint.py" < /tmp/built.txt
```

Expected: `semicolon` 0, `contraction` 0, `banned_modal` 0, `long_sentence` 0.

- [ ] **Step 5: Look at it**

Hard-reload and open About.

Expected: the section sits between the amber notice and the sources. Both links open in a new tab. At 360px no line overflows.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "About says a machine wrote it, and why a Selangor map covers Putrajaya

The complaint about the official portals was already in About with the evidence
attached. The fact it never stated is who wrote the code.

The scope paragraph earns its place twice. It is the origin story, and it is the
answer to a question the new Source code link creates: the repository is called
selangor-flood-tracker and the app is called Klang Valley Flood Watch.

It also states what the site does not do. No account, no analytics, no cookies,
nothing from a third party, and a location that never leaves the browser. All
five were checked by grep before this was written. Anything that ever posts a
coordinate must delete the last sentence."
```

---

## Task 5: `?force=1`, guarded

The only real logic in this change. Test first.

**Files:**
- Modify: `api.php` — consts near line 53, a new function and a `--selftest` branch above `header()` at line 237, and the cache test at lines 267-287, and the payload array at line 787

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `forceAllowed(int $now, ?int $lastForce, int $window = FORCE_EVERY): array` returning `[bool $allowed, string $why]`.
  - `GET api.php?force=1` returning the usual payload plus `forced: bool`. When `forced` is `false` the payload also carries `forceWhy: string`, one of `'rate limited'` or `'another refresh is running'`.

- [ ] **Step 1: Write the failing self-check**

In `api.php`, immediately after `const RETAIN = …` (line 56), add the two constants:

```php
/* A forced refresh skips the file cache, so it costs a full ~270-request fan-out at JPS. This
   button is public, so the guard is here and not in the browser. One force per minute for the
   whole site caps the worst case at ~4.5 requests a second — a cold rebuild already fires 270 in
   about three seconds, which is 90 a second, so the button cannot make a burst this site does not
   already make on its own. */
const FORCE_EVERY = 60;
const FORCE_STAMP = __DIR__ . '/.force.stamp';
```

Then, immediately before `header('Content-Type: application/json');` (line 237), add the self-check. It must come before the header and before any network call.

```php
/* `php api.php --selftest` — the guard above, checked offline. It lives here rather than in a
   second test file because the rule is arithmetic on two integers, and a separate test would need
   a third file to hold the function so both could import it. CLI only, and it exits before the
   first header. */
if (PHP_SAPI === 'cli' && in_array('--selftest', $argv ?? [], true)) {
    $fail = 0;
    $ok = function (string $what, bool $pass) use (&$fail) {
        if (!$pass) $fail++;
        echo ($pass ? '  ok   ' : '  FAIL ') . $what . "\n";
    };
    $now = 1800000000;

    echo "forceAllowed():\n";
    $ok('no stamp at all is allowed',            forceAllowed($now, null)[0] === true);
    $ok('a stamp 61s old is allowed',            forceAllowed($now, $now - 61)[0] === true);
    $ok('a stamp exactly 60s old is allowed',    forceAllowed($now, $now - 60)[0] === true);
    $ok('a stamp 59s old is refused',            forceAllowed($now, $now - 59)[0] === false);
    $ok('a stamp from this second is refused',   forceAllowed($now, $now)[0] === false);
    $ok('a refusal says why',                    forceAllowed($now, $now)[1] === 'rate limited');
    /* A stamp in the future would otherwise lock the button out until the clock caught up. Same
       hazard readTs() already guards against on a JPS reading, for the same reason: a clock we do
       not own moved. */
    $ok('a stamp from the future is allowed',    forceAllowed($now, $now + 3600)[0] === true);
    $ok('the window is honoured when passed',    forceAllowed($now, $now - 10, 5)[0] === true);

    echo $fail ? "\n$fail FAILED\n" : "\nall ok\n";
    exit($fail ? 1 : 0);
}
```

- [ ] **Step 2: Run it and watch it fail**

Run:

```bash
cd /d/Herd/flood-exp && php api.php --selftest
```

Expected: a fatal error, `Call to undefined function forceAllowed()`. That is the correct failure. If it prints `all ok`, the function already exists and something is wrong.

- [ ] **Step 3: Write the guard**

In `api.php`, directly above the `--selftest` block you just added:

```php
/**
 * May a forced refresh run now?
 *
 * @param int      $now       unix seconds
 * @param int|null $lastForce mtime of FORCE_STAMP, or null when no force has ever run
 * @return array{0: bool, 1: string} allowed, and why
 */
function forceAllowed(int $now, ?int $lastForce, int $window = FORCE_EVERY): array {
    if ($lastForce === null) return [true, 'first'];
    $since = $now - $lastForce;
    // A stamp in the future means a clock moved, not that someone forced a refresh in the future.
    // Refusing until it catches up would disable the button for as long as the skew lasts.
    if ($since < 0) return [true, 'clock moved'];
    return $since >= $window ? [true, 'ok'] : [false, 'rate limited'];
}
```

- [ ] **Step 4: Run it and watch it pass**

Run:

```bash
cd /d/Herd/flood-exp && php api.php --selftest
```

Expected: eight `ok` lines, then `all ok`, exit code 0.

- [ ] **Step 5: Wire the guard into the cache test**

In `api.php`, replace the block at lines 267-272. It currently reads:

```php
$lock = fopen(LOCK, 'c');
$mine = $lock && flock($lock, LOCK_EX | LOCK_NB);

if (is_file(CACHE)) {
    $age = time() - filemtime(CACHE);
    if ($age < TTL || !$mine) serveCache();   // fresh, or someone else is already rebuilding it
```

Replace with:

```php
$lock = fopen(LOCK, 'c');
$mine = $lock && flock($lock, LOCK_EX | LOCK_NB);

/* The Developer section's "Refresh now". It expires the *file* cache and nothing else — the scraped
   pages keep their own 15-minute cache in the `page` table, because the KL rainfall table takes
   about ten seconds upstream and re-scraping it would triple the cost of one button press.
   It is not a second refresh path: it falls into the same lock, and a loser still serves stale
   cache rather than queueing. GET only, so a prefetch of a link can never trip it. */
$force = isset($_GET['force']) && ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET';
$forceWhy = '';
if ($force) {
    [$allowed, $forceWhy] = forceAllowed(time(), is_file(FORCE_STAMP) ? filemtime(FORCE_STAMP) : null);
    if ($allowed) touch(FORCE_STAMP); else $force = false;
}

if (is_file(CACHE)) {
    $age = time() - filemtime(CACHE);
    // Fresh and nobody forced it, or someone else is already rebuilding it.
    if (($age < TTL && !$force) || !$mine) {
        serveCache(isset($_GET['force'])
            ? ['forced' => false, 'forceWhy' => $mine ? ($forceWhy ?: 'cache is fresh') : 'another refresh is running']
            : []);
    }
```

- [ ] **Step 6: Report the outcome on a rebuilt payload**

In the `$payload = json_encode([…])` array (near line 787), add one line directly after `'upstreamOk' => true,`:

```php
    'forced'   => $force,
```

Without this the button cannot tell a refresh it caused from a poll that happened to land.

- [ ] **Step 7: Lint the endpoint**

```bash
cd /d/Herd/flood-exp && php -l api.php && php -l sources.php && php api.php --selftest
```

Expected: `No syntax errors detected` twice, then `all ok`.

- [ ] **Step 8: Prove the rate limit over HTTP**

```bash
cd /d/Herd/flood-exp && rm -f .force.stamp
curl -sk "https://flood-exp.test/api.php?force=1" | php -r '$j=json_decode(stream_get_contents(STDIN),true); echo "first:  forced=".var_export($j["forced"]??null,true)." why=".($j["forceWhy"]??"-")."\n";'
curl -sk "https://flood-exp.test/api.php?force=1" | php -r '$j=json_decode(stream_get_contents(STDIN),true); echo "second: forced=".var_export($j["forced"]??null,true)." why=".($j["forceWhy"]??"-")."\n";'
```

Expected:

```
first:  forced=true why=-
second: forced=false why=rate limited
```

The first call takes a few seconds. That is the fan-out, and it is the thing the limit exists to bound.

- [ ] **Step 9: Prove the lock still wins**

Hold the lock from a second shell, then force:

```bash
cd /d/Herd/flood-exp && php -r 'const L=__DIR__."/.refresh.lock"; $f=fopen(L,"c"); flock($f,LOCK_EX); echo "lock held for 20s\n"; sleep(20);' &
sleep 1
rm -f .force.stamp
time curl -sk "https://flood-exp.test/api.php?force=1" | php -r '$j=json_decode(stream_get_contents(STDIN),true); echo "forced=".var_export($j["forced"]??null,true)." why=".($j["forceWhy"]??"-")."\n";'
wait
```

Expected: it returns **at once**, not after 20 seconds, with `forced=false why=another refresh is running`. A forced refresh that queues behind the lock is the stampede the lock exists to stop. It arrives one connection at a time.

- [ ] **Step 10: Confirm the page cache was not touched**

```bash
cd /d/Herd/flood-exp && php -r '$d=new SQLite3(".history.db"); $r=$d->query("SELECT url, ts, datetime(ts,\"unixepoch\",\"localtime\") FROM page"); while($x=$r->fetchArray(SQLITE3_NUM)) echo "$x[2]  $x[0]\n";'
```

Expected: the timestamps are unchanged by the forced refresh above. If they moved, the force is expiring the page cache and Step 5's comment is a lie.

- [ ] **Step 11: Add it to the repo's Verify block**

In `CLAUDE.md`, in the fenced block that currently starts `php shots-test.php`, add the second runnable check:

```bash
php api.php --selftest       # the force-refresh rate limit, offline. Must stay green.
```

- [ ] **Step 12: Commit**

```bash
git add api.php CLAUDE.md
git commit -m "A forced refresh skips the cache, once a minute, inside the same lock

Refresh now is a public button that costs a ~270-request fan-out at JPS, so the
guard is server-side. One force per minute for the whole site caps it at about
4.5 requests a second. A cold rebuild already fires 270 in three seconds, which
is 90 a second, so the button cannot make a burst this site does not already
make on its own.

It is not a second refresh path. It falls into the existing flock, and the loser
of that race still serves stale cache instead of queueing — a forced refresh
that queued would be the stampede the lock exists to stop, arriving one
connection at a time.

It expires the file cache and nothing else. The scraped pages keep their own
15-minute cache, because the KL rainfall table takes ten seconds upstream.

php api.php --selftest checks the guard offline. It covers the boundary at 60
seconds and a stamp in the future, which would otherwise disable the button
until the clock caught up — the same hazard readTs() already guards on a JPS
reading, for the same reason."
```

---

## Task 6: The Developer section

**Files:**
- Modify: `js/net.js:38-54` (extract the row builders)
- Modify: `index.html` — move the test-mode toggle, add the Developer block
- Modify: `js/ui.js` — the painter and three buttons
- Modify: `css/chrome.css` — `#devstats` rules

**Interfaces:**
- Consumes: `showPane()` from Task 1. `?force=1` and its `forced` / `forceWhy` fields from Task 5.
- Produces:
  - From `js/net.js`: `feedRows(j): [string, string|number][]`, `sourceRows(j): [string, string|number][]`, `lastPayload(): object|null`.
  - In `js/ui.js`: `paintDev(): void`, module-scope, not exported.
  - DOM ids `devstats`, `devForce`, `devRaw`, `devReset`, `devMsg`.

- [ ] **Step 1: Extract the row builders in `js/net.js`**

Replace lines 38-43, which currently read:

```js
  const rows = [['status', text], ...(err ? [['problem', err]] : [
    ['readings', j.sourceUpdated ? ago(j.sourceUpdated) : 'unknown'],
    ['last checked', ago(j.fetched)],
    ['stations', j.stations.length],
    ['from', j.cacheAge ? `cache, ${j.cacheAge}s old` : 'JPS'],
  ])];
```

with:

```js
  const rows = [['status', text], ...(err ? [['problem', err]] : feedRows(j))];
```

Then add, directly above `function network(j, err) {` (line 23):

```js
/* The four facts behind the status dot. Exported because the Developer section in the About dialog
   shows the same numbers, and two copies of this list would drift the first time one of them gained
   a row. */
export const feedRows = j => [
  ['readings', j.sourceUpdated ? ago(j.sourceUpdated) : 'unknown'],
  ['last checked', ago(j.fetched)],
  ['stations', j.stations.length],
  ['from', j.cacheAge ? `cache, ${j.cacheAge}s old` : 'JPS'],
];

/* What the dot has no room for. The scraped counters are the alarm for a scraper that broke —
   `parsed: 0` means a table moved upstream, not that the rivers went quiet — and until now they
   were in the payload and on no screen. */
export const sourceRows = j => [
  ['fetch time', `${j.tookMs ?? '?'} ms`],
  ['detail calls', `${j.details?.ok ?? '?'} of ${j.details?.requested ?? '?'}`],
  ['kl scraped', `${j.sources?.kl?.parsed ?? '?'} parsed, ${j.sources?.kl?.added ?? '?'} added`],
  ['national scraped',
    `${j.sources?.national?.parsed ?? '?'} parsed, ${j.sources?.national?.applied ?? '?'} applied`],
  ['offline stations', j.offline ?? '?'],
];

/** The payload the chip is currently describing, so the About dialog reports the same poll. */
export const lastPayload = () => last;
```

`last` is declared at line 21 with `let last;`. It is in module scope and needs no change.

- [ ] **Step 2: Move the test-mode toggle out of `.modalhead`**

In `index.html`, delete the `<label class="testtog">…</label>` block from `.modalhead` (lines 191-195). `.modalhead` keeps only the close form, and `#aboutBox .modalhead { justify-content: flex-end }` is still the right rule for it.

- [ ] **Step 3: Add the Developer block at the foot of the About pane**

Insert as the last child of `#paneAbout`, after the credits paragraphs:

```html
  <!-- The toggle moved here out of the close-button row. Its old spot had a reason — a mode and its
       exit within reach of each other — and the tabs weakened it: this pane is now short enough that
       the close button is one scroll away, and the amber test-mode strip across the top of the page
       is what actually gets you out. Here it sits under a heading that names what it is. -->
  <h3>Developer</h3>
  <label class="testtog" title="Fill the map with fake alerts to see how it behaves in a flood">
    <input type="checkbox" id="testMode"><span>Test mode</span>
  </label>
  <p class="muted">Fills the map with fake alerts, in this browser only. Nothing reaches JPS, and
     nothing is stored.</p>

  <table id="devstats"></table>

  <div class="rowbtns">
    <button id="devForce" class="link"><i class="i i-refresh"></i> Refresh now</button>
    <a id="devRaw" class="link" href="api.php" target="_blank" rel="noopener">Raw payload</a>
    <button id="devReset" class="link">Reset settings</button>
  </div>
  <p id="devMsg" class="muted" role="status"></p>
```

`.rowbtns` and `.link` are the drawer's existing classes, both in `css/base.css:345-363`. `.link:disabled` is already styled there, so the force button's disabled state needs no new rule. `.link` is written for `<button>`, and `#devRaw` is an `<a>` — check it takes the same padding and hover, and add `.rowbtns a.link { text-decoration: none }` only if it does not.

`role="status"` makes the outcome line reach a screen reader without stealing focus.

- [ ] **Step 4: Style the table**

In `css/chrome.css`, beside the other `#aboutBox` rules:

```css
/* `separate`, not `collapse` — collapse drops padding on the table box, which is the same trap
   #netstats already documents. */
#devstats { border-collapse: separate; width: 100%; margin: 12px 0; font-size: 13px; }
#devstats td { padding: 3px 0; vertical-align: top; }
#devstats td:first-child { width: 42%; color: var(--muted); }
```

Bump `css/chrome.css?v=116` to `?v=117` in `index.html`.

- [ ] **Step 5: Paint the table**

In `js/ui.js`, extend the import on line 15 and add the painter after `showPane()` from Task 1:

```js
import { load, feedRows, sourceRows, lastPayload } from './net.js';
```

```js
/* The same numbers the status dot shows, plus the ones it has no room for. Painted when the dialog
   opens and when the About pane comes back, because a poll may have landed while Help was on
   screen. There is nothing to tear down, so re-painting is the whole update. */
function paintDev() {
  const j = lastPayload();
  el('devstats').innerHTML = !j
    ? '<tr><td class="muted" colspan="2">no payload yet</td></tr>'
    : [...feedRows(j), ...sourceRows(j)]
        .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
}
```

Then add `paintDev()` to two places. In `showPane()`, as the last line of the function body:

```js
  if (tabId === 'tabAbout') paintDev();
```

And in the open handler on line 33:

```js
el('about').onclick = () => { closeSide(); paintDev(); aboutBox.showModal(); };
```

- [ ] **Step 6: Wire the three actions**

In `js/ui.js`, after `paintDev()`. Add `STATIC` and `FEED` to the `config.js` import on line 3:

```js
import { KINDS, camSrc, FEED, STATIC } from './config.js';
```

```js
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
  el('devMsg').textContent = 'refreshing…';
  try {
    const r = await fetch(FEED + (FEED.includes('?') ? '&' : '?') + 'force=1', { cache: 'no-store' });
    const j = await r.json();
    el('devMsg').textContent = j.forced
      ? `refreshed in ${j.tookMs} ms`
      : `not refreshed — ${j.forceWhy || 'served from cache'}`;
    await load();
  } catch (e) {
    el('devMsg').textContent = 'failed — ' + e.message;
  }
  b.disabled = false;
  paintDev();
};

/* Native confirm(), because this drops the ignored list and that is the one setting somebody chose
   deliberately. It fails in the safe direction — clearing it un-silences sensors, so it can only
   add alerts, never hide one — but "safe" is not "expected". */
el('devReset').onclick = () => {
  if (!confirm('Reset the theme, the district filter, the layer chips and the ignored sensors?\n\n'
      + 'This cannot be undone.')) return;
  localStorage.removeItem('prefs');
  location.reload();
};
```

Confirm the storage key first:

```bash
cd /d/Herd/flood-exp && grep -n "localStorage" js/state.js
```

If the key is not the literal `'prefs'`, use whatever `state.js` uses. Do not hard-code a second copy of it — if `state.js` exports the name, import it.

- [ ] **Step 7: Syntax-check the modules**

```bash
cd /d/Herd/flood-exp && T=$(mktemp -d) && for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done && for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done && echo "modules ok"
```

Expected: `modules ok`.

- [ ] **Step 8: Check the numbers agree with `#netstats`**

Hard-reload. Hover the logo mark to open `#netstats`, then open the dialog.

Expected: `readings`, `last checked`, `stations` and `from` show the same values in both places, on the same poll. If they disagree, one of them is not going through `feedRows()`.

- [ ] **Step 9: Exercise all three actions**

Expected, in order:
- `Refresh now`: the button disables, the line says `refreshing…`, then `refreshed in NNNN ms`. The map's stations reload. Press it again inside a minute: `not refreshed — rate limited`, and it returns at once.
- `Raw payload`: opens `api.php` in a new tab and shows JSON.
- `Reset settings`: the confirm names all four things. Cancel changes nothing. Accept reloads the page with the default theme and no ignored sensors.
- Test mode still toggles, and still paints the amber strip.

- [ ] **Step 10: Check the Pages build path**

```bash
cd /d/Herd/flood-exp && grep -n "STATIC" js/config.js
```

Confirm how `STATIC` is decided, then force it true in the browser console for one check:

```js
// in DevTools, on the live page
document.getElementById('devForce').hidden = true;
```

Expected: the row still lays out with two controls and no gap where the button was. If `.rowbtns` leaves a hole, the `hidden` attribute is being overridden by a `display` rule — fix it with `#devForce[hidden] { display: none }` rather than by removing the element.

- [ ] **Step 11: Commit**

```bash
git add index.html css/chrome.css js/ui.js js/net.js
git commit -m "The About pane says what the last poll did, and offers three things to do about it

The test-mode toggle moves out of the close-button row into a section that names
what it is. Its old spot had a reason, which the tabs weakened: this pane is now
short, and the amber strip across the page is what actually gets you out.

net.js exports the rows behind the status dot, so the dialog and the dot cannot
disagree. It also exports the counters the dot has no room for. Those are the
alarm for a scraper that broke — parsed: 0 means a table moved upstream, not
that the rivers went quiet — and until now they were in the payload and on no
screen at all.

Refresh now hides itself on the Pages build, where FEED is a baked api.json and
there is nothing to force. Reset settings asks first, because it drops the
ignored list, which is the one setting somebody chose on purpose."
```

---

## Task 7: Record it

**Files:**
- Modify: `docs/FEATURES.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Read the tail of the file to match its shape**

```bash
cd /d/Herd/flood-exp && tail -60 docs/FEATURES.md
```

Match the existing heading levels and the `### Trade-offs accepted` / `### Not built` convention.

- [ ] **Step 2: Append the entry**

Append a `## About and Help share one dialog` section. It must record, each in its own `###` block:

- **Two panes, one dialog.** Why tabs and not accordions or a second dialog. Why the logo is inside the About pane. Why About is the default pane even though Help holds most of the words — the not-official notice and the 999 line reach a first-time reader first, and that is a safety decision that outranks the desktop convention of About being a leaf of Help.
- **What moved, and what was deleted.** The legend and the alert rules moved unedited. The heat ramps were deleted because `#legend` draws the same scales from live values. Five of eight planned FAQ rows were deleted because the interface already prints the answer where the reader asks.
- **How this was built.** The four privacy claims and the grep behind each. State plainly that anything which ever posts a coordinate must delete the last sentence of that paragraph in the same change.
- **The Developer section.** That the per-source `parsed` counters had no screen before this. The four rules on `?force=1`: inside the existing lock, page cache untouched, one force per minute site-wide, and a loser serves stale instead of queueing. The arithmetic that makes 60 seconds the right number.
- **`php api.php --selftest`.** Why the check lives in the endpoint rather than a second test file, and what it covers.
- **`### Trade-offs accepted`** — the Developer section is public and the rate limit is the whole defence. Test mode is one scroll further from the close button. The Help pane holds a mixed prose register, because moved blocks were not rewritten.
- **`### Not built`** — no version number, no changelog, no uptime claim, no roving tabindex, no memory of the last pane, no `?` shortcut sheet, no URL fragment.

- [ ] **Step 3: Check the prose**

```bash
cd /d/Herd/flood-exp && python "C:/Users/illus/.claude/skills/ste-writing/ste-lint.py" < docs/FEATURES.md
```

The file is long, so judge the delta rather than the total. `semicolon`, `contraction` and `banned_modal` must be no higher than before your edit.

- [ ] **Step 4: Run every check one last time**

```bash
cd /d/Herd/flood-exp
php -l api.php && php -l sources.php
php shots-test.php | tail -3
php api.php --selftest | tail -1
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done; echo "modules ok"
for f in js/*.js css/*.css; do curl -sk -o /dev/null -w "%{content_type} $f\n" "https://flood-exp.test/$f"; done | grep -v 'javascript\|css'
curl -sk https://flood-exp.test/api.php | php -r 'echo json_encode(json_decode(stream_get_contents(STDIN),true)["sources"]),"\n";'
```

Expected: two `No syntax errors detected`, `shots-test.php` green, `all ok`, `modules ok`, no content-type output, and a `sources` line where no `parsed` is `0`.

- [ ] **Step 5: Commit**

```bash
git add docs/FEATURES.md
git commit -m "Record why the dialog has two panes and why the button is rate limited"
```

---

## Self-review notes

**Spec coverage.** Every section of the spec maps to a task: tabs and behaviour to Task 1, the content split and both deletions to Task 2, the four Help sections to Task 3, "How this was built" and its four verified claims to Task 4, `?force=1` and its four rules to Task 5, the Developer section and the shared renderer to Task 6, `docs/FEATURES.md` to Task 7.

**Two things the spec did not anticipate**, both found while reading the code:

1. **`FEED` is `api.json` on the Pages build.** `js/config.js:167` reads `STATIC ? 'api.json' : 'api.php'`. A `Refresh now` button there fetches `api.json?force=1`. That is a static file. It ignores the query and returns a payload with no `forced` field. The button then reports `not refreshed` for ever, on a build where a cron job owns the refresh. Task 6 Step 6 hides it.
2. **`<kbd>` has no rule.** The player keys need one, so Task 3 Step 3 adds it. Without it they render as unstyled monospace at the wrong size.

**Deferred deliberately.** `#netstats` keeps its own four rows rather than growing the source counters. Widening a hover popover on the app bar is a separate decision. The counters add five rows to the tallest panel in the header.
