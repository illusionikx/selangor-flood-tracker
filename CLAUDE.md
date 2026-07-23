# Klang Valley Flood Watch

Single-page map of live flood telemetry for Selangor, Kuala Lumpur and Putrajaya, from three JPS
sources.
No auth, no build step, no framework. Served by Laravel Herd at `https://flood-exp.test`.

> **Keep the docs current.** When a feature lands or a decision is made, append it to
> [`docs/FEATURES.md`](docs/FEATURES.md) — what it does and *why*, including trade-offs accepted
> and things deliberately not built. New gotchas go in the gotcha list below. Do this as part of
> the change, not as a follow-up task.

## Files

| file | role |
|---|---|
| `api.php` | server-side proxy + cache + source merge + poll history + camera image proxy |
| `sources.php` | scrapers for the two HTML-only upstreams (national portal, JPS WP) |
| `shots.php` | camera archive: capture, retention tiers, lookup. Required by `api.php` |
| `shots-test.php` | `php shots-test.php` — the only runnable check here. Exercises `pruneShots()` |
| `index.html` | markup only — no inline CSS or JS |
| `css/icons.css` | every icon, as an SVG mask. Generated — see docs/FEATURES.md for the fetch |
| `css/base.css` | tokens, reset, controls, blocks shared by popup + alert panel |
| `css/chrome.css` | page furniture: app bar, status chip, drawer, legend, alerts, splash |
| `css/map.css` | Leaflet overrides, pins, cluster badges, popup template |
| `js/app.js` | entry point — decides what happens on landing, nothing else |
| `js/config.js` | constants (kinds, palettes, thresholds, tile styles). No imports. |
| `js/state.js` | `state` (data + hereAt) and the `PREFS` blob. Breaks module cycles. |
| `js/util.js` | pure helpers + `hasInfo()` / `color()` / `isIgnored()` |
| `js/stations.js` | queries over the station set (`nearestOf`, `nearestCam`, `byId`) |
| `js/map.js` | map instance, basemap/theme, cluster, `focusOn` / `openStable` / `flashTo` |
| `js/heat.js` | heat layer, ground-fixed sizing, opacity |
| `js/popup.js` | popup + meter + gauge + sparkline templates |
| `js/render.js` | rebuilds markers and heat points; drawer summary table |
| `js/alerts.js` | "On alert" panel |
| `js/table.js` | the all-stations table dialog, grouped district → mast → sensor |
| `js/locate.js` | geolocation and the "You are here" marker |
| `js/ticker.js` | header alert marquee — measured, seamless, speed scales with the alert count |
| `js/timeline.js` | camera archive replay + A/B compare, inside the lightbox and nowhere else |
| `js/toast.js` | desktop-only "new alert since last poll" toast |
| `js/test.js` | test mode: fakes a flood in the client's copy of the payload |
| `js/net.js` | `load()` poll loop and the status chip |
| `js/ui.js` | all DOM wiring: drawer, filters, chips, panels, lightbox, delegated jumps |
| `vendor/` | Leaflet, leaflet.heat (patched), markercluster, subsetted fonts — no CDN, hand-managed |
| `lib/` | Composer's vendor dir (`symfony/dom-crawler`), gitignored — **not** `vendor/` |
| `composer.json` | the one server-side dependency; `composer install` before first run |
| `.github/workflows/pages.yml` | bakes the static GitHub Pages build — runs the PHP on cron, publishes `api.json` |
| `docs/DEPLOY.md` | both targets: Pages (what it can't do) and a Debian box (spec, nginx, cron) |
| `.cache.json` | last payload (gitignored) |
| `.history.db` | sqlite: water-level samples per station, 30-day retention (gitignored) |
| `shots/` | the camera archive — one dir per camera, `<unixts>.webp` per frame (gitignored) |

**Composer is server-side only.** `composer install` writes to `lib/`, because `vendor/` already
holds hand-vendored browser assets that Composer must never manage. The front end is still
build-free and dependency-free; nothing in `lib/` is ever sent to a browser.

**No build step.** The browser loads `js/app.js` as `<script type="module">` and resolves the
`import`s itself. Vendored libraries stay classic `<script>` tags because they publish globals
(`L`). Keep relative specifiers with the `.js` extension — there is no resolver to guess them.
Dependencies must stay acyclic; anything two modules both need lives in `state.js` or `config.js`.

## Data sources

Three JPS feeds, joined on the national station code (`station_Id` in the Selangor API, `Station ID`
in both HTML tables). Priority for a *reading* is national → whichever feed placed the pin.
Coordinates only ever come from Selangor or WP; the national portal publishes none.

| source | gives | shape |
|---|---|---|
| `infobanjirjps.selangor.gov.my/JPSAPI/api/` | Selangor: everything, incl. the only cameras, sirens and gauges | JSON |
| `publicinfobanjir.water.gov.my` | national water levels + thresholds; **authoritative reading** | HTML table |
| `infobanjirjpskl.water.gov.my` (SPHTN) | KL + Putrajaya water level and rainfall | HTML table |

### 1. JPS Selangor API

Base: `https://infobanjirjps.selangor.gov.my/JPSAPI/api/` — public, no auth, **no CORS headers**
(hence the proxy). Discovered from `data/config.json` + `jpsFunction/map1.js` on the JPS site.

**List endpoints** (all stations, coordinates, status codes — but *no readings*):
`StationRainfalls`, `StationRiverLevels`, `StationSirens`, `StationFloodGauges`, `CCTVS`,
`Hotspots/GetHotspots`.

**Detail endpoints** `…/{id}` carry the actual values. Fetched for rainfall, river, gauge, camera
via `curl_multi` (~270 requests, ~3s cold). **The lists alone are not enough** — e.g. flood gauges
return `lastReading: null` in the list but a real `floodLevel` in the detail.

Field notes:
- River detail: `waterLevel1`, `wL1SPAlert/Warning/Danger`, `waterLevel1LastUpdate`.
- Gauge detail: `floodLevel` = depth **over** a flood-prone spot; **negative means dry ground**.
  Thresholds `spWarning` 0.15m / `spDanger` 0.3m.
- Camera detail: `imageUrl` is **plain http**, so it can't be hotlinked from https — proxied.
- **No feed publishes a state.** `api.php` stamps `state` from which feed placed the pin, at the
  point the station is built — not later, because `source` is overwritten to `national` wherever
  that portal's reading wins. District case is normalised to Title Case there too. District names
  collide across states (KL and Selangor both have a Gombak), so anything keyed by district must
  key by `state|district` — see `dkey()` in `js/util.js`.
- Siren **list** has no timestamp of any kind; only the detail carries `statusLastUpdate`. That is
  the sole reason all 212 sirens are in the detail fan-out. Stamped >48h ago (`SIREN_STALE`) forces
  `online: false` — sirens heartbeat daily, so two missed days is out of contact, not idle.
- Timestamps are MYT with no offset; `api.php` pins `Asia/Kuala_Lumpur`. JPS stamps readings to
  the *upcoming* slot (17:45 at 17:36), so reading-age is floored at 0.
- `station_Id` (note the underscore — *not* `stationId`) is the national code the other feeds use.

### 2. Public Infobanjir (national) — `sources.php`

`…/index.php/aras-air/data-paras-air/aras-air-data/?state=SEL&district=ALL&station=ALL&lang=en`,
one call per state (`SEL`, `WLH` = KL, `PTJ` = Putrajaya). 301s to a canonical path, so
`CURLOPT_FOLLOWLOCATION` is required. Rows are `<tr class='item'>` and every cell carries a
**`data-th` attribute** — read columns by that (`$td->attr('data-th')`), never by position.

Rainfall exists on the portal but its table is loaded through
`wp-content/themes/shapely/agency/searchresultrainfall.php`, which returns headers and no rows for
every parameter combination tried. Not wired up; rainfall comes from the other two feeds.

### 3. JPS Wilayah Persekutuan / SPHTN — `sources.php`

`WaterLevel/LatestData/All` and `Rainfall/LatestData/All` return HTML fragments. No `data-th` here,
so columns are read by **position, guarded on row width** (14 cells for both). Coordinates appear
only inside the row's `onclick="loadMapPage(lat, lng, …)"`.

Also publishes its own trend arrow (`<img trend="Rising|Receding|No Change">`) — the only feed that
does. Parsed into `srcTrend` but **no longer used**: `rising` is now a claim about reaching a danger
mark within hours, and a bare direction arrow is no evidence for that.

Sirens are skipped: 11 stations with ragged column counts, and the state cell is the one that goes
missing. Cameras are skipped: `Camera/District/{n}` returns an empty fragment.

## api.php

- 5-minute file cache; serves stale cache (flagged `upstreamOk: false`) if upstream dies.
- Scraped pages get their **own** 15-min cache in the `page` table of `.history.db`: the KL rainfall
  table takes ~10s to render upstream (vs ~0.3s for a JSON call), so refetching it every poll would
  triple the cost of a refresh for data that can't have changed. A page that fails to fetch falls
  back to the stored copy. Warm poll ~3.5s, and one poll per quarter hour pays the ~15s.
- Merge order: Selangor API → KL (skipping any station within ~200 m of one we already have, since
  the two feeds share no station codes) → national override by code → trend pass over the winner.
- Every station carries `source` (`selangor` / `kl` / `national`) and, where known, `code`.
- `?cam=<id>` streams a camera still. Validates the id is an integer, looks the URL up in the
  cached payload, and rejects any host that isn't JPS. Never proxies an arbitrary URL.
- **Camera archive** (`shots.php`): `?shots=<id>` lists a camera's stored frames, `?shot=<id>&t=<ts>`
  serves one. Both parameters are cast to `int` before touching the filesystem, so the path cannot
  leave `shots/` — the same rule as `?cam=`. A frame is stored as **`.webp` or `.jpg`, whichever came
  out smaller** at 720p (the two are within 2% on this footage), so nothing may assume an extension —
  go through `shotFile()`, and take the content type off the file it found. Capture runs at the *end* of a refresh, at most once per
  `SHOT_EVERY` (30 min) however often the payload rebuilds, and is why one poll in six is several
  seconds slower. **Do not tie capture to the poll**: 90 cameras × 250 KB × 288 polls is 6.5 GB/day
  aimed at JPS from one address, which is the stampede the lock exists to prevent, in slow motion.
- Trend is **derived here**, not upstream: `.history.db` (sqlite, `level(station, ts, level)`,
  PK-deduped, 30-day retention, WAL) holds the samples; each poll loads the last 24h. `rate` = m/hour against the sample nearest an hour old (refused outside 20 min–3 h, so
  irregular polling can't produce a bogus figure). `rising` is a **forecast, not a rate**: climbing
  at `≥ RISE_FLOOR` (0.1 m/h), last three samples not dipping, and `eta` — hours to its *own* danger
  mark at that rate — within `RISE_ETA` (3 h). `eta` is published whenever a station is climbing, so
  the UI can show what the cutoff is cutting off. The client reads `s.rising`; it never re-derives it,
  and nothing mirrors `RISE_ETA` client-side any more.
- Response also carries real diagnostics used by the status chip: `tookMs`, `details.ok/requested`,
  `offline`, `cacheAge`, `sourceUpdated`.

## Colour language — do not violate

- **Station type** never uses a traffic-light hue: river blue `#4da3ff`, rainfall violet `#8f7bff`,
  siren pink `#f06292`, gauge taupe `#a1887f`, camera cyan `#26c6da`.
- **Status only**: green `#188038` → amber `#f9ab00` → orange `#e8710a` → red `#d93025`
  (`STATUS_COLOR`), plus grey `#9aa0a6` for offline / no reading.
- `hasInfo(s)` decides colour vs grey. A station with no reading must never look confident.

## Gotchas that have already bitten

- **`-9999` means "no reading"** in both scraped feeds, rendered as `-9,999.00` in one of them.
  `numOrNull()` strips separators and nulls anything ≤ −9990. Treated as a level, it would render a
  station as catastrophically dry and poison its trend history.
- **The KL endpoints return bare `<tr>` fragments.** Both libxml and the HTML5 parser discard rows
  that aren't inside a table, so `crawl()` wraps every page in `<table>` before parsing. Drop the
  wrap and the KL feeds silently return nothing.
- **`children('td')`, not `filter('td')`,** when counting a row's width — these pages nest tables,
  and a descendant search counts the inner table's cells too, blowing the 14-cell guard.
- **Iterating a `Crawler` yields raw `DOMNode`s**, which have no `attr()`. Use `->each(fn(Crawler
  $n) => $n->attr(…))` to stay in Crawler-land, or you get a fatal on the first attribute read.
- **`rm -rf shots/` is a year of camera history**, and unlike `.history.db` it cannot rebuild —
  the frames only exist because we were running when they were taken. To re-test the capture path,
  `rm shots/.last` (the 30-minute stamp), not the directory.
- **Never `rm .history.db` to test a cold start** — it destroys the accumulated samples, every
  `rising` flag goes false for an hour, and anything keyed off `rising` (the filter, alert panel,
  drawer counts, heat weighting) goes quiet at once. To re-test the scrape path, expire the page
  cache instead: `UPDATE page SET ts=0`. Copy the file first if you must delete it.
- **The scrapers fail silently by design** — a layout change yields zero rows, not an error. The
  payload's `sources` counters (`kl.parsed/added`, `national.parsed/applied`) are the alarm: if
  `parsed` hits 0, a table moved. Check those before believing "the rivers went quiet".
- **No `fastcgi_finish_request` under Herd** — the SAPI is `cgi-fcgi`, so there is no way to close
  the connection and keep working. Stale-while-revalidate is impossible in-process; the page cache
  is the workaround. A cron hitting `api.php` every 5 min would keep the cache warm for good.
  **Never put logic that must always run inside `if (function_exists('fastcgi_finish_request'))`** —
  that branch is dead code on the machine this runs on. The stampede guard lived there for weeks and
  therefore never guarded anything; see the lock below.
- **One rebuild at a time, enforced by `flock` on `.refresh.lock`.** A cold rebuild is ~270 requests
  at JPS, so N concurrent cache misses is 270N — the shape of a flood from one IP, aimed at the
  source the whole page depends on. The loser of the race serves stale cache and does *not* queue,
  except on a true cold start when there is nothing to serve. Anything added to the refresh path
  must stay inside the lock, and any new upstream fan-out needs the same treatment.
- **Herd serves everything `Cache-Control: max-age=10800`.** Three hours of stale CSS/JS after an
  edit unless the URL changes. The stylesheet links carry `?v=` — **bump it when you touch a css
  file**, the same as `vendor/fonts.css`. ES module imports have no such guard: hard-reload
  (Ctrl+Shift+R) after a `js/` change, or the browser may run the old module.
- **There is no icon font any more, and there must not be one again.** Icons are SVG masks in
  `css/icons.css` (`<i class="i i-warning">`, or `--i: var(--i-warning)` on a pseudo-element).
  A ligature font renders *text* that only becomes a picture if shaping cooperates, so a stray
  `text-transform`, a glyph missing from the subset or one stale cached subset put the raw word on
  screen — that happened three times, with three different triggers. Adding an icon is one rule in
  `icons.css`; there is no binary to refetch and no `?v=` to bump.
- **Herd serves `index.html` with HTTP 200 for missing files.** A typo'd asset path is *not* a 404,
  so "everything returns 200" proves nothing — check `%{content_type}` instead. This is why a
  missing `js/*.js` shows up as a module parse error in the console rather than a failed request.
- **Zooming destroys open popups.** markercluster rebuilds marker DOM on zoom. Use `openStable()`
  (opens, re-opens on next `moveend` if it closed), and `cluster.zoomToShowLayer()` for a marker
  that may be inside a cluster.
- **Stations within `SITE_M` (25 m) are one place.** `api.php` stamps a `site` key; the map draws one
  pin per site, not per station (669 → 434). Anything reaching for a marker must go through
  `siteMark` in `map.js` — a station's pin may be filed under another kind's bucket, because the
  bucket is the *lead* sensor's kind. Sites are built **after** filtering, so a hidden layer can
  never take a whole mast off the map; that is why layer chips call `render()`, not `syncCluster()`.
- Clustering still never fully disables: sites can sit metres apart. `maxClusterRadius` tightens
  with zoom and co-located pins spiderfy on click.
- **Offline gauges are frozen on old flood readings** (3.55m from April) — so they are *not sampled
  into `.history.db`* and carry no `history`. A flat line at a number from months ago reads as
  "steady", which is the one thing a graph of a dead sensor must not say. Anything offline or
  >24h old renders grey with an explicit `OFFLINE` block, the date in the footer. Never show these
  as live.
- **41 sirens last reported months ago** (one in July 2025). They render `OUT OF CONTACT`, never
  `IDLE` — a silent siren and a dead siren look identical, and only one is safe.
- **`footLine()` is the only place a timestamp is printed**, and it carries the whole story on one
  line: `OFFLINE · last reported 06/07/2026 10:19 · 411.0h ago · via JPS Selangor`. The stale state
  blocks (siren, rainfall, gauge) print no time at all — they each used to add a sentence naming the
  same moment the footer named three lines below. Elapsed time is appended only when the station is
  offline or stale, because on a live one the date is the answer and `· 4m ago` is padding. Seconds
  are trimmed for display by `noSec()`; the underlying string stays verbatim, so `parseMY()` is
  unaffected.
- **A marquee needs three things measured, not guessed.** `js/ticker.js` renders the item set twice
  and translates `-50%`, which is only seamless if one copy is at least as wide as the box — so it
  repeats the set to cover the box *before* doubling. Width alone isn't enough: a single wide item
  still pops, because the tile leaving the left edge is the whole strip leaving. `MIN_TILES` (3)
  guarantees a follower. And `#ticker` must have a **fixed flex basis** — sized to content the
  header re-laid itself out every poll as the alert count changed.
- **`.solo` is hidden until hover, globally.** The rule lives on the class, not on `#districtList`,
  so any new list reusing that pill button gets an invisible control on a mouse. `#ignoredList`
  overrides it back to `visible` — restoring is the whole point of that panel.
- **`<details>` can't animate closed** (children go `display:none`) and hides non-`<summary>`
  children entirely — that's why the drawer is a `body.drawer` class and the credit sits outside.
  The two filter sections *inside* the drawer (`#districts`, `#ignored`) are `<details>` precisely
  because they want no animation. Their counts live on the `<summary>`, so a collapsed section still
  reports what it is holding — do not move a count into the body.
- **`border-collapse: collapse` drops padding on the table box** — `#netstats` uses `separate`.
- **leaflet.heat sizes in screen pixels.** `heatScale()` converts `HEAT_KM` (4km) to pixels per
  zoom so blobs stay ground-fixed. Do **not** also call `heat.redraw()` — the plugin repaints on
  the following `moveend`, and doing both painted twice per zoom. Radius capped at 120px because
  blur cost is quadratic; past that cap the layer *fades out* rather than quietly covering less
  ground. `maxZoom` on the layer is **not** a display limit — it divides every weight by
  `2^(maxZoom − zoom)`, so anything inside the usable zoom range dims blobs as you zoom out. Pinned
  to 0.
- **`maxZoom` belongs on the map, not only the tile layer.** `cluster` is created and added at
  `map.js` load time, before `setBasemap()` adds any tile layer, and markercluster throws
  *"Map has no maxZoom specified"* if nothing has declared one by then.
- **The heat canvas is padded (PATCH 3), so raw container points are not canvas points.** Anything
  touching `_reset`/`_redraw` must add `_pad()` to point coords and keep grid indices non-negative —
  the flush loop iterates the array, so a negative key silently drops those blobs. `_animateZoom`
  is padded too; it writes an absolute transform, so forgetting it detaches the layer mid-zoom.
- **simpleheat's blob is a shadow, and it leaks past `radius + blur > 200`.** It draws an arc
  off-canvas and offsets the shadow back on. Stock offset is 200, so any blob wider than that puts
  the *source* arc back on the canvas — a hard-edged circle clipped by the corner. Our vendored
  copy patches the offset to `1e4`. Second reason not to overwrite `leaflet-heat.js`.

## Conventions

- **Anything that alerts is checked against the alert design standard** in
  [`docs/FEATURES.md`](docs/FEATURES.md#alert-design-standard) — CAP's separate severity / urgency /
  certainty axes, ISA-18.2's "an alarm requires a response" and its 10-in-10-minutes flood
  threshold, and the cry-wolf finding that false alarms cost more trust than they buy attention.
  Four gaps are open there; raise them when alert work comes up rather than adding a fifth surface.
- Responsive is a standing requirement (breakpoint 600px), including touch equivalents for every
  hover-only affordance.
- All user settings live in one `prefs` blob in `localStorage` (`PREFS` + `save()`).
- **`PREFS.ignored` is the only alarm-suppression control**, and it is applied *further* than the
  district filter: `isIgnored()` gates pins, heat, the alert panel, the ticker **and** the toast. The
  last two deliberately ignore the district picker; ignoring one named sensor is a request about that
  sensor, so it holds there too. Anything that suppresses an alert must keep both always-visible
  indications — the drawer's "Ignored sensors" panel (drawn even when empty) and the `· N ignored`
  count in `#shown` — and the all-clear must keep saying when a silenced sensor is itself on alert.
- **All times are 24-hour, and Malaysian.** JPS stamps readings MYT with no offset and we print them
  verbatim, so anything computed from a unix timestamp must be formatted with
  `timeZone: 'Asia/Kuala_Lumpur'` (see `MYT_HOUR` in `popup.js`) or it will disagree with the
  strings next to it for any viewer outside MYT. No `hour12` anywhere.
- **Rainfall is an interval quantity, not a level.** It gets `rainBars()`, never `sparkline()` — a
  line between two rain readings claims a value in between that never existed. And `hourlyRainfall`
  is a *rolling* hour, so it buckets by `RAIN_BUCKET` (1 h): finer buckets show the same rain twice.
- `history` is `[[unix seconds, value], …]` on rivers (metres), rainfall (mm/h) and gauges (metres of
  depth, negative = dry) — the graphs
  plot against the clock, not against sample index. Windowed to `SPARK_WIN` (12h) and thinned to one point per `SPARK_BUCKET` (15 min)
  server-side; `SPARK_H` in `config.js` is a **cap**, not a fixed frame — the axis spans the points
  actually held and only starts sliding once they exceed it. It must not exceed `SPARK_WIN`.
- Popups share one template: badge → name → region → body → still/link → footer. `meter()` renders
  water level on a **piecewise** scale (alert 38%, warning 68%, danger 100%) because real
  thresholds bunch above 88% on a linear bar.
- Vendored assets only — no CDN, so Tracking Prevention has nothing to block. `leaflet-heat.js` is
  **patched** (`willReadFrequently` on 3 `getContext` calls); don't overwrite it with a fresh copy.

## Verify

```bash
composer install                                      # writes lib/ — required before first run
php -l api.php && php -l sources.php                  # lint proxy + scrapers

# Are all three sources actually contributing? parsed:0 means a scraped table moved.
curl -sk https://flood-exp.test/api.php | php -r 'echo json_encode(json_decode(stream_get_contents(STDIN),true)["sources"]),"\n";'

php api.php | head -c 400                             # cold fetch (~3s), writes .cache.json
curl -sk https://flood-exp.test/api.php | php -r '...' # served payload
curl -sk -o /dev/null -w '%{http_code}\n' "https://flood-exp.test/api.php?cam=1"   # 200, jpeg

# Syntax-check the modules. node --check treats a bare .js as CommonJS, so copy to .mjs first:
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done

# And that every file still serves. Check the *type*, not the status: Herd answers a missing file
# with index.html and a 200, so a typo'd path passes a status check and fails in the browser.
for f in js/*.js css/*.css; do
  curl -sk -o /dev/null -w "%{content_type} $f\n" "https://flood-exp.test/$f"; done | grep -v 'javascript\|css'
```

```bash
php shots-test.php            # the one runnable check: camera retention. Must stay green.
curl -sk "https://flood-exp.test/api.php?shots=1"                          # frame timestamps
curl -sk -o /dev/null -w '%{http_code} %{content_type}\n' \
     "https://flood-exp.test/api.php?shot=1&t=$(curl -sk 'https://flood-exp.test/api.php?shots=1' \
     | php -r 'echo json_decode(stream_get_contents(STDIN))[0];')"          # 200 image/webp
```

There is otherwise no test suite. Changes are verified by linting, syntax-checking the modules,
querying `.cache.json` for the data shape being relied on, and looking at the page.

`shots-test.php` is the exception, and deliberately narrow: retention is the only rule in this repo
that can *quietly destroy* data. Everything else either works or visibly does not, but a prune that
buckets a frame wrongly deletes months of camera history and looks identical to one that worked —
and because it runs on every capture, a rule that shaves one extra frame per pass empties the
archive over a week without ever being wrong in a single run. Hence the idempotence assertion.
