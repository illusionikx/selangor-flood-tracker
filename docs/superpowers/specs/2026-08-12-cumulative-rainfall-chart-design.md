# Cumulative rainfall chart

Date: 2026-08-12

## Goal

Show rain totals for five nested windows on a rainfall sensor. The windows are 1 hour, 3 hours,
today from midnight, 24 hours and 72 hours. Draw each total as a horizontal bar.

**This chart answers how much rain fell. It never answers how dangerous that is.** Severity stays
with `rainBars()`, the area graph directly above it. That graph already draws the JPS intensity
classes across its plot. Two charts, two questions, one card.

Two surfaces draw this chart. The station card draws it under the rain area graph. The table
popover draws it in the same place. Both call one function, the way both already call
`rainBars()`.

## Why five windows

Flash Flood Guidance publishes nested windows because each window answers a different question.
A short window measures drainage overload. A long window measures how wet the ground already is.
Sensitivity to earlier soil moisture falls as the window grows. So 1 hour and 72 hours are two
facts. They are not two views of one fact.

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
`threeHoursRainfall` and `cumulativeRainfall`. `dailyRainfall` reset at midnight, so it answers
the "today" window exactly.

Measured across all 230 rainfall stations, the five windows resolve like this:

| | bars | share |
|---|---|---|
| published by a feed | 653 | 56.8% |
| derived, carries an asterisk | 423 | 36.8% |
| no answer possible | 74 | 6.4% |

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
the alarm for that. Do not publish a total with no such alarm.

A difference fails a different way. A missed poll widens the window. It does not lose rain. The
payload can measure that wider window, so it reports the span it covered. The chart states
26.1 hours rather than 24.

Two guards:

- A negative difference means the odometer reset on 1 January. Publish `null`.
- No baseline sample in range means no answer. Publish `null`.

`$hist` loads 24 hours through `READ`. The odometer needs 72 hours. Add one bulk read over the `#c`
keys. That read returns about 2,200 rows against the 48,000 already in the table.

### The 72 hour bar needs three days of uptime

Measured on this box on 2026-08-12, a usable baseline exists for 77.4% of stations at 24 hours and
**0% at 72 hours**. The archive holds no rows at all for 09/08, which is where the 72 hour
baseline lands. Herd polls only while somebody has the page open.

This is a data collection gap, not a design fault. The cron target in `docs/DEPLOY.md` closes it
after three days of uptime. Ship all five bars now. The 72 hour bar draws its empty state until
the archive fills. This document specifies that empty state below, and the chart needs it anyway.

## No threshold marks

This chart carries no threshold mark of any kind. This design tested three sources and each one
failed.
Record all three, because each one looks reasonable until somebody measures it.

**A curve fitted between the two published warning levels.** The first draft fitted a power curve
through `spVeryHeavy` at 1 hour and the MET figure of 240 mm at 24 hours. MSMA prices those two
numbers at a **1.7 year** event and a **216 year** event. They are 2 orders of magnitude apart in rarity. A
curve through them measures the distance between two unrelated definitions. It measures nothing
about rainfall. Do not restore it.

**MSMA return periods.** JPS publishes MSMA 2nd Edition Equation 2.2. Its validity
range, 5 minutes to 72 hours, covers every window here exactly. It is the right
instrument and it still fails on coverage. An IDF curve needs 20 to 30 years of continuous
high-resolution record at one spot. JPS found about 135 such sites nationwide and 12 in this
coverage area. Only **11 of 230 stations** sit on one. The other 219 borrow climatology from another
place. The median distance is 11.1 km and the worst is 33.5 km, in convective tropical rain near
a mountain range. The constants are sound. The compromise is the borrowing, and it lands on
95.2% of the chart.

**A station and its own `spVeryHeavy`.** JPS publishes it per station, so this route borrows nothing.
But it is a one hour intensity class. It can mark the 1 hour bar and nothing else. One marked bar beside four bare
ones reads as though only that window matters.

So the chart states measured totals and stops there. `rainBars()` above it already carries the
JPS intensity classes, and `rainState()` above that already prints `HEAVY RAIN`. This card
answers the severity question twice before this chart starts.

## Provenance marks

Attach an asterisk to every value this app worked out. Attach none to a value a feed published.

| bar | value | asterisk |
|---|---|---|
| 1 hour | `hourlyRainfall` | no |
| 3 hours, Selangor | `threeHoursRainfall` | no |
| 3 hours, KL | sum of three clock hours | yes |
| Today | `dailyRainfall` | no |
| 24 hours | odometer difference | yes |
| 72 hours | odometer difference | yes |

One footnote line sits under the chart. Emit it only when an asterisk is on screen:

    * Value derived from archived readings.

A station with every window answered from a feed shows no footnote at all.

## The chart

Five rows. The scale runs from zero to the largest of the five totals, so the widest bar always
fills the width. With no marks to hold, the axis needs no other rule.

A window with no answer draws an em dash in muted ink. The row stays in place. Every station
shows five rows.

Each row carries a `data-tip`. `js/sparktip.js` already labels any `data-tip` and works on
touch. A `title` does not open on a phone, so a `title` is not an option here.

Example tip text:

    24 hours - 180 mm - measured over 26 h

The tip is the only place the measured span appears. On a bar read straight from a feed the tip
carries the window and the figure alone.

## Payload

`api.php` computes every number. The client draws these numbers and calculates nothing. This
follows the standing rule that the server scores a status.

    "acc": {
      "h1":  [32,  0, null],
      "h3":  [78,  0, null],
      "day": [145, 0, null],
      "h24": [180, 1, 26.1],
      "h72": [210, 1, 74.0]
    }

Each row is `[mm, derived, spanHours]`. A window with no answer is `null` in place of the row.
`spanHours` is present only on a window measured from the odometer.

Row labels stay in `js/config.js`, beside `ALERT_TITLE`. The payload carries numbers only.

Cost is about 90 bytes per rainfall station, or 21 KB across 230 stations.

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
- A stale baseline reports its real span, not the window the caller named.
- A KL 3 hour sum with two of three clock hours gives `null`.
- A stale station yields no chart at all.

## Not built

- **No threshold mark.** See the section above for the three sources tested and why each failed.
  Anything that adds one has to answer that section first.
- No new alert. This chart moves no count, no icon badge, no ticker item and no toast.
- `RAIN_STOPS` stays at 10, 30 and 60. The feed publishes 5, 11, 31 and 61 per station. Those
  numbers drive pin color, heat weight and `rainStatus()`, which are alert surfaces. That change
  goes through the alert design standard on its own.
- This app scores the rainfall status pill. JPS does not. By the asterisk rule it needs one.
  It is an alert surface, so it is out of scope here.
- KL columns 6 to 11 stay unparsed. See the data sources section.
- MSMA constants stay untranscribed. Three text extractions of Appendix 2.B gave three different
  `lambda` for one station. Two of them shifted a column and still read as a clean table.
  Do not attempt that transcription until a surface needs it.

## Sources

- MSMA 2nd Edition, 2012, DID Malaysia. Chapter 2, Quantity Design Fundamentals. Equation 2.2 and
  Appendix 2.B. Used here to price two warning levels, not to mark the chart.
- JPS Selangor detail endpoint, `StationRainfalls/{id}`. Sampled 2026-08-12.
- MET Malaysia warning criteria page. Words only, no numbers.
- Flash Flood Guidance practice, for the reason to publish nested windows at all.
