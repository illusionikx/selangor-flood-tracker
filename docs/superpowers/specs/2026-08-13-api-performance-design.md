# API performance and error handling

Date: 2026-08-13
Status: approved, not yet implemented

## Why

The camera wall sends one request per tile. A reader reported timeouts. This document records what
the measurements found, and what to change.

The investigation found a larger problem behind the reported one. This server sends JPS about
176,832 requests each day. A third of them read one timestamp that another endpoint already dates.

## Method

Every claim below names the file and line that carries it. The first draft of this document made
two errors, and both had one cause. It read what an upstream endpoint *contains*. It did not read
what `api.php` *consumes*. Trace the consumer before you call a field unnecessary.

## Measurements

All numbers come from the live instance on 2026-08-13.

| item | measured |
|---|---|
| cold poll, cache expired | 36.5 s |
| warm poll | 0.08 s |
| payload | about 312 KB raw, 33.5 KB gzipped |
| detail calls per rebuild | 614 |
| one `?cam=` still | 271 KB, 0.80 s, a live JPS fetch every time |
| cameras that hold stored frames | 91 of 93 |
| JS on landing | 156 KB gzipped, 21 separate requests |
| CSS on landing | 80 KB gzipped |
| import graph depth | 7 levels |
| `water.json` | 242 KB gzipped |

## Verified findings

| id | finding | evidence |
|---|---|---|
| F1 | The session lock runs every request from one browser in series | staircase below |
| F2 | 212 siren details each rebuild read one timestamp | the `$detailUrls` build and the siren `status` field |
| F3 | `?cam=` fetches JPS live on every request and holds no cache | the `?cam=` handler |
| F4 | `?cam=` decodes about 312 KB of JSON to find one URL | the `?cam=` handler |
| F5 | The wall loads a live still per tile, then discards it | `tileHtml()`, `arm()` |
| F6 | No route serves the newest stored frame | the `?shot=` handler demands `t > 0` |
| F7 | The payload sets no cache header of its own | header dump |
| F8 | Five modules serve panels only | import map below |
| F9 | No `fetch()` in the client sets a timeout or retries | five call sites |
| F10 | The import graph is 7 levels deep and nothing preloads it | depth scan |
| F11 | `water.json` loads on landing for a dark theme reader | the `applyTheme()` call at module load, `setBasemap()` |
| F12 | `chunkedLoading` is not set, and markers arrive in bulk | the `cluster` options, `syncCluster()` |

### F1. The session lock

PHP runs with `session.auto_start=1`. The file session handler holds an exclusive lock for the whole
request. Every request that carries the same `PHPSESSID` therefore runs one at a time. A browser
sends the same cookie on all of its requests.

Six concurrent `?cam=` requests returned like this:

```
shared cookie : 1.93s  3.04s  4.29s  5.35s  6.07s  6.88s   wall 8.3s
no cookie     : 1.50s  1.75s  1.75s  1.80s  2.86s  2.99s   wall 3.4s
```

Four concurrent cheap requests with no shared cookie finish in 347 ms. The pool therefore holds at
least four workers. Worker starvation does not explain the staircase. The lock does.

`api.php`, `sources.php` and `shots.php` never read `$_SESSION`.

Ninety tiles run the same way. The poll queues behind them. This is the reported timeout.

### F2. The siren fan out

The siren list carries `status` and `stationStatus`. the `'status'` field already reads the status from
the list. The siren detail adds only `statusLastUpdate`. the `$detailUrls` build states this in its own
comment.

That timestamp does two jobs. It feeds the 48 hour staleness check at the `$stale` test. It also stamps
every siren sample at the siren block of the history pass, through `readTs()`.

## Section 1 — Reduce the load on JPS

### 1a. Sirens

Read `status` from the list. Fetch a siren detail only when the list status is not zero.

Refresh `statusLastUpdate` for every other siren once each hour. That gives 212 calls 24 times each
day, in place of 212 calls every five minutes. It saves about 55,968 requests each day.

**Use one hour, not six.** the siren block of the history pass samples every online siren into `.history.db`. It stamps
each sample from `statusLastUpdate`. The `(station, ts)` primary key drops a repeated stamp. A six
hour stamp therefore collapses six hours of siren samples into one row. It also spends 12.5% of the
48 hour staleness budget before the check runs.

Alarm latency does not change. The status still arrives on every poll.

### 1b. Cache `?cam=` on the server

Store each still on disk for 300 s. That is the lifetime the response header already claims. JPS
then answers at most one request per camera per five minutes. The number of readers does not change
that.

Keep this endpoint live. `?cam=` means the current picture. The lightbox asks the live question at
its live position, so this endpoint must not answer from the archive.

### 1c. Take the wall off the JPS path

`tileHtml()` writes `api.php?cam=` into each tile. `arm()` at `arm()` replaces that
picture with the strip about one second later. The still costs 271 KB and one JPS fetch. The reader
sees it for one second.

**Add a server route first.** the `?shot=` handler demands `t > 0`, so nothing serves the newest stored
frame. `shotList()` returns frames oldest first, so the newest one is the last entry.

Serve the newest stored frame from `?shot=<id>` with no `t`.

Give that form `Cache-Control: public, max-age=900`. Do not give it `immutable`. The `&t=` form
names one frame that never changes again, so a year is honest there. The newest frame changes every
`SHOT_EVERY`. The `?sheet=` comment already states this reasoning.

Then change the caller. `tileHtml()` writes `api.php?shot=<id>` as the tile source. `arm()` probes
`?sheet=` as it does now. A camera with no stored frame answers 404. The tile then falls back to
`api.php?cam=` through the error path `onSettle()` already runs.

91 of 93 cameras hold stored frames, so that fallback is rare.

### Effect

Rebuild traffic falls from about 176,832 requests each day to about 120,900. Section 1a carries that
whole reduction.

Sections 1b and 1c cut reader driven traffic instead. That traffic sits outside the rebuild total.
The wall leaves it completely.

## Section 2 — Fix the timeout

### 2a. Close the session

Call `session_write_close()` as the first statement in `api.php`. This releases the lock at once.
One line removes the staircase.

### 2b. Stop decoding the whole cache for one URL

the `?cam=` handler decodes about 312 KB of JSON to find one camera URL. Section 1b answers most requests
from the still cache, and a cache hit needs no lookup at all.

Write a small map of camera id to URL at the end of each rebuild. A cache miss reads that map.

### 2c. Give the payload its own cache headers

Herd serves every response with `Cache-Control: public, max-age=10800`. The payload sets no header
of its own. A browser can therefore answer every poll from its own cache for three hours.

Set an explicit `Cache-Control` on the payload. Add an `ETag`. An unchanged payload then returns 304
and about 200 bytes.

## Section 3 — Load panel code on demand

Five modules serve panels only. They cost 44 KB gzipped and five requests on landing.

| module | gzipped | imported by | called from |
|---|---|---|---|
| `timeline.js` | 15.4 KB | `ui.js` | the lightbox opener, a handler |
| `table.js` | 9.4 KB | `ui.js`, `render.js`, `locate.js` | the table opener, two guarded on `dataBox.open` |
| `wall.js` | 8.9 KB | `ui.js`, `render.js` | the wall opener, rest guarded on `camBox.open` |
| `test.js` | 5.6 KB | `net.js`, `ui.js` | see below |
| `clip.js` | 4.6 KB | `map.js` | card open and card close |

Use dynamic `import()`. Do not add a build step.

The two call sites in `render.js` stay synchronous. Use `import('./x.js').then(m => ...)` there.
Both sites already test `dialog.open`, so the browser holds the module before they run. This keeps
the poll path off `async`.

### test.js runs on landing today

that same landing call calls `paintTestChrome()` at module load. That call is a no operation. `state.test`
starts false at `state.test`, and the test mode block in `js/ui.js` states that the flag is session only. The
function only toggles a class from that flag.

Delete the call at that same landing call. Import `test.js` when the toggle turns on. `load()` and
the `onchange` handler on the toggle already sit behind `state.test`.

`test.js` inserts `#testbadge` at import time. CSS shows that badge only under `body.testmode`, so a
reader who never enters test mode never needs it.

### The clip ordering hazard

`js/map.js` calls `clip.start()` when a card opens. It calls `clip.stop()` when the card closes. A
deferred import opens a gap between those two calls. A reader can close the card inside that gap.
`stop()` then does nothing, and `start()` plays a clip on a closed card.

Hold one module promise at module scope. Chain both calls through it. Callbacks on one promise run
in registration order, so the two calls keep their order.

### The loading state

Add `js/lazy.js`:

```js
export async function lazy(load, box) {
  const t = setTimeout(() => box?.setAttribute('aria-busy', 'true'), 150);
  try { return await load(); }
  finally { clearTimeout(t); box?.removeAttribute('aria-busy'); }
}
```

CSS draws the skeleton from `[aria-busy="true"]`. One attribute drives the screen reader state and
the visible state. The two cannot drift apart.

The 150 ms delay is necessary. A same origin import of a 9 KB to 15 KB module takes about 10 ms to
40 ms when warm. A skeleton that appears for 20 ms is a flash. A flash reads worse than no skeleton.

Reuse the shimmer at `.camtile::before` in `css/chrome.css`. Promote it to a shared class in `css/base.css`. Do not
write a second skeleton look. The reduced motion rule at its reduced motion rule moves with it.

| surface | container | loading state |
|---|---|---|
| table dialog | `#dataBox`, `index.html` | about 8 placeholder rows at the real row height |
| camera wall | `#camGrid`, `index.html` | about 12 skeleton tiles at `aspect-ratio: 16 / 9` |
| lightbox bar | `#tl`, `index.html` | a reserved bar at the real height |
| station card clip | none | none |
| test toggle | `#testMode` | `disabled` and `aria-busy` |

All four containers are static markup, so each skeleton has somewhere to draw before its module
lands. `#tl` carries `hidden`, so the skeleton must clear that attribute and restore it.

The wall skeleton must carry `grid-auto-rows: min-content`. Without it the tiles overlap. See the
grid row gotcha in `CLAUDE.md`.

The lightbox bar must hold its height. `#tl` sits in the flow on touch and at narrow widths. An
absent bar shifts the picture when the real bar arrives.

The station card clip shows a still already. `CLAUDE.md` names a silent fallback to a visible
picture as one of the two allowed shapes. Add nothing there.

### The failure path

A module that fails to load leaves a dialog shimmering forever. `lazy()` must catch that failure.
The box then takes a `.loadfail` state with one sentence and a retry control.

Write that sentence in sentence case. State the verdict. Do not hedge. Do not use our own words for
the plumbing.

## Section 4 — Handle API errors

The client holds five `fetch()` call sites. None of them sets a timeout. None of them retries.
`fetch()` has no timeout of its own.

| id | finding | effect |
|---|---|---|
| 4a | no request can time out | a hung worker holds the splash open forever |
| 4b | `load()` calls `r.json()` before it tests `r.ok` | an HTML error page becomes a JSON parse error |
| 4c | `network()` renders the raw `e.message` | the reader sees `Unexpected token '<'` |
| 4d | `network()` sets `last = null` on a failure | the app stops stating the age of the data on screen |
| 4e | the `?shots=` fetch turns a failed fetch into `rows = []` | the scrubber claims the camera has no archive |
| 4f | no retry | one short fault holds the red dot for five minutes |

the `header('Content-Type: application/json')` before the rebuild sets `Content-Type: application/json` before it does the work. A PHP fatal after that
point sends an HTML page under a JSON content type. `?place=` already guards against this. The main
path does not.

### The fix

1. Write one wrapper. Use `AbortSignal.timeout(ms)`. Test `r.ok` in that one place. Allow 45 s on
   the first load, because a cold rebuild measured 36.5 s. Allow 20 s on a poll, because Section 1
   keeps the cache warm.
2. Write two messages. Show `No connection.` when `navigator.onLine` is false. Show `Could not reach
   the server.` for every other fault. The reader makes the same decision in both cases.
3. Keep `last`. The popover must keep stating how old the readings on screen are. Add a problem row
   beside that age.
4. Retry once with a short delay. Fall back to the state above.
5. Add `set_exception_handler()` and `register_shutdown_function()` to `api.php`. Emit JSON.
6. Make `js/timeline.js` tell an empty archive apart from a failed request. State which one happened.

None of this touches the alert count, the icon badge, the ticker or the toast. A network fault is a
maintenance problem. It is not a flood.

## Section 5 — First visit

| id | finding | fix |
|---|---|---|
| 5a | the import graph is 7 levels deep and nothing preloads it | add `<link rel="modulepreload">` |
| 5b | nothing preconnects to `basemaps.cartocdn.com` | add `<link rel="preconnect">` |
| 5c | `water.json` costs 242 KB on landing for a dark theme reader | fetch it after the first render |
| 5d | `chunkedLoading` is not set on the cluster | set it |

5a is the largest of these. The browser finds each import level only after it parses the level
above. The payload request therefore waits for seven round trips. At a 100 ms round trip that is
about 700 ms.

5a covers 16 modules, which is 21 less the five that Section 3 defers. Never preload a deferred
module. A preload loads it eagerly and undoes Section 3.

This repository has no build step to write those links. They can go stale when somebody adds a
module. Add a check to the Verify block.

5c is decoration. `setWater()` states that a map without water is a plainer map, not a broken one.
the `applyTheme()` call at module load runs `applyTheme()` at module load, and `setBasemap()` calls `setWater()` from it.
The landing costs 271 KB without the file. `water.json` nearly doubles that.

5d applies because `syncCluster()` adds markers through `addLayers()`. The option only affects that
bulk call. `render()` blocks while it builds 417 site markers. `load()` states this.

## Not built

- **A longer cache on the camera detail.** The detail carries `lastUpdate` as well as `imageUrl`.
  the `'shot'` field publishes it as `shot`. `idle()` in `js/clip.js` prints it to the reader as `Latest image ·
  14:15`. A cached detail puts a stale timestamp under a live picture. `CLAUDE.md` records the same
  failure for the MET stamp. This costs 93 calls each rebuild, and it stays.
- **Deferred `history` and `met` in the payload.** Measured at 6.4 KB gzipped and 2 ms of parse
  time. The cost is a spinner on every card open. It also fights the rule that `render()` refreshes
  the open card in place on every poll.
- **Request coalescing on `?cam=`.** Section 1b closes all but a one second window.
- **A lower `TTL` for water.** The archive holds 7,106 sample gaps over 24 hours. The median gap is
  15 minutes. The tenth percentile is 3 minutes. A flood is when that matters.
- **A capture cron.** The always-on server already captures every 30 minutes.
- **A build step.** Dynamic `import()`, `modulepreload` and `AbortSignal.timeout()` are native.
- **A font preload.** `font-display: swap` shows text at once already.
- **Lower coordinate precision in `water.json`.** The file holds 4 decimals already. Rounding to 5
  decimals saves nothing.

## Order of work

Ship 2a first and alone. It is one line, and it is the fault the reader reported.

Then Section 1, then Section 4, then Sections 3 and 5.

## Verify

```bash
php -l api.php && php -l sources.php
php api.php --selftest
php shots-test.php

# Detail calls per rebuild. Expect about 402, down from 614. Expect 614 once each hour, when the
# siren sweep runs. Expect more than 402 whenever a siren list status is not zero.
curl -sk https://flood-exp.test/api.php \
  | php -r 'echo json_decode(stream_get_contents(STDIN),true)["details"]["requested"],"\n";'

# The session lock. Six concurrent stills must not return in a staircase.
J=/tmp/cj.txt; curl -sk -c $J -o /dev/null "https://flood-exp.test/api.php"
for i in 1 2 3 4 5 6; do
  curl -sk -b $J -o /dev/null -w '%{time_total}\n' "https://flood-exp.test/api.php?cam=1271&x=$i" &
done; wait

# The newest frame route must answer, and must not claim to be immutable.
curl -sk -o /dev/null -D - "https://flood-exp.test/api.php?shot=1271" | grep -i 'http/\|cache-control'

# Siren history must keep its resolution. Distinct stamps per siren over 24 hours.
php -r '$db=new PDO("sqlite:.history.db");
$r=$db->query("SELECT COUNT(*) c, COUNT(DISTINCT station) s FROM level
  WHERE station LIKE \"siren-%\" AND ts > strftime(\"%s\",\"now\")-86400")->fetch();
echo $r["c"]," samples over ",$r["s"]," sirens\n";'

# The payload must carry its own cache header and an ETag.
curl -sk -o /dev/null -D - "https://flood-exp.test/api.php" | grep -i 'cache-control\|etag'

# Every module must carry a modulepreload link, except the five Section 3 defers.
for f in js/*.js; do
  case $(basename $f) in timeline.js|table.js|wall.js|test.js|clip.js) continue;; esac
  grep -q "$f" index.html || echo "MISSING modulepreload: $f"
done
```
