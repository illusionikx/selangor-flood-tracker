# Features & context

Running record of what exists and *why*. Append here when a feature lands; keep the reasoning,
not just the description — the reasoning is what isn't in the code.

Conventions and gotchas live in [../CLAUDE.md](../CLAUDE.md); this file is the feature inventory.

---

## Data pipeline

**Proxy + cache** (`api.php`) — JPS serves no CORS headers, so the browser can't call it directly.
5-minute file cache. On upstream failure it serves the last good payload flagged
`upstreamOk: false` rather than a blank map.

**Detail fan-out** — list endpoints carry coordinates and status codes but no readings, so
rainfall / river / gauge / camera details are fetched per station via `curl_multi` (~270 requests,
~3s cold). This is the only way to get water level, rainfall mm, flood depth and image URLs.

**Derived trend — rate of rise** — upstream publishes no trend, and JPS defines none (its bulletins
only say "upward/downward trend"). The hydrological standard is a *rate*, dH/dt in metres per hour,
so that is what `api.php` computes: `rate` = (level now − baseline) / hours, where the baseline is
the retained sample nearest an hour old. Samples live in `.history.db` and also feed the sparklines.
Fresh installs show no rate until an hour of history exists.

*Why not "latest − oldest":* polls are irregular — the cache only refreshes when someone loads the
page, so `.history.json` routinely has multi-hour gaps. The old figure was "level now minus level at
some unspecified point up to a day ago", which is not comparable between stations and drifts with
traffic. Normalising per hour makes 0.4 m/h mean the same thing everywhere.

*`rising` is a forecast, not a rate.* A station is flagged when, at the rate it is climbing now, it
would reach **its own danger mark within 3 hours** (`eta ≤ RISE_ETA`). A fixed m/h cannot do that
job: 0.2 m/h is a quiet afternoon on a big river 4 m below danger and an emergency on a drain 30 cm
below it. Every one of the 107 river stations publishes a danger mark, so this needs no fallback.

Three guards sit under it. `rate ≥ RISE_FLOOR` (0.1 m/h), because levels are reported to the
centimetre and over the shortest baseline we accept (20 min) a single 1 cm tick is already
0.03 m/h — under 0.1 is rounding, not a climb. The three most recent samples must not dip, which
rejects one bad reading spiking the rate; non-decreasing rather than strictly increasing, because
JPS refreshes slower than we poll and repeated identical readings must not cancel a real climb. And
the baseline window is bounded — younger than 20 min or older than 3 h is refused, leaving `rate`
`null`, which renders as "no trend" rather than a confident zero.

*Why it changed.* The old bar was `rate ≥ 0.05 m/h`. Measured against our own samples in calm
weather that sat on the **p90 of ordinary fluctuation** — 10.5% of station-hours over it, tripping
on as little as 3 cm of movement. On the poll where this was replaced it flagged 10 stations against
the new rule's 1; the 9 it dropped included one climbing at 0.100 m/h but **32 hours** from its
danger mark. There is no published standard to copy — NWS defines rapid onset by *flow* (+100% in an
hour), not by stage rate — so the bar is set from our own distribution and from what an alert is
for.

*`eta` is published whenever a station is climbing at all, flagged or not,* and shown in the popup
and alert panel (`Reaches danger · in ~1.0 h`). The flag is a cutoff on that number, and a cutoff
nobody can see the other side of is just an assertion — "not rising" should be readable as "still
nine hours away", not taken on trust. It is deliberately coarse past six hours: a straight-line
projection off an hour of samples is a rough signal and "in 7.3 h" would imply a forecast it has no
right to.

*Dropped with it:* the SPHTN trend arrow as a cold-start stand-in. `rising` is now a claim about
reaching a danger mark within hours, and a bare direction arrow is no evidence for that.

*Trade-off accepted:* one definition lives in `api.php` and the client just reads `s.rising`. The
map filter, alert panel, drawer table and heat weighting can no longer disagree about what rising
means — but changing the rule needs a server edit and a cache expiry, not a config constant.

*The "Rising stations only" chip disables itself when nothing qualifies*, and says which kind of
nothing: `none climbing`, or `needs an hour of history` when `rate` is null everywhere. A filter
that can legitimately match zero stations is a trap — the map empties, and an empty flood map reads
either as a broken app or, worse, as "nothing is happening". This surfaced the hard way: the
history db was deleted during testing, every `rising` flag went false, and a persisted tick in
`localStorage` blanked the map with no explanation. The filter now cannot fail silently, whatever
the reason the count is zero.

**Sparkline on a time axis** — the graph plots level against the clock, over the readings actually
held, capped at 12 hours. Ticks land on round clock times with the range beneath
(`1.74–1.82 m over 3.0 h`).

*Why it changed:* it used to plot against sample *index*, which lied whenever polling was uneven —
and it always is, because the cache only refreshes when someone loads the page. Six hours of steady
readings and a six-hour gap with a reading either side drew the identical flat line. Against a real
axis, a gap looks like a gap.

*Twelve hours is a cap, not a frame.* The axis spans what exists — two hours of history draws as two
labelled hours across the full width, not a sliver at the edge of a mostly empty 12-hour box. Only
once history exceeds 12 hours does the window start sliding.

*Tick spacing adapts* through 15m · 30m · 1h · 2h · 3h, coarsening until about five fit. Every step
divides an hour, so ticks land on `:00`, `:15` or `:30` rather than at arbitrary offsets from the
first reading — measured: 45 min of data ticks every 15 min, 3 h hourly, 11 h every 3 h.

*Hours are Malaysian, not the viewer's.* JPS stamps readings in MYT with no offset and the app
prints those verbatim, so the axis is formatted with `timeZone: 'Asia/Kuala_Lumpur'` via `Intl`.
Reading the map from another timezone must never put `14:00` on the axis beside a reading stamped
`06:00`. Everything on the page is 24-hour, matching the source data.

*Labels are HTML, not `<text>`.* The SVG stretches (`preserveAspectRatio="none"`) so the polyline can
work in a 0–100 coordinate space at any width; text inside that viewBox would be stretched with it.

*Payload cost:* `history` is now `[ts, level]` pairs rather than bare numbers, but it is windowed to
12h and thinned server-side to one point per 15 minutes — at most 48 points per station. Measured
9 KB of a 220 KB payload. Averaging within a bucket was rejected in favour of keeping the newest
sample: this is a level graph, and an average smooths away exactly the short sharp rise it exists
to show.

**Rainfall history, as bars** — rainfall popups now carry their own graph over the same window.
Rain now is the river's rise in an hour, so of the two graphs this is the earlier signal; the river
sparkline shows the consequence. 232 of 233 rainfall stations record history (the odd one out
reports `null`, and a station with no reading gets no invented one).

*Bars, not a line — and this is not a style choice.* A line between two readings claims the values
in between. For a water level that claim is true: it really was somewhere between 1.74 m and 1.82 m.
For rainfall it is false: 5 mm at 13:00 and 0 mm at 14:00 does not mean 2.5 mm fell at 13:30. Rain
is an amount collected over a period, so each period gets a bar and nothing is claimed between them.

*One bar per clock hour.* `hourlyRainfall` is a **rolling** one-hour total, so two samples fifteen
minutes apart describe overlapping windows — plotted as separate periods they would show the same
rain two, three, four times over. The server buckets rainfall by `RAIN_BUCKET` (1 h) rather than the
15-minute bucket used for levels, for exactly that reason.

*An hour with no reading leaves a gap*, because bars are anchored to their own hour rather than laid
out end to end. Missing is not the same as dry. And when every bar in the window is zero, the graph
is replaced by the sentence `no rain in the last 5.0 h` — a row of flat bars states it worse.

*Shared axis machinery.* `timeAxis()` computes the window and the round-clock ticks once for both
graphs, so the level line and the rain bars cannot drift apart on window, tick spacing or timezone.

**All stations as a table** (`list_alt` in the app bar) — every mast under its district, each with a
badge and a reading per sensor. The map answers "what is happening near here"; this answers "what is
there", which is a different question and a bad fit for pins — you cannot scan 435 pins, and a mast
holding six sensors shows one. Grouping matches the map exactly, so moving between them doesn't
re-teach you the shape of the data. Clicking a row closes the dialog and flies to the mast.

*Deliberately not filtered by the drawer.* This is "show me everything"; a table that quietly
omitted the districts you switched off on the map would be the same trap as the silently-empty map.
Its search box is the only filter, and what that hides, it hides in front of you.

*It is also the only place the unmappable stations appear.* 11 cameras are published by JPS with
zero coordinates, so the map has always dropped them silently — 446 rows against 435 pins. They get
a row marked `not on the map · no coordinates` and, deliberately, no `data-mast`, so they offer no
jump. A clickable row for a station at 0°, 0° would fly the map into the Atlantic.

*The icon for it is what finally killed the icon font* — see below.

*`leads()` moved to `util.js`.* The table needs the same sensor ordering as the map, and having a
view import another view would have put `render.js → table.js → render.js` in the graph. Both now
import it from `util.js`, and the acyclic rule holds — checked by walking the import graph.

**Icons are SVG masks, not an icon font** (`css/icons.css`) — same icon set as before, Material
Symbols Outlined (Apache 2.0). What changed is delivery, because the font *was* the bug.

*The failure mode, three times over.* A ligature icon font renders **text**. `<i>list_alt</i>` only
becomes a picture if font shaping cooperates; when it doesn't, the raw word appears — `LIST_ALT`
across the app bar. Each occurrence had a different trigger — a parent's `text-transform`, a glyph
missing from the subset, a stale cached subset — and each was patched individually, because each
looked like a different bug. They were one bug: the icon was text, and text has many ways to escape.

*A mask cannot fail that way.* There is no text to transform and no ligature to match. The icon is
a vector painted in `currentColor` and sized in `em`, so it inherits colour and size exactly as the
font did. If a name is wrong, nothing paints — a missing icon can no longer render as a readable
English word in the middle of the UI.

*What this deleted:* `vendor/symbols.woff2`, its `@font-face`, the `icon_names=` refetch procedure,
the two-file `?v=` bump on every icon addition, and the `text-transform: none; letter-spacing:
normal` resets scattered across `.badge i`, `.link i` and `.glyph`. Adding an icon is now one rule.

*Why not the Material icon library as a dependency?* It is the same set either way — this **is**
Material Symbols. Delivered as a font it keeps the exact failure mode above; via CDN it breaks the
project's no-CDN rule (the reason everything is vendored); via npm it needs a build step the project
doesn't have. The full font would fix "glyph missing from subset" and none of the other triggers,
at ~300 KB against 10 KB of CSS.

*Trade-off accepted:* 10 KB of CSS versus a 3.5 KB font file, and the paths are generated rather
than hand-written — regenerate with the script recorded in this file's history if the set changes.
In exchange there is no second network request, no FOUT, and no cache-busting dance.

*Found while doing it:* Herd answers a **missing** file with `index.html` and HTTP 200. Every
"all assets return 200" check in this project was therefore weaker than it looked — a typo'd path
would have passed it. The verify snippet in CLAUDE.md now checks `content_type`.

**One mast, one pin** — a rainfall gauge, a river gauge, a siren and a camera on the same pole are
published as four separate stations at one coordinate. Four pins stacked on each other made one
place look like four, and clicking any of them told you a quarter of the story. `api.php` groups
stations within `SITE_M` into a `site`, and the map draws one pin per site with one popup: the place
named once, then a section per sensor. 669 mappable stations become 434 pins.

*25 m, measured.* Grouping at 0 m merges 113 sites — but another 46 pairs sit a few metres apart
because two feeds typed the same mast slightly differently, and exact-match misses all of them. The
count rises to 161 by 25 m and then barely moves until 200 m, where it starts swallowing genuinely
separate installations. 25 m is that knee. Largest real site holds six sensors: rainfall, river,
three sirens and a camera at Batu 15, Hulu Langat.

*Filter first, group second.* A site is built from the sensors still showing on it, so switching
rainfall off on a mast that also carries a river gauge leaves the river pin exactly where it was.
The alternative — group first, then hide by the lead sensor's kind — would take a whole place off
the map because the sensor that happened to lead it was switched off. This is why a layer chip now
triggers a full `render()` rather than just `syncCluster()`: which sensor leads a shared mast, and
what its popup holds, both depend on what is switched on.

*The lead sensor is ranked by trouble, then by kind*: anything critical, then anything rising, then
`river > siren > gauge > rainfall > camera`. A sounding siren takes the pin from a rising river on
the same mast, because that is the thing worth seeing from across the map.

*Counts stayed per station, not per pin.* A layer chip controls stations, so a mast holding three
sirens must read `3`, not `1`. `state.perKind` carries the filtered tally and the drawer adds a
`· N pins` note when pins and stations diverge.

*Marker lookup moved to a site index.* A river gauge's pin may now be filed under `siren` if a
sounding siren shares its mast, so `flashTo` can no longer search its own kind's bucket — `siteMark`
maps site key to marker. That also collapsed the old three-way "target might be missing" handling in
`flashTo` into one path: pin it and re-render, which outranks every filter including the layer.

**Level history in sqlite** (`.history.db`) — one table, `level(station, ts, level)`, primary key
`(station, ts)`, `WITHOUT ROWID`. Each poll loads the last 24 hours, writes one row per river
station, and prunes past 30 days. `pdo_sqlite` ships with PHP, so this is still a zero-dependency,
no-build project.

*Why it replaced `.history.json`:* the flat file was a 24-sample ring buffer — a couple of hours,
rewritten whole on every poll. Two things pushed it over. History that outlives the trend window is
worth having (level this time last week, post-mortems after a flood), and 85 MB of JSON re-parsed
per request is not a way to have it. And the flat file had a read-modify-write race: it was read at
the top of the request and written at the bottom, with `LOCK_EX` covering only the write, so two
concurrent cold refreshes silently dropped a sample. The primary key makes an inserted sample
idempotent and WAL mode makes concurrent polls safe, so the race is gone rather than narrowed.

*Trade-off accepted:* a schema to migrate if the shape ever changes, and a binary file where a
readable one used to be (`sqlite3 .history.db` or a one-line PDO query, rather than `cat`). The
payload cache deliberately stays a flat file — it is a single blob, always read and written whole,
with nothing to query.

*Migration:* a one-off block imports `.history.json` if present and unlinks it, so trends survive
the switch instead of going null for an hour. It deletes itself; remove the block once no
deployment still has that file.

**Three sources, merged** (`sources.php`) — the map now covers Kuala Lumpur and Putrajaya as well as
Selangor, because no single JPS feed covers all of it:

- **JPS Selangor API** — Selangor stations, and the only source for cameras, sirens and gauges.
- **Public Infobanjir** (national JPS) — water levels and thresholds for the whole country.
- **JPS Wilayah Persekutuan / SPHTN** — KL and Putrajaya water level and rainfall.

They join on the national station code. Priority for a *reading* is national first, then whichever
feed placed the pin; coordinates can only come from Selangor or WP, because the national portal
publishes none.

*What the measurements said before choosing:* for the 48 Selangor stations all three carry, values
and thresholds agree, but the national portal is **never fresher** — median 0, up to 15 min behind
Selangor and a consistent 30 min behind KL. It also lists 69 Selangor stations against the state
API's 81. So national-first is a deliberate trade of freshness for consistency with the official
national figure, made with the numbers on the table rather than assumed.

*Stations only the national portal knows* (~20 Selangor, ~15 KL) have no coordinates from any
source and are dropped. The count is reported in the payload rather than swallowed. Geocoding them
by name was rejected: a pin in the wrong place is worse than no pin during a flood.

*De-duplication is by position, not by key* — the KL and Selangor feeds share **zero** station
codes even where they describe the same mast, so a KL station within ~200 m of a station we already
have is treated as the same one and skipped.

*Status is re-derived when the national reading wins.* That feed publishes values, not status
codes; keeping the state feed's code next to the portal's level would let the colour and the number
contradict each other.

*Not built:* national rainfall. Its table loads through `searchresultrainfall.php`, which returned
headers and no rows for every parameter combination tried. Rainfall comes from the other two feeds.
Also skipped: KL sirens (ragged column counts, and the state cell is the one that goes missing) and
KL cameras (the district route returns an empty fragment).

**Scraping, and how it fails** — neither new source publishes JSON, so `sources.php` parses their
HTML with `symfony/dom-crawler` (CSS selectors, plus `masterminds/html5` for a browser-grade parse
of markup neither portal validates). That is fragile by nature, so the failure modes are designed
rather than discovered:

- The national tables label every cell with `data-th`, so columns are read **by attribute**. An
  inserted column can't silently shift every reading one place left.
- The KL tables have no such labels, so columns are read by position but **guarded on row width**.
  A layout change drops the rows instead of writing rainfall into the water-level column.
- Both fail to *nothing*, never to garbage — and the payload's `sources` counters expose it, so a
  broken scrape shows up in the status chip as `parsed: 0` rather than as a quiet region of the map
  going dark.
- Both use `-9999` for "no reading", rendered `-9,999.00` in one of them.

*Why a library, and why this one.* The parser was originally hand-written on PHP's built-in
`DOMDocument`/`DOMXPath`, and the alternatives were weighed against it:

- **Firecrawl** was rejected on capability, not weight. It converts pages to LLM-ready markdown,
  which discards the two things this parse depends on — the `data-th` attributes that let columns be
  read by name, and the `onclick="loadMapPage(lat, lng…)"` that is the *only* source of KL
  coordinates. It also puts a paid third party in front of flood data, to render JavaScript these
  server-rendered pages don't use.
- **Scrapy** solves crawling at scale — frontiers, autothrottle, retry middleware, item pipelines.
  This fetches 5 fixed URLs every 15 minutes. It would have meant a second runtime and a scheduler
  beside a PHP app, for machinery that would sit idle.
- **symfony/dom-crawler** is the same libxml engine underneath, so nothing about the parse changed
  in capability — CSS selectors simply read better than XPath, and `masterminds/html5` parses
  malformed markup the way a browser does rather than the way libxml guesses.

*Trade-off accepted:* the project gained its first server-side dependency and a `composer install`
step. It is contained: Composer's vendor dir is `lib/`, since `vendor/` holds hand-managed browser
assets Composer must never touch, and the front end stays build-free. Verified identical output
before and after the switch — 104 national rows, 66 KL rows, same coordinates and thresholds.

*Still outstanding:* `lib/` sits inside the document root because Herd serves the project directory
whole. Nothing in it executes meaningfully on a GET, but a stricter deployment should move it out or
deny it at the server.

**Separate cache for scraped pages** — the KL rainfall table takes ~10s to render upstream, against
~0.3s for a JSON call, which turned a 3.5s cold poll into 15s. The scraped pages now live in a
`page` table in `.history.db` on a 15-minute clock, so most refreshes skip them entirely and a
failed fetch falls back to the last stored copy — a slow upstream should cost freshness, never a
whole region's worth of pins.

*Trade-off accepted:* one visitor per quarter hour still waits ~15s. The proper fix is
stale-while-revalidate, which needs `fastcgi_finish_request` — unavailable under Herd's `cgi-fcgi`
SAPI. A cron hitting `api.php` every 5 minutes would remove the problem entirely without any code.

**Sirens report when they last checked in** — the siren *list* carries no timestamp at all, so until
now a siren was whatever `stationStatus` said, forever, with no way to tell a working silent siren
from one that fell off the network. The detail endpoint does carry `statusLastUpdate`, so all 212
are now fetched for that one field. A siren stamped older than 48 h is forced offline: they
heartbeat daily (most stamp 08:00), so two missed days is out of contact, not idle — and `IDLE` on
a dead siren is the most dangerous thing this map could print. A siren with no timestamp at all is
left alone; that is missing evidence, not evidence of failure.

*Measured afterwards: the 48 h rule currently changes nothing.* Of 212 sirens, every one the list
calls online is stamped within 48 h (`listOn_stale = 0`), and all 41 stale ones — 24 of them silent
for over a month, one since July 2025 — are already flagged offline upstream. So `stationStatus`
turns out to encode exactly this rule already. The change was kept anyway for two reasons: the
popup can now say **when** a siren last reported (`OUT OF CONTACT · last reported 02/10/2025 · 293
days ago`) instead of an unexplained OFFLINE, and the rule is a standing check on a field we would
otherwise be trusting blindly. Cost is honest: +212 detail requests per poll, ~3.5s → ~4.5s cold.

**Camera image proxy** (`?cam=<id>`) — JPS advertises stills over plain http, unusable from an
https page. Integer id only, URL looked up in the cached payload, host checked against JPS.

## Map

**Base map** — CARTO, three styles selectable in the drawer (Voyager colour / Positron grey / Dark
matter), default follows theme. Dark matter gets a brightness lift because it's near-black.

**Markers** — every station is a Material icon pin tinted by *status*, not by type. Danger-level
rivers and sounding sirens render filled red with a pulsing halo and draw above everything.

**Clustering** — one shared cluster across all categories (per-category clustering stacked five
badges on one town). Badge shows total, takes the dominant kind's colour/icon, dashed when mixed,
red when any child is critical. Never fully disables, because 134 coordinate pairs hold 2+
stations — those spiderfy on click instead.

**Heatmap** — weights river stations by level ÷ their own danger mark, scaled by how soon they reach
it: `ratio × (1 + urgency)`, where urgency ramps from 0 at `RISE_ETA` hours out to 1 at the mark
itself. Same two facts the alert definition is built from, so what glows and what the alert panel
lists cannot tell different stories.

*A ramp, not the `rising` flag.* Reading the flag would have been shorter — it is the same rule —
but it carries a hard edge at `RISE_ETA`. Measured across the weighting: a station at 40% of danger
and 3.0 h out scored 0.80 while one at 3.1 h scored 0.40, a doubling either side of six minutes of
projection, and everything from 3 h down to 0 h glowed identically. The ramp spends the same
doubling across the countdown — 0.40 at 3 h, 0.67 at 1 h, 0.80 at the mark — and the set of stations
that get any boost at all is still exactly the set on alert, because `eta` is only published for a
station that is genuinely climbing.

Blobs are pinned to 4km on the ground (`HEAT_KM`) rather than a pixel size, so zooming doesn't change
what a hotspot means. Legend with colour ramp, ⓘ explaining the formula, and an opacity slider;
the whole legend hides with the layer. The vendored plugin is patched so blobs that size up past
200px stop shedding a hard quarter-circle at the canvas corner — chose to fix the plugin rather
than shrink the blobs, since 4km is the meaningful ground size for a weather system. Blur cost
still caps the radius at 220px, so past roughly street-level zoom the layer fades out instead —
a hotspot that silently covered less ground at each zoom would be worse than no hotspot.

**Popups** — one template everywhere: type badge → name → district · basin → body → still/link →
footer. Water level renders as a progress meter on a **piecewise** scale (alert 38%, warning 68%,
danger 100%) because real thresholds bunch above 88% on a linear bar. Sirens get a single centred
TRIGGERED / IDLE / NO SIGNAL block. Gauges state depth over the marked spot, with dry ground
spelled out and stale readings flagged NOT CURRENT. Non-camera popups link to the nearest webcam
rather than embedding it; camera stills open full-size in a lightbox.

## Panels

**Header** — 64px app bar: title, live status chip, sources, locate, theme toggle.

**Sources dialog** (ⓘ in the app bar) — names all three JPS feeds with links, says what each one
contributes, and states plainly that the site is not affiliated with JPS and is not an official
warning channel. Each station popup also names the feed its own reading came from: three sources
disagreeing by a few centimetres is normal, and an unattributed number would read as a bug in the
map. Built on a native `<dialog>` — modal behaviour, backdrop, Esc and focus trapping for free, and
the only script is `showModal()` plus a backdrop click. Its close button is text, not an icon,
because `close` isn't in the subsetted icon font and one glyph isn't worth busting every font cache.

**Status chip** — a real diagnostic, not decoration: upstream HTTP status, detail-call success
ratio (e.g. 269/274), offline station count, fetch duration, cache age, reading age. Colour and
halo reflect state; hover or tap for the breakdown split into Feed and Network sections.

**Popup header reads place-first** — name, region, then the sensor-type badge. You find a popup by
*where* it is; what kind of reading it holds is the follow-up question, not the opening one. The
multi-sensor variant does the same, with the badge row after the "N sensors at this location" line.

*Bug fixed with it:* the divider under the header was drawn twice. `.sensor:first-of-type` was meant
to drop the first section's own rule, but `.pophead` is a `div` too and so *it* was the first of its
type — the selector matched nothing. It is `.pophead + .sensor` now.

**Rainfall popups state whether it is raining**, the way a siren states TRIGGERED / IDLE. `3.4 mm`
is a fact you then have to interpret; `MODERATE RAIN` is the reading. The bands are the server's own
`rainStatus()` cutoffs (>0 / >10 / >30 / >60 mm an hour), so the block, the pin colour and the status
code cannot drift apart. Green when dry, amber for light and moderate, red for heavy and above — and
a grey `NO READING` with the last-reported time when the station has nothing, on the same principle
as the siren: silence must never render as "not raining".

**Camera popups lead with the picture.** For a camera the still *is* the reading, so it sits directly
under the header — and in a multi-sensor site popup the camera's whole section is hoisted to the top,
ahead of the `leads` order that ranks it last. That ranking is about which reading is most *urgent*;
in a popup the picture is what you opened the pin to look at, and scrolling past four sensors to
reach it defeats the point. The sort is stable, so everything else keeps render.js's order. The "show nearest webcam" link on every other kind stays at the bottom — that is an
action to take after reading the numbers, not one of them.

**Popups scroll past the viewport.** A camera still plus a sparkline can be taller than the map, and
Leaflet's autoPan cannot pan a popup that is taller than the viewport into view — it just clips the
top, which is where the name and the reading are. `.leaflet-popup-content` is capped at
`100vh - 190px` (the 64px app bar plus the popup's own tip, offset and margins) and scrolls, with
`overscroll-behavior: contain` so the scroll doesn't chain out to the map.

**App bar** — a `water_drop` mark sits before the title, and on phones the words are dropped and the
mark carries the identity alone. Five controls plus the status chip have to share a 64px bar at
360px wide; the title is the only thing there that the browser tab already says.

**Drawer** — hamburger, slides in, map re-centres by half its width so the view doesn't hide
underneath. Holds the district filter, layer toggle chips and heatmap controls.

*No basemap picker.* It offered three CARTO styles; the basemap now simply follows the theme —
Voyager in light, Dark Matter in dark. Three flavours of grey was a setting nobody needed, and every
option in a drawer is one more thing to read past during a flood.

**Alert panel** — **always on screen.** It used to hide itself when nothing was wrong, which made
"all clear" and "this thing is broken" render identically — the worse failure during a flood, when
the user is specifically looking for it. The tab always reads `On alert`; quiet is stated inside it
("All clear in KLANG. Nothing rising or in danger."), so an empty panel is visibly an answer rather
than an absence. With nothing to list it **collapses to the tab** — and springs back open when
something appears. Both only fire on the *transition*, so a user who opened the all-clear to read it
isn't shut again on the next poll, and reopening still respects a saved preference for closed.

The tab's counts are **icon chips** — `⌃3`, `⚠1`, `📢1` — not `(3 rising / 1 danger / 1 siren)`. The
words wrapped to a second line as soon as all three counts were non-zero, which is exactly when the
panel matters most. Zero counts are omitted entirely, so the clear state is just the label. Each chip
keeps `title` and `aria-label` text, so nothing is carried by the glyph alone. Glyphs come from what
the subsetted icon font already has (`expand_less`, `warning`, `campaign`) — adding one means
refetching the woff2 and busting its cache.

The leading warning glyph carries the *size* of the problem on the standard status ramp: grey none,
amber 1–4, orange 5–9, red 10+. Those steps are a judgement call, not a JPS definition — one rising
station is a normal afternoon, ten at once is not — and they are deliberately the only thing in the
panel that scales, so the ramp keeps meaning status and nothing else.

Each entry mirrors the popup layout: badge, name,
region, distance from you, meter or state block, sparkline, nearest-webcam button. Sorted
nearest-first when a location fix exists, otherwise sirens then closest-to-danger. Clicking flies
to the station, ripples over it, and temporarily un-hides its layer if switched off.

## User

**Location** — auto-located on landing (view untouched) purely to enable proximity sorting;
clicking the button recentres and opens a "You are here" popup listing the nearest water level,
rainfall, siren and gauge with one meaningful number each, plus the nearest webcam. Errors report
the real reason. *Known trade-off:* prompting on load risks Chrome auto-blocking the origin — the
fix, if it becomes a problem, is to check `navigator.permissions` first.

**Preferences** — one `prefs` blob in `localStorage`: theme, hidden districts, layer toggles,
heatmap on/off and opacity, drawer state, alert-panel state, map centre and zoom.

**Splash** — covers the map until the first poll lands. With no connection it *holds* and warns,
because stale flood data is worse than none; a retry button and the `online` event both resume.
If the browser is online but the feed is down, it lets you through to the map after 1.2s.

**Offline / no-data honesty** — `hasInfo()` greys any station that is offline or reporting nothing,
so nothing ever looks confident without a reading. Currently: all 36 gauges report depth but 15 are
stale, 46 rainfall and 44 siren stations report nothing.

**Heatmap padding** (`vendor/leaflet-heat.js`, PATCH 3) — the stock layer sizes its canvas to the
viewport and only repaints on `moveend`, so dragging pulled blank canvas in from the edge: the
heatmap looked cut off until you let go. The canvas is now padded by 20% of the viewport on each
side, positioned at `containerPoint(-pad)`, with the pad offset threaded through `_redraw`. Grid
indices there needed a larger origin offset than stock's `+2` — negative array keys are skipped by
the flush loop, which would have silently dropped every blob in the top/left padding.
`_animateZoom` had to move with it: it writes an absolute transform that discards the padded
position, so the layer detached for the length of every zoom animation and snapped back on
`moveend`. *Trade-off:* repaint cost is per canvas pixel (`getImageData` + a per-pixel colorize loop), so 20%
padding costs 1.96× per repaint — that is the ceiling on how much margin is worth pre-painting, and
why it isn't 100%. Repainting on `move` instead was rejected for the same reason: it pays that cost
every animation frame.

### "Go to a station" — searchable select

Floats on the map, top-right — not in the drawer with the filters. It is the one control you reach
for *while looking at the map*, and putting it behind the hamburger meant opening a panel to use it
and closing it again to see the result. Filters shape the view; this navigates it. On a phone it
goes full-width on the same 12px gutters as the alert panel, pushes that panel down, and hides with
the drawer open like the rest of the map furniture. It sits at `z-index: 402`, above the panel (400),
because on a phone the results list has to be able to cover it. (Placement lives in `chrome.css` with the other furniture; the control's own
styling stays in `base.css`.)

Closed it reads as a plain select; focused it becomes a filter box over a scrollable list grouped by
district. Picking a row runs the same `flashTo()` the
alert panel uses, so the layer unhides, the cluster expands and the popup opens. On a phone the
drawer closes first — it covers the map.

*Hand-rolled, ~50 lines.* select2 was the shape asked for, but it needs jQuery, which this project
does not have and is not adding for one control. `<datalist>` was tried first and removed: browsers
filter it on the option *value* only, it ignores `<optgroup>` so the district headings are
impossible, and it can't carry a synthetic "nearest to me" row.

Matching is a plain substring over `name + district + kind`, so typing a district lists that district
whole. Results are sorted by district — a group is only a group if its rows are adjacent. No result
cap and no virtualisation: an empty box lists all ~680, which is what a select does; rendering them
is a few ms per keystroke, and nobody scrolls to the bottom of a list they can type into.

*Grouped by state then district*, because the district names alone are ambiguous — Kuala Lumpur and
Selangor both have a Gombak, and they are different places.

The first row, when a geolocation fix exists, is **Nearest station to me** — a plain reduce over
`distKm`, not `nearestOf()`, which is per-kind. It shows on an empty box because it is the one entry
you can't type your way to.

**State on every station** — no feed publishes one, so `api.php` stamps it from *which feed placed
the pin*: the Selangor API only covers Selangor, SPHTN only covers KL and Putrajaya. That is
knowledge we already have rather than a guess from the name, which matters because the names collide
(KL has a Gombak constituency, Selangor a Gombak district). It is stamped where the station is built,
not at the end — `source` is later overwritten to `national` wherever that portal's reading wins, and
that would have relabelled every matched KL river as Selangor. *Known imprecision:* SPHTN publishes a
few stations just over the border (Bentong is in Pahang) and they file under Kuala Lumpur — better a
station in the wrong list than one in no list.

District case is normalised to Title Case at the same point. The feeds disagree — `HULU SELANGOR`
against `Bukit Bintang` — and a filter list mixing both reads as two different data sets.

**District filter — a multi-select list, not a dropdown.** Search box on top, districts grouped under
their state, each with its station count, each a checkbox, each with an **only** button that solos
it, and a `Show all` / `Hide all` pair underneath. Both are *disabled* rather than hidden when they
would do nothing — a button that appears and disappears shifts the rows under the pointer. `Hide all`
deliberately does not close the drawer on a phone: it empties the map, and the way back has to stay
on screen. The useful actions here are "hide
these three" and "only this one"; a `<select>` made both a series of round trips through a dropdown.

State is stored as `PREFS.hidden` — the districts switched **off**, keyed `State|District`. Storing
the hidden set rather than the shown one means a district the feeds add later appears by default
instead of being silently missing, and the state prefix stops hiding KL's Gombak from hiding
Selangor's. On a phone, solo and *show every* close the drawer; individual checkboxes don't, because
ticking three boxes shouldn't close the panel three times.

**Pin counts, not a district table** — each layer chip carries the number of stations that layer
holds *under the current district / rising-only filters*, and a line below the chips reads
`N of 678 stations on the map` counting only the layers switched on. So a chip's number answers
"what would turning this on add", and the total answers "what am I looking at".

It comes straight off `marks[kind].length`, which `render()` has already filtered — no second copy
of the filter rule to disagree with the first. Toggling a chip doesn't re-render (it only re-runs
`syncCluster()`), so that handler calls `counts()` itself.

*Replaced the drawer summary table*, which listed districts with rising/alert tallies. It duplicated
the alert panel — the same stations, less detail, no jump — and answered a question ("where is it
bad") that the map colours already answer at a glance. What it didn't answer was the one the filters
raise: how much of the data is still on screen.

**Jumping past the filters** — a target can be missing from the map two different ways, and
`flashTo()` now handles both. Its *layer* being switched off was already covered (unhide, flash,
re-hide). But the district and rising-only filters drop a station from `render()` entirely, so there
was no marker at all and the jump silently did nothing. `state.pinned` holds one station id that
`render()` keeps regardless of the filters; it is dropped on the first `dragstart`/`zoomstart` after
the flash ends, or as soon as the user touches a filter — that is them re-asserting what they meant.

*Not popupclose,* which would be the obvious signal: markercluster tears popups down on every zoom
(the reason `openStable()` exists), so the pin would vanish while the user was still reading it. The
listener is also armed only *after* the flash, because the flight and `zoomToShowLayer()` move the
map themselves.

*Wiring:* `render.js` parks itself on `state.rerender` so `map.js` can rebuild the markers without
importing it — the dependency already runs the other way and a cycle would break the module graph.
`state.js` exists for exactly this. The cost is a full marker rebuild per jump, same as a filter
change; not worth optimising for something that happens on a click.

**Phones close the drawer on a filter change.** There, the drawer *is* the screen, so a filter whose
effect you can't see is one you have to close the drawer to judge. Only the two that change *which*
stations are on the map do it (district, rising-only) — the heatmap toggle is a display option people
flip back and forth, and the layer chips are usually toggled several at a time. Growing back past
the breakpoint reopens it, since the reason it shut no longer applies.

For that to work, `setDrawer()` takes a `remember` flag: an auto-close is a layout decision, not the
user's, so it must not overwrite `PREFS.drawer` — otherwise there would be nothing left to restore.
Shrinking below the breakpoint deliberately does *not* close the drawer; someone who opened it on
purpose shouldn't lose it to a window resize.

*Skipped:* fuzzy/scored matching, recent searches, and any sync with the poll loop — the station
list only changes when JPS adds a mast, and it is re-read from `state.data` on every keystroke anyway.

## Code structure

**ES modules, no bundler** — the frontend was one 1200-line `index.html` (markup + 382 lines of CSS
+ 753 lines of JS inline). That was the right call while it was 300 lines; at 1200 it had stopped
paying. Split into `index.html` (markup only), three stylesheets and thirteen JS modules loaded via
`<script type="module">`, which the browser resolves natively.

*Why no bundler:* it would buy minification and old-browser support, and cost the edit-and-refresh
loop, a `dist/` directory and a toolchain to keep alive. HTTP/2 makes the extra requests
approximately free, and every target browser has supported modules since 2018.

*Why these seams:* they follow the dependency direction, not the topic. `config.js` and `state.js`
import nothing, so anything may depend on them; `util.js` and `stations.js` are pure; `map.js` and
`heat.js` own Leaflet objects; `popup.js`, `render.js` and `alerts.js` produce output; `ui.js` binds
events; `app.js` decides what happens on landing. The graph is acyclic, and `state.js` exists
specifically so two modules can share `data` / `hereAt` without importing each other.

*Trade-off accepted:* thirteen files is more to open than one. It buys the ability to change the
alert panel without scrolling past the heatmap, and to see at a glance what any file depends on.

## Not built (and why)

- **Heatmap tile cache** — no. The expensive part is the per-pixel colorize pass, and it changes
  with every pan/zoom, so there is nothing stable to cache. Padding removes the visible artefact;
  if repaints ever feel slow, lower `HEAT_MAX_PX` (blur cost is quadratic in radius) before caching.

- **Test suite** — no framework, no build; verification is lint + JS syntax check + querying
  `.cache.json`. Revisit if the proxy grows logic beyond shaping.
- **Database** — done, sqlite for level history (see *Level history in sqlite*). The payload cache
  stays a flat file. Not built on top of it: a server-side query API. Nothing asks for one yet; the
  poll response still carries everything the page renders.
- **Self-hosted tiles** — the only remaining third-party request. Not lite.
