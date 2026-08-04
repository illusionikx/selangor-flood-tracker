# Place search and favorites — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find any place in the coverage area and show the sensors near it. Star the sensors and masts that matter to you.

**Architecture:** `api.php` gains a `?place=` endpoint. It proxies OpenStreetMap Nominatim server-side, bounds the answer to the coverage box, caches it for 30 days and rate-limits the uncached path. The browser reaches no third party. Favorites are `PREFS.favs`, an array of station ids. It mirrors `PREFS.ignored` and is mutually exclusive with it. The go-to box lists one row per site instead of one row per sensor, with sensor sub-rows. The list then matches the map one for one.

**Tech Stack:** PHP 8 with curl and PDO sqlite. Browser ES modules, no build step, no framework. Leaflet and markercluster, hand-vendored.

**Source spec:** [`docs/superpowers/specs/2026-08-04-place-search-and-favourites-design.md`](../specs/2026-08-04-place-search-and-favourites-design.md)

## Global Constraints

- **American spelling everywhere**, in prose, in code and in every user-facing string. The word is `favorite`, never `favourite`.
- **No new dependency.** No CDN, no npm, no Composer package. `lib/` is server-side only and `vendor/` is hand-managed.
- **No build step.** Keep relative import specifiers with the `.js` extension.
- **Color language.** Status is green, amber, orange, red plus grey. Sensor kinds use `--k-*`. A favorite is neither, so it uses `--accent`. Never write a hex outside `css/base.css`.
- **Never `file_get_contents()` a remote URL.** Always `fetchAll()`.
- **Never re-derive a status client-side.** `test.js` is the one exception and this plan does not touch it.
- **Bump `?v=`** on every stylesheet link in `index.html` that you change.
- **Hard-reload** (Ctrl+Shift+R) after any `js/` change. ES module imports carry no cache guard.
- **Do not widen `isHot()`.** Favorites change order only. No count, no badge, no ticker and no toast moves.
- **Leave `sources.php` alone.** This plan touches neither its `data-th` reads nor its column guards.
- The comment and documentation spelling sweep is **out of scope**. It runs after this feature ships.

## Verification commands

Every task ends with the checks that apply to it. These are the three.

```bash
# JS: node --check treats a bare .js as CommonJS, so copy to .mjs first.
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done

# PHP
php -l api.php && php api.php --selftest && php shots-test.php

# Every file still serves. Check the type, not the status: Herd answers a missing file with
# index.html and a 200, so a typo passes a status check and fails in the browser.
for f in js/*.js css/*.css; do
  curl -sk -o /dev/null -w "%{content_type} $f\n" "https://flood-exp.test/$f"; done | grep -v 'javascript\|css'
```

## File structure

| file | change |
|---|---|
| `api.php` | `placeQuery()`, the `?place=` endpoint, four constants, `box` in the payload, selftest cases |
| `js/config.js` | `NEAR_MAX_KM` |
| `js/util.js` | `favIds()`, `isFav()` |
| `js/ui.js` | site rows, sub-rows, favorites group, place row and states, favorites panel wiring, favorites chip |
| `js/popup.js` | `nearPopup()`, `placePopup()`, `data-sensor` anchors, the mast star, the star in the info menu |
| `js/map.js` | `favLayer`, the `syncCluster()` split, `showPlace()` |
| `js/render.js` | the pin star, the `favOnly` filter, `favPanel()`, the `#shown` line |
| `js/alerts.js` | favorite rows sort first |
| `index.html` | the favorites drawer panel, the favorites chip, the About privacy sentence, `?v=` bumps |
| `css/icons.css` | `star` and `place` masks |
| `css/base.css` | search row shape, sub-rows, the mast star, the favorites panel |
| `css/map.css` | the pin star, the place pin, the sensor flash |
| `docs/FEATURES.md` | the feature, the trade-offs, the alert-standard non-change |
| `.gitignore` | `.place.stamp` |
| `CLAUDE.md` | two new gotchas |

---

# Stage 1 — The search box lists places

## Task 1: One row per site

The box lists one row per sensor. The map draws one pin per site. A six-sensor mast is six rows and
one pin, and the two surfaces disagree about what a result is.

**Files:**
- Modify: `js/ui.js:470-583` (the whole "go to" block)
- Modify: `css/base.css:246-260` (the `.picklist` row)
- Modify: `index.html:31-35` (the `?v=` bump)

**Interfaces:**
- Consumes: `leads` and `isFav` from `js/util.js`, `KINDS` and `MAST` from `js/config.js`.
- Produces: `hits` becomes an array of **row objects**, not stations. Row shapes used by every later
  task in this plan:
  - `{ t: 'site', key, ms, g, sub }` — `ms` is the site's sensors, sorted by `leads`
  - `{ t: 'near', g }` — the "Nearest station to me" row
  - `{ t: 'sensor', s, key, g }` — Task 2
  - `{ t: 'ask', g }`, `{ t: 'place', p, g, sub }`, `{ t: 'msg', text, g }` — Task 13
  - `g` is the group heading the row sits under. `sub` is an optional muted second line.

**Design note.** The spec says a row shows "the district and the state below it". The list already
groups its rows under a `state · district` heading. Printing the district on every row therefore
repeats the heading directly above it. So the row carries `sub` and prints it **only where the
heading is not a district**. That is the favorites group in Task 6 and the places group in Task 13.
This is one optional element, not a second row shape.

- [ ] **Step 1: Add the two imports `js/ui.js` needs**

In `js/ui.js`, change line 3 and line 5. `MAST` names the mast glyph and color, and `leads` picks
the sensor that speaks for a site:

```js
import { KINDS, MAST, camSrc, FEED, STATIC } from './config.js';
import { state, PREFS, PREFS_KEY, save } from './state.js';
import { el, distKm, dkey, ignoredIds, leads } from './util.js';
```

`isFav` arrives in Task 4. Nothing in this task uses it.

- [ ] **Step 2: Replace `search()`, `group()` and `draw()`**

In `js/ui.js`, replace everything from `function search() {` (line 524) down to the end of `draw()`
(line 553) with this:

```js
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

function search() {
  const terms = termsOf(gotoIn.value);
  const sites = sitesOf(state.data.filter(s => s.name && s.lat));
  // No cap: an empty box lists all ~417 sites, which is what a select does. Rendering them is a few
  // milliseconds per keystroke, and virtualising a list nobody scrolls to the end of is not worth it.
  hits = [...sites.entries()]
    .filter(([, ms]) => !terms.length || matches(siteHay(ms), terms))
    // Heading first: a group is only a group if its rows are adjacent.
    .sort(([, a], [, b]) =>
      group(a[0]).localeCompare(group(b[0])) || a[0].name.localeCompare(b[0].name))
    .map(([key, ms]) => ({ t: 'site', key, ms, g: group(ms[0]), sub: '' }));

  if (state.hereAt && (!terms.length || matches(squash('nearest station to me'), terms)))
    hits.unshift({ t: 'near', g: 'Your location' });
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
  if (r.t === 'near') return `<li role="option" data-i="${i}"${cls}
      ><i class="glyph i i-my_location" style="color:var(--accent)"></i
      ><span class="nm">${NEAREST.name}</span></li>`;

  const lead = r.ms[0], n = r.ms.length;
  const icon = n > 1 ? MAST.icon : KINDS[lead.kind].icon;
  const tint = n > 1 ? MAST.color : KINDS[lead.kind].color;
  return `<li role="option" data-i="${i}"${cls}
      ><i class="glyph i i-${icon}" style="color:${tint}"></i
      ><span class="nm">${lead.name}${
        r.sub ? `<br><small class="muted">${r.sub}</small>` : ''}</span>${
      n > 1 ? `<b class="sn"><i class="i i-layers"></i>${n}</b>` : ''}</li>`;
}
```

- [ ] **Step 3: Replace `pick()`**

Replace `pick()` (line 555) with this:

```js
function pick(i) {
  const r = hits[i];
  if (!r) return;
  const t = r.t === 'near' ? nearest() : r.ms[0];
  if (!t) return;
  gotoIn.blur();
  setFind(false);   // the search is over — collapse it back to the button and give the bar its room
  flashTo(t);
}
```

- [ ] **Step 4: Give the row its two-line shape in CSS**

In `css/base.css`, after the `.picklist b` rule (line 260), add:

```css
/* The go-to list rows carry a name and sometimes a muted second line, so the name needs a column of
   its own rather than sitting as a bare text node beside the glyph. */
.picklist .nm { flex: 1; min-width: 0; line-height: 1.35; overflow: hidden; }
.picklist .nm small { font-size: 11px; }
/* How many sensors this one row stands for. Same `layers` glyph as the mast pin and the site card's
   own count chip, so the row, the pin and the card header all say it the same way. */
.picklist .sn {
  margin-left: auto; display: flex; align-items: center; gap: 3px;
  font: 500 11px Roboto, sans-serif; color: var(--muted); font-variant-numeric: tabular-nums;
}
.picklist .sn .i { font-size: 13px; }
```

- [ ] **Step 5: Bump the stylesheet version**

In `index.html` line 33, change `css/base.css?v=81` to `css/base.css?v=82`.

- [ ] **Step 6: Syntax-check the modules**

Run:

```bash
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
```

Expected: no output. Any `FAIL` line is a parse error to fix before continuing.

- [ ] **Step 7: Look at the page**

Hard-reload `https://flood-exp.test` with Ctrl+Shift+R. Open the search box.

Check all four:
1. The list is shorter than it was. It holds about 417 rows, not about 680.
2. A mast shows one row with a `layers` glyph and a count on the right.
3. A single-sensor station shows its own kind glyph and no count.
4. Picking any row opens that place's card, as it did before.

- [ ] **Step 8: Commit**

```bash
git add js/ui.js css/base.css index.html
git commit -m "Search box lists one row per site, matching the map"
```

---

## Task 2: Sensor sub-rows

A mast row now hides which sensors stand there. Give it a chevron that lists them.

**Files:**
- Modify: `js/ui.js` (the "go to" block from Task 1)
- Modify: `css/base.css`
- Modify: `index.html` (the `?v=` bump)

**Interfaces:**
- Consumes: the row shapes from Task 1.
- Produces: `expanded`, a `Set` of open site keys, private to `js/ui.js`. Row shape
  `{ t: 'sensor', s, key, g }`.

- [ ] **Step 1: Add the open-row set and splice sub-rows into `search()`**

In `js/ui.js`, above `function search()`, add:

```js
/* Which mast rows are open. Cleared whenever the query changes: a tree left half-open under a list
   that has been replaced is furniture with nothing under it. A favorites row and a district row for
   one mast share a key, so opening either opens both — which is right, because they are one place
   listed twice. */
const expanded = new Set();
```

Then inside `search()`, replace the single `.map(...)` that builds the site rows with a loop that
also emits the sub-rows. Replace this:

```js
    .map(([key, ms]) => ({ t: 'site', key, ms, g: group(ms[0]), sub: '' }));
```

with this:

```js
    .flatMap(([key, ms]) => rowsFor(key, ms, group(ms[0]), ''));
```

And add `rowsFor()` above `search()`:

```js
/* A site row, and its sensors under it when the row is open. One function, so the favorites group
   and the district groups cannot grow two different ideas of what an expanded mast looks like.
   A sensor row carries `lead`, the mast's own name, because a sensor named the same as its mast has
   nothing to add by repeating it. */
function rowsFor(key, ms, g, sub) {
  const out = [{ t: 'site', key, ms, g, sub }];
  if (ms.length > 1 && expanded.has(key))
    for (const s of ms) out.push({ t: 'sensor', s, key, g, lead: ms[0].name });
  return out;
}
```

- [ ] **Step 2: Draw the chevron and the sub-row**

In `rowHtml()`, replace the `n > 1 ? ...` count expression at the end with the count plus a chevron,
and add a branch for the sensor row. The whole function becomes:

```js
function rowHtml(r, i) {
  const cls = i === sel ? ' class="sel" aria-selected="true"' : '';
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
      }</span></li>`;
  }

  const lead = r.ms[0], n = r.ms.length;
  const icon = n > 1 ? MAST.icon : KINDS[lead.kind].icon;
  const tint = n > 1 ? MAST.color : KINDS[lead.kind].color;
  const open = expanded.has(r.key);
  return `<li role="option" data-i="${i}"${cls}
      ><i class="glyph i i-${icon}" style="color:${tint}"></i
      ><span class="nm">${lead.name}${
        r.sub ? `<br><small class="muted">${r.sub}</small>` : ''}</span>${
      n > 1 ? `<b class="sn"><i class="i i-layers"></i>${n}</b>
        <button class="xp${open ? ' on' : ''}" data-x="${r.key}" tabindex="-1"
                aria-label="${open ? 'Hide' : 'Show'} the sensors at ${lead.name}"
          ><i class="i i-expand_more"></i></button>` : ''}</li>`;
}
```

A sensor row has no `ms`, which is why it reads `r.lead` rather than reaching into the site's member
list. `rowsFor()` in Step 1 puts that name on the row.

- [ ] **Step 3: Toggle on click**

Replace `gotoHits.onmousedown` (line 579) with:

```js
gotoHits.onmousedown = e => {
  /* Keep focus in the field. `gotoIn.onblur` closes the whole control after 150 ms, so a click that
     is meant to leave the list open has to stop the blur before it starts. pick() closes the box
     itself when it means to. */
  e.preventDefault();
  const x = e.target.closest('[data-x]');
  if (x) {
    const k = x.dataset.x;
    expanded.has(k) ? expanded.delete(k) : expanded.add(k);
    return search();
  }
  const li = e.target.closest('[data-i]');
  if (li) pick(+li.dataset.i);
};
```

- [ ] **Step 4: Toggle from the keyboard**

In `gotoIn.onkeydown` (line 569), add the two arrow keys before the existing `else return;`:

```js
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
    e.key === 'ArrowRight' ? expanded.add(r.key) : expanded.delete(r.key);
    e.preventDefault();
    return search();
  }
  else return;
  e.preventDefault();
  draw();
  gotoHits.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
};
```

- [ ] **Step 5: Clear the open rows when the query changes**

Replace `gotoIn.oninput` (line 563) with:

```js
gotoIn.oninput = () => { sel = -1; expanded.clear(); search(); };
```

- [ ] **Step 6: Style the chevron and the sub-row**

In `css/base.css`, after the `.picklist .sn .i` rule from Task 1, add:

```css
/* The chevron that opens a mast. `tabindex="-1"` in the markup keeps it out of the tab order: the
   list is driven by the arrow keys from the field, and a tab stop per mast would be 417 of them. */
.picklist .xp {
  flex: none; display: grid; place-items: center; width: 24px; height: 24px; padding: 0;
  border: 0; background: none; color: var(--muted); cursor: pointer; border-radius: 6px;
}
.picklist .xp:hover { background: var(--hover); color: var(--on-surface); }
.picklist .xp .i { font-size: 18px; transition: transform .15s; }
.picklist .xp.on .i { transform: rotate(180deg); }
/* A sensor inside an open mast. Indented to the depth of the row's own glyph, so the two read as a
   tree rather than as two lists. */
.picklist li.sub { padding-left: 30px; }
```

- [ ] **Step 7: Bump the stylesheet version**

In `index.html` line 33, change `css/base.css?v=82` to `css/base.css?v=83`.

- [ ] **Step 8: Syntax-check the modules**

Run:

```bash
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
```

Expected: no output.

- [ ] **Step 9: Look at the page**

Hard-reload. Open the search box.

Check all five:
1. A mast row shows a chevron. A single-sensor row does not.
2. Clicking the chevron lists the sensors and rotates it. Clicking again closes it.
3. The search box stays open when you click the chevron.
4. With a row selected, `ArrowRight` opens it and `ArrowLeft` closes it.
5. Typing one more character closes every open row.

- [ ] **Step 10: Commit**

```bash
git add js/ui.js css/base.css index.html
git commit -m "Expand a mast row in the search box to its sensors"
```

---

## Task 3: A sub-row jumps to its sensor inside the card

Both row kinds open the same card, because there is one card per site. A sub-row must therefore do
one more thing, or it is a slower way to press the row above it.

**Files:**
- Modify: `js/popup.js:404` (the `.sensor` blocks in `sitePopup()`)
- Modify: `js/ui.js` (`pick()`)
- Modify: `css/map.css`
- Modify: `index.html` (the `?v=` bump)

**Interfaces:**
- Consumes: the `{ t: 'sensor', s }` row from Task 2.
- Produces: every `.sensor` block in a site card carries `data-sensor="<station id>"`.

- [ ] **Step 1: Anchor each sensor block**

In `js/popup.js`, inside `sitePopup()`, change the sensor block's opening tag (line 404) from:

```js
    ${camFirst(members).map(m => `<div class="sensor">
```

to:

```js
    ${camFirst(members).map(m => `<div class="sensor" data-sensor="${m.id}">
```

- [ ] **Step 2: Scroll and flash from `pick()`**

In `js/ui.js`, replace `pick()` with:

```js
function pick(i) {
  const r = hits[i];
  if (!r) return;
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
```

- [ ] **Step 3: Style the flash**

In `css/map.css`, at the end of the file, add:

```css
/* The sensor a search sub-row asked for. It fades rather than staying marked, because the card is
   rebuilt in place on every poll and a permanent mark would outlive the question that set it. */
#sideBody .sensor.flash { animation: sflash 1.6s ease-out; }
@keyframes sflash {
  from { background: color-mix(in srgb, var(--accent) 26%, transparent); }
  to   { background: transparent; }
}
```

- [ ] **Step 4: Bump the stylesheet version**

In `index.html` line 35, change `css/map.css?v=91` to `css/map.css?v=92`.

- [ ] **Step 5: Syntax-check the modules**

Run:

```bash
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
```

Expected: no output.

- [ ] **Step 6: Look at the page**

Hard-reload. Search for a mast with several sensors, open it, and pick a sensor low in the list.

Check all three:
1. The card opens and that sensor's block is in view.
2. The block flashes once and fades.
3. Waiting for a poll does not scroll the card back to the top.

- [ ] **Step 7: Record the feature**

Append to `docs/FEATURES.md`, under a new heading `## Search by place`:

```markdown
### The go-to box lists places, not sensors

The box listed one row per sensor and the map draws one pin per site, so a six-sensor mast was six
rows and one pin. A reader comparing the two had no way to tell that was one place. The box now
groups on `s.site || s.id`, the same key `render()` groups on, and names the row with the same
`leads()` call that names the pin. About 417 rows, down from about 680.

A mast row carries a chevron that lists its sensors. Both a mast row and a sensor row open the same
card, because there is one card per site. A sensor row additionally scrolls that sensor's block into
view and flashes it, anchored on a `data-sensor` attribute in `sitePopup()`.

**Trade-off accepted.** Every keystroke closes the open rows. A tree that stays half-open under a
list the next keystroke replaces points at rows that are no longer there.

**Not built.** A card per sensor. There is one card per site by design, and the site card already
shows every reading of every sensor there.
```

- [ ] **Step 8: Commit**

```bash
git add js/popup.js js/ui.js css/map.css index.html docs/FEATURES.md
git commit -m "A search sub-row marks its sensor inside the station card"
```

---

# Stage 2 — Favorites

## Task 4: Store favorites and add the two controls

**Files:**
- Modify: `js/util.js` (after `isIgnored`, line 22)
- Modify: `js/ui.js` (`setIgnored`, and a new `setFavs` and click handler)
- Modify: `js/popup.js` (`dots()`, and the mast header in `sitePopup()`)
- Modify: `css/icons.css` (the `star` mask)
- Modify: `css/base.css` (the mast star button)
- Modify: `index.html` (the `?v=` bumps, the reset confirm text)

**Interfaces:**
- Produces: `favIds(): Set<string>` and `isFav(station): boolean` from `js/util.js`.
  `PREFS.favs` is an array of station ids. `[data-fav="id[,id…]"]` is the one control attribute, and
  a comma-separated list means one mast.

- [ ] **Step 1: Fetch the star icon**

`css/icons.css` holds Material Symbols masks, filled. Fetch the one new glyph:

```bash
curl -s "https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/star/fill1/24px.svg"
```

Take the `d="…"` value out of the `<path>` in the response.

- [ ] **Step 2: Add the mask**

In `css/icons.css`, add the variable in the `:root` block, in alphabetical order beside
`--i-search` (line 61), replacing `PASTE_PATH_HERE` with the `d` value from Step 1:

```css
  --i-star: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 -960 960 960'><path d='PASTE_PATH_HERE'/></svg>");
```

And the class, beside `.i-search` (line 118):

```css
.i-star { --i: var(--i-star); }
```

**There is one star, not two.** The whole set uses `fill=1`, so an outline star breaks that rule for
one glyph. A sensor that is not a favorite draws the same star in `var(--muted)` instead. Color
carries the state, which is what every other control here does.

- [ ] **Step 3: Add the two helpers to `js/util.js`**

In `js/util.js`, after `isIgnored` (line 22), add:

```js
/* Sensors the reader has starred, by station id. The mirror of `ignoredIds()` above, stored the same
   way and for the same reason: an id that drops out of the payload for one poll must not be
   forgotten, because the feeds add and drop stations all the time.
 *
 * A sensor is never in both lists. `setFavs()` and `setIgnored()` in ui.js each drop the id from the
 * other, because "show me this first" and "never show me this" is not a state a person meant to be
 * in — and if the code picked a winner at read time, one of the two controls would silently do
 * nothing.
 *
 * Favorites are **not** an alarm control. They order lists and they filter the map. They suppress
 * nothing. `PREFS.ignored` stays the one suppression control in this app. */
export const favIds = () => new Set(PREFS.favs || []);
export const isFav = s => (PREFS.favs || []).includes(s.id);
```

- [ ] **Step 4: Import the two helpers into `js/ui.js`**

Change the `util.js` import on line 5 to:

```js
import { el, distKm, dkey, ignoredIds, leads, favIds, isFav } from './util.js';
```

- [ ] **Step 5: Make the two lists exclusive, and add `setFavs()`**

In `js/ui.js`, replace `setIgnored()` (line 404) with the pair:

```js
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
```

- [ ] **Step 6: Wire the one delegated handler**

In `js/ui.js`, after the existing `[data-ignore]` listener (line 420), add:

```js
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
  setFavs(ids);
});
```

The card is **not** closed here, unlike the ignore handler. Ignoring takes the sensor off the map, so
the card it fills is describing something that is gone. Starring changes nothing about what is on
screen, and closing the card would look like an error.

- [ ] **Step 7: Add the menu item**

In `js/popup.js`, add `isFav` to the `util.js` import at the top of the file. Then replace `dots()`
(line 84) with:

```js
export const dots = s => `<button class="icon dots" popovertarget="mnu-${s.id}"
    title="Details" aria-label="Details and actions for ${s.name}"><i class="i i-info"></i></button>
  <div id="mnu-${s.id}" class="menu surface" popover>
    ${sourceInfo(s)}
    <button class="mi" data-fav="${s.id}"
      ><i class="i i-star" style="color:${isFav(s) ? 'var(--accent)' : 'var(--muted)'}"></i>
      <span>${isFav(s) ? 'Remove from favorites' : 'Favorite this sensor'}<br><small class="muted">${
        isFav(s) ? 'stops listing it first'
                 : 'lists it first in the search box and the alert panel'}</small></span>
    </button>
    <button class="mi" data-ignore="${s.id}"><i class="i i-visibility_off"></i>
      <span>Ignore this sensor<br><small class="muted">hides it and stops it alerting you</small></span>
    </button>
  </div>`;
```

- [ ] **Step 8: Add the mast star**

In `js/popup.js`, inside `sitePopup()`, add two constants after `const hasCam = …` (line 383):

```js
  /* Filled only when every sensor here is starred, because this button acts on all of them and has
     to state exactly what one press will undo. The pin on the map uses the opposite rule — any
     sensor starred draws a star — because that badge is an indication and not a control. */
  const favAll = members.every(isFav);
  const favIdList = members.map(m => m.id).join(',');
```

Then add the button as the first child of the `.badges` row (line 397):

```js
      <div class="badges"><button class="favbtn${favAll ? ' on' : ''}" data-fav="${favIdList}"
          aria-pressed="${favAll}"
          title="${favAll ? 'Remove every sensor here from favorites'
                          : 'Favorite every sensor at this mast'}"
        ><i class="i i-star"></i></button>${members.map(m => {
```

Leave the rest of the `.badges` expression as it is.

- [ ] **Step 9: Style the mast star**

In `css/base.css`, after the `#ignoredList .solo` rule (line 338), add:

```css
/* The mast's star. It rides in the badge row rather than beside the close button, because the three
   numbers that put the place name on that line move together and a second chip up there would be a
   fourth. Accent, not a status hue and not a sensor kind — a favorite is neither. */
.favbtn {
  flex: none; display: grid; place-items: center; width: 28px; height: 28px; padding: 0;
  border: 1px solid var(--outline); border-radius: 999px; cursor: pointer;
  background: none; color: var(--muted);
}
.favbtn:hover { background: var(--hover); color: var(--on-surface); }
.favbtn.on { color: var(--accent); border-color: var(--accent); }
.favbtn .i { font-size: 17px; }
```

- [ ] **Step 10: Name favorites in the reset warning**

In `js/ui.js`, in `el('devReset').onclick` (line 116), change the confirm text to name the new list:

```js
  if (!confirm('Reset every setting to its default? This clears the theme, the district filter, '
      + 'the layer chips, the heatmap, the favorites and the ignored sensors.\n\n'
      + 'This cannot be undone.')) return;
```

- [ ] **Step 11: Bump the stylesheet versions**

In `index.html`, change `css/icons.css?v=66` to `?v=67` and `css/base.css?v=83` to `?v=84`.

- [ ] **Step 12: Syntax-check the modules**

Run:

```bash
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
```

Expected: no output.

- [ ] **Step 13: Look at the page**

Hard-reload. Open a mast with several sensors.

Check all six:
1. The star in the header is grey with an outline ring.
2. Pressing it turns it accent-colored, and every sensor's ⓘ menu now reads `Remove from favorites`.
3. Pressing it again clears all of them.
4. Starring one sensor from its ⓘ menu leaves the mast star grey.
5. Ignoring a starred sensor removes it from the favorites — check `localStorage.prefs` in the
   console and confirm the id is in `ignored` and not in `favs`.
6. Starring a sensor does **not** close the card.

- [ ] **Step 14: Commit**

```bash
git add js/util.js js/ui.js js/popup.js css/icons.css css/base.css index.html
git commit -m "Star a sensor or a whole mast as a favorite"
```

---

## Task 5: The favorites drawer panel

A saved list with no panel is a setting the reader cannot review or undo.

**Files:**
- Modify: `index.html:645` (a new `<details>` before `#ignored`)
- Modify: `js/render.js` (a new `favPanel()`, called from `render()`)
- Modify: `js/ui.js` (the two click handlers)
- Modify: `css/base.css`

**Interfaces:**
- Consumes: `favIds()` from `js/util.js`, `setFavs()` from `js/ui.js`.
- Produces: `favPanel()` exported from `js/render.js`. Elements `#favList`, `#favN`, `#favClear`.

- [ ] **Step 1: Add the panel markup**

In `index.html`, immediately before the `<details id="ignored" …>` block (line 651), add:

```html
    <!-- Sensors starred from a station card. Listed one row per sensor, not one row per site: the
         search box groups by site because it matches the map, and this panel manages the saved list
         itself, so it has to show every id the list holds. A reader who starred one gauge of six
         needs to see which one. Collapsed by default — the count on the summary is the indication. -->
    <details id="favs" class="sect">
      <summary><i class="i i-star"></i>Favorite sensors<b id="favN"></b></summary>
      <ul id="favList" class="picklist"></ul>
      <div class="rowbtns"><button id="favClear" class="link">Remove all favorites</button></div>
    </details>
```

- [ ] **Step 2: Draw the list**

In `js/render.js`, add `favIds` and `isFav` to the `util.js` import (line 5). Then add `favPanel()`
immediately after `ignoredPanel()` (line 229):

```js
/* The sensors starred from a station card, listed so they can be found and unstarred. One row per
   sensor: this panel manages the saved list, and a list that hid five of a mast's six entries could
   not be used to remove one of them. Row order is the order they were starred in — a short list, and
   "the one I just added" is at the bottom where it was left. */
export function favPanel() {
  const ids = favIds();
  const rows = state.data.filter(s => ids.has(s.id));

  el('favN').textContent = rows.length || '';
  el('favList').innerHTML = rows.map(s => `<li>
      <i class="glyph i i-${KINDS[s.kind].icon}" style="color:${KINDS[s.kind].color}"></i>
      <span class="nm">${s.name}<br><span class="muted">${
        [s.district, s.state].filter(Boolean).join(', ')} · ${
        KINDS[s.kind].one || KINDS[s.kind].label}</span></span>
      <button class="solo" data-unfav="${s.id}"
              aria-label="Remove ${s.name} from favorites">remove</button>
    </li>`).join('')
    || '<li class="none">Nothing starred yet. Use the star on a mast, or the Details button on any '
     + 'sensor in a station’s card.</li>';
  el('favClear').disabled = !rows.length;
}
```

- [ ] **Step 3: Call it from `render()`**

In `js/render.js`, in `render()`, add the call beside `ignoredPanel()` (line 164):

```js
  ignoredPanel();
  favPanel();
```

- [ ] **Step 4: Wire the two controls**

In `js/ui.js`, after `el('ignoredClear').onclick` (line 429), add:

```js
el('favList').onclick = e => {
  const id = e.target.closest('[data-unfav]')?.dataset.unfav;
  if (!id) return;
  const ids = favIds();
  ids.delete(id);
  setFavs(ids);
};
el('favClear').onclick = () => setFavs(new Set());
```

- [ ] **Step 5: Reuse the ignored panel's styles**

In `css/base.css`, change the three `#ignoredList` selectors (lines 333 to 338) to name both lists,
so the two panels cannot drift apart:

```css
#ignoredList, #favList { max-height: 26vh; border: 1px solid var(--outline); border-radius: 8px; }
#ignoredList .nm, #favList .nm { flex: 1; min-width: 0; line-height: 1.35; }
#ignoredList .nm .muted, #favList .nm .muted { font-size: 11px; }
/* Always visible, unlike the district list's "only" — reviewing and undoing the list is the whole
   reason both panels exist, so the control must not be something you hover a row to discover. */
#ignoredList .solo, #favList .solo { visibility: visible; }
```

- [ ] **Step 6: Bump the stylesheet version**

In `index.html`, change `css/base.css?v=84` to `?v=85`.

- [ ] **Step 7: Syntax-check the modules**

Run:

```bash
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
```

Expected: no output.

- [ ] **Step 8: Look at the page**

Hard-reload. Open the drawer.

Check all five:
1. `Favorite sensors` sits above `Ignored sensors` and reads the empty hint.
2. Starring a sensor adds a row and puts a count on the summary.
3. The count is readable with the section collapsed.
4. `remove` on a row clears that one. `Remove all favorites` clears every one.
5. `Remove all favorites` is disabled when the list is empty.

- [ ] **Step 9: Commit**

```bash
git add index.html js/render.js js/ui.js css/base.css
git commit -m "Favorite sensors panel in the drawer"
```

---

## Task 6: Favorites lead the search box

**Files:**
- Modify: `js/ui.js` (`search()` and `rowHtml()`)
- Modify: `css/base.css`
- Modify: `index.html` (the `?v=` bump)

**Interfaces:**
- Consumes: `rowsFor()` and `where()` from Tasks 1 and 2, `isFav` from Task 4.

- [ ] **Step 1: Prepend the group**

In `js/ui.js`, in `search()`, add the favorites block between the `hits = …` assignment and the
`state.hereAt` line:

```js
  /* Favorites lead an untouched box only. Once the reader types, the district headings are the
     answer, and a favorite that matches the query is already listed under its own district —
     printing it twice would put one place in two places in one list.
     A site is here when **any** sensor on it is starred, the same rule the pin badge and the map
     filter use, so all three surfaces answer one question. */
  if (!terms.length) {
    const fav = [...sites.entries()].filter(([, ms]) => ms.some(isFav));
    hits.unshift(...fav.flatMap(([key, ms]) => rowsFor(key, ms, 'FAVORITES', where(ms[0]))));
  }
```

The `state.hereAt` line below it uses `hits.unshift(...)`, which would put "Nearest station to me"
above the favorites. Change that line to insert after the favorites instead:

```js
  if (state.hereAt && (!terms.length || matches(squash('nearest station to me'), terms))) {
    const at = hits.findIndex(r => r.g !== 'FAVORITES');
    hits.splice(at < 0 ? hits.length : at, 0, { t: 'near', g: 'Your location' });
  }
```

- [ ] **Step 2: Star the row**

In `rowHtml()`, in the site branch, add the star before the count. Replace the `return` expression's
last two lines with:

```js
  return `<li role="option" data-i="${i}"${cls}
      ><i class="glyph i i-${icon}" style="color:${tint}"></i
      ><span class="nm">${lead.name}${
        r.sub ? `<br><small class="muted">${r.sub}</small>` : ''}</span>${
      r.ms.some(isFav) ? '<i class="i i-star fvm" role="img" aria-label="Favorite"></i>' : ''}${
      n > 1 ? `<b class="sn"><i class="i i-layers"></i>${n}</b>
        <button class="xp${open ? ' on' : ''}" data-x="${r.key}" tabindex="-1"
                aria-label="${open ? 'Hide' : 'Show'} the sensors at ${lead.name}"
          ><i class="i i-expand_more"></i></button>` : ''}</li>`;
```

And in the sensor branch, add the same mark after the `.nm` span:

```js
      ><span class="nm">${k.one || k.label}${
        r.s.name !== r.lead ? `<br><small class="muted">${r.s.name}</small>` : ''
      }</span>${isFav(r.s) ? '<i class="i i-star fvm" role="img" aria-label="Favorite"></i>' : ''}</li>`;
```

- [ ] **Step 3: Style the mark**

In `css/base.css`, after the `.picklist li.sub` rule from Task 2, add:

```css
/* The star on a row. Accent, because a favorite is neither a status nor a sensor kind. It sits
   before the sensor count so the two never trade places as a mast gains or loses sensors. */
.picklist .fvm { flex: none; margin-left: auto; font-size: 15px; color: var(--accent); }
.picklist .fvm + .sn { margin-left: 6px; }
```

- [ ] **Step 4: Bump the stylesheet version**

In `index.html`, change `css/base.css?v=85` to `?v=86`.

- [ ] **Step 5: Syntax-check the modules**

Run:

```bash
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
```

Expected: no output.

- [ ] **Step 6: Look at the page**

Hard-reload. Star two stations in different districts. Open the search box without typing.

Check all four:
1. A `FAVORITES` heading leads the list, holding both.
2. Each favorite row prints its district and state under the name, because the heading does not.
3. `Your location` sits under the favorites, above the district groups.
4. Typing one character removes the favorites group, and the starred stations still carry a star in
   their own district group.

- [ ] **Step 7: Commit**

```bash
git add js/ui.js css/base.css index.html
git commit -m "Favorites lead the search box"
```

---

## Task 7: Star the pin, and keep it out of the cluster

**Files:**
- Modify: `js/render.js:96-142` (the marker)
- Modify: `js/map.js:82-87` (`syncCluster`)
- Modify: `css/map.css`
- Modify: `index.html` (the `?v=` bump)

**Interfaces:**
- Consumes: `isFav` from `js/util.js`.
- Produces: `marker.options.fav`, a boolean read by `syncCluster()`. `favLayer`, an
  `L.LayerGroup` exported from `js/map.js`.

- [ ] **Step 1: Mark the marker**

In `js/render.js`, inside the `for (const [key, members] of sites)` loop, add after
`const quiet = …` (line 105):

```js
    /* A star on the pin when **any** sensor here is starred — not when all of them are, which is the
       mast header button's rule. The two answer different questions. The button is a control and
       acts on every sensor at the mast, so it has to state exactly what one press will undo. This is
       an indication, and it says "something you starred is here". A mast where the reader starred
       only the river must still be findable at a glance. */
    const fav = members.some(isFav);
```

Add `fav` to the marker's options (line 113):

```js
      kind: lead.kind, critical, fav,                     // read back by the cluster badge and the split
```

Add the badge to the icon html (line 121). Replace the `html:` line with:

```js
        html: `<span class="pin${multi ? ' multi' : ''}${lead.online ? '' : ' off'}${
                     rising ? ' rise' : ''}${critical ? ' danger' : ''}" style="--c:${c}"><i class="i i-${
               multi ? MAST.icon : KINDS[lead.kind].icon}"></i>${
               multi ? `<b class="n">${members.length}</b>` : ''}${
               fav ? '<b class="fv"><i class="i i-star"></i></b>' : ''}</span>`,
```

- [ ] **Step 2: Split the cluster**

In `js/map.js`, replace `syncCluster()` (line 82) with:

```js
/* Favorites never cluster. A star swallowed by a chip is a star that did not work, and finding your
   own stations at a glance is the whole point of setting one. markercluster has no per-marker opt
   out, so they go on a plain layer group beside it. The split lives here because this function
   already walks `marks` and already gates on `shown(k)`, and layer visibility must stay in one
   place. */
export const favLayer = L.layerGroup().addTo(map);

export function syncCluster(alsoShow) {
  cluster.clearLayers();
  favLayer.clearLayers();
  for (const [k, list] of Object.entries(marks)) {
    if (!(shown(k) || k === alsoShow)) continue;
    cluster.addLayers(list.filter(m => !m.options.fav));
    for (const m of list) if (m.options.fav) favLayer.addLayer(m);
  }
}
```

- [ ] **Step 3: Style the badge**

In `css/map.css`, after the `.pin.multi.danger .n` rule (line 140), add:

```css
/* A starred place. Bottom right, opposite the sensor count at the top right, so a starred six-sensor
   mast shows both marks. `--accent`, because a favorite is neither a status nor a sensor kind and
   must take neither color language. */
.pin .fv {
  position: absolute; bottom: -3px; right: -3px; width: 18px; height: 18px;
  display: grid; place-items: center; border-radius: 999px; font-size: 12px;
  color: var(--surface); background: var(--accent); box-shadow: 0 0 0 2px var(--surface);
}
```

- [ ] **Step 4: Bump the stylesheet version**

In `index.html`, change `css/map.css?v=92` to `?v=93`.

- [ ] **Step 5: Syntax-check the modules**

Run:

```bash
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
```

Expected: no output.

- [ ] **Step 6: Look at the page**

Hard-reload. Star a station in a crowded area, then zoom out to the whole state.

Check all four:
1. The starred pin carries a star at its bottom right.
2. It stays a pin at every zoom, while its neighbors collapse into a chip.
3. A starred mast shows both the star and its sensor count.
4. Switching that sensor's layer chip off still removes the pin.

- [ ] **Step 7: Record the cluster gotcha**

Append to the gotcha list in `CLAUDE.md`, after the clustering bullet:

```markdown
- **A cluster badge counts what it is hiding, not what is in the area.** Favorites are drawn on
  `favLayer` in `map.js` and never enter `cluster`, so a chip over a patch holding 13 pins can read
  12. That is the correct number: the chip is hiding 12 pins and the 13th is drawn beside it. The
  same holds for the badge's red — `iconCreateFunction` ORs `m.options.critical` across its children,
  so a chip goes neutral when the only critical pin near it is an unclustered favorite drawing itself
  red. Nothing leaves the screen. Do not "fix" the count by folding the favorites back in; that would
  make the badge claim to hide pins that are visible.
```

- [ ] **Step 8: Commit**

```bash
git add js/render.js js/map.js css/map.css index.html CLAUDE.md
git commit -m "Star a favorited pin and keep it out of the cluster"
```

---

## Task 8: The "Favorites only" map filter

**Files:**
- Modify: `index.html:671-672` (a new chip)
- Modify: `js/render.js` (`syncFavChip()`, the filter, the `#shown` line)
- Modify: `js/ui.js` (the `onchange` chain, the stored preference)

**Interfaces:**
- Produces: `PREFS.favOnly`, a boolean. Elements `#favOnly` and `#favHint`.

- [ ] **Step 1: Add the chip**

In `index.html`, immediately after the `risingOnly` chip (line 672), add:

```html
      <!-- A view filter, like the district picker and unlike the ignored list: it hides pins and
           changes no alert. The two indications that it is on are the drawer panel above and the
           `· favorites only` note in #shown below, which is the same pair the ignored list uses. It
           needs no standing pill the way the rising filter does, because that one is a lone checkbox
           with no list under it saying what it took away, and this one has exactly that list. -->
      <label class="chip"><input type="checkbox" id="favOnly">
        <i class="glyph i i-star"></i>Favorites only <span id="favHint" class="hint"></span></label>
```

- [ ] **Step 2: Sync and gate the chip**

In `js/render.js`, add after `syncRisingChip()` (line 30):

```js
/* A filter that empties the map and cannot be reasoned about reads as a bug, so the chip is dead
   while nothing is starred and says why. It also un-checks itself in that state, or a reader who
   cleared their favorites would come back to a blank map and a control they could not press. */
function syncFavChip() {
  const chip = el('favOnly');
  const n = state.data.filter(isFav).length;
  chip.disabled = !n;
  el('favHint').textContent = n ? '' : 'none starred';
  if (!n) chip.checked = false;
  return chip.checked;
}
```

- [ ] **Step 3: Apply the filter**

In `js/render.js`, in `render()`, add the call beside the rising one (line 34):

```js
  const risingOnly = syncRisingChip();
  const favOnly = syncFavChip();
```

And add the test inside the `if (!pinned) {` block, after the rising test (line 56):

```js
      if (risingOnly && !s.rising) continue;
      if (favOnly && !isFav(s)) continue;
```

`render()` builds sites after this filter, so a partly starred mast draws a pin holding only its
starred sensors. The district and layer filters already behave this way.

- [ ] **Step 4: Say so on the count line**

In `js/render.js`, in `counts()`, change the `#shown` assignment (line 252):

```js
  el('shown').textContent = `${total} of ${state.data.length} stations on the map` +
    (pins && pins < total ? ` · ${pins} pins` : '') +
    (el('favOnly').checked ? ' · favorites only' : '') +
    (nIgn ? ` · ${nIgn} ignored` : '');
```

- [ ] **Step 5: Restore and persist the preference**

In `js/ui.js`, after `el('risingOnly').checked = !!PREFS.risingOnly;` (line 316), add:

```js
el('favOnly').checked = !!PREFS.favOnly;
```

Change the `onchange` chain (line 340) to include the new chip:

```js
el('heat').onchange = el('rainHeat').onchange = el('risingOnly').onchange =
  el('favOnly').onchange = e => {
```

Add the preference inside that handler, beside the rising one (line 351):

```js
  PREFS.risingOnly = el('risingOnly').checked;
  PREFS.favOnly = el('favOnly').checked;
```

And change the closing call (line 356) so both filters close the drawer on a phone:

```js
  // Both heatmaps are display options, not filters — only the two pin filters close the drawer.
  applyFilter(e.target === el('risingOnly') || e.target === el('favOnly'));
```

- [ ] **Step 6: Syntax-check the modules**

Run:

```bash
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
```

Expected: no output.

- [ ] **Step 7: Look at the page**

Hard-reload. Open the drawer.

Check all five:
1. With nothing starred, the chip is disabled and reads `none starred`.
2. Star two stations. The chip becomes usable.
3. Turning it on leaves only those pins, and `#shown` says `· favorites only`.
4. Reloading keeps the chip on.
5. Clearing every favorite disables the chip, un-checks it, and brings the map back.

- [ ] **Step 8: Commit**

```bash
git add index.html js/render.js js/ui.js
git commit -m "Favorites only map filter"
```

---

## Task 9: Favorites sort first in the alert panel

This is the only alert surface this plan touches, and it moves order only.

**Files:**
- Modify: `js/alerts.js:66-99` (`groupCard`)
- Modify: `css/base.css`
- Modify: `index.html` (the `?v=` bump)
- Modify: `docs/FEATURES.md`

**Interfaces:**
- Consumes: `isFav` from `js/util.js`.

- [ ] **Step 1: Build the set of starred sites**

In `js/alerts.js`, add `isFav` to the `util.js` import (line 7). Then add after `siteSize()`
(line 35):

```js
/* Which places hold something starred. Keyed on `site`, and true when **any** sensor there is
   starred — the same rule the pin badge and the search group use, so a reader who starred the camera
   at a mast still sees that mast lifted when the river beside it goes over its mark. */
const favSites = () => {
  const k = new Set();
  for (const s of state.data) if (isFav(s)) k.add(s.site || s.id);
  return k;
};
```

- [ ] **Step 2: Sort and mark**

In `groupCard()`, add the set beside `siteSize()` (line 67):

```js
  const size = siteSize();
  const fav = favSites();
```

Replace the `rows` sort (line 78):

```js
  /* Starred places first. Order only: the set of rows, the counts above them, the icon badge, the
     ticker and the toast are all unchanged, and `isHot()` is untouched. Widening what alerts is an
     alert-design decision and goes through the standard in docs/FEATURES.md. This is not that. */
  const rows = [...places.values()].sort((a, b) =>
    (fav.has(b.lead.site || b.lead.id) - fav.has(a.lead.site || a.lead.id))
    || (hereAt
      ? distKm(hereAt, a.lead) - distKm(hereAt, b.lead)
      : (b.lead.ratio || 0) - (a.lead.ratio || 0)));
```

Add the mark to the row, after the kind glyph (line 89):

```js
        <i class="i i-${(size.get(s.site || s.id) || 1) > 1 ? 'layers' : k.icon}"></i>
        ${fav.has(s.site || s.id)
          ? '<i class="i i-star fvm" role="img" aria-label="Favorite"></i>' : ''}
```

- [ ] **Step 3: Style the mark**

In `css/base.css`, beside the `.picklist .fvm` rule from Task 6, add:

```css
.slist .fvm { flex: none; font-size: 14px; color: var(--accent); }
```

- [ ] **Step 4: Bump the stylesheet version**

In `index.html`, change `css/base.css?v=86` to `?v=87`.

- [ ] **Step 5: Syntax-check the modules**

Run:

```bash
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
```

Expected: no output.

- [ ] **Step 6: Look at the page with test mode**

Hard-reload. Open About, turn on test mode, and star one of the stations the fake flood raises.

Check all four:
1. That row sits at the top of its card, with a star.
2. The count on the app bar's warning glyph is the same number it was before you starred anything.
3. The ticker lists the same stations in the same order.
4. Turn test mode off again.

- [ ] **Step 7: Record the feature and the alert-standard note**

Append to `docs/FEATURES.md`, under a new heading `## Favorites`:

```markdown
### Favorites

`PREFS.favs` is an array of station ids, the mirror of `PREFS.ignored` and stored in the same blob.
A star on a sensor's ⓘ menu adds one. A star on a mast header adds every sensor there, and reads
filled only when every one of them is starred, because that button acts on all of them and has to
state what one press will undo.

A sensor is never in both lists. Favoriting drops the id from `ignored` and ignoring drops it from
`favs`, because "show me this first" and "never show me this" is not a state a person meant to be in.

Four surfaces: a `FAVORITES` group leading an untouched search box, a drawer panel that mirrors
Ignored sensors, a `Favorites only` map filter, and favorites-first ordering inside each alert panel
card. On the map a pin carries a star when **any** sensor at that site is starred, and it is drawn
outside the cluster so a chip cannot swallow it.

**Alert-standard note.** The alert panel's ordering is the only alert surface this touches, and it
moves order only. The set of alerts does not change, nothing is suppressed, no count moves, and the
icon badge, the ticker and the toast are untouched. `isHot()` keeps its current definition. Favorites
are not an alarm control.

**Not built.** Favorites as an alert scope, which would suppress alerts elsewhere. A flood two
districts away that a reader muted is the failure ISA-18.2 spends a chapter on. `PREFS.ignored` stays
the one suppression control in this app.

**Not built.** A favorites map layer or a color of its own. A favorite is neither a status nor a
sensor kind, so it takes neither color language and the star is the whole indication.

**Trade-off accepted.** At low zoom a large favorites list is loose pins overlapping each other and
the clusters. That is the request: a favorite that clustering can swallow is a favorite the reader
cannot find.
```

- [ ] **Step 8: Commit**

```bash
git add js/alerts.js css/base.css index.html docs/FEATURES.md
git commit -m "Favorites sort first in the alert panel"
```

---

# Stage 3 — The place endpoint

## Task 10: `placeQuery()` and its offline checks

This is the one task in the plan with a real test cycle. `php api.php --selftest` is the project's
own harness, and the validator is arithmetic on a string, so it runs offline in milliseconds.

**Files:**
- Modify: `api.php:57-64` (four new constants)
- Modify: `api.php:265-267` (the new function, beside `serveFromCache()`)
- Modify: `api.php:294-300` (the selftest block)

**Interfaces:**
- Produces: `placeQuery(string $raw): ?string`. Returns the normalized query, or `null` when it is
  unusable. Constants `PLACE_EVERY`, `PLACE_STAMP`, `PLACE_TTL`, `NOMINATIM` and `BOX`.

- [ ] **Step 1: Write the failing checks**

In `api.php`, inside the `--selftest` block, after the last `serveFromCache()` line (line 298), add:

```php
    echo "\nplaceQuery():\n";
    $ok('a plain query normalizes',    placeQuery('Bandar Utama') === 'bandar utama');
    $ok('runs of space collapse',      placeQuery("  kg.   sg   lui \n") === 'kg. sg lui');
    $ok('one character is refused',    placeQuery('a') === null);
    $ok('two characters are allowed',  placeQuery('pj') === 'pj');
    $ok('whitespace only is refused',  placeQuery("   \t ") === null);
    $ok('80 characters are allowed',   placeQuery(str_repeat('a', 80)) === str_repeat('a', 80));
    $ok('81 characters are refused',   placeQuery(str_repeat('a', 81)) === null);

    /* The place lookup reuses forceAllowed(): it is the same arithmetic on the same two integers,
       with its own stamp file and its own window. A second copy would be a second thing to get
       wrong. */
    echo "\nplace rate limit:\n";
    $ok('a lookup one second later is allowed',
        forceAllowed($now, $now - 1, PLACE_EVERY)[0] === true);
    $ok('a second lookup in one second is refused',
        forceAllowed($now, $now, PLACE_EVERY)[0] === false);
```

- [ ] **Step 2: Run the checks to verify they fail**

Run: `php api.php --selftest`

Expected: a fatal error, `Call to undefined function placeQuery()`. That is the failing state.

- [ ] **Step 3: Add the constants**

In `api.php`, after `const FORCE_STAMP = …` (line 64), add:

```php
/* Place search. One uncached lookup per second, site-wide — Nominatim's usage policy asks for no
   more, and this proxy is a public URL that anyone can call. A cached hit skips the limit, because
   it costs OpenStreetMap nothing. */
const PLACE_EVERY = 1;
const PLACE_STAMP = __DIR__ . '/.place.stamp';
const PLACE_TTL   = 30 * 86400;   // place names do not move
const NOMINATIM   = 'https://nominatim.openstreetmap.org/search';
/* The coverage box: Selangor, Kuala Lumpur and Putrajaya. The 673 stations in the payload span
   latitude 2.6088 to 3.8470 and longitude 100.8229 to 101.9215, and this adds about 0.1 degrees of
   margin on each side so a place at the edge still resolves. Nominatim reads `viewbox` as
   west,north,east,south. Published in the payload as `box`, so the client can word its own
   out-of-area message from these numbers rather than from a second copy in a JS file. */
const BOX = [100.72, 3.95, 102.02, 2.50];
```

- [ ] **Step 4: Write the function**

In `api.php`, after `serveFromCache()` (line 267) and before the `--selftest` block, add:

```php
/**
 * Normalize and validate a place query. Returns the normalized string, or null when it is unusable.
 *
 * Separate from the endpoint so the self-check can exercise it without a network call, exactly as
 * forceAllowed() and serveFromCache() are. The query never builds a path or a URL — it becomes one
 * query-string parameter to one fixed host — so the `?cam=` rule holds by construction here too.
 *
 * Not the client's squash(): that one strips punctuation to match station names, and `kg.` and `kg`
 * are different queries to a geocoder.
 */
function placeQuery(string $raw): ?string {
    $q = trim(preg_replace('/\s+/u', ' ', $raw));
    $n = mb_strlen($q);
    if ($n < 2 || $n > 80) return null;
    return mb_strtolower($q);
}
```

- [ ] **Step 5: Run the checks to verify they pass**

Run: `php api.php --selftest`

Expected: every line reads `ok`, including the nine new ones, and the command exits 0.

- [ ] **Step 6: Lint**

Run: `php -l api.php`

Expected: `No syntax errors detected in api.php`.

- [ ] **Step 7: Commit**

```bash
git add api.php
git commit -m "placeQuery() and its offline checks"
```

---

## Task 11: The `?place=` endpoint

**Files:**
- Modify: `api.php:140` (the new handler, after the `?cam=` block)
- Modify: `api.php:892-905` (`box` in the payload)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `placeQuery()`, `forceAllowed()`, `fetchAll()`, and the constants from Task 10.
- Produces: `GET api.php?place=<query>` returns
  `{ "places": [ { "name": …, "detail": …, "lat": …, "lon": … } ], "error": null }`.
  Status 400 when the query is unusable, 429 when rate-limited, 502 when upstream fails.
  The main payload gains `box`, an array of four floats.

- [ ] **Step 1: Add the handler**

In `api.php`, immediately after the `?cam=` block's closing brace (line 140) and before the `?shots=`
comment, add:

```php
/* ?place=<query> — turn a place name into a coordinate, inside the coverage area only.
   The browser reaches no third party: this is the same rule every other outbound call here follows,
   and it is what lets the About pane keep its privacy paragraph honest with one added sentence.
   Explicit, never per keystroke. The client only calls this when the reader picks the search row,
   which is what Nominatim's usage policy asks for. */
if (isset($_GET['place'])) {
    header('Content-Type: application/json');
    $q = placeQuery((string)$_GET['place']);
    if ($q === null) {
        http_response_code(400);
        echo json_encode(['places' => [], 'error' => 'query too short']);
        exit;
    }

    /* The `page` table again, not a new store: this is one more slow upstream read with a long life,
       which is exactly what that table holds. Created here as well as in the refresh path below,
       because a place search can be the first thing that ever touches this file. */
    $db = new PDO('sqlite:' . HIST, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $db->exec('PRAGMA journal_mode=WAL');
    $db->exec('CREATE TABLE IF NOT EXISTS page (url TEXT PRIMARY KEY, ts INTEGER, body TEXT) WITHOUT ROWID');

    $key = 'place:' . $q;
    $sel = $db->prepare('SELECT ts, body FROM page WHERE url = ?');
    $sel->execute([$key]);
    $hit = $sel->fetch(PDO::FETCH_ASSOC);
    if ($hit && time() - (int)$hit['ts'] < PLACE_TTL) {
        header('Cache-Control: max-age=600');
        echo $hit['body'];
        exit;
    }

    /* The limit guards the uncached path only. A repeat search costs OpenStreetMap nothing, so
       refusing it would punish the reader for a request that never leaves this box. */
    [$allowed] = forceAllowed(
        time(), is_file(PLACE_STAMP) ? filemtime(PLACE_STAMP) : null, PLACE_EVERY);
    if (!$allowed) {
        http_response_code(429);
        echo json_encode(['places' => [], 'error' => 'rate limited']);
        exit;
    }
    touch(PLACE_STAMP);

    $url = NOMINATIM . '?' . http_build_query([
        'q'            => $q,
        'format'       => 'jsonv2',
        'limit'        => 8,
        'countrycodes' => 'my',
        'viewbox'      => implode(',', BOX),
        'bounded'      => 1,
    ]);
    // fetchAll, never file_get_contents — the same rule the whole file follows. It also carries the
    // identifying User-Agent that Nominatim's policy requires.
    $raw = json_decode(fetchAll([$url], 1, false)[$url] ?? '', true);
    if (!is_array($raw)) {
        http_response_code(502);
        echo json_encode(['places' => [], 'error' => 'unavailable']);
        exit;
    }

    /* Four fields, and nothing else. The raw response is large, its shape moves between versions,
       and the client must not depend on a schema we do not own.
       `display_name` is the full comma-separated address. Its first part repeats `name`, so the
       detail line takes the next three — which is the district, the state and usually the postcode
       area. */
    $places = [];
    foreach ($raw as $r) {
        $name = trim((string)($r['name'] ?? ''));
        $full = (string)($r['display_name'] ?? '');
        if ($name === '') $name = trim(explode(',', $full)[0] ?? '');
        if ($name === '') continue;
        $parts = array_slice(array_map('trim', explode(',', $full)), 1, 3);
        $places[] = [
            'name'   => $name,
            'detail' => implode(', ', array_filter($parts)),
            'lat'    => (float)($r['lat'] ?? 0),
            'lon'    => (float)($r['lon'] ?? 0),
        ];
    }

    $body = json_encode(['places' => $places, 'error' => null]);
    $db->prepare('INSERT OR REPLACE INTO page (url, ts, body) VALUES (?, ?, ?)')
       ->execute([$key, time(), $body]);
    header('Cache-Control: max-age=600');
    echo $body;
    exit;
}
```

- [ ] **Step 2: Publish the coverage box**

In `api.php`, in the payload array, beside `'siteM' => SITE_M,` (line 904), add:

```php
    // Published so the client can word its own out-of-area message from the numbers the server
    // actually bounds on, rather than keeping a second copy of the box in a JS file to go stale.
    'box'      => BOX,
```

- [ ] **Step 3: Ignore the new stamp file**

In `.gitignore`, add:

```
.place.stamp
```

- [ ] **Step 4: Lint and run the offline checks**

Run:

```bash
php -l api.php && php api.php --selftest && php shots-test.php
```

Expected: no syntax errors, and every check line reads `ok`.

- [ ] **Step 5: Exercise the endpoint**

Run each and read the output:

```bash
# A real place inside the box. Expect one or more results with lat/lon near 3.1, 101.6.
curl -sk "https://flood-exp.test/api.php?place=bandar+utama"

# Too short. Expect HTTP 400 and {"places":[],"error":"query too short"}.
curl -sk -o /dev/null -w '%{http_code}\n' "https://flood-exp.test/api.php?place=a"

# Outside the box. Expect an empty places array, not an error.
curl -sk "https://flood-exp.test/api.php?place=georgetown+penang"

# The cache. Run the first command again and time both. The second must be far faster,
# and it must not touch the stamp file.
time curl -sk -o /dev/null "https://flood-exp.test/api.php?place=bandar+utama"

# The rate limit. Two different uncached queries back to back — the second must be 429.
curl -sk -o /dev/null -w '%{http_code}\n' "https://flood-exp.test/api.php?place=sunway+pyramid"
curl -sk -o /dev/null -w '%{http_code}\n' "https://flood-exp.test/api.php?place=mid+valley"

# The payload carries the box.
curl -sk https://flood-exp.test/api.php \
  | php -r 'echo json_encode(json_decode(stream_get_contents(STDIN),true)["box"]),"\n";'
```

- [ ] **Step 6: Confirm the three sources still contribute**

Run:

```bash
curl -sk https://flood-exp.test/api.php \
  | php -r 'echo json_encode(json_decode(stream_get_contents(STDIN),true)["sources"]),"\n";'
```

Expected: every `parsed` counter is above zero. A zero means a scraped table moved, which is
unrelated to this change but must not be shipped past.

- [ ] **Step 7: Record the endpoint**

Append to `docs/FEATURES.md`, under the `## Search by place` heading from Task 3:

```markdown
### `api.php?place=`

The go-to box searched the station list and nothing else, so a reader who wanted the water level near
a housing area had to know which station covered it first.

`?place=` joins `?cam=`, `?shots=` and `?shot=` on the existing entry point, which already owns every
outbound request in this repository. It proxies OpenStreetMap Nominatim server-side, so the browser
still reaches no third party and the vendored-only rule holds. The query is trimmed, collapsed,
lowercased and rejected outside 2 to 80 characters by `placeQuery()`, which `php api.php --selftest`
exercises offline.

Results are bounded to `BOX`, the coverage area with about 0.1 degrees of margin on the station
extent, so "Klang" means the Selangor town. The box is published in the payload as `box`, so no JS
file keeps a second copy to go stale.

Each answer is cached in the `page` table of `.history.db` for 30 days, because place names do not
move. The rate limit guards the uncached path only, at one lookup per second site-wide, and it reuses
`forceAllowed()` rather than growing a second copy of the same arithmetic. An unlimited public proxy
to Nominatim is an open relay that gets our address blocked.

Only four fields survive: name, detail, lat and lon. The raw response is large and its shape moves
between versions, and the client must not depend on a schema we do not own.

**Not built.** Per-keystroke autocomplete. Nominatim's usage policy names it, and the client only
calls this when the reader picks the search row.
```

- [ ] **Step 8: Commit**

```bash
git add api.php .gitignore docs/FEATURES.md
git commit -m "api.php?place=: bounded, cached, rate-limited place lookup"
```

---

# Stage 4 — The place row and the place card

## Task 12: One builder for the location card, with a distance cap

**Files:**
- Modify: `js/config.js` (a new constant)
- Modify: `js/popup.js:427-458` (`herePopup`)

**Interfaces:**
- Produces: `nearPopup(latlng, head, capKm): string` and
  `placePopup(latlng, name, detail): string`, both exported from `js/popup.js`.
  `herePopup(e, loaded)` keeps its signature and its behavior for `locate.js`.
  `NEAR_MAX_KM` exported from `js/config.js`.

- [ ] **Step 1: Add the constant**

In `js/config.js`, after `CAM_ALERT_KM` (line 150), add:

```js
/* How far a sensor may be and still answer "what is near this point". The location card had no cap
   at all, so it would name a siren 60 km away, which is a different weather system and a different
   catchment. About the width of a district here.
   The camera keeps CAM_MAX_KM (5), which is a narrower and separate question — whether "the river in
   this picture" is a claim this app can make. */
export const NEAR_MAX_KM = 10;
```

- [ ] **Step 2: Generalize the builder**

In `js/popup.js`, add `NEAR_MAX_KM` to the `config.js` import. Replace `herePopup()` (line 427) with
these three:

```js
/* "What is near this point", for any point. The nearest camera's picture leads, then one section per
   kind with the full sensor body — meter, trend, sparkline, footer. A line of summary is enough to
   rank four stations and not enough to answer "is this bad?", which is the question anyone opens
   this card to ask.
   The one thing this card must say that a mast's need not is *where each sensor is*. On a station
   card the header names the place once and every sensor shares it. Here the four are four different
   places, so each section carries its own name, district and distance — and the name is the jump to
   it, because that station is somewhere else on the map.
   `capKm` bounds every kind but the camera. Past it the section says so rather than naming a sensor
   that shares no catchment with the point asked about. */
export function nearPopup(latlng, head, capKm) {
  const cam = nearestCam(latlng);
  const rows = ['river', 'rainfall', 'siren', 'gauge'].map(k => {
    const kind = KINDS[k];
    let s = nearestOf(k, latlng);
    if (s && distKm(latlng, s) > capKm) s = null;
    /* `title`, not `head`: the card's own head is this function's parameter, and shadowing it inside
       the callback would put a sensor's glyph where the card's badge belongs. */
    const title = `<i class="glyph i i-${kind.icon}"
        style="color:${s ? kind.color : 'var(--muted)'}"></i><b>${kind.one || kind.label}</b>`;
    // nearestOf() only ever returns a station that is reporting, so there is no "no reading" case
    // here — either the nearest one inside the cap has something to say or nothing does.
    if (!s) return `<div class="sensor">
      <div class="sensorhead">${title}</div>
      <div class="muted">no ${kind.label.toLowerCase()} within ${capKm} km</div>
    </div>`;
    return `<div class="sensor" data-sensor="${s.id}">
      <div class="sensorhead">${title}
        <span class="muted">${distKm(latlng, s).toFixed(1)} km</span>
        ${dots(s)}
      </div>
      <div class="place" data-go="${s.id}" title="Show ${s.name} on the map">${s.name}</div>
      ${region(s)}
      ${sensorBody(s, false)}
    </div>`;
  }).join('');

  return `${head}${camNear(latlng, cam)}${rows}`;
}

/* Built fresh on every open, so it reflects the latest poll rather than the fix's timestamp. */
export function herePopup(e, loaded) {
  if (!loaded) return '<b>You are here</b><br><span class="muted">stations still loading…</span>';
  /* The cap applies here too. One function must follow one rule, and two cards built by one builder
     saying different things is the drift this codebase argues against everywhere else. A siren 60 km
     from a reader was never a useful answer. */
  return nearPopup(e.latlng, `<div class="pophead">
      <span class="badge" style="--c:var(--me)"><i class="i i-home_pin"></i>You are here</span>
      <div class="muted">accurate to about ${Math.round(e.accuracy)} m</div>
    </div>`, NEAR_MAX_KM);
}

/* A place the reader searched for. The same card, with a different head — accent rather than the
   location blue, because this is somewhere they asked about and not where they are. No accuracy
   line: a geocode has no accuracy to state. */
export const placePopup = (latlng, name, detail) => nearPopup(latlng, `<div class="pophead">
    <span class="badge" style="--c:var(--accent)"><i class="i i-place"></i>Searched place</span>
    <div class="popname">${name}</div>
    ${detail ? `<div class="muted">${detail}</div>` : ''}
  </div>`, NEAR_MAX_KM);
```

- [ ] **Step 3: Syntax-check the modules**

Run:

```bash
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
```

Expected: no output.

- [ ] **Step 4: Look at the page**

Hard-reload. Press the locate button and allow the browser's location prompt.

Check all three:
1. The "You are here" card still opens with its camera picture and four sections.
2. Any kind with nothing inside 10 km reads `no <kind> within 10 km` instead of naming a far one.
3. Each named sensor still carries its distance and jumps to its own card when pressed.

- [ ] **Step 5: Commit**

```bash
git add js/config.js js/popup.js
git commit -m "One builder for the location card, capped at 10 km"
```

---

## Task 13: The place row and its states

**Files:**
- Modify: `css/icons.css` (the `place` mask)
- Modify: `js/ui.js` (`search()`, `rowHtml()`, `pick()`, and a new `lookup()`)
- Modify: `css/base.css`
- Modify: `index.html` (the `?v=` bumps)

**Interfaces:**
- Consumes: `STATIC` from `js/config.js`, already imported in `js/ui.js`.
- Produces: row shapes `{ t: 'ask', g }`, `{ t: 'place', p, g, sub }` and `{ t: 'msg', text, g }`.
  Module state `places`, `pstate` and `gen`.

- [ ] **Step 1: Fetch and add the place icon**

Run:

```bash
curl -s "https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/place/fill1/24px.svg"
```

In `css/icons.css`, add the variable in the `:root` block beside `--i-my_location` (line 53),
replacing `PASTE_PATH_HERE` with the `d` value from the response:

```css
  --i-place: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 -960 960 960'><path d='PASTE_PATH_HERE'/></svg>");
```

And the class beside `.i-my_location` (line 110):

```css
.i-place { --i: var(--i-place); }
```

- [ ] **Step 2: Add the lookup state and the fetch**

In `js/ui.js`, below the `expanded` set, add:

```js
/* The place lookup. Nothing leaves the browser until the reader picks the row at the foot of the
   list — Nominatim's usage policy names per-keystroke autocomplete, and an explicit row respects it
   outright. `gen` is the same guard clip.js uses: a slow answer to a query nobody is waiting for any
   more must not paint over a newer one. */
let places = [], pstate = '', gen = 0;

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
      : r.ok ? 'No place by that name in Selangor, Kuala Lumpur or Putrajaya'
      : 'Place search is unavailable';
  } catch {
    if (my !== gen) return;
    places = [];
    pstate = 'Place search is unavailable';
  }
  search();
}
```

- [ ] **Step 3: Put the rows in the list**

In `js/ui.js`, in `search()`, add this block immediately before `draw(true);`:

```js
  /* Results lead the list, the trigger row sits at its foot. A place is what the reader asked for
     when nothing local matched, so it belongs above; the offer to go and look is the last resort and
     belongs below.
     Nothing here on the GitHub Pages build: that build serves a baked api.json and `?place=` is a
     404 against a file with no opinion, exactly as "Refresh now" is. */
  if (!STATIC && terms.length) {
    if (places.length)
      hits.unshift(...places.map(p => ({ t: 'place', p, g: 'PLACES', sub: p.detail })));
    else
      hits.push(pstate ? { t: 'msg', text: pstate, g: 'PLACES' } : { t: 'ask', g: 'PLACES' });
  }
```

- [ ] **Step 4: Draw the three new rows**

In `rowHtml()`, add these three branches at the top, right after the `cls` const:

```js
  if (r.t === 'ask') return `<li role="option" data-i="${i}"${cls}
      ><i class="glyph i i-search" style="color:var(--accent)"></i
      ><span class="nm">Search the map for “${gotoIn.value.trim()}”</span></li>`;

  // Not an option and not selectable: there is nothing to pick, only something to read.
  if (r.t === 'msg') return `<li class="none">${r.text}</li>`;


  if (r.t === 'place') return `<li role="option" data-i="${i}"${cls}
      ><i class="glyph i i-place" style="color:var(--accent)"></i
      ><span class="nm">${r.p.name}${
        r.sub ? `<br><small class="muted">${r.sub}</small>` : ''}</span></li>`;
```

**Known wrinkle, accepted.** A `msg` row carries no `data-i` and takes no `.sel` class, so an arrow
key can move the selection onto it and nothing appears to happen. `pick()` returns early for that
row, so pressing Enter is harmless. There is at most one message row and it is always the last one,
so the fix costs more code than the wrinkle costs a reader.

- [ ] **Step 5: Handle the picks**

In `pick()`, add these two branches before the existing `const t = …` line:

```js
  /* The trigger row is the only thing here that does not close the box: the reader is still in the
     middle of the same search, and the answer arrives into the list they are looking at. */
  if (r.t === 'ask') {
    const q = gotoIn.value.trim();
    if (q.length >= 2) lookup(q);
    return;
  }
  if (r.t === 'msg') return;
```

- [ ] **Step 6: Clear the results when the query changes**

Replace `gotoIn.oninput` with:

```js
/* A place result belongs to the query that fetched it. Leaving stale hits under a changed query is
   the same lie a stale reading would be. */
gotoIn.oninput = () => {
  sel = -1;
  expanded.clear();
  places = [];
  pstate = '';
  search();
};
```

- [ ] **Step 7: Style the message row**

`.picklist li.none` already carries the muted, non-selectable shape this needs. Add one rule in
`css/base.css` beside it (line 253) so a long message wraps instead of stretching the panel:

```css
.picklist li.none { display: block; white-space: normal; line-height: 1.4; }
```

- [ ] **Step 8: Bump the stylesheet versions**

In `index.html`, change `css/icons.css?v=67` to `?v=68` and `css/base.css?v=87` to `?v=88`.

- [ ] **Step 9: Syntax-check the modules**

Run:

```bash
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
```

Expected: no output.

- [ ] **Step 10: Look at the page**

Hard-reload. Open the search box.

Check all six:
1. Typing `bandar utama` shows station matches, and a `Search the map for “bandar utama”` row below.
2. Picking that row shows `Searching…` and keeps the station hits above it.
3. The answer arrives as a `PLACES` group at the top, each row with a district line.
4. Typing one more character clears the places and brings the trigger row back.
5. Searching for `qwerty` returns `No place by that name in Selangor, Kuala Lumpur or Putrajaya`.
6. Two different searches within a second: the second says
   `Too many searches just now — try again in a moment`.

- [ ] **Step 11: Commit**

```bash
git add css/icons.css js/ui.js css/base.css index.html
git commit -m "The place-search row in the go-to box"
```

---

## Task 14: Picking a place drops a pin and opens the card

**Files:**
- Modify: `js/map.js` (a new `showPlace()`)
- Modify: `js/ui.js` (`pick()`)
- Modify: `css/map.css`
- Modify: `index.html` (the `?v=` bump, the About privacy sentence)
- Modify: `docs/FEATURES.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: `placePopup()` from `js/popup.js`, `openSide`, `focusOn` and `ping` from `js/map.js`.
- Produces: `showPlace(latlng, html)` exported from `js/map.js`. Panel key `@place`.

- [ ] **Step 1: Add the marker and the card**

In `js/map.js`, at the end of the file, add:

```js
/* A place the reader searched for. One marker at a time, kept until another place replaces it — the
   same life the "you are here" pin has, and closing the card does not clear it.
   A plain L.Marker, not an L.Path: paths bubble their clicks to the map and markers do not, and
   nothing about this pin may close the card someone is reading.
   The `@place` key keeps render()'s refresh pass off the card, the same rule `@here` and `@alerts`
   follow — it belongs to no site. */
let placeMark = null;
export function showPlace(latlng, html) {
  if (placeMark) placeMark.remove();
  placeMark = L.marker(latlng, { icon: L.divIcon({
    // Same box and same tip anchor as the "you are here" pin: a pin points at its tip, not its
    // middle, and Material draws the glyph with a little air below it inside the viewBox.
    className: '', iconSize: [48, 48], iconAnchor: [24, 44],
    html: '<span class="pin place"><i class="i i-place"></i></span>',
  }) }).addTo(map);
  openSide('@place', html);
  focusOn(latlng, 13);
  ping(latlng, 'place');
}
```

- [ ] **Step 2: Call it from `pick()`**

In `js/ui.js`, add `showPlace` to the `map.js` import (line 6) and `placePopup` to the `popup.js`
import (line 9). Then add this branch in `pick()`, after the `msg` branch:

```js
  if (r.t === 'place') {
    gotoIn.blur();
    setFind(false);
    const at = L.latLng(r.p.lat, r.p.lon);
    showPlace(at, placePopup(at, r.p.name, r.p.detail));
    return;
  }
```

- [ ] **Step 3: Style the pin and its ripple**

In `css/map.css`, after the `.pin.me` rule (line 170), add:

```css
/* A searched place. Accent rather than the location blue: this is somewhere the reader asked about,
   not where they are, and the two marks must not be read as the same thing. */
.pin.place { color: var(--accent); font-size: 40px; }
```

And beside `.ping.me` (line 203), add:

```css
.ping.place { --c: var(--accent); }
```

- [ ] **Step 4: Bump the stylesheet version**

In `index.html`, change `css/map.css?v=93` to `?v=94`.

- [ ] **Step 5: Correct the About privacy claim**

This change sends a typed place name to our server and on to OpenStreetMap. The About pane makes
three privacy claims and one of them is now incomplete.

In `index.html`, immediately after the CARTO paragraph (line 242), add:

```html
  <p class="muted">A place you search for goes to this site’s own server, which asks OpenStreetMap
     where it is. That happens only when you pick the search row, never as you type.</p>
```

Then verify the claims that remain. `CLAUDE.md` requires a check that lists **every** absolute URL
the code contains, not a grep for known offenders. Run:

```bash
grep -rhoE "https?://[a-zA-Z0-9./?=_%:-]+" index.html js/ css/ sw.js manifest.json \
  | sort -u
```

Read every line and classify it as fetched by the browser or merely linked. Confirm three things:

1. The only hosts the browser **fetches** from are CARTO's basemap tiles and this site's own origin.
2. Nominatim does not appear at all in that list. The browser calls `api.php`, not OpenStreetMap.
3. The paragraph "Your location, if you share it, stays in the browser. Nothing sends it anywhere."
   is still true. This feature sends a place **name**, never a coordinate.

- [ ] **Step 6: Syntax-check the modules and every served file**

Run:

```bash
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
for f in js/*.js css/*.css; do
  curl -sk -o /dev/null -w "%{content_type} $f\n" "https://flood-exp.test/$f"; done | grep -v 'javascript\|css'
```

Expected: no output from either command.

- [ ] **Step 7: Look at the page**

Hard-reload. Search for a place and pick it.

Check all six:
1. The map pans there and an accent pin drops at the tip of the mark, with a ripple.
2. The panel opens a card headed `Searched place` with the name and its district.
3. The card lists the nearest camera picture and one section per kind, each with a distance.
4. Any kind with nothing inside 10 km says so rather than naming a far one.
5. Clicking the map, panning and waiting for a poll do not close the card.
6. Searching a second place moves the pin rather than adding one.

- [ ] **Step 8: Check it on a phone width**

Open the browser's device toolbar and set the width below 600px. Repeat Step 7.

Check all three:
1. The search box and its list fit the screen and the list scrolls.
2. The place card fills the panel and the × closes it.
3. The chevron on a mast row is large enough to hit with a finger.

- [ ] **Step 9: Record the card and the two gotchas**

Append to `docs/FEATURES.md`, under the `## Search by place` heading:

```markdown
### The place card

`herePopup()` already assembled "what is near this point", so it became `nearPopup(latlng, head,
capKm)` and the two callers differ only in the head they pass. `herePopup()` stays as a thin wrapper
and `locate.js` needed no change.

The card opens under the key `@place`, joining `@here` and `@alerts` on the rule that a `@` key keeps
`render()`'s refresh pass off a card that belongs to no site. The pin is a plain `L.Marker` in
`--accent`, anchored at its tip, with no accuracy circle — a geocode has no accuracy to state. It
persists until another place replaces it, exactly as the "you are here" pin does.

`NEAR_MAX_KM` (10) bounds river, rainfall, siren and gauge. The camera keeps `CAM_MAX_KM` (5),
which already means something narrower. The cap applies to the "you are here" card too: one builder
must follow one rule, and that card would otherwise name a siren 60 km away.

**Not built.** Place search on the GitHub Pages build. That build has no PHP, so the trigger row is
gated on `STATIC` exactly as "Refresh now" is.

**About pane.** The privacy paragraphs gained one sentence, because a typed place name now reaches
this server and OpenStreetMap. The claim about the reader's own location is unchanged and still
true: this feature sends a name, never a coordinate.
```

Append to the gotcha list in `CLAUDE.md`:

```markdown
- **The go-to box lists sites, and `hits` holds row objects rather than stations.** Six row shapes
  share one array: `site`, `sensor`, `near`, `ask`, `place` and `msg`. `pick()` switches on `r.t`,
  and anything new added to that list must add a branch there as well as in `rowHtml()`, or a reader
  will select a row that does nothing. The sub-rows are spliced into `hits` itself rather than hidden
  with CSS, which is what lets the existing arrow keys keep walking visible rows with no new code.
- **Nothing calls `?place=` until the reader asks.** Nominatim's usage policy names per-keystroke
  autocomplete, so the lookup hangs off an explicit row at the foot of the list and never off
  `oninput`. `lookup()` carries a generation counter for the same reason `clip.js` does. Do not
  "improve" this into a debounced auto-search: every abandoned query would still leave the machine,
  and a fast typist would fire several.
```

- [ ] **Step 10: Commit**

```bash
git add js/map.js js/ui.js css/map.css index.html docs/FEATURES.md CLAUDE.md
git commit -m "Picking a place drops a pin and opens the nearby-sensors card"
```

---

## Task 15: American spelling in every user-facing string

The interface holds British spellings. Convert the ones a reader sees. Comments and documentation
are out of scope and are swept in their own commit after this feature ships.

**Files:**
- Modify: `index.html` (the Help and About panes)
- Modify: `js/locate.js:57`
- Modify: `js/alerts.js`, `js/popup.js`, `js/render.js`, `js/table.js` (output strings only)

- [ ] **Step 1: List the candidates**

Run:

```bash
grep -rnoiE "(colour|favourite|centre|recentre|metre|licence|behaviour|neighbour|grey|analyse|labelled|cancelled|defence|practise|honour)[a-z]*" \
  index.html js/*.js | sort
```

- [ ] **Step 2: Convert the user-facing ones only**

Work through the list and change a match **only** when it sits inside text a reader sees: visible
markup in `index.html`, or a string literal, `title` or `aria-label` in a JS file.

The conversions are `colour → color`, `coloured → colored`, `colours → colors`, `grey → gray`,
`metres → meters`, `neighbours → neighbors`, `licence → license`, `recentre → recenter`,
`centre → center`, `behaviour → behavior`.

Three rules:

1. **Leave every comment alone.** Most matches are in comments. A 500-line spelling sweep inside a
   feature diff makes the feature impossible to review.
2. **Never touch an identifier, a CSS property or an HTML attribute.** `aria-labelledby` is an
   attribute name. `color` is already the CSS property. `class="grey"` is a class name if one exists.
3. **Prefer the symbol `m` over the word** in any new or edited string. `meter()` in `popup.js` draws
   the water-level bar, so the unit and the component now share a spelling, and `3.42 m` avoids the
   collision entirely.

- [ ] **Step 3: Confirm no user-facing British spelling is left**

Run the Step 1 command again. Read every remaining line and confirm each one is a comment, an
identifier or an attribute name.

- [ ] **Step 4: Syntax-check and serve-check**

Run:

```bash
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
php -l api.php && php api.php --selftest && php shots-test.php
```

Expected: no output from the first, and every check line `ok` from the second.

- [ ] **Step 5: Look at the page**

Hard-reload. Open About, then Help, and read both panes end to end. Open a station card and the
locate button's tooltip.

Check that no British spelling reaches the screen.

- [ ] **Step 6: Record the rule**

Append to `docs/FEATURES.md`:

```markdown
### Spelling

This app uses American spelling everywhere: prose, code and every user-facing string. The interface
strings were converted with the place-search and favorites work. Comments and internal documentation
are swept separately, because a 500-line spelling change inside a feature diff makes the feature
impossible to review.

Two rules for any future conversion. Never touch an identifier, a CSS property or an HTML attribute —
`aria-labelledby` is an attribute name and `color` is already the CSS property. And prefer the symbol
`m` over the word "meters" in a new string, because `meter()` in `popup.js` draws the water-level bar
and the two would otherwise share a spelling.
```

- [ ] **Step 7: Commit**

```bash
git add index.html js/
git commit -m "American spelling in every user-facing string"
```

---

## Final check

Run every check once more, then look at the whole page.

```bash
php -l api.php && php -l sources.php
php api.php --selftest
php shots-test.php

curl -sk https://flood-exp.test/api.php \
  | php -r 'echo json_encode(json_decode(stream_get_contents(STDIN),true)["sources"]),"\n";'

T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done

for f in js/*.js css/*.css; do
  curl -sk -o /dev/null -w "%{content_type} $f\n" "https://flood-exp.test/$f"; done | grep -v 'javascript\|css'

curl -sk -o /dev/null -w '%{http_code}\n' "https://flood-exp.test/api.php?cam=1"
curl -sk "https://flood-exp.test/api.php?shots=1"
```

By hand, at full width and again below 600px:

1. Search a place, pick it, and read the card, the pin and the 10 km cap.
2. Search a place outside the coverage area, and read the message.
3. Search the same place twice, and confirm the second answer is instant.
4. Star a sensor, then a whole mast, and check the drawer panel, the chip and the pin star.
5. Ignore a starred sensor, and confirm it leaves the favorites list.
6. Clear every favorite, and confirm the `Favorites only` chip goes disabled and un-checked.
7. Turn on test mode, star one alerting station, and confirm it sorts first while the alert count,
   the ticker and the badge do not move. Turn test mode off.
8. Expand a mast in the search box, pick a sensor, and confirm the card scrolls to it and flashes.
