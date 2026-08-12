# Cumulative rainfall chart

Date: 2026-08-12

## Goal

Show rain totals for five nested windows on a rainfall sensor. The windows are 1 hour, 3 hours,
today from midnight, 24 hours and 72 hours. Draw each total as a horizontal bar. Put a threshold
mark on each bar.

Two surfaces draw the chart. The station card draws it under the rain area graph. The table
popover draws it in the same place. Both call one function, the way both already call
`rainBars()`.

## Why five windows

Flash Flood Guidance publishes nested windows because each window answers a different question.
A short window measures drainage overload. A long window measures how wet the ground already is.
Sensitivity to earlier soil moisture falls as the window grows. So 1 hour and 72 hours are two
facts. They are not two views of one fact.

Reference numbers for Malaysia:

- MET Malaysia issues a thunderstorm warning above 20 mm in an hour.
- MET Malaysia issues a red continuous rain warning above 240 mm in a day.
- JPS calls 60 mm in an hour very heavy.
- Flash floods need about 60 mm in 2 to 4 hours. The 3 hour bar exists for this number.

MET publishes the 240 mm figure through press reporting. The MET criteria page carries words
only. The page names three levels and gives no number for any of them.

These four numbers are context for the reader of this document. **None of them is a mark on the
chart.** The Thresholds section states where the marks come from and why these do not serve.

## Each bar contains the one above it, and the order can still invert

Each window contains the one before it. So the bars never fall as the reader goes down the
list, except at one point. Near midnight the "today" bar is younger than the "3 hours" bar.
At 01:00 today holds one hour of rain and the 3 hour window reaches back into yesterday.

The dip is true. Keep it. Keep the order the reader asked for.

## Data sources

The Selangor detail endpoint publishes three of the five totals. This app reads one of them
today and throws the other two away.

| bar | Selangor, 193 stations | KL, 37 stations |
|---|---|---|
| 1 hour | `hourlyRainfall` | column 13 |
| 3 hours | `threeHoursRainfall`, a new read | sum of three clock hours, derived |
| Today | `dailyRainfall` | column 12 |
| 24 hours | odometer difference, derived | none |
| 72 hours | odometer difference, derived | none |

This check ran against 8 Selangor stations on 2026-08-12. Every station carried
`threeHoursRainfall`, `cumulativeRainfall` and the four `sp*` thresholds. `dailyRainfall` reset at midnight, so it
answers the "today" window exactly.

KL publishes six earlier calendar days in columns 6 to 11. This design does not read them. Three
calendar days is not 72 hours. One label for two quantities is the drift this repo bans.

## The odometer

`cumulativeRainfall` is a year to date total. The 8 stations read 645 mm to 1656 mm. That is the
correct spread for mid August.

Store it as its own series in the `level` table, under the key `<id>#c`. This needs no schema
change. `RETAIN` prunes it at 30 days, which already covers 72 hours.

Read a window as a difference:

    total = cumulative(now) - cumulative(newest sample at or before now - window)

Do not sum hourly buckets. A sum loses the rain in every gap and reports a small number with no
error. This box holds 9 of the last 24 clock hours and has a 15 hour hole. A sum prints 40 mm
for 300 mm of rain. The scrapers already fail silently by design, and `sources.stale` is
the alarm for that. A total with no such alarm must not exist.

A difference fails a different way. A missed poll widens the window. It does not lose rain. The
payload can measure that wider window, so it reports the span it covered. The chart states
26.1 hours rather than 24.

Two guards:

- A negative difference means the odometer reset on 1 January. Publish `null`.
- No baseline sample in range means no answer. Publish `null`.

`$hist` loads 24 hours through `READ`. The odometer needs 72 hours. Add one bulk read over the `#c`
keys. That read returns about 2,200 rows against the 48,000 already in the table.

## Thresholds

Every mark comes from MSMA 2nd Edition, the Urban Stormwater Management Manual. JPS publishes
that manual. JPS also publishes the feed this app reads. So a mark on this chart is a JPS number,
not a number this app invented.

MSMA Equation 2.2 gives rainfall intensity for a duration and a return period:

    i = lambda * T^kappa / (d + theta)^eta

- `i` is the average rainfall intensity in mm per hour.
- `T` is the Average Recurrence Interval. Table 2.B1 covers 2 to 100 years. Table 2.B2 covers
  0.5 to 12 months.
- `d` is the storm duration in hours. Both tables run from 0.0833 to 72.
- Appendix 2.B lists `lambda`, `kappa`, `theta` and `eta` for each raingauge. MSMA calls these
  four the fitting constants.

The depth for a window is `i * d`.

The duration range runs from 5 minutes to 72 hours. Every window on this chart falls inside it.

### Two marks per bar

Draw a lower mark at 3 month ARI, from Table 2.B2. Draw an upper mark at 10 year ARI, from
Table 2.B1. Both marks state how rare that much rain is at that gauge. The app already reads
every other sensor on two rungs, and these two carry one meaning between them.

Depths at station 3116003, Ibu Pejabat JPS, Kuala Lumpur:

| window | 2 year | 5 year | 10 year | 50 year |
|---|---|---|---|---|
| 1 hour | 62.4 | 71.2 | 78.8 | 99.5 |
| 3 hours | 81.0 | 92.5 | 102.3 | 129.2 |
| 24 hours | 121.7 | 139.0 | 153.7 | 194.1 |
| 72 hours | 149.0 | 170.2 | 188.2 | 237.7 |

The "today" bar takes `d` as the hours since midnight, so its mark moves through the day. At
06:00 it states the 6 hour depth. Clamp `d` to 0.0833 in the first five minutes after midnight,
which is the floor of the equation.

### Why this design rejects a curve fitted to the warning levels

An earlier draft fitted a power curve through `spVeryHeavy` at 1 hour and the MET figure of
240 mm at 24 hours. MSMA shows what those two numbers are. At Ibu Pejabat JPS, 61 mm in an hour
is a 1.7 year event. 240 mm in a day is a 216 year event.

The two anchors are 2 orders of magnitude apart in rarity. A curve through them measures the gap
between two unrelated definitions. It measures nothing about rainfall. Do not restore it.

The same finding rules out one solid mark per bar from mixed sources. One stroke that means
1.7 years on one row and 216 years on the next lets no reader compare two rows.

### An ARI depth and a trailing window are not the same quantity

An ARI depth is the largest depth in any window of that length in a year. This chart measures one
named trailing window. A fixed window can not exceed the sliding maximum, so the comparison is
conservative. State this once in the help text. Do not state it per bar.

## Provenance marks

Attach an asterisk to every value this app worked out. Attach none to a value a feed published.
A bar value and its threshold have separate provenance, so each carries its own flag.

| bar | value | asterisk |
|---|---|---|
| 1 hour | `hourlyRainfall` | no |
| 3 hours, Selangor | `threeHoursRainfall` | no |
| 3 hours, KL | sum of three clock hours | yes |
| Today | `dailyRainfall` | no |
| 24 hours | odometer difference | yes |
| 72 hours | odometer difference | yes |

No mark carries an asterisk. MSMA publishes all ten of them, so this app writes no mark of its
own. That is the reason to prefer MSMA over any curve. It is worth more than the accuracy.

One footnote line sits under the chart. Emit it only when an asterisk is on screen:

    * Value derived from archived readings.

A station with every window answered from a feed shows no footnote at all.

## The chart

Five rows. Reuse the `.mk` stroke from `rainBars()`. Each row carries two marks. Draw the 3 month
mark in the lighter rung and the 10 year mark in the heavier one.

The axis obeys the rule `rainBars()` already follows, and reuses its exact test. Draw a mark only
when it is 2 times the largest reading or less. Grow the axis only that far. So a dry day draws
bars across the full width and no marks at all. A 188 mm mark never flattens 4 mm of drizzle.

The 3 month mark survives that test far more often than the 10 year one. This is the reason for
two marks and not one. A chart whose only mark is out of range on most days states nothing on
most days.

A window with no answer draws an em dash in muted ink. The row stays in place. Every station
shows five rows.

Each row carries a `data-tip`. `js/sparktip.js` already labels any `data-tip` and works on
touch. A `title` does not open on a phone, so a `title` is not an option here.

Example tip text:

    24 hours - 180 mm - measured over 26 h - past the 10 year rainfall for this gauge

The card names the MSMA gauge once, under the chart, with its distance. A reader can then see
which raingauge the marks belong to.

## Payload

`api.php` computes every number. The client draws these numbers and calculates nothing. This
follows the standing rule that the server scores a status.

    "acc": {
      "h1":  [32,   34.1,  78.8, 0, null],
      "h3":  [78,   44.2, 102.3, 0, null],
      "day": [145,  66.4, 153.7, 0, null],
      "h24": [180,  66.4, 153.7, 1, 26.1],
      "h72": [210,  81.3, 188.2, 1, 74.0]
    },
    "msma": ["3116003", "Ibu Pejabat JPS", 4.2]

Each row is `[mm, mark3month, mark10year, valueDerived, spanHours]`. A window with no answer is
`null` in place of the row. The 3 month figures above stay illustrative until somebody transcribes
Table 2.B2.

`msma` names the gauge whose constants this station borrowed, and the distance to it in km. One
entry per station, not per row.

Row labels stay in `js/config.js`, beside `ALERT_TITLE`. The payload carries numbers only.

Cost is about 170 bytes per rainfall station, or 39 KB across 230 stations.

## MSMA coverage and transcription

MSMA lists 10 raingauges in Selangor and 2 in Kuala Lumpur. This app carries 230 rainfall
stations. So most stations borrow the constants of the nearest MSMA gauge. Print that gauge and
its distance on the card. A reader can then judge how far the mark travelled.

The MSMA station IDs share the format of `station_Id` in the Selangor API. MSMA lists 3516022 and
the feed publishes 3516026. So a station that appears in both joins on its code, and every other
station joins on distance.

Confirmed Selangor IDs: 2815001, 2913001, 2917001, 3117070, 3118102, 3314001, 3411017, 3416002,
3516022, 3710006. Confirmed Kuala Lumpur IDs: 3015001, 3116003.

**Transcribe the constants by hand and check them.** Three text extractions of Appendix 2.B gave
three different `lambda` for one station. Two of them silently shifted the constants column
against the station names, which reads as a clean table and is wrong. A wrong constant puts a
wrong danger mark on a flood map. Trust no extraction here without a check.

The check is the worked example inside MSMA. At station 3116003 the constants are 61.976, 0.145, 0.122
and 0.818. At 20 year ARI and 30 minutes the manual prints 141.11 mm per hour and 70.56 mm of
depth. Equation 2.2 with those constants returns 141.11 and 70.55. Assert this in the selftest.

## Call sites

- `sensorBody()` in `js/popup.js`, under the `rainBars()` call.
- `trend()` in `js/table.js`, under the `rainBars()` call.

One new exported function in `js/popup.js`. This matches how `rainBars()` already serves both
surfaces.

## Stale stations

A rainfall station can freeze on an old reading. One station in the current payload holds 27 mm
in an hour. Its stamp reads 20/10/2025. `hasInfo()` calls it online because `hourly` is not null.

Draw no chart when the reading is stale. An offline flood gauge already gets no graph for the
same reason. This chart must never draw a total from last October as rain that fell today.

## Checks

Add a block to `php api.php --selftest`. Every assertion runs offline.

- Equation 2.2 returns 141.11 mm per hour for the worked example inside MSMA. This is the assertion
  that guards every transcribed constant.
- An odometer reset gives `null`, never a negative total.
- A missing baseline gives `null`.
- A stale baseline reports its real span.
- Depth rises with duration at one ARI. Depth rises with ARI at one duration.
- The 3 month mark sits under the 10 year mark on every window.
- The "today" mark clamps to the 0.0833 hour floor in the first five minutes after midnight.
- A KL 3 hour sum with two of three clock hours gives `null`.

## Not built

- `RAIN_STOPS` stays at 10, 30 and 60. The feed publishes 5, 11, 31 and 61 per station. Those
  numbers drive pin color, heat weight and `rainStatus()`, which are alert surfaces. That change
  goes through the alert design standard on its own.
- This app scores the rainfall status pill. JPS does not. By the asterisk rule it needs one.
  It is an alert surface, so it is out of scope here.
- No new alert. This chart moves no count, no icon badge, no ticker item and no toast.
- KL columns 6 to 11 stay unparsed. See the data sources section.
- No mark uses `spVeryHeavy` any more. MSMA prices that number at a 1.7 year event, and the two
  marks on this chart are 3 months and 10 years. Keep `spVeryHeavy` out of the chart entirely.
  Mixing it back in returns the fault the Thresholds section rejects.

## Sources

- MSMA 2nd Edition, 2012, DID Malaysia. Chapter 2, Quantity Design Fundamentals. Equation 2.2,
  Table 2.B1, Table 2.B2, Appendix 2.B. Worked example in Appendix 2.F.
- JPS Selangor detail endpoint, `StationRainfalls/{id}`. Sampled 2026-08-12.
- MET Malaysia warning criteria page. Words only, no numbers.
- Flash Flood Guidance practice, for the reason to publish nested windows at all.
