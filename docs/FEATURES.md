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

Four guards sit under it. `rate ≥ RISE_FLOOR` (0.1 m/h), because levels are reported to the
centimetre and over the shortest pair we accept a single 1 cm tick is already 0.06 m/h. The level
must be strictly higher than it was three samples ago. It must beat its own 24-hour high, which is
what keeps a tide out. And it must hold for two consecutive polls. **The guards, the rate and the
sample clock were all replaced after the first version fired 53 times and was wrong 53 times — see
[The forecast was wrong every time it fired](#the-forecast-was-wrong-every-time-it-fired) below.**

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

*A row with no coordinate still carries no jump, but this is no longer the only place one shows up.*
Not every camera JPS publishes carries a usable coordinate — some arrive at `lat: 0, lng: 0` rather
than a wrong point, and until recently every one of those was unmappable outright. `CAM_FIX` in
`api.php` now supplies a real coordinate for eleven of them, most from a station of another kind JPS
already places under the same name. The camera gotcha in `CLAUDE.md` walks through how each one got
its coordinate, and names the two that still rest on an unconfirmed district median. A camera that
`CAM_FIX` has not reached still lands at 0°, 0°. Its row here is still marked `not on the map · no
coordinates` with, deliberately, no `data-mast` — a clickable row for a station at 0°, 0° would fly
the map into the Atlantic. `All cameras` (see below) makes the identical call on a tile instead of a
row: the picture still shows, the click does not. How many cameras that still leaves without a
coordinate is not a number worth pinning here — it is a live figure that moves with what JPS
publishes, and this file already went stale once quoting one.

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
named once, then a section per sensor. 671 mappable stations become 417 pins.

*50 m, measured.* Grouping at 0 m leaves 546 pins — but many pairs sit a few metres apart because two
feeds typed the same mast slightly differently, and exact-match misses all of them. 25 m leaves 435,
50 m leaves 417, and past that it crawls (414 at 75 m, 408 at 100 m) until 200 m starts swallowing
genuinely separate installations. The distribution is bimodal — sensors are either bolted to one mast
or hundreds of metres apart — so almost everything worth merging is already inside 25 m, which is why
the curve is so flat. **Widened 25 → 50 m** anyway: the 18 pins it buys are masts straddling a river
or sitting at opposite ends of one compound, and none of them were separate places. Largest real site
holds six sensors: rainfall, river, three sirens and a camera at Batu 15, Hulu Langat.

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
popup can now say **when** a siren last reported (`OUT OF CONTACT`, over a footer reading
`OFFLINE · last reported 02/10/2025 · 7032.0h ago`) instead of an unexplained OFFLINE, and the rule
is a standing check on a field we would
otherwise be trusting blindly. Cost is honest: +212 detail requests per poll, ~3.5s → ~4.5s cold.

**Camera image proxy** (`?cam=<id>`) — JPS advertises stills over plain http, unusable from an
https page. Integer id only, URL looked up in the cached payload, host checked against JPS.

## Map

**Base map** — CARTO, three styles selectable in the drawer (Voyager colour / Positron grey / Dark
matter), default follows theme. Dark matter gets a brightness lift because it's near-black.

**Markers** — every station is a Material icon pin tinted by *status*, not by type. Danger-level
rivers and sounding sirens render filled red with a pulsing halo and draw above everything.

**Pins are filled, and the glyph picks its own contrast.** A pin used to be a white disc with a
glyph in the station's colour, which put camera cyan on white at about 2:1 — the icon was drawn and
unreadable, and the colour (the thing the map is actually saying) was a detail you had to lean in to
see. Now the disc *is* the colour, ringed in `--surface` to stay off the basemap, and `ink()` in
`util.js` picks near-black or white per fill by WCAG relative luminance. No single glyph colour
works across this palette — it runs from `#3a3a6a` (no rain) to `#ffd166` (river alert) — so the
choice has to be computed. Every colour the pin can take now clears 4.8:1, against ~2:1 before.

**A mast of several sensors gets its own pin** — the `layers` glyph and `MAST.color` indigo, keeping
the sensor-count badge. Same reasoning as the cluster badge: whichever kind leads a mixed stack, its
colour and icon speak for sensors that aren't it. Indigo because it has to miss every other meaning
on the map — the five type hues, the traffic-light statuses, the offline grey. **It is worn only
while the mast is quiet:** any member with `status > 0` keeps the real status colour, and a lead with
no reading stays grey, so the new pin can never make a signalling or dead mast look calm. The glyph
switches on member count alone; only the colour is conditional.

**The alert tab's counts sit on their own line.** Four of them — at danger, sounding, rising, not
current — plus the chevron did not fit 300px beside `On alert · nearest first`, and the title is
what gave way first, which is the one part of the tab that says what the panel *is*. The tally is
sent past the chevron with `order` so the chevron stays up on the title's line, and `:empty` keeps a
quiet panel to a single line, since `alerts.js` writes the span whether or not it has anything in it.

**The About dialog now says what raises an alarm, and how to read the map** — two sections above the
sources, which is where someone who has just been shown a red pin goes looking.

*What puts a station on alert* lays out the three tiers against the real `.tg` tags the panel and
ticker use, so the explanation cannot drift from the thing it explains: `HAPPENING NOW` (a river at
or past its danger mark, or a siren sounding — observed), `FORECAST` (climbing ≥ 0.1 m/h with three
non-dipping readings and its own danger mark ≤ 3 h away) and `NOT CURRENT` (either of those from a
station since gone quiet, kept on the list but sorted last and out of the counts). It also states
the two things the map is otherwise silent about: every mark is the station's *own*, so a drain and
a river are each judged against what floods them; and rainfall, gauges and cameras are drawn but
never alert.

*Reading the map* is a legend built from the map's **own** `.pin` and `.cluster` markup at the size
they are drawn — a legend redrawn in a second style is a legend that can disagree with the map. It
covers the five type colours, the alert/warning/danger fills, the rising ring, the mast pin with its
count, grey for no reading, and the cluster chip; then both heat ramps, reusing the gradients from
the legend panel. Two columns on desktop, stacked on phones, where 154px of pins against 130px of
prose was not a layout.

**Heat points are thinned, because a heatmap adds and an intensity does not.** leaflet.heat
composites overlapping blobs, so N stations reporting the same thing painted something stronger than
any of them reported. Density is the right model for "how many things are here"; both layers plot an
*intensity* — a position on a threshold scale, or millimetres in an hour — and two gauges both
reading 4 mm still means 4 mm.

It showed up as red over an area where every gauge said *light*. Measured on the live network: 233
rain gauges, a median of **4** inside one 5 km blob and up to **14**; alpha composites as
`1 − Π(1 − aᵢ)`, so light rain at 0.26 stacks to **0.70 at four deep and 0.97 at twelve** — the top
of the ramp, from readings at the bottom of it.

`thinHeat()` keeps the strongest reading and drops anything its own blob already covers. That is
exactly "the highest reading within a blob radius", which is what the colour was always claiming to
mean, so the fix is the honest reading rather than a fudge factor. Afterwards no kept point has
another inside the radius — 233 gauges → 102 points, worst case back to 0.26 — and blobs still
overlap softly at their edges, where the brush has faded to nothing anyway.

Applied to **both** layers. Water has one point on a calm day, so it changes nothing visible today,
but the flaw is identical and only surfaces once many stations alert at once — the one moment the
map has to be right. *Rejected:* raising simpleheat's `max` to absorb the stacking, which would have
made a lone violent gauge render as light; and a `lighten` composite op, which blends colour but
still accumulates alpha, so it fixes nothing here.

**Hovering a mast pin draws the area it grouped.** A dashed 50 m disc under the pin, in the mast
indigo — it answers "why is this one pin, and would that neighbour have joined it" without opening
anything. Only for pins holding several sensors: a ring round a lone station draws a boundary that
grouped nothing. The radius is **published in the payload** (`siteM`) rather than kept as a second
copy of `SITE_M` client-side, so the circle is always the radius the server actually grouped by.
`interactive: false`, so it can never swallow the click meant for the pin; an `L.circle` (metres)
rather than a `circleMarker` (pixels), since the whole point is a fixed distance on the ground.
One ring is reused and `render()` clears it, because a marker torn down mid-hover never fires its
`mouseout` and would strand its ring on the map. The popup shows it too — that is the touch
equivalent, a finger having no hover — and `mouseout` defers while the popup is open, so moving off
a pin you just opened doesn't pull the ring from under the list it explains.

**Station search ignores punctuation and word order.** JPS writes the same place as `I.K.B.N.`,
`IKBN` and `Ikbn` across its three feeds, so a reader typing one meant all three and a plain
`includes()` found none of the others. Both sides have punctuation stripped and terms match in any
order: `ikbn` now finds 4 stations instead of 2, `i.k.b.n.` 4 instead of 0, and `lui sg` finds
`KG. SG. LUI`, which used to return nothing.

Squashing the haystack rather than spacing it is what makes one test enough — a spaceless term found
in the spaced text is always in the squashed text too, so the squashed form is a superset. The query
is split on **whitespace only**, then punctuation is stripped *within* each word: splitting the query
on punctuation turned `I.K.B.N` into four single-letter terms and matched 294 of 671 stations.

*Substrings, not edit distance, and no scoring.* `klang` must never quietly surface `Hulu Kelang` —
different places on this map — and it doesn't, since squashing removes spaces but never letters
(`klang` 124 hits, `kelang` 1, both unchanged). Ranking is left alone because the list is read under
district headings, and a relevance order would fight the grouping rather than help it.

**Only one heatmap at a time.** The two chips are mutually exclusive: switching one on switches the
other off, and switching the live one off leaves the map clean. Stacked, they were two answers to
two questions in one picture — and worse, leaflet.heat accumulates alpha *across* layers, so
overlapping blobs blended into a colour belonging to neither scale, reading as an intensity neither
reading supported. They stay **checkboxes, not radios**, because "neither" has to remain reachable
and a radio group cannot be cleared by clicking.

The pair is stored as *one* preference (`PREFS.heatLayer`: `'water'`, `'rain'` or `''`). Two booleans
can hold a state the UI can no longer represent — both on — and a pref saved before this change is
exactly that, so the old keys are read once to migrate and then dropped from the blob.

The legend therefore shows one scale or none, never a stack of two ramps to read against each other,
and the divider that used to sit between them is gone. The opacity slider lives below both sections
and serves whichever layer is live — `heatOpacity()` walks every layer, so it needs no knowledge of
which one that is.

**A second heatmap: rainfall.** Its own layer and its own chip (default off), beside the water one.
Not another weight on the existing layer — the two answer different questions, "how high is the
water" and "how hard is it coming down", and a mast carrying both sensors would have summed a river
level with the rain falling on it into one number answering neither. Two layers also means either
can be read alone, which is the point of having two chips.

Weights come from JPS's own intensity classes (`rainStatus()`: >0 light, >10 moderate, >30 heavy,
>60 violent mm/h) via `RAIN_STOPS`, and the class edges land exactly on the gradient stops, so a
blob changes colour precisely where the class changes. Colours are read straight out of `RAIN_COLOR`
— the rainfall pins' own palette — so a violet blob and the violet pin under it cannot disagree.

**The first class starts at 0.25, not 0, and that is the whole trick.** leaflet.heat uses a point's
weight as its alpha, so a scale counting up from zero draws real rain as almost nothing. Light rain
is most of the rain most of the time: 10 of 233 gauges were reporting when this was built, none
above 4 mm/h, which on a from-zero scale would have been an empty-looking layer that looked broken.
The water layer never hit this because its floor is the alert slot. Only rain actually falling is
drawn — a dry gauge paints nothing, or the whole state would look wet.

Both layers share one sizing pass, one opacity slider and one legend panel, with a section per
active scale and a rule between them only when both are on. That rule is driven by a class on
`#legend`, not `#lgWater + #lgRain`: an adjacent-sibling selector still matches a hidden sibling, so
rain-alone would have drawn a divider under nothing.

*Blob diameter went 4km → 5km* at the same time, for both layers.

> **Superseded.** The corner chip described below is gone. The favorite mark holds that slot now —
> see "The favorite mark takes the header's corner" at the end of this file.

**The site popup's sensor count is a corner chip, not a sentence.** A multi-sensor popup opened with
a `6 sensors at this location` line under the region, which spent a whole row of a popup that is
mostly rows — and restated what the badge list directly beneath it already showed. It is now a chip
in the header's top-right, beside Leaflet's close button, carrying the same `layers` glyph the mast
pin uses so the pin you tapped and the header you get say the same thing. Only the name shares that
line, so only the name pays for the room (`.sitecount + .popname`, an adjacent-sibling rule — hence
the chip is emitted *before* the name). The count is now a bare number on screen, so the sentence
moves to `title`/`aria-label` with `role="img"`: a `<span>` needs the role for the label to be
announced at all.

**One timestamp per sensor, on one line.** A stale sensor used to print its recency twice: a
sentence in the state block (`last signal 411.0h ago`) and the footer naming the same moment again
two lines below (`OFFLINE · last reported 06/07/2026 10:19:05 · via JPS Selangor`). `footLine()` now
carries all of it — state, date, elapsed, source — and the state blocks for siren, rainfall and
gauge print no time at all. Elapsed time is gone from both callers, and the stamp is now printed at
the precision its age needs — see *The station panel said more than it knew* below. Seconds are
dropped for display by
`noSec()`, because the feeds stamp to the second but publish on a 15-minute slot, and the `:05` was
enough to wrap the footer onto two lines on a phone. It trims the printed string only — nothing
parses the result, so `parseMY()` still sees the verbatim stamp.

**Clustering** — one shared cluster across all categories (per-category clustering stacked five
badges on one town). Badge shows the total only, in one neutral slate chip — *no* kind icon or hue.
It used to take the dominant kind's colour and icon, but a cluster is usually mixed, so that dressed
a two-camera-plus-a-river badge as pure camera; the count is the only honest thing a merged badge can
say. Still dashed when mixed and red when any child is critical. Never fully disables, because 134
coordinate pairs hold 2+ stations — those spiderfy on click instead.

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

Blobs are pinned to 5km on the ground (`HEAT_KM`) rather than a pixel size, so zooming doesn't change
what a hotspot means. Legend with colour ramp, ⓘ explaining the formula, and an opacity slider;
the whole legend hides with the layer. The vendored plugin is patched so blobs that size up past
200px stop shedding a hard quarter-circle at the canvas corner — chose to fix the plugin rather
than shrink the blobs, since 5km is the meaningful ground size for a weather system. Blur cost
still caps the radius at 220px, so past roughly street-level zoom the layer fades out instead —
a hotspot that silently covered less ground at each zoom would be worse than no hotspot.

**Popups** — one template everywhere: type badge → name → district · basin → body → still/link →
footer. Water level renders as a progress meter on a **piecewise** scale (alert 38%, warning 68%,
danger 100%) because real thresholds bunch above 88% on a linear bar. Sirens get a single centred
TRIGGERED / IDLE / NO SIGNAL block. Gauges state depth over the marked spot, with dry ground
spelled out and stale readings flagged OFFLINE — the state block says only that, and the footer
carries the "last reported" date, so the same date isn't printed twice a line apart. Non-camera
popups link to the nearest webcam
rather than embedding it; camera stills open full-size in a lightbox.

**The webcam link is one template — `camLink()` in `popup.js`** — shared by the popup and the alert
panel, which each had their own copy of the markup until they disagreed. It reads
`Nearest webcam · 2.3 km`, and on a station that shares a mast with a camera, just **`Show webcam`**.
Two things were cut and both were noise. The camera's *name* was a second place name on a card that
already names a place, and clicking through names it anyway — on the alert panel it sat under the
station name, the district, the basin and the distance-from-you, so it was the fifth label competing
on a card whose job is one reading. And the *distance* is meaningless when it is zero: 113 of 589
non-camera stations are within `SITE_M` of a camera, so the old wording routinely produced
`Nearest station with a webcam · TTDI Jaya, Shah Alam (0.0 km)` next to a station called
`T.T.D.I JAYA, SHAH ALAM` — the same mast, described as a journey. The popup never showed this
because it already suppresses the link when the site holds its own camera (`hasCam`); the alert panel
had no such check, which is why the fix belongs in the shared template rather than at either call
site. `from` may be a bare latlng from a map click, so the same-mast test guards on `from.site`
existing rather than comparing two undefineds and calling every map click a mast.

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

**All-stations table is a matrix**: one row per mast, one column per sensor kind (the `KIND_RANK`
order), with a sticky heading row above the sticky district headings. A column therefore reads as one
measurement all the way down — you can scan every water level in a district without reading anything
else — and a mast with no siren shows a dash instead of a gap you have to interpret.

`oneLiner()` is deliberately *not* reused for the cells. It is written for a popup with 300px to
spend, and "1.68 m · 34% of danger" in a 150px column wraps to three lines. Cells put the value first
and the qualifier muted underneath. Six columns need room, so the dialog widened to 1060px and the
table scrolls sideways below ~820px rather than squeezing them — `min-width` on `thead`/`tbody`,
because `display: table` would otherwise honour the container's 100%.

*A pinned "My location" row* sits above the districts: the nearest **reporting** station of each
kind, with each cell naming its own station and distance in the hover panel — "nearest" is a
different station per kind, so one location cell could not honestly carry one distance. It appears
only while sorted by location and only with no search term: under a sorted reading it would be a row
claiming a rank it does not have, sitting above stations that beat it, and during a search it is not
a result and would contradict the count line. It is not clickable — it is a reading of where you are,
not a place to fly to.

*Every column sorts.* Sorted by location it stays grouped by district; sorted by a **reading the
grouping drops away**, because district headings would slice one ranking into 24 little ones — the
deepest river in Klang would sit above a deeper one in Petaling and the order would be a lie. The
district moves into the location cell instead: you still need to know where a row is, it just stops
being what the table is organised by. Names default to A–Z, readings to worst-first. A mast that
lacks the sorted sensor sinks to the bottom whichever way the arrow points — an absent sensor is not
a low reading. Every reading column sorts on **severity first, then size** — see "Worst first means
the status first" below.

*Water level carries a mini gauge*, the popup's meter shrunk to a column: same piecewise scale (alert
38%, warning 68%, danger 100%), tick marks at the thresholds, no labels. A linear bar would draw
"safe" and "at alert" as nearly the same picture, since real thresholds bunch above 88% of it.

*A "location" here is looser than on the map.* The map groups sensors sharing a coordinate exactly,
because a pin is a point. JPS scatters one site's sensors over a couple of hundred metres — river
gauge on the bridge, rainfall mast at the depot — so this table merges within **200 m**, and within
one district, since two masts either side of a district line are still two places to someone scanning
by district. Greedy O(n²) over ~450 coordinate groups, and only while the dialog is open.

*A 200 m site can hold two of the same kind* — two rainfall gauges either end of a township — and a
cell has room for one answer. Numbers average, states OR together, and a camera cell offers the first
feed there actually is. **Status does not average, it takes the worst:** a status code is a category,
not a quantity (the mean of "normal" and "danger" is not "warning"), and a merged cell rendering
calmer than its worst member is the one failure this app cannot have. So the number is the mean and
the colour is the worst — which is also how you would read it aloud. **Water level and rainfall cells show their graph on hover** — the same 12-hour sparkline the popup
draws, in the panel, which is the only place in this view with room for one. A cell that has nothing
else to add still opens for it.

**The rate arrow animates**, drifting the way the water is going, and comes from one `rateHtml()`
used by every place that prints a rate — the popup's Trend row and the alert panel's trend line. A
river climbing is the one thing on this page that is *happening* rather than merely being the case,
and a static triangle said it in the same voice as a station name. Nudged rather than spun: it has to
register from across a room and still be ignorable while you read the number beside it. Stopped
entirely under `prefers-reduced-motion`. A rate of exactly zero reads `steady` with no arrow —
"steady" is not a direction.

*The glyph is now `arrow_upward` / `arrow_downward`*, not `arrow_drop_up` / `arrow_drop_down`. A
drop triangle is a menu control — it points at a list, not at the ground. A shafted arrow points, so
the direction survives the animation: the shaft enters the frame before the head does, and the eye
reads travel from the shape alone. The travel is also in `em` now, not pixels, so it holds at any
font size. The triangle needed 1.7em to look present, because it filled less than half its box. The
arrow fills the box, so 1.2em is the same optical size.

**River popups carry the sparkline too.** The alert panel has had it all along; the popup you reach
by clicking the pin had the *numbers* for the trend (m/h, hours to danger) but not the shape they
came from. The meter says where the level sits against its own thresholds — the graph says how it
got there.

**Both graphs are gradient areas now**, filled 60% opaque at the baseline down to 10% at the line —
solid enough to read as a mass, faint enough not to compete with the stroke on top. Gradient ids are
minted per call, because several charts can be on the page at once and a duplicate id makes every
chart take the first one's colour.

*The rainfall area is cut into segments wherever an hour is missing.* Bars were used there for a
reason: an unbroken line across a six-hour hole says it did not rain, in the same shape as six hours
of measured zeroes. A lone reading with no neighbours gets a sliver wide enough to see. The area is
what changed; the honesty is not.

**Pointing at the badge, the gauge or the Show image button** opens a panel listing the sensors
behind that cell and each one's own reading. It also covers the case where a single sensor's name
differs from the place it sits at. There is no info icon: the badge and the gauge are what the eye is
already on, so they are what answers — an extra glyph per cell bought nothing but six more marks to
look past in a table meant to be scanned.

*It opens a native `popover`, not a `title` tooltip and not the app's `.tip`.* A title can't be
styled or laid out; `.tip` is absolutely positioned and this table is a scroll container that would
clip it. `popover` puts the panel in the **top layer** — no clipping, no z-index — and brings
click-to-open (so touch works), light dismiss and Esc with it. Only placement needs JS, since CSS
anchor positioning is still Chromium-only; `toggle` doesn't bubble, so that listener is on capture.
Browsers without popover support never match `:popover-open`, so the panel stays `display: none`
rather than spilling its contents into the cell. It opens on hover as well as click, but only under
`(hover: hover)` — touch fires a synthetic `mouseover` before the click, which would open the panel
and have the click toggle it straight shut.

*Rows in the panel read like the cells they explain*: a badge where the answer is a state, a coloured
number where it is a measurement. Anything else and you would be translating between two languages to
check one figure against another. One catch worth knowing: the panel is a *descendant of the cell* in
the DOM, so the table's badge rules still reach it — the top layer changes where an element paints,
not which selectors match it — and the full-width cell treatment has to be undone explicitly.

*Trend and graph, per sensor, in the panel* — a river's rate arrow and its ETA to danger, then its
sparkline; a rainfall sensor's bars; a flood gauge's depth line. The cell has no room for them and
this panel is the only place in the view that does. **Per sensor, not per cell**: a merged cell averages its members, and an
average has no history — two rainfall masts either end of a township can be rising and falling at
once, and one line drawn through their mean would plot a reading that never happened. So the cell
keeps the average and the panel breaks it back apart, each sensor's row followed by its own graph.
Before this, a merged cell showed the rows and nothing else, which is the case where the shape over
time is *most* worth having and was the only one without it. (Side-effect: the row separator is now
`.tiprow ~ .tiprow`, since a graph sits between rows and `+` no longer matches.)

*Flood gauges got a history to draw.* Depth over a flood-prone spot is a level like any other, so
`api.php` now samples it into the same `level` table with the same window and bucket as a river, and
`sparkline()` takes a `kind` so the line comes out in the gauge's taupe rather than river blue — a
graph in another sensor's colour would be the colour language broken for no reason. It shows in the
popup too, since the data exists everywhere the gauge does. Deliberately **no rate or ETA off it**:
the thresholds are 0.15 m and 0.3 m, and a rate against numbers that small, from a sensor rounding to
centimetres, would be mostly noise dressed as a forecast. The graph answers what a gauge is actually
asked — is this spot filling or draining.

*Offline gauges are not sampled at all*, so they have no `history` and draw nothing rather than the
"builds as we poll" placeholder. Several are frozen on April's readings; a flat line at a months-old
number reads as "steady", when what it means is that nobody is listening. This is the same instinct
as the grey `OFFLINE` block — the failure to guard against is a dead sensor looking calm.

*Sirens and cameras still get no graph*, and should not: a siren publishes a state with no history
behind it and a camera publishes a picture. Neither has a quantity to plot, and inventing one to make
the columns match would be decoration.

*"Offline" is a status here, badge and all* — grey, same shape as `TRIGGERED` or `DRY`. A station
that is not reporting is telling you something, and the failure to guard against is it looking like a
calm reading, not it looking like a status. The em dash is reserved for a kind that is **absent** from
the site, which is a different fact.

*The location column freezes* while the readings scroll under it — a row of numbers with the place
name scrolled off is unreadable. Sticky cells need their own background or the scrolling ones slide
straight through them, and the header's first cell is sticky in both directions, so it outranks both.

*Cells lead with whatever is the answer.* Where the reading **is** a state — siren, flood gauge,
rainfall intensity — that is a badge, with the number underneath as the evidence: `TRIGGERED`,
`NOT ACTIVE` (out of contact, which must never look like "no reading"), `DRY` / `WATER` / `WARNING` /
`DANGER`, `LIGHT` / `MODERATE` / `HEAVY` followed by the mm. Water level is the other way round: the
level is the answer and its status is carried in the colour. Badge colours come from the status ramp
even for rainfall — this is a status, not the violet that means "rainfall station".

*Status badges fill their cell*, so the colour band lines up down a column and can be read without
reading the word, and all five sensor columns are the same fixed 120px — the eye travels down one
without re-measuring. Type shrinks to match: 10px badges, 11px sub-lines.

*Two sticky rows means one hard-coded offset:* the district headings sit at `top: 30px`, which is the
column header's own height. Change one and the other has to follow.

**All-stations table: close button in the header, and a way to see a camera.** The close moved out of
a footer bar into the top-right of the header — the table scrolls, so a control pinned below it was
one more thing to travel to in a dialog you are always at the top of. Camera rows now carry a
**Show image** button: there is no room for a still in a table row, so it opens the same lightbox the
popup's image does, and the table stays open behind it.

*The lightbox had to become a `<dialog>` for that.* It was a fixed-position div at `z-index: 950`,
which cannot paint over `#dataBox` — that is a modal dialog, and only the top layer covers one. As a
dialog it stacks correctly and Esc and the backdrop come free, which deleted the custom keydown
handler. Adding the `close` icon was one line in `icons.css`; under the old subsetted font it would
have meant refetching the woff2 and bumping `?v=` on two files.

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

**Open by default on desktop.** The test is `PREFS.drawer !== false`, so an unset preference counts
as open and only an explicit close keeps it shut. A first desktop visit used to land on a bare map
with every filter and layer chip behind an unlabelled hamburger — and at that width there is room
for the panel beside the map, which is the whole reason it is a drawer rather than a sheet. A phone
still lands with it closed regardless of the saved preference: there the drawer *is* the screen, so
opening it would hand the user a filter panel where they expected a map.

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
region, distance from you, meter or state block, sparkline, nearest-webcam button. Entries sort by
tier first, then by kind within a tier (rivers before sirens), then by distance or danger rating.
Clicking flies to the station, ripples over it, and temporarily un-hides its layer if switched off.

**Alert list groups its sirens instead of interleaving them.** Tier always sorts first — observed
danger ranks above a forecast — and within each tier, rivers come before sirens. A list that
alternates between water levels and triggered sirens changes units on every row. A level is a
number to judge. A siren is a decision somebody else made. Grouping sits below tier, never above
it. A sounding siren must not fall under a river merely forecast to reach its mark. This reverses
the no-location default (sirens first). Swap the two operands in the comparator — `(b.kind ===
'siren') - (a.kind === 'siren')` — to restore the old behavior.

## User

**A fix is kept for 15 minutes** (`PREFS.fix`, in the same prefs blob as everything else) and
restored on load instead of re-asking. Every reload used to re-ask the Geolocation API, which on a
phone wakes the GPS for a position that has not meaningfully changed — and this map is a 4 km-radius
question, so 50 m of drift changes none of its answers. `maximumAge` on `map.locate()` says the same
thing to the browser's own position cache, which is the layer that can actually skip the hardware;
the stored copy is what survives the reload that clears it. Live and restored fixes go through one
`place()` — nothing downstream should be able to tell which it got, because there is no difference
worth telling.

**The alert panel collapses on the way into phone width too**, not only on landing there — same
handler shape as the drawer's, on the same `matchMedia` change. Expanded it covers a third of a
phone screen, and a panel that was reasonable beside a 1200px map is not the same object at 380px.
Restored to the saved preference on the way back out, and neither direction writes `PREFS`: the
layout is deciding, not the user, and overwriting would leave nothing to restore.

**A phone lands on the map and nothing else** — drawer shut, alert panel collapsed to its tab,
whatever the saved preferences say. At that width each of them *is* the screen, so restoring a
saved-open one hands the user a panel where they expected a map. Neither is remembered
(`remember: false`), so the preference survives for the desktop visit that set it. The alert panel
still springs open by itself when something *becomes* an alert — that is news, and news is worth the
space; a list that was already there when you arrived is not.

**Location** — auto-located on landing (view untouched) purely to enable proximity sorting;
clicking the button recentres, ripples over where you are and opens a "You are here" card holding
the nearest water level, rainfall, siren and gauge — each as a full sensor section, plus the nearest
webcam's picture (see below).

**A failed location crosses out the button glyph and says why on hover.** `#locate.fail` swaps
`my_location` for `location_disabled` and keeps the ink. The words ride `data-tip`, which
`js/sparktip.js` names on hover and on tap alike. A `title` does neither on a phone. `failTip()` in
`js/locate.js` holds the words.

The surface took three tries, and the two it discarded are worth keeping written down. A panel card
came first, and it was too much furniture for a button that did not answer. Amber came second, on a
request from a reader, and the same reader cut it within the day.

Amber was wrong for a reason the whole app shares. Every other status hue in this chrome rides an
alert row, a ticker tile, a toast or a camera frame. Each one means a station is in trouble. On a
flood map an amber glyph in the app bar therefore reads as an alert on the water. **A broken control
changes its glyph, never its hue.**

`location_disabled` is the crosshair of the resting state with a line through it, so the two read as
one control in two states. The card also had to stay off the landing auto-locate, because a card
nobody asked for lands on whatever the reader opened. A glyph has no such problem, so the crossed
crosshair shows on that path too.

The tip names one place, and the Permissions API is what picks it. A site permission can read
`granted` while the operating system refuses the browser under it.

So `granted` beside a failed fix is proof that the device is at fault. The tip then says so, and
never names the browser at all.

A `denied` permission names the site and the browser instead. A browser that answers nothing gets
both halves. On Windows the tip also names the path, because a reader told to open the settings for
a device still has to find them.

Measured on one Windows desktop: Edge held the grant, the machine held its location service
disabled, and both accuracy settings timed out. The first words named the settings in the browser
alone. Those were already correct, so they sent the reader in a circle.

`setBtn()` writes all three states, so no attribute outlives the state that set it. A tip left over
from a failure names a fault on a button that has since found you.

**The marker is the glyph alone — no chip.** Every station pin is a filled disc, because that is
what says "a sensor is here"; wearing the same chip put the reader into the dataset as a 672nd
reading, and the accuracy circle under it is already the mark that has a shape. The chip was doing
the contrast work, so a soft drop shadow takes that over, sitting the glyph above the map rather than
in it. `filter`, not `box-shadow`: it follows the SVG mask's rendered shape rather than its box.

A white halo was tried alongside it, as the contrast the chip used to give on a busy basemap, and
pulled — it reads as a *glow*. On the dark basemap the arrow wore a bright fringe, which says lit
object, not mark on a map.

The glyph is `my_location`, the crosshair — what the locate button already wears, so the button and
the mark it dropped are one picture. It took two goes to get there. The outlined person it started
with looked like clipart dropped on the map: a picture of *someone standing at* the place, needing a
field of its own to read against, which is what the chip had been providing. A filled `near_me`
arrow fixed the contrast and introduced a heading we do not have. A crosshair is neither — it *is*
the point it marks, so it needs no chip, and being centred on the fix it needs no tip to anchor
either. (The same reason a Google-style teardrop was not the answer: a pin points at its tip, so it
would have to be anchored at `[15,30]`, and it would want to be red.)

The ripple is the same `ping()` the jump-to-station flash draws, in the location blue rather than
the alert red — a red ring round your own position reads as a warning about you. It exists because
arriving was the one step with no feedback: the button turns blue the moment a fix lands, but on
every click after that the map pans to a marker that was already sitting there, so nothing on screen
changed except the view. It fires only when you asked — the landing auto-locate places the marker
without moving the view, and a ripple over a corner of the map nobody is looking at is a flicker
with no referent — and on both arrival paths, a fresh fix and a restored one. *Known trade-off:* prompting on load risks Chrome auto-blocking the origin — the
fix, if it becomes a problem, is to check `navigator.permissions` first.

**Preferences** — one `prefs` blob in `localStorage`: theme, hidden districts, ignored sensors, layer
toggles, heatmap on/off and opacity, drawer state, alert-panel state, map centre and zoom.

### Collapsible filter sections

**Districts and Ignored sensors are `<details>`.** Two scrolling lists stacked one above the other
pushed the layer chips and the "N of M stations" line off the bottom of a phone screen — and both are
things you set once and then stop looking at, unlike the chips, which are switched constantly. Native
`<details>`, so the open/shut state, the keyboard behaviour and the semantics are the platform's;
the stock marker is swapped for a chevron on the right because the count already sits there and a
triangle on the left plus a number on the right reads as two controls.

No animation, deliberately: `<details>` cannot animate closed (children go `display: none`), which is
the reason the drawer itself is a `body.drawer` class rather than a `<details>`. Here there is
nothing to animate around — the panel is behind a drawer that already slid.

Open/shut is remembered per section in `PREFS.sect`. Districts defaults open (it is the filter people
came for); Ignored defaults closed, because its summary count is the thing that has to be visible,
not its list.

### Ignoring a sensor

**The ⋮ in a map popup ignores that one sensor.** JPS publishes stations that are broken, frozen on
a flood reading from April, or simply not about you — a rainfall mast on the far side of a hill you
will never care about. Until now the only way to quieten one was to hide its whole district, which
takes the twenty stations you *do* want with it. `PREFS.ignored` is a list of station ids; the menu
adds to it, and the "Ignored sensors" panel at the top of the drawer is the way back.

**It applies further than the district filter does, and that is the point.** The ticker and the toast
deliberately ignore the district picker — a filter you set an hour ago to tidy the map is not consent
to be told less about a river reaching its danger mark. Ignoring one *named* sensor is exactly that
consent, given deliberately, about that sensor. So it holds everywhere: pins, heat weighting, the
alert panel, the ticker and the toast. This is the only setting on the page that suppresses an
alarm, which is why the rest of this section exists.

**Two always-visible indications, per ISA-18.2 on shelved alarms.** A muted alarm nobody can find is
the failure the standard spends a chapter on, so the count is not allowed to hide: the count sits on
the **summary** of the "Ignored sensors" section, which is present whether the section is open or
shut and whether or not anything is ignored (open and empty, it says so and names the ⋮); and
`#shown` — the line under the layer chips that answers "why is the map this empty" — carries
`· N ignored`. Collapsing the section is therefore never a way to lose sight of a silenced sensor.

**An ignored sensor that is itself on alert is stated in the all-clear.** "All clear. Nothing rising
or in danger" over the top of a silenced river at its danger mark would be a plain lie. It is counted,
not listed — listing it would undo the thing the user asked for — and the line says where to restore
it. *Considered and not built:* ISA-18.2 shelves alarms with a **time limit** so nothing stays
silenced by accident. Two permanent indications and a one-click restore were judged enough for a
public map where the realistic reason to ignore a sensor ("that gauge has read 3.55 m since April")
does not expire either. Open gap — see the alert design standard below.

**Ignore loses to a jump, like a hidden district does.** `state.pinned` still overrides every filter,
so a station reached from the table or the go-to box shows its pin rather than flying the map to an
empty patch. Ignoring from that popup clears the pin in the same action.

**Ids that leave the payload stay in the list.** The feeds drop and restore stations; forgetting the
setting on the one poll a station went missing would silently un-ignore it. Nothing lists it while it
is gone, because the panel is drawn from `state.data`.

**The ⋮ is a menu, not a bare button**, with one item. An unlabelled glyph that takes a station off
the map in one tap is the wrong affordance for something scanned with a thumb, and the item can carry
the second line that says what ignoring actually does. Native `popover` + `popovertarget`: toggle,
light dismiss and Esc for free, and the top layer means a Leaflet popup — a small scrolling box —
cannot clip it. Placement is by hand in `ui.js`, the same as the table's hover panels, because CSS
anchor positioning is still Chromium-only. Ids collide with nothing: Leaflet builds the DOM only for
the popup that is open, and there is only ever one.

*Not built:* ignoring a whole mast in one action (the district filter and per-sensor ignore bracket
it), and marking ignored rows in the all-stations table — that view is deliberately "show me
everything", and its search box is the only filter it has.

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

### Static build for GitHub Pages

Pages serves files, not PHP, so `.github/workflows/pages.yml` runs the PHP on a `*/15` cron instead
of on request: `composer install`, `php api.php > api.json`, stage `index.html css js vendor` plus
that JSON, publish. The site is then a folder of static assets with a pre-baked payload.

The two builds differ by **one line**: `STATIC` in `config.js`, flipped by a `sed` in the bake. It
drives `FEED` (`api.json` vs `api.php`) and `camSrc()`. Nothing sniffs the hostname — a build that
knows what it is beats one that guesses, and the local Herd copy is untouched by any of it.

*Cameras need no proxy there.* `api.php` fetches stills server-side partly for mixed content —
upstream advertises them as `http://`, which an https page will not load — but the same file is in
fact served over TLS. So the static build points `<img>` straight at
`https://infobanjirjps.selangor.gov.my/…/CCTV_Image/{id}.jpg` and 93 images stay out of the bake.
`api.php` keeps proxying because it *also* validates that the host is JPS before streaming anything.
Consequence: on Pages, a camera pane depends on upstream TLS staying up. If those certs lapse the
images break there and keep working locally.

*Bake-time `data-shot`.* The lightbox button used to carry a bare camera id that `ui.js` pasted into
a proxy URL, which put a second copy of "how a still is addressed" in a file that has no other
reason to know. `table.js` now writes the resolved URL and `ui.js` just uses it.

*Trend history survives in the Actions cache*, keyed `history-${run_id}` with a `history-` restore
key. This is the one piece of state a bake cannot rebuild, and caches are evicted after 7 days
unused — the schedule keeps it warm, but a long quiet spell costs the samples and every `rising`
flag goes false for an hour afterwards (see the gotcha about `rm .history.db`; same failure, remote).
Not committed to the repo instead: the file reaches tens of MB over the 30-day retention, and
pushing that four times an hour is a lot of traffic to avoid an occasional hour of flat trends.

*Trade-offs accepted:* cron is best-effort and frequently late, so the map runs 15–30 minutes behind
rather than 5, and the `POLL_MS` client refresh mostly re-fetches an unchanged file. GitHub disables
schedules after 60 days without a commit. Free Actions minutes require a public repo, which Pages
needs anyway. A poll that returns fewer than 100 stations fails the job deliberately, leaving the
previous deployment up — `api.php` reports upstream failure as a JSON error object, not an exit
code, so without that check a bad bake would publish cheerfully.

*Not built:* a `gh-pages` branch. `upload-pages-artifact` publishes without a commit at all, so
there is no history to force-push away every quarter hour.

## One rebuild at a time, and only for people who are watching

The refresh path had a stampede guard — `touch(CACHE)` to claim the work — but it sat inside the
`if (function_exists('fastcgi_finish_request'))` branch. Herd's SAPI is `cgi-fcgi`, which does not
have that function, so on the machine this actually runs on nothing ever claimed anything: every
concurrent cache miss started its own fan-out. A cold rebuild is ~270 requests at JPS, so two
visitors landing together made 540 and six made 1,620 — not a busy site, the shape of a flood from
one address, aimed at the agency the entire page depends on.

`flock` on `.refresh.lock` (gitignored) replaces it, because a lock file does not care which SAPI is
running. The winner rebuilds; everyone else **serves the stale payload rather than queueing**. Stale
here means at most one poll old, and holding a connection open for 15s to hand back data the caller
already has is worse for both ends than data that is five minutes behind. The one case that does
queue is a true cold start, where there is nothing to serve instead: those arrivals block on
`flock(LOCK_EX)` and then re-check the cache the winner just wrote.

Measured on six simultaneous requests against an expired cache: one took 4.9s and rebuilt, five
returned identical payloads in ~0.3s.

*Client side:* `setInterval` skips the poll while `document.hidden`, and `visibilitychange`
refreshes on return if more than `POLL_MS` has passed. A forgotten background tab costing a request
every five minutes for ever is traffic spent on data nobody is reading, and a returning tab is never
staler than it would have been anyway.

Upstream load is now capped at one fan-out per `TTL` regardless of how many people are on the page.

*Not done:* lowering `curl_multi` concurrency from 20. It makes a cold start slower without reducing
the total number of requests, and the burst was never the problem — the number of simultaneous
bursts was.

### The User-Agent names us on purpose

Every upstream request — JSON API, both scraped pages, every camera still — goes through the one
`curl_setopt_array` in `fetchAll()`, so there is exactly one place a User-Agent is set. It carries a
contact URL:

```
flood-exp/1.0 (+https://github.com/illusionikx/selangor-flood-tracker)
```

A deployed box pulls **~1.1 GB/day off JPS from a single residential IP on a fixed five-minute tick,
indefinitely**. That is the most conspicuous pattern a web log can hold, and JPS can already identify
it from volume and rhythm alone — the UA changes nothing about *whether* they can, only whether the
person reading the log has to guess. Naming the project turns an anonymous scraper into a legible
one, which is the difference between something worth blocking and something worth an email.

The alternative — a browser UA, or a rotating one — would be evasion, and evasion is what turns
"reading a public feed" into something that looks like it needed hiding. Nothing here bypasses auth,
CORS, a rate limit or a robots rule; the endpoints are public, unauthenticated and published for
public use. The politeness measures are structural instead: the `flock` guard, the 5-minute payload
cache, the 15-minute page cache for the slow KL table, and capture decoupled from polling so the
archive costs ~90 stills per half hour rather than 90 per poll.

*Not done:* conditional GET (`If-Modified-Since` → 304) on the stills. Upstream honours it, but at
30-minute intervals only ~2 cameras in 90 are stale enough to return 304, so it trims requests and
not the gigabyte. Worth revisiting only if `SHOT_EVERY` ever drops.

## The status chip says one word

Four states, one word each: `live` (200, upstream up, readings under 2h), `stale` (connection fine,
JPS's own readings older than 2h), `cached` (upstream down, last good payload), `offline` (proxy
unreachable). The old labels were sentences — `upstream down — showing cache` is two facts and a
dash inside a 64px bar. The chip answers one question, *is what I am looking at current*, and
anything else was answering a question nobody had asked yet.

The hover popover went from eight rows under two headings to four: readings age, last checked,
station count, and cache-or-JPS. Dropped: HTTP status, detail-call tally, fetch milliseconds,
offline percentage — all of it useful while building the proxy and to nobody since. `#netstats .head`
and `tr.gap` went with them.

It also carries the one thing the chip cannot show and everyone asks: *"Refreshes itself every 5
minutes. Nothing to reload."*

*The ages tick.* `network()` re-renders the last payload every 30s. Between polls the chip used to
read "last checked 4 minutes ago" for four solid minutes, which reads as a page that has stopped
rather than one that is waiting. This also lets `stale` flip on its own, without needing a poll to
notice the readings aged out.

## The splash says what it is doing

Five lines, and every one of them is a stage that can actually be observed:

| when | line |
|---|---|
| request sent | contacting the proxy… |
| +2.5s | asking JPS for stations — this can take a few seconds |
| +8s | still waiting on JPS. A cold start rebuilds the whole station list… up to 20 seconds |
| response in | reading water levels, rainfall, sirens and cameras… |
| parsed | placing 669 stations on the map… |

The fetch is **one opaque round trip** — there is no server-side progress to report, so the two
timed lines say only that it is slow and roughly why, which the reader can check against the clock.
A progress bar over a wait nobody can measure would be a lie with no tell.

The last line needs `await new Promise(requestAnimationFrame)` before `render()`: set and rendered
in the same task it would never paint, because `render()` blocks for the whole marker build. Only
the first poll narrates — `first` is captured before the fetch.

`#splashMsg` gets `min-height: 2.8em` so the splash does not jump as the lines change length.

## Lightbox spinner

A JPS still goes through the proxy and can take seconds; without this the dialog opened on a black
screen, which reads as *the camera is dead* rather than *wait*. Reuses the splash's spinner — the
rule was promoted from `#splash .spin` to plain `.spin`, so this cost no new CSS.

`.loading` is set before `src` and cleared on `load` **or** `error`: a dead camera stops the spinner
too, because a spinner that never ends reads as "still trying". It is also cleared immediately if
`img.complete` is already true — a still the popup has already cached fires no `load` event, and
without that check the spinner would sit there for ever over a picture that was ready.

## Camera timeline — replaying the archive

A river level has had a graph all along. A camera had only *now*, which is the wrong tense for the
question people actually bring to a flood camera: **was it like this an hour ago?** The server keeps
frames; the lightbox scrubs them.

### What is stored, and why it is not more

Every number here is a bandwidth decision, not a preference. Measured: **90 cameras, 175–390 KB per
still (avg ~250 KB)**. Pulling all 90 on every 5-minute poll would be **~6.5 GB/day taken from one
government server by one address** — the same shape as the stampede `.refresh.lock` exists to
prevent, played in slow motion, and the fastest way to lose access to the feed the whole page runs
on. So **capture is decoupled from the poll**: once per `SHOT_EVERY` (30 min), by whoever happens to
be refreshing when the stamp expires. ~1.1 GB/day, and it is the hard ceiling on how dense the
6-hour tier can be.

Frames are stored at **720p, which is what JPS actually serves** — every camera measured came back
1280×720, so `SHOT_W` is the native width and nothing is normally downscaled. It exists for the day
a camera starts publishing something larger.

At that size the frame is stored as **whichever of the two encodings is smaller**, not as WebP by
policy. Re-encoding 1280×720 CCTV to WebP q60 measured *larger than the JPEG it came from* on
several cameras (181 KB vs 165, 169 vs 153) — paying a generation loss to grow the file. Across a
real capture round it split **58 WebP (avg 191 KB) / 32 JPEG (avg 188 KB)**: the two formats are
within 2% of each other at this resolution, which is exactly why the rule compares them rather than
asserting a winner. It stays right if JPS changes its encoder, and it re-derives itself for free if
`SHOT_W` is ever lowered, where the re-encode wins by a wide margin (1024px measured 105 KB against
the same 167 KB source).

A frame is therefore `.webp` **or** `.jpg`, and the extension is not knowable from the timestamp —
hence `shotFile()`, two stat calls rather than a manifest that could disagree with the directory.
`?shot=` takes the content type off the file it found.

`SHOT_Q` is deliberately high (82). Combined with the smaller-of-the-two rule that means the
re-encode almost never wins, so what is actually stored is the original JPEG **byte for byte, with no
generation loss at all** — the most faithful thing we can keep, and the cheapest to produce. WebP
only takes over where it genuinely beats the original, which at that quality is a real saving rather
than a coin toss. **1080p was never on the table**: JPS publishes 1280×720, so upscaling would double
the file for no extra detail. 720p *is* the ceiling, and quality is the only axis left.

**193 frames survive per camera** at steady state (the test prints it), so at a 245 KB source average
that is **~4.3 GB** on disk for all 90 — and *flat from year one*, because the last tier deletes as
fast as capture adds. ~1.9 GB if `SHOT_W` dropped to 1024. Download from JPS is
unchanged either way (~1.1 GB/day): the full original is always fetched, the choice only affects what
is kept. Lowering `SHOT_W` is a one-line change and roughly halves the archive.

It was 165 frames and ~3.7 GB until the week tier went from 6-hourly to 3-hourly. **That 16% is
bought deliberately**, and the buyer is the scrubber: a tier is what a range can *play*, and a week
window at 6-hourly held 28 frames — a half-minute clip crossing seven days, against 48 for the day
before it. Half the storage decision is a playback decision, and disk is the cheap side of it.

### Retention

`SHOT_TIERS` in `shots.php`, applied on a frame's **age**, so a frame thins itself as it gets older
rather than being filed once and forgotten:

| age | kept | aims at (MYT) | frames in the matching scrubber range |
|---|---|---|---|
| ≤ 6 h | every frame | — | — |
| ≤ 24 h | one per 30 min | — | 48 |
| ≤ 7 days | one per 3 h | 01:00, then every 3 hours | 56 |
| ≤ 30 days | one per 12 h | 04:00 and 16:00 | 60 |
| ≤ 1 year | one per week | Monday 16:00 | 52 |
| older | deleted | — | — |

The third column is why the steps are what they are. **A tier is what a range can play**, so the two
are one decision: every window lands near 50 frames, which is a clip of about a minute at one frame a
second — the same weight of thing to sit through whichever range is picked. Loosening a tier does not
just free disk, it shortens a clip and skips half of what happened in it.

The first two tiers are the same density while `SHOT_EVERY` is 30 min. Both are written out anyway:
the tiers are the **policy**, the capture rate is a **bandwidth cap**, and conflating them would mean
re-deriving the policy from scratch the day the cap changes.

The newest frame in a bucket wins — for a 12-hour bucket that is the end of the period, which is what
"what did it look like that evening" means. Bucket keys carry their step (`"21600:82625"`, not
`82625`), because two tiers dividing by different numbers can land on the same integer and silently
delete each other's frames.

**Duplicate frames are dropped.** Several cameras stall for hours; storing an identical frame would
put a point on the timeline that claims to be a new observation and is not, and would make a dead
camera look like a still scene. Re-encoding is deterministic, so an md5 of the WebP is an exact test.
Anything under `SHOT_MIN` (4 KB) is skipped too — JPS answers a dead camera with a ~2 KB placeholder
rather than a 404.

### Storage shape

One directory per camera, one file per frame, named by the unix second it was captured. No index
table: the filename *is* the index, so listing is a `scandir` of ~170 entries and expiring a frame is
an `unlink`. A `shot(camera, ts)` table in `.history.db` would buy a query nobody makes.

`?shots=<id>` lists a camera's frames; `?shot=<id>&t=<ts>` serves one, `immutable` for a year because
a stored frame never changes. Both parameters are cast to `int` before they touch the filesystem, so
the path cannot be steered outside `shots/` — the same rule as `?cam=`, which never proxies a URL it
was handed.

### The lightbox is a modal, not an overlay

It used to be full-bleed black with the still centred in it, and you tapped anywhere to dismiss. That
is the right shape for "just show me the picture" and the wrong one the moment the picture has a
**name, a close button and a row of controls** — every one of those is a thing you click *on*, and a
tap-anywhere surface cannot tell a dismissal from a scrub, a play, or a drag on the compare divider.
Each needed its own exemption, and the list was going to keep growing.

So: `.modalhead` with the **location as the title** and an ×, the frame as the body, the timeline as
the **footer**. The same three-part shape as the About and All-stations dialogs, so it is the same
object rather than a third convention — and the backdrop-closes-it handler is now one line
(`e.target === lightbox`) with no exemptions at all.

The title comes from a `data-name` on both openers rather than from stripping "Latest still from "
off the alt text: that is a caption, and parsing a caption back into a name is a rule that breaks the
day the caption is reworded. The alt text stays on the `<img>`, where it belongs.

`width: fit-content` so the box tracks the frame — a fixed width would gutter a portrait still —
with a floor so a short camera name doesn't shrink the dialog around its own title, and the floor
drops on phones where a 460px minimum would be a horizontal scrollbar.

### The scrubber

Lightbox only, deliberately. A popup is 300px of readings you glance at; a timeline is something you
sit with, and the lightbox is already the full-screen "look at this properly" view. A scrubber in the
popup would be two places to learn and one of them too small to use.

**Named ranges, not a free zoom** (24 h / week / month / year). The retention tiers mean the
archive *is* a set of fixed resolutions, so a continuous zoom would promise detail that is not on
disk between the stops. These are the stops.

**There is no 6-hour stop.** It was the first one, and it meant "every frame we have" — but the
capture rate is `SHOT_EVERY`, 30 minutes, so "every frame" *is* half-hourly and the stop was the
24-hour window under a second name and a narrower lens. The finest resolution the archive can hold is
one frame per half hour, and that is what the shortest range now says it is.

**And a range plays at its own tier's spacing.** Each stop carries the `step` its tier is stored
at — 30 min, 3 h, 12 h, weekly — and `thin()` decimates the window down to it before
anything is played. It has to, because retention thins on a frame's *age*, not on the window you
happen to be looking through: a week window holds six days of 3-hourly frames and then 48 half-hourly
ones at the near end, so playing everything in it spent four fifths of the clip on the last day and
crossed the six days before it in seconds. The window said "a week" and the clip did not move through
it at a week's pace. `thin()` buckets by `floor(ts / step)` and keeps the newest in each — the same
rule and the same bucket key `pruneShots()` prunes by, so a window already thinned to that step comes
through untouched and one that has not is thinned the way it eventually will be on disk.

*Cost accepted:* the near end of a wide range shows fewer frames than exist. That is the trade the
ranges are for — the 24 h stop is there to see everything — and a clip that changes pace half way
through is not a timeline, it is two.

**The pace is written under the control** — `one frame every 3 hours`, and nothing else. Every range
plays at a frame a second, so while running they look identical and differ only in what each second
is worth; that is the one thing the picture cannot show. The caption also carried the frame count and
the span (`· 29 frames · 22 Jul 06:00 → live`) for a while, and both went: the tick strip already
shows the count by being countable and the span by starting at the left edge, so the words were a
third line of chrome restating a picture. A window holding nothing still says so in words, because
that is a state and not a number.

**A tick strip under the scrubber: one mark per frame, and no mark height on a period.** The strip
draws two heights. A plain frame is 8px of a 10px box, and the `now` mark is 8px too — width and
color set that one apart, not height. A hovered mark and an alert frame both fill the box at 2px
wide. What the strip rejects is a *repeating* second height. The first build made every new day
taller, which laid a second and coarser grid over the frames. The strip then said two things at
once. The window is thinned to the range's own step, so the frames already *are* the graduation.
The marks are evenly spaced by construction, and one mark is one picture. That is the whole legend,
and it needs no key.

Three marks stand out from that ruler, and none of them is a graduation. "Now" is wider and
accented, because it is the one mark that is not an archived frame. A hovered mark grows for as long
as the pointer rests on it. A frame taken while a river was at danger, or forecast to reach it, is
taller and wider. It carries the tier as a color.

The rejected day mark repeated forever, so it read as a scale. These three do not repeat on any
period. They name a condition on one frame. A second scale would compete with the frame spacing for
the same job. A condition never competes, because it measures nothing.

Marks are placed by *index*, like the scrubber's own positions rather than by clock time, so a mark
is always directly under the thumb that selects it. Positions are a percentage of the *track*, which
starts half a thumb in from each end, so the strip is inset with a `margin` and not a `padding` — a
percentage offset resolves against the padding box and padding would not have moved it.

**Hover a mark to read its time, click it to go there.** The scrubber has no labels, so finding
18:00 on it means dragging and watching; the marks carry the timestamp as a native `title` — nothing
to position, nothing to dismiss — and their index as `data-i`. Each is 1px of paint inside an 11px
hit box, which is the only reason either gesture works: a 1px target is neither hoverable nor
tappable. The box is sized just under the tightest spacing any range produces, so the boxes tile the
strip without overlapping and a click between two marks lands on the nearer one. Clicking stops
playback, for the same reason dragging the scrubber does — having gone to a specific frame, you are
not asking to be carried off it a second later.

**The picture plays and pauses the clip.** It is the largest target in the dialog and the thing being
looked at, so reaching to the footer to pause meant looking away from the frame you were pausing on.
The click was free: the lightbox closes on its backdrop only, deliberately, so nothing was on it.
Not while comparing — there a press on the stage is the start of a drag on the divider, and one
gesture cannot be both. The cursor says which mode it is in, from `:has(#tl:not([hidden]))` rather
than a class set from JS, since the state is already in the DOM.

**Opening picks the narrowest range that actually holds a clip.** 24 h is the right default on a
server that has been capturing all along, and empty on one that has not — an empty scrubber under a
camera with a week of frames behind it reads as "no archive", which is the exact state this footer
exists to replace.

The live still — the image the lightbox was opened on — sits one past the end of the scrubber. It is
not in the archive, but on a timeline it is simply the newest thing there is. Playback loops, because
stopping dead means pressing play again to see it.

**Playback ends on the live frame.** It used to skip it and jump from the newest *stored* frame
straight back to the oldest — so the clip showed every photo except the one that was on screen when
you pressed play, and a camera whose archive is up to 30 minutes behind (`SHOT_EVERY`) never reached
the present at all. The question a flood camera is opened with is "how did it get to *this*", and a
playback that stops half an hour short of "this" does not answer it. The original reason for skipping
was real — the live still is a full-size JPEG arriving at the end of a run of 720p WebP, and it does
land visibly — but arriving at the present is the point of the clip. It is **still** skipped while
comparing, where live is the fixed side: playing onto it would lay the picture over itself.

**Live gets no longer dwell than any other frame.** A 2.5 s hold on it was tried first, on the
reasoning that the frame a clip is played *towards* deserves to land — but at one second a frame the
run has a rhythm, and a frame that outstays it reads as the clip having stalled rather than as an
arrival. Nothing on screen says a pause is deliberate. Uniform timing also keeps the loop a plain
`setInterval` rather than a self-rescheduling `setTimeout`.

**A run starts wherever the scrubber already is, and the scrubber rests on live** — so a clip opens
on the live frame, wraps to the oldest and plays back up to it: *here is now, here is how it got
here*. Play used to rewind to frame 0 whenever it was resting at the end, which meant opening a
camera swapped the picture you had just asked to see for one from hours ago before you had looked at
it. Removing the rewind is a deletion, not a special case: the modulo already wraps, and the resting
position has already been painted.

`lastPos()` is the single place that knows where a run ends (`frames.length` normally, one less while
comparing), so the loop cannot disagree with itself about where the end is.

### Transport: step back, step forward, go to now

Play alone answers "show me the sweep". It does not answer "show me the frame before that one",
which is the question a river rising asks of the viewer. A drag on the scrubber is the wrong tool
for one frame: the thumb has no labels, and at 50 frames across a phone the thumb moves two or three
frames per pixel. So the footer now carries four transport buttons — previous frame, play/pause,
next frame, go to now.

**A step is one stored frame, not a fixed span of time.** The range decides what a frame is worth,
and the tick strip above the buttons already shows that spacing. A step of "15 minutes" would land
between frames on every range except the finest.

**Steps clamp. Playback wraps.** A clip that stops dead at the end means pressing play again, so the
loop wraps. A step is a nudge, and a nudge off the oldest frame that lands on the newest is a jump.
The two rules differ because the two acts differ.

**"Go to now" is `lastPos()`, not the live slot.** While comparing, live is the fixed side, so the
moving side can hold nothing newer than the last archived frame. One expression covers both states,
and no branch says "except while comparing".

Every deliberate move goes through one `go(i)`: the two step buttons, "go to now", and a click on a
tick. All four stop playback, for the reason dragging the scrubber stops it. Having asked for one
frame, you are not asking to be carried off it a second later.

**The buttons sit on their own row, under the track.** Play used to be the one control beside the
scrubber. Four buttons plus the scrubber do not fit a 360px phone.

**Transport on the left, range on the right, pushed to the two ends of the row.** A centered
transport was built first and looks wrong the moment anything shares its line: it reads as centered
on nothing, with the range control hanging off one side. The ends work because the row is the width
of the scrubber above it, so each cluster sits under the end of the thing it drives.

The range control carries a small `Range` label to its left, which is also the group's accessible
name. Four bare time words in a sunken track read as a filter until you press one. The label names
which of the timeline's two dimensions they move.

**The stacking rule is a container query, not a media query.** The thing that runs out of room is
the dialog, and the dialog is sized by the camera frame — a 4:3 still on a wide screen leaves a
narrow dialog, and a viewport-width query would call that case roomy. `#tl` takes
`container-type: inline-size`, and below 520px of it the two stack and both center, transport on
top. That is the first container query in this codebase. The 600px viewport breakpoint still governs
everything else, including the tighter segment padding on phones.

### The keys are YouTube's keys

A full-screen player is where people already learned media keys, so this dialog takes the same ones
rather than teaching a second set. `k` or space plays and pauses. `,` `.` and the arrows step one
frame. End goes to now.

**Every key presses its button.** The handler does not call the action, it calls `btn.click()`. So a
key runs exactly what the button runs, and the button lights up, which is the only way a keystroke
tells you which control it reached. It also means the key table cannot drift from what the buttons
do — there is one implementation of each action, on the button.

`j` and `l` are absent. On YouTube they are a coarser jump than the arrows. Here the coarse control
is the range, and a frame is already 30 minutes to a week, so there is no second granularity to
bind. `0` and Home are absent for a different reason: there is no "oldest frame" button, and a key
with no button has nothing to light up. Home still works natively while the scrubber holds focus.

The handler sits on the dialog, not on the scrubber. A key you must focus something to use is a key
you must find first. Two natives are stepped around. The scrubber is an `<input type="range">` and
handles the arrows, Home and End itself when it holds focus. And space on a focused button is that
button's own press, fired by the browser on keyup — handling it again would run the action twice.

**The play button takes focus when the timeline appears**, which is what makes space work. `<dialog>`
focuses the first focusable thing it finds, and that was the ×, so space closed the lightbox instead
of pausing it. `autofocus` in the markup cannot win this race: the footer is `hidden` until the
archive has been fetched, so it does not exist when `showModal()` runs.

That focus draws a ring nobody asked for. Chrome carries the modality of the previous focus across a
programmatic `focus()`, so opening the lightbox from a keyboard-focused control rings a button that
was never navigated to. A `.noring` class suppresses that one ring. The first key press and the
first blur both take it off, so a reader who is actually navigating gets the indicator back before
it can matter. Nothing else in the app loses a focus ring.

The `<dialog>` elements lose their own outline app-wide. A dialog is a container, not a control, and
`showModal()` focuses it whenever it finds nothing focusable inside. The ring says nothing a reader
can act on, and the box already carries a border of its own.

Each button's `title` names its key. The `aria-label` does not — a screen reader announcing "Play
open-paren k" reads the binding as part of the control's name.

### Pressed transport buttons flash

The picture is the play button, and the keys are on the dialog. So most toggles are made with your
eyes on the frame, and the only feedback is an icon swapping between two glyphs 200px away that
nobody is looking at. Clicking the picture appeared to do nothing.

Any transport button now ripples when pressed, whatever pressed it. One `click` listener on the
group covers a pointer press, Enter on a focused button, and the keyboard bindings, because those
reach the buttons through `.click()`. The stage adds one direct call, since a click on the picture
is a press of the play button by another route.

**Android's ripple, near enough.** The first version flipped the whole button to filled accent and
swelled it 30%. That is a state change, not an acknowledgement — it read as "this control is now on"
on a button that had only been pressed. A disc of accent at 26% opacity grows from 30% to the
button's own edge over 450ms and fades out. It says the press landed, and says nothing else.

It grows from the center, not from the pointer. These are 40px circles, so the offset a real ripple
would take is a couple of pixels, and reading it costs a `pointerdown` listener and two custom
properties per press.

The keyframe names only its `from` state. The resting state is the disc's own — invisible and full
size — so the animation ends by returning to it, and the class can stay on the button for good
without parking an accent circle over the glyph. Reduced motion swaps the keyframe for one without
the growth, rather than removing the effect: a press on the picture has no other feedback, and a
fade is not movement.

Restarting the animation needs the class removed, a style flush, then the class added. `offsetWidth`
is the flush. `requestAnimationFrame` is not — its callbacks run before the frame's style recalc,
the same trap the `#gotoBox` focus hit. Without the flush, a second press inside 450ms adds a class
that is already there and paints nothing.

**Playback runs at one frame a second, and that is not a frame rate.** Consecutive frames here are 30
minutes to a week apart, so nothing on screen is continuous with what preceded it — there is no
motion to smooth, and every frame is a separate scene that has to be *read*: has the water risen, is
the road still there. The first pass was paced at 320 ms as though this were video, and pushed the
whole archive past before any of it registered. A second a frame is the pace of looking rather than
the pace of playback: a typical 30–60 frame range takes 30–60 s, with the scrubber there for anyone
after one specific moment rather than the sweep.

Changing range warms the whole window with `new Image()` — at most ~60 frames off local disk, served
`immutable`. The alternative is a scrubber that stutters on every drag, which is the one interaction
this feature exists for.

**The ranges are a segmented control, not a row of pills.** They are mutually exclusive — picking one
unpicks the rest — and as separate outlined pills each looked independently pressable, with nothing
in the row saying only one could ever be on. A single sunken track with the current segment filled
says it in the shape: the selection moves *along* one control rather than lighting up one of four. It
is sized to its content and centred rather than stretched to the dialog width, so it reads as one
object sitting under the scrubber. On phones the segments tighten instead of wrapping — a segmented
control on two lines stops looking like one track, and the labels at that padding measure well inside
the ~320px a 360px phone leaves.

Selected segments take `color: var(--surface)` rather than `#fff`, which fixes a **dark-theme contrast
failure**: the accent flips to a pale blue (`#8ab4f8`) there, and white text on it is unreadable.
`--surface` is already near-black in dark and white in light, so one declaration is correct in both.

**Pressing compare pauses playback.** Reaching for the divider means you have found the frame you want
held against the live one, and playback would carry it away a second later — the same reason dragging
the scrubber stops it.

**Changing range does not.** A range is a zoom level on one timeline, not a different thing to watch,
so widening it mid-clip should widen what is playing rather than end it. The run restarts at the
oldest frame of the new range, which is what reaching for a wider range was asking to see. The play
loop carries a `frames.length < 2` guard for the same reason: the range can now change underneath a
running clip, and an empty one would make the loop a modulo by zero — landing `NaN` in the scrubber
and freezing the picture mid-play, which looks exactly like the bug this change fixed.

**Opening a camera starts the clip.** Not "resumes where you left off", not "waits for play" —
`openTimeline()` plays as soon as the range is set. Opening a camera full-screen *is* the request to
look at it properly, and the archive is the only thing in this dialog that has to be set in motion to
be seen at all: a still that opens paused is indistinguishable from a camera with no history behind
it, which is exactly what the lightbox was before the archive existed. The asymmetry is the point —
stopping it costs one press with the control already on screen, while finding out there was anything
to play cost a press nobody knew to make.

**Changing range starts one too.** Picking "week" is asking to see the week, not to be handed a single
still from the far end of it and left to find the play button — and `setRange()` has already parked
the scrubber on the oldest frame in the new window, which is precisely the start of the clip that was
just requested. So a range press plays it. Guarded twice: `!timer`, because calling the toggle on a
running clip would *stop* it and undo the paragraph above; and `ab.hidden`, because while comparing a
range press is choosing which past frame to hold against live, and a clip would carry it away a
second later — the same reasoning as the compare button pausing first.

The bar is **hidden entirely** unless the archive holds at least two frames. A disabled scrubber over
a single frame explains nothing its absence doesn't — and that is also what the static GitHub Pages
build gets, where there is no PHP to have stored anything. The camera id is read back out of the
image URL (`?cam=<n>`) rather than threaded through two call sites in markup: its absence is exactly
the condition under which there is no archive to offer.

### A/B compare

One toggle. On, the **scrubbed frame** is laid over the live still and clipped to a draggable divider,
each side labelled with its own time — a timestamp against `live`.

**The fixed side is the present, and the moving side is the past.** The base image holds the live
still — the picture the lightbox was opened on, so the one thing already familiar — and the clipped
side scrubs and plays over it. Every scrubber position reads as "then, against now", and playing a
range slides the past across a present that stays put. It was built the other way first, with a fixed
*oldest* frame and the present moving over it, which compared two unfamiliar pictures and silently
moved the reference every time the range changed. The ranges now only decide how far back the moving
side can reach, which is the one job they should have.

Putting the fixed image on the **base** rather than the overlay also steadies the box: `.stage` is
sized by the in-flow base image, so a base that never changes is a stage that never resizes
mid-playback.

**Only while comparing, though.** With the divider off there is no overlay on screen, so the base
image is the only thing there is and it has to be the one that moves — otherwise scrubbing with
compare turned off would change the timestamp and nothing else. `paint()` therefore branches on
whether the divider is up, and `setCompare()` repaints in **both** directions: switching compare off
has to hand the moving frame back to the base image.

Two places park the scrubber on `live`, and live is now the fixed side, so both had to learn to land
elsewhere while comparing — otherwise the toggle lays the picture over itself, which reads as a broken
divider rather than an empty one. Turning compare on jumps to the oldest frame in range; changing
range while compare is up lands on the oldest frame of the *new* range, which is what "further back"
was asking for anyway.

One ordering consequence: because `setCompare()` now repaints unconditionally, `reset()` clears `cam`
and `frames` **before** calling it. `openTimeline()` resets first, and by then `ui.js` has already put
the new camera's live still in the img — a repaint still carrying the previous camera's state would
overwrite it with a frame from the last one. `paint()` returns early without a `cam` for the same
reason.

Both frames come from one camera and share an aspect ratio, so matching `height: 100%` lines them up
on both axes; no measuring, no resize listener. That survives the `SHOT_W` change too — frames
captured at 1024×576 sit in the archive beside new ones at 1280×720, and both are 16:9. The drag is on the **whole stage**, not the 2px
divider, because a 2px drag target is a target nobody hits on a phone — pointer events, so mouse and
touch are one path. While compare is live, a click on the picture no longer closes the lightbox
(`#lightbox.cmp`): there, a click on the picture is the start of a drag.

**`touch-action: none`, and only while comparing, is what makes the drag work on a phone at all.**
A horizontal swipe across a picture is *also* the browser's own pan gesture, and the browser wins it:
a few pixels in it claims the gesture and fires `pointercancel`, which takes the pointer capture with
it and leaves the divider stuck wherever the finger first landed. The rule is scoped to
`#lightbox.cmp` so an ordinary lightbox still scrolls and pinch-zooms like a picture — while
comparing, the picture is a control, and everywhere else it is a picture.

The knob grows to **44px on coarse pointers** (`@media (pointer: coarse)`, by input rather than by
breakpoint — a tablet is a coarse pointer at any width), with the divider line thickened to 3px
alongside it. At 34px the knob is smaller than the finger resting on it and the 2px line vanishes
under the same finger, so nothing on screen says where the divider is at the moment you are moving
it. 44px is the WCAG 2.5.8 target size. The knob is still **decoration** — the drag target remains
the whole stage, which is the only target that was ever big enough.

The stage carries `user-select: none` and its images `-webkit-user-drag: none`, because a drag across
a picture already means two things to the browser — select it, or pick it up and carry it. Without
these the divider tracked the pointer correctly while a blue selection wash spread over both frames
and a ghost of the image trailed the cursor. `setPointerCapture` does not prevent either: it routes
the events to one element without claiming what they mean. Same root cause as the About egg turning
blue, and the same one-line fix.

*Trade-off accepted:* capture runs at the **end** of a refresh, inside the lock, after the payload is
already on the wire. With no `fastcgi_finish_request` under Herd the connection cannot actually be
closed, so **one poll in six takes several seconds longer**. That is the cost of having no background
worker; a cron on `api.php` would spend it where nobody is watching.

*Not built:* re-encoding older tiers smaller (a weekly frame from eight months ago does not need
720p — it would roughly halve the archive, at the cost of a second encode pass on every prune);
per-camera opt-in recording; and exporting a range as a video.

## The header alert ticker

`js/ticker.js`, `#ticker` in the header, centred between the title and the controls. Everything currently on alert,
scrolling right-to-left on the stock-ticker convention, rebuilt on every poll.

**Why, when the alert panel already lists these:** the panel lives on the map, and the map is the
thing you cover with a popup, a table, the drawer or the lightbox. The header is the one strip that
is never covered, so this is the layer that keeps saying *two rivers are at danger* while you are
reading something else. It carries **no information the panel does not** — deliberately. It is a
reminder, not a source, and anything only available here would be information hidden in an
animation.

Decisions:

- **Unfiltered by the district picker**, like the toast and unlike the panel. The panel is a list
  you went looking at; this is ambient. A filter set to tidy the map is not a request to be told
  less about rivers reaching their danger mark.
- **`aria-hidden`.** The same stations are in the alert panel as a real list; a screen reader gets
  them there rather than as an endlessly repeating strip.
- **Ordered by place, not by severity.** District first, then `dkey()` (state|district) as the
  tiebreak, then siren-then-ratio within a place. The panel is worst-first because you read it
  deliberately, top down; the ticker is read a glance at a time, so what matters is that alerts in
  the same district arrive as a run rather than scattered across the lap. Each item carries its
  district, so the run is legible rather than merely present. **Sorted, not grouped** — no headers,
  no merging, every item is still one clickable station.
  District names collide across states (KL and Selangor both have a Gombak), so the `dkey()` tiebreak
  keeps each state's stations together *within* a shared district name rather than interleaved —
  they still read as one run, which is the accepted cost of sorting on the district rather than on
  `state|district`.
- **Quiet is a state, not an absence.** Nothing on alert renders a centred grey *No alerts* card
  with the animation off. A ticker that empties itself looks broken, and on a flood map "broken" and
  "nothing is happening" must never look the same. Stillness is the message: the strip moves when,
  and only when, there is something to report.
- **Seamless loop by doubling.** The strip is rendered twice and translated exactly `-50%`, so the
  second copy lands where the first began. That only holds if one copy is at least as wide as the
  box, so the item set is first padded out by repetition (`reps = ceil(boxWidth / oneCopyWidth)`)
  and *then* doubled. Measured with `scrollWidth`, not guessed: one alert needs several repeats, ten
  need none. Duration is floored at 8s — measured before the webfont lands, `scrollWidth` can come
  back tiny, and a near-zero duration flickers rather than scrolls.
- **`MIN_TILES = 3`.** Width alone was not enough. A single alert wide enough to cover the box still
  *popped*, because with one tile on the belt the item leaving the left edge is the whole strip
  leaving — nothing follows it until the loop restarts. Padding to at least three tiles guarantees a
  neighbour behind whatever is going out.
- **Fixed basis, not content width.** `flex: 1 1 0`. Sized to content the strip grew
  and shrank with the number of alerts, so the header re-laid itself out on every poll and the bar
  was a different shape in a flood than on a calm day. It is a window onto the news; a window does
  not change size with the news. A zero basis with grow is not content sizing. `flex: 0 1 auto` is.

  **The strip takes what the title and the controls leave, and no share of the viewport.** Three
  rules stood here before this one. `min(58vw, 656px)` stopped at 1131px and then held one
  width across every screen above it. A flat `40vw` and then a flat `50vw` each held one share at
  every width.

  All three sized the strip against the window rather than against the space in the bar. A wide
  screen paid for them in voids. At 2560px a 50% strip left about 370px of nothing on each side of
  it. Each rail took 640px to hold a 280px title and a 176px cluster of controls.

  Measured after the change, at every width from 3440px down to 601px: the controls measure a
  constant 176px, the title rail stops at 300px, the gap either side of the strip holds a constant
  24px, and the strip is everything else. At 1536px it is 960px against the 768px a 50% rule gave.
- **The name of the app closes every set.** With one alert the strip carried that alert and nothing
  else, so a lap was the same tile four times over. That reads as a stuck ticker rather than as one
  river in trouble.

  A second tile gives the eye a seam. One alert now scrolls `LABOHAN DAGANG · Klang Valley Flood
  Watch · LABOHAN DAGANG · …`, and a long list gets one marker per lap.

  It is a divider and not an item. It sits after the map that inserts the advisory, so
  `i % ADVISE_EVERY` cannot land on it.

  It is a `<span>` with no `data-go` and no `data-banner`, so nothing opens, and it restates both
  halves of `.tk-i:hover b` so a pointer neither tints nor underlines it.

  It draws the same lockup as the app bar and the splash. Plain text, then a `<b>` at weight 500 in
  the accent, with the drop in the accent beside it. The name is one `<span>` and not two flex
  items, because `.tk-i` is a flex row with a 6px gap, and a bare text node beside a `<b>` takes
  that gap instead of an ordinary word space.

  `MIN_TILES` counts it, the same as every other tile on the belt.
- **Speed scales with the count.** One lap has to show everything, so a fixed pace means waiting a
  minute to find out whether your river is on the list when 40 stations are up. `pace()` ramps
  `PX_PER_SEC` from 45 upward once the count passes `FAST_FROM` (5), capped at 2×: past that the
  names stop being readable and the ticker is just motion.
- **Fades, not hard edges.** 56px `mask` ramps on both sides, so items dissolve rather than being
  guillotined by the box. A marquee is always mid-item at both edges, so a short ramp there reads as
  a clipped word rather than one still coming into view.

  **Below 600px the ramp is 18px, and for a while only the right edge had one.**

  The strip lost its left fade the day it got a row of its own. The marquee translates `-50%` at
  every width. So a phone guillotined a word on the left the way a desktop does with no mask.

  The ramp stays at 18px rather than 56px there. Two 56px ramps take 31% of a 360px strip.
- **Bounded by the two rails, and centred on nothing.** The bar was centred on the viewport for a
  long time, by two rails of equal width. That itself replaced a right-aligned strip sitting against
  the status chip, which made the header read as a title on the left and one wide cluster on the
  right, with the news the least prominent thing in the bar.

  Centring is what a wide screen exposes. It gives each rail half the leftover whatever it holds, so
  the more screen there is the more of it goes to two rails that need none of it.

  The shape now is a cap on the title rail and a content width on the controls:

  - **`header h1` keeps `flex: 1 1 0` and gains `max-width: 300px`.** The cap stops the rail growing
    past the longest spelling, which measures 282px.
  - **`header .hactions` is `flex: 0 0 auto`.** The controls are worth what they measure.
    `justify-content: flex-end` has no slack left to act on and stays as a guard.
  - **`#ticker` is `flex: 1 1 0`.** It is the only item that grows, so it takes the free space.

  **The cap goes on the rail and never a basis on the strip, and the container query is the reason.**
  `container-type: inline-size` collapses an element whose width comes from its own content, so this
  rail never takes its width from its content. `header h1 { flex: 0 1 auto }` draws no wordmark at
  all. A zero basis with grow keeps the width in the flex algorithm, which is what containment needs.

  **`margin-left: 8px` is gone from the strip.** It existed only to correct the centring: the header
  pads 8px left and 16px right, so equal rails put the middle of the strip 4px left of the middle of
  the window, and 8px of margin split between the rails moved it back. Nothing is centred on the
  window now. The header's own `gap: 12px` holds the strip off the title.

  **`margin-right: 16px` rides on top of that gap, so the strip stops 28px short of the controls and
  12px short of the title.** The two sides are not symmetric on purpose. The title is text that ends
  where it ends, and the controls are a row of 40px targets. A strip that stops as close to a button
  as it does to a word reads as though it belongs to that button.

  Margin and not padding. The fade is a `mask` over the whole box. Padding puts the last 16px of the
  right ramp inside the padding and shortens the visible fade. Margin moves the box and leaves the
  ramp measuring what it says.

  It still fails safely. Both rails carry `min-width: 0`, so the title gives way first and steps the
  wordmark down a rung. Below 601px the two rails share line one and the strip has a row of its own,
  where none of this applies. With the go-to box open the controls grow to 422px and the strip gives
  up the difference. Measured at 1536, 900, 700 and 601px, the header never overflows.
- **Hover pauses it** and the items are buttons that jump to the station. A moving target you cannot
  catch is a link that isn't one. Clicks are delegated once, because the strip is rebuilt every poll
  and holds several copies of every station.
- **`prefers-reduced-motion`** stops the animation and makes the strip horizontally scrollable
  instead. Continuous self-scrolling motion is a textbook nausea trigger.
- **Mobile** pushes it to a second header row (`flex: 1 0 100%`) and `--hdr` goes 64px → 100px. On
  one line it got whatever was left after six controls — about 40px, which is not a ticker, it is a
  keyhole.

## New-alert toast

`js/toast.js`, `#toast`, under the "go to" box. Fires from `load()` only — **after** `alerts()`, and
never from the filter path, because hiding a district must not read as stations going on alert.

`seen` starts `null` and the first poll seeds it silently: landing on the page during a flood should
not fire a toast for a situation that was already there before you arrived. After that, only
stations that crossed into `isHot()` since the last poll are announced, at most `LIST` (3) by name
plus a count. Twelve seconds, cleared on hover so it can be read and clicked.

**Desktop only** (`display: none` under 600px). On a phone the map is small and the alert panel is
already a full-width sheet; a toast would cover the thing it is telling you about.

`isHot()` lives in `js/util.js` precisely so the panel, the toast and the ticker cannot drift apart
on what counts as an alert.

## Test mode

`js/test.js`, toggled from the About dialog, held in `state.test` — **session-only, cleared by a
reload**. It used to live in `PREFS` with every other setting, which meant a fake flood could be
inherited by a later visitor who never asked for one; the badge explaining why the map is on fire is
easy to read as decoration. A reload is the first thing anyone tries, so a reload has to clear it.

Most of this app only shows its real face during weather that happens a few times a year — the
ticker cycling, the toast firing, the alert panel filling past its scroll, red pins clustering, the
heatmap actually glowing. Waiting for a storm to find out that a panel overflows badly is not a
testing strategy.

- It rewrites the **client's copy** of the payload, after the fetch and before anything renders.
  Nothing is sent anywhere and nothing reaches `.history.db`, so a drill cannot pollute a trend; the
  next poll with the switch off is clean data again. Nothing downstream knows it is looking at a
  drill, which is the point — the drill exercises the real code.
- **Deterministic, not random:** every 4th eligible river over its danger mark, every 3rd of the
  rest made to climb, every 9th siren triggered, every 5th rain gauge raining, every 11th station of
  any kind knocked offline. "Does the panel scroll right at 40 alerts" is a question you can ask
  twice and get the same answer to. On the current payload: 24 rivers at danger, 24 climbing, 17
  sirens sounding, 33 gauges raining, 51 stations off the network.
- **Rain falls as a storm cell**, not as a stripe of every class in station order. Bands of km from
  central KL map to the four JPS intensities (≤10 → 75 mm/h, ≤20 → 42, ≤35 → 18, ≤55 → 4, dry past
  that), so all four classes still appear — 6 violent, 6 heavy, 11 moderate, 5 light on the current
  set — but with a shape. Cycling them by index put violent rain next to light rain the length of
  the state, which is not weather, and it made the rainfall heatmap *look* broken in exactly the way
  a real bug does, since one violent gauge's blob covers its light neighbours. The cell has a dry
  edge deliberately: a storm with no edge is just a wet state, and the gradient is the thing being
  looked at. `status` is *set*, not left to be derived: the client never recomputes it — the pin
  colour, the popup's band and the heat weight all read that one field — so a fake that moved only
  `hourly` would contradict itself.
- **Offlining runs first, before anything else is faked.** Every seeding branch requires `s.online`,
  so an offlined station falls through and stays offline, and the two fakes can never land on the
  same station — no bookkeeping needed to track which ones the flood already claimed. Worth faking
  because "offline" is a whole rendering path (grey pins, the `OFFLINE` block, `NOT CURRENT` in the
  panel) that otherwise only appears on whichever stations happen to be down that day.
- The rising branch derives `rate` from a **target ETA** rather than using a fixed m/h. A flat rate
  means the flag depends on river size — 0.35 m/h reaches a 0.9m drain in half an hour and a 6m
  river in seventeen, so a fixed rate lit only 8 of 26 and left the rest silently climbing.
  Spreading the target over 0.5–2.5h also gives the ticker and panel a range of countdowns instead
  of one repeated number. Measured after the fix: 27 rising, 69 alerts across 15 districts.
- A fake 24-point rising `history` is written too — a flat sparkline under a station claiming to
  climb is the sort of detail that makes a screenshot useless.
- **Loud about itself**, deliberately more than once: a red-striped app bar, a fixed `#testbadge`
  over the map with a *Turn off* button, and the status chip reading `test mode` in amber, outranking
  every real state. A single badge is a thing you stop seeing after ten minutes, and mistaking a
  drill for a flood is the worst failure this app could have.

## About dialog

Was an "info" button showing sources. Now `About`: what the app is, why it exists, the disclaimer,
the three feeds, and credits (author, MIT licence, tiles/data/icons/Leaflet attribution). `LICENSE`
added at the repo root.

- The **logo is the heading** — the drop and the two-line wordmark on their own centred line. "About"
  over the top of them would be a title for a title.
- **The disclaimer is a highlighted notice**, not a third muted paragraph: warning icon, amber left
  rule, 10% amber tint, full-strength text. It was the third grey paragraph in a row, which made the
  one line carrying actual safety and legal weight the easiest to skip.
  This is a **deliberate exception to the status-colour rule.** Amber here is not standing in for a
  reading — no station is involved. It is the same "what you are looking at is not what it appears
  to be" signal as the test-mode strip, which uses the same `#e8710a`.
- **Test mode sits beside the close button**, because it is a mode and not a setting: the two things
  you want within reach of each other are "turn the pretend flood on" and "get out of here".

### The egg

Seven taps on the About logo inside five seconds pops `img/egg.webp` open, chromeless, on a dim
backdrop — scaling up from 40% with an overshoot past 100% before it settles. Tap anywhere to
dismiss, but **not until the pop has finished**.

**That hold is not polish, it is a fix.** The gesture is seven fast clicks, so an eighth is usually
already travelling when the dialog appears, and it lands on the thing that just opened — the reward
for finding a secret was one frame of it. `EGG_HOLD` (1.5 s) is a plain timestamp comparison against
when it opened.

It is set to **outlast the 0.45 s pop by a wide margin on purpose**, and that is why it is a number
rather than a hook into the animation. An earlier version asked the browser whether the animation was
still running, which is tidier and answers the wrong question: it protects exactly as long as the
flourish happens to last, so shortening the animation would quietly shorten the protection. The hold
is not waiting for the animation to finish — it is holding the picture still long enough to have been
looked at, which is the only reason it is on screen at all. Two independent numbers, correctly.

**Esc is deliberately left alone.** `<dialog>` closes on it natively and that stays true from the
first millisecond. A modal you cannot leave when you want to is a trap, and this one is a joke —
the hold may cost a stray click, never an exit.

Reduced motion drops the scale and keeps the fade: the overshoot is the part worth removing, and an
opacity ramp is not the motion that setting is asking about. It cannot affect the hold either way.

**Both the logo and the picture carry `user-select: none`, and that is not cosmetic.** A gesture
built out of fast repeated clicking runs straight into the browser's own click counting: the third
click of any burst is a triple-click, which selects. On the logo that drag-selects the wordmark; on
the picture it lays the blue selection wash over the image. The hold makes the second one worse
rather than better — nothing happens for 1.5 s, so the natural response is to click again, and the
one surface here that exists purely to be looked at turns blue while being looked at. Any future
control driven by a multi-click gesture needs the same rule.

**Why it is in the About dialog and nowhere else.** That dialog is the one surface here carrying no
reading, no warning and no alarm — nothing a person could be acting on. Everything else is either a
measurement or a claim about a river, and a joke that fires near those is a surprise on a screen
whose entire job is that nothing on it is a surprise. The logo is also inert: it is a heading, not a
control, so nothing is displaced and no affordance is overloaded. It keeps no hover state and no
pointer cursor for the same reason — the day it starts looking clickable it has cost something.

**The gesture is a rolling window, not a counter and a timer.** `taps = [...taps, Date.now()]
.slice(-7)`, then fire if the seventh is within 5 s of the first. There is no interval to arm, clear
or leak, and nothing has to decide when to "give up" and reset — tap slowly for a minute and the old
timestamps simply fall out of the window. `slice(-7)` is the entire state machine. Verified against
the cases that matter: six taps do nothing, seven spread over six seconds do nothing, seven fast taps
after a long idle spell still fire, fourteen fast taps fire exactly twice, and a span of exactly
5000 ms is excluded (the test is strict `<`).

**It hides itself when the picture is missing.** The `<img>` loads eagerly at page load, so a 404 is
known long before anyone earns the egg; `onerror` sets a flag the gesture checks. Without it the
reward for finding a secret would be an empty box holding a broken-image glyph, which is worse than
no secret at all. It also means the mechanism could ship before the picture did.

`img/` is the only optional directory in the build, so the Pages workflow copies it **conditionally**
— `[ -d img ] && cp -r img site/ || true`. An unconditional `cp` of a missing directory fails the
step, and a failed bake leaves the last deployment in place: the map would freeze on stale readings
because a decoration was absent. Nothing that can go missing may be able to stop the map updating.

## `--hdr`

Header height as one custom property on `:root` (64px, 100px on mobile where the ticker takes a
second row). Seven separate top offsets — drawer, legend, alerts, go-to box, toast and the rest —
had the header height baked in as a literal, so changing it meant finding all seven. Now they read
`var(--hdr)` and the mobile block redefines the variable once.

## Heat only where it means something

The heat layer used to paint every river with a reading: weight `level / danger` from 0 up, with a
`> 0.1` cut. On a dry day that is a warm wash over the whole valley, which reads as "everywhere is
somewhat flooding" and therefore as nothing at all. Now the bottom `HEAT_FLOOR` (0.9, `config.js`)
of the scale is discarded — a station under 90% of the way to its own danger mark contributes no
point — and the full gradient is spent on what is left. Blank map means blank map.

Two consequences that had to move with it:

- The gradient opens at amber, not blue (`heat.js` and `#legend .ramp` — change both together).
  Blue at the floor would say "calm" about a station already at 90% of danger.
- Legend ticks are now `90% / 95% / danger`, and the tip says what is being cut.

The reading itself is now "whichever sensor here is closest to its own mark", not "the river":
a flood gauge's `depth / danger` (spDanger, 0.3 m over the spot it watches) counts the same as a
river's `level / danger`. A gauge already under water next to a river with headroom is exactly the
case where the river-only version stayed cold. Both go through `hasInfo()` first — the gotcha about
offline gauges frozen on April's 3.55 m flood reading becomes a permanent hotspot otherwise, and
the old river-only path had no such check because rivers are less often stuck.

The `eta` scaling is unchanged and still applies *before* the floor, so a station climbing fast
crosses into view earlier than its bare level would. It cannot work the other way: the `min(1, …)`
clamp means a station at or past its mark is full red whatever its rate is doing. Arrived-and-now-
swaying publishes no `eta`, and a river that has already reached danger is not the safer of the two.
On the current cache: 30 of 682 stations paint.

## Alert design standard

Adopted 2026-07-22 after an audit of every alert surface (panel, ticker, toast, pins, heat) against
the three literatures that govern this. **Anything new that alerts is checked against this list
before it ships.** The point is not compliance for its own sake: this app's failure mode is not a
broken layout, it is becoming trained-ignorable, and every rule below exists because a real warning
system got ignored.

**[CAP 1.2](https://docs.oasis-open.org/emergency/cap/v1.2/CAP-v1.2-os.html)** — the international
alert format. Keep the axes separate: `severity` (how bad) is not `urgency` (how soon) is not
`certainty` (**Observed** vs Likely/forecast). Alerts carry an action (`responseType`: Monitor,
Prepare, Avoid, **AllClear**) and can be withdrawn (`msgType: Cancel`). Headline ≤160 chars.

**[ISA-18.2 / EEMUA 191](https://www.processvue.com/resources/alarm-management-guidelines/)** — the
control-room discipline that exists because operators learned to ignore 3,000-alarm consoles. An
alarm is only an alarm if **a response is required**; rationalizing an existing set normally deletes
30–60% of it. Target under 6 per hour; **more than 10 in 10 minutes is a "flood"**, treated as a
system failure rather than a busy day. Priority must be distinguishable at a glance and must not be
flat.

**[PADM](https://link.springer.com/chapter/10.1007/978-3-030-98989-7_3) and the
[cry-wolf literature](https://hess.copernicus.org/articles/26/4265/2022/)** — a warning states who
is at risk, where, when to act, what to do, and who says so. People **mill**: they seek confirmation
across channels before acting, so consistency and outbound links beat loudness. Consecutive false
alarms erode trust far enough that damage rises *despite* later accurate warnings — a threshold is
only defensible if the false-alarm cost was priced into it.

### Already compliant — do not regress

- `RISE_FLOOR` was set from the measured p90 of ordinary fluctuation in our own samples, which is
  cry-wolf cost priced in explicitly.
- `eta` is published whenever a station climbs at all, flagged or not: the cutoff is inspectable
  rather than asserted.
- One `isHot()` drives panel, ticker, toast and heat — cross-channel consistency by construction.
- Every station names and links its source, which is what milling needs.
- Quiet is stated, never implied ("No alerts", "All clear in…") — EEMUA's distinction between *no
  alarms* and *alarm system dead*.
- Per-sensor **ignore** is the one alarm-suppression control on the page, and it carries two
  permanent indications (the drawer panel, the `· N ignored` count) plus an explicit note in the
  all-clear when a silenced sensor is itself on alert. **Open gap:** ISA-18.2 shelves alarms with a
  *time limit*; this one does not expire. See "Ignoring a sensor" above for why, and reopen it if a
  fifth alert surface ever lands.

### Three tiers, not one bucket

All four gaps found in the audit are now closed. The change that carries most of it is `tier()` in
`js/util.js`, beside `isHot()` so nothing can drift from it:

| tier | what it is | CAP | rendered |
|---|---|---|---|
| `now` | river at danger, siren sounding | Observed / Immediate | red rule, `HAPPENING NOW` |
| `soon` | rising, forecast to reach danger ≤3h | Likely / Expected | amber rule, `FORECAST` |
| `stale` | on alert, but offline or a reading over 24h old | — | grey rule, `NOT CURRENT`, dimmed |

Lumping the first two is precisely the flat priority distribution ISA-18.2 names as the reason
operators stop reading their own console. They are different on **two** axes at once — certainty
(observed vs projected) and urgency (now vs within hours) — and rendering them identically threw
both away.

**`stale` is deliberately still an alert.** The tempting fix was `&& s.online` in `isCritical()`,
which *drops* it — and a river sitting at its danger mark whose telemetry has just died is the last
thing that should quietly disappear from the list. That is silence rendered as safety. So it stays
listed, sinks below everything actionable, drops out of the counts and the tab colour, and says why
in words. Staleness is decided by `isStale()`, which is the same rule the popups already drew
`NOT CURRENT` from — shared, so the two can never disagree about whether a station is trustworthy.

The card used to carry a second `LAST KNOWN — NOT CURRENT` bar under the reading as well as the
`NOT CURRENT` tag above it. Dropped: it restated the tag a few lines further down and its own label
was a tautology — a last-known reading is what an offline station *has*. The sentence underneath it
stayed, because that is the part carrying information the tag cannot ("the situation there may have
changed either way"). The tag, the grey rule and the dimming still mark the card, so nothing that
tells the reader this reading is untrustworthy was removed — only the duplicate of it.

Applied to all three surfaces: the panel sorts by tier before distance (nearest-first is the better
order *within* a tier, but across tiers it puts a forecast two streets away above a river already
over its mark), the ticker colours the *reason* rather than the icon (the kind colour is what makes
a river a river — the traffic-light ramp stays reserved for status), and the toast headline now
says which kind: `1 at danger, 2 forecast to reach it`, not `3 stations have gone on alert`.

### What to do, and when it's over

**The action line lives on the ticker, and only there.** *In danger? Call 999* plus a link to
[APM's flood emergency line directory](https://www.civildefence.gov.my/talian-kecemasan-bencana-banjir/)
— every state's number, kept current by the agency that answers them. CAP's `responseType` for this
is **Monitor**: we have no authority to tell anyone to evacuate and must not imply otherwise.

The ticker rather than the alert panel, because the panel is the thing that gets scrolled, collapsed
or covered, and the strip is the one that doesn't. In both it would read as furniture.

**It appears on exactly the condition that speeds the strip up** — `hot.length > FAST_FROM`, the same
threshold `pace()` uses. Not arbitrary twice over: the speed-up exists because the list has grown
long enough that one lap is a wait, and a list that long is also the point where "which of these is
about me" stops being obvious and a phone number starts being the useful thing on screen. Below it
the strip is calm, and a standing hotline banner is the sort of permanent warning nobody reads by the
second day. It is inserted *inside* the repeated item set, because the `-50%` loop requires every
copy to be identical.

**One at the head of the set, then one every `ADVISE_EVERY` (25) alert items.** Under twenty-five
that is the single leading copy and nothing else. Past that it repeats, because a sixty-item lap
would otherwise carry the number past once and bury it under a minute of telemetry — the wrong way
round, since the longer the list runs the likelier the reader is someone who needs a phone number
rather than a water level. Measured: 8 → 1, 24 → 1, 25 → 1, 26 → 2, 50 → 2, 69 → 3.

The same directory is linked from the About dialog's disclaimer, where it is not conditional. Both
read the URL from `HOTLINES` in `config.js`, so the two can never drift to different numbers.

**All-clear.** `toast.js` already kept `seen`; it now also keeps `seenNow`, so stations leaving the
`now` tier are announced in green. Two exclusions matter more than the feature does: a station that
went **stale** has not cleared — its telemetry died, and "back below danger" would be an actual lie
— and a station that has vanished from the payload entirely cannot be checked, so it is left alone
rather than declared safe.

### Alarm-flood control

ISA-18.2 calls more than ten alarms in ten minutes a system failure, and its remedy is not to
interrupt faster — it is to **stop interrupting and defer to the overview display**.

- Above `FLOOD_N` (10) stations on alert the toast goes silent entirely. The panel has sprung open,
  the ticker is running and the map is red; a popup repeating all three is only in the way. The
  ledger is still advanced, because the news is being delivered, just not by a toast.
- Below that, one interruption per `COOL_MS` (10 min). During a cooldown `seen` is deliberately
  **not** advanced, so anything held back is still new next poll and lands in the following toast
  rather than being swallowed.
- Bad news outranks good: a poll with both fresh alerts and all-clears leads with the alerts.

*Not adopted:* modelling `certainty`/`urgency`/`responseType` as actual payload fields. This is a
viewer, not an alert originator; the two-tier observed-vs-forecast split gets the same benefit
without the ceremony.

### A siren's alarm is checked against the water

A siren was the one alert in this app taken purely on trust. It publishes 0 or 1 and no scale, so a 1
was read as sounding. Following the archive, that was wrong nearly every time it mattered.

Every siren alarm on record, cross-referenced against the rivers around it at the time:

| siren | held 1 for | nearest river | its level | its Amaran mark |
|---|---|---|---|---|
| KG. MELAYU SUBANG | 127 h | 0.01 km | 34.28 m | 36.15 m |
| SIREN PEKAN BANTING | 37 h+ | 4.26 km | 1.68 m | 2.70 m |
| SIREN TMN. SRI MUDA 2 | 3.7 h | 0.44 km | 1.76 m | 4.70 m |
| BATU TIGA SHAH ALAM | one poll | 0.02 km | 5.51 m | 5.00 m |

Fifteen of the seventeen had no river near them within reach of its warning mark. Two did, both at
Batu Tiga on 31/07, and those are the two this app should be shouting about.

**The rule comes from JPS, not from us.** A siren sounds for one minute at the Amaran mark and
repeats every 3 hours while the water stays there, and at Bahaya it sounds on a higher note and
repeats every 5. So the alarm is a claim about a river level — and the river levels are already in
the payload. `sirenBacked()` in `api.php` asks them: `backed` is true when a river within `SIREN_KM`
(5 km) stands at Amaran or above, false when there are rivers in reach and none is, and **null when
there is no river within 5 km to ask**. `sounding()` in `util.js` reads `backed !== false`, so the
null case keeps the benefit of the doubt. Silencing a real evacuation alarm is far worse than
carrying a doubtful one, and 194 of 212 sirens have a river inside 5 km — 133 inside 2 km — so the
unanswerable case is 18 stations, not a hole in the middle of the feature.

**Duration was tried first, and it is wrong in the direction that matters.** The first cut called a
siren stuck once it had read 1 for more than 6 hours, which the archive supports: real events ran 0
to 4 hours and faults ran 29 hours to 5 days. Then JPS's repeat cadence arrived. At Bahaya the alarm
repeats every 5 hours *for as long as the water is up*, so a genuine flood holds a siren on all day,
and any cutoff short enough to catch the stuck ones would have thrown away the real one. A rule that
fails safe on ordinary data and dangerously on the worst day of the year is not a rule. The water is
what the siren is claiming, so the water is what gets asked.

**Both reds read it** — `isCritical()` for the alert path and `atDanger()` for the map. This is the
one narrowing that deliberately moves every alert surface at once: the panel, the icon badge, the
ticker, the toast and the pin colour all stop firing on a stuck relay together. Leaving the map red
would have put a red pin beside a panel refusing to list it, and a reader would be right to trust
neither.

**What it fixed.** The app bar's warning glyph has three rungs — grey, amber for a forecast, red for
something observed — and the amber one was unreachable. Any one of 212 sirens latched anywhere in
Selangor made every day red, so the colour carried no information and the panel's own forecast tier
had no colour of its own on the button. On the payload this was written against, the count went from
1 to 0 and the glyph from permanently red to correct.

**The card still reports what the station reports.** A doubted siren shows `TRIGGERED` in the off
tone, its 12-hour band, and one line: *Faulty signal. No river nearby is high.*

That line is written for someone standing near the siren, not for someone reading the rule. It said
"no river within 5 km is at its warning mark, which is what makes a siren sound — read as a stuck
relay and left out of the alert list", which is three clauses of plumbing that never answer the only
question being asked, which is whether there is a flood. `5 km`, `warning mark`, `stuck relay` and
the alert list are our vocabulary for our own bookkeeping. What a reader needs is the verdict first
and one fact behind it. The verdict is still ours and still checkable — the rivers are on the same
map, one tap away.

**No hedge.** The line said *probably* a faulty signal for one draft. The writing standard bans the
word, and this screen is a second reason to. The judgement has already been acted on — the station is
out of the alert list, off the icon badge and off the ticker — so a hedge on the one screen that
explains that decision hides it rather than qualifies it. State it, and leave it open to check.

**The rest of the interface was swept the same way.** The siren line was not the only string written
from inside the system. Three rules came out of it, and they are now in `CLAUDE.md`.

*Sentence case.* Every rendered string opens with a capital. The small `.muted` helper lines were all
lowercase fragments. `no level reading`, `no camera feed`, `accurate to about 40 m` and `nearest
reporting station per sensor` read as labels rather than as anything addressed to a person.

*None of our vocabulary.* The splash said `contacting the proxy…`, which names a piece of our
architecture to someone watching a loading screen, and `a cold start rebuilds the whole station
list`, which is our word for our own cache being empty. They now say `Contacting the server…` and
`Still waiting on JPS. The first load reads every station, water level, rain gauge and camera. This
can take up to 20 seconds.` Three graphs said they build `as we poll`, which describes our timer.
They say `Graph builds as readings arrive`, which describes what the reader will see.

*Consistent voice in a list.* The toast's reasons were lowercase fragments, such as `at danger` and
`stopped reporting`. They are sentence case now, beside the station name they belong to.

**Not swept: the ALL-CAPS state blocks.** `TRIGGERED`, `HEAVY RAIN`, `DRY GROUND`, `HAPPENING NOW`
and the rest are a visual language — one word, centred, colour-coded, doing the job a badge does.
They are not sentences and sentence case would make them look like unfinished ones. The glossary
terms in the About dialog stay lowercase for the same reason: they are dictionary headwords.

**The camera archive is asked the same question, per frame.** `?shots=` scores each stored frame
against what the sensors near that camera were doing when the shutter went, and a siren counted as
sounding there on the same trust the live path had just dropped. Measured before the fix: 10 of 19
frames on the Pekan Banting camera and 4 of 19 on Kg. Melayu Subang were red from the two stuck
relays, on photographs of calm water. The scrubber is where a reader goes to check what the map
claimed, so a stuck relay surviving there undoes the fix in the one place it is checked.

`$sirenFrames` in `api.php` reruns `frameTiers` over each river within `SIREN_KM` of the siren
against that river's **warning** mark — the same function that scores everything else, so the answer
is "which frames was this river at Amaran for", with no second scorer to drift. The siren's frames
are intersected with that set. The live rule cannot stand in here: a picture from last week has to be
judged by last week's water, which is the same reason `camWarn()` tests `'level' in a` rather than
falling back to the live figure.

Two things carry over from the live rule. No river in reach leaves the frames alone, so an
unanswerable siren keeps the benefit of the doubt. And it runs only for a siren that scored a frame
at all, so the 189 camera-siren pairs within `CAM_ALERT_KM` cost nothing until one of them reads 1.

Across the whole archive — 91 cameras, 1702 frames — this leaves 10 coloured frames: two rivers, and
`siren-1083` and `siren-1020`, which are the 31/07 Batu Tiga pair whose rivers really were at Amaran.
The rule dropped both stuck relays and kept both real alarms.

**Deliberately not done: flood gauges as backing evidence.** Standing water near a siren is a
different network and a weaker claim than the level JPS wires the siren to, and the archive says it
would add nothing. Of the 17 sirens that have ever read 1, six have no gauge within 5 km, and every
one of the rest has **no gauge samples at all** across its alarm window — offline gauges are not
sampled, and there are 36 gauges against 109 rivers. The one exception peaked at 0.08 m, under the
0.15 m warning mark, beside a siren the rivers had already backed. No rejected alarm would have been
rescued.

**Also not done: a per-siren river mapping.** JPS does not publish which gauge drives which siren,
and a hand-kept list is a list to maintain forever, wrong the day a station moves.

### The flood alert and the JPS MET mirror

This work checked `floodAlerts()` and `jpsMetWarnings()` against this standard, the same way it
already checked `metWarnings()` when the first warning surface shipped. Both clear it on the same
ground the MET warning already cleared. Neither carries a coordinate, so both read a place from text
alone. Both name a validity window that already retires the alert, in place of an unmarked flag. Both
count toward nothing: not the alert number, the icon badge, the app-bar glyph, the toast, or the
window title. A notice is a claim JPS makes about an area. A count on this page is a claim this app
makes about a sensor, and the two must never share one total.

**One gap this work leaves open.** `NT_DF` is an official siren notification from JPS, evidence that a
siren sounded. `sirenBacked()` does not read it. It still asks only whether a river nearby stands at
its Amaran mark, the rule "A siren's alarm is checked against the water" above already states. Reading
`NT_DF` gives a second, stronger source for the same question. This work does not build it, because it
changes `sirenBacked()`, which drives `sounding()`, `isCritical()` and two reds on the map. See "Not
built" in "The JPS notice feeds join the warning surface" below.

## Gauge state block, and the siren band

Two gaps in the popup, both about a station carrying a status nobody printed.

**A flood gauge now says its state in words**, in the same `.state` block a siren and a rainfall
station use — `DRY GROUND` / `WATER ON GROUND` / `WATER RISING` / `FLOODED`, with `OFFLINE` taking
the block over when the reading is stale. The gauge was the last kind whose state you had to infer
from a number and a bar: "0.22 m of water" is a fact you interpret, and the bands are the server's
own thresholds (0.15 m warning, 0.3 m danger) so the words, the pin colour and the status code
cannot disagree. Water present but below the warning mark first shipped with **no tone at all**, on
the grounds that a couple of centimetres is neither the green of dry ground nor a warning. That was
reversed — see "A gauge with water on it wears a status colour" below.

**A siren now carries its last 12 hours as a band**, not a graph. Its samples are 0 or 1, so there
is no shape to plot — a polyline would draw ramps up and down that never happened, and a "0–1" axis
is not a quantity anyone reads. The strip answers the question the pin is opened to ask ("has this
gone off today") in one look. Details:

- Quiet is drawn in `--outline`, not green. The state block above already carries the green, and a
  12-hour reassurance is more than a log of samples is entitled to give.
- Gaps over 90 minutes are left blank, the same rule the rain chart breaks its area on: an unbroken
  quiet band across a hole in the record claims silence that was never measured.
- Only online sirens are sampled, for the reason offline gauges aren't — a flat `IDLE` band from a
  sensor nobody can hear is the most dangerous thing this map could draw.
- `sparkPoints()` gained a `$peak` flag for this. Its normal rule is newest-wins per 15-minute
  bucket, which would drop a trigger that started and stopped inside one bucket — for a siren that
  is the single event the band exists to show, so it keeps the highest value instead.
- **The caption is a time, not a tally.** It read `sounded in 11 of 11 readings`, which counted our
  polls rather than the siren. The same siren behind a slower poll would have said `3 of 3` and
  meant the same thing, and neither number says when it went off. The line now reads
  `sounding since 17:15` while a siren is going, `last sounded 14:30` once it stops, and
  `silent for the last 12.0 h` when the window holds no trigger at all. A running siren walks back
  to the start of the run it is still in, so the time names the event and not the newest sample.

Both follow through to the all-stations table. `gaugeState()` is exported and returns a third
element — the pill's short form (`dry` / `water` / `rising` / `flooded`) — so the cell, its tip
panel and the popup all read from one place and a pin can never disagree with its own row. The
siren band joins the river sparkline, the gauge sparkline and the rain chart in the tip panel,
under the same "only where there is history" rule.

*Trade-off accepted:* sirens heartbeat daily, so most bands are 48 identical zeroes and the honest
answer they give is "silent". That is still the answer, and it was previously only inferable from a
timestamp. Storage is full-resolution like every other kind (`ponytail:` note in `api.php` names
hourly bucketing as the upgrade if the table bloats).

## Heat weight is the threshold scale

The heatmap used to be a temperature: weight was `level / danger`, everything under 90% of danger was
thrown away, and the surviving tenth was stretched across the whole gradient and then multiplied by
an urgency term derived from `eta`. It was defensible, and nobody could read it — "this blob is
orange" had no answer in the units the rest of the page speaks.

It now uses the **same piecewise scale as the popup meter**: alert 38%, warning 68%, danger 100%,
via a shared `levelStops()` / `gaugeStops()` in `js/util.js`. The gradient's stops are keyed on those
same numbers, so a blob's colour names the band the station has crossed — **yellow past alert, orange
past warning, red at danger** — and it is the colour its pin and its meter are already showing.
Below the alert slot nothing is drawn.

**A tripped flood gauge goes straight to full red**, whatever its depth. Its warning mark is 15 cm; a
gauge past it is reporting water standing over a spot known to flood, which is an *observation*, and
under CAP's separate certainty axis an observation outranks anything a forecast scale can say about
the centimetres.

Four places now hold one scale and must move together: `HEAT_ALERT`/`HEAT_WARNING` in `config.js`,
the gradient in `heat.js`, the `.ramp` gradient in `chrome.css` (which shows only the visible slice,
so warning lands at 48%), and the meter's own slot numbers in `util.js`.

*Removed, not kept:* the `eta` urgency multiplier, and with it `RISE_ETA`'s client-side mirror. Its
whole purpose was to soften a hard cutoff at three hours, and a colour that means "past its warning
mark" cannot also mean "arriving soon" without meaning neither. Urgency is still on the page in the
places built for it — the alert panel, the `rising` filter, the ETA line in the popup. One fewer
constant to keep in step across the client/server boundary.

**Phone popups are a device-wide sheet whose foot sits just above the heat legend.**
*Superseded — see "The station panel replaces the map popup" below. Kept for the reasoning, none of
the code described here still exists.* On a phone the
popup runs full viewport width (`.leaflet-popup-content-wrapper { width: 100vw }`, content forced to
`auto` over the `minWidth`/`maxWidth` Leaflet stamps from `popWidth()`), is capped to
`calc(100vh - 390px)` and scrolls inside. Placement is deterministic, not autoPan: `popPan()` turns
autoPan *off* on phones, and `keepPopupVisible()` in `map.js` pans the map so the popup's foot — the
pin — lands just above the legend (`POP_LEGEND` 155px up from the bottom), filling the band up toward
the alert panel, clamping the top at `POP_TOP` (200px) so a tall popup can't slide under the header.
autoPan was tried first but its fit-*anywhere* logic left short popups sitting wherever they opened;
pinning the foot is what "right above the heat scale" actually asked for. *Not `position: fixed`:*
the popup pane sits inside a `transform`ed ancestor, so fixed anchors to that pane, not the viewport.
The reserves are guesses off the chrome heights and pair across three files — `POP_TOP`/`POP_LEGEND`
in `map.js`, the `390` cap in `map.css`, both keyed to `--hdr` (85), the alert panel and the legend.

## The station panel replaces the map popup

**Station detail is now `#side`, a fixed panel on the right edge of the viewport.** It is filled by
`openSide(key, html, mastAt)` in `map.js` and holds exactly what the popup held — `sitePopup()` is
unchanged, and so are `meter()`, the sparklines and the ⋮ menu.

The complaint was that the popup appeared unpredictably, and it did, for four separate reasons that
all came from anchoring a card to a marker:

- **It was positioned by the pin**, so where it landed depended on the zoom, the drawer, whether the
  target was already on screen, and `autoPan`'s own nudge afterwards.
- **`autoPan` raced `setView`.** Opening mid-flight composed a `panBy()` into a running pan
  animation and left the view off-centre; `flashTo()` had to wait for `moveend`, and register that
  listener *before* calling `focusOn()` because a long jump fires `moveend` from inside `setView`.
- **Zoom destroyed it.** markercluster rebuilds marker DOM on zoom, so the popup vanished mid-read —
  `openStable()` existed to re-open it on the next `moveend`, and `cluster.zoomToShowLayer()` to
  wait for a clustered marker to have a DOM node at all.
- **Every poll destroyed it too.** `render()` rebuilds all ~430 markers, which closed whatever card
  was open — on a five-minute timer, on the page whose whole point is that it refreshes itself.

None of that is a thing a panel in the page can suffer. All four mechanisms are deleted:
`openStable()`, `keepPopupVisible()` with its `POP_TOP`/`POP_LEGEND` reserves, `popPan()`,
`popWidth()`, the `zoomToShowLayer` dance in `flashTo()`, and the whole `.leaflet-popup-*` override
block in `map.css`. `flashTo()` is now three lines: pin the station, fire the marker's own click,
draw the ripple — so a jump from the alert panel, the ticker, the table or the search takes the same
path as a click on the pin and cannot drift from it.

**The open card is refreshed in place instead of closed.** `render()` ends by re-rendering whatever
site `side.key` names, and closes the panel only if the filters have just taken that place off the
map. `openSide()` resets `scrollTop` only when the key changes, so a poll does not throw you back to
the top of a card you were reading. Keys starting `@` belong to the panel's non-station users
(locate.js's "you are here"), which own their contents and are skipped by that pass.

**The place stays put; only the readings scroll.** The panel is two boxes — `#sideHead` and
`#sideBody` — and `openSide()` moves the card's `.pophead` (name, region, one badge per sensor) into
the first one. A five-sensor mast runs several screens, and a column of numbers whose station name
has scrolled off is unreadable; the badges go with it because "which sensor am I looking at" is the
other half of that question.

`position: sticky; top: 0` on `.pophead` inside `#sideBody` was the first answer and is one CSS line
against three plus a line of JS. It was measured working — computed `position: sticky`, pinned at
the scrollport edge with the body scrolled 600 of 1278px — and still reported as scrolling away.
Rather than keep hunting for what defeated it, the header was moved out of the scroller: a header
that stays put only while nothing in the box breaks sticky is a header that can come loose, and this
one has no scroll to come loose from. The seam is that `.pophead` is always the card's first
element — `sitePopup()` still returns one string and knows nothing about the split.

The × is out of flow over the top-right corner rather than on a header row of its own — a row put it
a whole line clear of the name it closes, above an empty strip the width of the panel. Three numbers
are tied together: the button's `top: 8px`, `#sideHead .pophead`'s `padding-top: 18px` (8 + half the
button's 40 − half the name's 19.5px line) and `.sitecount`'s `top: 19px`.

**The nearest webcam leads the card, as a link.** A camera's own still has always been the first
thing in its card — the picture *is* the reading. Every other kind carries `camLink()` to the closest
one instead, and that link used to sit at the *foot* of the card, below the meter, the metrics and
the sparkline, on the argument that it is an action to take after reading the numbers. On a
five-sensor mast that put it several screens down, and it is the wrong argument anyway: "can I see
it?" is the first question a river level prompts, not the last. It now sits directly under the
header on single-sensor cards and camera-less site cards alike.

*Shown, not offered, was tried and pulled back.* Every card briefly opened with the still itself.
It reads well and it is what the picture is for — but it fetches ~250 KB through the proxy (~0.8 s
at JPS) on every card open, for a camera somewhere else, that you did not ask for. You opened a river
gauge to read a river gauge. The line saying a picture exists and how far away it is, is enough to
decide with. The same reasoning has always kept the alert panel on the link: N stills is N fetches
for places you are scrolling past.

**The one exception is the "you are here" card**, where the camera is not an aside — "what is around
me" is the whole question, and a picture of it is an answer in a way "there is one 3 km away" is not.
That card gets `camNear()`: the still, built as a `.sensor` section like every other kind on it —
camera glyph in camera cyan, the distance in the head where the other sections put it, the place
name (the jump to that camera), then the picture. One card, one fetch, asked for.

**The "you are here" card is a full card now.** It used to be four one-line summaries (`oneLiner()`,
since deleted — it had no other caller) and a link to the nearest webcam at the bottom. One line is
enough to *rank* four stations; it is not enough to answer "is this bad?", which is the question you
open your own location to ask, so every reading sent you off to four other cards to find out. Each
kind now gets the same `.sensor` section a mast's card gives it — meter, trend, ETA, sparkline,
footer, ⋮ — built from the same `sensorBody()`, so the two views cannot drift apart. The nearest
camera's still leads it, as a fifth section (`camNear()` — see above; this is the only card that
gets the picture rather than a link to it).

The one thing this card must say that a mast's need not is **where each sensor is**. On a station
card the header names the place once and all its sensors share it; here the four are four different
places, so each section carries its own name, its district and basin, and how far away it is. The
name is styled as, and is, the jump to that station — it is somewhere else on the map, and having
just been told a siren 3 km away is triggered, going to look at it is the next thing you want.

**Switching stations wipes the card.** The panel opens in the same place every time — which is the
point of it — so clicking a second pin only changes the text inside a box that does not move, and
one card of readings looks much like the next: same badge row, same meter, same footer line. A
220ms fade-and-slide (`#side.swap`, keyframes in `chrome.css`, retriggered in `openSide()`) marks
the change. It is gated twice: only when `side.key` actually changes, so the five-minute poll's
in-place refresh never flashes, and only when the panel is already open, so it doesn't fight the
slide-in. Under `prefers-reduced-motion` the travel is dropped and the fade kept — the feedback is
the whole feature, so it degrades rather than disappearing.

*Considered and not built:* a spinner (nothing is loading — the data is already in hand, and a
spinner would claim a wait that isn't there) and flashing the panel border in a status colour (the
colour language is reserved for severity; a green flash on a station at danger level is a lie).

**`focusOn()` now subtracts both sides.** The drawer takes the left, the panel the right; the shifts
subtract, so the pin lands in the middle of what is left. Skipped below 600px, where the panel covers
the map and there is no strip to aim at.

*Trade-off accepted:* on a phone the panel covers the map below the app bar, where the old popup left
a band of map above and below it. A card that is one tap from dismissal is worth more than a
half-visible map behind a sheet that had to be positioned by hand against the legend and the alert
panel — which is what `POP_TOP`/`POP_LEGEND` were, three files' worth of guessed chrome heights.

**Nothing dismisses the card except the reader.** `map.on('click', closeSide)` was carried over from
the popup and removed again: a popup had to close on a map click because it was attached to a pin,
and a panel is not. It made the card vanish mid-read, and the "you are here" card worst of all —
locate.js draws an accuracy circle around your fix, and a circle is an `L.Path`, which *does* bubble
its clicks to the map (unlike `L.Marker`, which sets `bubblingMouseEvents: false`). At a coarse fix
that circle is most of the viewport, so "click the map" and "click near where I am" were one
gesture. A poll does not close it either — if the place leaves the payload or a filter hides it, the
card is left standing rather than pulled away; every reading in it is stamped and `footLine()` says
how old it is.

That leaves three ways out, all of them deliberate: the ×, opening a dialog that takes the screen
(About, the all-stations table), and the ⋮ → *ignore this sensor*, which is the reader saying they
do not want that station at all. Clicking another pin is not one of them — it *replaces* the
contents. Neither is the lightbox: it is opened from a camera still inside the card, and you come
back to the card when you close it.

**Map furniture on the right steps aside rather than hiding under the panel** — `#toast`, `#credit`
and Leaflet's bottom-right zoom controls translate by `--side` (360px), the same idea as the drawer
pushing the legend and alert panel. The attribution has to stay readable and the zoom buttons usable;
they are not decoration. Not `#map { right: var(--side) }`, which would resize the map and force an
`invalidateSize()` plus a reflow of every layer on a control that opens and closes constantly.

## "Go to a station" moved into the app bar

**The search is collapsed to a magnifier in the header and slides out when pressed.** It used to be
a 300px box parked over the top-right of the map — permanent furniture for a control you reach for
deliberately, charging every visit that never searched for anything the width of it.

`body.finding` is the whole state machine: the box animates from `width: 0` and is `visibility:
hidden` while shut, so the input stays out of the tab order rather than being a zero-width focus
trap. The button **gives way to the field** rather than sitting beside it — a magnifier next to an
open search box is a control with nothing left to do, and on a 360px bar it is 40px the field wants.
So there is nothing to press to close: it collapses on Escape, on picking a station, and on clicking
away (the input's `blur`, on the same 150ms delay that lets a click on a result land first).

Two things had to be got right for "and then focus it", and both failed silently:

- **`visibility` cannot be in the transition.** A transitioned `visibility` interpolates, and at t=0
  of hidden→visible it still computes to `hidden` — so `focus()` was refused on a box the user could
  already see arriving. It is now `visibility 0s .25s`: instant on the way in (the open state zeroes
  the delay), held to the end of the slide on the way out so the fade still plays.
- **The focus has to come after a style flush.** The click that opens the box leaves focus on
  `#find`, which is about to become `display: none` — the browser returns focus to `<body>` when
  that lands, *after* the handler returns, so an earlier `focus()` is undone. Reading `offsetWidth`
  forces both to have happened first. **Not `requestAnimationFrame`:** its callbacks run *before*
  the frame's style recalc, so the box is still hidden there and the focus is dropped just the same.

`#gotoBox` is a direct child of `<header>`, **not** of `.hactions`: at phone width the bar wraps, and
only a direct child can claim a whole row. Open, it takes the ticker's row (`body.finding #ticker
{ display: none }`) rather than adding a third — `--hdr` is a fixed 85px there, and a taller header
would push the map down every time someone looked up a station. Its input is shortened to 34px in
that row to match the height the ticker's had.

Collapsed it is still a flex item paying the header's 12px gap on both sides, hence the `-12px`
right margin that pulls one back.

## Camera stills went through PHP's stream wrapper, and paid a dead DNS record for it

**Symptom:** stills took 21–30 s to arrive, and often never appeared at all — with browsers capping
concurrent connections per host, a card or table full of cameras queued behind six requests that
were each sitting on a stalled socket, and the spinner in `ui.js` (which spins until the image
lands, deliberately, so it never reads as "gave up") span for as long as anyone was willing to wait.

**Cause:** `infobanjirjps.selangor.gov.my` resolves to two A records, `175.143.72.197` (alive, 12 ms)
and `58.27.97.62` (SYNs go unanswered). curl implements happy eyeballs — it races the addresses and
uses whichever answers, so the ~270-request `curl_multi` fan-out that builds the payload never
noticed. `?cam=` was the one outbound fetch in the repo still using `file_get_contents()`, and PHP's
HTTP stream wrapper walks the address list *serially* with no connect timeout of its own, so a bad
draw waits out the operating system's TCP timeout: 21 s on Windows (SYN retries at 3 s, 6 s, 12 s).
The handler then had an https-first / http-fallback pair, so losing both draws cost 42 s.

**Fix:** route it through the existing `fetchAll()` — the same curl path everything else already
used. Two lines, no new dependency, no timeout constant to tune, and the https/http fallback is
kept. Measured 21–30 s → ~0.78 s per still.

Deliberately *not* done: no local cache of live stills (they carry `max-age=60` and the archive in
`shots/` already holds the history), no retry loop, and no pinning of the good IP — a hard-coded
address is a second outage waiting for the day JPS renumbers. The general rule went into the gotcha
list: **no JPS URL is ever fetched with `file_get_contents()`.**

## Installable — a PWA, in five files and no build step

**What:** Chrome offers *Install app*; iOS Safari's *Add to Home Screen* opens it standalone with a
real icon rather than a screenshot thumbnail and a Safari chrome. `manifest.json`, `sw.js`,
`icon.svg` and the two PNGs baked from it, plus five lines of `<head>` and two of `app.js`.

**Why it needs a service worker at all:** installability in Chrome is not just a manifest — the
browser requires a registered worker with a `fetch` handler before it offers the button. So one
exists, and since it has to exist it may as well do the one useful thing here: keep the shell
reachable with no connection, so launching the installed app offline shows *this* app's "NO INTERNET
CONNECTION" screen — which already explains why it will not draw a map from stale readings — instead
of the browser's dinosaur.

**Network-first, cache-as-you-go, and no precache list.** Both are the lazy choice on purpose:

- *Cache-first* would be a third cache-busting ritual on top of the `?v=` on the stylesheets and
  Herd's three-hour `max-age`. Its failure mode is an edit that is live for nobody, silently, until
  a cache name is bumped — worse than a page that loads a few milliseconds slower.
- *A precache list* is index.html's asset list copied into a second file, which goes stale the first
  time a module is added and fails silently when it does. The first page view warms the cache with
  exactly what the page actually requested, which is the same list, maintained by the browser.

**The readings are never cached, at any age.** `sw.js` returns without calling `respondWith()` for
`api.php` / `api.json`, so those requests behave exactly as if no worker were installed, error
handling included. The splash refuses to draw a map without a connection because during a flood an
out-of-date water level is worse than none; a worker quietly answering with yesterday's flood would
undo that from underneath, and from a layer the page cannot see.

**Icons.** The mark in `--accent` blue on transparency, at 86% of the canvas — no plate. It began as
white on a full-bleed brand square, which is the safe answer (opaque, `maskable`-clean, identical on
every backdrop) and looked like a shipped app tile rather than the mark itself. The plate came off;
what follows from that:

- **`purpose` is `any`, not `any maskable`.** A maskable icon is required to be opaque edge to edge —
  the platform crops it to whatever shape it likes and fills nothing. Declaring a transparent icon
  maskable gets it composited on a background of the platform's choosing, which is the one thing a
  deliberate transparency cannot survive. Android now draws it on its own plate, which is what a
  transparent icon is *for*.
- **`background_color` is white, not blue.** It is the PWA splash colour, and a blue glyph on a blue
  splash is nothing at all.
- **The glyph is blue, not white.** Without a plate the icon sits on the browser's tab strip, a
  wallpaper, a launcher — white disappears on half of them and black on the other half. `#1a73e8` is
  legible on both and is already what the header's mark is.
- **iOS gets its own opaque tile, `icon-180.png`.** Safari does not honour an alpha channel in a
  home-screen icon — it flattens it, onto a colour that is not ours to choose and historically
  black, which is exactly the plate that had just been removed. Depending on which colour any given
  iOS version picks is the wrong bet in both directions, so the one platform that cannot do
  transparency is handed a deliberate background instead of an accidental one: white, the app's own
  light surface and the backdrop the blue mark was chosen against. 180px because that is the size
  iOS asks for, and a smaller glyph (66% against 86%) because iOS rounds the corners itself and the
  squircle takes a bite out of anything that runs to the edge.

`icon-192.png` doubles as the favicon; browsers downscale it to 16px perfectly well, and it saves
keeping a second source in step. Three PNGs, one drawing: `icon-build.php` renders them through a
single function, so the tile and the icon cannot drift apart in anything but the two things that are
meant to differ — the plate and the margin.

All four references carry `?v=` — the two `<link>` tags and the two `icons[].src` in the manifest.
The build rewrites the PNGs under the same names, Herd serves them with a three-hour `max-age`, and
a browser will sit on a favicon for very much longer than that; without the bump a new mark simply
does not appear, which reads as "the build didn't work". `icon-build.php` says so when it finishes,
because a reminder that only lives in a document is a reminder nobody gets at the moment they need
it.

## The app mark — one raster, three surfaces

**What:** the logo in the app bar, on the splash and in the About dialog is a flooded house, not the
`water_drop` it used to be. `water_drop` is the *river-station* glyph — pins, legend, popup badges —
so the brand and one of the five sensor types were the same picture, which is the one collision a
map legend cannot afford. The mark now says what the site is about; the drop still says "river".

**Source:** Material Symbols' own `flood` at `fill=1` (Apache 2.0) — the same family as every other
icon on the page, so the mark and the station glyphs are one drawing set with one weight and one
fill. It was a hand-traced Flaticon wave before; that credit has gone from the About with it, and
the Credits line now names Material Symbols once for both.

**One file feeds all three surfaces.** `icon.svg` is the bare glyph on transparency — no
colour decisions in it, because the two consumers want different colours and neither wants the
other's:

- `--i-flood` in `css/icons.css` is those paths as a **mask**, exactly like the Material Symbols
  beside it. `background: currentColor` shows through, so it recolours for free — no dark-theme
  variant, no second file. Inline rather than `url(icon.svg)` so there is no separate asset that can
  404 into an empty logo.
- `icon-192.png` / `icon-512.png` are the same paths in white on the brand blue.

`php icon-build.php` produces both from `icon.svg` and prints the CSS line to paste back. It parses
the `viewBox` and the `d` attributes rather than embedding the file whole, which is what lets one
drawing carry a fill it does not declare. There is still no SVG rasteriser on this machine (no
Imagick, and `convert` on Windows is not ImageMagick), so 512 is a headless-Chrome screenshot and
192 is GD downsampling that — the same two steps as before, now inside the script instead of in
this document.

**Trade-off accepted:** the mask is pasted into `icons.css` by hand rather than `@import`ed or built.
That is one manual step on an icon that changes approximately never, against a build step on a repo
whose whole point is not having one.

**Deliberately not done:** a separate favicon, a light/dark logo pair, a wordmark lockup as an image.
All three are things the mask already handles or the `<h1>` text already is.

**`manifest.json`, not `manifest.webmanifest`** — Herd serves an unknown extension as
`application/octet-stream`, and the correct type (`application/manifest+json`) would have to be
added to the web server on every target: Herd, the nginx in `docs/DEPLOY.md`, and anything after
them. `.json` is already typed correctly everywhere and browsers do not care which name it has.

**No `*-web-app-capable` meta tag, of either spelling.** Chrome's console deprecates
`apple-mobile-web-app-capable` and asks for `mobile-web-app-capable` instead — but they are the same
pre-manifest mechanism with different vendor history, and `display: standalone` in the manifest has
superseded both: on Chrome from the start, and on iOS since 11.3 (2018). Taking the warning at face
value would have swapped one legacy tag for another and kept the redundancy. The tag was deleted
instead. The single feature still genuinely tied to the Apple tag is `apple-touch-startup-image`, the
iOS splash screen; we ship no startup images, so if those are ever wanted the tag returns *with*
them. `apple-mobile-web-app-title` stays — it is not deprecated, and it pins the home-screen label on
iOS versions that predate reading `short_name` from the manifest.

**Every path is relative** — `start_url: "."`, `icon-192.png`, and `new URL('../sw.js',
import.meta.url)` for the registration. The same files ship to the root of a Herd host and to a
GitHub Pages sub-path; an absolute `/sw.js` is a 404 on one of them.

**The icon carries the alert count.** One line in `alerts()`: `navigator.setAppBadge?.(live.length)`.
It is the *same* number the panel's warning glyph takes its colour from — live alerts, district
filter and ignore list applied, stale ones excluded — so an installed app on a home screen and the
panel on screen can never disagree. `live` rather than `hot` for the reason the counts already give:
a badge is a demand for attention, and a list of stations we can no longer read is a maintenance
problem, not a flood. Zero clears the badge by spec, so there is no clearing branch.

The Badging API is the whole implementation — no notification permission, no push subscription, no
service-worker message. Optional chaining removes it where it does not exist, and the `.catch`
absorbs iOS, which refuses it until notification permission is granted. That permission is *not*
requested: a prompt on landing spends exactly the trust the [alert design
standard](#alert-design-standard) says not to spend, for a number that is already on screen. The
badge is a convenience for people who installed the app; it is not an alert channel, and nothing
should start treating it as one without going through that standard first.

**The window title carries the same count**, in the same line of `alerts()`: `(2) Klang Valley Flood
Watch` when two stations are on alert, and the bare name when none are. It is a third mirror of
`live.length` — the button's badge, the app icon's badge and now the tab — so all three say one
number or none of them is trusted. The base string is read once at module load, because prefixing an
already-prefixed title would stack a count per poll. Forecast alerts are included with no mark of
their own: the panel and the badge already count them together, and a tab strip has room for a digit
and not for a distinction.

**The favicon turns red at the top rung, and only there.** `favicon()` in `alerts.js` takes one
boolean — is the app bar's warning glyph red — and swaps the tab mark for a red copy of the same
glyph, back to the blue one when the red clears. It is the fourth mirror of the same state, after the
button, the app icon's badge and the title.

It carries the state and not the count, because the title in front of it already carries the count
and 16 pixels of one shape cannot say two things. It is red or plain for the same reason: the middle
rungs are the ones that size cannot tell apart, and an amber mark a reader has to squint at is a
worse signal than a blue one they read as "nothing new".

The red mark is **painted at run time**, not shipped. `icon.svg` is the one drawing every other mark
is baked from, so a hand-kept red PNG is a file that goes stale the next time the glyph moves.
`favicon()` draws that SVG into a 64px canvas, fills it through `source-in` — the same alpha trick
`css/icons.css` plays with a mask — and hands the canvas to the `<link rel=icon>` as a data URL.
`toDataURL()` gives a PNG, so the tag's `type="image/png"` stays true and no browser has to support
an SVG favicon. The fill comes from `--s-danger` rather than a hex, so it is the palette's red and
not a copy of it. Read at paint time: a theme flip while the mark is red keeps the previous theme's
red until the state flips again, and both are red.

It repaints only when the state changes, because `alerts()` runs on every poll. Two guards behind
that: the flag is re-checked after `decode()` resolves, so a state that cleared mid-decode does not
get a red mark painted on top of it, and a `catch` leaves the blue mark standing if the drawing
fails.

Deliberately *not* done: no install-prompt UI (`beforeinstallprompt` banner) — the browser's own
button is where people look for it, and a second one is a thing to dismiss; no offline copy of the
last payload, per the above; no push notifications, which would be a new alert surface and belongs
in the [alert design standard](#alert-design-standard) discussion, not smuggled in with an icon; no
share target, shortcuts or screenshots in the manifest, none of which anything asks for yet.

## The alert list moved into the app bar, and the status chip onto the mark

Two things left the map. Both were paying rent on screen space with information a glance does not
need at that size.

**"On alert" is a button in the app bar**, between the search and the table, filled by `alerts.js`:
the warning glyph takes the status ramp (grey nothing, amber a handful, orange a bad night, red
district-wide — unchanged) and a badge on its corner carries the count. The list it opens is
`#side`, the same popout a pin opens, under the key `@alerts`.

Why the same popout rather than a second one: there is only ever one thing you are reading. The old
panel sat top-left over the map at 300px, permanently, whether or not anything was on alert — and
when you clicked a station in it, a *second* card opened on the opposite edge, so the map had a
column of furniture on each side and a strip of map between them. Now the station replaces the list
in the panel it was picked from, which is what following a link has always meant, and the way back
is the button that is still lit in the bar.

What that deleted, in order: the panel's own box, its collapse/expand tab and chevron, the
`alertsOpen` preference and its restore-on-landing, the collapse-into-phone-width handler, the
transform that slid it clear of the drawer, its scrollbar rules, and the per-row click handler that
existed only to collapse the panel before flashing to a station on a phone. About 60 lines of CSS
and 30 of JS, for a thing that reads the same and takes no map.

**What was given up:** the list no longer springs open by itself when a station goes on alert. On the
left edge that was free; on the right it would land on top of a card someone is reading, which is
the one rule the panel has (*nothing may close or replace the card except the reader*). The
compensation is that the signal is now permanent rather than conditional — the glyph and its count
are in the bar at all times, at a fixed position, in a colour that says how bad it is, where the old
tab could be scrolled behind, covered, or collapsed to a line. The interruption for *news* is still
the toast, which is what that surface is for, and the ticker still carries the names.

Checked against the [alert design standard](#alert-design-standard): the count is `live`, so stale
stations are excluded from the number exactly as they are from the icon badge — the two can't
disagree. Colour is not the only channel (the badge is a number, the button has a label naming the
count, the list says the tier in words). No new surface was added; one was removed.

**The status chip is a dot on the logo's corner.** It was a pill reading `LIVE` in `.hactions`; the
bar could not carry that, a ticker and six controls at once, and of the three the feed's state is
the only one that fits in a colour. So it rides the mark the way a presence dot rides an avatar — a
property of the thing it sits on — with the same broadcast halo and the same four states. The word
is not gone: it is the first row of the popover, which is now a `status` row above the readings,
last-checked, station count and source rows that were always there.

Hovering the *mark* opens it (a 24px target, not the 9px dot); tapping it does on touch. The table
had to move out of the `<h1>` — flow content cannot legally live in a heading — so it is a sibling
anchored to the header and revealed with `header:has(h1 .mark:hover)`, since no combinator walks
back out of the heading. It is pinned to the bar's left gutter rather than under the glyph: one
number that survives the phone layout moving the mark.

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

## The palette is two palettes

**Every station colour is a CSS token with a value per theme** (`--k-*` for the five kinds and the
mast, `--s-*` for the traffic light), defined at the top of `css/base.css`. `config.js` emits
`var(--k-river)` where it used to emit `#4da3ff`; every consumer already dropped that value into an
inline `style` or a `--c`, so the ~50 call sites did not change, and the theme swap is still one
attribute on `<html>` with no re-render.

*Why two.* One hex cannot serve the CARTO voyager basemap and dark_all. A colour picked to read on
warm paper is mud on near-black; one picked for near-black is a pastel on white. The light set is
**deep and saturated**, the dark set **light and coloured** — same hues throughout, so a river is
still blue and a siren still pink, and the type colours still miss the traffic light entirely.

*Held to a number.* Every value clears **3:1 against both basemap extremes and both surfaces**, which
is what WCAG 1.4.11 asks of non-text. That is not decoration: the pins have no chip behind them any
more, so a glyph's own colour is the whole of its legibility.

*Second pass: each theme moved the way it had room to.* The first cut held everything at 4:1 and the
map read drab — near-inks on the light theme, pastels on the dark one, and a set of five station
kinds you had to look twice at to tell apart. The fix is not one adjustment applied twice, because
the two themes have their headroom in different places. On white the hues are already near their most
saturated for their lightness, so there is nowhere to go but **lighter**: the light set was
brightened, spending contrast it had (4.2–6.3) down to a floor of ~3.1. On near-black the contrast
was being carried by lightness, and chroma was what had been given up to get it — so the dark set was
**saturated at the same lightness**, which costs nothing, because those values sit at 6–10:1 and only
ever need 3.

Three values did not move with their set, and each refusal is the rule proving itself:

- `--me` on light. Hazard yellow at 3.12 is already on the floor; yellow's whole problem is that it
  runs out of contrast against white before it runs out of lightness. Every step brighter drops it
  under 3. It is the one light token still at its original value.
- `--s-alert` and `--s-normal` on light took a **half** lift (to 3.33 and 3.58, not ~3.1) for the same
  reason in weaker form — amber and green are the two rungs of the traffic light nearest yellow.
- `--s-none` on dark was left alone. "No reading" is the absence of a colour; saturating the grey
  would make it a hue, and a hue on this map is a claim.

Nothing in the text stack moved: `--on-surface` and `--muted` are body text, still at 4.5:1, and the
3:1 floor applies only to the marks on the map.

*And the legend was lying.* The sample pins in `index.html` were still literal hexes from the palette
two revisions ago (`#4da3ff`, `#f06292`, …) plus a `--ink` that stopped existing when `ink()` was
deleted, so the key showed one set of colours and the map showed another — worse on the dark theme,
where a legend hard-coded to light-theme values sat beside pins that had never used them. They are
`var(--k-*)` / `var(--s-*)` now, and the mast sample carries `.multi` so it is drawn as the filled
chip it is on the map. **A legend that is not built from the same tokens is a legend that goes stale
silently** — there is nothing to fail.

*What this deleted.* `ink()` in `util.js` — black or white by relative luminance, computed per pin
fill — because only one pin is filled now and its glyph is `var(--surface)`, which is the same answer
from the token that already knows it. And six ad-hoc `:root[data-theme="dark"]` colour overrides
across `base.css` and `chrome.css`, each of which was this idea done once, by hand, for one rule.

*What still holds a real value, and why.* Anything painting **pixels rather than CSS**: the heat
layers' gradients are baked into an `ImageData` and a canvas cannot resolve a token, so the rainfall
ramp keeps `RAIN_HEAT` alongside `RAIN_COLOR` — one set for both themes, because a blob is
composited *over* the basemap at low alpha rather than read against it. The legend ramps in
`chrome.css` mirror those gradients and stay in step with them, not with the tokens. The cluster
badges keep their fixed slate and red for the reason they always did: they are filled chips with
white text, and white has to hold on both basemaps.

*And one trap.* A token cannot go in an **SVG presentation attribute** — `stroke="var(--k-river)"`
resolves to nothing. The sparkline's polyline, the area gradient's stops and the mast ring were all
paint-by-attribute; they are `style="stroke:…"` and a `.mastring` class now. Leaflet's
`color`/`fillColor` path options are presentation attributes too, which is why the mast ring is
coloured from CSS — any CSS rule outranks one.

## Pins are glyphs, not coins

**A station pin is its icon and nothing else** — no disc, no ring, just the glyph in the station's
colour with a soft drop shadow. It has been two other things: a white disc with a coloured glyph
(camera cyan on white at ~2:1 — the icon was there and unreadable), then a filled disc with the glyph
in whatever `ink()` picked. The filled version fixed the contrast and cost the thing the contrast was
for: at 400 pins the map was a field of identical coins, and the *shape* — the one part of an icon
that is read without being read — was down to 15px inside a 26px chip. Now the shape is the pin, at
24px, and the colour tokens above are what keep it legible.

**One pin keeps its disc: the mast.** A multi-sensor pin is standing for a stack rather than naming
a sensor, so there is no glyph shape to protect, and it carries a sensor count that needs a field to
sit on. Its ink is `var(--surface)`, white or near-black by theme.

Danger keeps its halo, which is what the fill used to do — it makes the pin bigger than a glyph
without hiding *which* glyph it is — and "rising" is a ring rather than a `box-shadow`, since a bare
glyph has no box to trace.

## The whole icon set is filled

**Every glyph is Material Symbols at `fill=1`**, refetched in one pass. The pins are why: a station
pin is its icon and nothing else now (see *Pins are glyphs, not coins*), and an outline standing on
an arbitrary photograph of a city is a thin line with no field of its own to read against. A fill has
area, and area is what survives being 24px over a satellite-grey street. What is right for the pins
is right for the rest — an outlined `menu` beside a filled `water_drop` in the same bar reads as two
icon sets, not one.

The refetch is one URL per glyph, recorded at the top of `icons.css`:
`…/materialsymbolsoutlined/<name>/fill1/24px.svg` (swap `fill1` for `default` to see the outlined
variants these replaced). Two rules are not from that fetch and stay: `--i-compare`, hand-drawn
because the stock glyph is a pair of arrows and this one has to say "two panels side by side"; and
`--i-flood`, which comes out of `icon-build.php` because the app mark and the PNGs are one drawing.

**The app mark is Material's `flood` now**, so the favicon, the installed-app icon, the splash and
the header wear the same drawing as the station glyphs. `icon.svg` was replaced with that path and
`php icon-build.php` re-baked all three PNGs; the `?v=` on both `<link>`s and both manifest `src`s
went to 3, which is the only thing that makes a browser let go of a favicon.

## "You are here" is a pin, in hazard yellow

**`home_pin`** — a house inside a map pin. The shape is doing the work: no station glyph is a pin, so
the mark reads as *a marker* rather than as a 672nd sensor before any colour is involved. It is
anchored at its **tip** (`iconAnchor: [16, 29]`, not the box's centre) — a pin points at something,
and Material leaves ~8% of the box as air below the point, so anchoring to the box bottom would float
the mark above the fix.

**The colour is `--me`, a hazard yellow.** It is the one mark on the map that is not a reading, so it gets
the one hue a reading never wears on its own. *Noted, not resolved:* yellow is also the alert rung of
the traffic light, and the colour language reserves that ramp for status. What keeps this from
reading as "an alert, here" is the shape and only the shape. If it ever does read that way, the fix
is the hue, not the pin.

One colour for all of "you": the pin, the accuracy circle, the arrival ripple and the badge on the
card. The circle and the ripple reach it through classes (`.mecircle`, `.ping.me`) rather than
Leaflet's path options, which are SVG presentation attributes and cannot resolve a token.

**The light value spends the 3:1 floor, and it is the only one in the set that does** (`#e0a500`,
2026-08-05). It holds 2.20 on white and 1.91 on `#efefef`, the darkest paper the light basemap puts
behind a mark. It was `#b87b00` at 3.58 and 3.11 — on the floor exactly, and on the map it read as
brown, which is the one thing a hazard mark must not do.

The trade was made with the numbers on the table, in this order. A yellow that clears 3:1 on white
*is* a dark yellow: that is the hue, not a badly chosen value, and every step lighter drops it
further. Two attempts at an outline would have bought the contrast back from somewhere other than
the fill, and both failed on the map — see *Three attempts at an outline on a station glyph*. So the
floor is spent here, deliberately, once.

What pays for it is what always paid for it: the shape. A house in a pin resembles no station glyph,
and it is drawn at 48px against every station's 29. `--s-alert` beside it holds 2.55 on white, so
this is one step past an amber the map already carries rather than a new kind of value.

*The cost, stated:* the "You are here" badge on the station card is 11px uppercase type in this
colour, and 2.20 is under any text floor. It was under 4.5 at `#b87b00` too. If that badge ever has
to be read rather than recognised, it takes its own token — the pin is what this value is for.

Its four predecessors, in order: a blue disc with a person in it (a station, as far as the map was
concerned), a bare outlined person (clipart on a map), a filled `near_me` arrow (a heading we do not
have), and a `my_location` crosshair (correct, and invisible next to the river blue).

## Three attempts at an outline on a station glyph, and what the third one changed

**A station pin is a bare glyph, and it stays bare.** The `--me` pin reads as brown on the light
basemap (see *"You are here" is a pin, in hazard yellow*), and the cause is the 3:1 floor: a yellow
that clears it on white paper is a dark yellow. The fix attempted was to stop asking the fill to
carry contrast on its own — put an edge on every glyph, then let the map draw with the dark theme's
brighter set on both themes.

**First attempt: four hard 1px drop shadows**, one per direction, which is the trick
`.pin .fv` uses on the favorite heart. It covers four directions only, so a water drop's diagonals
come out thinner than its sides.

**Second attempt: a real outline.** The glyph painted twice from the same mask — a copy scaled up in
`--edge` behind the glyph itself. Even at every angle, and worse for it. At 400 pins a grey
silhouette behind every glyph is 400 grey blobs: the outline becomes the mark and the colour inside
it becomes a fill. Turning `--edge` down from `--outline` to `--muted` and thickening the scale from
1.14 to 1.2 traded one failure for the other and fixed neither.

**Both attempts had the same cause, and it was the delivery, not the design.** A CSS mask keeps only
the alpha of the picture. The element under it is a solid box of `currentColor` clipped to that
alpha, so there is no fill and no stroke to address — an outline could only ever be faked from a
second copy of the shape, and a mask has no path to offset. Scaling is the only way to grow one, and
a scaled glyph grows away from its own centre rather than outward from its edge. That is why the
second attempt put a silhouette *behind* the mark instead of a border *around* it.

**Third attempt: put the SVG in the document and stroke the path.** `pinGlyph()` in `js/map.js`
returns `<svg class="pinglyph"><use href="#g-water_drop"/></svg>`, and `.pinglyph` in `css/map.css`
takes `fill: currentColor` and `stroke: var(--surface)`. Three declarations carry it:

- `paint-order: stroke` paints the stroke *under* the fill. A stroke is centred on the path, so
  without this it would eat half its width out of a 29px glyph.
- `vector-effect: non-scaling-stroke` states the width in screen pixels rather than in the
  960-unit viewBox — about 33 units to the pixel at a station pin's size, so without it a stroke of
  1 is invisible and only something past 100 shows at all. It is one of the few SVG presentation
  properties that does **not** inherit, so it cannot be declared on `.pinglyph`: a rule there lands
  on the outer `<svg>`, which paints nothing, and never reaches the path inside the `<use>` shadow
  tree. `pinGlyph()` stamps it on the path instead. Everything else here inherits and crosses that
  boundary, so it stays in the stylesheet. One pixel then holds at 31px on a station pin and at
  48px on the "you are here" pin, and `.pin`'s `scale(.8)` does not thin it.
- `stroke: var(--surface)` — white on the light theme, near-black on the dark one, so the edge
  reads as a gap punched in the basemap rather than as a ring drawn on top of it. Two values were
  tried in front of it and both failed the same way. `--muted` is the inverse pair, dark on light,
  and a dark ring round every glyph is the second attempt's failure arriving through a better
  technique. `--outline` is a step softer in the same direction and still reads as a ring. Not
  `#fff`/`#000`: that pair is what `--surface` already is either side of a shade, and it would not
  follow the theme toggle.

It is one shape, offset along its own outline, so it is the same width at a diagonal as at a side
and it adds nothing behind the glyph that the glyph does not already cover. It also replaced the
soft `drop-shadow` the pins used to carry, on both the station pins and the "you are here" mark: the
shadow existed to lift a glyph with no edge off a busy tile, and two marks around one 29px glyph is
one too many. The job is to stop the fill carrying 3:1 against white paper alone. **A stroke wide enough to read as a border of its own
is the 400-blob failure again in a better technique** — that is the line to watch when tuning it.

One more thing an `<svg>` does that a mask did not: it clips to its own viewport, and a stroke is
drawn outside the path's bounds. So the edge is shaved flat wherever the glyph meets the side of its
box. Growing the element does not help — the viewBox scales with it and the overhang grows in step.
`overflow: visible` is the fix. Padding the viewBox in user units and growing `width`/`height` by
the same ratio also works and is two numbers that must be kept in step, for a box nothing is laid
out against.

**The favorite heart is the same kind of glyph, and it needed one thing the station mark did not.**
It drew its own edge with four hard 1px `drop-shadow`s, one per direction, from before a pin glyph
was a path — hard because a blurred shadow leaves the edge soft exactly where the shape is thin,
which on a heart is the two upper curves, and four offsets leave the diagonals between them thin
anyway. It is a `.pinglyph` now and takes the same real stroke. It keeps a soft `drop-shadow` of its
own, which is **not** a duplicate of `.pin`'s: a filter renders its element and every descendant as
one image and casts a single shadow from the union silhouette, so `.pin`'s falls on the basemap and
nothing falls from the heart onto the station glyph it overlaps.

What cost the most time was the stacking. The heart is the last child of `.pin` and it is positioned,
so CSS2.1 painting order puts it at step 7 and the unpositioned station `<svg>` at step 3 — it could
not be underneath, and on every favorited pin it was. Both are now given explicit rungs:
`.pin > .pinglyph` at `position: relative; z-index: 0`, `.pin .fv` at 2. The `position` is load
bearing, because an unpositioned box cannot take a `z-index` at all. Two other explanations were
chased first and both were wrong — a `filter` on a parent creates a containing block for absolute
descendants but does not reorder them, and the heart's missing shadow was a depth problem rather
than an order one. **Do not delete either declaration as redundant on the strength of the spec.**

**The path data is still in one place.** `pinGlyph()` lifts each symbol out of the `--i-*` token in
`css/icons.css` at first use and appends it to a hidden `#glyphs` sprite, so adding an icon is still
one line in `icons.css` and there is no second copy to drift. **Only the map pins take this path.**
Every other icon in the app is still a mask, because nothing else needs a second colour, and an
`<svg>` per icon across the app bar and the cards would be markup where a token is enough.

**What the outline was for, finally collected.** The point of all three attempts was to stop the
fill carrying contrast on its own, so the map could draw with one palette on both themes. That is
now done: the map-palette block in `css/base.css` is selected by `:root[data-theme="dark"], .pin`,
so a station pin takes the dark theme's brighter set whatever the theme is. The same set was tried
on both themes once before, scoped to `.leaflet-pane`, and went back with the fake outline it
depended on. `.pin` rather than `.leaflet-pane` this time, because the stroke is on the pin glyph
and nothing else in that pane has one.

Scope matters here. Every other surface that paints a kind or a status — a badge, a table cell, a
chip, the legend, the alert panel — sits outside `.pin` and still swaps with the theme, because none
of them has an outline and the fill is all they have. And every token a pin resolves has to be in
that block: `--c` arrives as an inline `style` on `.pin` itself, and a `var()` in an inline style
resolves against that same element, so a kind left out would quietly fall back to the theme value
and draw one pin off-palette.

Trade-offs accepted: the pins now cost an SVG element each instead of a `<span>`, and one regular
expression reads a stylesheet value at runtime. Not built: a stroke on any icon outside the map, a
per-kind stroke colour, and a build step to bake the sprite — the symbols are made on demand and
there are eight of them.

**One thing from that work is worth keeping, and it is a trap, not a feature.** `filter` applies
*before* `mask` in the render order: the element paints, the filter applies, then the mask clips. An
`.i` is a box of `currentColor` with the glyph masked out of it, so a drop shadow on it is computed
from the box, lands outside the box, and is clipped away. Nothing renders, nothing errors. The
favorite heart works only because its filter sits on the `<b class="fv">` wrapper and the mask is on
the `.i` inside. Any future effect on an icon needs that same shape.

## The drawer is four sections, not a list of controls

**The district filter is one box.** The search field and the list it filters were two outlined
rectangles with a 10px gap: two controls to look at, doing one job. They now share a single
`.pickbox` border — the field on top, the list under it, one rounded outline round both. The gap
was the only thing saying they were related, and a shared box says it better.

**"only" sits on top of the count, not beside it.** It is revealed on hover, so the lane it used to
occupy was reserved on every row all the time and pushed every district's number ~40px in from the
edge for a button that was not there. It is absolutely positioned over the count now, filled with
the hovered row's own colour (`accent 14%` resolved *against* the surface rather than composited
over it, so it matches exactly). Two consequences worth keeping: the overlap lives inside the
`@media (hover: hover)` block, because on touch the button is permanently visible and a permanent
button on top of a number hides the number; and the row takes the same tint on `:focus-within`, or
the button would land on an untinted row when it is reached by keyboard.

**The heatmap pair and the sensor kinds are `<details>` sections** (`#heatsect`, `#kinds`), the same
`.sect` as Districts and Ignored sensors — so the drawer is four labelled things rather than two
lists followed by five loose chips, and the two layer groups can be folded away by anyone who set
them once. They persist through the same `PREFS.sect` map keyed by id that the other two use.

Each carries its state on its summary, which is the rule every section here obeys: `#heatN` names
the live layer (`water level` / `rainfall` / `off`) because the two chips are one mutually-exclusive
choice, and `#kindN` counts the kinds switched off, the same `N hidden` the district filter shows.

**`#shown` stays outside both sections.** It carries the `· N ignored` count, which is one of the
two always-visible indications that an alarm has been silenced — a collapsed section would hide it,
and that is the thing the alert standard is most explicit about.

*Later:* **"Rising stations only" moved into the heatmap section**, under an `<hr>`. It is not a
third heatmap — the two above it are one mutually-exclusive choice and this is a filter on the pins
— but it is the other control that changes what the map *shows* rather than which stations exist, so
it shares the fold and the rule says where one ends. A rule rather than a fourth `.sect`: a heading
for a single chip is a heading with nothing to hold.

*And:* **one spacing for all four sections** — `#bar .sect { margin-bottom: 12px }`, replacing two
per-section rules and the drawer's own 24px flex gap. The gap fell between the two columns, so the
seam between Ignored sensors and Heatmap was 36px against 12px everywhere else, which read as a
break in the stack rather than the next section.

## "Rising only" says so on the map

The rising filter hides most of the stations on the map, and unlike the district picker it is a
single checkbox with no list under it naming what it removed — a drawer closed an hour ago is not an
indication. So it now carries a **standing pill over the top of the map** while it is on, with
"Show all" on it: `body.rising` → `#risebadge`. Same reasoning as the ignored-sensors panel, which
the alert standard is explicit about: anything that suppresses stations has to say so somewhere that
cannot be missed, and has to be undoable from there rather than only from where it was switched on.

**The accent, not test mode's amber.** The shape is deliberately test mode's — it is the same
sentence, "what you are looking at is not everything" — but a filter you switched on yourself is a
state to be reminded of, not a hazard, and amber would make it the third thing on this page claiming
something is wrong. Its ink is `--surface`, never `#fff`: the accent is a pale blue on the dark
theme, where white on it is a contrast failure. (Same rule as `.tlr.on`.)

**Both pills live in one `#pills` strip**, a centred grid, and `test.js` appends its badge there
rather than to the body. Test mode and the rising filter can be on at once, and two independently
`position: fixed`, independently centred pills would have sat on each other. The strip itself is
`pointer-events: none` with its children back to `auto` — an invisible full-width bar across the map
would otherwise eat every click under it.

"Show all" **dispatches a `change` on the checkbox** rather than calling the handler: that handler
keys off `e.target` to work out which of the three controls moved, and it is the one place that
persists the preference, re-filters and closes the drawer on a phone.

## Both panels leave a peek of map, and on a phone that peek is the scrim

At phone width the drawer and the station panel each covered the screen. A panel that covers the map
completely reads as a new page, and the only way out was a control in a far corner — the × at the top
of `#side`, and for the drawer the hamburger in the app bar, which is not on the panel at all.

Both are now **84vw**, so a strip of map stays on screen beside each one. That strip is 58px at
360px, and it does two jobs: it says the map is still under there, and it is where the panel is
dismissed.

**At that width each panel is a modal drawer**, and Material's rule for one is the rule this app
follows: a modal drawer closes on a tap on its scrim, or on a swipe toward the edge it is anchored
to. `#scrim` is one box for both panels. It is a sibling of each, at `z-index: 440` — over the map
furniture at 400 and under `#side` at 450 and `#bar` at 500 — so each panel stands clear of its own
scrim. Its top is `var(--hdr)`, because the app bar holds the hamburger that opens the drawer.
The tap closes both panels, since only one of the two is ever open here.

**Above 600px the scrim is inert.** Neither panel is modal there. The drawer and the station panel
stand on opposite edges with map between them, so there is nothing to dim and nothing to tap through.
The × closes the card and the hamburger closes the drawer, which is where each control belongs on a
screen with room for both.

*An edge tab held this job first, and it is gone.* `#barTab` and `#sideTab` were 26px chevron plates
fixed to the seam where each panel met the map, at every width. Three things were wrong with it. It
drew a second object on the map for something the panel's own scrim already says. It reserved 26px of
the 58px peek, so the strip that was there to show the map mostly showed a button. And it invented a
control where the platform has a convention, which cost a reader the one gesture they already knew.
The swipe stays and the scrim replaces the plate.

*Two rules the scrim depends on, and both fail silently.* It carries **no `visibility`**, and
**`pointer-events` is outside the transition**. A transitioned `visibility` holds its start value for
the whole duration, so a fading-out scrim would go on taking taps for 250 ms after the panel left —
the exact failure `#splash` had. `opacity` alone never stops a tap either. The `pointer-events`
switch is the whole of what makes the scrim inert, so it must apply at once.

**Swipe to dismiss** — `swipeOff()` in `js/ui.js`, touch events only. A mouse has the × and the
hamburger, and a drag with one is a text selection.

*Two things it has to get right.* **The first 8px decide the axis**, and nothing moves before that:
both panels scroll vertically, and a swipe that stole a scroll would cost more than the swipe is
worth. A drag that starts on a range input is skipped outright, so the heat opacity slider keeps its
own. **The drag is written to the `translate` property, not to `transform`.** The panel already
carries a `transform` that places it — the open/shut slide — and an inline `transform` would throw
that away for the length of the drag. `translate` is a separate property that composes with it, so
the finger only ever adds to where the box already is. Every rule that transitions `transform` on
these boxes transitions `translate` too, and that is what carries a half-swiped panel home.

Released under a third of the panel's width, it goes back. Past that, it closes through the same
close path the scrim uses, so nothing has a second way to shut.

**One panel at a time, at phone width only.** Both are 84vw there and the drawer (z-index 500) is
painted over the station panel (450), so a second one opening lands on the first. Each now closes the
other: `setDrawer(true)` calls `closeSide()`, and `openSide()` announces itself so the drawer can
shut. Above 600px nothing changes — there is room for the two on opposite edges, which is the layout
they were built for.

The station panel's half of that is a **`sideopen` event on `document`**, not a call. `ui.js` owns
the drawer and already imports `map.js`; a call back the other way would close the import cycle the
no-build rule forbids. It fires only on a real open, because `render()` calls `openSide()` on every
poll to refresh the card in place. Both auto-closes pass `remember: false`, so a desktop drawer
preference survives a visit on a phone.

**Gotcha, and the reason only one panel had it:** `#bar` had no `overscroll-behavior`. Scrolling past
the end of the drawer chained to the document and carried the whole page up with it.
`#sideBody` has carried `contain` since it was built, so the station panel never showed the fault.
Any new scrolling panel over the map needs the same rule.

**And the flexbox trap under it.** `#bar` is a column flex container with a fixed height, so a child
taller than the drawer does not overflow it — the default `flex-shrink: 1` shrinks the child to the
container instead. The child's own content then spills out of the shrunken box, `#bar`'s
`scrollHeight` never exceeds its height, and the last sections of the drawer are clipped *and*
unreachable. `#bar > div` therefore carries `flex-shrink: 0`. It only ever showed on a phone, where
the sections stack into a narrow column and run past one screen. Any scrolling flex container needs
the same on its children.

**Then the same bug in its other half: `dvh`, not `bottom: 0`.** A phone resolves a fixed box's
`bottom` against the *large* viewport — the one with the address bar retracted — so both panels were
taller than the strip actually on screen. The drawer's content fitted inside that taller box, which
is a second way to get no scrollbar, with the last section parked behind the browser chrome. Both
panels now take `height: calc(100dvh - var(--hdr))`. `dvh` is the viewport as it stands, and it
follows the bar in and out. `#dataBox` already used the unit; this is the same rule, applied to the
rest of the furniture.

## Leaflet's controls join this page's stack

Leaflet gives all four of its control corners `z-index: 1000`, which is above everything here — so
the zoom buttons floated over the **splash**, a screen whose whole job is to say there is no map yet.
`map.css` now sets `.leaflet-top, .leaflet-bottom` to **400**, the map-furniture band the legend
already sits in: under the panels (450 / 500), the header (600) and the splash (900).

One rule for all four corners rather than one per control, so anything added to any corner later
lands in the same stack. It replaces the phone-only `body.side .leaflet-bottom.leaflet-right`
override, which fixed the same clash for one control, on one edge, at one width.

## The district list keeps its count on touch

On a mouse the solo button is hidden until the row is hovered, laid over the count so no lane is
reserved for a control that is usually not there. On touch there is no hover to reveal it, so it was
pinned visible — and pinned *beside* the count, which made every row carry a number and a control at
once. That is what a phone actually showed: a column of "Ampang 2 only".

Under `@media (hover: none)` the button **does not run at all**, and the count stays. The count is
what the row is for. Solo is a shortcut rather than the only way through, and the checkboxes hide
districts on any device — so a phone loses one gesture, not one capability.

`#ignoredList` keeps its own `.solo`, which is a different button under the same class: restoring a
silenced sensor is that panel's entire job, and it has no count to compete with.

## The forecast was wrong every time it fired

We replayed the `rising` forecast over every sample in `.history.db`. That is 7.2 days, 109 river
stations and 12,055 station-polls. It fired 53 times. Not one of those stations reached the mark the
alert named. The flag also turned on and off 48 times across those 53 firings, so almost every
alert lasted a single poll.

Four separate defects produced that result. Three of them are in the maths. The fourth is upstream
of the maths and is the largest.

### The sample clock was ours, not the reading's

`api.php` stored every sample against `$now`, the moment of the poll. Measured over the archive,
upstream changes a value every 25 minutes at the median. We poll every 8.5 minutes. A level is
therefore a staircase, and the same number arrives four or five times. Stamping each arrival with
the poll time puts the step where we noticed it, not where it happened.

Both ends of a rate then carry up to one poll interval of error. Over the 20-minute baseline the
old code accepted, that is a rate wrong by more than 100%. It is the reason PINTU AIR IJOK reported
`eta 0.9 h` through five consecutive polls at an unchanged level of 3.40 m.

`readTs()` now takes the reading's own stamp, which every station already carries in `updated`. JPS
stamps a reading to the *upcoming* slot. A stamp of 17:45 arrives at 17:36. A stamp in the future
is therefore normal, and `readTs()` pulls it back to now. A stamp that fails to parse falls back to
the poll time.

Three things follow for free. The `(station, ts)` primary key now dedupes a repeated reading to one
row instead of five. The sparkline plots against the clock that measured the reading. And a station
frozen on an old reading stores that old timestamp, which `RETAIN` prunes and `SPARK_WIN` excludes,
so a dead sensor stops writing fake current samples.

### The rate was a chord between two samples

The old `rate` picked the sample nearest an hour old and drew a straight line to now. One bad
reading at either end is the whole answer. It reported **9.61 m/h** on Sg. Kerayong. The archive
holds 846 steps of 0.5 m or more, and 63 of those reverted on the very next sample.

`rate` is now the median of every pairwise slope in the 3-hour window — the Theil-Sen estimator. It
[tolerates about 29% corrupt points](https://library.virginia.edu/data/articles/theil-sen-regression-programming-and-understanding-an-outlier-resistant-alternative-to-least-squares)
and stays competitive with least squares on clean data. It costs about 200 divisions per station
per poll, against 110 river stations. That is not a cost worth optimizing.

`TREND_WIN` is gone with the baseline it targeted. `TREND_MIN` survives with a new job: it is now
the closest two samples may be and still form a usable pair, and it dropped to 10 minutes because a
median over many pairs does not need each pair to be clean.

*Dropped:* the `trend` field, a raw level delta over the baseline window. No client read it.

### The dip test accepted a level that never moved

The old test asked that three samples not *decrease*. Three identical readings satisfy that. So a
level standing still passed the anti-spike guard on a rate left over from a step that had already
finished. The test is now strictly higher across the three samples.

### A tide is a rise

PINTU AIR IJOK is a water gate. BANDAR KLANG and TELUK PENYAMUN (JETI) are estuarine. A tide climbs
at 0.5 to 0.7 m/h twice a day. It reaches danger never. Extrapolating one produces a false alarm on
a timetable. This is a known trap in tidal-river gauging, where
[datum and backwater effects](https://www.frontiersin.org/journals/climate/articles/10.3389/fclim.2026.1757212/full)
are the usual trigger.

The fix is one line and it is the honest signal, not a station blocklist: **the level must beat its
own 24-hour high.** A tide stays inside yesterday's envelope. A flood breaks it. `READ` already
loads 24 hours of history per poll, so the number is in hand.

*Why not a blocklist of tidal stations:* somebody has to maintain it, it is wrong the first time JPS
adds a gauge, and it says nothing about the many rivers that are mildly tidal at the mouth.

### One poll of climb is a spike

The 48 flips across 53 firings are alarm chattering, which the
[alert design standard](#alert-design-standard) already commits us to avoiding under ISA-18.2. The
standard cure is an on-delay. `rising` now needs two consecutive polls inside the cutoff.

It costs nothing to store. `$assess()` takes a sample *index* rather than the latest point, so the
previous poll goes through the same rules, on history already in memory. Nothing persists between
requests, which matters because there is no process that lives between them.

### Measured

Each row adds to the one above, replayed over the same 7.2 days:

| rule | fired | correct | flips |
|---|---|---|---|
| the old method | 53 | 0 | 48 |
| Theil-Sen rate | 46 | 0 | 20 |
| strictly higher | 39 | 0 | 19 |
| above its 24-hour high | 10 | 0 | 11 |
| two consecutive polls | 4 | 0 | 7 |

**The `correct` column is zero throughout, and that is not a failure of the fix.** No station in
those 7.2 days reached its mark at all. The replay can measure false alarms. It cannot measure
misses. Anything claiming this method detects floods better needs a flood in the archive to say so.

The live check is better evidence. On the poll that shipped this, 56 of 233 rain gauges reported
rain and one read 31 mm/h. The method flagged three stations. ULU YAM had gone
32.90 → 33.59 → 34.13 in half an hour, against a danger mark of 38.3. RIMBA KDR had gone 0.22 → 0.91. KG. RANTAU PANJANG had
climbed steadily through four readings. BANDAR KLANG showed `eta 1.1 h` and was **not** flagged,
which is the envelope rule doing its job on a tidal station.

### Trade-offs accepted

- **Straight-line extrapolation stays.** Rate-of-rise projection is
  [a real operational method](https://www.weather.gov/media/marfc/FactSheets/Fact_Sheet_Understanding_River_Forecast_Process_FINAL_singlepgs.pdf),
  and a real flood hydrograph is a curve that this method under-reads on the rising limb. Fitting a
  curve to seven noisy points from one gauge would be a more confident wrong answer. The cure for
  that is rainfall-runoff routing, which is a different project.
- **Rainfall is still not an input**, although rain is the earlier signal by an hour. The samples are
  already stored. Nothing joins a rain gauge to the catchment above a river station, and guessing
  that join from distance would be worse than leaving it out.
- **`$mark` still falls back** `danger ?? warning ?? alert`, so one flag can mean three severities.
  This is an open gap against CAP's severity axis and belongs with the other four in the alert
  design standard.
- **Two polls of delay is up to 17 minutes of lead time** given the median poll gap. On a flashy
  urban river that is real. It buys the end of 48 flips, and an alert nobody believes has no lead
  time at all.

## The heat layers now match the saved choice before the first payload

**Landing showed both legend ramps, and the water layer, whatever you had picked.** The two heatmaps
are one mutually-exclusive choice, held in `PREFS.heatLayer`. The map and the legend were put on that
choice in one place only — `render()` — and `render()` does not run until the first poll returns.
That is about 3.5 seconds on a warm cache, longer on a cold one, and never if the poll fails. Until
then `index.html` had the water chip ticked and both `.lgsec` sections visible, and `heat.js` added
the water layer at module load. A reader whose choice was rainfall got the wrong legend, and a reader
who had switched both off got a legend for a layer that was not there.

The chips themselves were already correct on landing — `ui.js` reads the pref and ticks one of them.
Only the two things the chips are supposed to drive lagged.

`syncHeat()` in `heat.js` now holds those six lines, and `ui.js` calls it once, right after it ticks
the chips. `render()` calls the same function on every poll. One reconciliation, two callers.

### Trade-offs accepted

- **The initial state stays in the markup.** `#heat` keeps its `checked` attribute and the legend
  sections keep no inline `display`, so the page is still readable with no JavaScript running.
  `syncHeat()` corrects it in the same task as the rest of the drawer wiring, before paint.
- **No new state.** The function reads the checkboxes, which `ui.js` has already set from the pref.
  Nothing caches which layer is live, so there is no second copy of the answer to keep in step.

## Third palette pass: the status ramp, and what the alert glyph is allowed to say

Two complaints, one root. The light theme's status colours read brown, and the dark theme's read
washed out — so the alert glyph in the app bar looked like a different control in each theme.

### The colours

The [second pass](#the-palette-is-two-palettes) moved each theme the way it had room to move
and stopped short of the floor. This pass spends the rest.

| token | light was | light now | dark was | dark now |
|---|---|---|---|---|
| `--s-normal` | `#199040` | `#009e42` | `#5fdc86` | `#26e275` |
| `--s-alert` | `#bc7100` | `#c47600` | `#ffc94d` | `#ffc000` |
| `--s-warning` | `#dc4f10` | `#e55f00` | `#ff9440` | `#fe8400` |
| `--s-danger` | `#df2723` | `#ff3b33` | `#ff7a6e` | `#ff3a37` |

The light set is at 3.06–3.08 against `#efefef`, the darkest paper the light basemap puts behind a
mark, and 3.5 against white. That is the floor WCAG 1.4.11 sets for a non-text mark, held exactly.
The dark set went to the sRGB edge on each hue, which for the three warm rungs meant giving up a
little lightness — they were already at the edge where they sat. All four clear 4.5 on the surface.

**Amber gained the least, and that is physics, not caution.** Yellow runs out of contrast against
white before it runs out of lightness, so light amber cannot be brighter than `#c47600` and stay
legible. This is the same limit that pinned `--me` two passes ago. The two themes therefore cannot
meet on amber, and the divergence there is a fact about the hue rather than a choice.

**They do meet on red.** Light `#ff3b33` and dark `#ff3a37` are a shade apart, because red is the one
rung where "reads on white" and "reads on near-black" overlap. The rung that matters most is now the
same colour in both themes.

**`--s-warning` is the one hue that moved**, 40° to 45° in OKLCH. At the floor all four rungs sit at
about the same lightness, so hue is the only thing separating them, and orange against red was
already the tightest pair on the ramp. Five degrees puts warning an equal distance from each
neighbour: 0.073 and 0.077 in OKLab, against 0.088 and 0.050 before. ISA-18.2 asks that priority be
distinguishable at a glance, and this is what pays for it.

`--s-none` did not move, for the reason it did not move last time. A tinted grey is a hue, and a hue
on this map is a claim.

### The tinted chips needed their own ink

A status token is held to 3:1 because it is a mark. Three places set it as **text** on a tint of
itself — the `.state` blocks in a station card (`OUT OF CONTACT`, `IDLE`), and the four counts in the
alert list's head. Text asks 4.5, and a colour on a tint of itself starts from less than either
number: `.state.on` measured 3.81 before this pass and 2.94 after it.

The ink is now the token pulled 30% toward `--on-surface`, which puts the whole set at 4.5 or better
in both themes. One expression covers both, because `--on-surface` is near-ink on the light theme and
near-paper on the dark one — the mix always moves away from whatever surface is behind it. The chip
keeps the hue at full strength. The background carries the signal; the word carries the meaning.

The `.badge` chips on a station card use the same pattern with a **kind** colour, which this pass did
not touch, so their contrast is unchanged. They are the same class of problem and are worth the same
treatment when kind colours are next revisited.

### The alert glyph now carries severity, not headcount

The button used to take the status ramp by **count**: amber at 1–4 stations, orange at 5–9, red at
10 or more. That put an amber glyph over a river standing at its danger mark, and a red one over ten
stations merely forecast to climb.

It reads `tier()` now — red the moment one station is at danger or one siren is sounding, amber while
the worst of it is a forecast, grey when there is nothing. That is the split the list below it has
drawn as a red or amber rule per row since the alert audit, so the button and the rows it opens now
agree.

CAP keeps severity and urgency on separate axes, and count is neither. The count was never missing
from the button either — it is the badge on the corner, and it is the number the app icon carries.

### Trade-offs accepted

- **The orange rung is no longer reachable on the glyph.** `tier()` has two actionable tiers and the
  button now has two colours. Orange is still on the pins, where it is a station's own status.
- **"Ten at once" no longer has its own colour.** ISA-18.2's flood threshold is a real idea and this
  was a nod to it, but it was riding on the severity channel. A flood of alerts deserves its own
  indication rather than the loudest rung of somebody else's.
- **The light set has no margin left.** Every value is within 0.08 of the 3:1 floor. Anything that
  darkens the paper behind a mark — a basemap change, a print stylesheet — has to be measured, not
  assumed. There is no fourth pass available in this direction.

## The map pins grew by half

26px to 39px, and the glyph inside from 24 to 36. Everything hung off the pin went up by the same
half: the ring on a rising station, the halo on one at danger, the border and count on a mast chip,
and the "you are here" mark from 32 to 48.

**The box is declared twice and must stay in step.** `.pin` in `css/map.css` draws it, and
`iconSize` / `iconAnchor` in `render.js` is what Leaflet actually positions the marker from. Change
one alone and the pin stops pointing at its station. The same pair exists in `locate.js`, where the
anchor is the pin's **tip** rather than its centre, and stays at ~92% of the box height for the air
Material leaves under the glyph — 44 of 48, as it was 29 of 32.

The five sample pins in the About key grew with them, because they are the map's own `.pin` at the
map's own size. That is the point of the key: a legend drawn in a second style is a legend that can
go stale without anything failing. The stacked layout below 600px already covers the wider row.

### Trade-offs accepted

- **Pins overlap sooner.** Clustering is unchanged, so a mark now covers about twice the ground it
  did and stations metres apart crowd more at mid zoom. `maxClusterRadius` already tightens with
  zoom, and co-located pins spiderfy on click, so nothing is unreachable — it is denser to read.
- **The cluster badge did not grow.** It is a counter rather than a mark, and a 54px chip over the
  map hides what it is counting. If the pins now look large beside it, that is the number to revisit.

### No camera in range says nothing

`camLink()` and `camNear()` return an empty string when no camera is within `CAM_MAX_KM`. Both
printed "no camera nearby" before. The card is not a camera card. A river gauge card that opens
with a grey line about a camera that does not exist spends its first line on an absence, and 150 of
591 stations showed that line on every open. The link is an aside, so its absence is also an aside.

The "you are here" card drops the whole camera section for the same reason. That card still names
the four *water* kinds it finds nothing for, because you opened it to ask what is around you and
"no siren reporting" is an answer to that question. The distance cap itself did not move. Nothing
else changed either. The CSS keys the spacing of the first section on
`#sideBody > .sensor:first-child`, so the section that is now first gets the same treatment the
link had.

## A camera picture says what the river beside it was doing

Four changes, and they share one question. A reader opens a flood camera to ask one thing: is it
like this now. Every change below answers that question, or gets out of its way.

- **`nearestCam()` caps the nearest camera at 5 km** (`CAM_MAX_KM`). It reached 24 km before.
- **A picture carries a warning glyph** when a river or siren within 2 km is on alert
  (`CAM_ALERT_KM`).
- **`?shots=` returns a tier per frame**, so the lightbox colors its tick strip.
- **A station card plays its last three hours** (`js/clip.js`), a frame a second, no controls.

### Two radii, two questions

5 km answers which camera to offer. 2 km answers whether the frame shows the trouble. So the app
can offer a camera at 4.8 km and draw no glyph on it. That is correct, and it is why the two
numbers are not one number. A camera 5 km from a gauge is the nearest view of that valley. It is
not a picture of that gauge.

`CAM_MAX_KM` lives in `js/config.js` and applies only inside `nearestCam()`. `CAM_ALERT_KM` lives
twice, in `js/config.js` and in `api.php`. The server needs its own copy to join a stored frame to
a river. Change both together.

### What the 5 km cap removed

Measured on the live payload: 441 of 591 stations keep a camera link, and 150 lose one. Those 150
pointed at cameras up to 24 km away, over a different river with different weather. A wrong view is
worse than no view. See [No camera in range says nothing](#no-camera-in-range-says-nothing) for
what the card prints instead.

### The glyph, and why a stale alert draws none

`camAlert()` in `js/stations.js` returns the worst tier within 2 km. Distance breaks a tie between
two of the same tier. Red marks `now`, amber marks `soon`, and `stale` marks nothing.

A stale alert needs the sentence the alert panel gives it. That sentence says the telemetry died,
and the situation may have moved either way. A glyph on a photograph has no room for a sentence. A
warning nobody can qualify is the wrong claim to put on a picture.

`camAlert()` applies `isIgnored()` itself, rather than leaving it to the callers. `PREFS.ignored`
is the one alarm-suppression control in this app. It already holds past the district filter, on the
ticker and on the toast. This is a sixth surface under the same rule.

The glyph rides the card still and the lightbox. It never rides a map pin. A pin already carries
its own station's status, and a camera is not the river. The glyph sits on a translucent dark disc,
because half this footage is bright sky or wet concrete.

### A stored frame can be scored against the river it watched

`?shots=<id>` used to return a list of timestamps. It now returns `[ts, tier, stationId]` per
frame. The tier comes from replaying the live forecast at a past sample index.

That reuse is the point. `$slope` and `$assess` were closures inside the refresh path. They are now
named `slope()` and `assess()` above the early-returning endpoints. The bodies are unchanged. One
rule has to judge the past and the present. A second scoring rule would let the timeline and the
map disagree about one river.

`frameTiers()` in `shots.php` does the join. It takes `assess` as a parameter rather than importing
it. That keeps `shots.php` loadable by `shots-test.php`, which has no payload, no database and no
network.

Four hardening details, each worth keeping:

- **The database opens `PDO::SQLITE_OPEN_READONLY`.** `.history.db` holds 30 days of samples that
  nothing can rebuild. This path provably cannot touch them.
- **A database failure degrades to the plain frame list**, with null tiers. The response carries
  `max-age=60`, so a fatal body would sit in a cached 200 for a minute.
- **The sample query starts at `$frames[0] - RISE_DAY`.** The forecast's tide guard looks back 24
  hours. A frame at the window edge needs that lookback, or the guard runs short.
- **The server breaks a tier tie by distance, matching `camAlert()` on the client.** Only the
  worst-tier station id travels, and the client uses that id to drop a tick for an ignored sensor.
  If the two rules disagreed, ignoring a river could leave its tick colored.

### The tick strip is colored by tier

`js/timeline.js` keeps a `tierAt` Map from frame timestamp to tier and station id. A mark turns red
or amber for the tier that frame was taken under. The strip then answers "when did this start"
without playing the whole clip.

A station that has left the payload must not suppress the color. Only a station that is present and
ignored turns a mark plain. A frame taken while a river was at danger was still taken while that
river was at danger. An absent station is a lookup failure, not a reader's decision.

### The station card plays three hours

`js/clip.js` plays what the archive holds of the last `CLIP_WIN` (3 h). One frame lands per
`CLIP_MS` (1000 ms). Capture runs every 30 minutes, so a full window is six frames and a six-second
lap. The clip carries no controls. The lightbox holds the transport, the scrubber and the compare
divider. Two places to learn one control is one too many.

Fewer than two frames keeps the live still the card already drew. `?cam=` fetches that still from
the agency when the card opens. So an empty window means this server did not capture, not that the
camera stopped. Reaching into the archive for an older frame there would replace a live picture
with a stale one.

The caption says one of three things. A running clip says `LAST 3 HOURS · N frames`. A card with no
clip says `LATEST IMAGE · <time>`. It says `NOT CURRENT · <time> · <age>` once that still passes
three hours. NOT CURRENT is the word the cards already print on a reading over a day old.

Two details cost a round of debugging each:

- **The module keeps a generation counter, not just a camera id.** A reader can close a card and
  reopen the same camera before the first fetch returns. Both continuations then read the id as
  current, and two intervals run at once. Nothing holds the first handle any more. `stop()` bumps
  `gen`, so a stale run can never match again.
- **The lightbox resolves its camera from the wrapper's `data-clip`.** The clip rewrites `img.src`,
  so matching `?cam=` against the src fails on an archived frame. Six clicks in seven opened a
  lightbox with no scrubber, no compare and no glyph.

### What the timeline cannot say

Four things leave a tick uncolored. The first three can never leave one wrong. The fourth can
disagree with the live glyph, and it is written down here rather than patched.

- **A siren can never color a past tick.** `?shots=` walks rivers only, and `frameTiers()` scores a
  sample against the station's own danger mark. A siren publishes no such mark. Its samples are 0
  or 1, so the forecast rule has nothing to measure. 57 of the 69 glyph-capable cameras have a
  river within 2 km, so most cameras still color.
- **Levels retain 30 days and frames retain a year.** The month and year scrubber ranges stay
  largely uncolored. Do not change retention to fix this. Levels feed a forecast, and a reader
  watches frames.
- **The static GitHub Pages build has no PHP**, so `?shots=` fails there. The scrubber draws no bar
  and the card plays no clip. The card still captions the still: the failed `fetch` throws, `clip.js`
  catches it, and the idle branch prints `LATEST IMAGE` or `NOT CURRENT` from the payload's own
  timestamp. That caption needs no PHP, so it is the one part of this feature the static build keeps.
- **The past and the present score danger by two different rules.** `api.php` colors a past tick
  `now` when a stored sample reads at or above the station's own danger mark. The live glyph uses
  `isCritical()`, which reads `status >= 3`. For a Selangor river that the national feed does not
  override, `status` arrives from upstream and nothing re-derives it. So the two can disagree about
  one river at one moment, and the last tick stays gray under a red glyph. Neither rule is wrong on
  its own. Choosing one is a decision about which source owns the words "at danger", and that
  decision does not belong in a fix wave. Do not change either rule to close the gap here.

### Measured

90 cameras are online with an image. 441 of 591 stations keep a camera link at 5 km. 69 of the 90
cameras can ever raise a glyph at 2 km. 57 of those 69 have a river in range. A three-hour window
holds six frames at most.

Camera 17 currently carries three real `soon` frames from station `wl-157`, dated 29 and 31 July.
That is the first end-to-end proof of the join on real archived data.

### Trade-offs accepted

- **About 1.5 MB preloads on the first card open.** Every later lap is free, because `?shot=` is
  immutable for a year. The alternative was a first lap that flickers on every swap.
- **Only the worst-tier station id travels.** A tick raised by an ignored station falls to
  uncolored, not to the second-worst river. Two hot rivers within 2 km of one camera are rare.
- **An idle card re-requests `?shots=` once per poll.** That is one local read behind a 60-second
  cache.

### Not built

- **A control on the panel clip.** The lightbox holds the transport, and a picture that moves needs
  no buttons.
- **A higher capture rate near an alert.** `SHOT_EVERY` exists to cap the requests aimed at one
  agency. A flood is exactly when that cap matters most.
- **A second scoring rule for siren ticks.** Online sirens already reach `.history.db`, so the
  samples are there. A 0/1 log needs a rule of its own, because the forecast rule needs a danger
  mark. It would color ticks for up to twelve more cameras. It would also be a second rule judging
  one strip.
- **A second-worst fallback when the worst station is ignored.** A `ponytail:` comment in `api.php`
  marks the spot. Build it if two hot rivers near one camera turn out to be common.

## Five changes from a day of use

Four defects and one addition. All of them came from a reader using the app after the camera work
landed.

### The camera picture fills the panel on a phone

The phone rules capped `.shotwrap` and `.shot` at 210px and centered them. That cap dates from the
map popup, which floated over the map and had to leave the map visible.

The panel is the whole screen on a phone. So the cap left a small picture in a full-width column, with empty space on both
sides. The picture is the one block on a camera card that a reader cannot use at half size. It fills
the width now, like every other block in the card.

### A gauge with water on it wears a status color

Upstream publishes three codes against two marks: 0.15 m warning and 0.3 m danger. Any depth under
0.15 m therefore shared code 0 with dry ground. The pin kept the quiet taupe and the state block
kept no tone at all. The first version defended that. Two centimeters is neither the green of dry
ground nor a warning.

But grey and taupe are what this app paints on a sensor that cannot report. A
flood gauge answers one question. Is this flood-prone spot wet? Water standing on it is never the
normal state.

`gaugeTone()` in `js/util.js` now gives that answer once, for all four surfaces: the pin, the card,
the table cell and the table hover panel. It maps dry ground to 0, water on the ground to 1, the
published warning mark to 2, and the danger mark to 3.

`GAUGE_COLOR` in `js/config.js` turns the rung into a color, and it is not `STATUS_COLOR`. Rung 1
takes `--s-trace`, a yellow-green between the dry green and the alert amber. Amber names a mark, and
upstream published none down there. A flood gauge is the one kind that uses the whole ramp, so
`.state.trace` and `.state.warn` join `off`, `mid` and `on` in `css/base.css`.

Two gauges sat in that band on the day of the change. TAMAN MERU UTAMA read 0.06 m and KG. ORANG
ASLI KELINSING read 0.13 m.

*Not changed:* the heat weight and the alert list. `isHot()` never covered gauges, so the alert
count, the icon badge and the ticker do not move. This change gives a color to a reading. It does
not add an alarm.

### Every sounding siren shares one card

A water level is a number that a reader weighs. Its row hands over the marks, the last three hours
and a camera link, because all three help that judgment. A siren is not a measurement.

Somebody has already made the decision and set it off, so the reader has nothing left to weigh. And
there are 212 sirens. Test mode trips about 22 of them. One card each turned a flood into a scroll
of one repeated word, with every river reading buried under it.

`sirenCard()` in `js/alerts.js` collapses them to a title and a list of places. Each row carries the
name, the district and the distance, and a glyph that says whether the siren stands alone or on a
mast. A mast has a river level next to the siren, and that is the reading a reader wants next.

No timestamp and no online state on a row. A siren we cannot hear from is not in this list. It is
`stale`, and it keeps a card of its own, where the timestamp is the point and the trouble is the
sensor rather than the water.

The sort already clustered sirens inside their tier, so the first one draws the card and the rest
draw nothing. Sirens now lead their tier rather than trail it, which puts the card at the head of
the panel. A level is a number to judge and a decision still to make. A siren is a decision somebody
already made and acted on, which is the shorter road to acting yourself.

### Worst first means the status first

Each reading column sorted on one number per kind. A water level sorted on how far it stood toward its own
danger mark. That works only while every station in the column carries the same kind of number. A
river with no published mark fell back to bare meters and ranked against neighbors ranked on a
fraction.

And a river at 96% of its danger mark, which upstream had already put on alert, sat below
a river at 97% that upstream called normal.

`sortKey()` returns `[severity, size]` now, for every kind. The published status picks the band and
the reading orders the band. A station with no danger mark sorts to the foot of its own band,
because nothing places it inside one.

Sorting on the status exposed a hole in the status. The Selangor list endpoints publish `-1`, which
means "no status", on stations that report a real number: 144 of 233 rain gauges and 15 rivers.

`-1` is an unknown band, not a band below normal. So a gauge reporting 4 mm/h sorted under one
reporting 0.5 mm/h, and the cells had drawn the first of those as "dry" all along.

`api.php` now derives the missing code from the reading, through the same `rainStatus()` and
`wlStatus()` that the two scraped feeds already pass through. The fix belongs there and not in the
client: this app keeps one definition of a status, and `api.php` owns it.

After the change no online station carries `-1`, and five more rain gauges report a real class.
`band()` in `js/table.js` still clamps `-1` to 0. That is the guard behind the fix, for the day a
feed goes quiet in a new way.

### Every graph answers a pointer

The three graphs are 100-unit SVGs, stretched to whatever width they land in. Not one number appears
on them. The axis names the hours, the caption names the range, and everything between is shape.
"About two thirds of the way up, somewhere around noon" was as close as the eye could get to a
reading that the data holds exactly.

Point at any graph now and a small box names the sample under the pointer: `1.74 m · 14:15`,
`3 mm/h · 09:00`, `sounding · 22:30`. A tap does the same on a phone, and a drag scrubs along the
line.

`js/sparktip.js` is one delegated listener for every graph in the app, because all three graphs are
the same markup wherever they land: the station card, the alert list and the table hover panels.
Each graph ships its own samples in `data-pts`, as `[x%, label]` per sample. The function that draws
the graph words those labels, so the listener needs no unit, no clock and no notion of a sensor
kind.

Two details that cost more than they look:

- **The readout is a popover.** The table draws its graphs inside `.tipbox`, which is a popover
  itself and therefore sits in the top layer. No `z-index` reaches above that. Only another
  top-layer element paints over one. The readout uses `popover="manual"`, so opening it cannot
  light-dismiss the panel under it.
- **It names the nearest sample, not the sample under the pointer.** Readings sit a quarter of an
  hour apart and the space between two of them holds nothing. A readout that blanked in the gaps
  would flicker across the whole width of the graph.

*Not built:* a marker line down the graph at the sample. The box already sits on the x of the sample it names. A line would
say the same thing, and it would be a second element to keep in step.

## The card is the reading again

Three changes to what a station card says, and one to the palette it says it in.

### The light palette moved up ten steps of lightness

Three separate reports said the same thing: the marks on the light theme are too dark to pick out.
The third pass had held every value at 3:1 on `#efefef`, the darkest paper the light basemap puts
behind a mark, which is what WCAG 1.4.11 asks of a non-text mark.

It read as a set of near-inks on a pale map.

Every light value now moves **+10 L\* in CIELAB**, at its own hue, with chroma raised 8% and then
fitted to the sRGB gamut. Fitted, not clipped: clipping a channel shifts the hue, and hue is what
separates one rung of this palette from the next.

What it costs, stated plainly. The four status colors now sit near **2.2:1 on that paper**, under
the 3:1 floor. The kind colors land between 2.6 and 3.8. The pins keep their drop shadow, and that
shadow now carries more of the work than the color does. If a mark ever gets hard to find, deepen
the shadow before darkening these again.

`--s-danger` is the one value left alone. Red runs out of sRGB before the others. At L\* 67 it fits
a chroma of only 60 and comes out salmon, which nobody reads as danger. It is also the one rung
where the light and the dark theme agree, and that is worth keeping.

### The provenance moved into the sensor menu

Every card printed a footer: are we online, what was the stamp on the last reading, which feed won.
Three facts about the plumbing, in the same column as the reading, repeated once per sensor down a
mast that can hold six.

None of them changes what the water does. They are what a reader checks after doubting the
number. So they now sit where a reader goes to look: `sourceInfo()` builds them as the first item of
the sensor menu, above the ignore action, and the card is the reading again.

The menu button changed with it. It was a `⋮`, which promises a list of actions and held exactly
one. It is an `ⓘ` now, which is what the panel mostly holds. The item itself is not a button and
takes no hover fill, or it would promise a second action that is not there.

Six stale references to the old glyph survived that change. A later cleanup found them. Two were
on screen: the ignored-sensors empty state, and the About pane's help text. The glyph had changed
long before the text caught up.

### The clip caption dropped the frame count

`LAST 3 HOURS · 6 frames` became `Last 3 hours`, left aligned.

The frame count was a fact about this server. Six frames or four depends on when this server ran,
and it answers no question a reader has. **The rule generalizes to the whole app.** Do not
tell a reader a number that only describes how the app works.

Sentence case for the same reason the count went. All caps is a raised voice, and a caption under a
picture is not raising it.

## Danger outranks everything, and a fake flood is one event

### The map paints red for anything at the top of its own scale

`isCritical()` covers a river over its danger mark and a sounding siren. It drives `isHot()`, and
through that the alert panel, the icon badge, the ticker and the toast.

It also drove the pin. That left two kinds out. A flood gauge under 30 cm of standing water is at
the top of its scale, and so is a rain gauge in the top JPS class. Neither one is `isCritical`.

The cost showed on a mast. `leads()` elects the sensor that speaks for a place, and it elected on
`isCritical()`, so a quiet river outranked the flooded gauge on the same pole. The pin came out
river blue over a gauge under water.

`atDanger()` in `js/util.js` asks the question the map needs: is this sensor at the worst its own scale
can report? A river over its mark, a sounding siren, a gauge past 0.3 m, rainfall in the top class.
It drives the pin color, the halo, the cluster badge and `leads()`.

`render.js` states the red outright, `critical ? statusColor(3) : ...`, rather than trusting
`leads()` to elect the worst sensor and `color()` to happen to return red for it.

**The two questions stay apart.** Widening `isCritical()` would have been one word and it would have
widened every alert surface at once. A color on a map says "look here". An entry in the alert panel
says "act". Those are different claims, and the second one goes through the alert design standard.

### Test mode: a place tells one story

`seedTest()` walks stations one at a time. So it could leave a river 4% over its danger mark on the
same mast as a rain gauge reporting nothing, a dry flood gauge and an idle siren.

That is not a flood. It is four unrelated faults on one pole, and the mast card read as a bug.

A second pass now walks sites. Any site holding a river at danger has the rest of its online sensors
brought up to match, through one idempotent `drown()`: the rain that caused it, the gauge under
water, the siren sounding. Thirty sites, and none of them keeps a quiet sibling.

Offline members stay offline. A real flood knocks sensors off the network, and "one sensor on an
alerting mast has stopped reporting" is a rendering path worth looking at.

### The camera warning needed a knob of its own

A camera has nothing to fake. `camAlert()` measures from the alert to the lens, so the only way to
raise the warning triangle is to put an alert next to a camera.

That was left to which stations happened to land on a multiple of four. It reached 6 of the 31 sites
that hold both a camera and a river. `CAM_EVERY` now floods every third such site on purpose.

Measured over the payload behind this note: 36 of 81 online cameras carry a triangle, 29 of them
red, and 16 have the alert on their own mast.

### The gauge needed one too, at a rung real data never reaches

Test mode never produced a flooded gauge, so neither the danger rung nor the new `--s-trace` rung
had a way to show. `GAUGE_EVERY` puts every fourth gauge under water. `WET_EVERY` alternates the two
rungs between: 0.08 m for water on the ground and 0.2 m for past the warning mark.

The result covers the whole ramp: 8 dry, 7 on the trace rung, and 5 flooded.

**The rule this leaves behind.** Anything new that alerts needs a knob in `js/test.js`, or it ships
unseen. Two of the three gaps above existed because a feature landed and nothing faked it.

## The alert panel became a directory

### Every row is a place

The panel was one card per station. Each card carried a badge, a tier tag, a place, a meter, a trend
line and a 12-hour graph. That is the right shape for one alert and the wrong shape for forty.

Test mode makes 64 of them. The panel turned into two screens of identical furniture, and the one
question it exists to answer got lost in it: where is this happening?

`groupCard()` in `js/alerts.js` now draws one card per kind per tier, and every row inside it is a
place. Sirens went first, one release earlier. Water levels follow, at danger and forecast alike.
The same 64 alerts now fill 3 cards.

A row carries the place, its district, the distance from the reader, and the number. The number
changes with the tier: a percentage of the danger mark when the river is over it, the hours to that
mark under a forecast, the stamp on the last reading when the station has gone
quiet. The right column sets `tabular-nums`, so a reader can scan a list of them down the page.

Rows group on `site`, so a mast with two river gauges over their marks is one row and not two. The
worst sensor there speaks for the row, and the row says how many are behind it.

The glyph is the `layers` mast mark where more than one sensor stands at that place. It is the kind's own
glyph where one sensor does. Either one takes the tier color, the same color as the left rule.

**What the panel gave up.** The meter, the trend line and the sparkline are no longer in it. They
live on the station card, which every row opens with one tap, and that card has the width for them.
A stale group keeps its warning sentence, once, instead of once per station.

### The pins lost a fifth

At 400 marks the light basemap was more glyph than map. Every single-sensor pin is now
`transform: scale(.8)`.

A transform, not a smaller font: it takes the danger halo, the rise ring and the drop shadow down
with it in one step, and it leaves the 39px layout box alone. `render.js` repeats that box as `iconSize`, and that is
what positions the marker over its station.

The mast pin keeps its size. It stands for a stack rather than one reading, it carries a count that
has to stay legible, and it is the pin with the most to say.

### The camera warning says what is wrong

It was a triangle on a dark disc, with the words in a `title` attribute.

A `title` is a tooltip that never opens on a phone, waits a second on a mouse, and takes no style. So the marker meant "something", and the something was unreachable on half the devices this
runs on.

The words are on the picture now: `Water level 3.42 m`, or `Siren sounding`. Not the place name, and
not the distance. The card around the picture is already headed with the place, and nothing within
2 km of a lens is far enough away to change what the picture means.

The disc went with the tooltip. Legibility is a shadow instead: the glyph carries the same
`drop-shadow` the map pins use against busy tiles, and the words carry a `text-shadow` hard enough to
hold over bright sky or wet concrete. The marker is `pointer-events: none`, which also gives back
the 28px of dead corner the disc used to take out of a picture that opens the lightbox.

### The sensor menu states the connection as a badge

`Online` and `Offline` were a word beside a check mark. They are a badge now, green or gray, with a
wifi glyph. It is the one item in that panel that reports a state rather than a fact.
A badge is how this app says that everywhere else.

`--i-wifi` joins `--i-wifi_off` in `css/icons.css`. One rule and one class, which is the whole cost
of an icon here.

## The lightbox is a player

The camera lightbox was a picture with a footer under it. The footer held the seek bar, the transport,
the range control and a caption. It measured about 90px and it was there whether or not anyone was
reaching for it. The dialog caps the picture at a share of the viewport height, so those 90px came
straight off the thing people opened the lightbox to look at.

### The controls moved onto the frame

`#tl` is now the last child of `.stage`, absolutely placed along the bottom edge. A gradient scrim
fades up out of that edge, so the controls have something to sit on and the rest of the picture keeps
its own contrast. The picture grew from 62vh to 74vh in the same change, and from 46vh to 62vh on a
phone.

The bar is hidden by default and appears while a pointer is on the picture. It goes away 1.6 seconds
after the pointer leaves. The delay is the point. A bar that vanishes the moment you leave the
picture is a bar you lose while crossing to the range buttons.

`visibility` is stepped, not faded. Opacity alone would leave an invisible control bar taking clicks
over the bottom of the picture, and the picture is the play button.

Keyboard use holds it open through `#tl:has(:focus-visible)`. Not `:focus` — `openTimeline()` moves
focus to the play button on open so that space works, and `:focus` would pin the bar open for a
reader who never touched a key.

A phone gets the bar permanently, under `@media (hover: none)`. The alternative is a tap that means
"show the controls" competing with the tap that means play. That is a state machine for a surface
that already has one.

### The two frame labels step above it

`.btime` and `.abtime` sit in the same corner the bar comes up over. They move to `bottom: 96px`
while the bar is up, on the same 1.6 second delay, so the two move as one thing. With no archive
behind the camera, `#tl` is `hidden` and the labels keep the corner.

### The seek bar shows danger, not graduation

The ruler under the scrubber is gone. It drew one hairline per stored frame, up to 60 of them, over
the one control here that has to be dragged. The frames are already a regular grid, so the marks
measured nothing the spacing did not.

What is left is the colour. A frame taken while a river within `CAM_ALERT_KM` was at danger, or was
forecast to reach it, paints a span of the bar in that tier's status colour — red for `t-now`, amber
for `t-soon`. The bar answers "when did this start" without anyone playing the clip, which is the
only thing the marks were ever read for.

The bar is drawn by `.tltrack`, not by the input. The alert spans have to sit inside the bar and
under the thumb, which `accent-color` cannot do, so `#tlscrub` is transparent and the rail, the
played part and the spans are three layers under it. `paint()` writes the play position to `--p` on
the track.

The tick tooltips and the click-a-mark-to-go-there path went with the marks. The scrubber is the same
set of positions with a proper role, keyboard handling and a full-height grab target.

### The stage had to let the bar through

Two of the stage's own gestures now start inside a control. A press on the seek bar was also the
start of an A/B divider drag, and a press on any button was also a press on the picture, which plays
and pauses. One `tl.contains(e.target)` guard on each covers every control in the bar, including
anything added to it later.

### The camera warning wears a transparent pill

The warning on a camera picture was bare words with a heavy `text-shadow`. A shadow only darkens what
is already behind the letters, and JPS daylight footage is bright sky and wet concrete.

It is a translucent pill now: `rgb(0 0 0 / .55)` with a 3px backdrop blur, around the glyph and the
words together, so the two read as one label. The shadow stays as a second line of defence. This is
not the old disc coming back — that was furniture around a glyph that stood alone, and this is a
plate under a label that has words.

The glyph came down from 22px to 16px in the same step. It was sized to stand alone on a photograph.
Inside the pill it is one of two things on a line of 12px text, and at 22px it reached the pill's own
edge and made a badge out of a label.

### Compare joined the transport

The compare button sat on the seek bar's line and took a button's width off it. That is the one
control here that gets dragged, shortened for one that gets pressed.

It is now the fifth button in the control row, in a `.tlleft` wrapper with the four transport
buttons. A 10px gap separates it from their 2px — that gap is the whole statement that compare is not
a transport control. They step and play; it changes what the picture is.

The wrapper is what keeps the five on one line when the row stacks on a narrow dialog. Without it the
container query would have made three rows out of two.

`.tlrow` is gone with it. The track is a direct child of `#tl` at full width.

### The overlay is the special case, not the default

The bar has two shapes. In flow under the frame, on the dialog's own surface and in the dialog's own
colours; or laid over the picture with a scrim, in white, fading in and out with the pointer.

The plain shape is the base. The overlay is behind
`@media (hover: hover) and (min-width: 601px)`, and both halves are required.

`hover: hover`, because the bar hides itself. With no pointer to bring it back it would have to stay
up for good, and a bar that cannot be dismissed is a strip of the photograph taken away rather than a
player's chrome. Tap-to-reveal was the alternative: a tap meaning "show the controls" competing with
the tap meaning play, on the one surface that already has a job.

`min-width: 601px`, the same breakpoint the rest of the app turns on. A phone that lies about its
pointer — desktop mode, a paired stylus, a touchscreen laptop — is caught by the width even when the
first test passes.

This is the second attempt. The first had it the other way round: overlay by default, footer under
`@media (hover: none)`. A device that reports `hover: hover` when it should not fell through to a
permanent black bar sitting on the photograph, with no pointer able to dismiss it, and it happened
often enough to be reported as "sometimes it reverts to the desktop control". A misread now costs a
footer, which is merely plainer.

The literal whites moved with the overlay. In flow the bar reads `var(--muted)`, `var(--hover)` and
`var(--outline)` like every other control in the dialog, and it follows the theme. The tokens cannot
be used over a photograph, because they flip with the theme and the picture does not.

The warning pill follows the same split: a strip above the frame in the plain shape, the picture's
top-left corner in the overlay. The strip is opened by `:has(.camwarn)`, so a camera with no warning
pays nothing for it.

The frame is capped at 58vh in the plain shape, 74vh under the overlay, 50vh below 600px.

This needed a new element. `.stage` is exactly the picture's box — `.ab` and `.abgrip` are `inset: 0`
of it, and that is what lines the two A/B halves up pixel for pixel — so anything that has to sit
*beside* the picture cannot live inside it. `.player` wraps the frame, the bar and the pill as three
siblings. On a mouse the last two are laid over the first and `.player` is still exactly the frame.
On a phone `#tl` goes `position: static`, falls into flow under the frame, and `.player` grows to
hold it.

The frame gives up height for it: 50vh on a phone against the 74vh a mouse gets.

Two things got simpler. The bar is no longer inside `.stage`, so the `tl.contains(e.target)` guards
on the stage's click and its divider drag are gone — a press on a control never reaches the picture
now. And the reveal is keyed on `.player:hover` rather than `.stage:hover`, so hovering the bar
itself holds it open, which the old selector had to do through the delay.

### The title says where the camera is

`#lbTitle` was the camera's name alone. JPS names a camera for the road or the bridge it points at —
`Pekan Batang Kali`, `JAMBATAN SUNGAI DAMANSARA` — which places it only for somebody who already
knows the area.

The district and the state are a second line under it now, in the same order and the same words the
station card puts in its `.pophead`. The basin is left off. The card carries it, and it answers a
question about the river rather than about where you are looking.

The name wraps and the second line truncates. The dialog is sized by the picture and is at least
460px wide, so a long place name has the room, and half a place name is worse than two lines of one.
The second line is context rather than the answer, so it must not push the picture down a line.

Both lines are set with `textContent`, not one interpolated string. They are upstream names.

### The bar gave back a third of its height

The first version of the bar was 90px of picture. Three changes took it to about 60.

The caption line went, and its one fact with it. The chosen range segment now spells itself out —
`24 hours, 30 minutes per frame` where the others read `week`, `month`, `year`. A pace stated on the
button that sets it cannot be read against the wrong range, and it costs no row. The empty case moved
with it: `week, nothing stored this far back`.

The `Range` label beside the segments went the same way. It said which of the timeline's two
dimensions the words change, which is worth a line in a footer and is not worth a line over a
photograph. It survives as the group's `aria-label`.

The icon buttons are 34px here, not the 40px they are everywhere else in the app, and the row gaps
came down to 2px. Two rows of buttons stack over the frame, so six pixels a row is twelve off the
picture — and these sit on a scrim that already separates them from what is behind, so they need less
room than a button on the app bar to read as one.

### The range segments grow into their label

The chosen segment carries more words than the others, so every click changed the width of the pill
at once. The control jumped, and the button under the pointer was not the button the pointer had
aimed at by the time the click landed.

Each segment now holds both labels. `.tls` is the short one, `.tll` is the long one, and the CSS
wipes one out as the other comes in over 250ms. The text that is leaving stays in place and gets
clipped to nothing, so the words moving out is the animation. Nothing measures anything, and the
pill follows because its width is its content.

A width of `auto` is not animatable on its own. `interpolate-size: allow-keywords` on `.tlr` makes
it so, and it is declared there rather than on the root to keep it off every other element in the
app. A browser without it swaps the labels at once, which is what the control did before. The
transition is dropped under `prefers-reduced-motion: reduce`.

### The divider says which way to drag

The knob was a ring with the photograph showing through it. It stated that a circle was there and
nothing about what to do with it, and on a pale frame the white outline went with the frame. It is now
a solid white plate with a dark arrow each way. The plate reads over any picture, and the arrows are
the only part that has to be read.

The arrows are border triangles. There is no chevron in `css/icons.css`, and one pair of arrows in one
control is not worth refetching the icon set for.

`slide()` clamps the divider by half the knob's width instead of to 0 and 100 percent. At either end
the knob used to hang half off the picture and onto the dialog behind it. The clamp reads the width
off the element, because the knob grows to 44px on a coarse pointer. It costs the last few pixels of
wipe at each end, which is the trade every before-and-after slider makes.

The gesture itself still needs saying once. A picture cannot look draggable, and compare is the only
control on this dialog that is not a button. `.hintbox` prints `Drag across the picture to compare`
for three seconds every time the divider comes up, then fades. A permanent caption over a photograph
would be read once and be in the way after that. It sits above the knob rather than near the foot of
the frame, because the control bar covers the bottom of the picture and the pointer is on that bar at
the moment compare is switched on.

### The ends of the timeline say so

`go()` clamps, so a step off the oldest frame and a step off the newest both land where they started.
The button lit up and the picture did not change, which reads as a control that is broken rather than
one that has finished.

Both ends now speak, through the same `.hintbox` compare uses. `say()` writes the line and the box
shows it for three seconds. The test is whether the picture moved, so pressing "go to now" on the
newest frame answers too. Three lines cover it: `Oldest frame in this range`, `Live already, nothing
newer`, and `Newest frame in this range` for the compare case, where live is the fixed side and the
steps stop one frame short of it.

The box holds no text of its own any more. There is one box and several things to say into it, so
every line is written from `timeline.js`.

### The left timestamp left the clipped box

`.ab` is the older frame clipped to the divider. The label for that frame was inside it, so the
divider cut the label in half whenever it came near the left edge. The right label, in the unclipped
box, never had the problem, which is what made it look like a bug rather than a layout.

Both labels are now children of `.stage`. `#lightbox:not(.cmp) .abtime` hides the left one, which the
`hidden` attribute on `.ab` used to do for free.

### A camera opens three hours back, and waits

Opening rested on live. That is the right answer for a range button — you asked for a window, and the
newest frame in it is the one you know — but it is the wrong answer for opening, because live is the
frame the lightbox was already showing. Nothing new appeared, and the first thing the clip did was
jump backwards.

It now opens on the nearest frame to three hours ago. Far enough back that the water has moved, near
enough that it is still this weather.

Playback starts two seconds later instead of at once. A clip already running when the dialog finishes
opening gives its first frames away to a reader who is still finding the picture. The delay is in
`openTimeline()` and nowhere else. Somebody pressing a range button is already watching. Any
deliberate move cancels it, because every one of them goes through `stop()`.

### The press on the picture is answered on the picture

The picture plays and pauses the clip. The only sign of it was a 34px glyph in the control bar, which
self-hides on a mouse and is a long way from the middle of the frame either way, so half the presses
read as nothing having happened.

`.tapfx` flashes the state that was just entered in the middle of the frame, and is gone in under half
a second. It is the answer every video player gives. The play button fires it too, so `k` and space
get the same feedback as a click.

### The warning belongs to the frame, not to the clock

`ui.js` wrote the pill once, from the live alert, and it stayed there through the whole clip. A
picture from last Tuesday carried a claim about the water right now. The seek bar under it was
already right — its coloured spans come from `tierAt`, the per-frame tiers the server scores — so the
picture and the bar directly under it disagreed.

`paint()` now rewrites the pill for the frame on screen, from that same `tierAt`. Live is the one
position that asks the live question, through `camWarn()`'s own default. `camWarn()` takes the alert
as a second parameter for this, defaulting to `camAlert(cam)`.

The figure is the reading nearest that frame in the station's `history`, within half an hour. Beyond
the 12 hours of samples the payload carries there is none, and the pill states the sensor with no
figure. `'level' in a` decides, not `??`. On an old frame the live number is the one value it must
never fall back to.

The reader's ignore list is applied here, the same way `drawTicks()` applies it. The server never
learns that list.

Two costs, both paid. The pill is compared as a string against the one already on screen, because
`paint()` runs once a second through a clip and most frames carry the same warning as the one before.
And a calm frame on a camera whose archive holds an alerting one gets a hidden pill instead of no
pill. In the plain shape the strip above the picture is opened by `.player:has(.camwarn)`, so a pill
that came and went would move the frame 30px down and back up while somebody watched. Cameras that
never alert get no placeholder, which is the cost that rule exists to avoid.

### The station panel's still lost its pill

The card's picture carried the same wrong claim, and the same fix does not reach it. That still is a
3-hour clip that plays itself. It has no scrubber, no seek bar and no room to state a warning per
frame. So the pill said what the water is doing now, over a frame from hours ago.

`camImg()` no longer emits it. The card around the picture already gives the alerting sensor a
section of its own, with the reading, the meter and the graph. That says more than the pill said, and
it says it about the right moment. Only the lightbox keeps a pill, where the server scores every
frame.

`camWarn()` stays exported for that one caller.

### The pill states the tier, not just the reading

`Water level 3.42 m` said what the number is and left red against amber to say what kind of trouble
it is. A reader who does not know the palette cannot tell a river over its danger mark from one
forecast to reach it in three hours. CAP separates severity from certainty, and colour alone was
carrying that whole separation, on a photograph where nothing else holds a scale.

The pill now reads `Water level at danger, 3.42 m` or `Forecast to reach danger, 3.42 m`. A siren
reads `Triggered siren` and carries no figure.

The words are not new. They are `ALERT_TITLE`, the table the alert panel already groups its rows
under, moved from `alerts.js` to `config.js` so both surfaces read one copy. Somebody who scans the
panel and then opens the picture beside that river now reads one claim twice. Two wordings would have
read as two claims.

### Four kinds can raise it, and the alert path did not move

The pill covered rivers and sirens, because `camAlert()` filtered on `isHot()`. So a camera two
streets from a flood gauge under water sat beside a red pin on the map and showed a clean picture.
That reads as the picture disagreeing with the map.

`camAlert()` now takes `isHot(s) || atDanger(s)`. `atDanger()` asks whether a sensor is at the top of
its own scale, and it is already what paints that pin red — a river over its mark, a sounding siren,
a flood gauge past 0.3 m of standing water, rainfall in JPS's top class. The pill answers the map's
question now, not the panel's.

**`isHot()` did not change, and nothing about what alerts you moved.** The alert panel, the icon
badge, the ticker and the toast all draw from `isHot()` and list exactly what they listed before.
Widening that set is an alert design decision and goes through the standard above. This one is a
label on a photograph, which is the same claim the pin beside it was already making.

Everything the widening adds is observed, so it is `now`. Only a river publishes a rate, so only a
river gets `soon`.

Each kind keeps its own field and its own unit — a river reads `level` in metres, a flood gauge
`depth` in metres, a rain gauge `hourly` in mm/h. The pill used to print ` m` on whatever it was
handed, which was safe only while the river was the one kind that reached it with a number. A siren
prints no figure. Its samples are 0 and 1, and an archive frame passes that 1 straight in.

### The archive scores all four kinds too

The pill would have been nearly inert without this. `?shots=` walked rivers only, so a gauge or a
rain gauge could raise a warning on the live frame and on no other — and the lightbox opens three
hours back and plays forward, so the live frame is the one nobody starts on.

`api.php` now scores each kind against its own mark: the published danger mark for a river and a
gauge, 1 for a siren, and JPS's own class boundary for rainfall. Only the river is handed `assess`.
The other three get one that never answers, which turns the `soon` half of `frameTiers()` off — the
same split the live path makes.

The rainfall mark is 60.1, not 60. `rainStatus()` scores `> 60` as the top class and `frameTiers()`
compares with `>=`, so the two agree only at a value the feed cannot publish between. JPS reports
rainfall to one decimal.

### Trade-offs accepted

The bar covers the bottom of the picture while it is up. That is the trade for the height, and it is
the trade every video player makes.

There is no tap-to-reveal on a phone. The bar is simply always there, which costs the bottom of the
picture on the device with the least of it.

The `title` on each tick is gone, and with it the only place a frame's own timestamp could be read
without moving to it. `.btime` prints the current frame's stamp on the picture, which is the same
fact for the frame anyone is actually looking at.

## A level bar starts near the river, not at zero metres

`levelStops()` used to put the foot of every water-level bar at 0 m. Most of these stations read
against an absolute datum. SERENDAH alerts at 35.80 m and was sitting at 34.06 m. So the whole safe
stretch of the bar — the opening 38% — was spent on 35 metres of river bed that the water never
visits, and the calm reading landed at 36.2%, hard against the alert tick at 38%. Every station on
such a datum drew the same picture: a bar that looks one pixel from trouble and never moves. A rise
of 30 cm moved it by a third of a point.

The feed publishes no bed level and no normal range. The one unit it does give for "how far this
river travels when it matters" is its own alert→danger gap. The foot of the bar is now `LEVEL_FLOOR`
(6) of those gaps below the first mark. SERENDAH reads 19.6% and the same 30 cm rise now moves the
bar 3.2 points. The three marks stay exactly where they were — 38 / 68 / 100 — so nothing about the
bands, the heat gradient or the legend changes.

`LEVEL_FLOOR` is a tuning knob and is marked as one in `config.js`. On the payload it was picked
from, 6 left 6 of 107 rivers resting on the floor and 4 still near the alert tick. A smaller number
flattens the calm stations to nothing. A larger one bunches them under the tick again, which is the
fault it was chosen to fix.

Water below the floor reads 0. That is the honest answer for a river metres under its first mark,
and it is what the bar said before for anything at the bottom of the scale. Stations on a bed datum
(BANDAR KLANG: alert 2.40, danger 3.00) compute a negative floor and keep their old behaviour, so
the change only touches the stations that had the fault.

The table's own bar was a hand-copied set of the same stops. It calls `levelStops()` now, so the
scale has one definition again.

### The water level column sorts by the bar it draws

The column ordered on `level / danger`. The cell draws `scalePos()` on the piecewise scale. The two
disagree, so two rivers could swap places against the picture in front of them. The sort key is the
bar's own position now. Severity still leads it — a sorted column is asked "show me the worst" —
and `scalePos()` already carries the band, so the two agree by construction.

### Trade-offs accepted

Rivers resting on the floor tie at 0 and fall back to alphabetical order. Six of 107 on the payload
this was built against. The alternative is a second sort term that orders stations by how far below
the floor they are, which is a ranking of how safe the safe ones are.

The heat weight reads the same stops, so a calm river now contributes less warmth than it did. That
is the layer working as documented: below its first published mark a station paints nothing, and
these stations were painting a third of an alert.

### The sort key is the bar, and nothing leads it

The published band used to lead the water level sort key, on the grounds that a sorted column is
asked "show me the worst". `scalePos()` already carries that band. 38 is the alert mark, 68 the
warning mark, 100 the danger mark, on every river's own scale. Two terms for one fact can only
disagree, and when they did the column put a bar with nothing in it above a bar two thirds full.
The key is the bar's position alone now. A river with no published mark draws no bar and sorts as
an empty one.

### Test mode faked an alert the one way the scale cannot draw

`seedTest()` built a climbing river as `danger × 0.82`. That is a fraction of the danger mark, and a
river reading against an absolute datum alerts at 35.20 m and reaches danger at 35.80. So 82% of
danger is 29.36 m — metres *below* the alert mark the fake had just stamped on it. Test mode was
showing an amber reading on a station its own scale placed in the safe stretch. The bar from zero
hid it at 32%. The bar from a real floor drew it empty, which is what the screenshot showed.

The fake now lands 40% of the way from the station's alert mark to its danger mark. Every faked
river draws at 62%, between the two ticks, whatever datum it reads against. Real data never had this
fault: `api.php` derives a river's status from its own reading through `wlStatus()`, and 0 of 108
rivers in the cache carry a status above normal with a level below their alert mark.

## The toast names the place in full

Each toast row was one line: the kind icon, the place name, then the reason. The reason took its own
width — "reaches danger in ~2.5 h" is a third of a 300px toast — and the name took whatever was
left, under a `text-overflow: ellipsis`. So the name was cut off on almost every alert this data can
produce. "KG. LEMBAH JAYA UTARA, AMPANG" is 29 characters and had room for about 16 of them. A
notification that names a place you cannot read has failed at the only thing it is for.

The row is a two-column grid now. The icon spans both rows, the name has the full width of the
second column, and the reason sits under it. Names wrap rather than truncate. The longest name in
the payload is 50 characters and takes two lines.

### Trade-offs accepted

A three-station toast is now about 40px taller. It is top-right of the map on a desktop only, which
is where the room is, and it already made way for the alert panel.

## The graph draws a line at the sample you are reading

The hover readout named a value and a time, and left you to find which part of the shape it came
from. On a 12-hour graph a quarter of an inch is an hour, so the answer to "which peak is that"
was a guess. A crosshair now stands at the sample under the pointer, and the readout sits above it.

It is a `<line>` inside the graph's own SVG, not a second floating element. The readout has to
float, because it is a box of text over a card that scrolls. The crosshair is one pixel of the
picture. Putting it in the SVG also settles the top-layer question for free: the table draws its
graphs inside a popover, and anything painted over one from outside has to be a popover itself.

The stroke carries `vector-effect: non-scaling-stroke`. The viewBox is stretched to whatever width
the graph lands in, so a plain 1-unit line comes out as many pixels wide as the graph is stretched —
three of them in a 300px card. The data polyline already had the same attribute for the same reason.

It follows the snapped sample, not the pointer. That is the rule the readout already used: readings
are 15 minutes apart, and a crosshair that tracked the pointer would sit beside the number it is
naming.

### Trade-offs accepted

The crosshair is drawn into markup that `render()` rebuilds every poll. A pointer resting still on a
graph loses the line for one poll and gets it back on the next move. The alternative is to redraw it
after every payload, which is state to carry for a mark that only means anything while a pointer is
moving over it.

## The gap between tiles is the page, not Leaflet's grey

Leaflet paints `.leaflet-container` `#ddd`, in both themes, whatever the basemap under it looks
like. A zoom out asks for four times as many tiles, and outside the area already on screen there is
nothing to retain and scale over the gap. So the new tiles arrive one at a time over that grey, and
on the dark basemap the ones still missing read as pale boxes.

`.leaflet-container` takes `var(--surface)` now. An unpainted tile is the page showing through,
which is what it is, and the value follows the theme toggle without a second definition. White sits
against Voyager's #fbf8f3 land and #202124 against the lifted dark basemap, so a gap stops
announcing itself either way.

A sampled land colour was the other option. It is a fourth palette value to keep in step with a
basemap we do not control, and it paints the sea the colour of land — half the tiles around Klang
are water.

### The crosshair follows the pointer, the reading holds

The crosshair jumped to the nearest sample. That made the line a set of about 48 positions on a
graph you drag a pointer across. You could move a centimetre and see nothing move, then have the
line snap past the place you were aiming at.

It sits under the pointer now, and the readout box moves with it. The reading is still a sample,
because the graph holds nothing else, but it is the last sample at or before the line rather than
the nearest one. Nearest was right while the crosshair stood on the sample it named. With the line
free it would change the number half a step early, so a level appeared to arrive before the line
reached the point that carried it. Holding the last reading is also what the station itself does
between two readings.

The readout no longer goes blank in the gaps for the same reason it never did: there are no gaps to
go blank in. Every position on the graph has a last reading, and before the first sample there is
nothing to draw, because the window starts at it.

## The stations table was on the page the whole time

Zooming out showed the all-stations table through the map. The cause was one declaration.

A browser closes a `<dialog>` with `dialog:not([open]) { display: none }` in its own stylesheet, and
any author rule that sets `display` on that element beats it. `#dataBox` set `display: flex` to
stack its search box over its scrolling table. So from the first time anyone opened the table until
the next reload, the closed dialog was laid out on the page — all 450 rows of it — and it was
invisible only because `#map` is absolutely positioned and painted over it. It surfaced wherever
the map did not paint, which is why it looked like a zoom bug.

`#dataBox[open] { display: flex; }` fixes it. `#lightbox[open] { display: block; }` sits nine
hundred lines below and had the rule right, which is the pattern to copy for any dialog that needs a
`display` for its own layout.

The closed dialog was also in the tab order and read by a screen reader as ordinary page content.
That is the more serious half of the same fault, and it went unnoticed because the visible half
looked like somebody else's rendering glitch.

### What it was not

The tile background was changed first, on the theory that the grid was Leaflet's `#ddd` showing
through where tiles had not arrived. That is a real fault and the fix stays — Leaflet's grey is
wrong in both themes and very wrong in the dark one. It was not this one. The lesson is the cheaper
one: reproduce before diagnosing. A grid over a map looks like a tile grid, and the question that
settled it in one round was "does it look like blank boxes, seams, or literally our table".

## A camera card says what the water is doing

Every card in this app offers the nearest picture. A camera card offered nothing back. That is the
wrong way round: a still of a river is a question about a number — is that high? — and the frame
cannot answer it. So a camera that does not share a mast with a river now carries the nearest water
level, named, with its reading and how far away it is. The button jumps to that station, where the
meter states it properly.

It is three parts, not one line of four. The first attempt strung them together —
"Nearest water level · TAMAN MAYANG · 14.6 m · 1.2 km" — a place, a reading and a distance on one
separator, which reads as a sentence that never resolves and breaks in the wrong place when it
wraps. The place leads now, because that is what the button opens. What it is and how far away it is
drop to a caption under it. The reading goes right, where every other number in this app sits, and
the name truncates rather than pushing it off the end.

The reading is coloured by `color()`, the same function the pin and the card use. The number alone
says nothing without the mark it is measured against: 1.74 m is a quiet river on one station and a
flood on the next, and the colour is the only part of that which fits beside it.

`nearestLevel()` in stations.js is the mirror of `nearestCam()` and shares its 5 km cap, because it
is the same question turned around. Past that distance "the river in this picture" is not a claim
this app can make from either end. 45 of the 62 standalone cameras get a line. The other 17 print
nothing, which is what `camLink()` already does at the same distance.

Cameras that share a mast with a river draw nothing new. That card is already showing both, and the
line would be a link to the section under it.

### The nearest webcam button names the camera, in the same shape

"Nearest webcam · 3.2 km" said a picture exists somewhere over there and left the reader to open it
to find out whether "over there" is their road or the next town. The name answers that before the
fetch, and it is what the lightbox is titled anyway.

It takes the same three-part shape: the place on top, what it is and how far away as a caption under
it. Strung on one line the name was a fragment in the middle of a sentence that never resolves. The
two buttons differ in one thing now — the level line has a reading to put on the right, and the
webcam line has none.

The same-mast branch keeps its bare "Show webcam". There is no other place to name and no distance
to state, so it is an action rather than an offer.

### Trade-offs accepted

Both buttons are two lines tall where they used to be one. A camera card and a river card each
carry one of them, never both, so nothing gained a row it did not already have.

A name over about 30 characters is cut with an ellipsis. On the level line the reading is the part
that must stay whole; on the webcam line it keeps the two buttons the same width. The full name is
on the card the button opens.

## A graph with one sample still looks like a graph

A station we have watched for an hour draws one line and one hour label. On a bare card that is a
stray mark with a number under it, and the number was falling off the edge. Three changes, and none
of them touches what is plotted.

**The plot sits on a plate.** `.spark svg` takes four percent of the text colour, mixed off
`--on-surface` so it is correct in both themes and against whatever the card is painted. The plate
is the frame the line is drawn in, so an almost-empty one reads as a graph that has not filled up
yet rather than as a rendering fault. `--hover` was the first value and it was about twice this
step. That token is a control lighting up under a pointer, and at that weight the plate read as a
panel of its own on a card that is already mostly panels. This has to be the least a surface can be
and still be a surface.

**A history glyph marks the corner.** `.spark::before` with `--i-history`, set back with opacity —
it labels the plate, it is not on it. One rule serves all three graphs, because they are one element
with three fills, and a fourth graph added later cannot forget to include it.

**Every hour label stays inside the card.** The clamping was `:first-child` and `:last-child` in
CSS. That is a guess at the real question: it is right whenever the first tick sits at 0 and the
last at 100, and wrong the rest of the time. With a single tick on the graph the element is both,
the right-hand rule won, and the only label a new station has was dragged off the left of the panel.
`axisHtml()` now decides the shift from where the tick lands on the axis — inside the first 8% it
hangs right, past 92% it hangs left, everywhere else it is centred. 8% of a 300px panel is 24px and
a label is about 34px wide, so a tick inside that band cannot be centred without crossing the edge,
and one outside it always can.

**The line graphs are a quarter taller.** 42px against the band's 34. A line has a shape and needs
the room to have it. A siren log is a state over time and there is nothing in it that more height
would draw better. They were the same box with different marks in it, which is what made a status
log and a reading look like the same kind of statement. The viewBox is 0 0 100 28 and stretches, so
the height is a CSS number and no template knows it.

### Trade-offs accepted

The plate is one more surface on a card that is mostly surfaces. It earns it on the graph that has
almost nothing in it, which is the one that needed help.

The glyph has no words. The caption under every graph already says what window it covers, and a
`title` is not a tooltip on a phone.

## The level graph draws the marks the water is near

A sparkline now draws the station's own alert, warning and danger marks across the plot, dashed, in
the status colour each one means everywhere else. A flood gauge draws its two.

The hard part is not the line. It is the y axis. The axis spans the readings and nothing else,
because the readings are the point: a river that moved 8 cm in twelve hours has to draw those 8 cm
as a shape. Stretch the axis up to a danger mark three metres above and that shape flattens to a
straight line under a red rule, which says less than the graph said before — on the 95 of 105 rivers
that are nowhere near their marks, which is every river most days.

So a mark is drawn only when it is within one *data span* of the readings, and the axis grows only
that far. Stated as a guarantee: the readings always keep at least half the height of the graph. A
mark further away than the river has moved all day is not something this graph can show without
becoming a worse graph, and the meter directly above states all three with their values anyway.
Perfectly flat readings have no shape to lose, so they fall back to the alert→danger gap.

Measured on the payload it was built against: 10 of 105 rivers draw a mark on a quiet day. Every
station climbing into trouble draws them the whole way up, which is when they are worth having.

### Trade-offs accepted

The marks carry no labels. Text in a stretched viewBox distorts, which is why the hour labels are
HTML underneath, and a second HTML layer for three dashes is more machinery than the meter above
already provides. The colours are the app's status ramp and they mean the same three things here as
everywhere else.

A calm river shows nothing new. That is the feature working: the mark appears as the water comes
within reach of it, which makes its arrival information rather than furniture.

## Rainfall draws its classes, and the readout names the band

Two halves of the same change: a sample's status is now a fact the graph carries, so both the plot
and the readout can use it.

**The rain graph draws JPS's intensity classes** — moderate at 10 mm/h, heavy at 30, the top class
at 60, in `RAIN_COLOR`. The boundaries are `RAIN_STOPS`, the same array the heat gradient is keyed
on, so the graph and the map cannot disagree about where heavy rain starts. Same admission rule as
the level graph: a class is drawn only when it is within one data span of the readings. The rain
axis is zero-based, so that span is the peak itself, and 4 mm/h of drizzle does not get its graph
flattened to draw a line at 60.

**The hover readout is printed in the sample's own colour**, with a warning glyph from the warning
rung up. A river wears the traffic light from its first mark (`RIVER_COLOR`) and the glyph starts at
its warning mark. Rainfall wears `RAIN_COLOR` and the glyph starts at *heavy*: light and moderate
rain is most of the rain there ever is, and a warning triangle on a drizzle is the cry-wolf failure
the alert standard exists to prevent.

> Superseded below by [The readout prints a normal sample
> plain](#the-readout-prints-a-normal-sample-plain). A normal sample now takes no hue at all, and every
> sample that does take one also takes the glyph.

### The status is scored where the reading is stored

The client does not compare a historical value to the marks beside it. That would be a second
definition of a status, and the second one always drifts. `sparkPoints()` in `api.php` takes an
optional scorer and appends the code to each sample: `[ts, value, code]`, through the same
`wlStatus()`, `rainStatus()` and `gaugeStatus()` the feeds themselves go through. Rivers, rainfall
and flood gauges have a scorer. Sirens keep the two-element shape and print plain: their samples are
0 and 1, and the readout already says "sounding" or "quiet" in words.

Every reader destructures `[ts, value]`, so the extra element is invisible to all of them. It costs
about 7.5 KB on a 284 KB payload.

`js/sparktip.js` still knows no units, no clock, no kinds and no palette. It receives a CSS colour
and a flag in `data-pts` and writes them to the element. The glyph is a `::before`, so the module
builds no markup and keeps using `textContent`.

### The tip's `display` is on `:popover-open`

`.sparktip` needed `display: flex` for the glyph. A browser closes a popover with
`[popover]:not(:popover-open) { display: none }` in its own stylesheet, and an author rule setting
`display` beats it — which is exactly how the stations table ended up laid out on the page behind
the map. The rule is on `:popover-open`, and it is the same guard for the same trap.

### The gauge scorer is new, and it is not a new alert surface

`gaugeStatus()` joins the other two in `sources.php`. Four rungs against two published marks, the
same shape `gaugeTone()` draws client-side and has to stay so: dry ground is 0, any standing water is
1, the 0.15 m warning mark is 2, the 0.3 m danger mark is 3. `gaugeTone()` reads the code upstream
published for the current reading. This scores a stored depth, which upstream never scored at all.

A gauge readout wears `GAUGE_COLOR`, whose second rung is `--s-trace` rather than the alert amber,
because upstream published no mark down there. Its glyph starts at rung 2, which is a published mark.

That glyph is not a widening of `isCritical()` and nothing about what alerts you has moved. It is a
readout under a pointer, on a sample somebody went looking for, and it counts nothing, badges
nothing and interrupts nobody. The alert design standard governs what claims attention. This waits
to be asked.

### Trade-offs accepted

The per-sample code costs about 7.5 KB on a 284 KB payload, now across three kinds.

### The archive files a frame under the clock time it aims at

Both sides of the archive bucketed a frame by `floor(ts / step)`. That expression aligns to UTC
midnight. Malaysia runs UTC+8, so the frame that survived landed at an hour nobody chose. The week
range sat on 01:30, the month on 07:30 and 19:30, and the year on a Thursday.

A tier now carries a third number, the **anchor**. A slot is the next target at or after a frame,
so the frame left standing is the last one taken *before* that target. The slot expression is
`floor((ts - anchor + step - 1) / step)`, which is `ceil()` on positive numbers.

That gives the state as of 16:00, not the nearest picture to 16:00. The two differ. Take frames at
15:24 and 16:10. The nearest to 16:00 is 16:10, which is a photograph from after the time it would
carry. A timeline must never show that.

| range | step | anchor | aims at (MYT) |
|---|---|---|---|
| week | 3 h | 7200 | 01:00, then every 3 hours |
| month | 12 h | 28800 | 04:00 and 16:00 |
| year | 7 d | 374400 | Monday 16:00 |

The three targets nest. 16:00 sits on the 3-hour grid, and Monday 16:00 sits on the 12-hour grid. So
a frame keeps hitting its target as it ages from one tier to the next. It does not drift once per
tier.

A slot with no frame is absent from the list. So "show the closest frame" needs no tolerance value
and no empty slots to skip. On a server capturing every 30 minutes a frame is never more than 30
minutes before its target.

`pruneShots()` and `thin()` write the same expression. A rule in one file only would let the ruler
and the clip file one frame in two slots.

### The stamp under the picture is a full date

`14 Nov, 17:00` says the same thing about last November as about this one, and the year range holds
frames 365 days old. The stamp now reads `Monday 3 August 2026 at 16:00`.

The weekday earns its place on the year range. That range aims at Monday 16:00, so the weekday is
what shows the anchor holding.

A phone gets `Mon 3 Aug 2026, 16:00` instead. Measured from the vendored Roboto at 11px over every
weekday and month, the long form is a 213.8px pill.

`#lightbox img` caps at `min(968px, 100vw - 64px)`. So a 320px viewport gives a 256px picture. There
the long form covers 83% of the photograph and overlaps the `live` pill in compare mode. The short
form is 137.7px and clears it by 70px.

`stamp()` reads `matchMedia('(max-width: 600px)')` on each call, so it holds no state. One line binds
`onchange` to `paint()`, for a turn from landscape to portrait.

`en-GB` writes the short form as `Thu, 1 Jan 2026, 16:00` and the long form with no comma at all,
joined by `at`. So one `String.replace` strips the weekday comma and does nothing to the long form.

### Trade-offs accepted

The first prune after this change deleted 353 of 1425 stored frames, all of them in the week tier.
That is the one-time cost of moving an archive from the old UTC grid to this one. Both grids
keep one frame per 3 hours, so nothing changes in the steady state. Each deleted frame sat 33 to 128
minutes from the frame that replaced it, in a tier whose resolution is 3 hours. One rule now covers
the whole archive, and no branch carries the old bucketing.

Retention works on age, so the grid fills as frames age into each tier. The month grid is correct 7
days after the change. The year grid is correct after 30 days. Frames already pruned keep their old
times.

A sparse archive still shows off-target frames. Capture runs when a poll runs, so a machine without a
cron stores frames in bursts. The closest frame to 04:00 can then be hours away. The stamp states the
real capture time, so the picture reports its own age.

### Not built

No viewer-facing time picker. Three fixed schedules cover the need. Add a picker when they stop.

No maximum distance, past which a slot shows nothing. The bucket rule already bounds the error to
half a step.

No rewrite of the frames already stored.

## About and Help share one dialog

The About dialog now holds two panes: About and Help. The `#about` button opens the same dialog
as before. There is no new dialog, and no new button in the app bar.

### Two panes, one dialog

Tabs replace two other options. An accordion keeps both panes in one scroll, on a dialog already
too long for that. A second dialog needs a second open button, and the app bar has no room for one.

The logo moved inside the About pane. It is the identity of that pane, not of the dialog. A logo
above both panes costs scroll on Help before the first line of help text.

About opens first, even though Help holds most of the words. The desktop convention puts About
last, as a leaf of Help. This dialog puts safety first instead. The not-official notice and the
emergency number sit in About, so a first-time reader meets them before anything else. That reader
outranks a naming convention.

### What moved, and what was deleted

The pin legend and the alert rules moved to Help unedited. Their wording had already passed a style
check, and this change did not ask for a rewrite.

The heat ramp swatches were deleted, not moved. `#legend` on the map draws the same two scales from
live values. A second copy in a dialog goes stale the first time the palette moves, and the palette
has moved four times already.

Three of eight planned FAQ rows were kept. The other five were deleted, because the interface
already answers each one where the reader asks it. A grey pin already says why it is grey. A silent
siren already prints "OUT OF CONTACT". A row that restates an on-screen answer teaches the reader to
stop reading the dialog.

### How this was built

A new section in About states four things: the code is AI-written, the project carries no
warranty, it tracks nothing, and where a shared location goes. Four checks ran against the code
before this section shipped: a grep for analytics scripts, a grep for `document.cookie`, a grep for
third-party hosts, and a manual read of every line that touches a location. All four held.

The first version of the third-party claim was wrong. It said the site "loads nothing from a third
party." `js/map.js:24` fetches map tiles from `basemaps.cartocdn.com` on every pan and every zoom,
and the Credits block two paragraphs down already names CARTO for exactly that. The dialog
contradicted itself within one screen.

The grep meant to catch this was `https?://(cdn|unpkg|jsdelivr|fonts\.googleapis)`. It matches only
a host that starts with `cdn` right after the scheme, so `basemaps.cartocdn.com` passed through
clean. That pattern guessed at hosts a tracker uses. It never asked what the page actually fetches.

The fix names the one exception: map tiles, from CARTO, credited two paragraphs down. The check was
rewritten to match: list every absolute URL in the code, then classify each one as fetched at
runtime or merely linked. A claim about what a site does not do needs a check that enumerates what
the site does do. A guess at what a violation looks like is not that check.

A later pass rewrote the section in the voice of a blog post. One paragraph per beat, and the
reader carried from the complaint to the code to the field work. Two other shapes came first. A
single dense paragraph reads as a specification. A two-column `.key` table, reused from the Help
pane, reads as a datasheet for a product, and each of those lines is a claim about what this site
does not do. A claim of that kind is an argument, and an argument in a table asks the reader to
take it as a measured fact. A sentence can also say what CARTO does not get.

The section carries no em dash. A machine wrote this prose, the em dash is the tell, and the first
paragraph says who wrote it in plain words. That line is worth less under a punctuation habit that
says the opposite. It sits in the first sentence it applies to rather than as a punchline at the
end, which is the worse joke and the better disclosure. A reader who stops after one paragraph has
still been told.

Ten paragraphs became five. A paragraph break asks the reader to stop, and the section had put a
stop between the complaint and the code, between the shuffle and the field work, and between four
claims about data that answer one question together. The five beats that remain are why this
exists, what the cameras did, how I checked them, what the project is not, and what it does with
the data a reader gives it.

The register changes at the third break. The three story paragraphs stay blunt. The two under them
use plain words, with no jokes, because a reader who gets that far wants to know what happens to a
location they share. The comment in `index.html` names that seam, so a later edit does not blur the
two voices back together.

The rewrite also put the camera coordinates in front of a reader. `CAM_FIX` in `api.php` is the one
place this app overrides a value its source states, and About never said how I made those
corrections. It says it now. I went to some of those places in person. For the rest I read the picture, a
road sign or a bridge or a river bend, and matched it against the station name. Camera 1288 is the
first entry a visit confirmed, and its point moved about 500 m to what I found there. Five cameras
stay wrong on the map, and the section says that too. A reader who finds a camera in the wrong
district learns here that the app knows, and that an invented coordinate is the worse option.

A later pass rewrote the section in the voice of a blog post. One paragraph per beat, a short one
where the story turns, and the reader carried from the complaint to the code to the field work. A
single dense block came first, and it reads as a specification. The blunt sentences survive the
rewrite word for word. The code is vibe coded, no team stands behind it, and the closing line asks
the reader to name what I got wrong.

The rewrite also gained the camera coordinates. `CAM_FIX` in `api.php` was already the one place
this app overrides an upstream value. The About pane never said how I made those corrections. It
says it now. I went to some of those places in person. For the rest I read the picture, a road sign
or a bridge or a river bend, and matched it against the station name. Five cameras stay wrong on
the map, and the section says that too. A reader who finds a camera in the wrong district learns
here that the app knows. They also learn that an invented coordinate is the worse option.

The section carries no em dash. A machine wrote this prose, the em dash is the tell, and the last
line of the section says who wrote it, in plain words. That line is worth less under a punctuation
habit that says the opposite.

The privacy claims became a spec sheet for one revision, and then went back to paragraphs. The
sheet reused `.key`, the two-column list the Help pane uses for its legends, and it read well. It also read as a datasheet
for a product. Each of those five lines is a claim about what this site does not do, which is an
argument, and an argument in a specification table asks the reader to accept it as a measured fact.
A paragraph makes the same claim and shows its reasoning in the same breath. The CARTO line is the
proof: as a row it says "CARTO, so CARTO sees which tiles your browser asks for", and as a sentence
it can also say what CARTO does not get.

Ten paragraphs later became five. A paragraph break asks the reader to stop, and the section had
put a stop between the complaint and the code, between the shuffle and the field work, and between
each of four claims about data that answer one question together. The five that remain are the
beats: why this exists, what the cameras did, how I checked them, what the project is not, and what
it does with the data a reader gives it. The words did not change. Only the breaks did.

The register changed with the shape. The story above stays blunt, and it ends on the line that says
an AI wrote it. Everything below that line uses plain words, with no jokes and no shrugging,
because a reader who reaches those paragraphs wants to know what happens to a location they share.
That seam is the point of the section, and the comment in `index.html` names it.

### The Developer section

The About pane gains a Developer section: the same diagnostics `#netstats` shows on hover, plus the
per-source counters. `CLAUDE.md` already names those counters as the alarm for a scraper that
broke — `parsed: 0` means an upstream table moved — but nothing on screen showed them before this.
`#netstats` and the new section share one renderer, so the two views cannot drift apart.

Three buttons sit under the counters: Refresh now, Raw payload, and Reset settings. Refresh now is
the one with teeth.

`?force=1` treats the five-minute file cache as expired, inside the existing lock on
`.refresh.lock`. Four rules keep it safe, and all four hold server-side, because a guard in the
browser guards nothing:

1. It runs inside the existing lock. A concurrent rebuild wins the race, and this request serves
   stale cache instead of queuing behind it, the same as any other loser.
2. It does not expire the fifteen-minute page cache. That cache exists because the KL rainfall
   table takes about ten seconds to render upstream. Expiring it on every press triples the cost of
   one button.
3. A stamp file allows one force per sixty seconds, for the whole site, not per visitor. A denied
   force serves the cache and states why.
4. The endpoint reads `?force=1` from a GET request only. A non-GET request gets a plain reason
   instead of a silent no-op.

Sixty seconds bounds the worst case at 270 requests per minute, about 4.5 per second. A normal cold
rebuild already fires 270 requests in about three seconds, which is 90 per second. The button
cannot produce a burst the site does not already produce on a cold start.

Two defects surfaced in review, both about where a value defaults.

`forced` first defaulted inside `serveCache()`, one of two functions that return a cached payload to
a browser. Every ordinary poll read the flag back from `.cache.json` and reported `forced: true` for
the next five minutes, because the flag a force request wrote sat in the same file every plain poll
also serves. The fix moved the default into `cachedPayload()` instead, the one function every cached
read passes through. The lesson generalizes: a flag written once and read back through several call
sites must default at the one place all of them pass through, not at each exit.

The first attempt at that fix missed one of the two exits. `serveCache()` got the default. The
branch that echoes `cachedPayload()` directly, guarded by
`if (function_exists('fastcgi_finish_request'))`, did not. That branch is dead under Herd, whose
SAPI is `cgi-fcgi`, so nothing here caught the miss. It is live on the nginx and php-fpm target
`docs/DEPLOY.md` describes. `CLAUDE.md` already documents this exact trap, for a stampede guard that
sat unused in the same branch for weeks. It caught a second fix the same way.

Two smaller defects also came from moving markup into this section.

The test-mode toggle moved here, out of `.modalhead`. The move changed which flex rule governed it.
As a flex item in a flex row, `flex: none` had sized it to its content. As a block child of a pane
with its own `display: flex`, it became a flex container that stretches to the width of its parent.
The fix pins `width: fit-content` on the moved element at its new site. Moving a component to a new
parent can change which layout rule governs it, even when the component's own rules do not change.

The Refresh now button hides on the GitHub Pages build, where `FEED` points at a static `api.json`
file. That file ignores a `?force=1` query and returns no `forced` field at all, so the button
reports "not refreshed" forever on a build a cron job already keeps warm. Hiding it uses the `hidden`
attribute, and `.link { display: flex }` in `css/base.css` beat the browser's own
`[hidden] { display: none }` rule — the same trap this project already documents for a `<dialog>`
that will not close. The fix adds `.rowbtns .link[hidden] { display: none }`, scoped so the drawer's
own two buttons keep their default behavior.

### `php api.php --selftest`

The check lives in the endpoint itself, not a second test file. It covers `forceAllowed()`'s rate
limit and `serveFromCache()`'s cache-or-rebuild choice, both arithmetic on a handful of integers.
Running that arithmetic through a real request means a 270-request fan-out at JPS for every
assertion. The self-test runs the same arithmetic offline, in milliseconds, against no upstream at
all.

### Trade-offs accepted

- The Developer section is public. Anyone who opens the dialog can press Refresh now. The rate
  limit is the whole defense. A password or a hidden query flag adds an auth surface to a site
  that has none anywhere else.
- Test mode sits one scroll further from the close button than it did in the close-button row.
- The Help pane holds a mixed prose register. The moved sections read as they always did. This
  change did not ask for a rewrite, and none happened.

### Not built

- No version number, no changelog, and no uptime claim. Nothing in this project can back any of the
  three.
- No memory of the last pane a reader had open.
- No `?` keyboard shortcut sheet. The four bindings already print on the buttons that use them.
- No URL fragment that opens a pane directly.

## The Help pane split into four sections, because one list mixed four things

The Help pane once opened on a single `How to use the map` list of nine rows. The owner rejected
it on screen for four reasons, and the fix rebuilds that one heading into four:
`The buttons along the top`, `Filters`, `The station panel`, `The camera viewer`.

### The ⓘ meant two things in one flow

The list showed `i-info` for the "Details" button on the station card. The `#about` button that
opens this dialog carries the same glyph. A reader who pressed ⓘ to reach Help then saw ⓘ again,
naming something else. The rebuild never prints `i-info` inside the Help pane. The Details row
names the button by its position on the card instead of by its glyph.

### The ▶ was a lie

The list showed `i-play_arrow` for "The camera player," beside a sentence that starts "Tap any
camera picture." There is no play button at that point. The play control exists only once the
lightbox is open. The rebuilt camera section leads with the true entry point. A row named `Open the
camera` carries no glyph, because no glyph sits on a photograph. It shows the four transport glyphs
(`i-skip_previous`, `i-play_arrow`, `i-skip_next`, `i-last_page`) under a `Transport` row that comes
after it. `i-compare` gets its own `Compare` row beside it. Both are genuinely on screen.

### A gesture and a platform feature are not controls

"Read a point on a graph" and "Install it" sat in the same nine-row list, which named only one
button in the header. A hover gesture is not a control this page built. Neither is the install
prompt the browser shows on its own. "Read a point on a graph" moved into `The station panel`,
beside the meter and the graph it describes.
"Install it" is gone. It sat under a heading named for buttons this page draws, and the install
prompt is not one of them. The browser decides when to offer it, on its own rules, and a reader
who never sees the offer cannot act on the instruction. The README still documents installing.

### Filters had one line for a whole subsystem

The old list gave the entire drawer one sentence: districts, ignored sensors, two heatmaps, the
rising-only filter, five sensor-kind chips, and the always-visible counts. The new `Filters`
section gives each piece its own row, including the two counts that never collapse. The drawer
keeps its own "N hidden" summaries. The `#shown` line sits beneath every section. Both are the two
indications the alert design standard requires to stay visible whenever an alarm is silenced.

### The dialog widened to fit four sections without a longer scroll

The `max-width` on `#aboutBox` moved from `min(600px, calc(100vw - 32px))` to
`min(820px, calc(100vw - 32px))`. The `calc()` stays untouched, so a phone still gets
`100vw - 32px` regardless of the first number. The existing `@media (max-width: 600px)` block
needed no change. It already reshapes `.key` to one column and shrinks the logo below that
breakpoint, and none of its rules name `600px` as the width of the dialog itself.

### Trade-offs accepted

- The `Transport` row in the camera viewer carries four icons in one `.ctl` cell rather than one
  row each. Splitting them adds four rows to describe one button group that already reads as one
  group in the player itself (`role="group" aria-label="Playback"`).
- The four new sections use American spelling ("Colored spans"), the spelling this project asks
  for in new prose. Task 15's spelling sweep later converted the pane's older sections too, so the
  Help pane now reads in one spelling throughout rather than two.
- A later change (widening `#aboutBox` to 820px) gave `#aboutBox p` a `max-width` in `ch` units, so
  a paragraph stops well short of the full dialog width. The `.key` grid keeps no cap: its
  two-column layout is what asked for the width in the first place.

## The readout prints a normal sample plain

The hover readout tinted every sample it showed. A calm river printed blue, a dry gauge printed
green, light rain printed violet. That is a colour on the samples that do not matter, which is what
makes a colour on the samples that do matter easy to miss. A reader has to look at the hue to learn
that the hue is not saying anything.

A normal sample now takes no colour. The readout keeps its own ink, `var(--on-surface)`: black on
white in the light theme, white on near-black in the dark one. Only a sample past a published mark
takes a hue, and the hue is the traffic light — amber at the alert mark, orange at the warning mark,
red at danger.

**The chip is no longer inverted**, which this change is what asked for. It was white ink on a
near-black box in the light theme and the reverse in the dark one. A tinted reading therefore landed
on the one background in the app the status tokens were never checked against: the palette is held
to its contrast ratios on `--surface`, and the chip was `--on-surface`. The chip now takes the
surface it floats over, and a 1px `--outline` keeps it off a card of the same colour, which the fill
used to do on its own.

**The colour and the warning triangle now travel together.** Every sample that takes a hue also
takes the glyph, so a tinted number can never be the only warning on screen. A river earns both at
its first mark, one rung earlier than before. Rainfall keeps the old cutoff: nothing until *heavy*,
because light and moderate rain is most of the rain there ever is, and a triangle on a drizzle is
the cry-wolf failure the alert design standard exists to prevent.

`TONE` in `js/popup.js` is the whole change. A flood gauge is the one kind whose colour and glyph
still part company, at rung 1: that is real water under the first published mark, so it stays
`--s-trace` with no triangle. It is neither a normal reading nor a threshold pass, and the reason
that rung exists at all is that upstream named no mark down there.

An offline sample keeps its grey (`NO_INFO`), for the same reason it always had one. Grey is not a
status on the traffic light, it is the absence of a reading.

`js/sparktip.js` did not change. It still receives a CSS colour and a flag, and it still knows no
units, no clock, no kinds and no palette. A kind that has nothing to say now ships an empty colour
more often, which the module already treated as "print it plain".

### Test mode had to start scoring its own samples

A faked flood printed plain in the readout, at every level and on every kind. `seedTest()` built its
histories as `[ts, value]`, and the third element is where a sample's status lives — so the readout
had nothing to colour by. The one surface built to show a level crossing its mark was the one
surface test mode had no way to show it on. That is exactly the gap test mode exists to close.

`js/test.js` now scores each fake sample as it makes it, through `wlCode()`, `gaugeCode()` and
`rainCode()`. These copy the cutoffs in `wlStatus()`, `gaugeStatus()` and `rainStatus()` in
`sources.php`. **This is not the client scoring history.** Nothing in test mode reaches a server, so
there is no scorer to ask, and the file already copied the rainfall cutoffs for the live status for
the same reason. Real samples are still scored in `api.php` and nowhere else.

Two duplicated bodies went with it: both rainfall fakes now call one `rainRamp()`, and the live
rainfall status now calls `rainCode()` instead of repeating the ladder inline.

A siren's fakes keep the two-element shape, because a siren needs no scorer anywhere. Its samples
are 0 and 1, which is the status itself. See the section below.

### A siren reads its own value, and says `Sounding`

The readout colours a siren sample red when the siren was sounding, with the same triangle every
other kind gets. That is the answer `atDanger()` already gives for the pin beside it, so the graph
and the map make one claim.

It needs no code on the sample and no scorer in `api.php`. A siren's history is 0 and 1, which *is*
its status. `TONE.siren` therefore reads the value, and every scorer in the table now takes both the
code and the value. A kind that leaves a sample unscored hands its scorer `undefined`, and every
comparison in the table is false against that — which is the plain print. The old `c == null` guard
in `readout()` did that job and is gone.

The words are `Sounding` and `Quiet` now, not `sounding` and `quiet`. The readout prints this word
where every other graph prints a number, and a lower-case word beside `1.74 m` reads as a fragment
of a sentence rather than as a reading.

### Trade-offs accepted

- Rainfall classes 1 and 2 (light and moderate) lost their violet. They now read the same as no
  rain at all in the readout. The plot behind the pointer still draws the class bands, so the
  intensity is on screen. The readout names the millimetres, which is the finer answer anyway.
- A river at its alert mark now shows a triangle in the readout where it showed a plain amber
  number before. This adds no alert surface: the change touches `isCritical()`, the badge, the
  ticker and the toast in no way. The readout appears under a pointer, on a sample somebody went
  looking for.

## The right edge of a graph says `now`

Every label on the axis was a clock time, so the end of the line was one more hour to read against
the clock in the corner of the screen. That end is the one a reader looks at first. It now carries
the word `now`.

The label sits at 100%, which is the newest sample. That is not the wall clock, and the two are up
to half an hour apart: JPS moves a value about every 25 minutes. Within the hour it is what `now`
means for this station, because there is nothing more recent to have.

Past an hour the graph takes no edge label at all. A station frozen on an old reading gets a plain
axis rather than a word that claims the line reaches the present. That is the same rule the offline
blocks and the stale footer already follow: the app does not date a reading it cannot vouch for.

Two details make it fit. `timeAxis()` drops a clock tick inside 8% of the right edge, because two
labels cannot share that end. And it marks the `now` tick so `rules()` skips it. A vertical line on
the border of the plot is a frame, not a gridline.

All three graphs get it. They share `timeAxis()`. The level line, the rain bars and the siren band
label their present the same way, on the station card, in the alert panel and in the table's hover
panels.

## Search by place

### The go-to box lists places, not sensors

The box listed one row per sensor and the map draws one pin per site, so a six-sensor mast was six
rows and one pin. A reader comparing the two had no way to tell that was one place. The box now
groups on `s.site || s.id`, the same key `render()` groups on, and names the row with the same
`leads()` call that names the pin. About 417 rows, down from about 680.

A mast row carries a chevron that lists its sensors. Both a mast row and a sensor row open the same
card, because there is one card per site. A sensor row additionally scrolls that sensor's block into
view and flashes it, anchored on a `data-sensor` attribute in `sitePopup()`.

**Trade-off accepted.** Every keystroke closes the open rows. A tree that stays half-open under a
list the next keystroke replaces points at rows that are no longer there.

**Not built.** A card per sensor. There is one card per site by design, and the site card already
shows every reading of every sensor there.

### `api.php?place=`

The go-to box searched the station list and nothing else, so a reader who wanted the water level near
a housing area had to know which station covered it first.

`?place=` joins `?cam=`, `?shots=` and `?shot=` on the existing entry point, which already owns every
outbound request this server makes. It proxies OpenStreetMap Nominatim server-side. This feature adds
no new third party to the browser. The browser still talks only to this origin and to CARTO's
basemap tiles (`js/map.js` fetches those on every pan and zoom — see the About pane's Credits block).
Only this server's PHP code reaches OpenStreetMap. The query is trimmed, collapsed, lowercased and
rejected outside 2 to 80 characters by `placeQuery()`, which `php api.php --selftest` exercises
offline.

`BOX` bounds results to the coverage area, with about 0.1 degrees of margin on the station extent,
so "Klang" means the Selangor town. The payload publishes the box as `box`, alongside `siteM` and
`ttl`, as a plain diagnostic a caller can read without opening the source. **Decision:** keep it
rather than remove it. It costs one array entry, and it helps anyone who reads the endpoint's raw
response. No client script reads it today — `js/ui.js`'s out-of-area message is a hand-written list
of state names, and a bounding box cannot generate that list on its own.

Each answer is cached in the `page` table of `.history.db` for 30 days, because place names do not
move. The rate limit guards the uncached path only, at one lookup per second site-wide, and it reuses
`forceAllowed()` rather than growing a second copy of the same arithmetic. An unlimited public proxy
to Nominatim is an open relay that gets our address blocked.

Only four fields survive: name, detail, lat and lon. The raw response is large and its shape moves
between versions, and the client must not depend on a schema we do not own.

**Not built.** Per-keystroke autocomplete. Nominatim's usage policy names it, and the client only
calls this when the reader picks the search row.

### Picking a place answers in the list, not in a card

A place row opens no card. It drops the pin, moves the map, and refills the search box with the
stations near that point — nearest first, one row per site, under a heading that names the place.
The reader then picks a station, and that row flies the map and opens the station's own card, the
same way every other row in this box does.

The first build opened a card instead. `herePopup()` already assembled "what is near this point", so
it became `nearPopup(latlng, head, capKm)` with two callers that differed only in the head, and a
searched place drew that card under the key `@place`.

**Why the list replaced it.** The card answered a question nobody asked. It gave four sensor sections,
each with a meter, a trend line and a 12-hour graph, and a reader who searched for a place wanted
one thing from it: the station that covers the place. Reaching that station meant reading four
sections to find the one line in each that was a jump. A place search asks "which station covers
here", and a list of stations is that answer stated directly. It also costs one press instead of
two, and it leaves `#side` alone, so a card the reader was already reading survives the search.

With the card gone there is one caller left, so `nearPopup()` folded back into `herePopup()`. A head
parameter and a cap parameter were two ways to build one card.

`nearPlace` in `js/ui.js` holds the picked place. `search()` reads it before it reads the query and
answers about the place instead. Any edit to the box clears it, and closing the control clears it.
A list of what is near somewhere the reader has typed away from is furniture with nothing under it.
The pin outlives both, because it marks somewhere they asked about.

The rows are ordinary site rows. A mast still opens its sensors on the chevron, `pick()` needs no new
branch, and the favorites mark still shows. `NEAR_MAX_KM` (10) bounds the list, past which a station
shares no catchment with the point asked about.

The pin is a plain `L.Marker` in `--accent`, anchored at its tip, with no accuracy circle — a geocode
has no accuracy to state. It persists until another place replaces it, exactly as the "you are here"
pin does.

The "you are here" card keeps its own `NEAR_MAX_KM` cap on river, rainfall, siren and gauge. The
camera keeps `CAM_MAX_KM` (5), which already means something narrower. Drop the cap and that card
names a siren 60 km away.

**Not built.** A favorite mark on the place itself. Favorites are sensors, and a geocode is not one.

**Escaping.** The place name survives the pick — it becomes the heading over the nearby stations —
so escaping it once in the result row is not enough. `escHtml()` covers the heading too. Nominatim
returns text anyone on earth can edit, unlike the government feeds every other row draws from.

**Not built.** Place search on the GitHub Pages build. That build has no PHP, so the trigger row is
gated on `STATIC` exactly as "Refresh now" is.

**About pane.** The privacy paragraphs gained two sentences, because a typed place name now reaches
this server and OpenStreetMap. The claim about the reader's own location is unchanged and still
true: this feature sends a name, never a coordinate.

## Favorites

`PREFS.favs` is an array of station ids, the mirror of `PREFS.ignored` and stored in the same blob.
A mark on a sensor's ⓘ menu adds one. A mark on a mast header adds every sensor there. It reads
solid only when every one of them is a favorite, because that button acts on all of them and must
state what one press will undo.

A sensor is never in both lists. Favoriting drops the id from `ignored` and ignoring drops it from
`favs`, because "show me this first" and "never show me this" is not a state a person meant to be in.

Five surfaces: a `FAVORITES` group leading an untouched search box, a drawer panel that mirrors
Ignored sensors, a `Favorites only` map filter, favorites-first ordering inside each alert panel
card, and the map pin itself. A pin carries the mark when **any** sensor at that site is a
favorite, and the map draws it outside the cluster so a chip cannot swallow it.

**Alert-standard note.** The alert panel's ordering is the only alert surface this touches, and it
moves order only. The set of alerts does not change. Nothing suppresses an alert, and no count moves.
This change does not touch the icon badge, the ticker or the toast. `isHot()` keeps its current
definition. Favorites are not an alarm control.

**Not built.** Favorites as an alert scope. That kind of scope suppresses alerts elsewhere. A flood
two districts away that a reader muted is the failure ISA-18.2 spends a chapter on. `PREFS.ignored`
stays the one suppression control in this app.

**Not built.** A favorites layer *chip* or a color of its own. A favorite is neither a status nor a
sensor kind, so it takes no kind color, and the mark itself is the whole indication. A plain
`favLayer` layer group (`js/map.js`) does exist, outside the cluster — that is the mechanism behind
"the map draws it outside the cluster" above, not a user-facing layer with a toggle of its own. Do
not fold it back into `cluster`: see "A cluster badge counts what it is hiding" in `CLAUDE.md`, which
this same branch added, for why the split has to stay.

**Trade-off accepted.** At low zoom a large favorites list is loose pins overlapping each other and
the clusters. That is the request: a favorite that clustering can swallow is a favorite the reader
cannot find.

### Spelling

This app uses American spelling everywhere: prose, code and every user-facing string. The interface
strings were converted with the place-search and favorites work. Comments and internal documentation
are swept separately, because a 500-line spelling change inside a feature diff makes the feature
impossible to review.

Two rules for any future conversion. Never touch an identifier, a CSS property or an HTML attribute —
`aria-labelledby` is an attribute name and `color` is already the CSS property. And prefer the symbol
`m` over the word "meters" in a new string, because `meter()` in `popup.js` draws the water-level bar
and the two would otherwise share a spelling.

### The favorite mark takes the header's corner

A multi-sensor card carried two marks in its header. A sensor-count chip sat beside the close
button, and a favorite mark sat inside the badge row below the place name. One control replaces
both. The mark takes the corner and the count goes.

The count went because it restated its own neighbor. The badge row sits directly under the name and
draws one badge per sensor. A reader who wanted the number saw it an inch below the chip that stated
it. The mark had no such alternative. It acts on the whole mast. Inside the badge row it read as one
more sensor, not as a control over all of them.

`.pophead .favbtn` centers on the place name's line at `top: 14px`. That is the header's own
`padding-top: 18px`, plus half a 15px/1.3 line, less half the button's 28px. That is the same
arithmetic the chip used with its own height. `CLAUDE.md` records the three numbers that move
together. Only one thing fits in that corner. The adjacent-sibling rule that reserves the room lets
a second chip sit on the place name instead of beside it.

**The header mark lost its ring, and the pin's mark lost its disc.** Both are the bare glyph now.
Every pin on this map is a glyph with no plate. The reason applies here too. A disc covers ground,
and it says nothing the shape does not already say.

Dropping the pin's disc cost it its edge, so the glyph pays for it with light instead of paint.
`.pin` carries a drop-shadow its children inherit. But `.pin.multi` sets `filter: none`. On a mast
the mark then lands on a filled indigo or red circle, with nothing between them. Two stacked
`--surface` drop-shadows draw a thin halo that flips with the theme.

**The mark carries a tooltip, and this project allows it here.** The rule is that a `title` means
nothing on a phone. So it must only duplicate something already on screen. The glyph already reports
which state it is in. The tooltip names the action that state offers. The `aria-label` carries the
same words. Nothing lives only in the tooltip, so a touch device loses nothing.

**Trade-off accepted.** A card no longer states its sensor count in words anywhere. The badge row is
the answer, and it was already the better one.

### The favorite mark is a heart

The favorite mark reported its state with color alone, muted to `--accent`. It is a heart now, and
it carries the state in its shape as well. A hollow heart means "not a favorite". A solid pink one
means "favorite".

**The hollow heart is the one `fill=0` icon in `css/icons.css`.** Every other glyph in that file
uses `fill=1`. The rule behind that is simple. A filled icon and an outlined one read as two icon sets when they sit
side by side. This pair earns the exception, because the pair *is* the message. One control
never shows both at once. A hollow heart against a solid one is the oldest idiom for this. Both
glyphs come from Material Symbols, `/fill1/` and `/default/` of one name.

**Pink shares a band with `--k-siren`, and that is the collision to know about.** A siren pin is
pink too. `--fav` runs deeper and more magenta, which is the only room the band has. Shape separates
the two. The `--me` note in `base.css` already makes that argument for hazard yellow. No station
glyph is a heart, so the hue never has to carry "this is not a reading". The light value sits just
over the 3:1 non-text floor on white. The brighter pinks do not clear it.

**Where to watch it.** The map draws a pink heart on a pin that can sit beside a pink siren pin.
Color is not the message there. The heart is a shape no sensor wears, and it carries a `--surface`
halo, so it never reads against the basemap alone. Even so, no two marks on this map have ever sat this close in one
hue band.

**Both card kinds carry the mark, from one builder.** A single-sensor station short-circuits to
`popup()`, which never had one. The mark lived on the mast card alone. A reader on a plain station
had to open the ⓘ menu to find the switch. `favMark()` draws it for both now. The two differ in how
many ids one press acts on. The tooltip reads the same on both. It says `Add to favorites`, or
`Remove from favorites`.

A single-sensor card offers the switch twice, in its corner and in its ⓘ menu. That stays. The
corner is where a reader learns to look across every card. The menu item stays anyway. The sensors listed
down a mast and on the "near this point" cards need it. Neither has a corner of its own.

**The search box lost its sensor count too.** A mast row showed a `layers` glyph and a count. The
count goes for the same reason the card's did. The mast glyph already says this is a stack. The
chevron says it opens. Opening it lists the sensors, which is the number named rather than stated.

### The mast pin drops its disc and its count

A mast pin was a filled disc in the mast indigo, carrying a white `layers` glyph and a sensor count
in a corner badge. Everything else on the map is a bare glyph. The mast is one too now, and the
count is gone with the plate that carried it.

The old argument ran that a mast stands for a stack rather than naming a sensor. It had no glyph
shape to protect, so it could carry a plate. That reads backwards. The `layers` mark **is** a shape,
it protects itself, and a disc at every mast put a plate over the ground the map exists to show. The
count went for the same reason it went from the station card and the search box: opening the place
lists the sensors, which is the number named rather than stated.

Two rules folded away with it. A mast scaled to `.7` where every other pin scaled to `.8`, purely
because a disc covers more than a glyph. It pays the same as the rest now. And a rising or
critical mast drew its ring as a `box-shadow` on the disc, with the shared `::before` halo switched
off. Both now use the same halo every other pin uses.

**The favorite heart needed a real outline.** A blurred `--surface` halo was not enough at 15px. A
blurred shadow spreads its opacity out and goes softest exactly where the shape is thinnest, which
on a heart is the two upper curves. Four hard 1px shadows, one per direction, draw a stroke instead
of a glow, and one soft dark shadow under them lifts it off pale tiles. The mark sits over a basemap, over another
pin's glyph, and sometimes beside a siren pin that is pink itself. The stroke is what keeps it
readable in all three places.

## Fourteen cameras that JPS plots in the wrong district

`Kolam Sg Kayu Ara` is a camera in Petaling Jaya. The map drew it 34 km away in Sepang. The pin was
faithful to the feed.

JPS publishes the wrong coordinate against that camera. The list endpoint and the detail endpoint
carry the same value, so there was no better number upstream to prefer.

The fault is not one bad number. JPS shuffled the coordinates inside one batch of cameras, ids 1276
to 1289. The coordinate on camera 1285 points at Kayu Ara, 1.5 km from where a gazetteer puts the
place. The coordinate on camera 1287 points at Tanjung Karang, 250 m out.

Each coordinate is real. JPS attaches each one to the wrong camera. Camera 1288, named
`Pekan Tanjung Karang`, drew in Bangi. That is 83 km from the town in its own name, and outside the
district JPS gives it.

`CAM_FIX` in `api.php` corrects fourteen of them. This is the only place the app overrides a value its
source states. The bar to add an entry is therefore high, and an entry gets in one of two ways.

**The first way is two checks that fail in different ways.** Both must pass:

1. The station name must geocode to the point, through the same Nominatim proxy `?place=` uses.
2. That point must sit near the median of the non-camera stations in the district JPS itself assigns.

A name alone is not enough, and check 2 is what proves it. `Bukit Serdang`, camera 1285, geocodes
cleanly and confidently to Seri Kembangan. That is 30 km outside the Kuala Langat district JPS gives
it, because a second place carries the same name.

A table built on check 1 alone writes that coordinate in. It then moves a camera from one wrong
place to another wrong place, with a clean-looking match as its evidence.

**A same-named station of another kind beats both checks.** Camera 1277 came in this way.

JPS puts a rainfall gauge, a river and a flood gauge on one `TAMAN DESA KEMUNING` mast. The camera
carries that name too, so it takes the coordinate JPS already publishes for the place. A gazetteer
guesses at a name. The mast is upstream stating where the place is.

The geocode had landed 200 m off. That is outside `SITE_M`, so the camera drew as a place of its own
beside a mast it belongs on. It is one pin with four sensors now.

Camera 1282 took the same route on a name that is only close. It reads `Kg Simpang Balak`. The siren
reads `SIREN KG. SG. BALAK`, which is Sungai and not Simpang.

What carries that one is the district. The published point was not in Hulu Langat at all, and the
siren of the near name is. A near name is weaker evidence than an equal one, so the table marks the
entry `SOMEWHAT CONFIRMED` and the next reader can overrule it. A near name never gets in alone.

Camera 1280 is the case that ranks a mast against a geocode. The gazetteer answer for `Sungai Lui`
lands 2.3 km from the `KG. SG. LUI` mast, beside a different station on the same river. A gazetteer
answers about a river. The mast is upstream stating where the place is.

Camera 1283 moved off a geocode for the same reason. It reads `Jenderam Hilir`, and JPS puts a
rainfall gauge and a river on a `JENDERAM HILIR` mast 1.9 km from the geocoded point. The camera now
draws on that mast.

**Search the payload before the gazetteer.** Camera 1289 is what taught that order. It sat with the
stations left as published, and it was the worst pin on the map at 118 km from its district. The
reason recorded for it was that no gazetteer holds `Rimba KDR`.

That reason was never the whole question. JPS publishes a `RIMBA KDR` rainfall gauge and river, in
Sabak Bernam, the district JPS files the camera under. The mast answers a name the gazetteer misses.
A missing geocode says nothing about whether upstream already states where a place is.

**The third way is the swap, read from the other end.** Camera 1285 came in this way, and the
geocode played no part in it.

Correcting camera 1279 orphans the point JPS had published for it. The five stations nearest that
orphaned point are all in Kuala Langat. That is the district JPS gives camera 1285. Camera 1285 is
also the only Kuala Langat camera in the shuffled batch, so exactly one station can own the point.

That argument needs both halves. The neighbours must agree on a district, and the batch must hold
exactly one uncorrected camera that JPS files under it. With two candidates in the district the argument says nothing,
and a coordinate goes in only when the evidence names one station.

**The strongest way is that swap solved for the whole batch at once.** Start here next time.

Take the point JPS publishes for each suspect camera. Name the non-camera station nearest to it.
Thirteen of the fourteen points land within 550 m of a station that carries the name of another
camera in the batch.
The answer is a permutation, and it closes:

```
1276 → 1280 → 1287 → 1288 → 1284 → 1278 → 1282 → 1277 → 1281 → 1286 → 1289 → 1283 → 1276
1279 ↔ 1285
```

Read `X → Y` as: the point JPS publishes for camera X is the true point of camera Y.

Thirteen links come from names. The fourteenth needs no name at all.

Those thirteen leave exactly one camera and exactly one point over. The two can only match each
other. So camera 1281, `Sg Betong`, takes the point JPS publishes for camera 1277. No gazetteer
holds that name. No mast carries it either. The cycle beats both, because the other thirteen links
allow no other answer.

**Rebuild the whole map before you argue about one pin.** One camera at a time took ten rounds and
still left four wrong. The permutation took one query and left none.

**No station stays wrong on the map now.** Cameras 1271, 1272, 1273, 1274, 1275, 1315 and 1316 each
sit within 1.1 km of a station of their own name. The cycle closes without them. JPS publishes all
seven correctly.

This page called two of them, 1272 and 1315, wrong for months. The whole case against them was a
gazetteer lookup that returned nothing. A gazetteer answers about its own index, not about a
coordinate. Camera 1289 shows the same trap from the other side. It was the worst pin on the map at
118 km. No gazetteer holds `Rimba KDR`. JPS publishes a RIMBA KDR mast, in the district it files
that camera under.

A coordinate we invent is worse than one we can show belongs to upstream. Nothing inside this repo
can detect the first kind. The outlier sweep in `CLAUDE.md` lists the second kind every time it runs.

**`CAM_FIX_KM` retires the table by itself.** An override applies only while the feed still disagrees
by more than 2 km. The day JPS corrects a station, our value stops being an override. The feed wins
again, and no line here waits for somebody to remember to delete it.

A hard-coded correction that outlives the fault it corrects becomes the fault. This one cannot.

`camFix()` is pure arithmetic on a few floats, so it joins `forceAllowed()` and `sirenBacked()` in
`php api.php --selftest`. Six assertions cover both directions and the id space. A siren numbered
1279 is not camera 1279.

One more assertion per entry puts the corrected point inside `BOX`. That check is cheap, and it
catches the one mistake a hand-typed coordinate table really invites. A typo parks a camera in
another country.

### Not built

**Nothing detects the general case.** The district-median sweep is a shell command in `CLAUDE.md`,
not code in the app. It reports real outliers as well as faults, because a large district genuinely
holds stations 27 km from its centre. Read its output as a shortlist to check by name.

Wiring it into the payload needs a threshold. Any threshold is wrong for Hulu Selangor or useless
for Petaling.

**No flag on the doubtful pins in the UI.** Seven cameras stay in the wrong place, and the map says
nothing about it. A reader cannot act on that warning. It also adds a new alert-shaped surface for a
data-entry error at JPS.

The alert design standard governs anything that alerts, and this does not clear it.

## The card title is the way back to its pin

The station panel is fixed to the right edge of the viewport. The map behind it moves. So a pan or a
zoom leaves a reader holding a card that describes a place no longer on screen, with nothing to say
where it went. The panel is also opened from four places that never look at the map first: the alert
list, the all-stations table, the ticker and the go-to box.

The card's title now carries `data-go`, the same attribute every list in the app already uses to jump
to a station. `goName()` in `js/popup.js` emits it, for a single sensor and for a mast alike. The
delegated handler in `js/ui.js` was already there and needed no change.

A click centres the pin, plays the ripple and refreshes the card in place. The key does not change,
so `openSide()` keeps the reader's scroll position and plays no swap wipe.

**The ripple now names the place.** `ping()` takes a third argument, and `flashTo()` passes the
station name. The label is a chip over the ring, and it fades out with it after `FLASH_MS`.

The panel holds that name too, on the other edge of the screen. After a jump the reader is looking at
the map, and a bare ring says "here" without saying what "here" is. Every other jump gets the same
label, because they all go through `flashTo()`.

This is not a map popup, and the rule against one still holds. The label attaches to no marker.
Nothing survives the flash. The marker carries `interactive: false` and the label adds
`pointer-events: none`, so it cannot take a click from the pin it names.

### Not built

**No keyboard handler on the title.** It is a `<div>` with a `title`. That matches the alert rows and
the place names on the "near this point" card. Each of those is a second route to a pin that already
takes a click on the map. One role and one key handler here, and none on the other three, leaves the
app less consistent than it started.

**No permanent label under the pin.** 417 pins with a name each make a second map over the first. The
label answers one question, at the moment of one jump.

**The ripple is `--accent`, not red.** It started red, on the argument that a jump is nearly always
to something that is alerting. The pin under the ring already carries the status colour, so the ring
was not the thing saying so. Red is this app's word for danger, and a red ring round every arrival
spends that word on "look here".

`--me` still holds the location ripple, because any other colour round your own position reads as a
claim about you. `.ping.place` went with the change. It named the colour that is now the default.

## Open in Google Maps

The ⓘ menu on a sensor now holds a third item. It opens the station's coordinate in Google Maps, in
a new tab.

This app answers one question: what is the water doing. It holds no route, no street view and no
satellite tile. Each of those is the next thing a reader wants about a place they can see is
flooding, and each of them is somebody else's map.

`mapLink()` in `js/popup.js` writes an `<a class="mi">`, not a button with a script behind it. The
browser opens a link in a tab already, and a phone hands the coordinate straight to the Maps app.
The URL is Google's documented `?api=1` search form, so one address covers every platform.

`.mi` gained `text-decoration: none`, because the rule now dresses an anchor as well as two buttons.

**A station with no coordinate gets no item.** The national portal publishes none, and a card for one
of those stations opens from the all-stations table.

**The About pane needed no change.** Its claim is about what the page loads, and this is a link. No
request reaches Google until the reader chooses to go there. The source-code and issue links in the
same dialog are the same class of thing. The full sweep of absolute URLs in the client code puts
`www.google.com` beside `github.com`, `carto.com` and `openstreetmap.org` as linked and never
fetched. `basemaps.cartocdn.com` remains the one third-party host the browser contacts.

### Not built

**No second map provider, and no picker.** One item that works is the whole feature. A choice of
three is a preference to store, a menu to draw and two more addresses to keep current.

**Nothing opens directions.** A route needs a start point, so it needs your location or a typed
address. The coordinate is what this app knows.

## The ⓘ menu's actions lost their subtitles

Each action in the menu carried a line of small grey text under it. "Lists it first in the search box
and the alert panel." "Hides it and stops it alerting you." "This point, in a new tab."

Three items became six lines, and the menu read as a page of documentation. Every subtitle restated
its own verb. A reader who does not know what "Add to favorites" does learns nothing from "lists it
first", and a reader who does know reads it on every open forever.

The three actions are now one line each. `sourceInfo()` keeps its two small lines, because those are
facts about the station and not a gloss on a button.

`ui.js` writes the favorite label with `textContent` now, rather than rebuilding the same markup with
`innerHTML`. It repaints that one item live when the heart is pressed with the menu still open.

**The name chip shipped behind the pin.** `ping()` drew the ring and the label inside one marker, and
that marker carries `zIndexOffset: -1` so the ring paints under the station pins rather than over the
one it points at. The label inherited that. A station marker is 39px anchored at its middle, so its
glyph covers everything within 20px of the point, and the chip sat at 18px.

`ping()` now draws two markers. The ring keeps `-1`. The name takes `1000` and sits 28px up, clear of
the glyph. Both stay `interactive: false`, which is the thing that actually keeps the click on the
pin. The z order was only ever about paint.

**The chip grew a tail.** A rounded box floating 28px over a ripple names a place without pointing at
one. `.pinglabel::after` draws a 6px triangle out of borders, centred under the chip. Borders, not a
rotated square: a square needs a background of its own, and its corners show past the rounded end of
a short chip.

The shadow moved from `box-shadow` to `filter: drop-shadow`, because a box shadow traces the border
box and the tail hangs outside it. The chip is a plain `<b>`, so it carries no mask and the filter
renders. An icon in this app cannot take a filter for that exact reason.

The width cap and the ellipsis went at the same time. Both need `overflow: hidden`, and the tail is a
child, so any clip on the chip cuts the tail off. A station name is around 30 characters and the chip
lives for 2.4 seconds over a point the map has just centred.

## Every camera on one page, and four buttons behind one

Almost every one of the 93 cameras publishes a picture, and the station panel answers one at a
time. A camera is also the one sensor that needs no mark to read it — a picture of a flooded road
answers by itself — so a page of pictures is the fastest read this data supports. `All cameras` is
that page.

**The app bar had no room for it.** The right group held seven buttons and filled the bar at 360
pixels. Two of them opened a dialog, so both moved into one ⋮ menu with the new view and a Help
entry of its own. The menu is `.menu`, the component the sensor ⓘ already uses, and the delegated
handler in `js/ui.js` places every popover carrying that class — so the menu needed no positioning
code, no library and no new icon. `i-more_vert` was already in `css/icons.css` with no user.

**Help and About started as one dialog with two tabs.** Splitting the entry points was not
splitting the dialog. That held until the tab strip read as a control offering the page the reader
had just declined. They are two dialogs now — see "Help and About split into two dialogs" below.

**One timer drives the whole grid, not one timer per tile.** `js/clip.js` carries a generation
counter and a rebind path because `render()` replaces the open card's `<img>` under it on every
poll. The wall is built once and painted in place, so that whole class of problem never arises and
none of that machinery was copied. A timer per tile is a wakeup per tile every second where one will
do, and tiles that step together read as one deliberate thing rather than as pictures out of phase.

**A tile costs nothing until a reader scrolls to it.** Eager, the page is one call to `?shots=` per
camera, about 550 frames, roughly 80 MB. An `IntersectionObserver` arms a tile the first time it
comes into view: fetch the list, warm the lap with `Image().decode()`, join the tick. Leaving view
drops it out and keeps its place. The first screen is about a dozen tiles and about 10 MB. `loading="lazy"` on
the still is the browser doing the same job for the one image every tile has.

**A poll paints, it does not rebuild.** `render()` calls `paint()`, which re-runs `camAlert()` per
tile and swaps the tier class and the phrase. It creates and destroys no element and touches no
`<img>`, so nothing jumps mid-lap. The name matches `paint()` in `js/timeline.js`, which does the
same job for the lightbox.

**The border makes no new claim.** `camAlert()` is the call the lightbox pill already makes — same
2 km, same `isIgnored()`, same exclusion of stale stations — so this is one existing claim on a new
screen rather than a fifth alert surface. Widening `camAlert()` would go through the alert design
standard. Adding a screen that reads it does not.

**The border alone was not enough.** Color alone is not a message, which is the finding that
rewrote the lightbox pill. So an alerting tile also prints the phrase, from `ALERT_TITLE` through
`camPhrase()` — the function the pill now calls too. One river cannot make two claims, because
there is one string.

**A filtered tile takes `hidden` and stays in the grid.** It keeps its lap, its frame list and its
warmed images, so clearing the box brings it back where it was. The observer needs no code for it:
the browser reports a `display: none` element as not intersecting, so the tile stops ticking by
itself. The kind label is left out of the haystack, because every tile is a camera and `camera`
would match every tile.

**The filter does not take focus on open.** The table focuses its box, because a table is a thing
you filter. This is a wall of pictures, and a focused input opens the keyboard over them on a phone.

**A camera with no coordinate keeps its picture and loses its jump.** JPS publishes some cameras at
`lat: 0, lng: 0` rather than a wrong point, and the picture is still the reason this page exists, so
the tile still draws. A click is the part that has to give: `js/map.js` falls through a missing
coordinate to `focusOn([0, 0], 13)`, which is the Gulf of Guinea, and the first version of this wall
sent a click there anyway, to a panel that never opened. `js/table.js` had already made this decision
for the same stations — its row for one of them carries no `data-mast`, so it offers no jump — but
`js/wall.js` built its tile from the same row shape as the table, without carrying the one attribute
that held the decision, so every tile answered a click whether it had somewhere to send one or not. A
tile now matches the table: no `data-cam`, `disabled`, and a `Not on the map` caption over the foot
of the picture, shaped like `.camsay`'s alert phrase rather than printed across the frame. `.unmapped`
on the tile itself drops the pointer cursor and dashes the border, so the judgment reads before a
reader tries the tile, the same one the table already made in its own row.

**Not built:** no compare, no scrubber, no transport — the lightbox holds those, and two places to
learn one control is one too many. No warning pill on a tile, because a pill states one frame's
alert and a tile has no way to score the frame on screen. No sort control and no favorites-only
mode. Add one when a reader asks.

## The wall gets a menu, a tighter grid, and a sense of progress

A second pass over `All cameras`, its entry point, and three findings a review turned up in the
same files.

**The app-bar menu became a grid, and took its own icon.** `#apps` used to open a plain list —
Station table, All cameras, Help and About behind a `more_vert` glyph titled "Views," which stopped
being true the moment Help and About joined it: neither is a view, and a screen reader announced
"Views button" over a menu that was half view and half everything else. The button is now titled
"Menu," and the icon is a fresh fetch of Material Symbols' `apps` — the 3x3 dot grid every platform
already uses for exactly this job. The menu itself lays its four items out 2x2 instead of in a
column, each item a tile with its glyph above its label: four short destinations scan faster as a
grid. Measured, the grid does not save height — the old four-row list came to about 148px including
the menu's own padding, and the 2x2 grid comes to about 157px, a little more rather than less — and
it earns its place on scan speed instead.

*The grid is scoped to `#appMenu`, not a second class on `.menu`.* The sensor ⓘ menu shares `.menu`
for its popover placement — the delegated handler in `js/ui.js` keys off that class alone and
measures the box itself — and keeps the row shape, which is right for its own longer, two-line
items. The id was already there to hang the new layout off.

*A specificity trap surfaced while wiring this up, worth recording so it does not happen again.*
`.menu { display: none }` and `.menu:popover-open { display: block }` are how every popover on this
page opens and shuts — the same "the display goes on the state selector, never the bare element"
rule the two `<dialog>`s already follow, in the gotcha list. Setting `display: grid` on the bare
`#appMenu` selector looked like the obvious way to switch the menu's layout. It compiles, and it is
wrong: an ID selector outranks two classes on specificity regardless of source order, so
`#appMenu { display: grid }` would have beaten *both* of `.menu`'s rules and left the menu on screen
permanently, popover open or shut. The fix matches the state selector instead of the bare id —
`#appMenu:popover-open { display: grid }` — the same shape the existing rule already used.

**Five columns, stepping down as the dialog narrows.** The grid used to be
`repeat(auto-fill, minmax(220px, 1fr))`, which drew as many columns as fit at 220px each — four at
most widths this dialog reaches, never five, never a round number. It is now
`repeat(5, minmax(0, 1fr))` at the dialog's own full width, and `minmax(0, …)` is doing real work: a
bare `1fr` cannot shrink a column below its own content's minimum width, so a station name too long
to break would have pushed its column past an even fifth and overflowed the dialog. `gap` dropped
from 10px to a uniform 6px on both axes.

*The column count steps down at two breakpoints*, worked from the dialog's own width formula
(`min(1060px, calc(100vw - 24px))`) less the grid's 40px of horizontal padding and the gaps between
columns, aimed at a tile no narrower than about 150px — the point a camera still stops reading as a
picture and starts reading as a swatch. Five columns cross that floor around 838px of dialog width
(rounded to an 840px breakpoint), four columns around 682px (rounded to 680px). Below 600px the
dialog changes shape outright — full viewport width, 12px padding, no `min(1060px, …)` cap — so the
last step, to two columns, rides the existing phone breakpoint instead of a fresh computed one: two
columns hold 165–285px across the whole 360–600px range, comfortably inside the target.

**Every tile reserves its space and shows where it stands.** `.camtile` already carried
`aspect-ratio: 4 / 3`, so the box was never the problem — a scrolling grid of 90-odd cameras with no
loading state was. Three additions, all keyed off classes `js/wall.js` toggles and nothing more:

- *A skeleton*: a `::before` shimmer over the tile's own idle fill, shown until the tile settles
  either way (`.camtile.done::before { content: none }` removes it, the same pattern
  `.shotwrap::after` in `css/base.css` already uses for a spinner). The highlight is `--on-surface`
  at low opacity through `color-mix()` — never a literal white or black, because this box sits over
  an empty tile, not a photograph, so it has to move with the theme like everything else that is not
  a picture. It stops moving under `prefers-reduced-motion: reduce`: a still skeleton still says
  "waiting," and a moving one is exactly what that setting asks to remove.
- *A failed state*: `videocam_off` and the sentence "No picture" in place of the browser's own
  broken-image glyph, which says nothing about what went wrong and looks the same for a 404 as for a
  slow connection. The markup — `.camfail`, structured the way `.camsay` already is — sits in every
  tile from the start and is revealed only by class, so `js/wall.js` never builds a node here, only
  toggles one. It is full-bleed and opaque on purpose, not a corner badge: there is no picture behind
  it worth leaving visible.
- *One pair of capture-phase listeners on `#camGrid`*, not an inline handler per tile. `load` and
  `error` do not bubble, so a delegated listener has to sit in the capture phase to see them at all —
  by the time either would reach an ancestor in the bubble phase, it has already stopped propagating
  from the `<img>` itself. Bound once, at import time: `#camGrid` is static markup that is never
  recreated, only its children are. `tick()` rewrites `img.src` once a second per visible tile once a
  lap is running, so `load` fires again on every frame after the first — the handler checks for the
  `done` class before doing anything, so a tile settles once, and a good live still followed by a
  404'd archive frame does not retroactively mark the tile failed.

**A progress bar for the batch actually in flight, not a counter over 90.** Tiles arm as they scroll
into view, so a bar keyed to the whole grid would sit near empty for the entire session and read as
stuck. `js/wall.js` instead tracks `waiting` (tiles that have started loading their own first
picture and have not yet settled) and `batchTotal` (how many the current batch began with); a tile
that starts loading while `waiting` is zero begins a fresh batch rather than growing the old one
forever. The start signal is a tile's first `IntersectionObserver` intersection — an
`<img loading="lazy">` has no "began fetching" event of its own to hook, and arming lines up with the
browser's own lazy-load trigger closely enough to read as tracking the real thing.

The bar sits under the dialog's header, inside `#camBox`'s own flex column, and reserves its
3px-plus-margin box whether or not a batch is running: only `opacity` and `aria-hidden` change,
never the element's presence, so a batch starting or finishing never resizes `#camGrid` above or
below it. The fill is drawn by CSS (`transform: scaleX(var(--p))`) off a fraction `js/wall.js`
writes as a custom property — never a pixel value from script. It carries `role="progressbar"` with
`aria-valuenow`/`aria-valuemin`/`aria-valuemax`, and drops out of the accessibility tree through
`aria-hidden` while idle.

**Three findings from the same files, folded in alongside.** `#camFind` was an OS-default text box:
`css/base.css`'s two shared selector lists for every text input in the app (`select, #goto,
#dataFind` and its focus-ring twin) never named it, so it shipped with none of the app's own width,
padding, border, radius or focus ring. Both lists now include it. The camera CSS block sat between
the two halves of the all-stations-table section — `.shotbtn`, `table.data` and the table's own
phone media query all ran *after* the camera section header, 180-plus lines from the `#dataBox`
rules they belong beside — so the whole block moved to sit after the table section ends, media
queries included, and the two sibling dialogs now keep their phone rules together instead of split
across an unrelated header. And `.camsay .i` carried a `filter: drop-shadow(...)` that had never
once rendered: `filter` runs before `mask` in the paint order, and `.i` is a box of `currentColor`
with the glyph masked out of it, so the shadow is computed against the box and clipped away by the
mask that follows it. Deleted, with a comment recording why nothing replaces it — `.camwarn .i` in
`css/map.css` carries the identical dead rule and is left alone, since fixing it belongs to whatever
change next touches that file.

## The wall and the clip play a strip, not a frame at a time

The wall arms about sixteen tiles at once. Each one fetched a frame list from `?shots=` and then
warmed six or seven individual 1280-wide frames at roughly 214 KB apiece, to paint a tile about
200 px wide. One scroll of the grid was over 600 requests and several hundred megabytes. The
station panel's clip did the same thing for one camera into a box about 340 px wide — smaller in
scale, but the same shape of waste: a full 720p frame fetched once a second to draw a picture nobody
was viewing at more than a third of that width.

Video players solve this with a sprite sheet. NVRs solve it with a low-resolution sub stream for
grid views. A strip is both at once: one derived WebP per camera, holding every frame inside the
clip window laid out side by side, each cell already scaled down to the size a tile or a card
actually needs. A caller fetches that one picture and steps through it with a CSS transform. No
frame list, no per-frame request, and — past the first fetch — no request at all.

**`SHEET_W` x `SHEET_H` is 480x270.** Every camera measured publishes 1280x720, so 480x270 is the
same 16:9 at three-eighths scale. The widest consumer is the panel clip, whose box is about 340 px —
480 is roughly 1.4x that, sharp without being wasteful. The wall tile is narrower still, about
200 px, so the same cell is about 2.4x there. Going wider was rejected on memory, not bandwidth: a
decoded strip costs roughly `SHEET_W * cells * SHEET_H * 4` bytes once a browser's compositor
unpacks it, and a seven-cell strip at 480x270 is already about 2.6 MB decoded — times up to sixteen
tiles live at once on a five-column desktop grid, which is the ceiling this size was chosen against.

**`.camtile` is `aspect-ratio: 16 / 9`, the cell's own shape, not the `4 / 3` it carried while a
tile only ever held one still.** That earlier ratio was a choice made for a single picture, not for
a strip: `SHOT_W` and every measured camera are already 16:9, so a strip cell is too, and asking a
4:3 box to display a 16:9 cell only ever meant a crop or a stretch either way. Matching the box to
the cell removes the question rather than answering it — a strip's width/transform stepping (below)
lines up with real cell boundaries regardless of `object-fit`, because there is nothing left for
`object-fit` to reconcile. The station panel's clip box (`.shotwrap`/`.shot` in `css/base.css`) was
already 16:9 from the start, for the same underlying reason.

**`SHEET_Q` is 70, lower than the stored frame's own 82.** A stored frame is the archive's one copy
of that moment — the record — and it is worth spending bytes to keep it faithful. A strip is a
cache, rebuilt from those frames on demand whenever it goes stale, so a softer quality costs nothing
that cannot be regenerated, and it buys a real cut in the bytes a scrolling wall has to move.

**Built on request, never inside `captureShots()`.** That function runs holding the `flock` on
`.refresh.lock` the whole app depends on — see the gotcha in `CLAUDE.md`. Encoding a strip is a
decode, a resize and a re-encode per frame; doing that for ninety cameras inside that lock would
hold it for the better part of a minute on every single capture, which is the stampede the lock
exists to prevent, in slow motion, again. `buildSheet()` in `shots.php` runs instead from the
`?sheet=` handler in `api.php`, the first time somebody actually opens that camera, and rebuilds
only when the strip on disk is older than the newest frame inside the window — so the real cost is
at most one build per camera per `SHOT_EVERY` (30 min), and only for a camera somebody looks at.
Measured against a strip built with three frames in its window: a cold build took 0.36s and 71 862
bytes; the same request immediately after, still inside the window, took 0.06s off the file already
on disk — the rebuild-only-when-stale rule paying for itself on the very next open.

**`img.naturalWidth / SHEET_W` is the cell count.** Nothing else needs to know how many frames a
strip holds — no header, no manifest, no frame list fetched at one moment while the strip itself was
built at another and might disagree with it. The picture answers the question by how wide it decoded.
`js/wall.js` and `js/clip.js` both probe a strip through a detached `Image()` before touching the
card or tile's own `<img>`: `camImg()`'s template wires that element's `onerror` to swap itself for
an "image unavailable" placeholder on any failed load, which is right for a dead live still and wrong
for a thin archive — routing a `?sheet=` 404 straight into that handler would destroy a perfectly
good live picture just because this camera has not built three hours of history yet. A camera with a
strip under two cells never reaches either module: `buildSheet()` returns null below that floor and
the endpoint answers 404, the same as no strip at all, so the client only ever has two outcomes to
handle — a real, playable strip, or nothing — never a one-cell edge case to filter out.

**The cache header is `public, max-age=900`, not the year-long `immutable` a stored frame carries at
`?shot=`.** A stored frame never changes once written, so an immutable, year-long cache is honest. A
strip's bytes at the very same `?sheet=<id>` URL change every time `captureShots()` lays a fresh
frame under it and the strip goes stale — up to once every `SHOT_EVERY`. `immutable` there would be
a lie a browser could hold for a year: a reader who reopens a camera after one capture cycle would
keep seeing the strip from before it, with no way to notice. `max-age=900` is half of `SHOT_EVERY`,
so a reopen inside that window costs nothing and a cached strip can never outlive one capture cycle
by more than that same margin.

**The lightbox and its scrubber (`js/timeline.js`) are untouched, and stay on `?shots=` and full-size
`?shot=` frames on purpose.** That view scrubs the whole archive by the clock, needs a timestamp and
an alert tier per frame to paint the seek bar and the compare divider, and opens far enough back that
a 480x270 strip would be a visible downgrade on a picture someone deliberately zoomed into. The wall
and the clip both answer "what does this look like, roughly, right now" — the lightbox answers "show
me exactly this moment," and a strip cannot serve that second question at the resolution it deserves.

**The clip's lap still ends on a freshly fetched live still — that guarantee was never given up,
only reworked around the strip.** `js/clip.js`'s own header comment states the reason and it did not
change: a card is opened to answer "is it like this now", and a lap that stopped on the strip's own
newest cell would answer with a picture up to `SHOT_EVERY` (30 min) old, not with now. The lap is
`n + 1` positions — cells `0..n-1` off the strip, then position `n`, the live still — the same shape
the old per-frame version gave it before the strip existed. Entering position `n` drops the tile's
`.strip` class, which clears the strip's own `width` and `transform` along with it, so the live
still draws at its own natural size rather than at strip scale and offset; leaving it restores both,
and the `<img>`'s `src`. The strip is still the exact bytes the lap decoded when it started, cached
under `?sheet=`'s own 900s window, so returning to it costs nothing. **This is the camera wall's one
real trade-off, not the clip's.** `js/wall.js` dropped the live position on purpose: ninety tiles
cannot each pay for a fresh `?cam=` fetch a second, and `paint()` keeps a tile's alert state current
on every poll regardless, so a wall lap now ends on the strip's own newest cell rather than on a
guaranteed-fresh picture. A station panel shows one camera, and one live still a second is one
request — cheap enough to keep paying for.

**`object-fit: fill` is still what a strip needs while it plays, on both the wall and the clip, even
though `.camtile` now matches a cell's own 16:9 shape.** A strip is one wide bitmap; `cover` scales
it by a single factor and crops whatever is left over off its two outer edges — checked against the
arithmetic, not by eye, that crop lands near the strip's own ends rather than at each cell's
boundary once the strip holds more than one cell, so the two outermost frames lose most of their
width and a neighbour's pixels bleed into the frame beside it everywhere else. `fill` scales width
and height independently with no crop, and because the box and the bitmap both widen by the same
cell count together, that scale factor repeats identically for every cell — the one `object-fit`
value the width/transform stepping actually lines up against real cell boundaries under. With the
wall tile now the same 16:9 as a cell, `fill` has nothing left to stretch and is a plain no-op there,
same as it already was on the clip's own box — but the reasoning above is what makes that hold
regardless of whether the two shapes happen to agree, not the agreement itself, so `fill` stays.

**`.camtile`'s border went from `var(--outline)` to `transparent`, unrelated to the strip itself.**
Colouring the border while a tile's skeleton is still shimmering, or once it has settled on nothing
to report, reads as a frame drawn around empty space. `transparent` keeps the same 2 px reserved —
nothing shifts once a picture or a `.t-now`/`.t-soon` colour arrives — while showing no colour until
one of those two classes actually has something to say. Same specificity as before, so `.t-now` and
`.t-soon` still win over the default exactly as they did.

## The wall's rows never followed its tiles

`.camtile` carries `aspect-ratio: 16 / 9` and no height of its own. That is the correct way to shape
a tile, and it worked. Every tile measured exactly 16:9 at every column count. The **rows** did not
follow. On the live wall of ninety tiles the grid computed a row of **27.86 px** against a tile of
**110 px**. Each tile drew across the two under it, and the wall looked like a spread hand of cards.
The same markup cut down to ten tiles computed a **283 px** row against the same 110 px tile. That is
one fault drawn twice: overlap in one case, wide empty bands in the other.

Neither number is a function of the column width. At 800 px and at 700 px wide, with tiles of 175 px
and 150 px, the row stayed 186.83 px both times. An automatic row asks each item for a content
contribution. An item that takes its height from a ratio alone answers that question with something
else.

`grid-auto-rows: min-content` is the whole fix. It asks the row for what the tile needs, not for what
the tile holds. A box with a fixed ratio needs the height of that ratio. Every overlay inside a tile
is absolutely positioned — the name, the alert phrase, the "not on the map" caption and the "no
picture" cover. So no tile ever needs a taller row than its own shape.

**Three other explanations were tested first, and all three were wrong.** `align-items: start` on the
grid stops stretch alignment overriding the ratio. The row stayed at 283 px. `position: absolute` on
the tile's `<img>` leaves no in-flow child to push the row. The row stayed at 283 px. A different
tile ratio changed the shape of every tile and moved no row at all. Only the row property moved the
row.

**How this was found matters more than the fix.** The bug arrived as a screenshot, and both readings
of that screenshot were wrong. The overlap looks like a `z-index` fault. The ten-tile version looks
like a `gap` fault. Neither guess survived a measurement. What settled it was a headless Chrome run
against the real page: open the wall through its own buttons, then print
`getBoundingClientRect()` for the tiles beside `getComputedStyle(grid).gridTemplateRows`. Two numbers
that had to match did not, and the distance between them named the property to change. **Measure a
layout bug before you explain it.**

## Six dead payload fields, and two diagnostics kept on purpose

A repo-wide audit for over-engineering found sixteen cuts. This change makes twelve of them. It
rejects two. The record covers both, because the rejections carry the rule.

**What went, on the server.** The payload carried a `hotspots` array of 53 entries and a `district`
rollup of 23. No client script read either one. `hotspots` also cost one upstream request on every
cold rebuild, so the list endpoint went with it. `district` counted alerts and rising stations per
district. `districts()` in `js/render.js` now tallies the same numbers from `state.data`.

Every station carried `reading`, which is the Selangor list's `lastReading`. That field is null on
the gauges this app cares about. Twenty-five KL rivers carried `srcTrend`, the SPHTN trend arrow.
`CLAUDE.md` already recorded that field as unused. `klTrend()` in `sources.php` went with it. So did
the `normal` column, which `klStations()` parsed and then dropped at the merge.

**What went, on the client.** `SOURCES` in `js/config.js` held a `short` and a `url` for each of the
three feeds. Only `name` ever reaches a screen. `NEAREST` was an object of three fields for one
string, and that string appeared a second time in lower case as a search haystack. It is one constant
now. `squash()` lowercases, so the matcher needs no copy.

`js/test.js` exports `stationsFaked()`. No module imports it. Four more functions carry an `export`
that no module imports: `favPanel`, `ignoredPanel`, `counts` and `heatScale`.

**What went, in CSS.** Three Material glyphs had no user: `--i-more_vert`, `--i-person` and
`--i-visibility`. This file already records the first one as user-less, from the change that turned
the ⋮ into an ⓘ. Do not confuse `--i-visibility` with `--i-visibility_off`, which the ignore control
uses. `.i-history` went too, but its token stayed, because `.spark::before` reads it. `.swatch` in
`css/base.css` matched no markup. The CSS cut is 1.4 KB.

**What stayed, and why.** `endpoints` and `box` are unread by any script. They stay.

The payload is a diagnostic surface. The About dialog's Developer section links to it as **Raw
payload**. A person reading that response is a reader. `box` states this in its own comment, and
`ttl` is unread on the same terms.

`endpoints` holds the only per-list station count in the response. If `StationSirens` comes back
empty, `details.requested` drops, and nothing else names which list moved. That is the alarm
`sources.parsed` already gives for the two scraped feeds.

**The rule this draws.** A stated diagnostic stays. A superseded computation goes. `district` claimed
no diagnostic role, and a client feature had already replaced it. `box` and `endpoints` answer a
question a person asks of the raw response. An audit that asks only "does code read this" cannot tell
the two apart. Ask what a field is for before you delete it.

**Trade-off accepted.** `hotspots` was real data, at 53 entries per poll. Nothing plotted it. It
returns in one line the day something does.

---

## The clip caption was clipped by the box that holds it

The station panel's camera card prints one line under the picture: `Last 3 hours` while a clip
plays, or when the still was taken when there is no clip. That line disappeared and came back, over
and over, for as long as the card stayed open.

`js/clip.js` was not involved. It keeps the caption's text in `capText` at module scope for exactly
this reason, and `bind()` writes it back on every rebuild. The text it held never changed.

The fault was one CSS rule and the element tree under it. `camImg()` in `js/popup.js` puts the
picture and the caption in one box:

```html
<div class="shotwrap" data-clip="1279"><img class="shot"><p class="clipcap"></p></div>
```

`.shotwrap` carries `overflow: hidden`. `.shotwrap.done` relaxes it to `aspect-ratio: auto` once the
first picture loads, so the box measures the image **and** the caption. `.shotwrap.strip` then pinned
it back to `16 / 9`, and the strip's own image took `height: 100%` of that. So the box was exactly
the height of the picture, the caption started on its bottom edge, and `overflow: hidden` cut it off.

`tick()` toggles `.strip` once per lap: off at the live position, on at cell 0. The caption was
therefore visible for the one second a lap spends on the live still and hidden for the rest of it.
At six cells that is one second on and six off, forever.

**The fix is where the ratio lives, not whether it exists.** The ratio has to be stated — a strip is
`--n` times wider than a frame, and `.shot`'s own `16 / 9` would compute its height off that widened
width and grow the picture taller with every extra cell. Stating it on the **image** instead solves
the same problem without measuring the box: `aspect-ratio: calc(var(--n, 1) * 16 / 9)` widens the
ratio by the same factor the width widens by, so one cell resolves to the height a single frame had,
and the wrapper is left free to size to both its children.

`.shotwrap.strip { aspect-ratio: auto }` is then stated rather than inherited from `.done`. A strip
can be playing before `.done` is on the box: `render()` rebuilds the open card on every poll and
`bind()` re-adds `.strip` to a new `<img>` that has not fired `load` yet. Without the explicit
`auto`, the base `16 / 9` would take over for that moment and clip the caption once per poll — the
same bug, at a slower rate, which is the harder one to see.

**The rule this draws.** A box that clips its overflow, and holds more than one thing, must not have
its height pinned by one of them. Two other explanations were considered first and both were wrong:
that `stop()` was blanking `capText` on a re-probe, and that `finishEmpty()`'s `id = null` forced a
re-probe on every poll. Both are real code paths and neither fires here — every camera serves a
strip, so `finishEmpty()` is not on the common path at all. Checking that (`?sheet=` returns 200 for
every camera) is what ruled the JS out and sent the search to the stylesheet.

## The camera wall states its total at the foot, and how many are not answering

Two changes to `#camBox`, and one number that was missing.

**The count moved to the foot of the dialog.** It sat under the filter box, above the grid, where a
total is a claim a reader has to take on trust before seeing anything. Under the grid it is what a
reader arrives at. `#camCount` is now the last child of the dialog, with `flex: none` and a
`border-top`, the same shell `.dtop` uses on the edge it faces.

**It names the cameras that publish no picture.** `cameras()` in `js/wall.js` filters on `s.image`,
so a camera with nothing to show has always been dropped from the grid in silence. On the payload
this was built against that is 3 of 93, and the dialog drew 90 tiles and said `90 cameras` — true,
and it left the reader with no way to know the other three exist. The line now reads
`90 cameras · 3 offline`.

The number counts the payload, not failed loads. A tile that fails to fetch its picture is a
different thing and is deliberately not in it: tiles arm as they scroll into view, so a count of
failures would start at zero and climb as a reader moved down the wall, which reads as the page
breaking under them. `offline` is fixed at `open()`, like the grid itself — `paint()` deliberately
does not rebuild the grid on a poll, and a total that moved while the tiles it counts did not would
disagree with them.

The tail is appended only to the lines that carry a total. `No camera matches that name.` does not
take it: the filter is not talking about those cameras, and answering an unasked question there is
the padding the message standard already bans.

## The loading bar is the seam, not a widget parked above it

`#camBar` was an inset pill: `margin: 0 20px`, `border-radius: 999px`, 3px tall, on a grey
`--outline` track, holding a reserved row of its own in the dialog's flex column so that toggling it
could never resize the grid.

That shape is a component *in* the layout. It needs its own margins to look deliberate, its own row
so it does not shove anything, and it still reads as an object somebody placed there rather than as
the state of the thing it describes. It is now the boundary between the header and the grid: edge to
edge, 4px, square, no margins.

**`margin-bottom: -4px` is what buys that.** The bar keeps its 4px of paint and returns the same 4px
to the column, so it contributes no height at all. That is the identical guarantee the reserved row
gave — `#camGrid` cannot be resized by anything this element does — with no row to reserve. The grid
starts underneath it, so a scrolled tile passes behind the bar rather than shunting it.

**Which is where it drew behind ninety tiles.** `#camBar` took `z-index: 1` and still lost. The
cause was not the number. `.camtile` is `position: relative` with no `z-index`, and a positioned box
opens a stacking context only when its `z-index` is something other than `auto` — so every number
inside a tile (`.camsay` 1, `.camtile::before` 2, `.camfail` 3) was resolving against `#camBox`, not
against its siblings in the tile. Two of the three beat the bar. The shimmer at 2 is the one that
showed: a tile carries `::before` until its picture settles, which is precisely the state every tile
is in while the bar is up. The bar drew behind all of them and showed only through the 6px gaps
between columns.

`.camtile { isolation: isolate }` is the fix, and it is one declaration. The numbers inside a tile
were always written to mean "inside a tile" — the comment on `::before` says the `2` only has to
clear `.camsay`'s `1` — and this is what makes them mean it. Raising the bar to `4` was the other
option and is worse: it wins this race and leaves the leak for the next thing that paints near a
tile.

**The rule this draws.** `position: relative` does not scope a `z-index`. A component whose parts
carry small numbers relative to each other has to say so, or those numbers are competing with the
page. The map pins in `css/map.css` record the mirror of this trap — there, `position` had to be
*added* before a `z-index` would apply at all.

**The track is the indicator's own colour at low weight**, `color-mix(in srgb, var(--accent) 20%,
transparent)`, not `--outline`. Two halves of one bar should be one hue at two strengths. A neutral
grey track reads as a groove that a separate coloured thing slides along, which is the widget
reading this change is getting rid of. `border-radius: inherit` came off `#camBar::after` with the
radius it was inheriting.

**Not changed.** The bar still tracks the batch in flight rather than all ~90 cameras, for the reason
already recorded above it: tiles arm on view, so a bar counting every camera would sit near empty all
session and read as stuck.

## The splash kept catching clicks for 300ms after it disappeared

The app bar's buttons did nothing on the first press after landing, and worked on the second. It read
as a slow button.

`#splash` covers the viewport at `z-index: 900` and fades out with
`transition: opacity .3s ease, visibility .3s`, going to `opacity: 0; visibility: hidden` on `.gone`.

**`visibility` interpolates as a discrete step that holds its start value for the whole duration.**
Going `visible → hidden` it therefore stays `visible` until the transition ends. `opacity: 0` does
not stop hit-testing. So for the full 300ms the splash was an invisible sheet over the entire page,
swallowing every click, while the map underneath looked ready to use.

`pointer-events: none` on the `.gone` state is the fix, and it is deliberately not in the transition
list, so it applies the instant the class lands. `visibility: hidden` stays for the end of the fade,
where it still does real work for the tab order and for a screen reader.

**The rule this draws.** `opacity: 0` plus a transitioned `visibility` never stops a click. Any
overlay that fades itself out needs `pointer-events: none` stated on the faded state. `CLAUDE.md`
files this beside the `#gotoBox` focus trap, which is the same sentence of the spec seen from the
other end: there a transitioned `visibility` refused a `focus()` on something already on screen,
here it accepted a click on something already gone.

## Two heatmaps could both be on, which the drawer says is impossible

The Heatmap section states one choice: water level, rainfall, or neither. `PREFS.heatLayer` stores
exactly that, as `'water'`, `'rain'` or `''`. The pair could still end up both on, by two routes,
and once there it stayed.

**The markup carried a second source of truth.** `#heat` had a `checked` attribute and `#rainHeat`
did not. `js/ui.js` writes both boxes from the pref, but it is a deferred module, so between parse
and run the DOM held a state the pref could not express. A browser restoring form state across a
reload puts `#rainHeat` back on top of that, and both are lit. Neither box carries `checked` now.
The pref is the only writer.

**The repair was gated on which box was clicked.** The handler read
`e.target === el('heat') && el('heat').checked` before switching the other off, so it only ever
fixed the pair when one of these two boxes was the thing that changed. A pair that arrived already
both-on survived every toggle of the two pin filters that share the handler, while `PREFS.heatLayer`
saved `water` and the drawer went on showing both. The test moved to the pair, whoever fired the
event.

**Both repairs failed, because the handler is not the only writer of a checkbox.** The bug came back
with a signature that named the fault. The legend drew both ramps, both chips were lit, and the
section summary still read `RAINFALL`. Three surfaces, two answers. `syncHeat()` reads the boxes on
every poll, and the summary was written from the change handler alone. So the summary held the last
answer a reader gave, and the legend held the state the DOM had drifted to since. Nothing in this
app writes that box. A browser does. It restores form state across a reload, and it fires no
`change` when it does, so a repair that lives in the change handler never runs.

**The fix inverts the direction.** `syncHeat()` in `js/heat.js` now reads `PREFS.heatLayer` and
writes the two boxes, the legend, the layers and the summary from it. The handler writes the pref
from the one box that fired, and reads neither box back. One string with three values cannot hold
both-on, so no writer can put the pair into that state for longer than one poll. `syncRisingChip()`
and `syncFavChip()` in `js/render.js` already re-assert their own chips this way on every poll. The
heat pair was the only preference-owned control that did not.

**And the four checkboxes carry `autocomplete="off"`.** That stops the browser writing them at all,
which closes the window between a reload and the next poll. The three text inputs in this app
already carried it.

**The rules this draws.** A control whose state is owned by a preference must not also state that
state in the markup. An invariant repaired on one path through a shared handler is repaired on none
of the others. And an invariant repaired in a handler holds only against writers that call it —
repair it where the state is read, not where the reader changes it.

## A river's sparkline always draws its marks now

The graph drew a mark only when it sat within one *data span* of the readings. The reason was the
shape: the y axis spanned the readings alone, so a river that moved 8 cm in twelve hours drew those
8 cm as a real shape, and stretching the axis to a danger mark three metres up would flatten it.
Measured on the payload at the time, 10 of 105 rivers drew a mark on a quiet day.

That is now reversed for rivers. Every mark a river publishes is drawn, and the axis grows to hold
it.

**Why.** The question a reader brings to a river graph is how far this is from trouble. A graph that
answers it only once the river is close answers it exactly when it has stopped being the interesting
question. The marks are the scale. Without them the shape is 8 cm of movement with nothing to measure
against, and the reader has to carry three numbers down from the meter by eye.

**The cost, accepted.** A calm river draws as a near-flat line along the foot of the graph. That is a
true picture — the river is flat, three metres under its mark — and the trend figure beside the graph
states the movement in m/h for anyone who needs the centimetres.

**A flood gauge keeps the old rule.** Its two marks are 0.15 m and 0.3 m of depth over a spot, so
they are never far from the readings, and its axis crosses zero where a river's does not. There is no
distant mark to reach for and nothing to gain.

## Water reads as water on the dark basemap

The dark map made a flood map that hid its water. CARTO's `dark_all` paints water and land in two
grays that sit close together, so the sea and the lakes disappeared into the ground around them.
A station reading means more when the reader can see the water it stands on.

This section covers the sea and the lakes. Rivers needed a second and different answer, and the
section below this one covers that.

The fix tints one color. `index.html` holds an SVG `feComponentTransfer` filter, and `css/map.css`
adds it to the tile pane filter the dark theme already runs.

### Why a filter, and not an overlay

This section covers three routes. Two of them lost.

**Draw the water from OpenStreetMap data.** A query over the coverage box returns 9,319 water
features and 23 MB of raw geometry. Trimmed to rivers plus bodies above 0.1 square kilometers, and
simplified to 33 meters with Douglas-Peucker, that falls to 2,775 lines and 438 polygons, 553 KB of
GeoJSON and 147 KB over the wire.

The size is affordable. The cost is a data file to bake, a bake
script to keep, an attribution line to add, and a canvas renderer for 3,200 new paths. Rejected as
too much machinery for a tint. The measurements stand if this is ever wanted at higher fidelity.

**Add a third-party water tile overlay.** One line of code. It also puts a second outside host in
the browser. This repo vendors every asset for that reason, and CARTO is the single exception
already named in the Credits block. Rejected, and the user rejected it first.

**Tint the basemap.** No new data, no new host, no new dependency. Dark theme only, which is where
the problem is. This is what shipped.

### Finding the tone

The first attempt guessed that a `saturate()` boost lifts water. Water is usually the one blue
thing on a map. Measurement killed that.

A histogram of a Klang coast tile returns 18
distinct colors and every one of them has a chroma of zero. The dark basemap is pure greyscale, so
`saturate()` and `hue-rotate()` have nothing to act on.

The second attempt guessed that water was the darker of the two dominant tones. Measurement killed
that too. Drawing the tile as ASCII art, one character per tone, shows the Straits of Malacca as a
solid block on the west edge in the *brighter* tone. Water is luminance 38 and land is luminance 9.

Filled water is therefore one exact value, which is what makes a filter possible at all. The tone
holds at zoom 10, zoom 12 and zoom 14, and on the retina tiles, which carry the same 18 colors.

A river is not filled water. That limit is the next section.

### Why 64 bands

`feComponentTransfer` with `type="discrete"` splits the input range into equal bands. The table has
64 entries because 64 is the smallest count that gives luminance 38 a band to itself.

Luminance 34
falls in band 8, 38 in band 9, and 42 in band 10. Those neighbors are road and boundary tones, and
they must not take the color. At 32 bands, 34 and 38 share a band. At 48 bands, 38 and 42 share one.

The other 63 entries hold their own band's center, so they pass a tone through to within one level.

### The color, and the order the filters run in

The filter emits `#071b2a`, which is darker than what appears on screen. The dark theme already runs
`brightness(1.75) contrast(.92)` on the same pane, and that chain lifts the tint to `#15364e`.

The value comes from rendering the whole chain against real tiles. A color that looks right on its
own is a different color. A first pass previewed the tint alone and read far too bright.

The two filters are one declaration, and the tint comes first. Two rules cannot each set `filter` on
the same element, because the second replaces the first rather than adding to it. And the tint keys
on the raw tile tones, so it must read them before `brightness()` moves every tone into a new band.

`color-interpolation-filters="sRGB"` is on the filter for the same reason. SVG filters work in
linearRGB by default, which moves every tone before the table reads it.

### Deliberately not built

- **No light-theme tint.** Voyager already paints water in a pale blue with real chroma, so
  `data-lift="no"` keeps the filter off.
- **No control.** The tint is part of the dark basemap, the same as the lift it rides with.
- **No river highlight from station data.** The app knows where its river stations are. It does not
  know where the rivers go, and a line between stations is not a river.

### What breaks it

CARTO owns this tone. If CARTO restyles `dark_all`, water stops being luminance 38, and the tint
lands on nothing or on the wrong thing. Nothing errors. The check is the histogram in this section.
This is the accepted cost of tinting somebody else's picture instead of drawing our own.

## The theme control moves into the menu, and gains Auto

The theme toggle was the last button in the app bar. It was an icon button. Its glyph named the
theme of the next press. Two problems came with that shape.

A glyph alone cannot state a state. `dark_mode` on the button meant "press this to go dark". So one
picture had to say what will happen and what is true now. A reader had to guess which reading
applied.

The app bar also carried seven controls. A reader sets the theme one time and then leaves it alone.
A control used one time does not need permanent space.

**The control is now a row in the app menu, under the four tiles and under a rule.** The four tiles
above it are destinations. This row is a setting. The rule and the row shape mark the difference.

The row goes back to the shared `.mi` layout: glyph, label, control on one line. A setting reads as a
line of text with its state at the end. The column layout the tiles use has nowhere to put a state.
`#appMenu hr, #appMenu .swrow { grid-column: 1 / -1 }` spans both columns. It leaves the auto
placement of the tiles alone. The row carries `.info` as well, the class the sensor menu already uses
for a row that is not itself a button.

### Three choices, not two

A switch went in first. It has two positions and the theme has three answers. "Follow the system"
is a third choice, not a shade of light or of dark. So the control is a segmented pill of three: Auto, Light and Dark.

**Auto is the default.** `PREFS.theme` holds the pick. Anything that is not `light` or `dark` means
system, so an absent pref needs no special case.

**The shape is the lightbox range selector's, shared rather than copied.** `.seg` and `.seg label`
are grouped into the `.tlranges` and `.tlr` rules. A sunken track holds three pills, and the chosen
pill fills with the accent. There is no outer border and there are no dividers.

A bordered box went in first and read as three buttons in a frame. The point of this control is that
the selection sits inside one object and moves along it. That is the same argument the range selector
already makes for its own five. The `PLAYER_OVERLAY` block restyles `.tlranges` and `.tlr` in literal
whites for a photograph. It names those two selectors only, so none of that reaches the menu.

**One extra declaration keeps the track tight: `.seg label { margin: 0 }`.** `css/base.css` styles
the bare `label` element for the drawer's stacked filter rows, and that rule carries `margin: 6px 0`.
It reaches every label in the app.

Measured, it made the track 37px tall around 21px pills. That is 6px of dead air above and below each
pill, inside a shape whose whole point is that the fill hugs the segment. The lightbox pills are
`<button>` elements and never met the rule.

The symptom is space around the control rather than inside it, which reads as a padding mistake on
the row. Three other explanations came first and a measurement killed all three.

- The row padding. It is symmetric at 8px.
- `align-items` on the row. It is already `center`.
- The flex item stretching. `align-self: auto` on a centred row cannot stretch it.

**The segments are real radio inputs, hidden rather than replaced.** The browser keeps the group
exclusive, walks it with the arrow keys and reads the label out. A set of styled buttons gets none
of that for free. The CSS clips each input to one pixel rather than
hiding it with `display: none`, which drops an input out of the tab order and leaves the control
mouse-only. Each input sits in its own
`<label>`, so the segment is the hit area and `:has(:checked)` paints it.

### One resolve step, two ways in

`setTheme(t)` stores the pick and calls `applyTheme()`. `applyTheme()` resolves the pick to a real
theme, writes `dataset.theme`, writes the `theme-color` meta tag and rebuilds the basemap.

The two functions are separate because the system can change the answer with nobody picking
anything. `matchMedia('(prefers-color-scheme: dark)')` fires `change`, and `applyTheme` is the
listener. It reads the pref every time, so it is a no-op on `light` or `dark` and needs no test of
its own.

`applyTheme()` returns the pick rather than the resolved theme. `js/ui.js` uses the return value to
check the matching radio at load. The control shows what the reader chose, not what that resolved to
today. The markup carries no `checked` attribute, for the reason `#heat` carries none either. See
the gotcha list in CLAUDE.md.

### The one-time clear

The old toggle wrote a resolved `light` or `dark` back to `PREFS` on every single load. So every
stored value that predates this control came from the system, not from a reader. Those values leave
Auto reachable by new visitors alone, which is not what a default means.

`if (!PREFS.themePick) { delete PREFS.theme; PREFS.themePick = 1; save(); }` in `js/map.js` clears
the pref one time and marks it. A reader who had deliberately set dark under the old build loses
that once. The control is now on screen, and putting it back is one tap.

### The menu stays open

`js/ui.js` closes `#appMenu` on any click inside it, in the capture phase. That keeps a menu item
from calling `showModal()` while its own opener is still in the top layer. The theme row is the one
exception, gated on `.swrow`.

A menu that closes on a theme change hides the control. It hides it at the moment you want to see
the result, and try another one.

### `#apps` is now the last control in the app bar

It is the only control there that opens a panel of its own. A panel sits against the button that
opened it. Between `#alertBtn` and two icon buttons, its popover had controls on both sides.

The `light_mode` icon leaves `css/icons.css`. Nothing referenced it after the glyph stopped swapping.

### Deliberately not built

- **No theme row in the drawer.** The drawer holds filters, which change what the map shows. The
  theme changes how it looks.
- **No scheduled theme.** A clock-driven switch is a fourth state, and the system already offers one
  on every platform this runs on. Auto inherits it.
- **No fade on the theme change.** `applyTheme()` rebuilds the basemap as a new tile layer. A page
  that cross-fades over a map that pops is worse than one that changes at once.

## The map draws the water the basemap will not

The water tint above gets the sea and the large lakes. Two kinds of water it never reaches, and
both matter to a flood map. Rivers are one. Retention ponds are the other.

### Why the tint fails on a river

A river is one pixel wide. CARTO draws it as an antialiased line, so its pixels blend toward the
land tone by however much of each pixel the line covers. The single fill tone the filter keys on
never appears.

Measurement settles it. Take a Voyager tile, mark every pixel that light mode paints as water, then
read the dark tile at those same positions.

At zoom 10 the sea maps to tone 38 for 80% of its pixels. That is why the tint works there. At zoom
12 and 13 over Kuala Lumpur, tone 38 is absent from the tile entirely.

The river pixels land on tones 33 through 50 instead. Tone 37 is the peak, and only 20% to 27% of
tone 37 is river. The rest is roads and buildings. Tinting it paints three wrong pixels for every
right one.

Some tones do reach 71% to 100% river. Those hold 50 to 165 pixels each, and they are the bright
core of the widest channels. Keying them draws a dotted fragment.

No filter recovers this. Antialiasing threw the information away before the tile arrived.

### Why the tint fails on a retention pond, for a different reason

A pond is small. The 6,489 water bodies in the coverage box have a median area of 0.0037 square
kilometers, about 60 meters across, and 97% fall under a tenth of a square kilometer.

The failure is not size on screen. It is that CARTO leaves them out.

Tasik Taman Desa, at 0.115 square kilometers, holds 2,036 water pixels at zoom 13 and 6,509 at zoom
15, so the tint paints it correctly. A median pond of 0.0017 square kilometers holds **zero** water
pixels at zoom 13, 14 and 15 alike.

That pond is 41 meters across, which is 8 screen pixels at zoom 15. It is large enough to draw. The
style drops it on area, so no zoom brings it back, and a filter cannot recolour something absent
from the picture.

### What ships instead

`water-build.php` bakes `water.json` from OpenStreetMap, and `js/map.js` draws it over the dark
basemap. The file holds 2,775 rivers as lines and 3,860 water bodies as filled shapes, simplified to
33 meters with Douglas-Peucker and rounded to four decimals. That is 940 KB on disk and 234 KB on
the wire.

**Tolerance and scope are separate knobs, and confusing them wastes a lot of bytes.** Douglas-Peucker
controls the detail inside a shape the query already returned. Dropping from 33 meters to 11 meters
takes the rivers alone from 105 KB to 199 KB. It adds no pond at all, because a pond was never a
line in that query.

Reach for the query when something is missing. Reach for the tolerance when something looks crude.

No area floor. Small ponds simplify to a handful of points, so keeping everything costs the same
130 KB as a 0.001 square kilometer cutoff. A floor that saves nothing is a rule to maintain for no
reason.

The bake runs by hand. Overpass is a free service, the data changes about as often as a river moves,
and nothing in a request path depends on a third party this app does not control. A 504 from
Overpass is routine under load. The script fails loudly and writes nothing, so a retry is the answer.

`water-build.php` reads the coverage box straight out of `api.php` with a regular expression, so the
two cannot drift apart. Overpass returns whole ways that cross the box, so a few rivers run past its
edge. That is correct. Clipping them costs more than the coordinates it saves.

### Rings, and why a lake is not a list of ways

A large lake's outline is usually several ways in one relation, and each way on its own is an open
line. Closing each one separately draws the lake as a handful of wedges.

`rings()` walks each chain end to end, flipping a way that joins backwards, and keeps only what
closes. An open chain means a broken relation upstream, and the script drops it rather than guess.
Inner rings become holes on the polygon, so an island in a reservoir stays dry.

### The layer

**Dark theme only.** Voyager paints water in a pale blue with real chroma, so light mode already
reads well. The layer is never added on light, and the file is never fetched there.

**Fetched once, and lazily.** The first dark theme of a session asks for `water.json`. A reader who
stays on light never pays the 234 KB. The code swallows a failure. No water is a plainer map, and
every reading still draws.

**Canvas, not SVG.** 6,635 shapes through the default renderer is 6,635 DOM nodes to carry through
every pan and every zoom.

**Its own pane at z-index 250.** That sits between the tiles at 200 and the overlays at 400. Heat
blobs, station pins and the accuracy circle all draw over the water rather than under it.

**A pond is a fill with no stroke.** An outline on an 8-pixel shape is most of the shape.

### The color

`--water` lives in the dark block of `css/base.css` and `js/map.js` reads it by name, so no hex
lands in a JS file. `js/map.js` reads it at the moment it builds the layer, not when the fetch
returns, because the token exists on the dark theme alone.

The value is `#15364e`, which is exactly what the tint paints the sea and the large lakes. A drawn
pond sits beside a tinted lake, so the two have to be one water.

A brighter value shipped first, on the theory that a thin line needs more contrast than a filled sea
to read the same. It does, and that is the problem. The line announced itself as drawn rather than
sinking into the water around it.

The tile pane filter cannot reach this layer, which sits in a pane of its own. So this value is the
*finished* color and the tint's is the raw one, and moving either one means moving both.

Both sit well below `--k-river` at `#66b2ff`. That is the river *station* color, and a pin has to
win over the water it stands in.

### Deliberately not built

- **No streams.** The query takes `waterway=river` only. Streams triple the line count for channels
  no station reports on.
- **No coastline.** The sea is not a `natural=water` polygon, and the tint already paints it. The
  largest body in this file is 89 square kilometers, so nothing here is the Straits.
- **No control.** The layer is part of the dark basemap, the same as the tint and the lift.
- **No zoom cutoff.** Leaflet redraws the visible part of the one canvas layer, and hiding water
  when zoomed out loses the shape of the basin.

### What breaks it

Deleting `water.json` leaves the dark map without rivers or ponds and no error anywhere. The Pages
workflow copies it unconditionally, next to the PWA set, for that reason. Thin water is a worse map,
so it must not be able to fail a bake either way.

## A dead upstream page cost 25 seconds on every rebuild

A reader reported that the map timed out on load. The server runs on the same machine as the
browser, so the network between them was not the cause.

Measured on the live install: a cached poll answered in 0.13 seconds. A poll that rebuilt the cache
took 28.6 seconds. It took 45.1 seconds when the half-hourly camera capture landed in the same
request.

The first guess named the camera strips. `buildSheet()` builds a strip when a browser asks for
`?sheet=`. Measured, a strip build takes 0.054 seconds, and the payload route never calls it. That
guess was wrong.

### What it was

`infobanjirjpskl.water.gov.my/Rainfall/LatestData/All` stopped answering. A direct curl holds the
connection open and returns nothing. Its sibling `WaterLevel/LatestData/All` answers in 3.9 seconds
on the same host. The host is up and one route on it is not.

The page cache held that table under a timestamp four days old. Two rules made that timestamp
permanent:

- `$want` selects a page whose stored timestamp is older than its TTL.
- The old write ran only when the fetch returned a body.

A page that never answers never advances its timestamp. So `$want` selected it on every rebuild.
The fetch then held a slot in the shared `curl_multi` batch for the full `CURLOPT_TIMEOUT` of 25
seconds. A batch cannot finish before its slowest member, so the whole fan-out waited on it.

25 seconds of timeout plus 3.5 seconds of real work makes the 28.6 seconds on the clock.

### The fix

`pageRow()` decides what a cached row becomes after a fetch attempt. It stamps every page the server
asked for, whether or not that page answered. A failure keeps the copy already stored.

The function refuses to stamp a page the server did not ask for. A stamp on a fresh row pushes
its next fetch out forever. The page then goes stale with nothing to say so.

A dead page now costs 25 seconds once per `SCRAPE_TTL`, not once per rebuild. The page cache already
accepts that shape. One poll per quarter hour pays for the slow tables, and the rest read the stored
copy.

`php api.php --selftest` covers the four cases. The rule joins `forceAllowed()` and
`serveFromCache()` there for the same reason. All three decide how often this server contacts an
upstream.

### Deliberately not built

- **No shorter timeout.** The KL rainfall table takes about 10 seconds to render when it is alive.
  A cut deep enough to help a dead page also drops a live one.
- **No blocklist.** A dead upstream comes back. The backoff retires itself the day the page answers.
- **No retry.** A page that answers nothing after 25 seconds owes a second attempt nothing.

### What it left open

Two things, and the next section closes both.

The stored copy still fed the map. KL rainfall readings came from a four-day-old table, and the
`sources` counters did not report it. Those counters read how many rows a page parsed. A stored copy
parses as well as a fresh one, so `kl.parsed` stayed above zero through the whole outage.

A rebuild still blocked the reader who triggered it. Herd has no `fastcgi_finish_request`, so this
server cannot answer and keep working.

## The nearest webcam and the nearest water level move into the card header

Two offers sat under the station panel's header as full-width buttons. `camLink()` named the nearest
camera and its distance. `levelLink()` did the same for the nearest river on a camera card, and it
added the reading.

Each button carried a place name in bold on its own line. The card header above it already carries
a place name in bold. A reader met two titles before the first reading. On a phone the button pushed
the meter and the graph below the fold. A reader opens this card for the reading.

Both are now one glyph in the header's top-right corner, next to the favorite heart and the close
button. The camera glyph opens the lightbox. The river glyph jumps to that station.

A card carries at most one of the two. A camera card offers a water level. Every other card offers a
camera. A mast that already holds a camera offers nothing, because the picture is a section on the
same card.

### Where the corner puts it

Three controls now share one line. The close button holds 8 to 48 pixels from the panel edge. The
heart holds 50 to 78. The new button holds 90 to 118.

The gap between the heart and the new button is 12 pixels. Each button grows a 6-pixel hit area past
its own box, so a smaller gap puts one finger target over the other.

`.pophead .headbtn ~ .popname` reserves 108 pixels of padding. The station name keeps 220 pixels of
the panel's 360. A name over about 29 characters wraps to a second line. It cannot run under a
control.

The markup writes the new button before the heart. The heart keeps its slot through the
`.favbtn + .popname` rule, which still matches.

### What the trade costs

The place name, the distance and the reading move into the `title` attribute. A phone never opens a
`title`, so a touch reader sees a camera glyph and learns which camera only after the press.

This project's rule allows a `title` only as a repeat of something already on screen. This is the
first place that breaks the rule.

Two things reduce the cost. The lightbox titles itself with the camera name, so one press answers
the question. The alternative is the full-width button, and its cost fell on every reader of every
card.

The reading lost its colour. `levelLink()` painted the metre figure with `color()`, so a glance said
whether 1.74 m was a quiet river or a flood. A tooltip carries no colour. The button jumps to the
station, where the meter states it against the marks.

### Deliberately not built

- **No visible label beside the glyph.** A label is the full-width button again, in a smaller font.
- **No second offer on one card.** The corner holds one more control and no more. A third button
  takes the name below 190 pixels on a phone.
- **No popover instead of a `title`.** The table's hover panel shows what that costs. The button
  opens the answer in one press, and a panel that explains a press is slower than the press.

### The region line drops 6 pixels

The district and basin line sits under the name. It reserves 34 pixels for the close button and
nothing for the heart, so its text ended where the heart began. The two new buttons made that gap
read as a collision.

The line is one row below the buttons. It shares 4.5 pixels of its own line box with them, and
nothing else. So it moves down 6 pixels rather than reserving 108 to the right.

The measured cost of the other choice: region strings run to 53 characters, and a 220-pixel box
wraps the longest tenth of them onto a second line. Six pixels of header buys the same clearance.

The district stays on the face of the card. It is how a reader tells two stations of one name apart,
and the card names the place before it reads it.

## The KL rainfall table arrives one district at a time

The page before this one stopped a dead upstream from costing 25 seconds on every rebuild. It did
not make the rainfall readings current. The map still drew a table from 07/08/2026, and nothing on
screen or in the diagnostics said so.

### The route that works

`Rainfall/LatestData/All` hangs. Its sibling `WaterLevel/LatestData/All` answers in 3.9 seconds on
the same host, so the host is up and one handler on it is not.

The same route with a number answers in about a second. Each district returns the same 14-cell rows
the parser already reads, every row carries its coordinates, and no station code repeats across
districts.

The ids are not a range. Reading their own dropdown gives 1 to 11. That set returns 31 stations and
loses 9 that the old table held. Seven of those 9 sit on ids 23, 24, 25 and 27, in Gombak, Pandan,
Ampang and Bentong, which the dropdown never offers. Measured across ids 1 to 60: 12 to 22, 28 and
30 answer 500, 26 and 29 answer 200 with no rows, and nothing above 30 carries a row.

`KL_RAIN` in `sources.php` holds the 15 ids that carry stations. `klUrls()` emits one page key per
id, and `klStations()` merges the rows of every `kl-rain-*` page before it reads them. Each page is
a whole document, so the code merges rows and never markup.

The result: 37 gauges on the map, every one stamped today, against 39 frozen five days back.

### `sources.stale`, because the fix above removed an alarm

`pageRow()` stamps a page it asked for whether or not that page answered. So the `ts` column no
longer shows a dead upstream. That is the point of the stamp, and it costs the one signal a reader
had.

`sources.stale` lists the page keys this server asked for and did not get. A key there means the map
draws a stored copy of that table. It is empty on a healthy poll.

The parse counters cannot carry this. A stored copy parses as well as a fresh one, so `kl.parsed`
read 65 through a four-day outage.

### An error page is not data, and neither is a maintenance notice

Two guards, because upstream fails in two shapes.

`fetchAll()` returns an empty body for any status at 400 or above. Upstream answers 404 and 500 with
a full HTML page. Without this, the page cache stores one under the name of a table, `?cam=` serves
one as `image/jpeg`, and `pageRow()` writes it over the good copy it already had. `?cam=` now gets a
clean 502 where it used to serve an error page as a picture.

A status code is not enough. The national portal serves a maintenance window as a 320-byte
`Notis Gangguan` notice **under HTTP 200**. This was live while the work above was measured. That
notice replaced the stored tables for KL and Putrajaya, `national.applied` fell from 71 to 47, and
every counter stayed quiet because the fetch had in fact succeeded.

`pageHasData()` asks what kind of document arrived. A table page must hold a `<tr`, the two JSON
feeds must decode, and the nowcast page must hold its map scaffolding. A body that fails is treated
as a fetch that never answered: the stored copy stays, the row is stamped so the retry backs off,
and the key lands in `sources.stale`.

The nowcast is tested on `map.setView` rather than on a marker on purpose. A nowcast with nothing to
report is weather, not an outage, and a marker count would read the two as one thing.

Every caller already treats an empty body as a failed fetch, so both guards reuse that path rather
than adding one.

### The numbers

| | before | after |
|---|---|---|
| cached poll | 0.13 s | 0.10 s |
| rebuild | 28.6 s | 4.2 s |
| rebuild plus camera capture | 45.1 s | 23.7 s |
| KL rainfall gauges | 39, all 5 days old | 37, all stamped today |

The camera capture is ~19 s of real image pulls, once per `SHOT_EVERY`. This change does not touch
it, and it is not a fault.

### The warm task

A rebuild runs inside a reader request, because Herd has no `fastcgi_finish_request`. `docs/DEPLOY.md`
already puts a five-minute `cron` on the Debian target for that reason, and the same section now
carries the Task Scheduler equivalent for a Herd box under Windows.

Two arguments there are not obvious. Windows curl uses schannel, which asks the certificate for a
revocation endpoint. The local authority Herd signs with publishes none, so the call needs
`--ssl-no-revoke` or it exits 35. And `-LogonType S4U` runs the task in session 0, which keeps a
console window off the screen every five minutes.

### Deliberately not built

- **No probe of the whole id range on every poll.** Ids 12 to 22 answer 500 in 0.14 s, which is
  cheap. But each one then lands in `sources.stale` forever and drowns the signal.
- **No `All` fallback.** One request instead of fifteen is the trade that cost 25 seconds a rebuild.
- **No client change.** A gauge with an old stamp already renders grey through the existing rule.

### What breaks it

JPS moving a district id. `kl.parsed` falls, and `sources.stale` stays empty because the pages
still answer. Read that pair as an id that moved. An upstream that died marks itself stale instead.

### Both controls move into the card menu

The corner held the close button, the favorite heart and the webcam glyph. Three controls on one line reserved 108 pixels of a
328-pixel title. The two 28-pixel buttons also stood 4.5 pixels above the district line.

The heart and the glyph are rows in the ⓘ menu now, and the ⓘ takes the corner slot. One control
there costs the title 68 pixels instead of 108, and it clears the district line by 6.

A single-sensor card already had that menu, and the menu already held the favorite. So the card
loses a second way to one switch. It gains no new way. A mast gets `siteDots()`, which holds the
favorite that acts on all of its sensors, and the nearest webcam.

`.pophead > .dots` uses `~` to reserve the room, not `+`. `dots()` writes the button and the popover
it opens, so the menu element sits between the button and the name.

### What the row shape fixes

A menu row states the station name, the distance and the reading as text. The corner glyph had one place for them, the
`title`, and a phone never opens a `title`.

So the tooltip trade from the last revision is off the table. The reading also takes `color()` again.
A row has space for a number on the right, and 1.74 m reads as a quiet river or a flood by its
colour alone.

`.menu` gains a `max-width` of 340 pixels. A menu sizes to its content. One station name runs to 50 characters, and it drew a menu half the
width of a desktop window.

### What it costs

The favorite state left the face of the card. A reader who wants it opens the menu. The map pin also
draws a heart on a favorited site.

### Deliberately not built

- **No heart in the corner as an indicator only.** A mark that looks like a button and does nothing
  is worse than no mark.
- **No favorite state on the ⓘ glyph.** The glyph means "there is more here". A colour for one of the
  rows inside makes it mean two things.

### The ⓘ takes the close button's box

`.dots` is 28 pixels with an 18-pixel glyph, and it was written for a sensor row where nothing sits
beside it. `.icon` is 40 pixels with a 22-pixel glyph, and `#sideClose` is one.

Side by side in the corner, `.icon` paints a round hover disc the width of its box. So the two
buttons drew two discs of two sizes, under two glyphs of two sizes.

`.pophead > .dots` restates all three numbers. `top: 8px` is `#sideClose`'s own number, and it is
also the arithmetic: 18 + half a 15px/1.3 line − half 40 is 7.75. `right: 32px` puts this button's
right edge on the ×'s left edge, which is how two toolbar icons meet. Each `.icon` already carries
about 9 pixels of padding, and that is the gap between the glyphs.

The title and the district each reserve 78 pixels now, which is 32 + the button's 40 + 6 of air.
Both lines stop at the same place.

That retires the 6-pixel drop above. The region needed it while a 28-pixel button reserved no room
beside it. A 40-pixel button reserves the room, so the district clears it horizontally and the name
and the region sit flush again.

### The glyph becomes a kebab

The button opens a menu of four actions: the favorite, the nearest webcam or water level, the map
link and the ignore. It also states where the reading came from. An information glyph names the
last of those and none of the first four.

`--i-more_vert` is a fresh fetch of Material Symbols at `fill1`, added to `css/icons.css` the way
every other glyph there arrives. `icons.css?v=` goes to 80.

The glyph has changed twice on one rule. It was a ⋮ over a single "ignore" item, which promised
actions and held one. It became an ⓘ when the provenance moved in from a footer line. It is a ⋮ again now that
the menu holds four things to do. The first ⋮ was wrong because it held one action, not because it
was a ⋮.

`.i-info` stays in the About dialog and the Help item, which are information and nothing else.

### The nearest offer is always a row, and says so when there is none

`CAM_MAX_KM` caps the nearest webcam and the nearest water level. Past that cap the code drew no
row. So the menu held five items on one station and four on the next. A reader who had seen the
offer once then had no way to tell "there is none here" from "the app forgot". The row is always
there now. With nothing inside the cap it draws `disabled`.

Both rows also swapped their two lines. The station name led, with `Nearest webcam · 2.3 km away`
underneath, which named a place before it said why that place was on the menu. It also left the row
with no fixed first line, so the empty case had nothing to be the short version of. A row now leads
with `Nearest webcam` or `Nearest water level`. Under it comes the place and the distance, or
`No webcam nearby` and `No water level nearby`.

`disabled` covers the pointer and the keyboard on its own, so the CSS only stops the row looking
pressable — muted ink, the default cursor, and no hover wash. The row states no distance. The cap is
ours, and a reader wants the verdict rather than our arithmetic.

A Monitoring Station that carries its own camera still passes no row at all. The card lists that
camera as a section below, and an offer to go somewhere else for a picture that is already on screen
is not an answer to anything.

## Help and About split into two dialogs

The menu opens Help and About as separate entries and always did. Behind them stood one dialog with
a tab strip, so a reader who picked Help arrived on a page with a control offering the page they
had just declined. The strip was one click between the reader and a destination they had already
named.

`#helpBox` is now its own `<dialog>`. Both dialogs carry `.docbox`, which holds the box, the
prose, the `.key` grid and the pin legend — the rules both of them need. What belongs to one stays
on its id: the logo lockup, the amber notice, the source links and the whole Developer section are
`#aboutBox` alone.

The reason the tabs existed is gone. The app bar had no room for a second open button when this
project had seven buttons in the right group. The menu holds both entries now, so a second dialog
costs no bar space.

Help takes a title in `.modalhead`, the same shape the station table and the camera wall use. About
keeps a close button on its own, because its logo lockup is its heading.

### What this cost

The dialogs no longer cross-reference each other by a click. A reader in Help who wants About must
close one and open the other from the menu. That is two clicks where there was one, on a path
nobody measured.

This change deletes `showPane()`, the `PANES` map, the tab-strip click handler and the reset on
close. `paintDev()` now runs when About opens rather than when the About tab returns.

### Not built

- No shared scroll memory. Each dialog opens at the top, which is what the tab strip did too.
- No link from one dialog to the other. The menu is two clicks away from either.

## Help rewritten as a manual

Help held ten sections and described the app as it stood several changes ago. Six of its headings
asked a question: `Why it does that`, `What it cannot tell you`, `How to read the map`, `Words on
this map`, `What puts a station on alert`, `The buttons along the top`. A question heading sorts
nothing. A reader hunting for the seek bar cannot tell which question holds it.

Every heading now names a surface: App bar, Menu, Filters, Go to a station, Station panel, Camera
viewer, All cameras, Map symbols, Alert criteria, Glossary, Expected behavior, Limits. The order
follows the order a reader meets the app. The reference sections come last.

### Gaps this closed

Seven surfaces shipped with no entry in Help.

- The status dot on the app mark, and the four states it reports.
- The moving strip, and the two kinds of tile in it.
- The favorites panel, the star row in Details, and the `Favorites only` filter.
- The place search, and the 10 km list it answers with.
- The weather block on a station card.
- Every row of the Details menu except the ignore.
- The camera wall filter and its count line.

### What was wrong

`Details` named a button. It has been a ⋮ menu of four or five rows since the provenance moved into
it. Help now names the control `Details`, the same word the tooltip and the two drawer
panels use, and lists each row under it.

`A rain forecast` sat under `What it cannot tell you`. It claimed that a sensor measured every
number on the map. MET weather landed after that line. The map now carries a nowcast, a
three-hour outlook and a temperature range, and all three are forecasts. The row is `A water
forecast` now, and it draws the line where the code draws it: a sensor measured every water figure,
and the weather block states no river level.

### Trade-offs accepted

- Help is longer. Twelve sections against ten, and about 400 more words. A manual that omits a control to stay short fails at
  the one job it has.
- The About pane keeps its own voice. It tells the story of the project, and this change did not
  ask for a rewrite of it.

### Not built

- No search inside Help. Twelve headings fit on one scroll of a wide dialog.
- No screenshots. Every row leads with the live glyph or the live pin. Neither can go stale the
  way a picture of an old app bar can.

## Weather joins the station card, and MET warnings join the alert surfaces

### The card section

Every station card now carries a weather section above the sensor list. It holds two cells, `Now`
and `Later`. `Now` gives the current sky and the high and low for the day. `Later` gives the outlook
for the next three hours. Each cell is a filled box with its title on the bottom
edge, centred under the glyph, so the two read as two answers rather than as one row of parts. `--g`
in `css/map.css` is the glyph box, and the glyph and the title both read it, so one number keeps them
lined up. The section appears on every card, not on
rivers alone, because the same sky sits over a rain gauge, a siren and a camera alike.

The section carries a ⋮ of its own, and it holds provenance alone. Every other ⋮ on a card carries
actions under the same block — the favorite, the map link, the ignore — and not one of them applies
here. A favorite is a place. A map link is a coordinate. `PREFS.ignored` silences a sensor. The
weather is none of those, and an action that acts on nothing is worse than an absent one.

It states the two facts `sourceInfo()` states for a sensor. When the reading was made, and who made
it. `met.stamp` is MET's own issue time, so the clock is the one MET published. It goes through
`stamp()`, the same rule a station's reading takes: the clock alone while the issue is from today,
the date alone once it is not. That replaced a `· 25m ago` beside it. The elapsed figure was there
because `12:40` alone cannot say whether MET has been quiet since yesterday — which is the question
a stamp that switches to a date answers directly, and in fewer characters. The nearest point and its
distance answer "who made this" on the second line. They stay
out of the header, where the owner asked for them to go. A claim from 14 km away is a different
claim from one made next door, and the ⋮ is where this app already puts that kind of doubt.

`Later` always carries a sentence. `metSpan()` returns null when no step in the three-hour window is
wet, so there is no span to word, and the cell held a glyph and nothing else. A glyph on its own
does not answer "what happens next". The dry case now reads `No rain in the next 3 hours`.

The sky itself is a glyph, and no line writes the state out under it. The word rides on `data-tip`,
which `js/sparktip.js` opens on hover and on a tap. The graphs' readout already had to solve the
touch half, so a label costs one branch in a module that is on the page anyway. A `title` is the
obvious way to do this and is the wrong way. It never opens on touch, so the word goes missing on
half the devices this runs on. See the `title` gotcha in `CLAUDE.md`. The glyph also carries an
`aria-label` with the same word, for a reader who hears the card.

The section was three cells of equal width: a temperature pair, the current sky, and the outlook.
The outlook cell carries a sentence. The other two carry a word each. So one cell filled its column
and the other two stood nearly empty. Two columns give the sentence the room it needs. The split is 1:3. `Later` holds a sentence and `Now`
holds two short numbers, so an even split left one cell full and the other half empty. Both cells
keep one 12px gap between the glyph and the words, and 12px of side padding centres the pair inside
`Now`. Pushing the numbers to the far edge instead put a 30px gap in one cell beside a small one in
the other. That is one distance, stated twice, on one row.

No cell carries `min-width: 0`, and that is what holds the 1:3 up. A `1fr` track is
`minmax(auto, 1fr)`, so a cell never goes under its own content unless something zeroes that floor.
`Now` needs about 81px, and a quarter of a 360px panel is about 79px. The two are within a hair on
that screen. On a phone the panel is 84vw, the quarter share falls to about 65px, and the glyph would
stand outside its own cell. `Later` gives up those pixels instead, and its sentence wraps, which is
what a sentence does. The floor stays off every item inside a cell, where a forecast line does have
to shrink.

Two smaller changes came with it. The glyph is 28px, because the sky is the state and the words
beside it are the detail. The old rule set 26px on `.wxbig` and 14px on `.wxcol .i`. Two classes
beat one, so the large glyph drew at 14px for as long as the section existed. The temperatures also
stack, high over low, in place of an up arrow and a down arrow. The order says which is which. Their
`data-tip` says it in words, `Max 34° · Min 25°`, for anyone the order does not answer.

232 rain gauges already measure the rain that fell. None of them says what arrives next. A reading
states the past. A forecast is the one part of this section a sensor cannot give, and lead time is
the reason to build it.

### Nearest point, not an average

MET publishes a category — clear, rain, or heavy rain — not a number. A category cannot take an
average. Kriging three categories invents a reading nobody published, so `metNearest()` in
`api.php` picks the single nearest point instead. That is Thiessen assignment: the same answer a
Voronoi tessellation gives, without building the polygons.

### A flat radius, not a cell-scaled one

`MET_KM` caps the join at a flat 15 km. A cutoff scaled to the coverage cell around each point came
first, and it failed in both directions: it accepted a station 22.8 km from its point in a sparse
district, and it silenced stations 3 km from a dense cluster of points in central Kuala Lumpur.
Point density records where MET chose to build, not how far its weather reaches. 15 km comes from
the decorrelation distance for a 3-hour rainfall field, and sits well inside it. See the gotcha in
`CLAUDE.md` for the full measurement.

### The span runs first to last

`metSpan()` in `sources.php` finds the worst rung MET publishes across the three-hour window and
reports the first step it appears in and the last. 12% of wet markers hold the worst rung in more
than one block on a live page. A span built from the first unbroken run alone ends the rain too
early.

### The Later cell follows the span

The third cell on the card once read the one-hour step (`hr1`) alone, while the span still drove the
sentence under it. That put `Later: Clear` above the words `Rain 12:00, past 13:00` on the same
card, one cell arguing with its own sentence. The cell now reads the same rung the span reports, so
the cell and the sentence describe one window and agree.

### The attribution, dropped and then restored

The header printed the MET point and the distance to it, `Subang Jaya · 3.4 km`. It was dropped at
the request of the person reading it, after they saw it on screen, and it is back.

The cost of dropping it was stated at the time and is what brought it back. Without the line the
card states a local forecast from a point up to 15 km away, with nothing on screen to weigh that
claim against. The point for ULU YAM sits 11.7 km off, over high ground. A reader had no way to
tell that card from one whose point stands in the next street.

It reads `Via MET Malaysia · <place>, <n> km away` now, under the cells rather than beside the
heading, which is what the first version got wrong. The place name competed with the station name
at the top of the card. As a footnote under the forecast it answers the question the forecast
raises instead of interrupting the one the card is already answering.

Two things this records. `at` and `km` were kept in the payload when the line came out, which is
the only reason bringing it back cost one span. And a decision reversed after seeing it on a real
screen is not a decision made badly — both calls were made looking at the thing, which is the only
way this particular question can be answered.

### A moon after dark, MYT

A clear sky after 19:00 draws a moon rather than a sun. The hour that decides it is Malaysian, never
the hour where the reader sits, because every other time on this page already reads that way. A moon
next to a reading stamped 14:00 contradicts it.

### A forecast, not a thermometer

The two temperatures on the card are the forecast high and low for the day, not a live reading. MET
publishes no free observed temperature for these districts, so the card cannot show one. The word
"today" belongs beside the numbers for that reason.

### Warnings from MET

A warning feed now sits above the station list in `#side`, and its tiles lead the header ticker.
Both surfaces open the same modal with the full text. The panel row clips to one line. The ticker
tile carries the whole sentence, because the strip has no line under it to crowd.

The feed carries nine fields and not one of them is a coordinate. The only way to place a warning
is to read its own text, so `metWarnings()` in `sources.php` does. Every row survives by naming a
place this map covers, including `west coast` and `pantai barat`, since MET sometimes names a
warning by coast rather than by state. A marine row gets a second way in: the Straits of Melaka,
the stretch of sea this coast sits on.

Two rules took a second pass, and the review that found them was right to.

The straits run about 800 km, so naming them is not the same as naming our stretch of them. MET
publishes "the waters of Northern Straits of Melaka and Samui" for water off Kedah, Penang and
Thailand. Port Klang is about 300 km away. That row holds the three words `straits of melaka`, and
it passed on those words alone. A warning about Thai water reached the ticker.

`WARN_SEA_FAR` is cut out of the text before the keep test reads it. Cutting beats testing here,
because a row can name two stretches at once. Strip the northern mention from "Northern Straits of
Melaka and Central Straits of Melaka" and the central one still answers. A row that names only the
far stretch has nothing left to match on.

The sea test also read the wrong field. MET files a storm over water as "Warning on Thunderstorms",
which is what it calls a storm over a town, so the heading alone cannot separate them. A marine row
was read as a land row and judged by the land list. `WARN_WATER` reads the text instead, for
"waters of" or "perairan", which MET writes on every marine row. This matters in both directions:
it also lets in "the waters of Selangor", which names our coast without naming the straits.

Measured on a seven-row live feed: one row survived before these two rules and none after. The one
that survived was the Thai-water row.

A warning for the whole peninsula still drops. That gap stays open on purpose: widening the match
to `semenanjung` or `peninsular` also opens the door to warnings about every other state on the
peninsula.

### Where a warning sits, and how long it interrupts

Warnings led the panel first, and that put a forecast about a region above a river already over its
danger mark. Only one of those is happening. The panel already makes that argument in its tier sort,
where a forecast two streets away ranks under an observed danger. So the warning section takes a
place in that order rather than standing outside it: after the `HAPPENING NOW` groups, before
`soon` and `stale`. With nothing happening now it leads, which is where a warning belongs when no
observation outranks it.

The two surfaces then part company on time. The panel lists a warning for its whole validity. The
ticker carries it for the first six hours of that validity and then drops it.

One live sample was valid for nearly three days. A strip repeating the same sentence for three days
is the standing banner nobody reads by the second, which the alert design standard names directly.
The split follows what each surface is for. The panel is a directory a reader opens. The ticker is
an interruption nobody asked for, and an interruption has to end. The directory does not.

`fresh` is scored in `sources.php`, not in the browser. MET stamps Malaysian wall clock with no
offset, so a reader in another zone would age the warning by their own clock. It is measured from
the start of the warning's own validity rather than from when this app first read it, or a warning
issued overnight would restart its clock when somebody opens the page at eight.

The ticker filters on `fresh` **after** numbering its tiles. `data-warn` is an index into
`state.warnings`, which the panel and the modal share, so renumbering after the filter would open
the wrong warning.

A warning moves no count: not the alert number, the icon badge, the app-bar glyph colour, or the
toast. That separation is what let this surface pass the alert design standard. A warning is a
claim MET makes about an area. A station reading is a claim this app makes about a sensor. Merging
the two asserts something the app cannot observe.

`data.gov.my` publishes three weather endpoints: `forecast`, `warning` and `warning/earthquake`,
and no nowcast endpoint at all. This app never calls `warning/earthquake`. `WARN_DROP` also drops
any seismic row that turns up inside `warning` itself. A seismic row says nothing about a flood.

### Not built

- No map layer and no heat layer for weather. The map already carries two heat layers that are one
  choice between them, and a third layer over the same sky adds noise, not information.
- Nothing on a station card alerts from weather. No sensor count, badge or ticker entry reads the
  weather section. That question has not gone through the alert design standard yet.

## Monitoring Station and Monitoring Node replace "mast"

A place that carries several sensors was a `mast`. The word names a pole. The hardware is usually a
small gated shed, so the word described something that is not there. Two names replace it.

- **Monitoring Station** — a place that carries more than one sensor. Sensors within 50 m of each
  other are one station, and the map draws one pin for it.
- **Monitoring Node** — a place that carries one sensor. A card names the kind instead: Water
  level, Rainfall, Siren, Flood gauge or Camera.

The kind names are `KINDS[...].label` and `.one` in `js/config.js`, which every badge already
reads. Help spelled one of them `flood-depth gauge` on six lines while the badge beside it read
`Flood gauge`. Help now uses the spelling on that badge.

A node's card draws like a station's card. The reading sat loose under the header with no heading of
its own. It is a `.sensor` section now, headed by the glyph and the kind, which is the same section
a station gives each of its sensors. So the reading always arrives under a heading that names what
it measures. The section head carries no ⋮, because the header already holds the card's one menu. A
station needs one menu per sensor, and a node has one sensor.

The header keeps its kind badge, so the kind is on the card twice. The two answer two questions. The
badge answers "what is this place" at a glance, which is the job a station's row of badges does. The
heading answers "what am I looking at" over the reading itself.

`.wxsec` went with it. The weather section drew a rule under itself because the body below it had no
head. Now that body is a `.sensor`, which draws its own rule above itself, and the two together made
a double line. That is the same double line `#sideBody > .sensor:first-child` removes at the top of
the card.

Two rendered strings held the old word, and both changed: the Help glossary with the rows around
it, and the empty state of the favorites panel in `js/render.js`.

The code keeps the old spelling. `MAST`, `--k-mast`, `showMast()`, `.mastring` and `data-mast` are
identifiers in ten files, and renaming them moves no pixel on screen. `CLAUDE.md` carries the rule
that ties the two spellings together.

### Trade-offs accepted

- One concept, two spellings: `Monitoring Station` on screen and `mast` in the source. A reader of
  the code needs the rule in `CLAUDE.md` to connect them.
- The term is longer than the word it replaces. `Monitoring Station` costs a glossary row and a
  wider label wherever a card ever states it.

### Not built

- No label on the card head. A Monitoring Station card already carries one badge per sensor, which
  states what stands there. A second line naming the place type repeats what the badges show.
- No rename of `--k-mast`. The token paints the indigo of a Monitoring Station pin, and the colour
  block in `css/base.css` is the one place that value lives.

## The count row left Help

`The count under the filters` had a row of its own under Filters. The line it describes states
`417 stations · 2 ignored` in plain words, under the controls it counts, and it never collapses out
of view. A manual row for a sentence that reads itself is a row that can go stale on its own.

The line stays on screen. Only the row about it is gone. This change touches no part of the rule that a silenced alarm keeps
two always-visible indications. The `Ignored sensors` panel in the drawer and that count line are
both still there, and Help still describes the panel.

## About takes the same voice as Help

Help became a manual. About kept a second voice for one more change, and that was the fault. One
pane held two registers. It joked in the first half and stated facts in the second. A reader cannot
tell which half is careful. The jokes went. Every fact stayed.

The `Origin` section holds the story. One question, and three government websites. An AI that wrote
most of the code. Selangor first and Kuala Lumpur second. A shuffled batch of camera coordinates
that took a visit, or a read of the picture, to settle. Each of those facts is still on the page,
in plain sentences.

### Headings

Four headings became seven, and each one names a thing rather than asking about it.

| before | after |
|---|---|
| `How this was built` | `Origin` |
| (no heading) | `Warranty` |
| (no heading) | `Privacy` |
| (no heading) | `Repository` |
| `Where this data comes from` | `Data sources` |
| `Credits` | `Credits` |
| `Developer` | `Developer` |

The warranty, the privacy statement and the two repository links sat under no heading at all. A
reader scanning for the privacy statement had to read the pane to find it.

### One stale sentence

`Each station popup names the feed its reading came from` outlived the popup by several changes.
There is no map popup in this app. The sentence names `Details` now, the same control Help names.

### Trade-offs accepted

- The pane reads flatter. `This site is vibe coded` and `The rest I geoguessed` were the two lines
  people remembered, and neither survives a manual register.
- Seven headings on a pane that had four. The three new ones cover text that was already there.

## An outage the source announced

On 2026-08-12 the national portal stopped serving its water-level tables. It answered every request
with HTTP 200 and a 320-byte notice page instead. A status code alone does not catch this failure.

`national.applied` fell from 71 stations to 47. The map still drew every station, each with its own
last reading.

Nothing on screen said the source was down. A Service Notice card and a ticker tile now say this
instead.

### What the notice says

The page carries no text of its own. It carries one picture, a screenshot of Malay text, at
`/maintenance-files/MaintenancePublicinfobanjir/notifikasi.png`. Translated, it reads:

> **NOTIS GANGGUAN PERKHIDMATAN SISTEM PUBLIC INFOBANJIR**
>
> We will be back shortly. We greatly appreciate your patience. The PublicinfoBanjir website is
> currently receiving very high traffic, and this may affect your access. Our team is working to
> restore access and to return the service to normal as soon as possible. In the meantime you can
> get important information through the **MyPublicInfoBanjir** app, available on the **App Store**
> and **Google Play Store**. We regret any inconvenience.

Three facts in that message shaped the design.

**The cause is high traffic, not a maintenance window.** A flood portal takes its heaviest traffic
during a flood. This source fails hardest at the moment it matters most. That is why the notice
outranks a weather warning below.

**It carries no end time.** JPS gave none. This app must not invent one. It shows no countdown and
no guess at a return time.

**It names four channels to check instead.** These are the MyPublicInfoBanjir app, PublicInfoBanjir
on Facebook, JPS_InfoBanjir on X, and the portal itself.

A reader who doubts a flood map looks for a second opinion. The alert design standard calls this
milling. The modal carries the links milling needs.

### Why a notice counts toward nothing

A notice adds nothing to the badge, the tab title, the tally glyphs, or the warning glyph. Those
surfaces still read the station list alone. `warnCard()` set this rule for a MET warning first.

A warning names a region. A station reading names a place. The two must never share one total.

A notice follows the same rule for a stronger reason. It is not a reading at all. It is a statement
about a source, not about the water.

### Why an outage outranks a weather warning

A MET warning sits under the `HAPPENING NOW` groups. A notice sits above all of them, including that
group.

The two make different claims. A warning adds one possible event to the list. A notice can mark the
whole list wrong.

A quiet panel can still be false. A silent source, not a calm river, is the reason.

EEMUA states this exact point. A reader must be able to tell no alarms from a dead alarm system. A
notice states that the system, not the weather, is the problem right now.

### The banner has to be remembered, not re-derived

A whole-branch review caught this. No per-task review had the range to see it.

The first build read the notice out of the bodies fetched on that poll. Those bodies exist only for
the pages the poll actually asked for. `pageRow()` stamps a page that failed, so a dead source backs
off for `SCRAPE_TTL`, which is 900 seconds. The payload rebuilds every `TTL`, which is 300 seconds.

So two rebuilds in three asked for nothing, found nothing, and published an empty list. The banner
appeared for one poll, vanished for two, and returned. The source never moved. The ticker fell back
to `No alerts` while the portal was still down.

That is the cry-wolf failure this feature exists to prevent, built into the feature itself.

`noticeRow()` decides what to do with the memory after a fetch attempt. It returns `set` to remember
an id, `clear` to forget one, and `keep` when the poll asked for nothing. Only a fetch carries news.
A poll that did not ask must leave the memory alone.

The memory lives in the `page` table under a `notice:` key prefix, so it survives a restart. A key
this build no longer asks for contributes nothing, which leaves a stale row inert.

Four self-check assertions cover the four inputs. The live proof is a poll where `sources.stale` is
empty and `national.applied` reads 71, and the banner is still up: that poll fetched nothing and
still knew.

### The words took three drafts

The first draft opened two sentences with `JPS says`. That reports speech. It puts this app between
the reader and the agency, and it reads as a story about an outage rather than a notice of one.

The second draft cut them to `Reported cause: heavy traffic. Expected end: not stated.` That is how
a machine records an incident. A notice writes it out.

The third stands: `Heavy traffic has overloaded the portal. JPS has not announced a restoration
time.` Both sentences name their actor. Neither reports what anybody said.

One link, and it names the source. An earlier draft listed the app, Facebook and X under the words
`Where JPS says to look instead`. That heading narrates rather than states, and five links turned a
short notice into a directory. The trade is real: the alert standard calls the search for a second
opinion milling, and those channels served it. A reader reaches them from the portal in one more
step.

The strip and the panel row carry `title` and `line`. The two halves read as one sentence and
neither repeats the other. An early tile printed the agency name twice, because both halves opened
with it.

### Against the alert design standard

| rule | how it lands |
|---|---|
| ISA-18.2 — an alarm requires a response | The response is to check another channel. The modal carries them. |
| ISA-18.2 — 10 in 10 minutes is a flood | It counts toward no total, so it cannot contribute to one. |
| ISA-18.2 — priority must not be flat | It sits above the weather warnings, which sit above the stations. |
| CAP — certainty | Observed. JPS states it. This app never infers it from a timeout. |
| CAP — severity is not urgency | It claims neither. It reports a condition and names its scope. |
| CAP — headline at most 160 characters | 62. |
| CAP — alerts can be withdrawn | It leaves the payload the poll the tables parse again. |
| Cry-wolf | It fires only on positive identification. A blip shows nothing. |
| PADM — who says so | It names JPS, and links to JPS. |

### Deliberately not built

- **No duration.** "Down for 20 minutes" needs a first-seen time. `pageRow()` moves the timestamp on
  every attempt. Tracking one sentence needs a schema change.
- **No embed of the notice image, and no proxy for it.** The picture is 1280 by 720 pixels of Malay
  text. No screen reader reads it. A phone draws it too small to read. A link serves the reader who
  wants it.
- **No rule for a silent hang.** A timeout is not a statement from the source. It stays in the
  status popover.
- **No toast.** A toast interrupts for news that needs action now. This notice does not need one.
- **No all-clear.** A MET warning set that precedent. A source coming back online is not an event
  worth an interruption.
- **No second recognizer.** Only the national portal publishes a notice today. The KL host or MET
  can start the same. Each one needs its own evidence before it gets a rule.
- **No App Store link.** Apple publishes no working web search URL for its store. A guessed app id
  points a worried reader at the wrong software. This app links Google Play search instead, because
  its search URL works by construction. iOS readers get the app name with no link.

### What breaks it

JPS can change the notice title at any time. If it does, `noticeOf()` returns null for a real
notice. The banner never appears. `sources.stale` still reports the feed as stale. The failure still
shows, just not on the banner.

The failure is silence, not a wrong claim. That is the correct direction for this feature to fail
in.

## The card menu always opens downward

The ⋮ menu on a station card is a popover. CSS anchor positioning is Chromium-only, so `js/ui.js`
places the box by hand on the `toggle` event.

The old rule put the menu below the button, and flipped it above the button when the space below ran
short. That flip is correct on a desktop map, where a pin near the foot of the window has room above
it. It is wrong on a phone. A phone screen is short, so the space below runs out almost everywhere.
The ⋮ on a station card sits near the top of `#side`, a few pixels under the app bar. The flip
therefore drew the menu above the top edge of the screen. The reader saw nothing to tap.

The menu now always opens below the button. It slides up only as far as the viewport needs, with the
same clamp the left axis already used. A menu that has to slide can cover its own button. That is
the lesser fault. A covered button is still a menu you can read, and the reader closes it the same
way as before.

`.menu` in `css/chrome.css` takes `max-height: calc(100dvh - 16px)` and `overflow-y: auto` to hold
up the new rule. The slide cannot fit a box taller than the screen, so such a box must scroll. The
unit is `dvh` and not `vh`, because a phone browser counts its own address bar in `vh`. With `vh`
the last row of a full-height menu sits under that bar.

### Deliberately not built

- **No flip on any screen.** A rule that applies on one screen size and not another is a rule with
  two failure modes to test. One rule is enough here.
- **No anchor positioning.** `position-area` states this in one declaration and drops the handler.
  Firefox and Safari do not support it yet. The hand placement stays until they do.

## The clip plays at 1x, 1.5x or 2x

A camera clip runs one frame per second. That pace is correct, and the comment on `FRAME_MS` in
`js/timeline.js` says why: consecutive frames stand 30 minutes to a week apart, so every frame is a
separate scene a reader has to read. An earlier pass ran at 320 ms and pushed the archive past before
any of it registered.

The pace is wrong on a long range. A year window holds 52 frames, so the clip runs for 52 seconds.

One button now cycles 1x, 1.5x and 2x. It sits between the transport group and compare, and the
glyph states the current rate. The interval becomes `FRAME_MS / RATES[rate]`, which gives 1000 ms,
667 ms and 500 ms. `FRAME_MS` does not move. The default pace stays right for the 24-hour range, and
this button is the way out of it.

**Three stops, not a slider.** A frame here already stands for 30 minutes to a week, so the useful
span of "faster" is short. A slider offers a precision nothing on this bar rewards.

**No slow side.** Material Symbols publishes `speed_0_5x` and `speed_0_75x`. The pause button is how
a reader spends longer on one frame, and it is on the bar already.

**A press always starts the clip.** The handler advances the index, repaints the button, then calls
`stop()` and `toggle()`. That one pair covers both states this button answers. A running
clip picks the new pace up on the frame it is on. A paused clip starts. Starting is the point: a
reader presses this to get through the range, and a still plus a second press to find is not that.
`stop()` also clears `lead`, so a press inside the opening two seconds cancels the delayed start
rather than racing it.

**The rate does not survive the dialog.** `reset()` sets it back to 1x, and `reset()` runs at the top
of every `openTimeline()`. Nothing reaches `PREFS`. A rate is a decision about the clip in front of
the reader. A camera opened an hour later did not ask to run at that pace.

**The accent is what makes the rate readable.** `#tl .icon` sets `font-size: 20px`, and these glyphs
draw numerals 320 units tall in a 960 grid — so `1.5x` stands about 6.7px high. The button takes the
`on` class above 1x, which is the class compare already uses and the overlay bar already restyles in
white. It states "this clip runs fast" with nothing to decipher.

### Material Symbols publishes no `speed_1x`

The set steps from `speed_0_75x` to `speed_1_2x`. `speed_1_5x` and `speed_2x` both answer. The
refetch URL returns 404 on `speed_1x`.

`1x_mobiledata` is that missing drawing under another name: the numerals `1x` at the same 320-unit
cap height as the two glyphs beside it. The token keeps the upstream name, so the refetch URL at the
top of `css/icons.css` still works on it, and the `title` on the button carries the purpose instead.
`--i-last_page` drives the "Go to now" button the same way.

## Compare disables play and speed

Pressing compare already paused the clip. It now holds it paused: `setCompare()` sets `disabled` on
the play button and the speed button whenever the divider is up.

This finishes a rule rather than changing one. A reader who raises the divider has chosen one frame
to hold against the live one, and a clip carries that frame away a second later. Pausing them and
then handing them play was the app undoing its own reasoning one button along. A range press already
refuses to start a clip while comparing, for the same reason.

**Both steps, "go to now" and the seek bar stay enabled.** Each one moves the position and none
starts a clip — `go()` calls `stop()` first. So a reader can still walk the archive against the live
picture, a frame at a time. That is the whole gesture the divider exists for.

**Nothing else needed a guard.** `stage.onclick` already tests `ab.hidden`, so the picture is not a
play button while the divider is up. The range handler tests it too. Space and `k` reach play through
`play.click()`, and a browser fires no click on a disabled button, so the keys go quiet on their own.
No path into `toggle()` survives, so `toggle()` itself needs no test.

**`lastPos()` keeps its compare branch and loses a reason.** Nothing plays while the divider is up
any more, so that branch now serves `go()` alone. It is what holds the step buttons and "go to now"
off the live frame.

**The disabled glyph keeps stating what it holds.** A speed button disabled at 2x still reads 2x,
faded. A disabled control means the reader cannot change the rate from here. It does not mean the
rate stopped applying.

`#tl .icon:disabled` takes `pointer-events: none` rather than a `:not(:disabled)` on every hover
selector. The plain control bar and the `PLAYER_OVERLAY` block each paint their own hover, and one
declaration answers both.

### Deliberately not built

- **No keyboard binding for speed.** Every key in `KEYS` maps to a button that lights up under
  `.click()`. This button does not light up, because it sits outside `.tltransport` and the flash
  listener is on that group. Its glyph changes on every press, which states the result better.
- **No `aria-pressed` on the speed button.** That attribute states two states. This control has
  three.
- **No focus rescue when play goes dark.** Focus falls to the dialog. The keyboard bindings sit on
  the dialog, so the arrows and `End` still answer.
- **No speed control on the station panel clip.** `js/clip.js` carries no controls by design. The
  lightbox is where a reader sits with a camera.

## No picture, on a station card as well as on a wall tile

Three of the 93 cameras JPS publishes carry no feed URL. The station panel drew a muted line for
those, `No camera feed`, where every other camera card holds a picture. A card was a line of text
with nothing to look at.

The camera wall already had the shape for this. A tile whose picture fails to load shows `.camfail`:
the `videocam_off` glyph and the words `No picture`, full bleed on the tile's own idle fill. The card
now draws the same box, in the still's own place.

**The look moved to `css/base.css`, and only the placement stayed in `css/chrome.css`.** The wall
puts the box over a tile with `position: absolute` and `inset: 0`. The card puts it in flow. So the
shared half is the flex column, the fill and the type. The tile keeps the two lines that place it.
One fact must not get two looks.

**That placement rule names `.camtile` in its selector, and that scope is load-bearing.** It carries
`display: none`, because a tile holds the box in its markup at all times and reveals it by class.
Unscoped, the same declaration reaches the card and hides the box there for good.

`.shotnone` is the card's half. It takes the margin `.shotwrap` uses, the same 8px radius, and
`aspect-ratio: 16 / 9`. The ratio holds the card at one height, with a feed or without one.

### Deliberately not built

- ~~**A card whose picture fails to load still prints `image unavailable`.**~~ Built. See *Every
  picture in the app now fails into a box* below.

## The app menu grew to the height of an iPhone

Safari on iOS drew `#appMenu` as a full-page panel. The four tiles sat in the top half, the theme row
sat on the bottom edge, and wide empty bands separated them. Chrome and Firefox drew the same markup
as a 260 by 157 box.

The menu is a `popover`, so the browser's own stylesheet applies to it first. That rule sets
`position`, `inset`, `width`, `height`, `margin`, `padding`, `overflow`, `border` and two colors.
`.menu` in `css/chrome.css` restates all of them but one. **`height: fit-content` was the one left.**

WebKit reads `fit-content` on the block axis of an out-of-flow box as the space that is available
under `top`, not as the height of the content. The placement handler in `js/ui.js` sets `top: 8px`,
so the box measured one viewport tall. `#appMenu` is a grid, and a grid with a definite height and
the default `align-content` stretches its rows to fill. Four rows, one screen: that is the picture.

The fix is `height: auto` on `.menu`. An out-of-flow box with `bottom: auto` and `height: auto` is
the height of its content in every engine, so this changes no pixel on the engines that were already
right. The sensor ⋮ menu shares the class and takes the same correction — it draws as a block, so
the fault showed there as dead space under the last row rather than as a stretched grid, which is
why nobody reported it.

**Do not fix a stretch like this with `align-content: start`.** That closes the gaps and leaves the
box its full height, so an invisible panel keeps swallowing every tap over the map behind it. Aim at
the height.

### Deliberately not built

- **No sweep of the other popovers.** `.sparktip` and the table's `.tipbox` set their own height paths
  and neither reads `fit-content` from the UA sheet. A future popover that restates part of that rule
  needs the whole of it, and this entry is the record of which declaration is easy to miss.

## The lightbox holds its frame when the picture does not arrive

Open a camera whose feed is dead and the dialog folded up around its own title. The control bar, the
warning pill and the frame all went with it.

**Why.** A failed `<img>` has no intrinsic size, so it lays out at 0×0. `.stage` and `.player` are
both `inline-block`, which is shrink-to-fit, so each measured the nothing inside it. The control bar
is absolutely positioned against `.player` on a mouse, so it had no box to sit in either. Only
`.lbbody`'s `min-height: 140px` survived, and that holds the dialog body rather than the player.

**The fix states the box in that state and in no other.** `#lightbox.nopic .stage` takes the width
and the ratio a frame would have taken. Everywhere else `.stage` stays exactly the picture's box,
because `.ab` is `inset: 0` of it and that is what lines the two A/B halves up pixel for pixel — a
floor on `.stage` would misalign every frame smaller than it.

**The empty box is the camera wall's `No picture` panel**, the third surface to wear it. A held box
with nothing in it reads as a fault in the dialog. This one names the fault.

**`naturalWidth` decides it, not which event fired.** `js/ui.js` runs one handler for `load` and
`error` and tests the width both ways, so the panel lifts again the moment a later frame loads —
`js/timeline.js` drives the same `<img>` for every archived frame. Opening a camera clears the class
first, so a dead feed cannot be inherited by the next camera. A cached picture fires no event at all,
so the opener calls the handler directly when `complete` is already true. That covers a cached
*failure* as well, which the old spinner-only line did not.

### Deliberately not built

- ~~**The compare frame gets no such box.**~~ Built. See the next entry.

## Every picture in the app now fails into a box

The lightbox fix above raised the question for the other seven image surfaces. This is the sweep.

| surface | on failure |
|---|---|
| lightbox frame, `.stage > img` | `.nopic` states the box, `No picture` panel — the entry above |
| lightbox compare frame, `.abimg` | **fixed here**: `.ab` carries a fill |
| station card still, `img.shot` | **fixed here**: the same `No picture` panel |
| camera wall tile | already `.camtile.fail`, the panel this repo standardised on |
| wall strip probe (`?sheet=`) | already silent by design — the tile keeps its live still |
| clip strip probe | already `decode()` in a `try`, falling back to the live still |
| lightbox frame prefetch | nothing to fail into. It warms the cache and paints nothing |
| red favicon, `icon.svg` | already `.catch()`. The blue mark stands |
| About easter egg, `img/egg.webp` | already `onerror`. The gesture goes dead, which is the point |

**The compare frame showed the wrong thing rather than nothing.** `.ab` is the older frame clipped
to the divider, and it held no fill. So a frame that failed to load let the newer frame show straight
through it, and compare drew one picture twice with an A timestamp over half of it. A false match is
worse than a visible gap. `.ab` now carries `var(--hover)` and the frame's left corner radius. A
loaded frame is opaque and covers all of it.

**The station card printed a line of text.** `camImg()`'s `onerror` replaced the `<img>` with
`image unavailable`, which collapsed the still's 16/9 box to the height of one line and gave a third
wording to a fact the wall and the no-feed card already name. It now leaves the same `No picture`
panel, which holds the box. The box ships inside every still wrapper and `css/base.css` hides it
while the picture is there, so the inline handler stays one expression.

**The picture is removed, not hidden**, and that is load-bearing: `tick()` in `js/clip.js` reads
`isConnected` on that element to know a clip's frames have started failing and stop the loop.

## The weather section is all or nothing

MET answers a station through two feeds. The nowcast gives the rain, and it joins by nearest point
inside `MET_KM`. The forecast gives the two temperatures, and it joins by district name. A station
can match one feed and miss the other. 53 of 676 stations sit inside a forecast district and outside
`MET_KM` of every nowcast point, so they hold a temperature and no rain at all.

The section used to draw whatever it held. On those 53 stations that made a heading, a ⋮, one cell
and the word `Now` over two numbers. The `Later` cell was absent and the rain glyph beside the
temperatures was absent with it. A reader saw a weather panel with most of its parts missing. That
reads as a panel that failed to load, not as the one fact MET published.

`metSection()` in `js/popup.js` now returns nothing unless MET answered both questions. The gate
tests `now`, `hr1`, `tmax` and `tmin` together, at the top of the function. A card with no weather
section is a shape this app already draws, because a station outside both feeds always drew that
way. A card with a broken weather section was a new shape, and it was worth less than the
temperature in it.

The cost is that a hidden station loses a real temperature. That is the trade accepted. The
temperature is a district figure, and the same district holds other stations that carry the full
section.

### The cutoff moved 1.5 km, and only that far

Hiding the partial cards made the cutoff worth measuring. A sweep put each hidden station against
every nowcast point MET published. The 53 sat between 15.0 km and 27.0 km from the nearest one.
Eleven sat between 15.0 km and 15.5 km. The constant hid those eleven, and the weather did not.
`MET_KM` went from 15.0 to 16.5, which recovered 17 stations and left 36 hidden.

The 36 sit between 16.6 km and 27.0 km. A bigger number is the wrong tool for them. The far end
is Sabak Bernam. MET built one point there for a cell about 28 km across. A radius that reaches the
last station is the cell-scaled rule `api.php` already rejects. Point density records where MET
chose to build a station. It says nothing about where the rain falls.

16.5 km stays well inside the decorrelation distance for a 3-hour rainfall field, about 26.5 km.
That distance is what sets this constant. The `Now` glyph is the weaker half of the claim,
because an instant claim wants about 3 km. That gap was already open at 15.0 km and this does not
widen it much.

### The card names the point it read from

`MET_KM` reaching 16.5 km puts the point behind a card up to two districts away. So the card names
it, in the section head: `Weather` on the left and `Slim River` on the right.

That slot is not new. `.sensorhead .muted` already right-aligns and truncates a label there, and a
camera section already prints its own station name in it. One slot answers one question on every
sensor of the card: what this reading is about, when the heading beside it does not say. The weather
name costs one span and no new rule.

The distance stays in the ⋮, and that is a rule about heads rather than about this number. A head
that carries a distance makes every other head owe one. A camera then owes its metres from the
station, and a river owes its own. The card holds one distance in one place, under the ⋮ with
the issue time, where this app already puts what a reader checks when they doubt a number.

The name sat under the cells for one revision, as a footnote reading `From Slim River, 6.1 km away`.
The words were right and the place was wrong. A card that draws the same kind of label twice in two
shapes makes a reader learn two shapes.

The gate above guarantees the line has something to print. MET fills `at` and `km` in the same pass
that fills `now`, and a card with no `now` draws no weather section at all.

## Five costs a poll used to pay, all in `api.php`

A reader reported a stuck camera wall. The investigation found five separate costs on every poll,
not one fault. Each fix below is independent. Each one touches `api.php` alone.

### The session lock serialized every request from one browser

PHP starts a session on every request here. The file session handler holds an exclusive lock on
the session file for the whole request. Every request that carries the same `PHPSESSID` therefore
runs one at a time, no matter how many idle PHP-FPM workers wait.

Six concurrent camera stills share one cookie. They measured 1.9, 3.0, 4.3, 5.4, 6.1 and 6.9
seconds, a clean staircase. The same six requests with no shared cookie finish together in 3.4
seconds. Nothing in this repository reads `$_SESSION`. The lock protects nothing and costs the
whole camera wall its concurrency.

The fix is one line: `session_write_close()`, right after the two `require_once` calls at the top
of `api.php`. It runs before any real work starts and drops the lock at once. The fix stays inside
the PHP file. It does not move into an ini setting, because this file must stay correct on a
machine it does not own.

### A siren detail call answered one field, all day, for every siren

The siren list already carries `status`. The detail call adds exactly one more field,
`statusLastUpdate`. Every rebuild fetched all 212 siren details anyway, at 61,056 requests a day,
to keep one timestamp current on a sensor that reports once a day.

`sirenWanted()` reads the list first. A siren currently sounding still gets a detail call every
rebuild, so a real alarm loses no latency. A quiet siren refreshes on `SIREN_TTL`, one hour.

**5,088 is the floor, not the real count.** It assumes every siren stays quiet all day. This
payload holds 7 sirens stuck at a non-zero status. `sirenWanted()` fetches each of those on every
rebuild, not once an hour. The other 205 sirens still refresh on `SIREN_TTL`. The real daily count
is 6,936: 205 sirens times 24 fetches, plus 7 sirens times 288 fetches (`TTL`, 300 seconds, is the
rebuild cadence). A siren stuck at a non-zero status is now the most expensive siren on the map. It
never earns the hourly refresh.

**`SIREN_TTL` must not grow to six hours.** The history pass stamps each sample from
`statusLastUpdate`. The `(station, ts)` primary key drops a repeated stamp. Six hours between
fetches folds six hours of samples into one row.

A siren the sweep skips must keep the stamp it already had. It must not borrow the poll clock. The
first version fell back to the poll time, through the ordinary rule in `readTs()` for a missing
`updated` field. That miswrote 319 rows an hour across 131 sirens. "Not fetched this round" is not
the same claim as "reported now."

`stationUpdated()` now carries the last known `statusLastUpdate` forward for a siren the sweep
skipped. It reads that value from the payload the previous rebuild wrote. A gauge or a camera never
borrows one. Only a siren does.

### The camera still endpoint reached JPS on every request and cached nothing

`?cam=<id>` fetched the live still at JPS on every request, with no cache of its own. The camera
wall draws about 90 tiles on one page. Every reader looking at that wall multiplied JPS traffic by
90.

The still now stays on disk for `CAM_TTL` (300 seconds), the same number as `POLL_MS` in
`js/config.js`. A still cannot change faster than the payload that names it.

The `Cache-Control` header on a hit reports the remaining life of the file, not the full `CAM_TTL`.
A file 299 seconds old sends `max-age=1`, not `max-age=300`. The disk cache and the browser cache
compose. A header that always claimed 300 let a reader hold a still for two cycles while both
layers claimed one.

A cache hit answers with no lookup at all. A miss reads `.cams.json`, a small camera-id-to-URL map
the rebuild writes, instead of decoding all of `.cache.json` for one string. Measured after
clearing the cache file for one camera: a cold still takes 0.68 seconds. A warm one takes 0.05 to
0.06 seconds.

`camImageOk()` checks a fetched body with `getimagesizefromstring()` before anything writes it to
disk. A maintenance window can answer HTTP 200 with an HTML notice instead of a picture, the same
fault `pageHasData()` already guards against on the scraped pages. The old handler cached that body
without checking it, served it for `CAM_TTL`, then offered it again as the stale fallback with no
expiry. One bad response became a standing failure.

`CAM_STALE` (3600 seconds) now bounds the fallback. An outage past one hour falls through to the
failure panel the client already draws, instead of an old frame with nothing to mark it as old.

### The archive had no route for "whatever is newest"

`?shot=<id>&t=<unix>` names one exact frame. The camera wall wants a picture from the archive
instead of a live JPS fetch, but it holds no frame list to read a timestamp from. Before this
change it had no way to reach the archive at all, so it fetched a live still per tile instead.

`?shot=<id>` with no timestamp now serves the newest stored frame. **The newest frame form must
never take the `immutable` header.** An exact frame never changes once written, so a year is honest
there. While capture keeps reaching a camera, the bytes of the newest frame change every
`SHOT_EVERY` (30 minutes). `shotCache()` gives it `max-age=900` instead, half of `SHOT_EVERY`, the
same reasoning `?sheet=` already states for the strip.

**"Newest stored frame" is not the same claim as "recent frame."** A camera whose capture keeps
failing still has a newest frame. It is just old — one measured 5.9 days behind. `SHOT_FRESH`
(`shots.php`, twice `SHOT_EVERY`) is the ceiling. Past it, this route answers 404 instead of a
picture with no age on it. That 404 sends a caller on to its own fallback. For the wall that is the
live still, and past that, the `No picture` panel. This does not change the `&t=` form. It names one
exact frame, and a reader asking for a specific past moment gets it however old that is.

### The payload set no cache header of its own

Herd serves every response `Cache-Control: public, max-age=10800`. The JSON payload set nothing to
override that. A browser can answer all 36 polls of the next three hours from its own cache, on a
page whose whole purpose is to stay current.

`payloadValidators()` sets `Cache-Control: no-cache` and an `ETag`, and returns the ETag.
`no-cache` does not forbid storage. It requires the browser to revalidate before
it reuses a stored response. The ETag makes revalidating cheap: an unchanged payload now costs a
304 and about 200 bytes, instead of the full payload, measured at 342,551 bytes on a live poll.

`payloadEtag()` computes the tag, and it is not a plain hash of the body.
It blanks `"cacheAge":N` to `"cacheAge":0` first.
The tag then names the build rather than the moment somebody read it.

That split shipped later than the rest, together with a repair to `cacheAge` itself.
`cachedPayload()` merged its computed age to the right of the stored payload with the PHP `+`.
That operator is left-biased, and the stored file already carries a `cacheAge` of `0`.
So the computed value never survived, and every cached read reported `0` however long the file
had sat. The status popover reads that field to name the source of a poll.
It said `JPS` on every poll, including the ones a 5-minute file cache answered.

Neither half was safe on its own, and the ETag is the reason.
A frozen field cannot move a hash, so the tag held still only because the bug held it still.
Repair `cacheAge` alone and a rising number changes the body every second.
The tag then changes every second, and the 304 never fires again.

Nothing errors. A validator that never matches is not a failure.
It is a full 33 kB body on every poll, for as long as a reader keeps the tab open.

`payloadEtag()` is a function apart from the header writing for one reason.
`--selftest` can then call the rule rather than restate it.
Five assertions cover it. `cacheAge does not move the ETag` is the one that keeps the 304 alive.
Measured live: `cacheAge` moved from 147 s to 154 s, and the conditional poll still answered 304
with 0 bytes.
Any diagnostic added to this payload that moves without the data moving needs the same treatment.

`sendPayload()` calls `payloadValidators()`. It answers a matching `If-None-Match` with 304, and
otherwise echoes the body and exits. It compares the incoming header after a `trim()`, quotes
included. A comparison that always fails still returns 200 every time with no error. Check this
against an actual 304. Do not assume it from the absence of a crash.

**Three exits echo this payload, not two.** A fix that reaches only one of them has already cost
this codebase once, the `forced` flag gotcha this file already records. `serveCache()` ends the
request, so it calls `sendPayload()`. The `fastcgi_finish_request` branch and the end of a rebuild
both keep running afterward, the branch to fall through to a foreground refresh, the rebuild to run
`captureShots()`. Both call `payloadValidators()` directly and echo the body themselves.
`payloadValidators()` is the one function all three call. No exit can drift its own headers from
the others, the way `forced` once did.

The service worker plays no part here. `sw.js` returns without calling `respondWith()` for
`api.php`. These headers reach the HTTP cache inside the browser, and nothing else.

### Deliberately not built

- **No shared cache-busting scheme between the payload and the static assets.** The payload uses
  `no-cache` plus an ETag because it changes every poll. The CSS and JS files use a `?v=` query
  string because they change on a deploy, not on a timer. Two different problems, two different
  answers.
- **No new stampede guard for the ETag comparison.** `sendPayload()` runs after `cachedPayload()`
  or a fresh rebuild, both of which already sit behind the refresh lock or the file cache. A
  conditional request reaches no new code path to JPS.

## Every client-side JSON fetch now goes through one wrapper

Four places in the browser ask this server for JSON: the payload poll, the force-refresh button,
the place search, and the lightbox archive fetch. None of them set a timeout, checked the status,
or retried, and `fetch()` supplies none of the three by itself. A hung worker therefore left the
splash screen waiting with nothing to end it.

`js/ask.js` gives all four one timeout, one status check and one retry. `AbortSignal.timeout()` is
native, so no controller is wired up.

A fifth `fetch()` stays bare on purpose. `js/map.js` loads `water.json` and swallows its own
failure, because a map without the rivers is a plainer map rather than a broken one.

The camera wall is not on that list. Its tiles are `<img>` elements, and a browser loading an image
makes no `fetch()` call.

### `js/ask.js` adds three things

`askJson(url, opts)` now carries every one of those four requests. It adds three things
`fetch()` does not do on its own.

- A timeout, through `AbortSignal.timeout()`. Plain `fetch()` waits forever on a hung worker.
- A throw on any status outside 200 to 299. Plain `fetch()` resolves on a 500. Calling
  `r.json()` on an HTML error page then throws a message written for a browser vendor.
- One retry, on a network fault, a timeout, or a 5xx status. A single dropped packet used to
  cost a red status dot for the rest of the five-minute poll window.

The payload poll passes no `cache` option. The server sends an `ETag`. An unchanged poll then
costs a 304 and about 200 bytes. `cache: 'no-store'` skips that check and forces a full fetch
every time. The force-refresh button sets `no-store` on purpose. Defeating the cache is the
whole point of that button.

### The camera wall reads the archive, not a live still

Each tile on the camera wall now loads `api.php?shot=<id>`, the newest stored frame. Before this
change it loaded `api.php?cam=<id>`, a live request that reaches JPS every time the tile loads.

Measured on one tile: the archive route answers in about 0.07 seconds and 186 KB. The live route
takes about 0.83 seconds and 275 KB. Ninety tiles on one page used to multiply that live cost by
ninety, for every reader who opened the wall.

A tile can still fall back to `api.php?cam=<id>` once. That path runs inside the error handler in
`onSettle()`. It now fires on two different 404s, not one. The first is a camera JPS only just
added, whose archive holds nothing yet. The second is a camera whose capture has stopped reaching
it. `?shot=` refuses a frame past `SHOT_FRESH`, so a stale archive now answers 404 too. Before that
ceiling existed, a tile showed whatever frame was newest with no check on its age. One camera
measured showed a picture 5.9 days old, with nothing on screen to say so.

### `null` and `[]` mean different things after a `?shots=` call

The lightbox scrubber asks `?shots=<id>` for the frame list stored for one camera. `[]` means the
camera holds no stored frames. That is a fact about the archive.

A failed request now resolves to `null` instead. A timeout, a dropped connection, and a bad
status all count as failed. `null` is a fact about this client, not about the camera.

Before this change, both cases produced `[]`. A failed request then drew the scrubber exactly
like an empty archive: no scrubber, no line of text, and no way to tell the two apart.

`#tlfail` now carries the difference on screen. `openTimeline()` shows "Could not load the
archive." only when `rows` is `null`. An empty archive still draws nothing, exactly as before.
`reset()` hides `#tlfail` between cameras. A failure on one camera must not follow the reader to
the next.

## Five panel-only modules now load on demand, not on landing

Five modules used to load with every visit, whether or not the reader ever opened the surface each one drives.
`js/table.js` and `js/wall.js` serve two dialogs.
`js/clip.js` serves the station panel's camera preview.
`js/test.js` serves a mode most visits never enter.
`js/timeline.js` serves the lightbox scrubber.
Together they measured 45.3 kB gzipped, out of about 160 kB of JS the page loaded before this work.
Landing now loads about 116 kB.
Each module still loads in full.
It loads the first time a reader opens the surface it drives, not before.

Sizes, gzipped over the wire, measured with curl against the running site. One unit throughout —
kB, meaning 1000 bytes, not the 1024-byte KiB a file manager shows. The total is the sum of the
rows below it:

| module | size | surface |
|---|---|---|
| `js/table.js` | 9.5 kB | the all-stations table dialog |
| `js/wall.js` | 9.7 kB | the camera wall dialog |
| `js/clip.js` | 4.6 kB | the station panel's camera clip |
| `js/test.js` | 5.7 kB | test mode |
| `js/timeline.js` | 15.8 kB | the lightbox scrubber, the largest of the five |
| **total** | **45.3 kB** | |

Every module import graph in this app is static except these five.
The other eighteen modules still reach the page through ordinary `import` statements.
`index.html` still preloads all eighteen with `<link rel="modulepreload">`.
See the gotcha in `CLAUDE.md` about that list.
The five stay out of both.
A `modulepreload` link for one of them fetches that module on landing again.
That is the exact cost this work removes.

### `js/lazy.js` runs one job for every deferred module

`lazy(load, box)` calls `load()`, and sets `aria-busy="true"` on `box` while the import is in flight.
It clears the attribute once the import settles, in a `finally`, so a failed import cannot leave a box shimmering forever.
It rethrows the error, because the caller owns the surface and knows what to draw in it.

The 150 ms delay before `aria-busy` lands is the reason this function exists at all, not an afterthought.
A warm same-origin import of a 9 KB to 15 KB module takes 10 ms to 40 ms.
That holds once the browser has the file cached from a first load.
A skeleton that appears and then vanishes inside 20 ms reads as a flicker, not as loading.
Under 150 ms this function draws nothing.
Past it, a reader has already started to notice a wait, and the shimmer is already there to answer it.

### Each deferred module keeps one cached promise, not a bare `import()`

`js/ui.js` holds `withTable`, `withWall` and, as of this task, `withTimeline`.
`js/map.js` holds `withClip` the same way.
Each wraps one specifier in a module-level variable:

```js
let tlMod;
const withTimeline = fn => (tlMod ??= import('./timeline.js')).then(fn, err => {
  tlMod = null;
  console.warn('timeline.js did not load', err);
});
```

Two things this buys back, both lost by a bare `import('./x.js').then(fn)` at each call site.

First, registration order.
A promise runs its callbacks in the order a caller attaches them.
An open and a close registered on the same deferred module keep that order.
They keep it even while the import is still in flight.
A bare `import()` per call site raced two separate promises instead.
A fast open-then-close on the table or the wall left the opener running last, behind an already-closed dialog.

Second, a variable this code can clear on failure.
A browser can cache a failed dynamic import's rejection by specifier for the life of the page.
A failed import handled with a plain `.catch()` reuses that same rejected promise on every later call.
Clearing the module-level variable lets this code call `import()` again.
The browser's own module map can still answer that call from its cached rejection, so the retry can still fail.
A full page reload is the recovery that reliably works, because it starts a fresh module map.
Every one of these four clears its variable on failure anyway.
A specifier can fail once and still succeed on a later `import()`, when the network recovers between the two calls.

`withTable` and `withWall` rethrow on failure.
A table row or a wall tile has its own `loadfail` banner to draw, and needs to know the import failed.
`withTimeline` does not rethrow.
The lightbox has already opened on the picture by the time it asks for the module.
A failed import there is not fatal to the surface — the reader still has a still image to look at.
It logs a warning and lets the picture stand with no scrubber under it.
It does not fail the click that opened the lightbox.

Three more call sites read `withTable` or `withWall` with nowhere to report a failure: `dataFind`'s
keystroke handler, `camBox`'s close handler, and the camera filter's tile count. Each already
resolves the module from the cache with no network request, so the only rejection left to see is a
real bug inside `dataTable()`, `close()` or `count()`. `withTable` and `withWall` tag the error with
`importFail` when the import itself is what failed. `ignoreImportFail` in `js/ui.js` reads that tag
and rethrows anything else, so a genuine bug still surfaces as an unhandled rejection in the console
instead of vanishing into a blanket `.catch(() => {})`. A blanket catch was tried first and rejected:
it also swallowed a real bug thrown inside the module it was guarding.

### `render()` keeps its two deferred calls synchronous

`js/render.js` runs on every poll, and two lines in it read a deferred module:

```js
if (el('dataBox').open) import('./table.js').then(m => m.dataTable(), () => {});
if (el('camBox').open) import('./wall.js').then(m => m.paint(), () => {});
```

Both use `.then()`, not `await`, and `render()` itself stays a synchronous function.
A dialog can only be open because its own opener already called `withTable` or `withWall` once.
That means the module is already in the browser's module map.
A poll that reaches these two lines finds it there already, with no network request behind it.
Making `render()` `async` to `await` these two calls costs nothing on the network.
It still moves every line after each one into a later microtask, on every poll.
That cost falls on two calls that never actually wait for anything.

The second argument to `.then()` is a rejection handler that does nothing.
`render()` runs on every poll, and it has no surface to report a failure on.
A bare `import().then(fn)` here raised one unhandled rejection every poll, for as long as a reader
left a failed dialog open behind its `loadfail` banner.
`js/locate.js` reads the same table dialog on a location fix, and carries the same fix for the same
reason.

### Task 6: the lightbox scrubber

`js/timeline.js` was the last of the five and the largest, at 15.8 kB gzipped.
It binds 14 listeners at module scope, across ten elements, plus one `matchMedia` change listener.
That happens the first time anything imports it, not on landing.
Every target is static markup already in `index.html` — the stage, the seek bar, the transport
buttons, the range pills and the dialog itself — so each lookup still resolves once the module runs.
`openTimeline()` is only reachable off the resolved module object.
By the time a reader can call it, the listener setup has already finished.

Two call sites in `js/ui.js` needed different fixes.
The opener, a `document.addEventListener` delegated click handler, called `openTimeline(src)`
directly. It now runs the open through `withTimeline` and waits on the import alone, in two steps:

```js
withTimeline(m => m.openTimeline(src));
el('tlfail').hidden = true;
try { await lazy(() => tlMod, el('lightbox')); }
catch { el('tlfail').hidden = false; }
```

The first line registers the open on the shared promise, ahead of any close a reader triggers next.
The `await` hands `lazy()` the import alone.
`openTimeline()` then awaits `api.php?shots=` for up to 30 seconds.
The skeleton must not stand for that whole wait on every open — only the import belongs behind it.
An earlier version awaited the combined call, `lazy(() => withTimeline(m => m.openTimeline(src)))`,
which held the skeleton across that fetch on every open instead of only the first.

The `try` block shipped late, and its absence was a real defect.
`lazy()` rethrows a failed import on purpose, because it does not know which surface a caller owns.
The three other callers each answer that: the table and the wall draw a `loadfail` banner, and the
test toggle puts its own flag back. The lightbox answered nothing.
It awaited the raw import promise a second time, inside an `async` listener with no `try`.
`withTimeline`'s own rejection handler does not cover that second `await`.
So a failed import raised one unhandled rejection per lightbox open, and told the reader nothing.
Measured in node on the two shapes: one unhandled rejection before, none after.
`#tlfail` is the surface, and it is the same line `openTimeline()` prints when the archive is out of
reach. The reader is in the same position either way. No scrubber, no compare, and a live picture
that still works.
The handler clears that line before every attempt.
`reset()` clears it only on the path where the module loads, and that is the path which did not run.
The second site, `lightbox.addEventListener('close', reset)`, passed `reset` itself as a callback.
A dynamic import hands back a module object, not the bindings inside it.
Once the static import is gone, there is no `reset` to pass.
It now passes a small wrapper instead:

```js
lightbox.addEventListener('close', () => withTimeline(m => m.reset()));
```

`#tl`, the control bar, sits in the page flow under the picture on touch devices and at widths under 601px.
Only a hover-capable pointer at 601px or wider lifts it into an absolute overlay on top of the frame.
In flow, an absent bar during the import shifts the picture up when the real bar lands under it.
`#tlskel`, a plain box holding one `.skel` shimmer, now sits where `#tl` will render.
It reserves that height while `lazy()` holds `aria-busy` on `#lightbox`.
Scoped to the in-flow case only: an earlier version drew it under `#lightbox[aria-busy="true"]`
alone, with no width or pointer condition, so it also reserved the height on a hover-capable
pointer at 601px or wider — where `#tl` is `position: absolute` and takes no flow height at all.
That box appeared, then vanished when the real bar landed, shifting the picture twice on the
majority platform, which is the shift this skeleton exists to prevent. The fix is one negated media
query, `not all and (hover: hover) and (min-width: 601px)` — PLAYER_OVERLAY's own condition, inverted
— around the `display: block` rule, so the reservation applies only where the footer shape holds.

**The first pass read that height off the CSS rather than measuring it, and missed by 21px.**
No browser was available then. It added the rules of `#tl` and reached 101px.
It then gave `.skel` 101 minus the 16px of padding on this box, or 85px.
A later measurement in headless Chrome put the real bar at 80px.
So the skeleton reserved 21px more than the bar it stands in for, and the picture jumped by that
much when the module landed. That is the shift this box exists to prevent, drawn smaller and in the
other direction.

Measure this with a real frame in the stage.
`.stage` and `.player` are both shrink-to-fit around the picture.
An empty stage gives `.player` a width it never has in use, so `#tl`'s own container query resolves
against the wrong number and the bar reports a height nobody sees.

Measured at the widths where `#tl` sits in the flow, with a frame loaded:
the bar is 80px at 360, 390 and 480, and 68px at 600. The 900px case is `position: absolute`, and
the reservation correctly reads 0 there, which is the negated media query above doing its job.
`.skel` is 64px now, so 64 plus 16 matches the 80.

One reservation cannot match a bar that changes height.
The in-flow case is the phone, so the phone is the width to match.
The shift is 0px at 360, 390, 480 and 900, and 12px at exactly 600.

## The rainfall heatmap claimed rain over 250 km² from one gauge

**Every "gauge" in this section is a rainfall station**, measuring `hourly` in mm/h. That is the only
kind the rain layer reads, on both sides of the argument. A **flood gauge** is a different kind
altogether — `depth` in metres over a flood-prone spot — and it feeds the *water level* layer beside
the rivers. No rule in this section paints, denies or thins one. The two are worth keeping apart by
name, because JPS records a flood gauge reading negative as **dry ground**, and this section says
"dry gauge" about three hundred times meaning something else.

**And they must stay apart in the logic, not only in the wording.** A flood gauge measures what the
drainage failed to carry away, which is not what fell. Where the drainage is good, rain falls as
hard as anywhere and the gauge stays clear. Where runoff arrives from upstream, the gauge goes under
with no rain overhead. So a clear flood gauge is no evidence that the wash above it is overclaiming,
and it must never join the readings that deny ground. A submerged one is no evidence of rain either,
and must never paint. Only a rainfall station reports rain.

A reader reported that the violet wash on the rainfall layer covered ground where no gauge
reported rain. Measured on the payload it was reported from, this was correct. One gauge, JPS
Ampang, read 19 mm/h. The blob it painted reached 9 km. Twenty other gauges stood inside that
circle and every one of them read 0.0 mm. The nearest of the twenty was 1.6 km away.

### Cause 1: a blob painted 1.8 times the distance the constant named

`HEAT_KM` said 5 km. Three places treated 5 km as the size of a blob. The constant's own comment
called it the ground size. `heatScale()` said it pins each blob to a fixed distance on the ground.
`thinHeat()` dropped a weaker point within 5 km, on the claim that the stronger point's blob
already covered it.

The layer painted 9 km.

simpleheat builds one sprite and stamps it at every point. `radius(t, i)` fills an arc of radius
`t` and applies a shadow of blur `i` to it. It then sets `_r = t + i` and makes the sprite
`2 * _r` across. So the painted circle reaches `radius + blur`, not `radius`. `heatScale()` gave
`radius` the whole ground distance and then added `blur = radius * 0.8` on top of it. Every blob
on both layers therefore reached 1.8 times its stated size, and the layer covered 3.24 times the
area anyone had agreed to.

`thinHeat()` under-reached by the same factor. It exists to stop overlapping blobs compositing
their alpha, because both layers plot an intensity and two gauges reading 4 mm still means 4 mm.
It dropped neighbours inside 5 km while the blobs reached 9 km, so any pair between those two
distances still stacked. That is the same fault the function was written to fix, moved out one
ring.

The first repair split the ground distance across the pair, so that `radius + blur` summed to it by
construction. That trap is gone rather than tuned now: `SoftHeat._redraw()` paints the blobs itself
and never draws simpleheat's sprite, so `blobPx()` is the radius, `thinHeat()` takes the same ground
distance, and `HEAT_MAX_PX` bounds what it names. See *And the feather ate its neighbours* below for
why the layer ended up painting its own blobs.

### Cause 2: the layer read only half of what the network reported

The 5 km was chosen for water. Flooding is catchment scale, so one river gauge speaking for 5 km
of catchment is a fair claim. The rain layer took `HEAT_KM` because it was there.

Rain does not behave that way, and the payload can say so. Each rainfall station carries 12 hours
of history at 15-minute buckets. Take every pair of the 211 gauges that hold history, and every
time step where at least one of the pair was wet, and ask how often the other one was wet too.

| separation | P(the other gauge is also wet) |
|---|---|
| 0–4 km | 24% |
| 4–6 km | 13% |
| 6–8 km | 9% |
| 8–10 km | 8% |
| 10–12 km | 6% |
| 12 km and beyond | 4–6% |

The last row is the background rate — how often any gauge is wet at all. So one station's claim is
strong out to 4 km, half gone by 6 km, and worth nothing by 12 km. No rain claim survives 12 km,
and `RAIN_KM` at 9 km is the outer edge of one that does. The same reasoning already sits in
`api.php` at `MET_KM`, which notes that a claim about the next three hours reaches much further
than a claim about this moment.

**The first fix used that 4 km as the blob size, and it was wrong.** It made every blob small
enough to stop short of any dry gauge. That charges the same ground everywhere. Over Ampang,
where a dry gauge stands 1.6 km away, cutting the blob back is what the evidence says. Over Sabak
Bernam, where the nearest other gauge is 12 km off, nothing disputes anything and the cut buys
nothing. The map lost three quarters of its area and most of that loss was not evidence-driven.

**The network reports two things and the layer was reading one.** 12 gauges said rain. 218 said
none. Only the 12 reached the canvas, so the wash spread over ground that 218 stations had already
measured and found dry. The fix is not a smaller brush. It is to draw the other 218.

### What it does now

A wet gauge paints `RAIN_KM`, which is 9 km — the same reach the layer had before any of this.
A gauge reporting no rain then erases that paint over itself, at the same 9 km.

**One number covers both readings, and that is the rule.** The first build gave the paint 9 km and
the erase 4 km. There is no defending it. It is the same instrument, the same minute and the same
question, so the answer "none" cannot carry less ground than the answer "12 mm" — and a reader
looking at a small erased patch inside a large violet one is reading exactly that unfairness off
the screen. Symmetry cost 4% of the painted area, 2,005 km² against 1,906, because the midpoint
rule below already governs every dry gauge with paint on it. Only 19 of 213 were reaching the
4 km cap at all.

`SoftHeat` in `js/heat.js` is the subclass both layers use. It paints the wet
gauges the way the water layer does, then runs a second pass in `destination-out`, stamping a soft
brush at every dry gauge. `destination-out` multiplies canvas alpha by one minus the brush, so
overlapping erasers compound. Two dry gauges over the same ground remove more of it than one does,
which is right — that is two readings saying the same thing.

Three details are load-bearing, and each one was found by running the check rather than by reading
the code.

**simpleheat leaves `globalAlpha` set.** Its draw loop assigns the weight of each point and never
puts it back, so the eraser inherited the last blob's weight. A 0.9 blob left 22 of 229 alpha
standing on a gauge reporting zero. The pass runs inside `save()` and `restore()` now.

**An eraser stops at the midpoint to the nearest wet gauge.** This is what makes two equal radii
work. On the line between a wet gauge and a dry one, paint survives exactly where the pixel is
nearer to the wet one, so neither reading outranks the other and neither is discarded. Without it,
alpha is this layer's colour scale, so an eraser that reaches a wet gauge does not shrink its blob
— it restates the rainfall as a lighter class. A wet gauge 2 km from a dry one lost half its alpha
and dropped a class it had measured. A dry gauge on the same pole erased its neighbour off the map.

**The eraser holds full strength over its first 15%.** A ramp that peaks at the exact centre honours
the reading at a mathematical point, and no pixel is one. The gauge itself kept 5 of 206 alpha
because the sample sat half a pixel off the peak.

### A third fault: the paint brush drew four rain classes from one reading

This one predates both of the above and is worse than either. simpleheat looks its gradient up by
alpha, so alpha is the blob's extent **and** its colour at the same time. The brush fades from the
gauge's weight at the centre to nothing at the edge. That fade walks straight down the colour
scale, and the legend beside it names those colours in millimetres.

Measured on the canvas, one gauge reading 27 mm/h, which is JPS's *heavy* class:

| distance | alpha | colour | what the legend says it means |
|---|---|---|---|
| 0 km | 178 | `#bc7dff` | heavy — the actual reading |
| 3 km | 142 | `#9a7aff` | between moderate and heavy |
| 4 km | 112 | `#867bff` | moderate |
| 6 km | 44 | `#6e7aff` | light |

Three classes from one number, and no measurement behind two of them. In IDW or kriging a value
falls off because the estimate falls off. Here it fell off because that is how a brush is drawn.

**The first fix cut `BLUR` to 0.12 and it was ugly.** `BLUR` is the blur as a fraction of the solid
core, and dropping it from 0.8 turned every blob into a hard disc. The colour stopped lying and the
map stopped looking like a map. It also still drifted: 0.12 leaves a Gaussian tail that pulls the
weight from 0.9 to about 0.87 at four fifths of the radius, and between the 0.75 and 1.0 gradient
stops that is a visible move toward the next class up.

**The softness was never the problem. Softness bought with alpha *before* the colour is chosen was.**
`_colorize()` runs inside simpleheat's `draw()`, reads each pixel's alpha, writes the matching colour
back, and leaves the alpha alone. Anything that takes alpha away *after* that point makes a pixel
more transparent without touching what colour it already is. The dry-gauge eraser had been doing
exactly this all along, which is why an erased edge never changed hue.

**The second fix drew the blob twice over**, and it is the one the section below tears down. `BLUR`
went to 0.04, near enough to a hard disc that `_colorize()` saw one weight and painted one class
across the whole thing. `FEATHER` (0.45) then faded the outer 55% back out with a smoothstep in
`destination-out`, after the colour was settled. On one blob it was right, and this is what it did
to a gauge reading 27 mm/h:

| distance | before | now |
|---|---|---|
| 0 km | `#bc7dff` heavy, alpha 178 | `#bf7dff` heavy, alpha 182 |
| 3 km | `#9a7aff` **between classes** | `#be7dff` heavy, alpha 177 |
| 4 km | `#867bff` **moderate** | `#bf7dff` heavy, alpha 175 |
| 6 km | `#6e7aff` **light** | `#be7dff` heavy, alpha 118 |
| 8 km | fading | `#bf80ff` heavy, alpha 20 |

One colour, one claim, and an edge that fades. The water layer shared both constants and came out
the same way: a river at its danger mark painted `#ff4e4d` across the whole 5 km with the alpha
falling 255 to 0, where it used to grade through warning orange and alert amber on the way out.

That is a Thiessen cell with a soft edge, which is what a point reading spread over an area has
always been. It survives. What did not survive is the way the edge was made.

**The insight does survive, and it is the rule to keep.** `_colorize()` decides every pixel's colour
from its alpha and writes it back, so anything that changes alpha *afterwards* changes opacity and
nothing else. The dry-gauge eraser had been relying on that from the start, which is why an erased
edge never changed hue. Measured across an erased boundary: `#e86093` at alpha 230 on the gauge,
`#e96293` at alpha 83 in the fade — the same hue, two counts of premultiplied-alpha rounding apart.
That is still how the eraser works. It is only the blob's own edge that stopped being made this way,
for the reason below.

### And the feather ate its neighbours

Softening the edge by erasing it was wrong twice over, and the second one only showed on a screenshot
of two blobs close together.

A `destination-out` brush is a claim about the canvas, not about one blob. So each blob's own feather
removed whatever its neighbours had painted underneath it. `thinHeat()` leaves two kept gauges exactly
one blob apart, which puts each one's centre on the far rim of the other's feather — where that
feather is at full strength.

Measured along the line between two gauges one blob apart, both reading the same weight:

| position | alpha | colour |
|---|---|---|
| 1 km before gauge A | 177 | `#bc7dff` |
| **gauge A** | **5** | — |
| midway | 200 | `#e95e8c` |
| **gauge B** | **179** | `#bc7dff` |

Both centres erased to nothing by the other one's halo, and the ground between them stacked into a
class neither gauge had reported. The cliff at each centre is a 172-count step between samples 1 km
apart.

**Painting is additive over a neighbour and erasing is not, so the fade has to be painted.**
`SoftHeat._redraw()` now draws each blob itself: one colour out of `_grad`, the ramp simpleheat
builds from `options.gradient`, with only the alpha falling away. `_colorize()` is not called at all,
so nothing derives a colour from an alpha and there is nothing left to walk down the legend. Blobs
are drawn weakest first, so the worst reading in an overlap is the one on top — the rule `leads()`
and `atDanger()` already use everywhere else in this app.

The same two gauges after the rewrite: 179 at both centres, `#bc7dff` from end to end, and the
largest step between 1 km samples is 53, inside the smooth falloff.

### Painting shapes was still wrong, because two readings are not twice one reading

Drawing each blob as its own shape fixed the erasing, and left one thing that no composite operation
can fix. Every Porter-Duff `over` **adds** alpha. So two gauges reading the same rain over the same
ground came out heavier than either of them had reported: 227 where two 179 blobs met.

The hue did not move, so it never claimed a class nobody measured. It still said "more" where the
readings said "the same". There is no composite operation that blends colour and takes the *larger*
alpha rather than the sum, so the layer stopped stamping shapes and started asking the readings.

`SoftHeat._field()` computes the surface on a grid and lets the browser scale it up:

| per cell | what it is |
|---|---|
| `v` | the blended reading — every gauge in reach, weighted by nearness, **normalised**. A weighted mean, so two gauges reading the same thing give that thing back. |
| `cov` | whether any reading reaches this ground at all. A clamped sum, never a max. It carries the soft edge, and it is why an isolated blob still fades while an overlap does not brighten. |

Colour is `_grad[v]` and opacity is `v * cov`. Measured on two gauges one blob apart:

| both reading 0.70 | one 0.95, one 0.35 |
|---|---|
| alpha 179 flat from end to end, largest step over a kilometre: **1 count** | `#f35772` → `#b17cff` → `#7b7bff`, alpha 242 → 166 → 89 |

`cov` was a max in the first build of this field, and the section after next is what that cost.

The transition between two neighbours is the browser's own bilinear filter on a 4 px grid, which is
what makes it smooth for nothing. Raise the cell size and the edges go blocky. Lower it and the cost
climbs with the square.

**The bucket index is not a premature optimisation.** Without it the cost is cells times readings,
and `thinHeat()` packs readings one radius apart — so zooming out shrinks the radius and multiplies
the readings at the same time. Measured on a full viewport at that spacing:

| readings in view | flat scan | bucketed |
|---|---|---|
| 30 | 52 ms | 35 ms |
| 180 | 228 ms | 35 ms |
| 638 | 785 ms | 33 ms |
| 2,655 | 3.0 s | 38 ms |

A flood is exactly when a lot of stations report at once, and exactly when the map must not seize.

### The field drew a Voronoi border on every equidistant line

The overlap stopped brightening and the wash still came out as a set of circular lobes. Each lobe
faded at its own rim, and the fade lines between neighbours read as borders. A reader named it a
Voronoi diagram, which is what it was.

**One curve answered two questions, and `max` joined the answers.** A cell asks how much each
reading counts here, and it asks whether any reading reaches here at all. `cov` took the largest of
the per-gauge blend weights, so both faults sat in one expression.

`max` follows whichever gauge is nearer. Its slope therefore flips sign the moment another gauge
takes over, which happens on the equidistant locus. That locus is the Voronoi edge, and a slope that
flips sign is a crease. The eye reads a crease as a line.

The blend weight is also the wrong curve for coverage. It holds full strength across the inner 45%
and is down to 0.30 at 0.8 of a radius. That is correct for a weight and far too steep for coverage.
`thinHeat()` guarantees one radius between two kept gauges and nothing more, so real spacings run
well past that. Measured along the line between two gauges reading the same 0.70:

| gauges apart | midpoint alpha, against 179 at each gauge |
|---|---|
| 1.0 r | 177 |
| 1.4 r | 107 |
| 1.6 r | **61** |
| 1.8 r | **20** |

Two gauges that agree left a trench between them. The unequal pair states the same fault more
plainly. At 1.6 r the readings 0.95 and 0.35 painted alpha 242 and 89. The ground between them came
out at **54**. A midpoint darker than both of its ends is not a transition. It is a border.

**So the two questions get two kernels, and coverage gets a union.**

| constant | question | value |
|---|---|---|
| `BLEND` | how much say does this reading get in the mean | 0.45 |
| `FEATHER` | how far does the wash stay solid before its outer edge fades | 0.50 |

`cov` asks whether any reading reaches this ground. It cannot pass 1, so an overlap still never
paints brighter than a gauge centre, which is the rule this whole field render exists to keep. The
first build of it was `1 - (1-c1)(1-c2)…`, and the section below is why that changed.

The same measurement after the change:

| gauges apart | with the max | with the union |
|---|---|---|
| 1.4 r | 179 → 107 → 179 | 179 → **179** → 179 |
| 1.6 r | 179 → 61 → 179 | 179 → **177** → 179 |
| 1.8 r | 179 → 20 → 179 | 179 → **102** → 179 |
| 0.95 and 0.35, 1.6 r apart | 242 → 54 → 89 | 242 → **159** → 89 |

The handover now walks down from one reading to the other instead of diving between them.

**The old suite did not see any of this.** Its two overlap assertions probe two gauges exactly one
radius apart. That is the single spacing where `max` behaves, so both passed with the bug present.
`heat-test.html` gained probes at the wider spacings for this reason.

### A rim facing nothing and a join between two blobs are different edges

The union held the joins together and left the outer rim as abrupt as before. The ask that followed
named the distinction exactly: feather the edges that reach the limit of a blob and touch no other
blob, so the wash goes to empty ground more gently. Leave the joins alone.

`FEATHER` alone cannot do that. It is one radial curve, so lowering it softens the rim and hollows
out every join by the same amount. Measured on the whole gauge network, dropping it from 0.75 to
0.50 under the union took the share of joins that stay solid from 84% to 45%.

**The combine is what can tell the two edges apart, because it sees how many readings arrive.** A
rim has one. A join has two. A union asks whether any reading reaches the ground and saturates too
slowly to act on the count. A **sum** acts on it directly: one gauge at half strength stays half
covered, while two blobs meeting at half strength each add up to fully covered.

The sum needs a clamp, and the clamp is squared rather than bare. `min(1, s)` breaks its first
derivative where it bites, which is a crease along an iso-contour — the same fault as the Voronoi
edge, drawn on a different line. `1 - (1-s)²` has slope 0 at `s = 1` and meets the flat part
smoothly. Squaring is also the highest power that still lets the rim fade gently, since a higher one
holds full opacity further out and hardens the edge it was meant to soften.

That buys a much lower `FEATHER`. Held to joins staying solid at the median and 90th-percentile
spacing:

| coverage | `FEATHER` | joins solid | rim fade band | steepest slope |
|---|---|---|---|---|
| union | 0.75 | 84% | 1.38 km | 0.667 / km |
| union | 0.50 | 45% | 2.75 km | — |
| **sum, squared clamp** | **0.50** | **91–100%** | **2.20 km** | **0.440 / km** |

A 59% longer rim fade and a 34% gentler slope, with the joins no worse. One gauge alone, alpha by
radius:

```
before  230 230 230 230 230 230 230 230 230 230 230 230 230 230 230 227 196 135  67  15   0
after   230 230 230 230 230 230 230 230 230 230 229 229 227 217 197 166 125  79  37   8   0
0%                                                                                     100%
```

Ten steps across the outer half, against five across the outer quarter. And the joins, both gauges
reading 0.70:

| gauges apart | midpoint alpha, against 179 |
|---|---|
| 1.13 r, the median | 178 |
| 1.48 r, the 90th percentile | 179 |
| 1.60 r | 162 |
| 1.96 r, the widest that overlaps | 4 |

The last row is not a fault. At 1.96 r each gauge reaches 0.98 r short of the midpoint, so those two
blobs do not meet. Two separate blobs are the honest picture of two readings that far apart.

**Read the spacing off the station geometry, never off the wet gauges of the moment.** This tuning
first used the gauges reporting rain, and that set changes with the weather. Two snapshots an hour
apart put the widest overlapping pair at 1.58 r and at 1.90 r, and the same sweep scored one
candidate at 71% and then at 11% with no code change in between. The fixed answer comes from thinning
every rain gauge the network has, and it holds two populations that must not be quoted as one:

| population | pairs | median | 90th pct | widest |
|---|---|---|---|---|
| a gauge and its nearest neighbour | 47 | 1.13 r | 1.48 r | 1.96 r |
| every overlapping pair | 89 | 1.38 r | 1.88 r | 1.98 r |

A seam shows first between a gauge and its nearest neighbour, so `heat-test.html` takes its probe
distances from the first row. Join solidity is scored over the second, because any two blobs that
meet can show a seam. A constant tuned against one snapshot is tuned against one afternoon's rain.

### The blob went to 6 km, and every number above moved with it

Two asks arrived together: a gentler rim still, and a 6 km blob rather than 9. They pull against
each other, and the second one moves the ground the first is measured on.

**`RAIN_KM` at 6 km was already the better-supported number.** The co-wetness study behind the
constant puts the halving distance at 6 km and the background rate at 12. So 9 km was the outer edge
of a claim that survives, rather than the middle of one. A convective cell over the Klang Valley is
1 to 2 km across.

**A shorter radius spaces the gauges relatively further apart, which is the opposite of the
intuition.** `thinHeat()` drops a gauge whose blob another one already covers, so thinning at 6 km
keeps 84 gauges where 9 km kept 49 — and those 84 sit further apart *measured in blob radii*. The
90th-percentile join moves from 1.48 r to 1.66 r. Everything `FEATHER` was sized against therefore
moved, and `FEATHER` is a fraction of a radius rather than a distance.

| | `RAIN_KM` 9 | `RAIN_KM` 6 |
|---|---|---|
| gauges kept | 49 | 84 |
| median join | 1.13 r | 1.21 r |
| 90th-percentile join | 1.48 r | 1.66 r |
| `FEATHER` at 0.50 fades over | 2.20 km | 1.47 km |

The last row is the trap. `FEATHER` held at 0.50 through the change makes the rim **less** gentle in
metres, and the ask was for more. It sits at **0.20** now. That gives a 2.35 km fade at a slope of
0.413 per km, gentler than the 9 km layer on both counts.

```
9 km, 0.50   230 230 230 230 230 230 230 230 230 230 229 229 227 217 197 166 125  79  37   8   0
6 km, 0.20   230 230 230 230 229 229 229 227 224 217 205 190 170 146 119  91  62  40  19   4   0
0%                                                                                         100%
```

Sixteen steps against ten, over a blob two thirds the size.

**A 6 km blob with a 2.35 km rim does not merge into one sheet, and that is arithmetic.** Both
gauges reading 0.70, midpoint alpha against 179 at each of them:

| gauges apart | midpoint |
|---|---|
| 1.21 r, the median | 178 |
| 1.48 r | 133 |
| 1.66 r, the 90th percentile | 74 |
| 1.95 r, the widest | 2 |

At the 90th percentile the two gauges stand 10 km apart. Each blob stops 3 km short of the ground
between them. The softest tenth of real joins sit near 42%. That is the price of the two asks
together, and the dip is smooth rather than a crease — the fault this layer was rebuilt to remove
was a slope that flipped sign, not a slope. Raising `FEATHER` trades rim softness back for a solid
wash. The two cannot both be maximised, because one curve reaches the rim and the ground between
two gauges alike.

`heat-test.html` moved its probes to 1.21 r and 1.66 r, and the handover assertion moved to 1.21 r
as well. **At 1.66 r the midpoint is now fainter than the weaker of the two gauges**, so "the
handover never dips under both ends" stops being a contract out there. The blobs have parted, and
saying so is the honest picture of two readings 10 km apart.

### A gauge reporting no rain had a radius, and it was not the same one

`RAIN_KM` is one number and covers both answers. That was already true and already documented. The
asymmetry was somewhere else, in the shape the denial was drawn with.

The denial was a `destination-out` stamp, one per dry gauge, and its radius was a single scalar:

```
er = min(r, nearest_wet / 2)
```

The cap protects a real thing. Without it a dry gauge reaches across a wet one and takes its reading
off the map. A wet gauge 2 km from a dry one lost half its alpha. A dry gauge on the same pole
erased its neighbour outright. Halfway between two stations that disagree is where the boundary
belongs.

**But a scalar radius on a circle applies in every direction.** A dry gauge with a wet neighbour
2 km to the east shrank to 1 km westward too, where no wet gauge disputed anything. Measured on the
live network:

| | |
|---|---|
| dry gauges capped below the full radius | 143 of 191, **75%** |
| median cap | 0.54 of the radius |
| ground denied, against the ground they were entitled to deny | **35%** |

Two thirds of every dry reading was thrown away, most of it in directions nothing contested.

**The denial moved into `_field()` and is decided per pixel.** Dry gauges are read through the same
kernel at the same radius as wet ones, and the cell asks who owns the ground:

```
keep = 1 - dcov * gate        gate = D / (W + D)
```

`dcov` is the dry coverage, shaped exactly like `cov`, because it is the same question asked of the
other answer. `W` and `D` sum inverse-square distance to each side. That is Shepard's weighting, and
it is here for one property: **a gauge's own point is a singularity.**

| where | gate | result |
|---|---|---|
| at a wet gauge | 0 | its reading survives whole |
| at a dry gauge | 1 | the ground is denied whole |
| exactly halfway between the two | 0.5 | the boundary rule, unchanged |
| no wet gauge in reach | 1 | the dry gauge denies its full radius |

The protection and the reach now come out of one expression instead of fighting each other. The last
row is the ask. The first row is what the cap was for, and it is stronger than the cap was: the
guarantee is exact at the point rather than approximate at a radius.

Measured after, with a dry gauge 1.5 km from a wet one: the wet gauge keeps **229 of 230**. Across
the network the wash keeps **77% of its reach** against 96% under the cap, and **2 of 193** dry
gauges are still under paint. Both of those two share a pole with a wet gauge, which is exactly
where the gate is supposed to protect the wet reading.

**The hue is untouched by construction now, rather than by ordering.** The old pass ran last so that
a denied edge faded at the colour already settled beneath it. In the field, colour is `_grad[v]`,
`keep` multiplies only the alpha, and **`v` never sees a dry gauge at all**. One let in there
restates the rainfall as a lighter class. With `BLEND`'s flat core a dry gauge 2 km away carries
equal weight and halves the reading. A dry gauge denies ground and never supplies a value.

The cost is a second loop over the dry gauges, bucketed through the same index:

| load | before | after |
|---|---|---|
| 29 wet, 191 dry — the live network | 21.0 ms | 36.5 ms |
| 100 wet, 500 dry | — | 77.8 ms |
| 300 wet, 1500 dry | — | 215.9 ms |

The last two rows cannot happen. The network holds 231 rain gauges in total and they only ever move
between the two sets, so a flood raises the wet count and lowers the dry one.

`stamp()` went with the pass, and the trap it guarded is recorded in the section below. This layer
stamps nothing at all now.

### The feather shipped square, for one line

The first build of the feather filled a square. A canvas radial gradient does not stop at its last
stop, it clamps to it, so every pixel beyond `r` keeps the outermost colour. The feather's outermost
colour is full erase. The four corners outside the circle are 21% of that box, and they erased
everything under them — including the paint belonging to the next blob along, which `thinHeat()`
places exactly one blob away and therefore right in that corner.

On screen it drew as hard rectangles cut out of the wash, axis-aligned, about 2r on a side. That
reads as a tiling fault or a canvas seam. It is neither.

The dry-gauge eraser had used the same `fillRect` for weeks without ever showing it, because its
outermost colour is transparent and clamping to "no erase" is invisible. That is luck rather than
design, so both passes now go through one `stamp()` that fills the disc.

The check grew a case for it: a second gauge 1.2 blobs away on the diagonal, which is outside the
first blob's circle and inside its square. With the disc fill that gauge reads alpha 230. With the
square fill back it reads 0 — erased off the map entirely by a neighbour's corner.

### One more fault, found by the probe

`heatScale()` sized every layer in `LAYERS`, on the map or not. `setOptions()` ends in `redraw()`,
which reads `this._map._animating`, and Leaflet nulls `_map` when it removes a layer. So sizing a
layer that is off throws a `TypeError`.

It hid because the layer that is off has usually never been added, and a layer with no canvas
returns from `redraw()` one test earlier. Switching the heat chip from rainfall to water is what
reaches it. That leaves `rainHeat` added-then-removed, holding a canvas and no map. `heatScale()`
now skips any layer the map does not hold. `syncHeat()` adds and removes before it calls
`heatScale()`, so a layer just switched on is already on the map and still gets sized.

### What changed on screen

Measured on the payload, 12 gauges reporting rain and 218 reporting none:

| | paint | erase | area still violet | dry gauges under violet |
|---|---|---|---|---|
| before | 9 km | none | 2,747 km² | 58 of 218 |
| first fix, rejected | 4 km | none | 503 km² | 18 |
| second, asymmetric | 9 km | 4 km | 2,005 km² | 1 |
| now | 9 km | 9 km | 1,906 km² | 1 |

79% of the reach survives the erase. The one dry gauge left under paint shares a pole with a wet
one, so its eraser has no room and the wet reading wins. That is the midpoint rule working, not a
gap in it.

### What was not built

**No interpolation.** An inverse distance weighted field over all 230 gauges gives a smooth
surface and fills every pixel. It replaces a reading with a model, and this app draws readings. The
erase pass uses a dry gauge only to deny ground, never to invent a value.

**Nothing was added to the alert path.** This is a colour on a map. `isHot()`, the alert count, the
icon badge and the ticker are untouched.

**The water layer keeps 5 km and has no eraser.** Only its paint distance was wrong, not its
number. And a river reading low is not evidence that the river next to it is low. Rain gauges are
the only sensors here where one station's zero says something about the ground beside it.

## Rain totals over five nested windows

A rainfall sensor draws a second chart under its area graph. It shows the rain that fell in the
last 1 hour, 3 hours, today from midnight, 24 hours and 72 hours. Each total is one column.
The station card and the table popover share one function, the way both already share `rainBars()`.

Flash Flood Guidance publishes nested windows because each window answers a different question.
A short window measures drainage overload. A long window measures how wet the ground already is.
Sensitivity to earlier soil moisture falls as the window grows. So 1 hour and 72 hours are two
facts rather than two views of one fact.

Each window contains the one to its left, so the columns normally climb across. One exception is
real and it stays. Near midnight "Today" is younger than "3 h". At 01:00 today holds one hour of
rain and the 3 hour window reaches back into yesterday.

### Three of the five totals were in the feed all along

The Selangor rainfall detail endpoint publishes `threeHoursRainfall`, `cumulativeRainfall` and four
`sp*` class thresholds beside the `hourlyRainfall` this app already read. This app fetched every one of them and threw
it away on every poll since somebody wrote the proxy. So the 1 hour, 3 hour and today totals are
fields rather than calculations.

### 24 and 72 hours are a difference, never a sum

Nobody publishes those two. `cumulativeRainfall` is a year to date odometer, so the rain between
two samples is one subtraction. `accWindow()` in `api.php` does that subtraction.

Do not add up `hourly` buckets instead. A sum loses the rain in every gap and reports a small
number with nothing to say it is short. Measured on this box, the archive held 9 of the last 24
clock hours and a 15 hour hole. A sum renders that as a dry day, and the scrapers already fail
silently by design. A total with no alarm behind it has no place here.

A difference fails a different way. A missed poll widens the window rather than losing the rain
inside it, and the payload can measure that wider window. So the chart states 26.1 hours instead
of claiming 24.

The samples ride in the `level` table under a `#c` suffix. That needs no schema change, and
`RETAIN` prunes them with everything else. No station id ends that way, so nothing can mistake an
odometer row for a level.

The series started on 2026-08-13 and nothing can fill it in, because no earlier poll ever stored
`cumulativeRainfall`. So both long windows publish `null` until the archive reaches back that far.

### An asterisk marks what this app worked out

A total read from a feed carries nothing. A total this app computed carries an asterisk, and one
footnote line appears under the chart to say what the asterisk means. The 24 and 72 hour totals
always carry one. KL publishes no 3 hour total, so its 37 stations add clock hours for that row and
carry one there too. That sum refuses to answer unless every clock hour has a reading, because a
short sum reads as light rain.

Measured across 230 rainfall stations and five windows: 56.8% of bars come from a feed, 36.8%
carry an asterisk, and 6.4% hold no answer at all.

### The chart carries no threshold mark, and three sources failed to supply one

This chart answers how much rain fell. It never answers how dangerous that is. `rainBars()`
directly above already draws the JPS intensity classes across its plot, and `rainState()` above
that prints the word. The card answers the severity question twice before these bars start.

This design tried three sources for a mark. Record all three, because each one looks reasonable
until somebody measures it.

**A curve fitted between the two published warning levels.** The first draft fitted a power curve
through `spVeryHeavy` at 1 hour and the MET figure of 240 mm at 24 hours. MSMA prices those two
numbers at a 1.7 year event and a 216 year event. They are 2 orders of magnitude apart in rarity,
so a curve through them measures the distance between two unrelated definitions.

**MSMA return periods.** JPS publishes MSMA 2nd Edition Equation 2.2, and its validity range of 5
minutes to 72 hours covers every window here exactly. It is the right instrument and it still fails
on coverage. An IDF curve needs 20 to 30 years of continuous high-resolution record at one spot.
JPS found about 135 such sites nationwide and 12 in this coverage area. Only 11 of 230 stations
stand on one. The other 219 borrow climatology from another place, at a median of 11.1 km and up to
33.5 km, through convective rain beside a mountain range. The constants are sound. The borrowing is
the compromise, and it lands on 95.2% of the chart.

**A station and its own `spVeryHeavy`.** JPS publishes it per station, so this route borrows
nothing. But it is a one hour intensity class. It can mark the 1 hour bar and nothing else, and one
marked bar beside four bare ones reads as though only that window matters.

A dry station draws five flat columns rather than one sentence. The sentence has to name a window, and the
two long ones are exactly the windows a young archive cannot answer. "No rain in
the last 72 hours" on a station whose 72 hour total is unknown is the claim this design refuses to
make. Five columns keep a measured zero and an unanswered window visibly apart.

The full record, including the measurements behind each rejection, is in
`docs/superpowers/specs/2026-08-12-cumulative-rainfall-chart-design.md`.

### Test mode fakes the chart, and shapes it rather than scaling it

A drill has to move this chart too. `soak()` in `js/test.js` is the one door a faked rain gauge
leaves through, so the hour, the day, the status, the graph and the five totals cannot drift apart.
`rainState()` prints `HEAVY RAIN` and `rainBars()` draws the hour, both directly above a 1 hour
column that states the same hour as a number. The three disagreeing reads as a bug in the chart
rather than as a fake. The two callers had already drifted before this. `drown()` hard-coded a
158 mm day where the storm cell applies a multiplier that gives 157.5.

`stormAcc()` shapes the five windows. A violent cell is short, so the 3 hour multiplier falls as the
hour gets heavier. At 75 mm in an hour the 3 hour total is 1.37 times it, because 225 mm in three
hours is a once-in-decades event. At 4 mm/h it is 2.5 times, because drizzle really does run all
afternoon.

The 24 and 72 hour windows take a per-station seed instead. Antecedent rain is the one thing that
does not follow from the hour on the gauge. A station can read 4 mm now after a soaking week.
Another can read 75 mm in the first hour of a dry month. Scaling those two off the hour gave all 198 faked gauges one
silhouette. Nobody could then look at the chart against the two cases it exists to tell apart.
Measured after the change: 183 distinct silhouettes across 198 gauges, and no run of two the same.

That seed is FNV-1a and not the `h * 31 + c` one-liner. Station ids run `rf-153`, `rf-154`,
`rf-156`, so the simple hash put adjacent ids on adjacent values and twenty gauges in a row drew the
same chart. A run of identical charts reads as a pattern rather than as weather.

This app invents that shape, and it may. Nothing in test mode reaches a server, a history file or
another reader. That is the reason the threshold marks could take no invented number and this can.

Test mode fakes the `derived` flags and the measured spans as well. Both reach real data only once
the odometer fills, so without a knob here the asterisk and its footnote ship unseen. A KL gauge carries
the asterisk on its 3 hour column, because a summed one really would.

### The chart replaced the two rows above it

The rainfall card carried a `Last hour` row and a `Today` row. Both are gone. The chart states the
same two numbers, as its `1 h` and `Today` columns, and it states three more windows beside them.

One fact must not get two looks on one card. The rows and the columns read the same fields, so they
agreed or exposed a fault, and nothing else.

They had already exposed one. The test mode section above describes it, and `soak()` became a single
door for exactly that reason. Removing the rows leaves one place to read the hour, and one place to
fix it.

Nothing is lost where a station reports nothing. A gauge with no reading printed `Last hour —`
before, and the chart prints an em dash over an empty column now. Measured on the live payload, one
of 231 rainfall stations carries no `acc` at all, and that station publishes a null hour and a null
day, so both rows were already em dashes on it.

`num()` left `js/popup.js` with those rows. It was the only caller in that file.

### The columns are the full width of their cell

Three changes, all in `.acccol i`.

The bar fills its grid cell. A `max-width` of 22 px held it to about a third of the 58 px cell, so
five thin marks stood in a wide plate. The 6 px grid gap is now the only thing between two columns.

The bar has no rounded top. A 3 px radius on a 58 px column reads as a soft edge on a wide block
rather than as a bar with a cap.

The fill is a gradient in `--k-rainfall`. The section below states the stops, which changed once the
bars took an outline.

The color stays `--k-rainfall`, the kind token. This chart states how much rain fell and never how
bad that is, so a status hue claims something the chart refuses to say.

### The value moved inside the plate

The five totals sat on a row above the chart. They sit inside their own column now, in a strip at
the top of the plate.

A row above the plate asks the reader to carry a number sideways to the bar it belongs to. One
number over one bar is easy. Five over five is the moment that goes wrong, and the two long columns
often print an em dash, so the row and the plate did not even hold the same count of marks.

**`.acccol` reserves the strip with `padding-top`, and padding is the only thing that works here.**
A bar states its total as a percentage height. A percentage height resolves against the content box
of its container. So 16 px of padding shortens the scale of all five bars at once, and the tallest
column fills the 42 px below its own number.

A margin or a shorter plate leaves the percentage measuring the full box, and the tallest bar then
covers its own value. The plate is 58 px: the 42 px of bar this chart has always had, plus the 16 px
strip.

**`position` lifts the asterisk, and `vertical-align: super` does not.** A raised inline box grows
the line box that holds it. Measured, the value box went from 15 px to 17.3 px against a 16 px
strip, and the tallest bar started 1.3 px inside its own number.

That case is the normal one and not an edge case. The 24 hour and 72 hour totals are both derived,
so both carry the mark, and the five windows nest, so the longest of them is the tallest column.
`line-height: 0` takes the mark out of the measurement and `top` puts it back where it looks right.
The value box measures a flat 15 px with the mark or without it.

Measured across four states, with the plate at 58 px and the tallest bar at 42 px: the tallest bar
starts at 16 px and every value ends at 15 px. Nothing overlaps, and every value sits inside the
plate. The four are a live station, a full set of nested windows, a station with two unanswered
windows, and a station reporting no rain in any window.

### The bars took the shape of the line graph, and the grid runs the other way

A card can carry three graphs at once: a level line, a rain area and these columns. The first two
draw a see-through fill under an opaque stroke. The columns filled solid, so one card stated a value
two ways.

`areaFill()` in `js/popup.js` runs 0.6 alpha at the foot of an area and 0.1 at its head, and a solid
stroke rides the upper boundary. `.acccol i` states the same gradient and takes a 1 px border in
`--k-rainfall`. The border stops at the base, the way an area graph strokes its upper boundary and
leaves the axis bare.

`box-sizing: border-box` keeps that border inside the height the bar states. Without it a 1 px line
adds itself to every total, and the tallest column runs into its own value.

**A measured zero now draws its own baseline**, because a border box cannot go under the height of
its own border. That is worth keeping rather than working around.

Five columns exist to hold a measured zero and an unanswered window apart. Before this, both of them
drew nothing at all. The station with two unanswered windows now shows three columns with a violet
base and two with none.

**The grid is horizontal where `rules()` draws a vertical one, and both are right.** A grid marks
the axis that carries the scale. On a line graph that axis is time, and it runs across. On these
columns it is the total, and it runs up.

The grid takes the same `--outline` and the same 1 px as `.spark line`, so the two read as one
family.

The grid sits at the bottom of the plate, in a box 42 px tall. It covers the bars and stops under
the value strip. Four lines land at 0, 10.5, 21 and 31.5. The box ends before a fifth line starts,
so the plot needs no rule along its top edge.

### A utility class carrying a font size beats the size its context passes down

The `24 h` and `72 h` labels drew larger than their three neighbours. `.accx` sets `font-size: 10px`
and every label inherits it. An unanswered label also carried `class="muted"`, and `.muted` declares
`font-size: 12px`. **A declaration on the element always beats a value the parent passes down**, so
the two labels a reader is most likely to question drew biggest.

The class is gone from those labels. It added no colour, because `.accx` already paints all five
`--muted`. The em dash over the column is what says the window has no answer.

`#ignoredList .nm .muted` in `css/base.css` patches the same trap at another site. Read that rule as
evidence rather than as a one-off. Any compact context that sets its own font size needs to state it
on the element, or avoid `.muted` there.

### A rain gauge reporting rain its own total denies

The five nested windows put three sources on one plate, and that made a fault visible that nothing
here had asked about before. The windows nest, so the totals must not fall as the eye moves right.
On 2026-08-14 seven of 147 live gauges broke that order.

The raw JPS detail endpoint settled where the fault sits. Station 878 publishes `hourlyRainfall`
29.5 and `threeHoursRainfall` 20.5 in one response. Nothing here touches either number.

Two different causes hide behind one symptom, and only one of them is safe to act on.

**The three hour total trails.** Station 878 was in live rain. Its odometer and its hourly field
moved together step for step, plus 6.5, plus 9, plus 9. The three hour field sat at 20.5, which is
what the hourly field read ten minutes earlier.

Nothing here can repair a lag. Clamping the column to the one beside it prints a number JPS never
published.

**A gauge sticks.** T.K.P.M SG. KELAMBU read 4.5 mm for twelve straight hours while its odometer
never moved and its daily total read 0. A rolling one hour total cannot hold one value for twelve
hours.

### The odometer is the check, the way a river is the check on a siren

`rainBacked()` in `api.php` asks the second question and publishes `backed`. True where the odometer
rose across the hour the reading names. False where it did not move while the gauge still claimed
rain. Null where the archive cannot answer.

The three do not collapse into two. False is evidence against the reading and null is no evidence,
so a gauge nobody can check keeps what it reports. `sirenBacked()` already obeys that rule, and this
asks the same shape of question on another sensor. `raining()` in `js/util.js` reads
`backed !== false`, exactly as `sounding()` does.

Null covers every KL gauge, because only Selangor publishes an odometer. It also covers a young
archive. Measured on the payload this shipped against: 43 true, 5 false, 183 null.

**The window is the hour the reading names, and a longer one is wrong.** Rain that fell forty
minutes ago and stopped leaves the odometer flat right now, while the rolling hour still carries the
total. Any window wider than the claim calls that live rain faulty. A selftest assertion holds the
case.

`accWindow()` does the reading, so a sparse archive widens the window rather than failing. A wider
window can only add rain, so it can only move the answer toward true. That is the safe direction to
be wrong in.

### What the flag reaches

Three surfaces read it, and the card states it.

`color()` paints an unbacked gauge as a gauge reporting nothing. `atDanger()` needs the reading
backed before the top class can turn a pin red or put a warning on a camera. The rain heat layer
leaves the station out of **both** passes: an unbacked gauge cannot paint, and it must not erase
either, because a reading nobody can stand behind is no evidence that the ground under it is dry.

The card keeps printing the word JPS publishes and loses the colour, which is how the siren block
states a doubted alarm. Under it goes one line: `Faulty signal. This gauge collected no rain this
hour.` The verdict, then one fact. A rain gauge collects rain into a total, so the sentence needs
none of our vocabulary.

Measured on the shipping payload, four pins change colour and no pin changes to or from red. Nothing
stood at the top class that day, so a selftest guards the red path rather than an observation.

`soak()` in `js/test.js` sets `backed: true`. Without it a faked storm on one of those five gauges
draws as a faulty signal, with no pin colour and no blob under it.

**The three hour lag stays unrepaired, on purpose.** Clamping a window to the one beside it invents
a number, and the asterisk covers totals derived from our own archive rather than totals we quietly
corrected. A value we invent is worse than one we can show belongs to upstream, which is the rule
`CAM_FIX` already states about coordinates.

### The rainfall section names its three parts

A rainfall card carries a state block, a 12 hour graph and five window totals. Nothing stood between
them, so a reader had to work out from the shapes that the three measure three different spans of
time. Each part now carries one line naming what it answers: `Right now`, `Last 11 h`, `Totals`.

The middle heading states the span the graph actually covers, not the `SPARK_H` cap. A station
watched for two hours says two hours.

Sentence case, and not the ALL-CAPS of `MODERATE RAIN` under it. That register belongs to a reading.
A heading is furniture.

Each template emits its own heading, so the table popover gets the same structure and the two
surfaces cannot drift. The three early returns in `rainBars()` take no heading, because each already
names its own window in its own sentence.

### The chart marks its own peak

The graph ended with `Peak 60 mm in an hour · last 12 h`. Both halves have moved. The span is the
heading above the graph, and the peak is a mark on the plot.

**That caption was also wrong.** It printed `hi`, the axis maximum, which is the taller of the data
peak and the highest intensity class drawn across the plot. A station peaking at 37.5 mm with the
60 mm class on screen captioned itself `Peak 60 mm in an hour`, a figure no gauge had reported. The
mark reads `hi0`, the peak of the readings.

The mark is a dashed rule down the column, with a `keyboard_double_arrow_up` glyph at the top and
the figure and the clock time in `data-tip`. A `title` never opens on a phone, and `show()` in
`js/sparktip.js` tests `[data-tip]` before `.spark[data-pts]` — so the label wins while the pointer
is on the glyph, and the per-sample readout takes every other column.

**The mark is HTML over the plot and not a shape inside the SVG.** That viewBox carries
`preserveAspectRatio="none"`, and the browser stretches it to the plate. Anything drawn inside it
stretches too. A glyph comes out squashed and a one-unit rule comes out wide.

`.spark` already carries `position: relative` for the axis labels, so a percentage from the same
`x()` the polyline uses lands on the same column.

**The rule keeps the true column and the glyph moves aside at the edges.** Rain peaking right now is
the ordinary case, because the newest sample is the last column, and a centred glyph there hangs
half its width outside the plate. Two classes anchor the mark inward at each end. Only the glyph
moves.

### The peak mark is amber, and it is the one status colour on a thing that is not a status

The mark started grey and the plate swallowed it. The time rules, the class lines and the history
glyph are all `--muted` or near it, so a fourth grey thing read as more furniture.

`--s-alert` breaks the colour rule as written. Two things carry the exception, and a second
annotation needs both of them again.

It marks one point on one graph. It never paints a station, a pin, a table row or a badge — nothing
a reader scans for a verdict, and nothing that feeds a count.

Amber is the one hue this plot does not already use. `RAIN_COLOR` draws the intensity classes across
it in `--k-rainfall`, then `--k-rain-heavy`, then `--s-danger`.

Measured on the rendered card, the three class lines are violet, mauve and red. No class line
shares that hue, so the mark cannot read as one of them. That is the confusion this had to avoid.

### A dry rain graph draws its zeros

`rainBars()` printed `No rain in the last 11 h` whenever every reading in the window was zero. It
draws the readings now.

A sentence about a window makes one claim about the whole of it. This graph holds two facts that
have to stay apart. **A run of measured zeros is a line along the floor. A break in that line is a
station nobody reached.** The segment loop already cuts wherever two readings sit more than an hour and a
half apart, so the plot told the two apart all along and the sentence collapsed them.

The five totals beside it already worked this way. A dry station draws five flat columns rather
than a sentence, for the same reason and in the same words.

Three histories from the live payload check it. An all-zero station draws one segment flat at the
floor, with no class lines and no peak mark. The same station with four hours cut out of it draws two
segments. A raining station draws what it drew before.

**`hi` ends `|| 1`, and that is what lets a dry station draw at all.** With every reading at zero
there is no peak and no intensity class in range, so the axis maximum is zero — and `y()` divides by
it. Every point came out `NaN` and the polyline rendered nothing.

Any positive number puts a zero on the floor. So 1 is the smallest one that reads as arbitrary rather
than as a threshold somebody chose.

A dry station gets no peak mark. `Peak 0 mm/h` names a peak that did not happen, and an
amber mark over nothing is the cry-wolf failure in miniature.

The mark reads `mm/h` and not `mm in an hour`. The per-sample readout on every other column of this
same graph already prints `mm/h`, so three words spelled out what one unit says beside them.

Two sentences remain. Both cover the case with nothing at all to plot: no history yet, and no
reading inside the window. A graph cannot state either of those for itself.

### The Help legend showed a blue pin at danger

A reader saw a station at danger. It drew a pulsing red ring around an icon that was not red.
The map was right. The Help legend was wrong. The legend is where they looked.

`.pin` reads `color: var(--c, var(--accent))`. Every sample in that legend states its own `--c`.
The "at danger" sample did not, so it fell back to the accent blue. A browser measures that pin
at `#1a73e8`. The sentence under it promised the reader it fills red.

`render.js` sets the class and the colour in one expression, `critical ? statusColor(3) : ...`.
So a real pin cannot show the halo and miss the red. That is what makes this fault read as a map
fault. A reader can still tell the two states apart on screen. Only the picture that teaches them
was wrong.

The check is one line in the Verify block. Every `.pin` sample in `index.html` states a `--c`.
A legend is a claim about what the map draws. A claim needs a check that fails when it stops
being true. The same rule caught the "It loads nothing from a third party" sentence in the About
pane.

This work measured three other explanations first and dropped all three. `atDanger()` refuses an
offline station. The map-palette block can omit `--s-danger`. And `.pin.rise` does draw red around
a pin that keeps its own status colour. That last one is deliberate and stays. A forecast is not
a reading.

### The two long rain totals drew a dash for two days

The `#c` odometer series starts the moment somebody deploys the code that stores it. Before that
there is nothing, and no later poll can supply it. So a fresh box draws an em dash under `24 h` and
`72 h` for two days while the archive fills. On this box the series began 2026-08-13 18:30. The
next afternoon it held 20.5 hours, and 1 station of 231 answered the 24-hour window.

A reader asked why. That is the right question to ask of a dash. The chart had no answer for it
anywhere on screen.

`accWindow()` now takes `$partial`. With no sample at or before the far end, it measures from the
oldest sample there is. It reports the span it really covered.

This is the same subtraction it always did, so it still cannot lose rain. The standing rule forbids
a **sum**. A sum drops the rain in every gap and states a small number with nothing to say it is
short. A difference over a shorter span says exactly how short it is.

`derived` became a ladder of three rungs rather than a flag. 0 means the number came off a feed.
1 means this app worked it out over the whole window. 2 means it worked it out over less.

The card prints one asterisk per rung, and `24 h**` carries a footnote saying the records cover less
than the full period. The readout on the column gives the span it did cover.

Neither one names a clock time. An early version printed the hour the records start at, in the
footnote and again in the readout. A reader cut it. The shortfall is the fact that changes how to read
the number, and the hour this particular server first stored an odometer reading is a fact about the
server. `accFrom` still rides on the station, because the chart reads whether it is there. Nothing
prints its value.

`$partial` is false by default, and `rainBacked()` depends on that default. It asks whether an hour
of claimed rain reached the odometer. A window narrower than that hour calls live rain faulty. A
wider window can only add rain, which is the safe way to be wrong. A narrower one is the unsafe
way, so the short answer stays opt-in.

### Two windows answered with one number, and both of them keep it

Both long windows anchor to the oldest sample there is. So an archive 21 hours deep answers 24 hours
and 72 hours with the same 21-hour difference, each marked short, and the two columns draw one number
at one height. On the 2026-08-14 16:20 poll that is 180 stations of 231 — every Selangor gauge that
can answer at all.

This work built two filters to suppress that pair. Both are gone. The reasoning behind them is worth
keeping, because it is the argument against what ships.

The first was a floor in hours. A partial had to cover more ground than the fixed window under it:
3 hours under the day, and 24 hours under the three days. The live payload broke it in one query.
PUNCAK ATHENEUM holds 27 hours of records. Its 24-hour window **widened** to 27 hours, because the
base is the last sample at or before the far end. Its 72-hour window fell **short** to that same
sample. Both published 6.5 mm, and the floor passed the pair. A floor compares one span to a
constant, and the fault is two spans landing on each other. A widened window can meet a short one at
any depth, so no constant catches it.

The second compared the two spans and dropped the longer one. That is the one a reader reversed, and
the reversal is right. Suppression trades a true short measurement for no measurement at all. The
reader asked for the earliest record on both columns with a remark saying the records fall short, and
the remark is already there under the chart. A dash says nothing, and a reader who sees one asks why
— which is how this whole feature started.

Do not build a third filter. Four assertions in `--selftest` hold the behaviour: 23 hours of records
answers both windows over 23 hours, and a 27-hour archive covers the 24-hour window whole while
falling short on the 72-hour one.

A widened window is not a short one, so the pair can carry different marks over one number. PUNCAK
ATHENEUM draws `24 h*` beside `72 h**` at 6.5 mm each. The first covered more ground than it names.
The second covered less. That is two different facts about one subtraction, and the marks are what
separate them.

### An empty column said nothing, and one reason for it is permanent

An answered column has carried a readout since the chart shipped: `24 h · 31 mm · measured over
24.2 h`. An empty one carried none, so a reader who hovers the dash learns nothing at all.

The two long windows subtract two odometer readings. SPHTN publishes no `cumulativeRainfall`, so 38
of 231 rain gauges have nothing to subtract and their two columns are empty forever. The readout now
says so: `Not measured. This gauge reports no running total.` The other three windows come straight
off a feed, and a bare `Not measured.` is the whole of what there is to say about them.

The station carries one new field, `accFrom`, holding the oldest odometer sample it has. Only its
presence matters. A gauge with no running total holds no such sample, and that is the whole test.

There is no second, temporary reason. An earlier version of this text described one — a gauge waiting
for the archive to reach back far enough — and that stopped being true the moment a short window
started answering. Two odometer samples are enough, so a gauge stops being unanswerable on its second
stored reading. Measured on the live payload: of the 184 gauges that draw this chart, 37 carry the
permanent dash and **none** carries any other kind.

The `!from` guard survives for one poll in the life of a server. A fresh `.history.db` leaves a
station holding one sample and no difference. That station does publish a running total, so the
clause is false on it. The guard is there to stop this app saying a false thing for eight minutes. It
is not a state, and it gets no message of its own.

### A short window can undershoot a window inside it

A 24-hour window measured over 20.5 hours still contains today, so it must not report less rain
than today does. On the 2026-08-14 15:45 poll, 4 stations of 180 do. Three are out by 0.5 to
1.0 mm. TAMAN MAYANG is out by 12.5. Its odometer says 25 mm over 20.5 hours and the feed's own
daily total says 37.5.

This app suppresses neither number, for two reasons.

Do not suppress the odometer figure. That trusts the feed's daily total over the odometer, and
those two fields already carry the opposite trust. `rainBacked()` reads the odometer to catch an
`hourly` figure that claims rain the same gauge never collected. The odometer is the reference here,
not the suspect.

The chart has also always drawn windows that disagree. On the same poll, 17 stations report less
rain today than in the last 3 hours. Both sides of that come straight off the feed. It is a larger
contradiction than the short window adds, it predates this work, and nothing here can name the
wrong side of it.

## The camera wall now fits the screen it is on

The "All cameras" dialog carried two pixel caps. It was 1060px wide at most and 900px tall at most.
On a wide monitor it sat in the middle at a size that ignored the screen.

It now takes the viewport, less a 12px inset on every edge. That inset keeps the border and the
12px radius reading as a deliberate edge. The phone breakpoint still takes the last 24px.

The grid stated a column count for each screen width. Five columns, four below 840px, three below
680px, and two below 600px.

A person worked each threshold back from the dialog width, the grid padding and the gaps between
columns. A change to any of those three made the whole table wrong, and nothing reported it.

`repeat(auto-fill, minmax(min(240px, 45%), 1fr))` states the rule once. The browser counts the
columns from the box the grid is in. All three media queries are gone.

The floor went from the old 150px to 240px. The old five columns drew a 155px tile, and a camera
still at that size reads as a swatch rather than as a picture.

The percentage is the phone half of the same expression. A percentage track resolves against the
grid content box. 45% is the widest floor that still leaves room for two columns at any width.

That is what holds a phone at two tiles. A bare 240px floor drops every phone to one column, which
is a long scroll through ninety cameras. Above about 533px of content the 240px is the smaller of
the two, so the percentage never touches a desktop.

The skeleton grid takes the same track sizing and the same padding as the real one. Both grids count
columns the same way now, so the tiles land on the columns the skeleton drew.

Measured in a headless browser. A 2560px monitor draws 9 columns at 267px. A 1920px monitor draws
7 columns at 254px. A 1280px monitor draws 4 columns at 288px.

A 900px viewport draws 3 columns at 260px. Phones from 320px to 430px draw 2 columns, from 137px
to 192px. Every desktop width holds the tile between 254px and 288px.

The wall trades density for legibility. A 1920px monitor showed 11 tiles a row at 159px before this
work and shows 7 at 254px now.

## The station panel said more than it knew

The card printed facts at a precision beyond what it knew. A sensor eleven months dead still drew
a minute hand and an elapsed figure: `Last reported 19/09/2025 12:15 · 7892.0h ago`. Four stations
in the payload are past 6,500 hours. At the other end, `Updated 14/08/2026 15:45` spent ten
characters saying the date was today, which it is on every live station.

One sweep read every rendered string on the panel against one question: does this state more
precision than the fact needs. The sweep cut or trimmed eighteen strings. Nothing moved, no section
collapsed, and no template changed shape.

### One clock, at the precision the age needs

`stamp()` in `js/popup.js` prints the clock alone on a reading taken today and the date alone on one
from any other day. Two callers: `sourceInfo()` for a sensor, `wxDots()` for the weather section.
Elapsed time is gone from both.

Measured over the whole payload: 557 of 679 stations get a clock, 122 get a date, none produce
anything else.

The same-day test is a `startsWith` and not a parse. JPS stamps `DD/MM/YYYY HH:MM:SS` in MYT and
`en-GB` formats a date the same way. So one expression reads both that string and MET's unix
instant. The numeric case takes the feed's own shape first.

**`ago()` was deliberately not fixed.** It has no unit above hours, which is what printed `7892.0h`.
Adding one was the obvious repair and it is dead code. This was its only caller with a value large enough to overflow.
The two that remain are `clip.js`, which ages a camera frame no older than three hours, and
`net.js`, which prints how long ago the last poll ran. Both stay inside the range `ago()` covers, and
seconds are the right precision for the second one.

This reverses a rule that stood in `CLAUDE.md`. It said elapsed time belonged on a stale station
"because on a live one the date is the answer". The live case is the one where the date says least.

### Seventeen more, on the same question

Cut, because the fact was already on screen or was never about the place:

| where | printed | why |
|---|---|---|
| `meter()` | `85% of danger (3.50 m)` | `.mscale` draws `3.50 danger` 20px below |
| `region()` | `basin n/a` | 287 of 679 stations. A gap in the feed, not a fact about the place |
| `region()` | `district n/a` | 0 stations. A branch nothing reaches |
| peak mark | `Peak 12.5 mm in an hour` | the readout beside it already prints `mm/h` |

Trimmed, because the words or the digits outran the fact:

| where | printed | now |
|---|---|---|
| four sites | `2.4 km away` | `2.4 km` |
| `spanText()` | `Last 9.4 h` | `Last 9 h` |
| `gaugeBlock()` | `water is 3.55 m below the gauge marker` | `3.55 m below the marker` |
| `gaugeBlock()` | `water is level with the gauge marker` | `Level with the marker` |
| `rainState()` | `Faulty signal. This gauge collected no rain this hour.` | `Faulty signal. No rain reached this gauge.` |
| `rainAcc()` | `* Value derived from archived readings.` | `* Derived from archived readings.` |
| `rainAcc()` | `** Records cover less than the full period.` | `** Measured over a shorter period.` |
| `blank()` | `24 h · Not measured. This gauge reports no running total.` | `24 h · This gauge keeps no running total.` |
| `etaText()` | `over 6 h away` | `over 6 h` |
| `sirenBand()` | `silent for the last 9 h` | `Silent for 9 h` |
| `herePopup()` | `Accurate to about 250 m` | `Accurate to 250 m` |

`spanText()` rounds **down**, not to nearest. Three surfaces print it: a rainfall heading, a level
graph's caption, a siren's quiet run. Every reader of that number reads it as ground covered, so a
span stated short understates the watch, and a span stated long claims minutes the record never
held. Minutes keep their rounding, because under an hour the whole number is the fact.

`blank()` states one sentence rather than two. `Not measured.` followed by the cause said the same
thing twice, and the permanent case — a KL gauge that publishes no running total and never will — is
better named than qualified.

### What the sweep did not cut

`Faulty signal. No river nearby is high.` is the model for the rest, so it stands.
`No rain in the next 3 hours` keeps its window, because the heading above it reads `Later` and names
none. The three empty-graph lines stay: a graph that has not filled yet, a window with no readings
in it, and a log with nothing logged are three states, and none is inferable from the others.
`0.22 m of water` keeps `of water`, because the bare unit is ambiguous against a river level on a
mast card. Every control keeps its verb.

This sweep leaves `in ~1.4 h` alone, against the writing standard's ban on hedging. The tilde is the coarseness
marker, not a hedge — a straight-line projection off an hour of samples has no business claiming six
minutes, and `in 1.4 h` claims exactly that.

### The sentence-case sweep had missed five

`CLAUDE.md` claimed the UI had been swept for sentence case. Five strings still opened lowercase, all
in `popup.js`: two in `gaugeBlock()` and three in `sirenBand()`. Shortening them fixed every one as a
side effect.

That is the useful part. A line nobody has reworded is a line nobody has re-read, so the strings that
survive a style sweep are the ones no later change happened to touch. Do not trust a past sweep over
a grep.

### One latent bug, named and not fixed

`WEATHER[0].line` is the empty string, and `metSection()` builds its rain sentence whenever
`m.rung != null`. A rung of 0 renders ` until 16:00` — a leading space and no subject. Measured
on the live payload, `met.rung` is 1 on 566 stations, 2 on 54, and absent on 59. It is never 0,
because `metSpan()` in `api.php` returns null when no step in the window is wet. The invariant is
upstream and the guard belongs here, so this entry states the risk rather than coding around it.

## The "You are here" card now carries the weather

The card that answers "what is near me" listed four sensors and a camera picture. It said nothing
about the sky. Every station card above it has carried the MET outlook since the weather section
landed. A reader who taps their own position asks the question a reader who taps a pin asks. So the
card draws the same section now, in the same slot.

### It borrows a station, because the outlook hangs on one

`api.php` attaches the MET nowcast to a station by nearest point. It attaches the daily temperature
by district name. The payload publishes no list of MET points.

So the browser holds nothing to measure a bare coordinate against. A point that is not a station has
to borrow one.

`nearestWx()` in `js/stations.js` picks the nearest station that carries a whole outlook. The card
caps it at `NEAR_MAX_KM` (10 km), the number the four sensor rows above it already state. Past that
cap the card shows no weather at all.

The section names the MET point behind the reading. That point arrives through a borrowed station.
A station further away than any sensor the card lists makes a claim about somewhere else.

Measured on the payload of 2026-08-14, from four points. Kuala Lumpur city centre borrows a station
1.0 km away. Shah Alam borrows one at 3.2 km, Putrajaya at 2.5 km and Sabak Bernam at 0.5 km. No
point comes near the cap.

The stacked error needs a name. `MET_KM` lets a station hold a point up to 16.5 km away, and this
card adds up to 10 km more. A reader at the cap can therefore read an outlook from 26 km off. That
figure is the decorrelation distance for a 3-hour rainfall field. `MET_KM` takes its own value from
the same figure, so the worst case here sits at the edge of the claim rather than outside it. It
also needs both halves at their worst together, and the measurements above say they are not.

### The all-or-nothing gate moved, and that is what makes the pick correct

`metSection()` refuses to draw a half outlook. A heading, a glyph and two numbers under the word
`Now` read as a panel that failed to load. That test is `hasWx()` in `js/util.js` now, and
`nearestWx()` asks the same one.

The two must share it. 643 of 679 stations carry a whole outlook and 36 carry a part of one. A pick
on `s.met` alone lands on one of those 36 about one time in nineteen. The section then draws nothing
while a station a kilometre further holds the whole answer. The reader gets no weather and no
reason.

### Where it sits

Straight after `.pophead`, above the camera picture and the four sensor rows. A station card puts it
there, and the reason holds here too. Rain over a place is one fact about the whole card. It is not
a reading that belongs to one of the sensors under it. `openSide()` lifts `.pophead` into
`#sideHead`, so the section must follow it rather than precede it.

Nothing else about the section changed. It keeps its own ⋮, which states two facts. MET issued the
outlook at that time, and the borrowed station stands that far from the point. Neither number is the
distance from the reader to the point, and the card claims no such thing. The number a reader can
act on sits in the section head, which names the place behind the forecast.

## A browser error reached nobody

Three faults made this site hard to trace. Each one failed in a different way.

`api.php` already caught what it can. `set_exception_handler` logs an uncaught throw. A shutdown
function turns a fatal into JSON a client can parse. That code was right. Its destination was not.

PHP ran with no `error_log` set. Each of those lines went to standard error. A FastCGI server folds
standard error into its own log. That log held about 28,000 lines on the machine here. An uncaught
exception from this app was one line among them.

Most of those lines were one warning, repeated. `session.auto_start` was on, and the session
directory refused a write. So PHP logged two warnings for every request. Each font, stylesheet and
module paid that cost. Nothing in this app reads `$_SESSION`.

The browser reported nothing at all. Twenty modules run in the browser, and five more load on demand.
A throw in any of them left the map half drawn and told nobody.

### What now happens

`.user.ini` sets `session.auto_start=0` for this directory. The noise stops at the source. The file
is per-directory, so it changes nothing for another site on the same server. `api.php` keeps its
`session_write_close()` call. A server that ignores `.user.ini` still needs it.

`api.php` and `log.php` each call `ini_set('error_log', __DIR__ . '/.php-error.log')`. This app now
writes to a file of its own. `__DIR__` finds the correct path on both deploy targets. A committed
absolute path cannot do that.

`js/oops.js` reports a browser error to `log.php`. It listens for three things. An `error` event
carries a throw. The same event in the capture phase carries a file that failed to load. An
`unhandledrejection` event carries a promise nobody caught. `log.php` appends one JSON line per
report to `.client-errors.log`.

### Why the module loads first

`app.js` imports `oops.js` before any other module. A static import runs before the body of the file
that imports it. A handler inside `app.js` therefore starts too late to see a throw from another
module. That case is real. `state.js` reads the saved preferences with `JSON.parse`. Corrupt storage
there throws before the map draws.

`oops.js` imports nothing, so it runs first and listens for the rest.

The capture phase on the `error` listener earns its place the same way. A failed load does not
bubble. A listener without capture sees a throw alone. Herd answers a missing file with `index.html`
and HTTP 200. A wrong path in the module list therefore reaches a reader as a parse error. This is
how that arrives from a real visitor.

### What this deliberately does not use

An error tracking service sells two things above a log file. It groups repeated errors. It maps a
minified stack trace back to the source. The second is worth nothing here. This app has no build
step, so a stack trace already names the file and the line a reader runs.

The first is worth something, one day. The trigger is a log file too large to read. GlitchTip is the
answer then. It speaks the Sentry protocol and runs in four containers.

A hosted tracker is a separate question, and the answer is no for now. The About pane states what
this app sends to a third party. A hosted tracker puts a new third party in the browser. That makes
the sentence false. A tracker on our own machine keeps it true. Read the entry about the CDN grep
before any change to that sentence.

`sendBeacon` carries the report. It cannot throw, cannot slow the page, and survives a closing tab.
The ordinary fetch in `ask.js` does none of those. GitHub Pages serves no PHP, so `log.php` is absent
there and the browser drops the report. That is the correct result on a static host. It needs no test
for the host in use.

### The guards on a public write endpoint

`log.php` writes to disk and anybody can reach it. It takes four guards. It accepts POST alone. It
reads 4096 bytes at most. It refuses a body that is not a JSON object. It stops writing at 5 MB.

The client caps itself at 20 reports per session. One throw inside a loop must not become a thousand
requests. That cap protects an honest reader. The size ceiling answers a dishonest one.

`log.php` records no IP address. The report already names the page, the browser and the stack. Who
saw the fault is not part of the repair.

### The one thing an error tracker does not catch

The scrapers fail silently by design. A layout change upstream yields zero rows and no error. The map
then draws stale water levels under a green status dot. `sources.stale` and the `parsed` counters are
the alarm. This app has published them for months. Nothing rang them.

That failure is an HTTP 200 with valid JSON and no rows. No error tracker looks at it. `watch.php`
does, and it needs no service, no container and no account. The poll cron already fetches the payload
every five minutes and threw the answer away. That answer carries the alarm, so the cron pipes into
`watch.php` now and the check costs one extra process.

`watch.php` reports a change of state rather than a state. A fault every five minutes for a week is
2,016 identical lines, and the alert design standard above rejects exactly that. It skips
`metwarn.parsed`, which reads 0 on any calm day. See `docs/DEPLOY.md` under *Watching it*.

An external uptime service answers one question this cannot. A machine that is off runs no cron. That
failure is the loud one, and a reader meets it on the first page load. Add a monitor when this runs
somewhere public, and not before.


## The siren band frames on the clock

The siren log answered "has this gone off today" for 23 sirens of 212. The other 189 drew a sliver.

Measured on the live payload. 212 sirens. 86 hold no history at all, 103 hold exactly one sample,
and 23 hold two to twelve. The median newest sample is 9.3 hours old.

A siren heartbeats daily, and `.history.db` keys on the reading's own stamp. So an unchanged siren
stores one row however often this app polls it. Every other graph here spans the readings it holds,
because a reading exists only where somebody took it. Framed that way, a one-sample siren has a
window of zero width, and 103 of them drew a single 0.8% sliver against an empty plate.

A state is not a reading. A state exists at every instant. So the band spans the last `SPARK_H`
hours ending now, and the samples colour parts of it. `timeAxis()` takes a `frame` parameter for
this, and the siren band is its only caller.

### A reading holds until the next one

The band used to cut each bar 15 minutes after its sample and leave the rest blank. The argument for
that: an unbroken quiet band across a hole says the siren was silent, in the same shape as a siren
measured silent.

That argument assumed a hole meant lost contact. It does not. This app polls an online siren every
few minutes and stores a row only when the siren's own stamp moves, so a hole is the value staying
put. The reading now carries forward to the next sample, or to now.

The honest residue of the old argument is that polls run on a request, so a quiet stretch can also
mean nobody opened the page. The station stays online either way, and the block above the band says so.

### Three states, and the third one is an absence

| what | how it draws |
|---|---|
| Triggered | a 10px bar in the danger red |
| Idle | a 10px bar in `--outline`, never green |
| Out of contact | a 2px rail in `--s-none` |

A rail and not a bar, because the third one is the absence of a state rather than a state. `--s-none`
is the token this app already reserves for offline and no reading.

**The out-of-contact case needs no flag, and it must never grow one.** `SPARK_WIN` is 12 hours and
`SIREN_STALE` is 48. A siren's last sample leaves the window a day and a half early. Only then does this app call
the station out of contact. Measured: all 65 out-of-contact sirens hold zero history, so the whole band
is rail by geometry. A `hasInfo()` test here states one fact in two places. The copy then drifts from the block
above it.

The band also moved outside the state test in `sensorBody()`. An out-of-contact siren used to get
the block alone, which left the one kind whose whole question is "and for how long" as the one kind
with no timeline.

### Two things the rewrite had to keep

An empty band ships no `data-pts`. `show()` in `js/sparktip.js` takes the last sample at or before
the pointer and destructures it, so an empty array raises a `TypeError` on every pointermove across
the plate. A graph with nothing to say ships no attribute, which is the contract that module already
states for a kind with no status.

The table drops its own guard. `dataTable()` wrapped the call in `m.history?.length`, which is the
right rule for a flood gauge and the wrong one here now that a siren with no samples has something
to draw.

### The caption is gone

It read `Silent for 9 h`, `Last sounded 14:22` or `Sounding since 13:50`. The band states all three.
A rail with no bar on it is silence. A red bar shows when it started. A red bar that reaches the right edge means the siren sounds now. The hover readout names the hour on any sample.

## A graph always draws

The state of the station took the timeline away from three of the four sensor kinds. The flood
gauge lost it almost always.

| kind | stations | drew a timeline | why the rest did not |
|---|---|---|---|
| river | 107 | 104 | 3 hold under two samples |
| rainfall | 231 | 213 | 18 hold none, and 16 of those are offline |
| gauge | 36 | 3 | a gate on `history?.length`, and single-sample history |
| siren | 212 | 212 | fixed one commit earlier |

Even the 3 gauges that drew had a data span of 0.0 h. JPS stamps a batch of them to one time. So no gauge in the payload
produces a data-framed window.

### The clock supplies the window the readings cannot

A window needs two readings to have a width. With fewer than two, `sparkline()` and `rainBars()` now
frame on the last 12 hours ending now. They take the `frame` parameter on `timeAxis()` that the siren
band already uses.

With two readings or more, nothing changed. The axis still spans the readings held, capped at
`SPARK_H`. Two hours of history still draws as two labelled hours.

A graph holding nothing is not an empty box. It draws the plate, the axis and the station's own
marks. For a flood gauge that is the 0.15 m and 0.3 m lines. For a river it is alert, warning and
danger. That is the scale with nothing on it. It answers the question a reader brings to the card.

A lone reading draws as a dash. The viewBox stretches everything inside it, so a `<circle>` comes out
an ellipse. That is the same reason the rain peak mark sits in HTML over the plot.

### Two gates removed, one kept

`sensorBody()` and `dataTable()` each wrapped the gauge sparkline in `history?.length`. That gate is
why 15 gauges drew nothing at all. Both are gone.

`rainAcc()` keeps its `!isStale(s)` gate. It draws five current totals rather than a history, so it
is not a timeline. One gauge in the payload holds 27 mm in an hour stamped last October, and printing
that under a column headed `Today` is the one thing that chart must never do.

### The caption stated the axis

This fault turned up during the rewrite, and it is the larger one.

The caption under a level graph read `lo` and `hi`. Those are the axis. An earlier change grew the
axis to hold every mark a river publishes, so the caption started naming marks as water.

```
T.T.D.I JAYA, SHAH ALAM    caption said 3.42-8.30 m    the river ranged 3.42-5.32 m
```

**102 of 104 river graphs stated a range no reading had reached.** The caption reads `lo0` and `hi0`
now, which are the readings.

`rainBars()` already carried this rule for its peak mark, after the same fault. The peak printed the
axis maximum and named 60 mm on a station that peaked at 37.5. Anything stating a graph's range reads
the data, never the scale.

Two readings or it is not a range. A graph holding one reading or none carries no caption.

### What the rewrite had to guard

`Math.max()` of nothing is `-Infinity`, and it fed both the axis and the mark filter. `reduce()` with
no initial value throws on an empty array, and an empty plot is a real case now. An empty graph ships
no `data-pts`, for the reason the siren band already states.

Measured after the change. All 586 sensors draw a graph. Nothing throws. No `NaN` and no `Infinity`
reaches the markup. All 107 river captions match their own readings.

The two sentences are gone. `Graph builds as readings arrive` and `No readings in the last 12 hours`.
The second was already unreachable, because the server windows `SPARK_WIN` against now and no
delivered sample is older than that.

## The alert head counted one station twice

The panel head read `1 at danger` and `1 rising`, over a list that held one row.

`tier()` puts each station in one tier. `isCritical` wins, so a river at its danger mark and still
climbing is `now`, and the cards draw it once under `HAPPENING NOW`. The chips above those cards did
not follow that rule.

Three of the four already did. `live` subtracts `stale` out of itself. The danger chip and the
sounding chip cannot both match one station, because one reads a river and the other reads a siren.
The forecast chip read `s.rising` alone.

```
wl-201  JAMBATAN S.K.C  status=3  rising=1  ->  tier() says now, chips said now and soon
```

The chip counts a tier now. A river that is at danger and rising is one alert in the head and one row
in the list.

**A chip in that head must count a tier, not a flag.** The flags overlap on purpose. `rising` is a
forecast about a river, and a river can reach its mark and go on climbing. The tier is the answer to
"what does a reader do about this", and the cards are already grouped by it.

The counts still count sensors, and each row is a place. A monitoring station with two rivers over
their marks is two in the head and one row. That is a different question and it is not changed here.

## The wordmark shortens instead of clipping

`KLANG VALLEY FLOOD WATCH` ran out of room and the app bar cut it with an ellipsis. It read
`Klang Valley Flood W…`, which names no place and no app.

The title rail is what is left after the ticker and the controls. The bar centred the ticker between
two rails of equal width when this shipped, and a 1000px screen gave the rail 136px against a title
that wants 279px.

Four rungs now, and the rail picks one:

| rail | drawn |
|---|---|
| 282px and over | Klang Valley Flood Watch |
| 190 to 281px | KV Flood Watch |
| 94 to 189px | KVFW |
| under 94px | the drop alone |

### Why a container query and not a media query

The rail is not the viewport. It is what is left after the ticker and the controls, and both of
those move on their own. Below 600px the ticker takes a row of its own, so the rail widens as the
viewport narrows, from 77px at 601px to 272px at 600px. No viewport threshold can follow that.

The ticker settled this over the next day. It went from `min(58vw, 656px)` to a flat `50vw`, with a
`40vw` candidate in and out beside it, and then to `flex: 1 1 0` under a 300px cap on this rail.
Each move changed the rail at every width above 600px.

Not one threshold here needed an edit, and `title-test.html` stayed green through all of it. A media
query needs all three numbers again on each move.

The last move also fixed the ladder by accident. The rail now stops at 300px instead of taking half
the leftover. The full spelling reaches 900px where a 50% strip only reached 1400px, and a
700px window draws `KVFW` where it drew the drop alone.

`header h1` is the container. `container-type: inline-size` is safe on it, because `flex: 1 1 0`
with `min-width: 0` already takes the width from the flex algorithm and never from the content.

The phone rule that hid the title whole is gone. The container measures what that rule assumed.

### The numbers

Measured at 22px Roboto: the three spellings are 247, 156 and 59px wide. The drop and its gap add
32. Each threshold is the sum plus about 2px of slack. `title-test.html` holds them.

### Two ways this fails with nothing on screen to say so

A threshold set too low draws a spelling wider than its rail, and the ellipsis hides it.

A selector that loses on specificity draws nothing at all, which looks exactly like the bottom rung.
This one shipped for one run. `header h1 .word > span { display: none }` is one class and three
elements. `header h1 .w-sm` is one class and two elements. So it lost, and every width drew the drop
alone. Every selector in the ladder goes through `.word >` for that reason.

`title-test.html` loads the app in an iframe at fifteen widths. It asserts one spelling at a time,
never wider than its rail, and never a longer spelling on a narrower rail. It prints PASS or the
failures. Checked against a wrong threshold, it reports all three faults.

## The map refuses a window under 300px

Under 300 CSS pixels the app draws a full-screen block instead of a map. It states the problem, it
states the two ways out, and it closes itself the moment the width arrives.

```
This screen is too narrow
The map does not fit a window this narrow.
Turn your phone to landscape. On a computer, make the window wider.
The map returns when there is room.
```

### The number is a floor somebody chose, not the point where the layout breaks

Measured before the block existed. The app bar holds together down to 245px. Below that the
document overflows its own width and draws a horizontal scrollbar.

| width | document | overflows |
|---|---|---|
| 300px | 300 | no |
| 280px | 280 | no |
| 260px | 260 | no |
| 240px | 244 | yes |

So 300 blocks 55 pixels of width that work today. Weigh two things before you move it.

A Galaxy Fold cover screen is 280 CSS pixels wide, and it lands inside the block. This is a flood
map, so a reader locked out is a reader with no water levels.

Against that, a map in a 240px keyhole during a flood is worse than a sentence that says to turn
the phone. `NARROW_PX` in `js/config.js` is the one place to change it.

### It is a dialog, and that is the whole design

`showModal()` puts the box in the top layer, which is not part of any stacking context. So it covers
an open About box, the all-stations table and the camera wall. No `z-index` can do that — the same
rule the graph readout already obeys.

`showModal()` also makes the rest of the page inert. Nothing behind the block takes a tap or a Tab.
No `inert` attribute has to travel over the page to arrange it.

### Nothing dismisses it except width

The box carries no close control. A dismiss button hands the reader a broken map and calls it a
choice. Only width repairs a narrow window.

`js/ui.js` refuses the `cancel` event, which is what Escape and the phone back gesture raise. The
media query is live, so the box opens and closes itself. No resize listener runs.

`:root:has(#narrowBox[open])` hides the overflow. The page behind the block is inert, and the
browser still lays it out. So under 245px it drew a scrollbar along the bottom of the block, for a
map nobody can reach.

### Three ways this fails with nothing wrong on screen

A dialog opened over it wins the top layer, and the block covers nothing. A `cancel` that goes
through hands back a broken map on one Escape. A threshold in `js/ui.js` that drifts from
`NARROW_PX` blocks a width that works.

`narrow-test.html` reads `NARROW_PX` out of the source and asserts all three. Checked against each
fault in turn, it reports each one.

The check also records two attempts at the top-layer assertion that do not work. A `showModal()`
call from the check asserts a call this file made. A resize of a live iframe needs a layout, and
headless virtual time supplies no reliable clock to wait on.

The check asserts the property instead. Focus proves the block is modal, and a modal dialog is in
the top layer by definition.

## The national portal becomes the preferred rainfall and river source

The map grows from 338 river and rainfall stations to about 471, drawn from
`publicinfobanjir.water.gov.my`'s own rainfall table and its own station search. The portal is now
the preferred reading for both kinds, ahead of the Selangor API and SPHTN. Every rainfall window —
1 hour, 3 hours, today, 24 hours, 72 hours — answers exactly now, rather than through a summed
approximation.

Three measured faults drove this.

**Kuala Lumpur publishes no running rainfall total.** SPHTN carries no `cumulativeRainfall`, so
`accWindow()` had nothing to subtract for 38 gauges. Their 24 hour and 72 hour columns showed an em
dash on every one of them, always.

**The fallback for those 38 gauges was wrong.** `accHours()` summed one rolling-hour reading per
clock hour. The readings sit a median 46 minutes apart, so most hour boundaries counted about
14 minutes of rain twice. Scored against the 3 hour total Selangor publishes for itself, 14 of 176
stations were out by more than 5 mm, worst 60 mm. `accHours()` is gone.

**Kuala Lumpur's river coverage was 26 of 48.** SPHTN's own water-level table publishes no
coordinate for 22 of its 48 rivers, so nothing here can place them. The portal's own station search
does carry a coordinate, and 22 of the 37 new rivers this change adds are exactly those Kuala
Lumpur rivers.

**The trade accepted.** About 178 rainfall stations change where their number comes from. Each one
showed a reading before this change and shows the portal's own figure after it. A disagreement
between the two feeds is now visible on a station somebody already watches, where before only one
feed's number ever reached the screen.

**Deliberately not built.** Per-station rainfall thresholds from the portal: six stations across
three states all return 10, 30, 60 and 90, and those are constants — `RAIN_STOPS` already hardcodes
three of them. Near-name matching for a station this app cannot place on an equal name: 17
candidates, and no evidence behind any of them. A coordinate this app invents is worse than one it
can show belongs to upstream, the rule `CAM_FIX` already states. `cyearly` as an odometer: measured
flat at 766.5 across a window where 12 mm fell. The three official JPS notice feeds a reader asked
for on 2026-08-14: each needs the alert design standard on its own, and all three held no rows when
measured, so no parser here can yet tell a quiet feed from a moved layout.

## The portal placement passes drew duplicate stations

A whole-branch review found a gap in both new-station placement passes. The KL merge already
refuses a same-kind candidate near a station this app already holds. Neither portal pass did.

The portal publishes an old and a new record for some sites. The gazetteer holds both `Pekan
Banting` and `Pekan Banting (F2)` at one coordinate. `portalKey()` cannot join the two records,
because the `(F2)` suffix only satisfies `gazPlace()`'s other-direction rule.

Measured before the fix: 153 new stations, 79 within 50 meters of a station already held, and 87
within 200 meters. 64 of the 79 published an identical reading. An identical reading proves one
instrument counted twice.

The fix adds `posDupe()`, one function shared by the KL merge and both portal placement passes. It
refuses a same-kind candidate within about 200 meters of a station already held, the same distance
the KL merge already used. Each pass counts its own refusals as `dupe`, beside `placed`, `unplaced`
and `district`.

**Why this mattered.** `js/alerts.js` counts stations, not sites. A duplicated gauge at its top
class adds one to the app-bar number, the icon badge, the document title and the toast. That
widens an alert surface with no design review behind it.

`isIgnored()` also keys on station id, so silencing one twin leaves the other alerting. That breaks
the rule that `PREFS.ignored` is the only alarm-suppression control.

Measured after the fix, on a forced refresh: 62 new stations, 0 within 50 meters of a station
already held, 0 within 200 meters. `pwl-2914401`, the duplicate national record for RS Batu 8, no
longer appears in the payload. The fix leaves `wl-831`, the original Selangor reading, untouched.

## A failed history seed looked the same as a finished one

`seriesParse('')` returns an empty array on a failed request. `seedRebase()` then returns an empty
array too. Zero rows get inserted, and the drip still writes the `histdone:` stamp. The stamp is
right on its own: the drip must not repeat a dead request on every refresh.

But it left no way to tell a failing endpoint from a finished backfill. `hist.seeded` counts
stamps, not rows, so a failing endpoint can drive `seeded` toward the full station count and
`pending` toward zero, the same shape success takes. This is the `graphId` integer-cast fault an
earlier task found, with the detection removed — that one silently left 23% of stations seeded with
nothing.

The fix adds `hist.empty`, a count of stations that carry a `histdone:` stamp but hold no `#c` row
in `.history.db` at all. The query checks the whole table, not the 80-hour window `$odo` loads,
because a station seeded days ago, with no live poll since, looks empty in that window even when
the seed succeeded.

## `gazParse()` accepted a coordinate outside the coverage area

`gazParse()` dropped only a falsy coordinate, `0, 0`. The live gazetteer holds two rows at the
sentinel `-9999.0000, -9999.0000` (`SUNGAI SENTUL AOP6-3` and `AOP7-7`). `-9999` is truthy in PHP,
so `gazParse()` kept both rows. Nothing else bounds a placement: `gazCorroborated()` only checks a
district that already holds three stations, so a sparse district waves a sentinel straight through.

The fix rejects a gazetteer row whose point falls outside `BOX`, the coverage area constant already
defined in `api.php`. The constant orders `BOX` as `[west, north, east, south]`.

`gazParse()` lives in `sources.php`. It reads the constant from `api.php` directly, rather than
keep a second copy — a second copy drifts from the original over time. The Johor row in the
`--selftest` fixture now proves the same check on a real, far-off coordinate, not only on the
sentinel.

## A source flip-flop can put a backwards step into a rainfall running total

A station uses `portalOdo()`'s running total while its source is `portal`. The moment its portal
row goes missing, or arrives with both `hourly` and `daily` null, the accumulation block fell back
to `(float)$s['cumulative']` — the year-to-date odometer JPS publishes, a different scale from
`portalOdo()`'s own running total.

An earlier task held the one-way transition into the portal path. Nothing held the way back out.
The new function `rainScaleHeld()` checks whether the last `#c` write carries a `#d` write at the
same timestamp, which only happens inside the portal branch. When it does, the accumulation block
holds the last `#c` value for one poll, instead of writing the raw cumulative figure.

This fault is latent today: zero backwards steps measured. But one backwards step nulls every
accumulation window on that station for up to 72 hours, since `accWindow()` treats a falling
odometer as a reset.

## The JPS notice feeds join the warning surface

Three more pages at `publicinfobanjir.water.gov.my/ramalan/` now reach the map: the JPS flood
forecast, the JPS mirror of the MET bulletins, and a link to the JPS media statement page. A reader
asked for all three on 2026-08-14. The repository deferred them that day, because every page held no
rows. Measured again on 2026-08-17, two of the three held real data.

### The MET warning source sat seven days dead, and every counter stayed quiet

`api.data.gov.my/weather/warning` held 7 rows on 2026-08-17. Every row carried an issue stamp of
2026-08-10. Most had expired by 2026-08-13. `sources.metwarn.parsed` read 0, and that number was
correct: the geography filter was right to refuse warnings about Phuket that were a week old.

Nothing in the payload said the source itself had gone quiet. The map looked calm because the feed
was calm, not because the weather was.

**`metwarn.parsed` almost lost the meaning that reading depends on.** An early draft of the merge
counted the merged `warnings` array under that key instead of `metWarnings()`'s own output. The JPS
mirror keeps that number above 0 on its own, so a merged count hides exactly the outage this section
describes. `metwarn.parsed` counts `api.data.gov.my` alone now, so the existing rule in `CLAUDE.md` —
zero there, and only there, means `data.gov.my` moved something — still holds.

The JPS mirror of the same MET bulletins answered the morning of 2026-08-17, with rows issued at
08:21 and 08:31. Two of them named the waters of Selangor, each valid from 08:00 to 12:00. A poll
that afternoon read `sources.jpsmet.parsed: 3`, once the feed had churned to a third row. After the
geography filter and the merge, `warnings` held 1 row: the live Selangor warning `metWarnings()` had
never seen, because its own source had stopped moving three days before.

### One array, two sources, and a duplicate no exact key can catch

`api.php` now merges three producers into one `warnings` array: `metWarnings()` for
`api.data.gov.my`, `jpsMetWarnings()` for the JPS mirror, and `floodAlerts()` for the JPS flood
forecast. Every row from every producer carries the same seven fields: `title`, `text`, `from`, `to`,
`fresh`, `kind` and `src`.

The merge does not pick one source over the other. It keeps both running, sorts every row newest
first, and drops a row whose lowercased `title` and `text` match a row it already kept. Either source
can go quiet on its own, the way `api.data.gov.my` just did. The merge survives that, because it
never depends on one source alone.

**`jpsmet.parsed` reading 3 beside `warnings` holding 1 row is not a contradiction.** Each `parsed`
counter states what its own source yielded, before the merge removes anything. `jpsmet.parsed`
already names three rows that passed the geography filter — that filter runs inside
`jpsMetWarnings()` itself, so it has done its work before `count($warnJps)` is ever taken.
`warnings` names what is left once `mergeNotices()`'s cross-source duplicate test runs on top of
that. The 3 to 1 reduction here is the duplicate test alone. A reader who checks only one of the
two numbers will misread the other.

`mergeNotices()`'s duplicate key cannot join the same bulletin worded two ways. JPS writes "SECOND
CATEGORY WARNING ON STRONG WINDS AND ROUGH SEAS" in capitals. `data.gov.my` writes "Warning on Strong
Wind and Rough Seas (Second Category)" in sentence case for the same event. An exact key cannot
match those two strings, so a reader can meet one bulletin twice while both sources carry it. That is
the accepted trade. A fuzzy key invents its own match, and a wrong join hides a real warning behind an
assumed duplicate. That failure is worse than showing one warning twice.

The exact key still earns its place inside one source alone. Measured on the morning of 2026-08-17,
`met_gelora.json` held two rows naming the waters of Selangor. Measured the same afternoon, it held
three byte-identical rows, and `mergeNotices()` collapsed them to one. The feed churns within a day,
so a row count taken once is a row count taken once.

### Paragraph-level geography

`met_gelora.json` can carry a bulletin for the whole country in one row. Measured on 2026-08-17: one
row held 1,795 characters across 16 lines, naming Sarawak, Sabah, Selangor, Perlis, Kedah and Perak
together. The row-level place test in `metWarnings()` already kept a row like this on the single word
`selangor`. The panel then printed a wall of text that was mostly about Borneo.

`hereParts()` in `sources.php` splits the text on sentence and line boundaries. It keeps only the
parts naming somewhere this map covers, then rejoins them. On the measured row that reduced 1,795
characters to one 203-character sentence. The gate itself did not change: `hereNames()` still tests
the combined English and Malay text, so every row that used to survive still survives. Only what the
panel prints narrows.

### `sources.old` beside `sources.stale`

`sources.stale` already named a page that did not answer at all. It cannot name the fault this work
found, because `api.data.gov.my/weather/warning` answered every time. `sources.old` is the new
signal. It names a page whose newest row is older than a maximum age set for that source.

That test cannot live inside `pageHasData()`. That function decides what kind of document arrived. A
failure there discards the stored copy and pushes the next retry back by a full `SCRAPE_TTL`. A
week-old MET bulletin is a real bulletin, not a broken fetch, so `noticeOld()` runs as a separate
check, after `pageHasData()` already accepts the page.

Five page keys carry the two JPS notice feeds:

| key | role | TTL |
|---|---|---|
| `jps-flood` | the flood forecast, `getdisse.php` | 300 s |
| `jps-rain` | continuous rain | 900 s |
| `jps-storm` | thunderstorm | 900 s |
| `jps-sea` | strong wind and rough seas | 900 s |
| `jps-beat` | heartbeat only, `met_cyclone.json` | 900 s |

`jps-flood` takes the shorter TTL, because it is the only true flood alarm among the three feeds this
work adds. `jps-beat` never reaches a screen: `met_cyclone.json` carries a row at all times, and it
read `No Advisory` on 2026-08-17. `WARN_DROP` already discards that phrase. The file exists so
`beatDead()` has something to test. An empty or unreadable heartbeat marks the whole JPS MET mirror
old, which is the only liveness evidence `jps-rain` has on the days it legitimately holds nothing.

Measured on 2026-08-17: `sources.old` read `["met-warn"]` and `sources.stale` read `[]`. A cold
rebuild of the payload, with every page cache expired, took 13.7 seconds. A warm poll took 0.08
seconds.

### Three withdrawal codes, and why the validity window already retires an alert

`getdisse.php` publishes eight notification codes. `floodAlerts()` keeps five: `NT_7D` (Early),
`NT_2D` (Final), `NT_UP` (Update), `NT_DF` (Siren) and `NT_MET` (Meteorological). It drops `NT_TM`
(Termination), `NT_RC` (Recall) and `NT_NF` (No Flood).

The three dropped codes are withdrawals. Every surface here already renders a notice only inside its
own validity window. An alert that has ended leaves the panel on its own, once `$now > $to` fails the
window test. A withdrawal row only restates that fact. It also arrives alone whenever the alert it
withdraws has already expired by the next poll.

### `--k-notice` is its own token, not `--k-river`

A JPS flood forecast is a claim about an area, not a station reading. `--k-weather` and
`--k-source` already exist for exactly that reason. `NOTICE_KIND.flood.c` must not borrow the
colour of a station. Before this pass it pointed at `--k-river`, the colour a river gauge reading
uses.

The hue of `--k-notice` sits closer to `--k-river` than any other pair in the palette. Saturation
and lightness carry the separation, not hue angle. `--k-river` reads `#3a88ff` on light and
`#66b2ff` on dark. `--k-notice` reads `#2f6690` on light and `#6fa8d8` on dark. This choice is a
judgment call. It does not come from the contrast passes the rest of the palette went through.
Write it down here so a reader does not have to reconstruct it.

### The flood card draws first

A JPS flood forecast is a stronger claim than a MET weather forecast. Its card must draw above the
weather card in the alert panel. `js/alerts.js` builds the cards by iterating
`Object.entries(NOTICE_KIND)`. The insertion order of that object is the mechanism, so `flood` sits
before `weather` in `NOTICE_KIND`. Reordering the object reorders the panel.

### `TEST_FLOOD`

`getdisse.php` has never returned a row. So no real payload today shows the Flood Alert heading,
its glyph, its rule colour, its ticker tile or its modal head. `js/test.js` fakes one through
`TEST_FLOOD`. `CAM_EVERY` already carries the same argument for the camera warning path: anything
that alerts needs a knob in test mode, or it ships unseen.

### The media statement becomes a link, not a parser

`publicinfobanjir.water.gov.my/ramalan/pernyataan-media/` is a list of PDF documents, not an alarm.
It fails the alert design standard on that alone: it carries no severity, no urgency, and nothing to
withdraw.

The alert design standard cites the milling literature: a reader confirms a warning across channels
before acting on it. An outbound link is what that reader needs. It is the whole of what a document
list can honestly give. The About dialog now carries one link to the page, beside the `HOTLINES`
directory. There is no parser and no payload field for it.

### Not built

- **Siren backing from `NT_DF`.** JPS publishes an official siren notification, stronger evidence than
  the current rule in `sirenBacked()`, which looks for a river at its Amaran mark within 5 km. This
  work leaves it out, because it changes `sirenBacked()`, which drives `sounding()`, `isCritical()`
  and two reds on the map. That change goes through the alert design standard on its own.
- **POI geometry.** `getdisse.php` carries map geometry for each alert. Nothing plots it, so nothing
  here parses it.
- **A flood-alert count.** The same rule that keeps a MET warning out of every count keeps this out. A
  notice is a claim JPS makes about an area. A count is a claim this app makes about a sensor.
- **A reader-facing staleness notice.** `sources.old` reaches `watch.php` and no screen. The merge
  already protects a reader: a reader keeps seeing rows from whichever source is still alive.

### Open risk

`floodAlerts()` has never seen a row. `getdisse.php` answered `[]` on every fetch made during design.
The field names come from the consumer JavaScript JPS publishes on its own page. That is evidence,
not a guess, but nobody has tested the parser against real data yet. The first non-empty response is
the moment to check it by hand.

This work also surfaced a false positive it did not cause and does not fix. Before this work,
`data.gov.my` was the only warning source this app had, and it had published nothing for seven days.
No row reached the geography filter at all, so the fault stayed invisible. The JPS mirror delivers
rows now, and on 2026-08-17 the ticker carried a sentence naming "Northern part of Phuket, Northern
Straits Of Melaka, Southern Straits Of Melaka, Northern Reef South, Southeastern Reef North and
Labuan". None of that sits inside the area this map covers. `WARN_SEA_FAR` at `sources.php:709` cuts
only `northern straits of melaka` before the keep test runs. MET also writes `Southern Straits Of
Melaka`, which still matches `WARN_SEA_KEEP`'s `straits of melaka`. `CLAUDE.md` already documents this
exact fault for the northern phrase. This is the same fault at the southern site. See the gotcha list
in `CLAUDE.md` for the fix this leaves open, and why it stays out of this change.
