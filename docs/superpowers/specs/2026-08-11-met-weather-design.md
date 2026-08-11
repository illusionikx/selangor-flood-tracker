# MET weather on the station card — design

Date: 2026-08-11
Status: approved, ready to plan

## Problem

This app measures water. It holds 232 rain gauges, 106 river stations and 36 flood gauges. Every one
of those numbers describes what already happened. A gauge reports rain after the rain falls.

A reader who opens a station card wants to know one more thing. Is more rain coming here.

Nothing in the payload answers that. The `rising` flag forecasts a river level, but it forecasts from past
samples of that river. It cannot see a storm that has not reached the catchment.

MET Malaysia publishes the answer as a free web page. This design brings it in.

## What MET publishes

Two products, from two hosts. Both come from MET Malaysia. Neither needs a key.

### 1. The nowcast — `https://www.met.gov.my/nowcasting/`

One HTML page. The page renders a Leaflet map on the server. The data sits in 294 `L.marker(...)`
calls in the source. There is no second request to intercept.

Each marker carries a place, a coordinate, an icon class and a popup. The popup holds **seven
values**:

```
Sekarang: Hujan                 value 1 — now
Ramalan pada:
  03:10 PM: Hujan               value 2 — in 30 min
  03:40 PM: Hujan               value 3 — in 60 min
  04:10 PM: Hujan               value 4 — in 90 min
  04:40 PM: Tiada Hujan         value 5 — in 120 min
  05:10 PM: Tiada Hujan         value 6 — in 150 min
  05:40 PM: Tiada Hujan         value 7 — in 180 min
Tarikh kemaskini : 11/08/2026 02:40 PM
```

Seven half-hour steps. Each step holds one of three rungs. The rungs are `Tiada Hujan`, `Hujan` and
`Hujan Lebat`. The icon class states the same rung as the first value. The classes are `cerahIcon`,
`hujanIcon` and `hujanlebatIcon`.

The page carries no temperature.

### 2. The daily forecast — `https://api.data.gov.my/weather/forecast/`

One JSON call. Free, no key, sourced from MET. The endpoint returns a 301, so the fetch needs
`CURLOPT_FOLLOWLOCATION`. The national portal already needs the same option.

`?filter=<YYYY-MM-DD>@date` cuts the response from 585 KB to 103 KB.

One row per location per day:

```json
{ "location": { "location_id": "Ds057", "location_name": "Petaling" },
  "date": "2026-08-11", "min_temp": 24, "max_temp": 34,
  "morning_forecast": "Tiada hujan", "afternoon_forecast": "Ribut petir di beberapa tempat" }
```

Location ids come in three tiers. `Ds###` is a district. `St###` is a state. `Tn###` is a town.
This design reads the district tier only.

`min_temp` and `max_temp` are a **forecast for the day**. MET publishes no free observed temperature.
The town pages carry the same forecast at 165 KB per town.

## Scope

The feature adds one section to the station card. It adds nothing else.

**Not built, and each for a stated reason.**

- **No alert surface.** `isHot()`, `isCritical()` and `atDanger()` do not change. The alert panel, the
  icon badge, the ticker, the toast and every pin colour stay as they are. Any alert built on rain
  that has not fallen goes through the alert design standard first.
- **No map layer.** A weather layer sits beside the rainfall heatmap and disagrees with it. MET
  can say rain while a JPS gauge 2 km away reads 0 mm/h. The screen holds no way to explain the
  difference.
- **No history.** The nowcast is a projection. `.history.db` stores readings. A stored projection
  invites somebody to graph it against the readings. The two are not the same kind of number.
- **No interpolation.** See *Why nearest point* below.
- **No day parts.** The forecast call also returns morning, afternoon and night text in Bahasa. This
  design reads the two temperatures and drops the rest.

## Why nearest point

Each station takes the value of the single MET point nearest to it. This is Thiessen assignment. It
is the same thing as a Voronoi tessellation over the MET points, because a Voronoi cell holds exactly
the area nearer to its own seed than to any other. The polygons are therefore not built. `argmin`
over 294 points gives the identical answer in three lines.

The literature ranks kriging above inverse distance weighting above Thiessen for areal rainfall. Each
of those comparisons interpolates millimetres. MET publishes a **category**, not a quantity. An
average of `Tiada Hujan` and `Hujan Lebat` is `Hujan`, which is a reading MET never made. Thiessen is
the only one of the three methods that carries the published category through unchanged. Kriging also
needs a dense network to fit a variogram. The 39 points in use over 13,000 km² are not one.

### The cutoff is 15 km, and the reason is the time window

A MET point speaks for a station only within `MET_KM`, which is 15 km. Beyond that the station gets
no weather section.

The number comes from the rainfall decorrelation distance. That distance grows with the length of the
measuring period. Published figures put a 10-minute field at about 7.8 km and a 3-hour field
at about 26.5 km. An instantaneous convective cell is tighter still, at 1.5 to 2.8 km.

This design states a claim about a **3-hour window**. So the 3-hour figure governs, and 15 km sits
well inside it. Tropical rainfall also correlates more strongly in space than the temperate fields
those studies measured, so 26.5 km is a floor here rather than a ceiling.

Note what this means for any future change. A line that claims rain **falls at this moment**
needs a much tighter radius, near 3 km. Do not reuse `MET_KM` for one.

### A cell-scaled cutoff fails

This design also measured a cutoff taken from the local Voronoi cell size. That rule scales the wrong
way.

```
MET point spacing:  min 0.1 km   median 5.8 km   max 39.4 km

coverage of 679 stations
  cell rule, 0.5 × spacing    258  (38%)
  cell rule, 1.0 × spacing    478  (70%)
  cell rule, 1.5 × spacing    590  (87%)
  fixed 15 km                 626  (92%)
```

Sabak Bernam sits in a 28.5 km cell. The cell rule therefore accepts a station 22.8 km from its point.
That is the weakest claim on the map, and the rule admits it because MET built nothing nearby. Central
Kuala Lumpur holds points 0.1 km apart, which are two MET offices and a convention centre. There the
cell rule silences stations 3 km from a point, in the area where the reading is most reliable.

Point density records where MET chose to build. It says nothing about weather. The width of a storm
cell bounds the claim, and that width does not change when somebody installs an instrument.

### The points are not filtered by area

All 294 markers parse. The 15 km test decides which ones speak.

A geographic filter adds nothing. No MET point outside the coverage box lies within
15 km of any station, so filtering to the box and keeping every point both cover the same 626
stations through the same 39 points. Keeping every point removes a constant. The day JPS adds a
station near Tanjung Malim, a Perak point qualifies with no box to widen.

## The join

### Nowcast — by distance

For each station that has a coordinate, find the nearest MET point. Accept it at or under `MET_KM`.
Coverage is 626 of 679 stations, which is 92%. The 53 stations left out sit 15 to 27 km from any
point, in the Sabak Bernam paddy and on the Hulu Selangor edge. Those stations print no weather
section.

### Temperature — by district

The forecast rows key by district name. `api.php` already normalizes `district` to Title Case, so the
join needs no coordinates and no radius.

620 of 679 stations match a district row directly. The 13 districts that miss are Batu, Kepong, Bandar
Tun Razak, Setiawangsa, Bukit Bintang, Seputeh, Titiwangsa, Cheras, Segambut, Wangsa Maju, Lembah
Pantai, Pandan and Ampang. Every one of them carries `state = Kuala Lumpur`. They are constituencies,
and MET publishes one `Kuala Lumpur` district for all of them.

One rule closes the gap. A station whose `state` is `Kuala Lumpur` takes the `Kuala Lumpur` district
row. Coverage then reaches every station that has a district.

Match on `state|district`, not on district alone. District names repeat across states, which is why
`dkey()` exists in `js/util.js`.

## Fetch and cache

Both fetches go through `fetchAll()`. Never use `file_get_contents()`.

`metNowcast()` and `metForecast()` are new functions in `sources.php`. They sit beside the two
scrapers already there.

| product | cache | reason |
|---|---|---|
| nowcast | `page` table, `SCRAPE_TTL` (15 min) | MET stamps the product at :10 and :40 |
| forecast | `page` table, `MET_DAY_TTL` (6 h) | the values change once a day |

Both use the `page` table of `.history.db`, the same as the two scraped feeds. A failed fetch falls
back to the stored copy.

The nowcast carries its own stamp in `Tarikh kemaskini`. A stamp older than `MET_STALE`, which is
2 hours, drops the whole nowcast. An old projection is worse than none. This is the rule that makes an
offline gauge render grey instead of steady.

## The payload

One object per station. `api.php` omits it when it has nothing to say.

```json
"met": {
  "at": "Shah Alam", "km": 3.1,
  "now": 0, "rung": 2, "from": "16:10", "to": "17:10", "open": false,
  "tmin": 24, "tmax": 34
}
```

| field | meaning |
|---|---|
| `at` | name of the MET point |
| `km` | distance from the station to that point |
| `now` | the rung at this moment, 0 clear, 1 rain, 2 heavy rain |
| `rung` | the worst rung across all seven steps |
| `from` | clock time the worst rung starts, or `null` when it starts now |
| `to` | clock time the worst rung ends |
| `open` | `true` when the worst rung still holds at the final MET step |
| `tmin`, `tmax` | forecast temperatures for today, in Celsius |

The rain fields are absent when all seven steps read clear. The temperature fields are absent when the
district has no row. The whole object is absent when both are true.

### How to derive `from`, `to` and `open`

Take the worst rung across the seven steps. Find its **first** index and its **last** index.

`from` is the clock of the first index, or `null` when that index is 0. `to` is the clock of the step
**after** the last index. `open` is `true` when the last index is the final step. `to` then holds the
clock of that final step.

**The span runs first to last, not the first unbroken run.** Measured on one live page: 137 of 294
markers hold rain somewhere, and 17 of those, which is 12%, hold the worst rung in more than one
block. `[0,0,0,1,0,1,1]` is a real pattern. Rain arrives, stops for one step, and returns. First-run
logic reports `Rain 16:10 until 16:40` and hides the return. Spanning first to last reports `Rain
from 16:10, past 17:40`. That overstates one dry half hour and understates nothing. A flood app must
be wrong in that direction.

**`to` names the first dry step, not the last wet one.** MET labels instants at :10 and :40. A wet
16:40 and a dry 17:10 mean the rain stops between them. Naming 17:10 has the reader wait a little too
long. Naming 16:40 has the reader stop too early. The first is the safe error, and an interval named
by its end is the normal convention.

## The card

### Where it goes

A new `.sensor` block, directly after `.pophead`, ahead of `camLink()`. It is a peer of the sensor
sections and it uses their markup.

The block renders **once per card**, not once per sensor. Rain over a place is one fact. `sourceInfo()`
already taught this app that a per-place fact repeated down a six-sensor mast is noise.

`.pophead` stays the first element of the card. `openSide()` lifts it into `#sideHead`, and that seam
must not move.

Both card builders emit it. `sitePopup()` reads `members[0]`. `popup()` reads its own station.

### What it says

```
 ♥  TAMAN SRI MUDA                    [×]
    Klang · Selangor
    [river] [rainfall] [camera]
 ────────────────────────────────────────
 ☂  Weather
    Heavy rain 16:10 until 17:10
    Shah Alam · 3.1 km
    🌡 24 – 34 °C today
 ────────────────────────────────────────
 ▲  River            0.42 m
```

The rain line takes one of five shapes. `Rain` renders for rung 1 and `Heavy rain` for rung 2.

| `now` | starts | outlook | line |
|---|---|---|---|
| worst | now | ends | `Heavy rain until 16:10` |
| worst | now | runs out | `Heavy rain past 17:40` |
| clear | later | ends | `Heavy rain 16:10 until 17:10` |
| clear | later | runs out | `Heavy rain from 16:10, past 17:40` |
| rain, worse later | later | either | `Raining now, heavy rain 16:10 until 17:10` |

`past` states that the MET outlook ended, not that the rain ended. The two words carry the difference,
so no line ever claims an end that MET did not publish.

The muted second line always prints the point and the distance. A reader can then weigh a 14 km claim
for themselves. This is also the line that keeps the section honest about what it is. The section is
not a sensor at this place.

The temperature line prints `24 – 34 °C today`. The line must keep the word `today`. Without it the range
reads as a thermometer, and it is a forecast.

Each line stands or falls on its own. A station with no `met` object renders no section at all. A
station with a temperature and no rain renders the section, the head, and the temperature line only.

So the section shows on most cards, because a district row nearly always exists. **The rain line is
the part that comes and goes.** A calm place carries the head and one temperature, and states no
weather it cannot support.

### Colour

The section takes a new token, `--k-weather`. The token goes in `css/base.css`, two values, one per
theme. That file holds every colour value in this app.

Grey fails here. `--s-none` grey means a sensor that cannot report, so a grey section
reads as broken.

`--k-rainfall` violet fails too. A mast that holds a rain gauge then draws two
violet sections side by side, one measured and one forecast.

`--k-weather` must not be a traffic-light hue. Green, amber, orange and red belong to status. This
section states no status. Heavy rain is not red here.

### Icons

Four new glyphs, from Material Symbols at `fill=1`, the family every glyph in this app already uses.
Fetch each one from
`https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/<name>/fill1/24px.svg`
and add it to `css/icons.css` as a mask. The top of that file records the refetch URL.

| glyph | use |
|---|---|
| `sunny` | rung 0, and the section head when no rain comes |
| `rainy` | rung 1 |
| `rainy_heavy` | rung 2 |
| `thermostat` | the temperature line |

There is no icon font, and this adds none.

## Constants

| name | value | reason |
|---|---|---|
| `MET_URL` | `https://www.met.gov.my/nowcasting/` | the nowcast page |
| `MET_DAY_URL` | `https://api.data.gov.my/weather/forecast/` | the daily forecast |
| `MET_KM` | 15.0 | inside the ~26 km decorrelation length of a 3-hour window |
| `MET_STALE` | 7200 | 2 hours, the age at which `api.php` drops the nowcast |
| `MET_DAY_TTL` | 21600 | 6 hours, because the forecast changes once a day |

The nowcast page reuses `SCRAPE_TTL`. It needs no new constant.

## Diagnostics

These scrapers fail silently by design. A layout change yields zero rows and no error.

The `sources` block in the payload gains counters, the same as `kl.parsed` and `national.applied`:

| counter | meaning |
|---|---|
| `met.parsed` | markers read off the nowcast page |
| `met.matched` | stations that took a nowcast value |
| `metday.parsed` | district rows read off the forecast call |
| `metday.matched` | stations that took a temperature |

A `parsed` of 0 means the page moved. Check these before believing the weather went quiet.

The Verify block in `CLAUDE.md` gains one `curl` line per product.

## Third parties

This adds two upstream hosts, `www.met.gov.my` and `api.data.gov.my`.

**PHP reaches both, and the browser reaches neither.** The page still talks to this origin and to the
CARTO basemap tiles, and to nothing else.

The claim about third parties in the About pane therefore still holds. Re-check it with a
**full sweep of every absolute URL in the code**, not a grep for known offenders. A short grep is what
let `basemaps.cartocdn.com` ship under a false claim.

The Credits block gains MET Malaysia, named once for both products.

## Documentation

`CLAUDE.md` gains a row in the files table, a row in the data sources table, and a gotcha. The gotcha
records the two traps here. The nowcast page bakes its data into `L.marker(...)` calls, so there is no
endpoint to find. The cell-scaled cutoff scales the wrong way, so nobody re-derives it.

`docs/FEATURES.md` gains the entry, with the decorrelation reasoning, so nobody re-derives 15 km.

## Sources

- Decorrelation against integration time — https://hess.copernicus.org/articles/23/2863/2019/
- Network density and convective extremes — https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2018GL077994
- Spatial variability from a dense gauge network — https://www.sciencedirect.com/science/article/abs/pii/S0169809509003275
- Thiessen against IDW against kriging — https://www.ijern.com/journal/2018/November-2018/25.pdf
- Areal rainfall methods — http://caee.webhost.utexas.edu/prof/maidment/ce394k/rainfall/rainfall.htm
- data.gov.my weather API — https://developer.data.gov.my/realtime-api/weather
