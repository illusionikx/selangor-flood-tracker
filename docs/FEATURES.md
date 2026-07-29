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
gauge print no time at all. Elapsed time is appended only when the station is offline or stale; on a
live one the date is the answer and `· 4m ago` is padding. Seconds are dropped for display by
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
a low reading.

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
region, distance from you, meter or state block, sparkline, nearest-webcam button. Sorted
nearest-first when a location fix exists, otherwise sirens then closest-to-danger. Clicking flies
to the station, ripples over it, and temporarily un-hides its layer if switched off.

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
webcam's picture (see below). Errors report the real reason.

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

| age | kept | frames in the matching scrubber range |
|---|---|---|
| ≤ 6 h | every frame | — |
| ≤ 24 h | one per 30 min | 48 |
| ≤ 7 days | one per 3 h | 56 |
| ≤ 30 days | one per 12 h | 60 |
| ≤ 1 year | one per week | 52 |
| older | deleted | — |

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

**A tick strip under the scrubber: one mark per frame, all the same mark.** It was built with two
heights — a taller one on each new day — which laid a second, coarser grid over the frames and left
the strip saying two things at once. Since the window is thinned to the range's own step, the frames
*are* the graduation: the marks are evenly spaced by construction and one mark is one picture. That
is the whole legend, and it needs no key. Only "now" is different, wider and accented, because it is
the one mark that is not an archived frame.

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

`js/ticker.js`, `#ticker` in the header, left of the status chip. Everything currently on alert,
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
- **Fixed width, not content width.** `flex: 0 1 min(58vw, 656px)`. Sized to content the strip grew
  and shrank with the number of alerts, so the header re-laid itself out on every poll and the bar
  was a different shape in a flood than on a calm day. It is a window onto the news; a window does
  not change size with the news.
- **Speed scales with the count.** One lap has to show everything, so a fixed pace means waiting a
  minute to find out whether your river is on the list when 40 stations are up. `pace()` ramps
  `PX_PER_SEC` from 45 upward once the count passes `FAST_FROM` (5), capped at 2×: past that the
  names stop being readable and the ticker is just motion.
- **Fades, not hard edges.** 56px `mask` ramps on both sides, so items dissolve rather than being
  guillotined by the box, plus 10px of its own margin before the status chip — the strip is always
  mid-item at its right edge, and an item dissolving up against the chip reads as the two colliding.
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

## Gauge state block, and the siren band

Two gaps in the popup, both about a station carrying a status nobody printed.

**A flood gauge now says its state in words**, in the same `.state` block a siren and a rainfall
station use — `DRY GROUND` / `WATER ON GROUND` / `WATER RISING` / `FLOODED`, with `OFFLINE` taking
the block over when the reading is stale. The gauge was the last kind whose state you had to infer
from a number and a bar: "0.22 m of water" is a fact you interpret, and the bands are the server's
own thresholds (0.15 m warning, 0.3 m danger) so the words, the pin colour and the status code
cannot disagree. Water present but below the warning mark gets **no tone at all** — it is neither
the green of dry ground nor a warning, and a couple of centimetres does not earn either.

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

**The colour is `--me`, a hazard yellow** — `#b87b00` on the light theme, `#ffbb1a` on the dark,
both clearing 3:1 on their basemap. It is the one mark on the map that is not a reading, so it gets
the one hue a reading never wears on its own. *Noted, not resolved:* yellow is also the alert rung of
the traffic light, and the colour language reserves that ramp for status. What keeps this from
reading as "an alert, here" is the shape and only the shape. If it ever does read that way, the fix
is the hue, not the pin.

One colour for all of "you": the pin, the accuracy circle, the arrival ripple and the badge on the
card. The circle and the ripple reach it through classes (`.mecircle`, `.ping.me`) rather than
Leaflet's path options, which are SVG presentation attributes and cannot resolve a token.

Its four predecessors, in order: a blue disc with a person in it (a station, as far as the map was
concerned), a bare outlined person (clipart on a map), a filled `near_me` arrow (a heading we do not
have), and a `my_location` crosshair (correct, and invisible next to the river blue).

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

## Both panels leave a peek of map, and both close from their outer edge

At phone width the drawer and the station panel each covered the screen. A panel that covers the map
completely reads as a new page, and the only way out was a control in a far corner — the × at the top
of `#side`, and for the drawer the hamburger in the app bar, which is not on the panel at all.

Both are now **84vw**, so a strip of map stays on screen beside each one. That strip is 58px at
360px, and it does two jobs: it says the map is still under there, and it holds the hide tab.

**The tab is on the edge where the panel meets the map** — `#barTab` on the drawer's right,
`#sideTab` on the panel's left. That is also the edge a dismissing swipe starts from, so the button
and the gesture are the same place. **It runs at every width**, not only on a phone: on a desktop it
is a close control at the seam instead of only in a far corner, and the panels already slide the same
way there, so it is the same rules with different offsets.

It is fixed to the **centre of the viewport** — `top: calc(50% - 30px)` against its 60px height — so
it holds still while the panel behind it scrolls. It is a **`--hover` grey plate with an accent
glyph**. A solid accent tab was tried first and was the loudest thing on the map, competing with the
status colours — the only hues on this page allowed to demand attention. The accent on the glyph
alone still reads as a control, and the shadow draws the plate the same way every other floating box
here is drawn.

Each tab is `position: fixed` and a **sibling** of its panel, not a child: `#bar` and `#side` both
scroll, and a child that sticks out of a scrolling box is clipped. The glyph is `expand_more` rotated
a quarter turn, because there is no chevron mask and one rotation costs less than two more icons.

**Swipe to dismiss** — `swipeOff()` in `js/ui.js`, touch events only. A mouse has the tab and the ×,
and a drag with one is a text selection.

*Two things it has to get right.* **The first 8px decide the axis**, and nothing moves before that:
both panels scroll vertically, and a swipe that stole a scroll would cost more than the swipe is
worth. A drag that starts on a range input is skipped outright, so the heat opacity slider keeps its
own. **The drag is written to the `translate` property, not to `transform`.** Both the panel and its
tab already carry a `transform` that places them — the open/shut slide, and the tab's offset by the
panel width — and an inline `transform` would throw that away for the length of the drag. `translate`
is a separate property that composes with it, so the finger only ever adds to where the box already
is. Every rule that transitions `transform` on these three elements transitions `translate` too, and
that is what carries a half-swiped panel home.

Released under a third of the panel's width, it goes back. Past that, it closes through the same
close path the tab uses, so nothing has a second way to shut.

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
the end of the drawer chained to the document and carried the whole page up with it, tab included.
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
panels now take `height: calc(100dvh - var(--hdr))`, and the tab is centred on `50dvh` rather than
`50%` for the same reason — on `50%` it was centred on a screen taller than the one in front of you
and sat low. `dvh` is the viewport as it stands, and it follows the bar in and out. `#dataBox`
already used the unit; this is the same rule, applied to the rest of the furniture.

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
