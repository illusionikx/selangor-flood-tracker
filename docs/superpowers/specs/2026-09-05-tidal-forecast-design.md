# Tidal stations get no forecast

Date: 2026-09-05

## Goal

Stop the `rising` forecast from firing on the tide.

Thirteen water level stations on the coast and in the Klang estuary rise and fall with the sea.
Each one climbs 0.5 to 0.7 m/h twice a day. The forecast extrapolates that climb to the danger
mark and fires. The tide then turns. Over 30 days of archive, 81 of 103 forecast firings were
tidal. Not one was correct.

The forecast reaches four surfaces: the `FORECAST` rows in the alert list, the app bar badge, the
ticker and the toast. Every one of them cried wolf on the tide.

This design derives a `tidal` flag from the archive and withholds the forecast on a tidal station.
It touches nothing else that alerts.

## What the archive says

The measurements below come from `.history.db` on 2026-09-05, 30 days, 120 rivers. Three
throwaway scripts replayed the live rule and three candidate rules over the same samples.

| station | daily swing | `rising` fired in 30 days | days at Waspada or Amaran |
|---|---|---|---|
| KG. RANTAU PANJANG (Klang) | 2.89 m | 21 | 5 |
| SELAT MUARA | 2.60 m | 16 | 1 |
| P/A PEKAN TG. KARANG | 2.32 m | 14 | 2 |
| RIMBA KDR | 2.12 m | 14 | 7 |
| BANDAR KLANG | 2.53 m | 11 | 3 |
| TELUK PENYAMUN (JETI) | 2.59 m | 5 | 1 |

Every inland river swings under 0.3 m on an ordinary day.

**The 24-hour envelope guard leaks for a week each fortnight.** The guard asks that the level beat
its own 24-hour high. From neap to spring, each high tide beats the one before it, for seven
days. So the guard holds for one week and fails the next.

A 15-day envelope halves the firings and does not stop them. A 30-day envelope stops them on
this archive and leaks on any king tide higher than the month before. The equinox springs climb
month over month.

**A king tide is a real hazard, and the forecast is still wrong about it.** Selangor issued a
state-wide high tide warning for 18 to 22 February 2026. The prediction put Port Klang at 4.8 to
5.23 m. JPS tweeted BANDAR KLANG over Amaran at 05:45 on 17 February, which is that tide. So the
crossing is not noise. It is a different claim: predictable, brief, coastal.

The `now` tier at the danger mark still fires on a tidal station. Only the straight-line
forecast goes, because a straight line through a tide has no skill.

**At a tidal station the daily low sits in a tight band.** The lows at BANDAR KLANG sit between
-0.47 and -0.72 m over 23 days. The highs swing from 0.45 to 2.61 m with the moon. A river flood
lifts the low. That is the honest flood signal at an estuary, and it is the upgrade path below.

## The rule

A refresh derives `tidal` for every river from the archive. The refresh stores nothing. No
station list exists, and the gotcha that forbids one stands.

One SQL aggregation runs beside the `$hist` load in `api.php`:

    SELECT station, (ts + 28800) / 86400 AS d, MAX(level) - MIN(level) AS r, COUNT(*) AS n
    FROM level
    WHERE station NOT LIKE '%#%' AND ts >= :since
    GROUP BY station, d

`:since` is now minus `TIDE_WIN`. Measured: 890 station-days in 84 ms. The `28800` puts the day
boundary on Malaysian midnight, and Malaysia has no daylight saving. The bucket only measures a
swing, so the boundary does not matter much. It is there so a day is a day. Every station is
grouped, because an id carries no kind. The trend pass reads the map for rivers alone. The `#`
test keeps the rainfall odometer series out, since those rows are totals and not levels.

A pure function reads the per-day ranges:

    tidalRange(array $ranges): bool

It applies four tests, in this order:

1. Drop any day with fewer than `TIDE_SAMPLES` (4) samples. Two samples cannot hold a range.
2. Fewer than `TIDE_DAYS` (5) days left answers false. A new station is not tidal until the
   archive can say so.
3. Take the lower quartile of the remaining ranges.
4. Answer true when that quartile is at or above `TIDE_RANGE` (0.5 m) and under `TIDE_CEIL`
   (6 m).

The SQL does step 1 in PHP after the fetch, so `tidalRange()` receives every day and stays
testable on its own.

**Why the lower quartile and not the median.** BATU 9, HULU LANGAT had one wet week. Its median
daily range reached 0.72 m and its lower quartile stayed at 0.06 m. A tidal fortnight swings on
every day, so its smallest quartile is its neap days, and those still reach 0.67 m and up.
Measured over 15 days, the lower quartile splits the set cleanly: 13 coastal stations at 0.67 m
and above, every inland river at 0.36 m and below.

**Why 0.5 m.** It sits in the middle of that gap, 0.14 m from each side.

**Why 6 m.** Six feeds drop to 0.00 for hours and come back. ULU YAM reads 32.5 m and 0.00 on the
same day, so its daily range is 32 m. No tide in Malaysia reaches 6 m. The spring range at Port
Klang is 4.6 m at the port and less upstream.

**Why 15 days.** One spring-neap cycle is 14.8 days. A window that holds one cycle sees a neap
whatever day it runs.

**Why 5 days.** The development archive has gaps, because the machine sleeps. A production
archive is continuous, and 5 of 15 is the floor that still answers on this one. A fresh
`.history.db` therefore shows tide forecasts for five days. That is the accepted cost of a rule
with no list to seed it.

**Why 4 samples a day.** The national portal delivers about 15 samples a day per station. A day
with 3 or fewer samples is a day the poll mostly missed.

## What changes downstream

**The trend pass.** After `assess()` returns, one line:

    if ($s['tidal']) $eta = null;

`rising` reads `$eta`, so it is false on a tidal station. `rate` is still published. The tide
really climbs at 0.7 m/h, and the card can say so. `assess()` itself does not change.

**The camera strip.** `?shots=` scores each archived frame against the rivers near the camera,
and a river takes `assess()` there too. Its own comment says the strip and the live rule must
agree. So a tidal river takes the closure that never forecasts, the one a siren already takes.
One condition changes.

**A wet fortnight can flag an inland river, and the cost is priced.** A flashy river that swings
0.5 m or more on 12 of 15 days reaches the quartile. It then loses its forecast tier until the
fortnight ends, and keeps its `now` tier. No such fortnight sits in the archive to measure, so
the risk is stated rather than counted. The low-water rule below is the repair: an inland river
in a wet fortnight holds its trough high, and that rule forecasts on exactly that.

**The payload.** Every river carries `tidal`, true or false.

**The card.** `js/popup.js` draws one muted line where a river shows its `Reaches danger`
metric:

    Tidal. Rises and falls with the sea twice a day.

That line says why there is no forecast and why the pin turns amber twice a month. It follows
the four rules for a message on screen: sentence case, no hedge, no plumbing word, no number.

**Nothing else moves.** `js/alerts.js` reads `rising`. `js/ticker.js` and `js/toast.js` read
`eta` only on a station that is already hot. `js/test.js` fakes `rising` on stations of its own
and never reads `tidal`.

## The alert design standard

- **Certainty.** CAP keeps a forecast apart from an observation. This forecast fired 81 times on
  the tide and was correct 0 times. A forecast with no skill is not Likely. It is noise, and the
  replay measured its cry-wolf cost.
- **An alarm requires a response.** ISA-18.2 rationalizes an alarm set by deleting the alarms
  nobody can act on. Nobody acts on a tide.
- **Observed stays.** A tidal station over Bahaya is a `now` row, an Observed and Immediate claim.
  A king tide can put it there.
- **No new suppression control.** `PREFS.ignored` stays the one suppression. This is a rule
  about a forecast's validity, derived from the data, and it heals itself when a station changes.
- **The four open gaps stay four.** This adds none.

## Two faults found and left alone

The replay leaves 23 firings in 30 days once the flag has warmed. Neither group is tidal.

- **PINTU AIR IJOK fired 11 times.** It is a water gate on a controlled pond. It climbed 0.18 m
  in two days and crossed Waspada on four of them. The forecast fired on a slow climb because
  the mark is close. That is a question about gates, not about tides.
- **Eight firings are feeds dropping to 0.00 and back.** A reading that falls 32 m and returns
  is a 32 m/h climb to the rate. The strictly higher test and the envelope both pass. A ceiling
  on the rate is a separate design.

## Deliberately not built

- **A 30-day envelope for every station.** One constant, and it stops the tide on this archive.
  It also withholds the forecast from a river climbing toward danger for the second time in a
  month, until it beats the earlier peak. That is the monsoon case the forecast exists for.
- **A low-water rule at tidal stations.** A tidal station forecasts only when its trough sits
  0.3 m above its normal low. The replay gives it the same false count as this design. It keeps
  a forecast path for an estuary flood. This design defers it because it needs trough finding,
  a band built from 30 days of lows, night samples that are thin, and a flood in the archive to
  show it fires. It is the upgrade path, and the code carries a comment that names it.
- **The amber pin and the status word at Waspada and Amaran on a tide.** The reader named the
  forecast rows alone. The marks belong to JPS, and a spring tide over them is a coastal hazard
  the state warns about.
- **Tide times on the card.** JUPEM publishes predictions through a phone app and no endpoint.
  A seventh upstream host for one line is not worth its outage.

## Checks

`php api.php --selftest` gains cases for `tidalRange()`:

- fifteen days that swing 1.5 to 2.5 m answer true
- fifteen days that swing 0.03 to 0.09 m answer false
- fifteen flat days with one 0.72 m day answer false
- fifteen days at 32 m answer false
- four days that swing 2 m answer false
- a lower quartile of exactly 0.5 m answers true, and exactly 6 m answers false
- a day with three samples counts for nothing

`php -l api.php` and `php -l sources.php` run as before.

`docs/VERIFY.md` gains a sweep that lists the rivers the live payload marks tidal. It asserts a
range, 10 to 16 stations, never an equality. The three replay scripts stay in the scratchpad.
Their numbers live in this document and in `docs/FEATURES.md`.

## Documents

- `docs/FEATURES.md`: a section that states what shipped, the numbers above and the trade-offs.
- `docs/GOTCHAS.md`: the 30-day replay proves the "A tide is a rise" entry wrong. The rewrite
  says the envelope leaks for a week each fortnight and the flag is the guard now. The rule
  against a station list stays in it.
- `CLAUDE.md`: the `rising` bullet in the `api.php` section gains the sixth condition. The
  gotcha index line follows the rewritten entry.
