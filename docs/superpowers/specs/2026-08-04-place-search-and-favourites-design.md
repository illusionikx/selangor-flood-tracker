# Place search and favorites — design

Date: 2026-08-04
Status: approved, ready to plan

## Spelling

This app uses American spelling everywhere. This document, every new string and every string it
touches follows that rule.

The interface holds British spellings today. Convert every user-facing one as part of this work.
The set is small, because most of the 502 matches in the repository sit in comments and in
documentation.

| file | what to convert |
|---|---|
| `index.html` | the Help pane and the About pane: colour, coloured, colours, grey, metres, neighbours, licence |
| `js/locate.js` | the `Recentre on my location` title string |
| `js/alerts.js`, `js/popup.js`, `js/render.js`, `js/table.js` | any British word inside an output string, a `title` or an `aria-label` |

Two rules for the conversion:

1. Convert output strings only. Leave comments and documentation alone. A 500-line spelling sweep
   inside a feature diff makes the feature impossible to review.
   The remaining 480 matches sit in `CLAUDE.md`, `docs/FEATURES.md`, `docs/DEPLOY.md`, `README.md`
   and inline comments. Sweep them in one commit **after this feature ships**. Do not start that
   sweep earlier, and do not fold it into any commit below.
2. Never touch an identifier, a CSS property or an HTML attribute. `aria-labelledby` is an
   attribute name. `color` is already the CSS property.

One collision to watch. `meter()` in `popup.js` draws the water-level bar. The unit becomes
"meters" after this change. Prefer the symbol `m` in a new string, so no reader has to tell the
component from the unit.

## Problem

The go-to box searches the station list and nothing else. A reader who wants the water level near a
housing area must first know which station covers it. Most readers do not.

The same box lists one row per sensor. The map draws one pin per site. A six-sensor mast is
therefore six rows and one pin. The list and the map disagree about what a result is.

There is also no way to mark the stations a reader cares about. `PREFS.ignored` can silence a
sensor. Nothing can raise one.

## Goals

1. Find any place in the coverage area, then show the sensors near it.
2. Make the search list match the map, one row per site.
3. Let a reader mark a sensor or a mast as a favorite, then find it again fast.

## Non-goals

- Favorites must not suppress an alert. `PREFS.ignored` stays the one suppression control.
- No routing, no directions, no address autocomplete.
- No place search on the GitHub Pages build. That build has no PHP.

---

## Part 1 — Place lookup, server side

### Endpoint

`api.php?place=<query>` joins `?cam=`, `?shots=` and `?shot=` on the existing entry point. The file
already owns every outbound request. It already holds the curl rule, the page cache and a
rate-limit pattern.

### Input

Trim the query. Reject it below 2 characters. Cap it at 80 characters. The query never builds a
path or a URL. It becomes one query-string parameter to one fixed host. The `?cam=` rule holds by
construction.

### Upstream

Call `https://nominatim.openstreetmap.org/search` through curl. Never use `file_get_contents()`.
See the gotcha about the dead A record.

Parameters:

| parameter | value | why |
|---|---|---|
| `format` | `jsonv2` | stable field names |
| `limit` | `8` | one screen of results |
| `countrycodes` | `my` | Malaysia only |
| `viewbox` | the coverage box | see below |
| `bounded` | `1` | drop hits outside the box |

Nominatim requires an identifying `User-Agent`. Send one that names the app and its repository.

### Coverage box

One constant in `api.php`. It covers Selangor, Kuala Lumpur and Putrajaya.

The 673 stations in `.cache.json` span latitude 2.6088 to 3.8470 and longitude 100.8229 to
101.9215. The box adds about 0.1° of margin on each side, so a place at the edge of the coverage
area still resolves.

Nominatim takes `viewbox` as `west,north,east,south`. The value is therefore
`100.72,3.95,102.02,2.50`.

`api.php` publishes the box in the payload. The client words its own "outside the area" message
from those numbers. A second copy of the box in a JS file goes stale.

### Cache

Store each result in the `page` table of `.history.db`. Use a 30-day TTL. Place names do not move.
A repeat search must never reach OpenStreetMap twice.

Key it on the normalized query. Normalize it server-side: lowercase it, then collapse every run of
whitespace to one space. Do not reuse the client's `squash()`. That function strips punctuation to
match station names, and it is not a cache key.

### Rate limit

Copy the shape of `forceAllowed()`. Use a site-wide stamp file. Allow one uncached lookup per
second. A cached hit skips the limit.

Over the limit, return HTTP 429 and a reason string. This is not politeness. An unlimited public
proxy to Nominatim is an open relay. It gets our address blocked.

### Response

```json
{ "places": [ { "name": "…", "detail": "…", "lat": 3.14, "lon": 101.61 } ], "error": null }
```

`name` is the primary label. `detail` is the district and the state. Keep nothing else. The raw
Nominatim response is large. Its shape changes between versions. The client must not depend on a
schema we do not control.

### Offline check

Add cases to `php api.php --selftest` for the query validator and the rate limit. Put them beside
the two checks that file already runs. The new cases use arithmetic only and touch no network.

---

## Part 2 — The search box

### What stays

`search()` keeps its instant substring filter over `state.data`. It keeps `squash()`, `hay()` and
`termsOf()`. It keeps the district grouping and the `Nearest station to me` row.

### One row per site

Build the rows from sites, not from stations. Group on `s.site || s.id`, the same key `render()`
groups on. This gives about 417 rows instead of about 680.

A row shows:

- the lead sensor's name, from the same `leads()` call that names the pin
- the district and the state below it
- a `layers` count chip where the site holds more than one sensor
- a `★` where any sensor at the site is a favorite

One `leads()` call for both surfaces makes sure the list and the map print one name per place.

The haystack for a site is the union of its members' haystacks. Typing `camera` still lists every
place that has a camera. Typing a river's name still finds the mast it sits on.

### Sensor sub-rows

A multi-sensor row carries a chevron. Clicking the chevron toggles the row. It does not pick the
row.

An expanded row lists its sensors below it, indented. Each sensor row shows its kind glyph in its
`--k-*` color, its kind label and its own name. A favorited sensor row carries a `★`.

Hold the open site keys in a `Set`. Clear the set whenever the query changes. A tree left half-open
under a replaced list is stale furniture.

### Keyboard

- `ArrowDown` and `ArrowUp` walk the visible rows only. This needs no new code.
- `ArrowRight` expands the selected row.
- `ArrowLeft` collapses it.
- `Enter` picks the selected row.

### Picking

Both a site row and a sensor sub-row open the same panel card. `flashTo()` resolves through
`siteMark`, and there is one card per site.

A sensor sub-row does one more thing. It scrolls that sensor's block into view inside the card and
flashes it. Add a `data-sensor` attribute to each `.sensor` block in `sitePopup()` to anchor on.

This is safe against the refresh pass. `openSide()` resets `scrollTop` only when the key changes.
A poll that arrives while a reader reads must not throw them back to the top.

**Rejected:** a card per sensor. There is one card per site by design. The site card already shows
every reading of every sensor there.

### Favorites group

With the field empty, a `FAVORITES` group sits at the top of the list. It sits above
`Nearest station to me`. It lists favorited sites.

A site appears in the group when any sensor there is a favorite. This is the same rule the pin
badge and the map filter use. All three surfaces answer one question.

The group disappears once the reader types. The district grouping is the answer then. A favorite
that matches the query already appears in it.

### The place-search row

Below the station hits sits one row: `Search the map for "bandar utama"`. It carries a search glyph
in `--accent`.

The row is part of `hits`. The existing arrow-key and `Enter` handling reaches it with no new
keyboard code.

Picking the row calls the endpoint. Nothing leaves the browser before that. Nominatim's policy
forbids per-keystroke autocomplete, and this respects it outright.

### States

| state | what the list shows |
|---|---|
| idle | the trigger row, below the station hits |
| in flight | the row reads `Searching…`, and the station hits stay above it |
| results | a `PLACES` group above the station groups, up to 8 rows, trigger row gone |
| empty | `No place by that name in Selangor, Kuala Lumpur or Putrajaya` |
| refused | `Too many searches just now — try again in a moment` |
| failed | `Place search is unavailable` |

A slow lookup must never blank results the reader is already reading.

Typing again clears the places and restores the trigger row. A place result belongs to the query
that fetched it. Stale hits under a changed query are the same lie a stale reading is.

### Two guards

1. A generation counter, the same shape `clip.js` uses. A slow response for an abandoned query must
   not paint over a newer one.
2. On the GitHub Pages build the trigger row never renders. Gate it on `STATIC`, the same gate
   `devForce` uses. `?place=` returns a 404 there.

---

## Part 3 — The place card

### One builder for two cards

`herePopup()` already assembles "what is near this point". It shows the nearest camera picture,
then one section per kind with the full sensor body. Each section carries its own name, district
and distance.

Generalize it to `nearPopup(latlng, head, capKm)`. The two callers differ only in the head they
pass. Keep `herePopup()` as a thin wrapper, so `locate.js` needs no change.

### The head

The place name leads. The district and the state sit muted below it. A badge in `--accent` carries
the `place` glyph.

This is the same three-part `.pophead` every card opens with. `openSide()` lifts `.pophead` into
`#sideHead`, and that seam must not move.

The panel key is `@place`. It joins `@here` and `@alerts` under the rule that a `@` key keeps
`render()`'s refresh pass off the card.

### Radius cap

Add `NEAR_MAX_KM` (10) to `config.js`. It bounds river, rainfall, siren and gauge.

The camera keeps `CAM_MAX_KM` (5). That cap already lives in one place. It already means one
thing — whether "the river in this picture" is a claim this app can make.

10 km is about the width of a district here. Past it a gauge stops sharing a catchment with the
reader.

Past the cap a section prints `no river gauge within 10 km`. This matches the shape of the existing
`no rainfall reporting` line.

**The cap applies to `@here` too.** One function must follow one rule. A siren 60 km from a reader
was never a useful answer. Two cards built by one function must not say different things.

### The pin

Drop one marker at the picked coordinate. Use the `location_on` glyph in `--accent`. Anchor it at
its tip, like the `me` pin.

Draw no accuracy circle. A geocode has no accuracy to state.

The pin persists until the reader picks another place. Closing the card does not clear it. The `me`
pin behaves the same way.

Use a plain `L.Marker`. `L.Path` bubbles its clicks to the map and `L.Marker` does not. This pin
must never close the card.

### Color

`--accent`. A searched place is not a sensor. It has no status and no kind, so it takes neither
color language.

---

## Part 4 — Favorites

### Storage

`PREFS.favs` holds an array of station ids. It has the same shape as `PREFS.ignored` and lives in
the same blob.

Add `favIds()` and `isFav(s)` to `util.js`, beside `ignoredIds()` and `isIgnored()`.

### A sensor cannot be both

Favoriting an id removes it from `ignored`. Ignoring an id removes it from `favs`.

"Show me this first" and "never show me this" is not a state a person meant to be in. If the code
picks a winner at read time, one of the two controls silently does nothing.

### Controls

**Per sensor.** Add a second item to the ⓘ menu that already holds Ignore. The two actions belong
together. The item reads `Favorite this sensor` or `Remove from favorites`, with a star glyph.

**Per mast.** Add a `★` button to the mast card's header. It reads filled **only when every sensor
at that mast is a favorite**.

Pressing it when it is not full favorites every sensor there. Pressing it when it is full removes
every sensor there.

### Surfaces

1. **Search box.** See Part 2.
2. **Drawer panel.** `Favorite sensors`, built like `Ignored sensors`. Same list markup. A count
   on the `<summary>`, so a collapsed section still reports what it holds. A per-row remove and a
   clear-all. Always drawn. When empty it names the ⓘ menu.
   This panel lists **one row per sensor**, not one row per site. The search box groups by site
   because it matches the map. This panel manages the saved list itself, so it must show every id
   the list holds. A reader who starred one gauge of six needs to see which one.
3. **Map filter.** A `Favorites only` chip beside the layer chips. It stores `PREFS.favOnly`. It
   calls `render()`, not `syncCluster()`. `render()` builds sites after it filters, so a partly
   favorited mast draws a pin holding only its favorited sensors. The district and layer filters
   already behave this way.
   Disable the chip when the reader has saved no favorites. A filter that empties the map without
   an explanation reads as a bug.
   When the chip is on, `#shown` appends `· favorites only`. That line already carries
   `· N ignored`. It is the line the eye lands on to ask why the map is this empty.
4. **Alert panel order.** Inside each card, favorite rows sort first. The existing order holds
   below them. Each such row carries a small `★`, so the order explains itself.

### Map

**The pin badge.** The pin html is a `.pin` span holding one glyph. A mast pin also holds
`<b class="n">`. Add one more child, a small `★` corner badge in `--accent`. Position it clear of
`.n`, so a favorited six-sensor mast shows both its count and its star.

The badge fills when **any** drawn sensor at that site is a favorite. This is not the mast header's
rule, and the difference is deliberate.

The header `★` is a **control**. Pressing it acts on every sensor there, so it must state exactly
what it is about to undo. The pin `★` is an **indication**. It says "something you starred is
here". A mast where a reader starred only the river must still draw a starred pin.

**Unclustering.** markercluster has no per-marker opt-out. Add a favorite marker to a plain
`L.layerGroup` instead of to `cluster`.

Split inside `syncCluster()`. That function already walks `marks` and already gates on `shown(k)`.
One extra branch keeps layer visibility in one place.

**The cluster badge does not undercount.** The badge counts how many pins the chip hides. It does
not count how many stations sit in the area. The cluster hides no favorite, so a count that leaves
every favorite out is the correct count.

The same holds for the badge's red. `iconCreateFunction` ORs `m.options.critical` across its
children. When the only critical pin nearby is an unclustered favorite, the chip goes neutral while
that pin draws itself red beside it. Nothing leaves the screen.

Put this reasoning in the gotcha list. The next reader will see a badge reading 12 over an area
holding 13 pins, and will file it as a bug.

**Trade-off accepted.** At low zoom a large favorites list is loose pins that overlap each other
and the clusters. That is the request. A favorite that clustering can swallow is a favorite the
reader cannot find.

### Alert-standard note

Surface 4 is the only alert surface this design touches, and it moves order only.

The set does not change. This design suppresses nothing. No count moves. The badge, the ticker and
the toast stay as they are. `isHot()` keeps its current definition.

Record this in `docs/FEATURES.md` under the alert design standard as a stated non-change. A later
reader must not have to derive that favorites are not an alarm control.

**Rejected:** favorites as an alert scope. It suppresses alerts elsewhere. A flood two districts
away that a reader muted is the failure ISA-18.2 spends a chapter on.

**Rejected:** a favorites map layer or a color of its own. A favorite is not a status and not a
kind. The `★` is the whole indication.

---

## Build order

This design holds two features. They share the search box and nothing else. Build them in four
stages, and keep each stage shippable on its own.

1. **Site rows and sub-rows.** Part 2, without the place search. This stands alone, it fixes the
   list-against-map mismatch today, and it needs no server change.
2. **Favorites.** Part 4, plus the favorites group in Part 2. This needs stage 1, because the
   group lists sites.
3. **The endpoint.** Part 1, plus the `--selftest` cases. Verify it with curl before any client
   work starts.
4. **The place row and the card.** The rest of Part 2, and all of Part 3.

## Files this touches

| file | change |
|---|---|
| `api.php` | `?place=` endpoint, coverage box constant, cache, rate limit, selftest cases |
| `js/config.js` | `NEAR_MAX_KM` |
| `js/state.js` | nothing — `PREFS.favs` and `PREFS.favOnly` need no declaration |
| `js/util.js` | `favIds()`, `isFav()`, mutual exclusion with `ignoredIds()` |
| `js/ui.js` | site rows, sub-rows, favorites group, place row, place states, favorites chip |
| `js/popup.js` | `nearPopup()`, `data-sensor` anchors, mast `★`, ⓘ menu item |
| `js/map.js` | `syncCluster()` split, favorites layer group |
| `js/render.js` | pin `★` badge, `favOnly` filter, favorites drawer panel, `#shown` line |
| `js/alerts.js` | favorite rows sort first |
| `index.html` | favorites drawer panel, `Favorites only` chip, About privacy sentence |
| `css/base.css` | sub-row and `★` styles |
| `css/chrome.css` | drawer panel, chip |
| `css/map.css` | pin `★` badge |
| `css/icons.css` | `star`, `star_border`, `place`, `expand_more` masks |
| `docs/FEATURES.md` | the feature, the trade-offs, the alert-standard non-change |
| `CLAUDE.md` | the two new gotchas |

Bump `?v=` on every stylesheet link that changes. Hard-reload after the JS changes.

## About pane

This design sends a typed place name to our server, and on to OpenStreetMap. The About pane makes
three privacy claims. One of them must change.

Add one sentence next to the CARTO sentence. State that a place a reader searches for goes to our
server and on to OpenStreetMap. State that this happens only when the reader picks the search row.

The paragraph about the reader's own location stays true. This design never sends a coordinate.

Follow the rule in `CLAUDE.md`. A claim about what the app does not do needs a check that lists
every absolute URL in the code. A short grep for known offenders proves nothing.

## Verification

```bash
php -l api.php
php api.php --selftest
php shots-test.php

# the new endpoint
curl -sk "https://flood-exp.test/api.php?place=bandar+utama"
curl -sk "https://flood-exp.test/api.php?place=a"            # rejected, too short
curl -sk "https://flood-exp.test/api.php?place=penang"       # empty, outside the box

# modules still parse
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done

# every file still serves — check the type, not the status
for f in js/*.js css/*.css; do
  curl -sk -o /dev/null -w "%{content_type} $f\n" "https://flood-exp.test/$f"; done | grep -v 'javascript\|css'
```

By hand:

1. Search a place, pick the row, and check the card, the pin and the 10 km cap.
2. Search a place outside the coverage area, and read the message.
3. Search twice, and confirm the second search hits the cache.
4. Favorite a sensor, then a whole mast, and check the drawer, the chip and the pin star.
5. Ignore a favorited sensor, and confirm it leaves the favorites list.
6. Clear every favorite, and confirm the `Favorites only` chip stays disabled.
7. Put a favorite on alert with test mode, and confirm it sorts first and the counts do not move.
8. Repeat 1 to 7 below 600px.
