# Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The closed app on a phone gets one notification for a station the reader follows at warning or danger.

**Architecture:** At the end of a refresh, inside the refresh lock, `api.php` matches the new payload against each stored subscription. It sends at most one Web Push message per phone. The match rule and the diff rule are pure PHP functions in a new `push.php`, so `--selftest` can run them offline. The browser side is one deferred module, `js/push.js`, a Settings section, and two handlers in `sw.js`.

**Tech Stack:** PHP 8.2, `minishlink/web-push` (Composer, into `lib/`), the Web Push API and `showNotification()` in the service worker, plain ES modules.

**Spec:** `docs/superpowers/specs/2026-11-04-push-notifications-design.md`

## Global Constraints

- No commits per task. `CLAUDE.md` says one commit for one finished unit of work. The owner decides that the work is done. Leave every edit in the working tree and say so.
- Every string a reader sees obeys the writing rules in `CLAUDE.md`: sentence case, no hedging, none of our plumbing words, 24-hour Malaysian time.
- Every new control a preference owns carries `autocomplete="off"`, and the script writes the control from `PREFS`, never the reverse.
- An M3 switch is the component in `index.html` under `#devList` (`.msw`, `.mswtrack`, `.mswthumb`). Copy that markup.
- Levels are the two strings `'danger'` and `'warning'`. Nothing else names a level.
- Constants: `PUSH_AGAIN` 21600 seconds, `PUSH_CAM_M` 1000 metres, `PUSH_TEST_EVERY` 60 seconds, `PUSH_MAX_BODY` 16384 bytes. All in `push.php`.
- A station with `online` false, with `backed === false`, or with a reading stamp over 86400 seconds old never matches.
- The notification `tag` is the one string `'kvfw'`.
- `docs/FEATURES.md` gains a section as part of the change, not after it.
- `push.php` is required before the `--selftest` block in `api.php`, beside the `shots.php` require on line 79. The selftest exits early, so a `const` defined later is undefined there.
- Deploy steps on the box are the owner's. The plan writes them down and runs none of them.

## Review Focus

1. A subscription endpoint that is not `https://` or not an object. The handler must answer 400 and store nothing. Test in Task 2.
2. A phone that unsubscribes in the browser without telling the server. The push service answers 410, and the row must go. Test in Task 3.
3. A river that reads danger on one tick, warning on the next, then danger again inside six hours. The phone must hear the second danger. Test in Task 1.
4. A reader with only the danger rows on while a river falls from danger to warning. No "All clear" must fire. Test in Task 1.
5. A payload with no stations, or a station with no `lat`. The sender must skip and not throw inside the refresh lock. Test in Task 3.

---

### Task 1: The match rule and the diff rule, offline

**Files:**
- Create: `push.php`
- Modify: `api.php:79` (require), `api.php:1581-1700` (the `--selftest` block, add a section)

**Interfaces:**
- Produces: `pushLevel(array $s, int $now): ?string`. Returns `'danger'`, `'warning'` or `null`.
- Produces: `pushLevels(array $stations, int $now): array`. Station id to level, for every station that has one.
- Produces: `pushMatch(array $levels, array $on, array $favs, array $ignored): array`. The subset of `$levels` this phone listens to. `$on` is `['favWarn' => bool, 'favDanger' => bool, 'anyWarn' => bool, 'anyDanger' => bool]`.
- Produces: `pushDiff(array $matched, array $levels, array $seen, array $sent, int $now): array`. Returns `['notify' => string[], 'allClear' => bool, 'seen' => array, 'sent' => array]`.

- [ ] **Step 1: Write the failing selftest section in `api.php`**

Add after the `stationUpdated():` section:

```php
echo "\npushLevel():\n";
$live = ['online' => true, 'updated' => date('d/m/Y H:i:s', $now - 600)];
$ok('a river at 3 is danger',        pushLevel(['kind' => 'river', 'status' => 3] + $live, $now) === 'danger');
$ok('a river at 2 is warning',       pushLevel(['kind' => 'river', 'status' => 2] + $live, $now) === 'warning');
$ok('a rising river is warning',     pushLevel(['kind' => 'river', 'status' => 1, 'rising' => true] + $live, $now) === 'warning');
$ok('a river at 1 is nothing',       pushLevel(['kind' => 'river', 'status' => 1] + $live, $now) === null);
$ok('a sounding siren is danger',    pushLevel(['kind' => 'siren', 'status' => 1] + $live, $now) === 'danger');
$ok('a gauge at 2 is danger',        pushLevel(['kind' => 'gauge', 'status' => 2, 'depth' => 0.4] + $live, $now) === 'danger');
$ok('a gauge at 1 is warning',       pushLevel(['kind' => 'gauge', 'status' => 1, 'depth' => 0.2] + $live, $now) === 'warning');
$ok('rain class 4 is danger',        pushLevel(['kind' => 'rainfall', 'status' => 4, 'hourly' => 70] + $live, $now) === 'danger');
$ok('rain class 3 is warning',       pushLevel(['kind' => 'rainfall', 'status' => 3, 'hourly' => 40] + $live, $now) === 'warning');
$ok('a camera is nothing',           pushLevel(['kind' => 'camera'] + $live, $now) === null);
$ok('a faulty reading is nothing',   pushLevel(['kind' => 'siren', 'status' => 1, 'backed' => false] + $live, $now) === null);
$ok('an offline station is nothing', pushLevel(['kind' => 'river', 'status' => 3, 'online' => false, 'updated' => $live['updated']], $now) === null);
$ok('a stale reading is nothing',    pushLevel(['kind' => 'river', 'status' => 3, 'online' => true,
                                                'updated' => date('d/m/Y H:i:s', $now - 90000)], $now) === null);

echo "\npushMatch():\n";
$lv  = ['wl-1' => 'danger', 'wl-2' => 'warning', 'wl-3' => 'danger'];
$off = ['favWarn' => false, 'favDanger' => false, 'anyWarn' => false, 'anyDanger' => false];
$ok('nothing on matches nothing',    pushMatch($lv, $off, ['wl-1'], []) === []);
$ok('any danger takes danger alone', pushMatch($lv, ['anyDanger' => true] + $off, [], []) === ['wl-1' => 'danger', 'wl-3' => 'danger']);
$ok('any warning takes both levels', pushMatch($lv, ['anyWarn' => true] + $off, [], []) === $lv);
$ok('fav danger takes one favorite', pushMatch($lv, ['favDanger' => true] + $off, ['wl-1', 'wl-2'], []) === ['wl-1' => 'danger']);
$ok('fav warning takes favorites',   pushMatch($lv, ['favWarn' => true] + $off, ['wl-1', 'wl-2'], []) === ['wl-1' => 'danger', 'wl-2' => 'warning']);
$ok('an ignored id never matches',   pushMatch($lv, ['anyWarn' => true] + $off, [], ['wl-2']) === ['wl-1' => 'danger', 'wl-3' => 'danger']);

echo "\npushDiff():\n";
$d = fn($m, $l, $seen, $sent) => pushDiff($m, $l, $seen, $sent, $now);
$ok('a new station notifies',        $d(['wl-1' => 'danger'], ['wl-1' => 'danger'], [], [])['notify'] === ['wl-1']);
$ok('the same level is quiet',       $d(['wl-1' => 'danger'], ['wl-1' => 'danger'], ['wl-1' => 'danger'],
                                        ['wl-1' => ['danger', $now - 60]])['notify'] === []);
$ok('a rise notifies',               $d(['wl-1' => 'danger'], ['wl-1' => 'danger'], ['wl-1' => 'warning'],
                                        ['wl-1' => ['warning', $now - 60]])['notify'] === ['wl-1']);
$ok('a fall is quiet',               $d(['wl-1' => 'warning'], ['wl-1' => 'warning'], ['wl-1' => 'danger'],
                                        ['wl-1' => ['danger', $now - 60]])['notify'] === []);
$ok('a dip and a return notifies',   $d(['wl-1' => 'danger'], ['wl-1' => 'danger'], ['wl-1' => 'warning'],
                                        ['wl-1' => ['danger', $now - 600]])['notify'] === ['wl-1']);
$ok('a reminder fires at 6 h',       $d(['wl-1' => 'danger'], ['wl-1' => 'danger'], ['wl-1' => 'danger'],
                                        ['wl-1' => ['danger', $now - PUSH_AGAIN]])['notify'] === ['wl-1']);
$ok('a reminder waits under 6 h',    $d(['wl-1' => 'danger'], ['wl-1' => 'danger'], ['wl-1' => 'danger'],
                                        ['wl-1' => ['danger', $now - PUSH_AGAIN + 1]])['notify'] === []);
$ok('all clear when every seen station is below warning',
    $d([], [], ['wl-1' => 'danger'], ['wl-1' => ['danger', $now - 60]])['allClear'] === true);
$ok('no all clear while a seen station is still at warning',
    $d([], ['wl-1' => 'warning'], ['wl-1' => 'danger'], ['wl-1' => ['danger', $now - 60]])['allClear'] === false);
$ok('no all clear from nothing',     $d([], [], [], [])['allClear'] === false);
$ok('seen is the new matched set',   $d(['wl-1' => 'danger'], ['wl-1' => 'danger'], [], [])['seen'] === ['wl-1' => 'danger']);
$ok('sent stamps a notified id',     $d(['wl-1' => 'danger'], ['wl-1' => 'danger'], [], [])['sent'] === ['wl-1' => ['danger', $now]]);
$ok('sent drops a cleared id',       $d([], [], ['wl-1' => 'danger'], ['wl-1' => ['danger', $now - 60]])['sent'] === []);
```

- [ ] **Step 2: Run the selftest to make sure that it fails**

Run: `php api.php --selftest`
Expected: a fatal error, `Call to undefined function pushLevel()`.

- [ ] **Step 3: Create `push.php` with the four functions and the constants**

`pushLevel()` has three gates. If `online` is not true, return `null`. If `backed === false`, return `null`. If `$now - readTs($s['updated'] ?? null, $now) > 86400`, return `null`. Then by kind: river `status >= 3` danger, `status === 2` or `rising === true` warning. Siren `status > 0` danger. Gauge `status >= 2` danger, `status >= 1` warning, and `depth > 0` for both. Rainfall `status >= 4` danger, `status === 3` warning, and `hourly > 0` for both. Any other kind `null`.

`pushMatch()` drops an id in `$ignored`. One of these conditions keeps an id:

- `anyWarn` is true.
- `anyDanger` is true and the level is danger.
- the id is in `$favs` and `favWarn` is true.
- the id is in `$favs` and `favDanger` is true and the level is danger.

One of these conditions makes `pushDiff()` notify an id:

- the id is not in `$seen`.
- `$seen[$id]` is warning and `$matched[$id]` is danger.
- `$sent[$id]` holds the same level and is `PUSH_AGAIN` or more seconds old.

If `$seen` is not empty and no key of `$seen` is a key of `$levels`, `allClear` is true. The returned `seen` is `$matched`. The returned `sent` is `$sent` with each notified id set to `[$level, $now]`. Every id not in `$matched` is removed from it.

Add `require_once __DIR__ . '/push.php';` under the `shots.php` line in `api.php`.

- [ ] **Step 4: Run the selftest to make sure that it passes**

Run: `php api.php --selftest`
Expected: every `pushLevel`, `pushMatch` and `pushDiff` line prints `ok`, and the exit code is 0.

---

### Task 2: Store a subscription

**Files:**
- Modify: `push.php` (add the validator), `api.php` (two handlers before the `?place=` handler at line 575; the `CREATE TABLE` beside line 3365)
- Create: `push-keys.php`
- Modify: `.gitignore`, `composer.json`

**Interfaces:**
- Consumes: `forceAllowed()` from `api.php`.
- Produces: `pushDoc(string $raw): ?array`. The accepted document or `null`. The document is `['sub' => array|null, 'endpoint' => ?string, 'on' => [4 bools by name], 'favs' => string[], 'ignored' => string[]]`.
- Produces: `pushKeys(): ?array`. Returns `['publicKey', 'privateKey', 'subject']` from `.vapid.json`, or `null`.
- Produces: table `push(endpoint TEXT PRIMARY KEY, body TEXT, seen TEXT, sent TEXT, ts INTEGER)` in `.history.db`.
- Produces: `GET api.php?push=key` answers `{"key": "<public>"}`, or 503 `{"key": null}` with no key file.
- Produces: `POST api.php?push=1` with a document answers `{"ok": true}`. With `sub` null it deletes the row. A bad document answers 400 `{"ok": false}`.

- [ ] **Step 1: Write the failing selftest section**

```php
echo "\npushDoc():\n";
$sub = ['endpoint' => 'https://fcm.googleapis.com/x', 'keys' => ['p256dh' => 'a', 'auth' => 'b']];
$good = json_encode(['sub' => $sub, 'on' => ['favWarn' => true, 'favDanger' => true, 'anyWarn' => false, 'anyDanger' => false],
                     'favs' => ['wl-1'], 'ignored' => []]);
$ok('a good document passes',           is_array(pushDoc($good)));
$ok('a warning switch locks its danger switch',
    pushDoc(json_encode(['sub' => $sub, 'on' => ['favWarn' => true, 'favDanger' => false, 'anyWarn' => true, 'anyDanger' => false],
                         'favs' => [], 'ignored' => []]))['on'] === ['favWarn' => true, 'favDanger' => true, 'anyWarn' => true, 'anyDanger' => true]);
$ok('a null sub passes, for a delete',  pushDoc(json_encode(['sub' => null, 'on' => [], 'favs' => [], 'ignored' => []]))['sub'] === null);
$ok('an http endpoint fails',           pushDoc(str_replace('https://', 'http://', $good)) === null);
$ok('a sub with no keys fails',         pushDoc(json_encode(['sub' => ['endpoint' => 'https://x'], 'on' => [], 'favs' => [], 'ignored' => []])) === null);
$ok('a non-object fails',               pushDoc('[1,2]') === null);
$ok('a bad station id fails',           pushDoc(json_encode(['sub' => $sub, 'on' => [], 'favs' => ['../etc'], 'ignored' => []])) === null);
$ok('too many ids fail',                pushDoc(json_encode(['sub' => $sub, 'on' => [], 'favs' => array_fill(0, 1001, 'wl-1'), 'ignored' => []])) === null);
$ok('a body over the cap fails',        pushDoc(str_repeat(' ', PUSH_MAX_BODY + 1) . $good) === null);
```

- [ ] **Step 2: Run the selftest to make sure that it fails**

Run: `php api.php --selftest`
Expected: `Call to undefined function pushDoc()`.

- [ ] **Step 3: Implement `pushDoc()` and `pushKeys()` in `push.php`**

`pushDoc()` refuses a string longer than `PUSH_MAX_BODY`. It refuses a decode that is not an array. It refuses a `sub` that is not null and lacks an `endpoint` starting `https://`. It refuses a `sub` that lacks string `keys.p256dh` and `keys.auth`. `on` becomes the four named booleans, missing ones false. If `favWarn` is true, `favDanger` becomes true. If `anyWarn` is true, `anyDanger` becomes true. `favs` and `ignored` must be arrays of at most 1000 strings matching `/^[a-z]+-\d+$/`. `endpoint` is an optional `https://` string, for a delete. Return the five keys and nothing else.

`pushKeys()` reads `STATE . '/.vapid.json'` and returns the three strings. If the file is missing or malformed, it returns `null`.

- [ ] **Step 4: Run the selftest to make sure that it passes**

Run: `php api.php --selftest`
Expected: every `pushDoc` line prints `ok`.

- [ ] **Step 5: Add the two handlers to `api.php` before the `?place=` block**

`?push=key`: GET, `Content-Type: application/json`, `Cache-Control: max-age=3600`. Body from `pushKeys()`.

`?push=1`: POST only, else 405. Read `php://input` with the `MAX_BODY` shape `log.php` uses, at `PUSH_MAX_BODY`. `pushDoc()` null answers 400. Open `.history.db` inside try/catch the way the `?place=` handler does, and `CREATE TABLE IF NOT EXISTS push (...)`. With `sub` null, `DELETE FROM push WHERE endpoint = ?` using the document's `endpoint` field. Otherwise `INSERT INTO push (endpoint, body, seen, sent, ts) VALUES (?, ?, '{}', '{}', ?) ON CONFLICT(endpoint) DO UPDATE SET body = excluded.body, ts = excluded.ts`. `seen` and `sent` are kept on an update, because a changed switch must not replay every open alert.

Add the same `CREATE TABLE` beside the `station` table at `api.php:3368`, so a refresh with no subscriber ever can still `SELECT`.

- [ ] **Step 6: Test the handlers against Herd**

Run from PowerShell:

```powershell
Invoke-RestMethod https://flood-exp.test/api.php?push=key
$b = '{"sub":{"endpoint":"https://example.invalid/x","keys":{"p256dh":"a","auth":"b"}},"on":{"anyDanger":true},"favs":[],"ignored":[]}'
Invoke-RestMethod -Method Post -Uri 'https://flood-exp.test/api.php?push=1' -Body $b -ContentType application/json
Invoke-RestMethod -Method Post -Uri 'https://flood-exp.test/api.php?push=1' -Body '{"sub":"nope"}' -ContentType application/json
```

Expected: `key` is null with a 503 before Step 7 and a string after. The second call answers `ok: true`. The third throws with status 400. Then `sqlite3 .history.db "select endpoint from push"` lists one row.

- [ ] **Step 7: Create `push-keys.php` and the Composer dependency**

Add `"minishlink/web-push": "^9.0"` to `composer.json` and run `composer install`. `push-keys.php` is CLI only. It refuses to overwrite an existing `.vapid.json`. It calls `Minishlink\WebPush\VAPID::createVapidKeys()` and writes `{"publicKey", "privateKey", "subject"}`, with `subject` from `--subject=` and a default of `https://floodwatch.taila2a82f5.ts.net`. Add `.vapid.json` to `.gitignore`.

Run: `php push-keys.php` then `php push-keys.php` again.
Expected: the first prints the file path. The second refuses and exits 1.

---

### Task 3: Send

**Files:**
- Modify: `push.php` (the body builder and the sender), `api.php:4436` (call after `captureShots($stations)`), `api.php` (the `?push=test` handler beside the two from Task 2)

**Interfaces:**
- Consumes: everything Task 1 and Task 2 produce.
- Produces: `pushCam(array $s, array $stations): ?int`. The bare integer id of the nearest online camera with an image within `PUSH_CAM_M`, or `null`. The id is the integer after `camera-`.
- Produces: `pushBody(array $ids, array $matched, array $stations): array`. Returns `['title', 'body', 'image' (string|null), 'url', 'tag']`.
- Produces: `pushAllClear(): array`. The same shape.
- Produces: `pushSend(PDO $db, array $stations, int $now): void`.
- Produces: `POST api.php?push=test` with `{"sub": ...}`. It sends `pushBody()` for a fixed fake station to that subscription alone. `forceAllowed()` on `STATE . '/.pushtest.stamp'` at `PUSH_TEST_EVERY` limits it. It answers `{"ok": true}`. If limited, it answers 429. If no keys, it answers 503.

- [ ] **Step 1: Write the failing selftest section**

```php
echo "\npushBody():\n";
$st = [
  ['id' => 'wl-1', 'kind' => 'river', 'name' => 'Sg. Klang di Jln Tun Razak', 'lat' => 3.17, 'lng' => 101.70,
   'level' => 5.32, 'danger' => 4.8, 'status' => 3],
  ['id' => 'rf-2', 'kind' => 'rainfall', 'name' => 'Taman Melawati', 'lat' => 3.21, 'lng' => 101.75, 'hourly' => 41, 'status' => 3],
  ['id' => 'camera-9', 'kind' => 'camera', 'name' => 'Cam', 'lat' => 3.175, 'lng' => 101.70, 'online' => true, 'image' => 'http://x/y.jpg'],
  ['id' => 'camera-8', 'kind' => 'camera', 'name' => 'Far', 'lat' => 3.30, 'lng' => 101.70, 'online' => true, 'image' => 'http://x/z.jpg'],
];
$one = pushBody(['wl-1'], ['wl-1' => 'danger'], $st);
$ok('one station names it in the title',    $one['title'] === 'Sg. Klang di Jln Tun Razak at danger');
$ok('one river states the reading and mark', $one['body'] === '5.32 m. Danger mark 4.80 m.');
$ok('one station opens its card',           $one['url'] === '#station=wl-1');
$ok('the near camera is the picture',       $one['image'] === 'api.php?cam=9');
$ok('the tag is the one constant',          $one['tag'] === 'kvfw');
$ok('a camera over 1 km is no picture',     pushCam($st[1], $st) === null);
$two = pushBody(['wl-1', 'rf-2'], ['wl-1' => 'danger', 'rf-2' => 'warning'], $st);
$ok('several count by level',               $two['title'] === '1 at danger, 1 at warning');
$ok('several name the worst in the body',   str_starts_with($two['body'], 'Sg. Klang di Jln Tun Razak. 5.32 m.'));
$ok('several open the alert list',          $two['url'] === '#alerts');
$ok('rain states mm in an hour',            pushBody(['rf-2'], ['rf-2' => 'warning'], $st)['body'] === '41 mm in an hour.');
$ok('a station with no lat gets no picture', pushCam(['id' => 'x', 'kind' => 'river'], $st) === null);
$ok('all clear has its own words',          pushAllClear()['title'] === 'All clear');
```

- [ ] **Step 2: Run the selftest to make sure that it fails**

Run: `php api.php --selftest`
Expected: `Call to undefined function pushBody()`.

- [ ] **Step 3: Implement `pushCam()`, `pushBody()` and `pushAllClear()` in `push.php`**

Distance uses the `hypot(... cos(deg2rad(...))) * 111000` form at `api.php:4143`. A station with no numeric `lat` or `lng` returns `null`.

Body lines by kind:

- River: `{level} m. Danger mark {danger} m.` with two decimals.
- Rainfall: `{hourly} mm in an hour.` with no decimals.
- Gauge: `{depth} m of water over the spot.` with two decimals.
- Siren: `Siren sounding.`

Title for one station: `{name} at {level}`. Title for several: `{n} at danger, {m} at warning`. A zero count drops its clause. Body for several: `{worst name}. {its line}`. The worst is the first danger in `$ids`, else the first id. `image` is `api.php?cam={id}` for the title station, or `null`. All clear: title `All clear`, body `No station you follow is at warning or danger.`, url `#alerts`, image null.

- [ ] **Step 4: Run the selftest to make sure that it passes**

Run: `php api.php --selftest`
Expected: every `pushBody` line prints `ok`.

- [ ] **Step 5: Implement `pushSend()` and wire it**

If `pushKeys()` is null or `$stations` is empty, `pushSend()` returns at once. It computes `$levels = pushLevels($stations, $now)` once. For each row of `push`: decode `body`, `seen`, `sent`. Run `pushMatch()` then `pushDiff()`. If `notify` is not empty, build the payload with `pushBody()`. If `notify` is empty and `allClear` is true, build it with `pushAllClear()`. In every other case send nothing. Queue on one `Minishlink\WebPush\WebPush` with the VAPID array, `['TTL' => 3600, 'urgency' => 'high']`. After the loop, `flush()`. For each report with `isSubscriptionExpired()`, delete its row. Write `seen` and `sent` back for every row, sent or not. Wrap each row's work in try/catch and `error_log('push: ' . $e->getMessage())`, so one row cannot stop the next.

In `api.php`, after `captureShots($stations);` on line 4436, add `pushSend($db, $stations, $now);`.

Add the `?push=test` handler. It reads a document through `pushDoc()`, takes the rate stamp through `forceAllowed()`, and sends `pushBody(['wl-0'], ['wl-0' => 'danger'], [one fake river named 'Test station' at 5.32 m with danger 4.80])` to that one subscription.

- [ ] **Step 6: Test the sender does not throw on an empty table and a bad row**

Run: `php -r "require 'api.php';"` is not possible, because `api.php` runs the request. Instead run `php api.php --selftest` and add two cases:

```php
echo "\npushSend():\n";
$mem = new PDO('sqlite::memory:');
$mem->exec('CREATE TABLE push (endpoint TEXT PRIMARY KEY, body TEXT, seen TEXT, sent TEXT, ts INTEGER)');
$mem->exec("INSERT INTO push VALUES ('https://example.invalid/x', 'not json', '{}', '{}', 0)");
pushSend($mem, $st, $now);
$ok('a bad row does not throw',             true);
pushSend($mem, [], $now);
$ok('an empty payload does not throw',      true);
```

Expected: both print `ok`, and `.php-error.log` gains one `push:` line for the bad row. Without a `.vapid.json` the sender returns before the loop, so run this part with the key file present.

---

### Task 4: The service worker

**Files:**
- Modify: `sw.js` (two handlers at the end)

**Interfaces:**
- Consumes: the payload shape from Task 3. `image` and `url` are relative to the app root.
- Produces: a `push` handler and a `notificationclick` handler.

- [ ] **Step 1: Add the `push` handler**

`e.data.json()` inside try/catch. `showNotification(p.title, { body, tag: p.tag, icon: 'icon-192.png', badge: 'icon-192.png', image: p.image ? new URL(p.image, self.registration.scope).href : undefined, data: { url: new URL(p.url, self.registration.scope).href }, renotify: true })` inside `e.waitUntil()`.

- [ ] **Step 2: Add the `notificationclick` handler**

Close the notification. `clients.matchAll({ type: 'window', includeUncontrolled: true })`. If a client exists, `client.navigate(url)` then `client.focus()`. Else `clients.openWindow(url)`. All inside `e.waitUntil()`.

- [ ] **Step 3: Make sure that the build keeps both handlers**

Run: `npm run build` then search `site/sw.js` for `notificationclick`.
Expected: one match. `build.mjs` replaces two lines only, so no edit to it is expected. If the search finds nothing, the build is the fault.

---

### Task 5: The browser side

**Files:**
- Create: `js/push.js`
- Modify: `index.html`, a Notifications section after the Alerts group, before Developer
- Modify: `js/ui.js`, write the controls from `PREFS.push`, wire the switches and the test row
- Modify: `js/state.js:28`, dispatch a `prefs` event in `save()`
- Modify: `js/app.js`, the hash reader and the sync on landing
- Modify: `js/ask.js`, pass `method` and `body` through to `fetch()`

**Interfaces:**
- Consumes: `GET api.php?push=key`, `POST api.php?push=1`, `POST api.php?push=test` from Tasks 2 and 3. `flashTo(t)` from `js/map.js`, `byId(id)` from `js/stations.js`, `toggleAlerts()` from `js/alerts.js`, `lazy()` from `js/lazy.js`, `snack()` from `js/util.js`.
- Produces: `PREFS.push = { on, favWarn, favDanger, anyWarn, anyDanger }`, all booleans, default all false.
- Produces in `js/push.js`: `pushState(): 'ok' | 'denied' | 'insecure' | 'unsupported'`, `pushOn(): Promise<boolean>`, `pushOff(): Promise<void>`, `pushSync(): Promise<void>`, `pushTest(): Promise<void>`.
- Produces: `save()` in `js/state.js` dispatches `document` event `prefs` after it writes.

- [ ] **Step 1: Write the Settings markup**

After `#alertSetList` and its comment, add `<h3 id="pushHead">Notifications</h3>` and `<ul id="pushList" class="picklist mlist">` with six rows in this order. Each switch row copies the `#hideFaulty` row's markup, with the glyph, headline and supporting line stated below, and `autocomplete="off"` on the input.

| id | glyph | headline | supporting line |
|---|---|---|---|
| `pushOn` | `notifications` | Show notifications | Reaches this phone while the app is closed. |
| `pushFavWarn` | empty | Favorites at warning | A favorite reaches its warning mark or worse. |
| `pushFavDanger` | empty | Favorites at danger | A favorite reaches its danger mark. |
| `pushAnyWarn` | empty | Any station at warning | Any station reaches warning or worse. |
| `pushAnyDanger` | empty | Any station at danger | Any station reaches its danger mark. |
| `pushTest` | empty | Send a test notification | (an action row, `<button class="mrow">`, no switch) |

An empty glyph slot is `<i class="glyph" aria-hidden="true"></i>`, the shape `#devReadings` uses. Each supporting line sits in `<span id="…Note" class="muted">` so the script can rewrite the master's.

- [ ] **Step 2: Create `js/push.js`**

`pushState()` answers in this order. If `PushManager` or `serviceWorker` is missing, `'unsupported'`. If `!isSecureContext`, `'insecure'`. If `Notification.permission === 'denied'`, `'denied'`. Else `'ok'`.

`pushOn()`: `Notification.requestPermission()`. On anything but `'granted'` return false. Else fetch `?push=key`, `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` with the base64url to `Uint8Array` conversion, then `pushSync()`, return true.

`pushSync()`: when `PREFS.push?.on` is false, return. Get the subscription. POST `{ sub: sub.toJSON(), on: PREFS.push, favs: PREFS.favs || [], ignored: PREFS.ignored || [] }` to `?push=1` through `askJson(url, { method: 'POST', body })`. `askJson()` has no `method` option today, so add `method` and `body` pass-through to its `fetch()` call, the same way it passes `cache`.

`pushOff()`: get the subscription, POST `{ sub: null, endpoint: sub.endpoint, on: {}, favs: [], ignored: [] }`, then `sub.unsubscribe()`.

`pushTest()`: POST `{ sub, on: {}, favs: [], ignored: [] }` to `?push=test`.

A `document` listener on `prefs` waits 2000 ms after the last event. If `JSON.stringify([PREFS.push, PREFS.favs, PREFS.ignored])` differs from the last posted string, it calls `pushSync()`.

- [ ] **Step 3: Wire the controls in `js/ui.js`**

`syncPush()` writes the five boxes from `PREFS.push`. It toggles each `.msw` `on` class the way `sayFaulty()` does. It disables the four rows while the master is off. It sets `pushFavDanger.disabled = pushFavWarn.checked` and `pushAnyDanger.disabled = pushAnyWarn.checked`. Each danger box is checked while its warning box is. The master's supporting line reads by `pushState()`. For `'denied'`: `Blocked in the browser's site settings.` For `'insecure'`: `Needs the installed app.` For `'unsupported'`: `Not available in this browser.` Those three disable the master too.

The master `onchange`: on, `lazy('./push.js')` then `pushOn()`; a false return sets the box back and runs `syncPush()`. Off, `pushOff()`. Both set `PREFS.push.on` and `save()`.

The four rows `onchange`: write `PREFS.push[key]` from the box, apply the lock rule into `PREFS.push`, `save()`, `syncPush()`.

`pushTest` `onclick`: `snack('Sending…')` then `pushTest()`. On success `snack('Sent. Watch for it.')`. On failure `snack('Failed. ' + e.message)`.

`if (STATIC)` hide `#pushHead` and `#pushList`.

- [ ] **Step 4: Dispatch `prefs` from `save()` and sync on landing**

`js/state.js`: after `localStorage.setItem(...)`, `document.dispatchEvent(new Event('prefs'))`.

`js/app.js`: after the first `poll` event, `if (PREFS.push?.on) import('./push.js').then(m => m.pushSync())`. Also the hash reader, once: `#station=<id>` → `const t = byId(id); if (t) flashTo(t)`. `#alerts` → `toggleAlerts()`. Then `history.replaceState(null, '', location.pathname + location.search)`.

- [ ] **Step 5: Test by hand in Chrome against Herd**

Open `https://flood-exp.test`, Settings, turn the master on, accept the permission, press Send a test notification.
Expected: a notification titled `Test station at danger` within a few seconds, and a tap on it opens the app on the alert list. Turn the master off and `sqlite3 .history.db "select count(*) from push"` prints 0.

---

### Task 6: The rendered check

**Files:**
- Modify: `m3-check.html` (after the Developer group block at line 2144)

- [ ] **Step 1: Add the assertions**

```js
/* --- the Notifications group --- */
const pl = d.getElementById('pushList');
is([...pl.children].map(x => x.querySelector('[id]')?.id).join(','),
   'pushOn,pushFavWarn,pushFavDanger,pushAnyWarn,pushAnyDanger,pushTest',
   'notifications: master, four thresholds, then the test row');
is(pl.querySelectorAll('.msw').length, 5, 'notifications: five M3 switches');
is(d.getElementById('pushFavWarn').disabled, true, 'notifications: a row is disabled while the master is off');
is(d.getElementById('pushTest').closest('li').querySelector('.msw'), null, 'notifications: the test row is an action, not a switch');
```

- [ ] **Step 2: Run the check on both targets**

Run: `chrome --headless --dump-dom https://flood-exp.test/m3-check.html` and again with `?base=/site/` after `npm run build`.
Expected: the four new lines print as passes, and the pass count is unchanged otherwise.

---

### Task 7: Documentation

**Files:**
- Modify: `docs/FEATURES.md`, `docs/DEPLOY.md`, `docs/VERIFY.md`, `CLAUDE.md`

- [ ] **Step 1: `docs/FEATURES.md`**

Append a section "Push notifications". It states what the feature does and why. It covers the two levels and the rule behind each. It covers the one-per-tick fold, the 6 hour reminder and the all-clear test. It covers the test row and the tag. It names the three things not built: quiet hours, MET warnings, GitHub Pages. Add one line under "Alert design standard" for how this surface clears it. It reports a change and never a state. It folds a flood of changes into one message. It carries CAP's `AllClear`.

- [ ] **Step 2: `docs/DEPLOY.md`**

Under the Debian section add the owner's steps, in order: `tailscale serve --bg 80`, `composer install`, `php push-keys.php`. Add `--exclude='.vapid.json'` to the rsync. State that the https name is a new origin and a phone installed from the http address keeps its lists there. Replace the paragraph at line 523 that points at ntfy with a pointer to this feature.

- [ ] **Step 3: `docs/VERIFY.md` and `CLAUDE.md`**

In `docs/VERIFY.md`, add the hand test from Task 5 Step 5. In `CLAUDE.md`, add `push.php`, `push-keys.php` and `.vapid.json` to the file table. Add the two new `api.php` handlers to the `## api.php` list. Add one line to the roll of nine checks: `--selftest` now covers the push rules.

- [ ] **Step 4: Run the lint hook and the two PHP checks one last time**

Run: `php api.php --selftest` and `php shots-test.php`.
Expected: both exit 0.
