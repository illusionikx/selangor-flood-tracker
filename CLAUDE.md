# Klang Valley Flood Watch

Single-page map of live flood telemetry for Selangor, Kuala Lumpur and Putrajaya, from three JPS
sources. `api.php` reaches three more hosts server-side, and each one answers a different question:
OpenStreetMap Nominatim for the go-to box's place search (`?place=`), `met.gov.my` for the rain
outlook, and `api.data.gov.my` for the day's temperature and MET's own warnings. Six upstream hosts
in all. **PHP contacts every one of them. The browser contacts none.**
No auth, no build step, no framework. Served by Laravel Herd at `https://flood-exp.test`.

> **Keep the docs current.** When a feature lands or a decision is made, append it to
> [`docs/FEATURES.md`](docs/FEATURES.md) — what it does and *why*, including trade-offs accepted
> and things deliberately not built. New gotchas go in the gotcha list below. Do this as part of
> the change, not as a follow-up task.

## Files

| file | role |
|---|---|
| `api.php` | server-side proxy + cache + source merge + poll history + camera image proxy + rate-limited `?force=1` + place lookup (`?place=`, proxies Nominatim) + weather layer lookup (`?wx=1`) |
| `sources.php` | scrapers for the two HTML-only upstreams (national portal, JPS WP) and the three MET feeds (nowcast, forecast, warning). Also the national portal's rainfall table, gazetteer and 7-day history endpoints. Also the two JPS notice parsers: the MET mirror, the flood alert |
| `shots.php` | camera archive: capture, retention tiers, lookup, and the on-request strip (`buildSheet()`) the wall and the clip play. Required by `api.php` |
| `shots-test.php` | `php shots-test.php` — one of five runnable checks. Guards retention. Exercises `pruneShots()` |
| `log.php` | where a browser error lands. `js/oops.js` is the only caller. Appends one JSON line to `.client-errors.log` |
| `watch.php` | reads a payload on stdin and complains when it is wrong. The poll cron pipes into it. Reports a change of state, never a state |
| `.user.ini` | per-directory PHP settings. Holds one line, `session.auto_start=0`, and the reason it is there |
| `index.html` | markup only — no inline CSS or JS |
| `title-test.html` | `chrome --headless --dump-dom` — one of five runnable checks. Guards the app bar wordmark ladder, in rendered pixels |
| `narrow-test.html` | `chrome --headless --dump-dom` — one of five runnable checks. Guards the narrow-window block: its threshold, its coverage, its refusal to be dismissed, and that it is modal |
| `css/icons.css` | every icon, as an SVG mask. Generated — see docs/FEATURES.md for the fetch |
| `css/base.css` | tokens, reset, controls, blocks shared by popup + alert panel |
| `css/chrome.css` | page furniture: app bar, status dot, drawer, legend, splash |
| `css/map.css` | Leaflet overrides, pins, cluster badges, popup template |
| `js/app.js` | entry point — decides what happens on landing, nothing else |
| `js/oops.js` | reports a browser throw, a rejected promise or a failed asset to `log.php`. No imports, and `app.js` imports it first |
| `js/config.js` | constants (kinds, palettes, thresholds, tile styles, `WEATHER`). Also `NOTICE`, the words for an upstream outage. No imports. |
| `js/state.js` | `state` (data + hereAt) and the `PREFS` blob. Breaks module cycles. |
| `js/util.js` | pure helpers + `hasInfo()` / `color()` / `isIgnored()` |
| `js/stations.js` | queries over the station set (`nearestOf`, `nearestCam`, `byId`) |
| `js/map.js` | map instance, basemap/theme, cluster, the station panel (`openSide`), `focusOn` / `flashTo` |
| `js/heat.js` | both heat layers (water level, rainfall), ground-fixed sizing per layer, shared opacity, and the field pass where a gauge reporting no rain denies the ground a wet one claims |
| `heat-test.html` | `chrome --headless --dump-dom` — one of five runnable checks. Guards the rain layer's paint distance, its dry-gauge erase and its handover between neighbours, in canvas pixels |
| `js/popup.js` | popup + meter + gauge + sparkline templates |
| `js/sparktip.js` | the hover/tap readout on every graph, and the label on any `data-tip`. One delegated listener, no imports |
| `js/render.js` | rebuilds markers and heat points; drawer summary table |
| `js/alerts.js` | "On alert": the app bar's warning glyph, the list it opens in `#side`, the icon badge, the red favicon, and the MET warning cards above that list |
| `js/table.js` | the all-stations table dialog, grouped district → mast → sensor |
| `js/locate.js` | geolocation, the "You are here" marker, and the amber button a failed fix leaves behind |
| `js/ticker.js` | header alert marquee — measured, seamless, speed scales with the alert count, draws the MET warning tiles into the strip, and closes every set with the app's own name as a divider |
| `js/timeline.js` | camera archive replay + A/B compare, inside the lightbox and nowhere else |
| `js/clip.js` | the station panel's 3-hour camera clip — no controls, that is the lightbox's job |
| `js/toast.js` | desktop-only "new alert since last poll" toast |
| `js/test.js` | test mode: fakes a flood in the client's copy of the payload |
| `js/lazy.js` | `lazy()` — loads a deferred module and drives `aria-busy` for its skeleton |
| `js/net.js` | `load()` poll loop and the status dot on the logo |
| `js/ui.js` | all DOM wiring: drawer, filters, chips, panels, lightbox, delegated jumps |
| `js/wall.js` | the camera wall: every camera on one page, one timer for all of them |
| `js/wx.js` | the MET weather layer: the map mode, the pins, and the half-hour panel. Deferred |
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
| `vendor/` | Leaflet, leaflet.heat (patched), markercluster, subsetted fonts — no CDN, hand-managed |
| `lib/` | Composer's vendor dir (`symfony/dom-crawler`), gitignored — **not** `vendor/` |
| `composer.json` | the one server-side dependency; `composer install` before first run |
| `.github/workflows/pages.yml` | bakes the static GitHub Pages build — runs the PHP on cron, publishes `api.json` |
| `docs/DEPLOY.md` | both targets: Pages (what it can't do) and a Debian box / Proxmox LXC (spec, nginx, cron, container traps) |
| `.cache.json` | last payload (gitignored) |
| `.php-error.log` | this app's own PHP errors, and nothing else (gitignored) |
| `.client-errors.log` | one JSON line per browser error, written by `log.php` (gitignored) |
| `.watch.state` | the last verdict `watch.php` reached, so it reports a change and not a state (gitignored) |
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
in both HTML tables). The national portal is now the **preferred rainfall source** as well as the
authoritative river reading: priority for a *reading* is national/portal → whichever feed placed the
pin. Coordinates for a station another feed already placed still come only from Selangor or WP; the
portal publishes none there. The portal can place a station no other feed carries, but only through
its own station search — a small gazetteer this app drips in slowly, never a per-poll coordinate. See
the `## api.php` section below.
Only these three carry water. The other three hosts in the table below are not flood-data sources.
Nominatim answers `?place=` and joins nothing at all. The two MET hosts join a station by nearest
point and by district name, and they never touch a reading.

| source | gives | shape |
|---|---|---|
| `infobanjirjps.selangor.gov.my/JPSAPI/api/` | Selangor: everything, incl. the only cameras, sirens and gauges | JSON |
| `publicinfobanjir.water.gov.my` | national water levels + thresholds; **authoritative reading** | HTML table |
| `publicinfobanjir.water.gov.my` (rainfall table) | national rainfall + a per-day running total; **preferred rainfall source** | HTML fragment |
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
via `curl_multi` (~270 requests, ~3s cold). **The lists alone are not enough** — e.g. flood gauges
return `lastReading: null` in the list but a real `floodLevel` in the detail.

Field notes:
- Rainfall detail carries more than `hourlyRainfall`. `threeHoursRainfall` is a 3-hour total and
  `cumulativeRainfall` is a **year-to-date odometer** (645–1656 mm across 8 stations in August).
  This app reads both now — see the accumulation gotcha below. `spLight` 5 / `spModerate` 11 /
  `spHeavy` 31 / `spVeryHeavy` 61 are the intensity classes for that one station. Nothing reads
  them. `RAIN_STOPS` hard-codes 10/30/60 for everyone. Moving to the published per-station numbers
  changes pin colour, heat weight and `rainStatus()`, so it goes through the alert design standard
  first. `rfSpike15`/`rfSpike60` are unread and nothing has looked at them.
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

The portal also publishes rainfall, at `wp-content/themes/shapely/agency/searchresultrainfall.php` —
`portalRainUrls()` / `portalRows()` / `portalRain()` in `sources.php`. It once answered only headers
and no rows for every parameter tried. The missing piece was two hidden form inputs, `loginStatus`
and `language`, that the site's own page always submits alongside the query. With those added it is
now the **preferred rainfall source**: an authoritative reading and a per-day running total that
neither Selangor nor SPHTN publishes. See the gotcha list for the row-parsing fault this table hides.

The portal publishes a coordinate too, but only through a separate endpoint, its own station search
at `wp-content/themes/enlighten/query/searchstation_control.php` — `gazUrl()` / `gazParse()` in
`sources.php`. That endpoint answers a substring search over station names. It is not a per-poll
feed, so `api.php` drips it slowly into a small gazetteer table and reads it only to place a station
no other feed carries. A sibling endpoint, `getrainfalllast7days.php` — `seriesUrl()` /
`seriesParse()` — answers one station's own 5-minute rainfall history for the last 7 days, and seeds
a running total for a station this app has never polled before. See the `## api.php` section below
for both drips.

### 3. JPS Wilayah Persekutuan / SPHTN — `sources.php`

`WaterLevel/LatestData/All` and `Rainfall/LatestData/<district>` return HTML fragments. No `data-th`
here, so columns are read by **position, guarded on row width** (14 cells for both). Coordinates
appear only inside the row's `onclick="loadMapPage(lat, lng, …)"`.

**Rainfall has no working `All` route, and must be fetched one district at a time.** That handler
holds the connection open until the client gives up, and it has done so since 07/08/2026, while its
water-level twin answers in 3.9 s on the same host. `KL_RAIN` in `sources.php` holds the ids, and
`klStations()` merges the rows of every `kl-rain-*` page before it reads them. **The ids are not a
range**: 1 to 11 are what the site's own dropdown offers, and 23, 24, 25 and 27 carry seven more
stations — in Gombak, Pandan, Ampang and Bentong — that the dropdown never lists. Measured
2026-08-12: 12 to 22, 28 and 30 answer 500, 26 and 29 answer 200 with no rows, and nothing from 31
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

- 5-minute file cache; serves stale cache (flagged `upstreamOk: false`) if upstream dies.
- Scraped pages get their **own** 15-min cache in the `page` table of `.history.db`: the KL rainfall
  table takes ~10s to render upstream (vs ~0.3s for a JSON call), so refetching it every poll would
  triple the cost of a refresh for data that can't have changed. A page that fails to fetch falls
  back to the stored copy. Warm poll ~3.5s, and one poll per quarter hour pays the ~15s.
- Merge order: Selangor API → KL (skipping any station within ~200 m of one we already have, since
  the two feeds share no station codes) → national override by code (rivers) → portal override by
  match (rainfall) → new rows the national portal alone knows, placed from its own gazetteer → trend
  pass over the winner.
- Every station carries `source` (`selangor` / `kl` / `national` / `portal`) and, where known, `code`.
- **Two drips run at the end of a refresh, inside the same lock, the shape `captureShots()` already
  uses:** at most `GAZ_FILL` (5) prefixes and `HIST_FILL` (5) stations per refresh, at most once per
  `GAZ_EVERY` / `HIST_EVERY` (600 s each), site-wide, behind `.gaz.stamp` and `.hist.stamp`. The
  gazetteer drip queries the portal's own station search. It writes a `station(name, lat, lng,
  district, state)` row in `.history.db`, which `gazPlace()` reads to place a rainfall or river row
  the portal alone knows about. The history drip fetches one station's 7-day series and writes it
  into `level` under a `<id>#c` key, through `seedRebase()` — see the gotcha list for why the seed
  must join the running total this app already keeps rather than restart it. Both drips reuse the
  `page` table's reserved-prefix pattern (`gazdone:`, `histdone:`), the same one `notice:` and
  `place:` already use, so each row marks a prefix or a station asked whether or not it answered —
  the rule `pageRow()` already states for a scraped page.
- **`camFix()` corrects or supplies twenty-five camera coordinates, across two faults in JPS's feed:**
  fourteen swapped between cameras, and eleven published with no coordinate at all. It is the only
  place this app overrides a value the feed states. See the gotcha below for the rule that admits an
  entry to `CAM_FIX`, and for the seven cameras confirmed correct and deliberately left out of it.
- `?cam=<id>` streams a camera still. Validates the id is an integer, looks the URL up in the
  cached payload, and rejects any host that isn't JPS. Never proxies an arbitrary URL.
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
- **Rain totals over five nested windows** ride on every rainfall station as `acc`, keyed
  `h1` / `h3` / `day` / `h24` / `h72`. Each is `[mm, derived, spanHours]` or `null` where nothing can
  answer. `derived` is 1 where this app worked the number out, and the card prints an asterisk on
  it. 1 hour and today come off the feed, and so does 3 hours where Selangor publishes its own
  total. Every other window goes through `accWindow()`, which subtracts two samples off a running
  total: `portalOdo()`'s total for a station the national portal carries, or the year-to-date
  `cumulativeRainfall` odometer for a Selangor station the portal does not. Those totals live in the
  `level` table under `#c` and `#d` suffixes, so there is no schema change and `RETAIN` prunes them
  with the rest.
  `ACC_READ` (80 h) is their own load window, because `READ` is 24 h and too short.
- Response also carries real diagnostics used by the status popover: `tookMs`, `details.ok/requested`,
  `offline`, `cacheAge`, `sourceUpdated`.
- **`?place=<query>` — the go-to box's place search.** Proxies OpenStreetMap Nominatim server-side, so
  this adds no new third party to the *browser*: the browser still talks only to this origin and to
  CARTO's basemap tiles (see the third-party gotcha below), and Nominatim is reached only from PHP.
  `placeQuery()` trims, collapses, lowercases and rejects the query outside 2–80 characters or on
  invalid UTF-8, and `placeParam()` guards the one call site that turns `$_GET['place']` into the
  string it expects — see the array-cast gotcha below. Results are bounded to `BOX`, the coverage
  area with about 0.1 degrees of margin on the station extent, and only four fields survive per
  result (`name`, `detail`, `lat`, `lon`) — the raw Nominatim response is large and its shape is not
  ours to depend on. Each answer is cached in the `page` table of `.history.db` for **30 days**
  (`PLACE_TTL`), because place names do not move — a much longer life than the scraped pages' 15
  minutes. The uncached path is rate-limited to one lookup per second, site-wide, guarded by
  `.place.lock` (taken, used and released around the check only, never across the fetch) and stamped
  in `.place.stamp` via the same `forceAllowed()` the force-refresh button uses, at its own
  `PLACE_EVERY` window. The connect to `.history.db` is wrapped in try/catch: this handler has
  already sent `Content-Type: application/json` by the time it runs, so an uncaught `PDOException`
  would put a PHP fatal-error page inside a response a client expects to parse as JSON — a connect
  failure degrades to "no cache" rather than a broken response.
- **`?wx=1` — the weather layer.** Serves the row a refresh already wrote in the `page` table,
  keyed `wx:box`. This handler parses nothing and reaches no upstream. So it cannot be slow, and it
  cannot fail in a new way. A try/catch wraps the connect to `.history.db`, the same shape `?place=`
  uses. A missing or unreadable row degrades to `{"points":[]}` rather than a broken response. The
  body carries an `ETag`. MET reissues about every 30 minutes, against a poll every 8.5. So most
  polls cost one 304 rather than the full body.

## Colour language — do not violate

- **Station type** never uses a traffic-light hue: river blue, rainfall violet, siren pink, gauge
  taupe, camera cyan, mast indigo. Tokens `--k-*`.
- **Status only**: green → amber → orange → red (`--s-normal` / `--s-alert` / `--s-warning` /
  `--s-danger`, exposed as `STATUS_COLOR`), plus grey `--s-none` for offline / no reading.
  **There is no exception. A reader cut the one this app tried.** `#locate.fail` painted `--s-alert`
  for a location this app could not get, which is a fault in a control rather than a station in
  trouble. On a flood map an amber glyph in the app bar reads as an alert on the water.
  **A broken control changes its glyph, never its hue.** See `--i-location_disabled`.
- **The values live in `css/base.css` and nowhere else**, two sets, one per theme — except on a map
  pin. `.pin` shares the dark theme's set on both themes, through the selector
  `:root[data-theme="dark"], .pin` on the map-palette block, because the pin glyph carries a real
  `stroke` and its fill no longer has to hold 3:1 against white paper alone. Every other surface that
  paints a kind or a status still swaps with the theme. Any token a pin resolves must be in that
  block: `--c` arrives as an inline style on `.pin` itself, so a missing one falls back to the theme
  value and draws a single pin off-palette. Do not write a hex
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
- **JPS shuffled the coordinates inside one batch of cameras, so a pin can be 83 km from its name.**
  The coordinate the feed publishes for camera 1285 points at Kayu Ara, and the one for camera 1287
  points at Tanjung Karang. So camera 1279 drew in Sepang and camera 1288 in Bangi, each one filed
  under a district it was nowhere near. The list endpoint and the detail endpoint carry the same
  wrong value, so there is no better source to prefer. `CAM_FIX` in `api.php` corrects fourteen of them,
  and an entry gets in one of two ways. **Most must pass two checks that fail in different ways**:
  the station name must geocode to the point, and that point must sit near the median of the
  non-camera stations in the district JPS itself assigns. A name alone is not enough. `Bukit Serdang`
  (camera 1285) geocodes cleanly to Seri Kembangan, 30 km outside the Kuala Langat district JPS gives
  it, because a second place carries that name. **A same-named station of another kind beats both**,
  and camera 1277 came in that way: JPS already publishes a TAMAN DESA KEMUNING mast, so the camera
  takes that coordinate rather than a gazetteer guess. The geocode landed 200 m off, which is outside
  `SITE_M`, so the camera drew as a place of its own beside a mast it belongs on. Camera 1282 took
  the same route on a name that is only close: it reads `Kg Simpang Balak` and the siren reads
  `SIREN KG. SG. BALAK`, which is Sungai and not Simpang. What carries it is the district. The
  published point was not in Hulu Langat at all. The siren of the near name is. **A near name is
  weaker evidence than an equal one**, so the table marks that entry `SOMEWHAT CONFIRMED`. A near
  name never gets in on its own.
  **The third way in is the swap, read from the other end.** Correcting camera 1279 orphans the
  point JPS published for it. The five stations nearest that point are all in Kuala Langat, which is the district JPS gives
  camera 1285. That camera is also the only Kuala Langat one in the batch, so exactly one station can
  own the orphaned point. Use that rule
  only when both halves hold: the neighbours agree on a district, and the batch holds exactly one
  uncorrected camera that JPS files under it.
  **The strongest way in is that same swap solved for the whole batch at once.** The shuffle is one
  closed permutation. Name the station nearest each suspect camera's published point, and thirteen of
  the fourteen points name another camera in the batch, inside 550 m. The cycle runs
  1276→1280→1287→1288→1284→1278→1282→1277→1281→1286→1289→1283→1276, with 1279 and 1285 swapped as a
  pair. One camera and one point are then left over and can only be each other, which is how camera
  1281 got in with no gazetteer hit and no same-named mast. **Rebuild the whole map before you argue
  about one pin** — solving them one at a time took ten rounds and left four wrong.
  The cycle also names the cameras that are **not** in the shuffle: 1271, 1272, 1273, 1274, 1275,
  1315 and 1316 each sit near a station of their own name, and the cycle closes without them. Two of
  those (1272, 1315) were called wrong here for months on a failed gazetteer lookup alone. **A name
  a gazetteer misses is not a wrong coordinate.** Camera 1289 makes the same point from the other
  side: no gazetteer holds `Rimba KDR`, and JPS publishes a RIMBA KDR mast in the district it files
  the camera under. Search the payload first, then the gazetteer.
  A coordinate we invent is worse than one we can show belongs to upstream.
  `CAM_FIX_KM` retires the table by itself: an override applies only while the feed still disagrees
  by more than 2 km. The day JPS corrects a station, the feed wins again, and no line here waits for
  somebody to delete it. Do not extend this to another kind without the same evidence — the shuffle
  touched cameras only.
  **A second and unrelated fault sits beside the shuffle.** JPS also publishes some cameras with no
  coordinate at all, `lat: 0, lng: 0` rather than a wrong one, and `CAM_FIX` now carries entries for
  those too. Seven of the eleven came in by the route this entry already calls strongest — a station
  of another kind, already in the payload, carrying the same name. Two more, cameras 241 and 247,
  carry a name only close to a station JPS already publishes rather than an equal one, and a near
  name is weaker evidence than an equal one, the same rule camera 1282 states above — what carries
  each of those two is the district, since the near-named station sits inside the district JPS files
  the camera under, and both are marked `SOMEWHAT CONFIRMED` in the table for it. The other two,
  cameras 244 and 246, carry the median of their district's non-camera stations instead, which is a
  coordinate this file invented, and the rule above says to delete an invented coordinate rather than
  keep it if nobody can confirm where the camera actually stands. Anything that draws a station from
  this payload must still tolerate a camera with no coordinate — the next one JPS publishes that way
  has no entry here yet.
- **A `(string)` cast on `$_GET[...]` does not throw on an array — it emits a warning and coerces
  silently.** `?place[]=x` makes `$_GET['place']` an array. `(string)` on it prints
  `Warning: Array to string conversion` and yields the literal string `"Array"`, five characters that
  pass `placeQuery()`'s length check clean — so the warning lands inside a response whose
  `Content-Type` is already `application/json`, breaking the parse for a client that sent one
  malformed query string, and the request still spends the site-wide rate limit on a garbage query.
  `?cam=` and `?shots=` never had this problem because `(int)` on an array is silent. `placeParam()`
  in `api.php` is the guard: refuse anything that is not already a `string` before it reaches
  `placeQuery()`, rather than cast and hope. Any future endpoint that reads a `$_GET` value as a
  string needs the same check at the call site — the validator downstream cannot fix a type problem
  that already corrupted the response.
- **The KL endpoints return bare `<tr>` fragments.** Both libxml and the HTML5 parser discard rows
  that aren't inside a table, so `crawl()` wraps every page in `<table>` before parsing. Drop the
  wrap and the KL feeds silently return nothing.
- **`children('td')`, not `filter('td')`,** when counting a row's width — these pages nest tables,
  and a descendant search counts the inner table's cells too, blowing the 14-cell guard.
- **Iterating a `Crawler` yields raw `DOMNode`s**, which have no `attr()`. Use `->each(fn(Crawler
  $n) => $n->attr(…))` to stay in Crawler-land, or you get a fatal on the first attribute read.
- **`crawl()` reads nothing from the national portal's rainfall table.** No data row carries an
  opening `<tr>`. The `<tbody>` holds one empty row, then about 31 stray closing tags, then every row
  as a bare run of `<td>` cells ending in `</tr>`. Measured on the live page,
  `crawl($html)->filter('tr')` finds 4 elements, and none holds a `td` child, against 239 real rows.
  The existing wrap in `crawl()` cannot repair this. It supplies a missing table, and this page
  lacks the rows instead. `portalRows()` splits the body on `</tr>` and wraps each chunk as a row
  of its own, then keeps only chunks of exactly 13 cells. The width guard checks that the repair
  produced the shape expected.
- **`pageHasData()`'s `<tr` test cannot answer for the portal rainfall page.** Its header block holds
  four instances of `<tr`, and the empty form page — what the endpoint returns without its two hidden
  inputs — holds the same four. A shared test cannot tell the two apart. Those keys test
  `data-th='No'` instead, which appears once per data row and nowhere else.
- **`clean_rainfall` is the disjoint 5-minute bucket in the 7-day history series, not `raw`.** The
  field names guessed before the endpoint was read — `tarikh`, `raw`, `clean`, `chourly` — do not
  exist on the live feed. The real fields are `date_time` (no seconds), `clean_rainfall`,
  `cum_hourly` and `cum_daily`. `cum_hourly` is a rolling 60-minute total and `cum_daily` is the
  running day total, so there is no single rolling field to confuse with the disjoint one. There are
  two, and neither is the one to sum. Measured against the live endpoint on three stations across up
  to 8 days, `clean_rainfall` summed across one calendar day reproduced `cum_daily`'s own end-of-day
  figure exactly, every time. **Score this identity on a station with rain in the window.** An
  earlier pass scored it on a station holding 15 non-zero buckets out of 1,815, and the rolling field
  passed, because twelve zeros sum to a zero.
- **A `graphId` is a string, and casting it to `int` silently breaks the history backfill.** Some ids
  carry a trailing underscore the site's own link puts there, `stationid=3015084_`. Measured against
  the live SEL/WLH/PTJ pages: 58 of 176 ids on the Selangor page alone carry one, 72 of 308 across all
  three state pages. The digit run alone is a *different* id to the endpoint the id names. It answers
  with an empty series, while the id with its underscore answers with the station's own 7-day
  history. This app stamps a station `histdone:` whether or not its fetch answered, so an `(int)`
  cast here silently empties the backfill for 23% of stations, for good.
- **A running total must never restart when this app cannot advance it.** Before this work a
  Selangor station stored a year-to-date odometer under `#c`. A portal station starts a total near
  zero. Without a guard, restarting on deploy writes a small number after a large one. `accWindow()`
  reads the total going backwards and answers null, so 140 stations sit dark for 72 hours. It held
  here only because `INSERT OR IGNORE` collided on `(station, ts)`, which is luck, not a guard.
  `portalOdo()` holds the total instead of restarting it whenever it has no `prevDaily` to measure the
  rise against — the exact case a fresh deploy meets — and that costs one poll of rain, once.
- **A name alone cannot place a station.** The portal's own gazetteer holds two entries for one
  station, 81 km apart: `Sg. Bernam di Tanjung Malim`, 1.1 km from the real town, and `Sg. Bernam di
  Tanjung Malim (F2)`, beside Putrajaya. `gazCorroborated()` requires the point to sit within
  `GAZ_DISTRICT_KM` (50 km) of the median of stations in the district the portal itself assigns. This
  is the rule `CAM_FIX` already states for a camera, above, so nothing here restates it in full.
  Evidence for 50 km: zero of about 470 stations this app already holds sit past it, the check
  refuses the same two rows at 40, 50 and 60 km alike, and the worst legitimate outlier measured,
  34.6 km, leaves a wide gap under the closest rejected placement, at 67.5 km.
- **The corroboration check has a floor, and the floor is a hole.** A `state|district` bucket
  holding fewer than 3 known stations passes `gazCorroborated()` unchecked. Refusing there has no
  evidence behind it, and that invents a check rather than makes one. 8 buckets are that small: 7
  Kuala Lumpur districts, and Putrajaya, whose only two stations are new placements from this same
  source — so its own baseline started at zero.
- **A skipped rainfall bucket understates the seeded history, and nothing marks it.**
  `seriesParse()` drops a bucket that fails `numOrNull()` or reads negative, which keeps the running
  sum non-decreasing. The drop happens before `seedRebase()`'s accumulator ever sees the bucket. So
  `$run` sits short by that bucket's rain from that point forward. The shortfall lives in the running
  sum, not in the offset. The offset is one constant, computed once per station and added to every
  point. It cancels out of any window, skip or no skip — the identical rule `sources.php`'s own
  comment on `seedRebase()` already states. A window with both ends on the same side of a skipped
  bucket still nets the shortfall out, because both ends carry the same short `$run`. A window
  straddling the skip does not, because only the later end has absorbed the loss, and several skips
  compound in the same, understating, direction. That is the opposite of this repo's safe way to be
  wrong, and no `derived` marker communicates it.
- **Never `file_get_contents()` a JPS URL — always curl.** `infobanjirjps.selangor.gov.my` resolves
  to *two* A records and one of them (`58.27.97.62`) blackholes SYNs. curl races both (happy
  eyeballs) and connects in ~10 ms; PHP's stream wrapper tries addresses serially with no connect
  timeout of its own, so it eats the OS TCP timeout — 21 s on Windows — whenever it draws the dead
  one. `?cam=` was the only outbound call in the repo not going through `fetchAll()`, and it was
  therefore the only slow endpoint: ~21 s per still, 42 s when the https attempt lost and the http
  fallback lost too. Stills now take ~0.8 s. The dead record may be removed or may move to the other
  IP; the rule is about the mechanism, not that address.
- **Every picture in this app fails into `.camfail`, and a failed `<img>` must never be left to size
  its own box.** Four surfaces draw a picture — the lightbox frame, the lightbox's compare frame, the
  station card still and a camera wall tile — and each one keeps the box the picture would have taken
  and puts the same `videocam_off` / `No picture` panel in it. The look is `.camfail` in
  `css/base.css` and only the placement belongs to each surface. **One fact must not get two looks**:
  the card printed `image unavailable` instead, on a box that collapsed to the height of that line.
  The compare frame is the exception that shows why an empty box is not enough on its own — it is
  clipped to the divider and held no fill, so a failed frame let the *other* frame show through and
  compare drew one picture twice under two timestamps. A false match is worse than a visible gap.
  Three image paths are deliberately silent instead, and all three have a picture already on screen
  to fall back to: the wall's strip probe, the clip's strip probe, and the lightbox's frame prefetch.
  **Anything new that draws a picture picks one of those two shapes** — the panel, or a silent
  fallback to something already visible. Never a bare broken image, and never a handler that lets the
  box shrink to nothing.
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
- **A rain total over 24 or 72 hours is a difference, never a sum.** `cumulativeRainfall` only
  climbs, so `accWindow()` subtracts two samples. **Do not add up `hourly` buckets instead.** A sum
  loses the rain in every gap and reports a small number with nothing to say it is short.
  Measured on this box, the archive held 9 of the last 24 clock hours and a 15-hour hole.
  A sum renders that as a dry day. The scrapers already fail silently by design, and a total with no alarm behind
  it is worse than none. A difference cannot lose rain: a missed poll widens the window instead, and
  the payload measures that wider window, so the card states `measured over 26.1 h` rather than
  claiming 24. Three things return `null` rather than a number: an empty series, a backwards odometer
  (the 1 January reset), and both ends on one sample.
  **The national portal supplies a per-day running total, and `accHours()` is gone.** A station the
  portal carries builds the total from its midnight column — see `portalOdo()` — and answers both
  long windows the same way a Selangor station with its own year-to-date odometer always did.
  `accHours()` added one rolling hour per clock hour. `hourlyRainfall` is a rolling 60 minute total,
  and the readings sit a median 46 minutes apart, so every hour boundary counted about 14 minutes of
  rain twice. Scored against the 3 hour total Selangor publishes for itself, 14 of 176 stations were
  out by more than 5 mm, the worst by 60 mm. The error was zero on a dry station and large during
  heavy rain, the worst shape an error can take here.
  **The permanent dash now marks the stations the portal does not carry**, not a fixed block of 38
  KL gauges. Two `—` columns on such a station are still the right answer, and the readout on the
  dash still says why: `Not measured. This gauge keeps no running total.` Measured 2026-08-15: of
  204 gauges that draw this chart, 3 carry that dash, all Kuala Lumpur stations the portal search
  never matched. **That is still the only empty long window a reader ever meets.**
  **The `#d` series holds the previous daily reading.** It carries its own suffix for the same
  reason `#c` has one: no station id ends in `#d`. `portalOdo()` needs both the last running total
  and the last daily reading to bridge a midnight, so the next poll stores `#d` to know what it
  already counted.
- **A window can also cover LESS ground than it names, and then it says so.** `accWindow()`
  takes `$partial`. With no sample at or before the far end it measures from the oldest sample there
  is and returns `short`. `derived` is a ladder of three rungs rather than a flag — 0 off the feed,
  1 worked out over the whole window, 2 worked out over a shorter one — and the card prints one
  asterisk per rung. This is still a difference, so it still cannot lose rain. **The `#c` series began
  2026-08-13 18:30 and nothing can fill it in**, because no earlier poll stored `cumulativeRainfall`.
  Before this, both long windows drew a dash for two days. On the 2026-08-14 15:45 poll, with the
  archive 20.5 h deep: 179 stations of 231 answer `h24` over 20.5 h, 1 answers it whole, and 51 answer
  nothing. **`$partial` is false by default, and `rainBacked()` depends on that.** A window narrower
  than the hour it asks about calls live rain faulty. A wider window can only add rain, which is
  the safe way to be wrong.
  **Both long windows anchor to the earliest record, and both publish it even when that is one number
  twice.** An archive 21 h deep answers 24 h and 72 h with the same 21 h difference, each marked
  short. On the 2026-08-14 16:20 poll, 180 stations of 231 answer both windows over one span, which is
  every Selangor gauge that can answer at all. The earliest record is the earliest record, and a dash
  tells a reader nothing. The mark and the span in the readout carry the shortfall on each column.
  **Neither surface names a clock time, and an early version named it twice.** The footnote printed
  `Measured from 13 Aug, 19:11` and the readout repeated it. A reader cut both. The shortfall changes
  how to read the number, and the hour this one server first stored an odometer reading does not.
  `accFrom` still rides on every station with a running total, because the card tests whether the key
  is THERE, which is how the card names the KL gauges. Nothing prints its value, so do not delete the
  field on the strength of that. `MYT_WHEN` in `popup.js` existed only to format it and is gone.
  **The `!from` guard covers one poll in the life of a server, and that is not a state.** A fresh
  `.history.db` leaves a station holding one odometer sample and no difference. That station does
  publish a running total, so the clause is false on it. The guard stops this app saying a false thing
  for eight minutes. Do not give it a message of its own, and do not delete it either.
  **Two filters tried to suppress the pair and both are gone. Do not build a third.** The first
  was a floor in hours: a partial had to cover more ground than the fixed window under it. The live
  payload broke it at once, because a floor compares one span to a constant and the fault is two spans
  landing on each other. PUNCAK ATHENEUM holds 27 h, so its 24-hour window WIDENED to 27 and its
  72-hour window fell SHORT to that same sample. A widened window can meet a short one at any depth.
  The second compared the two spans and dropped the longer. That is the one this reverses on a
  reader's instruction, and the instruction is right: suppression trades a true short measurement for
  no measurement, and the remark already states what the columns share.
  **A widened window is not a short one, so the pair can carry different marks over one number.**
  PUNCAK ATHENEUM draws `24 h*` and `72 h**` at 6.5 mm each. The first covered more ground than it
  names and the second covered less. Four assertions in `--selftest` hold both halves.
  **A short window can undershoot a window nested inside it, and this app does not suppress that.**
  On the same poll, 4 stations of 180 report less over 24 h than over today, three of them
  by 0.5 to 1.0 mm and TAMAN MAYANG by 12.5. The odometer and the feed's own daily total disagree,
  and nothing here can say which is wrong. Do not suppress the odometer figure. That trusts the feed
  over it, and those two fields already carry the opposite trust. For scale, 17
  stations on that poll report less today than in the last 3 hours, with both sides straight off the
  feed. The chart has always drawn windows that disagree.
- **The accumulation chart carries no threshold mark, and three sources failed to supply one.** It
  says how much rain fell and never how bad that is — `rainBars()` above it already draws the JPS
  intensity classes and `rainState()` above that prints the word. A curve fitted between
  `spVeryHeavy` (61 mm/h) and the MET figure of 240 mm/day joins a **1.7-year event to a 216-year
  one**, two
  orders of magnitude apart in rarity, so it measures the gap between two definitions and nothing
  about rain. JPS publishes MSMA 2nd Edition Equation 2.2, which covers 5 minutes to 72 hours
  exactly, and it still loses: an IDF curve needs 20–30 years of record at one spot, JPS published
  12 such gauges in this area, and **only 11 of 230 stations stand on one**. The rest borrow
  climatology from another place at a median of 11 km. `spVeryHeavy` alone is per-station and honest
  but marks the 1-hour bar only. A dry station therefore draws five flat columns and **not** a
  sentence: any sentence has to name a window, and "No rain in the last 72 hours" on a station whose
  72-hour total is unknown is the exact claim this refuses to make. Five columns keep a measured
  zero and an unanswered window apart. See `docs/superpowers/specs/2026-08-12-cumulative-rainfall-chart-design.md`.
  **`rainBars()` above it now obeys the same rule and for the same reason.** It printed `No rain in
  the last 11 h` on an all-zero history and draws the zeros instead. A sentence about a window can
  only make one claim about the whole of it, and this graph holds two facts that have to stay apart:
  a run of measured zeros is a line along the floor, and a station we could not reach is a break in
  that line. Its `hi` therefore ends `|| 1` — with no peak and no class in range the axis is zero,
  and `y()` divides by it, so every point came out `NaN` and nothing rendered. Any positive number
  puts a zero on the floor. The two remaining sentences are the case where there is nothing at all to
  plot, which is the one thing a graph cannot state for itself.
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
- **A page-cache row that never answers can never advance its own timestamp.** `$want` selects a page
  whose stored `ts` is older than its TTL. The write used to run only on a non-empty body. So a dead
  upstream re-entered `$want` on every rebuild. It then held a slot in the shared `curl_multi` batch
  for the full `CURLOPT_TIMEOUT` of 25 s. A batch finishes no sooner than its slowest member, so one
  hung page put 25 s on every cache miss. Measured: 0.13 s for a cached poll, 28.6 s for a rebuild,
  and 45.1 s when the half-hourly camera capture landed in the same request.
  `infobanjirjpskl.water.gov.my/Rainfall/LatestData/All` hung that way for four days.
  `WaterLevel/LatestData/All` answered in 3.9 s on the same host through all of it. `pageRow()` stamps
  every page the server asked for, answer or not, and keeps the stored copy on a failure. A dead page
  now costs the timeout once per `SCRAPE_TTL` rather than once per rebuild. **Never stamp a page the
  server did not ask for** — a stamp on a fresh row pushes its next fetch out forever. The stamp then
  costs the one signal a reader had, because the `ts` column now advances whether or not the page
  answered. **`sources.stale` is the replacement, and it is the alarm to read.** It lists the page
  keys this server asked for and did not get, so a key there means the map is drawing a stored copy
  of that table. The parse counters cannot say it — a stored copy parses as well as a fresh one, so
  `kl.parsed` stayed above zero through the whole outage. `sources.stale` is empty on a healthy poll.
  **A status code cannot decide what a body is, so `pageHasData()` decides it.** The national portal
  serves a maintenance window as a 320-byte `Notis Gangguan` notice under **HTTP 200**, and that
  notice overwrote the stored tables for KL and Putrajaya while this work was measured.
  `national.applied` fell from 71 to 47 and nothing said why, because the fetch had succeeded. A
  table page must hold a `<tr`, `met-day` and `met-warn` must decode as JSON, and `met-now` must hold
  `map.setView`. **`met-now` is tested on the map scaffolding and never on a marker** — a nowcast
  with nothing to report is weather, not an outage. `fetchAll()` covers the other shape and blanks
  any status at 400 or above, which also stops `?cam=` serving an HTML error page as `image/jpeg`.
  The first guess named the camera strips and was wrong. `buildSheet()` runs from `?sheet=` alone,
  never from the payload route, and one strip takes 0.054 s.
  **The weather section prints MET's own issue time, `met.stamp`, and never our poll time.** The
  nowcast page is cached for `SCRAPE_TTL` and MET issues about every 30 minutes, so the two are
  different by up to 45 minutes. Printing the poll time would tell a reader a forecast was fresh
  when it was three quarters of an hour old. `metPoints()` drops any marker whose stamp fails to
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
  lines, because nothing in this app reads `$_SESSION` and a server that ignores `.user.ini` still
  needs the release. Do not move it later in the file. Code added above it runs inside the lock
  again. `session_write_close()` is silent when no session is active, so the call costs nothing once
  `.user.ini` applies. Note that PHP caches `.user.ini` for `user_ini.cache_ttl` seconds, 300 by
  default.
- **`error_log()` writes to standard error, and a FastCGI server folds that into its own log.**
  `api.php` has called `error_log()` correctly the whole time. PHP ran with no `error_log` set, so
  every one of those lines landed in the log of the web server, beside every unrelated line it
  writes. An uncaught exception from this app was one line among about 28,000.
  `api.php` and `log.php` each call `ini_set('error_log', __DIR__ . '/.php-error.log')` now. This is
  `ini_set()` rather than an ini file because `__DIR__` resolves on both deploy targets. A committed
  absolute path is correct on one target at most. **Any new PHP entry point needs that line**, or its
  errors go back to the shared log and nobody finds them.
- **A geolocation permission can read `granted` and still yield nothing, because the operating
  system refuses the browser underneath it.** Measured on one Windows desktop reaching this app over
  https: the permission query returned `granted`, and `getCurrentPosition` timed out at both accuracy
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
  the tip also names the path, because a reader told to open the settings for a device still has to
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
  water. The glyph is the third, and it is the crosshair of the resting state with a line through it,
  so the two read as one control in two states. `setBtn()` writes all three button states through one
  function, so no attribute outlives the state that set it — a tip left over from a failure names a
  fault on a button that has since found you.
- **`js/oops.js` must stay the first import in `app.js`.** A static import runs before the body of
  the file that imports it. A handler written inside `app.js` therefore starts after every other
  module has evaluated, and a throw during that evaluation reaches nobody. This is a real case rather
  than a theoretical one. `state.js` reads the saved preferences with `JSON.parse`, so corrupt
  storage throws there before the map draws anything. `oops.js` imports nothing, so it evaluates
  first. Moving it down the import list, or folding it into `app.js`, gives up the one case it exists
  for and breaks nothing visible.
  The third argument on its `error` listener is the capture phase, and it is what catches a file that
  failed to load. That event does not bubble, so a listener without capture sees a throw alone.
  **A headless check with `--dump-dom` captures nothing, and the fault there is the harness.** Chrome
  exits at the dump and discards the queued beacon, so the log stays empty and the code looks broken.
  Keep the browser alive for a few seconds instead, then stop it.
- **No `fastcgi_finish_request` under Herd** — the SAPI is `cgi-fcgi`, so there is no way to close
  the connection and keep working. Stale-while-revalidate is impossible in-process; the page cache
  is the workaround. A cron hitting `api.php` every 5 min would keep the cache warm for good.
  **Never put logic that must always run inside `if (function_exists('fastcgi_finish_request'))`** —
  that branch is dead code on the machine this runs on. The stampede guard lived there for weeks and
  therefore never guarded anything; see the lock below. It caught a second fix the same way: the
  `?force=1` feature's defaults for `forced`/`forceWhy` were first added only to `serveCache()`, and
  this branch echoes `cachedPayload()` directly, so it kept replaying a stale `forced: true` for five
  minutes after every real force. Dead here, live on the nginx/php-fpm target `docs/DEPLOY.md`
  describes. Whatever a fix touches in `serveCache()` must be checked against this branch too.
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
- **`filter` runs before `mask`, so a filter on an `.i` is discarded.** The spec order is: paint the
  element, apply the filter, *then* clip with the mask. An `.i` is a box of `currentColor` with the
  glyph masked out of it, so a `drop-shadow` on it is computed from the box, lands outside the box,
  and the mask clips it off. Nothing renders and nothing errors — the pin stroke shipped invisible on
  both themes this way. The favorite heart works because its filter is on the `<b class="fv">`
  wrapper and the mask is on the `.i` inside it — `.pin`'s own soft shadow works for the same reason,
  since `.pin` is a plain `<span>`. Anything that wants an effect on an icon needs that wrapper.
- **A map pin's glyph is an inline `<svg><use>`, not a masked `<i>`, and the outline is the reason.**
  A CSS mask keeps only the alpha of the picture and paints the box in `currentColor`, so there is no
  fill and no stroke to address. Two attempts faked one and both were reverted. Four hard drop
  shadows cover four directions, so a water drop's diagonals come out thinner than its sides. A
  scaled copy of the mask behind the glyph is even at every angle and worse for it: a mask has no
  path to offset, so it grows away from its own centre rather than outward from its edge, and at 400
  pins that is 400 grey silhouettes with a coloured shape laid on them. A real `stroke` on a real
  path is neither — one shape, offset along its own outline, with `paint-order: stroke` putting it
  under the fill and `vector-effect: non-scaling-stroke` holding the width at 1 screen pixel through
  `.pin`'s `scale(.8)` and the 48px `.me` pin alike — that property does **not** inherit, so it is
  stamped on the path in `pinGlyph()` and cannot be declared on `.pinglyph`. The pins lost their
  `drop-shadow` when they gained the stroke: two marks around one 29px glyph is one too many.
  **Do not go back to a second copy of the shape**, and keep the stroke thin and in `--surface`: it
  is the gap between the mark and the tile, and one wide enough to read as a border is the 400-blob
  failure in a better technique.
  `pinGlyph()` in `js/map.js` lifts each symbol out of `css/icons.css` at first use, so the path data
  still lives in one place and adding an icon is still one line there. **Only the map pins take this
  path** — every other icon in the app is still a mask, because nothing else needs a second colour.
  See `docs/FEATURES.md`, *Three attempts at an outline on a station glyph*.
- **Both glyphs on a map pin carry an explicit `z-index`, and the painting order alone did not hold
  them.** `.pin` draws the station mark and, on a favorited place, a heart badge over its bottom-right
  corner. The heart is the last child *and* it is positioned, so CSS2.1 painting order puts it at
  step 7 and the unpositioned station `<svg>` at step 3 — the heart could not be underneath, and it
  was, on every favorited pin. `.pin > .pinglyph` now takes `position: relative; z-index: 0` and
  `.pin .fv` takes 2. **The `position` is not decoration** — an unpositioned box cannot take a
  `z-index` at all, so the station mark had to be positioned before it could be pushed down a rung.
  Do not delete either declaration as redundant on the strength of the spec. It reads redundant and
  is not. Two other explanations were chased first and both are wrong: a `filter` on `.pin` creates a
  containing block but not a z-order change, and the heart's own `drop-shadow` is about lifting it
  off the glyph, not about which one paints first.
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
  `.sparktip:popover-open` are the pattern. The same trap caught a plain `[hidden]` attribute too:
  `.link { display: flex }` in `base.css` beats the browser's own `[hidden] { display: none }`, so
  the Developer section's "Refresh now" button — hidden on the GitHub Pages build, where the query it
  needs does nothing — needed `.rowbtns .link[hidden] { display: none }` to actually disappear.
- **A popover inherits ten declarations from the UA sheet, and `height: fit-content` is the one that
  gets forgotten.** `.menu` restates `position`, `inset`, `margin`, `padding`, `overflow`, `border`
  and the colors, and left the height alone. WebKit reads `fit-content` on the block axis of an
  out-of-flow box as the space available under `top`, not as the content height, so `#appMenu`
  measured one viewport tall on iOS Safari — and a grid with a definite height stretches its rows to
  fill, which drew the four tiles and the theme row spread down the whole screen. Chrome and Firefox
  drew the same markup at 157px. `.menu` carries `height: auto` now, which changes nothing on the
  engines that were already right. **Do not reach for `align-content: start`** — it closes the gaps
  and keeps the full-height box, so an invisible panel goes on swallowing taps over the map.
- **There is no map popup any more, and there must not be one again.** Station detail is `#side`, a
  fixed panel on the right edge of the viewport, filled by `openSide(key, html, mastAt)` in `map.js`.
  Everything a Leaflet popup needed — `autoPan` racing `setView`'s animation, `openStable()`
  re-opening what a zoom had torn down, `cluster.zoomToShowLayer()` waiting for a marker to have a
  DOM node at all, a `keepPopupVisible()` that nudged the view on phones — existed because the card
  was anchored to a marker. The panel is a page element: nothing to pan into view, nothing to
  destroy. Anything that wants to *show a station* calls `flashTo()`, which fires the marker's own
  click; anything that wants to show something else calls `openSide()` with a key starting `@`
  (see locate.js), which keeps `render()`'s refresh pass off it.
  **The name chip `flashTo()` leaves over the ripple is not a popup either.** `ping()` draws it
  inside its own throwaway marker, which is `interactive: false` and removed after `FLASH_MS` —
  nothing anchors it to a station's pin and nothing outlives the flash. It exists because the panel
  is fixed to the right edge while the map moves under it, so the card's title carries `data-go`
  (`goName()` in `popup.js`) as the way back to the pin, and a bare ring says "here" without saying
  what "here" is. Anything that wants a *persistent* label on the map is the thing this rule forbids.
- **The card arrives as one string and is split into two boxes.** `openSide()` moves the card's
  `.pophead` — the place name, region and one badge per sensor — out of `#sideBody` and into
  `#sideHead`, which is not inside anything that scrolls. `position: sticky` on it was tried first
  and is one line rather than three, but a header that stays put only while nothing defeats sticky
  is a header that can come loose; this one has no scroll to come loose from. **Anything that
  reshapes `sitePopup()` must keep `.pophead` as its first element** — that is the seam.
- **Three numbers put the place name on the close button's line and move together:** `#sideClose`'s
  `top: 8px`, `#sideHead .pophead`'s `padding-top: 18px` (8 + half the button's 40 − half a 15px/1.3
  line) and `.pophead > .dots`'s `top: 8px` (18 + half that line − half the button's 40 = 7.75, which
  is `#sideClose`'s own number). **That ⓘ takes the full `.icon` box, not `.dots`'s 28px one** — it
  stands beside the ×, and `.icon` paints a round `--hover` disc the width of its box, so the smaller
  shape drew two discs of two sizes under two glyphs of two sizes. `.dots` stays 28px everywhere it
  is alone on a row. `right: 32px` puts the two boxes edge to edge, the way two toolbar icons meet.
  **That corner holds exactly one control besides the ×, and it is the ⋮.** A sensor-count chip held
  the slot first, then the favorite heart, then the heart and a nearest-webcam glyph together — and
  the pair reserved `padding-right: 108px` of a 328px line and stood 4.5px into the district line
  below, which is what a reader sees as a collision. **Every card control is a row inside that one
  menu now.** `dots(s, extra)` takes the nearest webcam or water level as its optional row, and a
  mast gets `siteDots()`, which holds the favorite that acts on all its sensors. The rows state the
  station name, the distance and the reading in visible text, which a glyph could only put in a
  `title`. One control costs the title 68px instead of 108, and the card loses a glance at the
  favorite state — the map pin still draws a heart on a favorited site.
  **The reservation is `~`, not `+`**: `dots()` emits the button *and* the popover it targets, so the
  menu div sits between the button and `.popname`. **The region line takes the same 78px as the
  name** — it is a line lower, but a 40px button reaches 48px down and the region starts at 37.5.
  **A menu row's `[data-fav]` may hold a comma list**, so anything reading it back tests every id
  (see the still-open branch in ui.js). `ids.has('a,b,c')` is false forever.
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
  The ways out are the ×, a dialog taking the screen (About, the table — both call `closeSide()` in
  ui.js), ⋮ → ignore, and at phone width the two gestures a modal drawer owes a reader: a swipe
  toward the right edge, and a tap on `#scrim`. **Do not add another without a reason that survives
  "it vanished while I was reading it".** The last two carry theirs. Both exist only below 600px,
  where the panel takes 84vw and there is nothing behind it left to read, and the scrim is a real box
  over the map rather than a map click — so no pan, no marker and no accuracy circle can fire it.
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
  **The same interpolation eats clicks on the way out, and `#splash` was doing it.** `visibility`
  holds its *start* value for the whole duration, so `visible → hidden` stays `visible` until the
  transition ends. Paired with `opacity: 0`, which does not stop hit-testing, `#splash.gone` left an
  invisible `inset: 0`, `z-index: 900` sheet over the entire viewport for 300ms after the map
  appeared. The first press of anything in the app bar did nothing and the second worked, which
  reads as a slow button rather than as something on top of it. The fix is `pointer-events: none` on
  the `.gone` state, kept **out** of the transition list so it applies at once. Any overlay that
  fades itself out needs that declaration — `opacity` and a transitioned `visibility` together never
  stop a click, and both of this app's full-screen fades were written that way.
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
- **A cluster badge counts what it is hiding, not what is in the area.** Favorites are drawn on
  `favLayer` in `map.js` and never enter `cluster`, so a chip over a patch holding 13 pins can read
  12. That is the correct number: the chip is hiding 12 pins and the 13th is drawn beside it. The
  same holds for the badge's red — `iconCreateFunction` ORs `m.options.critical` across its children,
  so a chip goes neutral when the only critical pin near it is an unclustered favorite drawing itself
  red. Nothing leaves the screen. Do not "fix" the count by folding the favorites back in; that would
  make the badge claim to hide pins that are visible.
- **Offline gauges are frozen on old flood readings** (3.55m from April) — so they are *not sampled
  into `.history.db`* and carry no `history`. A flat line at a number from months ago reads as
  "steady", which is the one thing a graph of a dead sensor must not say. Anything offline or
  >24h old renders grey with an explicit `OFFLINE` block, the date in the footer. Never show these
  as live. **A graph is still drawn for them**, and that does not breach the rule above: an offline
  gauge holds no samples at all, so what draws is its two marks against an empty plot rather than a
  flat line through a number from April. The gate that used to suppress it took the timeline from 15
  of 36 gauges. See the always-draw rule under Conventions.
- **41 sirens last reported months ago** (one in July 2025). They render `OUT OF CONTACT`, never
  `IDLE` — a silent siren and a dead siren look identical, and only one is safe.
- **The siren band frames on the clock, and it is the only graph here that does.** Every other graph
  spans the readings it holds, because a reading exists only where somebody took it. A state exists at
  every instant. `sirenBand()` therefore spans the last `SPARK_H` hours ending **now** and lets the
  samples colour parts of it, through the `frame` parameter on `timeAxis()` that no other caller
  passes. Measured on the live payload: 212 sirens, of which 86 hold no history at all and 103 hold
  exactly one sample, and the median newest sample is 9.3 hours old — a siren heartbeats daily and
  `.history.db` keys on the reading's own stamp, so an unchanged siren stores one row. Framed on its
  data the way a river graph is, the median siren drew a window of **zero width**.
  **A reading holds until the next one, and that reverses the rule that stood here.** The band used
  to cut each bar 15 minutes after its sample and leave the rest blank, on the argument that an
  unbroken quiet band across a hole says the siren was silent in the same shape as one measured
  silent. That argument assumed a hole meant lost contact. It does not: this app polls an online
  siren every few minutes and only stores a row when the siren's own stamp moves, so a hole is the
  value not changing. The cost of the old assumption was 103 sirens drawn as one sliver.
  **A hairline rail in `--s-none` covers what the samples do not**, and that is the token this app
  already uses for no reading — a rail and not a bar, because it is the absence of a state rather
  than a third one. **The out-of-contact case needs no flag and must never grow one.** `SPARK_WIN`
  is 12 hours and `SIREN_STALE` is 48, so a siren's last sample leaves the window a day and a half
  before this app calls the station out of contact. All 65 out-of-contact sirens hold zero history, so
  the whole band is rail by geometry. A `hasInfo()` test here states one fact in two places, and
  the copy then drifts from the block above it.
  **The band draws for an out-of-contact siren too** — it sits outside the state ternary in
  `sensorBody()`. It used to sit inside, which left the one kind whose whole question is "for how
  long" as the one kind with no timeline.
  **An empty band ships no `data-pts`.** `show()` in `js/sparktip.js` takes the last sample at or
  before the pointer and destructures it, so an empty array is a `TypeError` on every pointermove
  across the plate. A graph with nothing to say ships no attribute.
  There is **no caption**. It read `Silent for 9 h`, `Last sounded 14:22` or `Sounding since 13:50`,
  and the band states all three. A rail with no bar on it is silence. A red bar shows when
  it started. A red bar that reaches the right edge means the siren sounds now.
- **A siren reading 1 is a claim, not a fact, and the river behind it is the check.** JPS sounds a
  siren for one minute at the Amaran mark, repeating every 3 hours while the water stays there, and
  every 5 at Bahaya. So the alarm is a claim about a river level the payload already holds.
  `sirenBacked()` in `api.php` asks it: `backed` is true when a river within `SIREN_KM` (5 km) is at
  status ≥ 2, false when rivers are in reach and none is, **null when there is none to ask**.
  `sounding()` in `util.js` reads `backed !== false` — the null case keeps the benefit of the doubt,
  because silencing a real evacuation alarm beats carrying a doubtful one. 15 of the 17 alarms in our
  archive were unbacked, including one held 127 hours with its own gauge 2 m under the mark, and
  believing them kept the app bar red every day of the week. **Do not replace this with a duration
  cutoff** — that was the first attempt, and JPS's repeat cadence means a genuine flood holds a siren
  on all day, so any cutoff short enough to catch the stuck ones discards the real one. Both reds
  read `sounding()`, `isCritical()` and `atDanger()` — a red pin beside a panel that refuses to list
  it is the map contradicting the panel. **`?shots=` asks the same question per frame**, through
  `$sirenFrames` — `frameTiers` against each nearby river's *warning* mark, intersected with the
  siren's frames. It must never fall back to the live `backed` flag: a picture from last week is
  judged by last week's water, the same rule `camWarn()` obeys. Flood gauges are **not** backing
  evidence — measured, they hold no samples across any alarm window on record.
- **A rain gauge's hourly reading is a claim too, and its own odometer is the check.**
  `hourlyRainfall` is a *rolling* one-hour total and `cumulativeRainfall` only climbs, so rain the
  first claims has to appear in the second across that hour. `rainBacked()` in `api.php` asks it and
  publishes `backed`: true where the odometer rose, false where it did not move while the gauge
  still claimed rain, **null where nothing can be asked** — a young archive, or a station with no
  odometer, which is every KL gauge. `raining()` in `util.js` reads `backed !== false`, exactly as
  `sounding()` does, and a gauge nobody can check keeps its reading. Measured 2026-08-14: 5 of the
  48 gauges that could be asked were claiming rain their own total denied, and T.K.P.M SG. KELAMBU
  had held 4.5 mm for **twelve hours** against an odometer that never moved and a daily total of 0.
  **The window is the hour the reading names, and a longer one is wrong.** A real burst leaves the
  odometer flat straight afterwards while the rolling hour still carries the total, so any window
  wider than the claim calls live rain faulty. `accWindow()` does the reading, so a sparse archive
  widens the window instead of failing, and a wider window can only add rain — it can only move the
  answer toward true, which is the safe way to be wrong. Three surfaces read the flag: the pin
  colour through `color()`, `atDanger()` at the top class, and the rain heat layer, where an
  unbacked gauge **neither paints nor erases** — a reading nobody can stand behind is no evidence
  that the ground under it is dry either. The card keeps printing what JPS publishes and adds
  `Faulty signal.`, the same shape the siren block above uses. **`soak()` in `test.js` sets
  `backed: true`**, or a faked storm on one of those gauges draws as a faulty signal with no pin and
  no blob. Do not widen this to a duration cutoff, and do not let it silence a gauge it cannot ask.
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
  **A fake sample carries a status code too**, the third element real samples get from
  `sparkPoints()` — `wlCode()` / `gaugeCode()` / `rainCode()` in `test.js` copy the cutoffs in
  `sources.php` (a siren needs none — its value is its status). That is the one place a status is
  scored client-side, and it is allowed because
  nothing in test mode reaches a server. Without it the hover readout printed a faked flood in plain
  ink, which hid the very crossing the fake exists to show.
  **A fake that moves one field of a sensor has to move every field the card draws beside it.**
  `soak()` is the single door for a rain gauge — the hour, the day, the status, the graph and the
  `acc` chart all leave through it, because `rainState()` prints `HEAVY RAIN` and `rainBars()` draws
  the hour directly above a 1 h column that states it as a number, and the two disagreeing reads as a
  bug in the chart rather than as a fake. Two callers had already drifted.
  `drown()` hard-coded a 158 mm day where the storm cell applies a multiplier that gives 157.5.
  **`stormAcc()` shapes the five windows rather than scaling them.** A violent cell is short, so its
  3-hour multiplier falls as the hour gets heavier — 75 mm held for three hours is a once-in-decades
  total, while 4 mm/h of drizzle really does run all afternoon. The two long windows carry a
  per-station `seed()`, because antecedent rain is the one thing that does *not* follow from the
  hour on the gauge, and scaling it off that hour gave every faked gauge one silhouette. That seed
  is **FNV-1a and not `h * 31 + c`**: ids run `rf-153`, `rf-154`, `rf-156`, so the simple hash put
  adjacent ids on adjacent values and twenty gauges in a row drew the same chart. Test mode fakes the
  `derived` flags and the measured spans too. Both reach real data only once the odometer fills, so
  without a knob the asterisk and its footnote ship unseen.
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
  **The nearest-webcam offer tested this rule and lost.** It spent one revision as a corner glyph
  with the camera name and distance in a `title` alone. That is a fact a phone cannot reach, and the
  fix was not a better tooltip but a different control: a menu row, which states the name, the
  distance and the reading as text. Reach for the row shape before the glyph shape.
- **A timestamp is printed inside a ⋮ menu and nowhere else.** `sourceInfo()` does it for a sensor
  and `wxDots()` does it for the weather section, which is the only other reading on a card. Three
  facts, all about the plumbing: are we hearing from this station, what was the stamp on the last
  thing it sent, which of the three feeds won. None of them changes what the water is doing, and as a
  footer line they repeated per sensor down a six-sensor mast. They are what you check when you doubt
  the number, so they sit where you go to look. The stale state blocks (siren, rainfall, gauge) print
  no time at all. **The stamp is printed at the precision its age needs, and `stamp()` in `popup.js`
  is the one rule.** A reading taken today is answered by its clock. A reading from any other day is
  answered by its date. This reverses what stood here, which said elapsed time was appended only on
  a stale station "because on a live one the date is the answer" — the live case is the one where
  the date says least, since it is today on every live station, and `Updated 14/08/2026 15:45` spent
  ten characters saying so. The stale case was worse: `Last reported 19/09/2025 12:15 · 7892.0h ago`
  put a minute hand and an elapsed figure on a sensor eleven months dead. Four stations in the
  payload are past 6,500 hours. **Elapsed time is gone from both callers**, and `ago()` was
  deliberately **not** given a unit above hours to fix `7892.0h` — this was its only caller that
  could overflow, and the two that remain (`clip.js`'s frame age, `net.js`'s poll clock) stay inside
  the range it was written for. A day unit there would be unreachable code. The same-day test is a
  `startsWith` and not a parse: JPS stamps `DD/MM/YYYY HH:MM:SS` in MYT and `en-GB` formats a date
  the same way, so one expression reads both that string and MET's unix instant. Seconds are trimmed
  for display by `noSec()`; the underlying string stays verbatim, so `parseMY()` is unaffected — it
  has no caller in `popup.js` any more, and `js/clip.js` is the module that still uses it. **The glyph names
  what is in the menu, and it has changed twice on that one rule.** It was a ⋮ over a single "ignore"
  item, which promised actions and held one, so it became an ⓘ when the provenance moved in. It is a
  `more_vert` ⋮ now that the menu also carries the favorite, the nearest webcam or water level, the
  map link and the ignore — four actions is not an information glyph. Count the actions before
  changing it again.
- **A marquee needs three things measured, not guessed.** `js/ticker.js` renders the item set twice
  and translates `-50%`, which is only seamless if one copy is at least as wide as the box — so it
  repeats the set to cover the box *before* doubling. Width alone isn't enough: a single wide item
  still pops, because the tile leaving the left edge is the whole strip leaving. `MIN_TILES` (3)
  guarantees a follower. And `#ticker` must have a **fixed flex basis** — sized to content the
  header re-laid itself out every poll as the alert count changed.
- **`.solo` is hidden until hover, globally.** The rule lives on the class, not on `#districtList`,
  so any new list reusing that pill button gets an invisible control on a mouse. `#ignoredList` and
  `#favList` both override it back to `visible` — restoring is the whole point of either panel — and
  share one `::after` that grows the hit area past the small pill, `inset: -10px -6px`, because a
  two-line row must not grow around the control to make it a real touch target. The two selectors are
  merged in `css/base.css` on purpose, so the ignored list and the favorites list cannot drift apart.
- **`<details>` can't animate closed** (children go `display:none`) and hides non-`<summary>`
  children entirely — that's why the drawer is a `body.drawer` class and the credit sits outside.
  The two filter sections *inside* the drawer (`#districts`, `#ignored`) are `<details>` precisely
  because they want no animation. Their counts live on the `<summary>`, so a collapsed section still
  reports what it is holding — do not move a count into the body.
- **`border-collapse: collapse` drops padding on the table box** — `#netstats` uses `separate`.
- **leaflet.heat sizes in screen pixels.** `heatScale()` converts a layer's ground distance to
  pixels per zoom so blobs stay ground-fixed. Do **not** also call `heat.redraw()` — the plugin
  repaints on the following `moveend`, and doing both painted twice per zoom. Radius capped at
  `HEAT_MAX_PX` because blur cost is quadratic; past that cap the layer *fades out* rather than
  quietly covering less ground, and the fade is per layer because the cap is. `maxZoom` on the layer
  is **not** a display limit — it divides every weight by `2^(maxZoom − zoom)`, so anything inside
  the usable zoom range dims blobs as you zoom out. Pinned to 0.
- **A blob is painted `radius + blur` across, not `radius`, so the two must sum to the ground
  distance and may never be set apart from each other.** simpleheat's `radius(t, i)` fills an arc of
  radius `t`, blurs it by `i`, then stamps a sprite of half-width `t + i`. `heatScale()` handed
  `radius` the whole of `HEAT_KM` and added `blur = radius * 0.8` on top, so every blob on both
  layers reached 1.8× its stated size and covered 3.24× the area. One rain gauge reading 19 mm/h
  washed 250 km² of Kuala Lumpur violet, over twenty gauges reporting 0.0 mm, the nearest of them
  1.6 km away. **Three places asserted the 5 km and the code painted 9** — the constant's comment,
  `heatScale()`'s own comment, and `thinHeat()`, which drops a weaker neighbour on the claim that
  the stronger point's blob already covers it. That last one is the compounding fault: thinning at
  5 km while painting at 9 let every pair between the two distances stack its alpha, which is the
  bug `thinHeat()` exists to prevent, moved out one ring. **`SoftHeat._redraw()` paints the blobs
  itself now and never draws that sprite**, so the trap is gone rather than tuned — one `blobPx()`
  is the radius, `thinHeat()` takes the same ground distance, and `HEAT_MAX_PX` bounds what it
  names. The `radius` and `blur` options stay in `BASE` only because `_updateOptions()` builds
  `_grad` from `gradient` in the same call, and `_grad` is where the colours come from.
- **"Gauge" in the rain heat entries below means a rainfall station, and this is the one place two
  kinds share a word.** A rainfall station measures `hourly` in mm/h and is the only kind the rain
  layer reads, on both sides of the argument — `render.js` gates every one of them on
  `kind === 'rainfall'`. A **flood gauge** is the kind spelled `gauge`, labelled `Flood gauge`,
  measuring `depth` in metres over a flood-prone spot. It feeds the **water level** layer beside the
  rivers and no rain rule touches it. The collision is not theoretical: the JPS field notes above
  record that a flood gauge reading negative means **dry ground**, so "a dry gauge" reads as a
  rainfall station saying 0 mm/h in one entry and as a flood gauge on dry land in another. Name the
  kind in any sentence that reads both ways.
  **A flood gauge is never evidence about rain, in either direction.** It measures what the drainage
  failed to carry away, which is not what fell. Where the drainage is good, rain falls as hard as
  anywhere and the gauge stays clear. Where runoff arrives from upstream, the gauge goes under with
  no rain overhead. **So a clear flood gauge must never join `dryPoints` and deny the wash, and a
  submerged one must never paint.** Only a rainfall station reports rain. Checked on the current
  tree: no rain conclusion reads `depth`, and `rainBacked()` tests the station's own
  `cumulativeRainfall` odometer rather than any gauge. Keep it that way — the tempting mistake is to
  read a dry flood gauge as proof that the rain layer is overclaiming, and good drainage is the
  whole reason it is not. This is the same rule the siren already obeys from the other side, where
  flood gauges are not backing evidence either.
- **A rain gauge reporting zero is a reading, and the rain heat layer draws it.** The network says
  two things — 12 gauges reporting rain and 218 reporting none, on the payload this was built from
  — and the layer used to draw only the first, so the wash covered ground that 218 stations had
  already measured and found dry. `SoftHeat` in `js/heat.js` runs the second pass for this reason: it
  paints the wet gauges, then runs a second pass in `destination-out` stamping a soft brush at every
  dry one. **`RAIN_KM` (6 km) is one number and covers both readings.** A gauge reporting rain
  paints that far and a gauge reporting none erases that far. Two numbers stood here first, 9 km of
  paint against 4 km of erase, and there is no defending that — it is the same instrument, the same
  minute and the same question, so the answer "none" cannot carry less ground than the answer
  "12 mm". Symmetry cost 4% of the painted area, 2,005 km² against 1,906. **Do not split them
  again.**
  **The number itself was 9 km until 2026-08-14, and the evidence for 6 was already in the file.**
  The co-wetness study in `config.js` puts the halving distance at 6 km and the background rate at
  12, so 9 was the outer edge of a claim that survives rather than the middle of one. A convective
  cell here is 1 to 2 km across. **Moving it moves four things at once** — the paint, the erase,
  `thinHeat()`'s spacing and the blob — and it changes gauge spacing *measured in blob radii*, which
  is what `FEATHER` is sized against. Thinning at a shorter distance keeps gauges that are
  relatively further apart: the 90th-percentile join went from 1.48 radii at 9 km to 1.66 at 6.
  **The first fix used 4 km as the blob size instead, and it is the wrong shape of answer** — a
  smaller brush charges the same ground everywhere, including Sabak Bernam where the nearest other
  gauge is 12 km off and nothing disputes anything. It cost three quarters of the map's area to fix
  a problem that only existed where a dry gauge stood. Measured: 2,747 km² before, 503 km² under
  the small brush, 1,906 km² now, with 58 dry gauges under paint before and 1 after. **Three
  details are load-bearing and all three were found by running `heat-test.html`, not by reading the
  code.**
  **simpleheat leaves `globalAlpha` set** — its draw loop assigns each point's weight and never puts
  it back, so an eraser inherits the last blob's weight and removes that fraction rather than all of
  it. A 0.9 blob left 22 of 229 alpha on a dry gauge. The pass runs inside `save()`/`restore()`.
  **A gauge reporting no rain reaches exactly as far as a gauge reporting rain, and the boundary
  between two that disagree is halfway between them.** Both rules are old. The `destination-out`
  stamp that carried them held the second alone, and it bought that by breaking the first.
  Its radius was one scalar, `min(r, nearest_wet / 2)`, applied to a circle — so a dry gauge with a
  wet neighbour to the east shrank in **every** direction, including west where nothing disputed it.
  Measured on the live network: 143 of 191 dry gauges capped, a median of 0.54 of the radius, and
  35% of the ground they were entitled to deny actually denied.
  `_field()` decides it per pixel now and the stamp is gone. `keep = 1 - dcov * gate`, where `dcov`
  is the dry coverage shaped exactly like `cov`, and `gate` is inverse-square distance to each side —
  Shepard's weighting, chosen for the one property that matters. **A gauge's own point is a
  singularity**, so the gate is 0 at a wet gauge and its reading survives whole, 1 at a dry gauge,
  0.5 exactly halfway between the two, and 1 with no wet gauge in reach. The protection and the
  reach come from the same expression instead of fighting each other. Measured after: 77% of the wet
  reach kept against 96% under the cap, and still only 2 of 193 dry gauges left under paint — both
  of those share a pole with a wet gauge.
  **The cap existed for a real reason, so keep the reason when touching this.** A dry gauge on the
  same pole once erased its neighbour off the map outright. A wet gauge 2 km from a dry one lost
  half its alpha. `heat-test.html` asserts the wet gauge keeps 229 of 230 with a dry gauge 1.5 km
  away.
  **The brush holds full strength over its first 15%** — now `FEATHER`'s flat core, and once a
  gradient stop — because a ramp peaking at the exact centre honours the reading at a mathematical
  point and no pixel is one. The gauge kept 5 of 206 alpha on a half-pixel sampling offset. Do not
  replace any of this with interpolation: a dry gauge may deny
  ground, never supply a value. See `docs/FEATURES.md`, *The rainfall heatmap claimed rain over
  250 km² from one gauge*.
- **A heat blob's alpha is its colour as well as its size, so the brush's own falloff walks down the
  legend.** simpleheat's `_colorize()` looks the gradient up by alpha, and the stock brush fades
  across most of a blob — so one rain gauge reading 27 mm/h, JPS's *heavy* class, painted heavy at
  the gauge, moderate 4 km out and light 6 km out. Three classes from one number, with a legend beside them naming those colours in
  millimetres. In IDW or kriging a value falls off because the estimate falls off. Here it fell off
  because that is how a brush is drawn.
  **So `SoftHeat._redraw()` in `js/heat.js` paints the blobs itself and never calls `_colorize()`.**
  It reads the class colour out of `_grad` — the 256-entry ramp simpleheat builds from
  `options.gradient`, so the legend stays the one definition — and draws each blob in that **one**
  colour with only its alpha ramping, and the alpha holds full strength across an inner core before
  it smoothsteps out. Measured on one gauge at 27 mm/h: one hue from the centre to 8 km with alpha
  falling 182 to 20. A river at its danger mark paints `#ff4e4d` across its whole 5 km, 255 to 0.
  **Two shorter fixes were built and thrown away, and both are worth not repeating.** Cutting the
  sprite's blur to 0.04 got one class per blob and drew hard discs. Softening those back with a
  `destination-out` pass got the look and broke the neighbours: a `destination-out` brush is a claim
  about the canvas, not about one blob, so each blob's own feather ate whatever its neighbours had
  painted under it. Measured on two gauges one blob apart, which is the closest `thinHeat()` ever
  leaves them, **each centre was erased to alpha 5 of 177 by the other one's feather**, and the
  ground between them stacked to 200 in a class neither gauge reported. Painting is additive over a
  neighbour and erasing is not, so a fade has to be painted. After the rewrite the same two gauges
  hold 179 at both centres, one hue end to end, and the largest step between 1 km samples is 53
  inside the smooth falloff against 172 before.
  **And the layer computes a field rather than stamping shapes, because two readings are not twice
  one reading.** Every Porter-Duff `over` adds alpha, so two gauges reading the same rain over the
  same ground came out heavier than either reported — 227 where two 179 blobs met. No composite
  operation blends colour while taking the *larger* alpha, so `SoftHeat._field()` asks the readings
  per cell instead: `v` is the blended reading, every gauge in reach weighted by nearness and
  **normalised**, so two gauges reading the same thing give that thing back. `cov` asks whether any
  reading reaches this ground at all, which carries the soft edge and is why an isolated blob fades
  while an overlap does not brighten. Colour is `_grad[v]`, opacity is `v * cov`. Measured on
  two gauges one blob apart: both at 0.70 gives alpha 179 flat end to end, largest step over a
  kilometre one count. One at 0.95 and one at 0.35 walks `#f35772` to `#7b7bff` with alpha 242 to
  89. The smoothness between neighbours is the browser's bilinear filter on a 4 px grid — raise
  `CELL` and the edges go blocky, lower it and the cost climbs with the square.
  **`cov` is a union, and it must never go back to a max — that is a Voronoi border.** A cell asks
  two questions and one curve cannot answer both, so `BLEND` (0.45) sizes each reading's say in the
  mean and `FEATHER` (0.75) sizes the coverage. One curve served both at first, joined by `max`, and
  that failed twice over. `max` follows whichever gauge is nearer, so its slope flips sign on the
  equidistant locus — the Voronoi edge. A sign flip is a crease, and the eye reads a crease as a
  line. The blend weight is also down to 0.30 at 0.8 of a radius. That is right for a weight and far
  too steep for coverage. `thinHeat()` guarantees one radius between two gauges and no more.
  Measured on two gauges reading the same 0.70, against 179 at each of them: 107 between them at 1.4
  radii, 61 at 1.6, 20 at 1.8. An unequal pair states it more plainly. 0.95 and 0.35 painted 242 and
  89 with **54 between them**, and a midpoint darker than both ends is a border, not a transition.
  The replacement is a **clamped sum**, and it cannot pass 1, so an overlap still never paints
  brighter than a gauge centre. After it, 179 flat at 1.13 and 1.48 radii, and the unequal pair
  walks 242 → 149 → 89.
- **A rim facing empty ground and a join between two blobs are different edges, and only the combine
  can tell them apart.** `FEATHER` is one radial curve, so lowering it to soften the rim hollows out
  every join by the same amount — measured, 0.75 to 0.50 under a union took the share of solid joins
  from 84% to 45%. The combine sees something the curve cannot: how many readings arrive. A rim has
  one and a join has two. So `cov` sums the per-gauge coverage rather than unioning it. One gauge at
  half strength stays half covered, and two blobs meeting at half strength each add up to covered.
  **The clamp is `1-(1-s)²` and not `min(1, s)`.** A bare clamp breaks its first derivative where it
  bites, which is a crease along an iso-contour — the Voronoi fault on a different line. Squared has
  slope 0 at s=1. It is also the highest power that still fades the rim gently, because a higher one
  holds full opacity further out and hardens the edge it exists to soften. That bought `FEATHER` at
  0.50 while `RAIN_KM` was 9: the rim fade went from 1.38 km to 2.20 km with a 34% gentler slope.
  **It sits at 0.20 now, and the value only means anything beside `RAIN_KM`.** A 6 km blob at 0.50
  fades over 1.47 km, which is less gentle in metres than the 9 km blob it replaced. At 0.20 it
  fades over 2.35 km at a slope of 0.413 per km, gentler than the 9 km layer on both counts. The
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
  at 1.90 radii, and one sweep scored the same candidate at 71% and then 11% with no code change
  between. Thin *every* rain gauge instead. **Two populations answer two questions and their
  percentiles differ**, so name which one a number came from. Nearest neighbour, which is where a
  seam shows first and where `heat-test.html` takes its probe distances: at `RAIN_KM` 6, 82 pairs,
  median 1.21 r, p90 1.66 r, widest 1.95 r. Every overlapping pair, which is what join solidity is
  scored over since any two blobs that meet can show a seam: 143 pairs, median 1.54 r, p90 1.89 r.
  The Verify block prints both. A constant tuned against one snapshot is tuned against one
  afternoon's rain.
  **The bucket index in `_field()` is load-bearing, not tidiness.** Without it the cost is cells
  times readings, and `thinHeat()` packs readings one radius apart, so zooming out shrinks the
  radius and multiplies the readings together. Measured on a full viewport at that spacing: 52 ms at
  30 readings, 785 ms at 638, 3.0 s at 2,655 — against a flat 33 to 38 ms bucketed at every one of
  them. A flood is when a lot of stations report at once and when the map must not seize.
- **The denial touches alpha and never colour, and that survived the move out of `destination-out`.**
  A dry reading denies the ground, not one neighbour's contribution to it. The old pass ran last, so
  a denied edge faded at the colour already settled beneath it. `_field()` gets the same result by
  construction rather than by ordering: hue is `_grad[v]`, `keep` multiplies only the alpha, and `v`
  never sees a dry gauge at all. **Do not let a dry gauge into `v`.** It would restate the rainfall
  as a lighter class, which is the thing this layer exists not to do — and with `BLEND`'s flat core a
  dry gauge 2 km away would carry equal weight and halve the reading. A dry gauge may deny ground and
  never supply a value. `heat-test.html` asserts the hue at three radii and across a denied boundary.
- **A canvas radial gradient clamps past its last stop, so never `fillRect` one.** Beyond `r` the
  gradient does not stop, it keeps painting whatever the outermost colour was. The old eraser's
  outermost colour was full erase. Filled as a square, the four corners outside the
  circle — 21% of the box — erased everything under them, **including the paint belonging to the next
  blob along**, which `thinHeat()` places exactly one blob away and therefore right in that corner.
  It drew as hard rectangles cut out of the wash, axis-aligned and about 2r on a side, which reads
  as a tiling fault or a canvas-tile seam and is neither. It went unseen for weeks first, because
  the *erase* clamps to transparent and clamping to "no erase" is invisible. That is luck, not
  design. **This layer stamps nothing any more** — `_field()` computes every pixel, so there is no
  sprite and no disc left to get wrong, and the `stamp()` helper that guarded the trap went with the
  pass. Anything that brings a gradient back needs it back too.
  `heat-test.html` still puts a second gauge 1.2 blobs away on the diagonal, outside the first blob's
  circle and inside its square.
- **`heatScale()` may only size a layer the map is holding.** `setOptions()` ends in `redraw()`,
  which reads `this._map._animating`, and Leaflet nulls `_map` when it removes a layer — so sizing a
  layer that is off throws a `TypeError`. It hid for a long time because the layer that is off has
  usually never been added, and a layer with no canvas returns from `redraw()` one test earlier.
  **Switching the heat chip from rainfall to water is what reaches it**, since that leaves `rainHeat`
  added-then-removed, holding a canvas and no map. `syncHeat()` adds and removes before it calls
  `heatScale()`, so a layer just switched on is on the map by then and still gets sized.
- **The water layer has no denial and must not get one, and everything else it shares.** Both layers
  are `SoftHeat`, so the field render, `BLEND`, `FEATHER`, the clamped-sum coverage and the bucket
  index are one implementation and reach both. Only `setDry()` is called on one of them, from
  `render.js`. **A river reading low says nothing about the river beside it.** A rain gauge is the
  only sensor here whose zero is evidence about the ground next to it, which is why that argument
  exists on one layer alone. A flood gauge is not that sensor either — see the drainage rule in the
  rain heat entry above. Anything added to `SoftHeat` lands on both layers, so check it against both
  before assuming it is a rain change.
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
- **`?shots=` returns `[ts, tier, stationId]`, not a bare timestamp.** The reader still accepts a
  bare number: `timeline.js` guards with `Array.isArray(r)`. The response is cached for 60 seconds,
  so a deploy leaves the old shape in flight. Do not remove that fallback while the cache header
  stands. `wall.js` and `clip.js` no longer call `?shots=` at all — see the strip gotcha below —
  so `timeline.js`'s lightbox is the only reader left with this shape to guard against.
- **Two image endpoints answer for one camera, `?shot=` and `?sheet=`, and they deliberately
  disagree about how long a browser may cache them.** `?shot=<id>&t=<ts>` names one immutable,
  already-captured frame, so `Cache-Control: public, max-age=31536000, immutable` is honest — that
  exact file never changes again. `?sheet=<id>` names the strip `buildSheet()` in `shots.php`
  builds on request — every frame inside the clip window, laid out side by side in one WebP, which
  is what `js/wall.js` and `js/clip.js` play instead of fetching a frame at a time (see
  `docs/FEATURES.md`). The same URL's *bytes* change under it every time `captureShots()` lays a
  new frame and the strip goes stale, up to once every `SHOT_EVERY` (30 min), so `?sheet=` carries
  `public, max-age=900` instead — half of `SHOT_EVERY`, so a reopen inside that window is free and a
  cached strip can never outlive one capture cycle by more than that same margin. Copy `immutable`
  onto `?sheet=` and a reader who opens a camera twice in one capture window keeps seeing the strip
  from before it, for up to a year, with nothing to tell them it went stale — the exact failure the
  frame endpoint's own header is right to invite and the strip endpoint exists to avoid.
- **`clip.start()` must stay idempotent by camera id *and* by generation.** `render()` calls
  `openSide()` on every poll for the card on screen. A clip that restarted there would jump back to
  frame 0 while somebody watched. So `start()` rebinds to the fresh nodes and keeps its place. The
  id alone is not enough. A reader can close a card and reopen the same camera before the fetch
  returns. `stop()` clears the id and the second `start()` sets it back, so both continuations
  match. `gen` catches that case. `stop()` bumps it on every call, so a stale run can never match
  again.
- **`.shotwrap` clips its overflow and holds two children, so nothing may pin its height to one of
  them.** The box carries the picture *and* the `<p class="clipcap">` caption under it. `.done`
  relaxes it to `aspect-ratio: auto` so it measures both. `.shotwrap.strip` used to pin it back to
  `16 / 9` — giving the strip `<img>` a definite box to resolve `height: 100%` against — which made
  the box exactly the picture's height, started the caption on its bottom edge and cut it off.
  `tick()` toggles `.strip` once a lap, so the caption flashed on for the one second a lap spends on
  the live still and vanished for the other six. **Nothing in `js/clip.js` was wrong**: `capText` is
  held at module scope precisely so a rebuild repaints it, and the text never changed — two JS
  explanations were chased first (`stop()` blanking `capText`, `finishEmpty()`'s `id = null` forcing
  a re-probe) and neither fires, because every camera serves a strip. The ratio still has to be
  stated, or `.shot`'s own `16 / 9` computes a height off the `--n`-times-wider width and grows the
  picture taller per cell — so state it **on the image**, `aspect-ratio: calc(var(--n, 1) * 16 / 9)`,
  where widening the ratio by the same factor as the width holds one cell at a single frame's height
  and leaves the wrapper free. `.shotwrap.strip { aspect-ratio: auto }` is then explicit rather than
  left to `.done`: `bind()` re-adds `.strip` to a fresh `<img>` on every poll, before that image has
  fired `load`, and the base rule would otherwise clip the caption once per poll instead of once per
  lap. Anything added to that box gets the same treatment.
- **`position: relative` does not scope a `z-index`, so `.camtile` carries `isolation: isolate`.** A
  positioned box opens a stacking context only when its `z-index` is something other than `auto`.
  `.camtile` had `position: relative` and no `z-index`, so the numbers written *inside* a tile
  (`.camsay` 1, `.camtile::before` 2, `.camfail` 3) resolved against `#camBox` and competed with the
  dialog's own chrome. `#camBar` at `z-index: 1` therefore drew **behind the skeleton shimmer on
  every tile** — `::before` at 2 — which is exactly the state a tile is in while that bar is on
  screen, so the bar showed only through the 6px gaps between columns. The fix is one declaration on
  the tile, not a bigger number on the chrome: raising `#camBar` to 4 wins one race and leaves the
  leak for the next thing that paints near a tile. This is the mirror of the map-pin gotcha above,
  where `position` had to be *added* before a `z-index` would apply at all — same spec sentence,
  opposite symptom.
- **The lightbox reads its camera from `data-clip`, not from the clicked image's `src`.** The panel
  clip plays a strip for its archived cells (see the `?sheet=` gotcha above) but still ends every
  lap on a fresh live still, so `img.src` cycles between the strip's own URL and a `?cam=<id>` one
  every few seconds for as long as the card stays open — matching `?cam=` against whatever `src`
  happens to be showing catches the camera on some ticks and misses it on others, which is worse
  than failing outright: a match that sometimes works reads as a bug in the lightbox, not as a wrong
  approach. That is what opened a lightbox with no scrubber, no compare and no warning glyph before
  `data-clip` replaced it. Only the table's "show image" button has no such wrapper, and it keeps
  the old path.
- **`.stage` is exactly the picture's box, and nothing that sits beside the picture may live in it.**
  `.ab` is `inset: 0` of `.stage` and `.abgrip` spans its full height — that is what lines the two
  A/B halves up pixel for pixel, and it holds only while `.stage` is the frame and nothing else. The
  control bar and the warning pill are therefore siblings of it inside **`.player`**, which is the
  box both overlays are positioned against. `ui.js` injects `camWarn()` into `.player`, not
  `.stage`, for the same reason.
  **`.camfail` is the one child that is allowed, because it stands *instead of* the picture rather
  than beside it** — `inset: 0`, drawn only under `#lightbox.nopic`. That class is also the only
  thing that may give `.stage` a size of its own. A failed `<img>` lays out at 0×0, and `.stage` and
  `.player` are both shrink-to-fit, so a dead feed folded the frame, the control bar and the warning
  pill up together and left the dialog wrapped around its title. **Do not fix that with a floor on
  `.stage`** — the box has to keep matching the picture, or every frame narrower than the floor draws
  its A/B halves out of line. `ui.js` sets the class from `naturalWidth` in one handler for `load`
  and `error`, so it lifts again the moment a later frame loads.
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
- **A claim about what the app does not do needs a check that lists what it does do.** The About
  pane once said "It loads nothing from a third party." A grep for known CDN prefixes verified it:
  `https?://(cdn|unpkg|jsdelivr|fonts\.googleapis)`. That pattern matches only a host starting `cdn`
  right after the scheme, so `basemaps.cartocdn.com` passed clean on the wrong letters alone.
  `js/map.js:24` fetches tiles from that host on every pan and every zoom. The Credits block in the
  same pane already names CARTO for exactly those tiles. The claim shipped false anyway. A guess at
  what a violation looks like proves nothing. The check must list every absolute URL the code
  contains, then classify each one as fetched or merely linked. Any future "we send no X" or "we load
  nothing from Y" sentence needs that same full sweep, not a short grep aimed at known offenders.
- **A value read back out of the cache must default inside the one function every cached read passes
  through, not at each call site.** `?force=1` stamps `forced: true` into the payload it triggers,
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
  cache, so it said JPS on every poll. `cacheAge` sits on the LEFT now.
  **The `ETag` was stable only because of that bug.** `payloadValidators()` hashed the whole body,
  and a field frozen at `0` is a field that cannot move a hash. Repair `cacheAge` by itself and a
  rising number changes the body every second, which changes the `ETag` every second, and the `304`
  in `sendPayload()` stops firing. Nothing errors. A validator that never matches is not a failure,
  just a full 33 KB body on every poll for as long as a tab stays open. `payloadEtag()` is the other
  half: it blanks `"cacheAge":N` to `"cacheAge":0` before hashing, so the tag names the build rather
  than the moment somebody read it. **It blanks the field rather than cutting it**, so the hash
  still depends on that field being present.
  It sits apart from the header writing so `--selftest` can call the rule instead
  of restating it. That is the same reason this file lifts out `shotFresh()` and `stationUpdated()`.
  Five
  assertions guard it, and `cacheAge does not move the ETag` is the one that keeps the `304` alive.
  **Any diagnostic added to this payload that changes without the data changing needs the same
  treatment**, or it silently costs every reader the full body on every poll.
- **Moving an element to a new parent can change which flex rule governs it, even when the
  element's own rules stay the same.** `.testtog` was a flex item inside `.modalhead`. There,
  `flex: none` sized it to its own content, and it drew as a pill. Moved to sit as a block child of
  `#aboutBox`, its own `display: flex` made it a flex container instead, one that stretches to the
  width of its new parent. Left as is, `.testtog:has(:checked)` paints a full-width amber bar across
  the pane. `#aboutBox .testtog { width: fit-content }` pins it back down at the new site. A
  component moved between a flex-item role and a flex-container role needs its sizing rule restated.
  The old rule does not travel with it.
- **The go-to box lists sites, and `hits` holds row objects rather than stations.** Six row shapes
  share one array: `site`, `sensor`, `near`, `ask`, `place` and `msg`. `pick()` switches on `r.t`,
  and anything new added to that list must add a branch there as well as in `rowHtml()`, or a reader
  will select a row that does nothing. The sub-rows are spliced into `hits` itself rather than hidden
  with CSS, which is what lets the existing arrow keys keep walking visible rows with no new code.
- **A picked place refills the list; it opens no card.** `place` and `ask` are the two rows that
  close nothing and keep focus in the box — every other row ends the search. Picking a place sets
  `nearPlace`, drops the pin and moves the map, and `search()` then answers about that point instead
  of about the query: the sites within `NEAR_MAX_KM`, nearest first. There **was** a card here, a
  copy of "You are here" under the key `@place`, and it is gone — four sensor sections with a meter
  and a graph each, when the question a place search asks is "which station covers here". Do not put
  it back. `nearPlace` is cleared by `oninput` and by `setFind(false)`, or the next open answers about
  a place the reader typed away from. The pin is not cleared: it marks somewhere they asked about,
  and it lives until another place replaces it.
- **Nothing calls `?place=` until the reader asks.** Nominatim's usage policy names per-keystroke
  autocomplete, so the lookup hangs off an explicit row at the foot of the list and never off
  `oninput`. `lookup()` carries a generation counter for the same reason `clip.js` does. Do not
  "improve" this into a debounced auto-search: every abandoned query would still leave the machine,
  and a fast typist would fire several.
- **The camera wall is painted on a poll, never rebuilt.** `render()` calls `paint()` in
  `js/wall.js`, which swaps the tier class and the phrase on the tiles that already exist. A tile
  holds three things the payload does not: which cell of its strip it is showing, how many cells
  that strip has, and whether the observer reached it. A rebuild throws all three away and drops
  every visible tile back to the start of its lap, which is the failure `js/clip.js` was written to
  prevent on one camera, arriving a dozen at a time. The filter obeys the same rule: a hidden tile
  stays in the grid. **Do not add `wall.open()` to the poll path** beside `dataTable()` — the table
  is safe to rebuild because a row is a pure function of the payload, and a tile is not.
- **A grid row does not follow its item's `aspect-ratio`, so `#camGrid` sets `grid-auto-rows`.**
  `.camtile` takes its whole height from `aspect-ratio: 16 / 9`, and an `auto` row measures the item
  some other way. Measured on the live wall of ninety tiles: a **27.86px row against a 110px tile**,
  so every tile overlapped the two below it and the wall read as a stack of cards. The same markup
  with ten tiles gave a **283px row against the same 110px tile** — one fault, drawn twice, once as
  overlap and once as gaps. Neither number tracks the column width, and neither moves when the
  breakpoints change the column count. `grid-auto-rows: min-content` in `css/chrome.css` pins the
  row to what the tile needs. Every overlay inside a tile is absolutely positioned, so no tile can
  ask for a taller row than its own ratio. **Measure the row against the tile before believing
  either.** The gap version reads as a spacing mistake and the overlap version reads as a `z-index`
  mistake, and both are this. Three other explanations were tried first and all three were wrong:
  `align-items: start` on the grid, `position: absolute` on the tile's `<img>`, and a wider tile
  ratio. Each left the row exactly where it was.

- **Under `NARROW_PX` (300) the app blocks the whole page, and that block is a `<dialog>` for one
  reason.** `showModal()` puts it in the **top layer**, which is not part of any stacking context, so
  it covers an open About box, the all-stations table and the camera wall. No `z-index` can do that —
  the same rule `js/sparktip.js` already obeys from the other side. It also makes the rest of the
  page inert for free, so no `inert` attribute has to travel over the page. A plain `show()` paints
  over the map and leaves the page live underneath, and the two look identical on screen.
  **Nothing dismisses it except width.** There is no close control, because a dismiss button hands a
  reader a broken map and calls it a choice. `js/ui.js` refuses the `cancel` event, which is what
  Escape and the phone back gesture raise. The media query is live, so the box opens and closes
  itself and no resize listener runs. `:root:has(#narrowBox[open])` hides the overflow, because the
  page behind is inert and still laid out, and under 245px it drew a scrollbar along the bottom of
  the block for a map nobody can reach.
  **300 is a floor somebody chose and not the width where the layout breaks.** Measured: the app bar
  holds together to 245px and the document overflows below that, so the block takes 55 pixels of
  width that work today. A Galaxy Fold cover screen is 280 CSS pixels wide and lands inside it, and
  a reader locked out of a flood map is a reader with no water levels. Weigh that against a map in a
  240px keyhole before moving the number, and move it in `js/config.js` only.
  `narrow-test.html` reads `NARROW_PX` out of the source and guards all three silent faults.
- **The app bar wordmark has four spellings and the title rail picks one, so a specificity slip
  draws none of them.** `Klang Valley Flood Watch` → `KV Flood Watch` → `KVFW` → the drop alone, at
  282px, 190px and 94px of `header h1`. That is a **container query and not a media query**, because
  the rail is what is left after the ticker and the controls, and both of those move on their own.
  Below 600px the ticker takes a row of its own, so the rail WIDENS as the viewport narrows, from
  77px at 601px to 272px at 600px — no viewport threshold can follow that. The ticker then proved
  the rest: it went from `min(58vw, 656px)` to a flat `50vw`, with a `40vw` candidate in and out
  beside it, and then to `flex: 1 1 0` under a 300px cap on this rail. Each move changed the rail at
  every width above 600px, and not one threshold here needed an edit. The phone rule
  that hid the title whole is gone, since the container now measures what that rule assumed.
  `container-type: inline-size` is safe on that flex item because `flex: 1 1 0` with `min-width: 0`
  already takes the width from the flex algorithm and never from the content. **That is also why the
  cap sits on this rail and never as a basis on the strip** — containment collapses an element whose
  width comes from its own content, so `header h1 { flex: 0 1 auto }` draws no wordmark at all.
  **Every selector in the ladder goes through `.word >`, and that is specificity rather than
  tidiness.** `header h1 .word > span { display: none }` is one class and three elements, and
  `header h1 .w-sm` is one class and two, so the hide rule won and every width drew the drop alone —
  which looks exactly like the bottom rung and errors nowhere. Two classes beat one class and any
  number of elements. The thresholds are measured font widths (247, 156 and 59px at 22px Roboto,
  plus 32 for the drop and its gap), so **remeasure them if the font, the size or the words change**
  — a threshold set too low draws a spelling wider than its rail and the ellipsis hides the overflow.
  `title-test.html` is the check for both faults.
- **`.muted` carries a `font-size`, so it beats whatever size its context passes down.**
  `.muted { color: var(--muted); font-size: 12px }` in `css/base.css`. A declaration on the element
  always wins against an inherited value, however specific the parent's selector is. `.accx` sets
  `font-size: 10px` on the rain chart's label row and every label inherits it — but an unanswered
  window's label also carried `class="muted"`, so `24 h` and `72 h` drew at 12px beside three
  neighbours at 10. The two labels a reader is most likely to question drew biggest. The class was
  doing no work there either, since `.accx` already paints all five `--muted`. **This is not the
  first site**: `#ignoredList .nm .muted` patches the same trap by restating 11px. Read that rule as
  evidence rather than as a one-off, and treat `.muted` as a colour-plus-size pair. In a compact
  context, either state the size on the element or reach for the token instead of the class.

- **A graph's viewBox is stretched, so a mark on the plot goes in HTML over it, not in the SVG.**
  Every `.spark` carries `viewBox="0 0 100 28"` with `preserveAspectRatio="none"`, which is what lets
  one template serve any width — and it stretches everything drawn inside it. A line survives on
  `vector-effect: non-scaling-stroke`, and nothing else does: a glyph comes out squashed and a
  one-unit rule comes out wide. The rainfall peak mark is the worked example. `.spark` is already
  `position: relative` for the axis labels, so a percentage off the same `x()` the polyline uses
  lands on the same column, and `.peak` is a plain `<b>` with a `border-left` and an `<i>` on top.
  Its words go in `data-tip`, because `show()` in `js/sparktip.js` tests `[data-tip]` before
  `.spark[data-pts]` — the label wins while the pointer is on the glyph and the per-sample readout
  keeps every other column. **A mark near an edge moves the glyph, never the rule**: the newest
  sample is the last column, so rain peaking right now is the ordinary case rather than an edge case,
  and a centred glyph there hangs half its width off the plate.
  **The caption it replaced read the wrong maximum**, and that is the part worth remembering.
  `rainBars()` holds `hi0`, the peak of the readings, and `hi`, the axis maximum — which is the
  taller of `hi0` and the highest intensity class drawn across the plot. The caption printed `hi`, so
  a station peaking at 37.5 mm with the 60 mm class on screen said `Peak 60 mm in an hour`, a figure
  no gauge had reported. Anything stating a graph's peak reads the data, never the scale.
- **A label sharing a box with a percentage-height bar has to be reserved with `padding`, and a
  raised `sup` beside it grows the box that reserves it.** Two rules, both on `.acccol` in
  `css/base.css`, and the rain accumulation chart needs each. Its five totals print inside the plate
  rather than on a row above it, and a bar states its total as a percentage height — which resolves
  against the **content box** of its container. So `padding-top: 16px` shortens the scale of all five
  bars at once, and the tallest fills the 42px under its own number. A margin, or a shorter plate,
  leaves the percentage measuring the full box and the tallest bar covers the value it belongs to.
  The second rule is the provenance asterisk. A bare `sup` lifts itself with `vertical-align: super`,
  and a raised inline box **grows the line box that holds it** — the value measured 17.3px against
  the 16px strip, so the tallest bar started 1.3px inside its own number. `line-height: 0` with
  `position: relative; top: -4px` lifts the mark and contributes nothing to the measurement. **That
  is the normal case and not an edge case**: the 24h and 72h totals are both derived, so both carry
  the mark, and the five windows nest, so the longest is the tallest column. Anything new that prints
  a value inside a plot needs both halves.

- **The dark basemap is greyscale, and its *filled* water is the brighter tone, not the darker one.**
  All 18 colors in CARTO `dark_all` have a chroma of zero, so `saturate()` and `hue-rotate()` have
  nothing to act on. Filled water is luminance 38 and land is luminance 9. Read the river gotcha
  below before assuming this covers every river on screen. It does not. Two guesses got both facts wrong before any
  measurement. The first reached for `saturate()`. The second assumed water was the dark tone. Draw a tile as ASCII art, one character per tone, and the coastline names itself — the
  Straits of Malacca is a solid block of 38 on the west edge of tile `dark_all/10/800/503`.
  `#watertint` in `index.html` keys on that one value. **Four rules hold it together and each one
  fails silently.** The band table has **64 entries** because 64 is the smallest count that isolates
  38 from 34 and 42, the road and boundary tones. At 32 bands 34 and 38 merge. At 48 bands 38 and
  42 merge. The filter carries **`color-interpolation-filters="sRGB"`**, because SVG filters run in
  linearRGB by default and move every tone into a different band before the table reads it.
  The tint and the existing `brightness(1.75) contrast(.92)` lift are **one `filter` declaration in
  `css/map.css`, tint first** — a second rule setting `filter` on the same element replaces this
  value rather than adding to it, and the tint has to read the raw tones before the lift moves them.
  And the emitted color is **darker than what lands on screen**, because that lift multiplies it:
  `#071b2a` draws as `#15364e`. Preview the whole chain against a real tile, never the tint
  alone. CARTO owns this tone, so a restyle upstream aims the tint at nothing and errors nowhere.
- **Nothing can reference an SVG filter inside a `display: none` subtree.** `#mapfx` in `index.html`
  holds `#watertint` and must stay in the render tree. `css/map.css` takes it out of the flow with
  `position: absolute; width: 0; height: 0` instead. The rule is in the stylesheet and not on the
  element, because `index.html` carries no inline CSS.

- **The dark basemap loses water two different ways, and neither one is fixable with a filter.**
  `#watertint` gets the sea and the large lakes because CARTO fills those with one exact tone.
  **CARTO antialiases a river into the road tones.** A river is one pixel wide, so the style draws
  it as a line that blends toward the land tone by however much of each pixel it covers. **Measure before
  assuming a tone means what it looks like.** Mark every pixel Voyager paints as water, then read
  the dark tile at those same positions. At zoom 10 the sea maps to tone 38 for 80% of its pixels.
  At zoom 12 and 13 over Kuala Lumpur, tone 38 is not in the tile at all. The river pixels
  spread over tones 33 to 50 instead. Tone 37 is the peak and is only 20% to 27% river — the rest is roads
  and buildings, so keying it paints three wrong pixels per right one.
  **A retention pond is not drawn at all.** That is a separate fault with a separate cause: CARTO
  drops small water on area, not on screen size. Tasik Taman Desa at 0.115 km² holds 2,036 water
  pixels at zoom 13. A median pond at 0.0017 km² holds **zero** at zoom 13, 14 and 15 alike, and it
  is 8 screen pixels wide at the last of those. No zoom brings it back, and a filter cannot recolour
  something absent from the picture. The box holds 6,489 water bodies with a median area of 0.0037
  km², so this is most of them.
  So `js/map.js` draws both from `water.json`, on the dark theme alone. **Five things about that
  layer are load-bearing.** It uses a **canvas** renderer, because 6,635 shapes through the default
  one is 6,635 DOM nodes carried through every pan. It has **its own pane at z-index 250**, between
  the tiles at 200 and the overlays at 400, so heat, pins and the accuracy circle draw over the
  water. It reads **`--water` from `css/base.css` at the moment it builds the layer**, not when the
  fetch returns, because that token exists on the dark theme only. That token is the **finished**
  colour and the tint in `index.html` is the raw one, since the tile pane filter cannot reach this
  pane — move one and move the other. And the fetch stays **lazy and swallows its own failure** — a
  light-theme reader never pays the 234 KB, and a failure leaves a plainer map rather than a broken
  one. `water.json` has no `?v=`, so a rebake needs a hard reload.
- **Tolerance and scope are different knobs on `water-build.php`, and the wrong one costs bytes for
  nothing.** Douglas-Peucker controls the detail inside a shape the query already returned. Taking
  the rivers from 33 m to 11 m grows them from 105 KB to 199 KB. It adds no pond, because a pond was
  never a line in that query. If something is **missing**, change the query. If something looks
  **crude**, change the tolerance. There is also no area floor, on purpose: a small pond simplifies
  to a handful of points, so keeping every one costs the same 130 KB as a 0.001 km² cutoff.
- **A lake's outline is several ways in one relation, so closing each one separately draws wedges.**
  `rings()` in `water-build.php` chains member ways end to end, flipping one that joins backwards,
  and keeps only what closes. An open chain means the relation is broken upstream, and the script
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
  in a 28.5 km cell. A cell-scaled rule there accepts a station 22.8 km from its point — the weakest
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
  Thailand, about 300 km from Port Klang, and that row holds the three words `straits of melaka`. It
  passed on them alone and put Thai water on the ticker. `WARN_SEA_FAR` is **cut out of the text**
  before the keep test reads it, rather than tested for. Cutting is what keeps a row that names two
  stretches: strip the northern mention from "Northern Straits of Melaka and Central Straits of
  Melaka" and the central one still answers. A row naming only the far stretch has nothing left.
  **The sea test cannot read the heading alone.** MET files a storm over water as "Warning on
  Thunderstorms", the same words it uses over land, so a heading test read a marine row as a land
  one and judged it by the wrong list. `WARN_WATER` reads the text for "waters of" or "perairan",
  which MET writes on every marine row. Measured on a seven-row feed: one row survived before these
  two rules and none after, and the one that survived was the Thai-water row.
  A land row must name a place this map covers (`WARN_HERE`). That list
  includes `west coast` and `pantai barat`. MET names some warnings by coast rather than by state,
  and Selangor sits on the west coast. **A warning for the whole peninsula still drops.** That gap
  is open on purpose: adding `semenanjung` and `peninsular` also lets in warnings about every other
  state. Name the gap so the next reader sees a decision, not a bug. The filter reads English and
  Malay text alike, because MET writes some rows in one language only.
  **A live payload tested the southern stretch, and the rule answered correctly.** Before this work,
  `data.gov.my` was the only warning source this app had, and it had published nothing for seven days.
  No row reached the geography filter at all, so nothing exercised this rule. The JPS mirror delivers
  rows now, and on 2026-08-17 the ticker carried "Northern part of Phuket, Northern Straits Of
  Melaka, Southern Straits Of Melaka, Northern Reef South, Southeastern Reef North and Labuan".
  `WARN_SEA_FAR` cuts `northern straits of melaka`, and MET's `Southern Straits Of Melaka` then
  matches `WARN_SEA_KEEP`. **That is the right answer. The southern stretch reaches this map, and the
  northeast monsoon is when.** The repository owner confirmed it on 2026-08-17. So do not add
  `southern straits of melaka` to the drop list. An earlier draft of this entry recommended exactly
  that, on the assumption that the row named nowhere here.
  **What else the sentence names is a granularity floor, not a fault.** `hereParts()` splits on
  sentence and line boundaries. So one sentence naming six places survives whole once any one of them
  is in reach, and this row puts Phuket, two reefs and Labuan on the ticker beside our own water.
  Cutting inside a sentence needs per-place surgery on MET's wording, and that is a larger change than
  the paragraph filter this app has.
- **The two warning surfaces disagree about time on purpose, and `fresh` is the seam.** The panel
  lists a warning for its whole validity. The ticker carries it only while `fresh` — the first
  `WARN_FRESH` (6 h) of that validity, measured from the warning's own start and **not** from when
  we first read it. A sample valid for three days would otherwise scroll for three days, which is
  the standing banner the alert design standard rejects. The panel is a directory somebody opens.
  The ticker is an interruption nobody asked for, and an interruption has to end.
  `fresh` is scored in `sources.php` because MET stamps Malaysian wall clock with no offset, so a
  browser would age it by the reader's clock. **The ticker numbers its tiles before it filters**:
  `data-warn` indexes `state.warnings`, which the panel and the modal share, so renumbering after
  the filter opens the wrong warning.
  The panel section sits **under the `HAPPENING NOW` groups**, not above them. It led once, which
  put a regional forecast above a river over its danger mark — the same thing the tier sort already
  refuses to do to a forecast two streets away. `alerts()` splices it at the first group that is not
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
  `no-store` skips that check and forces a full fetch every time, on a poll that runs every few
  minutes for as long as the tab stays open. `js/ask.js`'s `askJson()` passes `cache` through only
  when a caller asks for it, so the payload poll must call it with no `cache` option at all. The
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
  inside an `async` listener with no `try`, so a failed import raised one unhandled rejection per
  open and said nothing on screen. **`withTimeline`'s own rejection handler does not cover that
  second `await`** — a handler on a promise settles that one continuation, never a separate one, and
  the shape reads as guarded because the word `catch` is already on the line above. Measured in node
  on the two shapes: one unhandled rejection before the `try`, none after. Its surface is `#tlfail`,
  the line `openTimeline()` already prints when the archive is out of reach, cleared before every
  attempt because `reset()` clears it only on the path that did not run. Anything new behind
  `lazy()` needs both halves, and a surface a reader can see beats a `console.warn`.
- **The JPS MET mirror answers JSON that is not valid JSON.** `met_gelora.json` and its siblings hold
  raw newline characters inside string values, so `json_decode()` returns null on a page that holds
  real rows. A null decode looks exactly like an empty feed to a caller that only tests `is_array()`,
  so a good page reads as an outage. `jsonLoose()` in `sources.php` walks the text, tracks whether the
  cursor sits inside a string, and escapes any control character it finds there. `pageHasData()` must
  test a `jps-` key with `jsonLoose()`, never with `json_decode()` alone, or a good page reads as an
  outage. **A second fault hid inside the first fix.** Inside a string, a backslash sets an escape
  flag. The old rule then copied the next character through raw. A raw control byte straight after a
  backslash skipped the sanitizer that way, and the function returned null on readable data. The
  escaped character now runs through the same control-character test the rest of the string uses.
  Measured 2026-08-17 against all five JPS MET files: four decode the same either way, and
  `met_gelora.json` goes from a parse failure to 2 rows.
- **A stale feed and a calm feed look the same, and `parsed: 0` cannot tell them apart.**
  `api.data.gov.my/weather/warning` sat seven days dead on 2026-08-17. Every counter stayed quiet,
  because the fetch had succeeded and the geography filter correctly refused week-old warnings about
  Phuket. `sources.stale` names a page that did not answer at all. `sources.old` is the new signal: it
  names a page that answered with nothing recent, scored off the stamp on the newest row. An age test
  cannot live in `pageHasData()`. That function decides what kind of document arrived, and a failure
  there discards the stored copy and delays the retry, the wrong outcome for a week-old bulletin,
  which is a real bulletin and not a broken fetch.
- **Zero rows is not old.** An alarm on a quiet warning feed is the cry-wolf failure the alert design
  standard rejects, so `noticeOld()` never reads an empty JSON array as a sign the feed has decayed.
  `jps-beat` (`met_cyclone.json`) covers the case a genuinely empty feed cannot cover for itself: it
  carries a row at all times, so an empty or unreadable heartbeat marks the whole JPS MET mirror old
  on its own. `jps-rain` is legitimately empty on most days, so the heartbeat is the only liveness
  evidence it has.
- **A warning stamp needs the ISO shape, or the merge and the modal both misread it.** `warnWhen()` in
  `js/ui.js` matches `^\d{4}-\d\d-\d\dT\d\d:\d\d` and prints the raw string when a stamp does not
  match it. JPS stamps `17-08-2026 08:00:00`. Left verbatim, that puts two date formats inside one
  modal. The merge sort is a `strcmp` over the same field, so a JPS stamp left in the shape JPS uses
  also misorders the merge. `jpsMetWarnings()` converts the stamp with `date('Y-m-d\TH:i:s', $from)`,
  the same shape `metWarnings()` already emits.
- **A national bulletin names several regions, and only one of them is ours.** A row-level place
  test keeps the whole bulletin once it names one place this map covers. `met_gelora.json` carried a
  1,795-character bulletin across 16 lines on 2026-08-17, naming Sarawak, Sabah, Selangor, Perlis,
  Kedah and Perak together, and the panel printed a wall of text mostly about Borneo. `hereParts()`
  splits the text on sentence and line boundaries, keeps only the parts naming somewhere this map
  covers, and rejoins them. On that row it returns a single 203-character sentence. The gate itself
  stays on the combined English and Malay text, so every row that used to survive still survives.
  Only the display narrows.
- **`floodAlerts()` has never seen a row.** `getdisse.php` answered `[]` on every fetch made during
  design. The field names come from the consumer JavaScript JPS publishes on its own page, which is
  evidence and not a guess, but nobody has tested the parser against real data yet. The first
  non-empty response is the moment to check it by hand. **It also skips a check its sibling parser
  keeps, on purpose.** `jpsMetWarnings()` drops a row where `$now < $from`, because a MET bulletin
  describes weather already underway. `floodAlerts()` does not: an `NT_7D` Early alert forecasts a
  flood up to seven days ahead, and dropping it before its own window opens hides a seven-day warning
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
- **`rainy_heavy` carries no cloud, so the map states heavy rain by color.** Rendered at 31px
  beside `rainy` it reads as hatching rather than as more of one thing. The map reads its ladder
  from `WEATHER[].pin`. The card reads its own ladder from `WEATHER[].icon`. The card keeps the
  streaks, because they read at `wxbig` size. The card also has no color ladder to carry intensity.
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
- **Weather mode never writes `PREFS.heatLayer`.** `syncHeat()` reads `PREFS.wx` as one more input
  and drops both canvases while the mode is on. So leaving the mode restores whatever heatmap the
  reader had, with nothing remembered and nothing to get wrong. Do not add a "previous layer" field.
  **`PREFS.wx` persists across a reload**, which means a reader can land on a map with no flood
  stations on it. `#shown` states `Weather map · flood stations hidden`. The Layers section summary
  reads `weather`. Those two lines are the whole of what says why, so do not delete either one.
- **Two MET points stand 80 m apart and never separate.** `Serdang` and `Seri Kembangan` measure
  16 screen pixels apart at zoom 15. So `WX_THIN_PX` keeps one of them at every zoom a reader uses.
  That is right. Two points 80 m apart report one weather. But somebody who knows both names will
  only ever find one. The layer thins rather than clusters, for the same family of reason. A
  cluster badge reading 6 cannot say WHICH weather.
## Conventions

- **Anything that alerts is checked against the alert design standard** in
  [`docs/FEATURES.md`](docs/FEATURES.md#alert-design-standard) — CAP's separate severity / urgency /
  certainty axes, ISA-18.2's "an alarm requires a response" and its 10-in-10-minutes flood
  threshold, and the cry-wolf finding that false alarms cost more trust than they buy attention.
  Four gaps are open there. Raise them when alert work comes up rather than adding a fifth surface.
- **Two of the three JPS notice feeds now reach the map, and the third became a link.** The flood
  forecast and the weather-alert mirror at
  `publicinfobanjir.water.gov.my/ramalan/{amaran-banjir,met-alert}/` are rows in the warning surface,
  through `floodAlerts()` and `jpsMetWarnings()` in `sources.php`. The media statement at
  `.../ramalan/pernyataan-media/` became one outbound link in the About dialog, because a document
  list is not an alarm. See "The JPS notice feeds join the warning surface" in `docs/FEATURES.md` for
  what shipped and why, and the alert design standard section there for how both cleared it.
  **`floodAlerts()` has never seen a row.** `getdisse.php` answered `[]` on every fetch made during
  design, so the parser ships checked against evidence, not against a real response. A parser that has
  never met one real row cannot tell a quiet feed from a moved layout. The first non-empty response
  from that endpoint is the moment to check it by hand.
- **Material Design 3 is the reference for every UI decision.** Where M3 names a component, take its
  behaviour from the spec instead of inventing one — a reader already knows the platform convention,
  and a hand-made control costs them that knowledge. The modal drawer is the worked example: both
  panels dismiss on a tap on `#scrim` or a swipe toward the edge they are anchored to, and the edge
  tab that did the job before is gone. This does **not** override the two rules below it. The colour
  language here is a status language, so M3's tonal palette never gets to paint a station kind, and
  the writing standard still governs every word on screen. Where the spec and this file disagree,
  this file wins and the disagreement is written down.
- Responsive is a standing requirement (breakpoint 600px), including touch equivalents for every
  hover-only affordance.
- **A message on screen is written for the reader, not for the system.** Four rules, and the station
  panel was swept for them twice. **Sentence case** — a capital at the front of every rendered
  string, including the small `.muted` helper lines, which were all lowercase fragments. The first
  sweep missed five, all in `popup.js`: `water is … below the gauge marker` and `water is level with
  the gauge marker` in `gaugeBlock()`, and `silent for the last …` / `last sounded …` / `sounding
  since …` in `sirenBand()`. The second sweep caught every one of them as a side effect of
  *shortening* them, which is the usual way — a line nobody has reworded is a line nobody has
  re-read. Do not trust a past sweep over a grep. **No hedging** —
  the writing standard bans "probably", and a hedge is dishonest anyway where the app has already
  acted on the judgement it is hedging about. **None of our vocabulary**: `proxy`, `cold start`,
  `as we poll`, `stuck relay`, `warning mark`, `the alert list` and `5 km` are how *we* describe the
  plumbing, and a reader wants the verdict and one fact behind it. The siren line is the model —
  `Faulty signal. No river nearby is high.` replaced a 28-word sentence that never answered whether
  there was a flood. **The precision the fact needs, and no more.** A live station's stamp needs its
  clock and not today's date. A sensor eleven months dead needs its date and neither a minute hand
  nor `· 7892.0h ago`. A graph window measured over 9.6 hours is `9 h`, because a decimal claims
  six-minute precision on a span nobody measures that finely — and it rounds **down**, since a span
  is read as ground covered and a long one claims minutes that were never in the record. A number
  already drawn on the scale 20px below is not repeated in the line above it. A distance needs no
  `away` after it, an accuracy radius no `about` before it, and `mm/h` says what `mm in an hour`
  spells. Sweeping the station panel on this one rule cut or trimmed 18 strings, and deleted
  `basin n/a` from 287 of 679 cards — a line stating a gap in the feed rather than a fact about the
  place, beside `district n/a`, which no station could ever reach. The ALL-CAPS blocks (`TRIGGERED`,
  `HEAVY RAIN`, `HAPPENING NOW`) are a deliberate visual language and are **not** messages — leave
  them.
- All user settings live in one `prefs` blob in `localStorage` (`PREFS` + `save()`).
- **`PREFS.ignored` is the only alarm-suppression control**, and it is applied *further* than the
  district filter: `isIgnored()` gates pins, heat, the alert panel, the ticker **and** the toast. The
  last two deliberately ignore the district picker; ignoring one named sensor is a request about that
  sensor, so it holds there too. Anything that suppresses an alert must keep both always-visible
  indications — the drawer's "Ignored sensors" panel (drawn even when empty) and the `· N ignored`
  count in `#shown` — and the all-clear must keep saying when a silenced sensor is itself on alert.
- **A place with several sensors is a Monitoring Station. A place with one sensor is a Monitoring
  Node, or the name of its kind** — Water level, Rainfall, Siren, Flood gauge, Camera. The word
  *mast* is gone from every rendered string: the hardware is usually a small gated shed, so the
  word described a pole that is not there. The kind names come from `KINDS[...].label` and
  `.one` in `config.js`, so a card, a chip and the glossary cannot spell one kind three ways —
  `flood-depth gauge` was the drift this rule caught, on six lines of Help against a badge reading
  `Flood gauge`. **The code still spells the concept `mast`**: `MAST` in `config.js`, `--k-mast`,
  `showMast()` / `hideMast()` / `.mastring` in `map.js`, `data-mast` in `table.js`. Renaming those
  moves no pixel and touches ten files, so they keep the old spelling on purpose. Read `mast` in
  code as *Monitoring Station*, and never print it.
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
  moment the map has to be right. **It takes the distance as a parameter, and a caller must pass the
  one its own layer paints at.** A thinning distance shorter than the paint leaves the stacking
  alive in the ring between the two — see the `radius + blur` gotcha above, which is how that
  happened.
- **A heat layer's weight is its alpha.** leaflet.heat draws each point at its weight, so a scale
  that starts at 0 draws real readings as nothing. The water layer never hit this because its floor
  is the alert slot (0.38); the rain layer's first class therefore *starts at 0.25* (`RAIN_STOPS`)
  rather than counting up from zero. Light rain is most of the rain most of the time — 10 of 233
  gauges reporting and none above 4 mm/h on the day it was built — so a scale from zero would have
  shipped an empty-looking layer. Any new heat layer needs a floor chosen the same way.
- **A control owned by a preference must not also state that state in the markup.** `#heat` carried
  a `checked` attribute while `PREFS.heatLayer` was the source of truth. `js/ui.js` writes both heat
  boxes from that pref, but it is a **deferred module**, so between parse and run the DOM held both
  boxes on — the one state the pair is not allowed to be in, since the two heatmaps are one choice.
  A browser restoring form state across a reload stacks on top of that. Neither box carries `checked`
  now. **And an invariant repaired on one path through a shared handler is repaired on none of the
  others**: the exclusivity guard read `e.target === el('heat') && …`, so it only fixed the pair when
  one of those two boxes was what changed. A pair that arrived already both-on survived every toggle
  of the two pin filters that share that handler, while `PREFS.heatLayer` saved `water` and the
  drawer went on showing both. The test moved to the pair, whoever fired the event.
  **Both of those repairs failed, because a handler is not the only writer of a checkbox.** The bug
  came back showing two answers at once: both ramps on the legend, both chips lit, and the section
  summary still naming one. `syncHeat()` re-read the boxes on every poll, and the summary was written
  from the change handler alone, so the two surfaces aged apart. Nothing in this app checked that
  box. **A browser restores form state across a reload and fires no `change`**, so a repair that
  lives in a change handler never runs on that path. **Repair an invariant where the state is read,
  not where the reader changes it.** `syncHeat()` in `js/heat.js` now reads `PREFS.heatLayer` and
  writes the two boxes, the legend, the layers and the summary from it, the way `syncRisingChip()`
  and `syncFavChip()` in `js/render.js` already re-assert their own chips every poll. The handler
  writes the pref from the box that fired and reads neither box back, so both-on is unrepresentable.
  The four preference-owned checkboxes also carry `autocomplete="off"`, which stops the browser
  writing them at all — the three text inputs already had it. **Any new control whose state a
  preference owns needs both halves**: the attribute, and a reader that writes the control from the
  preference rather than the reverse.
  **The theme control is the same rule at a second site.** It lives in `#appMenu` as `#themeRow`,
  three `<input type="radio" name="theme">` in a segmented pill, none of them carrying `checked`.
  **That pill is the lightbox range selector's shape, shared and not copied** — `.seg` and
  `.seg label` are grouped into the `.tlranges` and `.tlr` rules, so a change there restyles the
  theme picker too. The `PLAYER_OVERLAY` block is the safe half: it names `.tlranges` and `.tlr`
  alone, in literal whites for a photograph, and none of that must ever be widened to `.seg`.
  **`label` is a styled element in `css/base.css`, and it carries a margin.** `label { display: flex;
  align-items: center; gap: 8px; margin: 6px 0 }` is written for the drawer's stacked filter rows.
  It lands on every `<label>` in the app. Measured on the theme picker, that margin made the track
  37px tall around 21px pills — 6px of dead air above and below each one, inside a shape whose whole
  point is that the fill hugs the segment. The lightbox's own pills are `<button>`s and never met it.
  **Any `<label>` used as a compact control needs `margin: 0` stated**, and the symptom is spacing
  around the control rather than in it, which reads as a padding mistake on the parent. Three other
  explanations were measured first and all three were wrong: the row's own padding (symmetric at 8px),
  `align-items` on the row (already `center`), and the flex item stretching (`align-self: auto` on a
  centred row cannot stretch).
  `applyTheme()` in `map.js` returns the stored pick and `ui.js` checks the matching radio from that
  return value, which is also what corrects a browser that restored a different one.
- **The theme has three states and two of them are the same colour.** `PREFS.theme` holds the
  *pick* — `system`, `light` or `dark` — and `applyTheme()` resolves it to one of the two real
  themes. Anything that is not `light` or `dark` means system, so an absent pref needs no special
  case and `system` is the default. **`setTheme()` no longer applies anything**: it stores the pick
  and calls `applyTheme()`, which is also the `change` listener on
  `matchMedia('(prefers-color-scheme: dark)')` — the system can move the answer with nobody picking
  anything, and that listener needs no test of its own because `applyTheme()` re-reads the pref every
  time. Anything that wants to know the theme on screen reads `document.documentElement.dataset.theme`
  as before. **Never read `PREFS.theme` as if it were a theme** — on the default it is not one.
  A one-time clear in `map.js` guards `themePick`: the old two-state toggle wrote a *resolved*
  `light`/`dark` back on every load, so every stored value predating this control was the system's
  answer rather than a reader's, and honouring it would have left Auto reachable by new visitors
  alone. Do not delete that line until nobody can still be carrying a pre-Auto `prefs` blob.
- **`#appMenu` closes itself on any click inside it, in the capture phase, and a setting must opt
  out.** The handler in `ui.js` exists so a menu item's `showModal()` never runs while its opener is
  still in the top layer. That is right for the four tiles, which are destinations, and wrong for the
  theme row, which is a setting — closing the menu takes the control off screen at the moment you
  want to see what it did and try another one. The guard is `e.target.closest('.swrow')`. **Anything else
  added to that menu that is not a destination needs `.swrow` or its own exemption**, or it will
  fire once and vanish. `.swrow` also carries `grid-column: 1 / -1`, as does the `<hr>` above it:
  `#appMenu` is a two-column grid and a row that does not span both lands in a tile slot.
- **A river's sparkline draws every mark it publishes, and the axis grows to hold them.** This
  reverses the earlier rule, which drew a mark only within one *data span* of the readings so the
  readings kept half the graph's height. That rule left 89 of 105 rivers with no mark at all on a
  quiet day, and "how far is this from trouble" is the question a river graph is opened with. The
  accepted cost is that a calm river draws as a near-flat line at the foot of the graph — a true
  picture, with the trend figure beside it stating the movement in m/h. **A flood gauge keeps the
  proximity rule**: its marks are 0.15 m and 0.3 m of depth over a spot, never far from the readings,
  and its axis crosses zero where a river's does not. With no readings to be near, that filter has
  nothing to measure and every mark is drawn.
  **The caption under the graph states the readings, never the axis.** It read `lo` and `hi`, which
  are the axis — and this very rule grows the axis to hold every mark, so T.T.D.I JAYA captioned
  itself `3.42–8.30 m` over readings of 3.42 to 5.32 and named its danger mark as water that had
  arrived. **102 of 104 river graphs stated a range no reading reached.** It reads `lo0` and `hi0`
  now. This is the same rule the rain peak already carried, broken at a second site by the change
  that let the axis grow — see the peak-mark gotcha. Anything stating a graph's range reads the data.
  Two readings or it is not a range, so a graph holding one or none carries no caption.
- **A graph always draws, and no state of the station suppresses it.** `sparkline()`, `rainBars()`
  and `sirenBand()` each frame on the readings they hold, and a window needs two readings to have a
  width — so with fewer than two the clock supplies one, through the `frame` parameter on
  `timeAxis()`. With two or more nothing changed. A graph holding nothing is not an empty box: it
  draws the plate, the axis and the station's own marks, which is the scale with nothing on it.
  **The flood gauge is why.** All 36 of its stations were broken. 15 drew nothing behind a
  `history?.length` gate in `sensorBody()` and another in `table.js`. 18 hold a single sample. Even
  the 3 holding more have a data span of 0.0 h. JPS stamps a batch of them to one time.
  Three rivers and eighteen rainfall stations sat in the same state, and the siren was the whole 212.
  **A lone reading draws as a dash and never a dot.** The viewBox stretches everything inside it, so a `<circle>`
  comes out an ellipse — the same reason the rain peak mark sits in HTML over the plot. A `<rect>`
  stretches too, and it is a dash either way.
  **The two sentences are gone**: `Graph builds as readings arrive` and `No readings in the last 12
  hours`. The second was already unreachable, because the server windows `SPARK_WIN` against now and
  no delivered sample is older than it. **`rainAcc()` keeps its `!isStale(s)` gate and is not covered
  by this rule** — it draws five current totals rather than a history, and one gauge in the payload
  holds 27 mm in an hour stamped last October.
- **Rainfall is an interval quantity, not a level.** It gets `rainBars()`, never `sparkline()` — a
  line between two rain readings claims a value in between that never existed. And `hourlyRainfall`
  is a *rolling* hour, so it buckets by `RAIN_BUCKET` (1 h): finer buckets show the same rain twice.
- `history` is `[[unix seconds, value], …]` on rivers (metres), rainfall (mm/h) and gauges (metres of
  depth, negative = dry). Rivers, rainfall and gauges carry a **third element, the status that
  sample was at**, scored in `sparkPoints()` through `wlStatus()` / `rainStatus()` / `gaugeStatus()` —
  the hover readout prints a normal sample in its own ink and colours only a sample past a published
  mark, with the warning glyph on every sample that takes a colour (`TONE` in `popup.js`, and a flood
  gauge's `--s-trace` rung is the one exception). A siren carries no third element and needs none —
  its samples are 0 and 1, which *is* the status, so `TONE.siren` reads the value. **Never score a historical
  value client-side**; add a scorer in `api.php` instead. Every reader destructures `[ts, value]`, so
  a kind without one is not a special case anywhere. The graphs
  plot against the clock, not against sample index. Windowed to `SPARK_WIN` (12h) and thinned to one point per `SPARK_BUCKET` (15 min)
  server-side; `SPARK_H` in `config.js` is a **cap**, not a fixed frame — the axis spans the points
  actually held and only starts sliding once they exceed it. It must not exceed `SPARK_WIN`.
- Station cards share one template: name → region → one badge per sensor in `.pophead`, then one
  `.sensor` section per sensor, each headed by its glyph and kind. A place with one sensor draws the
  same way as a place with four. The kind is on the card twice on purpose: the badge answers what
  the place is, and the heading names the reading under it. `meter()` renders
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
const KINDS={river:{color:'B'},gauge:{color:'T'},rainfall:{color:'V'},siren:{color:'P'}};
const SOURCES={},ALERT_TITLE={},camSrc=()=>'',distKm=()=>0;
const hasInfo=()=>true,isStale=()=>false,statusColor=n=>'S'+n,scalePos=()=>0;
const levelStops=()=>null,gaugeStops=()=>null,gaugeColor=()=>'',color=()=>'',isFav=()=>false;
const nearestOf=()=>null,nearestCam=()=>null,nearestLevel=()=>null,camAlert=()=>null;\`;
const M = new Function(stubs+noSec+src+
  '; return { stamp, spanText, sirenBand, sparkline, rainBars };')();
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
is(/3.42–5.32 m/.test(r2),true,'spark: the caption states the READINGS');
is(/8.30/.test(r2.match(/class=\"muted\">[^<]*/)[0]),false,'spark: and never the axis, which holds the marks');
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
  const c=h.match(/([\d.-]+)–([\d.-]+) m over/);
  if(c && s.history?.length>1){ const v=s.history.map(r=>r[1]);
    if(Math.abs(+c[1]-Math.min(...v))>0.005||Math.abs(+c[2]-Math.max(...v))>0.005){ capBad++;
      console.log('  CAPTION STATES THE AXIS',s.id,c[0]); } } }
console.log('every station drew a graph:',drew,' threw:',threw,' bad markup:',faults,' bad captions:',capBad);
bad += threw + faults + capBad;
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

php shots-test.php            # one of five runnable checks. Guards camera retention. Must stay green.
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

# Every module must carry a modulepreload link, except the six loaded on demand. There is no build
# step to generate that list, so it goes stale silently when somebody adds a module.
for f in js/*.js; do
  case $(basename $f) in timeline.js|table.js|wall.js|test.js|clip.js|wx.js) continue;; esac
  grep -q "modulepreload\" href=\"$f\"" index.html || echo "MISSING modulepreload: $f"
done
```

There is otherwise no test suite. Changes are verified by linting, syntax-checking the modules,
querying `.cache.json` for the data shape being relied on, and looking at the page.

`shots-test.php`, `php api.php --selftest`, `heat-test.html`, `title-test.html` and
`narrow-test.html` are the five runnable checks here, and each guards a different risk.

`shots-test.php` is deliberately narrow: retention is the only rule in this repo that can *quietly
destroy* data. Everything else either works or visibly does not, but a prune that buckets a frame
wrongly deletes months of camera history and looks identical to one that worked — and because it
runs on every capture, a rule that shaves one extra frame per pass empties the archive over a week
without ever being wrong in a single run. Hence the idempotence assertion.

`api.php --selftest` guards the decisions that gate a request to an upstream — JPS **or** Nominatim,
now that `?place=` reaches a second one. `forceAllowed()`'s rate limit and `serveFromCache()`'s
cache-or-rebuild choice are the original two, both arithmetic on a few integers so the check runs
offline in milliseconds rather than through a 270-request fan-out. The place lookup added its own
block of the same shape: `placeQuery()`'s validation (length, whitespace collapse, the invalid-UTF-8
case with no PHP notice), `placeParam()`'s array-cast guard (see the gotcha above), and
`forceAllowed()` reused at `PLACE_EVERY`'s window for the per-second Nominatim limit — fifteen
assertions in all, half the check's total, and all offline for the same reason: no test here should
cost a real request to either upstream.

`heat-test.html` guards the one part of this app that lives in canvas pixels. The rain heat layer
paints a distance and then erases what a gauge reporting no rain denies. Neither rule is visible to
`php -l`, to `node --check`, or to any query over `.cache.json`. Both are wrong only on screen.
It needs a browser, so it runs headless and prints its own verdict rather than a picture. It earned
its place immediately. Six faults survived the code review that wrote the layer, and the check and
its probes found all six: simpleheat's leaked `globalAlpha`, an eraser reaching across a wet gauge
and restating its rainfall as a lighter class, a brush that peaked where no pixel sits, a paint
falloff that drew four rain classes out of one reading, `heatScale()` sizing a layer the map had
already dropped, and a gradient filled as a square erasing its neighbour's blob. Two of the six had
shipped for months and no amount of reading found either. Anything else added to a canvas here needs the same treatment. A canvas
is where reading the code stops working.

**A seventh fault got past it, and how it did is the lesson.** `cov` took the max of the blend
weights and drew a Voronoi border on every equidistant line. The check held two assertions over
overlapping gauges and both passed. Both probe two gauges exactly one radius apart, which is the one
spacing where a max behaves. A reader found it on screen instead. **`thinHeat()` guarantees one
radius and nothing more, so one radius is the best case and never the typical one.** The assertions
added after it probe at 1.48 and 1.60 radii, which the spacing sweep takes off the station geometry.
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
copy of a constant reports on the number it remembers and not on the number the app uses.

**Assert the property, not the scenario, and two attempts here show why.** A `showModal()` call from
the check asserts a call the check made. It passes against an app put back to a plain `show()`.
Narrowing a live iframe reaches the call the app makes. That needs a layout, and headless virtual
time supplies no reliable clock to wait on.

Focus is the property. A modal dialog makes the page behind it inert, and a modal dialog is in the
top layer by definition.
