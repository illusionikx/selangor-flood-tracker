# API server load and caching — Implementation Plan (A of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release the PHP session lock. Cut about 55,968 daily requests to JPS. Stop the browser from caching the payload for three hours.

**Architecture:** All five tasks change `api.php` only. Each one is small and independent. Task 1 removes a lock. Task 2 skips a fan out. Tasks 3 and 4 add caches. Task 5 adds response headers.

**Tech Stack:** PHP 8.2, no framework, no package. `pdo_sqlite` and `curl` ship with PHP.

**Source spec:** `docs/superpowers/specs/2026-08-13-api-performance-design.md`, Sections 1 and 2.

## Plan split

This spec became three plans. Each one ships working software.

- **A, this plan.** Server: Section 2a, 1a, 1b, 2b, 2c, and the server half of 1c.
- **B, next.** Client: the caller half of 1c, and all of Section 4.
- **C, last.** Client: Sections 3 and 5.

## Global Constraints

- **No test framework.** `CLAUDE.md` states this repository has no test suite. Two checks run:
  `php api.php --selftest` and `php shots-test.php`. Add assertions to the first. Do not add a
  framework, a package or a third test file.
- **Offline checks only in `--selftest`.** No assertion there reaches a network. That block runs
  before the first `header()` call and exits.
- **Prose rules.** Write every comment in active voice. Keep sentences under 20 words. Use no
  semicolons and no contractions. Use American spelling.
- **Composer is server side only.** Add no browser asset. Add no dependency.
- **Never delete `.history.db` or `shots/`.** `CLAUDE.md` explains what each loss costs.
- **One name for one thing.** A constant added here gets one name and one home in `api.php`.

## File structure

| file | change |
|---|---|
| `api.php` | every task. Session release, siren gate, two caches, four headers |
| `.gitignore` | one line per new cache path |

No new PHP file. Each change is under 30 lines, and `api.php` already owns every request handler.

## Baseline

Run these before Task 1. Each task compares against them.

```bash
cd d:/Herd/flood-exp
curl -sk https://flood-exp.test/api.php \
  | php -r 'echo json_decode(stream_get_contents(STDIN),true)["details"]["requested"],"\n";'   # 614
curl -sk -o /dev/null -D - "https://flood-exp.test/api.php" | grep -i 'cache-control\|etag'
php api.php --selftest | tail -1                                                              # all ok
```

---

### Task 1: Release the session lock

**Files:**
- Modify: `api.php`, immediately after the two `require_once` lines at the top

**Interfaces:**
- Consumes: nothing
- Produces: nothing. No function and no constant. Later tasks depend on none of this.

This is the fault the reader reported. Ship it alone.

- [ ] **Step 1: Record the failure**

Run this. It takes about 10 seconds.

```bash
cd d:/Herd/flood-exp
J=/tmp/cj.txt; rm -f $J
curl -sk -c $J -o /dev/null "https://flood-exp.test/api.php"
for i in 1 2 3 4 5 6; do
  curl -sk -b $J -o /dev/null -w '%{time_total}\n' "https://flood-exp.test/api.php?cam=1271&x=$i" &
done; wait
```

Expected: six times that climb by about one second each. The measured baseline reads
`1.93 3.04 4.29 5.35 6.07 6.88`. Save the output. Step 4 compares against it.

A staircase is the failure. Six times close together means the fault is already gone. Stop and report that instead of continuing.

- [ ] **Step 2: Confirm nothing reads the session**

```bash
grep -c 'session_\|\$_SESSION' api.php sources.php shots.php
```

Expected: `api.php:0`, `sources.php:0`, `shots.php:0`.

If any file returns more than 0, stop. This task assumes the session holds nothing, and that
assumption just failed.

- [ ] **Step 3: Release the lock**

In `api.php`, find these two lines near the top:

```php
require_once __DIR__ . '/sources.php';   // the two scraped upstreams (national portal + KL)
require_once __DIR__ . '/shots.php';     // the camera archive: capture, retention, lookup
```

Insert this directly below them:

```php
/* This PHP runs with `session.auto_start=1`, and the file session handler takes an exclusive lock
   on the session file for the whole request. Every request that carries the PHPSESSID of one browser
   therefore runs one at a time. Six concurrent stills measured 1.9, 3.0, 4.3, 5.4, 6.1 and 6.9
   seconds, which is a clean staircase. The same six with no shared cookie finished in 3.4 seconds
   together. Four cheap requests finish in 347 ms, so the worker pool is not the reason.
   Ninety camera tiles queue that way, and the five minute poll queues behind them.
   Nothing in this repository reads `$_SESSION`, so the lock protects nothing and costs the whole
   camera wall. Release it before any work starts.
   Do not replace this with an ini change. The ini belongs to the machine, and this file has to be
   correct on a machine it does not own. */
if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
```

- [ ] **Step 4: Confirm the staircase is gone**

```bash
php -l api.php
J=/tmp/cj.txt; rm -f $J
curl -sk -c $J -o /dev/null "https://flood-exp.test/api.php"
for i in 1 2 3 4 5 6; do
  curl -sk -b $J -o /dev/null -w '%{time_total}\n' "https://flood-exp.test/api.php?cam=1271&x=$i" &
done; wait
```

Expected: `php -l` prints `No syntax errors detected`. The six times now sit close together, near
the 3.4 second total the no cookie run measured. No time is about one second above the one before it.

- [ ] **Step 5: Confirm the payload still answers**

```bash
php api.php --selftest | tail -1
curl -sk https://flood-exp.test/api.php \
  | php -r 'echo count(json_decode(stream_get_contents(STDIN),true)["stations"]),"\n";'
```

Expected: `all ok`, then a station count near 677. A count of 0 or an error means the insert landed
in the wrong place.

- [ ] **Step 6: Commit**

```bash
git add api.php
git commit -m "One browser got one worker at a time, and the wall wanted ninety

session.auto_start locks the session file for the length of a request, so
every request carrying one PHPSESSID ran in series. Six concurrent stills
came back 1.9, 3.0, 4.3, 5.4, 6.1 and 6.9 seconds apart. The same six with
no shared cookie took 3.4 seconds together.

Nothing here reads \$_SESSION."
```

---

### Task 2: Fetch a siren detail only when it says something

**Files:**
- Modify: `api.php` — add two constants beside `SIREN_STALE`, add `sirenWanted()` beside
  `forceAllowed()`, add a `--selftest` block, change the `$detailUrls` build

**Interfaces:**
- Consumes: `forceAllowed(int $now, ?int $lastForce, int $window): array` — already in `api.php`.
  Returns `[bool $allowed, ?string $why]`. It answers "has this window elapsed", which is the
  question this task asks about the sweep.
- Produces: `sirenWanted(array $list, bool $sweep): array` — returns the `stationId` values that
  need a detail call this rebuild. Task 3, 4 and 5 do not use it.

The siren list already carries `status`. `api.php` already reads the status from the list, in the
`'status' => (int)($fg['status'] ?? $s['status'] ?? 0)` line. The detail adds only
`statusLastUpdate`.

- [ ] **Step 1: Add the constants**

Find this line in `api.php`:

```php
const SIREN_STALE = 48 * 3600;
```

Add below it:

```php
/* How often every siren refreshes `statusLastUpdate`. The list carries the status, so a quiet
   siren needs its detail only to keep that timestamp current. Two things read it: the SIREN_STALE
   check above, and the stamp on every siren sample in `.history.db`.
   One hour, not six. The siren history pass stamps each sample from this field, and the
   `(station, ts)` primary key drops a repeated stamp. A six hour value therefore folds six hours of
   samples into one row. It also spends 12.5% of the 48 hour budget before the check above runs. */
const SIREN_TTL   = 3600;
const SIREN_STAMP = __DIR__ . '/.siren.stamp';
```

- [ ] **Step 2: Write the failing assertions**

Find the end of the `forceAllowed():` assertions inside the `--selftest` block. Add this after them:

```php
    echo "\nsirenWanted():\n";
    $sirens = [
        ['stationId' => 1, 'status' => 0],
        ['stationId' => 2, 'status' => 1],
        ['stationId' => 3],
    ];
    $ok('a sweep asks for every siren',      sirenWanted($sirens, true) === [1, 2, 3]);
    $ok('no sweep asks only the loud one',   sirenWanted($sirens, false) === [2]);
    $ok('a missing status counts as quiet',  !in_array(3, sirenWanted($sirens, false), true));
    $ok('an all quiet list asks for none',   sirenWanted([['stationId' => 9, 'status' => 0]], false) === []);
    $ok('an empty list asks for none',       sirenWanted([], true) === []);
    /* The sweep window reuses forceAllowed(), the same way the place lookup reuses it at
       PLACE_EVERY. A stamp older than SIREN_TTL opens the sweep. */
    $ok('an hour old stamp opens a sweep',   forceAllowed($now, $now - SIREN_TTL, SIREN_TTL)[0] === true);
    $ok('a fresh stamp keeps it shut',       forceAllowed($now, $now - 60, SIREN_TTL)[0] === false);
    $ok('no stamp at all opens a sweep',     forceAllowed($now, null, SIREN_TTL)[0] === true);
```

- [ ] **Step 3: Run the assertions and watch them fail**

```bash
php api.php --selftest
```

Expected: PHP stops with `Call to undefined function sirenWanted()`. That is the failure this step
wants. A pass here means the function already exists. Stop and read it.

- [ ] **Step 4: Write the function**

Add this directly above `forceAllowed()` in `api.php`:

```php
/**
 * Which sirens need a detail call this rebuild.
 *
 * The list carries `status`, and this file already reads the status from there. A detail call adds
 * one field, `statusLastUpdate`, so a quiet siren needs one only to keep that timestamp current.
 * That costs 212 calls every five minutes, which is 61,056 requests a day for a daily heartbeat.
 *
 * A siren that claims to be sounding is fetched every rebuild, so an alarm loses no latency at all.
 * The rest ride the SIREN_TTL sweep.
 *
 * @param array $list  the StationSirens list, as the feed publishes it
 * @param bool  $sweep true when the SIREN_TTL window has elapsed
 * @return array the stationId values to fetch
 */
function sirenWanted(array $list, bool $sweep): array {
    $out = [];
    foreach ($list as $s) {
        // A missing status is quiet. The feed publishes the field on every row measured, and a row
        // without one is not evidence of an alarm.
        if ($sweep || (int)($s['status'] ?? 0) !== 0) $out[] = $s['stationId'];
    }
    return $out;
}
```

- [ ] **Step 5: Run the assertions and watch them pass**

```bash
php api.php --selftest
```

Expected: eight new `ok` lines under `sirenWanted():`, and `all ok` at the end.

- [ ] **Step 6: Use it in the fan out**

Find these two lines in `api.php`:

```php
// Sirens are fetched purely for `statusLastUpdate`; the list carries no timestamp of any kind.
foreach ($get('StationSirens') as $s) $detailUrls["sn-{$s['stationId']}"] = API . 'StationSirens/' . $s['stationId'];
```

Replace both with:

```php
/* Sirens are fetched for `statusLastUpdate` alone. The list carries the status itself, so only a
   siren that claims to be sounding needs a detail every rebuild. The rest refresh on SIREN_TTL.
   The stamp is written whether or not the sweep found anything, so a rebuild that reaches here
   always moves the window. Compare the page cache rule in this file: never leave a row unable to
   advance its own timestamp. */
$sirenLast  = is_file(SIREN_STAMP) ? (int)file_get_contents(SIREN_STAMP) : null;
$sirenSweep = forceAllowed(time(), $sirenLast, SIREN_TTL)[0];
if ($sirenSweep) @file_put_contents(SIREN_STAMP, (string)time(), LOCK_EX);
foreach (sirenWanted($get('StationSirens'), $sirenSweep) as $sid) {
    $detailUrls["sn-$sid"] = API . 'StationSirens/' . $sid;
}
```

- [ ] **Step 7: Ignore the stamp file**

Add this line to `.gitignore`, below `.place.lock`:

```
.siren.stamp
```

- [ ] **Step 8: Confirm the fan out shrank**

```bash
php -l api.php
rm -f .siren.stamp
curl -sk "https://flood-exp.test/api.php?force=1" \
  | php -r 'echo json_decode(stream_get_contents(STDIN),true)["details"]["requested"],"\n";'
sleep 61
curl -sk "https://flood-exp.test/api.php?force=1" \
  | php -r 'echo json_decode(stream_get_contents(STDIN),true)["details"]["requested"],"\n";'
```

Expected: the first number is about 614, because a missing stamp opens a sweep. The second is about
402, because the stamp is now fresh. A second number still near 614 means the stamp did not write,
so check that the web server can write to the repository directory.

- [ ] **Step 9: Confirm no siren lost its data**

```bash
curl -sk https://flood-exp.test/api.php | php -r '$p=json_decode(stream_get_contents(STDIN),true);
$s=array_filter($p["stations"],fn($x)=>$x["kind"]==="siren");
$dated=array_filter($s,fn($x)=>!empty($x["updated"]));
echo count($s)," sirens, ",count($dated)," carry a timestamp\n";
$on=array_filter($s,fn($x)=>$x["online"]); echo count($on)," online\n";'
```

Expected: about 212 sirens, and the count carrying a timestamp matches what the baseline showed.
Run the same command against the baseline first if you did not record it. A large drop in
`carry a timestamp` means the sweep is not populating `$details`, so re read Step 6.

- [ ] **Step 10: Commit**

```bash
git add api.php .gitignore
git commit -m "Two hundred and twelve calls every five minutes for a daily heartbeat

The siren list carries the status. The detail adds statusLastUpdate and
nothing else, and that one field feeds the 48 hour staleness check and the
stamp on each siren sample.

A siren that claims to be sounding is still fetched every rebuild, so an
alarm loses no latency. The quiet ones refresh hourly, which is 5,088 calls
a day instead of 61,056.

One hour and not six: the history pass stamps samples from this field, and
the (station, ts) key folds six hours into one row."
```

---

### Task 3: Cache the camera still, and stop decoding the payload to find it

**Files:**
- Modify: `api.php` — add three constants beside `CACHE`, add `camUrl()`, rewrite the `?cam=`
  handler, write the URL map at the end of a rebuild
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `fetchAll(array $urls, int $concurrency, bool $json): array` — already in `api.php`.
- Produces: `camUrl(int $id): ?string` — the upstream image URL for a camera, or null.

- [ ] **Step 1: Add the constants**

Find this line in `api.php`:

```php
const CACHE = __DIR__ . '/.cache.json';
```

Add below it:

```php
/* The camera still cache. Every ?cam= request used to reach JPS, so N readers on the camera wall
   aimed N times 90 fetches at one agency. 300 seconds is the lifetime the Cache-Control
   on this endpoint already claims, and it matches POLL_MS in js/config.js. A still cannot change
   faster than the payload that names it.
   CAM_URLS is a small map of camera id to image URL, written at the end of each rebuild. The
   handler used to decode all 312 KB of .cache.json to read one string out of it. */
const CAM_TTL  = 300;
const CAM_DIR  = __DIR__ . '/.cam';
const CAM_URLS = __DIR__ . '/.cams.json';
```

- [ ] **Step 2: Write the URL map at the end of a rebuild**

Find this line near the end of `api.php`:

```php
file_put_contents(CACHE, $payload, LOCK_EX);
```

Insert directly above it:

```php
/* The id to URL map the ?cam= handler reads. This uses the same stations the payload carries, so
   the two cannot disagree. Write a temporary file and rename it. A reader can arrive while this
   runs, and rename is atomic on one filesystem. */
$camMap = [];
foreach ($stations as $s) {
    if ($s['kind'] === 'camera' && !empty($s['image'])) {
        $camMap[(int)explode('-', $s['id'])[1]] = $s['image'];
    }
}
$camTmp = CAM_URLS . '.' . getmypid();
if (file_put_contents($camTmp, json_encode($camMap), LOCK_EX) !== false) rename($camTmp, CAM_URLS);
```

- [ ] **Step 3: Write `camUrl()`**

Add this directly above the `?cam=` handler in `api.php`:

```php
/**
 * The upstream image URL for one camera.
 *
 * Reads the small map the rebuild writes. Falls back to the full payload when that map is absent,
 * which is the state a fresh deployment starts in and the state a failed rename leaves behind. A
 * missing map must degrade to a slower answer, never to a 404.
 */
function camUrl(int $id): ?string {
    if ($id <= 0) return null;
    $map = is_file(CAM_URLS) ? json_decode((string)@file_get_contents(CAM_URLS), true) : null;
    if (is_array($map) && isset($map[$id])) return $map[$id];
    $cams = is_file(CACHE) ? (json_decode((string)@file_get_contents(CACHE), true)['stations'] ?? []) : [];
    foreach ($cams as $s) {
        if ($s['kind'] === 'camera' && $s['id'] === 'camera-' . $id) return $s['image'] ?? null;
    }
    return null;
}
```

- [ ] **Step 4: Rewrite the handler**

Replace the whole `if (isset($_GET['cam'])) { ... }` block with this:

```php
if (isset($_GET['cam'])) {
    $id  = (int)$_GET['cam'];
    $hit = $id > 0 ? CAM_DIR . "/$id.jpg" : null;

    /* A cached still answers without a lookup and without touching JPS. This is the whole point of
       the endpoint: 90 tiles times every reader used to be 90 times every reader at the agency. */
    if ($hit && is_file($hit) && time() - filemtime($hit) < CAM_TTL) {
        header('Content-Type: image/jpeg');
        header('Cache-Control: max-age=' . CAM_TTL);
        readfile($hit);
        exit;
    }

    $url = camUrl($id);
    if (!$url || strcasecmp(parse_url($url, PHP_URL_HOST) ?? '', HOST) !== 0) {
        http_response_code(404);
        exit;
    }
    /* curl, never file_get_contents. JPS publishes two A records for this host and one
       (58.27.97.62) blackholes SYNs. curl races both and lands on the live one in ~10ms. PHP's
       stream wrapper tries them serially with no connect timeout, so it ate Windows' full 21s TCP
       timeout on every other still. Prefer TLS. Fall back to what upstream advertised. */
    $try = fn($u) => fetchAll([$u], 1, false)[$u] ?? '';
    $img = $try(preg_replace('#^http://#i', 'https://', $url)) ?: $try($url);
    if ($img === '') {
        /* Serve a stale still rather than a broken picture. The archive is a year of pictures and
           this cache is five minutes of them, so an upstream blip costs a slightly old frame
           instead of the videocam_off panel on every tile at once. */
        if ($hit && is_file($hit)) {
            header('Content-Type: image/jpeg');
            header('Cache-Control: max-age=60');
            readfile($hit);
            exit;
        }
        http_response_code(502);
        exit;
    }

    /* Write a temporary file and rename it. Two readers can miss the cache at the same moment,
       and this must never serve a half written file as a picture. */
    if ($hit) {
        @mkdir(CAM_DIR, 0777, true);
        $tmp = $hit . '.' . getmypid();
        if (file_put_contents($tmp, $img, LOCK_EX) !== false) rename($tmp, $hit);
    }
    header('Content-Type: image/jpeg');
    /* 300s = POLL_MS in js/config.js and CAM_TTL above. All three move together. */
    header('Cache-Control: max-age=' . CAM_TTL);
    echo $img;
    exit;
}
```

- [ ] **Step 5: Ignore the two cache paths**

Add these lines to `.gitignore`, below `.siren.stamp`:

```
.cam/
.cams.json
```

- [ ] **Step 6: Confirm the cache works and JPS is spared**

```bash
php -l api.php
rm -rf .cam .cams.json
curl -sk "https://flood-exp.test/api.php?force=1" -o /dev/null      # rebuild writes .cams.json
ls -l .cams.json && php -r 'echo count(json_decode(file_get_contents(".cams.json"),true))," cameras mapped\n";'
echo "cold, then warm:"
curl -sk -o /dev/null -w 'cold %{time_total}s %{size_download}B %{http_code}\n' "https://flood-exp.test/api.php?cam=1271"
curl -sk -o /dev/null -w 'warm %{time_total}s %{size_download}B %{http_code}\n' "https://flood-exp.test/api.php?cam=1271"
```

Expected: about 90 cameras mapped. The cold request takes about 0.8 seconds. The warm request takes
under 0.05 seconds and returns the same byte count with status 200. A warm time still near 0.8
seconds means the write failed, so check that the web server can create `.cam/`.

- [ ] **Step 7: Confirm the fallback and the guard still hold**

```bash
mv .cams.json .cams.json.off
curl -sk -o /dev/null -w 'no map, falls back to .cache.json: %{http_code}\n' "https://flood-exp.test/api.php?cam=1272"
mv .cams.json.off .cams.json
curl -sk -o /dev/null -w 'unknown id must be 404: %{http_code}\n' "https://flood-exp.test/api.php?cam=999999"
curl -sk -o /dev/null -w 'array cast must not be 200: %{http_code}\n' "https://flood-exp.test/api.php?cam[]=1"
```

Expected: `200`, then `404`, then `404`. The second line is the rule that this endpoint never
proxies a URL it was handed. A `200` on the third line means the integer cast was lost.

- [ ] **Step 8: Commit**

```bash
git add api.php .gitignore
git commit -m "Ninety tiles, ninety readers, ninety thousand fetches at one agency

?cam= reached JPS on every request and cached nothing, so the camera wall
multiplied by every reader looking at it. It also decoded all 312 KB of
.cache.json to read one URL out of it.

The still is now held for 300 seconds, which is the lifetime its own header
already claimed. A cache hit needs no lookup at all, and a miss reads a small
id to URL map the rebuild writes.

An upstream blip serves the stale still rather than the No picture panel."
```

---

### Task 4: Serve the newest stored frame

**Files:**
- Modify: `api.php` — add `shotCache()` beside `forceAllowed()`, add a `--selftest` block, change
  the `?shot=` handler

**Interfaces:**
- Consumes: `shotList(int $id): array` from `shots.php`. Returns every stored frame timestamp for a
  camera, oldest first. `shotFile(int $id, int $ts): ?string` returns the path or null.
- Produces: `shotCache(bool $exact): string` — the `Cache-Control` value for a frame response.
  the wall change in Plan B consumes the route this task adds, not this function.

Plan B points the camera wall at this route. The route has to exist first.

- [ ] **Step 1: Write the failing assertions**

Add this at the end of the `--selftest` block, above the `echo $fail ? ...` line:

```php
    echo "\nshotCache():\n";
    /* The two forms of ?shot= mean different things and must not share a header. `&t=` names one
       frame that never changes again, so a year is honest. The no timestamp form names whichever
       frame is newest, and that changes every SHOT_EVERY. A browser holding the second for a year
       keeps a stale picture with nothing to tell it so. */
    $ok('an exact frame is immutable',     str_contains(shotCache(true), 'immutable'));
    $ok('an exact frame lasts a year',     str_contains(shotCache(true), 'max-age=31536000'));
    $ok('the newest frame is never immutable', !str_contains(shotCache(false), 'immutable'));
    $ok('the newest frame lasts 900s',     str_contains(shotCache(false), 'max-age=900'));
    $ok('900 is half of SHOT_EVERY',       900 === (int)(SHOT_EVERY / 2));
```

- [ ] **Step 2: Run the assertions and watch them fail**

```bash
php api.php --selftest
```

Expected: PHP stops with `Call to undefined function shotCache()`.

- [ ] **Step 3: Write the function**

Add this directly above `forceAllowed()` in `api.php`:

```php
/**
 * The Cache-Control for one frame response.
 *
 * `?shot=<id>&t=<unix>` names an exact frame. A stored frame never changes once written, so a year
 * is honest.
 *
 * `?shot=<id>` with no timestamp names whichever frame is newest. Those bytes change every
 * SHOT_EVERY, so `immutable` there is a promise this server cannot keep. 900 is half of
 * SHOT_EVERY, which is the reasoning ?sheet= already states for the strip.
 */
function shotCache(bool $exact): string {
    return $exact
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=900';
}
```

- [ ] **Step 4: Run the assertions and watch them pass**

```bash
php api.php --selftest
```

Expected: five new `ok` lines under `shotCache():`, and `all ok` at the end.

- [ ] **Step 5: Add the no timestamp form**

Replace the whole `if (isset($_GET['shot'])) { ... }` block with this:

```php
if (isset($_GET['shot'])) {
    $id    = (int)$_GET['shot'];
    $exact = isset($_GET['t']);
    $t     = (int)($_GET['t'] ?? 0);
    /* No timestamp means the newest stored frame. shotList() returns them oldest first, so the
       newest one is the last entry. The camera wall asks this way: it wants a picture from the
       archive rather than a live fetch at JPS, and it has no frame list to pick from.
       `$exact` is read from whether the caller supplied `t`, never from the resolved value. A
       caller that sent `t=0` asked for an exact frame and gets a 404, not the newest one. */
    if ($id > 0 && !$exact) {
        $all = shotList($id);
        $t   = $all ? end($all) : 0;
    }
    $f = $id > 0 && $t > 0 ? shotFile($id, $t) : null;
    if (!$f) { http_response_code(404); exit; }
    // A frame is stored in whichever format was smaller, so the type comes off the file we found.
    header('Content-Type: ' . (str_ends_with($f, '.webp') ? 'image/webp' : 'image/jpeg'));
    header('Cache-Control: ' . shotCache($exact));
    readfile($f);
    exit;
}
```

- [ ] **Step 6: Confirm both forms**

```bash
php -l api.php
ID=$(ls shots | head -1)
echo "newest form:"
curl -sk -o /dev/null -D - "https://flood-exp.test/api.php?shot=$ID" \
  | grep -i 'http/\|content-type\|cache-control'
echo "exact form:"
T=$(curl -sk "https://flood-exp.test/api.php?shots=$ID" | php -r '$r=json_decode(stream_get_contents(STDIN),true); $f=end($r); echo is_array($f)?$f[0]:$f;')
curl -sk -o /dev/null -D - "https://flood-exp.test/api.php?shot=$ID&t=$T" \
  | grep -i 'http/\|cache-control'
echo "a camera with no archive:"
curl -sk -o /dev/null -w '%{http_code}\n' "https://flood-exp.test/api.php?shot=999999"
```

Expected: the newest form returns `200`, an image content type, and
`Cache-Control: public, max-age=900` with no `immutable`. The exact form returns `200` and
`max-age=31536000, immutable`. The unknown camera returns `404`.

- [ ] **Step 7: Confirm retention still passes**

```bash
php shots-test.php | tail -3
```

Expected: the check passes. This task reads `shots/` and writes nothing there, so a failure means
something else moved.

- [ ] **Step 8: Commit**

```bash
git add api.php
git commit -m "The wall cannot ask for the newest frame, because nothing serves one

?shot= demanded a timestamp, so a caller with no frame list had no way to
reach the archive at all. The camera wall is that caller, and it fetched a
live still from JPS per tile instead.

The no timestamp form serves the newest stored frame. It does not inherit
the immutable year: an exact frame never changes again, and the newest one
changes every SHOT_EVERY. It takes the header of the strip for the same reason
the strip does."
```

---

### Task 5: Stop the browser caching the payload for three hours

**Files:**
- Modify: `api.php` — add `sendPayload()`, and call it at all three payload exits

**Interfaces:**
- Consumes: `cachedPayload(): array` — already in `api.php`. Every cached read passes through it.
- Produces: `payloadValidators(string $body): string` — sets `Cache-Control` and `ETag`, and
  returns the ETag it set. Every payload exit calls it.
- Produces: `sendPayload(string $body): never` — calls `payloadValidators()`, answers a matching
  `If-None-Match` with 304, otherwise echoes the body and exits. Only the exits that may exit call
  this one.

**There are three payload exits, not two.** `CLAUDE.md` records what a fix applied to one of them
costs. All three must go through `sendPayload()`.

| exit | what it echoes |
|---|---|
| `serveCache()` | `json_encode($extra + cachedPayload(), ...)` |
| the `fastcgi_finish_request` branch | `json_encode(cachedPayload(), ...)` |
| the end of a rebuild | `echo $payload;` |

The second exit is dead under Herd and live on the deploy target in `docs/DEPLOY.md`. Test the
first and third here. Read the second and confirm by eye.

- [ ] **Step 1: Record the failure**

```bash
curl -sk -o /dev/null -D - "https://flood-exp.test/api.php" | grep -i 'cache-control\|etag'
```

Expected: `Cache-Control: public, max-age=10800` and no `ETag`. That header is the blanket rule from Herd.
The payload sets none of its own, so a browser answers every poll from its cache for three hours.

- [ ] **Step 2: Write `sendPayload()`**

Find `function serveCache(array $extra = []): never {` in `api.php`. Add this directly above it:

```php
/**
 * Set the two validators on a payload response, and return the ETag.
 *
 * Three exits echo a payload and only one of them may exit, so the headers live here and the
 * exiting behaviour lives in sendPayload() below. One function sets these headers, so no exit can
 * drift from the others. A default written into one exit alone reached none of the others once
 * already, which is the `forced` flag gotcha in CLAUDE.md.
 */
function payloadValidators(string $body): string {
    $etag = '"' . md5($body) . '"';
    header('Cache-Control: no-cache');
    header('ETag: ' . $etag);
    return $etag;
}

/**
 * Write the payload to the browser, with validators.
 *
 * Two headers, and both matter. The server this runs behind serves every response
 * `Cache-Control: public, max-age=10800`, and this payload set none of its own, so a browser could
 * answer all 36 polls of the next three hours from its own cache. `no-cache` does not stop a
 * browser storing the response. It requires the browser to revalidate before reusing it, and the
 * ETag is what makes revalidating cheap: an unchanged payload costs 304 and about 200 bytes rather
 * than 33 KB.
 *
 * Every exit that echoes a payload calls this. There are three of them, and one is dead under Herd
 * and live on the deploy target. A default written into one exit alone reached none of the others
 * once already, which is the `forced` flag gotcha in CLAUDE.md.
 *
 * The service worker is unaffected. It returns without calling respondWith() for this URL, so
 * these headers reach the cache in the browser and nothing else.
 */
function sendPayload(string $body): never {
    $etag = payloadValidators($body);
    if (trim($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
        http_response_code(304);
        exit;
    }
    echo $body;
    exit;
}
```

- [ ] **Step 3: Route the first exit through it**

Find this line inside `serveCache()`:

```php
    echo json_encode($extra + cachedPayload(), JSON_UNESCAPED_SLASHES);
    exit;
```

Replace both lines with:

```php
    sendPayload(json_encode($extra + cachedPayload(), JSON_UNESCAPED_SLASHES));
```

- [ ] **Step 4: Route the second exit through it**

Find this line inside the `fastcgi_finish_request` branch:

```php
        echo json_encode(cachedPayload(), JSON_UNESCAPED_SLASHES);
```

Replace it with:

```php
        /* Not sendPayload(): this branch keeps working after the response, so it must not exit here.
           The validators still have to match the other two exits, or a reader on the deploy target
           gets a payload with no ETag while everybody else gets one. */
        $body = json_encode(cachedPayload(), JSON_UNESCAPED_SLASHES);
        payloadValidators($body);
        echo $body;
```

- [ ] **Step 5: Route the third exit through it**

Find these two lines near the end of `api.php`:

```php
file_put_contents(CACHE, $payload, LOCK_EX);
echo $payload;
```

Replace only the second one, so the file write stays:

```php
file_put_contents(CACHE, $payload, LOCK_EX);
/* Not sendPayload(): captureShots() still has to run below, so this exit must not exit either. The
   validators come from the same function as the other two exits. */
payloadValidators($payload);
echo $payload;
```

- [ ] **Step 6: Confirm the headers and the 304**

```bash
php -l api.php
echo "headers:"
curl -sk -o /dev/null -D - "https://flood-exp.test/api.php" | grep -i 'cache-control\|etag'
echo "conditional request:"
E=$(curl -sk -o /dev/null -D - "https://flood-exp.test/api.php" | grep -i '^etag:' | tr -d '\r' | cut -d' ' -f2)
curl -sk -o /dev/null -w 'status %{http_code}, %{size_download} bytes\n' -H "If-None-Match: $E" "https://flood-exp.test/api.php"
echo "and an unconditional one still returns the payload:"
curl -sk -o /dev/null -w 'status %{http_code}, %{size_download} bytes\n' "https://flood-exp.test/api.php"
```

Expected: `Cache-Control: no-cache` and an `ETag`. The conditional request returns `304` and 0
bytes. The unconditional one returns `200` and about 312,000 bytes. A `200` on the conditional
request means the `If-None-Match` comparison failed, so check the quoting in `sendPayload()`.

- [ ] **Step 7: Confirm the map still loads**

Open `https://flood-exp.test` in a browser and hard reload with Ctrl+Shift+R. The map draws its
stations. The status dot on the logo is green or amber, never red.

Then wait for one poll and confirm the popover on the dot advances its `last checked` row. A dot stuck
on one time means the 304 is reaching code that expects a body.

- [ ] **Step 8: Run both checks and commit**

```bash
php api.php --selftest | tail -1
php shots-test.php | tail -1
git add api.php
git commit -m "Every poll for three hours could come from the cache in the browser

The payload set no cache header of its own, so the blanket
max-age=10800 was the only one on it. The page polls every five minutes and
the whole point is that it is current.

no-cache asks for revalidation rather than forbidding storage, and the ETag
makes that cheap: an unchanged payload is 304 and about 200 bytes instead of
33 KB.

Three exits echo a payload, and one of them is dead here and live on the
deploy target. All three carry the validators. A default written into one of
them reached none of the others once already."
```

---

## Done when

```bash
cd d:/Herd/flood-exp
php -l api.php && php -l sources.php
php api.php --selftest | tail -1                 # all ok
php shots-test.php   | tail -1                   # passes

# 402 on an ordinary rebuild, 614 once an hour
curl -sk https://flood-exp.test/api.php \
  | php -r 'echo json_decode(stream_get_contents(STDIN),true)["details"]["requested"],"\n";'

# no staircase
J=/tmp/cj.txt; rm -f $J; curl -sk -c $J -o /dev/null "https://flood-exp.test/api.php"
for i in 1 2 3 4 5 6; do
  curl -sk -b $J -o /dev/null -w '%{time_total}\n' "https://flood-exp.test/api.php?cam=1271&x=$i" &
done; wait

# a warm still is under 0.05s, and the newest frame route answers without immutable
curl -sk -o /dev/null -w '%{time_total}s\n' "https://flood-exp.test/api.php?cam=1271"
curl -sk -o /dev/null -D - "https://flood-exp.test/api.php?shot=$(ls shots | head -1)" | grep -i cache-control

# the payload revalidates
curl -sk -o /dev/null -D - "https://flood-exp.test/api.php" | grep -i 'cache-control\|etag'
```

## Documentation

`CLAUDE.md` requires a feature note as part of the change, not after it. Append to `docs/FEATURES.md` in the same commit series. State what each of the five changes does.
State the measured numbers. State two rules a later reader needs. `SIREN_TTL` must not grow to six
hours. The newest frame form must never take the `immutable` header.

Add one gotcha to `CLAUDE.md`. `session.auto_start` serializes every request from one browser.
`api.php` releases the session on its first statement.
