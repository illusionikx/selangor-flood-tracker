# Klang Valley Flood Watch

Single-page map of live flood telemetry for Selangor, Kuala Lumpur and Putrajaya, from three JPS
sources. `api.php` reaches three more hosts server-side. Each one answers a different question.
OpenStreetMap Nominatim answers the go-to box's place search (`?place=`). `met.gov.my` answers the
rain outlook. `api.data.gov.my` answers the day's temperature and MET's own warnings. Six upstream
hosts in all. **PHP contacts every one of them. The browser contacts none.**
No auth, no build step, no framework. Served by Laravel Herd at `https://flood-exp.test`.

> **Keep the docs current.** When a feature lands or a decision is made, append it to
> [`docs/FEATURES.md`](docs/FEATURES.md). State what it does and *why*. Include the trade-offs
> accepted and the things deliberately not built. New gotchas go in the gotcha list below. Do this
> as part of the change, not as a follow-up task.

## Files

| file | role |
|---|---|
| `api.php` | server-side proxy + cache + source merge + poll history + camera image proxy + rate-limited `?force=1` + place lookup (`?place=`, proxies Nominatim) + weather layer lookup (`?wx=1`) |
| `sources.php` | scrapers for the two HTML-only upstreams (national portal, JPS WP) and the three MET feeds (nowcast, forecast, warning). Also the national portal's rainfall table, gazetteer and 7-day history endpoints. Also the two JPS notice parsers: the MET mirror, the flood alert |
| `shots.php` | camera archive: capture, retention tiers, lookup, and the on-request strip (`buildSheet()`) the wall and the clip play. Required by `api.php` |
| `shots-test.php` | `php shots-test.php` — one of eight runnable checks. Guards retention. Exercises `pruneShots()` |
| `log.php` | where a browser error lands. `js/oops.js` is the only caller. Appends one JSON line to `.client-errors.log` |
| `watch.php` | reads a payload on stdin and complains when it is wrong. The poll cron pipes into it. Reports a change of state, never a state |
| `.user.ini` | per-directory PHP settings. Holds one line, `session.auto_start=0`, and the reason it is there |
| `index.html` | markup only — no inline CSS or JS |
| `title-test.html` | `chrome --headless --dump-dom` — one of eight runnable checks. Guards the wordmark ladder in both of the heading's homes, the app bar and the navigation rail, in rendered pixels |
| `narrow-test.html` | `chrome --headless --dump-dom` — one of eight runnable checks. Guards the narrow-window block: its threshold, its coverage, its refusal to be dismissed, and that it is modal |
| `paint-check.html` | `chrome --headless --dump-dom` — one of eight runnable checks. Guards the layer chips over the map: that the panel and its two openers are gone, that the filters panel and every district id are gone too, that a menu chip states its own value and a filter chip carries a checkmark, that the heatmap and the two filters leave with the station layer, that a filter chip clears itself on a second press, that nothing else on the map lands on the row, and that below 600px the row wraps rather than scrolling |
| `m3-check.html` | `chrome --headless --dump-dom` — one of eight runnable checks. Guards every M3 surface in rendered pixels: the nine dialogs against the roll call and the kind each is declared as, the four-band ladder, the map as an inset card, the one motion that changes what the pane holds, the supporting pane's headers and all five dialog headers as one M3 medium flexible top app bar, measured against each other at both widths, the supporting pane at M3's canonical ratios with the map giving up exactly that width, the pane as a side sheet above 600px and a full-screen dialog below it, and the station panel as an M3 list, one item per sensor, with its readings as a segmented list under a 24px kind glyph. Also the navigation rail at both its widths, the navigation bar below 600px, and that every enter carries M3's own duration and easing. Also the table dialog and the camera wall. Both take the one inset, shared by the search bar, the count line and the grid. The search bar states its own 56px shape. The sort target reaches 56dp. A tile states its container tone and a 12dp corner. The check also guards the two deletions, so a half-finished revert cannot ship silently. Also the warning dialog's body, as a declaration and in pixels, because Blink draws its broken rule and its fixed rule the same way |
| `kind-color-lab.html` | the station kind palette, derived in OKLCh at load. **Not a check** — it renders for a person to read, and it prints no verdict. It fetches `css/base.css` and reports whether the app still holds what the rule builds, so open it after any palette edit. It was seven competing options until 2026-08-26 and holds one palette now |
| `css/icons.css` | every icon, as an SVG mask. Generated — see docs/FEATURES.md for the fetch |
| `css/base.css` | tokens, reset, controls, blocks shared by popup + alert panel |
| `css/chrome.css` | page furniture: app bar, status dot, rail, navigation bar, legend, splash |
| `css/map.css` | Leaflet overrides, pins, cluster badges, popup template |
| `js/app.js` | entry point — decides what happens on landing, nothing else |
| `js/oops.js` | reports a browser throw, a rejected promise or a failed asset to `log.php`. No imports, and `app.js` imports it first |
| `js/config.js` | constants (kinds, palettes, thresholds, tile styles, `WEATHER`). Also `NOTICE`, the words for an upstream outage. No imports. |
| `js/state.js` | `state` (data + hereAt) and the `PREFS` blob. Breaks module cycles. |
| `js/util.js` | pure helpers + `hasInfo()` / `color()` / `isIgnored()` |
| `js/stations.js` | queries over the station set (`nearestOf`, `nearestCam`, `byId`) |
| `js/pins.js` | the station pins and the cluster chips, painted on ONE canvas. Sprite cache, greedy grid clustering, hit testing, and the danger halo's own frame loop. Replaced Leaflet.markercluster |
| `js/map.js` | map instance, basemap/theme, the pin layer, the station panel (`openSide`), `focusOn` / `flashTo`. Also the coverage mask, the zoom floor and the pan limit, all three off `border.json`. Also the zoom ceiling, 15, and `disableClusteringAtZoom: 15` on the cluster, which is what makes 15 the zoom that merges nothing |
| `js/heat.js` | both heat layers (water level, rainfall), ground-fixed sizing per layer, shared opacity. Also the field pass where a gauge reporting no rain denies the ground a wet one claims |
| `heat-test.html` | `chrome --headless --dump-dom` — one of eight runnable checks. Guards the rain layer's paint distance, its dry-gauge erase and its handover between neighbours, in canvas pixels |
| `map-limits-test.html` | `chrome --headless --dump-dom` — one of eight runnable checks. Guards the coverage circle, the zoom floor, the pan limit and the two water floors. It probes the drawn shape with `isPointInFill`, so it reads the fill rule the browser paints with. It asserts that the circle holds every point of the land ring, that its centre sits east of that ring's middle, that the faint stripes still carry their hairline, and that the pattern sprite is rendered rather than `display: none`, which is the one thing that empties the tile with nothing to say so |
| `js/popup.js` | popup + meter + gauge + sparkline templates. Also `wxItem()` and its three helpers, the weather list item both weather surfaces draw |
| `js/sparktip.js` | the hover/tap readout on every graph, and the label on any `data-tip`. One delegated listener, no imports |
| `js/render.js` | rebuilds markers and heat points, the two saved lists, and the kind counts |
| `js/alerts.js` | "On alert": the app bar's warning glyph, the list it opens in `#side`, the icon badge, the red favicon. Also the MET warning cards above that list |
| `js/table.js` | the all-stations table dialog, grouped district → mast → sensor |
| `js/locate.js` | geolocation, the "You are here" marker, and the amber button a failed fix leaves behind |
| `js/ticker.js` | header alert marquee — measured, no visible seam, speed scales with the alert count. Draws the MET warning tiles into the strip. Closes every set with the app's own name as a divider |
| `js/timeline.js` | camera archive replay + A/B compare, inside the lightbox and nowhere else |
| `js/clip.js` | the station panel's 3-hour camera clip — no controls, that is the lightbox's job |
| `js/toast.js` | desktop-only "new alert since last poll" toast |
| `js/test.js` | test mode: fakes a flood in the client's copy of the payload |
| `js/lazy.js` | `lazy()` — loads a deferred module and drives `aria-busy` for its skeleton |
| `js/net.js` | `load()` poll loop and the diagnostics popover on the brand glyph |
| `js/ui.js` | all DOM wiring: theme, chips, panels, lightbox, delegated jumps |
| `js/wall.js` | the camera wall: every camera on one page, one timer for all of them |
| `js/wx.js` | the MET weather layer: the map mode, the pins, and the half-hour panel. `hereCard()` draws that panel over the reader's own fix, and `carry()` hands a card across a layer switch. Deferred |
| `manifest.json` | PWA manifest. `.json`, not `.webmanifest` — see the gotcha below |
| `sw.js` | service worker: network-first shell cache, and the reason Chrome offers "Install app" |
| `icon.svg` | the app mark: bare glyph, no fill. Source for the PNGs *and* the `--i-flood` mask |
| `icon-build.php` | `php icon-build.php` — rebakes the two icons and prints the mask rule to paste |
| `water-build.php` | `php water-build.php` — rebakes `water.json` from OpenStreetMap. Holds the two size floors, `MIN_AREA_KM2` and `MIN_RIVER_KM`, and the Douglas-Peucker tolerance `TOL_DEG`. Takes `--tol=` and `--dp=` to try a value, and `--cached` to reuse the last raw Overpass answer. Run by hand, never in a request |
| `water.json` | the water the dark basemap will not draw: 866 rivers + 1,185 ponds, baked and committed. It held 2,775 and 3,864 until the size floors landed on 2026-09-02. 1,732 KB, 402 KB gzipped, since the tolerance went to 6.6 m on 2026-09-07 |
| `border-build.php` | `php border-build.php` — bakes `border.json` from OpenStreetMap. Two Overpass calls: Selangor's geometry, then its member way TAGS, so the sea boundary (`maritime=yes`) can be dropped before the circle is placed. Run by hand, never in a request |
| `border.json` | `circle` is `[lat, lng, km]` and is the one source for three things: the shading outside it, the zoom floor and the pan limit. Also the full outline and the land ring, which only `border-build.php` and `map-limits-test.html` read. 30 KB, 4 KB gzipped |
| `wx-build.php` | `php wx-build.php` — bakes `wx-places.json` from Nominatim. Run by hand, never in a request |
| `wx-places.json` | the district behind each weather point, baked and committed |
| `icon-192.png`, `icon-512.png` | manifest icons (`any`) and the favicon — the glyph on transparency |
| `icon-180.png` | `apple-touch-icon`. Opaque, because iOS flattens alpha onto a colour of its own |
| `img/` | optional. Only `egg.webp` (the About easter egg). Absent is a supported state — see below |
| `m3-build.php` | `php m3-build.php` — bakes `vendor/m3/tokens.css` from the M3 Expressive token set. Run by hand, never in a request |
| `vendor/m3/tokens.css` | M3's shape, typescale, elevation, motion and state scales, vendored. Generated — **colour is deliberately not in it** |
| `vendor/` | Leaflet, leaflet.heat (patched), subsetted fonts, the M3 token scales — no CDN, hand-managed. **markercluster left on 2026-09-03**, when the pins moved to a canvas |
| `basemap-spike.html` | **throwaway, not a check and not part of the app.** Twelve tile services at one view, with `water.json` over each. It answers which basemap draws the sea, because Esri's Canvas pair paints it near-black and a reader asked why the sea is not blue. It contacts OpenStreetMap, OpenTopoMap and CARTO, which the app itself never does. See docs/FEATURES.md |
| `maplibre-spike.html` | **throwaway, not a check and not part of the app.** Measures a MapLibre GL vector basemap against the Esri raster one under 460 canvas marks. It loads unpkg and OpenFreeMap, which the app itself never contacts. See docs/FEATURES.md for what it answered |
| `lib/` | Composer's vendor dir (`symfony/dom-crawler`), gitignored — **not** `vendor/` |
| `composer.json` | the one server-side dependency. Run `composer install` before first run |
| `.github/workflows/pages.yml` | bakes the static GitHub Pages build — runs the PHP on cron, publishes `api.json` |
| `docs/DEPLOY.md` | both targets: Pages (what it cannot do) and a Debian box / Proxmox LXC (spec, nginx, cron, container traps) |
| `docs/GOTCHAS.md` | every trap that already cost a debugging session. Left this file on 2026-08-27, over the 150,000-character limit. `## Gotchas` below indexes it |
| `docs/VERIFY.md` | the eight runnable checks and every sweep over the live payload. Left this file the same day, for the same reason |
| `.cache.json` | last payload (gitignored) |
| `.php-error.log` | this app's own PHP errors, and nothing else (gitignored) |
| `.client-errors.log` | one JSON line per browser error, written by `log.php` (gitignored) |
| `.watch.state` | the last verdict `watch.php` reached, so it reports a change and not a state (gitignored) |
| `.history.db` | sqlite: water-level samples per station, 30-day retention (gitignored) |
| `shots/` | the camera archive — one dir per camera, `<unixts>.webp` per frame (gitignored) |

**Composer is server-side only.** `composer install` writes to `lib/`, because `vendor/` already
holds hand-vendored browser assets that Composer must never manage. The front end is still
build-free and dependency-free. Nothing in `lib/` is ever sent to a browser.

**No build step.** The browser loads `js/app.js` as `<script type="module">` and resolves the
`import`s itself. Vendored libraries stay classic `<script>` tags because they publish globals
(`L`). Keep relative specifiers with the `.js` extension — there is no resolver to guess them.
Dependencies must stay acyclic. Anything two modules both need lives in `state.js` or `config.js`.

## Data sources

Three JPS feeds, joined on the national station code (`station_Id` in the Selangor API, `Station ID`
in both HTML tables). The national portal is now the **preferred rainfall source** as well as the
authoritative river reading. Priority for a *reading* is national/portal, then whichever feed placed
the pin. Coordinates for a station another feed already placed still come only from Selangor or WP.
The portal publishes none there. The portal can place a station no other feed carries. It does so
only through its own station search. That search feeds a small gazetteer this app drips in slowly,
never a per-poll coordinate. See the `## api.php` section below.
Only these three carry water. The other three hosts in the table below are not flood-data sources.
Nominatim answers `?place=` and joins nothing at all. The two MET hosts join a station by nearest
point and by district name, and they never touch a reading.

| source | gives | shape |
|---|---|---|
| `infobanjirjps.selangor.gov.my/JPSAPI/api/` | Selangor: everything, incl. the only cameras, sirens and gauges | JSON |
| `publicinfobanjir.water.gov.my` | national water levels + thresholds, the **authoritative reading** | HTML table |
| `publicinfobanjir.water.gov.my` (rainfall table) | national rainfall + a per-day running total, the **preferred rainfall source** | HTML fragment |
| `publicinfobanjir.water.gov.my` (station search + 7-day history) | the portal's own gazetteer, and the backfill for a rainfall archive | JSON |
| `infobanjirjpskl.water.gov.my` (SPHTN) | KL + Putrajaya water level and rainfall | HTML table |
| `met.gov.my/nowcasting` | rain now and every 30 min to +3 h, 294 points | HTML with baked-in JS |
| `api.data.gov.my/weather/forecast` | daily lowest and highest temperature, by district | JSON |
| `api.data.gov.my/weather/warning` | warnings from MET, with a validity window | JSON |
| `publicinfobanjir.water.gov.my` (JPS mirror of MET warnings — `jps-rain`, `jps-storm`, `jps-sea`, `jps-beat`) | continuous rain, thunderstorm, rough seas and a heartbeat, fresher than `api.data.gov.my` | JSON |
| `publicinfobanjir.water.gov.my` (flood forecast — `jps-flood`) | the JPS flood alert, with a validity window and a withdrawal code | JSON |

MET Malaysia adds three more feeds, all weather rather than water. They join no water reading and
override no station. The two JPS notice feeds sit on the same host as the national portal. Neither is
a reading, and neither joins a station either.

The nowcast and the forecast each attach to a station. The nowcast attaches by nearest point. The
forecast attaches by district name.

The warning feed attaches to nothing. It is a claim about an area, not about one station. It sits
above the alert list and on the moving headline. It never sits on a card.

All three requests run from PHP. The browser never contacts a MET host.

### 1. JPS Selangor API

Base: `https://infobanjirjps.selangor.gov.my/JPSAPI/api/` — public, no auth, **no CORS headers**
(hence the proxy). Discovered from `data/config.json` + `jpsFunction/map1.js` on the JPS site.

**List endpoints** (all stations, coordinates, status codes — but *no readings*):
`StationRainfalls`, `StationRiverLevels`, `StationSirens`, `StationFloodGauges`, `CCTVS`.
`Hotspots/GetHotspots` exists and is **not** fetched: it published 53 entries into the payload and no
client script ever read one. Add the URL back to `$lists` the day something plots them.

**Detail endpoints** `…/{id}` carry the actual values. Fetched for rainfall, river, gauge, camera
via `curl_multi` (~270 requests, ~3s cold). **The lists alone are not enough.** For example, flood
gauges return `lastReading: null` in the list but a real `floodLevel` in the detail.

Field notes:
- Rainfall detail carries more than `hourlyRainfall`. `threeHoursRainfall` is a 3-hour total and
  `cumulativeRainfall` is a **year-to-date odometer** (645–1656 mm across 8 stations in August).
  This app reads both now — see the accumulation gotcha below. `spLight` 5 / `spModerate` 11 /
  `spHeavy` 31 / `spVeryHeavy` 61 are the intensity classes for that one station. Nothing reads
  them. `RAIN_STOPS` hard-codes 10/30/60 for everyone. Moving to the published per-station numbers
  changes pin colour, heat weight and `rainStatus()`. So it goes through the alert design standard
  first. `rfSpike15` and `rfSpike60` are unread, and nobody examined them.
- River detail: `waterLevel1`, `wL1SPAlert/Warning/Danger`, `waterLevel1LastUpdate`.
- Gauge detail: `floodLevel` is the depth **over** a flood-prone spot. **Negative means dry ground**.
  Thresholds `spWarning` 0.15m / `spDanger` 0.3m.
- Camera detail: `imageUrl` is **plain http**, so https cannot hotlink it — proxied.
- **No feed publishes a state.** `api.php` stamps `state` from which feed placed the pin, at the
  point the station is built. It does not stamp it later, because `source` is overwritten to
  `national` wherever that portal's reading wins. District case is normalised to Title Case there
  too. District names collide across states. KL and Selangor both have a Gombak. So anything keyed
  by district must key by `state|district` — see `dkey()` in `js/util.js`.
- Siren **list** has no timestamp of any kind. Only the detail carries `statusLastUpdate`. That is
  the sole reason all 212 sirens are in the detail fan-out. Stamped >48h ago (`SIREN_STALE`) forces
  `online: false` — sirens heartbeat daily, so two missed days is out of contact, not idle.
- Timestamps are MYT with no offset. `api.php` pins `Asia/Kuala_Lumpur`. JPS stamps readings to
  the *upcoming* slot (17:45 at 17:36), so reading-age is floored at 0.
- `station_Id` (note the underscore — *not* `stationId`) is the national code the other feeds use.

### 2. Public Infobanjir (national) — `sources.php`

`…/index.php/aras-air/data-paras-air/aras-air-data/?state=SEL&district=ALL&station=ALL&lang=en`,
one call per state (`SEL`, `WLH` = KL, `PTJ` = Putrajaya). 301s to a canonical path, so
`CURLOPT_FOLLOWLOCATION` is required. Rows are `<tr class='item'>` and every cell carries a
**`data-th` attribute** — read columns by that (`$td->attr('data-th')`), never by position.

The portal also publishes rainfall, at `wp-content/themes/shapely/agency/searchresultrainfall.php` —
`portalRainUrls()` / `portalRows()` / `portalRain()` in `sources.php`. It once answered only headers
and no rows for every parameter tried. The missing piece was two hidden form inputs, `loginStatus`
and `language`, that the site's own page always submits alongside the query. With those added it is
now the **preferred rainfall source**. It gives an authoritative reading and a per-day running total
that neither Selangor nor SPHTN publishes. See the gotcha list for the row-parsing fault this table
hides.

The portal publishes a coordinate too, but only through a separate endpoint, its own station search
at `wp-content/themes/enlighten/query/searchstation_control.php` — `gazUrl()` / `gazParse()` in
`sources.php`. That endpoint answers a substring search over station names. It is not a per-poll
feed. So `api.php` drips it slowly into a small gazetteer table. It reads that table only to place a
station no other feed carries. A sibling endpoint, `getrainfalllast7days.php` — `seriesUrl()` /
`seriesParse()` — answers one station's own 5-minute rainfall history for the last 7 days. It also
seeds a running total for a station this app never polled before. See the `## api.php` section below
for both drips.

### 3. JPS Wilayah Persekutuan / SPHTN — `sources.php`

`WaterLevel/LatestData/All` and `Rainfall/LatestData/<district>` return HTML fragments. No `data-th`
here, so columns are read by **position, guarded on row width** (14 cells for both). Coordinates
appear only inside the row's `onclick="loadMapPage(lat, lng, …)"`.
**Rainfall has no working `All` route, and must be fetched one district at a time.** That handler
holds the connection open until the client gives up. It behaved that way since 07/08/2026. Its
water-level twin answers in 3.9 s on the same host. `KL_RAIN` in `sources.php` holds the ids, and
`klStations()` merges the rows of every `kl-rain-*` page before it reads them. **The ids are not a
range**: 1 to 11 are what the site's own dropdown offers. Ids 23, 24, 25 and 27 carry seven more
stations the dropdown never lists, in Gombak, Pandan, Ampang and Bentong. Measured
2026-08-12: 12 to 22, 28 and 30 answer 500. Ids 26 and 29 answer 200 with no rows. Nothing from 31
to 60 carries a row. Do not restore the `All` URL because it is one request rather than fifteen. It
cost 25 s on every rebuild, which is the gotcha below.

Also publishes its own trend arrow (`<img trend="Rising|Receding|No Change">`) — the only feed that
does. **Not parsed.** It was read into `srcTrend` and never used, and both the parser and the field
are gone. `rising` is a claim about reaching a danger mark within hours, and a bare direction arrow
is no evidence for that. Column 13 is still in the layout comment in `sources.php`, because the
14-cell row guard counts it.

Sirens are skipped: 11 stations with ragged column counts, and the state cell is the one that goes
missing. Cameras are skipped: `Camera/District/{n}` returns an empty fragment.

## api.php

- 5-minute file cache. If upstream dies, it serves stale cache, flagged `upstreamOk: false`.
- Scraped pages get their **own** 15-min cache in the `page` table of `.history.db`. The KL rainfall
  table takes ~10s to render upstream, against ~0.3s for a JSON call. A refetch every poll triples
  the cost of a refresh, for data that cannot have changed. A page that fails to fetch falls
  back to the stored copy. Warm poll ~3.5s, and one poll per quarter hour pays the ~15s.
- Merge order, in six steps. Selangor API first. Then KL, which skips any station within ~200 m of
  one we already have. The two feeds share no station codes. Then the national override by code
  (rivers). Then the portal override by match (rainfall). Then new rows the national portal alone
  knows, placed from its own gazetteer. Last, a trend pass over the winner.
- Every station carries `source` (`selangor` / `kl` / `national` / `portal`) and, where known, `code`.
- **Two drips run at the end of a refresh, inside the same lock, the shape `captureShots()` already
  uses.** Each refresh takes at most `GAZ_FILL` (5) prefixes and `HIST_FILL` (5) stations. Each runs
  at most once per `GAZ_EVERY` / `HIST_EVERY` (600 s each), site-wide, behind `.gaz.stamp` and
  `.hist.stamp`. The gazetteer drip queries the portal's own station search. It writes a
  `station(name, lat, lng, district, state)` row in `.history.db`. `gazPlace()` reads that row to
  place a rainfall or river row the portal alone knows about. The history drip fetches one station's
  7-day series and writes it into `level` under a `<id>#c` key, through `seedRebase()`. See the
  gotcha list for why the seed must join the running total this app keeps, rather than restart it.
  Both drips reuse the `page` table's reserved-prefix pattern (`gazdone:`, `histdone:`), the same one
  `notice:` and `place:` already use. So each row marks a prefix or a station asked, whether or not
  it answered. That is the rule `pageRow()` already states for a scraped page.
- **`camFix()` corrects or supplies twenty-five camera coordinates, across two faults in JPS's
  feed.** Fourteen are swapped between cameras. Eleven are published with no coordinate at all. It
  is the only place this app overrides a value the feed states. See the gotcha below for the rule
  that admits an entry to `CAM_FIX`. It also names the seven cameras confirmed correct and
  deliberately left out of it.
- `?cam=<id>` streams a camera still. It validates that the id is an integer. It looks the URL up in
  the cached payload. It rejects any host that is not JPS. It never proxies an arbitrary URL.
- `?force=1` treats the 5-minute file cache as expired, inside the existing `flock` on
  `.refresh.lock` — never a second path to JPS. `forceAllowed()` caps it at one force per 60
  seconds, site-wide, through a stamp file. `serveFromCache()` then makes the same cache-or-rebuild
  choice an ordinary poll makes, with the force flag as one more input. Both functions carry their
  own offline check, `php api.php --selftest`. The one caller is the About dialog's Developer
  section, next to the per-source `parsed` counters and a Raw payload link. See
  `docs/FEATURES.md` for the four rules and the arithmetic behind 60 seconds.
- **Camera archive** (`shots.php`): `?shots=<id>` lists a camera's stored frames, `?shot=<id>&t=<ts>`
  serves one. Both parameters are cast to `int` before touching the filesystem, so the path cannot
  leave `shots/` — the same rule as `?cam=`. A frame is stored as **`.webp` or `.jpg`, whichever came
  out smaller** at 720p. The two are within 2% on this footage. So nothing can assume an extension.
  Go through `shotFile()`, and take the content type off the file it found. Capture runs at the
  *end* of a refresh, at most once per `SHOT_EVERY` (30 min), however often the payload rebuilds.
  That is why one poll in six is several seconds slower. **Do not tie capture to the poll**: 90
  cameras × 250 KB × 288 polls is 6.5 GB/day aimed at JPS from one address. That is the stampede the
  lock exists to prevent, in slow motion.
- Trend is **derived here**, not upstream. `.history.db` (sqlite, `level(station, ts, level)`,
  PK-deduped, 30-day retention, WAL) holds the samples. Each poll loads the last 24h. **`ts` is the
  reading's own stamp (`readTs()`), never the poll time** — see the gotcha below. `rate` = the
  **median of every pairwise slope** in a 3h window (Theil–Sen, pairs ≥ `TREND_MIN` apart), not a
  chord between two samples. `rising` is a **forecast, not a rate**, and it needs all five of these.
  The rate is `≥ RISE_FLOOR` (0.1 m/h). The level is strictly above the sample two back. The level is
  at or above its own 24h high, which is what keeps a tide out. The `eta` — hours to its *own* danger
  mark at that rate — is within `RISE_ETA` (3 h). The same was true on the previous poll (on-delay).
  `eta` is published whenever a station climbs, so the UI can show what the cutoff cuts off. The client reads `s.rising`. It never re-derives it, and nothing mirrors `RISE_ETA`
  client-side any more. `$assess()` takes a sample *index* precisely so the on-delay needs nothing
  persisted between requests.
- **Rain totals over five nested windows** ride on every rainfall station as `acc`, keyed
  `h1` / `h3` / `day` / `h24` / `h72`. Each is `[mm, derived, spanHours]` or `null` where nothing can
  answer. `derived` is 1 where this app worked the number out, and the card prints an asterisk on
  it. 1 hour and today come off the feed, and so does 3 hours where Selangor publishes its own
  total. Every other window goes through `accWindow()`, which subtracts two samples off a running
  total. That total is `portalOdo()`'s figure for a station the national portal carries. For a
  Selangor station the portal does not carry, it is the year-to-date `cumulativeRainfall` odometer.
  Those totals live in the `level` table under `#c` and `#d` suffixes. So there is no schema change,
  and `RETAIN` prunes them with the rest.
  `ACC_READ` (80 h) is their own load window, because `READ` is 24 h and too short.
- Response also carries real diagnostics used by the status popover: `tookMs`, `details.ok/requested`,
  `offline`, `cacheAge`, `sourceUpdated`.
- **`?place=<query>` — the go-to box's place search.** It proxies OpenStreetMap Nominatim
  server-side, so this adds no new third party to the *browser*. The browser still talks only to this
  origin and to Esri's basemap tiles. See the third-party gotcha below. PHP alone reaches Nominatim.
  `placeQuery()` trims, collapses and lowercases the query. It rejects a query outside 2–80
  characters, or one with invalid UTF-8. `placeParam()` guards the one call site that turns
  `$_GET['place']` into the string it expects — see the array-cast gotcha below. Results are bounded
  to `BOX`, the coverage area with about 0.1 degrees of margin on the station extent. Only four
  fields survive per result (`name`, `detail`, `lat`, `lon`). The raw Nominatim response is large,
  and its shape is not ours to depend on. Each answer is cached in the `page` table of `.history.db`
  for **30 days** (`PLACE_TTL`), because place names do not move. That is a much longer life than the
  scraped pages' 15 minutes. The uncached path is rate-limited to one lookup per second, site-wide.
  `.place.lock` guards it, taken, used and released around the check only, never across the fetch.
  The stamp lands in `.place.stamp`, through the same `forceAllowed()` the force-refresh button uses,
  at its own `PLACE_EVERY` window. The connect to `.history.db` is wrapped in try/catch. This handler
  already sent `Content-Type: application/json` by the time it runs. So an uncaught `PDOException`
  puts a PHP fatal-error page inside a response a client expects to parse as JSON. A connect failure
  degrades to "no cache" rather than a broken response.
- **`?wx=1` — the weather layer.** Serves the row a refresh already wrote in the `page` table,
  keyed `wx:box`. This handler parses nothing and reaches no upstream. So it cannot be slow, and it
  cannot fail in a new way. A try/catch wraps the connect to `.history.db`, the same shape `?place=`
  uses. A missing or unreadable row degrades to `{"points":[]}` rather than a broken response. The
  body carries an `ETag`. MET reissues about every 30 minutes, against a poll every 8.5. So most
  polls cost one 304 rather than the full body.

## Colour language — do not violate

- **THE SIX KIND HUES ARE BUILT TO A RULE, IN OKLCh, AND `kind-color-lab.html` DERIVES THEM.** The
  repository owner set that rule on 2026-08-26: the whole hue range, and a chroma that separates a
  kind from the functional set. One chroma for all six, at 0.119. Six hues 60 degrees apart, with
  water pinned at 238 and rain at 310 because meaning outranks a score, and the other four taking the
  seats those two leave.
  **The chroma window has a FLOOR as well as a ceiling.** The functional set holds both ends of the
  axis: `--s-none` is grey at 0.012 and the other three run 0.17 to 0.23. A kind pushed low enough to
  clear the vivid set lands on the no-reading grey instead. The window is about 0.09 to 0.16.
  **THREE LIGHTNESSES, ONE PER SURFACE, and this replaced a two-block palette.** 0.620 on paper,
  0.760 on the dark theme, and **0.690 on a map pin AND on the station panel**, which is a block of
  its own. See the pin entry below.
  **`#side` JOINED THAT BLOCK ON 2026-08-26, on a reader's instruction.** The panel drew its kind
  glyphs from the paper block while the map drew the pin they came from at 0.690, and a reader read
  the two side by side and called the panel wrong. A glyph on the card is the exact hex of the pin
  now, on BOTH themes — `#side` is an id, so it beats `:root` and `:root[data-theme="dark"]` alike.
  **The cost is measured and accepted.** On the light card 0.690 gives a kind glyph 2.6 to 2.9:1
  against 3.4 to 3.9 at 0.620, so it is now under WCAG 1.4.11's 3:1 for a graphical object. That is
  the same divergence the disc knockout already states. On the dark card it is 5.5 to 6.1:1.
  **Three surfaces still draw a kind at 0.620 and the change did not reach them**: the all-stations
  table, the go-to search rows, and the layer chip's kind menu. The instruction named the panel.
  Written down rather than swept in.
  **`--k-weather`, `--k-source` and `--k-notice` are not station kinds and they follow the rule
  anyway, since 2026-08-26.** They were the last of the old eye-built set. Measured before: weather
  L 0.565 C 0.060, source L 0.624 C 0.063, notice L 0.493 C 0.089. **C 0.060 is under the chroma
  floor**, which is the exact fault that floor exists to stop, and notice sat on hue 244 — water's
  own 238 — while its own comment forbade borrowing `--k-river`. They take each block's lightness at
  the kinds' chroma, on the three seat MIDPOINTS: weather 208, source 328, notice 268. A midpoint is
  about 6 dE from its nearest kind against 11.8 between two kinds, and that is paid because none of
  them ever appears among 400 pins. **All three are in the `.pin, #side` block too**, because the
  Weather section is a row in the panel's own sensor list. A pin resolves none of them.
  **Colour blindness is out of scope**, on the repository owner's call the same day. The lab page
  still measures it and still greys those columns rather than deleting them.
- **Station type** never uses a traffic-light hue: river blue, rainfall violet, siren pink, gauge
  taupe, camera cyan, mast indigo. Tokens `--k-*`.
- **Status only**: green → amber → orange → red (`--s-normal` / `--s-alert` / `--s-warning` /
  `--s-danger`, exposed as `STATUS_COLOR`), plus grey `--s-none` for offline / no reading.
  **There is no exception. A reader cut the one this app tried.** `#locate.fail` painted `--s-alert`
  for a location this app failed to get. That is a fault in a control, rather than a station in
  trouble. On a flood map an amber glyph in the app bar reads as an alert on the water.
  **A broken control changes its glyph, never its hue.** See `--i-location_disabled`.
- **The values live in `css/base.css` and nowhere else**, two sets, one per theme — except on a map
  pin and on the station panel. `.pin` shares the dark theme's set on both themes, through the
  selector `:root[data-theme="dark"], .pin` on the map-palette block, and `.pin, #side` states the
  six kinds again below it at 0.690. The pin glyph carries a real `stroke`, so its fill no longer has
  to hold 3:1 against white paper alone. Every other surface that
  paints a kind or a status still swaps with the theme. Any token a pin resolves must be in that
  block: `--c` arrives as an inline style on `.pin` itself. So a missing one falls back to the theme
  value, and draws a single pin off-palette. Do not write a hex into a JS file, or copy one into a
  doc. Every hex outside that block goes stale the next time the palette moves. The palette moved
  four times. The one exception is a **canvas**: the heat gradient cannot resolve a token, so
  `RAIN_HEAT` in `config.js` keeps real values. The water gradient in `js/heat.js` keeps its own for
  the same reason, and the two `#legend .ramp` rules restate both a second time. Those four are one
  ladder in four places and they move together. See the wash gotcha below.
- **A SENSOR WEARS THREE COLOURS AND NEVER A FOURTH: its own kind, the alert amber, or the danger
  red.** The repository owner set that rule on 2026-08-26, for the map first and then for the card,
  the table and the meter with it. `color()` in `js/util.js` is the one function that answers it, and
  every surface that paints a reading reads that function.
  **Where each ladder crosses.** A water level takes amber at its alert mark and red at its danger
  mark. A flood gauge takes amber at 0.15 m and red at 0.3 m. A rain gauge takes amber above
  30 mm an hour and red above 60, which is `isCritical()`'s own cutoff. A siren has no middle state
  at all: it is idle in its own pink, or sounding in red.
  **Four rungs went and the cost is real.** A river's alert mark and its warning mark are one amber.
  A flood gauge's dry ground and its unnamed water are one taupe. A rain gauge's dry, light and
  moderate classes are one violet. Every one of those is still on the card in WORDS, and the meter
  still draws each published mark as a tick with its own label. Colour stopped carrying them.
  The argument for paying it: a map is a ten-second scan, six ramps of four rungs is a code nobody
  was taught, and the two ambers measured 14 degrees apart on the hue wheel.
  **`STATUS_COLOR` is the TIER ladder and is not this.** It keeps four rungs, because `heavy` and
  `soon` are two tiers that share `--s-warning`. Two questions, two ladders of different lengths.
  Never reach for `statusColor()` to paint a reading.
- **`--s-trace` HAS NO CALLER ANYWHERE, and it stays declared.** It was the rung between normal and
  alert, and a flood gauge holding water under its first published mark was its only user. The
  three-colour rule above took that rung. The token is kept in `css/base.css` on both themes, with a
  note saying so, because a rung cut out of a palette cannot go back without measuring the whole set
  again. Delete it the day somebody is sure. Do not reach for it meanwhile.
  `--s-warning` is still live, and only the tier language reaches it.
- `hasInfo(s)` decides colour vs grey. A station with no reading must never look confident.

## Gotchas that have already bitten

The entries moved to [`docs/GOTCHAS.md`](docs/GOTCHAS.md) on 2026-08-27. This file was 456,000
characters, and Claude Code truncates a `CLAUDE.md` past 150,000. So the section that held two
thirds of the file now sits one Read away.

**Read that file before you change a subsystem it names.** Each entry states a trap that already
cost somebody a debugging session. The index below carries the first line of every entry, in the
order that file holds them. A trap names itself here, and the file states the evidence.

- `-9999` means "no reading"
- JPS shuffled the coordinates inside one batch of cameras, so a pin can be 8...
- A `(string)` cast on `$_GET[...]` does not throw on an array — it emits a w...
- The KL endpoints return bare `<tr>` fragments.
- `children('td')`, not `filter('td')`,
- Iterating a `Crawler` yields raw `DOMNode`s
- `crawl()` reads nothing from the national portal's rainfall table.
- `pageHasData()`'s `<tr` test cannot answer for the portal rainfall page.
- `clean_rainfall` is the disjoint 5-minute bucket in the 7-day history serie...
- A `graphId` is a string, and casting it to `int` silently breaks the histor...
- A running total must never restart when this app cannot advance it.
- A name alone cannot place a station.
- The corroboration check has a floor, and the floor is a hole.
- A skipped rainfall bucket understates the seeded history, and nothing marks...
- Never `file_get_contents()` a JPS URL — always curl.
- Every picture in this app fails into `.camfail`, and a failed `<img>` must ...
- `rm -rf shots/` is a year of camera history
- A retention bucket aims at a clock time, and both sides must aim at the sam...
- A sample's `ts` is when the reading was taken, not when we polled.
- A rain total over 24 or 72 hours is a difference, never a sum.
- A window can also cover LESS ground than it names, and then it says so.
- The accumulation chart carries no threshold mark, and three sources failed ...
- A tide is a rise, and three of these stations are tidal.
- Never `rm .history.db` to test a cold start.
- The scrapers fail silently by design
- A page-cache row that never answers can never advance its own timestamp.
- `session.auto_start` serializes every request from one browser, and it also...
- `error_log()` writes to standard error, and a FastCGI server folds that int...
- A geolocation permission can read `granted` and still yield nothing, becaus...
- `js/oops.js` must stay the first import in `app.js`.
- No `fastcgi_finish_request` under Herd
- One rebuild at a time, enforced by `flock` on `.refresh.lock`.
- Herd serves everything `Cache-Control: max-age=10800`.
- A pseudo-element that sets `--i` paints nothing until its selector joins th...
- `filter` runs before `mask`, so a filter on an `.i` is discarded.
- A map pin's glyph is an inline `<svg><use>`, not a masked `<i>`, and the ou...
- THE MAP'S PINS ARE PAINTED ON A CANVAS, so the pin appearance lives in TWO...
- A CSS `filter` on a map marker rasterizes again on every frame of a zoom.
- A frame count on this map climbs over the first minute. Measure A against B...
- `disableClusteringAtZoom` names the first zoom that clusters NOTHING, and th...
- Three numbers set the zoom ceiling together, and a new station moves one of ...
- `zoomSnap: 0` is slower here and it breaks the cluster grid.
- `chunkedLoading` buys nothing at this size.
- A pin token resolves against a `.pin`, and the root gives a different answer.
- A sprite is a picture, so a theme swap has to throw the cache away.
- The pin canvas takes no pointer events, and the map does the hit testing.
- Cluster in PROJECTED pixels at a whole zoom, never in container pixels.
- A halo sampled on one frame reads as blank.
- Two `stroke` attributes on one SVG element is a parse error, and an `<img>`...
- FOUR MARK SHAPES ON THE MAP, AND EACH IS SIZED AGAINST THE STATION DISC.
- "YOU ARE HERE" IS A GREEN DOT WITH NO GLYPH, and it was an amber crosshair.
- Both glyphs on a map pin carry an explicit `z-index`, and the painting orde...
- There is no icon font any more, and there must not be one again.
- The service worker must never cache a reading.
- The app icons are transparent, so `purpose` must stay `any` — never `any ma...
- Do not add `mobile-web-app-capable` — or put `apple-mobile-web-app-capable`...
- iOS has its own icon, `icon-180.png`, and needs it.
- The icon badge follows the app bar's alert count and nothing else.
- The PWA paths are all relative
- The manifest is `manifest.json`, not `.webmanifest`.
- Herd serves `index.html` with HTTP 200 for missing files.
- A multi-click gesture needs `user-select: none` on everything it touches.
- Nothing optional can fail the Pages bake.
- A `<dialog>`'s `display` goes on `[open]`, and a popover's on `:popover-ope...
- Every `<dialog>` in this app is one of three kinds, and a bare `.modalhead`...
- `#warnBox`'s icon sits ABOVE its headline, which is M3's basic dialog anato...
- A browser's own stylesheet caps every `<dialog>`, and it silently ate one b...
- A zero flex basis measures zero in a flex column of AUTO height, and only W...
- A pointer press focuses a `<button>`, and `tabindex="-1"` does not stop it.
- The four dialogs sit on a four-band ladder, and three variables carry it, n...
- A sticky header inside a padded scroller pins to the PADDING box, not to th...
- Below 600px FOUR surfaces are M3 full-screen dialogs, and none of them need...
- A popover inherits ten declarations from the UA sheet, and `height: fit-con...
- There is no map popup any more, and there must not be one again.
- Both headers in the pane are M3's MEDIUM FLEXIBLE top app bar, and each was...
- The card arrives as one string and FIVE pieces of it move.
- Three numbers used to put the place name on the close button's line, and al...
- An equal split is EQUALITY, and a flat `50vw` is not it.
- The 30% ratio needs a floor, and 840px is where that shows.
- The map card has TWO insets and they are not interchangeable.
- Every furniture box adds the card's inset as well as `--pane-w`, and WHICH ...
- One motion changes what the supporting pane holds, and two events read it.
- The occupant exit is instant, and that is the station swap's own behavior.
- The occupants are `position: absolute; inset: 0`, and the swap is why.
- An occupant of `#pane` is a fixed header over a scrolling body.
- An `<h2>` keeps the UA block margin, and `css/base.css` resets `h1` alone.
- The card treatment and the gap turn on together, and the radius is why.
- Three surfaces lost their line, and none of them gets it back.
- `#map`'s `right` transitions now, and that reverses an earlier decision.
- `invalidateSize()` needs `debounceMoveend: true` now, and the heat layer is...
- `#pane` is a `<dialog>` and the window class picks the METHOD, not the styl...
- `show()` runs the dialog focusing steps too, and on a desktop that is wrong.
- A dialog's `close` event is fired ASYNCHRONOUSLY, so a flag set around `clo...
- `syncPane()` runs from a `MutationObserver` on the body class, so the open ...
- A module that wires an element at import time makes every test page carry t...
- EVERY PANEL IN THIS APP WEARS ONE HEADER, AND IT IS THE PANE'S OWN APP BAR.
- `--pane` is the `.docbox` padding and a SECOND rule held a literal copy of it.
- The pane's leading button is a BACK ARROW at every width, and it is first i...
- The bottom sheet is gone again, and the reversal is the entry.
- A FILTER WITH NO SURFACE IS WORSE THAN NO FILTER.
- The map is a pane, so Leaflet has to be told when its box changes.
- `--pane-w` does NOT transition, and that is a decision.
- `--pane-w` is 0 at every state below 600px.
- Stepping aside for the pane is only half of it. The furniture has to clear ...
- Three boxes step aside for the pane and the zoom control must not.
- `focusOn()` carries no offset any more. Do not put one back.
- One pane, one occupant.
- The pane animates and its occupants do not.
- `#pane` is not `class="surface"`.
- A header written as a row in the flow needs a height before anything pins i...
- `.pophead` is the station card's first element, so no rule can key on `#sid...
- The station panel is an M3 LIST, one item per sensor, and it was one filled...
- A place name is capitals from JPS and Title Case from the national portal, ...
- `render()` refreshes the open card in place, so `openSide()` must stay idem...
- Nothing can close the card except the reader
- The alert list is a tenant of `#side`, under the key `@alerts`.
- `#alertBtn`'s `aria-expanded` is synced from `openSide()`/`closeSide()` in ...
- `#netstats` is a sibling of the `<h1>`, not a child of the mark that opens it.
- You cannot focus something you are still animating into view.
- `focusOn()` centres on the strip of map that is actually visible.
- Stations within `SITE_M` (50 m) are one place.
- A cluster badge counts what it hides, not what is in the area.
- Offline gauges are frozen on old flood readings
- 41 sirens last reported months ago
- The siren band frames on the clock, and it is the only graph here that does.
- A siren reading 1 is a claim, not a fact, and the river behind it is the check
- A rain gauge's hourly reading is a claim too, and its own odometer is the c...
- Nothing outranks a popover except another popover.
- A graph's samples ride on the element, in `data-pts`.
- A flood gauge's status colour comes from `gaugeColor()` in `util.js` and no...
- The Selangor list publishes `-1` for "no status" on stations that report a ...
- `atDanger()` is the map's red. `isCritical()` is the alert path's.
- `tier()` has FOUR rungs, and the fourth one is severity rather than certainty.
- Test mode makes a place tell one story.
- The alert panel is a directory, not a stack of readings.
- THE HEAD'S CHIPS ARE M3 ASSIST CHIPS AND THEY ARE LIFTED. A GROUP HEAD IS N...
- AN ALERT GROUP IS A SUBHEADER OVER A LIST, AND IT DRAWS NO SHELL AT ALL.
- `.mseg` is SHARED, and the hoist out of `#settingsBox` is a specificity trap.
- `alertPane()` in `m3-check.html` runs AFTER `desktop()`, and the order is l...
- `title` is not a tooltip on a phone.
- A timestamp is printed inside a ⋮ menu and nowhere else.
- A marquee needs three things measured, not guessed.
- `border-collapse: collapse` drops padding on the table box
- leaflet.heat sizes in screen pixels.
- A blob is painted `radius + blur` across, not `radius`.
- "Gauge" in the rain heat entries below means a rainfall station.
- A rain gauge reporting zero is a reading, and the rain heat layer draws it.
- NEITHER HEAT WASH FOLLOWS THE THREE-COLOUR RULE, AND THAT IS SETTLED.
- A heat blob's alpha is its colour as well as its size.
- A rim facing empty ground and a join between two blobs are different edges.
- The denial touches alpha and never colour, and that survived the move out o...
- A canvas radial gradient clamps past its last stop, so never `fillRect` one.
- Switching a heatmap off used to freeze the whole map, and the reason is one...
- `heatScale()` must only size a layer the map holds.
- A zoom fires `zoomend` and then `moveend`, and the heat layer paints on the...
- The water layer has no denial and must not get one, and everything else it ...
- Leaflet paints its container `#ddd` in both themes.
- Leaflet puts `.leaflet-touch` on its container, and its two-class rules bea...
- `maxZoom` belongs on the map, not only the tile layer.
- The heat canvas is padded (PATCH 3), so raw container points are not canvas...
- simpleheat's blob is a shadow, and it leaks past `radius + blur > 200`.
- `?shots=` returns `[ts, tier, stationId]`, not a bare timestamp.
- Two image endpoints answer for one camera, `?shot=` and `?sheet=`, and they...
- `clip.start()` must stay idempotent by camera id *and* by generation.
- `.shotwrap` clips its overflow and holds two children.
- `position: relative` does not scope a `z-index`, so `.camtile` carries `iso...
- The lightbox reads its camera from `data-clip`, not from the clicked image'...
- `.stage` is exactly the picture's box.
- The overlay bar is the special case and lives behind a query. The in-flow b...
- The seek bar is painted by `.tltrack`, not by the input.
- The control bar's colours are literal, not tokens.
- The lightbox's warning pill belongs to the frame on screen, not to the clock.
- The camera pill is the one alert surface that reads `atDanger()`, not `isHo...
- `.abtime` must stay outside `.ab`.
- The opening play delay is cancelled by `stop()`, and that is the only guard...
- A range segment holds two labels, and `setRange()` must never write over th...
- A claim about what the app does not do needs a check that lists what it doe...
- A value read back out of the cache must default inside one function.
- `cacheAge` and the payload `ETag` are one repair, and neither half is safe ...
- Moving an element to a new parent can change which flex rule governs it.
- The go-to box lists sites, and `hits` holds row objects rather than stations.
- A picked place refills the list. It opens no card.
- Nothing calls `?place=` until the reader asks.
- The camera wall is painted on a poll, never rebuilt.
- A grid row does not follow its item's `aspect-ratio`, so `#camGrid` sets `g...
- Under `NARROW_PX` (300) the app blocks the whole page, and that block is a ...
- The heading has TWO homes, and a wordmark ladder measured in each.
- The navigation rail runs the full height and expands.
- The rail's travel re-rasters the map card every frame, and `--m3-rail` is 1...
- A rail toggle also drops frames on the heat canvas, and nothing was changed...
- The navigation bar is what a compact window gets, and the rail does not dra...
- The app bar below 600px carries two absolutely positioned action groups.
- The search has two homes too, and above 600px it is M3's DOCKED search view.
- The app bar wordmark has four spellings and the title rail picks one.
- `.muted` carries a `font-size`, so it beats whatever size its context passe...
- A graph's viewBox is stretched, so a mark on the plot goes in HTML over it,...
- A label sharing a box with a percentage-height bar has to be reserved with ...
- TWO PROVIDERS SIT IN `js/map.js` AND `CARTO_KEY` PICKS ONE.
- THE BASEMAP WAS ESRI FROM 2026-08-27, AND THE TILE FILTER IS DELETED.
- A GREY CANVAS BASEMAP DRAWS ALMOST NO SMALL WATER, and no filter can recolo...
- Tolerance and scope are different knobs on `water-build.php`, and the wrong...
- `MIN_AREA_KM2` and `MIN_RIVER_KM` are size floors, and they REVERSE what th...
- A lake's outline is several ways in one relation, so closing each one separ...
- `border-build.php` fetches Selangor alone, and dropping its inner rings is ...
- Do not set `fillRule` on the mask.
- The mask's outer ring is finite, and a ring around the whole world is what ...
- The mask draws a CIRCLE and it drew Selangor's outline, and the outline is ...
- The diagonal stripes went and came back lighter, all on 2026-09-02.
- The stripes are faint and the hairline is what states the boundary.
- The stroke on the mask path draws the circle and nothing else.
- One box holds the zoom floor and the pan limit, and two numbers cannot be t...
- `setLimits()` runs after `invalidateSize()` and never before it.
- The circle is placed and sized on LAND alone, and only `border-build.php` c...
- The minimum enclosing circle is the wrong circle here, and it was measured ...
- A radius that exactly reaches the farthest point puts that point ON the bou...
- The MET nowcast page has no endpoint to find.
- `MET_KM` is a flat 15 km, not a radius scaled to how far each point reaches.
- The warning feed carries no coordinates.
- The two warning surfaces disagree about time on purpose, and `fresh` is the...
- A MET warning counts toward nothing.
- The payload poll must never pass `cache: 'no-store'`.
- The `modulepreload` list has no build step, and it drifts silently.
- A loading skeleton takes its state from `aria-busy` on the dialog. It takes...
- `lazy()` rethrows a failed import, so every caller owns a failure surface a...
- The JPS MET mirror answers JSON that is not valid JSON.
- A stale feed and a calm feed look the same, and `parsed: 0` cannot tell the...
- Zero rows is not old.
- A warning stamp needs the ISO shape, or the merge and the modal both misrea...
- A JPS notice feed is an archive of reissues, not a picture of now.
- A national bulletin names several regions, and only one of them is ours.
- `floodAlerts()` has never seen a row.
- MET publishes no past, and the weather panel needs one.
- A station must never supply the district for a weather point.
- CLOUD AND THUNDERSTORM ARE GONE FROM THIS MAP, and the ladder is the whole ...
- RUNG 0 HAS TWO GLYPHS and the Malaysian hour picks one, so never assert `su...
- The pin ladder used to collapse both wet rungs to `rainy`, and it does not ...
- The Weather row in the layer menu draws `partly_cloudy_day`. The rung ladde...
- The day's temperature shares the `NOW` card's bottom line with the clock, a...
- Cloud is a refinement of rung 0, never a rung of its own.
- A thunderstorm is the mirror of cloud, and it refines the WET rungs.
- Every section of the legend fits its own content, and none of them states a...
- Weather mode never writes `PREFS.heatLayer`.
- Two MET points stand 80 m apart and never separate.
- A search bar here filters in place and opens no view.
- A camera tile is an M3 filled card carrying a 2px status border.
- The table states ONE inset, and it stated two.
- `#camBar` declines three parts of the M3 Expressive linear progress indicator.
- `--pane` is 16px for `#dataBox` and `#camBox`, and 24px for `.docbox` above...
- The hover panel states its own background and its own shadow, and it carrie...
- A camera tile's state layer is a pseudo-element, and it never takes an inse...
- The phone name column and the table's own `min-width` are one number in two...

## Conventions

- **Anything that alerts is checked against the alert design standard** in
  [`docs/FEATURES.md`](docs/FEATURES.md#alert-design-standard). That standard holds three things.
  It holds CAP's separate severity / urgency / certainty axes. It holds ISA-18.2's "an alarm
  requires a response" and its 10-in-10-minutes flood threshold. And it holds the cry-wolf finding
  that false alarms cost more trust than they buy attention.
  Four gaps are open there. Raise them when alert work comes up rather than adding a fifth surface.
- **Two of the three JPS notice feeds now reach the map, and the third became a link.** The flood
  forecast and the weather-alert mirror at
  `publicinfobanjir.water.gov.my/ramalan/{amaran-banjir,met-alert}/` are rows in the warning surface,
  through `floodAlerts()` and `jpsMetWarnings()` in `sources.php`. The media statement at
  `.../ramalan/pernyataan-media/` became one outbound link in the About dialog, because a document
  list is not an alarm. See "The JPS notice feeds join the warning surface" in `docs/FEATURES.md` for
  what shipped and why. The alert design standard section there says how both cleared it.
  **`floodAlerts()` has never seen a row.** `getdisse.php` answered `[]` on every fetch made during
  design, so the parser ships checked against evidence, not against a real response. A parser that has
  never met one real row cannot tell a quiet feed from a moved layout. The first non-empty response
  from that endpoint is the moment to check it by hand.
- **Material Design 3 is the reference for every UI decision.** Where M3 names a component, take its
  behaviour from the spec instead of inventing one. A reader already knows the platform convention,
  and a hand-made control costs them that knowledge. **Transcribe the component rather than
  approximate it.** The M3 Expressive component set is the reference this app reads:
  https://github.com/bczak/m3you (MIT) — plain CSS files, each citing its own page on
  m3.material.io. Every number this app takes from M3 comes out of one of them, so it can be grepped
  against a real file rather than eyeballed.
  **The token SCALES are vendored and a component's CSS is transcribed, and the split is
  deliberate.** `php m3-build.php` bakes that repo's `src/styles/tokens/` into
  `vendor/m3/tokens.css`, so no shape, type, elevation, motion or state number is hand-copied again.
  Every value this app had restated by hand matched the source exactly, and the swap moved no pixel.
  A component's own CSS is still read and transcribed into `css/chrome.css` or `css/map.css` beside
  the reasoning. Each one lands on markup this app already has, and each one diverges somewhere it
  has to say why.
  **That repo's components are React, so nothing here can import them.** Its CSS is plain and its
  tokens are plain, and that is the half this app takes. There is no build step here at request
  time, and there must not be one.
  **Colour is the one scale this app does not vendor.** M3 ships a full tonal palette. The palette
  rule below reserves this app's hues for station status and holds one surface tone. So
  `css/base.css` bridges the `--md-sys-color-*` names a component asks for onto the tokens this app
  already has. Add a line to that bridge when a component wants a role it is missing. Never add M3's
  palette instead.
  **Seven components, ten variants, and each surface declares which it is.** Dialogs are
  full-screen or basic. Sheets are side or bottom. The supporting pane's two headers are the top app
  bar's medium flexible variant, at both widths. The layer panel's three choices are connected
  button groups. `m3-check.html` holds the dialog roll call and `paint-check.html` holds the button
  group's numbers.
  **`.menu` is M3's MENU, and one set of numbers serves every surface that draws one.** The
  reference is `Menu/menu.css`: a `surface-container` column at `shape-corner-large`, 4px of padding
  and a 2px gap, holding 48px items at `shape-corner-extra-small`, with the group's own first and
  last row taking `shape-corner-medium`. The item is a centred flex row, `body-medium`, inset 12px,
  with a 20px leading glyph in `on-surface-variant` and M3's own `on-surface` state layer. The
  divider is 1px of `outline-variant`, inset 8px, with no block margin.
  **Six surfaces draw one, so the rules live in `css/chrome.css` once.** They are the phone's
  overflow (`#appMenu`), the three map chip menus, a sensor's ⋮ and the weather card's ⋮. The
  repository owner asked for the component on the overflow menu on 2026-08-25, and a menu
  transcribed for one surface and approximated for the next is the fault the rule above exists to
  stop.
  **Four divergences and each says why where it is written.** The cap is 340px rather than M3's 280,
  because the nearest-webcam row carries a station name of 50 characters. The item takes
  `min-height` rather than the reference's fixed `height`, because M3 truncates a label with an
  ellipsis and a station name cut in half names another station. It takes block padding for the same
  reason, since a row free to grow to three lines needs the text held off its own ends. And the
  elevation is `--shadow`, which is the divergence every dialog here already states.
  **The 1px outline went with the change.** M3 separates a menu by elevation alone.
  **The `.mv` reading keeps `color()`'s paint** rather than the reference's `on-surface-variant`:
  1.74 m is a quiet river or a flood, and the mark it is measured against is not on that row.
  `paint-check.html`'s `m3menu()` holds the numbers. It runs on the three chip menus at a desktop
  width and on `#appMenu` at a phone width, which is the one width that can reach it.
  **Navigation is two components and the window class picks which draws.** `#rail` is the navigation
  rail, collapsed by default and expandable, on the leading edge above 600px. `#navbar` is the
  navigation bar along the bottom below 600px, because M3 states no rail at a compact width and
  80px of a 360px screen is 22% of it. Each id in the bar is its rail twin with one prefix changed,
  and `m3-check.html` asserts both.
  **A control that only LOOKS like an M3 component is the failure this section exists to stop.**
  `.seg` is the worked example. It is this app's own sunken track, and for a while three surfaces
  called it a segmented button. M3 Expressive has no segmented button. It has a connected button
  group, whose selected member changes shape rather than sliding a fill along a rail. Name a
  component only after reading its CSS in the reference set.
  **The window is M3's supporting-pane canonical layout**, and the numbers come from that page:
  https://m3.material.io/foundations/layout/canonical-examples/supporting-pane
  `#map` is the main pane and `#pane` is the supporting one. `#pane` holds one occupant at a time.
  Above 600px that is the station card alone. Below 600px the search joins it, because M3's
  full-screen search view is a destination there. **The filters panel was the third occupant and it
  is deleted**, on the repository owner's instruction of 2026-08-26.
  **Medium splits the window equally. Expanded gives 70% to the main pane and 30% to the supporting
  one**, and the two bands above expanded keep that ratio. `--pane` carries it, with two corrections
  the ratio alone does not survive. See the entry on its floor below.
  **The main pane is drawn as a card**, because M3 separates panes with space rather than with a
  line. `--gap` is the map's inset against the window and `--seam` is the space between the two
  panes, which is M3's own margin-and-spacer pair.
  **One motion changes what the pane holds, and it is not M3's fade through.** M3 names fade through
  for peer destinations that share a container, and these three are that. This app ran it for one
  revision. A reader met it beside the station swap inside `#side` and asked for one motion.
  `--m3-swap` is that motion, and both events read it.
  **No surface in this layout carries a dividing line.** Not the card, not the app bar, not the pane.
  **In a compact window the supporting pane is a full-screen destination.** That is what
  `SupportingPaneScaffold` does in the Compose adaptive library, and it is why `#pane` is a
  `<dialog>`: `showModal()` below 600px, `show()` above it.
  The load-bearing half is that M3 answers questions this app would otherwise invent answers to.
  A full-screen dialog covers the screen, carries 0dp corners and elevation 0, has no scrim, and
  puts a close X on the leading edge of a top app bar. So the swipe and the scrim went, the drawer
  gained a header, and the station panel's button changed edges.
  **That header is the full-screen dialog's own, and it is not a top app bar.** `Dialog/dialog.css`
  states 56px, `title-large`, `gap: 8px` and a 24px body. The supporting pane wears a top app bar
  instead, at 112px and `headline-medium`, because a top app bar heads a destination. The four
  dialogs wore the pane's for one revision and a reader asked for the exact styles. The edge tab
  that did the job before all this is gone too. This does **not** override the two rules below it. The colour
  language here is a status language. So M3's tonal palette never gets to paint a station kind.
  The writing standard still governs every word on screen. Where the spec and this file disagree,
  this file wins and the disagreement is written down.
- Responsive is a standing requirement (breakpoint 600px), including touch equivalents for every
  hover-only affordance.
- **A message on screen is written for the reader, not for the system.** Four rules, and the station
  panel was swept for them twice. **Sentence case.** That is a capital at the front of every rendered
  string. It includes the small `.muted` helper lines, which were all lowercase fragments. The first
  sweep missed five, all in `popup.js`: `water is … below the gauge marker` and `water is level with
  the gauge marker` in `gaugeBlock()`, and `silent for the last …` / `last sounded …` / `sounding
  since …` in `sirenBand()`. The second sweep caught every one of them as a side effect of
  *shortening* them, which is the usual way. A line nobody reworded is a line nobody
  re-read. Do not trust a past sweep over a grep. **No hedging.**
  The writing standard bans "probably". A hedge is dishonest anyway where the app already acted on
  the judgement it hedges about. **None of our vocabulary**: `proxy`, `cold start`,
  `as we poll`, `stuck relay`, `warning mark`, `the alert list` and `5 km` are how *we* describe the
  plumbing, and a reader wants the verdict and one fact behind it. The siren line is the model —
  `Faulty signal. No river nearby is high.` replaced a 28-word sentence that never answered whether
  there was a flood. **The precision the fact needs, and no more.** A live station's stamp needs its
  clock and not today's date. A sensor eleven months dead needs its date and neither a minute hand
  nor `· 7892.0h ago`. A graph window measured over 9.6 hours is `9 h`. A decimal claims
  six-minute precision on a span nobody measures that finely. It rounds **down**. A span
  is read as ground covered, and a long one claims minutes that were never in the record. A number
  already drawn on the scale 20px below is not repeated in the line above it. A distance needs no
  `away` after it, an accuracy radius no `about` before it, and `mm/h` says what `mm in an hour`
  spells. Sweeping the station panel on this one rule cut or trimmed 18 strings. It also deleted
  `basin n/a` from 287 of 679 cards. That line stated a gap in the feed rather than a fact about the
  place. It sat beside `district n/a`, which no station can ever reach. The ALL-CAPS blocks (`TRIGGERED`,
  `HEAVY RAIN`, `HAPPENING NOW`) are a deliberate visual language and are **not** messages — leave
  them.
- All user settings live in one `prefs` blob in `localStorage` (`PREFS` + `save()`).
- **The layer controls are a bare CHIP ROW over the map, and there is no panel left at all.**
  `#mapchips` sits on the map's leading edge, under the ticker, on the legend's own 12px line. A
  reader asked for that on 2026-08-25, and deleted the filters panel that stood beside it on
  2026-08-26. **Every map control this app has is a chip on this row.**
  **Four chips, in two M3 kinds.** A chip that opens a menu states its VALUE as its label and carries
  a trailing `expand_more`. A chip that is on or off states a NAME and answers with a leading
  checkmark. `Chip/chip.css` is the reference, and `.chip` in `css/base.css` is the component.
  `layerChip` picks Stations or Weather. `heatChip` picks Off, Water level or Rainfall. `kindChip`
  holds the five sensor kinds. `alertChip` and `favChip` are filter chips.
  **The sensor kinds moved off the drawer on 2026-08-25 and they are a MENU chip, not five chips.**
  Five more chips on that row is nine chips over a map. They are the one MULTI-select group here, so
  their rows are checkboxes and `PREFS.layers` stays a map of booleans. Every other group in the row
  is one string holding one answer. **The chip states how much of the set is off** — `Sensors` alone
  means every kind draws — which is what the drawer section's own `<summary>` count used to say.
  **A kind is not a filter over stations.** It is which of a station's sensors this map draws at all.
  That is why it stayed in the drawer while Favorites and On alert left, and why it sits under the
  station layer here rather than beside the two filters. The drawer itself is gone since 2026-08-26,
  so this chip is the only home it has.
  **`checked` in the markup is safe on these and on nothing else.** `js/ui.js` generates the rows
  from `PREFS.layers` on every load, so a browser has no form state left to restore. A radio written
  once in `index.html` is the case that rule forbids.
  **The heatmap, the kinds and the two filters answer about the STATION layer, so they leave with
  it.** Weather takes the map and there is nothing for any of them to act on. A `:has()` rule in `css/chrome.css`
  does it, so no script can get it wrong and nothing is written on the poll.
  **There is no `All` chip on the filter, because a filter chip clears itself.** M3 states that
  pressing a selected filter chip turns it off, so "every pin" is the state with neither on. They are
  still radios and still one string, so both-on stays unrepresentable.
  **The clear handler must NOT call `preventDefault()`.** A browser sets a radio's checkedness as
  pre-click activation and restores the PRE-click value on a cancelled click. That value is checked,
  so cancelling put the chip straight back on and undid the line under it. The test also reads
  `PREFS.pinFilter`, never `e.target.checked`: activation runs before dispatch, so the box reads
  `true` on a first press as well as a second.
  **There is no panel behind these chips.** Every control this app has is a chip on this row or a
  row in Settings.
  **`#paintmenu`, `#paint` and `#navLayers` are all gone.** The chips ARE the control, so a panel, a
  round button that opened it, and a navigation bar item pointing at the same panel are three things
  with no job. The bar carries four items now. `#locate` took the slot beside the zoom box.
  **`--top-chips` is the row's height plus its gap**, and `#toast`, `#pills` and the docked search
  all start under it. A row that scrolled sideways would hide chips with nothing on screen to say
  they exist.
  **It is MEASURED by a `ResizeObserver` on the row, and two literals held it before.** One row on a
  desktop and two on a phone. How many lines the row takes depends on the LIVE payload: `On alert ·
  63` is three digits wider than `On alert · 1`, and at 360px that alone pushes the chips onto a
  third line. The strip below then sat on the chips. The literals stay in the stylesheets as the
  value before `js/ui.js` runs, so a failed import does not dock every box at 0.
  **`paint-check.html` asserted `exactly two rows` and went red on upstream churn.** That is the
  equality-against-live-data trap this file already records for the source counters. It asserts that
  the row wrapped, and the overlap assertions under it prove the strip clears whatever it wrapped to.
  **Never `parseFloat` this token.** It computes to `calc(var(--top-free) + Npx)`, its own token
  stream rather than a pixel, which is the trap `--navbar-h` already carries.
  **The row takes no pointer events and its chips take them back.** It spans the map so its chips can
  wrap across it, and a row that took clicks would swallow every press along the top of the map. That
  is the pair `#mapfoot` already states at the other end.
  **Every chip up here carries `--surface` and `--shadow`.** `.chip` alone is transparent, which is
  right inside a panel and invisible on a map.
  **Chromium does not restyle a `:has(input:checked)` subject when a SCRIPT changes that
  checkedness.** `matches()` answers true and `getComputedStyle` hands back the unchecked value.
  Measured on this build. Every box in this app is written by script, because `PREFS` is the source
  of truth and no control carries a `checked` attribute. So a page landing with a filter on drew the
  chip looking off. **`setBox()` in `js/util.js` is the repair**: it sets the box and mirrors the
  answer onto `.chip.on`, from the same preference. Every `:has(input:checked)` rule on a chip names
  `.chip.on` beside it. The `:has()` half stays, because it answers a real pointer press with no
  script involved. Anything new that writes one of these boxes goes through `setBox()`.
  **The rule for what goes where: a control the reader reaches for WHILE LOOKING AT THE MAP is a chip
  on the map. Everything else is a row in Settings**, beside the two saved lists. The drawer was the
  third home and it is deleted, so a new control has two places to land rather than three.
  **Every mutually-exclusive group is ONE choice held in ONE string**: `PREFS.mapLayer`,
  `PREFS.heatLayer` and `PREFS.pinFilter`. Never a pair of booleans: that shape holds both-on, and
  this repo already paid for it once — see `syncHeat()`.
  **The menu chip's label is written from the preference, never read back.** `render()` writes
  `#layerChipLabel` and `#layerChipIcon`. `syncHeat()` writes `#heatChipLabel`.
  **Five shapes came before this one and every one failed on the same axis.** A glyph plate in the
  map's corner read as a map pin. An accent FAB with a label shouted. Then a panel behind a `layers`
  button, then a bottom sheet on a phone, then connected button groups inside that panel, then size-lg
  square outlined buttons. Each one put a settings dialog between a reader and a setting.
- **`#risebadge` reads `ON ALERT` and the chip that raises it filters on `isHot()`, WHICH REVERSES
  THIS ENTRY.** It filtered on `s.rising` alone from 2026-08-18. That flag is a forecast about one
  river, and `isHot()` is what the app bar counts, the icon badge shows and the alert panel lists. So
  a sounding siren, a river already at its danger mark and heavy rain each lit the map and left the
  chip DEAD, because `syncPins()` disables a filter with no members. A reader met that on 2026-08-26
  and the repository owner widened it.
  **A disabled chip beside red pins reads as a fault in the app**, and the pill's sentence could not
  answer it. That sentence is on the map only while the filter is ON. The chip is dead in the exact
  case a reader asks the question.
  **So the chip and the app bar are ONE number now.** `syncPins()` counts `!isIgnored(s) && isHot(s)`,
  which is the alert panel's own expression. The ignore test is what makes the two agree.
  **The cost is real and is accepted.** There is no way left to ask for climbing rivers alone. A
  reader who wants that reads the alert panel, where `soon` is a tier of its own with a chip counting
  it. **Do not narrow it back without asking.** Both directions are a decision, not a bug.
- **`PREFS.ignored` is the only suppression of any kind.** `isIgnored()` gates pins, heat, the alert
  panel, the ticker **and** the toast. Ignoring one named sensor is a request about that sensor, so
  it holds on every surface.
  **NO INDICATION OF IT IS ALWAYS VISIBLE, AND THAT BREAKS A RULE THIS FILE USED TO STATE.** A muted
  alarm needs two: the "Ignored sensors" list, and a standing count. The list moved to Settings on
  2026-08-25 and the count went with the filters panel on 2026-08-26, both on the repository owner's
  instruction. `#ignoredN` on that Settings heading is the whole of what is left, behind a press.
  The all-clear line still names an ignored sensor that is itself on alert. That is the one surface
  a reader meets without asking. **Anything that restores a standing indication takes it through the
  alert design standard first**, and needs a home that is not the filters panel.
- **A place with several sensors is a Monitoring Station. A place with one sensor is a Monitoring
  Node, or the name of its kind.** The kinds are Water level, Rainfall, Siren, Flood gauge, Camera. The word
  *mast* is gone from every rendered string. The hardware is usually a small gated shed, so the
  word described a pole that is not there. The kind names come from `KINDS[...].label` and
  `.one` in `config.js`. So a card, a chip and the glossary cannot spell one kind three ways.
  `flood-depth gauge` was the drift this rule caught, on six lines of Help against a badge reading
  `Flood gauge`. **The code still spells the concept `mast`**: `MAST` in `config.js`, `--k-mast`,
  `showMast()` / `hideMast()` / `.mastring` in `map.js`, `data-mast` in `table.js`. Renaming those
  moves no pixel and touches ten files, so they keep the old spelling on purpose. Read `mast` in
  code as *Monitoring Station*, and never print it.
- **All times are 24-hour, and Malaysian.** JPS stamps readings MYT with no offset and we print them
  verbatim. So anything computed from a unix timestamp must be formatted with
  `timeZone: 'Asia/Kuala_Lumpur'` — see `MYT_HOUR` in `popup.js`. Otherwise it disagrees with the
  strings next to it, for any viewer outside MYT. No `hour12` anywhere.
- **leaflet.heat composites overlapping blobs, and both our layers plot an intensity, not a density.**
  Two gauges both reading 4 mm/h still means 4 mm/h, not 8. But the canvas accumulates alpha. So N
  stations reporting the same thing paint something stronger than any of them reported. Measured:
  233 rain gauges, a median of 4 inside one 5 km blob and up to 14. That stacked light rain (0.26)
  to 0.97. That is solid red over a state where nothing worse than light rain was reported. `thinHeat()` in
  `heat.js` fixes it. It keeps the strongest reading and drops anything its own blob already
  covers. That *is* "the highest reading within a blob radius", the thing the colour claims to
  mean. **Any new heat layer must go through it.** The water layer does too, even though it has
  one point on a calm day. The flaw only appears when many stations alert at once. That is the one
  moment the map has to be right. **It takes the distance as a parameter, and a caller must pass the
  one its own layer paints at.** A thinning distance shorter than the paint leaves the stacking
  alive in the ring between the two. See the `radius + blur` gotcha above, which is how that
  happened.
- **75% is the heat wash's DEFAULT, and the slider that sets it lives in Settings.** That control
  rode under both ramps on the legend, and a reader cut it there on 2026-08-24. The same reader asked
  for it back on 2026-08-25, in Settings. **The home is the whole of what changed.** The legend is a
  scale a reader reads on every glance, and the opacity is a setting they pick once. So a slider
  under the ramp charged every glance for one decision. 75% is still the figure the control exists to
  reach. A pin, a river and a road all read through the wash, and the wash still states its own
  class. `HEAT_OPACITY` in `js/heat.js` holds the default and `PREFS.heatOpacity` holds the pick.
  **The floor is 20% and there is no zero.** A wash at zero is a layer switched off with its chip
  still stating a value, which is the chip contradicting the map. The heat chip's own `Off` is how a
  reader turns it off.
  **`_fade` is a separate term and it stays.** That one is the layer telling a reader its blob has
  stopped covering the ground it names, and it multiplies this number rather than replaces it.
  **The slider is a native `<input type="range">` and not a transcribed M3 slider.** `accent-color`
  paints the filled track and the handle in this app's primary, which is the anatomy M3's own slider
  states. Go to M3's own the day this needs a value label on the handle or a stepped track.
  **It carries `autocomplete="off"` and `js/ui.js` writes it from the preference**, which is the rule
  every preference-owned control here obeys. A browser restores form state across a reload and fires
  no `change`.
- **A heat layer's weight is its alpha.** leaflet.heat draws each point at its weight. So a scale
  that starts at 0 draws real readings as nothing. The water layer never hit this, because its floor
  is the alert slot (0.38). The rain layer's first class therefore *starts at 0.25* (`RAIN_STOPS`)
  rather than counting up from zero. Light rain is most of the rain most of the time. On the day it
  was built, 10 of 233 gauges reported and none was above 4 mm/h. A scale from zero ships an
  empty-looking layer. Any new heat layer needs a floor chosen the same way.
- **A control owned by a preference must not also state that state in the markup.** `#heat` carried
  a `checked` attribute while `PREFS.heatLayer` was the source of truth. `js/ui.js` writes both heat
  boxes from that pref, but it is a **deferred module**. So between parse and run the DOM held both
  boxes on. That is the one state the pair is not allowed to be in, since the two heatmaps are one
  choice.
  A browser restoring form state across a reload stacks on top of that. Neither box carries `checked`
  now. **And an invariant repaired on one path through a shared handler is repaired on none of the
  others.** The exclusivity guard read `e.target === el('heat') && …`. So it only fixed the pair
  when one of those two boxes was what changed. A pair that arrived already both-on survived every toggle
  of the two pin filters that share that handler. Meanwhile `PREFS.heatLayer` saved `water`, and the
  panel went on showing both. The test moved to the pair, whoever fired the event.
  **Both of those repairs failed, because a handler is not the only writer of a checkbox.** The bug
  came back showing two answers at once. Both ramps drew on the legend, both chips lit, and the
  section summary still named one. `syncHeat()` re-read the boxes on every poll, and the summary was written
  from the change handler alone. So the two surfaces aged apart. Nothing in this app checked that
  box. **A browser restores form state across a reload and fires no `change`.** So a repair that
  lives in a change handler never runs on that path. **Repair an invariant where the state is read,
  not where the reader changes it.** `syncHeat()` in `js/heat.js` now reads `PREFS.heatLayer`. It
  writes the two boxes, the legend, the layers and the summary from it. `syncRisingChip()`
  and `syncFavChip()` in `js/render.js` already re-assert their own chips every poll the same way. The handler
  writes the pref from the box that fired and reads neither box back, so both-on is unrepresentable.
  The four preference-owned checkboxes also carry `autocomplete="off"`, which stops the browser
  writing them at all. The three text inputs already had it. **Any new control whose state a
  preference owns needs both halves.** Those are the attribute, and a reader that writes the control
  from the preference rather than the reverse.
  **The theme control was the same rule at a second site, and it is not a control of that kind any
  more.** It was three radios in a segmented pill inside `#appMenu`. Two themes and one press
  replaced it on 2026-08-24, so there is no box for a browser to restore and nothing to write back.
  `syncThemeBtn()` in `js/ui.js` still writes the glyph from the resolved theme rather than the
  reverse, which is the half of this rule a button keeps.
  **`label` is a styled element in `css/base.css`, and it carries a margin.** `label { display: flex;
  align-items: center; gap: 8px; margin: 6px 0 }` is written for the drawer's stacked filter rows.
  It lands on every `<label>` in the app. Measured on the old theme picker, that margin made the
  track 37px tall around 21px pills. That is 6px of dead air above and below each one. The whole
  point of that shape is that the fill hugs the segment.
  **Any `<label>` used as a compact control needs `margin: 0` stated.** The symptom is spacing
  around the control rather than in it, which reads as a padding mistake on the parent. Three other
  explanations were measured first and all three were wrong. They were the row's own padding
  (symmetric at 8px), `align-items` on the row (already `center`), and the flex item stretching.
  `align-self: auto` on a centred row cannot stretch.
  **It bit a second time on 2026-08-25, in the three chip MENUS, and a reader is what found it.**
  Those rows are `<label class="mi">`, so each one carried 6px above and below. The rows stood 10px
  off the panel's top and bottom against 4px on the sides, and 14px apart against the 2px `.menu`
  states. `#appMenu` was right the whole time, because its rows are `<button>` and `<a>`. **The
  declarations all passed while the menu was wrong**: `padding` read 4px and `row-gap` read 2px on
  the box asked, and the margin lives on the child. `.mi` states `margin: 0` now, on the item rather
  than on `.chipmenu .mi`, so the next menu row written as a label needs no second cancel.
  **The kinds menu carried the same fault upside down.** Its rows sit in a `<div id="layers">`
  wrapper, so `.menu`'s gap never reached them and they stacked flush at 0px. That box is
  `display: contents` now, which hands `.menu` its own children rather than restating the gap in a
  second file. **So `paint-check.html`'s `m3menu()` measures the four gaps** and no longer trusts the
  declarations alone. The map's own layer chips are the live users
  of this rule now.
- **THE THEME HAS THREE CHOICES AGAIN, AND THE PICKER IS IN SETTINGS.** `PREFS.theme` holds `auto`,
  `light` or `dark`, and `THEMES` in `map.js` is that list. `applyTheme()` stamps the RESOLVED shade
  on `<html>`, and `setTheme()` stores the pick and calls it. Anything that wants to know the theme
  on screen reads `document.documentElement.dataset.theme`, as before. The repository owner cut Auto
  on 2026-08-24 and asked for it back on 2026-08-25.
  **`auto` is the default and nothing is seeded any more.** The version this reverses seeded
  `PREFS.theme` once from `matchMedia('(prefers-color-scheme: dark)')`, because no value meant "ask
  the device". One does now, so a first visit stores `auto` and a stored `light` or `dark` is a
  choice somebody made.
  **Auto keeps following the device**, through a listener on that same query in `map.js`. A phone
  crossing into its own dark hours restyles this app while `auto` holds. That is the whole of what
  the third choice buys, and the seed it replaces only ever started in the right place.
  **THE RAIL BUTTON NAMES THE SHADE ON SCREEN, AND THAT REVERSES THIS ENTRY.** It named the next
  press, on the argument that a reader can already see the shade they are looking at. Under Auto the
  pick is a WORD, and which shade that word resolved to is the one thing a reader cannot read off the
  page. So the glyph is the state and the words carry the act: `Automatic. Dark now. Switch to
  light.` against `Dark theme. Switch to light.`
  **One press sets an explicit shade, which LEAVES Auto.** A button cannot cycle three values without
  becoming a control that has to be pressed twice to be read. Settings is where Auto comes back.
  **The rail is that button's only home.** It travelled into the app bar's trailing group below
  600px, because the rail is `display: none` there and a phone otherwise carried no theme control.
  The picker answers that now, so `place()` in `js/ui.js` moves `#brand` and `#findpane` and nothing
  else.
  **`syncThemeBtn()` in `js/ui.js` is the one writer, and it writes BOTH surfaces.** It draws the
  button and checks the matching row, from `PREFS.theme` and never from a control. So the rows and
  the button cannot report two answers, whichever of the two a reader pressed. That is the rule this
  file already states for every preference-owned control.
  **Two listeners on one media query, and each owns its own concern.** `map.js` re-paints the app,
  so a page drawing a map without the chrome still follows the device. `ui.js` re-draws the button
  that reports the shade. Registration order runs the paint first, because that module imports this
  one.
  The `themePick` migration is still gone. It guarded a pre-Auto blob, and every value that blob can
  hold is one of the three this reads.
- **The overflow menu is `#appMenu` again, and it is a different thing under one id.** It held four
  destination tiles and a theme row, in a two-column grid, and it closed itself on any click inside
  it through a capture-phase handler in `js/ui.js`. Every one of those is gone. It holds three rows,
  Settings, Help and About, and it draws below 600px alone, because a navigation bar caps at five
  items and the rail above 600px carries all three as items of its own.
  **`#navMore` in the APP BAR's trailing group is what opens it.** That button has been round this
  loop twice on 2026-08-25: it began in the app bar, moved to the navigation bar's fifth slot, and a
  reader moved it back the same day so the location button could take the middle slot. It keeps the
  `nav` prefix in both homes, and it is not a `.navitem` any more.
  **So `.swrow` and the capture-phase close are deleted.** That handler existed so a menu item's
  `showModal()` never ran while its opener was still in the top layer, and it needed an exemption
  for the one row that was a setting rather than a destination. Every row is a destination now.
  Nothing closes the menu either: `showModal()` closes every open popover itself, which is what the
  HTML spec states.
  **The three rows share one handler with their rail twins.** `openSettings`, `openHelp` and
  `openAbout` in `js/ui.js` are bound to `railSettings`/`menuSettings`, `railHelp`/`menuHelp` and
  `railAbout`/`menuAbout` in one loop. Only one of each pair is ever on screen, and two copies of a
  handler is two things to change.
- **Settings holds the two saved lists and the developer controls, and both arrived on 2026-08-25 on
  the repository owner's instruction.** `#settingsBox` is a `.docbox`, so it is a full-screen dialog
  below 600px and a basic one above, the same as About and Help.
  **A Theme section arrived on 2026-08-25 and holds three rows.** They are Auto, Light and Dark, and
  the repository owner asked for the picker here and for Auto back with it. The rail's button is a
  switch between two shades and cannot state a third choice, so the choice lives where a setting
  lives. See the theme entry further down for what each control says.
  **Radio rows and never a switch.** Three choices is not a state a switch can hold, which is the
  same rule that keeps the two heat layers in one string rather than in two booleans.
  **The check is the TRAILING slot and it holds its box while it is hidden.** A check that took the
  row's own space only while it drew would shift the words on every press. That is the shape every
  chip menu on the map already uses, and `.mcheck` is the same class.
  **The row is a `<label class="mrow">`, so it has to cancel `label`'s own margin.** `css/base.css`
  styles that element with `margin: 6px 0`, written for the drawer's stacked filter rows, and it
  lands on every label in the app. The cancel goes on `.mrow` rather than on the theme list, so the
  next Settings row written as a label needs no second one. That trap has now bitten the theme
  picker, the chip menus and this pane.
  **The leading glyph takes the accent with the check and the WEIGHT does not move.** M3's selected
  list item states no weight change, and a bold row here bolds its supporting line too.
  **`--i-theme_auto` is hand-drawn, the way `--i-compare` is, and it is named for the job.** Material
  Symbols publishes `brightness_auto`, a sun with an A cut out of it, and at 24px beside `light_mode`
  that letter reads as two sun shapes side by side. This is the half-filled circle every platform
  draws for "follow the device". The ring is two arcs of opposite sweep, so nonzero winding leaves
  the middle hollow, and the half takes the outer circle's own sweep so it fills one side back in.
  **A third section, Map, arrived on 2026-08-25 and holds one row.** That row is the heat wash's
  opacity. It is neither a filter nor a developer control: it changes how the map draws, which is
  what the heading names. See the wash entry in the gotcha list above.
  **A saved list is not a filter.** The favorites and the ignored sensors were `<details>` sections
  in the filters drawer. Each is a list a reader reviews and edits, which is what this pane is for.
  The district picker stayed, because it IS a filter.
  **They are open sections here, never `<details>`.** They were collapsed in the drawer, because two
  scrolling lists stacked over the layer switches pushed those off a phone screen. Nothing sits under
  these two but Developer. A reader who opened Settings to review a list must not press again to see
  it.
  **Every group here is an M3 LIST, SEGMENTED appearance, and the numbers are `List/list.css`'s
  own.** The item is 72px at two lines, the layout is a flex row with a 16px gap, the leading slot is
  a 24px glyph in a 48px box, the headline is `body-large` and the supporting line is `body-medium`.
  A row is a filled container on `surface-container`, the rows keep a 4dp corner and the group's own
  first and last row take the 16dp one. The rules sit in `css/chrome.css` beside `#settingsBox`, and
  `css/base.css` keeps a pointer to them.
  **The standard appearance stood here for one revision and the repository owner reversed it on
  2026-08-25.** Segmented is what M3 gives a settings group.
  **The gap is 8px and the reference states 2px.** These groups each hold a different kind of row,
  and 2px between a two-line station and the next reads as one long block with hairlines cut into it.
  **The trailing action is an M3 ICON BUTTON**, 48dp on both axes, and it was a text pill reading
  `remove`. `heart_minus` removes a favorite and `visibility` restores an ignored sensor, which pairs
  with the `visibility_off` on that section's own heading. Its words ride `data-tip` and never
  `title`, the rule this file already states for anything a phone has to read.
  **Test mode is an M3 SWITCH**, from `Switch/switch.css`: a 68x48 target, a 52x32 track with a 2px
  outline, a 16dp handle off and 24dp on. `:has(:checked)` reads the input, because the reference is
  React and writes `data-checked` and this app has no build step. `.testtog`, the amber pill, is
  gone.
  **`#testbadge` is gone too, and `#testChip` on the map chip row replaced it.** The badge was a fat
  amber pill in `#pills` carrying a label, a sentence and a Turn off button. The repository owner
  asked for a chip on 2026-08-25. `body.testmode` draws it, so no script writes it and `js/test.js`
  injects no markup at all any more. That let `js/ui.js` bind the way out directly rather than
  delegate from `#pills`. It keeps the amber, `#e8710a` in both themes, because every other chip on
  that row reports a choice the reader made and this one reports that the map is lying. Its trailing
  × turns the mode off, which is M3's input chip.
  **It is the only thing that says so above 600px.** `<header>` does not draw there, so the striped
  bar is a compact-width signal alone. That is a narrower guard than the pill it replaced, and it is
  the accepted cost of the instruction. Anything that weakens it further goes through the alert
  design standard first.
  **The developer order is the repository owner's own**: the switch, the readings, Refresh now, Raw
  payload, Reset settings. The readings are a row of the same group that takes no press — a table
  rather than a headline, no button, no anchor, no pointer. The three actions are M3's list ACTION
  mode, a button that fills the item.
  **The Pages build hides the ROW, never the button.** A hidden button leaves an empty container in
  the middle of a segmented group, which draws as a gap rather than as nothing.
  **`#devMsg` is gone and an M3 SNACKBAR replaced it**, from `Snackbar/snackbar.css`: min(344px,
  window - 32), a 4dp corner, `inverse-surface`, 48px on one line. `#devMsg` was a muted line under
  the buttons inside a pane that scrolls, so the answer to a press sat below the fold while the
  reader watched the button. **It is a `popover`, and that is the only way it can be seen**: it
  reports on a control inside a modal dialog, and no `z-index` reaches over the top layer. `manual`,
  and `snack()` in `js/ui.js` owns its one timer, cleared on every call.
  **`togglePopover()`, never `showPopover()`/`hidePopover()`.** Both of those THROW rather than do
  nothing when the popover already holds the state they ask for. `snack()` called `hidePopover()`
  first, to restart the enter animation, and every call threw on that line. So the snackbar never
  drew once, and nothing said so: the throw landed inside a handler with no surface.
  **Closing the pane does NOT take the snackbar down, and the first version did.** That rule came
  across from `#devMsg`, which was a line INSIDE the pane. A snackbar has its own four-second clock,
  and M3 ties its life to that clock rather than to the surface that raised it. It also made one
  thing impossible: switching test mode on closes this pane and then says so.
  **Switching test mode ON closes this pane after `TEST_CLOSE_MS` (500 ms), then snacks.** The
  repository owner asked for that on 2026-08-25. The point of the mode is the map, and this pane is
  the one thing that cannot show a fake flood. **The snackbar follows the close, never precedes it**:
  a `<dialog>` fires `close` asynchronously, so a message shown first sits on screen while the pane
  is still open. `settingsBox.close()` is a no-op when the mode was switched off from the map chip,
  so one path serves both.
  **The reset confirmation is an M3 basic dialog, `#confirmBox`, and it was a native `confirm()`.**
  `Dialog/dialog.css`: min(560px, window - 48), a 28dp corner, 24px of padding, `headline-small` over
  `body-medium`, a footer on the trailing edge with an 8px gap, Cancel first. **It carries no close
  X**, so the roll call's basic branch runs its header assertions only where there is a header. A
  confirmation answers with its two buttons. It opens over `#settingsBox`, which below 600px is the
  full-screen variant M3 states as the one that admits another dialog over it.
  **ALL THREE destructive presses in Settings go through it, and `ask()` in `js/ui.js` is the one
  door.** They are Reset settings, Remove all favorites and Stop ignoring all. A reader asked for the
  two list controls to confirm on 2026-08-25. Each of the three destroys a list somebody built one
  sensor at a time, and only doing that work again undoes it.
  **Clearing a whole list confirms. Removing one row does not.** A row names its own sensor and its
  control sits beside it, so a mis-tap costs one star and the row says which. The button at the foot
  empties the list and nothing on screen names what it took.
  **The confirming button names the ACT, never `OK`.** M3 states it, and it is the last word a reader
  who mis-tapped has left to read. `ask()` writes the headline, the line under it and that verb on
  every open.
  **The armed action is taken in hand BEFORE the close, never read back after it.** A dialog fires
  `close` asynchronously — the trap this file already records for the pane — so a handler that
  disarms runs after the confirming handler returns. Clearing it in hand also makes one press do one
  thing. `onclose` covers the two answers that never reach the button, Escape and the backdrop.
  **A shared dialog invents one fault, and `m3-check.html` guards it.** A second caller can open it
  still carrying the first caller's headline, and a reader then confirms the wrong act. So the check
  presses all three and asserts each one rewrites the words, against each other rather than against a
  literal. It always answers Cancel: confirming would empty a real saved list on the machine it runs
  on.
  **The markup already carried the three slots, so `js/render.js` emits the rows it always did.**
  `.picklist li` is the item, `.glyph` is the leading slot, `.nm` is the content and `.mtrail` is
  the trailing one. The rows are static and the button is the action, so no pointer cursor and no hover
  tint.
  **Two things left and one number diverges.** The bordered box went, because a standard list has no
  container. `max-height: 26vh` went with it, because it put a second scroller inside a pane that
  already scrolls. And the 16dp inline padding is gone rather than halved: the pane pads 24px
  already, and a list padded inside that stands its rows 16px in from the Developer prose under
  them. One pane states one inset, and `m3-check.html` asserts all three blocks on one line.
  **Every heading in this pane is M3's list SUBHEADER**, `title-small` in `on-surface-variant` at
  48dp, Developer included. One pane states one heading style. `List/list.css` carries no subheader,
  so those numbers come from the spec page rather than from a file this repo can grep. That is the
  one number in the block that is not greppable.
  **A heading carries no glyph and no disc.** Both stood here for one revision. The repository owner
  asked for the disc on 2026-08-25 and cut the disc and the glyph together the same day. That lands
  on M3's own list subheader, which states a label and nothing else. `m3-check.html` asserts the
  absence of each: a half-finished revert draws a disc on one heading and nothing on the next, and
  neither errors.
  **The one thing worth keeping from that attempt.** An `.i` is a box of `currentColor` with the
  glyph masked out of it, so that mask clips away a background on the `.i` itself and nothing paints.
  A disc has to be a WRAPPER with the mask on the `.i` inside it. That is the trap the favorite heart
  already carries.
  **The trailing pill did not grow to 48px.** M3 puts that on the trailing SLOT, there is no slot
  element here, and a 48px pill is a button the height of the row. The pill keeps its 19px and its
  `::after` grows the hit area to 49.
  **The supporting line needed three classes to beat `.muted`.** That class carries a `font-size` of
  its own, and a declaration on the element wins against an inherited value. It is the trap this file
  already records against the rain chart's window labels.
  **Every id came across unchanged, so `js/render.js` and the two list handlers needed no edit.**
  `favPanel()` and `ignoredPanel()` write by id. `paint-check.html` asserts the new PARENT of each
  id rather than the absence of the old one. A missing `#favList` is a throw halfway through
  `render()`, which stops the markers and the alert panel with it.
  **The developer controls came out of About, which is the other direction.** About states what this
  site is and where the data comes from. These controls change what the app does. So `paintDev()`,
  the `poll` listener that repaints it, the `onclose` that clears `#devMsg` and the two in-flight
  guards all read `settingsBox` now. `#aboutBox .testtog` moved with the block it sizes, or the pill
  draws as a full-width amber bar the day somebody switches test mode on.
- **A river's sparkline draws every mark it publishes, and the axis grows to hold them.** This
  reverses the earlier rule. That rule drew a mark only within one *data span* of the readings. The
  readings then kept half the graph's height. It left 89 of 105 rivers with no mark at all on a
  quiet day. "How far is this from trouble" is the question a river graph is opened with. The
  accepted cost is that a calm river draws as a near-flat line at the foot of the graph. That is a
  true picture, with the trend figure beside it stating the movement in m/h. **A flood gauge keeps
  the proximity rule**. Its marks are 0.15 m and 0.3 m of depth over a spot, never far from the
  readings. Its axis crosses zero where a river's does not. With no readings to be near, that filter has
  nothing to measure and every mark is drawn.
  **The caption under the graph states the readings, never the axis.** It read `lo` and `hi`, which
  are the axis. This very rule grows the axis to hold every mark. So T.T.D.I JAYA captioned
  itself `3.42–8.30 m` over readings of 3.42 to 5.32. It named its danger mark as water that had
  arrived. **102 of 104 river graphs stated a range no reading reached.** It reads `lo0` and `hi0`
  now. This is the same rule the rain peak already carried. The change that let the axis grow broke
  it at a second site — see the peak-mark gotcha. Anything stating a graph's range reads the data.
  Two readings or it is not a range, so a graph holding one or none carries no caption.
  **The SPAN left that caption and became the graph's heading.** It read `3.42–5.32 m over 9 h`.
  Every block of a sensor's body is one segment of a segmented list now, and every segment carries a
  title. This graph's title is the ground it covers, which is the heading `rainBars()` already drew.
  Left in both places the card printed `Last 9 h` over `over 9 h`, 40px apart. The caption states the
  range alone.
- **A graph always draws, and no state of the station suppresses it.** `sparkline()`, `rainBars()`
  and `sirenBand()` each frame on the readings they hold. A window needs two readings to have a
  width. So with fewer than two the clock supplies one, through the `frame` parameter on
  `timeAxis()`. With two or more nothing changed. A graph holding nothing is not an empty box. It
  draws the plate, the axis and the station's own marks, which is the scale with nothing on it.
  **The flood gauge is why.** All 36 of its stations were broken. 15 drew nothing behind a
  `history?.length` gate in `sensorBody()` and another in `table.js`. 18 hold a single sample. Even
  the 3 holding more have a data span of 0.0 h. JPS stamps a batch of them to one time.
  Three rivers and eighteen rainfall stations sat in the same state, and the siren was the whole 212.
  **A lone reading draws as a dash and never a dot.** The viewBox stretches everything inside it. So a `<circle>`
  comes out an ellipse, the same reason the rain peak mark sits in HTML over the plot. A `<rect>`
  stretches too, and it is a dash either way.
  **The two sentences are gone**: `Graph builds as readings arrive` and `No readings in the last 12
  hours`. The second was already unreachable, because the server windows `SPARK_WIN` against now and
  no delivered sample is older than it. **`rainAcc()` keeps its `!isStale(s)` gate and is not covered
  by this rule.** It draws five current totals rather than a history. One gauge in the payload
  holds 27 mm in an hour, stamped last October.
- **Rainfall is an interval quantity, not a level.** It gets `rainBars()`, never `sparkline()` — a
  line between two rain readings claims a value in between that never existed. And `hourlyRainfall`
  is a *rolling* hour, so it buckets by `RAIN_BUCKET` (1 h): finer buckets show the same rain twice.
- `history` is `[[unix seconds, value], …]` on rivers (metres), rainfall (mm/h) and gauges (metres of
  depth, negative = dry). Rivers, rainfall and gauges carry a **third element, the status that
  sample was at**. `sparkPoints()` scores it through `wlStatus()` / `rainStatus()` / `gaugeStatus()`.
  The hover readout prints a normal sample in its own ink, and colours only a sample past a published
  mark. The warning glyph goes on every sample that takes a colour. See `TONE` in `popup.js`. A
  flood gauge starts one rung later than the others, at its 0.15 m mark, because the rung under that
  mark wears the gauge's own taupe and a taupe number in a readout says nothing. A siren carries no
  third element and needs none.
  Its samples are 0 and 1, which *is* the status, so `TONE.siren` reads the value. **Never score a
  historical value client-side.** Add a scorer in `api.php` instead. Every reader destructures `[ts, value]`, so
  a kind without one is not a special case anywhere. The graphs
  plot against the clock, not against sample index. Windowed to `SPARK_WIN` (12h) and thinned to one point per `SPARK_BUCKET` (15 min)
  server-side. `SPARK_H` in `config.js` is a **cap**, not a fixed frame. The axis spans the points
  actually held, and only starts sliding once they exceed it. It must not exceed `SPARK_WIN`.
- Station cards share one template. It runs name → region → one badge per sensor in `.pophead`. Then
comes one `.sensor` section per sensor, each headed by its glyph and kind. A place with one sensor draws
  the same way as a place with four. The kind is on the card twice on purpose. The badge answers what
  the place is, and the heading names the reading under it. `meter()` renders water level on a
  **piecewise** scale: alert 38%, warning 68%, danger 100%. Real thresholds bunch above 88% on a
  linear bar. **The scale does not start at 0 m.** Most stations read
  against an absolute datum (SERENDAH alerts at 35.80 m). So a bar from zero put every calm one hard
  against the alert tick, and froze it there. `levelStops()` floors it `LEVEL_FLOOR` (6) alert→danger
  gaps below the first mark. One definition, in `util.js`: the meter, the table bar, the table's sort
  key and the heat weight all read it. Do not hand-copy the stops — `table.js` did, and its sort and
  its bar then disagreed.
- **The station pins and the cluster chips are painted on ONE canvas, by `js/pins.js`.** Every pin
  was a `divIcon` until 2026-09-03, and Leaflet.markercluster grouped them. Measured over one
  scripted gesture, medians: 103 frames in 4.2 s as DOM nodes against 209 on the canvas, with the
  95th-percentile frame falling from 140 ms to 37 ms. Drawing no marks at all gives 215, so the
  canvas costs what an empty map costs.
  **The marker objects stayed.** `render.js` still builds one `L.Marker` per site and the canvas
  draws from that array, so a press fires the marker's own `click` and every handler already bound
  runs unchanged. It gained one field, `pin`, which names the glyph, the colour, the ink and the
  four states. The sprite cache keys on those, and the live payload makes 18 sprites.
  **Four marks are still DOM**: the selected pin's teardrop, "You are here", a searched place and
  the weather pins. Weather mode was never measured.
  **So the pin appearance lives in two places.** `css/map.css` draws the DOM copies and the
  legend, and `js/pins.js` draws the canvas ones off numbers taken from that same file. Change a
  number in one and not the other and the map and the legend drift, with nothing to say so.
  **Leaflet.markercluster is gone**, with its script tag, its stylesheet and both vendored files.
  Its grouping is 30 lines of greedy grid in `pins.js`, at the same radius.
- Vendored assets only — no CDN, so Tracking Prevention has nothing to block. `leaflet-heat.js` is
**patched**, with `willReadFrequently` on 3 `getContext` calls. Do not overwrite it with a fresh
copy.

## Verify

The commands moved to [`docs/VERIFY.md`](docs/VERIFY.md) on 2026-08-27, for the reason the gotcha
section above states. That file holds every sweep that reads the live payload. It also holds the
eight runnable checks, and it says which risk each one guards.

Run the checks that cover what you changed. The eight are `php shots-test.php`,
`php api.php --selftest`, `heat-test.html`, `title-test.html`, `narrow-test.html`,
`paint-check.html`, `m3-check.html` and `map-limits-test.html`.
