# Upstream outage notice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When JPS publishes its own outage notice, say so at the top of the ticker and the alert panel, with a modal that links the channels JPS names.

**Architecture:** `api.php` recognises the notice page it already rejects, collapses the pages it hit into one entry, and publishes `notices[]`. The client renders it through the MET warning plumbing that shipped this week — one generalised card, one generalised ticker tile, one delegated handler — so no fifth alert surface appears and no total moves.

**Tech Stack:** PHP 8 (no framework), ES modules (no build step), plain CSS. Symfony DomCrawler in `lib/`.

## Global Constraints

- **Colour language.** A notice must never take a traffic-light hue. `--s-normal` / `--s-alert` / `--s-warning` / `--s-danger` are reserved for status. Values live in `css/base.css` and nowhere else. Never write a hex into a JS file.
- **Counts.** A notice counts toward nothing. The icon badge, `document.title`, the tally glyphs and `#alertBtn`'s colour stay station-only. This is the rule `warnCard()` already states at `js/alerts.js:150`.
- **Message rules.** Sentence case on every rendered string. No hedging. None of this app's internal vocabulary — the words `page cache`, `stale`, `upstream`, `payload` and `proxy` must not reach the screen.
- **Prose in files.** Active voice, one instruction per sentence, 20 words maximum, no semicolons, no contractions. Check with `python "C:/Users/illus/.claude/ste-lint.py" < FILE`.
- **Escaping.** Every upstream string a banner renders goes through `esc()` from `js/util.js`. The MET warning code already does this and the notice path must match it.
- **No build step.** Relative import specifiers with the `.js` extension. Dependencies stay acyclic.
- **Cache.** Bump `?v=` on a changed CSS link in `index.html`. Hard-reload after a `js/` change.
- **Verify before done.** `php -l api.php`, `php api.php --selftest`, `php shots-test.php`, and `node --check` on every changed module.

---

### Task 1: Recognise the notice and publish it

**Files:**
- Modify: `api.php` — add `noticeOf()` and `NOTICE_REGION` after `pageHasData()` closes at line 645
- Modify: `api.php:1348-1356` (the page loop)
- Modify: `api.php:1807` (the payload's `warnings` line)
- Test: `api.php` `--selftest` block, after the `pageHasData()` group

**Interfaces:**
- Consumes: `pageHasData(string $key, string $body): bool`, already present.
- Produces: `noticeOf(string $body): ?string` — a notice id, or null.
- Produces: payload key `notices`, an array of `['id' => string, 'regions' => string[]]`. Empty array on a healthy poll.

- [ ] **Step 1: Write the failing test**

In `api.php`, find the `pageHasData():` group in the `--selftest` block. Insert this immediately after its last assertion, the one reading `a nowcast notice is not data`:

```php
    echo "\nnoticeOf():\n";
    $ok('the notice page returns its id',  noticeOf('<html><title> Notis Gangguan </title><body></body></html>') === 'publicinfobanjir');
    $ok('a real table is not a notice',    noticeOf("<table><tr class='item'><td>1</td></tr></table>") === null);
    $ok('an empty body is not a notice',   noticeOf('') === null);
    // The match is on the title, not on the body. A table that happens to print the words in a cell
    // is still a table, and treating it as an outage would take a working feed off the map.
    $ok('the words in body text do not match', noticeOf('<html><title>Aras Air</title><body>Notis Gangguan</body></html>') === null);
    $ok('case and spacing do not matter',  noticeOf('<TITLE>notis   gangguan</TITLE>') === 'publicinfobanjir');
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `php api.php --selftest`
Expected: `PHP Fatal error: Uncaught Error: Call to undefined function noticeOf()`

- [ ] **Step 3: Write the recogniser**

In `api.php`, insert after `pageHasData()` closes at line 645, before the `placeQuery()` docblock:

```php
/* Which region each page speaks for. Only the national portal is known to publish a notice, so only
   its keys are here. A key absent from this table can still be recognised as a notice, and it simply
   contributes no region — the reader is told the source is down without a claim about where. */
const NOTICE_REGION = [
    'nat-SEL' => 'Selangor',
    'nat-WLH' => 'Kuala Lumpur',
    'nat-PTJ' => 'Putrajaya',
];

/**
 * Which known outage notice is this body, if any?
 *
 * The national portal answers a service outage with a page titled `Notis Gangguan`, under HTTP 200.
 * pageHasData() already refuses it, which keeps the stored table on the map. This function reads the
 * same body one step further and asks whether the source stated its own failure, because a source
 * that says it is down is worth repeating to a reader and a timeout is not.
 *
 * The test is the title, never the body text and never the image path. A table that prints these two
 * words in a cell is still a table, and a file name is something JPS can rename without telling
 * anyone.
 */
function noticeOf(string $body): ?string {
    if ($body === '') return null;
    return preg_match('~<title>\s*Notis\s+Gangguan~i', $body) ? 'publicinfobanjir' : null;
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `php api.php --selftest`
Expected: five new lines reading `ok`, and the run ending `all ok`.

- [ ] **Step 5: Collect the notices in the page loop**

In `api.php`, replace lines 1348 to 1356 exactly:

```php
$pagesStale = [];
$noticeHits = [];      // notice id => [region, …]
foreach ($extraUrls as $k => $u) {
    $got = $raw[$u] ?? '';
    if (!pageHasData($k, $got)) {
        /* Read the raw body before the next line clears it. A notice is the one failure that states
           its own cause, so it is the only one a reader hears about. Everything else stays in
           $pagesStale, which the status popover already carries. */
        $id = noticeOf($got);
        if ($id !== null && isset(NOTICE_REGION[$k])) $noticeHits[$id][] = NOTICE_REGION[$k];
        $got = '';
    }
    [$write, $body] = pageRow(isset($want[$k]), $got, $stored[$u]['body'] ?? '');
    if (isset($want[$k]) && $got === '') $pagesStale[] = $k;
    if ($write) $keep->execute([$u, $now, $body]);
    $pages[$k] = $body;
}

/* One entry per notice, never one per page. Three national pages carry the same notice, and three
   identical tiles on the strip claim one outage three times. */
$notices = [];
foreach ($noticeHits as $id => $regions) {
    $notices[] = ['id' => $id, 'regions' => array_values(array_unique($regions))];
}
```

- [ ] **Step 6: Publish it**

In `api.php`, find line 1807, which reads `    'warnings' => $metWarn,`. Insert this line directly after it:

```php
    // Empty on a healthy poll, so a reader of this key needs no special case. See noticeOf().
    'notices'  => $notices,
```

- [ ] **Step 7: Check the payload against the live outage**

Run:

```bash
php -l api.php
curl -sk "https://flood-exp.test/api.php?force=1" \
  | php -r '$p=json_decode(stream_get_contents(STDIN),true);
            echo json_encode($p["notices"]),"\n",json_encode($p["sources"]["stale"]),"\n";'
```

Expected while JPS is down: `[{"id":"publicinfobanjir","regions":["Kuala Lumpur","Putrajaya"]}]` and a matching `stale` list. Expected once JPS recovers: `[]`.

The force is rate limited to one per 60 seconds. If it returns the cached payload, wait a minute and repeat.

- [ ] **Step 8: Commit**

```bash
git add api.php
git commit -m "A source that says it is down gets to say so"
```

---

### Task 2: The client's copy of the words

**Files:**
- Modify: `js/config.js` — add `NOTICE` after `HOTLINES` at line 99
- Modify: `js/state.js:7` (beside `warnings`)
- Modify: `js/net.js:111`
- Modify: `css/icons.css` — one token and one class

**Interfaces:**
- Consumes: payload key `notices` from Task 1.
- Produces: `NOTICE`, an object keyed by notice id. Each value is
  `{ source: string, title: string, line: string, text: string, links: [label, url][] }`.
- Produces: `state.notices`, an array of `{ id, regions }`, defaulting to `[]`.
- Produces: the CSS classes `.i-public_off` and the token `--i-public_off`.

- [ ] **Step 1: Add the string table**

In `js/config.js`, insert after line 99, the `HOTLINES` export:

```js
/* Upstream outage notices. `api.php` publishes an id and the regions the outage hit. Every word a
   reader sees is here, beside ALERT_TITLE and HOTLINES, because that is where this app keeps its
   strings. A payload that reships this paragraph every five minutes pays for it on every poll.

   `line` is the whole of the ticker tile and the panel row. CAP caps a headline at 160 characters
   and this one is 62.

   The links are the channels the notice itself names. A reader who doubts a flood map goes looking
   for a second opinion, and the alert standard calls that milling. The links are the feature.

   MyPublicInfoBanjir has no App Store link. Apple publishes no working web search for the store, and
   a guessed app id on a flood app points a worried reader at the wrong software. Google Play search
   is correct by construction, so Android gets a link and iOS gets the name. */
export const NOTICE = {
  publicinfobanjir: {
    source: 'JPS PublicInfoBanjir',
    title:  'JPS PublicInfoBanjir is down',
    line:   'JPS PublicInfoBanjir is down. Some water levels may be behind.',
    text:   'JPS says the site is overloaded by high traffic. No end time was given.',
    links: [
      ['MyPublicInfoBanjir on Google Play', 'https://play.google.com/store/search?q=MyPublicInfoBanjir&c=apps'],
      ['PublicInfoBanjir on Facebook',      'https://www.facebook.com/PublicInfoBanjir'],
      ['JPS_InfoBanjir on X',               'https://x.com/JPS_InfoBanjir'],
      ['publicinfobanjir.water.gov.my',     'https://publicinfobanjir.water.gov.my/'],
      ['Read the notice from JPS',          'https://publicinfobanjir.water.gov.my/maintenance-files/MaintenancePublicinfobanjir/notifikasi.png'],
    ],
  },
};
```

- [ ] **Step 2: Hold it in state**

In `js/state.js`, line 7 currently reads:

```js
  warnings: [],    // MET warnings from the last successful poll, already filtered server-side
```

Insert directly after it:

```js
  notices: [],     // upstream outages JPS states itself — see NOTICE in config.js
```

- [ ] **Step 3: Read it from the payload**

In `js/net.js`, line 111 currently reads:

```js
    state.warnings = j.warnings || [];
```

Insert directly after it:

```js
    state.notices = j.notices || [];
```

- [ ] **Step 4: Add the glyph**

A notice must not reuse the weather glyph, and it must not reuse `wifi_off`, which the tally already
spends on a station nobody can hear. A struck-through globe says a website is down and cannot read as
weather.

In `css/icons.css`, insert this line inside the `:root` block that holds the other `--i-*` tokens,
directly after the `--i-play_arrow` line at line 67:

```css
  --i-public_off: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 -960 960 960'><path d='M819-28 701-146q-48 32-103.5 49T480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-62 17-117.5T146-701L27-820l57-57L876-85l-57 57ZM440-162v-78q-33 0-56.5-23.5T360-320v-40L168-552q-3 18-5.5 36t-2.5 36q0 121 79.5 212T440-162Zm374-99-58-58q21-37 32.5-77.5T800-480q0-98-54.5-179T600-776v16q0 33-23.5 56.5T520-680h-80v45L261-814q48-31 103-48.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 61-17.5 116T814-261Z'/></svg>");
```

Then, beside the other `.i-*` class rules, directly after `.i-play_arrow` at line 128, insert:

```css
.i-public_off { --i: var(--i-public_off); }
```

That path came from the set's own fetch URL, recorded at the top of the file:
`…/materialsymbolsoutlined/public_off/fill1/24px.svg`.

- [ ] **Step 5: Check the modules parse and the icon resolves**

```bash
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
curl -sk "https://flood-exp.test/css/icons.css" | grep -c "i-public_off"
```

Expected: no `FAIL` lines, and a count of 2.

- [ ] **Step 6: Commit**

```bash
git add js/config.js js/state.js js/net.js css/icons.css
git commit -m "The words for an outage, and a glyph that is not weather"
```

---

### Task 3: The panel card, the modal and the click that joins them

**Files:**
- Modify: `js/alerts.js:150-176` (the comment and `warnCard`) and `js/alerts.js:251-257`
- Modify: `js/ui.js:1106-1117` (the `[data-warn]` handler)
- Modify: `index.html:818-826` (the `warnBox` dialog)
- Modify: `css/chrome.css` — add after `.warnrow .warntext` at line 1246
- Modify: `index.html` — bump `?v=` on the `chrome.css` link

**Interfaces:**
- Consumes: `state.notices`, `NOTICE` from Task 2.
- Produces: `bannerCard(list, kind)` in `js/alerts.js`, returning an HTML string, empty when `list` is empty. `kind` is `'notice'` or `'warn'`.
- Produces: the DOM contract `data-banner="<kind>:<index>"`, read by one delegated handler in `js/ui.js`. It replaces `data-warn`, which no longer exists anywhere.

- [ ] **Step 1: Generalise the card**

In `js/alerts.js`, replace lines 150 to 176 — the comment block and `warnCard()` — with:

```js
/* Two kinds of regional notice, and they do not take the same rank.

   A MET warning sits under HAPPENING NOW and above everything else. It led the panel first, and a
   forecast about a region then sat above a river already over its danger mark. Only one of those is
   happening, which is the same argument the tier sort below makes about a forecast two streets
   away. So it takes a place in that order: after the `now` groups, before `soon` and `stale`. With
   nothing happening now it is still the first thing under the head.

   An outage notice sits above all of it, including HAPPENING NOW. It is not another item in the
   list. It is a caveat on the list itself, and it says the list may be incomplete. The all-clear is
   why. "All clear. Nothing rising or in danger" can be false precisely because a source stopped
   answering, and EEMUA's point is that a reader must be able to tell no alarms from a dead alarm
   system.

   Neither adds anything to the counts below. The badge, the tab title, the tally glyphs and the
   warning glyph still read the station list alone. Merging the two tells a reader that stations are
   in trouble when none is.

   The row clips its text with CSS, not by cutting the string. The full sentence stays in the DOM
   for a screen reader. It stays too for anyone who copies it. The modal holds all of it. */
const BANNER = {
  warn:   { cls: 'warngrp',   icon: 'rainy_heavy', c: 'var(--k-weather)', head: 'Forecast Warning' },
  notice: { cls: 'noticegrp', icon: 'public_off',  c: 'var(--k-source)',  head: 'Service Notice' },
};

/* One card for both kinds. `kind` picks the shell. The row text comes from the payload item for a
   warning, and from NOTICE in config.js for an outage, because an outage publishes an id rather
   than prose. */
function bannerCard(list, kind) {
  if (!list || !list.length) return '';
  const b = BANNER[kind];
  const rows = list.map((w, i) => {
    const t = kind === 'notice' ? NOTICE[w.id] : w;
    if (!t) return '';                    // an id this build has no words for says nothing
    return `<button class="warnrow" data-banner="${kind}:${i}">
        <b>${esc(t.title)}</b>
        <span class="warntext">${esc(t.text)}</span>
      </button>`;
  }).join('');
  // Every row unknown means an empty card shell, which draws a heading over nothing.
  if (!rows) return '';
  return `<div class="alertgrp ${b.cls}">
      <div class="alerthead">
        <i class="i i-${b.icon}" style="--c:${b.c}"></i>
        <b>${b.head}</b>
      </div>
      ${rows}
    </div>`;
}
```

`esc()` is already imported in this file at line 7. Every string a banner renders goes through it,
the same as the code being replaced.

Add `NOTICE` to the `config.js` import at line 5, which currently reads
`import { KINDS, STATUS_COLOR, NO_INFO, ALERT_TITLE } from './config.js';`.

- [ ] **Step 2: Draw both, at their two different ranks**

In `js/alerts.js`, replace lines 251 to 257 — the comment, `warnHtml` and `write`:

```js
  // Placed by the caller, not by write() — it sits after the `now` groups, and only the group list
  // below knows where those end. See the comment on bannerCard().
  const warnHtml = bannerCard(state.warnings, 'warn');
  /* The outage notice is not placed by the group list. It goes above everything, so it rides inside
     write() and covers the all-clear path and the grouped path with one line rather than two. */
  const noticeHtml = bannerCard(state.notices, 'notice');
  const write = body => {
    card = head + noticeHtml + body;
    if (side.key === KEY) openSide(KEY, card);
  };
```

Nothing else in `alerts()` moves. `warnHtml` keeps both of its existing uses: the all-clear path at
line 271 and the `body.splice(seam, …)` at line 309. The notice is above both because `write()` puts
it there.

- [ ] **Step 3: Add the colour token**

`--k-source` does not exist yet. It is a kind colour, not a status, so it belongs with the other
`--k-*` tokens and must not be a traffic-light hue.

`--k-weather` sits on line 65 of the bare `:root` block and on line 143 of the
`:root[data-theme="dark"], .pin` block. Add `--k-source` to **both**, on the same line as
`--k-weather` in each. The second block is also the pin palette, and a kind missing from it draws one
pin off-palette, so it cannot be skipped even though no pin uses this token today.

Use a muted violet-slate. It is neither the weather teal nor any status colour:

```css
  --k-source: #8d7fa8;   /* line 65, the light theme */
  --k-source: #a99bc4;   /* line 143, dark and .pin  */
```

Add a one-line comment beside the first, in the shape the `--k-weather` comment already uses: this is
not a station kind, it colours a source that stated it is down, and it must never take a
traffic-light hue.

- [ ] **Step 4: Style the card**

In `css/chrome.css`, insert after the `.warnrow .warntext` rule, which ends on line 1247:

```css
/* Same box as .warngrp, one rung above it in the panel, and its own left rule. A source that is down
   is not a status, so this colour is a kind colour and never a traffic light. */
.noticegrp {
  padding: 14px 0 14px 10px; border-top: 1px solid var(--outline);
  border-left: 3px solid var(--k-source);
}
#sideBody > .noticegrp:first-child { border-top: 0; padding-top: 4px; }
.noticegrp .alerthead { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.noticegrp .alerthead .i { color: var(--c); font-size: 18px; }
.noticegrp .alerthead b { font-weight: 500; }
```

- [ ] **Step 5: Make the modal serve both**

In `index.html`, replace the `warnBox` dialog at lines 818 to 826:

```html
<dialog id="warnBox" aria-labelledby="warnBoxTitle">
  <div class="modalhead">
    <i id="warnBoxIcon" class="i i-rainy_heavy" style="color:var(--k-weather)"></i>
    <h2 id="warnBoxTitle">Forecast Warning</h2>
    <form method="dialog"><button class="icon dclose" title="Close" aria-label="Close"
      ><i class="i i-close"></i></button></form>
  </div>
  <div id="warnBody"></div>
</dialog>
```

The icon now carries an id, because the head states which of the two kinds this is.

- [ ] **Step 6: Rewrite the handler**

In `js/ui.js`, replace lines 1106 to 1117 — the comment and the `[data-warn]` listener:

```js
// "Kuala Lumpur and Putrajaya", not "Kuala Lumpur, Putrajaya". One region reads as one region.
// Not called `list`: this file already binds that name at lines 507 and 702.
const andList = a => a.length < 2 ? (a[0] || '') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`;

// One click handler for both surfaces and both kinds. A panel row and a ticker tile both carry
// data-banner, which is the kind and the index into the matching list. Neither carries data-go: a
// regional notice is not a station, and opens no card.
document.addEventListener('click', e => {
  const w = e.target.closest('[data-banner]');
  if (!w) return;
  const [kind, i] = w.dataset.banner.split(':');
  const it = (kind === 'notice' ? state.notices : state.warnings)[+i];
  if (!it) return;
  const icon = el('warnBoxIcon');
  if (kind === 'notice') {
    const t = NOTICE[it.id];
    if (!t) return;
    icon.className = 'i i-public_off';
    icon.style.color = 'var(--k-source)';
    el('warnBoxTitle').textContent = 'Service Notice';
    /* The regions sentence is built from what the outage actually hit, so it never claims a region
       that is still reporting. The links are the reason this modal exists — see NOTICE in
       config.js. Every one is outbound, so the browser fetches nothing new. */
    const where = it.regions && it.regions.length
      ? `<p>${esc(andList(it.regions))} water levels may be behind. Stations still show their last known reading.</p>`
      : '';
    el('warnBody').innerHTML = `<h3>${esc(t.title)}</h3><p>${esc(t.text)}</p>${where}
      <p class="muted">Where JPS says to look instead:</p>
      <ul class="noticelinks">${t.links.map(([label, url]) =>
        `<li><a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a></li>`).join('')}</ul>`;
  } else {
    icon.className = 'i i-rainy_heavy';
    icon.style.color = 'var(--k-weather)';
    el('warnBoxTitle').textContent = 'Forecast Warning';
    el('warnBody').innerHTML = `<h3>${esc(it.title)}</h3><p>${esc(it.text)}</p>
      <p class="muted">Valid ${warnWhen(it.from)} to ${warnWhen(it.to)}</p>`;
  }
  warnBox.showModal();
});
```

`warnWhen()` and `esc()` already exist in this file and are used by the code being replaced. Keep the
`warnBox.onclick` backdrop line that follows — it is unchanged.

Add `NOTICE` to the `config.js` import at the top of `js/ui.js`.

- [ ] **Step 7: Style the link list**

In `css/chrome.css`, insert after the `.noticegrp .alerthead b` rule from Step 4:

```css
/* The links are the point of this modal, so they are a list and not a paragraph of commas. */
.noticelinks { margin: 6px 0 0; padding-left: 18px; }
.noticelinks li { margin: 4px 0; }
```

- [ ] **Step 8: Bump three cache keys**

In `index.html`, raise the `?v=` by one on **three** stylesheet links. Herd serves everything
`max-age=10800`, so an unbumped stylesheet is three hours of the old rules.

| line | file | now | becomes | why |
|---|---|---|---|---|
| 33 | `css/icons.css` | `?v=82` | `?v=83` | Task 2 added `--i-public_off`, and this step is where markup first asks for it |
| 34 | `css/base.css` | `?v=109` | `?v=110` | Step 3 added `--k-source` |
| 35 | `css/chrome.css` | `?v=146` | `?v=147` | Step 4 and Step 7 added `.noticegrp` and `.noticelinks` |

`css/icons.css` matters most and is the easiest to miss, because Task 2 changed that file and this
task changed the markup that needs it. A reader holding the cached stylesheet gets the new `<i>` and
no glyph to paint in it, which draws blank space rather than an error.

- [ ] **Step 9: Check it**

```bash
php -l api.php
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
grep -rn "data-warn" js/ index.html || echo "no data-warn left"
```

Expected: no `FAIL` lines. `grep` must report only `js/ticker.js`, which Task 4 changes. Nothing in
`js/alerts.js`, `js/ui.js` or `index.html`.

Then hard-reload `https://flood-exp.test` and confirm, with the outage live:

1. A `Service Notice` card sits above everything, including any `HAPPENING NOW` group.
2. Its left rule is the slate `--k-source`, not red, amber, orange or green.
3. Clicking the row opens the modal with the regions sentence and five links.
4. The app bar badge, the tab title and the tally glyphs are unchanged.
5. A MET warning row still opens its own modal with `Valid … to …`.

- [ ] **Step 10: Commit**

```bash
git add js/alerts.js js/ui.js index.html css/chrome.css css/base.css
git commit -m "One card and one modal for a warning and for an outage"
```

---

### Task 4: The ticker tile

**Files:**
- Modify: `js/ticker.js:50-68` (the comment and the `warns` tiles), `js/ticker.js:74`,
  `js/ticker.js:86` and `js/ticker.js:136-137`

**Interfaces:**
- Consumes: `state.notices`, `NOTICE`, and the `data-banner` contract from Task 3.
- Produces: nothing new. The strip reuses the handler that already exists.

- [ ] **Step 1: Build both tile sets**

In `js/ticker.js`, replace lines 50 to 68 — the comment and the `warns` constant:

```js
  /* Regional notices lead the strip, an outage ahead of a weather warning. Each tile carries the
     full sentence, not a clipped one: the strip has one line and nothing under it to crowd, unlike
     the panel row in alerts.js.
     A tile carries data-banner and no data-go. Neither kind is a station, so neither opens a card.
     The same [data-banner] click in js/ui.js serves this tile and the panel row alike.

     A warning rides here only while `fresh` — the first WARN_FRESH hours of its own validity,
     scored in sources.php because MET stamps Malaysian wall clock with no offset. The panel keeps
     listing it for the whole window. A warning valid for three days would otherwise repeat here for
     three days, which is the standing banner the alert design standard exists to prevent.

     An outage carries no such filter and needs none. This server re-detects it on every poll, so it
     rides here only while the source is still serving its notice, and it leaves the poll the tables
     parse again. A timer would take it off the one surface that is never covered, while the map is
     still degraded.

     Each index is captured before its filter, so it stays the index into the list the click handler
     reads. Renumbering after would open the wrong item, or none. */
  const tile = (kind, icon, c, title, why, i) =>
    `<button class="tk-i tk-warn" data-banner="${kind}:${i}" tabindex="-1">
      <i class="i i-${icon}" style="--c:${c}"></i>
      <b>${esc(title)}</b><span class="tk-why">${esc(why)}</span>
      <span class="tk-dot">•</span>
    </button>`;

  const notes = state.notices
    .map((n, i) => [NOTICE[n.id], i])
    .filter(([t]) => t)                   // an id this build has no words for says nothing
    .map(([t, i]) => tile('notice', 'public_off', 'var(--k-source)', t.title, t.line, i));

  const warns = state.warnings
    .map((w, i) => [w, i])
    .filter(([w]) => w.fresh)
    .map(([w, i]) => tile('warn', 'rainy_heavy', 'var(--k-weather)', w.title, w.text, i));

  const banners = notes.concat(warns);
```

Add `NOTICE` to the `config.js` import at line 15, which currently reads
`import { KINDS, HOTLINES } from './config.js';`.

- [ ] **Step 2: Keep the quiet state honest**

In `js/ticker.js`, line 74 currently reads:

```js
  if (!hot.length && !warns.length) {
```

Replace it with:

```js
  if (!hot.length && !banners.length) {
```

An outage with no hot station must still move the strip. Leaving `warns` here would show `No alerts`
during an outage, which is the exact sentence this feature exists to prevent.

- [ ] **Step 3: Put them at the head of the set**

In `js/ticker.js`, line 86 currently begins:

```js
  const items = warns.concat(hot.map(s => {
```

Replace `warns` with `banners`:

```js
  const items = banners.concat(hot.map(s => {
```

- [ ] **Step 4: Fix the pacing comment**

In `js/ticker.js`, the comment at lines 136 and 137 names `warns`. Replace those two lines:

```js
  // items.length, not hot.length: a banner with no hot station still fills the strip and needs
  // a real pace. hot.length alone divides by zero on a banner-only poll.
```

- [ ] **Step 5: Check it**

```bash
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
grep -rn "data-warn" js/ index.html || echo "no data-warn left anywhere"
```

Expected: no `FAIL` lines, and `no data-warn left anywhere`.

Hard-reload and confirm, with the outage live:

1. The strip leads with the outage tile, then any *fresh* weather warning, then the stations.
2. The tile's glyph is the struck-through globe in slate.
3. Clicking it opens the same modal the panel row opens.
4. The strip scrolls smoothly with no jump at the wrap.

- [ ] **Step 6: Commit**

```bash
git add js/ticker.js
git commit -m "The strip says the source is down before it says nothing is wrong"
```

---

### Task 5: A knob, so it can be seen on a day JPS is up

**Files:**
- Modify: `js/test.js` — a constant near the other `*_EVERY` constants, and a line in `seedTest()`

**Interfaces:**
- Consumes: `state` (already imported at `js/test.js:17`), `state.notices` from Task 2.
- Produces: nothing other tasks read.

- [ ] **Step 1: Add the constant**

In `js/test.js`, insert after the `CAM_EVERY` constant:

```js
/* Test mode fakes an outage too. Anything that alerts needs a knob here or it ships unseen, and this
   one is otherwise visible only while JPS is actually down — which is a few hours a year, and never
   when somebody is looking at the panel on purpose. The id must be a key of NOTICE in config.js. */
const TEST_NOTICE = { id: 'publicinfobanjir', regions: ['Kuala Lumpur', 'Putrajaya'] };
```

- [ ] **Step 2: Seed it**

In `js/test.js`, find `export function seedTest(data) {` at line 106. Insert directly after the line
declaring the counters, `let rivers = 0, sirens = 0, rains = 0, gauges = 0, offline = 0;`:

```js
  /* The client's copy only, exactly like every other fake here. `state.notices` is overwritten and
     not appended to, so a real outage during a drill is replaced rather than doubled. The next poll
     with the switch off restores whatever the payload actually said. */
  state.notices = [TEST_NOTICE];
```

- [ ] **Step 3: Check it**

`net.js` sets `state.notices` at Step 3 of Task 2 and calls `seedTest()` four lines later, so the
fake lands after the real value and before anything renders. Confirm that order:

```bash
grep -n "state.notices\|seedTest" js/net.js
```

Expected: the `state.notices` assignment on a lower line number than the `seedTest` call.

```bash
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
```

Expected: no `FAIL` lines.

Then hard-reload, open About and turn test mode on. Confirm:

1. The `Service Notice` card and the ticker tile appear whether or not JPS is down.
2. The badge, the tab title and the tally glyphs still count stations only, with 60-odd fake alerts
   on screen.
3. Turning test mode off and waiting one poll returns the panel to whatever is real.

- [ ] **Step 4: Commit**

```bash
git add js/test.js
git commit -m "A drill can raise an outage on a day the source is fine"
```

---

### Task 6: Write it down

**Files:**
- Modify: `docs/FEATURES.md` — append a section
- Modify: `CLAUDE.md` — the file table row for `js/config.js`, and the gotcha added with `pageHasData()`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing code reads.

- [ ] **Step 1: Append the feature section**

Append a `## An outage the source announced` section to `docs/FEATURES.md` covering, in this order:

- What happened on 2026-08-12: the notice under HTTP 200, `national.applied` falling from 71 to 47,
  and nothing on screen saying so.
- What the notice says, translated, and the three facts that shaped the design: high traffic rather
  than a window, no end time, and the channels it names.
- Why a notice counts toward nothing, citing the same reason `warnCard()` gives.
- Why an outage outranks a weather warning.
- The table of the alert design standard checks, copied from
  `docs/superpowers/specs/2026-08-12-upstream-notice-banner-design.md`.
- A `### Deliberately not built` block: no duration, no embed of the image, no rule for a silent
  hang, no toast, no all-clear, no second recogniser, and no App Store link with the reason.
- A `### What breaks it` block: JPS changing the notice title makes `noticeOf()` return null, the
  banner never appears, and `sources.stale` still reports the feed. The failure is silence rather
  than a wrong claim, which is the correct direction.

- [ ] **Step 2: Update CLAUDE.md**

Two edits.

In the file table, the `js/config.js` row currently reads
`constants (kinds, palettes, thresholds, tile styles). No imports.` Add `Also `NOTICE`, the words for
an upstream outage.` to it.

In the gotcha that starts **A page-cache row that never answers can never advance its own
timestamp**, add a closing sentence: a notice the app can name is published as `notices[]` and shown
to the reader, and every other failure stays in `sources.stale`.

- [ ] **Step 3: Check the prose**

```bash
python "C:/Users/illus/.claude/ste-lint.py" < docs/FEATURES.md
python "C:/Users/illus/.claude/ste-lint.py" < CLAUDE.md
```

Both files are long and carry existing counts. Compare against `git stash`-ed originals if the totals
are hard to read, or lint only the new section by pasting it into a scratch file. A list of more than
six items raises a false `long_paragraph` count — ignore that one.

- [ ] **Step 4: Run every check**

```bash
php -l api.php && php -l sources.php
php api.php --selftest
php shots-test.php
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
for f in js/*.js css/*.css; do
  curl -sk -o /dev/null -w "%{content_type} $f\n" "https://flood-exp.test/$f"; done | grep -v 'javascript\|css'
```

Expected: `all ok`, `all passed`, no `FAIL` lines, and no output from the last loop.

- [ ] **Step 5: Commit**

```bash
git add docs/FEATURES.md CLAUDE.md
git commit -m "Write down the outage the map used to draw as a normal day"
```

---

## Self-review

**Spec coverage.** Every section of the design maps to a task. Detection and the region map are Task
1. The payload shape is Task 1 Step 6. The client data path and the glyph are Task 2. The panel, the
modal and the colour rule are Task 3. The ticker is Task 4. Test mode is Task 5. The alert standard
table and the not-built list are Task 6.

**Names used across tasks.** `noticeOf()`, `NOTICE_REGION`, `notices[]`, `NOTICE`, `state.notices`,
`bannerCard(list, kind)`, `data-banner="<kind>:<index>"`, `--k-source`, `.noticegrp`,
`.i-public_off`, `TEST_NOTICE`. Each one is defined in the task that first uses it, and every later
use matches that spelling.

**Two defects found and fixed.** The first draft of `bannerCard()` carried
`${kind === 'notice' ? t.text : t.text}`, a ternary with identical branches — both kinds do carry
`title` and `text`, so the lookup by id is the only thing that differs and it already happens a line
earlier. The first draft also named the region helper `list`, which `js/ui.js` already binds at lines
507 and 702.

**One thing to watch.** `bannerCard()` and the ticker's `tile()` both read a notice through
`NOTICE[id]` and a warning through the payload item. Both shapes must keep `title` and `text`. The
ticker additionally reads `line`, which only `NOTICE` has, and falls back with `?? text`.
