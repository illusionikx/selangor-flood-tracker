# Camera wall off JPS, and API error handling — Implementation Plan (B of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the camera wall fetching a live still per tile. Give every request a timeout, a
status check, one retry, and a failure message a reader can act on.

**Architecture:** Task 1 changes `js/wall.js` to load the archive route Plan A built. Task 2 makes `api.php` answer a fatal with JSON. Tasks 3 to 5 add one fetch wrapper and route the five call sites through it.

**Tech Stack:** Vanilla ES modules, no build step. PHP 8.2. `AbortSignal.timeout()` is native and needs no library.

**Source spec:** `docs/superpowers/specs/2026-08-13-api-performance-design.md`, Section 1c caller half and all of Section 4.

## What Plan A already landed

Read this before Task 1. These are facts about the server as it stands now.

- `api.php?shot=<id>` with no `t` serves the newest stored frame at `Cache-Control: public, max-age=900`. Measured: **0.062 s and 186 KB**, against **0.977 s and 273 KB** for `?cam=`.
- 91 of 93 cameras hold stored frames. The other two answer 404 on that route.
- `api.php?cam=<id>` now caches on disk for 300 s and sends the remaining life of the file.
- The payload carries `Cache-Control: no-cache` and an `ETag`, so an unchanged poll is a 304 of 0 bytes.

## Global Constraints

- **No test framework, and no harness at all for the client.** `CLAUDE.md` states this repository has
  no test suite. Server logic goes in `php api.php --selftest`. Client changes are verified by
  `node --check`, by the content-type sweep below, and by looking at the page.
- **No build step.** Keep relative import specifiers with the `.js` extension. Add no bundler, no
  package, no dependency.
- **Never pass `cache: 'no-store'` on the payload poll.** Plan A gave the payload an `ETag` so an
  unchanged poll costs 304 and about 200 bytes. `no-store` skips the conditional request and throws
  that away. The force-refresh call in `js/ui.js` keeps `no-store` on purpose, because it exists to
  defeat the cache.
- **A message on screen is written for the reader.** Sentence case. No hedging. None of our own
  words for the plumbing: no `proxy`, no `HTTP`, no `timeout`, no exception text.
- **Nothing here touches the alert count, the icon badge, the ticker or the toast.** A network fault
  is a maintenance problem and not a flood.
- Prose and comments: active voice, sentences under 20 words, no semicolons, no contractions,
  American spelling.
- Never delete `.history.db` or anything under `shots/`. Never run `git clean`.
- Commit directly to `main`. Do not create a branch.
- **`STATIC` mode has no PHP.** `js/config.js` exports `STATIC`, and the GitHub Pages bake sets it
  true. Every new route added here must fall back to what `camSrc()` already builds when `STATIC`
  is true.

## File structure

| file | change |
|---|---|
| `js/wall.js` | tile source comes from the archive, with one fallback to the live still |
| `js/ask.js` | new. One wrapper: timeout, status check, one retry |
| `js/net.js` | poll through the wrapper, keep the data age visible on a failure |
| `js/timeline.js` | tell an empty archive apart from a failed request |
| `js/ui.js` | force refresh and place lookup through the wrapper |
| `api.php` | answer a fatal with JSON |

`js/ask.js` is new because three modules need it and `js/util.js` holds pure helpers with no I/O.

## Client verification, used by every task

```bash
cd d:/Herd/flood-exp
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done

# Herd answers a missing file with index.html and a 200, so check the TYPE, never the status.
for f in js/*.js; do curl -sk -o /dev/null -w "%{content_type} $f\n" "https://flood-exp.test/$f"; done \
  | grep -v javascript
```

Both must print nothing. A silent run is a pass.

---

### Task 1: The wall loads the archive, not a live still

**Files:**
- Modify: `js/wall.js` — the import line, `tileHtml()`, and `onSettle()`

**Interfaces:**
- Consumes: `api.php?shot=<id>` with no `t`, from Plan A. Serves the newest stored frame, or 404
  when a camera has none. `camSrc(s)` from `js/config.js` still builds the live URL.
- Produces: nothing other modules import.

`tileHtml()` writes `api.php?cam=` into every tile today. `arm()` then replaces that picture with the
strip about one second later. The still costs 273 KB and one upstream fetch, and a reader sees it for
one second.

- [ ] **Step 1: Measure what a wall open costs now**

```bash
cd d:/Herd/flood-exp
grep -n 'src="\${camSrc(c)}"\|camSrc(c)' js/wall.js
curl -sk -o /dev/null -w 'live still: %{time_total}s %{size_download}B\n' "https://flood-exp.test/api.php?cam=1271"
curl -sk -o /dev/null -w 'archive   : %{time_total}s %{size_download}B\n' "https://flood-exp.test/api.php?shot=$(ls shots | head -1)"
```

Expected: `camSrc(c)` appears inside `tileHtml()`. The live still takes about 0.9 s and about 273 KB.
The archive frame takes about 0.06 s and about 186 KB. Record both.

- [ ] **Step 2: Import `STATIC`**

`js/wall.js` starts with this import:

```js
import { CLIP_MS, SHEET_W, camSrc } from './config.js';
```

Change it to:

```js
import { CLIP_MS, SHEET_W, STATIC, camSrc } from './config.js';
```

- [ ] **Step 3: Add the tile source helper**

Add this directly above `const tileHtml = c => {` in `js/wall.js`:

```js
/* The first picture a tile shows.
 *
 * The archive holds a frame for 91 of the 93 cameras, and shots.php already has it, so a wall of
 * ninety tiles costs the agency nothing. A live still costs 273 KB and about 0.9 s each. The
 * archived frame costs 186 KB and about 0.06 s, and it is at most SHOT_EVERY old — which is what
 * the strip this tile plays is anyway, so the tile loses no freshness it was going to keep.
 *
 * A camera with no stored frame answers 404, and onSettle() below falls that tile back to the live
 * still exactly once.
 *
 * STATIC has no PHP at all, so it keeps the direct URL camSrc() already builds for that build. */
const tileSrc = (c, id) => STATIC ? camSrc(c) : `api.php?shot=${id}`;
```

- [ ] **Step 4: Use it**

Inside `tileHtml()`, find:

```js
    mapped ? '' : ' disabled'}><img loading="lazy" alt="" src="${camSrc(c)}"><span class="camname"
```

Change `camSrc(c)` to `tileSrc(c, id)`:

```js
    mapped ? '' : ' disabled'}><img loading="lazy" alt="" src="${tileSrc(c, id)}"><span class="camname"
```

- [ ] **Step 5: Fall back once when a camera has no stored frame**

`onSettle()` currently starts:

```js
function onSettle(e) {
  const t = e.target.closest('.camtile');
  if (!t) return;
  if (!t.classList.contains('done')) {
```

Insert the fallback between those last two lines:

```js
function onSettle(e) {
  const t = e.target.closest('.camtile');
  if (!t) return;
  /* Two of the 93 cameras hold no stored frame, so ?shot= answers 404 for them. Spend one live
     fetch on those rather than drawing the No picture panel over a camera that works.
     `data-live` records that the tile has spent that one retry, so a camera that is genuinely dead
     draws the panel instead of alternating between two failing requests forever. The tile is not
     marked `done` here, because it is still loading and `waiting` still counts it. */
  if (e.type === 'error' && !STATIC && !t.dataset.live && t.dataset.lap) {
    t.dataset.live = '1';
    e.target.src = `api.php?cam=${t.dataset.lap}`;
    return;
  }
  if (!t.classList.contains('done')) {
```

- [ ] **Step 6: Check the modules and the types**

Run the client verification block at the top of this plan. Both commands must print nothing.

- [ ] **Step 7: Confirm the wall no longer asks the agency**

```bash
cd d:/Herd/flood-exp
grep -n 'api.php?cam=' js/wall.js
```

Expected: exactly one hit, inside the `onSettle()` fallback. A hit inside `tileHtml()` means Step 4
did not land.

Then open `https://flood-exp.test`, open the camera wall from the app bar menu, and watch the
network panel of the browser developer tools. Expected: the tiles request `api.php?shot=<id>`. At
most two request `api.php?cam=<id>`, and only after a 404. Record how many of each you counted.

- [ ] **Step 8: Confirm a lap still plays and a filter still works**

With the wall open, watch one tile for ten seconds. The picture steps through its lap once a second.
Type a district name into the filter box of the wall. The count line updates and the hidden tiles freeze.

State in your report what you observed for both.

- [ ] **Step 9: Commit**

```bash
git add js/wall.js
git commit -m "Ninety tiles asked the agency for a picture it had already stored

tileHtml wrote api.php?cam= into every tile, and arm() threw that picture
away a second later when the strip arrived. The still cost 273 KB and about
0.9 s each.

The archive holds a frame for 91 of the 93 cameras and answers in 0.06 s at
186 KB. Its frame is at most SHOT_EVERY old, which is what the strip the
tile plays is anyway.

The other two cameras fall back to the live still once, then draw the panel."
```

---

### Task 2: Answer a fatal with JSON

**Files:**
- Modify: `api.php` — add the two handlers directly below the `session_write_close()` block

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other code calls. It changes what a fatal looks like on the wire.

`api.php` sets `Content-Type: application/json` and then does all of its work. A fatal after that
point sends an HTML error page under a JSON content type. The client then fails with a parse error
instead of a message it can act on. The `?place=` handler already guards itself this way.

- [ ] **Step 1: Add the handlers**

Find the `session_write_close()` line near the top of `api.php`. Add this directly below it:

```php
/* A fatal after the first header() sends an HTML error page under a JSON content type, so a client
   that asked for JSON gets a parse error rather than something it can act on. The ?place= handler
   already carries this guard for its own route. This covers every route, including the payload,
   which is every poll this page makes.
   Both handlers refuse to write once the body has started. A payload already on the wire must not
   gain a JSON object glued to its end, and captureShots() runs after that point on every sixth
   poll. A truncated payload the client can report is better than a corrupted one it cannot. */
$fatalJson = function (): void {
    if (headers_sent()) return;
    header('Content-Type: application/json');
    http_response_code(500);
    echo json_encode(['error' => 'server error']);
};
set_exception_handler(function (Throwable $e) use ($fatalJson) { $fatalJson(); });
register_shutdown_function(function () use ($fatalJson) {
    $e = error_get_last();
    if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) $fatalJson();
});
```

- [ ] **Step 2: Confirm an ordinary request is unchanged**

```bash
php -l api.php
php api.php --selftest | tail -1
php shots-test.php | tail -1
curl -sk -o /dev/null -w 'payload: %{http_code} %{content_type} %{size_download}B\n' "https://flood-exp.test/api.php"
curl -sk -o /dev/null -w 'still  : %{http_code} %{content_type}\n' "https://flood-exp.test/api.php?cam=1271"
curl -sk https://flood-exp.test/api.php | tail -c 40
```

Expected: `all ok`, `all passed`, a 200 `application/json` payload of about 340,000 bytes, a 200
`image/jpeg` still, and a payload whose last characters are the end of the JSON object and nothing
after it. Anything appended means the shutdown handler fired at the wrong time.

- [ ] **Step 3: Prove the handler actually fires**

Make a temporary copy and break it on purpose. Do not edit `api.php` itself for this.

```bash
cd d:/Herd/flood-exp
cp api.php .fatal-probe.php
printf '\nundefined_function_on_purpose();\n' >> .fatal-probe.php
curl -sk -o /dev/null -w 'fatal: %{http_code} %{content_type}\n' "https://flood-exp.test/.fatal-probe.php"
curl -sk "https://flood-exp.test/.fatal-probe.php" | tail -c 120
rm -f .fatal-probe.php
```

Expected: status 500, content type `application/json`, and a body ending in a parseable JSON object
rather than an HTML `<br />` block. Record the literal output.

The probe may return 200 with the payload instead. Then the appended line ran after the payload
went out, which is the case the `headers_sent()` guard covers. Say so in your report and move on. That is
correct behavior, not a failure.

- [ ] **Step 4: Commit**

```bash
git add api.php
git commit -m "A fatal sent an HTML page under a JSON content type

This file sets its content type and then does all of its work, so anything
fatal after that point reached the client as an error page it could only
fail to parse. The place lookup already guarded its own route.

Neither handler writes once the body has started. A payload on the wire must
not gain a JSON object glued to its end."
```

---

### Task 3: One way to ask this server for JSON

**Files:**
- Create: `js/ask.js`
- Modify: `js/net.js`, `js/ui.js`, `js/timeline.js` — route each fetch through it

**Interfaces:**
- Consumes: nothing.
- Produces: `askJson(url, opts)` from `js/ask.js`. Returns the parsed JSON. Throws on a timeout, a
  network fault, or a status outside 200 to 299. The thrown error carries `.status` when the server
  answered. `opts` accepts `ms` (timeout, default 20000), `tries` (default 2) and `cache` (passed
  to `fetch` only when given).

Five `fetch()` calls exist in the client and none of them sets a timeout, checks `r.ok`, or retries.
`fetch()` has no timeout of its own, so a hung worker leaves the promise pending forever.

- [ ] **Step 1: Write the module**

Create `js/ask.js`:

```js
// One way to ask this server for JSON. Nothing else in the app calls fetch() for data.

/* Three things fetch() does not do on its own, each of which has cost this app something.
 *
 * It has no timeout. A hung worker leaves the promise pending forever. The splash screen waits on
 * that promise with no way out.
 *
 * It resolves on a 500. Calling r.json() on an HTML error page throws a SyntaxError whose message
 * is written for a browser vendor: `Unexpected token '<'`. That string reached the status popover.
 *
 * It does not retry. One dropped packet cost a red dot for the whole five minutes to the next poll.
 *
 * AbortSignal.timeout() is native, so there is no AbortController to wire up and nothing to clean
 * up on the way out.
 *
 * `cache` is passed through only when a caller asks for it. The payload poll must not set
 * `no-store`: the server sends an ETag, so an unchanged poll costs 304 and about 200 bytes, and
 * `no-store` skips the conditional request that earns it. The force refresh sets it on purpose,
 * because defeating that cache is the whole of what that button does.
 */
export async function askJson(url, { ms = 20000, tries = 2, cache } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    // A short pause before the second attempt. Long enough to outlast a dropped packet, short
    // enough that a reader waiting on the splash does not notice it.
    if (i) await new Promise(r => setTimeout(r, 400));
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(ms), ...(cache ? { cache } : {}) });
      if (!r.ok) {
        const err = Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
        // A 404 or a 400 will not become a 200 on a second try, and the rate limiter behind
        // ?place= counts every arrival. Give up at once on anything the server answered clearly.
        if (r.status < 500) throw err;
        last = err;
        continue;
      }
      return await r.json();
    } catch (e) {
      // AbortSignal.timeout() rejects with a TimeoutError. Retrying that is the point.
      last = e;
    }
  }
  throw last;
}
```

- [ ] **Step 2: Route the payload poll through it**

In `js/net.js`, add to the imports:

```js
import { askJson } from './ask.js';
```

Then find these four lines inside `load()`:

```js
    const r = await fetch(FEED);
    clearTimeout(slow); clearTimeout(slower);
    if (first) say('Reading water levels, rainfall, sirens and cameras…');
    const j = await r.json();
```

Replace them with:

```js
    /* A longer budget on the first load than on a poll. A cold rebuild measured 36.5 s, and a
       server kept warm by cron answers in 0.08 s. No `cache` option: the server sends an ETag, so
       an unchanged poll is a 304 of about 200 bytes, and `no-store` would throw that away. */
    const j = await askJson(FEED, { ms: first ? 45000 : 20000 });
    clearTimeout(slow); clearTimeout(slower);
    if (first) say('Reading water levels, rainfall, sirens and cameras…');
```

The next line already reads `if (!j.stations) throw new Error(...)`. Leave it exactly as it is.

- [ ] **Step 3: Route the force refresh through it**

In `js/ui.js`, add `import { askJson } from './ask.js';` to the imports. Then find these two lines:

```js
    const r = await fetch(FEED + (FEED.includes('?') ? '&' : '?') + 'force=1', { cache: 'no-store' });
    const j = await r.json();
```

Replace both with this one:

```js
    /* `no-store` stays here. This button exists to defeat the cache, and that is the one place
       where doing so is right. One try: a reader who pressed a button watches the result, and the
       rate limit behind ?force=1 counts every arrival. */
    const j = await askJson(FEED + (FEED.includes('?') ? '&' : '?') + 'force=1',
                            { cache: 'no-store', tries: 1 });
```

Nothing else in that handler changes. It already reads `j`, and the `catch (e)` below it already
prints `'Failed — ' + e.message`. Leave that line alone. This is the Developer section. It exists to state the plumbing. `e.message` now reads `HTTP 500`
rather than wording a browser chose.

- [ ] **Step 4: Route the place lookup through it**

**This one is a rewrite, not a rename.** The handler reads `r.status` in four branches to choose its
message, and `askJson()` throws on any status outside 200 to 299, so `r` stops existing and those
branches move into the `catch`. Losing them blames this site for a query the reader can fix.

In `js/ui.js`, find this block and replace all of it:

```js
    const r = await fetch(`api.php?place=${encodeURIComponent(q)}`, { cache: 'no-store' });
    const j = await r.json();
    if (my !== gen) return;
    places = j.places || [];
    pstate = places.length ? ''
      : r.status === 429 ? 'Too many searches just now — try again in a moment'
      // 400 is placeQuery() rejecting the query outright — too long, or invalid UTF-8 — and is a
      // problem with what the reader typed, not with reaching JPS or Nominatim. Reporting it as
      // "unavailable" blames this site for the input of the reader.
      : r.status === 400 ? 'That search is too long — try a shorter place name.'
      : r.ok ? 'No place by that name in Selangor, Kuala Lumpur or Putrajaya'
      : 'Place search is unavailable';
  } catch {
    if (my !== gen) return;
    places = [];
    pstate = 'Place search is unavailable';
  }
```

with this:

```js
    /* One try only. Nominatim allows one request a second, and this proxy is the only thing holding
       that line. A retry would spend a second lookup on a reader who asked once. */
    const j = await askJson(`api.php?place=${encodeURIComponent(q)}`,
                            { cache: 'no-store', tries: 1, ms: 15000 });
    if (my !== gen) return;
    places = j.places || [];
    pstate = places.length ? '' : 'No place by that name in Selangor, Kuala Lumpur or Putrajaya';
  } catch (e) {
    if (my !== gen) return;
    places = [];
    /* askJson() throws on any status outside 200 to 299, so the two messages that used to read
       `r.status` read `e.status` here instead. Both name something the reader can act on. 400 is
       placeQuery() rejecting the query outright, which is a problem with what the reader typed and
       not with reaching Nominatim. Calling that "unavailable" blames this site for their input. */
    pstate = e.status === 429 ? 'Too many searches just now — try again in a moment'
      : e.status === 400 ? 'That search is too long — try a shorter place name.'
      : 'Place search is unavailable';
  }
```

The generation guard `if (my !== gen) return;` stays in both paths. It is what stops a slow answer
overwriting a newer search.

- [ ] **Step 5: Check the modules and the types**

Run the client verification block at the top of this plan. Both commands must print nothing.

- [ ] **Step 6: Confirm the three paths still work**

Open `https://flood-exp.test` and hard reload with Ctrl+Shift+R.

1. The map draws its stations and the status dot is green or amber.
2. Open the About dialog, find the Developer section, and press Refresh now. It answers.
3. Open the go-to box, type a place name, and pick the search row at the foot of the list. It
   returns places.

Then confirm the 304 survived:

```bash
E=$(curl -sk -o /dev/null -D - "https://flood-exp.test/api.php" | grep -i '^etag:' | tr -d '\r' | cut -d' ' -f2)
curl -sk -o /dev/null -w 'conditional: %{http_code} %{size_download}B\n' -H "If-None-Match: $E" "https://flood-exp.test/api.php"
```

Expected: `304 0B`. A 200 here means a `cache` option leaked onto the poll.

State what you observed for all four checks.

- [ ] **Step 7: Commit**

```bash
git add js/ask.js js/net.js js/ui.js
git commit -m "Five requests, no timeout among them, and fetch has none of its own

A hung worker left the poll pending forever, and the splash screen waits on
that promise. Nothing checked r.ok either, so a 500 carrying an HTML page
became a SyntaxError whose text was written for a browser vendor.

askJson gives all five one timeout, one status check and one retry.
AbortSignal.timeout is native, so no controller is wired up here.

The poll passes no cache option on purpose. The server sends an ETag and an
unchanged poll is a 304 of about 200 bytes."
```

---

### Task 4: Keep saying how old the readings are

**Files:**
- Modify: `js/net.js` — `network()`

**Interfaces:**
- Consumes: `askJson()` from Task 3, and `feedRows(j)` already exported from `js/net.js`.
- Produces: nothing new that other modules import.

`network()` sets `last = null` on a failure. The map keeps drawing the last good payload, and the
popover stops saying how old those readings are. That is the fact a reader most needs at the moment
a poll fails.

- [ ] **Step 1: Keep the last good payload**

In `js/net.js`, find:

```js
function network(j, err) {
  last = err ? null : j;
```

Replace the second line with:

```js
function network(j, err) {
  /* Keep describing what is on screen. A failed poll leaves the last good payload drawn on the
     map, so the age of those readings is exactly what a reader needs at that moment. Clearing this
     dropped the age rows precisely when they mattered, and left the popover with a problem and no
     way to judge it. */
  if (!err) last = j;
```

- [ ] **Step 2: Write the two messages**

Add this above `function network(j, err) {`:

```js
/* Two messages, not a taxonomy of faults. Whatever broke, the reader's next move is the same:
   read the age on screen and decide whether to trust it. So the message says which of the two
   things a reader can act on has happened, and the age rows below it carry the rest.
   None of our own words for the plumbing: no status code, no exception text, no `proxy`. The raw
   `e.message` used to land here, and it reads `Unexpected token '<'` or `Failed to fetch`
   depending on the browser. */
const netMessage = () => navigator.onLine ? 'Could not reach the server.' : 'No connection.';
```

- [ ] **Step 3: Use them in the rows**

Find this line inside `network()`:

```js
  const rows = [['status', text], ...(err ? [['problem', err]] : feedRows(j))];
```

Replace it with:

```js
  /* The problem line and the age rows are not alternatives. On a failure the reader wants both:
     what went wrong, and how old the map under it is. `last` survives a failure now, so the age
     rows still have a payload to describe. */
  const rows = [
    ['status', text],
    ...(err ? [['problem', netMessage()]] : []),
    ...(last ? feedRows(last) : []),
  ];
```

- [ ] **Step 4: Fix the splash copy on a failure**

Still in `js/net.js`, find this line in the `catch` block of `load()`:

```js
        el('splashMsg').textContent = 'Could not reach the flood data. Showing the map anyway.';
```

Leave it exactly as it is. It is already written for a reader and it is already correct.

Report that you checked it and changed nothing.

- [ ] **Step 5: Check the modules and the types**

Run the client verification block at the top of this plan. Both commands must print nothing.

- [ ] **Step 6: Confirm the failure path**

The server is up, so simulate the failure from the browser.

Open `https://flood-exp.test`, let it load, then open the browser developer tools, go to the
network panel, and set the throttling control to Offline. Wait for the next poll, or press Refresh
now in the About dialog.

Expected: the map keeps its stations. The status dot turns red. Hover the logo. The popover shows `status offline` and a `problem` row reading `No connection.`
The `readings`, `last checked`, `stations` and `from` rows all stay, with real values.

Set throttling back to Online. The next poll clears it.

State exactly what the popover showed in both states. You may be unable to drive the browser. Then read the code, confirm `netMessage()` returns the two
strings, and report that you substituted.

- [ ] **Step 7: Commit**

```bash
git add js/net.js
git commit -m "The app stopped saying how old the map was, exactly when it mattered

A failed poll set the payload to null, so the popover lost its readings age,
its last checked time and its station count. The map kept drawing the last
good data underneath. The reader was left with a red dot and no way to judge
what was on screen.

The payload survives a failure now, and the problem line sits beside the age
rather than in place of it.

The problem line is one of two sentences a reader can act on. The raw
exception text used to land there, and it reads differently in every
browser."
```

---

### Task 5: Tell an empty archive apart from a failed request

**Files:**
- Modify: `js/timeline.js` — the `?shots=` fetch and whatever reads `rows` after it

**Interfaces:**
- Consumes: `askJson()` from Task 3.
- Produces: nothing new.

`js/timeline.js` catches a failed fetch into `rows = []`. An empty array already means the camera has no archive. So a failed request draws the scrubber as
though the camera has no history. That
is a false claim, not a degraded one. `CLAUDE.md` states the same rule for the weather parser: an
unknown marker is dropped and never read as clear weather.

- [ ] **Step 1: Read the current code**

```bash
cd d:/Herd/flood-exp
grep -n 'api.php?shots=' -B6 -A14 js/timeline.js
```

Record the whole block, including every line that reads `rows` afterward. You need to know what an
empty `rows` currently causes before you change what produces it.

- [ ] **Step 2: Separate the two outcomes**

Find these lines:

```js
    rows = await (await fetch(`api.php?shots=${id}`)).json();
  } catch { rows = []; }
```

Replace them with:

```js
    rows = await askJson(`api.php?shots=${id}`, { tries: 2, ms: 15000 });
  } catch {
    /* null is not []. An empty array is a camera with no stored frames, which is a fact about the
       archive. null is this client failing to ask, which is a fact about the connection. Drawing
       the second as the first tells a reader the camera has no history when it may have a year of
       it. That is the same rule the weather parser follows: an unknown marker is dropped, never
       read as clear weather. */
    rows = null;
  }
```

Add the import at the top of `js/timeline.js`:

```js
import { askJson } from './ask.js';
```

- [ ] **Step 3: Make every reader of `rows` handle null**

Read every line you recorded in Step 1. For each one that assumes `rows` is an array, decide what it
must do when the value is `null`, and write it.

The rule is this. An empty archive draws whatever it draws today. A failed request must not claim the camera
has no frames. Where the code has words to show, say `Could not load the archive.` — sentence case,
no plumbing words. Where it has only a control, leave that control as it was. Do not reset it to an empty archive.

Report each site you changed and what you chose for it.

- [ ] **Step 4: Check the modules and the types**

Run the client verification block at the top of this plan. Both commands must print nothing.

- [ ] **Step 5: Confirm both outcomes**

```bash
cd d:/Herd/flood-exp
# a camera with an archive
curl -sk "https://flood-exp.test/api.php?shots=$(ls shots | head -1)" | head -c 80
echo
# a camera with none
curl -sk "https://flood-exp.test/api.php?shots=999999"
echo
```

Expected: the first prints an array of entries. The second prints `[]`.

Then open `https://flood-exp.test`, open a camera from the map, and open the lightbox from its
picture. The scrubber draws its frames. State what you saw.

- [ ] **Step 6: Commit**

```bash
git add js/timeline.js
git commit -m "A failed request drew the scrubber as a camera with no history

The catch turned any failure into an empty array, and an empty array already
meant something: this camera has no stored frames. So a dropped connection
told a reader the camera had no archive when it may hold a year of it.

null now means we could not ask. The weather parser follows the same rule,
where an unknown marker is dropped rather than read as clear weather."
```

---

## Done when

```bash
cd d:/Herd/flood-exp
php -l api.php && php api.php --selftest | tail -1 && php shots-test.php | tail -1

T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done
for f in js/*.js; do curl -sk -o /dev/null -w "%{content_type} $f\n" "https://flood-exp.test/$f"; done | grep -v javascript

# the wall asks the archive, not the agency
grep -c 'api.php?shot=' js/wall.js      # 1, in tileSrc
grep -c 'api.php?cam='  js/wall.js      # 1, in the onSettle fallback only

# every data fetch goes through the wrapper
grep -n 'fetch(' js/*.js                # only js/ask.js and js/map.js water.json

# the 304 survived
E=$(curl -sk -o /dev/null -D - "https://flood-exp.test/api.php" | grep -i '^etag:' | tr -d '\r' | cut -d' ' -f2)
curl -sk -o /dev/null -w 'conditional: %{http_code} %{size_download}B\n' -H "If-None-Match: $E" "https://flood-exp.test/api.php"
```

`js/map.js` keeps its own bare `fetch('water.json')`. That call already swallows its failure by
design, and Plan C moves it. Leave it alone here.

## Documentation

`CLAUDE.md` requires a feature note as part of the change. Append to `docs/FEATURES.md` in the same
commit series. State what the wall now loads and the measured cost of both routes. State the three
things `askJson()` adds and why the poll passes no cache option. State that `null` and `[]` mean
different things after a `?shots=` call.

Add one gotcha to `CLAUDE.md`. The payload poll must never pass `cache: 'no-store'`. The server
sends an `ETag`, and that option skips the conditional request which earns the 304.
