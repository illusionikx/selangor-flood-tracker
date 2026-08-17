# The JPS notice feeds join the warning surface

**Date:** 2026-08-17
**Status:** approved, ready for a plan

## Goal

Add the three notice feeds at `publicinfobanjir.water.gov.my/ramalan/` to the map.

The flood alert and the weather alert become rows in the warning surface that already exists. The
media statement becomes one outbound link. No count moves and no new alert surface appears.

A second goal follows from the first. The app must be able to tell a quiet notice feed from a dead
one. It cannot do that today.

## Why

A reader asked for all three feeds on 2026-08-14. The repository deferred them on that date, because
all three pages held no rows. This work measured each page again on 2026-08-17 and found a different
picture.

### The MET warning source is seven days dead, and nothing said so

`api.data.gov.my/weather/warning` answers with 7 rows. Every row carries an issue stamp of
2026-08-10, and most expired on 2026-08-13. The payload reports `metwarn.parsed: 0`. That count is
correct, because the geography filter refuses week-old warnings about Phuket.

The JPS mirror of the same MET bulletins answers with rows issued at 08:21 and 08:31 on 2026-08-17.
Two of those rows name the waters of Selangor. Each one ran from 08:00 to 12:00 on the day of
measurement.

So the map showed no warning while a live warning for this coverage area existed. The repository
already states this failure shape in its own words. A scraper here must not make a quiet feed and a
moved feed look the same.

### The pages hold endpoints, not empty tables

The earlier reading called all three pages empty. Each page renders its table with JavaScript. The
tables are therefore empty in the HTML, and the data sits behind a request.

| page | mechanism | state on 2026-08-17 |
|---|---|---|
| `ramalan/amaran-banjir/` | `query/getdisse.php`, JSON | `[]` |
| `ramalan/met-alert/` | five static JSON files | 3 of 5 hold rows |
| `ramalan/pernyataan-media/` | server-rendered, no request | no rows |

### The flood alert is the strongest alert shape available here

`getdisse.php` publishes a `NotificationTypeCode` per row. The set maps onto the CAP message types
almost exactly.

| code | meaning | CAP |
|---|---|---|
| `NT_7D` | Early | Alert |
| `NT_2D` | Final | Alert |
| `NT_UP` | Update | Update |
| `NT_DF` | Siren | Alert |
| `NT_MET` | Meteorologi | Alert |
| `NT_TM` | Termination | Cancel |
| `NT_RC` | Recall | Cancel |
| `NT_NF` | No Flood | Cancel |

Rows also carry `State`, `POIType`, `POINew`, `MessageDT`, `EstimatedDT`, `EstimatedEndDT`, `hide`
and map geometry. A validity window and a withdrawal path is what the alert design standard asks an
alert to have.

## Decisions

Six decisions shape this work. A reader made each one.

1. **The app merges both MET sources and prefers the fresher row.** It does not replace one source
   with the other. Either source can go quiet, and the merge survives that.
2. **The flood alert takes the surface the MET warning already has.** A section in the alert list, a
   tile on the ticker while fresh, and one modal with the full text.
3. **The media statement becomes one outbound link.** No parser and no payload field.
4. **A notice feed announces its own death by the age of its newest row.** A heartbeat covers the
   feeds that are legitimately empty.
5. **One array carries every notice, and a `kind` field separates them.** The client keeps reading
   one array.
6. **No count moves.** Not the alert number, the icon badge, the app bar glyph, the toast or the
   window title.

## What gets built

### Five page-cache keys

| key | URL suffix under `wp-content/themes/enlighten/` | TTL | role |
|---|---|---|---|
| `jps-flood` | `query/getdisse.php` | 300 s | flood alert |
| `jps-rain` | `data/met_rain22.json` | 900 s | continuous rain |
| `jps-storm` | `data/met_thunderain2.json` | 900 s | thunderstorm |
| `jps-sea` | `data/met_gelora.json` | 900 s | strong wind and rough seas |
| `jps-beat` | `data/met_cyclone.json` | 900 s | heartbeat only |

`jps-flood` takes the shorter TTL because it is the only true flood alarm here. Its response is 2
bytes today. A late flood alert costs more than the request does.

The other four take `MET_WARN_TTL`, which is the window MET warnings already use.

`data/met_earthquake.json` is not fetched. `WARN_DROP` holds `earthquake` and `tsunami`, so every
row of that file drops. Fetching it spends a request to discard the answer.

### `jsonLoose()` in `sources.php`

JPS writes raw newline characters inside JSON string values. `json_decode()` therefore returns null
on `met_gelora.json`. The failure is silent, because a null decode and an empty feed look the same
to a caller that tests `is_array()`.

`jsonLoose()` walks the text and tracks whether the cursor sits inside a string literal. It honours
the backslash escape. It escapes any control character it finds inside a string, and it changes
nothing outside one.

Measured against all five files on 2026-08-17: four decode the same either way, and `met_gelora`
goes from a parse failure to 2 rows.

`pageHasData()` must test these keys with `jsonLoose()`. A test with `json_decode()` reads a good
page as an outage.

### `jpsMetWarnings()` in `sources.php`

Maps a JPS MET row onto the row shape `metWarnings()` already emits.

| JPS field | app field |
|---|---|
| `Heading_EN` | `title` |
| `Msg_EN` | `text` |
| `Valid_from` | `from` |
| `Valid_to` | `to` |

The function adds `kind: 'weather'` and `src: 'jps'`.

`Msg_EN_EarthQuake` is not read, because the earthquake file is not fetched.

JPS stamps `17-08-2026 08:00:00`. `strtotime()` reads that correctly. PHP assumes the European
`d-m-y` order when the separator is a dash. This work measured that.

### `floodAlerts()` in `sources.php`

Maps a `getdisse.php` row onto the same shape, with `kind: 'flood'`.

The function drops a row that carries `hide == '1'`. JPS operators hide a message through a
`update_showhidefloodalert.php` endpoint, so the flag is a decision the source made.

The function keeps `NT_7D`, `NT_2D`, `NT_UP`, `NT_DF` and `NT_MET`. It drops `NT_TM`, `NT_RC` and
`NT_NF`.

The three dropped codes are withdrawals. Every surface here renders a notice only inside its
validity window, so an alert that ended leaves the panel without help. A withdrawal row restates
that. It also appears alone whenever the alert it withdraws expired between two polls.

### Paragraph-level geography

This is a new rule, and it repairs the existing path as well as the new one.

`met_gelora.json` carries a national bulletin in one row. Measured on 2026-08-17: 1,795 characters
across 16 lines, naming Sarawak, Sabah, Selangor, Perlis, Kedah and Perak together.

`WARN_HERE` keeps that row on the word `selangor`. The panel then prints a wall of text that is
mostly about Borneo.

So the filter splits the text on sentence and line boundaries first. It keeps only the parts that
name somewhere this map covers. It then rejoins those parts. On the measured row that reduces 1,795
characters to a single 203-character sentence.

Every row-level rule stays as it is. This work leaves the validity window, `WARN_DROP`, the sea
test, the `WARN_SEA_FAR` cut and the `WARN_HERE` test exactly as they stand.

### The merge

All three producers emit one row shape, so the merge is short.

1. Concatenate the rows from `metWarnings()`, `jpsMetWarnings()` and `floodAlerts()`.
2. Sort on `from`, newest first.
3. Apply the `title|text` duplicate test `metWarnings()` already runs.

The sort puts the fresher copy of a repeated bulletin first, so the duplicate test drops the older
one. The duplicate key lowercases the title, because JPS writes a heading in capitals and
`data.gov.my` does not.

The duplicate test already earns its place inside one source. `met_gelora.json` held two identical
rows on the day of measurement.

### Liveness

Two faults need two names.

**`sources.stale` keeps its meaning and does not change.** It lists the page keys the server asked
for and did not get. `pageRow()` writes it at the fetch layer, and `pageHasData()` decides what
counts as an answer.

**`sources.old` is new.** It lists the page keys that answered with nothing recent. A source whose
newest row is older than a maximum age for that source goes in it.

An age test cannot live in `pageHasData()`. That function asks what kind of document arrived. A
failure there also discards the stored copy and delays the retry. A week-old bulletin is a real
bulletin.

`jps-beat` supplies the heartbeat. `met_cyclone.json` carries a row at all times, and today that row
reads `No Advisory`. `WARN_DROP` already holds `no advisory`, so the heartbeat needs no new
rule and can never reach a surface.

An empty or unreadable `met_cyclone.json` marks the whole JPS MET mirror as old. That is the only
liveness evidence available for `jps-rain`, which is legitimately empty on most days.

`jps-flood` gets the structural check alone. It answers `[]`, and no content test can tell a quiet
forecast from a moved endpoint.

On the data measured for this spec, `sources.old` reads `["met-warn"]` and `sources.stale` is empty.

`watch.php` gains one line beside the line it already has for `sources.stale`. It reports a change
of state, so the fault logs once.

### Client

`kind` selects a glyph and a heading word. Nothing else changes.

`bannerCard()` in `js/alerts.js` and the tile builder in `js/ticker.js` keep iterating one
`state.warnings` array. A `weather` row renders as it does today.

The words go in `ALERT_TITLE` in `js/config.js`. Two surfaces read them, and `js/popup.js` cannot
import `js/alerts.js`.

`data-warn` still indexes `state.warnings` before the freshness filter. That rule does not change,
because the array gains rows and keeps its order.

### The media statement link

One link in the About dialog, beside the `HOTLINES` directory.

The page is a list of PDF documents. It is not an alarm, and it fails the alert design standard on
that alone.

The standard cites the milling literature, which says a reader confirms a warning across channels.
An outbound link is what that reader needs, and it is the whole of what a document list can
honestly give.

## What this work does not build

**Siren backing from `NT_DF`.** JPS publishes an official siren notification. That is stronger
evidence than `sirenBacked()`'s current rule, which looks for a river at its Amaran mark within 5 km.
15 of the 17 alarms on record carried no backing, so the gain is real.

This work leaves it out because it changes `sirenBacked()`, which drives `sounding()`,
`isCritical()` and two reds. That goes through the alert design standard on its own.

**POI geometry.** `getdisse.php` carries it. Nothing plots it, so nothing parses it.

**A flood-alert count.** The same rule that keeps a MET warning out of every count keeps this out.
A notice is a claim JPS makes about an area. A count is a claim this app makes about a sensor.

**A reader-facing staleness notice.** `sources.old` reaches `watch.php` and no screen. The merge
already protects a reader, because a reader keeps seeing rows from whichever source is alive.

**A media statement parser.** See the link decision above.

## Open risk

`floodAlerts()` has never seen a row.

The field names in this spec come from the consumer JavaScript on the JPS page, which this work read.
That is evidence and not a guess. The parser still ships untested against real data, and `jps-flood`
carries structural liveness alone.

The first non-empty response is the moment to check the parser by hand.

This spec accepts the risk rather than solves it. The alternative is to wait. The repository already
waited three days, and a live Selangor warning stayed off the map for a different reason.

## How to verify

```bash
php -l api.php && php -l sources.php

# Every JPS MET file must decode. met_gelora fails a plain json_decode and must not fail here.
# A zero-row file is a real state. A null decode is not.
php -r 'require "sources.php";
foreach (["met_rain22","met_thunderain2","met_cyclone","met_gelora"] as $f) {
  $u = "https://publicinfobanjir.water.gov.my/wp-content/themes/enlighten/data/$f.json";
  $c = curl_init($u); curl_setopt_array($c,[CURLOPT_RETURNTRANSFER=>1,CURLOPT_SSL_VERIFYPEER=>0,CURLOPT_TIMEOUT=>20]);
  $b = curl_exec($c); curl_close($c);
  $j = json_decode(jsonLoose($b), true);
  printf("%-18s %s\n", $f, $j === null ? "NULL — ".json_last_error_msg() : count($j)." rows"); }'

# The two liveness signals must stay apart. `stale` means no answer. `old` means a stale answer.
# On the data this spec measured, `old` holds met-warn and `stale` is empty.
curl -sk https://flood-exp.test/api.php | php -r '$s=json_decode(stream_get_contents(STDIN),true)["sources"];
echo "stale: ",json_encode($s["stale"]),"\n  old: ",json_encode($s["old"]??null),"\n";'

# Which notices survive the filter, and where each came from. A `flood` row is a JPS forecast.
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
foreach($p["warnings"] as $w) printf("%-8s %-5s %s\n  %s\n", $w["kind"], $w["src"]??"?",
  substr($w["title"],0,60), substr(preg_replace("/\s+/"," ",$w["text"]),0,150));'

# No notice text may name only places this map does not cover. This is the paragraph filter's check.
# A row naming Sarawak alone means the split kept the wrong part of a national bulletin.
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
$here=["selangor","kuala lumpur","putrajaya","klang","melaka","malacca","west coast","pantai barat"];
$bad=0; foreach($p["warnings"] as $w){ $t=strtolower($w["text"]); $ok=false;
 foreach($here as $k) if(str_contains($t,$k)){$ok=true;break;}
 if(!$ok){$bad++; echo "  NAMES NOWHERE HERE: ",substr($w["title"],0,60),"\n";} }
echo $bad?"FAIL: $bad rows\n":"OK: every row names somewhere this map covers\n";'

# watch.php must report an old source and must stay silent on a healthy payload.
rm -f .watch.state
curl -sk https://flood-exp.test/api.php | php watch.php; echo "live payload -> $?"

# The media statement link must reach the JPS page.
curl -sk -o /dev/null -w '%{http_code}\n' "https://publicinfobanjir.water.gov.my/ramalan/pernyataan-media/?lang=en"
```
