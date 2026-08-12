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

This check ran against 8 Selangor stations on 2026-08-12. Every station carried `threeHoursRainfall`,
`cumulativeRainfall` and the four `sp*` thresholds. `dailyRainfall` reset at midnight, so it
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
widening is measurable, so the payload reports the span it covered. The chart states 26.1 hours
rather than claiming 24.

Two guards:

- A negative difference means the odometer reset on 1 January. Publish `null`.
- No baseline sample in range means no answer. Publish `null`.

`$hist` loads 24 hours through `READ`. The odometer needs 72 hours. Add one bulk read over the `#c`
keys. That read returns about 2,200 rows against the 48,000 already in the table.

## Thresholds

The feeds publish two thresholds. This app must supply three.

`spVeryHeavy` gives the 1 hour mark, per station. Seven of the 8 stations published 61 and one
published 60. MET gives 240 mm for the day, which covers both the "today" bar and the
24 hour bar.

Fit a curve through the two published anchors. Take no constant from outside the data:

    exponent = ln(240 / spVeryHeavy) / ln(24)
    mark(D)  = spVeryHeavy * D ^ exponent        # D is the window in hours

At `spVeryHeavy` 61 the exponent is 0.431 and the curve gives 97 mm at 3 hours and 385 mm at
72 hours.

This design rejects a square root curve. That curve gives 299 mm at 24 hours. MET publishes 240 mm
for the same window. A mark this app invents must never stand above a mark MET states.

Guards:

- Clamp when `spVeryHeavy` is 240 or more. The exponent goes to zero or below and the curve
  inverts.
- Fall back to 60 mm when `spVeryHeavy` is absent. KL stations have no such field.

## Provenance marks

Attach an asterisk to every value this app worked out. Attach none to a value a feed published.
A bar value and its threshold have separate provenance, so each carries its own flag.

| bar | value | asterisk | threshold | asterisk |
|---|---|---|---|---|
| 1 hour | `hourlyRainfall` | no | `spVeryHeavy` | no |
| 3 hours, Selangor | `threeHoursRainfall` | no | curve | yes |
| 3 hours, KL | sum of three clock hours | yes | curve | yes |
| Today | `dailyRainfall` | no | MET 240 | no |
| 24 hours | odometer difference | yes | MET 240 | no |
| 72 hours | odometer difference | yes | curve | yes |

Draw a published threshold as a solid stroke. Draw an estimated threshold as a dashed stroke.

Two footnote lines sit under the chart. Emit a line only when its asterisk is on screen:

- `* Value derived from archived readings.`
- `* Threshold estimated between published values.`

The two lines name two different operations. A derived value is arithmetic on stored
measurements. An estimated threshold is a model.

A station shows two lines at most. A station with no odometer baseline yet shows the threshold
line alone, because it has no derived value to mark.

## The chart

Five rows. Reuse the `.mk` stroke from `rainBars()`.

The axis obeys the rule `rainBars()` already follows, and reuses its exact test. Draw a mark only
when it is 2 times the largest reading or less. Grow the axis only that far. So a dry day draws
bars across the full width and no marks at all. A 385 mm mark never flattens 4 mm of drizzle.

A window with no answer draws an em dash in muted ink. The row stays in place. Every station
shows five rows.

Each row carries a `data-tip`. `js/sparktip.js` already labels any `data-tip` and works on
touch. A `title` does not open on a phone, so a `title` is not an option here.

Example tip text:

    24 hours - 180 mm - measured over 26 h - MET reports red above 240 mm

## Payload

`api.php` computes every number. The client draws these numbers and calculates nothing. This
follows the standing rule that the server scores a status.

    "acc": {
      "h1":  [32,  61, 0, 0, null],
      "h3":  [78,  97, 0, 1, null],
      "day": [145, 240, 0, 0, null],
      "h24": [180, 240, 1, 0, 26.1],
      "h72": [210, 385, 1, 1, 74.0]
    }

Each row is `[mm, mark, valueDerived, markDerived, spanHours]`. A window with no answer is
`null` in place of the row.

Row labels stay in `js/config.js`, beside `ALERT_TITLE`. The payload carries numbers only.

Cost is about 120 bytes per rainfall station, or 27 KB across 230 stations.

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

- An odometer reset gives `null`, never a negative total.
- A missing baseline gives `null`.
- A stale baseline reports its real span.
- The curve rises with duration and passes through both published anchors.
- The curve clamps when `spVeryHeavy` is 240 or more.
- A KL 3 hour sum with two of three clock hours gives `null`.

## Not built

- `RAIN_STOPS` stays at 10, 30 and 60. The feed publishes 5, 11, 31 and 61 per station. Those
  numbers drive pin color, heat weight and `rainStatus()`, which are alert surfaces. That change
  goes through the alert design standard on its own.
- This app scores the rainfall status pill. JPS does not. By the asterisk rule it needs one.
  It is an alert surface, so it is out of scope here.
- No new alert. This chart moves no count, no icon badge, no ticker item and no toast.
- KL columns 6 to 11 stay unparsed. See the data sources section.
