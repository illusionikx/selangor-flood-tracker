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
| `shots-test.php` | `php shots-test.php` — one of seven runnable checks. Guards retention. Exercises `pruneShots()` |
| `log.php` | where a browser error lands. `js/oops.js` is the only caller. Appends one JSON line to `.client-errors.log` |
| `watch.php` | reads a payload on stdin and complains when it is wrong. The poll cron pipes into it. Reports a change of state, never a state |
| `.user.ini` | per-directory PHP settings. Holds one line, `session.auto_start=0`, and the reason it is there |
| `index.html` | markup only — no inline CSS or JS |
| `title-test.html` | `chrome --headless --dump-dom` — one of seven runnable checks. Guards the wordmark ladder in both of the heading's homes, the app bar and the navigation rail, in rendered pixels |
| `narrow-test.html` | `chrome --headless --dump-dom` — one of seven runnable checks. Guards the narrow-window block: its threshold, its coverage, its refusal to be dismissed, and that it is modal |
| `paint-check.html` | `chrome --headless --dump-dom` — one of seven runnable checks. Guards the layer chips over the map: that the panel and its two openers are gone, that the filters panel and every district id are gone too, that a menu chip states its own value and a filter chip carries a checkmark, that the heatmap and the two filters leave with the station layer, that a filter chip clears itself on a second press, that nothing else on the map lands on the row, and that below 600px the row wraps rather than scrolling |
| `m3-check.html` | `chrome --headless --dump-dom` — one of seven runnable checks. Guards every M3 surface in rendered pixels: the nine dialogs against the roll call and the kind each is declared as, the four-band ladder, the map as an inset card, the one motion that changes what the pane holds, the supporting pane's headers and all five dialog headers as one M3 medium flexible top app bar, measured against each other at both widths, the supporting pane at M3's canonical ratios with the map giving up exactly that width, the pane as a side sheet above 600px and a full-screen dialog below it, and the station panel as an M3 list, one item per sensor, with its readings as a segmented list under a 24px kind glyph. Also the navigation rail at both its widths, the navigation bar below 600px, and that every enter carries M3's own duration and easing. Also the table dialog and the camera wall. Both take the one inset, shared by the search bar, the count line and the grid. The search bar states its own 56px shape. The sort target reaches 56dp. A tile states its container tone and a 12dp corner. The check also guards the two deletions, so a half-finished revert cannot ship silently |
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
| `js/map.js` | map instance, basemap/theme, cluster, the station panel (`openSide`), `focusOn` / `flashTo` |
| `js/heat.js` | both heat layers (water level, rainfall), ground-fixed sizing per layer, shared opacity. Also the field pass where a gauge reporting no rain denies the ground a wet one claims |
| `heat-test.html` | `chrome --headless --dump-dom` — one of seven runnable checks. Guards the rain layer's paint distance, its dry-gauge erase and its handover between neighbours, in canvas pixels |
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
| `water-build.php` | `php water-build.php` — rebakes `water.json` from OpenStreetMap. Run by hand, never in a request |
| `water.json` | the water the dark basemap will not draw: 2,775 rivers + 3,860 ponds, baked and committed |
| `wx-build.php` | `php wx-build.php` — bakes `wx-places.json` from Nominatim. Run by hand, never in a request |
| `wx-places.json` | the district behind each weather point, baked and committed |
| `icon-192.png`, `icon-512.png` | manifest icons (`any`) and the favicon — the glyph on transparency |
| `icon-180.png` | `apple-touch-icon`. Opaque, because iOS flattens alpha onto a colour of its own |
| `img/` | optional. Only `egg.webp` (the About easter egg). Absent is a supported state — see below |
| `m3-build.php` | `php m3-build.php` — bakes `vendor/m3/tokens.css` from the M3 Expressive token set. Run by hand, never in a request |
| `vendor/m3/tokens.css` | M3's shape, typescale, elevation, motion and state scales, vendored. Generated — **colour is deliberately not in it** |
| `vendor/` | Leaflet, leaflet.heat (patched), markercluster, subsetted fonts, the M3 token scales — no CDN, hand-managed |
| `lib/` | Composer's vendor dir (`symfony/dom-crawler`), gitignored — **not** `vendor/` |
| `composer.json` | the one server-side dependency. Run `composer install` before first run |
| `.github/workflows/pages.yml` | bakes the static GitHub Pages build — runs the PHP on cron, publishes `api.json` |
| `docs/DEPLOY.md` | both targets: Pages (what it cannot do) and a Debian box / Proxmox LXC (spec, nginx, cron, container traps) |
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

- **`-9999` means "no reading"** in both scraped feeds, rendered as `-9,999.00` in one of them.
  `numOrNull()` strips separators and nulls anything ≤ −9990. Treated as a level, it renders a
  station as catastrophically dry and poisons its trend history.
- **JPS shuffled the coordinates inside one batch of cameras, so a pin can be 83 km from its name.**
  The coordinate the feed publishes for camera 1285 points at Kayu Ara. The one for camera 1287
  points at Tanjung Karang. So camera 1279 drew in Sepang and camera 1288 in Bangi. Each one was
  filed under a district it was nowhere near. The list endpoint and the detail endpoint carry the
  same wrong value, so there is no better source to prefer. `CAM_FIX` in `api.php` corrects fourteen
  of them, and an entry gets in one of two ways. **Most must pass two checks that fail in different
  ways.** The station name must geocode to the point. That point must sit near the median of the
  non-camera stations in the district JPS itself assigns. A name alone is not enough. `Bukit Serdang`
  (camera 1285) geocodes cleanly to Seri Kembangan, 30 km outside the Kuala Langat district JPS gives
  it. A second place carries that name. **A same-named station of another kind beats both**,
  and camera 1277 came in that way: JPS already publishes a TAMAN DESA KEMUNING mast, so the camera
  takes that coordinate rather than a gazetteer guess. The geocode landed 200 m off, which is outside
  `SITE_M`. So the camera drew as a place of its own, beside a mast it belongs on. Camera 1282 took
  the same route on a name that is only close. It reads `Kg Simpang Balak` and the siren reads
  `SIREN KG. SG. BALAK`, which is Sungai and not Simpang. What carries it is the district. The
  published point was not in Hulu Langat at all. The siren of the near name is. **A near name is
  weaker evidence than an equal one**, so the table marks that entry `SOMEWHAT CONFIRMED`. A near
  name never gets in on its own.
  **The third way in is the swap, read from the other end.** Correcting camera 1279 orphans the
  point JPS published for it. The five stations nearest that point are all in Kuala Langat, which is
  the district JPS gives camera 1285. That camera is also the only Kuala Langat one in the batch. So
  exactly one station can own the orphaned point. Use that rule only when both halves hold. The
  neighbours agree on a district. The batch holds exactly one uncorrected camera that JPS files
  under it.
  **The strongest way in is that same swap solved for the whole batch at once.** The shuffle is one
  closed permutation. Name the station nearest each suspect camera's published point. Thirteen of
  the fourteen points name another camera in the batch, inside 550 m. The cycle runs
  1276→1280→1287→1288→1284→1278→1282→1277→1281→1286→1289→1283→1276. Cameras 1279 and 1285 are
  swapped as a pair. One camera and one point are then left over, and can only be each other. That
  is how camera 1281 got in, with no gazetteer hit and no same-named mast. **Rebuild the whole map
  before you argue about one pin.** Solving them one at a time took ten rounds, and left four wrong.
  The cycle also names the cameras that are **not** in the shuffle: 1271, 1272, 1273, 1274, 1275,
  1315 and 1316. Each sits near a station of its own name, and the cycle closes without them. Two of
  those (1272, 1315) were called wrong here for months on a failed gazetteer lookup alone. **A name
  a gazetteer misses is not a wrong coordinate.** Camera 1289 makes the same point from the other
  side. No gazetteer holds `Rimba KDR`. JPS publishes a RIMBA KDR mast in the district it files
  the camera under. Search the payload first, then the gazetteer.
  A coordinate we invent is worse than one we can show belongs to upstream.
  `CAM_FIX_KM` retires the table by itself: an override applies only while the feed still disagrees
  by more than 2 km. The day JPS corrects a station, the feed wins again, and no line here waits for
  somebody to delete it. Do not extend this to another kind without the same evidence — the shuffle
  touched cameras only.
  **A second and unrelated fault sits beside the shuffle.** JPS also publishes some cameras with no
  coordinate at all, `lat: 0, lng: 0` rather than a wrong one. `CAM_FIX` now carries entries for
  those too. Seven of the eleven came in by the route this entry already calls strongest. That route
  is a station of another kind, already in the payload, carrying the same name. Two more, cameras
  241 and 247, carry a name only close to a station JPS publishes, not an equal one. A near
  name is weaker evidence than an equal one, the same rule camera 1282 states above. What carries
  each of those two is the district. The near-named station sits inside the district JPS files
  the camera under. Both are marked `SOMEWHAT CONFIRMED` in the table for it. The other two,
  cameras 244 and 246, carry the median of their district's non-camera stations instead. That is a
  coordinate this file invented. If nobody can confirm where the camera stands, the rule above says
  to delete an invented coordinate. Do not keep it. Anything that draws a station from
  this payload must still tolerate a camera with no coordinate. The next one JPS publishes that way
  has no entry here yet.
- **A `(string)` cast on `$_GET[...]` does not throw on an array — it emits a warning and coerces
  silently.** `?place[]=x` makes `$_GET['place']` an array. `(string)` on it prints
  `Warning: Array to string conversion`. It yields the literal string `"Array"`, five characters that
  pass `placeQuery()`'s length check clean. So the warning lands inside a response whose
  `Content-Type` is already `application/json`. That breaks the parse for a client that sent one
  malformed query string. The request still spends the site-wide rate limit on a garbage query.
  `?cam=` and `?shots=` never had this problem because `(int)` on an array is silent. `placeParam()`
  in `api.php` is the guard: refuse anything that is not already a `string` before it reaches
  `placeQuery()`, rather than cast and hope. Any future endpoint that reads a `$_GET` value as a
  string needs the same check at the call site. The validator downstream cannot fix a type problem
  that already corrupted the response.
- **The KL endpoints return bare `<tr>` fragments.** Both libxml and the HTML5 parser discard rows
  that are not inside a table. So `crawl()` wraps every page in `<table>` before parsing. Drop the
  wrap and the KL feeds silently return nothing.
- **`children('td')`, not `filter('td')`,** when counting a row's width. These pages nest tables,
  and a descendant search counts the inner table's cells too. That blows the 14-cell guard.
- **Iterating a `Crawler` yields raw `DOMNode`s**, which have no `attr()`. Use `->each(fn(Crawler
  $n) => $n->attr(…))` to stay in Crawler-land, or you get a fatal on the first attribute read.
- **`crawl()` reads nothing from the national portal's rainfall table.** No data row carries an
  opening `<tr>`. The `<tbody>` holds one empty row, then about 31 stray closing tags. Every row
  follows as a bare run of `<td>` cells ending in `</tr>`. Measured on the live page,
  `crawl($html)->filter('tr')` finds 4 elements, and none holds a `td` child, against 239 real rows.
  The existing wrap in `crawl()` cannot repair this. It supplies a missing table, and this page
  lacks the rows instead. `portalRows()` splits the body on `</tr>` and wraps each chunk as a row
  of its own. It then keeps only chunks of exactly 13 cells. The width guard checks that the repair
  produced the shape expected.
- **`pageHasData()`'s `<tr` test cannot answer for the portal rainfall page.** Its header block holds
  four instances of `<tr`. The empty form page holds the same four. That page is what the endpoint
  returns without its two hidden inputs. A shared test cannot tell the two apart. Those keys test
  `data-th='No'` instead, which appears once per data row and nowhere else.
- **`clean_rainfall` is the disjoint 5-minute bucket in the 7-day history series, not `raw`.** The
  field names guessed before the endpoint was read — `tarikh`, `raw`, `clean`, `chourly` — do not
  exist on the live feed. The real fields are `date_time` (no seconds), `clean_rainfall`,
  `cum_hourly` and `cum_daily`. `cum_hourly` is a rolling 60-minute total and `cum_daily` is the
  running day total. So there is no single rolling field to confuse with the disjoint one. There are
  two, and neither is the one to sum. Measured against the live endpoint on three stations across up
  to 8 days: `clean_rainfall` summed across one calendar day reproduced `cum_daily`'s own end-of-day
  figure exactly, every time. **Score this identity on a station with rain in the window.** An
  earlier pass scored it on a station holding 15 non-zero buckets out of 1,815. The rolling field
  passed, because twelve zeros sum to a zero.
- **A `graphId` is a string, and casting it to `int` silently breaks the history backfill.** Some ids
  carry a trailing underscore the site's own link puts there, `stationid=3015084_`. Measured against
  the live SEL/WLH/PTJ pages: 58 of 176 ids on the Selangor page alone carry one, 72 of 308 across all
  three state pages. The digit run alone is a *different* id to the endpoint the id names. It answers
  with an empty series, while the id with its underscore answers with the station's own 7-day
  history. This app stamps a station `histdone:` whether or not its fetch answered. So an `(int)`
  cast here silently empties the backfill for 23% of stations, for good.
- **A running total must never restart when this app cannot advance it.** Before this work a
  Selangor station stored a year-to-date odometer under `#c`. A portal station starts a total near
  zero. Without a guard, restarting on deploy writes a small number after a large one. `accWindow()`
  reads the total going backwards and answers null, so 140 stations sit dark for 72 hours. It held
  here only because `INSERT OR IGNORE` collided on `(station, ts)`, which is luck, not a guard.
  `portalOdo()` holds the total instead of restarting it, whenever it has no `prevDaily` to measure
  the rise against. That is the exact case a fresh deploy meets. It costs one poll of rain, once.
- **A name alone cannot place a station.** The portal's own gazetteer holds two entries for one
  station, 81 km apart: `Sg. Bernam di Tanjung Malim`, 1.1 km from the real town, and `Sg. Bernam di
  Tanjung Malim (F2)`, beside Putrajaya. `gazCorroborated()` requires the point to sit within
  `GAZ_DISTRICT_KM` (50 km) of the median of stations in the district the portal itself assigns. This
  is the rule `CAM_FIX` already states for a camera, above, so nothing here restates it in full.
  Evidence for 50 km. Zero of about 470 stations this app already holds sit past it. The check
  refuses the same two rows at 40, 50 and 60 km alike. The worst legitimate outlier measured
  34.6 km. That leaves a wide gap under the closest rejected placement, at 67.5 km.
- **The corroboration check has a floor, and the floor is a hole.** A `state|district` bucket
  holding fewer than 3 known stations passes `gazCorroborated()` unchecked. Refusing there has no
  evidence behind it, and that invents a check rather than makes one. 8 buckets are that small: 7
  Kuala Lumpur districts, and Putrajaya. Putrajaya's only two stations are new placements from this
  same source. So its own baseline started at zero.
- **A skipped rainfall bucket understates the seeded history, and nothing marks it.**
  `seriesParse()` drops a bucket that fails `numOrNull()` or reads negative, which keeps the running
  sum non-decreasing. The drop happens before `seedRebase()`'s accumulator ever sees the bucket. So
  `$run` sits short by that bucket's rain from that point forward. The shortfall lives in the running
  sum, not in the offset. The offset is one constant, computed once per station and added to every
  point. It cancels out of any window, skip or no skip — the identical rule `sources.php`'s own
  comment on `seedRebase()` already states. A window with both ends on the same side of a skipped
  bucket still nets the shortfall out. Both ends carry the same short `$run`. A window
  straddling the skip does not. Only the later end absorbed the loss. Several skips
  compound in the same, understating, direction. That is the opposite of this repo's safe way to be
  wrong, and no `derived` marker communicates it.
- **Never `file_get_contents()` a JPS URL — always curl.** `infobanjirjps.selangor.gov.my` resolves
  to *two* A records. One of them (`58.27.97.62`) blackholes SYNs. curl races both (happy
  eyeballs) and connects in ~10 ms. PHP's stream wrapper tries addresses serially, with no connect
  timeout of its own. So it eats the OS TCP timeout — 21 s on Windows — whenever it draws the dead
  one. `?cam=` was the only outbound call in the repo not going through `fetchAll()`. It was
  therefore the only slow endpoint, at ~21 s per still. It took 42 s when the https attempt lost and
  the http fallback lost too. Stills now take ~0.8 s. The dead record can be removed, or it can move
  to the other IP. The rule is about the mechanism, not that address.
- **Every picture in this app fails into `.camfail`, and a failed `<img>` must never be left to size
  its own box.** Four surfaces draw a picture. They are the lightbox frame, the lightbox's compare
  frame, the station card still and a camera wall tile. Each one keeps the box the picture takes,
  and puts the same `videocam_off` / `No picture` panel in it. The look is `.camfail` in
  `css/base.css` and only the placement belongs to each surface. **One fact must not get two looks.**
  The card printed `image unavailable` instead, on a box that collapsed to the height of that line.
  The compare frame is the exception that shows why an empty box is not enough on its own. It is
  clipped to the divider and held no fill. So a failed frame let the *other* frame show through, and
  compare drew one picture twice under two timestamps. A false match is worse than a visible gap.
  Three image paths are deliberately silent instead. All three have a picture already on screen to
  fall back to. They are the wall's strip probe, the clip's strip probe, and the lightbox's frame
  prefetch. **Anything new that draws a picture picks one of those two shapes.** It takes the panel,
  or a silent fallback to something already visible. Never a bare broken image, and never a handler
  that lets the box shrink to nothing.
- **`rm -rf shots/` is a year of camera history**, and unlike `.history.db` it cannot rebuild. The
frames only exist because we ran when they were taken. To re-test the capture path,
  `rm shots/.last` (the 30-minute stamp), not the directory.
- **A retention bucket aims at a clock time, and both sides must aim at the same one.** `SHOT_TIERS`
  carries a third number per tier. That is the anchor, the target time in UTC modulo the step. A
  frame's slot is the **next target at or after it**. So what survives is the last frame taken
  *before* that target. It is not the nearest one to it. With frames at 15:24 and 16:10, the nearest
  to 16:00 is 16:10. A picture taken after the time it is labelled with is the one thing this must
  not do. `thin()` in `js/timeline.js` repeats the same expression and the same numbers. So the ruler
  and the clip cannot file one frame in two slots. Week aims at 01:00 MYT, month at 04:00 and 16:00,
  year at Monday 16:00. The three nest, so a frame keeps hitting its target as it ages between
  tiers. The old rule bucketed on `floor(ts / step)`, which aligns to **UTC** midnight. At +8 that
  put the week range on 01:30, and the month on 07:30 and 19:30. It put the year on a Thursday.
  Change an anchor in one file only and the two sides disagree about where a slot starts.
  `shots-test.php` asserts each anchor against `time()` — **never against the epoch**. Malaysia ran
  UTC+7:30 until 1982, and PHP renders a 1970 instant 30 minutes early. That makes a correct constant
  look broken.
- **A sample's `ts` is when the reading was taken, not when we polled.** Upstream changes a value
  every ~25 min and we poll every ~8.5 min. So a level is a staircase, and the same number arrives
  four or five times. Stamping each arrival `now` puts the step where we noticed it. That put up to
  a poll interval of error on *both* ends of a rate. A rate came out wrong by over 100% on a short
  baseline. That is why a station whose level had not moved in five polls reported a 0.9 h ETA. The
  `readTs()` helper reads `updated` and clamps a future stamp, because JPS stamps to the upcoming
  slot. It falls back to `now` only when the parse fails. Anything new that writes to `level` must go through
  it. Two side effects to keep. The `(station, ts)` PK now dedupes a repeated reading to one row. A
  station frozen on an old reading stores that old stamp. So `RETAIN` prunes it, and `SPARK_WIN`
  excludes it instead of drawing a flat live-looking line.
- **A rain total over 24 or 72 hours is a difference, never a sum.** `cumulativeRainfall` only
  climbs, so `accWindow()` subtracts two samples. **Do not add up `hourly` buckets instead.** A sum
  loses the rain in every gap and reports a small number with nothing to say it is short.
  Measured on this box, the archive held 9 of the last 24 clock hours and a 15-hour hole.
  A sum renders that as a dry day. The scrapers already fail silently by design, and a total with no
  alarm behind it is worse than none. A difference cannot lose rain. A missed poll widens the window
  instead, and the payload measures that wider window. So the card states `measured over 26.1 h`
  rather than claiming 24. Three things return `null` rather than a number. They are an empty series,
  a backwards odometer (the 1 January reset), and both ends on one sample.
  **The national portal supplies a per-day running total, and `accHours()` is gone.** A station the
  portal carries builds the total from its midnight column — see `portalOdo()`. It answers both long
  windows the same way a Selangor station always did, with its own year-to-date odometer.
  `accHours()` added one rolling hour per clock hour. `hourlyRainfall` is a rolling 60 minute total,
  and the readings sit a median 46 minutes apart. So every hour boundary counted about 14 minutes of
  rain twice. Scored against the 3 hour total Selangor publishes, 14 of 176 stations were
  out by more than 5 mm. The worst was out by 60 mm. The error was zero on a dry station and large
  during heavy rain. That is the worst shape an error can take here.
  **The permanent dash now marks the stations the portal does not carry**, not a fixed block of 38
  KL gauges. Two `—` columns on such a station are still the right answer, and the readout on the
  dash still says why: `Not measured. This gauge keeps no running total.` Measured 2026-08-15. Of
  204 gauges that draw this chart, 3 carry that dash. All three are Kuala Lumpur stations the portal
  search never matched. **That is still the only empty long window a reader ever meets.**
  **The `#d` series holds the previous daily reading.** It carries its own suffix for the same
  reason `#c` has one: no station id ends in `#d`. `portalOdo()` needs both the last running total
  and the last daily reading to bridge a midnight. So the next poll stores `#d` to know what it
  already counted.
- **A window can also cover LESS ground than it names, and then it says so.** `accWindow()`
  takes `$partial`. With no sample at or before the far end it measures from the oldest sample there
  is and returns `short`. `derived` is a ladder of three rungs rather than a flag. 0 is off the feed.
  1 is worked out over the whole window. 2 is worked out over a shorter one. The card prints one
  asterisk per rung. This is still a difference, so it still cannot lose rain. **The `#c` series began
  2026-08-13 18:30 and nothing can fill it in**, because no earlier poll stored `cumulativeRainfall`.
  Before this, both long windows drew a dash for two days. On the 2026-08-14 15:45 poll, with the
  archive 20.5 h deep: 179 stations of 231 answer `h24` over 20.5 h, 1 answers it whole, and 51 answer
  nothing. **`$partial` is false by default, and `rainBacked()` depends on that.** A window narrower
  than the hour it asks about calls live rain faulty. A wider window can only add rain, which is
  the safe way to be wrong.
  **Both long windows anchor to the earliest record, and both publish it even when that is one number
  twice.** An archive 21 h deep answers 24 h and 72 h with the same 21 h difference, each marked
  short. On the 2026-08-14 16:20 poll, 180 stations of 231 answer both windows over one span. That is
  every Selangor gauge that can answer at all. The earliest record is the earliest record, and a dash
  tells a reader nothing. The mark and the span in the readout carry the shortfall on each column.
  **Neither surface names a clock time, and an early version named it twice.** The footnote printed
  `Measured from 13 Aug, 19:11` and the readout repeated it. A reader cut both. The shortfall changes
  how to read the number. The hour this one server first stored an odometer reading does not.
  `accFrom` still rides on every station with a running total. The card tests whether the key
  is THERE, which is how the card names the KL gauges. Nothing prints its value, so do not delete the
  field on the strength of that. `MYT_WHEN` in `popup.js` existed only to format it and is gone.
  **The `!from` guard covers one poll in the life of a server, and that is not a state.** A fresh
  `.history.db` leaves a station holding one odometer sample and no difference. That station does
  publish a running total, so the clause is false on it. The guard stops this app saying a false thing
  for eight minutes. Do not give it a message of its own, and do not delete it either.
  **Two filters tried to suppress the pair and both are gone. Do not build a third.** The first
  was a floor in hours: a partial had to cover more ground than the fixed window under it. The live
  payload broke it at once. A floor compares one span to a constant, and the fault is two spans
  landing on each other. PUNCAK ATHENEUM holds 27 h. So its 24-hour window WIDENED to 27, and its
  72-hour window fell SHORT to that same sample. A widened window can meet a short one at any depth.
  The second compared the two spans and dropped the longer. That is the one this reverses on a
  reader's instruction, and the instruction is right. Suppression trades a true short measurement for
  no measurement. The remark already states what the columns share.
  **A widened window is not a short one, so the pair can carry different marks over one number.**
  PUNCAK ATHENEUM draws `24 h*` and `72 h**` at 6.5 mm each. The first covered more ground than it
  names and the second covered less. Four assertions in `--selftest` hold both halves.
  **A short window can undershoot a window nested inside it, and this app does not suppress that.**
  On the same poll, 4 stations of 180 report less over 24 h than over today. Three of them are out
  by 0.5 to 1.0 mm, and TAMAN MAYANG by 12.5. The odometer and the feed's own daily total disagree,
  and nothing here can say which is wrong. Do not suppress the odometer figure. That trusts the feed
  over it, and those two fields already carry the opposite trust. For scale, 17
  stations on that poll report less today than in the last 3 hours. Both sides come straight off the
  feed. The chart always drew windows that disagree.
- **The accumulation chart carries no threshold mark, and three sources failed to supply one.** It
  says how much rain fell and never how bad that is. `rainBars()` above it already draws the JPS
  intensity classes. `rainState()` above that prints the word. A curve fitted between
  `spVeryHeavy` (61 mm/h) and MET's 240 mm/day joins a **1.7-year event to a 216-year
  one**. Those are two
  orders of magnitude apart in rarity. So it measures the gap between two definitions, and nothing
  about rain. JPS publishes MSMA 2nd Edition Equation 2.2, which covers 5 minutes to 72 hours
  exactly. It still loses. An IDF curve needs 20–30 years of record at one spot. JPS published
  12 such gauges in this area, and **only 11 of 230 stations stand on one**. The rest borrow
  climatology from another place at a median of 11 km. `spVeryHeavy` alone is per-station and honest
  but marks the 1-hour bar only. A dry station therefore draws five flat columns and **not** a
  sentence. Any sentence has to name a window. Take "No rain in the last 72 hours" on a station whose
  72-hour total is unknown. That is the exact claim this refuses to make. Five columns keep a measured
  zero and an unanswered window apart. See `docs/superpowers/specs/2026-08-12-cumulative-rainfall-chart-design.md`.
  **`rainBars()` above it now obeys the same rule and for the same reason**. It printed `No rain in
  the last 11 h` on an all-zero history and draws the zeros instead. A sentence about a window can
  only make one claim about the whole of it. This graph holds two facts that have to stay apart.
  A run of measured zeros is a line along the floor. A station we cannot reach is a break in
  that line. Its `hi` therefore ends `|| 1`. With no peak and no class in range the axis is zero,
  and `y()` divides by it. So every point came out `NaN` and nothing rendered. Any positive number
  puts a zero on the floor. The two remaining sentences are the case where there is nothing at all to
  plot. That is the one thing a graph cannot state for itself.
- **A tide is a rise, and three of these stations are tidal.** PINTU AIR IJOK is a water gate.
  BANDAR KLANG and TELUK PENYAMUN (JETI) are estuarine. They climb 0.5–0.7 m/h twice a day forever,
  so any rate-based forecast flags them daily. The guard is `level ≥ its own 24h high`, not a
  blocklist. A list needs maintaining. It is wrong the day JPS adds a gauge. It says nothing about
  rivers that are mildly tidal at the mouth. **Do not replace it with a station list.**
- **Never `rm .history.db` to test a cold start.** It destroys the accumulated samples. Every
  `rising` flag goes false for an hour. Anything keyed off `rising` goes quiet at once: the filter,
  the alert panel, the kind counts, the heat weighting. To re-test the scrape path, expire the page
  cache instead: `UPDATE page SET ts=0`. If you must delete it, copy the file first.
- **The scrapers fail silently by design** — a layout change yields zero rows, not an error. The
  payload's `sources` counters (`kl.parsed/added`, `national.parsed/applied`) are the alarm: if
  `parsed` hits 0, a table moved. Check those before believing "the rivers went quiet".
- **A page-cache row that never answers can never advance its own timestamp.** `$want` selects a page
  whose stored `ts` is older than its TTL. The write used to run only on a non-empty body. So a dead
  upstream re-entered `$want` on every rebuild. It then held a slot in the shared `curl_multi` batch
  for the full `CURLOPT_TIMEOUT` of 25 s. A batch finishes no sooner than its slowest member, so one
  hung page put 25 s on every cache miss. Measured: 0.13 s for a cached poll, and 28.6 s for a
  rebuild. It reached 45.1 s when the half-hourly camera capture landed in the same request.
  `infobanjirjpskl.water.gov.my/Rainfall/LatestData/All` hung that way for four days.
  `WaterLevel/LatestData/All` answered in 3.9 s on the same host through all of it. `pageRow()` stamps
  every page the server asked for, answer or not, and keeps the stored copy on a failure. A dead page
  now costs the timeout once per `SCRAPE_TTL` rather than once per rebuild. **Never stamp a page the
  server did not ask for.** A stamp on a fresh row pushes its next fetch out forever. The stamp then
  costs the one signal a reader had. The `ts` column now advances whether or not the page
  answered. **`sources.stale` is the replacement, and it is the alarm to read.** It lists the page
  keys this server asked for and did not get. A key there means the map draws a stored copy of that
  table. The parse counters cannot say it. A stored copy parses as well as a fresh one, so
  `kl.parsed` stayed above zero through the whole outage. `sources.stale` is empty on a healthy poll.
  **A status code cannot decide what a body is, so `pageHasData()` decides it.** The national portal
  serves a maintenance window as a 320-byte `Notis Gangguan` notice under **HTTP 200**. That
  notice overwrote the stored tables for KL and Putrajaya while this work was measured.
  `national.applied` fell from 71 to 47 and nothing said why, because the fetch succeeded. A
  table page must hold a `<tr`, `met-day` and `met-warn` must decode as JSON, and `met-now` must hold
  `map.setView`. **`met-now` is tested on the map scaffolding and never on a marker.** A nowcast
  with nothing to report is weather, not an outage. `fetchAll()` covers the other shape and blanks
  any status at 400 or above. That also stops `?cam=` serving an HTML error page as `image/jpeg`.
  The first guess named the camera strips and was wrong. `buildSheet()` runs from `?sheet=` alone,
  never from the payload route, and one strip takes 0.054 s.
  **The weather section prints MET's own issue time, `met.stamp`, and never our poll time.** The
  nowcast page is cached for `SCRAPE_TTL`, and MET issues about every 30 minutes. So the two are
  different by up to 45 minutes. The poll time tells a reader a forecast is fresh
  when it is three quarters of an hour old. `metPoints()` drops any marker whose stamp fails to
  parse, so a point that reaches the payload always carries one.
  This app publishes a notice it can name as `notices[]`. The reader then sees it on screen. Every
  other failure still stays in `sources.stale` alone.
- **`session.auto_start` serializes every request from one browser, and it also buries every other
  fault.** The file session handler holds an exclusive lock on the session file for the whole
  request. Every request that carries the same `PHPSESSID` therefore waits behind the one before it.
  Six concurrent camera stills measured a staircase: 1.9, 3.0, 4.3, 5.4, 6.1 and 6.9 seconds. The
  same six requests with no shared cookie finished together in 3.4 seconds.
  The second cost hid the first for months. Where the session directory refuses a write, PHP logs
  two warnings for every request. Each font, stylesheet and module pays that. The log on this
  machine reached about 28,000 lines, and almost all of them said the same thing.
  `.user.ini` sets `session.auto_start=0` for this directory now, so there is usually no session at
  all. Measured after the change: three requests grew the shared log by zero bytes.
  `api.php` still calls `session_write_close()` as its first statement, above the two `require_once`
  lines. Nothing in this app reads `$_SESSION`. A server that ignores `.user.ini` still
  needs the release. Do not move it later in the file. Code added above it runs inside the lock
  again. `session_write_close()` is silent when no session is active, so the call costs nothing once
  `.user.ini` applies. Note that PHP caches `.user.ini` for `user_ini.cache_ttl` seconds, 300 by
  default.
- **`error_log()` writes to standard error, and a FastCGI server folds that into its own log.**
  `api.php` called `error_log()` correctly the whole time. PHP ran with no `error_log` set. So
  every one of those lines landed in the log of the web server, beside every unrelated line it
  writes. An uncaught exception from this app was one line among about 28,000.
  `api.php` and `log.php` each call `ini_set('error_log', __DIR__ . '/.php-error.log')` now. This is
  `ini_set()` rather than an ini file because `__DIR__` resolves on both deploy targets. A committed
  absolute path is correct on one target at most. **Any new PHP entry point needs that line.**
  Without it, its errors go back to the shared log and nobody finds them.
- **A geolocation permission can read `granted` and still yield nothing, because the operating
  system refuses the browser underneath it.** Measured on one Windows desktop reaching this app over
  https. The permission query returned `granted`. `getCurrentPosition` timed out at both accuracy
  settings, 10 s and 30 s. Windows held `lfsvc` disabled and the machine consent key at `Deny`. Edge
  inherited that `Deny` and had no source left, network fallback included.
  Leaflet adds no timer of its own, so `map.locate()` reports what the browser reports and no sooner.
  The browser did fire `locationerror` on time. Nobody saw it.
  `js/locate.js` wrote the reason into `btn.title` alone, and `#locate.busy` carries
  `pointer-events: none` for those ten seconds. So a reader pressed, waited, saw nothing, and pressed
  again. That reads as a button that spins for ever.
  **Do not tell a reader to check the site settings in the browser.** Those can be correct while the
  device refuses. `failTip()` in `js/locate.js` splits three ways instead, on the answer
  `navigator.permissions` gives for the site half. A `granted` beside a failed fix names the device
  and never the browser. A `denied` names the site. No answer from that API names both. On Windows
  the tip also names the path. A reader told to open the settings for a device still has to
  find them. **A repair a reader runs in a terminal is not a fix.** The first draft of this entry
  ended in three PowerShell lines.
  **A one-page probe found the fault and is gone now. The method is the part to keep.** Put a wall
  clock on each request rather than trust the timeout you pass in. Ask at both accuracy settings. A
  browser that ignores its own timeout and one whose provider never answers look identical from
  inside this app. Only the clock tells them apart.
  **The words ride `data-tip` and the state rides the glyph.** `#locate.fail` swaps `my_location` for
  `location_disabled` and keeps the ink, and `js/sparktip.js` names anything carrying that attribute
  on hover and on tap alike. The surface took three tries. A panel card came first and it was too
  much furniture for a button that did not answer. Amber came second and read as an alert on the
  water. The glyph is the third. It is the crosshair of the resting state with a line through it.
  So the two read as one control in two states. `setBtn()` writes all three button states through one
  function. So no attribute outlives the state that set it. A tip left over from a failure names a
  fault on a button that already found you.
- **`js/oops.js` must stay the first import in `app.js`.** A static import runs before the body of
  the file that imports it. A handler written inside `app.js` therefore starts after every other
  module evaluated. A throw during that evaluation reaches nobody. This is a real case rather
  than a theoretical one. `state.js` reads the saved preferences with `JSON.parse`, so corrupt
  storage throws there before the map draws anything. `oops.js` imports nothing, so it evaluates
  first. Moving it down the import list, or folding it into `app.js`, gives up the one case it exists
  for. It also breaks nothing visible.
  The third argument on its `error` listener is the capture phase. That is what catches a file that
  failed to load. That event does not bubble, so a listener without capture sees a throw alone.
  **A headless check with `--dump-dom` captures nothing, and the fault there is the harness.** Chrome
  exits at the dump and discards the queued beacon, so the log stays empty and the code looks broken.
  Keep the browser alive for a few seconds instead, then stop it.
- **No `fastcgi_finish_request` under Herd** — the SAPI is `cgi-fcgi`, so there is no way to close
  the connection and keep working. Stale-while-revalidate is impossible in-process. The page cache
  is the workaround. A cron that hits `api.php` every 5 min keeps the cache warm for good.
  **Never put logic that must always run inside `if (function_exists('fastcgi_finish_request'))`** —
  that branch is dead code on the machine this runs on. The stampede guard lived there for weeks and
  therefore never guarded anything. See the lock below. It caught a second fix the same way. The
  `?force=1` feature's defaults for `forced`/`forceWhy` were first added only to `serveCache()`. This
  branch echoes `cachedPayload()` directly. So it kept replaying a stale `forced: true` for five
  minutes after every real force. Dead here, live on the nginx/php-fpm target `docs/DEPLOY.md`
  describes. Whatever a fix touches in `serveCache()` must be checked against this branch too.
- **One rebuild at a time, enforced by `flock` on `.refresh.lock`.** A cold rebuild is ~270 requests
  at JPS. So N concurrent cache misses is 270N. That is the shape of a flood from one IP, aimed at
  the source the whole page depends on. The loser of the race serves stale cache and does *not*
  queue. The exception is a true cold start, when there is nothing to serve. Anything added to the
  refresh path must stay inside the lock, and any new upstream fan-out needs the same treatment.
- **Herd serves everything `Cache-Control: max-age=10800`.** Three hours of stale CSS/JS after an
  edit unless the URL changes. The stylesheet links carry `?v=` — **bump it when you touch a css
  file**, the same as `vendor/fonts.css`. ES module imports have no such guard. Hard-reload
  (Ctrl+Shift+R) after a `js/` change, or the browser can run the old module.
  **The app icons carry `?v=` too**, in four places — the two `<link>` tags in `index.html` and the
  two `icons[].src` in `manifest.json`. `icon-build.php` rewrites the PNGs under the same names. A
  browser holds a favicon for far longer than three hours. So bumping that number is the only
  thing that makes a new mark appear. The script prints the reminder when it finishes.
- **A pseudo-element that sets `--i` paints nothing until its selector joins the list in
  `css/icons.css`.** An `.i` element gets the mask from the `.i` class. A pseudo-element cannot, so
  the mask lives in one explicit selector list instead: `#gotoBox::after, .spark::before,
  .sparktip.warn::before`. `#locate::before` left it when that button took a real `<i>` child. That list is the answer to "how do icons work", kept in
  one file rather than repeated in three.

  A rule that sets `--i` and a size, and never joins that list, has no `content` and no `mask`. So
  it draws an empty box. The old `#paint::before` shipped that way for one run. It resolved the right `--i`
  at every state and drew a blank white plate on the map.
  **A computed `--i` is not evidence that anything painted.** `paint-check.html` reads `mask-image`
  for that reason, not just the token. **The fix was to stop using a pseudo-element.** That button
  took a real `<i class="i i-layers">` child, which takes the mask from the class like every other
  icon in the app. The button is gone now and the rule is not: reach for the child element first. The list exists for the cases that
  cannot have one, which is a box whose content is already spoken for.
- **`filter` runs before `mask`, so a filter on an `.i` is discarded.** The spec order is: paint the
  element, apply the filter, *then* clip with the mask. An `.i` is a box of `currentColor` with the
  glyph masked out of it. So a `drop-shadow` on it is computed from the box, lands outside the box,
  and the mask clips it off. Nothing renders and nothing errors — the pin stroke shipped invisible on
  both themes this way. The favorite heart works because its filter is on the `<b class="fv">`
  wrapper and the mask is on the `.i` inside it. `.pin`'s own soft shadow works for the same reason,
  since `.pin` is a plain `<span>`. Anything that wants an effect on an icon needs that wrapper.
- **A map pin's glyph is an inline `<svg><use>`, not a masked `<i>`, and the outline is the reason.**
  A CSS mask keeps only the alpha of the picture and paints the box in `currentColor`. So there is no
  fill and no stroke to address. Two attempts faked one and both were reverted. Four hard drop
  shadows cover four directions, so a water drop's diagonals come out thinner than its sides. A
  scaled copy of the mask behind the glyph is even at every angle and worse for it. A mask has no
  path to offset. So it grows away from its own centre rather than outward from its edge. At 400
  pins that is 400 grey silhouettes with a coloured shape laid on them. A real `stroke` on a real
  path is neither. It is one shape, offset along its own outline. `paint-order: stroke` puts it
  under the fill. `vector-effect: non-scaling-stroke` holds the width at 1 screen pixel, through
  `.pin`'s `scale(.8)` and the 48px `.me` pin alike. That property does **not** inherit. So it is
  stamped on the path in `pinGlyph()`, and cannot be declared on `.pinglyph`. The pins lost their
  `drop-shadow` when they gained the stroke: two marks around one 29px glyph is one too many.
  **Do not go back to a second copy of the shape**, and keep the stroke thin and in `--surface`. It
  is the gap between the mark and the tile. One wide enough to read as a border is the 400-blob
  failure in a better technique.
  `pinGlyph()` in `js/map.js` lifts each symbol out of `css/icons.css` at first use. So the path data
  still lives in one place, and adding an icon is still one line there. **Only the map pins take this
  path.** Every other icon in the app is still a mask, because nothing else needs a second colour.
  See `docs/FEATURES.md`, *Three attempts at an outline on a station glyph*.
  **A STATION PIN IS A DISC NOW, and the bare glyph above is what the other two marks still draw.**
  The repository owner picked the shape on 2026-08-26. `pinGlyph(name, disc)` in `js/map.js` emits a
  `<circle>` in the kind's colour with the glyph knocked out of it, and `render.js` is the ONE caller
  that passes `true`. A filled disc carries far more of a muted colour than a thin mark does, which
  is what the new palette needs at 29px.
  **Three callers deliberately do not pass it.** The favorite heart is a badge on the corner rather
  than the mark. `.pin.me` and `.pin.place` are not stations: 48px, `--me` and `--accent` from
  another part of the palette, and white on either fails. So the map draws discs for stations and
  bare glyphs for the two marks that are not one.
  **`stroke="none"` on the `<use>` is load-bearing.** `.pinglyph` strokes every path in `--surface`
  for the bare form and that rule inherits through the `<use>` shadow tree. Left on, a white glyph
  inside a disc wears a white outline and thickens into a blob.
  **The pin takes a THIRD block of the six kinds, at lightness 0.690.** A white knockout needs the
  fill dark enough to read: the dark theme's 0.760 measures 1.9:1 and 0.690 measures 2.6 to 2.9. The
  `.pin` block in `css/base.css` states the six and **nothing else** — every other token a pin
  resolves still comes from the shared block above it, and source order is the whole of what makes
  the override win.
  **The alert amber flips its ink to black, and it is the only fill that does.** White on `--s-alert`
  is 1.64:1 against 12.79:1 for black. It cannot be darkened to suit a knockout, because a status
  colour IS its brightness. `DARK_INK_FILL` in `js/config.js` holds the list, the measurement for
  every fill a pin can wear, and the reason it is a list rather than a calculation: `render.js`
  compares a `var()` string and there is no hex to measure. **Re-measure and edit that list whenever
  a token in the status ramp moves.** A pin whose glyph disappears is silent.
  **The Help legend draws the disc in CSS and the map draws it in SVG, so the two are checked by
  eye.** Those samples are static markup holding a masked `<i>`, and there is no sprite to `<use>`
  until `pinGlyph()` has run once. `.docbox .pins .pin` in `css/chrome.css` converts the SVG's own
  numbers: a 35-of-40 circle on a 1em box is 31.5px, and its 2.5 unit edge is 2.25px. The samples
  carry `inkdark` by hand on every amber one.
- **FOUR MARK SHAPES ON THE MAP, AND EACH IS SIZED AGAINST THE STATION DISC.** The repository owner
  set all four on 2026-08-26. The disc is the ruler: `.pin`'s 36px font at `scale(.7)` is 25.2px, its
  circle is 35 of 40 viewBox units of that (**22.1px**), and the glyph knocked out of it is 24 of 40
  (**15.1px**).
  | mark | shape | size |
  |---|---|---|
  | a station | disc, glyph knocked out | 22.1px circle |
  | a weather point | bare glyph, `.pin.wx` | 21.9px |
  | the selected pin | bare teardrop, `.pin.sel` | **32px** |
  | you are here | solid dot, no glyph | 14px plus a 2px ring |
  | a searched place | bare teardrop, `.pin.place` | **42px** |
  **THE WHOLE SET CAME DOWN 12.5% LATER THE SAME DAY, on the repository owner's own reading of the
  map: "getting busy".** A station pin became a filled disc that day, and a disc carries far more ink
  than the bare glyph the old `scale(.8)` was measured against. So the set was sized for a mark that
  no longer existed.
  **`scale(.8)` went to `scale(.7)` and that is ONE line for two of the five rows.** `.pin.wx` is a
  plain `.pin` box, so it is inside the same `:not()` list and the scale already takes it. Editing
  `.pin.wx`'s own 31.25px as well would take a weather pin down twice.
  **A scale is the only knob here that needs no anchor arithmetic.** It leaves the 39px layout box
  alone, and that box is what `iconSize` repeats in `render.js` and `wx.js`. That is the whole reason
  it is a transform rather than a smaller font.
  **The other three each state their own size AND their own anchor, and both halves have to move.**
  `.pin.me` is a dot anchored at its centre, so only the dot's width moves. The two teardrops are
  anchored at the tip, so each takes `box x 0.9167` — see the entry below.
  **`.pin.place` is no longer the odd one out.** It was left at 48px when the selected pin came down
  to 36, and this file recorded that as a live inconsistency. It came down with the rest, so the two
  teardrops match again.
  **A fractional anchor is CORRECT and must not be rounded.** 32 x 0.9167 is 29.3 and 42 x 0.9167 is
  38.5. Leaflet takes a fractional pixel. Rounding one to keep the number tidy is the same silent 2px
  error the entry below records.
  **`markSel()` builds its icon fresh now, and it used to patch the station's html twice.** That
  worked while a station pin was a bare glyph: swap the class, re-point the `<use>` at the teardrop.
  A station pin is a disc, so re-pointing the `<use>` left a teardrop cut out of a coloured disc.
  Only `--c` is carried over, which is what keeps a station at danger red while its card is open.
  **THE TIP IS AT 11/12 OF THE BOX, NOT AT THE FOOT OF IT.** `--i-place` does not paint to the bottom
  of its own viewBox: measured with `getBBox()`, the path ends at 33 of a 36px box, which is 0.9167.
  The old `[24, 44]` on a 48px box encoded exactly that ratio. A rewrite to 25px used `[12.5, 25]`
  and put every selected mark 2px above its station. **So the anchor is `box x 0.9167`, and it moves
  whenever `.pin.sel`'s size does.** A wrong anchor here is silent: the mark still draws, it just
  stops pointing at the station it names.
  **The selected pin is the one exception to the one-size rule**, at 32px rather than the disc's 22.
  Every other mark is sized to the disc so the set reads at one size. This one is deliberately half
  again bigger, because its whole job is to pick one station out of the four hundred around it.
  **THE CLUSTER BADGE FOLLOWS THE SET, and it is the one mark the scale cannot reach.** That rule
  names `.pin` and a cluster is a `.cluster`, so its size is a literal in two places rather than a
  transform: `.cluster` in `css/map.css` and `iconSize` in `js/map.js`. **Edit both by hand whenever
  the set moves**, or the badge stops sitting over the pins it is hiding. It is 21px in a 22px box.
  **The TYPE came down with the box and the EDGES did not.** 11px overflows a 21px chip: `434`, the
  widest count this network can produce, measures about 19.5px at 11 against the 19px of inner width
  the border leaves. 10px measures about 17.8px and fits. The 1px border and the 2px danger ring
  stay, because an edge here is a screen pixel rather than a fraction of a mark — the same rule
  `pinGlyph()` states from the other side with `vector-effect: non-scaling-stroke`.
  **The Help legend's own `.cluster` override is DELETED.** It drew 28px and said it was scaling the
  chip down to sit in a text column. The map's chip passed under it, so that rule had inverted: it
  scaled the sample up by a third, and the legend disagreed with the map about the one mark it exists
  to keep honest. The `.pin` samples never had this problem, because the `:not()` rule reaches them.
- **"YOU ARE HERE" IS A GREEN DOT WITH NO GLYPH, and it was an amber crosshair.** The repository
  owner asked for both on 2026-08-26. `locate.js` emits an empty `<span class="pin me">` and
  `.pin.me::before` draws the dot, so there is no glyph to size and no sprite to build.
  **The box stays 48px and only the dot shrinks.** Leaflet gets `iconSize [48, 48]` anchored at its
  centre and `.pin` is a centring grid, so the dot lands on the fix with no second number to keep in
  step. Shrinking the box would put the dot in the divIcon's top-left corner, 15px off the fix.
  **`--me` is `#00950d` and it was searched, not picked.** It maximises the closest distance to
  everything that shares the map: worst is 14.8, against the several-sensors olive. **L 0.58 is the
  only rung clearing 3:1 on BOTH basemaps** — 3.51 on the light tile, 3.58 on the dark — and every
  lighter green falls under 3:1 on the pale one. It is one value on both themes now, because a pin
  is one palette.
  **It is 22.3 from `--s-normal`, and that collision is not on the map.** No pin wears the normal
  green since the three-colour rule gave a quiet sensor its own kind colour. `--s-normal` draws on a
  card chip and a table pill, where this dot never appears. Re-measure if that changes.
  The old entry above this one describes a house in a pin and a crosshair. Both are gone. What
  separates this mark from a station is three things, and colour is the smallest: it is solid where
  every station is a disc with a shape cut out of it, it is two thirds the size, and it sits inside
  a translucent accuracy circle no station has.
- **Both glyphs on a map pin carry an explicit `z-index`, and the painting order alone did not hold
  them.** `.pin` draws the station mark and, on a favorited place, a heart badge over its bottom-right
  corner. The heart is the last child *and* it is positioned. So CSS2.1 painting order puts it at
  step 7, and the unpositioned station `<svg>` at step 3. The heart cannot be underneath, and it
  was, on every favorited pin. `.pin > .pinglyph` now takes `position: relative; z-index: 0` and
  `.pin .fv` takes 2. **The `position` is not decoration.** An unpositioned box cannot take a
  `z-index` at all. So the station mark had to be positioned before anything can push it down a rung.
  Do not delete either declaration as redundant on the strength of the spec. It reads redundant and
  is not. Two other explanations were chased first and both are wrong. A `filter` on `.pin` creates a
  containing block but not a z-order change. The heart's own `drop-shadow` is about lifting it
  off the glyph, not about which one paints first.
- **There is no icon font any more, and there must not be one again.** Icons are SVG masks in
  `css/icons.css` (`<i class="i i-warning">`, or `--i: var(--i-warning)` on a pseudo-element).
  A ligature font renders *text* that only becomes a picture if shaping cooperates. So a stray
  `text-transform`, a glyph missing from the subset, or one stale cached subset put the raw word on
  screen. That happened three times, with three different triggers. Adding an icon is one rule in
  `icons.css`. There is no binary to refetch and no `?v=` to bump.
- **The service worker must never cache a reading.** `sw.js` deliberately returns without calling
  `respondWith()` for `api.php` and `api.json`, so those requests behave as if no worker existed.
  The splash refuses to draw a map with no connection. A stale water level during a flood is
  worse than none. A worker answering from cache defeats that from a layer the page cannot see.
  It is network-first for everything else too, so a `?v=` bump is still the only cache ritual.
  **Do not "optimise" it to cache-first.** An edit then goes live for nobody until a cache name moves.
- **The app icons are transparent, so `purpose` must stay `any` — never `any maskable`.** A maskable
  icon is required to be opaque edge to edge. Declaring a transparent one maskable hands the
  platform a background of its own choosing. That destroys the reason it is transparent. Same
  chain. `background_color` is white because it is the *splash* colour, and a blue glyph on a blue
  splash is invisible. The glyph is blue rather than white. With no plate it lands on a
  tab strip, a wallpaper and a launcher. White survives only some of those.
- **Do not add `mobile-web-app-capable` — or put `apple-mobile-web-app-capable` back.** Chrome's
  console deprecates the Apple tag and suggests the unprefixed one. Both are the pre-manifest way of
  asking for standalone. `display: standalone` in `manifest.json` covers it since iOS 11.3.
  The suggested tag is a second legacy mechanism for something already declared. The
  only thing still tied to the Apple tag is `apple-touch-startup-image`. If iOS splash screens are
  ever wanted, that tag comes back *with* them and not before.
- **iOS has its own icon, `icon-180.png`, and needs it.** Safari does not honour alpha on a
  home-screen icon. It flattens it onto a colour of its own choosing, historically black. That is the
  exact plate that was deliberately removed. So `apple-touch-icon` points at an opaque white tile
  with a smaller glyph. iOS rounds the corners itself. The squircle bites anything near the edge.
  The favicon and the manifest keep the transparent pair. **Do not point `apple-touch-icon` back at
  `icon-192.png`.** It looks right in every browser you can test locally, and black on a phone.
- **The icon badge follows the app bar's alert count and nothing else.** `navigator.setAppBadge()` in
  `alerts()`, on `live`. That is the same number the panel's warning glyph is coloured by. The
  district filter and `PREFS.ignored` are already applied, and stale stations are excluded. Never
  badge `hot`: stations we can no longer read are a maintenance problem, not a flood. It deliberately
  does **not** request notification permission. iOS needs it and simply goes without. A prompt on
  landing is the trust-spending the alert standard warns about, for a number already on screen. The
  badge is not an alert channel. Anything that wants to make it one goes through the alert design
  standard first.
- **The PWA paths are all relative** (`start_url: "."`, `new URL('../sw.js', import.meta.url)`). The
  same files serve from the root of a Herd host *and* a GitHub Pages sub-path. An absolute `/sw.js`
  is a 404 on one of the two. A worker that fails to register quietly removes the install button.
- **The manifest is `manifest.json`, not `.webmanifest`.** Herd types an unknown extension
  `application/octet-stream`. The correct type has to be added to every web server this ever
  runs behind. `.json` is right everywhere already, and no browser cares about the name.
- **Herd serves `index.html` with HTTP 200 for missing files.** A mistyped asset path is *not* a 404.
  So "everything returns 200" proves nothing. Check `%{content_type}` instead. This is why a
  missing `js/*.js` shows up as a module parse error in the console rather than a failed request.
- **A multi-click gesture needs `user-select: none` on everything it touches.** The browser counts
clicks whatever you do with them. So the third of any fast burst is a triple-click, and it
  selects. The About egg is opened by seven fast clicks and then ignores clicks for 1.5s. So people
  keep clicking, and the selection wash rendered the picture blue. Both `#aboutBox .logo` and
  `#eggBox` carry the rule. Anything else driven by repeated clicks will need it too.
- **Nothing optional can fail the Pages bake.** `img/` holds one decoration and can be
  absent. So the staging step copies it with `[ -d img ] && cp -r img site/ || true`. An unconditional
  `cp` of a missing directory fails the step. A failed bake keeps the *last* deployment. So the
  map sits on stale readings because an easter egg was absent. Same rule for anything added to
  that `cp` line. If it can go missing, it must not be able to stop the map updating. Under Herd the
  same missing file is invisible (see above), so this only ever shows up in CI.
- **A `<dialog>`'s `display` goes on `[open]`, and a popover's on `:popover-open` — never on the
  element.** The browser closes a dialog
  with `dialog:not([open]) { display: none }` in its own stylesheet, and any author rule setting
  `display` beats it. `#dataBox { display: flex }` therefore laid the closed table dialog out on the
  page. That is 450 rows, in the tab order and read by screen readers. It was invisible only because
  `#map` is absolutely positioned and painted over it. It surfaced through the map whenever a tile
  was missing. That read as a Leaflet zoom bug, and was chased as one. `#dataBox[open]`,
  `#lightbox[open]` and `.sparktip:popover-open` are the pattern. The same trap caught a plain
  `[hidden]` attribute too. `.link { display: flex }` in `base.css` beats the browser's own
  `[hidden] { display: none }`. So the Developer section's "Refresh now" button needed a
  `display: none` rule of its own to actually disappear. That button is hidden on the GitHub Pages
  build, where the query it needs does nothing. `js/ui.js` hides its whole `<li>` now, which is a
  plain `<li>` with no author `display`, so the trap does not reach it.
- **Every `<dialog>` in this app is one of three kinds, and a bare `.modalhead` selector broke two
  of them.** `#dataBox`, `#camBox` and the two `.docbox` panes are **full-screen** below 600px and
  **basic** above it. `#lightbox` and `#warnBox` are **basic at every width**. `#eggBox` and
  `#narrowBox` are **exempt**, and each names its reason where it is defined: one is a picture with
  no chrome at all, and the other is a blocking state screen with no way out on purpose.
  The full-screen header rules were written as bare `.modalhead` inside the phone media query. So
  they also reached the two basic dialogs, and each one drew its close button on the leading edge of
  a 56px bar while the box around it stayed a floating card with a 12px corner and a scrim. **A
  full-screen header on a basic container reads as a fault in the header and is a fault in the
  selector.** Those rules name `#dataBox .modalhead, #camBox .modalhead, .docbox .modalhead` now.
  **The two basic ones must not become full-screen, and M3 is why.** That variant is for a task with
  a series of steps, keyboard input, or a box that opens another dialog. A camera still and a
  warning read are neither. The four that did convert each carry a filter field or a document.
  **`m3-check.html` holds the roll call, and the roll call is the point.** It reads every `<dialog>`
  out of the document and fails on any id the table does not name, and on any name the document no
  longer holds. Nothing caught the fault above, because nothing knew those two dialogs existed. A
  new dialog now needs a decision rather than a default.
- **`#warnBox`'s icon sits ABOVE its headline, which is M3's basic dialog anatomy order.** Icon is
  item 2 and headline is item 3, in a column. It was inline before the headline for a long time, and
  the bare `.modalhead` rule then reversed the row and pushed it past the title to the trailing edge.
  Left-aligned rather than centred: M3 marks centring a prop rather than the default, and every other
  dialog here leads its header on the same edge. `js/ui.js` writes the glyph and its colour by id, so
  moving the element in the markup needed nothing there.
  **`headline-small` is 24px and only one of the two basic dialogs takes it.** `#warnBox` holds a
  fixed short title. `#lightbox` holds a camera's name and its district on two lines, and it wraps
  rather than truncating. M3's own rule about a long or variable headline applies: at 24px on a 360px
  screen that name takes two 32px lines before the picture starts.
- **A browser's own stylesheet caps every `<dialog>`, and it silently ate one breakpoint band.**
  The UA sheet carries `dialog { max-width: calc(100% - 6px - 2em); max-height: calc(100% - 6px - 2em) }`.
  `#dataBox` and `#camBox` set `width` and `height` rather than `max-*`, so that cap still applies
  over the top of them. At a 14px font 2em is 28, so the cap is `100% - 34px`. It clamped a 668px
  pane to 666 in a 700px window, and the medium band's 16px inset silently became 17. **It bites in
  the medium band alone**, because the cap is wider than the pane at every band above it, which is
  the worst shape for something to be wrong in: three of four bands look right. `max-width: none`
  and `max-height: none` on those two clear it. `.docbox` never had the problem, because it sets
  `max-width` itself and an author rule beats a UA one. **It keeps the UA `max-height` on purpose,
  and that cap is what gives `.docbody` a height to scroll inside.** A pane free to grow has no
  overflow, so its body never scrolls and long prose simply runs off the screen.
  **`#warnBox` takes the same cap and needed the same body.** It had none, so a MET bulletin of
  about 1,800 characters ran out of the bottom of the dialog with no way to reach the end. `#warnBody`
  is `flex: 1; overflow: auto` now, and the icon and the headline above it are `flex: none`.
- **The four dialogs sit on a four-band ladder, and three variables carry it, not twelve rules.**
  `--dlg-inset` is the gap to the window edge, `--dlg-wide` caps the table and `--dlg-prose` caps
  the two prose panes. M3's window size classes name the bands: compact under 600, medium to 839,
  expanded to 1199, large above. **The medium band exists to fix a jump.** Before it, a dialog
  crossed out of the full-screen variant at 601px straight into its desktop shape, and that shape
  measured 577px. The camera wall takes no cap at any width, which is a decision this file already
  carries above: more room is strictly better for a wall of ninety pictures.
  Two parts of M3's basic dialog are declined on purpose. `surface-container-high`, because this app
  holds one surface tone in `css/base.css` and a second tone five percent off the first is invisible
  over a scrim and is a colour invented outside that file. And elevation `level3`, because
  `--shadow` is this app's one elevation and every dialog already carries it.
- **A sticky header inside a padded scroller pins to the PADDING box, not to the top, so `top: 0`
  is wrong there.** A sticky box is held inside its scrollport, and a scroller's scrollport is its
  padding box. So a bar with `top: 0` in a scroller padded 20px stops 20px down, and the content
  scrolls through the gap above it. It looks almost right, which is why it shipped twice in one
  change. **`top` is the negative of that padding**, and the negative margin beside it is a different
  job. That one takes the bar full bleed across the pane's padding and puts its static position at
  the top of the border box. Neither one substitutes for the other.
  **THERE IS NO STICKY HEADER LEFT IN THIS APP, and the entry stays as the trap it names.** The
  three `.docbox` panes carried one for a revision, at `top: calc(-1 * var(--pane))` and four
  negative margins. A reader asked for the scrollbar to sit inside the pane and under the header on
  2026-08-25, and a sticky bar cannot answer that. A dialog that scrolls ITSELF runs its scrollbar
  the full height of the box and past the bar, whatever the bar is pinned by.
  **So every dialog here is now a flex column: the header is `flex: none` and one body scrolls.**
  `.docbody` is that body in the three prose panes. `table.data` is it in the table and `#camGrid`
  in the camera wall, and those two always were. The dialog itself takes `overflow: hidden`.
  **A structural seam has no offset to drift**, which retires the four negative margins and the
  variable that kept them honest. `--pane` still states the padding once, and the header and the
  body both read it back.
  **Assert that the header does not MOVE, never that it sits on a particular pixel**, and cap the
  BODY rather than the dialog when there is nothing to scroll. Capping the dialog makes the dialog
  the scroller, and a static header then travels with it. That is a fault the cap invented, measured
  at 12px on `#dataBox` and 75px on `#camBox`.
- **Below 600px FOUR surfaces are M3 full-screen dialogs, and none of them needs a `z-index`.**
  `showModal()` puts a dialog in the top layer, which is not part of any stacking context. That is
  also what makes M3's own rule work here — a full-screen dialog is the only dialog another dialog
  can open over.
  **The two panels are not among them.** They are M3 sheets: side sheets above 600px, modal bottom
  sheets below it. A full-screen dialog is M3's answer for a TASK — a form with steps, keyboard
  input, a box that opens another box. A panel that reports on the map behind it is a sheet, and a
  sheet keeps that map in view. The four that stayed dialogs each carry a filter field or a
  document.
  **The two panels get an enter AND an exit, and the four dialogs get an enter alone.** A body class
  leaves a closed state to transition from. `showModal()` flips `display`, so a keyframe on `[open]`
  is all there is to start from, the same shape `#eggBox` uses, and a dialog still leaves instantly.
  `@starting-style` with `allow-discrete` on `overlay` buys that exit. It also risks the dialog
  leaving the top layer before the animation ends, which draws the exit behind the page.
  **The motion comes from M3's own component spec, and two tokens in `css/base.css` hold it.**
  **They are named for what a surface DOES, never for one component that does it.** `--m3-travel` is
  a surface that moves in from an edge, at `duration-short2` (300ms) on `easing-emphasized`
  (`cubic-bezier(.2, 0, 0, 1)`). The full-screen dialog takes it with `translateY(100%)`, and so does
  the layer bottom sheet. `--m3-grow` is a surface that grows in place, which is the basic dialog:
  `opacity: 0` with `scale(.95)`, at `duration-extra-short4` (200ms). M3 names three easings across
  those components and its own table gives all three the same curve, so the duration is the whole of
  the difference. The reference is the M3
  Expressive component set's `dialog.css`, which cites `m3.material.io/components/dialogs/specs`.
  **A clip-path collapse along the y axis stood here first and it was wrong.** The argument for it
  was M3's transitions page, which files a dialog under enter and exit *within* screen bounds and
  avoids anything implying an elevation change. That page describes the basic dialog. The component
  spec for the full-screen variant says translate. **A component spec beats a generalisation about
  its family.** The basic dialog still gets the within-bounds treatment, which is the half that
  argument was right about.
- **A popover inherits ten declarations from the UA sheet, and `height: fit-content` is the one that
  gets forgotten.** `.menu` restates `position`, `inset`, `margin`, `padding`, `overflow`, `border`
  and the colors, and left the height alone. WebKit reads `fit-content` on the block axis of an
  out-of-flow box as the space available under `top`. It does not read it as the content height. So
  `#appMenu` measured one viewport tall on iOS Safari. A grid with a definite height stretches its
  rows to fill. That drew its four tiles and its theme row spread down the whole screen. Chrome and
  Firefox drew the same markup at 157px. `.menu` carries `height: auto` now, which changes nothing on
  the engines that were already right. **Do not reach for `align-content: start`.** It closes the gaps
  and keeps the full-height box. So an invisible panel goes on swallowing taps over the map.
- **There is no map popup any more, and there must not be one again.** Station detail is `#side`, a
  fixed panel on the right edge of the viewport, filled by `openSide(key, html, mastAt)` in `map.js`.
  A Leaflet popup needed four things, and all four existed because the card was anchored to a marker.
  `autoPan` raced `setView`'s animation. `openStable()` re-opened what a zoom had torn down.
  `cluster.zoomToShowLayer()` waited for a marker to have a DOM node at all. A `keepPopupVisible()`
  nudged the view on phones. The panel is a page element: nothing to pan into view, nothing to
  destroy. Anything that wants to *show a station* calls `flashTo()`, which fires the marker's own
  click. Anything that wants to show something else calls `openSide()` with a key starting `@`
  (see locate.js). That keeps `render()`'s refresh pass off it.
  **The name chip `flashTo()` leaves over the ripple is not a popup either.** `ping()` draws it
  inside its own throwaway marker, which is `interactive: false` and removed after `FLASH_MS`.
  Nothing anchors it to a station's pin, and nothing outlives the flash. It exists because the panel
  is fixed to the right edge while the map moves under it. So the card's title carries `data-go`
  (`goName()` in `popup.js`) as the way back to the pin. A bare ring says "here" without saying
  what "here" is. Anything that wants a *persistent* label on the map is the thing this rule forbids.
- **Both headers in the pane are M3's MEDIUM FLEXIBLE top app bar, and each was something else
  before.** `#sideHead` was the side sheet header, 64px with a `title-large` title on the icons' own
  row. A reader asked for one headline across the pane, at `headline-medium`, on 2026-08-21. So it
  takes one component at both widths. The numbers are `AppBar/app-bar.css`'s own:

      112px container, in two rows
      top row     min-height 56px, padding 8px 4px 0, align-items flex-start, a flex: 1 spacer
      label block min-height 56px, padding 0 16px 12px, bottom aligned, gap 4px
      headline    headline-medium, 28px on 36px
      supporting  body-medium, 14px on 20px at weight 500, in on-surface-variant

  **`__flex-content` and `__label-block` are one box here.** The reference nests them and cancels the
  inner one's inline padding. Nothing else sits in the outer box, so this states one set of numbers.
  **`min-height`, not `height`, because the headline wraps.** The reference truncates with an
  ellipsis. This app does not, and that rule is older: a station name cut in half names another
  station. M3 Expressive states a two-line form for this variant, so a grown bar stays in the family.
- **The card arrives as one string and FIVE pieces of it move.** `openSide()` takes the `.popname`
  into `#sideTitle`, the `.near`, the `.fav`, the `.dots` and the popover it targets into
  `#sideActions`, the region line into `#sideSub`, and the sensor badges into `#sideKinds`.
  **That selector is a fixed list of classes, and one it does not name simply stays in the body.**
  `.pophead` is then removed as empty, so the control disappears with nothing on screen to say it
  existed. `querySelectorAll` answers in DOCUMENT order, so the order of the row comes from `dots()`
  and the selector cannot restore it.
  **The region line moved up on the same instruction, and that reverses an entry.** It stayed in the
  body because M3 puts supporting content there. That is the SIDE SHEET's rule. An app bar states a
  headline and an optional line under it, and this line always was that: `Shah Alam, Selangor` under
  a station name, the accuracy radius under "Your Location", the point and its distance under a
  weather place.
  **The kind chips followed on 2026-08-21, for the same reason and one more.** They answer `what is
  this place`, which is the question the headline and the region line answer. So the three read as
  one block. On a five-sensor mast they used to sit under a region line the reader scrolled away
  from. `#sideKinds` is the app bar's second supporting line.
  **One chip per KIND, never one per sensor, and `kindChips()` in `popup.js` is the one rule.** The
  row drew one badge per member. So a place carrying two sirens drew the word `Siren` twice, which
  reads as a rendering fault rather than as two sirens. A repeated kind takes a multiplier instead,
  `Siren ×2`, and each kind states itself once. Measured on the live payload: 188 sites hold more
  than one sensor, and **73 of them carried a repeated word**.
  **A lone sensor of its kind carries no `×1`.** The count is worth printing only where it is not
  the obvious one.
  **A `Map`, because it keeps insertion order.** That order is the rank `render.js` gave the
  members, so sorting the kinds here moves the lead sensor's chip off the front.
  **The colour folds with OR, never off the first member.** Grey is this app's no-reading tone. A
  chip covering one reporting siren and one silent one sits over a place that reports, so it keeps
  the kind hue. It goes grey only where none of them reports. A station with no reading must never
  look confident, and a station with one must not look dead.
  **They are M3 assist chips there, and they were `.badge` pills.** A 32dp container,
  `shape-corner-small`, a 1dp outline, `label-large` and an 18dp leading icon. **The colour splits
  the way M3 splits it.** The label takes `on-surface` and the leading icon takes the accent role,
  which here is the station kind's own hue. A chip whose TEXT is painted by the kind reads as a
  status, and this app reserves that reading.
  **THE ALERT PANEL JOINED THIS RULE ON 2026-08-25, on a reader's instruction.** The selector is
  `#sideKinds .badge, .alert .badge`, one rule and not a second copy of the numbers. Every alert
  group heads itself with the kind it holds, and that is the same claim `#sideKinds` makes about a
  place. `.badge` is still untouched in the all-stations table, which is a dense grid rather than a
  pane, and a 32dp chip in a table cell is a row height.
  **THE CELLS TOOK CHIPS FOR ONE REVISION, AND CAME BACK ON 2026-08-26.** The chip's label
  carried the reading, and its 18dp leading glyph carried the status hue. So the status word left
  the cell. A river cell kept its meter and gained a chip. It then ran to about 84px, against about
  53px for every other kind. So about one row in four ran tall. The repository owner looked at it
  and reverted it the same day.
  **THE MEASUREMENT THAT CONDEMNED IT IS THE ONE THIS RULE ALREADY STATED.** A chip in a table cell
  is a row height.
  **It is `:scope > .muted`, never `.muted`.** The alert list writes `· nearest first` INSIDE its own
  `.popname`. A descendant search lifts that fragment out of the title it belongs to.
  **Every card then leaves `.pophead` empty, so `openSide()` removes it.** An empty seam
  still draws its own 16px of bottom margin over the first reading. `:empty` cannot see it, because
  the template leaves whitespace text nodes behind. The test is `!head.firstElementChild`.
  **So the first `.sensor` leads the body, and its own 8px is what clears the app bar.** That number
  is the gap between two cards as well. `m3-check.html` asserts the arithmetic rather than the 20 it
  comes to, since there is no sibling left to measure the first card against.
  **The × is a flex item in that row.** It used to float over the card's top-right corner, and
  three numbers in `css/map.css` existed to work around it: the name was padded clear of it and the
  ⋮ was placed against it. A header row places all three by itself and those numbers are gone.
  **`.pophead` is still the seam and still the card's first element.** Only the slice taken from it
  changed. Anything that reshapes `sitePopup()` has to keep `.popname` inside `.pophead`, or the
  header empties and the name buries itself in the body — a fault nothing else in this app notices.
  `m3-check.html` drives the real `openSide()` and asserts the distribution for that reason.
  Its old shape, kept because it explains the constraint: `openSide()` moved the whole `.pophead`
  into `#sideHead`, which is not inside anything that scrolls.
  `.pophead` was the place name, the region and one badge per sensor. `position: sticky` on it was
  tried first, and is one line rather than three. A header that stays put only while nothing defeats
  sticky is a header that can come loose. This one has no scroll to come loose from. **Anything that
  reshapes `sitePopup()` must keep `.pophead` as its first element** — that is the seam.
- **Three numbers used to put the place name on the close button's line, and all three are gone.**
  `#sideClose` took `top: 8px`, `#sideHead .pophead` took `padding-top: 18px` and `.pophead > .dots`
  took `top: 8px`, and each was derived from the others. They existed because the close button
  floated over the card's corner. `#side` is an M3 side sheet now and its header is a flex row, so
  the three controls place themselves. **The arithmetic survives in `css/map.css` for the surfaces
  that still float a button**: the table's hover panel and every map card. `#sideBody .pophead`
  cancels it, because nothing floats there any more.
  **That ⓘ takes the full `.icon` box, not `.dots`'s 28px one.** It stands beside the ×, and `.icon`
  paints a round `--hover` disc the width of its box. So the smaller shape drew two discs of two
  sizes, under two glyphs of two sizes. `.dots` stays 28px everywhere it
  is alone on a row. `right: 32px` puts the two boxes edge to edge, the way two toolbar icons meet.
  **The trailing actions hold three controls: the nearest webcam or water level, the favorite, then
  the ⋮.** The heart has been round this loop three times, and the offer four. A sensor-count chip
  held the slot first. Then the heart. Then the heart and a nearest-webcam glyph together, and that
  pair reserved `padding-right: 108px` of a 328px line and stood 4.5px into the district line below.
  So every control became a row inside the one menu. A reader pulled the heart back out on
  2026-08-21 and the offer back out on 2026-08-26.
  **The header is an M3 top app bar now, and that answers the objection rather than ignores it.** The
  actions have a 56px row of their own. They take nothing from the headline under them, so the 108px
  reservation that condemned the pair does not exist any more.
  **THE WEBCAM OFFER IS A BUTTON AGAIN, AND THIS REVERSES THE ENTRY THAT KEPT IT A ROW.** That entry
  said a row states a station name, a distance and a reading in visible text, and a glyph can only
  put those in a `title`, which never opens on touch. **The premise about `title` is right and the
  conclusion was wrong.** `data-tip` is not a `title`. `js/sparktip.js` answers it on tap as well as
  on hover, and the favorite beside it already reaches its words that way.
  **The reading is a word in that tip and never the glyph's ink.** The row painted the level with
  `color()`, because 1.74 m is either a quiet river or a flood and the mark is not on the row. An app
  bar action painted by a status makes a status claim about a station the card is not about. So the
  number goes to the station card the button jumps to, where the meter states it properly.
  **With nothing inside the cap the button still draws, and it takes `aria-disabled` rather than the
  `disabled` ATTRIBUTE.** A disabled button fires no pointer event in Chrome, so its `data-tip` never
  opens and the one thing it has to say is unreachable. It carries no `data-cam` and no `data-go`
  either, and both jumps are delegated on those. So there is nothing for a press to reach and nothing
  to disable.
  **THE TIP TAKES TWO LINES, and a newline in `data-tip` is the whole of it.** What the button IS
  leads and what it found follows: `Nearest webcam` over `KG BARU · 2.1 km`. That is the split the
  menu row made with a `<small class="muted">` second line, and it is why the row read as well as it
  did. `js/sparktip.js` writes the label with `textContent`, so a newline is the only break available
  and no caller can build markup.
  **`.sparktip` takes `white-space: pre` for it, never `pre-line` and never `nowrap`.** `nowrap`
  swallows the newline and the tip runs on one long line, which looks deliberate. `pre-line` honours
  it and also lets any long tip wrap wherever it likes. `pre` honours the break and still never wraps
  on its own, which is the half `nowrap` was there for. A tip with no newline is unchanged, so every
  graph readout is untouched. `text-align: center` is inert on those and stops a ragged second line
  under a 40px glyph.
  **The `aria-label` keeps ONE line, joined with a stop.** A screen reader announces a newline as a
  pause with no punctuation, so the two halves run together as one phrase.
  **A sensor's inline ⋮ keeps the favorite as a row.** `dots(s, extra, lift)` takes `lift` only from
  the card header. Six hearts down a six-sensor mast is six controls for what the header already
  offers once, and the per-sensor favorite is what lets somebody star one gauge of six.
  A mast's header gets `siteDots()`, whose heart acts on every sensor there.
  The map pin still draws a heart on a favorited site.
  **The reservation is `~`, not `+`**: `dots()` emits the button *and* the popover it targets, so the
  menu div sits between the button and `.popname`. **The region line takes the same 78px as the
  name.** It is a line lower. But a 40px button reaches 48px down, and the region starts at 37.5.
  **A menu row's `[data-fav]` can hold a comma list.** So anything reading it back tests every id
  (see the still-open branch in ui.js). `ids.has('a,b,c')` is false forever.
- **An equal split is EQUALITY, and a flat `50vw` is not it.** `--gap` (16) and `--seam` (8) both
  come out of the MAP, so a pane at half the window left the map 24px short of half. The main pane
  was the smaller of the two right across the medium band. Measured at 839px: a 420px pane against a
  396px map. `--pane` is `calc(50vw - 12px)` there, which is half of those 24 put back in the middle.
  **A share assertion cannot see this fault**, and `m3-check.html` held one for a while: 50% of the
  window is exactly what the pane was taking while the split was wrong. It asserts `pane == map` now.
- **The 30% ratio needs a floor, and 840px is where that shows.** M3 gives the supporting pane 30%
  from 840 up. That is 252px there, under M3's own 256dp minimum for this surface, and it arrives as
  a 168px COLLAPSE off the 420 the band below ends on. The whole 840 to 1199 range sits under 360,
  which is the width a camera still needs and the number `--pane`'s own comment already carries.
  Every landscape tablet lands in it: 307px at 1024, 334 at 1112, 354 at 1180.
  `max(360px, 30vw)` floors it, and the ratio takes over at 1200 where 30vw passes 360 on its own.
  **No cap at the top.** 30vw is 576px at 1920, past M3's 400dp side-sheet band. That band is written
  for a sheet over content, and this is a canonical layout's supporting pane.
  **Measure this by rendering the app across the range, never by reading the rule.** The sweep that
  found both faults set the frame to 18 widths and read `#pane` and `#map` back. Switch transitions
  off in the frame first: `#map`'s `right` animates for 300ms, so a shorter wait reads a map that is
  still moving and the two widths do not add up to the window.
- **The map card has TWO insets and they are not interchangeable.** `--gap` (16px) holds it off the
  window on the leading, top and bottom edges. `--seam` (8px) is the space between it and the
  supporting pane, on the trailing edge alone. That is M3's own pair: a margin holds content off the
  window and a spacer separates one pane from the next. This app read them as one number for a
  revision, and a reader cut the spacer alone. **M3 puts the spacer at 24dp, wider than the margin,
  and this goes the other way.** The map is what this app draws, and the pane is the only thing
  taking width from it.
  The map's trailing inset is therefore `--pane-w` PLUS `--seam`, and a box measuring from the map's
  own edge picks up ONE of them and never two. `m3-check.html` got that wrong first: the zoom control
  sits 10px inside the card, which is `360 + seam + 10` from the window and not
  `360 + seam + 10 + seam`.
- **Every furniture box adds the card's inset as well as `--pane-w`, and WHICH inset depends on the
  edge.** A box measuring from the trailing edge measures across the space between the two panes, so
  it takes `--seam`. Every other edge takes `--gap`. `#toast` needs both, one per axis. Leaflet's own
  controls live inside the map container and get it free. A box that misses the term sits on the page
  beside the card rather than on the map, which reads as a spacing mistake rather than as a missing
  term.
- **One motion changes what the supporting pane holds, and two events read it.** `--m3-swap` is
  220ms on `easing-emphasized`. It slides the arriving surface 14px in from the trailing edge and
  fades it. A station swapped for another inside `#side` takes it through `sideSwap`. An occupant
  swapped for another inside `#pane` takes it through a transition on `#side` and `#findpane`. One token
  feeds both, so the two cannot drift.
  **This reverses M3's fade through, on a reader's instruction, 2026-08-21.** That pattern fades the
  outgoing surface over the first 30% of 300ms. It then fades and scales the incoming one from 92%
  over the rest. M3 names it for peer destinations that share a container. The station card, the
  weather card and the filters are exactly that, so the reading of the spec was right.
  **Two motions in one box read as two events, and the pane is one box.** A reader met the occupant
  swap beside the station swap and named the station swap. `m3-check.html` asserts the numbers on
  each event, and then asserts the two events against each other.
- **The occupant exit is instant, and that is the station swap's own behavior.** A station swap
  replaces the card with `innerHTML`, and the new card fades in from nothing. So an outgoing occupant
  simply stops drawing. `display` needs no transition and no `allow-discrete` to survive one. Both of
  those went with the fade through, which needed them for its own 90ms outgoing half.
- **The occupants are `position: absolute; inset: 0`, and the swap is why.** They were `flex: 1`
  children of a column, so two visible at once split the pane's height between them. The arriving
  occupant has to be in place before it slides. The pane still owns the box: the occupants state
  `inset: 0` and nothing else about it. `m3-check.html` asserts both halves, because an occupant that
  positions itself and one that states a size are different faults.
- **An occupant of `#pane` is a fixed header over a scrolling body.** `#side` is a flex column:
  `#sideHead` is `flex: none` and `#sideBody` takes the rest and scrolls under it. One box doing
  both jobs scrolls its own title away with the content below it, measured at 109px of travel on a
  1400px window. `m3-check.html` asserts the shape and then the behavior. An occupant that scrolls
  itself and one whose header happens to fit are different faults, and only the second is invisible.
- **An `<h2>` keeps the UA block margin, and `css/base.css` resets `h1` alone.** That margin is
  `0.83em`, 18px above and below at 22px, so a header asking for 64px drew 86. Any heading placed in
  a header row in this app needs `margin: 0` stated.
- **The card treatment and the gap turn on together, and the radius is why.** With `--gap` at 0 the
  map fills the window, and a 16px radius on a full-bleed box notches the four screen corners and
  shows the page through them. So the radius and the edge live in the same `min-width: 601px` query
  the gap does. Below 600px there is no second pane beside the map either — the supporting pane is a
  destination over it — so there is nothing for a card to separate from. **M3 states a 16dp margin
  for a compact window and this app declines it.** 32px off a 360px map is the reason.
- **Three surfaces lost their line, and none of them gets it back.** The map card carried an inset
  1px outline, the app bar carried a rule under it, and the supporting pane carried M3's own
  `outline-variant` on the edge facing the map. A reader cut all three on 2026-08-20.
  **They separate by space now.** `--gap` is the seam on three sides of the card, between the two
  panes, and under the app bar. A line inside that space states one seam twice. M3's own layout
  guidance separates panes with space, so the pane's divergence is from the side sheet COMPONENT and
  not from the layout.
  If a boundary is ever wanted back on the map, it goes on a pseudo-element and never on a `border`.
  A border sits inside an absolutely positioned box, so it takes two pixels off the map rather than
  drawing around it. That is invisible until somebody measures the container. `m3-check.html` asserts
  the border width and the pseudo-element separately, because those two fail differently.
- **`#map`'s `right` transitions now, and that reverses an earlier decision.** It snapped, on the
  argument that animating the width makes Leaflet resize on every frame of the travel. It does, and
  that is exactly what keeps live tiles in the card as it grows. The alternative reveals a blank
  strip for 300ms. `right` alone, never the `inset` shorthand: the other three sides never move, and
  naming them puts three properties on the transition list that can only animate a value to itself.
  The `ResizeObserver` in `js/map.js` already answered each of those frames and needed no change.
- **`invalidateSize()` needs `debounceMoveend: true` now, and the heat layer is why.** The observer
  runs about 18 times across a 300ms travel. Leaflet fires `moveend` from each call unless told
  otherwise. `SoftHeat` repaints its whole field on that event, measured at 33 to 38ms for a full
  viewport, so eighteen of them is 630ms of main-thread work inside a 300ms animation. This app's own
  `moveend` handler writes the centre to `localStorage`, and that runs eighteen times for one
  press. With the debounce both happen once, 200ms after the travel. **The tiles keep up regardless**:
  a grid layer redraws on `move`, which still fires per call. The heat canvas rides the overlay pane,
  so it stays glued to the ground during the travel and only the newly revealed strip waits.
- **`#pane` is a `<dialog>` and the window class picks the METHOD, not the styling.** Below 600px it
  opens with `showModal()`. That is the only way to get the top layer, a real focus trap, and a page
  behind it that is inert. Above 600px it opens with `show()`, because a non-modal dialog is a plain
  positioned box and that is what a standard side sheet beside a live map has to be. `syncPane()` in
  `js/map.js` picks. **A `<div>` styled to look full-screen looks identical and is not the same
  thing**, and this app drew it that way for one revision. Four dialogs open OVER this one, and only
  the top layer lets them.
- **`show()` runs the dialog focusing steps too, and on a desktop that is wrong.** Landing opens the
  filters, and the pane then takes focus into the district filter box before a reader has touched
  anything. `syncPane()` restores the previous `activeElement` in that branch alone. A modal
  full-screen dialog MUST take focus, so the other branch leaves it. `#pane` carries `autofocus`
  and `tabindex="-1"` for that case: without them the dialog focuses its first focusable descendant,
  which drew a focus ring on the station card's ⋮ every time the pane opened.
- **A dialog's `close` event is fired ASYNCHRONOUSLY, so a flag set around `close()` cannot guard
  it.** The spec queues the event as an element task rather than firing it inside the call. A boolean
  set before `close()` and cleared after is therefore already back to false when the handler runs.
  Measured on the mode swap that crosses 600px: the event from one close landed AFTER the next open,
  so the handler cleared a body class the pane was open for, and **the pane never opened again for
  the rest of the session**. The listener in `js/map.js` tests `pane.open` instead. That cannot lie:
  it is false only when the element is genuinely shut, and that is the one case that clears the
  classes. **A headless check cannot wait for that event with a timer either.** Virtual time
  fast-forwards a `setTimeout` past a queued task, and a 300ms wait resolved before the event was
  delivered. `m3-check.html` awaits the `close` event itself.
- **`syncPane()` runs from a `MutationObserver` on the body class, so the open is one microtask
  behind the class that asks for it.** Three functions write those classes — `openSide()`,
  `closeSide()` and `setFind()` in ui.js. Watching the fact beats
  remembering four calls. Anything that asserts on the pane has to wait a tick first.
- **A module that wires an element at import time makes every test page carry that element.**
  `js/map.js` reaches `#pane` and `#map` at module scope, and `heat-test.html` imports it for the
  heat layer alone. A missing element is a `TypeError` at import time, and then nothing on that page
  runs at all. That page already stubbed `#sideClose` for the same reason. Add the stub rather than
  guard the wiring: a `if (pane)` in `map.js` hides a genuinely missing element in the app.
- **EVERY PANEL IN THIS APP WEARS ONE HEADER, AND IT IS THE PANE'S OWN APP BAR.** The repository
  owner asked for that on 2026-08-25. `#pane`, `#aboutBox`, `#helpBox`, `#settingsBox`, `#dataBox`
  and `#camBox` all draw M3's MEDIUM FLEXIBLE top app bar, at every width: 112px in two rows, a 48px
  target 4px in on a 56px top row, and `headline-medium` on the row under it. The numbers are stated
  once, beside `#sideHead` in `css/chrome.css`, and each dialog's markup carries the same
  `.apptop` and `.apflex` parts the pane carries.
  **This reverses "a full-screen dialog's header is NOT a top app bar".** That rule is M3 read
  correctly. `Dialog/dialog.css` gives the full-screen variant a 56px header of its own, and above
  600px these five are BASIC dialogs, which take a `headline-small` on a floating card and no bar at
  all. So the five drew four shapes: 112px on a phone, 56px for the prose panes on a desktop, 36px
  for the table and the wall, and the pane's 112px beside them.
  **What the spec reading cost is what it lost on.** A panel is a panel to a reader. One that
  restyles its own header at 600px reads as a fault, and no reader ever sees the component boundary
  the rule was drawn along.
  **`min-height`, not `height`, at every width.** The reference truncates a headline with an
  ellipsis. This app does not, and that rule is older: a station name cut in half names another
  station.
  **About draws 56px, because it carries no headline.** M3 marks the headline optional, and that
  pane's identity is the logo lockup below. A 112px band over a lone arrow is an empty label block.
  **Four rules went and none of them is worth rebuilding.** `#dataBox h2`, `#camBox h2` and the
  `headline-small` rung above 600px each named an id, so each beat the class rule the bar states its
  headline with. That is how the desktop drew 24px while the phone drew 28. The `.dclose` margins
  went too: each was a negative number derived from the padding of the box around it, and the three
  paddings behind them were 18, 20 and 24.
  **The table and the wall moved their inline padding onto the filter field.** `.dtop` holds the bar
  and that field. An app bar states its own insets, so a 20px pad on the box around it put both of
  them 20px further in than the pane's.
  **These five lead with a BACK ARROW, at every width, and that reverses the rule this entry held.**
  The old rule said the X stays and must never become an arrow. Its argument was M3's own: a
  supporting pane is a destination somebody navigates to, and a dialog dismisses. The repository
  owner asked for one glyph across every panel on 2026-08-25, and named the arrow. A phone shows one
  full-screen surface at a time, so two glyphs in one position for one action reads as a fault rather
  than as a component boundary.
  **The five are `#aboutBox`, `#helpBox`, `#settingsBox`, `#dataBox` and `#camBox`.** Each is
  full-screen below 600px and a basic dialog above it, and the arrow leads at both widths. That is
  what `#pane` already does.
  **`#lightbox` and `#warnBox` keep the ×.** Both are basic dialogs at every width — floating cards
  that never fill the screen. The lightbox has a second reason: an arrow beside its scrubber and its
  step-back button reads as "previous frame".
  **The base rule names ids, so the phone block had to name them too.** `#dataBox .modalhead .dclose`
  is one id and beats three classes wherever it lands. A bare `.dtop .modalhead .dclose` in the phone
  block therefore lost, and both of those panes drew the glyph 30px in against the 28 every other
  full-screen bar here holds. `m3-check.html` caught it.
  **About carries no headline.** M3 marks it optional, and that pane's identity is the logo lockup in
  the content below. So its bar is a 56px row holding one button.
  **Above 600px they wear the same bar, and the entry above states why.** These five were basic
  dialogs there, taking `headline-small` on a floating card and no bar at all. They kept the card
  and lost the headline rung on 2026-08-25.
- **`--pane` is the `.docbox` padding and a SECOND rule held a literal copy of it.** The base states
  `padding: var(--pane)`, and a phone-width rule stated `padding: 18px` beside a compact
  `--pane: 18px`. The two agreed by luck. `--pane` went to M3's 24px body padding and the literal
  stayed at 18. The pinned header read `--pane` back for the negative margin that took it full
  bleed, so it then bled 6px past the pane on each side. Measured: `scrollWidth` 381 against
  `clientWidth` 375, and a horizontal scrollbar along the bottom of a dialog that never had one.
  **Nothing else looked wrong.** The literal is gone for real now. It survived the first cut and sat
  in a second phone-width block, where it re-stated the dialog's own padding. The padding moved off
  the dialog and onto `.docbody` on 2026-08-25, so a `padding` on `.docbox` would put the pane's
  inset back on the box that must not have one. `--pane` is stated once, in the compact block that
  already sets it.
- **The pane's leading button is a BACK ARROW at every width, and it is first in the DOM too.** It
  was a close X: trailing above 600px, leading below it, moved by `order: -1`. A reader asked for the
  arrow on 2026-08-21. M3 gives a top app bar a leading navigation icon, so the button moved rather
  than the order. One bar now reads the same at both widths, and the tab order follows the reading
  order. `.apsp`, the app bar's own spacer, holds the slack between it and the trailing actions.
  `--i-arrow_back` came into `css/icons.css` for it, by the refetch that file's own header states.
  **One number holds every app bar in this app, and it is 28px to the GLYPH, 32px down.** Every one
  of the six reaches it the same way now, as `.apptop`'s 4px around a 48px target under 8px of top
  padding. **So assert the centre, never the box edge**, or a correct bar reads as broken the moment
  its target grows. There is no cancel left to keep in step with anything: the five dialogs each
  carried a negative margin derived from their own box's padding, and `.apptop` places all six.
  The one number a dialog does not share is the 1px border it carries above 600px, so a glyph
  measured from the border box reads 29 there and 28 inside it.
- **The bottom sheet is gone again, and the reversal is the entry.** The two panels were modal bottom
  sheets for one revision, on the argument that a panel reporting on the map behind it has to keep
  that map in view. **That argument describes a sheet somebody opens over content they are still
  reading. It does not describe a pane.** A pane is a destination, and in a compact window it is the
  only thing on screen. So `#scrim`, the `.grab` handle on both panels and `swipeSheet()` on the
  pane are all deleted. **There is no bottom sheet left in this app.** `#paintmenu` was the last
  one, and the layer controls became a chip row over the map on 2026-08-25. `.grab` and
  `swipeSheet()` went with it.
- **A FILTER WITH NO SURFACE IS WORSE THAN NO FILTER.** The filters panel and the district picker
  inside it were deleted together on 2026-08-26. Deleting the panel alone leaves a stored `hidden`
  set that hides districts with no control to bring them back. `PREFS.hidden`, `PREFS.drawer` and
  `PREFS.sect` are dead keys in a reader's stored blob. See `docs/FEATURES.md`, *The filters panel is
  deleted, and the ignored count went with it*, for the alarm indication this cost.
- **The map is a pane, so Leaflet has to be told when its box changes.** `#map` is
  `inset: var(--hdr) var(--pane-w) 0 0`, and `--pane-w` is the supporting pane's width while that
  pane is open. So the map narrows rather than being covered. Leaflet listens to `window.resize` and
  to nothing else. Without a second signal it keeps its old size: the tiles stop where the old edge
  was, and every `latLngToContainerPoint` answers for a container that is no longer there. A
  `ResizeObserver` on `#map` in `js/map.js` answers it, coalesced on a frame. **An observer and not a
  call at each site.** The pane is one cause of a resize. The window, the breakpoint and a rotate are
  others, and the observer catches every one with no call site to remember. `invalidateSize()` keeps
  the CENTRE by default, which is what a narrowing map wants. Measured at 711 stations: one call
  costs under a millisecond, so there is nothing to throttle beyond the frame.
- **`--pane-w` does NOT transition, and that is a decision.** The map snaps to its new width in one
  frame and the pane travels in beside it, which is what an adaptive layout does. Animating the width
  makes Leaflet resize on every frame of the travel. It also leaves the strip revealed on the way out
  empty for the whole 300ms. The strip the pane travels over is `--surface`, the same tone as the
  pane, so an opening pane reads as its content sliding in. A closing one slides off a map that is
  already full width.
- **`--pane-w` is 0 at every state below 600px.** There the pane is a full-screen destination over
  the map, which takes no width from it. `m3-check.html` asserts the map keeps its whole width at
  that breakpoint. A `--pane-w` fed a phone value shortens the map for a surface that never sits
  beside it.
- **Stepping aside for the pane is only half of it. The furniture has to clear ITSELF.** Every box in
  the bottom strip adds `--pane-w`, so none of them ever reaches the supporting pane. Each one was
  correct on its own and they collided with each other as the map narrowed. Measured with the pane
  open: at 700px the layer button sat on the legend, 60px by 60. At 840px the credit line ran 191px
  in under it, at 900px 131px, at 1024px 7px.
  **`#mapfoot` holds the legend and the credit in ONE WRAPPING flex row, and that replaces two
  offsets.** Two boxes in one flex row cannot overlap at any width, and a row too narrow for both
  puts the credit on a line of its own UNDER the legend. So a reader's two asks of 2026-08-25 are
  one shape: they read as one line where the map is wide enough, and the credit sits under the scale
  where it is not. `#credit` used to own the band up to 22px, at `8px + --gap` and one 14px line, and
  `#legend` started at 30 to clear it. The wrapper takes those offsets now, and it is anchored by its
  bottom edge, so it grows upward rather than off the screen.
  **It was a flex COLUMN for one revision, and that is the reversal to remember.** A column states
  two lines on a 1536px map with room for one. The legend is first and the credit second, so the
  wrap puts them in the order this entry is about.
  **The scale states itself on ONE line, and the titles paid for it.** `Water-level heat` and
  `Rainfall heat` are `Water level` and `Rainfall` now, which are the paint panel's own two names
  for the same two layers. The ramp beside a title is what says heat. That is 35px on a 360px
  screen, and it is the difference between one line and two. Measured after: 249px and 265px against
  a 280px row.
  **The medium band is the floor, and it cannot be repaired by shortening a word.** One line needs
  about 273px and the row hands 106px to the zoom cluster, against a map of 236 to 300px there. So
  no width in that band is both one line and clear of the cluster. `flex-wrap` on `.lgsec` breaks
  the scale rather than run it under the buttons. `m3-check.html` asserts one line wherever the map
  leaves room, and asserts the clearance at every width.
  **THE CREDIT IS THE LOWEST THING ON THE MAP, AT EVERY WIDTH.** That is a rule a reader stated with
  the stack, and it covers the legend, the zoom control and `#locate` alike. The
  arithmetic was already correct and nobody stated it as a rule. The credit sits 8px above the map's
  bottom edge and the zoom cluster sits 36px up. On a phone that is 6px against 40px. **Anything new
  that floats over the map takes a `bottom` at or above the zoom box's, never under it.**
  **The wrapper takes no pointer events and its children take them back.** The column spans the
  width of the map. A wrapper that took clicks would swallow every press along the bottom of it.
  **THE COLUMN IS FLUSH WITH THE MAP ON BOTH EDGES, AND THE RESERVATION MOVED ONTO THE WRAP.** It
  stopped 118px short of the trailing edge for a revision, to keep a wrapped credit out of the button
  and the zoom box. A reader called that floating on 2026-08-25, and it was: one line of credit,
  ending in the middle of the map. The credit needs 337px for one line, measured across eight window
  widths at both rail states. So it wraps on a map narrower than that and nowhere else, which is the
  medium band alone. A wrapped line rises to 44px above the map's bottom edge and 80px at four
  lines, against a zoom cluster 36px up. So the wrap is the whole of the fault and the width where it
  wraps is the whole of the answer. `#mapfoot` is a container now, and
  `@container (max-width: 360px)` hands the credit `--btncol` (106px) back. 106 is 118 less the
  column's own 12px inset, and 118 is the button's reach, `48 + --fab`, and 10 more to stand off it.
  **`#mapfoot` can be a container because its width is definite.** It is absolutely positioned on
  both edges, so containment has nothing to collapse. A box that takes its width from its own
  content and then contains it measures 0 — the trap `#brand` already carries.
  **The legend keeps the reservation at every width, through `max-width`.** It stands inside the band
  the cluster takes, and it never wraps out of it.
  **THE CREDIT IS FLUSH RIGHT WHILE IT SHARES THE SCALE'S LINE, AND LEADS ON THE LEFT ONCE IT TAKES
  ITS OWN.** A reader asked for that on 2026-08-25, after asking for flush right and then for flush
  left on a phone. `justify-content: space-between` is the whole of it, and there is no threshold.
  That property distributes per flex LINE: two items on one line go to the two ends, and one item on
  a line goes to the start. An auto margin stood here first and cannot do this. It pins the box to
  the trailing end on every line, wrapped or not, and no query can tell a CSS box that it wrapped.
  `text-align` is left at every width for the same reason. The alignment only shows on a line of its
  own, where the box already leads on the left.
  **The phone reserves that column on the WRAPPER instead, at `right: 68px`, and sets `--btncol` to
  0.** Both children are clear of the cluster there, so a second reservation on the legend is 56px
  the scale needs for its one line. One token carries it, so the container query on the credit goes
  quiet at that width too.
  **The pairwise check cannot see the ordering rule, so `m3-check.html` states it in two halves.** A
  button beside the credit on one band never intersects it, and that is the arrangement the rule
  refuses. One assertion reads the credit's own bottom edge and fails on any box that reaches under
  it. A second asserts the legend sits over the credit rather than beside it. Both run at every band
  the sweep covers, and again at 360px. The phone block writes its own offsets for all four boxes,
  and no other probe in that file runs a width under 700px.
  **Every child needs `min-width: 0`.** A flex item floors at its own min-content, and the credit's
  is a 65px word. In the medium band with the rail open the map is under 300px wide. The row then
  overflowed its own reservation by 6px and landed back on the layer button.
  **The legend is one row, and every scale in it states itself on that row.** It was a stacked card:
  a title, a ramp under it, and the tick words under that, at 288px with a `max-width` holding it off
  the layer button. On one row there is no second line to drop to. So the title, the
  ramp and the ticks run across, and only the ramp states a width, 72px on a desktop and 60 on a
  phone. A ramp is the one thing here with no intrinsic width. `flex-wrap` is the floor: a phone too
  narrow for the whole scale breaks it rather than overflow the map.
  **`.info`'s panel opens toward the map now, on `left`.** It hung off `right: -8px`, which ran a
  244px panel leftward from the glyph. That was right while the legend was a 288px card with the
  glyph on its trailing edge. On the strip the glyph sits about 100px from the map's leading edge,
  and the panel ran off it and was cut. A reader named that on 2026-08-24.
  **`m3-check.html` intersects every visible furniture box pairwise at each band.** Nothing else in
  this app could see this fault. A box that is correct against the pane, correct against the window
  and correct against the card is still wrong if it lands on its neighbour.
- **Three boxes step aside for the pane and the zoom control must not.** Leaflet's own controls live
  INSIDE the map container, and that container now stops at the pane, so they follow it for
  free. `#toast`, `#mapfoot`, `#mapchips` and `#locate` are siblings of `#map` and position against the window, so
  each adds `--pane-w` to its own `right`. `#pills` takes half of it off its centre line.
  **`right`, not a transform**, which is what the old rule used: `#toast` already owns its
  `transform` for the slide it opens with, and two rules writing one property is how a toast arrives
  360px off the edge it belongs to.
- **`focusOn()` carries no offset any more. Do not put one back.** It compensated for panels
  covering the two edges of the map. The map's own box ends at the pane now, so the container IS the
  visible strip.
- **One pane, one occupant.** Below 600px the search is an occupant too, so `setFind(true)` calls
  `closeSide()`. Above 600px the search floats over the map and shares the screen by design.
- **The pane animates and its occupants do not.** One box moves, so switching the station card for
  the search swaps the content of a container already in place. Each panel carried its own travel
  while each had its own box, and that switch drew two sheets sliding through each other.
  **A transition on `[open]`, and it buys an enter AND an exit.** `show()` and `showModal()` both
  flip `display`, so there is no closed state to transition from. `@starting-style` supplies one.
  `allow-discrete` on `display` holds the box on screen while it travels out, and `allow-discrete` on
  `overlay` holds the top layer, which matters below 600px alone. A keyframe stood here first and
  bought the enter alone, so the pane arrived over 300ms and left in one frame. A reader named that
  on 2026-08-24.
  **The occupant on screen fades with the pane, and only there.** `closeSide()` drops the body class,
  so the occupant's opacity goes to 0 in the same recalc the pane starts its exit in. Without a
  second rule the pane slides off holding nothing. That rule names `#pane:not([open])`, so an
  occupant replaced while the pane STAYS open still leaves at once. A cross fade there is the second
  motion a reader already cut. `m3-check.html` asserts an occupant's `animation-name` is `none`, and
  its swap assertion has to keep the pane open — removing every body class closes it and measures the
  new fade instead.
- **`#pane` is not `class="surface"`.** That class pairs the background with `--shadow`, and a
  standard side sheet has no elevation — the 1px line is what separates it. The full-screen variant
  has none either, because it covers the screen and there is nothing to lift it off.
  **A `<dialog>` also arrives with ten UA declarations to answer.** They are `position: absolute`,
  `margin: auto`, a solid border, `1em` of padding, its own colours, and a cap of
  `calc(100% - 6px - 2em)` on both axes. `#pane` states every one of them.
- **A header written as a row in the flow needs a height before anything pins it. About and Help
  shipped without one.** `.modalhead` sized to its own title and pulled its close button back onto that
  line with `margin: -8px -10px -8px 0`. That is correct for a row the content flows past. Pinning
  it made it a bar with a divider under it, and the vertical half of that pull then hung the 40px
  button through the divider. Measured: About drew a **24px bar under a 38px button**, and Help a
  35px one. **Both read as a browser artifact and are a number written for another layout.**
  `.docbox .modalhead` takes `min-height: 56px` now, which is the number the phone block below it
  already stated and is M3's top app bar. The pull survives on the inline edge alone, which is the
  half that puts the button's hit area on the pane's own padding. `m3-check.html` opens each pane and
  asserts the button stays inside the bar at both ends.
- **`.pophead` is the station card's first element, so no rule can key on `#sideBody > .sensor:first-child`.**
  That rule cancelled the first section's top rule against `.pophead`'s bottom rule, and its own
  comment warned against a sibling selector for exactly this reason. It then keyed on position, which
  is the same fault by another name. The moment `openSide()` began lifting three pieces out of
  `.pophead` rather than the whole element, `.pophead` became the body's first child and the rule
  stopped matching. Both rules drew, 8px apart, directly under the title. **A section is an M3 filled
  card now, so neither rule exists.** Cards separate by surface and by an 8px gap. The rule is gone
  rather than re-keyed: `#sideBody > .pophead + .sensor` would work today and break the next time the
  head moves.
- **The station panel is an M3 LIST, one item per sensor, and it was one filled card per sensor.**
  A reader asked for it on 2026-08-25. `.sensor` is the group and paints nothing. `.sensorhead` is
  the item: a 24px kind glyph in the leading slot, a `body-large` headline in the regular weight,
  and a trailing supporting line. `.sbody` under it is that sensor's readings, as M3's list at
  `appearance: segmented`. The numbers come from `List/list.css`.
  **The card held a meter, a metric row, a graph and a totals chart on one flat surface**, and said
  nowhere that each answers a different question. A segment per block says it.
  **A block a kind does not draw makes no segment.** `sensorBody()` filters before it wraps. So
  `:first-child` and `:last-child` reach the blocks a reader can see, and the 16dp outer corner lands
  on the real ends. A river draws three segments and a camera draws one.
  **EVERY segment carries a title, and TWO mechanisms supply them.** `sensorBody()` titles the block
  where it knows the kind. The block titles itself where only it knows its own span, which is read
  off the readings it holds. `sparkline()`, `rainBars()` and `sirenBand()` each head their own
  window. `rainState()` heads `Right now` and `rainAcc()` heads `Totals`. An empty title in
  `sensorBody()`'s table means the block writes its own. **Do not move a span title to the wrapper.**
  It cannot know one, and a wrong span is worse than none.
  **Five words cover every kind.** They are `Right now` for a reading at this moment, `Trend` for
  where it is going, `Last N h` for a timeline, `Totals` for the accumulation chart, and
  `Latest still` for a picture. So a river, a gauge and a rainfall station read down the same
  headings.
  **A group of ONE item takes no title**, because the section head already named the only thing under
  it. The camera reaches that here. The weather section, the weather panel and the nearest-camera
  section reach it for the same reason.
  **`sirenBand()` heads `SPARK_H` and never a measured span**, and it is the one graph where that is
  right. It frames on the clock, so the ground it covers is the constant. A measured span prints
  `Last 0 min` on the 103 sirens of 212 that hold one sample.
  **The siren's state and its band are TWO segments.** They answer `is it sounding` and `for how
  long`, and one title cannot head both. They were one block.
  **The river's rate row is keyed `Rate`, and it was `Trend`.** The segment around it is headed
  `Trend`, so the old key repeated its own heading 20px above it.
  The node harness in CLAUDE.md's Verify block walks every station and fails on an untitled segment,
  and on a lone segment that grew a title. `m3-check.html` reads the title off the rendered pane.
  **The gap is 2px and `.mseg` beside it takes 8px.** 2px is `--md-list-item-gap`'s own number.
  `.mseg` diverges because its groups hold different kinds of row. Every segment here belongs to one
  sensor and has to read as one block.
  **The leading slot is a bare 24px glyph, and it must NOT wear a disc.** `kindGlyph()` in
  `js/popup.js` emits it and `.sensorhead .glyph` in `css/map.css` sizes it. It wore the Notices
  pane's 40px tinted avatar for one revision and a reader cut it on 2026-08-25. An avatar names a
  SENDER, which is right for a bulletin. A sensor kind is not a sender, and six discs down one card
  read as six of them. `.avat` in `css/chrome.css` stays, and the Notices pane is its only caller
  again.
  **The gap is 12px here and M3 states 16.** 16 is written for a 40px avatar. Beside a bare 24px
  glyph it stands the headline further out than the supporting line under the whole group.
  **`.glyph` is 18px in `css/base.css`**, which is written for the drawer's own dense rows. A list
  item states 24. So a slot that loses the rule shrinks rather than vanishes, and still looks
  deliberate.
  **Never test a glyph's `backgroundColor` for a disc.** An `.i` IS a box of `currentColor` with the
  glyph masked out of it, so that property reads the station kind's own hue on a correct glyph. The
  BOX is what says there is no disc: an avatar is 40px and a leading slot is 24.
  **`--hover` is still this app's container tone**, and `surface-container` bridges onto it. A cell
  inside a segment steps back to `--surface`, or the two containers read as one flat block.
  `.sensor .wxcol` does that, and it reaches both surfaces that draw a `.wxcol`: the station card's
  weather section, and the weather panel's half-hour stack.
  **`sflash` lands on the HEAD and ends on `transparent` again.** Both reverse. The group paints
  nothing and every segment carries its own opaque container, so a tint on the group shows in the
  2px gaps and nowhere else. The head is the list item, and a list item is what takes a state layer.
  The keyframe ended on `--hover` while the section was a filled card, because fading to nothing
  erased the container the flash was drawn on.
  **`.subhead` cancels its top margin inside a segment.** It leads its own `<li>`, and that item
  states 12px of padding. A 10px margin over the first line stands the line 22px down. The old rule
  cancelled against `.sensorhead`, which is not a sibling of anything in the body any more.
  **Four surfaces take the shape.** The weather section, the weather panel's half-hour stack and the
  nearest-camera section each wrap their content in a `.sbody` too. The station card and the weather
  panel stand in one pane, one at a time. A head over loose content in one, and a head over a
  segmented group in the other, is one component in two shapes.
  **TWO SURFACES DRAW A WEATHER READING AND BOTH DRAW M3's TWO-LINE LIST ITEM.** They are every
  half hour in the weather panel's stack, and the two rows of the station card's own weather
  section. The repository owner asked for the component on both, on 2026-08-25.
  **`wxItem()`, `wxWhen()`, `wxTemps()` and `WX_NOW` in `js/popup.js` build the markup once**, and
  `js/wx.js` imports all four. They live in `popup.js` because `wx.js` already imports that module,
  and the other direction is a cycle. `.wxstep` in `css/map.css` states the numbers once.
  **The panel drew ONE item holding nine cards.** `.wxsteps` was a grid of `.wxcol` cards inside a
  single segment, which is a container inside a container. A segment is a block a reader takes in on
  its own, and a step is one: a glyph, a word and a clock about one instant.
  **The station card's section drew TWO CELLS of a `1fr 3fr` grid**, inside one segment of its own.
  Each cell held a 28px glyph over a title, with the whole state on `data-tip` and no word written
  out. The pane holds that card and the weather panel one at a time, so a head over two cells and a
  head over a list is one component in two shapes.
  **EIGHT RULES ARE DELETED and nothing draws them.** They are `.wx`, `.wxcol`, `.wxrow`, `.wxsub`,
  `.wxbig`, `.wxline`, `.wxtemp` and the `.sensor .wxcol` cancel. The `--g` glyph token went with
  them.
  **The card's rain SENTENCE splits across the item's two lines.** It was one string that opened
  with the same weather word the headline states, so the card read `Heavy rain` and then
  `Heavy rain until 19:30`, 20px apart. The headline keeps the weather and the supporting line keeps
  the span, which is the split every item here obeys. The span takes a capital, and `cap()` in
  `js/util.js` is the WRONG tool for it: that one works per word, lowercases the rest, and is not
  exported.
  **EVERY HEADLINE IS THE `WEATHER` LADDER'S OWN WORD, and never a phrase written in a template.**
  The dry case read `No rain` for one revision and the repository owner cut it on 2026-08-25. That
  is a fifth name for a rung this app calls `Clear` on the pin, in the legend, in the weather panel
  and on the map. One name for one thing, which is a rule this file already holds.
  **The ladder holds THREE rungs and that is the whole vocabulary**: `Clear`, `Rain`, `Heavy rain`.
  See the entry on the two refinements below.
  **A node harness in the Verify block reads back the seven wording branches**, and it evaluates
  `metSection()` as it ships. **It reads the ITEMS and never the whole section.** The section head is
  a `<b>` too and `WX_NOW` carries a glyph, so a document-wide search read the title `Weather` as a
  headline and the play arrow as the weather. That failed four assertions on markup that was right.
  **The item is M3's TWO-LINE row and every number is `List/list.css`'s own.** A 16px gap, `8px
  16px` of padding, a 72px floor, a `body-large` headline in the regular weight, and a `body-medium`
  supporting line in `on-surface-variant`. The step drew a 28px glyph over a 12px word with an 11px
  clock under the pair, and none of those three is M3's.
  **THE LEADING SLOT IS M3's AVATAR, a 40px tinted disc under a 24px glyph.** The repository owner
  asked for the disc on 2026-08-25. `.avat` in `css/chrome.css` states the shape and this surface
  states no number of its own. **That is not the disc the station panel cut the same day.** That one
  named a sensor KIND, which never changes down a card, so six discs read as six senders. This one
  carries the thing that DOES change down the stack, which is the rung at that half hour. So a
  reader finds the wet hours by colour before reading a word.
  **The word is the headline and the clock is the supporting line.** This panel answers about
  weather. The clock says which half hour states it, which is the job of a supporting line.
  **THE STEP HAPPENING NOW REPLACES ITS CLOCK with a play arrow and the word `Now`**, in the accent
  and in bold, on the repository owner's instruction of 2026-08-25. It was a 9px outlined `NOW` chip
  in the trailing slot. The item already carries a 2px accent outline, so an outlined chip inside it
  drew two rings around one fact. The row a reader is on is the one row that needs no time read off
  it, and a clock beside the word says one thing twice.
  **It takes `body-medium`, the clock's own size.** A supporting line that changes size from row to
  row moves the headline above it.
  **It is a `<span>` and NOT a `<b>`.** `.wxstep .wxtext b` is two classes and an element, so it
  beats any two-class rule on that box. As a `<b>` the marker drew at the headline's own 16/24 and
  stood the headline 2px higher than every other row's. The weight is in the stylesheet instead.
  **THE TRAILING SLOT IS M3's TRAILING SUPPORTING TEXT, and it holds the day's two ends alone.** A
  reader asked for the spec on 2026-08-25. `label-small` in `on-surface-variant`, `flex: none`. It
  wore the item's own `on-surface` for a revision, which is the HEADLINE's colour, and a trailing
  line that dark reads as a second headline. The two arrows keep `--wx-cold` and `--wx-warm`, which
  is this app's one temperature idiom.
  **HIGH OVER LOW, on TWO lines, and M3 states one.** The repository owner asked for the stack the
  same day, and it is the one divergence in this slot. Two 16px lines is 32px inside a 72px item
  that pads 8px, so the row does not grow. The order is the MARKUP's and never a `column-reverse`,
  so a screen reader hears what the eye reads. `align-items: flex-end` lines the two figures up on
  the item's own inset, and there is no gap: the line height is the space.
  **`.wxtrail` is gone.** It stacked two things in this slot while the `NOW` chip stood there, and
  that chip is the supporting line now.
  **`.mseg > li` in `css/chrome.css` holds the same numbers and is NOT the same selector.** Those
  rows hold text. This one holds a glyph, a word, a clock and a pair of temperatures.
  **The clock is not `.muted`.** That class carries a `font-size` of its own, which is the trap this
  file already records against the rain chart's window labels.
  **`.sbody > li` states a 12px inset for a graph or a picture, so the item needs the ELEMENT as
  well as the class to beat it.** `.sbody > li.wxstep` is the selector.
  **The `now` outline moved onto the ITEM.** The item is what carries the shape the outline follows.
  **The station card's weather section is the only caller of `.wxcol` left.** That box keeps its own
  fill, its `--g` glyph token and its 8px radius. Nothing in the weather panel draws one any more.
  **THE HEAD'S GLYPH IS FIXED, and it read the first step's rung for one revision.** The repository
  owner cut that on 2026-08-25. A head names the sensor, the job the kind glyph does over a river or
  a siren, and those never move. Every item under it states its own rung, so a moving head stated
  one step's weather twice and every other step's weather wrongly. It draws `partly_cloudy_day` in
  `--k-weather`, which is the mark the Weather layer chip already carries. The rung ladder draws
  `sunny` for a clear sky, and a rung is not a name for the layer.
  **A step grows from about 56px to 72px, so the stack of nine grows about 144px.** That is the
  number M3 states, and this file's own rule is to transcribe a component rather than approximate
  it.
- **A place name is capitals from JPS and Title Case from the national portal, so a title has to pick
  one.** `titleCase()` in `js/util.js` is the one place that picks. **CSS cannot do it**:
  `text-transform: capitalize` raises a first letter and leaves the rest of the word alone, so
  capitals stay capitals. Three tests find an acronym. The live payload supplied the evidence for each one.
  A token holding a digit is a code (`F2`, `B27`, `FT29`, `BT.14`). A stop INSIDE a token marks an
  acronym written with stops (`T.K.P.M`, `S.J.K.C`). A token with no vowel is an acronym written
  without them (`SMK`, `KTM`, `LRT`, `TNB`, `PWTC`). **Eight Malay place words are the exception, and
  the data is why.** They abbreviate a word rather than initial a name, the portal's own Title Case
  rows already write them `Kg.` and `Sg.`, and `KG` and `SG` alone are **316 of the 380 vowel-less
  tokens** in the payload. A first pass splits `SG.PELEK`, which JPS writes run together and
  elsewhere writes apart. Left whole, the stop inside it reads as an acronym and the name stays in
  capitals. **Three names of 630 come out wrong and no rule here can see them.** They are `USJ`,
  `REM` and `PRAB` — acronyms that hold a vowel. A list of them is a list somebody maintains. It buys one word of one
  station name. Three surfaces call it, and all three draw a name as a TITLE: the
  station card (`goName()`), the weather card (`js/wx.js`) and the table's hover panel. **A row in a
  list is not a title and does not call it.**
- **`render()` refreshes the open card in place, so `openSide()` must stay idempotent.** It runs on
  every poll for the site currently on screen. It resets `scrollTop` **only** when the key changes.
  Otherwise a poll throws you back to the top of a card you read. Anything stateful
  added to the card is lost on that rebuild, unless it is keyed the same way. That covers an open
  `<details>`, a scroll position and a text selection.
- **Nothing can close the card except the reader**, and there is no `map.on('click', closeSide)`.
  That was carried over from the popup, where it belonged. It dismissed the panel mid-read. The
  "you are here" card was hit hardest. The `js/locate.js` module draws an accuracy circle. `L.Path`
  bubbles its clicks to the map where `L.Marker` does not (`bubblingMouseEvents: false`). So at a
  coarse fix most of the viewport closed it. `render()` no longer closes it either when the site
  leaves `sites`. The ways out are the ×, a dialog taking the screen, ⋮ → ignore, and two gestures
  at phone width. About and the table are the dialogs, and both call
  `closeSide()` in ui.js. The two
  gestures are the ones a modal sheet owes a reader. Below 600px the pane is an **M3 modal bottom
  sheet**, so it has three ways out and all three are that component's own: a tap on `#scrim`, a
  drag down on the handle, and Escape, which is also what the Android back gesture fires.
  **The filters are a fourth way out and they are meant to be.** One pane holds one occupant, so
  pressing the hamburger replaces the card rather than dismissing it. That is a swap and not a
  dismissal, which is why it does not breach the rule above.
  It spent one revision as a full-screen dialog, which has no scrim and no drag, and the scrim and
  the swipe were deleted for it. Both are back.
  **Do not add another without a reason that survives
  "it vanished while I was reading it".** The last three carry theirs.
  **The layer switch was a fifth way out and it is not one any more.** It closed the card, on the
  argument that a switch takes the thing the card describes off the map. The premise is true and the
  conclusion was wrong. Both layers answer about one place. So a reader on a station card who
  presses Weather asks for the weather at that place. Closing takes the place away too.
  **The card hands over instead**, and `carry()` in `js/ui.js` is the one door. A station card hands
  to the nowcast point it already named, through `met.at`. `api.php` attaches a station to its
  nearest point and publishes that point name. So the match is the point the reader already read,
  and not a second guess at it. Measured 2026-08-20: all 675 stations carrying `met` name
  one of the 50 points `?wx=1` publishes. A weather card hands back to the nearest station of any
  kind. `flashTo()` does it, and that is the one door to a station card here.
  **Both directions move the map, and the first version moved it on one.** `flashTo()` carries the
  move and the ripple already. The weather side swapped the panel over a map standing still, which a
  reader read as nothing having happened. So `carry()` makes the two moves a weather pin makes on a
  click, `openSide()` then `focusOn()`, and adds the same ripple. The ripple carries the point name,
  because the zoom can thin the pin under it away. **A headless probe cannot check this half.**
  Leaflet pans with a transform and `requestAnimationFrame`, and virtual time does not run that
  faithfully. Two runs reported the centre on the point and then short of it, with no code change
  between. Record the `focusOn()` call, never the rendered position. **The hand-over is not
  an inverse and nothing here makes it one.** KG. KUNDANG names the Banting point at 14.7 km, and the
  nearest station to that point is SIREN PEKAN BANTING. Both steps are right.
  **The alert list is the one occupant that still closes.** It is a directory of stations, and a
  weather map has no answer to carry it to. A card with no answer at all closes too. That is the old
  rule, kept for the case it was right about. That covers a station with no `met`, a point with no
  station, and a failed import.
  **`carry()` is one function with two call sites, and `pts` is the reason.** The weather direction
  cannot answer until `?wx=1` has landed. So it runs at the tail of `wxLayer`'s own handler, after
  the `tick()` that handler already awaits. The preference guards it, so a rolled-back import closes
  nothing. The Stations direction starts in weather mode. The points are already in hand
  there, so a listener on that radio is enough. `carry()` in `js/wx.js` holds both directions,
  because it is the module that holds the points.
  **The "Your Location" card answers on both layers, so it swaps rather than hands over.**
  `showHere()` in `js/locate.js` owns both forms and `carry()` just calls it. On `weather` it is the
  card a weather pin opens, over the MET point nearest the fix. `hereCard()` in `js/wx.js` builds
  it, behind a dynamic import that costs no request. Weather mode is the only way to that branch,
  and it is what loaded the module. **Do not put the two-cell `metSection()` back there.** A weather map opens the whole forecast on
  every pin. A summary of that forecast beside it is one fact in two sizes. The
  head keeps its title and its glyph and swaps its muted line for `<point> · <km>`. Which MET point
  answered is the one fact that card cannot get anywhere else. `hereCard()` answers nothing past
  `NEAR_MAX_KM`. `herePopup()` then draws the head and the line `No weather within 10 km`. That
  is one message in one place, whichever half did not answer. `tick()` rebuilds the card on the poll under the
  `@here` key. That is the way it already rebuilds an open `@wx-` one.
- **The alert list is a tenant of `#side`, under the key `@alerts`.** It is not a panel of its own
  any more. So there is nothing to place, slide past the drawer or collapse on a phone. A
  station picked out of the list *replaces* the list. That is why nothing binds the rows any more.
  The delegated `[data-go]` handler in ui.js reaches them. The old per-row handler existed only to
  collapse the panel on a phone first. Two consequences. Its head must stay the first element and
  must be `.pophead`, the same seam every station card obeys — `openSide()` lifts it into
  `#sideHead`. And **nothing springs it open by itself**. On the right edge it lands on a card
  someone reads, which is the rule directly above. The button's colour and count are on screen
  the whole time, and the interruption for news is still the toast.
- **`#alertBtn`'s `aria-expanded` is synced from `openSide()`/`closeSide()` in map.js**, not from the
  click that opened it. The panel has half a dozen other ways to change what is in it. They are a
  pin, the table, "you are here" and the ×. Every one of them left the button lying.
- **`#netstats` is a sibling of the `<h1>`, not a child of the mark that opens it.** A `<table>` is
  flow content and cannot legally sit inside a heading. So the popover is anchored against the
  window and revealed by `body:has(#brand .mark:hover)`. There is no combinator that walks back out
  of the heading to a sibling. The `body` selector, not `header`, is what lets one popover answer
  for both of the heading's homes — see the entry on that below. The touch path toggles `.open` on
  `.mark` itself now: there is no separate status dot to carry it. `#netstats` has to stop its own
  clicks (ui.js), because it is no longer inside the element the document handler exempts.
- **You cannot focus something you are still animating into view.** Two separate traps, both silent,
  and `#gotoBox` hit each in turn. A transitioned `visibility` *interpolates*: at t=0 of
  hidden→visible it still computes to `hidden`, so `focus()` is refused — hence `visibility 0s .25s`
  rather than `visibility var(--slide)`. The click that opened the control leaves focus on the
  button that is about to become `display: none`. That returns focus to `<body>` *after* the
  handler returns. So the focus must follow a style flush (`el.offsetWidth`). `requestAnimationFrame`
  does **not** work here: its callbacks run before the frame's style recalc.
  **The same interpolation eats clicks on the way out, and `#splash` did it.** `visibility`
  holds its *start* value for the whole duration, so `visible → hidden` stays `visible` until the
  transition ends. `opacity: 0` does not stop hit-testing. Paired with it, `#splash.gone` left an
  invisible `inset: 0`, `z-index: 900` sheet over the entire viewport for 300ms after the map
  appeared. The first press of anything in the app bar did nothing and the second worked. That
  reads as a slow button, rather than as something on top of it. The fix is `pointer-events: none` on
  the `.gone` state, kept **out** of the transition list so it applies at once. Any overlay that
  fades itself out needs that declaration. `opacity` and a transitioned `visibility` together never
  stop a click. Both of this app's full-screen fades were written that way.
- **`focusOn()` centres on the strip of map that is actually visible.** That strip is now bounded on
  both sides. The pane takes the trailing side. Skipped
  below 600px, where the panel covers the map outright and there is no strip to aim at.
- **Stations within `SITE_M` (50 m) are one place.** `api.php` stamps a `site` key. The map draws one
  pin per site, not per station (671 → 417). Anything reaching for a marker must go through
  `siteMark` in `map.js`. A station's pin can be filed under another kind's bucket, because the
  bucket is the *lead* sensor's kind. Sites are built **after** filtering, so a hidden layer can
  never take a whole mast off the map. That is why layer chips call `render()`, not `syncCluster()`.
- Clustering still never fully disables: sites can sit metres apart. `maxClusterRadius` tightens
  with zoom and co-located pins spiderfy on click.
- **A cluster badge counts what it hides, not what is in the area.** Favorites are drawn on
  `favLayer` in `map.js` and never enter `cluster`, so a chip over a patch holding 13 pins can read
  12. That is the correct number: the chip hides 12 pins and the 13th is drawn beside it. The
  same holds for the badge's red. `iconCreateFunction` ORs `m.options.critical` across its children.
  So a chip goes neutral when the only critical pin near it is an unclustered favorite drawing itself
  red. Nothing leaves the screen. Do not "fix" the count by folding the favorites back in. That
  makes the badge claim to hide pins that are visible.
  **The open card's pin is the second tenant of `favLayer`, from 2026-08-26.** `markSel()` turns it
  into a teardrop, and a chip that swallows that teardrop leaves the map unable to say which place
  the pane describes. A zoom out is how a reader looks for it. `loose()` in `map.js` is the one test
  both tenants go through, and `markSel()` calls `syncCluster()` on a real change of selection so
  the last pin goes back in. The count above reads one lower again, for the same reason and with
  the same answer.
- **Offline gauges are frozen on old flood readings** (3.55m from April). So they are *not sampled
  into `.history.db`*, and carry no `history`. A flat line at a number from months ago reads as
  "steady". That is the one thing a graph of a dead sensor must not say. Anything offline or
  >24h old renders grey with an explicit `OFFLINE` block, the date in the footer. Never show these
  as live. **A graph is still drawn for them**, and that does not breach the rule above. An offline
  gauge holds no samples at all. So what draws is its two marks against an empty plot. It is not a
  flat line through a number from April. The gate that used to suppress it took the timeline from 15
  of 36 gauges. See the always-draw rule under Conventions.
- **41 sirens last reported months ago** (one in July 2025). They render `OUT OF CONTACT`, never
  `IDLE` — a silent siren and a dead siren look identical, and only one is safe.
- **The siren band frames on the clock, and it is the only graph here that does.** Every other graph
  spans the readings it holds, because a reading exists only where somebody took it. A state exists at
  every instant. `sirenBand()` therefore spans the last `SPARK_H` hours ending **now**, and lets the
  samples colour parts of it. It does that through the `frame` parameter on `timeAxis()` that no
  other caller passes. Measured on the live payload: 212 sirens, of which 86 hold no history at all
  and 103 hold exactly one sample. The median newest sample is 9.3 hours old. A siren heartbeats
  daily, and `.history.db` keys on the reading's own stamp. So an unchanged siren stores one row.
  Framed on its data the way a river graph is, the median siren drew a window of **zero width**.
  **A reading holds until the next one, and that reverses the rule that stood here.** The band used
  to cut each bar 15 minutes after its sample and leave the rest blank. The argument was that an
  unbroken quiet band across a hole says the siren was silent. It says it in the same shape as one
  measured silent. That argument assumed a hole meant lost contact. It does not. This app polls an
  online siren every few minutes, and only stores a row when the siren's own stamp moves. So a hole
  is the value not changing. The cost of the old assumption was 103 sirens drawn as one sliver.
  **A hairline rail in `--s-none` covers what the samples do not.** That is the token this app
  already uses for no reading. It is a rail and not a bar. It is the absence of a state, rather
  than a third one. **The out-of-contact case needs no flag and must never grow one.** `SPARK_WIN`
  is 12 hours and `SIREN_STALE` is 48. So a siren's last sample leaves the window a day and a half
  early. Only then does this app call the station out of contact. All 65 out-of-contact sirens hold
  zero history, so the whole band is rail by geometry. A `hasInfo()` test here states one fact in two
  places, and the copy then drifts from the block above it.
  **The band draws for an out-of-contact siren too** — it sits outside the state ternary in
  `sensorBody()`. It used to sit inside. That left the one kind whose whole question is "for how
  long" as the one kind with no timeline.
  **An empty band ships no `data-pts`.** `show()` in `js/sparktip.js` takes the last sample at or
  before the pointer and destructures it. So an empty array is a `TypeError` on every pointermove
  across the plate. A graph with nothing to say ships no attribute.
  There is **no caption**. It read `Silent for 9 h`, `Last sounded 14:22` or `Sounding since 13:50`,
  and the band states all three. A rail with no bar on it is silence. A red bar shows when
  it started. A red bar that reaches the right edge means the siren sounds now.
- **A siren reading 1 is a claim, not a fact, and the river behind it is the check**. JPS sounds a
  siren for one minute at the Amaran mark. It repeats every 3 hours while the water stays there,
  and every 5 at Bahaya. So the alarm is a claim about a river level the payload already holds.
  `sirenBacked()` in `api.php` asks it. `backed` is true when a river within `SIREN_KM` (5 km) is at
  status ≥ 2. It is false when rivers are in reach and none is. It is **null when there is none to
  ask**. `sounding()` in `util.js` reads `backed !== false`. The null case keeps the benefit of the
  doubt, because silencing a real evacuation alarm beats carrying a doubtful one. 15 of the 17 alarms
  in our archive were unbacked. One was held 127 hours with its own gauge 2 m under the mark.
  Believing them kept the app bar red every day of the week. **Do not replace this with a duration
  cutoff.** That was the first attempt. JPS's repeat cadence means a genuine flood holds a siren
  on all day. So any cutoff short enough to catch the stuck ones discards the real one. Both reds
  read `sounding()`, `isCritical()` and `atDanger()`. A red pin beside a panel that refuses to list
  it is the map contradicting the panel. **`?shots=` asks the same question per frame**, through
  `$sirenFrames` — `frameTiers` against each nearby river's *warning* mark, intersected with the
  siren's frames. It must never fall back to the live `backed` flag. A picture from last week is
  judged by last week's water, the same rule `camWarn()` obeys. Flood gauges are **not** backing
  evidence — measured, they hold no samples across any alarm window on record.
- **A rain gauge's hourly reading is a claim too, and its own odometer is the check.**
  `hourlyRainfall` is a *rolling* one-hour total and `cumulativeRainfall` only climbs. So rain the
  first claims has to appear in the second across that hour. `rainBacked()` in `api.php` asks it and
  publishes `backed`. It is true where the odometer rose. It is false where the odometer did not
  move while the gauge still claimed rain. It is **null where nothing can be asked**. That is a young
  archive, or a station with no odometer, which is every KL gauge. `raining()` in `util.js` reads
  `backed !== false`, exactly as `sounding()` does. A gauge nobody can check keeps its reading.
  Measured 2026-08-14: 5 of the 48 gauges this app can ask claimed rain their own total denied. T.K.P.M SG. KELAMBU held 4.5 mm for **twelve hours**, against an odometer that never moved
  and a daily total of 0.
  **The window is the hour the reading names, and a longer one is wrong.** A real burst leaves the
  odometer flat straight afterwards while the rolling hour still carries the total. So any window
  wider than the claim calls live rain faulty. `accWindow()` does the reading, so a sparse archive
  widens the window instead of failing. A wider window can only add rain. It can only move the
  answer toward true, which is the safe way to be wrong. Three surfaces read the flag: the pin
  colour through `color()`, `atDanger()` at the top class, and the rain heat layer. There an
  unbacked gauge **neither paints nor erases**. A reading nobody can stand behind is no evidence
  that the ground under it is dry either. The card keeps printing what JPS publishes and adds
  `Faulty signal.`, the same shape the siren block above uses. **`soak()` in `test.js` sets
  `backed: true`.** Without it, a faked storm on one of those gauges draws as a faulty signal. It gets no
  pin and no blob. Do not widen this to a duration cutoff, and do not let it silence a gauge it
  cannot ask.
- **Nothing outranks a popover except another popover.** The table draws its graphs inside `.tipbox`,
  which is a `popover` and therefore in the **top layer**. That is above every `z-index` on the page,
  because the top layer is not part of the stacking context at all. So `js/sparktip.js`'s readout is
  itself a popover (`manual`, so it cannot light-dismiss the panel it sits on). Anything new that has
  to paint over the table's panels, the ⋮ menus or the lightbox needs the same treatment. Raising a
  z-index will look like it works everywhere except over a popover, which is the one place it matters.
- **A graph's samples ride on the element, in `data-pts`.** `readout()` in `popup.js` writes
  `[x%, label]` per sample and words the label itself (`1.74 m · 14:15`, `sounding · 22:30`). So the
  one listener that reads them needs no units, no clock and no sensor kind. The attribute is
  **single-quoted** because JSON quotes with double ones. Any new graph that wants the readout emits
  the same attribute. Any that does not simply has no `[data-pts]` to match.
- **A flood gauge's status colour comes from `gaugeColor()` in `util.js` and nowhere else.** Upstream
  publishes 3 codes against 2 marks. So any depth under 0.15 m shared code 0 with *dry ground*. A
  wet spot painted the same taupe as a dry one. That is the colour this app reserves for a sensor
  that cannot report. `gaugeTone()` gives the rung: dry → 0, any water → 1, the warning mark → 2,
  danger → 3. `GAUGE_COLOR` gives the colour, which is **not** `STATUS_COLOR`. Four
  surfaces read it: pin, card, table cell, table hover panel. It deliberately changes **no alert
  surface**. `isHot()` never covered gauges, so the count, the badge and the ticker do not move. If
  a gauge ever needs to alert, that goes through the alert design standard first.
  **RUNG 1 TOOK `--s-trace` AND TAKES THE GAUGE'S OWN TAUPE NOW**, on the three-colour rule of
  2026-08-26. So the pin at rung 0 and the pin at rung 1 are one colour again, which is the exact
  fault this entry was written about. **It is not the same fault.** Then, a wet gauge wore the colour
  this app uses for a sensor that cannot report, and the card said nothing else. Now it wears the
  gauge's own kind colour, which every reporting gauge wears, and the card says `WATER ON GROUND` in
  that same taupe through `.state.kind`. Grey still means no reading and nothing else.
  `gaugeTone()` keeps all four rungs. Only the colour table under it lost two.
  **The readout on the graph moved with it.** `TONE.gauge` in `popup.js` tested `c > 0` and tests
  `c > 1`. A taupe number in a readout is a colour that says nothing, and the warning glyph beside it
  already started at rung 2.
- **The Selangor list publishes `-1` for "no status" on stations that report a number.** 144
  of 233 rain gauges and 15 rivers, on the payload this was found. `api.php` derives the code
  from the reading, through the same `rainStatus()` / `wlStatus()` the two scraped feeds already
  use. It is server-side, because there is one definition of a status and it is that file's. `band()`
  in `table.js` clamps `-1` to 0 as the guard behind it. Never re-derive a status client-side.
  **For rainfall this is no longer a fallback, and the feed's own class table is why.** The `-1`
  test is gone. Wherever there is a reading, `rainStatus()` scores it. Measured 2026-08-25, TAMAN
  FRIM KEPONG reported 51.5 mm an hour against its own published `spHeavy` of 31, in the same
  response, and JPS still published `status: 2`. So the field contradicts the table beside it.
  4 of 281 gauges disagreed on that poll, every one of them a class low. Trusting the field lists a
  gauge at 38.5 mm/h in the alert panel and skips the one at 51.5, which reads as a fault in the
  app. The repair moves a pin colour and a heat weight on those 4, always upward, and only where the
  feed understates a reading it publishes itself. **The river branch still tests `-1`**, because no
  river was measured disagreeing. Do not extend this to a river without the same measurement.
- **`atDanger()` is the map's red. `isCritical()` is the alert path's.** They are different
  questions and must not be merged. `atDanger()` asks whether this sensor is at the top of its own
  scale. It covers a river over its mark and a sounding siren. It also covers a flood gauge under
  water, and rainfall in JPS's top class. It drives the pin colour, the `.danger` halo, the cluster
  badge and `leads()`. A pin has to be red whenever anything at that place is at its worst. A mast
  led by a quiet river used to draw blue over a flooded gauge beside it. `isCritical()` is narrower,
  and feeds `isHot()` and through it the alert panel, the icon badge, the ticker and the toast.
  **Widening `isCritical()` widens every alert surface at once** — that is an alert-design decision,
  and it goes through the standard first.
  **It was widened once, on 2026-08-25, and rain is the one kind in both.** `isCritical()` covers
  `raining(s) && s.status >= 3`, which is JPS's heavy class, `> 30` mm an hour. `atDanger()` still
  reads `>= 4`, which is `> 60`. So the two still answer different questions and the numbers differ
  on purpose. **Do not collapse them to one number.** `atDanger()` asks about the top of a scale and
  class 3 is not the top.
  Evidence for 3 over 4, from a 30-day archive. Class 4 fired on 13 samples in the whole month.
  Class 3 fired in 66 ten-minute buckets, on 10 days of the 30. Two of those buckets reached
  ISA-18.2's 10-in-10-minutes flood threshold, and `FLOOD_N` in `toast.js` already stands the toast
  down at exactly 10. See `docs/FEATURES.md`, *Heavy rain joins the alert path, on a rung of its
  own*.
- **`tier()` has FOUR rungs, and the fourth one is severity rather than certainty.** They are `now`,
  `heavy`, `soon` and `stale`. The first build put heavy rain in `now`, and the repository owner
  opened the panel and asked where the amber had gone. Every card was red. Amber was not missing.
  It is `soon`, and no river was rising. **The question still found a real fault.** The other three
  rungs split certainty and urgency and carry no severity at all. Four gauges at 38 mm an hour and a
  river over its danger mark are both observed and both immediate, and one red said they were the
  same claim. CAP keeps severity on its own axis for this reason.
  `heavy` sits above `soon`, because it is observed and a forecast is not. It sits under `now`,
  because class 3 is not the top of the rain scale. So a class 3 gauge is listed amber in the panel
  and keeps its violet pin, and the rung and the map agree about it.
  **`heavy` and `soon` share `--s-warning`, and the tag word tells them apart.** That is the shape
  `now` already had: one red over a river at its mark and over a sounding siren. A fourth hue puts
  four traffic-light steps on a panel with three things to say about severity.
  **The rung test comes BEFORE `isCritical()`**, which already answers true for a class 3 gauge.
  **A tier name has to appear in four places or a card draws a bare grey rule and errors nowhere.**
  They are `TIER_RANK` in `util.js`, `TIER_TAG` in `alerts.js`, `.alert.t-<name>` in `chrome.css`,
  and `ALERT_TITLE` in `config.js`. `#ticker .tk-why.t-<name>` is a fifth for anything the strip
  draws. The Verify block holds a harness that asserts all of them.
  **The app bar glyph went amber for free and needed no edit.** It reads
  `STATUS_COLOR[live.some(s => tier(s) === 'now') ? 3 : 1]`, and the red favicon follows the glyph.
  So rain alone paints both amber the moment it leaves `now`.
  `render.js` states the red explicitly
  (`critical ? statusColor(3) : …`) rather than trusting `leads()` to elect the worst sensor and
  `color()` to return red for it.
- **Test mode makes a place tell one story.** `seedTest()` walks stations. So its first pass can
  leave a river over its danger mark. The same mast can carry a dry gauge and an idle siren. That is
  four unrelated faults on one pole, which reads as a bug rather than as weather. A second pass over
  `site` brings every online member of a flooded site up to match, through one idempotent `drown()`.
  Offline members stay offline on purpose: a sensor down on an alerting mast is a real rendering
  path. **A camera has nothing of its own to fake.** `camAlert()` measures from the alert to the
  lens. So `CAM_EVERY` floods every third site that holds both a camera and a river. Without it the
  camera warning was faked by luck, on 6 of the 31 such sites. Anything new that alerts needs a knob
  here, or it ships unseen. That is why the gauge has one, at a rung real data almost never reaches.
  **A faked level is placed against the station's own marks, never as a fraction of the danger
  mark.** `danger × 0.82` is 29.36 m on a river that alerts at 35.80. So the fake stamped an alert on
  a station the scale put in the safe stretch. The row drew an amber number over an empty bar.
  **A fake sample carries a status code too.** That is the third element real samples get from
  `sparkPoints()`. `wlCode()` / `gaugeCode()` / `rainCode()` in `test.js` copy the cutoffs in
  `sources.php`. A siren needs none, because its value is its status. That is the one place a status
  is scored client-side. It is allowed because nothing in test mode reaches a server. Without it the
  hover readout printed a faked flood in plain ink. That hid the very crossing the fake exists to
  show.
  **A fake that moves one field of a sensor has to move every field the card draws beside it.**
  `soak()` is the single door for a rain gauge. The hour, the day, the status, the graph and the
  `acc` chart all leave through it. `rainState()` prints `HEAVY RAIN`, and `rainBars()` draws
  the hour directly above a 1 h column that states it as a number. The two disagreeing reads as a
  bug in the chart, rather than as a fake. Two callers had already drifted.
  `drown()` hard-coded a 158 mm day where the storm cell applies a multiplier that gives 157.5.
  **`stormAcc()` shapes the five windows rather than scaling them.** A violent cell is short. So its
  3-hour multiplier falls as the hour gets heavier. 75 mm held for three hours is a once-in-decades
  total. 4 mm/h of drizzle really does run all afternoon. The two long windows carry a
  per-station `seed()`. Antecedent rain is the one thing that does *not* follow from the
  hour on the gauge. Scaling it off that hour gave every faked gauge one silhouette. That seed
  is **FNV-1a and not `h * 31 + c`**. Ids run `rf-153`, `rf-154`, `rf-156`. So the simple hash put
  adjacent ids on adjacent values, and twenty gauges in a row drew the same chart. Test mode fakes
  the `derived` flags and the measured spans too. Both reach real data only once the odometer fills,
  so without a knob the asterisk and its footnote ship unseen.
- **The alert panel is a directory, not a stack of readings.** `groupCard()` in `alerts.js` draws one
  card per kind per tier, five at most and usually two. **Every row in it is a place**, grouped on
  `site`. So a mast with two gauges over their marks is one row. One card per station carried a
  meter, a trend line and a 12-hour graph each. That is right for one alert and wrong for forty.
  Test mode makes 64, and they now fill 3 cards. The meter and the graph are on the station card,
  which every row opens with one tap. **Do not put a reading back in this panel.** The row's number
  is the whole of what a scan needs. That number is a percent of danger, hours to it, or the stamp
  on a stale one.
  **THE ROWS ARE AN M3 SEGMENTED LIST FROM 2026-08-25, and it costs the panel that one screen.** A
  reader asked for the component. `.mseg` in `css/chrome.css` is M3's list at
  `appearance: segmented`: a filled container per row, a 4dp inner corner, and the 16dp outer one on
  the group's first and last row alone. Measured on a 13-place list: 1272px on a desktop and 1192 on
  a phone, against about 550 before, and a pane `scrollHeight` of 1748 against a 688px pane. **So
  the claim above that the whole panel fits a screen at any size of flood is no longer true**, and
  the sentence stays because it is the property somebody chose and the one to weigh against.
  Rows grow past M3's 72dp two-line item because the NAME wraps. A 299px row spends 32 on padding,
  24 on the glyph, 32 on two gaps and up to 90 on the reading, which leaves about 128px for a name
  at `body-large`. `SUNGAI DAMANSARA` needs about 150. **Three ways to shave it were measured and
  none shipped.** An 8px in-row gap saves 80px of 1272, that gap with a 12px inset saves 120, and
  `body-medium` on the headline collides with the supporting line, which is `body-medium` already.
  This file's own rule is to transcribe the component rather than approximate it. **The two real
  fixes both change the row rather than the numbers**: move the reading's second line into the
  content slot, which is M3's three-line item at 88dp and frees about 40px of name width, or cap the
  rows the panel draws and count the rest.
  **One divergence, and it is older than the component.** M3 paints the leading glyph
  `on-surface-variant`. This app paints it with the TIER colour, the same one the card's left rule
  carries, so the rule and the glyph say one thing.
- **THE HEAD'S CHIPS ARE M3 ASSIST CHIPS AND THEY ARE LIFTED. A GROUP HEAD IS NOT A CHIP.** The
  head's counts and the ordering line draw `.badge` under `#sideKinds .badge`. The repository owner
  asked for the head on 2026-08-25 and cut the group's own chip the same day.
  **The head's row is `.badges`, and that class is what makes `openSide()` lift it.** That function
  moves `:scope > .badge, :scope > .badges` into `#sideKinds`, the app bar's chip line. So the alert
  head reads as a station card does: a headline over a row of chips.
  **`.tally` was neither, and the seam paid for it.** That row stayed in the body, so `.pophead`
  never emptied, so `openSide()` never removed it, and an empty seam still draws its own bottom
  margin. **A chip correct in every pixel that stays in the body is still wrong**, which is why
  `m3-check.html` reads the count out of `#sideKinds` rather than off the card.
  **The colour splits M3's way and the label is NEVER painted by the status.** `on-surface` on the
  label, the status hue on the 18dp leading icon alone. A count whose number wears the status reads
  as a reading, and a count of stations is not one.
  **`.tally b`'s contrast expression went with it and `.state` still needs one.** That pill set
  `color-mix(in srgb, var(--c) 70%, var(--on-surface))`, because a 12px number in its own colour on
  a tint of itself starts under 4.5:1. A chip puts its label on the page instead. `.state` in
  `css/base.css` is exactly the old shape and keeps the expression.
  **`Nearest first` had to LEAVE the title to become a chip.** It was `· nearest first` inside
  `.popname`, and `openSide()` lifts that element whole into the headline. A 32dp chip inside a
  headline is not a chip. It carries `--muted` and no status hue, because it states how the rows are
  ordered rather than what is in them, and it comes last because the counts are what a reader scans.
  **Emit the row only when it holds something.** An empty `.badges` is still a child, so
  `#sideKinds:empty` fails to match and the app bar keeps a line for nothing.
  **THE TIER TAG IS THE ONE PILL LEFT AND IT IS NOT AN OVERSIGHT.** `HAPPENING NOW`, `HEAVY RAIN`,
  `FORECAST` and `NOT CURRENT` are ALL-CAPS blocks, which the writing rules in this file name as a
  deliberate visual language rather than as messages. An M3 chip is `label-large` with
  `text-transform: none`, so making one drops the caps. That is a decision about this app's own
  language, not about the component. Do not convert it without asking.
- **AN ALERT GROUP IS A SUBHEADER OVER A LIST, AND IT DRAWS NO SHELL AT ALL.** The head is `.nsub`,
  the M3 list SUBHEADER the Notices pane already draws: `title-small` in `on-surface-variant` at
  48dp with a 24dp leading glyph. One component and two panes, so the numbers are stated once.
  **The kind chip is gone, and it stated the kind a THIRD time.** `Water level` sat over a heading
  reading `Water levels at danger`, over rows that all carry the water-drop glyph. `.alert .badge`
  has no user left, so `#sideKinds .badge` is the whole selector again.
  **THE HEAD CARRIES NO GLYPH EITHER, AND THREE SHAPES WERE TRIED BEFORE TEXT WON.** A tier-coloured
  glyph stated the tier a third time in the head, right after the left rule was cut for doing exactly
  that. A neutral one still repeated the mark every row under it already carries. An `avat()` disc,
  the one a sensor row and a bulletin draw, made a 40dp mark out of that repeat. The repository owner
  cut all three on 2026-08-25. **M3's list subheader is a label and nothing else**, so text is the
  component rather than a divergence from it. Do not put a mark back without asking.
  **The Notices pane KEEPS its glyph, so nothing here may be written against a bare `.nsub`.** That
  selector reaches both panes. `.nsub .i` styles the Notices glyph and the alert head simply has
  none, which is why no alert rule exists for it.
  **The coloured left rule is gone, and it stated the tier a third time.** Every row's glyph takes
  the tier colour, so the group states it down the LIST rather than down its own side.
  **So the tier is stated twice in the head and once per row**: the tag's word, the tag's own tint,
  and each row's leading glyph. **The divider above each group went the same way**: this pane separates by space,
  which the Notices pane already obeys, and `.nsub` carries its own 12px top margin.
  **Both are the argument the Notices pane made first**, one pane over, when it dropped its own card
  shell: a shell states the category three times, as a rule, a heading glyph and a heading word.
  **The tier tag is NOT that rule in another shape.** The rule was colour, and colour alone is a
  code nobody was taught. The tag is the word, and it is the only thing that tells `HEAVY RAIN` from
  `FORECAST`, since those two share one amber.
  **`.tg`'s own 6px left margin is cancelled inside the subheader.** That number was written for a
  tag following an inline title. `.nsub` is a flex row with M3's 16px gap, and the two stacked to
  22px.
  **The subheader WRAPS rather than squashing.** A 302px row holds a 24px glyph, a title of about
  150px and a tag of about 100px with 16px gaps. `Water levels at danger` beside `HAPPENING NOW`
  takes two lines and the subheader grows to 64px.
  **Assert a deletion, or a half-finished revert ships markup that draws and errors nowhere.**
  `m3-check.html` reads the chip count inside `.alert` as 0, `.alerttop` as absent, and both border
  widths as `0px`.
  **Anything asserted against a SECOND element has to survive that element being deleted.** Two
  assertions in that file broke here. One compared a row glyph against the card's `borderLeftColor`,
  and on a border-less box that property answers the element's own `color`, so it compared the tier
  red against the body ink and failed on markup that was right. The other compared the head chip's
  ink against `.alert .badge`, and `getComputedStyle(null)` THROWS rather than fails — that one took
  155 assertions with it while the verdict still read a single failure.
- **`.mseg` is SHARED, and the hoist out of `#settingsBox` is a specificity trap.** Two surfaces
  draw M3's segmented list: the two saved lists in Settings and every alert group. The numbers are
  stated once in `css/chrome.css` and each surface states only what it diverges on. `#settingsBox`
  keeps `cursor: default` and no state layer, because a saved row is static and its trailing button
  is the action. An alert row opens a station card, so it keeps the pointer and the layer.
  **An unscoped `.mseg > li` is one class and one element, and `.picklist li` beside it is the
  same.** So source order alone decides, and a change to either file can move Settings with nothing
  on the alert side to show it. `m3-check.html` measures a Settings row inside the alert block for
  that reason.
  **That row is INJECTED, not found.** A reader with no favorites leaves the list holding `li.none`
  alone, and a loose `.mseg > li` search reaches the Developer group, whose rows carry `padding: 0`
  because the `.mrow` button inside them carries it. The check read that row first and failed on
  markup that was right.
  **The hover state layer sits OVER the container, never instead of it.** The accent tint the rows
  had answers a row with no fill under it. A tint painted in place of the container makes a hovered
  row look like a row from another list.
- **`alertPane()` in `m3-check.html` runs AFTER `desktop()`, and the order is load-bearing.** It
  switches transitions off in the shared `#desk` frame, and `desktop()` reads its motion
  DECLARATIONS before its own `settle()`. Called first, this probe answered every one of those with
  `none`, and **16 assertions failed on markup that was right**. That file's own header states the
  rule, and this is where it bites. Anything new added to that runner that settles a frame goes
  after the block that reads motion out of it.
- **`title` is not a tooltip on a phone.** It never opens on touch. It waits about a second on a
  mouse, and takes no styling. So anything whose meaning lives in a `title` means nothing on half the
  devices this runs on. That is why the camera warning prints its words on the picture (`Water level
  3.42 m`). It is why the table uses a `popover` panel instead. And it is why a new affordance that
  needs explaining needs it *on screen*.
  **THERE IS NO `title` ATTRIBUTE LEFT IN THIS APP, AND THAT REVERSES THE EXEMPTION THIS ENTRY
  CARRIED.** The rule used to allow one as a duplicate of something already visible, and named the
  jump hint on an alert row and the count on a chip. The repository owner cut every one on
  2026-08-26. Two reasons, and the second is what the exemption missed. A duplicate `title` says
  nothing new, so deleting it costs nothing. And beside `data-tip` it draws a SECOND tooltip shape
  for one control, at a different delay, in the operating system's own colours. `#locate` shipped
  exactly that: a native tip at rest and a styled one after a failed fix.
  **`data-tip` is the one channel, and `js/sparktip.js` is the one reader.** It answers on hover and
  on tap alike. Every control that carried a `title` already carried an `aria-label`, so nothing was
  lost to a screen reader. Anything that needs both keeps them apart for the reason `paintSpeed()`
  states: a tip carries the key binding, and an accessible name must not.
  **A `title` that only repeated visible text was DELETED rather than converted.** `Show <name> on
  the map` sat on four visible station names and `Sort by <label>` on a visible column head. A
  styled tip repeating the words under the pointer is noise, and on touch it parks until the next
  press elsewhere — over the card that press just opened. The table's `.gline` lost one for the
  stronger version of the same reason: that element already opens the table's own hover panel.
  **Leaflet writes the last two, and `js/map.js` takes them off after `addTo()`.** The zoom buttons
  sit on the map beside `#locate`, which draws a styled tip, so the pair disagreed at the one place a
  reader meets them together. It is not patched into `vendor/leaflet.js`: that file already carries
  three edits this app has to keep, and a fourth for a cosmetic rule is one more thing a version bump
  loses. Leaflet writes its own `aria-label` beside the `title`, and writes both once.
  **A grep in the Verify block is the guard, and a rendered-page read is the second half.** A `title`
  costs nothing to add and nothing on screen says it is there. The grep covers the app's own files.
  Only the rendered page covers a vendored library writing one at runtime.
  **The nearest-webcam offer tested this rule twice, and lost once.** It spent one revision as a
  corner glyph with the camera name and distance in a `title` alone. That is a fact a phone cannot
  reach, and the fix was a different control rather than a better tooltip. It is a glyph again since
  2026-08-26, with the same words on `data-tip`, which is the attribute that answer needed.
- **A timestamp is printed inside a ⋮ menu and nowhere else.** `sourceInfo()` does it for a sensor.
  `wxDots()` does it for the weather section, the only other reading on a card. Three
  facts ride there, all about the plumbing. Are we hearing from this station? What was the stamp on
  the last thing it sent? Which of the three feeds won? None of them changes what the water does. As a
  footer line they repeated per sensor down a six-sensor mast. They are what you check when you doubt
  the number, so they sit where you go to look. The stale state blocks (siren, rainfall, gauge) print
  no time at all. **The stamp is printed at the precision its age needs, and `stamp()` in `popup.js`
  is the one rule.** A reading taken today is answered by its clock. A reading from any other day is
  answered by its date. This reverses what stood here. That said elapsed time was appended only on
  a stale station. The reason given was that on a live one the date is the answer. The live case is the one where
  the date says least, since it is today on every live station. `Updated 14/08/2026 15:45` spent
  ten characters saying so. The stale case was worse. `Last reported 19/09/2025 12:15 · 7892.0h ago`
  put a minute hand and an elapsed figure on a sensor eleven months dead. Four stations in the
  payload are past 6,500 hours. **Elapsed time is gone from both callers**, and `ago()` was
  deliberately **not** given a unit above hours to fix `7892.0h`. This was its only caller that can
  overflow. The two that remain (`clip.js`'s frame age, `net.js`'s poll clock) stay inside
  the range it was written for. A day unit there is unreachable code. The same-day test is a
  `startsWith` and not a parse. JPS stamps `DD/MM/YYYY HH:MM:SS` in MYT and `en-GB` formats a date
  the same way. So one expression reads both that string and MET's unix instant. Seconds are trimmed
  for display by `noSec()`. The underlying string stays verbatim, so `parseMY()` is unaffected. It
  has no caller in `popup.js` any more, and `js/clip.js` is the module that still uses it. **The
  glyph names what is in the menu, and it has changed twice on that one rule**. It was a ⋮ over a
  single "ignore" item, which promised actions and held one. So it became an ⓘ when the provenance
  moved in. It is a `more_vert` ⋮ now. The menu also carries the favorite, the nearest webcam or
  water level, the map link and the ignore. Four actions is not an information glyph. Count the
  actions before changing it again. **A sensor's own menu holds three of those four now, and the
  card HEADER's menu holds two.** The favorite left it on 2026-08-21 and the nearest-webcam offer on
  2026-08-26. Both are buttons in the app bar's trailing actions.
- **A marquee needs three things measured, not guessed.** `js/ticker.js` renders the item set twice
  and translates `-50%`. That shows no seam only if one copy is at least as wide as the box. So it
  repeats the set to cover the box *before* doubling. Width alone is not enough. A single wide item
  still pops, because the tile leaving the left edge is the whole strip leaving. `MIN_TILES` (3)
  guarantees a follower. And `#ticker` must have a **fixed flex basis**. Sized to content, the
  header re-laid itself out every poll as the alert count changed.
- **`border-collapse: collapse` drops padding on the table box** — `#netstats` uses `separate`.
- **leaflet.heat sizes in screen pixels.** `heatScale()` converts a layer's ground distance to
  pixels per zoom so blobs stay ground-fixed. Do **not** also call `heat.redraw()`. The plugin
  repaints on the following `moveend`, and doing both painted twice per zoom. Radius is capped at
  `HEAT_MAX_PX` because blur cost is quadratic. Past that cap the layer *fades out* rather than
  quietly covering less ground. The fade is per layer because the cap is. `maxZoom` on the layer
  is **not** a display limit. It divides every weight by `2^(maxZoom − zoom)`, so anything inside
  the usable zoom range dims blobs as you zoom out. Pinned to 0.
- **A blob is painted `radius + blur` across, not `radius`.** The two must sum to the ground
  distance. They must never be set apart from each other. simpleheat's `radius(t, i)` fills an arc of
  radius `t`. It blurs that by `i`, then stamps a sprite of half-width `t + i`. `heatScale()` handed
  `radius` the whole of `HEAT_KM` and added `blur = radius * 0.8` on top. So every blob on both
  layers reached 1.8× its stated size and covered 3.24× the area. One rain gauge reading 19 mm/h
  washed 250 km² of Kuala Lumpur violet, over twenty gauges reporting 0.0 mm. The nearest of them was
  1.6 km away. **Three places asserted the 5 km and the code painted 9.** They are the constant's
  comment, `heatScale()`'s own comment, and `thinHeat()`. That last one drops a weaker neighbour on
  the claim that the stronger point's blob already covers it. That last one is the compounding fault. Thinning
  at 5 km while painting at 9 let every pair between the two distances stack its alpha. That is the
  bug `thinHeat()` exists to prevent, moved out one ring. **`SoftHeat._redraw()` paints the blobs
  itself now and never draws that sprite.** So the trap is gone rather than tuned. One `blobPx()`
  is the radius, `thinHeat()` takes the same ground distance, and `HEAT_MAX_PX` bounds what it
  names. The `radius` and `blur` options stay in `BASE` only because `_updateOptions()` builds
  `_grad` from `gradient` in the same call, and `_grad` is where the colours come from.
- **"Gauge" in the rain heat entries below means a rainfall station.** This is the one place two
  kinds share a word. A rainfall station measures `hourly` in mm/h. It is the only kind the rain
  layer reads, on both sides of the argument. `render.js` gates every one of them on
  `kind === 'rainfall'`. A **flood gauge** is the kind spelled `gauge`, labelled `Flood gauge`,
  measuring `depth` in metres over a flood-prone spot. It feeds the **water level** layer beside the
  rivers and no rain rule touches it. The collision is not theoretical. The JPS field notes above
  record that a flood gauge reading negative means **dry ground**. So "a dry gauge" reads two ways. It is a
  rainfall station saying 0 mm/h in one entry, and a flood gauge on dry land in another. Name the
  kind in any sentence that reads both ways.
  **A flood gauge is never evidence about rain, in either direction.** It measures what the drainage
  failed to carry away, which is not what fell. Where the drainage is good, rain falls as hard as
  anywhere and the gauge stays clear. Where runoff arrives from upstream, the gauge goes under with
  no rain overhead. **So a clear flood gauge must never join `dryPoints` and deny the wash, and a
  submerged one must never paint.** Only a rainfall station reports rain. Checked on the current
  tree: no rain conclusion reads `depth`, and `rainBacked()` tests the station's own
  `cumulativeRainfall` odometer rather than any gauge. Keep it that way. The tempting mistake is to
  read a dry flood gauge as proof that the rain layer overclaims. Good drainage is the
  whole reason it is not. The siren already obeys the same rule from the other side. Flood gauges are not backing
  evidence there either.
- **A rain gauge reporting zero is a reading, and the rain heat layer draws it.** The network says
  two things: 12 gauges reporting rain and 218 reporting none, on the payload this was built from.
  The layer used to draw only the first. So the wash covered ground that 218 stations had
  already measured and found dry. `SoftHeat` in `js/heat.js` runs the second pass for this reason. It
  paints the wet gauges, then runs a second pass in `destination-out`, stamping a soft brush at every
  dry one. **`RAIN_KM` (6 km) is one number and covers both readings.** A gauge reporting rain
  paints that far and a gauge reporting none erases that far. Two numbers stood here first, 9 km of
  paint against 4 km of erase. There is no defending that. It is the same instrument, the same
  minute and the same question. So the answer "none" cannot carry less ground than the answer
  "12 mm". Symmetry cost 4% of the painted area, 2,005 km² against 1,906. **Do not split them
  again.**
  **The number itself was 9 km until 2026-08-14, and the evidence for 6 was already in the file.**
  The co-wetness study in `config.js` puts the halving distance at 6 km and the background rate at
  12. So 9 was the outer edge of a claim that survives, rather than the middle of one. A convective
  cell here is 1 to 2 km across. **Moving it moves four things at once**: the paint, the erase,
  `thinHeat()`'s spacing and the blob. It also changes gauge spacing *measured in blob radii*, which
  is what `FEATHER` is sized against. Thinning at a shorter distance keeps gauges that are
  relatively further apart. The 90th-percentile join went from 1.48 radii at 9 km to 1.66 at 6.
  **The first fix used 4 km as the blob size instead, and it is the wrong shape of answer.** A
  smaller brush charges the same ground everywhere. That includes Sabak Bernam, where the nearest
  other gauge is 12 km off and nothing disputes anything. It cost three quarters of the map's area
  to fix a problem that only existed where a dry gauge stood. Measured: 2,747 km² before, 503 km²
  under the small brush, and 1,906 km² now. 58 dry gauges sat under paint before and 1 after.
  **Three details are load-bearing and all three were found by running `heat-test.html`, not by
  reading the code.**
  **simpleheat leaves `globalAlpha` set.** Its draw loop assigns each point's weight and never puts
  it back. So an eraser inherits the last blob's weight and removes that fraction rather than all of
  it. A 0.9 blob left 22 of 229 alpha on a dry gauge. The pass runs inside `save()`/`restore()`.
  **A gauge reporting no rain reaches exactly as far as a gauge reporting rain.** The boundary
  between two that disagree is halfway between them. Both rules are old. The `destination-out`
  stamp that carried them held the second alone, and it bought that by breaking the first.
  Its radius was one scalar, `min(r, nearest_wet / 2)`, applied to a circle. So a dry gauge with a
  wet neighbour to the east shrank in **every** direction. That included west, where nothing
  disputed it.
  Measured on the live network: 143 of 191 dry gauges capped, at a median of 0.54 of the radius. They
  denied 35% of the ground they were entitled to deny.
  `_field()` decides it per pixel now and the stamp is gone. `keep = 1 - dcov * gate`, where `dcov`
  is the dry coverage shaped exactly like `cov`. `gate` is inverse-square distance to each side, which
  is Shepard's weighting, chosen for the one property that matters. **A gauge's own point is a
  singularity.** So the gate is 0 at a wet gauge and its reading survives whole. It is 1 at a dry
  gauge. It is 0.5 exactly halfway between the two, and 1 with no wet gauge in reach. The protection and
  the reach come from the same expression instead of fighting each other. Measured after: 77% of the
  wet reach kept against 96% under the cap. Only 2 of 193 dry gauges are left under paint. Both
  of those share a pole with a wet gauge.
  **The cap existed for a real reason, so keep the reason when touching this.** A dry gauge on the
  same pole once erased its neighbour off the map outright. A wet gauge 2 km from a dry one lost
  half its alpha. `heat-test.html` asserts the wet gauge keeps 229 of 230 with a dry gauge 1.5 km
  away.
  **The brush holds full strength over its first 15%.** That is now `FEATHER`'s flat core, and once
  a gradient stop. A ramp peaking at the exact centre honours the reading at a mathematical
  point, and no pixel is one. The gauge kept 5 of 206 alpha on a half-pixel sampling offset. Do not
  replace any of this with interpolation. A dry gauge can deny
  ground, never supply a value. See `docs/FEATURES.md`, *The rainfall heatmap claimed rain over
  250 km² from one gauge*.
- **NEITHER HEAT WASH FOLLOWS THE THREE-COLOUR RULE, AND THAT IS SETTLED.** The repository owner
  ruled on 2026-08-26, when the rule reached every other surface that draws a reading. Four things
  keep the old four-rung ladder: the two gradients in `js/heat.js` and the two `#legend .ramp` rules
  in `css/chrome.css` that describe them.
  **A wash paints GROUND and a pin names a SENSOR.** The rule exists because a reader scanning four
  hundred marks cannot learn a six-ramp code. A wash is one continuous field, read against a legend
  standing beside it rather than against the mark next to it. So the argument for folding rungs does
  not reach here.
  **The cost is real and is accepted.** At JPS's heavy class the rainfall pin is amber and the blob
  under it is violet. On the water layer the pin folds the warning mark into the alert amber and the
  wash still paints it orange. Only the legend says so, and both tips now name that split.
  **Do not "fix" this by copying `RIVER_COLOR` or `RAIN_COLOR` into a gradient.** Anything that moves
  a gradient moves its ramp in the same change. `RAIN_HEAT`'s own comment in `js/config.js` holds the
  argument once, and every other site points at it.
- **A heat blob's alpha is its colour as well as its size.** So the brush's own falloff walks down
  the legend. simpleheat's `_colorize()` looks the gradient up by alpha. The stock brush fades
  across most of a blob. So one rain gauge reading 27 mm/h, JPS's *heavy* class, painted heavy at
  the gauge. It painted moderate 4 km out and light 6 km out. That is three classes from one number, with a
  legend beside them naming those colours in
  millimetres. In IDW or kriging a value falls off because the estimate falls off. Here it fell off
  because that is how a brush is drawn.
  **So `SoftHeat._redraw()` in `js/heat.js` paints the blobs itself and never calls `_colorize()`.**
  It reads the class colour out of `_grad`, the 256-entry ramp simpleheat builds from
  `options.gradient`, so the legend stays the one definition. It draws each blob in that **one**
  colour with only its alpha ramping. The alpha holds full strength across an inner core before
  it smoothsteps out. Measured on one gauge at 27 mm/h. One hue runs from the centre to 8 km, with alpha
  falling 182 to 20. A river at its danger mark paints `#ff4e4d` across its whole 5 km, 255 to 0.
  **Two shorter fixes were built and thrown away, and both are worth not repeating.** Cutting the
  sprite's blur to 0.04 got one class per blob and drew hard discs. Softening those back with a
  `destination-out` pass got the look and broke the neighbours. A `destination-out` brush is a claim
  about the canvas, not about one blob. So each blob's own feather ate whatever its neighbours had
  painted under it. Measure two gauges one blob apart, the closest `thinHeat()` ever
  leaves them. **Each centre was erased to alpha 5 of 177 by the other one's feather.** The
  ground between them stacked to 200 in a class neither gauge reported. Painting is additive over a
  neighbour and erasing is not, so a fade has to be painted. After the rewrite the same two gauges
  hold 179 at both centres, one hue end to end. The largest step between 1 km samples is 53
  inside the smooth falloff, against 172 before.
  **And the layer computes a field rather than stamping shapes, because two readings are not twice
  one reading.** Every Porter-Duff `over` adds alpha. So two gauges reading the same rain over the
  same ground came out heavier than either reported. Two 179 blobs met at 227. No composite
  operation blends colour while taking the *larger* alpha. So `SoftHeat._field()` asks the readings
  per cell instead. `v` is the blended reading, every gauge in reach weighted by nearness and
  **normalised**. So two gauges reading the same thing give that thing back. `cov` asks whether any
  reading reaches this ground at all. That carries the soft edge, and is why an isolated blob fades
  while an overlap does not brighten. Colour is `_grad[v]`, opacity is `v * cov`. Measured on
  two gauges one blob apart, both at 0.70. Alpha is 179 flat end to end. The largest step over a
  kilometre is one count. One at 0.95 and one at 0.35 walks `#f35772` to `#7b7bff` with alpha 242 to
  89. The smoothness between neighbours is the browser's bilinear filter on a 4 px grid. Raise
  `CELL` and the edges go blocky. Lower it and the cost climbs with the square.
  **`cov` is a union, and it must never go back to a max — that is a Voronoi border.** A cell asks
  two questions and one curve cannot answer both. So `BLEND` (0.45) sizes each reading's say in the
  mean and `FEATHER` (0.75) sizes the coverage. One curve served both at first, joined by `max`, and
  that failed twice over. `max` follows whichever gauge is nearer, so its slope flips sign on the
  equidistant locus, which is the Voronoi edge. A sign flip is a crease, and the eye reads a crease
  as a line. The blend weight is also down to 0.30 at 0.8 of a radius. That is right for a weight and
  far too steep for coverage. `thinHeat()` guarantees one radius between two gauges and no more.
  Measured on two gauges reading the same 0.70, against 179 at each of them: 107 between them at 1.4
  radii, 61 at 1.6, 20 at 1.8. An unequal pair states it more plainly. 0.95 and 0.35 painted 242 and
  89 with **54 between them**. A midpoint darker than both ends is a border, not a transition.
  The replacement is a **clamped sum**, and it cannot pass 1. So an overlap still never paints
  brighter than a gauge centre. After it, 179 flat at 1.13 and 1.48 radii, and the unequal pair
  walks 242 → 149 → 89.
- **A rim facing empty ground and a join between two blobs are different edges.** Only the combine
  can tell them apart. `FEATHER` is one radial curve, so lowering it to soften the rim hollows out
  every join by the same amount. Measured, 0.75 to 0.50 under a union took the share of solid joins
  from 84% to 45%. The combine sees something the curve cannot: how many readings arrive. A rim has
  one and a join has two. So `cov` sums the per-gauge coverage rather than unioning it. One gauge at
  half strength stays half covered, and two blobs meeting at half strength each add up to covered.
  **The clamp is `1-(1-s)²` and not `min(1, s)`.** A bare clamp breaks its first derivative where it
  bites. That is a crease along an iso-contour, the Voronoi fault on a different line. Squared has
  slope 0 at s=1. It is also the highest power that still fades the rim gently. A higher one
  holds full opacity further out, and hardens the edge it exists to soften. That bought `FEATHER` at
  0.50 while `RAIN_KM` was 9. The rim fade went from 1.38 km to 2.20 km with a 34% gentler slope.
  **It sits at 0.20 now, and the value only means anything beside `RAIN_KM`.** A 6 km blob at 0.50
  fades over 1.47 km. That is less gentle in metres than the 9 km blob it replaced. At 0.20 it
  fades over 2.35 km, at a slope of 0.413 per km. That is gentler than the 9 km layer on both counts. The
  cost is stated in the next line and is real.
  **A 6 km blob with a 2.35 km rim does not merge into one sheet. That is arithmetic, not a fault.**
  A join at the median spacing holds 178 of 179. At the 90th percentile the two gauges are 10 km
  apart. Each blob stops 3 km short of the ground between them, and the midpoint reads 74.
  The softest tenth of joins sit near that. Measured at 1.21 / 1.48 / 1.66 / 1.95 radii: 178, 133,
  74, 2. **Raise `FEATHER` to trade rim softness back for a solid wash, and re-measure both.** The
  two cannot both be maximised, because one curve reaches the rim and the ground between gauges
  alike.
  **Read gauge spacing off the station geometry, never off the gauges reporting rain.** The wet set
  changes with the weather. Two snapshots an hour apart put the widest overlapping pair at 1.58 and
  at 1.90 radii. One sweep scored the same candidate at 71% and then 11% with no code change
  between. Thin *every* rain gauge instead. **Two populations answer two questions and their
  percentiles differ**, so name which one a number came from. The first is nearest neighbour, which
  is where a seam shows first and where `heat-test.html` takes its probe distances. At `RAIN_KM` 6
  that is 82 pairs, median 1.21 r, p90 1.66 r, widest 1.95 r. The second is every overlapping pair,
  which is what join solidity is scored over. Any two blobs that meet can show a seam. That is
  143 pairs, median 1.54 r, p90 1.89 r.
  The Verify block prints both. A constant tuned against one snapshot is tuned against one
  afternoon's rain.
  **The bucket index in `_field()` is load-bearing, not tidiness.** Without it the cost is cells
  times readings. `thinHeat()` packs readings one radius apart, so zooming out shrinks the
  radius and multiplies the readings together. Measured on a full viewport at that spacing: 52 ms at
  30 readings, 785 ms at 638, and 3.0 s at 2,655. Bucketed, it is a flat 33 to 38 ms at every one of
  them. A flood is when a lot of stations report at once and when the map must not seize.
- **The denial touches alpha and never colour, and that survived the move out of `destination-out`.**
  A dry reading denies the ground, not one neighbour's contribution to it. The old pass ran last, so
  a denied edge faded at the colour already settled beneath it. `_field()` gets the same result by
  construction rather than by ordering. Hue is `_grad[v]`, `keep` multiplies only the alpha, and `v`
  never sees a dry gauge at all. **Do not let a dry gauge into `v`.** It restates the rainfall
  as a lighter class, which is the thing this layer exists not to do. With `BLEND`'s flat core a
  dry gauge 2 km away carries equal weight and halves the reading. A dry gauge can deny ground and
  never supply a value. `heat-test.html` asserts the hue at three radii and across a denied boundary.
- **A canvas radial gradient clamps past its last stop, so never `fillRect` one.** Beyond `r` the
  gradient does not stop. It keeps painting whatever the outermost colour was. The old eraser's
  outermost colour was full erase. Filled as a square, the four corners outside the
  circle are 21% of the box. They erased everything under them, **including the paint belonging to
  the next blob along**. `thinHeat()` places that blob exactly one blob away, and therefore right in that
  corner. It drew as hard rectangles cut out of the wash, axis-aligned and about 2r on a side. That
  reads as a tiling fault or a canvas-tile seam, and is neither. It went unseen for weeks first,
  because the *erase* clamps to transparent and clamping to "no erase" is invisible. That is luck,
  not design. **This layer stamps nothing any more.** `_field()` computes every pixel, so there is no
  sprite and no disc left to get wrong. The `stamp()` helper that guarded the trap went with the
  pass. Anything that brings a gradient back needs it back too.
  `heat-test.html` still puts a second gauge 1.2 blobs away on the diagonal. That is outside the first
  blob's circle and inside its square.
- **Switching a heatmap off used to freeze the whole map, and the reason is one missing null check
  in the vendored layer.** `redraw()` in `vendor/leaflet-heat.js` reads `this._map._animating` with
  no guard, and Leaflet nulls `_map` on remove. The first add builds `_heat` and nothing tears it
  down. So `!this._heat` short-circuits for a layer that was never added, which is why this hid for
  so long. Add a layer and then remove it, and the same call throws. **`render()` calls
  `setLatLngs()` on both heat layers on every poll, and `setLatLngs()` ends in `redraw()`.** So the
  next poll after switching a heatmap off threw partway through `render()`, and every line after it
  stopped: the markers, the cluster and the alert panel. The map froze on its last good
  poll until somebody reloaded, with only `js/oops.js` to say why. `SoftHeat.redraw()` in
  `js/heat.js` bails when there is no map. **The fix is app-side on purpose**, so the vendored file
  keeps its three patches as the only edits to it. `heatScale()` states the same rule from the other
  side, with `map.hasLayer()`. Anything new that calls into a heat layer needs one of the two.
- **`heatScale()` must only size a layer the map holds.** `setOptions()` ends in `redraw()`,
  which reads `this._map._animating`. Leaflet nulls `_map` when it removes a layer. So sizing a
  layer that is off throws a `TypeError`. It hid for a long time. The layer that is off has
  usually never been added. A layer with no canvas returns from `redraw()` one test earlier.
  **Switching the heat chip from rainfall to water is what reaches it.** That leaves `rainHeat`
  added-then-removed, holding a canvas and no map. `syncHeat()` adds and removes before it calls
  `heatScale()`. So a layer just switched on is on the map by then, and still gets sized.
- **The water layer has no denial and must not get one, and everything else it shares.** Both layers
  are `SoftHeat`. So the field render, `BLEND`, `FEATHER`, the clamped-sum coverage and the bucket
  index are one implementation and reach both. Only `setDry()` is called on one of them, from
  `render.js`. **A river reading low says nothing about the river beside it.** A rain gauge is the
  only sensor here whose zero is evidence about the ground next to it. That is why that argument
  exists on one layer alone. A flood gauge is not that sensor either — see the drainage rule in the
  rain heat entry above. Anything added to `SoftHeat` lands on both layers. Check it against both
  before assuming it is a rain change.
- **Leaflet paints its container `#ddd` in both themes.** That is what shows through wherever a tile
  has not arrived. A zoom out has nothing to retain over the newly revealed area. So the
  missing tiles read as a grid of pale boxes on the dark basemap. `.leaflet-container` takes
  `var(--surface)` in `map.css`. Anything that changes the basemap has to keep a gap looking like
  the page rather than like a table.
- **Leaflet puts `.leaflet-touch` on its container, and its two-class rules beat every one-class
  rule in `css/map.css`.** `.leaflet-touch .leaflet-bar` sets `box-shadow: none` and `.leaflet-touch
  .leaflet-bar a` sets 30px. So this app's `box-shadow: var(--shadow)` on `.leaflet-control-zoom`,
  and its 44px phone rule for the buttons, both lost on every touch-capable browser. That is every
  phone, and any laptop with a touchscreen. Measured in headless Chrome at 360px: 30px buttons
  against the 44 the file asks for, and no shadow at all. **Both faults look like a choice**, which
  is why they went unseen. A flat zoom control reads as a style, and a 30px button reads as
  Leaflet's own default rather than as this app's rule losing a cascade. The shadow takes
  `!important`, matching the `border` declaration beside it. The size names both touch states rather
  than leaving it to Leaflet. **Anything else added to `map.css` that styles a Leaflet control needs
  the same check**: read the computed value back off the live element, never trust that the rule
  applied. `.leaflet-touch` is not in the markup, so grepping the repo for it finds nothing.
- **`maxZoom` belongs on the map, not only the tile layer.** `cluster` is created and added at
  `map.js` load time, before `setBasemap()` adds any tile layer. If nothing has declared a
  `maxZoom` by then, markercluster throws *"Map has no maxZoom specified"*.
- **The heat canvas is padded (PATCH 3), so raw container points are not canvas points.** Anything
  touching `_reset`/`_redraw` must add `_pad()` to point coords and keep grid indices non-negative.
  The flush loop iterates the array, so a negative key silently drops those blobs. `_animateZoom`
  is padded too. It writes an absolute transform, so forgetting it detaches the layer mid-zoom.
- **simpleheat's blob is a shadow, and it leaks past `radius + blur > 200`.** It draws an arc
  off-canvas and offsets the shadow back on. Stock offset is 200. So any blob wider than that puts
  the *source* arc back on the canvas. It draws as a hard-edged circle clipped by the corner. Our vendored
  copy patches the offset to `1e4`. Second reason not to overwrite `leaflet-heat.js`.
- **`?shots=` returns `[ts, tier, stationId]`, not a bare timestamp.** The reader still accepts a
  bare number: `timeline.js` guards with `Array.isArray(r)`. The response is cached for 60 seconds,
  so a deploy leaves the old shape in flight. Do not remove that fallback while the cache header
  stands. `wall.js` and `clip.js` no longer call `?shots=` at all — see the strip gotcha below.
  So `timeline.js`'s lightbox is the only reader left with this shape to guard against.
- **Two image endpoints answer for one camera, `?shot=` and `?sheet=`, and they deliberately
  disagree about how long a browser can cache them.** `?shot=<id>&t=<ts>` names one immutable,
  already-captured frame. So `Cache-Control: public, max-age=31536000, immutable` is honest, because
  that exact file never changes again. `?sheet=<id>` names the strip `buildSheet()` in `shots.php`
  builds on request. That is every frame inside the clip window, laid out side by side in one WebP.
  It is what `js/wall.js` and `js/clip.js` play instead of fetching a frame at a time (see
  `docs/FEATURES.md`). The same URL's *bytes* change under it every time `captureShots()` lays a
  new frame and the strip goes stale. That happens up to once every `SHOT_EVERY` (30 min). So
  `?sheet=` carries `public, max-age=900` instead. That is half of `SHOT_EVERY`. A reopen inside
  that window is free, and a cached strip can never outlive one capture cycle by much more. Copy
  `immutable` onto `?sheet=`. A reader who opens a camera twice in one capture window then keeps
  seeing the strip from before it. That lasts up to a year, with nothing to tell them it went
  stale. It is the exact failure the frame endpoint's own header is right to invite. The strip
  endpoint exists to avoid it.
- **`clip.start()` must stay idempotent by camera id *and* by generation.** `render()` calls
  `openSide()` on every poll for the card on screen. A clip that restarted there jumps back to
  frame 0 while somebody watches. So `start()` rebinds to the fresh nodes and keeps its place. The
  id alone is not enough. A reader can close a card and reopen the same camera before the fetch
  returns. `stop()` clears the id and the second `start()` sets it back, so both continuations
  match. `gen` catches that case. `stop()` bumps it on every call, so a stale run can never match
  again.
- **`.shotwrap` clips its overflow and holds two children.** Nothing can pin its height to one of
them. The box carries the picture *and* the `<p class="clipcap">` caption under it. `.done`
  relaxes it to `aspect-ratio: auto` so it measures both. `.shotwrap.strip` used to pin it back to
  `16 / 9`, which gives the strip `<img>` a definite box to resolve `height: 100%` against. That
  made the box exactly the picture's height. It started the caption on its bottom edge and cut it
  off. `tick()` toggles `.strip` once a lap. So the caption flashed on for the one second a lap
  spends on the live still. It vanished for the other six. **Nothing in `js/clip.js` was wrong.**
  `capText` is held at module scope precisely so a rebuild repaints it, and the text never changed.
  Two JS explanations were chased first: `stop()` blanking `capText`, and `finishEmpty()`'s
  `id = null` forcing a re-probe. Neither fires, because every camera serves a strip. The ratio
  still has to be stated. Otherwise `.shot`'s own `16 / 9` computes a height off the
  `--n`-times-wider width, and grows the picture taller per cell. So state it **on the image**, as
  `aspect-ratio: calc(var(--n, 1) * 16 / 9)`. Widening the ratio by the same factor as the width
  holds one cell at a single frame's height. It leaves the wrapper free.
  `.shotwrap.strip { aspect-ratio: auto }` is then explicit rather than left to `.done`. `bind()`
  re-adds `.strip` to a fresh `<img>` on every poll, before that image has fired `load`. The base
  rule otherwise clips the caption once per poll instead of once per lap. Anything added to
  that box gets the same treatment.
- **`position: relative` does not scope a `z-index`, so `.camtile` carries `isolation: isolate`.** A
  positioned box opens a stacking context only when its `z-index` is something other than `auto`.
  `.camtile` had `position: relative` and no `z-index`. So the numbers written *inside* a tile
  (`.camsay` 1, `.camtile::before` 2, `.camfail` 3) resolved against `#camBox`, and competed with
  the dialog's own chrome. `#camBar` at `z-index: 1` therefore drew **behind the skeleton shimmer on
  every tile**, which is `::before` at 2. That is exactly the state a tile is in while that bar is
  on screen. So the bar showed only through the 6px gaps between columns. The fix is one declaration
  on the tile, not a bigger number on the chrome. Raising `#camBar` to 4 wins one race, and leaves
  the leak for the next thing that paints near a tile. This is the mirror of the map-pin gotcha
  above, where `position` had to be *added* before a `z-index` applies at all. Same spec sentence,
  opposite symptom.
- **The lightbox reads its camera from `data-clip`, not from the clicked image's `src`.** The panel
  clip plays a strip for its archived cells (see the `?sheet=` gotcha above). It still ends every
  lap on a fresh live still. So `img.src` cycles between the strip's own URL and a `?cam=<id>` one
  every few seconds. That lasts as long as the card stays open. Matching `?cam=` against whatever
  `src` happens to show catches the camera on some ticks and misses it on others. That is worse
  than failing outright. A match that sometimes works reads as a bug in the lightbox, not as a wrong
  approach. That is what opened a lightbox with no scrubber, no compare and no warning glyph before
  `data-clip` replaced it. Only the table's "show image" button has no such wrapper, and it keeps
  the old path.
- **`.stage` is exactly the picture's box.** Nothing that sits beside the picture can live in it.
  `.ab` is `inset: 0` of `.stage` and `.abgrip` spans its full height — that is what lines the two
  A/B halves up pixel for pixel, and it holds only while `.stage` is the frame and nothing else. The
  control bar and the warning pill are therefore siblings of it, inside **`.player`**. That is the
  box both overlays are positioned against. `ui.js` injects `camWarn()` into `.player`, not
  `.stage`, for the same reason.
  **`.camfail` is the one child that is allowed, because it stands *instead of* the picture rather
  than beside it** — `inset: 0`, drawn only under `#lightbox.nopic`. That class is also the only
  thing that can give `.stage` a size of its own. A failed `<img>` lays out at 0×0, and `.stage` and
  `.player` are both shrink-to-fit. So a dead feed folded the frame, the control bar and the warning
  pill up together. It left the dialog wrapped around its title. **Do not fix that with a floor on
  `.stage`.** The box has to keep matching the picture. Otherwise every frame narrower than the
  floor draws its A/B halves out of line. `ui.js` sets the class from `naturalWidth` in one handler for `load`
  and `error`, so it lifts again the moment a later frame loads.
- **The overlay bar is the special case and lives behind a query. The in-flow bar is the default.**
  `@media (hover: hover) and (min-width: 601px)` — marked `PLAYER_OVERLAY` in `chrome.css` — is the
  only place `#tl` is absolute, white, scrimmed and self-hiding. Everything outside it is the plain
  shape. It is in flow under the frame, on the dialog surface, in `var(--muted)` / `var(--hover)` /
  `var(--outline)`, like every other control. **Do not invert this.** It was written the other way
  first: overlay by default, footer under `@media (hover: none)`. Any device that reports
  `hover: hover` when it must not then fell through to a permanent black bar on the photograph. No
  pointer can dismiss that bar. A touchscreen laptop, a paired stylus and an Android browser in
  desktop mode all report it. The safe shape has to be the one a misread lands on. Both halves of the query earn their
  place. The pointer test is there because a bar that hides itself needs something to bring it back.
  The width test is there because a phone can lie about the first one. The literal whites belong **inside** that
  block only. They cannot be tokens over a photograph. Tokens flip with the theme and the
  picture does not.
- **The seek bar is painted by `.tltrack`, not by the input.** The alert spans have to sit inside the
  bar and under the thumb, and `accent-color` cannot draw them. So `#tlscrub` is transparent
  (`appearance: none`, no track background). The rail, the played part and the spans are three
  layers below it. `paint()` writes the play position to `--p` **on the track**, not on the input.
  The pseudo-elements that read it belong to the parent. There is no tick per frame any more, and
  there must not be one again. 60 hairlines over a control you drag is a graduation. The frames
  are already an even grid, so the marks measured nothing the spacing did not. Colour is the whole
  message. A span is red or amber because a river near that lens was in trouble then.
- **The control bar's colours are literal, not tokens.** It sits on a photograph. So `--on-surface`
and `--muted` flip with the theme while the picture behind them does not. White and
  `#ffffffb3` in both themes. `--accent` is the one token that stays, on the thumb and the played
  rail. It is legible on the scrim in either theme.
- **The lightbox's warning pill belongs to the frame on screen, not to the clock.** `paint()` in
  `timeline.js` rewrites it from `tierAt`. Those are the same per-frame tiers the seek bar's coloured
  spans are drawn from. So the picture and the bar under it cannot disagree. Live is the only
  position that asks the live question. The metre figure comes from the station's `history` within
  half an hour of that frame. It is **omitted** past the 12 hours of samples the payload carries.
  That is why `camWarn()` tests `'level' in a` rather than `??`. Falling back to the live number
  there prints today's water on a picture from last week. A calm frame gets a `hidden` pill rather
  than none. So the mobile strip that `.player:has(.camwarn)` opens does not shut mid-clip and shift
  the picture 30px.
  **The pill is the lightbox's alone.** `camImg()` used to put one on the station panel's still too.
  That picture is a 3-hour clip playing itself, with nowhere to state a warning per frame. The
  card around it already gives the alerting sensor a section with the reading, the meter and the
  graph. Do not put it back there without a way to score the frame on screen.
  **Its words are `ALERT_TITLE` in `config.js`**, the same table the alert panel groups its rows
  under. They are `Water level at danger` / `Forecast to reach danger` / `Triggered siren`, with the
  reading appended where there is one. It lives in `config.js` rather than `alerts.js` because two surfaces
  read it and `popup.js` cannot import `alerts.js` (that module already imports `popup.js`). Change
  the phrase in one place or the panel and the picture start making two claims about one river.
- **The camera pill is the one alert surface that reads `atDanger()`, not `isHot()`.**
  `camAlert()` takes `isHot(s) || atDanger(s)`. So a flood gauge under water and rainfall in JPS's
  top class put a warning on the picture. `atDanger()` is what already paints that camera's
  neighbour red on the map. A clean picture beside a red pin reads as the map being wrong.
  **`isHot()` is untouched.** The alert panel, the icon badge, the ticker and the toast list exactly
  what they listed before. Widening *those* still goes through the alert design standard. Every
  kind `atDanger()` adds is observed, so it is `now`. Only a river publishes a rate, so only a river
  gets `soon`. Each kind reads its own field and unit through `CAM_READ` in `popup.js`: `level` m,
  `depth` m, `hourly` mm/h. A siren prints no figure. Its samples are 0 and 1, and an archive
  frame hands that 1 straight in. `?shots=` scores the same four kinds server-side. Otherwise the
  pill shows on the live frame only, and the lightbox opens three hours back, so nobody sees it.
  **`isHot()` covers rain in JPS's HEAVY class from 2026-08-25, and `RAIN_DANGER` did NOT move with
  it.** It stays at 60.1, the top class. `camAlert()` drops the panel's new `heavy` tier before it
  ranks anything, so the pill carries two rungs and the panel carries four. Three reasons and any
  one is enough. A glyph on a photograph has no room for a third severity, which is the argument
  that already excludes `stale` there. The pill answers the MAP's question and the map still reads
  `atDanger()` at class 4. And `?shots=` scores an archived frame against one mark, not two, so a
  wider live rule draws a pill the whole archive behind it denies. **The 0.1 is the whole of that
  constant's rule**: `rainStatus()` scores `> 60` and `frameTiers()` compares with `>=`, and JPS
  reports rainfall to one decimal. `.camtile` and `.camwarn` therefore carry no `t-heavy` rule.
- **`.abtime` must stay outside `.ab`.** `.ab` is the older frame clipped to the divider. So a label
  inside it is cut in half whenever the divider comes near the left edge. The right-hand label lives
  in the unclipped box and never is. That is what made it look like a bug. Both labels are
  children of `.stage` now, and `#lightbox:not(.cmp) .abtime` does the hiding that `.ab[hidden]` did.
- **The opening play delay is cancelled by `stop()`, and that is the only guard it has.**
  `openTimeline()` parks the scrubber three hours back and starts the clip two seconds later. Every
  deliberate move — a step, the scrubber, the compare button, `reset()` — reaches `stop()`, which
  clears `lead`. Anything new that means "I am looking at this frame" must go through `stop()` too.
  Otherwise it is carried off that frame two seconds after landing on it.
- **A range segment holds two labels, and `setRange()` must never write over the button itself.**
  The short label is `.tls`, the long one `.tll`, and the pill grows because the CSS transitions each
  from `width: 0` to `width: auto` — which is only animatable because `interpolate-size:
  allow-keywords` is set on `.tlr`. Setting `b.textContent` removes both spans. The control then goes
  back to jumping on every click, with nothing in the console to say why.
- **A claim about what the app does not do needs a check that lists what it does do.** The About
  pane once said "It loads nothing from a third party." A grep for known CDN prefixes verified it:
  `https?://(cdn|unpkg|jsdelivr|fonts\.googleapis)`. That pattern matches only a host starting `cdn`
  right after the scheme, so `basemaps.cartocdn.com` passed clean on the wrong letters alone.
  `js/map.js:24` fetches tiles from that host on every pan and every zoom. The Credits block in the
  same pane already named CARTO for exactly those tiles. The claim shipped false anyway. The host
  is `server.arcgisonline.com` now and the lesson is unchanged. A guess at
  what a violation looks like proves nothing. The check must list every absolute URL the code
  contains, then classify each one as fetched or merely linked. Any future "we send no X" or "we load
  nothing from Y" sentence needs that same full sweep. A short grep aimed at known offenders is not
  enough.
- **A value read back out of the cache must default inside one function.** That is the function
  every cached read passes through, not each call site. `?force=1` stamps `forced: true` into the payload it triggers,
  and that payload is what `.cache.json` stores afterward. The first fix defaulted
  `forced`/`forceWhy` back to false inside `serveCache()` alone. Every ordinary poll that read
  through the other cached-read exit kept reporting `forced: true` for five minutes after any real
  force. See the `fastcgi_finish_request` gotcha above for that exit. The working fix moved the
  defaults into `cachedPayload()`, the one function both exits call before they echo anything to a
  browser. A flag two exits can both return needs one default both of them share, not a copy pasted
  into each.
- **`cacheAge` and the payload `ETag` are one repair, and neither half is safe to ship alone.**
  `cachedPayload()` used to end `['forced' => false, 'forceWhy' => null] + $j + ['cacheAge' => ...]`.
  The array `+` operator in PHP is left-biased. `$j`, the stored payload, already carries a
  `cacheAge` key, and the rebuild write sets it to `0` every time. So the computed value on the
  right never survived the merge, and every cached read reported `cacheAge: 0` however long the file
  had sat. The status popover reads that field to say whether a poll came from JPS or from the file
  cache. So it said JPS on every poll. `cacheAge` sits on the LEFT now.
  **The `ETag` was stable only because of that bug.** `payloadValidators()` hashed the whole body,
  and a field frozen at `0` is a field that cannot move a hash. Repair `cacheAge` by itself and a
  rising number changes the body every second. That changes the `ETag` every second, and the `304`
  in `sendPayload()` stops firing. Nothing errors. A validator that never matches is not a failure.
  It is a full 33 KB body on every poll, for as long as a tab stays open. The `payloadEtag()` helper is the other
  half. It blanks `"cacheAge":N` to `"cacheAge":0` before hashing. So the tag names the build rather
  than the moment somebody read it. **It blanks the field rather than cutting it**, so the hash
  still depends on that field being present.
  It sits apart from the header writing so `--selftest` can call the rule instead
  of restating it. That is the same reason this file lifts out `shotFresh()` and `stationUpdated()`.
  Five
  assertions guard it, and `cacheAge does not move the ETag` is the one that keeps the `304` alive.
  **Any diagnostic added to this payload that changes without the data changing needs the same
  treatment.** Otherwise it silently costs every reader the full body on every poll.
- **Moving an element to a new parent can change which flex rule governs it.** That holds even when
  the element's own rules stay the same. `.testtog` was a flex item inside `.modalhead`. There,
  `flex: none` sized it to its own content, and it drew as a pill. Moved to sit as a block child of
  `#aboutBox`, its own `display: flex` made it a flex container instead. That container stretches to
  the width of its new parent. Left as is, `.testtog:has(:checked)` paints a full-width amber bar across
  the pane. `#aboutBox .testtog { width: fit-content }` pins it back down at the new site. A
  component moved between a flex-item role and a flex-container role needs its sizing rule restated.
  The old rule does not travel with it.
- **The go-to box lists sites, and `hits` holds row objects rather than stations.** Six row shapes
  share one array: `site`, `sensor`, `near`, `ask`, `place` and `msg`. `pick()` switches on `r.t`.
  Anything new added to that list must add a branch there as well as in `rowHtml()`. Otherwise a
  reader selects a row that does nothing. The sub-rows are spliced into `hits` itself rather than hidden
  with CSS. That is what lets the existing arrow keys keep walking visible rows with no new code.
- **A picked place refills the list. It opens no card.** `place` and `ask` are the two rows that
  close nothing and keep focus in the box — every other row ends the search. Picking a place sets
  `nearPlace`, drops the pin and moves the map. `search()` then answers about that point instead
  of about the query. It lists the sites within `NEAR_MAX_KM`, nearest first. There **was** a card here, a
  copy of "You are here" under the key `@place`, and it is gone. It drew four sensor sections with a
  meter and a graph each. The question a place search asks is "which station covers here". Do not put
  it back. `nearPlace` is cleared by `oninput` and by `setFind(false)`, or the next open answers about
  a place the reader typed away from. The pin is not cleared: it marks somewhere they asked about,
  and it lives until another place replaces it.
- **Nothing calls `?place=` until the reader asks.** Nominatim's usage policy names per-keystroke
  autocomplete. So the lookup hangs off an explicit row at the foot of the list, and never off
  `oninput`. `lookup()` carries a generation counter for the same reason `clip.js` does. Do not
  "improve" this into a debounced auto-search. Every abandoned query still leaves the machine,
  and a fast typist fires several.
- **The camera wall is painted on a poll, never rebuilt.** `render()` calls `paint()` in
  `js/wall.js`, which swaps the tier class and the phrase on the tiles that already exist. A tile
  holds three things the payload does not. They are which cell of its strip it shows, and how many
  cells that strip has. The third is whether the observer reached it. A rebuild throws all three away. It
  drops every visible tile back to the start of its lap. That is the failure `js/clip.js` was
  written to prevent on one camera, arriving a dozen at a time. The filter obeys the same rule: a hidden tile
  stays in the grid. **Do not add `wall.open()` to the poll path** beside `dataTable()`. The table
  is safe to rebuild because a row is a pure function of the payload. A tile is not.
- **A grid row does not follow its item's `aspect-ratio`, so `#camGrid` sets `grid-auto-rows`.**
  `.camtile` takes its whole height from `aspect-ratio: 16 / 9`, and an `auto` row measures the item
  some other way. Measured on the live wall of ninety tiles: a **27.86px row against a 110px tile**.
  So every tile overlapped the two below it, and the wall read as a stack of cards. The same markup
  with ten tiles gave a **283px row against the same 110px tile**. That is one fault, drawn twice,
  once as overlap and once as gaps. Neither number tracks the column width, and neither moves when the
  breakpoints change the column count. `grid-auto-rows: min-content` in `css/chrome.css` pins the
  row to what the tile needs. Every overlay inside a tile is absolutely positioned. So no tile can
  ask for a taller row than its own ratio. **Measure the row against the tile before believing
  either.** The gap version reads as a spacing mistake and the overlap version reads as a `z-index`
  mistake, and both are this. Three other explanations were tried first and all three were wrong:
  `align-items: start` on the grid, `position: absolute` on the tile's `<img>`, and a wider tile
  ratio. Each left the row exactly where it was.

- **Under `NARROW_PX` (300) the app blocks the whole page, and that block is a `<dialog>` for one
  reason.** `showModal()` puts it in the **top layer**, which is not part of any stacking context. So
  it covers an open About box, the all-stations table and the camera wall. No `z-index` can do that —
  the same rule `js/sparktip.js` already obeys from the other side. It also makes the rest of the
  page inert for free, so no `inert` attribute has to travel over the page. A plain `show()` paints
  over the map and leaves the page live underneath, and the two look identical on screen.
  **Nothing dismisses it except width.** There is no close control, because a dismiss button hands a
  reader a broken map and calls it a choice. `js/ui.js` refuses the `cancel` event, which is what
  Escape and the phone back gesture raise. The media query is live, so the box opens and closes
  itself and no resize listener runs. `:root:has(#narrowBox[open])` hides the overflow, because the
  page behind is inert and still laid out. Under 245px it drew a scrollbar along the bottom of
  the block, for a map nobody can reach.
  **300 is a floor somebody chose and not the width where the layout breaks.** Measured: the app bar
  holds together to 245px and the document overflows below that. So the block takes 55 pixels of
  width that work today. A Galaxy Fold cover screen is 280 CSS pixels wide, and lands inside it. A
  reader locked out of a flood map is a reader with no water levels. Weigh that against a map in a
  240px keyhole before moving the number, and move it in `js/config.js` only.
  `narrow-test.html` reads `NARROW_PX` out of the source and guards all three silent faults.
- **The heading has TWO homes, and a wordmark ladder measured in each.** `#brand` is written into
  `<header>`, which is where a phone keeps it. Above 600px the navigation rail runs the full height
  on the leading edge and the app bar is the ticker's strip, so `js/ui.js` moves the node into the
  rail's brand slot on the breakpoint. A second copy in the markup is a second `<h1>` for a screen
  reader to read. CSS cannot move a node.
  The bar draws it at 22px across up to 300px. The rail draws `title-medium` across 56px shut and
  180px open, because `KV Flood Watch` needs 156px at 22px against the 148 the rail leaves. So the
  rail carries rungs of its own, at two ids so they beat the bar's whichever way the cascade runs.
  `title-test.html` reads both homes back in rendered pixels, and it opens the rail for the second
  ladder.
  **`container-type: inline-size` contains the box, so it can never take its width from its own
  content.** `flex: none` in the rail measured 0 and the whole lockup vanished. The phone bar hit
  the same trap from the other side: the ticker holds a row of its own there, so the heading is
  alone on line one with nothing to share against, and `flex: 1 1 0` resolved to 4px. Both state a
  definite `width`. It reads as a missing element rather than as a sizing rule.
  **`#netstats` does not move.** It is positioned against the window at both widths, and a 236px
  popover inside an 80px column that clips draws nothing. Its trigger is `body:has(#brand .mark:hover)`,
  because body is the one ancestor that holds the mark and the popover at either width.
- **The navigation rail runs the full height and expands.** 80px against 220, with
  `padding-inline: 20px`. Every number except the collapsed width is
  `NavigationRail/navigation-rail.css`'s own.
  **80 and not 96, because M3 publishes two rails.** That file states 96, which is the Expressive
  rail, and this app drew it for the whole M3 transformation. m3.material.io's own navigation rail
  specs page states an 80dp container, a 56dp item and a 32dp indicator. This rail already draws
  that item and that indicator, so 96 left the 56px pill 20px of clear space on each side against
  the 12 the classic page states. The repository owner picked 80 on 2026-08-25, off that page.
  **Two derived numbers move with it.** The medium band's `--pane` floor bites from 601 to 615px
  rather than to 631. The expanded band's ratio takes over at 1280px rather than 1296. Both come out
  of `(window - rail)`, so both are arithmetic and neither is a decision. `m3-check.html`'s
  band-floor probe had to move from 620px to 610px for the same reason: 620 left the range.
  **The top pad is 0, and M3 states 44px.** That number reserves a status bar this app does not
  draw. The toggle is the first item, so 44px of empty surface put it below the app bar's own
  glyphs on the row beside it. The repository owner cut it on 2026-08-25.
  **Three vertical gaps are trimmed, and the width is not.** The repository owner asked for space
  back on the expanded rail on 2026-08-25. **220px is load-bearing and cannot go.**
  `body.railopen #rail #brand` gets `220 - 40 - 16 = 164px`, and the rail's wordmark ladder has one
  rung at `@container (min-width: 147px)`. At 200px the brand falls to 144 and the rail draws no
  heading at all, which `title-test.html` guards. 220 is also M3's own floor for this variant, and
  the classic spec publishes no expanded rail — only a 360dp drawer, which is wider.
  So the slack was vertical. `.railitems` goes 40 to 24, `#rail hr` goes 12 to 8, and `.railfab`
  goes 12 to 8. That is about 40px back down the column.
  **The 24 is not deleted and must not be.** It is the one thing saying the search FAB belongs to
  the header block rather than being the first destination. It is still three times the 8 inside
  that block, so the grouping reads the same.
  **Every button in the rail answers a pointer with an M3 state layer.** That is the surface's own
  content colour at `--m3-state-hover` (8%) or `--m3-state-press` (10%), over that surface's own
  shape. `css/base.css` derives both percentages from the vendored state scale, so no opacity is
  hand-copied. Four controls take one: the item, the FAB, the rail toggle and the theme button.
  **The layer goes on the INDICATOR, never on the whole item.** A collapsed item is a 64px column
  holding a 56 by 32 pill with a label under it, and M3 lights the pill alone. A layer over the
  column paints the label's own box too, which reads as a row in a list rather than as an indicator.
  Expanded, the ROW is the indicator, so the layer moves onto the row. That is the same move the
  selected fill already makes, and it is why the rules are two blocks rather than one.
  **A selected surface names its own container as the second colour of the mix.** `color-mix()` is
  the mechanism rather than a pseudo-element with an `opacity`, which is what M3 itself uses. A mix
  reaches the same pixels with one property and no extra child. What it costs is that the mix has to
  name what is underneath. **A mix ending in `transparent` over a filled shape ERASES that fill.**
  So the selected pill mixes `on-secondary-container` into `secondary-container`, and only a
  transparent control mixes into `transparent`.
  **`:active` and not `:focus`.** A focus ring already answers the keyboard on all four, and M3
  gives focus and pressed the same 10%.
  **A `:hover` cannot be driven from a script, so `m3-check.html` asserts the two halves that fail
  silently.** A probe element carrying the same expression reads back whether `color-mix()` resolved
  it at all — a dropped declaration leaves a button that answers nothing. A CSSOM walk then asserts
  that all four controls still declare a rule, because a control left out draws correctly.
  **The theme button wears a resting DISC, in the rail alone.** The repository owner asked for it on
  2026-08-25. It is M3's filled icon button unselected: a `surface-container-highest` container under
  an `on-surface-variant` glyph, which this app bridges to `--hover` under `--muted`.
  **Not the tonal variant.** M3 fills that one with `secondary-container`, which this app bridges to
  `--accent`, the selected indicator's own fill. An accent disc at the foot of the column reads as a
  seventh destination, and a selected one.
  **The rail alone, because the button has two homes.** Below 600px it is the app bar's trailing
  action, and an app bar action is a standard icon button with no container. `#railApps .i` beside it
  is deliberately unscoped for the opposite reason: a glyph size belongs to the button, and a
  container belongs to the surface the button stands on.
  **`.icon:hover` fills a 40px disc with `--hover`, and that is a surface rather than a state
  layer.** It is the same tone the theme button now rests on, so that button's hover would have shown
  nothing. Both icon buttons in the rail take the layer instead.
  It starts at `top: 0` and the
  app bar starts where it ends, which is M3's canonical layout. That is one declaration,
  `header { left: var(--rail-w) }`, and it answers both widths: below 600px the token is 0.
  **The indicator moves from `.railpill` to `.railitem`, and that is why the markup needs no second
  form.** Collapsed, the pill is the indicator and the label sits under it. Expanded, the row is the
  indicator and the label sits inside it. One DOM, two states, because the paint moves.
  **`--rail-w` is declared on `:root`, never on `body`.** `--pane` is computed on `:root` and reads
  `--rail-w` there. A value redefined further down the tree never reaches it. The supporting pane
  then sizes against an 80px rail while the rail draws 220. `:root:has(body.railopen)` is what lets a
  body class move a root-level token.
  `PREFS.railOpen` holds the width. `syncRail()` writes the control from the preference and never
  the reverse, the rule `syncHeat()` states for every preference-owned control here.
  **`--m3-rail` is a second NAME for one motion, not a second motion.** It cites the rail's own
  `easing-standard` and `--m3-travel` cites `easing-emphasized`, and M3's token set gives both
  `cubic-bezier(0.2, 0, 0, 1)`. `m3-check.html` reads that back off the map card, which transitions
  `right` for the pane and `left` for the rail.
  **A collapsed rail draws no brand, so `#netstats` has no way in above 600px.** The feed diagnostics
  open from `#brand .mark`, and the collapsed rail hides the whole heading. One press of the rail
  toggle brings it back. That is an accepted cost, and it is the one thing in this app that a state
  of the chrome can put out of reach.
- **The rail's travel re-rasters the map card every frame, and `--m3-rail` is 150ms because of it.**
  Measured 2026-08-25 at 1536px and a 1.25 device pixel ratio, which is the repository owner's own
  screen. **The device pixel ratio is the variable that hid this**: at ratio 1 the light theme sits
  at a 16.9ms median frame and looks fine, and at 1.25 it is 27.8ms. Leaflet also asked CARTO for
  `@2x` tiles past ratio 1, and Esri caches no retina tile, so that half no longer applies and the
  measurement was not repeated. The floor does not move — with no animation at all both themes sit at
  16.6ms — so the travel is the whole of it, and the map card is a live rasterized surface whose
  width is what animates.
  **Six mitigations were measured and none works.** `will-change: left`, `will-change: transform`,
  `contain: paint` on the map, `border-radius: 0`, dropping `overflow: hidden`, and moving the dark
  theme's filter chain onto each tile. That last one renders pixel-identical, confirmed by
  screenshot, because the chain is per-pixel with no neighbour sampling. It changed nothing. **The
  cost is the work, not the region.**
  **So the duration moved instead**, `duration-short2` to `duration-extra-short3`, a rung of M3's own
  scale. Light theme at 1.25: frames over 33ms fell from 25 of 108 to 10 of 135, median 26.0 to 17.2.
  **Halving the travel does not make a frame cheaper. It halves how many of them there are.**
  Snapping the map card while the rail still travels is worse, 25.1 against 17.2.
  **`--m3-rail` therefore stops being a second NAME for `--m3-travel`.** The two still cite the same
  M3 curve. `m3-check.html` reads the map card's two edges as `0.3s, 0.15s` now, and the news pill's
  as `0.15s, 0.3s`, because the rail's edge leads there.
  **THE DARK THEME WAS A WALL, THE TILE FILTER WAS THE WALL, AND THE WALL CAME DOWN ON 2026-08-27.**
  `filter: url(#watertint) brightness(1.75) contrast(.92)` on `.leaflet-tile-pane` put that theme at
  a 67.6ms median frame with 41 of 43 frames missed. Nothing above moved it and neither did the
  duration. Measured then: removing the filter takes the median from 43.4 to 17.9 at ratio 1, and
  removing the SVG tint alone takes it to 31.1.
  **That deletion was not made for the frame rate.** The basemap moved to Esri, which serves lossy
  JPEG, and a tint keying on one exact tone cannot read one. The frame rate is what it paid.
  **Re-measure before quoting any number in this entry.** Every figure above was taken with the
  filter live.
  **`L.Canvas._update` is the cost that remains**, redrawing all 6,635 water shapes on `moveend`, at
  about **130ms of main-thread JavaScript per press**. That one is not raster and does not care
  about the machine. It is untouched, because it is a deliberate feature: cutting it is a decision
  about how the dark map looks rather than a fix.
- **A rail toggle also drops frames on the heat canvas, and nothing was changed for that either.**
  Measured 2026-08-25 with a throwaway probe. Leaflet is not the cost: `invalidateSize` runs
  16 times a press at 1.2ms each, and tile work is 0.5ms. The one `SoftHeat` repaint lands 200ms
  AFTER the travel, so it cannot stutter the travel either. **The cost is per frame, and it is the
  canvas's composited AREA.** `_pad()` in `vendor/leaflet-heat.js` returns `map.getSize() × 0.2`, so
  the canvas is 1.96 times the map's own area. Scaling its CSS box to half that area recovered the
  whole cost. Measured over one 460ms window: 124 frames with the heat layer on against 157 with it
  off, and 157 with no animation at all.
  **No CSS fix exists and one of them lied.** `contain: strict` on the canvas scored best and
  **collapses it to a 0×0 box** — that keyword includes size containment, and a canvas takes its box
  from its `width`/`height` attributes. It was fast because it was invisible. **A pixel count calls
  that a pass**, because `getImageData` still reports a full backing store. Read
  `getBoundingClientRect()` as well, on anything claiming a canvas survived. `will-change: left` on
  the map looked like a large win in a blocked run and vanished under interleaving.
  **Interleave the conditions and rotate their order every round.** Drift across a blocked run reads
  as a difference between conditions, which is exactly how `will-change` scored a win it does not
  have. Count frames as well as timing them: a median hides a dropped frame.
  **Every number is headless software rasterization**, where composite area is expensive and on a GPU
  it is nearly free. The response is not linear either, which is the shape of a raster-tile threshold
  rather than of a real cost curve. So `_pad()` keeps its 0.2 until somebody presses the rail with
  the heatmap off on a real machine and reports the difference. That pad has its own trade, stated in
  its own comment: without it a drag pulls blank canvas in from the edge.
  **A probe presses real controls on the app's own origin**, so a run can leave a saved heatmap or
  rail preference changed. That is the hazard `m3-check.html` already carries for its rail toggle.
- **The navigation bar is what a compact window gets, and the rail does not draw there at all.**
  `#navbar` is M3's navigation bar, from `NavigationBar/navigation-bar.css`. 80px of a 360px screen
  is 22% of it, and M3 states no rail under 600px.
  **Five items was the cap M3 states, and the bar holds four now.** The rail carried eight
  destinations. Settings, Help and About are the three visited least, so they move to `#appMenu`.
  The filters item went with its panel on 2026-08-26.
  **The middle slot holds the map layers, and the search left this bar for the app bar.** A reader
  asked for both on 2026-08-25. The search was the middle item and it is `.hlead` now, the app bar's
  leading action, and the search took the slot it vacated.
  **The layers item is gone.** It pointed at a panel, and the layer controls are a chip row over the
  map since 2026-08-25. A bar item that opens a panel which no longer exists opens nothing and errors
  nowhere.
  **THE MIDDLE SLOT HOLDS THE LOCATION BUTTON FROM 2026-08-25, and `#navMore` left this bar the same
  day.** A reader asked for both. So the five items were Filters, Alerts, Location, Table and
  Cameras, and the overflow is the app bar's trailing action instead.
  **THE BAR HOLDS FOUR ITEMS FROM 2026-08-26, AND THE LOCATION BUTTON IS NOT AT THE CENTRE ANY
  MORE.** The repository owner deleted the filters panel that day, so `#navFilters` went with it.
  Four items have no centre slot, so the property a reader asked for is gone and the item keeps its
  place in the reading order instead. M3 states three to five for this component, so four needs no
  other change. `m3-check.html` asserts the position it holds now rather than the centre.
  **`#navLocate` has no rail twin, and it must not grow one.** Above 600px the map draws `#locate`
  itself, over the ground a fix lands on, which is where a location control belongs whenever there is
  room for it. That is why this id breaks the `rail`/`nav` pairing every other item here keeps.
  **It presses `#locate` rather than repeating what that button does.** Every path through
  `js/locate.js` hangs off one handler: a first fix, a stored fix, the recentre, the ripple and the
  card. A second caller is a second copy of the one that matters.
  **It is a DESTINATION and takes `aria-current`**, and `railSync()` marks it while `side.key` is
  `@here`. That is the one card in the supporting pane a navigation destination names. A station card
  and a weather card select nothing.
  **`js/locate.js` mirrors the glyph and the words onto it**, from the same `setBtn()` that writes
  `#locate`. A crosshair on a control whose last fix failed says nothing, and a failure has to arrive
  as text as well. Only the glyph and the words cross. The `.busy` and `.on` paint belongs to a round
  button standing on a photograph of a city, and `GLYPH` in that file states the three names because
  no `#locate.*` rule can reach an element carrying no `.mapbtn` class.
  **Below 600px `#pane` covers the bar**, because that pane is a full-screen dialog there. So the
  bar is a launcher at that width and never a state display.
  **`--navbar-h` holds `calc(64px + env(safe-area-inset-bottom, 0px))`**, and `viewport-fit=cover`
  in the viewport meta tag is what makes that inset report a real number. Without the tag it reads 0
  and the bar sits under the iOS home indicator.
  **NO BUTTON DRAWS ON THE MAP AT THIS WIDTH.** `#locate` held the slot beside the zoom box until
  2026-08-25, and the bar's middle item replaced it. `css/chrome.css` gives that node `display: none`
  below 600px. **Assert that it does not DRAW, never that it is absent**: `js/locate.js` still owns
  it and still writes its three states onto it, and a check reading the element as gone would pass
  the day somebody deleted the button a desktop needs. `m3-check.html` and `paint-check.html` both
  hold that shape.
  **`#mapfoot` still takes `--navbar-h` and still needs it.** It states a bottom measured up from the
  map's own edge. That edge moved 64px and the literal did not, so the zoom box climbed past it.
  `paint-check.html` reported it, and nothing else in this app reads that geometry.
  **`.mapbtn` declares `--fab` on itself.** A rule that stacks one map button above another cannot
  inherit it, so it states the fallback. Without one the whole `calc()` is invalid and the button
  falls to the top of the page. It is the desktop pair that still stacks.
  **THE FLEXIBLE HALF IS DECLINED, AND A MEASUREMENT IS WHY.** M3 states two item arrangements.
  Vertical stacks the glyph over the label and is what this bar draws. Horizontal puts the two on one
  row inside an indicator that wraps the whole item, and M3 asks for it where the window's height is
  compact, which is 480dp. It was built to the reference's own numbers — a 64px container, 12px of
  block padding, a 20px gap, a 40px item inset 16px, a 20px corner on the item's own box, and the
  pill down to the glyph's 24px — and then the five items measured **569px against a 360px window**.
  **There is no window in this app where that arrangement both applies and fits.** This bar draws
  below 600px alone, and a phone held sideways is 760 by 360 and gets the rail. So the band left is
  569px to 600px, and it is 31px wide.
  **Do not restore it by making the items smaller.** Shrinking the inset or dropping a label is the
  component approximated rather than transcribed. Restore it the day this bar draws in a window wider
  than 569px. `shortPhone()` in `m3-check.html` holds the decline: it takes the frame to 360 by 420
  and asserts that a compact height changes nothing.
  **Every item answers a pointer with a state layer, and this bar carried none for a revision.** The
  rail gained one on all four of its controls on 2026-08-25 and its bar twin was left out, which
  draws correctly and answers nothing. **The layer goes on the INDICATOR, never on the whole item**,
  which is the rule the rail already states: an item is a 72px column holding a 56 by 32 pill over a
  label, and a layer over the column paints the label's box too. A selected pill names its own
  container as the second colour of the mix, or a mix ending in `transparent` erases that fill.
  `m3-check.html` walks the CSSOM for it, because a `:hover` cannot be driven from a script.
  **The selected LABEL takes `secondary` here and the rail's takes `on-surface`.** That is the
  reference's own split, and this bar wore the rail's value until 2026-08-25.
- **The app bar below 600px carries two absolutely positioned action groups.** `.hactions` is the
  trailing one and `.hlead` is the leading one. `<header>` does not draw above 600px at all, so
  nothing has to hide either of them there.
  **`.hactions` holds the overflow menu and nothing else, from 2026-08-25.** A reader asked for the
  More button on the app bar's right side that day, and its old slot in the navigation bar went to
  the location button. It keeps the id `navMore` and `popovertarget` is the whole of its wiring, so
  the browser opens the menu and there is nothing in `js/ui.js` to keep in step. It draws as a plain
  icon button with no pill and no label, which is what `#navFind` already does on the other edge.
  **The theme switch LEFT this group the same day.** It used to travel between the rail and this bar,
  because the rail is `display: none` at this width and a phone otherwise carried no theme control.
  The picker is three rows in Settings now, so a phone has one, and no node moves between the two
  homes. `m3-check.html` asserts both halves: the group holds one control, and the switch is not it.
  **The search keeps the id `navFind` there.** `NAV` in `js/ui.js` binds it and `railSync()` writes
  its `aria-expanded`, and both match on the suffix its rail twin shares. So only the shape changed.
  It carries no pill and no label: a bar item names a destination in words, and an app bar action
  names itself in a tooltip. `railActive()` never reaches it either, which is already the rule — the
  search is an action at both widths, so it states `aria-expanded` and never `aria-current`.
  **Out of flow, because the bar centres the brand on the WINDOW.** That is M3's center-aligned
  small top app bar, whose title centres in the container rather than in the space the actions
  leave. A flex item on the trailing end moves the mark by half its own width.
  **One box and not two positioned buttons.** Each button placed for itself needs a literal offset
  that has to stay in step with the width of the one beside it. 8px on the group puts the trailing
  glyph centre 28px inside the window edge, which is the number every app bar in this app lands a
  trailing glyph on. The leading group takes the same 8px, on the other edge.
  **`place()` in `js/ui.js` moves `#brand` and `#findpane` and nothing else.** The theme switch was
  the third node with two homes until 2026-08-25. See the theme entry below.
- **The search has two homes too, and above 600px it is M3's DOCKED search view.** A card floating
  over the map's top-left corner, on the legend's own leading edge, with the field as its header and
  the results under it. `Search/search.css`'s own `border-radius: 28px 28px 4px 4px` on
  `surface-container-high`. Elevation is `--shadow`, for the reason the four dialogs each decline
  M3's own. Below 600px it is a pane occupant, which is M3's FULL-SCREEN search view.
  **Both variants are search views, so both are the same two parts: the bar, then the results.**
  `css/chrome.css` states that shape once and each width states only its own numbers. The bar is a
  row holding a leading back arrow and then the field, and `Search/search.css` puts the surface on
  the row rather than on the field. The desktop bar is a 56px pill with its results on a second
  raised surface. The phone bar is 72px on the screen's own surface, with a divider under it and the
  results filling the rest.
  **The phone variant was a dropdown, and four things made it one.** `css/base.css` floats
  `#gotoHits` under the field with `position: absolute; top: 100%`, outlines it, caps it at 46vh and
  draws an `expand_more` caret in the field. Those four say that a field opens a list under itself.
  A search view is a destination. So `css/chrome.css` cancels all four, at both widths.
  **`#findHead` is gone, and that is the fifth.** The pane carried a 112px app bar reading `Go to`
  over the field. M3 gives a search view no title bar: the search bar IS the header, and it carries
  the arrow. A title bar above a field made the field read as a form control on a page.
  So `#findBack` draws at every width now, and `#findClose` went with the bar it sat in.
  **The body stops scrolling and the list starts.** `#findBody` is a pane occupant's scroller, and
  with the bar inside it the bar scrolled away with the results. A search view holds its bar still.
  **It is written OUTSIDE `#pane`.** A closed `<dialog>` is `display: none`, and a floating card
  inside one cannot draw. So the phone is the case that needs the move.
  Three things follow it. `syncPane()` stops opening the pane for `find` above 600px. The pane's
  `close` listener stops clearing the `find` class there — it took the card away in the same frame
  it arrived, and the press read as a button that does nothing. And `#gotoHits` goes in flow: it is
  `position: absolute; top: 100%` in `css/base.css`, so it contributed nothing to a card that is
  only as tall as its content. The card stayed 66px and clipped 278px of results, with nothing on
  screen to say so.
- **The app bar wordmark has four spellings and the title rail picks one.** So a specificity slip
  draws none of them. `Klang Valley Flood Watch` → `KV Flood Watch` → `KVFW` → the drop alone, at
  282px, 190px and 94px of `header h1`. That is a **container query and not a media query**. The
  rail is what is left after the ticker and the controls, and both of those move on their own.
  Below 600px the ticker takes a row of its own. So the rail WIDENS as the viewport narrows, from
  77px at 601px to 272px at 600px. No viewport threshold can follow that. The ticker then proved
  the rest. It went from `min(58vw, 656px)` to a flat `50vw`, with a `40vw` candidate in and out
  beside it. Then it went to `flex: 1 1 0` under a 300px cap on this rail. Each move changed the
  rail at every width above 600px, and not one threshold here needed an edit. The phone rule
  that hid the title whole is gone, since the container now measures what that rule assumed.
  `container-type: inline-size` is safe on that flex item because `flex: 1 1 0` with `min-width: 0`
  already takes the width from the flex algorithm and never from the content. **That is also why the
  cap sits on this rail and never as a basis on the strip.** Containment collapses an element whose
  width comes from its own content. So `header h1 { flex: 0 1 auto }` draws no wordmark at all.
  **Every selector in the ladder goes through `.word >`, and that is specificity rather than
  tidiness.** `header h1 .word > span { display: none }` is one class and three elements.
  `header h1 .w-sm` is one class and two. So the hide rule won and every width drew the drop alone.
  That looks exactly like the bottom rung and errors nowhere. Two classes beat one class and any
  number of elements. The thresholds are measured font widths: 247, 156 and 59px at 22px Roboto,
  plus 32 for the drop and its gap. **Remeasure them if the font, the size or the words change.**
  A threshold set too low draws a spelling wider than its rail, and the ellipsis hides the overflow.
  `title-test.html` is the check for both faults.
- **`.muted` carries a `font-size`, so it beats whatever size its context passes down.**
  `.muted { color: var(--muted); font-size: 12px }` in `css/base.css`. A declaration on the element
  always wins against an inherited value, however specific the parent's selector is. `.accx` sets
  `font-size: 10px` on the rain chart's label row and every label inherits it. But an unanswered
  window's label also carried `class="muted"`. So `24 h` and `72 h` drew at 12px beside three
  neighbours at 10. The two labels a reader is most likely to question drew biggest. The class did
  no work there either, since `.accx` already paints all five `--muted`. **This is not the
  first site.** `#ignoredList .nm .muted` patches the same trap by restating 11px. Read that rule as
  evidence rather than as a one-off. Treat `.muted` as a colour-plus-size pair. In a compact
  context, either state the size on the element or reach for the token instead of the class.

- **A graph's viewBox is stretched, so a mark on the plot goes in HTML over it, not in the SVG.**
  Every `.spark` carries `viewBox="0 0 100 28"` with `preserveAspectRatio="none"`, which is what lets
  one template serve any width — and it stretches everything drawn inside it. A line survives on
  `vector-effect: non-scaling-stroke`, and nothing else does: a glyph comes out squashed and a
  one-unit rule comes out wide. The rainfall peak mark is the worked example. `.spark` is already
  `position: relative` for the axis labels. So a percentage off the same `x()` the polyline uses
  lands on the same column. `.peak` is a plain `<b>` with a `border-left` and an `<i>` on top.
  Its words go in `data-tip`, because `show()` in `js/sparktip.js` tests `[data-tip]` before
  `.spark[data-pts]`. The label wins while the pointer is on the glyph, and the per-sample readout
  keeps every other column. **A mark near an edge moves the glyph, never the rule.** The newest
  sample is the last column. So rain peaking right now is the ordinary case rather than an edge
  case. A centred glyph there hangs half its width off the plate.
  **The caption it replaced read the wrong maximum**, and that is the part worth remembering.
  `rainBars()` holds `hi0`, the peak of the readings, and `hi`, the axis maximum. `hi` is the
  taller of `hi0` and the highest intensity class drawn across the plot. The caption printed `hi`.
  So a station peaking at 37.5 mm with the 60 mm class on screen said `Peak 60 mm in an hour`. No
  gauge had reported that figure. Anything stating a graph's peak reads the data, never the scale.
- **A label sharing a box with a percentage-height bar has to be reserved with `padding`.** A
  raised `sup` beside it then grows the box that reserves it. Two rules, both on `.acccol` in
  `css/base.css`, and the rain accumulation chart needs each. Its five totals print inside the plate
  rather than on a row above it. A bar states its total as a percentage height, which resolves
  against the **content box** of its container. So `padding-top: 16px` shortens the scale of all five
  bars at once, and the tallest fills the 42px under its own number. A margin, or a shorter plate,
  leaves the percentage measuring the full box. The tallest bar then covers the value it belongs to.
  The second rule is the provenance asterisk. A bare `sup` lifts itself with `vertical-align: super`,
  and a raised inline box **grows the line box that holds it**. The value measured 17.3px against
  the 16px strip. So the tallest bar started 1.3px inside its own number. `line-height: 0` with
  `position: relative; top: -4px` lifts the mark and contributes nothing to the measurement. **That
  is the normal case and not an edge case.** The 24h and 72h totals are both derived, so both carry
  the mark. The five windows nest, so the longest is the tallest column. Anything new that prints
  a value inside a plot needs both halves.

- **THE BASEMAP IS ESRI AND IT WAS CARTO, AND THE TILE FILTER IS DELETED.** CARTO ended keyless
  access on 2026-08-27. Every tile came back with `API KEY REQUIRED` burned into the picture.
  **Measure that before believing a retry helps.** Every subdomain answered HTTP 200 with a real
  tile, each tile differed by coordinate, and a browser `Referer` and `User-Agent` changed the
  response hash not at all. It is a policy change rather than a rate limit, so it does not clear
  itself.
  `TILES` in `js/config.js` holds `World_Light_Gray` and `World_Dark_Gray`, and `js/map.js` adds a
  `_Base` or a `_Reference` suffix.
  **AN ARCGIS TILE PATH IS `{z}/{y}/{x}`, ROW BEFORE COLUMN.** That is the reverse of the XYZ order
  every other provider here uses, and it fails silently: the tiles still load, and they are simply
  the wrong part of the world. There is no `{s}` and no `{r}`.
  **Esri publishes the ground and the place names as two services**, so the map adds two layers per
  theme. The labels take the `labels` pane at z-index 260, above the water this app draws at 250. At
  the tile pane's own 200 a drawn river covers the name of the town it runs through. That pane takes
  no pointer events, or it sits between the reader and every pin under it.
  **`maxNativeZoom: 16` beside `maxZoom: 18`, and the second number alone is wrong.** Esri caches no
  tile past zoom 16 over this area. Zoom 17 and 18 both answer with one shared `Map data not yet
  available` plate — measured, the light and the dark service return the identical file — which is a
  second watermark. `maxNativeZoom` stretches the zoom-16 tile across the two zooms above it, so the
  app keeps its own zoom range and only the ground goes soft. Every pin, label and heat blob is
  drawn by this app and stays sharp.
  **`#watertint` KEYED ON ONE EXACT TONE, AND A JPEG HAS NO EXACT TONES.** `dark_all` is a PNG
  painting filled water at luminance 38 against land at 9, so a 64-band discrete table could isolate
  that one value. Esri serves the canvas as lossy JPEG. Measured on one sea tile: 145 distinct
  colours where a PNG holds a handful, and every flat block fringes at its own edge. A discrete band
  cannot separate water from road there, and a table retuned against those artifacts paints a halo
  along every coastline. **Do not rebuild it against a JPEG provider.**
  The `brightness(1.75) contrast(.92)` lift went for a plainer reason. It raises a near-black tile,
  and Esri's dark canvas is a mid-grey that 1.75 blows out.
  **Four things went together**: the `filter` rule in `css/map.css`, the `#mapfx` SVG in
  `index.html`, the `#mapfx` rule that held it out of the flow, and the `data-lift` attribute
  `setBasemap()` wrote. One of them carried its own trap worth keeping in mind for anything new: an
  SVG filter cannot be referenced out of a `display: none` subtree, so the holder had to stay in the
  render tree and leave the flow by other means.
  **The sea and the large lakes lost their blue and are still separable.** Only the tint ever
  reached them. Measured on the rendered page: sea reads `#232227` and land reads `#4d4d4f` to
  `#5b5b5d`, so the sea is the **darker** tone here, the reverse of `dark_all`. The rivers and the
  ponds keep their blue, because `water.json` is a vector overlay in a pane of its own that owes the
  basemap nothing.
  **One preconnect replaced three.** CARTO answered on `a`, `b` and `c`, because Leaflet expands
  `{s}` over its default subdomains. Esri publishes one host.
  **Three surfaces name the tile provider and all three must agree.** They are the credit line under
  the map, the Privacy paragraph in About, and the Credits block below it. A page crediting one
  party while its map fetches from another states a false thing about where a reader's requests go.

- **A GREY CANVAS BASEMAP DRAWS ALMOST NO SMALL WATER, and no filter can recolour what is absent.**
  Measured on CARTO `dark_all`, and Esri's dark canvas drops the same class of water. **That is a
  fault of area, not of screen size.** CARTO
  drops small water on area, not on screen size. Tasik Taman Desa at 0.115 km² holds 2,036 water
  pixels at zoom 13. A median pond at 0.0017 km² holds **zero** at zoom 13, 14 and 15 alike. It
  is 8 screen pixels wide at the last of those. No zoom brings it back, and a filter cannot recolour
  something absent from the picture. The box holds 6,489 water bodies with a median area of 0.0037
  km². So this is most of them.
  So `js/map.js` draws both from `water.json`, on the dark theme alone. **Five things about that
  layer are load-bearing.** It uses a **canvas** renderer. 6,635 shapes through the default
  one is 6,635 DOM nodes carried through every pan. It has **its own pane at z-index 250**, between
  the tiles at 200 and the overlays at 400. So heat, pins and the accuracy circle draw over the
  water. It reads **`--water` from `css/base.css` at the moment it builds the layer**, not when the
  fetch returns. That token exists on the dark theme only, and it is now the one place the water
  colour is stated. And the fetch stays **lazy and swallows its own failure**. A
  light-theme reader never pays the 234 KB, and a failure leaves a plainer map rather than a broken
  one. `water.json` has no `?v=`, so a rebake needs a hard reload.
- **Tolerance and scope are different knobs on `water-build.php`, and the wrong one costs bytes for
  nothing.** Douglas-Peucker controls the detail inside a shape the query already returned. Taking
  the rivers from 33 m to 11 m grows them from 105 KB to 199 KB. It adds no pond, because a pond was
  never a line in that query. If something is **missing**, change the query. If something looks
  **crude**, change the tolerance. There is also no area floor, on purpose. A small pond simplifies
  to a handful of points. So keeping every one costs the same 130 KB as a 0.001 km² cutoff.
- **A lake's outline is several ways in one relation, so closing each one separately draws wedges.**
  `rings()` in `water-build.php` chains member ways end to end, flipping one that joins backwards.
  It keeps only what closes. An open chain means the relation is broken upstream. The script
  drops it rather than guess at a shape. Inner rings become holes, so an island stays dry.
- **The MET nowcast page has no endpoint to find.** It renders its Leaflet map on the server and
  bakes all 294 points into `L.marker(...)` statements. There is no request to intercept, so
  `metPoints()` parses the JavaScript source with a regex. `data.gov.my` publishes three weather
  endpoints — `forecast`, `warning` and `warning/earthquake` — and **no nowcast**, so this scrape is
  not a shortcut around a clean API. Nobody needs to search for that endpoint again.
  A marker whose wording this parser does not know is **dropped whole**, and never read as clear
  weather: `metRung()` returns -1 and the marker vanishes, so `sources.met.parsed` falls and somebody
  looks. Reading an unknown word as "no rain" hides a layout change behind calm weather. That is the
  one way a scraper must not fail.
- **`MET_KM` is a flat 15 km, not a radius scaled to how far each point reaches.** A cell-scaled cutoff
  came first, sized to the area a point covers, and it failed in both directions. Sabak Bernam sits
  in a 28.5 km cell. A cell-scaled rule there accepts a station 22.8 km from its point. That is the weakest
  claim on the map, admitted only because MET built nothing nearby. Central Kuala Lumpur holds
  points 0.1 km apart, two MET offices and a convention centre. The same rule silences stations 3 km
  out, where the reading is most reliable. Point density records where MET chose to build. It says
  nothing about weather. 15 km comes from the decorrelation distance for a 3-hour rainfall field,
  about 26 km, and sits safely inside it. **A line that claims rain falls at this moment needs about
  3 km instead.** Decorrelation distance falls with the period measured. Reusing `MET_KM` for an
  instant claim overstates it by about five times.
- **The warning feed carries no coordinates.** Nine fields, and none of them is geographic. The only
  way to place a warning is to read its text, so `metWarnings()` in `sources.php` does exactly that.
  Every row must name a place this map covers (`WARN_HERE`). A marine row gets a second way in: our
  stretch of the Straits of Melaka (`WARN_SEA_KEEP`). Port Klang stands on those straits, so rough
  water there reaches this map. Water off Phuket, Samui, Layang-Layang, Palawan and Sulu does not.
  **Naming the straits is not the same as naming our stretch of them.** They run about 800 km. MET
  writes "the waters of Northern Straits of Melaka and Samui" for water off Kedah, Penang and
  Thailand. That is about 300 km from Port Klang, and the row holds the three words
  `straits of melaka`. It
  passed on them alone and put Thai water on the ticker. `WARN_SEA_FAR` is **cut out of the text**
  before the keep test reads it, rather than tested for. Cutting is what keeps a row that names two
  stretches. Strip the northern mention from "Northern Straits of Melaka and Central Straits of
  Melaka", and the central one still answers. A row naming only the far stretch has nothing left.
  **The sea test cannot read the heading alone.** MET files a storm over water as "Warning on
  Thunderstorms", the same words it uses over land. So a heading test read a marine row as a land
  one, and judged it by the wrong list. `WARN_WATER` reads the text for "waters of" or "perairan",
  which MET writes on every marine row. Measured on a seven-row feed: one row survived before these
  two rules and none after. The one that survived was the Thai-water row.
  A land row must name a place this map covers (`WARN_HERE`). That list
  includes `west coast` and `pantai barat`. MET names some warnings by coast rather than by state,
  and Selangor sits on the west coast. **A warning for the whole peninsula still drops.** That gap
  is open on purpose: adding `semenanjung` and `peninsular` also lets in warnings about every other
  state. Name the gap so the next reader sees a decision, not a bug. The filter reads English and
  Malay text alike, because MET writes some rows in one language only.
  **A live payload tested the southern stretch, and the rule answered correctly.** Before this work,
  `data.gov.my` was the only warning source this app had, and it had published nothing for seven days.
  No row reached the geography filter at all, so nothing exercised this rule. The JPS mirror delivers
  rows now. On 2026-08-17 the ticker carried this row. "Northern part of Phuket, Northern Straits Of
  Melaka, Southern Straits Of Melaka, Northern Reef South, Southeastern Reef North and Labuan".
  `WARN_SEA_FAR` cuts `northern straits of melaka`, and MET's `Southern Straits Of Melaka` then
  matches `WARN_SEA_KEEP`. **That is the right answer. The southern stretch reaches this map, and the
  northeast monsoon is when.** The repository owner confirmed it on 2026-08-17. So do not add
  `southern straits of melaka` to the drop list. An earlier draft of this entry recommended exactly
  that, on the assumption that the row named nowhere here.
  **What else the sentence names is a granularity floor, not a fault.** `hereParts()` splits on
  sentence and line boundaries. So one sentence naming six places survives whole once any one of them
  is in reach. This row puts Phuket, two reefs and Labuan on the ticker beside our own water.
  Cutting inside a sentence needs per-place surgery on MET's wording. That is a larger change than
  the paragraph filter this app has.
- **The two warning surfaces disagree about time on purpose, and `fresh` is the seam.** The panel
  lists a warning for its whole validity. The ticker carries it only while `fresh`. That is the first
  `WARN_FRESH` (6 h) of that validity, measured from the warning's own start. It is **not**
  measured from when we first read it. A sample valid for three days otherwise scrolls for three days. That is
  the standing banner the alert design standard rejects. The panel is a directory somebody opens.
  The ticker is an interruption nobody asked for, and an interruption has to end.
  `fresh` is scored in `sources.php`, because MET stamps Malaysian wall clock with no offset. A
  browser ages it by the reader's clock instead. **The ticker numbers its tiles before it filters**:
  `data-warn` indexes `state.warnings`, which the panel and the modal share, so renumbering after
  the filter opens the wrong warning.
  The panel section sits **under the `HAPPENING NOW` groups**, not above them. It led once. That
  put a regional forecast above a river over its danger mark. The tier sort already
  refuses to do that to a forecast two streets away. `alerts()` splices it at the first group that is not
  `now`, so with nothing happening it still leads.
- **A MET warning counts toward nothing.** It draws two surfaces: a section in the station list
  in `#side`, and tiles on the ticker. Both open the same modal, with the full text. Neither surface
  moves a count: not the alert number, the icon badge, the app-bar glyph colour, or the toast. The
  panel shows a warning with no tally beside it claiming a station is in trouble. That separation is
  the whole reason this surface passed the alert design standard in `docs/FEATURES.md`. A warning is
  a claim MET makes about an area. A station count is a claim this app makes about a sensor. Merging
  the two makes the app assert something it cannot observe. Anything that later wants a warning to
  raise the count goes through the alert design standard first.
- **The payload poll must never pass `cache: 'no-store'`.** The server sends an `ETag` with every
  response. An unchanged poll then costs one 304 and about 200 bytes instead of the full body.
  `no-store` skips that check and forces a full fetch every time. That poll runs every few
  minutes, for as long as the tab stays open. `js/ask.js`'s `askJson()` passes `cache` through only
  when a caller asks for it. So the payload poll must call it with no `cache` option at all. The
  force-refresh button sets `no-store` on purpose, because defeating the cache is the whole point
  of that one button.
- **The `modulepreload` list has no build step, and it drifts silently.** `index.html` lists every
  module the browser fetches on landing. A person edits that list by hand. Add a static import and
  forget the line. The page still works, but the browser discovers that module one round trip
  late. Remove a static import and leave the line, and the browser fetches a module landing no
  longer needs. Neither mistake throws an error or shows on the page. The Verify block in this
  file checks the list against `ls js/*.js`, and skips the five deferred modules by name. Run it
  after every change to an import or to this list.
- **A loading skeleton takes its state from `aria-busy` on the dialog. It takes its look from
  `.skel` in `css/base.css`. Do not invent a second version of either.** `lazy()` sets
  `aria-busy="true"` on the box passed to it, and clears it once the module resolves or fails.
  Each surface gets its own placement class — `.skelrows`, `.skeltiles`, `#tlskel`. It draws only
  while that attribute reads true. Each one wraps a plain `.skel` for the shimmer. `.skel` holds
  the one animation and the one gradient. A second shimmer class, styled to match by eye, drifts
  from the first the day the palette moves. That already happened once, in the wall's own
  `camskel`, before this shared shape replaced it. Add a new deferred panel by adding a placement
  rule and a `.skel` child. Do not add a new shimmer.
- **`lazy()` rethrows a failed import, so every caller owns a failure surface and a `try`.** The
  function clears `aria-busy` in a `finally` and lets the error out, because it does not know which
  box the caller owns. Three of the four callers answer that: `#dataBox` and `#camBox` take a
  `loadfail` banner, and the test toggle puts `state.test` back. The lightbox answered nothing for a
  while, and it is the one to copy the shape from. It awaited the raw import promise a second time,
  inside an `async` listener with no `try`. So a failed import raised one unhandled rejection per
  open, and said nothing on screen. **`withTimeline`'s own rejection handler does not cover that
  second `await`.** A handler on a promise settles that one continuation, never a separate one. The
  shape reads as guarded because the word `catch` is already on the line above. Measured in node
  on the two shapes: one unhandled rejection before the `try`, none after. Its surface is `#tlfail`,
  the line `openTimeline()` already prints when the archive is out of reach. It is cleared before
  every attempt, because `reset()` clears it only on the path that did not run. Anything new behind
  `lazy()` needs both halves, and a surface a reader can see beats a `console.warn`.
- **The JPS MET mirror answers JSON that is not valid JSON.** `met_gelora.json` and its siblings hold
  raw newline characters inside string values, so `json_decode()` returns null on a page that holds
  real rows. A null decode looks exactly like an empty feed to a caller that only tests `is_array()`.
  So a good page reads as an outage. `jsonLoose()` in `sources.php` walks the text, tracks whether the
  cursor sits inside a string, and escapes any control character it finds there. `pageHasData()` must
  test a `jps-` key with `jsonLoose()`, never with `json_decode()` alone, or a good page reads as an
  outage. **A second fault hid inside the first fix.** Inside a string, a backslash sets an escape
  flag. The old rule then copied the next character through raw. A raw control byte straight after a
  backslash skipped the sanitizer that way. The function then returned null on readable data. The
  escaped character now runs through the same control-character test the rest of the string uses.
  Measured 2026-08-17 against all five JPS MET files. Four decode the same either way, and
  `met_gelora.json` goes from a parse failure to 2 rows.
- **A stale feed and a calm feed look the same, and `parsed: 0` cannot tell them apart.**
  `api.data.gov.my/weather/warning` sat seven days dead on 2026-08-17. Every counter stayed quiet,
  because the fetch had succeeded and the geography filter correctly refused week-old warnings about
  Phuket. `sources.stale` names a page that did not answer at all. `sources.old` is the new signal. It
  names a page that answered with nothing recent, scored off the stamp on the newest row. An age test
  cannot live in `pageHasData()`. That function decides what kind of document arrived. A failure
  there discards the stored copy and delays the retry. That is the wrong outcome for a week-old
  bulletin, which is a real bulletin and not a broken fetch.
- **Zero rows is not old.** An alarm on a quiet warning feed is the cry-wolf failure the alert design
  standard rejects. So `noticeOld()` never reads an empty JSON array as a sign the feed decayed.
  `jps-beat` (`met_cyclone.json`) covers the case a genuinely empty feed cannot cover for itself. It
  carries a row at all times. So an empty or unreadable heartbeat marks the whole JPS MET mirror old
  on its own. `jps-rain` is legitimately empty on most days, so the heartbeat is the only liveness
  evidence it has.
- **A warning stamp needs the ISO shape, or the merge and the modal both misread it.** `warnWhen()` in
  `js/ui.js` matches `^\d{4}-\d\d-\d\dT\d\d:\d\d` and prints the raw string when a stamp does not
  match it. JPS stamps `17-08-2026 08:00:00`. Left verbatim, that puts two date formats inside one
  modal. The merge sort is a `strcmp` over the same field. So a JPS stamp left in the shape JPS uses
  also misorders the merge. `jpsMetWarnings()` converts the stamp with `date('Y-m-d\TH:i:s', $from)`,
  the same shape `metWarnings()` already emits.
- **A JPS notice feed is an archive of reissues, not a picture of now.** MET reissues one standing
  bulletin every few hours, under one heading and one validity window. `met_gelora.json` held 18
  rows on 2026-08-18. Eight of those rows were one bulletin, valid 17 August to 21 August. Each
  reissue rewords its own list of areas. `hereParts()` then narrows each row to the sentences naming
  somewhere this map covers. Three of the eight reissues named Selangor, and each narrowed
  to a different string. `mergeNotices()` keyed on the title and the text at the time. Three
  different strings made three different keys, so a reader met one bulletin as three cards.
  **The key is the title and the validity window now. It is never the text.** The window identifies
  a bulletin. The text is what changes between issues of it. One heading can still carry two
  bulletins, because a short warning sits inside a standing one. Rows 0 and 1 of that same file did
  exactly that, over 13:00 to 17:00. The window separates them and both survive.
  **The newest issue wins, and the order is what decides that.** `usort()` is stable in PHP 8. JPS
  publishes the newest row first, and `jpsMetWarnings()` keeps that order. So the first row for a
  key is the newest issue of it. `jpsMetWarnings()` discards the `Date` field the feed carries, so
  nothing else can tell one issue from another. Check the order claim again before sorting that
  array anywhere else. `--selftest` holds one assertion on it, and that assertion is the only
  thing that reports a change of feed order.
- **A national bulletin names several regions, and only one of them is ours.** A row-level place
  test keeps the whole bulletin once it names one place this map covers. `met_gelora.json` carried a
  1,795-character bulletin across 16 lines on 2026-08-17. It named Sarawak, Sabah, Selangor, Perlis,
  Kedah and Perak together. The panel printed a wall of text mostly about Borneo. `hereParts()`
  splits the text on sentence and line boundaries, keeps only the parts naming somewhere this map
  covers, and rejoins them. On that row it returns a single 203-character sentence. The gate itself
  stays on the combined English and Malay text, so every row that used to survive still survives.
  Only the display narrows.
- **`floodAlerts()` has never seen a row.** `getdisse.php` answered `[]` on every fetch made during
  design. The field names come from the consumer JavaScript JPS publishes on its own page. That is
  evidence and not a guess. But nobody tested the parser against real data yet. The first
  non-empty response is the moment to check it by hand. **It also skips a check its sibling parser
  keeps, on purpose.** `jpsMetWarnings()` drops a row where `$now < $from`, because a MET bulletin
  describes weather already underway. `floodAlerts()` does not. An `NT_7D` Early alert forecasts a
  flood up to seven days ahead. Dropping it before its own window opens hides a seven-day warning
  until the day it starts. Do not add the missing-looking check back without checking which parser it
  belongs on.
- **MET publishes no past, and the weather panel needs one.** A nowcast marker holds the current
  word and six forward steps at 30 minutes each. It never answers what happened an hour ago. So a
  refresh writes one `level` row per point, keyed `wx-<slug>`. **This app stamps it with the issue
  time MET gives, never the poll time.** That is the rule `readTs()` states for every writer to that
  table.
  The `(station, ts)` primary key dedupes a re-read of one issue to one row. `RETAIN` prunes it
  with everything else. There is no schema change.
  **`WX_PAST` anchors on the issue stamp, not on `now`.** A window measured from `now` drops a
  sample as the clock moves. That changes the `?wx=1` body between two MET issues. A changing body
  kills the 304 — the same fault `cacheAge` caused on the payload. Never put a field in that body
  that moves without the data moving.
- **A station must never supply the district for a weather point.** `metDaily()` keys its rows by
  district and a nowcast point carries none, so the join needs one from somewhere. The nearest
  station is the tempting answer and it is wrong twice. It reads as that station reporting a
  temperature, and no station in this payload holds a weather reading. It is also measurably wrong
  at the edge. The nearest station to `Bentong` sits 20.9 km away, in Hulu Selangor. So a Pahang
  town prints a Selangor temperature instead. `wx-build.php` bakes the district from Nominatim,
  through `district` then `city` then `state`. Kuala Lumpur is a federal territory with no daerah,
  so `city` answers there. Putrajaya answers on `state`.
- **CLOUD AND THUNDERSTORM ARE GONE FROM THIS MAP, and the ladder is the whole vocabulary.** The
  repository owner cut both on 2026-08-25. `WX_CLOUD`, `WX_STORM` and `wxSky()` in `js/config.js`,
  the `sky` branch in `wxIcon()`, two rows of `WX_TONE`, `--wx-cloud` and `--wx-storm` in
  `css/base.css`, `--i-cloud` and `--i-flash_on` in `css/icons.css`, two legend keys, `$row['sky']`
  in `metDaily()` and ten `--selftest` assertions all went with them.
  **The map draws the NOWCAST, and that feed publishes neither word.** Its whole vocabulary is
  `Tiada Hujan`, `Hujan` and `Hujan Lebat`. Both extra words came from the MET DAILY forecast for a
  district, so each drew a claim about a whole district over a whole day, on one point at one
  instant. **The temperature comes off that same daily feed and stays**, because the card prints it
  as a day-scale figure with an arrow for each end and it states its own scale. A glyph on the map
  does not.
  **One assertion replaced the ten**: a `summary_forecast` naming a thunderstorm must add no field
  to the row. That is the deletion, guarded.
  **Do not put either word back without a source that reports it for the instant the map draws.**
- **RUNG 0 HAS TWO GLYPHS and the Malaysian hour picks one, so never assert `sunny` alone.** The
  node harness for `metSection()` did, so it passed all day and failed all night on code that was
  right. It asserts the SET now, `sunny` or `clear_night`. Anything checking a rung 0 glyph has to.
- **The pin ladder used to collapse both wet rungs to `rainy`, and it does not any more.** The
  argument for collapsing was that `rainy_heavy` carries no cloud of its own. Beside `rainy` at a
  31px pin it read as hatching rather than as more of one thing. Color carried the intensity, and
  `WEATHER[].pin` differed from `WEATHER[].icon` for that one rung.
  **A fifth key is what reversed it.** With a bolt on the strip, the map drew five marks and no
  longer four. **The bolt is gone and the reversal stands.** Three marks still need shape to
  separate them, and `rainy_light` against `rainy_heavy` is the pair that argument was really about. Color alone has to separate five things at once. Two of the five are the wet rungs,
  already separated by the smallest step on the ramp. So `WEATHER[2].pin` is
  `rainy_heavy` now, and the two ladders agree on every rung. The hatching argument still holds at
  31px. It is accepted. A reader counting marks on a five-key legend is worse off than a reader
  squinting at one. **Rung 1 draws `rainy_light` rather than `rainy`, and that is what answers the
  hatching.** One streak against two reads as less and more of one thing. Two streaks against three
  reads as two weights of the same hatching, which is the fault above. The three wet glyphs now step
  `rainy_light`, `rainy_heavy`, bolt, and they differ by shape before they differ by color.
  **The weather pins sit in warm hues without joining the status set.** The status rule above
  reserves `--s-alert` and its neighbors for status, and states there is no exception. This does
  not breach it. `--wx-clear` is its own token, muted away from `--s-alert` so it cannot read as
  one. Weather mode also draws no station pin, so nothing status-colored shares the map. The
  status set reads as saturated, and this set reads as muted, so the two also separate by
  vividness. This app measured and rejected gold `#f2b705` for sitting too close. It lands within
  one shade of `--s-alert` on the light theme, and matches `#ffc000` on the dark theme.
  **Heavy differs from rain by saturation and never by lightness.** `.pin` uses one palette on both
  themes, because a pin has to win over the basemap. So a darker heavy pin disappears into the dark
  tile.
  **`wxTone()` in `popup.js` is the one place a glyph gets a colour, and it reads the glyph.** It
  maps one icon name to one `--wx-*` token, so a rung, a night form and a refinement all reach the
  colour through `wxIcon()`. A ladder stated twice drifts. `js/wx.js` held a second one and it is
  gone. Every weather glyph on a card reads it now: the half-hour cards, the `Now` and `Later`
  cells, and the section head over each pair. `--k-weather` stays as the fallback in `.wxbig`.
  **`--wx-moon` is the sixth token and the one the two themes do not share.** A clear night draws
  `clear_night`, and `--wx-clear` is a gold that says daylight. The map keeps off white `#e6e3da`,
  because a pin carries a dark drop shadow to stand against a pale tile. A card glyph carries none,
  and off white on the light theme's card `#f1f3f4` is invisible. So `:root` holds `#7d8794`
  instead. Do not copy either value into the other block. The legend gains no moon key. That strip
  already wraps below 320px with five keys, and it states the ladder rather than the hour.
- **The Weather row in the layer menu draws `partly_cloudy_day`. The rung ladder draws `sunny`.**
  The chip names a layer and reports no rung, so it takes the wider mark. Rung 0 is the rung the
  legend calls `Clear`, so its glyph answers to that word. One revision moved the pin, the card
  glyph and the legend key onto the new mark as well. The repository owner reverted it on
  2026-08-19. Both icons ship, and each one has one job.
- **The day's temperature shares the `NOW` card's bottom line with the clock, and `.wxfoot` is
  that box.** It had a card of its own titled `Today`. One day-scale fact does not take the height
  of a step beside nine half-hour ones, and on that line it costs no height at all. It takes the
  clock's own 11px, because the two share a line and neither one outranks the other. `.wxfoot`
  carries `margin-top: auto` for every step card. `.wxsub` keeps its own copy for the station card,
  where it is still a direct child of `.wxcol`. `stepCard()` takes the pair as its last argument,
  so only the step happening now can draw it.
  **The arrows carry `--wx-cold` and `--wx-warm`, blue for the low and terracotta for the high.**
  That pair argues past the status rule the same way the weather set does. The status set holds
  full saturation and this pair sits well under it, so the two separate by vividness as well as by
  hue. It also draws on an 11px arrow inside a card that reports no status. Do not reach for
  `--wx-heavy` and `--wx-clear` instead. Those name heavy rain and a clear sky on this same card,
  and one token cannot say `hot` and `clear` in one place.
- **Cloud is a refinement of rung 0, never a rung of its own.** The nowcast's whole vocabulary is
  `Tiada Hujan`, `Hujan` and `Hujan Lebat`. Measured 2026-08-18 over all 294 markers, those three
  are the only values it publishes. The page declares a fourth icon, `icon-na.svg`, and no marker
  used it. `Tiada Hujan` means no rain. It does not mean clear sky. So the sun this app drew on
  rung 0 was already the wider claim of the two.
  The word comes from `summary_forecast` on the MET daily feed, through `sky` on the weather point.
  That is the same feed and the same district join that already carry the temperature.
  `metDaily()` reads `mendung` alone. Measured over 500 rows, that feed holds nine values built
  from four phenomena: no rain, `Mendung`, `Hujan` and `Ribut petir`. The four are mutually
  exclusive on a row, so naming `mendung` names the day's headline. A thunderstorm has no rung
  here, and rain the nowcast already answers for the instant the map draws.
  **A fourth rung was the wrong shape and here is why.** `api.php` writes `rungs[0]` into the
  `level` table on every refresh. A new rung changes what every stored row means, and nothing can
  go back and rescore them. `WX_CLOUD` in `config.js` is a descriptor beside the ladder instead.
  **Cloud only ever replaces Clear.** `wxIcon()` and `tone()` both test `r === 0` first, so a wet
  pin can never take the dry glyph or the dry tone. It also outranks the night glyph. A moon says
  the sky is clear, which is the one thing an overcast night is not.
  **The trade-off is real.** `Mendung di beberapa tempat` is a claim about a district across a day,
  drawn on one point at one moment. It is accepted only inside the case where MET itself makes no
  claim about the sky at all.
- **A thunderstorm is the mirror of cloud, and it refines the WET rungs.** The nowcast cannot
  observe lightning. Its three words are about rain and nothing else. `Ribut petir` is the daily
  feed's most common value by a distance: 331 of 500 rows on 2026-08-18, and 13 of the 16 districts
  this map covers. `metDaily()` reads it as `sky: 'storm'`.
  **It applies only from rung 1 up, and that is what keeps it honest.** Both sources have to agree
  that something is falling. The nowcast says it rains here now, and the district's day is forecast
  to carry storms. So calling that rain a thunderstorm adds the one fact the nowcast has no word
  for. At rung 0 nothing is falling, and a bolt over a dry point is the forecast overruling the
  observation. Measured on the 2026-08-18 18:00 poll: 28 of 50 points carried `storm`, 3 of them
  were wet, and 3 bolts drew. The other 25 drew clear.
  **`wxSky()` in `config.js` is the one place that decides a refinement.** The pin glyph, the pin
  colour and the card word all read it, so the three cannot drift. `wxIcon()` and `tone()` state no
  rung test of their own any more.
  **The glyph is `flash_on` and not `thunderstorm`.** The second is a cloud with bolts under it. At
  pin size its cloud reads as the same cloud `rainy` and `cloud` already draw. The three then differ
  only in their hatching. That is the fault the entry above this one describes.
  **`--wx-storm` is a violet, and it sits closest to `--k-rainfall` of any token here.** They never
  share a surface. Weather mode draws no station pin, and `syncHeat()` shows `#lgWx` only while
  every other legend section is hidden. It is lighter than `--wx-heavy` rather than darker, which
  is the rule the palette block below states for the whole set.
- **Every section of the legend fits its own content, and none of them states a box width.** The
  heat sections carried 288px and the weather one carried `fit-content`, through a `:has()` on the
  section that draws. All three are one row on the credit's line now, so all three size on their
  content and that selector is gone. Only the ramp states a width, because a ramp has none of its
  own.
  `.wxkey` is one row too, a 14px glyph beside its word rather than a 22px glyph over it. It still
  wraps. Below about 320px the strip beside the zoom buttons is narrower than five keys. A squashed
  key breaks its own word before it drops a whole one.
- **Weather mode never writes `PREFS.heatLayer`.** `syncHeat()` reads `PREFS.wx` as one more input
  and drops both canvases while the mode is on. So leaving the mode restores whatever heatmap the
  reader had, with nothing remembered and nothing to get wrong. Do not add a "previous layer" field.
  **`PREFS.wx` persists across a reload**, which means a reader can land on a map with no flood
  stations on it. The layer chip states `Weather`, and that chip is the whole of what says why.
- **Two MET points stand 80 m apart and never separate.** `Serdang` and `Seri Kembangan` measure
  16 screen pixels apart at zoom 15. So `WX_THIN_PX` keeps one of them at every zoom a reader uses.
  That is right. Two points 80 m apart report one weather. But somebody who knows both names will
  only ever find one. The layer thins rather than clusters, for the same family of reason. A
  cluster badge reading 6 cannot say WHICH weather.
- **A search bar here filters in place and opens no view.** M3 gives a search bar a search view,
  but `.m3search` only filters rows already on screen. The go-to box is a real search view, and
  `#gotobar` states the same 56px shape. So this app draws one search shape for two behaviors. The
  alternative, M3's outlined text field, is the honest component, and it draws a second field shape.
- **A camera tile is an M3 filled card carrying a 2px status border.** That border is this app's
  status language, not a card outline. M3's outlined card states a 1dp neutral line. Around a 254px
  tile, 1dp of red reads much quieter than 2px. Do not convert it.
- **The table states ONE inset, and it stated two.** `table.data` itself carries the left inset as
  `padding-left: var(--pane)`. Both `td` and `.chead th` now pad with `var(--pane)` too, where each
  once stated a bare 8px. So the left edge read 16px while every column divider read 8.
  `box-sizing: border-box` in `css/base.css:494` keeps the column math steady, since padding sits
  inside each 120px column, not outside it. `table.data td.nm` keeps `padding-left: 0`, since the
  table already places it.
- **`#camBar` declines three parts of the M3 Expressive linear progress indicator.** They are the
  rounded ends, the 4dp gap between the active indicator and the track, and the stop indicator. Each
  shapes a widget parked in a layout. This bar is the state of a boundary.
- **`--pane` is 16px for `#dataBox` and `#camBox`, and 24px for `.docbox` above 600px.** M3 states
  two insets, and the content picks which one applies. An app bar or a list item takes 16dp, and a
  dialog's own prose takes 24dp. These two panels hold list content, and `.docbox` holds paragraphs
  instead. `.docbox` also drops from 18px to 16px on a phone. 18px under a 16px headline reads as a
  mistake, not an indent.
- **The hover panel states its own background and its own shadow, and it carried `class="surface"`
  for both.** Two files once declared one background at equal specificity, and load order alone
  decided which won. That is not a rule anybody can read. This rule also states `border: 0`, since
  the `[popover]` UA sheet sets a solid 3px border on every popover. Without that reset, the outline
  returns at three times the deleted 1px width. `.menu` already restates it for the same reason.
- **A camera tile's state layer is a pseudo-element, and it never takes an inset `box-shadow`.** CSS
  paints an inset shadow with the element's own background, then paints in-flow descendants over it.
  `.camtile > img` is an in-flow descendant, so the shadow stays invisible behind every working
  picture. It shows only on a tile that failed to load. `isolation: isolate` makes this certain,
  because the tile then forms its own stacking context. The overlay takes `z-index: 4`, above
  `.camsay` at 1, `::before` at 2, and `.camfail` at 3.
- **The phone name column and the table's own `min-width` are one number in two places.** The name
  column went 220px to 160px below 600px, because 220 is 61% of a 360px screen. `table.data thead`
  and `table.data tbody` carry a `min-width` that must equal the sum of the six columns. It was 820
  (220 plus five times 120), and it is 760 below 600px. Leave the old floor in place, and the six
  columns stretch to fill 820px on a 360px screen. The table still draws, but only the columns are
  wrong.
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
- Vendored assets only — no CDN, so Tracking Prevention has nothing to block. `leaflet-heat.js` is
**patched**, with `willReadFrequently` on 3 `getContext` calls. Do not overwrite it with a fresh
copy.

## Verify

```bash
composer install                                      # writes lib/ — required before first run
php -l api.php && php -l sources.php                  # lint proxy + scrapers

# Are all three sources actually contributing? parsed:0 means a scraped table moved.
curl -sk https://flood-exp.test/api.php | php -r 'echo json_encode(json_decode(stream_get_contents(STDIN),true)["sources"]),"\n";'

# The portal migration's accounting. A fall in `applied` means a join broke. A rise in the stations
# left on an old feed means the portal dropped rows. ASSERT A RANGE, NEVER AN EQUALITY — two fetches
# an hour apart returned 311 rainfall rows and then 310, and the Selangor page returned 239 on
# 15 August. A station or two of drift is upstream churn, not a fault.
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
$s=$p["sources"]; echo json_encode(["portalrf"=>$s["portalrf"],"national"=>$s["national"],
  "gaz"=>$s["gaz"],"hist"=>$s["hist"]]),"\n";
$k=[]; foreach($p["stations"] as $x) $k[$x["kind"]."/".$x["source"]]++;
ksort($k); echo json_encode($k),"\n";'

# The spread of derived 3 hour rainfall windows, on stations with rain. This is a sanity check on
# the derivation, not a comparison against a referee.
# `api.php` reads `hour3`, the 3 hour total Selangor publishes for itself. It unsets that field
# before the payload ships, so no sweep can see it.
# A different check condemned the old summed approach, scored against that hidden figure before it
# shipped. `accHours()` was out by more than 5 mm on 14 of 176 stations, worst 60 mm.
# SCORE IT ON STATIONS WITH RAIN IN THE WINDOW. A dry station agrees with everything, and that is how
# a rolling field passed for a disjoint one while this was designed.
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
$d=[]; foreach($p["stations"] as $s){ if($s["kind"]!=="rainfall")continue;
 $a=$s["acc"]["h3"] ?? null; if(!$a || $a[0]<=0) continue;   // wet only
 if(($a[1]??0)===0) continue;                                 // the feed answered, nothing to score
 $d[]=$a[0]; }
sort($d); $n=count($d);
printf("%d wet derived 3h windows, median %.1f mm, p90 %.1f mm\n", $n,
  $n?$d[(int)($n*.5)]:0, $n?$d[(int)($n*.9)]:0);'

# This migration must not lose any station's reading. The count of rainfall and river stations with
# a null reading must not rise.
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
$n=0; $t=0; foreach($p["stations"] as $s){ if(!in_array($s["kind"],["rainfall","river"]))continue; $t++;
 $v = $s["kind"]==="rainfall" ? ($s["hourly"]??null) : ($s["level"]??null); if($v===null)$n++; }
echo "$n of $t river and rainfall stations hold no reading\n";'

# Expires every cached page and forces a rebuild.
# This demonstrates recovery, not failure. All three `prf-` keys reach `sources.stale` only when a
# fetch fails. An empty result here shows the pages refetched cleanly on the forced refresh.
# To test the failure path by hand: change one character in `PRF`. Expire the pages and force a
# refresh. Confirm all three `prf-` keys land in `sources.stale`. Then restore `PRF`.
php -r '$d=new PDO("sqlite:.history.db"); $d->exec("UPDATE page SET ts=0");'
curl -sk 'https://flood-exp.test/api.php?force=1' \
  | php -r 'echo json_encode(json_decode(stream_get_contents(STDIN),true)["sources"]["stale"]),"\n";'

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

# The rules in js/popup.js that fail silently and no linter reaches. `stamp()` chooses a clock
# against a date, so a wrong slice index prints an empty string. `spanText()` floors, so a wrong
# rounding claims minutes the record never held. `sirenBand()`, `sparkline()` and `rainBars()` all
# draw whatever they hold, so a degenerate window is a graph that renders nothing and errors
# nowhere. The last block runs every station in the payload through its own graph.
# There is no JS test harness here and this does not add one. The MODULE is evaluated as it ships,
# with only its imports stubbed, so no copy can drift from what runs.
# **Give the palette stubs real values.** `RAIN_COLOR` as a bare `[]` puts `undefined` in the
# readout for 96 rainfall stations, which reads as a fault in the code and is a fault in the check.
node --input-type=module -e "
import fs from 'fs';
const src = fs.readFileSync('js/popup.js','utf8')
  .replace(/^import[\s\S]*?from '\.\/stations\.js';/m,'').replace(/\bexport /g,'');
const noSec = fs.readFileSync('js/util.js','utf8').match(/export const noSec = .*;/)[0].replace('export ','');
const stubs = \`
const SPARK_H=12, NO_INFO='', NEAR_MAX_KM=30, MET_NAME='', ACC_ROWS=[], WEATHER=[{}];
const RIVER_COLOR={1:'r1',2:'r2',3:'r3'},RAIN_COLOR={1:'c1',2:'c2',3:'c3',4:'c4'};
const GAUGE_COLOR={1:'g1',2:'g2',3:'g3'},RAIN_STOPS=[[0],[10],[30],[60]];
const KINDS={river:{color:'B',label:'Water level',one:'Water level',icon:'water_drop'},
  gauge:{color:'T',one:'Flood gauge',icon:'flood'},rainfall:{color:'V',one:'Rainfall',icon:'rainy'},
  siren:{color:'P',one:'Siren',icon:'siren'},camera:{color:'C',one:'Camera',icon:'videocam'}};
const SOURCES={selangor:{label:'Selangor'}},ALERT_TITLE={},camSrc=()=>'',distKm=()=>0;
const hasInfo=s=>s.info!==false,isStale=()=>false,statusColor=n=>'S'+n,scalePos=()=>0;
const levelStops=()=>null,gaugeStops=()=>null,gaugeColor=()=>'',color=()=>'',isFav=()=>false;
const nearestOf=()=>null,nearestCam=()=>null,nearestLevel=()=>null,camAlert=()=>null;\`;
const M = new Function(stubs+noSec+src+
  '; return { stamp, spanText, sirenBand, sparkline, rainBars, dots, kindChips, sensorBody, camLink, levelLink };')();
const now=Math.floor(Date.now()/1000), H=3600;
let bad=0; const is=(g,w,n)=>{const ok=g===w; if(!ok)bad++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':'  want '+JSON.stringify(w)));};
const today=new Intl.DateTimeFormat('en-GB',
  {timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date());

is(M.stamp(today+' 15:45:00'),'15:45','stamp: today -> clock, seconds trimmed');
is(M.stamp('19/09/2025 12:15:00'),'19/09/2025','stamp: another day -> date only');
is(M.stamp(today),today,'stamp: a date with no clock -> the date');
is(M.stamp(Date.parse('2025-09-19T12:15:00+08:00')),'19/09/2025','stamp: unix ms, another day -> date');
is(/^\d\d:\d\d\$/.test(M.stamp(Date.now())),true,'stamp: unix ms, today -> clock');
is(M.spanText(3600*9.6),'9 h','spanText: floors, never rounds up');
is(M.spanText(1800),'30 min','spanText: under an hour keeps minutes');

// dots() emits the favorite two ways and must never emit both. The card HEADER gets a button beside
// the kebab, and openSide() lifts it into the app bar. A sensor's inline menu keeps the row, which
// is what lets somebody star one gauge of six. A lift flag that stops taking the row out puts the
// same action on one card twice, and nothing on screen says which of the two is stale.
// Escape every double quote in here. The whole harness is one double-quoted shell string, and a
// bare backtick in a comment runs as a command substitution.
// The nearest-webcam offer is the same rule at a second control. It left the menu on 2026-08-26 and
// leads the row. A caller that emits it INSIDE the menu draws a correct-looking row that openSide()
// then throws away with the emptied pophead. No backtick and no double quote in this comment: the
// whole harness is one double-quoted shell string, and the rule above already states why.
const S={ id:'wl-1', name:'TEST', kind:'river', source:'selangor', site:'s1',
          updated:'01/01/2026 00:00:00', lat:3, lng:101 };
const near=M.camLink(S,{ id:'camera-9', name:'KG BARU', site:'s2' });
const head=M.dots(S,near,true), inline=M.dots(S);
is(/class=\"icon fav\"/.test(head),true,'dots: the card header emits a favorite BUTTON');
is((head.match(/data-fav/g)||[]).length,1,'dots: and exactly one favorite control, never two');
is(/class=\"mi\" data-fav/.test(head),false,'dots: so its menu carries no favorite ROW');
is(head.indexOf('icon fav')<head.indexOf('icon dots'),true,'dots: the heart comes before the kebab');
is(head.indexOf('icon near')<head.indexOf('icon fav'),true,'dots: and the offer before the heart');
is(head.indexOf('icon near')<head.indexOf('class=\"menu'),true,'dots: outside the menu, never in it');
is(/class=\"icon fav\"/.test(inline),false,'dots: a sensor row emits no button of its own');
is(/icon near/.test(inline),false,'dots: and no offer at all, which belongs to the place');
is(/class=\"mi\" data-fav/.test(inline),true,'dots: it keeps the favorite as a menu row');
// An empty offer still draws, and it must not take the disabled ATTRIBUTE: a disabled button fires
// no pointer event in Chrome, so the one thing it has to say never opens.
is(/aria-disabled=\"true\"/.test(M.camLink(S,null)),true,'camLink: no camera -> aria-disabled');
is(/disabled>|disabled /.test(M.camLink(S,null).replace(/aria-disabled/g,'')),false,
   'camLink: and never the attribute, which would close the tip');
// TWO LINES: what the button is, then what it found. sparktip.js writes the label with
// textContent, so the newline is the only break available and .sparktip takes white-space: pre.
is(M.levelLink(S,{id:'wl-2',name:'R',level:1.74})
   .includes('data-tip=\"Nearest water level\nR · 0.0 km · 1.74 m\"'),true,
   'levelLink: the tip carries the name, the distance and the reading a title could not');
is(M.levelLink(S,{id:'wl-2',name:'R',level:1.74})
   .includes('aria-label=\"Nearest water level. R · 0.0 km · 1.74 m\"'),true,
   'levelLink: and the aria-label keeps ONE line, because a reader announces a newline as a pause');

// kindChips() draws the station panel's app bar row: one chip per KIND, never one per sensor. A
// place with two sirens drew the word Siren twice, which reads as a rendering fault. Three things
// fail silently here. A count printed as x1 on a lone sensor is noise. Sorting the kinds moves the
// lead sensor's chip off the front. And the hue folds with OR, so a chip covering one reporting
// siren and one silent one must keep the kind colour. Grey is this app's no-reading tone, and a
// station with a reading must not look dead.
// No backticks in this comment, and no bare double quotes: the whole harness is one double-quoted
// shell string, so either one breaks the run before node sees it. The rule is stated above too.
const labels=h=>[...h.matchAll(/<\/i>([^<]*)</g)].map(m=>m[1]).join('|');
const hues=h=>[...h.matchAll(/--c:([^\"]*)\"/g)].map(m=>m[1]).join('|');
const K=(kind,info=true)=>({kind,info});
is(labels(M.kindChips([K('siren'),K('siren')])),'Siren ×2','chips: two sirens are one chip with the count');
is(labels(M.kindChips([K('siren')])),'Siren','chips: and one siren carries no multiplier');
is(labels(M.kindChips([K('river'),K('siren'),K('siren'),K('camera')])),
   'Water level|Siren ×2|Camera','chips: each kind once, in the order render.js ranked them');
is(labels(M.kindChips([K('rainfall'),K('river'),K('rainfall'),K('river'),K('river')])),
   'Rainfall ×2|Water level ×3','chips: several repeated kinds each count separately');
is(hues(M.kindChips([K('siren',false),K('siren')])),'P',
   'chips: one reporting siren and one silent one keeps the kind hue');
is(hues(M.kindChips([K('siren',false),K('siren',false)])),'var(--muted)',
   'chips: and goes grey only where none of them reports');

const rects=h=>[...h.matchAll(/<rect[\s\S]*?\/>/g)].map(m=>m[0]);
const A=M.sirenBand(null), B=M.sirenBand([[now-9.3*H,0]]);
const C=M.sirenBand([[now-11*H,0],[now-6*H,1],[now-5*H,0]]);
is(rects(A).length,1,'band: no history -> the empty rail alone');
is(/data-pts/.test(A),false,'band: no history -> no data-pts, or sparktip throws on pointermove');
const b=rects(B)[1];
is(Math.round(+b.match(/x=\"([\d.]+)\"/)[1] + +b.match(/width=\"([\d.]+)\"/)[1]),100,
   'band: one sample carries forward to now');
is(rects(C).filter(r=>r.includes('S3')).length,1,'band: exactly one bar takes the danger red');

const G={warning:0.15,danger:0.3}, R={alert:6.0,warning:7.0,danger:8.30};
const g0=M.sparkline(null,'gauge',G), g1=M.sparkline([[now-4*H,0.12]],'gauge',G);
is((g0.match(/class=\"mk\"/g)||[]).length,2,'spark: a gauge with no readings still draws both marks');
is(/polyline|data-pts/.test(g0),false,'spark: no readings -> no line and no readout');
is(rects(g1).length,1,'spark: one reading -> a dash, not a line');
const r2=M.sparkline([[now-9*H,3.42],[now-5*H,4.80],[now-1*H,5.32]],'river',R);
is(/3.42–5.32 m<\/div>/.test(r2),true,'spark: the caption states the READINGS, and the range alone');
is(/ m over /.test(r2),false,'spark: the span moved to the heading, so the caption cannot print it twice');
is(/8.30/.test(r2.match(/class=\"muted\">[^<]*/)[0]),false,'spark: and never the axis, which holds the marks');
is(/<div class=\"subhead\">Last 12 h</.test(M.sparkline(null,'river',null)),true,
   'spark: and it heads its own window, the same rule rainBars and sirenBand obey');
is(/<div class=\"subhead\">Last 12 h</.test(M.sirenBand(null)),true,
   'band: the clock frame, so the heading is the constant and never the record');
is((r2.match(/class=\"mk\"/g)||[]).length,3,'spark: a river still draws all three marks');
is(/<svg/.test(M.sparkline(null,'river',null)),true,'spark: no readings and no marks -> still a graph');
is(/data-pts|class=\"peak/.test(M.rainBars(null)),false,'bars: no readings -> no readout and no peak');
is(/Last 12 h/.test(M.rainBars(null)),true,'bars: no readings -> heading names the window it drew');

let drew=0, threw=0, faults=0, capBad=0;
for (const s of JSON.parse(fs.readFileSync('.cache.json','utf8')).stations) {
  const k=s.kind; if(!['river','gauge','rainfall','siren'].includes(k)) continue;
  let h=''; try { h = k==='rainfall'?M.rainBars(s.history):k==='siren'?M.sirenBand(s.history)
      :M.sparkline(s.history,k,s); } catch(e){ threw++; console.log('  THREW',s.id,e.message); continue; }
  if(/<svg/.test(h)) drew++; else console.log('  NO GRAPH',s.id,k);
  if(/NaN|Infinity|undefined/.test(h)){ faults++; if(faults<3) console.log('  BAD MARKUP',s.id,k); }
  const c=h.match(/([\d.-]+)–([\d.-]+) m<\/div>/);
  if(c && s.history?.length>1){ const v=s.history.map(r=>r[1]);
    if(Math.abs(+c[1]-Math.min(...v))>0.005||Math.abs(+c[2]-Math.max(...v))>0.005){ capBad++;
      console.log('  CAPTION STATES THE AXIS',s.id,c[0]); } } }
console.log('every station drew a graph:',drew,' threw:',threw,' bad markup:',faults,' bad captions:',capBad);
bad += threw + faults + capBad;

// Every segment of a sensor's body carries a title, and two mechanisms supply them. sensorBody()
// titles the block where it knows the kind. The block titles itself where only it knows its own
// span. A block that stops stating its heading leaves an untitled segment, and nothing on screen
// says which of the two failed. A group of ONE item takes no title, because the section head above
// it already named the only thing under it.
let one=0, many=0, untitled=0, lone=0;
for (const s of JSON.parse(fs.readFileSync('.cache.json','utf8')).stations) {
  let h; try { h = M.sensorBody(s); } catch(e){ untitled++; console.log('  THREW',s.id,e.message); continue; }
  const items = h.split('<li>').slice(1);
  if (!items.length) { untitled++; console.log('  NO SEGMENT',s.id,s.kind); continue; }
  if (items.length === 1) { one++;
    if (/class=\"subhead\"/.test(items[0])) { lone++; console.log('  LONE ITEM TITLED',s.id,s.kind); }
    continue; }
  many++;
  for (const it of items) if (!/<div class=\"subhead\">[^<]+</.test(it)) { untitled++;
    if (untitled<6) console.log('  UNTITLED SEGMENT',s.id,s.kind,it.slice(0,70)); } }
console.log('groups of one:',one,' of several:',many,' untitled:',untitled,' lone titled:',lone);
bad += untitled + lone;
console.log(bad?'FAILURES: '+bad:'all pass'); process.exit(bad?1:0);"
```

```bash
# Is any station plotted outside the district it is filed under? This is the sweep that found the
# shuffled camera batch. It measures each station against the median of its own district, so a large
# district reports real outliers too — BUKIT FRASER is 27 km from the centre of Hulu Selangor and is
# correct. Read it as a shortlist to check by name, never as a list of faults.
php -r '$p=json_decode(file_get_contents(".cache.json"),true);$g=[];
foreach($p["stations"] as $s){if(!$s["lat"]||!$s["lng"])continue;$g[$s["state"]."|".$s["district"]][]=$s;}
$m=function($a){sort($a);$n=count($a);return $n%2?$a[($n-1)/2]:($a[$n/2-1]+$a[$n/2])/2;};$o=[];
foreach($g as $k=>$r){if(count($r)<4)continue;$cl=$m(array_column($r,"lat"));$cn=$m(array_column($r,"lng"));
foreach($r as $s){$km=hypot($s["lat"]-$cl,($s["lng"]-$cn)*cos(deg2rad($cl)))*111;
if($km>25)$o[]=sprintf("%6.1f km  %-24s %-14s %s",$km,$k,$s["id"],$s["name"]);}}
rsort($o);echo implode("\n",$o),"\n";'

# What each published camera point actually is. This is the sweep that solved the shuffle: it names
# the nearest non-camera station to every raw coordinate the feed publishes. A camera in the shuffle
# lands within ~550 m of a station that carries ANOTHER camera's name, and those pairs form one
# closed cycle. A camera near a station of its own name is published correctly. Run it against the
# live list, not .cache.json — the cache holds coordinates CAM_FIX has already rewritten.
php -r '$c=curl_init("https://infobanjirjps.selangor.gov.my/JPSAPI/api/CCTVS");
curl_setopt_array($c,[CURLOPT_RETURNTRANSFER=>1,CURLOPT_SSL_VERIFYPEER=>0,CURLOPT_TIMEOUT=>20]);
$r=json_decode(curl_exec($c),true);curl_close($c);
$p=json_decode(file_get_contents(".cache.json"),true);
$km=fn($a,$b,$c2,$d)=>hypot($a-$c2,($b-$d)*cos(deg2rad($a)))*111;$non=[];
foreach($p["stations"] as $s) if($s["kind"]!=="camera"&&$s["lat"]&&$s["lng"]) $non[]=$s;
foreach($r as $s){$la=(float)$s["latitude"];$ln=(float)$s["longitude"];if(!$la)continue;
$b=null;$bd=1e9;foreach($non as $n){$d=$km($la,$ln,$n["lat"],$n["lng"]);if($d<$bd){$bd=$d;$b=$n;}}
printf("%-5d %-28s %6.0f m  %-30s %s\n",$s["stationId"],$s["stationName"],$bd*1000,$b["name"],$b["district"]);}'

# The vendored M3 token scales must match their source. What this catches is somebody editing a
# generated file by hand. What it cannot catch is upstream moving a number this app relies on, so
# read the diff rather than the exit code. It reaches the network, so run it beside the other
# by-hand bakes rather than on every change.
php m3-build.php
git diff --quiet vendor/m3/tokens.css && echo "OK: matches the source" || echo "MOVED: read the diff, then bump ?v="

php shots-test.php            # one of seven runnable checks. Guards camera retention. Must stay green.
php api.php --selftest       # another. Guards the force-refresh rate limit, cache choice, and the
                              # place-lookup validator/rate limit. Must stay green.
curl -sk "https://flood-exp.test/api.php?shots=1"                          # frame timestamps

# Which rain gauges are claiming rain their own odometer denies. The siren sweep below is the same
# question on the other sensor. Read the three counts together: `null` is the archive being unable
# to answer, not a pass, and it covers every KL gauge because only Selangor publishes an odometer.
# A `false` count climbing past a handful means either JPS broke a batch of gauges or the odometer
# stopped arriving — check `sources.stale` before believing the first one.
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
$r=array_filter($p["stations"],fn($s)=>$s["kind"]==="rainfall");$c=["true"=>0,"false"=>0,"null"=>0];
foreach($r as $s){$b=$s["backed"]??null;$c[$b===true?"true":($b===false?"false":"null")]++;}
echo count($r)," rainfall: ",json_encode($c),"\n";
foreach($r as $s) if(($s["backed"]??null)===false)
  printf("  %-9s %-26s hourly=%-5s status=%s daily=%s\n",$s["id"],substr($s["name"],0,26),
         $s["hourly"],$s["status"],json_encode($s["daily"]??null));'

# Which archived frames still carry an alert span, and which sensor raised each one. The siren rule
# lives in a closure inside the request handler and cannot be reached by --selftest, so this sweep is
# its check: a siren id appearing here must have had a river at its Amaran mark at that time. Both
# stuck relays (siren-50, siren-1081) coloured 14 frames before the rule and none after it.
for d in shots/*/; do id=$(basename "$d"); curl -sk "https://flood-exp.test/api.php?shots=$id"; done \
  | php -r 'while($l=fgets(STDIN)) foreach(json_decode($l,true)?:[] as $f) if($f[1]!==null) echo "$f[2] $f[1]\n";' \
  | sort | uniq -c
curl -sk -o /dev/null -w '%{http_code} %{content_type}\n' \
     "https://flood-exp.test/api.php?shot=1&t=$(curl -sk 'https://flood-exp.test/api.php?shots=1' \
     | php -r 'echo json_decode(stream_get_contents(STDIN))[0];')"          # 200 image/webp

# Place search. Run sparingly — an uncached query reaches Nominatim, a free service with a
# one-request-per-second policy this proxy is the only thing enforcing. Expect a 200 with a
# non-empty `places` array on a real place name.
curl -sk "https://flood-exp.test/api.php?place=Bandar+Utama" \
     | php -r 'echo json_encode(json_decode(stream_get_contents(STDIN),true)),"\n";'

# The two logs this app writes. Both are gitignored, and both are absent on a healthy day.
tail -20 .php-error.log        # PHP: an uncaught throw or a fatal, from api.php or log.php
tail -20 .client-errors.log    # the browser: one JSON line per report, from js/oops.js

# log.php is a public endpoint that writes to disk, so only a POST carrying a JSON object may write
# a line. Expect `wrote 1` from the four requests below. Any other number means a guard has gone.
B=$( [ -f .client-errors.log ] && wc -l < .client-errors.log || echo 0 )
curl -sk -o /dev/null                                     "https://flood-exp.test/log.php"  # GET
curl -sk -o /dev/null -X POST --data 'not json'           "https://flood-exp.test/log.php"
curl -sk -o /dev/null -X POST --data '"a bare string"'    "https://flood-exp.test/log.php"
curl -sk -o /dev/null -X POST --data '{"kind":"error","msg":"verify"}' "https://flood-exp.test/log.php"
echo "wrote $(( $(wc -l < .client-errors.log) - B ))"

# watch.php is the whole of the monitoring on a self-hosted box. The poll cron pipes the payload into
# it. Healthy is silent, and it reports a CHANGE of state so a fault logs once rather than every five
# minutes. Expect exit 0, 1, 1, 0 and exactly two new lines in the log.
rm -f .watch.state
curl -sk https://flood-exp.test/api.php | php watch.php; echo "healthy    -> $?"
printf '' | php watch.php;                               echo "no payload -> $?"
printf '' | php watch.php;                               echo "again      -> $?  (must not log twice)"
curl -sk https://flood-exp.test/api.php | php watch.php; echo "recovered  -> $?"
tail -2 .php-error.log

# metwarn.parsed reads 0 on any calm day, so watch.php must NOT treat it as a fault. Expect 0.
curl -sk https://flood-exp.test/api.php \
  | php -r '$p=json_decode(stream_get_contents(STDIN),true);$p["sources"]["metwarn"]["parsed"]=0;echo json_encode($p);' \
  | php watch.php; echo "metwarn 0  -> $?  (must be 0)"

# watch.php now reads sources.old as well as sources.stale. They name different faults: `stale` is a
# page that did not answer, `old` is a page that answered with nothing recent. On the payload this
# work measured, `old` holds met-warn and `stale` is empty, so watch.php reports a fault and exits 1.
rm -f .watch.state
curl -sk https://flood-exp.test/api.php | php watch.php; echo "first  -> $?"
curl -sk https://flood-exp.test/api.php | php watch.php; echo "again  -> $?  (must not log twice)"
tail -2 .php-error.log
```

```bash
# Are all three weather feeds contributing? Read met.parsed and met.fresh as a pair. parsed:0 means
# MET moved something and the scrape found nothing. parsed high with fresh:0 means the scrape works
# and the upstream has stopped updating, which is a different fault. Never read fresh alone.
curl -sk https://flood-exp.test/api.php | php -r '$s=json_decode(stream_get_contents(STDIN),true)["sources"];
echo json_encode(["met"=>$s["met"],"metday"=>$s["metday"],"metwarn"=>$s["metwarn"]]),"\n";'

# No station may hold a MET point beyond MET_KM. The radius is read out of api.php rather than
# copied here: this check sat at a hardcoded 15 after MET_KM moved to 16.5, and reported the 16
# stations that change was made to recover as failures.
php -r '$p=json_decode(file_get_contents(".cache.json"),true);
preg_match("/MET_KM\s*=\s*([\d.]+)/",file_get_contents("api.php"),$m);$k=(float)$m[1];
echo count(array_filter($p["stations"],fn($s)=>($s["met"]["km"]??0)>$k))," beyond MET_KM ($k km)\n";'

# The weather layer. `points` must hold about 50 rows. A fall means BOX, metPoints() or the MET
# page moved. `temp` reads 0 while api.data.gov.my/weather/forecast answers an empty array. That
# happened on 2026-08-17 — read it beside `metday.parsed` before calling it a fault.
curl -sk "https://flood-exp.test/api.php?wx=1" | php -r '$j=json_decode(stream_get_contents(STDIN),true);
$p=$j["points"] ?? []; printf("points: %d, temp: %d, past: %d\n", count($p),
  count(array_filter($p, fn($x)=>isset($x["tmax"]))),
  count(array_filter($p, fn($x)=>($x["past"] ?? []) !== [])));'

# The ETag must not move between two MET issues. A 200 here means the body carries a field that
# changes without the data changing. Every poll then ships the full body, for as long as a tab
# stays open. That is the fault `cacheAge` caused on the payload.
E=$(curl -sk -D - -o /dev/null "https://flood-exp.test/api.php?wx=1" | tr -d '\r' | awk '/^ETag:/{print $2}')
curl -sk -o /dev/null -w 'must be 304: %{http_code}\n' -H "If-None-Match: $E" \
     "https://flood-exp.test/api.php?wx=1"

# A weather row must never borrow a district from a station. Every district must come from
# wx-places.json, which wx-build.php bakes from Nominatim.
php -r '$j=json_decode(file_get_contents("wx-places.json"),true);
$d=new PDO("sqlite:.history.db");
$w=json_decode($d->query("SELECT body FROM page WHERE url=\"wx:box\"")->fetchColumn(),true);
$bad=0; foreach($w["points"] ?? [] as $p){ if(!isset($p["tmax"])) continue;
 if(!isset($j[$p["id"]])){ $bad++; echo "  NOT BAKED: ",$p["id"],"\n"; } }
echo $bad ? "FAIL: $bad rows\n" : "OK: every temperature came from the baked table\n";'

# The weather archive. One row per point per MET issue, stamped with the issue time MET gives. A
# row stamped with the poll minute means something bypassed the stamp rule.
php -r '$d=new PDO("sqlite:.history.db");
printf("rows: %d, points: %d, newest: %s\n",
  $d->query("SELECT COUNT(*) FROM level WHERE station LIKE \"wx-%\"")->fetchColumn(),
  $d->query("SELECT COUNT(DISTINCT station) FROM level WHERE station LIKE \"wx-%\"")->fetchColumn(),
  date("Y-m-d H:i", (int)$d->query("SELECT MAX(ts) FROM level WHERE station LIKE \"wx-%\"")->fetchColumn()));'

# The rain heat layer, in canvas pixels. Guards the paint distance, the dry-gauge erase and the
# handover between two neighbours — the rules that live in a canvas, where linting and node --check
# cannot reach them. It prints its own verdict. Must read PASS.
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --ignore-certificate-errors --virtual-time-budget=15000 --dump-dom \
  https://flood-exp.test/heat-test.html | perl -0777 -ne 'print $1 if /<pre id="out">([^<]*)</s'

# The narrow-window block. Under NARROW_PX the app draws a full-screen dialog instead of a map.
# Three ways it fails with nothing wrong on screen: a dialog opened over it wins the top layer and
# the block covers nothing, a `cancel` that goes through hands back a broken map on one Escape, and
# a threshold in js/ui.js that drifts from NARROW_PX blocks a width that works. Reads PASS.
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --ignore-certificate-errors --virtual-time-budget=35000 --window-size=1200,900 --dump-dom \
  https://flood-exp.test/narrow-test.html | perl -0777 -ne 'print $1 if /<pre id="out">(.*?)<\/pre>/s'

# The on-map paint chooser. Its button states what the map paints with one glyph, off a `:has()`
# ladder in css/chrome.css. Three silent faults: a wrong rung draws a real glyph for the wrong layer,
# a missing `:not()` hands the answer to stylesheet order, and a rule left off the mask list in
# css/icons.css draws an empty plate. The last one shipped. Also measures the button against every
# other floating box, at 1536 and again at 360. Reads PASS.
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --ignore-certificate-errors --virtual-time-budget=40000 --window-size=1600,1000 --dump-dom \
  https://flood-exp.test/paint-check.html | perl -0777 -ne 'print $1 if /<pre id="out">(.*?)<\/pre>/s'

# The M3 full-screen dialogs below 600px: the station panel, the search, the table, the camera
# wall, About and Help. Loads the app twice, at 360px and at 1200px. Four faults here put nothing
# wrong on screen. A sticky header with `top: 0` pins at the scroller's PADDING edge and holds the
# bar 18 or 20px down. A headline drifting off M3's 56dp is invisible on any one pane. A rule
# written outside the media query moves the desktop, where nothing is meant to move. And a variant
# with no scrim has to keep a way out, which is now the close X and Escape alone. Reads PASS.
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --ignore-certificate-errors --virtual-time-budget=300000 --window-size=1600,1000 --dump-dom \
  https://flood-exp.test/m3-check.html | perl -0777 -ne 'print $1 if /<pre id="out">(.*?)<\/pre>/s'
# **A short budget TRUNCATES this check rather than failing it.** At 120000 it stopped as the desktop
# pass started, after 122 of 274 assertions, with nothing failed and no verdict printed. At 240000
# it printed the opening line alone, once the rail and the bar joined it. Read the last line: no
# `PASS` means the run did not finish, whatever the counts above it say. It holds 902 assertions.

# The app bar wordmark ladder, in rendered pixels. Loads the app in an iframe at fifteen widths and
# asserts one spelling at a time, never wider than its rail, and never a longer spelling on a
# narrower rail. Both faults here are invisible: an overflowing spelling hides under the ellipsis,
# and a selector that loses on specificity draws the drop alone, which is a real rung. Reads PASS.
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --ignore-certificate-errors --virtual-time-budget=40000 --window-size=1800,1000 --dump-dom \
  https://flood-exp.test/title-test.html | perl -0777 -ne 'print $1 if /<pre id="out">(.*?)<\/pre>/s'

# How far apart the stations stand, in blob radii. **Both heat layers, because FEATHER (0.20) is one
# module constant and governs both.** It is not a rain setting. Re-run this before moving it, before
# moving RAIN_KM or HEAT_KM, and before moving the join assertions in heat-test.html.
# The two rows should stay close to each other. Measured 2026-08-14 they are near identical —
# rainfall at 6 km reads 1.21/1.66/1.95 and water at 5 km reads 1.18/1.68/1.99 — so one FEATHER
# fits both. That is not luck: each radius was picked for its own network's density, so the ratio
# lands in the same place. If a future change pulls the two rows apart, FEATHER has to become a
# per-layer option beside `groundKm` rather than stay a shared constant.
# **It thins EVERY station, not the ones currently reporting.** The reporting set changes with the
# weather, and two snapshots an hour apart moved the widest rain pair from 1.58 to 1.90 radii. The
# station geometry does not move. thinHeat() guarantees 1.00 and no more, so read the spread rather
# than the floor. Both populations, because they answer different questions and their percentiles
# differ. A seam shows first between a station and its NEAREST neighbour, so heat-test.html takes its
# probe distances from that row. Join solidity is scored over EVERY overlapping pair instead, since
# any two blobs that meet can show one. At RAIN_KM 9 the rain row read 49 kept and nearest
# 1.13/1.48/1.96 — a SHORTER radius keeps stations relatively FURTHER apart, the opposite of the
# intuition.
php -r '$p=json_decode(file_get_contents(".cache.json"),true);$c=file_get_contents("js/config.js");
preg_match("/RAIN_KM\s*=\s*([\d.]+)/",$c,$m);preg_match("/HEAT_KM\s*=\s*([\d.]+)/",$c,$m2);
$km=fn($a,$b,$c2,$d)=>hypot($a-$c2,($b-$d)*cos(deg2rad($a)))*111;
foreach(["rainfall"=>[["rainfall"],(float)$m[1]],"water"=>[["river","gauge"],(float)$m2[1]]] as $nm=>[$kinds,$R]){
$all=array_values(array_filter($p["stations"],fn($s)=>in_array($s["kind"],$kinds)&&$s["lat"]));
$k=[];foreach($all as $s){foreach($k as $x) if($km($x["lat"],$x["lng"],$s["lat"],$s["lng"])<$R) continue 2; $k[]=$s;}
$nn=[];foreach($k as $i=>$a){$n=1e9;foreach($k as $j=>$b) if($i!=$j) $n=min($n,$km($a["lat"],$a["lng"],$b["lat"],$b["lng"]));
if($n/$R<2)$nn[]=$n/$R;}
$ap=[];foreach($k as $i=>$a){foreach($k as $j=>$b){ if($j<=$i)continue;
$t=$km($a["lat"],$a["lng"],$b["lat"],$b["lng"])/$R; if($t<2)$ap[]=$t;}}
sort($nn);sort($ap);$q=fn($x,$f)=>$x[(int)(count($x)*$f)];
printf("%-9s @%.0fkm: %d stations -> %d kept\n",$nm,$R,count($all),count($k));
printf("  nearest neighbour : %d pairs, median %.2f, p90 %.2f, max %.2f\n",count($nn),$q($nn,.5),$q($nn,.9),end($nn));
printf("  all overlapping   : %d pairs, median %.2f, p90 %.2f, max %.2f\n",count($ap),$q($ap,.5),$q($ap,.9),end($ap));}'

# How much ground the rain layer claims, and how many gauges reporting no rain are left under it.
# This is the sweep that found the 1.8x paint bug: the wash covered 2,747 km2 with 58 dry gauges
# under it. It is a PHP replica of `_field()`, so RAIN_KM and FEATHER are read out of the source and
# never copied here. Expect about 77% of the reach kept, and at most a handful of dry gauges left
# under paint — those share a pole with a wet gauge, where the gate protects the wet reading.
# A dry count in the dozens means the denial stopped running. A kept figure near 96% means the
# per-pixel gate has been replaced by a per-gauge radius again, which under-denies by two thirds.
php -r '$p=json_decode(file_get_contents(".cache.json"),true);
preg_match("/RAIN_KM\s*=\s*([\d.]+)/",file_get_contents("js/config.js"),$m);$R=(float)$m[1];
preg_match("/FEATHER\s*=\s*([\d.]+)/",file_get_contents("js/heat.js"),$m2);$F=(float)$m2[1];
$km=fn($a,$b,$c2,$d)=>hypot($a-$c2,($b-$d)*cos(deg2rad($a)))*111;
$ramp=fn($t,$k)=>1-(($t-$k)/(1-$k))**2*(3-2*($t-$k)/(1-$k));
$ker=fn($t)=>$t>=1?0:($t>$F?$ramp($t,$F):1);
$all=array_values(array_filter($p["stations"],fn($s)=>$s["kind"]==="rainfall"&&$s["lat"]));
$wet=array_values(array_filter($all,fn($s)=>($s["hourly"]??0)>0));
$dry=array_values(array_filter($all,fn($s)=>($s["hourly"]??null)!==null&&$s["hourly"]<=0));
usort($wet,fn($a,$b)=>$b["hourly"]<=>$a["hourly"]);
$k=[];foreach($wet as $s){foreach($k as $x) if($km($x["lat"],$x["lng"],$s["lat"],$s["lng"])<$R) continue 2; $k[]=$s;}
$cell=function($y,$x)use($k,$dry,$km,$R,$ker){$cs=0;$wn=0;$dsum=0;$dn=0;
 foreach($k as $s){$d=$km($y,$x,$s["lat"],$s["lng"]);if($d>=$R)continue;$c=$ker($d/$R);$cs+=$c;$wn+=$c/($d*$d+0.01);}
 foreach($dry as $s){$d=$km($y,$x,$s["lat"],$s["lng"]);if($d>=$R)continue;$c=$ker($d/$R);$dsum+=$c;$dn+=$c/($d*$d+0.01);}
 $cov=1-(1-min(1,$cs))**2; $dcov=1-(1-min(1,$dsum))**2;
 return [$cov, $dn?1-$dcov*($dn/($wn+$dn)):1];};
$st=0.4;$dg=$st/111;$la=array_column($k,"lat");$ln=array_column($k,"lng");$full=0;$lit=0;
for($y=min($la)-0.1;$y<=max($la)+0.1;$y+=$dg){$dx=$dg/cos(deg2rad($y));
for($x=min($ln)-0.1;$x<=max($ln)+0.1;$x+=$dx){[$cov,$keep]=$cell($y,$x);
 if($cov<0.25)continue; $full+=$st*$st; if($cov*$keep>=0.25)$lit+=$st*$st;}}
$on=0;foreach($dry as $d){[$cov,$keep]=$cell($d["lat"],$d["lng"]); if($cov*$keep>=0.25)$on++;}
printf("%d wet -> %d blobs, %d dry. reach %.0f km2, violet %.0f km2 (%d%% kept), %d of %d dry under\n",
count($wet),count($k),count($dry),$full,$lit,round(100*$lit/max(1,$full)),$on,count($dry));'

# Which notices survive the filter, and where each one came from. `kind` names a flood alert or a
# weather warning. `src` names which of the two MET sources answered, or `jps` for the flood alert.
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
foreach($p["warnings"] as $w) printf("%-8s %-5s %s\n  %s\n", $w["kind"], $w["src"]??"?",
  substr($w["title"],0,60), substr(preg_replace("/\s+/"," ",$w["text"]),0,150));'

# Every JPS MET file must decode. A raw newline inside a string breaks json_decode() and must not
# break jsonLoose(). met_gelora is the file that failed a plain decode on 2026-08-17.
php -r 'require "sources.php";
foreach (["met_rain22","met_thunderain2","met_cyclone","met_gelora"] as $f) {
  $u = "https://publicinfobanjir.water.gov.my/wp-content/themes/enlighten/data/$f.json";
  $c = curl_init($u); curl_setopt_array($c,[CURLOPT_RETURNTRANSFER=>1,CURLOPT_SSL_VERIFYPEER=>0,CURLOPT_TIMEOUT=>20]);
  $b = curl_exec($c); curl_close($c);
  $j = jsonLoose($b);
  printf("%-18s %s\n", $f, $j === null ? "NULL decode" : count($j)." rows"); }'

# The two liveness signals must stay apart. `stale` names a page that did not answer at all. `old`
# names a page that answered with nothing recent. On 2026-08-17, `old` held `met-warn` and `stale`
# was empty.
curl -sk https://flood-exp.test/api.php | php -r '$s=json_decode(stream_get_contents(STDIN),true)["sources"];
echo "stale: ",json_encode($s["stale"]),"\n  old: ",json_encode($s["old"]??null),"\n";'

# No notice text may name only places this map does not cover. A row naming Sarawak alone means the
# paragraph filter kept the wrong part of a national bulletin.
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
$here=["selangor","kuala lumpur","putrajaya","klang","melaka","malacca","west coast","pantai barat"];
$bad=0; foreach($p["warnings"] as $w){ $t=strtolower($w["text"]); $ok=false;
 foreach($here as $k) if(str_contains($t,$k)){$ok=true;break;}
 if(!$ok){$bad++; echo "  NAMES NOWHERE HERE: ",substr($w["title"],0,60),"\n";} }
echo $bad?"FAIL: $bad rows\n":"OK: every row names somewhere this map covers\n";'

# The media statement link must reach the JPS page.
curl -sk -o /dev/null -w '%{http_code}\n' "https://publicinfobanjir.water.gov.my/ramalan/pernyataan-media/?lang=en"

# Every pin sample in the Help legend must state its own `--c`. A `.pin` reads
# `color: var(--c, var(--accent))`, so a sample with no `--c` draws in the accent blue instead of the
# colour the sentence beside it names. The "at danger" sample shipped that way: an accent-blue drop
# inside the pulsing red halo, under a line promising the reader it fills red. The map was right the
# whole time, which is why this reads as a map fault and is not one.
grep -n 'class="pin[ "]' index.html | grep -v -- '--c:' \
  && echo "FAIL: a legend pin sample has no --c" || echo "OK: every legend pin states its colour"

# The tally chips in the alert panel head must partition the list under them, so the forecast chip
# reads a tier and not a flag. A river at its danger mark can also be rising, and `tier()` files it
# under `now` alone — so a chip counting `s.rising` claims a second alert the cards never draw.
# `alerts.js` evaluates the DOM at module scope, so node cannot load it. This grep is the check.
grep -q 'live.filter(s => s.rising && tier(s) === .soon.)' js/alerts.js \
  && echo "OK: the forecast chip counts a tier" || echo "FAIL: the forecast chip double-counts"

# Which stations hold two alert flags at once. Nothing is wrong when this lists a row. It names the
# case the check above guards, so a reader can see the chips against the cards on a live payload.
php -r '$p=json_decode(file_get_contents(".cache.json"),true);
foreach($p["stations"] as $s) if($s["kind"]==="river"&&($s["status"]??0)>=3&&!empty($s["rising"]))
  printf("%-8s %-26s at danger AND rising\n",$s["id"],$s["name"]);'

# color() in js/util.js, the three-colour rule. A sensor wears its own kind, the alert amber or the
# danger red, and never a fourth. Nothing else in this repo can see a fourth colour: the ladders live
# in three tables in config.js, each read by a different surface, and a rung added to one of them
# draws correctly and errors nowhere.
# Two halves. Where each ladder crosses, stated once per kind, so a moved cutoff fails here rather
# than on a wet afternoon. Then every station in the live payload, which is what catches a rung this
# file forgot to name.
# The MODULES are read as they ship, with only their own tables lifted out, so no copy can drift.
# **Grab RIVER_COLOR and RAIN_COLOR to `\};` and not to `;`.** Both are object literals spanning two
# lines, and a lazy `.*?;` stops at the semicolon inside the first line's `--s-none)`.
node --input-type=module -e "
import fs from 'fs';
const cfg = fs.readFileSync('js/config.js','utf8'), util = fs.readFileSync('js/util.js','utf8');
const grab = (s, re) => s.match(re)[0].replace(/export /g,'');
const C = re => grab(cfg, re), U = re => grab(util, re);
const M = new Function(
  C(/const KINDS = \{[\s\S]*?\n\};/) +
  C(/const RIVER_COLOR = [\s\S]*?\};/) + C(/const RAIN_COLOR  = [\s\S]*?\};/) +
  C(/const STATUS_COLOR = .*;/) + C(/const GAUGE_COLOR = .*;/) + C(/const NO_INFO = .*;/) +
  U(/const statusColor = .*;/) + U(/const gaugeTone = s =>[\s\S]*?: 1;/) +
  U(/const gaugeColor = .*;/) + U(/const hasInfo = s =>[\s\S]*?\?\? false\);/) +
  U(/const sounding = .*;/) + U(/const raining = .*;/) +
  U(/function color\(s\) \{[\s\S]*?\n\}/) + '; return { color, KINDS };')();
let bad=0; const is=(g,w,n)=>{const ok=g===w; if(!ok)bad++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':'  want '+JSON.stringify(w)));};
const R=st=>({kind:'river',online:true,level:1,status:st});
is(M.color(R(0)),'var(--k-river)','river: normal -> its own blue');
is(M.color(R(1)),'var(--s-alert)','river: alert mark -> amber');
is(M.color(R(2)),'var(--s-alert)','river: warning mark -> the SAME amber');
is(M.color(R(3)),'var(--s-danger)','river: danger mark -> red');
const G=(d,st)=>({kind:'gauge',online:true,depth:d,status:st});
is(M.color(G(-0.2,0)),'var(--k-gauge)','gauge: dry ground -> its own taupe');
is(M.color(G(0.05,0)),'var(--k-gauge)','gauge: water under 0.15 m -> the SAME taupe');
is(M.color(G(0.2,1)),'var(--s-alert)','gauge: past the 0.15 m mark -> amber');
is(M.color(G(0.4,2)),'var(--s-danger)','gauge: past the 0.3 m mark -> red');
const P=(st,h,b=true)=>({kind:'rainfall',online:true,hourly:h,status:st,backed:b});
is(M.color(P(1,5)),'var(--k-rainfall)','rain: light -> its own violet');
is(M.color(P(2,20)),'var(--k-rainfall)','rain: moderate -> the SAME violet');
is(M.color(P(3,45)),'var(--s-alert)','rain: heavy, over 30 mm/h -> amber');
is(M.color(P(4,70)),'var(--s-danger)','rain: very heavy, over 60 -> red');
is(M.color(P(3,45,false)),'var(--k-rainfall)','rain: a gauge its own odometer denies keeps the violet');
is(M.color({kind:'siren',online:true,status:0}),'var(--k-siren)','siren: idle -> its own pink');
is(M.color({kind:'siren',online:true,status:1,backed:true}),'var(--s-danger)',
   'siren: sounding -> red, and no middle rung');
is(M.color({kind:'camera',online:true,image:'x'}),'var(--k-camera)','camera: always its own cyan');
is(M.color({kind:'river',online:false,level:1,status:3}),'var(--s-none)',
   'no reading outranks every rung');
const ok = k => new Set([M.KINDS[k].color,'var(--s-alert)','var(--s-danger)','var(--s-none)']);
const seen={};
for (const s of JSON.parse(fs.readFileSync('.cache.json','utf8')).stations) {
  const c = M.color(s); (seen[s.kind] ||= new Set()).add(c);
  if (!ok(s.kind).has(c)) { bad++; console.log('  FOURTH COLOUR',s.kind,s.id,c); } }
for (const k of Object.keys(seen).sort())
  console.log('    '+k.padEnd(9)+[...seen[k]].sort().join(' '));
console.log(bad?'FAILURES: '+bad:'all pass'); process.exit(bad?1:0);"

# tier() in js/util.js, the four-rung alert ladder. `js/alerts.js` evaluates the DOM at module scope
# so node cannot load it, and the rung itself lives here where node can.
# Two halves. The ladder in both directions, including the `raining()` guard that keeps a stuck gauge
# off five surfaces. Then the four places a tier NAME has to appear: TIER_TAG, chrome.css,
# ALERT_TITLE, and the line in camAlert() that keeps `heavy` off a camera. A tier missing any of
# those draws a card with a bare grey rule and errors nowhere.
# The isCritical grab ends `;[\r\n]` and not `;\n`. These files carry CRLF, and `;\n` matches nothing.
node --input-type=module -e "
import fs from 'fs';
const src = fs.readFileSync('js/util.js','utf8');
const grab = re => src.match(re)[0].replace(/export /g,'');
const M = new Function(
  grab(/const sounding = .*;/) + grab(/const raining = .*;/) +
  grab(/const isCritical = s =>[\s\S]*?;[\r\n]/) + grab(/const isHot = .*;/) +
  'const hasInfo = s => s.info !== false; const isStale = s => !s.online;' +
  grab(/const tier = s =>[\s\S]*?'soon';/) + grab(/const TIER_RANK = .*;/) +
  '; return { tier, TIER_RANK };')();
let bad=0; const is=(g,w,n)=>{const ok=g===w; if(!ok)bad++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':'  want '+JSON.stringify(w)));};
const R=(status,hourly=40,x={})=>({kind:'rainfall',status,hourly,backed:true,online:true,info:true,...x});
is(M.tier(R(2)),null,'rain: class 2 is not on the list at all');
is(M.tier(R(3)),'heavy','rain: class 3 takes the amber rung');
is(M.tier(R(4,70)),'now','rain: class 4 takes the red one');
is(M.tier(R(3,40,{backed:false})),null,'rain: an unbacked gauge raises nothing');
is(M.tier(R(3,0)),null,'rain: a gauge reading zero raises nothing');
is(M.tier(R(3,40,{online:false})),'stale','rain: stale still outranks the rung');
is(M.tier({kind:'river',status:3,online:true,info:true}),'now','river at danger untouched');
is(M.tier({kind:'river',status:1,rising:true,online:true,info:true}),'soon','a rising river untouched');
is(M.tier({kind:'siren',status:1,backed:true,online:true,info:true}),'now','a siren untouched');
is(M.TIER_RANK.now < M.TIER_RANK.heavy,true,'ranks: red sorts above amber rain');
is(M.TIER_RANK.heavy < M.TIER_RANK.soon,true,'ranks: observed rain sorts above a forecast');
is(M.TIER_RANK.soon < M.TIER_RANK.stale,true,'ranks: stale still sorts last');
const tags = fs.readFileSync('js/alerts.js','utf8').match(/const TIER_TAG = \{[\s\S]*?\};/)[0];
const css = fs.readFileSync('css/chrome.css','utf8');
for (const t of Object.keys(M.TIER_RANK)) {
  is(tags.includes(t+':'),true,'TIER_TAG names '+t);
  is(css.includes('.alert.t-'+t),true,'chrome.css paints .alert.t-'+t); }
const titles = fs.readFileSync('js/config.js','utf8');
for (const k of ['rainfall|heavy','rainfall|now','rainfall|stale'])
  is(titles.includes(\"'\"+k+\"'\"),true,'ALERT_TITLE holds '+k);
is(fs.readFileSync('js/stations.js','utf8').includes(\"t === 'heavy'\"),true,
   'camAlert drops the heavy rung before it ranks a camera');
// The M3 markup contract. m3-check.html measures a FIXED card, so only this half can say that the
// real groupCard() emits the classes those rules key on. A card missing either one still renders.
const src2 = fs.readFileSync('js/alerts.js','utf8');
is(/class=\"nsub\"/.test(src2),true,'groupCard heads itself with a list subheader');
// No glyph and no disc in that head. Three shapes were tried and all three were cut — see the
// gotcha list. The Notices pane keeps its own, so this reads alerts.js and never the stylesheet.
is(/nsub\">\$\{rows/.test(src2),true,'and it states the kind in words, with no glyph and no disc');
is(/class=\"alerttop\"/.test(src2),false,'and the chip row it replaced is gone');
is(/class=\"slist mseg\"/.test(src2),true,'groupCard declares its list segmented');
is(/<div class=\"badges\">/.test(src2),true,'the alert head emits a .badges row, so openSide lifts it');
is(/i-near_me/.test(src2),true,'and Nearest first is a chip in it, not a fragment in the headline');
is(/class=\"tally\"/.test(src2),false,'and the pill row it replaced is gone');
console.log(bad?'FAILURES: '+bad:'all pass'); process.exit(bad?1:0);"

# Which rain gauges are on the alert list right now, and on which rung. Class 3 draws amber and class
# 4 draws red. A gauge here whose `backed` reads false is a fault in the guard, not weather.
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
foreach($p["stations"] as $s){ if($s["kind"]!=="rainfall")continue;
 if(($s["status"]??0)<3 || ($s["hourly"]??0)<=0 || ($s["backed"]??null)===false) continue;
 printf("%-6s %-30s %5s mm/h  class=%s  %s\n",$s["status"]>=4?"now":"heavy",
   substr($s["name"],0,30),$s["hourly"],$s["status"],$s["updated"]); }'

# The Selangor feed's own status field must never disagree with rainStatus(). It did, on 4 of 281
# gauges, and TAMAN FRIM KEPONG published class 2 over 51.5 mm an hour against its own spHeavy of 31.
# api.php scores every reading itself now. Expect 0.
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
$rs=fn($h)=>$h===null?-1:($h>60?4:($h>30?3:($h>10?2:($h>0?1:0))));
$n=0; foreach($p["stations"] as $s){ if($s["kind"]!=="rainfall")continue; $h=$s["hourly"]??null;
 if($h!==null && $rs((float)$h)!==(int)$s["status"]){ $n++;
   printf("  %-8s %-28s %s mm/h feed=%s derived=%s\n",$s["id"],substr($s["name"],0,28),$h,$s["status"],$rs((float)$h)); } }
echo $n?"FAIL: $n disagree\n":"OK: every rainfall status came from rainStatus()\n";'

# metSection() in js/popup.js, the station card's weather section. Every headline has to come out of
# the WEATHER ladder in config.js, and that ladder holds THREE rungs: Clear, Rain, Heavy rain. A
# phrase written in the template is a second name for a rung this app already names, and the dry
# case shipped as `No rain` for one revision. Two more words, `Cloudy` and `Thunderstorm`, came off
# the MET DAILY forecast and the repository owner cut both on 2026-08-25.
# The module is evaluated as it ships, with only its imports stubbed, so no copy can drift from what
# runs. Give the ladder stub its REAL values: a bare [] makes every headline `undefined`, which
# reads as a fault in the code and is a fault in the check.
# **Read the ITEMS and never the whole section.** The section head is a <b> too and WX_NOW carries a
# glyph, so a document-wide search reads the title `Weather` as a headline and the play arrow as the
# weather. That failed four assertions on markup that was right.
node --input-type=module -e "
import fs from 'fs';
const src = fs.readFileSync('js/popup.js','utf8')
  .replace(/^import[\s\S]*?from '\.\/stations\.js';/m,'').replace(/\bexport /g,'');
const stubs = \`
const SPARK_H=12, NO_INFO='', NEAR_MAX_KM=30, MET_NAME='MET', ACC_ROWS=[];
const WEATHER=[{icon:'sunny',night:'clear_night',pin:'sunny',word:'Clear',line:''},
 {icon:'rainy_light',pin:'rainy_light',word:'Rain',line:'Rain'},
 {icon:'rainy_heavy',pin:'rainy_heavy',word:'Heavy',line:'Heavy rain'}];
const RIVER_COLOR={},RAIN_COLOR={},GAUGE_COLOR={},RAIN_STOPS=[[0],[10],[30],[60]];
const KINDS={},SOURCES={},ALERT_TITLE={},camSrc=()=>'',distKm=()=>0;
const hasInfo=()=>true,isStale=()=>false,statusColor=n=>'S'+n,scalePos=()=>0;
const hasWx=m=>!!m&&m.now!=null&&m.hr1!=null&&m.tmax!=null&&m.tmin!=null;
const levelStops=()=>null,gaugeStops=()=>null,gaugeColor=()=>'',color=()=>'',isFav=()=>false;
const titleCase=s=>s,noSec=s=>s;
const nearestOf=()=>null,nearestCam=()=>null,nearestLevel=()=>null,camAlert=()=>null,nearestWx=()=>null;
const PREFS={};\`;
const M = new Function(stubs+src+'; return { metSection };')();
let bad=0; const is=(g,w,n)=>{const ok=JSON.stringify(g)===JSON.stringify(w); if(!ok)bad++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':'  want '+JSON.stringify(w)));};
const items = met => M.metSection({ met: { at:'X', km:1, stamp:0, tmin:24, tmax:33, ...met } })
  .split('<li class=\"wxstep').slice(1).map(li => ({
    glyph: li.match(/class=\"i i-([a-z_]+)\" aria-hidden/)[1],
    head: li.match(/<b>([^<]*)<\/b>/)[1].trim(),
    sub: li.match(/class=\"wx(?:when|now)\"[^>]*>(?:<i[^>]*><\/i>)?([^<]*)</)[1].trim(),
  }));
const later = met => items(met)[1];
// **Rung 0 has TWO glyphs and the clock picks one.** metSection() passes no clock, so wxIcon()
// reads the hour in Malaysia. An assertion naming `sunny` therefore passes all day and fails all
// night, on code that is right. Assert the SET.
const CLEAR = ['sunny','clear_night'];
const r0 = (r, sub, n) => { is([r.head, r.sub], ['Clear', sub], n);
  is(CLEAR.includes(r.glyph), true, n + ': a rung 0 glyph, day or night -> ' + r.glyph); };
r0(later({now:0,hr1:0}), 'In the next 3 hours',
   'dry: the ladder word under the glyph it names, never a phrase written here');
r0(items({now:0,hr1:1,rung:1,to:'19:30'})[0], 'Now',
   'the Now row states the rung now and says Now');
is(later({now:0,hr1:1,rung:1,to:'19:30'}),{glyph:'rainy_light',head:'Rain',sub:'Until 19:30'},
   'wet: the span repeats no word from the headline');
is(later({now:0,hr1:1,rung:2,from:'18:00',open:true,to:'20:30'}),
   {glyph:'rainy_heavy',head:'Heavy rain',sub:'From 18:00, past 20:30'},
   'wet: an open span names both ends');
// A `sky` word must change NOTHING. It named a cloud on rung 0 and a bolt on the wet rungs, off the
// MET daily forecast, and it is deleted from api.php down. A stray refinement re-entering here is
// the map claiming what the nowcast never reported.
is(items({now:0,hr1:1,rung:1,to:'19:30',sky:'storm'}),items({now:0,hr1:1,rung:1,to:'19:30'}),
   'a storm sky changes nothing');
is(items({now:0,hr1:0,sky:'cloud'}),items({now:0,hr1:0}),'a cloud sky changes nothing');
// Three words, and no fourth. Sweep every rung and both shapes of the span.
const words = new Set(['Clear','Rain','Heavy rain']);
const all = [{now:0,hr1:0},{now:1,hr1:1,rung:1,to:'1'},{now:2,hr1:1,rung:2,to:'1'},
  {now:2,hr1:1,rung:2,from:'1',open:true,to:'2'},{now:1,hr1:1,rung:1,to:'1',sky:'storm'}]
  .flatMap(items).map(r => r.head);
is([...new Set(all)].filter(x => !words.has(x)),[],'every headline is one of the ladder three');
console.log(bad?'FAILURES: '+bad:'all pass'); process.exit(bad?1:0);"

# titleCase() in js/util.js, the one rule that turns a JPS name into a title. It has three tests for
# an acronym and one exception list, and every one of them was measured against the live payload. A
# wrong branch here does not throw. It lowercases an acronym, or leaves a whole name in capitals.
# The module is read as it ships, so no copy can drift from what runs.
node --input-type=module -e "
import fs from 'fs';
const M = new Function(fs.readFileSync('js/util.js','utf8')
  .match(/const ABBR[\s\S]*?cap\(w\)\);/)[0].replace(/export /g,'') + '; return titleCase;')();
let bad = 0; const is=(g,w,n)=>{const ok=g===w; if(!ok)bad++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':'  want '+JSON.stringify(w)));};
is(M('BATU 9, HULU LANGAT'),'Batu 9, Hulu Langat','plain capitals');
is(M('T.T.D.I JAYA, SHAH ALAM'),'T.T.D.I Jaya, Shah Alam','an acronym written with stops is kept');
is(M('SMK SRI AMAN PURI (F2)'),'SMK Sri Aman Puri (F2)','a vowel-less acronym is kept');
is(M('KG. SG. SELISIK'),'Kg. Sg. Selisik','the eight Malay abbreviations lower');
is(M('Pintu Air SG.PELEK'),'Pintu Air Sg. Pelek','and split when JPS runs one together');
is(M('Sg. Midah Di Lebuhraya KL-Seremban'),'Sg. Midah Di Lebuhraya KL-Seremban','a hyphen is a boundary');
is(M('P/A KG. BARU HICOM (F2)'),'P/A Kg. Baru Hicom (F2)','a slash is one too');
is(M('LN B27 RAWANG'),'LN B27 Rawang','a token holding a digit is a code');
is(M(null),'','null is empty, never the word null');
// No name may lose or gain a character. The one pass that inserts a space is the SG.PELEK split, so
// the comparison ignores whitespace.
const names = JSON.parse(fs.readFileSync('.cache.json','utf8')).stations.map(s=>s.name);
is(names.filter(n => M(n).replace(/\s/g,'').length !== n.replace(/\s/g,'').length).length, 0,
   'no name loses or gains a character');
console.log(bad?'FAILURES: '+bad:'all pass'); process.exit(bad?1:0);"

# No `title` attribute anywhere, and no script that writes one. A `title` opens on no phone, so its
# words are missing on half the devices this runs on, and beside the styled tip it draws a second
# tooltip shape for one control. `data-tip` is the one channel — see js/sparktip.js. A `title` costs
# nothing to add and nothing on screen says it is there, so this grep is the only thing that catches
# one coming back. `document.title` is the window title bar and is not a tooltip.
grep -rn '\btitle=\|\.title *=' js/*.js index.html | grep -v 'document\.title' \
  && echo "FAIL: a title attribute is back" || echo "OK: data-tip is the only tooltip"

# Leaflet writes its own on the two zoom buttons, and js/map.js takes them off after `addTo()`. That
# repair is in an app file, so the grep above cannot see it go. Read the RENDERED page instead: it
# is the only check that covers a vendored library writing an attribute at runtime. Expect nothing.
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --ignore-certificate-errors --virtual-time-budget=25000 --dump-dom https://flood-exp.test/ \
  | grep -o 'title="[^"]*"' | sort -u

# Every module must carry a modulepreload link, except the six loaded on demand. There is no build
# step to generate that list, so it goes stale silently when somebody adds a module.
for f in js/*.js; do
  case $(basename $f) in timeline.js|table.js|wall.js|test.js|clip.js|wx.js) continue;; esac
  grep -q "modulepreload\" href=\"$f\"" index.html || echo "MISSING modulepreload: $f"
done
```

There is otherwise no test suite. Changes are verified four ways. Lint the PHP. Syntax-check the modules. Query `.cache.json` for
the data shape being relied on. Then look at the page.

`shots-test.php`, `php api.php --selftest`, `heat-test.html`, `title-test.html`,
`narrow-test.html`, `paint-check.html` and `m3-check.html` are the seven runnable checks here, and
each guards a different risk.

`shots-test.php` is deliberately narrow: retention is the only rule in this repo that can *quietly
destroy* data. Everything else either works or visibly does not. A prune that buckets a frame
wrongly deletes months of camera history, and looks identical to one that worked. It also runs on
every capture. So a rule that shaves one extra frame per pass empties the archive over a week. It is
never wrong in a single run. Hence the idempotence assertion.

`api.php --selftest` guards the decisions that gate a request to an upstream — JPS **or** Nominatim,
now that `?place=` reaches a second one. `forceAllowed()`'s rate limit and `serveFromCache()`'s
cache-or-rebuild choice are the original two. Both are arithmetic on a few integers. So the check
runs offline in milliseconds, rather than through a 270-request fan-out. The place lookup added its
own block of the same shape. It covers `placeQuery()`'s validation: length, whitespace collapse, and
the invalid-UTF-8 case with no PHP notice. It covers `placeParam()`'s array-cast guard, from the
gotcha above. And it covers `forceAllowed()` reused at `PLACE_EVERY`'s window, for the per-second
Nominatim limit. That is fifteen assertions in all, half the check's total. All are offline for the
same reason. No test here must cost a real request to either upstream.

`heat-test.html` guards the one part of this app that lives in canvas pixels. The rain heat layer
paints a distance and then erases what a gauge reporting no rain denies. Neither rule is visible to
`php -l`, to `node --check`, or to any query over `.cache.json`. Both are wrong only on screen.
It needs a browser, so it runs headless and prints its own verdict rather than a picture. It earned
its place immediately. Six faults survived the code review that wrote the layer. The check and its
probes found all six:

- simpleheat's leaked `globalAlpha`
- an eraser reaching across a wet gauge and restating its rainfall as a lighter class
- a brush that peaked where no pixel sits
- a paint falloff that drew four rain classes out of one reading
- `heatScale()` sizing a layer the map had already dropped
- a gradient filled as a square, erasing its neighbour's blob

Two of the six had shipped for months, and no amount of reading found either. Anything else added to
a canvas here needs the same treatment. A canvas is where reading the code stops working.

**A seventh fault got past it, and how it did is the lesson.** `cov` took the max of the blend
weights and drew a Voronoi border on every equidistant line. The check held two assertions over
overlapping gauges and both passed. Both probe two gauges exactly one radius apart, which is the one
spacing where a max behaves. A reader found it on screen instead. **`thinHeat()` guarantees one
radius and nothing more, so one radius is the best case and never the typical one.** The assertions
added after it probe at 1.48 and 1.60 radii. The spacing sweep takes both off the station geometry.
Pick a probe distance from measured data. Otherwise the check reports on a case the map never draws.

`title-test.html` guards the app bar wordmark ladder, which is the same class of problem one layer
up. The rungs are container queries against measured font widths, and both ways they fail put
nothing wrong on screen. A threshold set too low draws a spelling wider than its rail, and the
ellipsis hides the overflow. A selector that loses on specificity draws no spelling at all, which is
a real rung of the ladder. The second one shipped for one run.

The check loads the app in an iframe at fifteen widths and reads the rungs back. The rail is a
rendered width, and no query over the source can state it.

`narrow-test.html` guards the narrow-window block, which is the one surface here that takes the
whole app away from a reader.

Three faults put nothing wrong on screen. A dialog opened over the block wins the top layer and the
block covers nothing. A `cancel` that goes through hands back a broken map on one Escape. A
threshold in `js/ui.js` that drifts from `NARROW_PX` blocks a width that works.

It reads `NARROW_PX` out of `js/config.js` rather than carrying a copy. A check that holds its own
copy of a constant reports on the number it remembers. It does not report on the number the app
uses.

**Assert the property, not the scenario, and two attempts here show why.** A `showModal()` call from
the check asserts a call the check made. It passes against an app put back to a plain `show()`.
Narrowing a live iframe reaches the call the app makes. That needs a layout, and headless virtual
time supplies no reliable clock to wait on.

Focus is the property. A modal dialog makes the page behind it inert, and a modal dialog is in the
top layer by definition.

`paint-check.html` guards the layer chips over the map. What it asserts is rendered pixels, and none
of it reaches `php -l`, `node --check` or any query over `.cache.json`.

**Five shapes came before this one and every one of them failed on the same axis.** A glyph plate in
the map's corner read as a map pin. An accent FAB with a label shouted. Then a panel behind a
`layers` button, a bottom sheet on a phone, connected button groups inside that panel, and size-lg
square outlined buttons. Each one put a settings dialog between a reader and a setting. The chips ARE
the control now.

**The deletions are asserted, and that is the assertion nothing else can make.** `#paintmenu`,
`#paint` and `#navLayers` are gone. Markup left behind by a half-finished revert draws a dead button
on the map and errors nowhere.

**Two chip kinds, told apart by shape.** A menu chip states its VALUE as its label and carries a
trailing arrow. A filter chip states a NAME and answers with a leading checkmark. The check reads
both halves on all four chips, because a chip carrying neither mark looks deliberate.

**Chromium does not restyle a `:has(input:checked)` subject when a SCRIPT changes that
checkedness.** `matches()` answers true and `getComputedStyle` hands back the unchecked value.
Measured on this build. So the selected chip's own pixels are read from a page that LANDS with the
filter on, never after a scripted click.

**A filter with no members is disabled, and `syncPins()` clears the preference when one empties.**
That is correct behaviour, and a scenario test reads it as a failure. So the check writes a real
station id into `PREFS.favs` first, taken out of the live payload. A made-up id leaves the filter
with nothing to match, and the app clears it again.

**A reload replaces the document, so every helper bound to the old one goes stale.** The favorite
block is last in the desktop pass for that reason, and it rebinds.

**A resolved token is not a painted pixel.** An early version asserted `--i` alone and passed on a
button drawing an empty plate, because a rule had never joined the mask list in `css/icons.css`. It
reads `mask-image` and the box size too.

**Headless virtual time does not run CSS transitions faithfully, so no check here can measure one
mid-flight.** Reading an animated collapse 120ms in returned a value that then stuck at 0 for the
rest of the run, on markup that works in a real browser.

So an animation is asserted as a DECLARATION, once, and then `paint-check.html` injects
`* { transition: none !important }` into the frame and measures every state settled. Assert the
declaration BEFORE that override, or the override is what gets read.

**Geometry is measured with a menu OPEN.** A closed popover is `display: none`, so every rect inside
it reads zero and an assertion compares 0 against 0.

**It paints after every assertion, not once at the end.** A check that reports only on completion
reports nothing at all when it hangs, and this one hung. The whole body is in a `try` for the same
reason.

**Nothing else in this app could see a box landing on its neighbour.** A box correct against the
pane, correct against the window and correct against the card is still wrong if it lands on the one
beside it. So the check intersects the chip row against every other box on the map, at both widths.

**Below 600px the row wraps, and that is asserted as two rows.** Four chips need about 440px and a
compact map is 360. A row that scrolled sideways would hide the chips past its edge with nothing on
screen to say they exist.

`m3-check.html` guards the six M3 full-screen dialogs below 600px. It is the same class of problem
as `paint-check.html`: rendered pixels, and no query over the source can state one of them.

Four faults here put nothing wrong on screen and three of them shipped during the work.

**A sticky header pins to the scroller's PADDING box.** So `top: 0` holds the bar 18 or 20px down
and the content scrolls through the gap above it. That reads as a browser artifact rather than as a
wrong number, and it happened in two panes.

**The headline starts on M3's 56dp across five panes built from four different paddings.** Drift
there is invisible on any one pane. It only shows when two stand side by side, which is the one
thing a reader never does.

**A rule written outside the media query moves the desktop**, where nothing here is meant to move.
So the check loads the app a second time at 1200px and reads the wide layout back: the 288px rail,
the 360px panel, the trailing ×, the two slide transforms and the four floating dialogs.

**A variant with no scrim has to keep a way out.** The scrim tap and the swipe both went with the
bottom sheet they belonged to. So the check asserts the station card has a close button at all, and
drives a real Escape through the document to reach the handler the app registered.

It reuses two rules the checks above it already state. Transitions are switched off in the frame
before anything is measured. And geometry is read with the pane OPEN, because a closed dialog is
`display: none` and every rect inside it reads zero.

**Press the control, never write `aria-current` by hand.** `railSync()` derives that attribute from
the live DOM and runs from a `MutationObserver`, so a hand-written value is cleared by the next
body-class write. The assertion then reads an unselected item and calls a correct rule broken.

**A second `const` of one name in one function is a parse error, and this file prints `running...`
and nothing else.** No assertion runs, no `THREW` line appears, and the whole page looks like a
hang. Extract the script and run `node --check` on it before blaming the app.
