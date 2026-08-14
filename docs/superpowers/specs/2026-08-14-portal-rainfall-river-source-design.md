# The national portal becomes the rainfall and river source

**Date:** 2026-08-14
**Status:** approved, ready for a plan

## Goal

Make `publicinfobanjir.water.gov.my` the preferred source for rainfall and river readings, and use
its own station search to place the stations it publishes. The map goes from 338 river and rainfall
stations to 471. Every rainfall window becomes exact on the first poll.

## Why

Three faults drove this. This work measured each one.

**Kuala Lumpur publishes no running rainfall total.** SPHTN carries no `cumulativeRainfall`, so
`accWindow()` has nothing to subtract. The 24 hour and 72 hour columns on 38 gauges show an em dash
and always will.

**The fallback for those 38 gauges is wrong.** `accHours()` adds one reading per clock hour.
`hourlyRainfall` is a rolling 60 minute total ending at the reading stamp, so a sum only tiles if
the readings sit exactly one hour apart. They sit a median 46 minutes apart, and every boundary
counts about 14 minutes of rain twice. Scored against the one referee available, the 3 hour total
Selangor publishes for itself: 14 of 176 stations out by more than 5 mm, worst 60 mm, p99 51.5 mm.
The error is zero on dry stations and large during heavy rain, which is the worst shape this app can
carry.

**Kuala Lumpur rivers are incomplete.** The portal publishes 48 water level rows for WLH. The map
draws 26. The portal states no coordinate, so nothing can place the other 22.

## What the portal publishes

Four endpoints on one host this app already contacts. This work measured each fact below. None of
them comes off a document.

| endpoint | cost | gives |
|---|---|---|
| `…/themes/shapely/agency/searchresultrainfall.php` | 3 requests | 311 rainfall rows |
| `…/index.php/aras-air/data-paras-air/aras-air-data/` | 3 requests | 114 river rows |
| `…/themes/enlighten/query/searchstation_control.php` | about 35, once | coordinates for 2,513 stations |
| `…/themes/enlighten/query/getrainfalllast7days.php` | 1 per station, once | 7 days of 5 minute buckets |

### The rainfall table

`CLAUDE.md` records that this endpoint returns headers and no rows. That is wrong. It returns the
search form until the caller also sends the two hidden inputs the page carries:

    ?state=SEL&district=ALL&station=ALL&loginStatus=0&language=1

With them it returns 241 rows for Selangor, 68 for Kuala Lumpur and 2 for Putrajaya. Columns are
`No | Station ID | Station | District | Last Updated | Rainfall from Midnight | Total 1 Hour (Now)`
and then six daily totals, one per previous day. Only the first two cells carry `data-th`. Read the
rest by position, and guard on row width, the same rule the SPHTN parser obeys.

### Rainfall from Midnight is a per-day odometer

`cdaily` only climbs and resets at midnight. So `accWindow()` computes an exact window from it with
no new arithmetic. The six daily columns bridge each midnight the window crosses.

### The 5 minute series

`getrainfalllast7days.php?station=<graphid>` returns 1,815 records over 167.8 hours. `clean` is a
disjoint 5 minute bucket. Two identities confirm it:

- twelve consecutive `clean` values equal `chourly`, maximum error 0.00 over 1,803 checks
- `clean` summed from midnight equals `cdaily`

Disjoint buckets add up. That is the whole reason this source solves what SPHTN cannot.

### Two fields that look useful and are not

`cyearly` looks like the year to date odometer SPHTN lacks. On the Kuala Lumpur station measured it
sat flat at 766.5 for the whole window while 12 mm fell. Do not use it.

The `info` block publishes `light`, `moderate`, `heavy` and `veryheavy` per station. Six stations
across three states all return 10, 30, 60 and 90. These are constants, not station values.
`RAIN_STOPS` already hardcodes 10, 30 and 60. Adopting them moves pin colour and heat weight through
the alert design standard to reach the numbers already in use. Out of scope. The thresholds that do
vary are the JPS Selangor `spLight` set, and they are a separate question.

## Architecture

### Fetch

Steady state is **6 requests per refresh**, both bulk tables, under the existing 15 minute page
cache in the `page` table. Nothing else runs on the poll path.

Two backfills run once per station, never during a refresh, the same rule `captureShots()` obeys:

1. **Coordinates.** Prefix queries against `searchstation_control.php` fill a `station` table of
   name, latitude and longitude. The endpoint needs three characters or more and returns
   `{"loc":[lat,lng],"title":"Name, District, State"}`.
2. **History.** The 7 day series seeds the rainfall archive, so 24 hour and 72 hour totals answer on
   the first poll rather than after two days.

A full per-station fetch on every refresh costs 28 MB. That is about 2.7 GB each day at one
government host. It is the shape of the camera stampede the refresh lock exists to prevent. Do not
build it.

### Merge order

This extends the rule already in `api.php`. It does not replace it.

    placement    Selangor API -> SPHTN -> portal gazetteer
    readings     portal -> Selangor API -> SPHTN

The portal wins a reading wherever it carries the station. The old feeds supply the 86
stations it does not carry. The reason is coverage, not resilience. Drop the fallback on the
day the portal covers all of them.

### Station matching

Three rules, strongest first. Reject anything weaker.

1. **Station code.** 145 of 231 rainfall stations join this way.
2. **Equal name**, after stripping case and punctuation.
3. **Unique suffix.** The rainfall table drops the river prefix that the gazetteer carries:

       rainfall table   Desa Pinggiran Putra (F2)
       gazetteer        Sg.Langat di Desa Pinggiran Putra (F2)

   Accept a suffix match only when exactly one gazetteer name ends with it. Two rainfall names
   match more than one and stay unplaced.

A near name is not evidence. 17 rainfall stations have a close name and no exact one. They keep
their current source and are never matched on similarity alone. This is the rule `CAM_FIX` states,
and the reason a coordinate this app invents is worse than one it can show belongs to upstream.

## What changes

Counted as portal rows, which is how the three columns above sum to the portal total:

| portal rows | rivers | rainfall | total |
|---|---:|---:|---:|
| rows published | 114 | 311 | 425 |
| match a station we hold | 76 | 186 | 262 |
| new and placed | 37 | 96 | 133 |
| new and skipped, cannot place | 1 | 29 | 30 |

Counted as our stations, which is how these sum to the map we draw today:

| our stations | rivers | rainfall | total |
|---|---:|---:|---:|
| stations we hold | 107 | 231 | 338 |
| take a portal reading | 74 | 178 | 252 |
| kept on the old feed | 33 | 53 | 86 |

**The two tables disagree by 10 on purpose, and the plan has to resolve it.** 262 portal rows match
only 252 distinct stations, because 10 rows collide: two portal rows claim one station of ours, one
on its code and one on its name. The plan must state which row wins. Prefer the code match, and log
the collision rather than pick silently.

The map grows from 338 to 471 river and rainfall stations. Of the 133 new stations, 83 place on an
equal name and 50 on a unique suffix. 22 of the 37 new rivers are the Kuala Lumpur ones, so that gap
closes completely.

**262 stations change where their number comes from.** That is the real size of this change, larger
than the 133 new pins. Each of those stations shows a reading today and shows
the portal figure after this change. A disagreement between the two feeds then becomes visible on a
station somebody watches.

On the surfaces:

- rainfall windows become exact and answer from the first poll. The `**` mark and its remark become
  rare rather than usual
- the 12 hour graph draws disjoint buckets. Today it samples a rolling hour and buckets at
  `RAIN_BUCKET` to avoid counting the same rain twice
- this work deletes `accHours()`, and the Kuala Lumpur 3 hour sum retires
- `rainBacked()` keeps working for the 86 stations on the old feeds. It means nothing on a portal
  station, because the hour and the check come from one source

## Not in this spec

- **The three alert feeds.** Each one needs the alert design standard on its own. All three pages
  are empty today, so no parser can meet a real row yet. They get their own specs.
- **Per-station rainfall thresholds.** Measured identical to the constants already in use.
- **Near name matching.** 17 candidates, no evidence behind any of them.
- **`cyearly` as an odometer.** Measured flat.

## Verification

Each check below fails loudly if the thing it guards breaks.

1. **Station accounting.** A sweep that prints the six numbers in the table above. A fall in
   "updated" means a join broke. A rise in "kept on the old feed" means the portal dropped rows.
2. **The bucket identity.** Assert that twelve `clean` values equal `chourly` and that `clean` from
   midnight equals `cdaily`. This is what licenses adding them.
3. **Window agreement.** Compare the portal 3 hour window against the 3 hour total Selangor
   publishes for itself, on every station carrying both. The current sum is out by more than 5 mm on
   14 of 176. The portal figure must beat that by a wide margin or the migration is wrong.
4. **`sources.stale`.** The two new page keys must appear there when the portal fails, and the map
   must fall back rather than blank.
5. **No station loses a reading.** Count stations with a null reading before and after. The number
   must not rise.

## Open question for the plan

The backfill needs a trigger and a store. It runs one time per station, and that needs a home:
a table naming the stations this app already backfilled, and a rule for when a new station takes
its turn. Keep the fetch off a reader's poll.
