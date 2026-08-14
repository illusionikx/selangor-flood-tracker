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
| `api.php` | server-side proxy + cache + source merge + poll history + camera image proxy + rate-limited `?force=1` + place lookup (`?place=`, proxies Nominatim) |
| `sources.php` | scrapers for the two HTML-only upstreams (national portal, JPS WP) and the three MET feeds (nowcast, forecast, warning) |
| `shots.php` | camera archive: capture, retention tiers, lookup, and the on-request strip (`buildSheet()`) the wall and the clip play. Required by `api.php` |
| `shots-test.php` | `php shots-test.php` — one of two runnable checks. Guards retention. Exercises `pruneShots()` |
| `index.html` | markup only — no inline CSS or JS |
| `css/icons.css` | every icon, as an SVG mask. Generated — see docs/FEATURES.md for the fetch |
| `css/base.css` | tokens, reset, controls, blocks shared by popup + alert panel |
| `css/chrome.css` | page furniture: app bar, status dot, drawer, legend, splash |
| `css/map.css` | Leaflet overrides, pins, cluster badges, popup template |
| `js/app.js` | entry point — decides what happens on landing, nothing else |
| `js/config.js` | constants (kinds, palettes, thresholds, tile styles, `WEATHER`). Also `NOTICE`, the words for an upstream outage. No imports. |
| `js/state.js` | `state` (data + hereAt) and the `PREFS` blob. Breaks module cycles. |
| `js/util.js` | pure helpers + `hasInfo()` / `color()` / `isIgnored()` |
| `js/stations.js` | queries over the station set (`nearestOf`, `nearestCam`, `byId`) |
| `js/map.js` | map instance, basemap/theme, cluster, the station panel (`openSide`), `focusOn` / `flashTo` |
| `js/heat.js` | both heat layers (water level, rainfall), ground-fixed sizing per layer, shared opacity |
| `js/popup.js` | popup + meter + gauge + sparkline templates |
| `js/sparktip.js` | the hover/tap readout on every graph, and the label on any `data-tip`. One delegated listener, no imports |
| `js/render.js` | rebuilds markers and heat points; drawer summary table |
| `js/alerts.js` | "On alert": the app bar's warning glyph, the list it opens in `#side`, the icon badge, the red favicon, and the MET warning cards above that list |
| `js/table.js` | the all-stations table dialog, grouped district → mast → sensor |
| `js/locate.js` | geolocation and the "You are here" marker |
| `js/ticker.js` | header alert marquee — measured, seamless, speed scales with the alert count, and draws the MET warning tiles into the strip |
| `js/timeline.js` | camera archive replay + A/B compare, inside the lightbox and nowhere else |
| `js/clip.js` | the station panel's 3-hour camera clip — no controls, that is the lightbox's job |
| `js/toast.js` | desktop-only "new alert since last poll" toast |
| `js/test.js` | test mode: fakes a flood in the client's copy of the payload |
| `js/lazy.js` | `lazy()` — loads a deferred module and drives `aria-busy` for its skeleton |
| `js/net.js` | `load()` poll loop and the status dot on the logo |
| `js/ui.js` | all DOM wiring: drawer, filters, chips, panels, lightbox, delegated jumps |
| `js/wall.js` | the camera wall: every camera on one page, one timer for all of them |
| `manifest.json` | PWA manifest. `.json`, not `.webmanifest` — see the gotcha below |
| `sw.js` | service worker: network-first shell cache, and the reason Chrome offers "Install app" |
| `icon.svg` | the app mark: bare glyph, no fill. Source for the PNGs *and* the `--i-flood` mask |
| `icon-build.php` | `php icon-build.php` — rebakes the two icons and prints the mask rule to paste |
| `water-build.php` | `php water-build.php` — rebakes `water.json` from OpenStreetMap. Run by hand, never in a request |
| `water.json` | the water the dark basemap will not draw: 2,775 rivers + 3,860 ponds, baked and committed |
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
Only these three carry water. The other three hosts in the table below are not flood-data sources.
Nominatim answers `?place=` and joins nothing at all. The two MET hosts join a station by nearest
point and by district name, and they never touch a reading. See the `## api.php` section below.

| source | gives | shape |
|---|---|---|
| `infobanjirjps.selangor.gov.my/JPSAPI/api/` | Selangor: everything, incl. the only cameras, sirens and gauges | JSON |
| `publicinfobanjir.water.gov.my` | national water levels + thresholds; **authoritative reading** | HTML table |
| `infobanjirjpskl.water.gov.my` (SPHTN) | KL + Putrajaya water level and rainfall | HTML table |
| `met.gov.my/nowcasting` | rain now and every 30 min to +3 h, 294 points | HTML with baked-in JS |
| `api.data.gov.my/weather/forecast` | daily lowest and highest temperature, by district | JSON |
| `api.data.gov.my/weather/warning` | warnings from MET, with a validity window | JSON |

MET Malaysia adds three more feeds, all weather rather than water. They join no water reading and
override no station.

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

Rainfall exists on the portal but its table is loaded through
`wp-content/themes/shapely/agency/searchresultrainfall.php`, which returns headers and no rows for
every parameter combination tried. Not wired up; rainfall comes from the other two feeds.

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
  the two feeds share no station codes) → national override by code → trend pass over the winner.
- Every station carries `source` (`selangor` / `kl` / `national`) and, where known, `code`.
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
  it. 1 hour, 3 hours and today come off the feed. 24 and 72 hours go through `accWindow()`, which
  subtracts two `cumulativeRainfall` samples. Those live in the `level` table under a `#c` suffix,
  so there is no schema change and `RETAIN` prunes them with the rest.
  `ACC_READ` (80 h) is their own load window, because `READ` is 24 h and too short. KL publishes no 3-hour total, so those 37 stations use
  `accHours()`, which refuses to answer unless every clock hour in the window has a reading.
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

## Colour language — do not violate

- **Station type** never uses a traffic-light hue: river blue, rainfall violet, siren pink, gauge
  taupe, camera cyan, mast indigo. Tokens `--k-*`.
- **Status only**: green → amber → orange → red (`--s-normal` / `--s-alert` / `--s-warning` /
  `--s-danger`, exposed as `STATUS_COLOR`), plus grey `--s-none` for offline / no reading.
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
  claiming 24. Four things return `null` rather than a number: an empty series, no sample at or
  before the far end, a backwards odometer (the 1 January reset), and both ends on one sample.
  `accHours()` is the KL fallback and obeys the same rule from the other side — all three clock
  hours or nothing, because a short sum reads as light rain. **The `#c` series began 2026-08-13 and nothing
  can fill it in**, because no earlier poll stored `cumulativeRainfall`. Both long windows published
  `null` everywhere for the first day.
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
- **`session.auto_start` serializes every request from one browser.** The file session handler
  holds an exclusive lock on the session file for the whole request. Every request that carries
  the same `PHPSESSID` therefore waits behind the one before it. Six concurrent camera stills
  measured a staircase: 1.9, 3.0, 4.3, 5.4, 6.1 and 6.9 seconds. The same six requests with no
  shared cookie finished together in 3.4 seconds. `api.php` calls `session_write_close()` on its
  first statement, right after the two `require_once` lines, because nothing in this app reads
  `$_SESSION`. The lock protects nothing. Do not move that release later in the file. Code added
  above it runs inside the lock again.
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
  as live.
- **41 sirens last reported months ago** (one in July 2025). They render `OUT OF CONTACT`, never
  `IDLE` — a silent siren and a dead siren look identical, and only one is safe.
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
  no time at all. Elapsed time is appended only when the station is offline or stale, because on a
  live one the date is the answer and `· 4m ago` is padding. Seconds are trimmed for display by
  `noSec()`; the underlying string stays verbatim, so `parseMY()` is unaffected. **The glyph names
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
  bug `thinHeat()` exists to prevent, moved out one ring. The split is now `wide / (1 + BLUR)` and
  `r * BLUR` off one `BLUR` constant, so the sum is right by construction. `HEAT_MAX_PX` also starts
  bounding what it names: the sprite used to be 1.8× the cap.
- **`HEAT_KM` is 5 km and `RAIN_KM` is 4 km, and rain must never borrow the water number again.**
  5 km is a catchment claim, which is fair for a river level. Rain reached for it because it was
  there. The payload can settle it: take the 211 rainfall stations that carry history, every pair
  of them and every 15-minute bucket where one of the pair was wet, and ask how often the other was
  wet too. It runs 24% out to 4 km, halves to 13% by 6 km, and is back to the 4–6% background rate
  by 12 km. So a rain reading carries about 4 km of information. `MET_KM` in `api.php` states the
  same rule from the other end — a claim about the next three hours reaches much further than a
  claim about this moment, and `hourly` is the last rolling hour. **A layer's paint distance and its
  `thinHeat()` distance are one number**, passed to both from `config.js`. Rain still covers ground
  where no gauge reports rain, and that is weather rather than a defect: even inside 4 km, three
  quarters of a wet gauge's neighbours are dry. Do not chase that figure to zero with a smaller
  radius — below the distance a reading informs, the layer is 233 dots. Do not chase it with
  interpolation either. This app draws readings, not a modelled field. See `docs/FEATURES.md`,
  *The rainfall heatmap claimed rain over 250 km² from one gauge*.
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
## Conventions

- **Anything that alerts is checked against the alert design standard** in
  [`docs/FEATURES.md`](docs/FEATURES.md#alert-design-standard) — CAP's separate severity / urgency /
  certainty axes, ISA-18.2's "an alarm requires a response" and its 10-in-10-minutes flood
  threshold, and the cry-wolf finding that false alarms cost more trust than they buy attention.
  Four gaps are open there; raise them when alert work comes up rather than adding a fifth surface.
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
- **A message on screen is written for the reader, not for the system.** Three rules, and the whole
  UI was swept for them once. **Sentence case** — a capital at the front of every rendered string,
  including the small `.muted` helper lines, which were all lowercase fragments. **No hedging** —
  the writing standard bans "probably", and a hedge is dishonest anyway where the app has already
  acted on the judgement it is hedging about. **None of our vocabulary**: `proxy`, `cold start`,
  `as we poll`, `stuck relay`, `warning mark`, `the alert list` and `5 km` are how *we* describe the
  plumbing, and a reader wants the verdict and one fact behind it. The siren line is the model —
  `Faulty signal. No river nearby is high.` replaced a 28-word sentence that never answered whether
  there was a flood. The ALL-CAPS blocks (`TRIGGERED`, `HEAVY RAIN`, `HAPPENING NOW`) are a
  deliberate visual language and are **not** messages — leave them.
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
  and its axis crosses zero where a river's does not.
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

php shots-test.php            # one of two runnable checks. Guards camera retention. Must stay green.
php api.php --selftest       # the other. Guards the force-refresh rate limit, cache choice, and the
                              # place-lookup validator/rate limit. Must stay green.
curl -sk "https://flood-exp.test/api.php?shots=1"                          # frame timestamps

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

# How much ground the rainfall heat layer claims, and how much of it holds a gauge reporting no
# rain. This is the sweep that found the 1.8x paint bug: the wash covered 2,036 km2 and 82% of the
# gauges under it were dry. RAIN_KM is read out of config.js, never copied here. Read the second
# figure as a trend, not a pass mark — rain is patchy and it will never reach zero. A jump back
# toward 80%, or an area far above 500 km2 on a dozen wet gauges, means a blob outgrew its number.
php -r '$p=json_decode(file_get_contents(".cache.json"),true);
preg_match("/RAIN_KM\s*=\s*([\d.]+)/",file_get_contents("js/config.js"),$m);$r=(float)$m[1];
$km=fn($a,$b)=>hypot($a["lat"]-$b["lat"],($a["lng"]-$b["lng"])*cos(deg2rad($a["lat"])))*111;
$all=array_values(array_filter($p["stations"],fn($s)=>$s["kind"]==="rainfall"&&$s["lat"]));
$wet=array_values(array_filter($all,fn($s)=>($s["hourly"]??0)>0));
usort($wet,fn($a,$b)=>$b["hourly"]<=>$a["hourly"]);
$k=[];foreach($wet as $s){foreach($k as $x) if($km($x,$s)<$r) continue 2; $k[]=$s;}
$cov=0;$dry=0;foreach($all as $s){foreach($k as $x) if($km($x,$s)<=$r){$cov++;if(($s["hourly"]??0)<=0)$dry++;break;}}
printf("%d wet gauges -> %d blobs, %.0f km2, %d gauges covered, %d dry (%d%%)\n",
count($wet),count($k),count($k)*M_PI*$r*$r,$cov,$dry,$cov?round(100*$dry/$cov):0);'

# Which warnings survive the geography filter, and how many the feed offered.
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
foreach($p["warnings"] as $w) echo substr($w["title"],0,70),"\n";'

# Every module must carry a modulepreload link, except the five loaded on demand. There is no build
# step to generate that list, so it goes stale silently when somebody adds a module.
for f in js/*.js; do
  case $(basename $f) in timeline.js|table.js|wall.js|test.js|clip.js) continue;; esac
  grep -q "modulepreload\" href=\"$f\"" index.html || echo "MISSING modulepreload: $f"
done
```

There is otherwise no test suite. Changes are verified by linting, syntax-checking the modules,
querying `.cache.json` for the data shape being relied on, and looking at the page.

`shots-test.php` and `php api.php --selftest` are the two runnable checks here, and each guards a
different risk.

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
