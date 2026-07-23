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

**A phone lands on the map and nothing else** — drawer shut, alert panel collapsed to its tab,
whatever the saved preferences say. At that width each of them *is* the screen, so restoring a
saved-open one hands the user a panel where they expected a map. Neither is remembered
(`remember: false`), so the preference survives for the desktop visit that set it. The alert panel
still springs open by itself when something *becomes* an alert — that is news, and news is worth the
space; a list that was already there when you arrived is not.

**Location** — auto-located on landing (view untouched) purely to enable proximity sorting;
clicking the button recentres and opens a "You are here" popup listing the nearest water level,
rainfall, siren and gauge with one meaningful number each, plus the nearest webcam. Errors report
the real reason. *Known trade-off:* prompting on load risks Chrome auto-blocking the origin — the
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

**165 frames survive per camera** at steady state (the test prints it), so at a 245 KB source average
that is **~3.7 GB** on disk for all 90 — and *flat from year one*, because the last tier deletes as
fast as capture adds. ~1.6 GB if `SHOT_W` dropped to 1024. Download from JPS is
unchanged either way (~1.1 GB/day): the full original is always fetched, the choice only affects what
is kept. Lowering `SHOT_W` is a one-line change and roughly halves the archive.

### Retention

`SHOT_TIERS` in `shots.php`, applied on a frame's **age**, so a frame thins itself as it gets older
rather than being filed once and forgotten:

| age | kept |
|---|---|
| ≤ 6 h | every frame |
| ≤ 24 h | one per 30 min |
| ≤ 7 days | one per 6 h |
| ≤ 30 days | one per 12 h |
| ≤ 1 year | one per week |
| older | deleted |

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

**Named ranges, not a free zoom** (6 h / 24 h / week / month / year). The retention tiers mean the
archive *is* a set of fixed resolutions, so a continuous zoom would promise detail that is not on
disk between the stops. These are the stops.

The live still — the image the lightbox was opened on — sits one past the end of the scrubber. It is
not in the archive, but on a timeline it is simply the newest thing there is. Playback skips it: it
is a different image at a different resolution, and a full-size JPEG flashing in at the end of a run
of WebP reads as a glitch. Playback loops, because a 12–60 frame clip is under 20 seconds and
stopping dead means pressing play again to see it.

Changing range warms the whole window with `new Image()` — at most ~60 frames off local disk, served
`immutable`. The alternative is a scrubber that stutters on every drag, which is the one interaction
this feature exists for.

The bar is **hidden entirely** unless the archive holds at least two frames. A disabled scrubber over
a single frame explains nothing its absence doesn't — and that is also what the static GitHub Pages
build gets, where there is no PHP to have stored anything. The camera id is read back out of the
image URL (`?cam=<n>`) rather than threaded through two call sites in markup: its absence is exactly
the condition under which there is no archive to offer.

### A/B compare

One toggle. On, the **oldest frame in the selected range** is laid over the scrubbed one and clipped
to a draggable divider, each side labelled with its own time — so widening the range widens what
"before" means, which is the whole reason the ranges exist.

Both frames come from one camera and share an aspect ratio, so matching `height: 100%` lines them up
on both axes; no measuring, no resize listener. That survives the `SHOT_W` change too — frames
captured at 1024×576 sit in the archive beside new ones at 1280×720, and both are 16:9. The drag is on the **whole stage**, not the 2px
divider, because a 2px drag target is a target nobody hits on a phone — pointer events, so mouse and
touch are one path. While compare is live, a click on the picture no longer closes the lightbox
(`#lightbox.cmp`): there, a click on the picture is the start of a drag.

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
- **Rain cycles all four of JPS's intensity classes** (4 / 18 / 42 / 75 mm an hour → light,
  moderate, heavy, violent), so the rainfall heatmap shows its whole ramp rather than one colour
  repeated, and the popup gets all four wordings. `status` is *set*, not left to be derived: the
  client never recomputes it — the pin colour, the popup's band and the heat weight all read that
  one field — so a fake that moved only `hourly` would contradict itself.
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

**Phone popups are a device-wide sheet whose foot sits just above the heat legend.** On a phone the
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
