# MET weather layer

Date: 2026-08-17

## Goal

Draw a map of MET Malaysia nowcast points. Hide every flood station while that map is on.

A tap on a weather point opens a panel. The panel states the temperature range for the day.
It then draws every half hour MET publishes, one card per step.

This layer adds no alert surface. It moves no count, no badge and no ticker tile. It is weather,
and weather makes no claim about a sensor.

## What MET publishes, and what it does not

A nowcast marker holds one current word and six forward steps. Each step covers 30 minutes. The
window reaches three hours ahead. The marker also carries the issue time.

```
Kuala Nerus | Sekarang: Tiada Hujan
Ramalan pada: 02:30 PM ... 05:00 PM      six steps
Tarikh kemaskini : 17/08/2026 02:00 PM   issue time
```

**MET publishes no past.** The feed answers what happens now and later. It never answers what
happened an hour ago. So this app must record its own observations. The archive section below
states how.

`metPoints()` in `sources.php` already parses all of this. It returns `rungs` and `clocks`, each
seven long. Index 0 holds now, and `clocks[0]` holds null because now carries no clock.

## The point set

MET publishes 294 markers for the whole country. `BOX` keeps 50 of them. `BOX` is the same
constant `?place=` bounds its results to.

**Do not clip this set to Selangor, Kuala Lumpur and Putrajaya.** Ten of the 50 points sit in
Pahang, Negeri Sembilan or Perak. Five of those ten sit on the Titiwangsa ridge, and that ridge
feeds the Klang valley. Rain over Genting Highlands arrives in Kuala Lumpur as a flash flood.
A state border deletes the most useful weather on this map.

Measured against the station set:

| point | state | km to the nearest station |
|---|---|---|
| Bukit Fraser | Pahang | 0.5 |
| Genting Highlands | Pahang | 6.6 |
| Bukit Tinggi | Pahang | 8.4 |
| Raub | Pahang | 16.3 |
| Bentong | Pahang | 20.9 |
| Nilai | Negeri Sembilan | 6.0 |
| Seremban | Negeri Sembilan | 17.6 |
| Port Dickson | Negeri Sembilan | 13.9 |

Every one of the 50 points sits within 21 km of a station this app carries. Forty of them sit
within 2 km. The layer lies on top of the station network. It does not sprawl past it.

Bukit Fraser makes the case on its own. The point sits 500 m from the BUKIT FRASER gauge in
this app. A survey line runs between the two.

### One pair never separates

`Serdang` and `Seri Kembangan` stand 80 m apart. They measure 16 screen pixels apart at zoom 15.
No zoom a reader uses draws both. One always wins and the other never appears.

That is correct. Two points 80 m apart report one weather. Say it here so nobody reads the missing
name as a fault.

## Delivery

A refresh already parses the nowcast for the station join. The same pass builds the weather rows.
It writes them as one row in the `page` table, under the key `wx:box`. That reuses the reserved
prefix pattern `place:` and `gazdone:` already follow.

`api.php?wx=1` reads that row and echoes it. **The handler parses nothing.** It cannot reach MET.
It cannot be slow.

```
MET nowcast  --> api.php, once per SCRAPE_TTL, from PHP
                   |
                   v
             page table, row `wx:box`
                   |
             ?wx=1 reads the row
                   v
                browser
```

The browser reaches this origin only. PHP reaches every upstream. That is the rule this app
already runs on, and weather does not change it. One MET fetch per 15 minutes serves every reader.

### Why not the main payload

The payload measures about 33 KB. The weather rows add about 9 KB. Weather mode stays off for
most readers. A permanent 27 percent tax on every poll buys those readers nothing.

`?cam=`, `?shots=`, `?sheet=` and `?place=` are the same shape. `lazy()` already drives a deferred
module, its skeleton and its failure line.

### The ETag must stay stable

`?wx=1` carries an `ETag`. The body holds nothing that moves except the data from MET.
`stamp` is the issue time from MET. It is never the poll time.

MET reissues about every 30 minutes. Readers poll about every 8.5 minutes. So about three polls in
four cost one 304 and about 200 bytes.

**Never put a per-request field in that body.** A field that moves on every read changes the hash on
every read. The 304 then stops firing, and every poll ships the full 9 KB. See the `cacheAge`
entry in `CLAUDE.md` for the same fault at its first site.

## The archive

Each refresh that parsed a nowcast writes one row per point.

```sql
INSERT OR IGNORE INTO level (station, ts, level)
VALUES ('wx-petaling-jaya', <MET issue stamp>, <rungs[0]>)
```

`ts` is the issue stamp from MET. It is never the poll time. This is the rule `readTs()` already states
for every other writer to this table. The `(station, ts)` primary key then dedupes a re-read of one
issue to a single row.

`RETAIN` prunes these rows with the rest. **There is no schema change.**

A fresh server holds no past. The panel then starts at the current row. It prints no message about
that. One poll in the life of a server is not a state.

## Temperature

`metDaily()` keys its rows by district name. A nowcast point carries a name and a coordinate. It
carries no district.

**Never take that district from a station.** A temperature taken through the district of a
station reads as that station reporting a temperature. No station in this payload holds a weather reading. The
app must not invent that claim.

The join reads a coordinate through Nominatim instead.

```
Nominatim reverse  ->  address.district      Petaling, Bentong, Hulu Langat
                   ?? address.city           Kuala Lumpur, which MET files as one district
                   ?? address.state          Putrajaya
lowercase, look up metDay
no match  ->  no temperature row
```

Measured on three points, one for each rung:

| point | district | city | state |
|---|---|---|---|
| Petaling Jaya | Petaling | Petaling Jaya | Selangor |
| Bukit Bintang | — | Kuala Lumpur | — |
| Bentong | Bentong | Bentong | Pahang |

Nominatim returns the *daerah* of Malaysia in the `district` field. Kuala Lumpur is a federal territory
and carries no daerah, so `city` answers there. Putrajaya answers on `state`.

Those spellings match the district vocabulary this app already joins on. Selangor holds nine
daerah, and `Petaling` is one of them.

### Bake the lookups, never drip them

Nominatim allows one request each second. Fifty lookups cannot ride a refresh.

`wx-build.php` runs by hand. It writes `wx-places.json`, which holds 50 rows of slug and district.
Commit that file. This is the pattern `water-build.php` already states: run by hand, never in a
request.

Towns do not move. A new MET point shows no temperature until somebody runs the script again. That
is a missing row, not a wrong one.

The bake also returns a state for each point. Nothing reads it today. A future clip by state is
then one filter over data the file already holds.

## The map

`PREFS.wx` holds one boolean. `syncWx()` reads the preference and writes the checkbox, the summary,
the layer and the legend. **It never reads the control back.** That is the rule `syncHeat()` exists
to state, and a browser restores a checkbox without firing `change`.

### One Layers section, not two

The control sits in the drawer, in the **Layers** section, beside the two heatmaps.

**The three share one section because they are one choice.** Weather mode forces both heatmaps
off, so exactly one of the three ever paints. Two sections said otherwise. A reader had to open both sections to learn what the map draws.

The section takes the `layers` glyph, which suits it. `Sensor kinds` gives that glyph up and takes
`apps`, a grid, which suits a row of one chip per kind.

**One summary, written by one function.** `syncHeat()` owns it, because that function already reads
both preferences. Two writers on one line age apart, which is the fault `syncHeat()` itself exists
to prevent. `syncWx()` writes no summary.

The summary names the layer on screen: `weather`, `water level`, `rainfall` or `off`.

**The two view filters keep their rule below.** Rising-only and favorites-only hide pins rather
than paint a layer, so they stay under the divider they already sit under.

**Merging the sections merges no state.** `PREFS.wx` stays a boolean and `PREFS.heatLayer` stays a
string. A single control has to remember the heatmap it replaced. Two preferences remember
it by never having disturbed it.

`PREFS.heatLayer` is never written. `syncHeat()` takes `PREFS.wx` as one more input and drops both
canvases while the mode is on. Turn the mode off and the heat choice returns, because it
never left. **That is the whole of the previous-heatmap requirement.**

`PREFS.wx` persists. A reader who left the mode on meets a map with no stations on it. The drawer
summary is the only thing that states why.

### Thinning, not clustering

A cluster badge reading 6 cannot say which weather. So the layer thins instead. `thinWx()` keeps a
point only where no kept point stands within `WX_THIN_PX` of it.

`WX_THIN_PX` is 40. A pin draws at 31.2 px, so that leaves about 9 px of air.

Measured at latitude 3.1:

| zoom | m per pixel | points kept at 32 / 40 / 48 px |
|---|---|---|
| 9 | 305.3 | 22 / 22 / 20 |
| 10 | 152.7 | 36 / 31 / 27 |
| 11 | 76.3 | 44 / 42 / 40 |
| 12 | 38.2 | 45 / 45 / 45 |
| 13 | 19.1 | 46 / 46 / 46 |
| 15 | 4.8 | 49 / 49 / 49 |

The threshold acts at zoom 11 and below. Above zoom 12 it changes almost nothing. Zoom 11 is the
Klang valley overview, so that is where the work happens.

The layer is a plain `L.layerGroup`. It does not enter `cluster`.

### Pins

A pin calls `pinGlyph()`. It gets the same stroke, shadow and scale every station pin gets.

The glyph states two things. It states clear against rain. It states day against night.

A point reads its own stamp for that, and never the current hour. Night runs 19:00 to 06:59.
`popup.js` already defines those hours.

**The color states intensity.** Rendered tests rejected the alternative. `rainy_heavy` carries no
cloud, so beside `rainy` it reads as a different thing rather than more of one thing. At 31 px it
reads as hatching.

So `WEATHER` gains a `pin` field beside `icon`. The card keeps `rainy_heavy` at its larger size,
where the glyph works and no color ladder exists. The pin uses `rainy` for both wet rungs.

| rung | card glyph | pin glyph |
|---|---|---|
| 0 clear | `sunny` / `clear_night` | same |
| 1 rain | `rainy` | `rainy` |
| 2 heavy | `rainy_heavy` | `rainy` |

### Color

This layer paints natural sky colors. **That is not an exception to the status rule, and an early
draft of this spec wrongly called it one.**

The rule in `CLAUDE.md` reserves the status TOKENS for status. That rule already cut one
attempt. `#locate.fail` took `--s-alert` for a failed location fix. Weather takes no status token. `--wx-clear` is its own token.

The real risk is perceptual, not token misuse. Two things manage it. The value sits muted away from
`--s-alert`, which is `#e68e16` on light and `#ffc000` on dark. And weather mode draws no station
pin, so nothing status-colored shares the map.

The drawer control still takes no status hue, and the header keeps its own alert colors.

One more rule holds the two sets apart. **The status set uses saturated colors. Weather uses muted ones.** A reader
separates them by vividness as well as by hue.

A rendered test rejected gold `#f2b705`. It sits within a shade of `--s-alert` on the light theme.
It matches `#ffc000` on the dark theme. `#d8a93f` clears both.

The three values live as `--wx-clear`, `--wx-rain` and `--wx-heavy` in `css/base.css`. They must
also appear in the `:root[data-theme="dark"], .pin` block, because a pin resolves `--c` there. A
token missing from that block draws one pin off palette.

**The rain and heavy pair is not final.** `.pin` uses one palette on both themes, because a pin
must win over the basemap. A heavy value darker than the rain value loses on the dark tile.
Intensity must differ by saturation, not by lightness. Tune the pair against a real basemap tile
before writing the values down.

## The panel

The panel is a tenant of `#side`, under the key `@wx-<slug>`. That is the pattern `@alerts` and
`@here` already follow. Its head is a `.pophead`, and `openSide()` lifts that head out.

**The panel reuses the weather card on the station panel.** That card draws two cells. The `Later`
cell holds a glyph on the left. A line of words sits beside it. A label sits under the pair.

This panel repeats that cell once per half hour. The label states the clock.

```
Petaling Jaya                          ...  x
MET Malaysia
---------------------------------------------
  32 / 24    Today
---------------------------------------------
  +---------------------------------------+
  | sun   Clear                           |
  | 14:00                                 |
  +---------------------------------------+
  | rai   Rain                            |
  | 14:30                                 |
  +---------------------------------------+
  | rai   Rain                      NOW   |   <- outlined
  | 15:00                                 |
  +---------------------------------------+
  | hvy   Heavy rain                      |
  | 15:30                                 |
  +---------------------------------------+
        ... one card per half hour, to +3 h
```

The card is `.wxcol`. The glyph is `.wxbig`. The words are `.wxline`. The clock is `.wxsub`.

Every one of those classes exists in `css/map.css` today, on the `Later` cell. Only the container
is new, and the container is one column.

**The cards stack down the panel. They never run sideways.** A sideways strip hides the later
hours behind a swipe, and a hidden hour on a flood map helps nobody. A vertical stack also gives each card the full width. The word then sits beside its
glyph, the way the `Later` cell draws it.

**Each card names its weather in words.** That reverses the rule the weather card states for its
own two cells, where the glyph carries the state alone.

Two cells can afford that, because a reader scans two glyphs at once. Nine cannot. A stack of nine
glyphs with no words makes a reader decode every one of them. `data-tip` opens one at a time.

**The panel states no span and no sentence.** It never prints "Rain until 16:30". Every half hour
MET publishes gets its own card.

The current card takes a `NOW` chip and an outline. The chip labels it and the outline finds it.
A reader scanning nine cards then lands on the right one without reading.

The clock stays on the card. A card that traded the time for the word states one fact and loses
another. `NOW` in capitals joins `TRIGGERED` and `HAPPENING NOW` as badge language. It is not a
message.

The temperature sits above the cards, in a `.wxrow`, and reuses `.wxtemp`. It is absent where no
district matched. The cards then start the panel.

The cards before the chip come from the archive in this app. The cards after it come from the MET
forecast.

**That fact rides in the three-dot menu, and nowhere else.** It is provenance, and this app
already prints provenance there. The menu holds three lines. It states the issue time, the
source, and which half of the stack this app observed.

## Exits

`flashTo()` in `map.js` clears `PREFS.wx` before it moves the map. Every jump in this app already
reaches that function. The go-to box, the table, the alert rows, the ticker and the menu rows all
pass through it. So the exit lives in one place.

## Poll and repaint

`wx.js` owns its data and its repaint from end to end. The payload never carries weather.
`render()` never writes the weather panel.

`render()` calls `wx.tick()` when the mode is on. `tick()` fetches `?wx=1`. It then repaints the
layer. It also rebuilds the open panel when the `#side` key starts `@wx-`.

Two fetches now run per poll, and they cannot race. Neither one writes what the other reads. The
only guard needed is a generation counter, which discards a stale response. `clip.js` and
`lookup()` in `ui.js` already state that pattern.

## The static build

GitHub Pages runs no PHP, so `?wx=1` does not answer there. The bake writes `wx.json` beside
`api.json`, on the same cron. `wx.js` reads that file when `STATIC` is true.

`.history.db` already survives between runs, through `actions/cache@v4`. So the archive fills there
the same way the trend history does.

**A failed weather bake must not fail the map bake.** Copy `wx.json` the way the workflow copies
`img/`. A missing file must hide the drawer section, and never break the map.

## Files

| file | change |
|---|---|
| `api.php` | `BOX` filter, temperature join, archive write, `wx:box` row, `?wx=1` handler |
| `js/wx.js` | new, deferred. Layer, thinning, pins, panel, poll |
| `js/heat.js` | `syncHeat()` reads `PREFS.wx` |
| `js/render.js` | one guard around the marker pass, one call to `wx.tick()` |
| `js/map.js` | `flashTo()` clears the mode |
| `js/popup.js` | `night()` takes a clock |
| `js/config.js` | `WEATHER[].pin`, `WX_THIN_PX` |
| `js/ui.js` | the chip handler and its `lazy()` failure surface |
| `index.html` | drawer section, legend key |
| `css/base.css` | three `--wx-*` tokens, in both themes and in the `.pin` block |
| `css/map.css` | `.wxsteps` column, `.wxcol.now` and the `NOW` chip |
| `wx-build.php` | new. Runs by hand. Writes `wx-places.json` |
| `wx-places.json` | new. Committed. 50 rows of slug, district and state |
| `.github/workflows/pages.yml` | bake `wx.json`, copy it, never fail on it |
| `docs/FEATURES.md` | the entry |
| `CLAUDE.md` | the color exception, the archive key, the new gotchas |

`sources.php` needs no change. `metPoints()` and `metDaily()` both stay as written.

## Checks

`php api.php --selftest` gains assertions for the `BOX` filter, the slug and the archive key.

The `Verify` block in `CLAUDE.md` gains two sweeps. One counts the points and the archive depth.
One asserts that no weather row carries a district borrowed from a station.

## What this ships unverified

**1. The temperature join has never met a real response.** `api.data.gov.my/weather/forecast`
answered an empty array for every date tested on 2026-08-17. Nobody has seen a `Ds` row. The
district spellings above come from the station data in this app and from Nominatim. They do not come
from the MET forecast feed.

Check this by hand on the first non-empty response. This is the caveat `floodAlerts()` already
carries.

**2. Nothing alarms when that feed dies.** `sources.old` names `met-warn` and nothing else.
`metday.parsed` reads 0 with no signal behind it. So nobody can say how long the feed has been
quiet.

Fixing that sits outside this work. Name it here so the next reader sees a decision.

**3. Nobody has measured how often MET reissues.** The 30 minute figure comes from a code comment and one
observed stamp. The past hour holds two rows at that cadence. It holds one at an hourly cadence.
Measure the stamp over a few hours before trusting the number.

**4. A point name is the archive key.** A rename orphans the history for that point, and `RETAIN` prunes
it 30 days later. A name is steadier than a float coordinate. No measurement stands behind that.

**5. The rain and heavy colors are not chosen.** See the color section above.

**6. `wxPast()` anchors on the newest stamp across every point, not on each point's own.**
`api.php:3223` takes `max()` of all fifty stamps. Today every point shares one stamp. The anchor
and each point's own stamp are the same number.

A future point can lag behind the newest by more than `WX_PAST` (1 hour). Its own window then
starts from the wrong anchor. It gets an empty `past` array instead of a shorter one.

Check this once MET publishes points on staggered issue times.
