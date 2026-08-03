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
| `css/chrome.css` | page furniture: app bar, status dot, drawer, legend, splash |
| `css/map.css` | Leaflet overrides, pins, cluster badges, popup template |
| `js/app.js` | entry point — decides what happens on landing, nothing else |
| `js/config.js` | constants (kinds, palettes, thresholds, tile styles). No imports. |
| `js/state.js` | `state` (data + hereAt) and the `PREFS` blob. Breaks module cycles. |
| `js/util.js` | pure helpers + `hasInfo()` / `color()` / `isIgnored()` |
| `js/stations.js` | queries over the station set (`nearestOf`, `nearestCam`, `byId`) |
| `js/map.js` | map instance, basemap/theme, cluster, the station panel (`openSide`), `focusOn` / `flashTo` |
| `js/heat.js` | both heat layers (water level, rainfall), ground-fixed sizing, shared opacity |
| `js/popup.js` | popup + meter + gauge + sparkline templates |
| `js/sparktip.js` | the hover/tap readout on every graph. One delegated listener, no imports |
| `js/render.js` | rebuilds markers and heat points; drawer summary table |
| `js/alerts.js` | "On alert": the app bar's warning glyph, the list it opens in `#side`, the icon badge |
| `js/table.js` | the all-stations table dialog, grouped district → mast → sensor |
| `js/locate.js` | geolocation and the "You are here" marker |
| `js/ticker.js` | header alert marquee — measured, seamless, speed scales with the alert count |
| `js/timeline.js` | camera archive replay + A/B compare, inside the lightbox and nowhere else |
| `js/clip.js` | the station panel's 3-hour camera clip — no controls, that is the lightbox's job |
| `js/toast.js` | desktop-only "new alert since last poll" toast |
| `js/test.js` | test mode: fakes a flood in the client's copy of the payload |
| `js/net.js` | `load()` poll loop and the status dot on the logo |
| `js/ui.js` | all DOM wiring: drawer, filters, chips, panels, lightbox, delegated jumps |
| `manifest.json` | PWA manifest. `.json`, not `.webmanifest` — see the gotcha below |
| `sw.js` | service worker: network-first shell cache, and the reason Chrome offers "Install app" |
| `icon.svg` | the app mark: bare glyph, no fill. Source for the PNGs *and* the `--i-flood` mask |
| `icon-build.php` | `php icon-build.php` — rebakes the two icons and prints the mask rule to paste |
| `icon-192.png`, `icon-512.png` | manifest icons (`any`) and the favicon — the glyph on transparency |
| `icon-180.png` | `apple-touch-icon`. Opaque, because iOS flattens alpha onto a colour of its own |
| `img/` | optional. Only `egg.webp` (the About easter egg). Absent is a supported state — see below |
| `vendor/` | Leaflet, leaflet.heat (patched), markercluster, subsetted fonts — no CDN, hand-managed |
| `lib/` | Composer's vendor dir (`symfony/dom-crawler`), gitignored — **not** `vendor/` |
| `composer.json` | the one server-side dependency; `composer install` before first run |
| `.github/workflows/pages.yml` | bakes the static GitHub Pages build — runs the PHP on cron, publishes `api.json` |
| `docs/DEPLOY.md` | both targets: Pages (what it can't do) and a Debian box / Proxmox LXC (spec, nginx, cron, container traps) |
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
  PK-deduped, 30-day retention, WAL) holds the samples; each poll loads the last 24h. **`ts` is the
  reading's own stamp (`readTs()`), never the poll time** — see the gotcha below. `rate` = the
  **median of every pairwise slope** in a 3h window (Theil–Sen, pairs ≥ `TREND_MIN` apart), not a
  chord between two samples. `rising` is a **forecast, not a rate**, and needs all five: rate
  `≥ RISE_FLOOR` (0.1 m/h), level strictly above the sample two back, level ≥ its own 24h high (this
  is what keeps a tide out), `eta` — hours to its *own* danger mark at that rate — within `RISE_ETA`
  (3 h), and the same true on the previous poll (on-delay). `eta` is published whenever a station is
  climbing, so the UI can show what the cutoff is cutting off. The client reads `s.rising`; it never
  re-derives it, and nothing mirrors `RISE_ETA` client-side any more. `$assess()` takes a sample
  *index* precisely so the on-delay needs nothing persisted between requests.
- Response also carries real diagnostics used by the status popover: `tookMs`, `details.ok/requested`,
  `offline`, `cacheAge`, `sourceUpdated`.

## Colour language — do not violate

- **Station type** never uses a traffic-light hue: river blue, rainfall violet, siren pink, gauge
  taupe, camera cyan, mast indigo. Tokens `--k-*`.
- **Status only**: green → amber → orange → red (`--s-normal` / `--s-alert` / `--s-warning` /
  `--s-danger`, exposed as `STATUS_COLOR`), plus grey `--s-none` for offline / no reading.
- **The values live in `css/base.css` and nowhere else**, two sets, one per theme. Do not write a hex
  into a JS file or copy one into a doc — every hex outside that block is a value that will go stale
  the next time the palette moves, and it has moved four times. The one exception is a **canvas**:
  the heat gradient cannot resolve a token, so `RAIN_HEAT` in `config.js` keeps real values.
- `--s-trace` is a fifth rung, sitting between normal and alert, and a flood gauge is its only user.
  It exists because JPS marks a gauge at 0.15 m and 0.3 m, so water under the first mark is a real
  reading with no published name. See `GAUGE_COLOR` in `config.js`.
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
- **Never `file_get_contents()` a JPS URL — always curl.** `infobanjirjps.selangor.gov.my` resolves
  to *two* A records and one of them (`58.27.97.62`) blackholes SYNs. curl races both (happy
  eyeballs) and connects in ~10 ms; PHP's stream wrapper tries addresses serially with no connect
  timeout of its own, so it eats the OS TCP timeout — 21 s on Windows — whenever it draws the dead
  one. `?cam=` was the only outbound call in the repo not going through `fetchAll()`, and it was
  therefore the only slow endpoint: ~21 s per still, 42 s when the https attempt lost and the http
  fallback lost too. Stills now take ~0.8 s. The dead record may be removed or may move to the other
  IP; the rule is about the mechanism, not that address.
- **`rm -rf shots/` is a year of camera history**, and unlike `.history.db` it cannot rebuild —
  the frames only exist because we were running when they were taken. To re-test the capture path,
  `rm shots/.last` (the 30-minute stamp), not the directory.
- **A retention bucket aims at a clock time, and both sides must aim at the same one.** `SHOT_TIERS`
  carries a third number per tier — the anchor, which is the target time in UTC modulo the step — and
  a frame's slot is the **next target at or after it**, so what survives is the last frame taken
  *before* that target. Not the nearest one to it: with frames at 15:24 and 16:10 the nearest to
  16:00 is 16:10, and a picture taken after the time it is labelled with is the one thing this must
  not do. `thin()` in
  `js/timeline.js` repeats the same expression and the same numbers, so the ruler and the clip cannot
  file one frame in two slots. Week aims at 01:00 MYT, month at 04:00 and 16:00, year at Monday
  16:00, and the three nest, so a frame keeps hitting its target as it ages between tiers. The old
  rule bucketed on `floor(ts / step)`, which aligns to **UTC** midnight: at +8 that put the week
  range on 01:30, the month on 07:30 and 19:30, and the year on a Thursday. Change an anchor in one
  file only and the two sides disagree about where a slot starts. `shots-test.php` asserts each
  anchor against `time()` — **never against the epoch**, because Malaysia ran UTC+7:30 until 1982 and
  PHP renders a 1970 instant 30 minutes early, which makes a correct constant look broken.
- **A sample's `ts` is when the reading was taken, not when we polled.** Upstream changes a value
  every ~25 min and we poll every ~8.5 min, so a level is a staircase and the same number arrives
  four or five times. Stamping each arrival `now` puts the step where we noticed it, which put up to
  a poll interval of error on *both* ends of a rate — a rate wrong by over 100% on a short baseline,
  and the reason a station whose level had not moved in five polls reported a 0.9 h ETA to danger.
  `readTs()` reads `updated`, clamps a future stamp (JPS stamps to the upcoming slot) and falls back
  to `now` only when the parse fails. Anything new that writes to `level` must go through it.
  Two side effects to keep: the `(station, ts)` PK now dedupes a repeated reading to one row, and a
  station frozen on an old reading stores that old stamp, so `RETAIN` prunes it and `SPARK_WIN`
  excludes it instead of drawing a flat live-looking line.
- **A tide is a rise, and three of these stations are tidal.** PINTU AIR IJOK is a water gate;
  BANDAR KLANG and TELUK PENYAMUN (JETI) are estuarine. They climb 0.5–0.7 m/h twice a day forever,
  so any rate-based forecast flags them daily. The guard is `level ≥ its own 24h high`, not a
  blocklist — a list needs maintaining, is wrong the day JPS adds a gauge, and says nothing about
  rivers that are mildly tidal at the mouth. **Do not replace it with a station list.**
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
  **The app icons carry `?v=` too**, in four places — the two `<link>` tags in `index.html` and the
  two `icons[].src` in `manifest.json`. `icon-build.php` rewrites the PNGs under the same names, and
  a browser holds a favicon for far longer than three hours, so bumping that number is the only
  thing that makes a new mark appear. The script prints the reminder when it finishes.
- **There is no icon font any more, and there must not be one again.** Icons are SVG masks in
  `css/icons.css` (`<i class="i i-warning">`, or `--i: var(--i-warning)` on a pseudo-element).
  A ligature font renders *text* that only becomes a picture if shaping cooperates, so a stray
  `text-transform`, a glyph missing from the subset or one stale cached subset put the raw word on
  screen — that happened three times, with three different triggers. Adding an icon is one rule in
  `icons.css`; there is no binary to refetch and no `?v=` to bump.
- **The service worker must never cache a reading.** `sw.js` deliberately returns without calling
  `respondWith()` for `api.php` and `api.json`, so those requests behave as if no worker existed.
  The splash refuses to draw a map with no connection because a stale water level during a flood is
  worse than none; a worker answering from cache would defeat that from a layer the page cannot see.
  It is network-first for everything else too, so a `?v=` bump is still the only cache ritual —
  **do not "optimise" it to cache-first**, or an edit goes live for nobody until a cache name moves.
- **The app icons are transparent, so `purpose` must stay `any` — never `any maskable`.** A maskable
  icon is required to be opaque edge to edge; declaring a transparent one maskable hands the
  platform a background of its own choosing, which destroys the reason it is transparent. Same
  chain: `background_color` is white because it is the *splash* colour and a blue glyph on a blue
  splash is invisible, and the glyph is blue rather than white because with no plate it lands on a
  tab strip, a wallpaper and a launcher, and white survives only some of those.
- **Do not add `mobile-web-app-capable` — or put `apple-mobile-web-app-capable` back.** Chrome's
  console deprecates the Apple tag and suggests the unprefixed one; both are the pre-manifest way of
  asking for standalone, and `display: standalone` in `manifest.json` has covered it since iOS 11.3.
  Adding the suggested tag would be a second legacy mechanism for something already declared. The
  only thing still tied to the Apple tag is `apple-touch-startup-image`; if iOS splash screens are
  ever wanted, that tag comes back *with* them and not before.
- **iOS has its own icon, `icon-180.png`, and needs it.** Safari does not honour alpha on a
  home-screen icon; it flattens it onto a colour of its own choosing, historically black — the exact
  plate that was deliberately removed. So `apple-touch-icon` points at an opaque white tile with a
  smaller glyph (iOS rounds the corners itself and the squircle bites anything near the edge), while
  the favicon and the manifest keep the transparent pair. **Do not point `apple-touch-icon` back at
  `icon-192.png`** — it will look right in every browser you can test locally and black on a phone.
- **The icon badge follows the app bar's alert count and nothing else.** `navigator.setAppBadge()` in
  `alerts()`, on `live` — the same number the panel's warning glyph is coloured by, with the district
  filter and `PREFS.ignored` already applied and stale stations excluded. Never badge `hot`: stations
  we can no longer read are a maintenance problem, not a flood. It deliberately does **not** request
  notification permission (iOS needs it and simply goes without) — a prompt on landing is the
  trust-spending the alert standard warns about, for a number already on screen. The badge is not an
  alert channel; anything that wants to make it one goes through the alert design standard first.
- **The PWA paths are all relative** (`start_url: "."`, `new URL('../sw.js', import.meta.url)`),
  because the same files serve from the root of a Herd host *and* a GitHub Pages sub-path. An
  absolute `/sw.js` is a 404 on one of the two, and a worker that fails to register just quietly
  removes the install button.
- **The manifest is `manifest.json`, not `.webmanifest`.** Herd types an unknown extension
  `application/octet-stream`; the correct type would have to be added to every web server this ever
  runs behind. `.json` is right everywhere already, and no browser cares about the name.
- **Herd serves `index.html` with HTTP 200 for missing files.** A typo'd asset path is *not* a 404,
  so "everything returns 200" proves nothing — check `%{content_type}` instead. This is why a
  missing `js/*.js` shows up as a module parse error in the console rather than a failed request.
- **A multi-click gesture needs `user-select: none` on everything it touches.** The browser counts
  clicks whatever you are doing with them, so the third of any fast burst is a triple-click and
  selects. The About egg is opened by seven fast clicks and then ignores clicks for 1.5s, so people
  keep clicking — and the selection wash rendered the picture blue. Both `#aboutBox .logo` and
  `#eggBox` carry the rule; anything else driven by repeated clicks will need it too.
- **Nothing optional may be able to fail the Pages bake.** `img/` holds one decoration and may not
  exist, so the staging step copies it with `[ -d img ] && cp -r img site/ || true`. An unconditional
  `cp` of a missing directory fails the step, and a failed bake keeps the *last* deployment — so the
  map would sit on stale readings because an easter egg was absent. Same rule for anything added to
  that `cp` line: if it can go missing, it must not be able to stop the map updating. Under Herd the
  same missing file is invisible (see above), so this only ever shows up in CI.
- **A `<dialog>`'s `display` goes on `[open]`, and a popover's on `:popover-open` — never on the
  element.** The browser closes a dialog
  with `dialog:not([open]) { display: none }` in its own stylesheet, and any author rule setting
  `display` beats it. `#dataBox { display: flex }` therefore laid the closed table dialog out on the
  page — 450 rows, in the tab order and read by screen readers — invisible only because `#map` is
  absolutely positioned and painted over it. It surfaced through the map whenever a tile was missing,
  which read as a Leaflet zoom bug and was chased as one. `#dataBox[open]`, `#lightbox[open]` and
  `.sparktip:popover-open` are the pattern.
- **There is no map popup any more, and there must not be one again.** Station detail is `#side`, a
  fixed panel on the right edge of the viewport, filled by `openSide(key, html, mastAt)` in `map.js`.
  Everything a Leaflet popup needed — `autoPan` racing `setView`'s animation, `openStable()`
  re-opening what a zoom had torn down, `cluster.zoomToShowLayer()` waiting for a marker to have a
  DOM node at all, a `keepPopupVisible()` that nudged the view on phones — existed because the card
  was anchored to a marker. The panel is a page element: nothing to pan into view, nothing to
  destroy. Anything that wants to *show a station* calls `flashTo()`, which fires the marker's own
  click; anything that wants to show something else calls `openSide()` with a key starting `@`
  (see locate.js), which keeps `render()`'s refresh pass off it.
- **The card arrives as one string and is split into two boxes.** `openSide()` moves the card's
  `.pophead` — the place name, region and one badge per sensor — out of `#sideBody` and into
  `#sideHead`, which is not inside anything that scrolls. `position: sticky` on it was tried first
  and is one line rather than three, but a header that stays put only while nothing defeats sticky
  is a header that can come loose; this one has no scroll to come loose from. **Anything that
  reshapes `sitePopup()` must keep `.pophead` as its first element** — that is the seam.
- **Three numbers put the place name on the close button's line and move together:** `#sideClose`'s
  `top: 8px`, `#sideHead .pophead`'s `padding-top: 18px` (8 + half the button's 40 − half a 15px/1.3
  line) and `.sitecount`'s `top: 19px`.
- **`render()` refreshes the open card in place, so `openSide()` must stay idempotent.** It runs on
  every poll for the site currently on screen. It resets `scrollTop` **only** when the key changes —
  otherwise a poll would throw you back to the top of a card you were reading. Anything stateful
  added to the card (an open `<details>`, a scroll position, a text selection) is lost on that
  rebuild unless it is keyed the same way.
- **Nothing may close the card except the reader**, and there is no `map.on('click', closeSide)` —
  that was carried over from the popup, where it belonged, and it dismissed the panel mid-read. The
  "you are here" card was hit hardest: locate.js draws an accuracy circle, and `L.Path` bubbles its
  clicks to the map where `L.Marker` does not (`bubblingMouseEvents: false`), so at a coarse fix most
  of the viewport closed it. `render()` no longer closes it either when the site leaves `sites`.
  The three ways out are the ×, a dialog taking the screen (About, the table — both call
  `closeSide()` in ui.js), and ⋮ → ignore. **Do not add a fourth without a reason that survives
  "it vanished while I was reading it".**
- **The alert list is a tenant of `#side`, under the key `@alerts`.** It is not a panel of its own
  any more, so there is nothing to place, slide past the drawer or collapse on a phone — and a
  station picked out of the list *replaces* the list, which is why nothing binds the rows any more
  (ui.js's delegated `[data-go]` handler reaches them, and the old per-row handler existed only to
  collapse the panel on a phone first). Two consequences. Its head must stay the first element and
  must be `.pophead`, the same seam every station card obeys — `openSide()` lifts it into
  `#sideHead`. And **nothing springs it open by itself**: on the right edge it would land on a card
  someone is reading, which is the rule directly above. The button's colour and count are on screen
  the whole time, and the interruption for news is still the toast.
- **`#alertBtn`'s `aria-expanded` is synced from `openSide()`/`closeSide()` in map.js**, not from the
  click that opened it — the panel has half a dozen other ways to change what is in it (a pin, the
  table, "you are here", the ×) and every one of them would have left the button lying.
- **`#netstats` is a sibling of the `<h1>`, not a child of the dot that opens it.** A `<table>` is
  flow content and cannot legally sit inside a heading, so the popover is anchored to `header` and
  revealed by `header:has(h1 .mark:hover)` — there is no combinator that walks back out of the
  heading to a sibling. The touch path toggles `.open` on `#net`, and `#netstats` has to stop its own
  clicks (ui.js) because it is no longer inside the element the document handler exempts.
- **You cannot focus something you are still animating into view.** Two separate traps, both silent,
  and `#gotoBox` hit each in turn. A transitioned `visibility` *interpolates*: at t=0 of
  hidden→visible it still computes to `hidden`, so `focus()` is refused — hence `visibility 0s .25s`
  rather than `visibility var(--slide)`. And the click that opened the control leaves focus on the
  button that is about to become `display: none`, which returns focus to `<body>` *after* the
  handler returns — so the focus must follow a style flush (`el.offsetWidth`). `requestAnimationFrame`
  does **not** work here: its callbacks run before the frame's style recalc.
- **`focusOn()` centres on the strip of map that is actually visible**, which is now bounded on both
  sides: the drawer takes the left, the panel the right, and the two shifts subtract. Skipped below
  600px, where the panel covers the map outright and there is no strip to aim at.
- **Stations within `SITE_M` (50 m) are one place.** `api.php` stamps a `site` key; the map draws one
  pin per site, not per station (671 → 417). Anything reaching for a marker must go through
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
- **Nothing outranks a popover except another popover.** The table draws its graphs inside `.tipbox`,
  which is a `popover` and therefore in the **top layer** — above every `z-index` on the page, because
  the top layer is not part of the stacking context at all. So `js/sparktip.js`'s readout is itself a
  popover (`manual`, so it cannot light-dismiss the panel it sits on). Anything new that has to paint
  over the table's panels, the ⋮ menus or the lightbox needs the same treatment; raising a z-index
  will look like it works everywhere except over a popover, which is the one place it matters.
- **A graph's samples ride on the element, in `data-pts`.** `readout()` in `popup.js` writes
  `[x%, label]` per sample and words the label itself (`1.74 m · 14:15`, `sounding · 22:30`), so the
  one listener that reads them needs no units, no clock and no sensor kind. The attribute is
  **single-quoted** because JSON quotes with double ones. Any new graph that wants the readout emits
  the same attribute; any that does not simply has no `[data-pts]` to match.
- **A flood gauge's status colour comes from `gaugeColor()` in `util.js` and nowhere else.** Upstream
  publishes 3 codes against 2 marks, so any depth under 0.15 m shared code 0 with *dry ground* — and
  a wet spot painted the same taupe as a dry one, which is the colour this app reserves for a sensor
  that cannot report. `gaugeTone()` gives the rung (dry → 0, any water → 1, the warning mark → 2,
  danger → 3) and `GAUGE_COLOR` gives the colour, which is **not** `STATUS_COLOR` — rung 1 is
  `--s-trace`, because upstream published no mark down there and amber would claim one. Four
  surfaces read it: pin, card, table cell, table hover panel. It deliberately changes **no alert
  surface** — `isHot()` never covered gauges, so the count, the badge and the ticker do not move. If
  a gauge ever needs to alert, that goes through the alert design standard first.
- **The Selangor list publishes `-1` for "no status" on stations that are reporting a number.** 144
  of 233 rain gauges and 15 rivers, on the payload this was found. `api.php` now derives the missing
  code from the reading, through the same `rainStatus()` / `wlStatus()` the two scraped feeds already
  use — server-side, because there is one definition of a status and it is that file's. `band()` in
  `table.js` clamps `-1` to 0 as the guard behind it. Never re-derive a status client-side.
- **`atDanger()` is the map's red; `isCritical()` is the alert path's.** They are different questions
  and must not be merged. `atDanger()` asks "is this sensor at the top of its own scale" — a river
  over its mark, a sounding siren, a flood gauge under water, rainfall in JPS's top class — and it
  drives the pin colour, the `.danger` halo, the cluster badge and `leads()`. A pin has to be red
  whenever anything at that place is at its worst, and a mast led by a quiet river used to draw blue
  over a flooded gauge beside it. `isCritical()` is narrower, and feeds `isHot()` and through it the
  alert panel, the icon badge, the ticker and the toast. **Widening `isCritical()` widens every alert
  surface at once** — that is an alert-design decision, and it goes through the standard first.
  `render.js` states the red explicitly (`critical ? statusColor(3) : …`) rather than trusting
  `leads()` to elect the worst sensor and `color()` to return red for it.
- **Test mode makes a place tell one story.** `seedTest()` walks stations, so its first pass could
  leave a river over its danger mark on the same mast as a dry gauge and an idle siren — four
  unrelated faults on one pole, which reads as a bug rather than as weather. A second pass over
  `site` brings every online member of a flooded site up to match, through one idempotent `drown()`.
  Offline members stay offline on purpose: a sensor down on an alerting mast is a real rendering
  path. **A camera has nothing of its own to fake** — `camAlert()` measures from the alert to the
  lens — so `CAM_EVERY` floods every third site that holds both a camera and a river. Without it the
  camera warning was faked by luck, on 6 of the 31 such sites. Anything new that alerts needs a knob
  here, or it ships unseen: that is why the gauge has one, at a rung real data almost never reaches.
  **A faked level is placed against the station's own marks, never as a fraction of the danger
  mark.** `danger × 0.82` is 29.36 m on a river that alerts at 35.80, so the fake stamped an alert on
  a station the scale put in the safe stretch, and the row drew an amber number over an empty bar.
- **The alert panel is a directory, not a stack of readings.** `groupCard()` in `alerts.js` draws one
  card per kind per tier — five at most, usually two — and **every row in it is a place**, grouped on
  `site` so a mast with two gauges over their marks is one row. One card per station carried a meter,
  a trend line and a 12-hour graph each, which is right for one alert and wrong for forty: test mode
  makes 64, and they now fill 3 cards. The meter and the graph are on the station card, which every
  row opens with one tap. **Do not put a reading back in this panel** — the row's number (percent of
  danger / hours to it / the stamp on a stale one) is the whole of what a scan needs.
- **`title` is not a tooltip on a phone.** It never opens on touch, waits about a second on a mouse
  and takes no styling — so anything whose meaning lives in a `title` means nothing on half the
  devices this runs on. That is why the camera warning prints its words on the picture (`Water level
  3.42 m`), why the table uses a `popover` panel instead, and why a new affordance that needs
  explaining needs it *on screen*. A `title` is acceptable only as a duplicate of something already
  visible — the jump hint on an alert row, the count on a chip.
- **`sourceInfo()` is the only place a timestamp is printed, and it lives inside the ⓘ menu.** Three
  facts, all about the plumbing: are we hearing from this station, what was the stamp on the last
  thing it sent, which of the three feeds won. None of them changes what the water is doing, and as a
  footer line they repeated per sensor down a six-sensor mast. They are what you check when you doubt
  the number, so they sit where you go to look. The stale state blocks (siren, rainfall, gauge) print
  no time at all. Elapsed time is appended only when the station is offline or stale, because on a
  live one the date is the answer and `· 4m ago` is padding. Seconds are trimmed for display by
  `noSec()`; the underlying string stays verbatim, so `parseMY()` is unaffected. **The ⋮ is an ⓘ** —
  the glyph promised actions and held exactly one.
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
- **leaflet.heat sizes in screen pixels.** `heatScale()` converts `HEAT_KM` (5km) to pixels per
  zoom so blobs stay ground-fixed. Do **not** also call `heat.redraw()` — the plugin repaints on
  the following `moveend`, and doing both painted twice per zoom. Radius capped at 120px because
  blur cost is quadratic; past that cap the layer *fades out* rather than quietly covering less
  ground. `maxZoom` on the layer is **not** a display limit — it divides every weight by
  `2^(maxZoom − zoom)`, so anything inside the usable zoom range dims blobs as you zoom out. Pinned
  to 0.
- **Leaflet paints its container `#ddd` in both themes.** That is what shows through wherever a tile
  has not arrived, and a zoom out has nothing to retain over the newly revealed area — so the
  missing tiles read as a grid of pale boxes on the dark basemap. `.leaflet-container` takes
  `var(--surface)` in `map.css`. Anything that changes the basemap has to keep a gap looking like
  the page rather than like a table.
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
- **`?shots=` returns `[ts, tier, stationId]`, not a bare timestamp.** Both readers still accept a
  bare number. `timeline.js` and `clip.js` each guard with `Array.isArray(r)`. The response is
  cached for 60 seconds, so a deploy leaves the old shape in flight. Do not remove that fallback
  while the cache header stands.
- **`clip.start()` must stay idempotent by camera id *and* by generation.** `render()` calls
  `openSide()` on every poll for the card on screen. A clip that restarted there would jump back to
  frame 0 while somebody watched. So `start()` rebinds to the fresh nodes and keeps its place. The
  id alone is not enough. A reader can close a card and reopen the same camera before the fetch
  returns. `stop()` clears the id and the second `start()` sets it back, so both continuations
  match. `gen` catches that case. `stop()` bumps it on every call, so a stale run can never match
  again.
- **The lightbox reads its camera from `data-clip`, not from the clicked image's `src`.** The panel
  clip rewrites `img.src` to an archived frame every second. Matching `?cam=` against that src
  fails on five frames in six. That opened a lightbox with no scrubber, no compare and no warning
  glyph. Only the table's "show image" button has no such wrapper, and it keeps the old path.
- **`.stage` is exactly the picture's box, and nothing that sits beside the picture may live in it.**
  `.ab` is `inset: 0` of `.stage` and `.abgrip` spans its full height — that is what lines the two
  A/B halves up pixel for pixel, and it holds only while `.stage` is the frame and nothing else. The
  control bar and the warning pill are therefore siblings of it inside **`.player`**, which is the
  box both overlays are positioned against. `ui.js` injects `camWarn()` into `.player`, not
  `.stage`, for the same reason.
- **The overlay bar is the special case and lives behind a query; the in-flow bar is the default.**
  `@media (hover: hover) and (min-width: 601px)` — marked `PLAYER_OVERLAY` in `chrome.css` — is the
  only place `#tl` is absolute, white, scrimmed and self-hiding. Everything outside it is the plain
  shape: in flow under the frame, on the dialog surface, in `var(--muted)` / `var(--hover)` /
  `var(--outline)` like every other control. **Do not invert this.** It was written the other way
  first (overlay by default, footer under `@media (hover: none)`), and any device that reports
  `hover: hover` when it should not — a touchscreen laptop, a paired stylus, an Android browser in
  desktop mode — fell through to a permanent black bar on the photograph that no pointer could
  dismiss. The safe shape has to be the one a misread lands on. Both halves of the query earn their
  place: the pointer test, because a bar that hides itself needs something to bring it back; the
  width test, because a phone can lie about the first one. The literal whites belong **inside** that
  block only — they cannot be tokens over a photograph, since tokens flip with the theme and the
  picture does not.
- **The seek bar is painted by `.tltrack`, not by the input.** The alert spans have to sit inside the
  bar and under the thumb, and `accent-color` cannot draw them — so `#tlscrub` is transparent
  (`appearance: none`, no track background) and the rail, the played part and the spans are three
  layers below it. `paint()` writes the play position to `--p` **on the track**, not on the input:
  the pseudo-elements that read it belong to the parent. There is no tick per frame any more, and
  there must not be one again — 60 hairlines over a control you drag is a graduation, and the frames
  are already an even grid, so the marks measured nothing the spacing did not. Colour is the whole
  message: a span is red or amber because a river near that lens was in trouble then.
- **The control bar's colours are literal, not tokens.** It sits on a photograph, so `--on-surface`
  and `--muted` would flip with the theme while the picture behind them did not. White and
  `#ffffffb3` in both themes. `--accent` is the one token that stays, on the thumb and the played
  rail, and it is legible on the scrim in either theme.
- **The lightbox's warning pill belongs to the frame on screen, not to the clock.** `paint()` in
  `timeline.js` rewrites it from `tierAt` — the same per-frame tiers the seek bar's coloured spans are
  drawn from, so the picture and the bar under it cannot disagree. Live is the only position that asks
  the live question. The metre figure comes from the station's `history` within half an hour of that
  frame and is **omitted** past the 12 hours of samples the payload carries, which is why `camWarn()`
  tests `'level' in a` rather than `??`: falling back to the live number there would print today's
  water on a picture from last week. A calm frame gets a `hidden` pill rather than none, so the mobile
  strip that `.player:has(.camwarn)` opens does not shut mid-clip and shift the picture 30px.
  **The pill is the lightbox's alone** — `camImg()` used to put one on the station panel's still too,
  and that picture is a 3-hour clip playing itself with nowhere to state a warning per frame. The
  card around it already gives the alerting sensor a section with the reading, the meter and the
  graph. Do not put it back there without a way to score the frame on screen.
  **Its words are `ALERT_TITLE` in `config.js`**, the same table the alert panel groups its rows
  under — `Water level at danger` / `Forecast to reach danger` / `Triggered siren`, with the reading
  appended where there is one. It lives in `config.js` rather than `alerts.js` because two surfaces
  read it and `popup.js` cannot import `alerts.js` (that module already imports `popup.js`). Change
  the phrase in one place or the panel and the picture start making two claims about one river.
- **The camera pill is the one alert surface that reads `atDanger()`, not `isHot()`.**
  `camAlert()` takes `isHot(s) || atDanger(s)`, so a flood gauge under water and rainfall in JPS's
  top class put a warning on the picture — because `atDanger()` is what already paints that camera's
  neighbour red on the map, and a clean picture beside a red pin reads as the map being wrong.
  **`isHot()` is untouched**: the alert panel, the icon badge, the ticker and the toast list exactly
  what they listed before, and widening *those* still goes through the alert design standard. Every
  kind `atDanger()` adds is observed, so it is `now` — only a river publishes a rate, so only a river
  gets `soon`. Each kind reads its own field and unit through `CAM_READ` in `popup.js` (`level` m,
  `depth` m, `hourly` mm/h); a siren prints no figure, because its samples are 0 and 1 and an archive
  frame hands that 1 straight in. `?shots=` scores the same four kinds server-side, or the pill would
  show on the live frame only — and the lightbox opens three hours back, so nobody would see it.
- **`.abtime` must stay outside `.ab`.** `.ab` is the older frame clipped to the divider, so a label
  inside it is cut in half whenever the divider comes near the left edge — and the right-hand label,
  which lives in the unclipped box, never is, which is what made it look like a bug. Both labels are
  children of `.stage` now, and `#lightbox:not(.cmp) .abtime` does the hiding that `.ab[hidden]` did.
- **The opening play delay is cancelled by `stop()`, and that is the only guard it has.**
  `openTimeline()` parks the scrubber three hours back and starts the clip two seconds later. Every
  deliberate move — a step, the scrubber, the compare button, `reset()` — reaches `stop()`, which
  clears `lead`. Anything new that means "I am looking at this frame" must go through `stop()` too,
  or it will be carried off that frame two seconds after landing on it.
- **A range segment holds two labels, and `setRange()` must never write over the button itself.**
  The short label is `.tls`, the long one `.tll`, and the pill grows because the CSS transitions each
  from `width: 0` to `width: auto` — which is only animatable because `interpolate-size:
  allow-keywords` is set on `.tlr`. Setting `b.textContent` would remove both spans, and the control
  would go back to jumping on every click with nothing in the console to say why.

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
- **leaflet.heat composites overlapping blobs, and both our layers plot an intensity, not a density.**
  Two gauges both reading 4 mm/h still means 4 mm/h, not 8 — but the canvas accumulates alpha, so N
  stations reporting the same thing paint something stronger than any of them reported. Measured:
  233 rain gauges, a median of 4 inside one 5 km blob and up to 14, stacking light rain (0.26) to
  0.97 — solid red over a state where nothing worse than light rain was reported. `thinHeat()` in
  `heat.js` fixes it by keeping the strongest reading and dropping anything its own blob already
  covers, which *is* "the highest reading within a blob radius" — the thing the colour claims to
  mean. **Any new heat layer must go through it**, and the water layer does too even though it has
  one point on a calm day: the flaw only appears when many stations alert at once, which is the one
  moment the map has to be right.
- **A heat layer's weight is its alpha.** leaflet.heat draws each point at its weight, so a scale
  that starts at 0 draws real readings as nothing. The water layer never hit this because its floor
  is the alert slot (0.38); the rain layer's first class therefore *starts at 0.25* (`RAIN_STOPS`)
  rather than counting up from zero. Light rain is most of the rain most of the time — 10 of 233
  gauges reporting and none above 4 mm/h on the day it was built — so a scale from zero would have
  shipped an empty-looking layer. Any new heat layer needs a floor chosen the same way.
- **Rainfall is an interval quantity, not a level.** It gets `rainBars()`, never `sparkline()` — a
  line between two rain readings claims a value in between that never existed. And `hourlyRainfall`
  is a *rolling* hour, so it buckets by `RAIN_BUCKET` (1 h): finer buckets show the same rain twice.
- `history` is `[[unix seconds, value], …]` on rivers (metres), rainfall (mm/h) and gauges (metres of
  depth, negative = dry). Rivers, rainfall and gauges carry a **third element, the status that
  sample was at**, scored in `sparkPoints()` through `wlStatus()` / `rainStatus()` / `gaugeStatus()` —
  the hover readout colours itself by it and flags the warning rung up. **Never score a historical
  value client-side**; add a scorer in `api.php` instead. Every reader destructures `[ts, value]`, so
  a kind without one is not a special case anywhere. The graphs
  plot against the clock, not against sample index. Windowed to `SPARK_WIN` (12h) and thinned to one point per `SPARK_BUCKET` (15 min)
  server-side; `SPARK_H` in `config.js` is a **cap**, not a fixed frame — the axis spans the points
  actually held and only starts sliding once they exceed it. It must not exceed `SPARK_WIN`.
- Station cards share one template: badge → name → region → body → still/link → footer. `meter()` renders
  water level on a **piecewise** scale (alert 38%, warning 68%, danger 100%) because real
  thresholds bunch above 88% on a linear bar. **The scale does not start at 0 m** — most stations read
  against an absolute datum (SERENDAH alerts at 35.80 m), so a bar from zero put every calm one hard
  against the alert tick and froze it there. `levelStops()` floors it `LEVEL_FLOOR` (6) alert→danger
  gaps below the first mark. One definition, in `util.js`: the meter, the table bar, the table's sort
  key and the heat weight all read it. Do not hand-copy the stops — `table.js` did, and its sort and
  its bar then disagreed.
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
