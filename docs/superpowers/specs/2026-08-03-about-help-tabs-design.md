# About and help, in two tabs

Date: 2026-08-03
Status: approved. Implementation has not started.

## What this changes

The About dialog holds two panes. The first pane says what this site is, who runs it and where the
data comes from. The second pane says how to use the map. It also gives the words, the reasons and the limits.

No new dialog. No new button in the app bar. The `#about` button opens the same `<dialog>` it opens
now.

## Why

The About dialog is already a help document. It explains the alert rules, the pin legend, the two
heatmaps and the three sources. It does not explain a single control. A reader cannot find out how
to ignore a sensor. The camera archive and the district filter are the same.

The dialog is also one scroll of 140 lines. More prose in the same scroll makes it worse.

## Prior art

Four patterns are common. Two of them apply here.

1. **About is a leaf of Help.** The desktop Help menu ends with About. Documentation and
   Keyboard Shortcuts come above it. About holds the version, the licence and the credits.
   Help holds the substance. This design follows that split.
2. **Large web apps host Help outside the app.** Google Maps, Flightradar24 and OpenStreetMap each
   run a separate help site. This site has no support team and no ticket queue, so an in-app dialog
   is the only option.
3. **A `?` key opens a keyboard shortcut sheet.** This site has four bindings. All four are in one
   dialog. All four are already printed on the buttons that use them. This design does not build a sheet.
4. **Explain a thing where it happens.** A legend on the map beats a legend in a document. This
   site already does this. The station card prints `OFFLINE`. The meter draws the danger mark. The
   siren card prints `OUT OF CONTACT`. Help covers only what has no such place.

Pattern 4 removes two things from the plan. See "What this change deletes" below.

## Structure

The dialog gets one new row, between `.modalhead` and the logo.

```
+------------------------- [Test mode] [x] -+   .modalhead, unchanged
|  [ About ]  Help                          |   NEW: .tabs
|-------------------------------------------|
|  logo, then the pane                      |
+-------------------------------------------+
```

The logo moves inside the About pane. It is the identity of that pane, not of the dialog. A reader
who opens Help lands on the first line of help. A logo above both panes costs 76 pixels of scroll on
a phone before any help text.

### Markup

```html
<div class="tabs" role="tablist">
  <button role="tab" id="tabAbout" aria-controls="paneAbout" aria-selected="true">About</button>
  <button role="tab" id="tabHelp"  aria-controls="paneHelp"  aria-selected="false">Help</button>
</div>
<div id="paneAbout" role="tabpanel" aria-labelledby="tabAbout">...</div>
<div id="paneHelp"  role="tabpanel" aria-labelledby="tabHelp" hidden>...</div>
```

The tab order is About, then Help. The dialog opens on About. Help holds most of the
words. The not-official warning and the 999 line still come first. That is a safety decision, and it outranks the convention in pattern 1.

The `#about` button keeps its icon. Its `title` and `aria-label` become `Help and about`, because a
help section nobody can find is not a help section.

### Behavior

About six lines in `js/ui.js`, beside the existing `aboutBox` wiring:

- One delegated `click` listener on `.tabs`. It sets `aria-selected` on both buttons and toggles
  `hidden` on both panes.
- The listener resets `aboutBox.scrollTop` to 0. A reader who switches tabs must land at the top of
  the new pane.
- `aboutBox.onclose` resets the dialog to the About pane. The dialog always opens where this
  document says it opens. This stores nothing in `PREFS`.

There is no roving `tabindex`. The ARIA authoring practice makes a tab list one stop and moves
between tabs with the arrow keys. With two tabs that makes the second tab harder to reach than a
plain Tab press. A `ponytail:` comment records this.

### Style

About twelve lines in `css/chrome.css`, next to the `#aboutBox` rules. The strip is a row of two
text buttons. The selected tab takes `--on-surface` and a 2px bottom border in `--accent`. The other
takes `--muted`. Both use tokens. The rule holds no hex.

`#aboutBox .modalhead { justify-content: flex-end }` stays as it is. The tabs are their own row.

Bump `?v=` on the `chrome.css` link in `index.html`.

## What each pane holds

### About

1. The logo lockup.
2. What this site is. Unchanged.
3. Why it exists. Unchanged.
4. The `.notice` block: not an official warning channel, call 999, the APM link. Unchanged.
5. `How this was built`: new. See below.
6. `Where this data comes from`: the three `.src` blocks and the paragraph about which feed wins.
   Unchanged.
7. `Credits`: the author, the licence, the tiles, the icons, Leaflet. Unchanged.
8. `Developer`: new. See below.

### Help

In this order:

1. **How to use the map.** New. About eight rows.
2. **How to read the map.** Moved from About. The pin legend only. The heading gains `How to`,
   to match the section above it. The prose below the heading does not change.
3. **What puts a station on alert.** Moved from About. Unchanged.
4. **Words on this map.** New. About ten terms.
5. **Why it does that.** New. Three rows.
6. **What it cannot tell you.** New. About six rows.

Every new section uses the existing `.key` grid: the term on the left, one sentence on the right.
This adds no new layout.

## Content

### How to use the map

Only what a tap does not teach. The list does not say "tap a pin".

| row | says |
|---|---|
| Ignore a sensor | The three-dot menu on any station card. The sensor stays on the map and raises no alert. The drawer keeps the count and can undo it. |
| Check where a reading came from | The same menu names the feed. It prints the stamp on the last reading. It says whether the station still answers. |
| Look back at a camera | Tap the picture on a camera card. The player opens three hours back. Drag the divider to compare that frame against the live one. |
| Show only what is climbing | A chip in the drawer. It leaves only the stations climbing towards their danger mark. |
| Show one district | The Districts list in the drawer. |
| Read a point on a graph | Move the pointer over the graph. On a phone, hold a finger on it. The reading and its time appear above the line. |
| See every station at once | The list button in the app bar. The table sorts, filters and groups by district. |
| Install it | The browser offers to install this site. It then opens without browser chrome. It still needs a connection. |

One more row holds the player keys. `k` or space plays. `,` and `.` step one frame. `End`
returns to the live picture.

### Words on this map

About ten terms. Each gets one sentence.

- `alert mark`, `warning mark`, `danger mark` — the three levels JPS publishes for one station.
  Every station has its own set.
- `rising` — forecast to reach its own danger mark within three hours.
- `mast` — one pole that carries more than one sensor.
- `site` — sensors within 50 metres. The map draws one pin for a site.
- `stale` — the station was on alert, and has since gone quiet.
- `offline` — no reading arrived.
- `water level` — the height of the river against a fixed datum.
- `flood-depth gauge` — the depth of water over a spot that floods. A negative reading is dry
  ground.
- `intensity class` — the rainfall bands JPS publishes: above 0, 10, 30 and 60 mm in the last hour.
- `frame` and `tier` — one stored camera picture, and how long the archive keeps it.

### Why it does that

Three rows. Each covers behavior the interface cannot explain at the point it happens.

| question | answer |
|---|---|
| The map is empty and says it cannot load. | This site refuses to draw a map it cannot refresh. A water level from an hour ago is worse than none during a flood. |
| The reading is twenty minutes old. | JPS updates a station about every 25 minutes. The time in the menu is the time JPS took the reading, not the time this site fetched it. |
| The camera picture is not from now. | The card plays the last three hours. The lightbox opens three hours back. Press the live button to return to now. |

The interface answers anything else a reader asks, on the thing itself. A grey pin opens a card
that says why it is grey. A silent siren says `OUT OF CONTACT`. Those do not get a row here.

### What it cannot tell you

About six rows.

- Cameras, sirens and flood-depth gauges cover Selangor only. JPS publishes none for Kuala Lumpur
  or Putrajaya.
- The national portal publishes rainfall, but not in a form this site can read. Rainfall comes from
  the two other feeds.
- The graphs hold twelve hours. There is no longer history on screen.
- This site sends no notification. It must be open to warn you.
- This is not a rainfall forecast. JPS measured every number on this map. JPS predicted none of them.
- A station JPS does not publish is not here.

## The "How this was built" section

A new `<h3>` in the About pane, directly under the `.notice` block. It sits there because it makes
the same kind of statement as the notice. Both tell a reader how much weight this site carries.

Four short paragraphs, then two links.

> **How this was built**
>
> This site is vibe coded. An AI wrote most of it, over a few evenings. It exists because reading
> three government pages to answer one question about my own river was absurd.
>
> It started as Selangor alone. I work in Kuala Lumpur, so I added that too, and Putrajaya arrived
> on the same feed. A Selangor map became a Klang Valley one. The repository still carries the
> first name.
>
> So there is no team behind it, and no warranty. It can be wrong. The code is open. Read it, and
> tell me what I got wrong.
>
> It keeps no account, runs no analytics and sets no cookies. It loads nothing from a third party.
> Your location, if you share it, stays in the browser. Nothing sends it anywhere.
>
> **Source code** — the whole site, and the scrapers behind it.
> **Report a mistake** — a wrong reading, a station in the wrong place, a page that will not load.

### The scope paragraph earns its place twice

It tells the origin story. It also answers a question the Source code link creates. The repository
is `selangor-flood-tracker`. The app is `Klang Valley Flood Watch`. A reader who follows the link
meets that mismatch at once, and this paragraph is the answer to it.

The claim about Putrajaya is accurate. `CLAUDE.md` records that the SPHTN feed carries Kuala Lumpur
and Putrajaya together. Putrajaya needed no third integration.

This paragraph does **not** go in the existing "why it exists" paragraph, which a reader finds one
screen above. That paragraph makes one point: the three portals hold pieces and none of them plot
them together. Scope history in the middle of it costs the point its edge.

### Why here and not in Credits

The complaint about the official pages is already in About, one paragraph up. It reads: "The
official portals each hold a piece of it and none of them plot it together." That is the same point
with the evidence attached, so this section does not repeat it. This section adds the one fact
About never stated: a machine wrote the code.

Credits keeps its byline, and the byline keeps its link to the GitHub profile of the author. The repo
link is an action, not a credit, so it goes here beside the issues link.

### Claims to check before this ships

Each of these is true today. Each can stop being true.

| claim | how to check |
|---|---|
| no analytics | `grep -rn "gtag\|plausible\|umami\|analytics" index.html js/ sw.js` returns nothing |
| no cookies | `grep -rn "document.cookie" js/` returns nothing. `PREFS` uses `localStorage` |
| nothing from a third party | `CLAUDE.md` bans a CDN. Every asset is in `vendor/` |
| location never leaves the browser | `js/locate.js` draws a marker. `api.php` takes no coordinates |

The last claim is the strongest one on the page, because this site asks for a location. Anything
that ever posts a coordinate must delete that sentence in the same change.

### Markup

Two `.src` blocks, the same pattern the three source links already use: a bold link, then one muted
line. This adds no CSS.

## The Developer section

The last section of the About pane. It holds the test-mode toggle, the numbers behind the last
poll, and three actions.

The test-mode toggle **moves here** out of `.modalhead`. Its old comment gives the reason for the
old spot: a mode and its exit belong within reach of each other. The tabs weaken that reason. The
toggle now sits under a heading that names what it is, and the close button is one scroll away
rather than one line away. The amber test-mode strip across the top of the page is the thing that
gets you out, and it stays.

### Diagnostics

The same three facts `#netstats` shows, plus the source counters:

| line | from |
|---|---|
| last poll, and how long it took | `tookMs` |
| cache age, and whether upstream answered | `cacheAge`, `upstreamOk`, `offline` |
| the stamp upstream put on the data | `sourceUpdated` |
| per feed: requested, parsed, applied | `details`, `sources` |

`#netstats` opens on hover on a desktop. A phone cannot hover, so it reaches these numbers through
`.open` on `#net` and a tap. This section is the plain-language second route, and it is the only
place the per-source counters appear at all. `CLAUDE.md` names those counters as the alarm for a
scraper that broke: `parsed: 0` means a table moved upstream. That alarm had no surface.

One function builds both. `ui.js` gains a renderer that takes a mount point and a flag for the
counters. `#netstats` and this block both call it. Two copies of the same table drift apart.

### Actions

Three buttons.

| button | does | guard |
|---|---|---|
| Refresh now | `GET api.php?force=1`. Treats the five-minute file cache as expired. | See below. |
| Raw payload | Opens `api.php` in a new tab. | None needed. The endpoint is already public. |
| Reset settings | Removes the `prefs` blob and reloads. | A native `confirm()` names what it drops. |

**Raw payload** costs no new code. The endpoint exists and serves the cache.

**Reset settings** drops the theme, the district filter, the layer chips and `PREFS.ignored`. The
`confirm()` says so. Dropping `ignored` un-silences every silenced sensor. That fails in the safe
direction: it can only add alerts, never hide one.

**Refresh now** is the one with teeth. A rebuild is about 270 requests at JPS, and this button is
public. Four rules, and all four hold server-side, because a guard in the browser guards nothing:

1. It runs **inside the existing `flock` on `.refresh.lock`**. It is not a second path. If another
   rebuild holds the lock, this request serves stale cache and does not queue, the same as any
   other loser of that race.
2. It does **not** expire the page cache. The scraped KL and national pages keep their fifteen
   minutes. That cache exists because the KL rainfall table takes about ten seconds upstream.
   A full re-scrape triples the cost of the button.
3. A stamp file allows **one force per sixty seconds**, for the whole site, not per visitor. A
   denied force serves the cache and says why in the response.
4. `api.php` reads `?force=1` from a `GET` only. It changes nothing on disk except the cache it
   rebuilds and its own stamp.

Rule 3 bounds the worst case at 270 requests per minute, or about 4.5 per second. A normal cold
rebuild already fires 270 in about three seconds, which is 90 per second. The button therefore
cannot produce a burst the site does not already produce on a cold start.

The response reports what happened, so the button can say `refreshed`, `served from cache` or
`another refresh is running` instead of flashing and looking broken.

### Trade-offs accepted

- The section is public. Anyone can open it and press Refresh now. A password or a query flag adds
  an auth surface to a site that has none. The server-side rate limit
  is the guard, and it holds whoever presses the button.
- Test mode is one scroll further from the close button than it was.
- The diagnostics duplicate `#netstats` on screen, but not in code. One renderer feeds both.

## What this change deletes

**The heatmap ramps.** `#legend` on the map draws three things from live values. They are the
water ramp, the rain ramp and the opacity slider. The `.ramps` block in the About prose is a second copy of the same scale.
Two copies drift. The live one stays. The two paragraphs beside it move to Help as prose, without the
swatches. They say what each heatmap measures, and why only one runs at a time.

**Five of the eight planned FAQ rows.** Each restated a sentence the interface already prints. See
"Why it does that".

## Prose

New prose follows ASD-STE100 loosely: active voice, one instruction per sentence, no semicolons, no
contractions. Run `ste-lint.py` over it before you report the work as done.

This change does not rewrite moved prose. The alert rules and the pin legend read well and carry no defect.
This change did not ask for that rewrite. The Help pane therefore holds a mixed register.
We accept that.

## Files

| file | change |
|---|---|
| `index.html` | the tab strip, two pane wrappers, the moved sections, the new sections, the Developer section, the `?v=` bump, the `#about` label |
| `css/chrome.css` | about twelve lines for `.tabs`, plus the Developer block |
| `js/ui.js` | the tab listener, the reset on close, the shared stats renderer, the three action buttons |
| `api.php` | `?force=1`, inside the existing lock, with the sixty-second stamp |
| `docs/FEATURES.md` | an entry for this change, with the trade-offs above |

## Verify

- `node --check` every module, through the `.mjs` copy step in `CLAUDE.md`.
- Every `js/` and `css/` file still serves with the right content type. Herd answers a missing file
  with `index.html` and a 200, so check the type and not the status.
- Open the dialog. Both tabs switch. Both panes scroll from the top.
- Close and reopen the dialog. It opens on About.
- Tab through the strip with a keyboard. Both buttons take focus. `aria-selected` follows.
- Check the dialog at 360px wide. The tab strip and the test-mode toggle do not collide.
- Check both themes. The new rule must hold no hex.
- `python ste-lint.py` over the new prose.
- Re-run the four greps under "Claims to check before this ships". All four must still hold.
- Follow both new links. The repo and the issues page must both resolve.
- Press Refresh now twice inside a minute. The second press must serve cache and say so.
- Hold `.refresh.lock` from a shell, then press Refresh now. It must serve stale cache at once.
- `php -l api.php` after the `?force=1` branch lands.
- Compare the Developer numbers against `#netstats` on the same poll. They must agree.

## Not built

- No search inside Help.
- No URL fragment that deep-links to a pane.
- No memory of the last pane opened.
- No third tab.
- No separate wiki page or external help site.
- No `?` keyboard shortcut sheet.
- No first-run tour or coach marks.
- No version number or build date. The Pages bake publishes none, and a stale one misleads.
- No changelog. Nothing feeds it.
- No uptime or accuracy claim. I cannot back either one.
- No password or hidden flag on the Developer section.
- No force that expires the page cache as well.
- No queue behind the refresh lock. A loser serves stale cache, as it does now.
