<?php
/* Push notifications. The match rule, the diff rule, the body builder and the sender.
 *
 * Required by api.php, which defines STATE, HIST and readTs() that this file reads. The rules are
 * pure functions so `php api.php --selftest` can run them offline. See
 * docs/superpowers/specs/2026-11-04-push-notifications-design.md for what each one is for and why.
 */

const PUSH_AGAIN       = 21600;   // a station that holds its level is mentioned again after 6 hours
const PUSH_CAM_M       = 1000;    // a camera further than this from the station is no picture
const PUSH_TEST_EVERY  = 60;      // the test send, site-wide, through forceAllowed()
const PUSH_MAX_BODY    = 16384;   // a phone's document is a few hundred bytes. This is generous.
const PUSH_STALE       = 86400;   // a reading older than this never pushes. isStale() in js/util.js
const PUSH_BUDGET      = 8.0;     // seconds the sender may spend in one refresh. PHP's own limit is 30
const PUSH_TIMEOUT     = 4;       // seconds one push service gets to answer

/* The one document a phone posts: its subscription, its four switches and its two lists. Returns the
   accepted document, or null for anything else. A null `sub` is a delete, and it names the row by
   `endpoint`. This is a public POST, so nothing leaves here that was not checked. */
function pushDoc(string $raw): ?array {
    if (strlen($raw) > PUSH_MAX_BODY) return null;
    $d = json_decode($raw, true);
    if (!is_array($d) || array_is_list($d)) return null;

    $https = fn($u) => is_string($u) && str_starts_with($u, 'https://') && strlen($u) <= 1024;
    $sub = $d['sub'] ?? null;
    if ($sub !== null) {
        if (!is_array($sub) || !$https($sub['endpoint'] ?? null)
            || !is_string($sub['keys']['p256dh'] ?? null) || !is_string($sub['keys']['auth'] ?? null)) return null;
        $sub = ['endpoint' => $sub['endpoint'],
                'keys' => ['p256dh' => $sub['keys']['p256dh'], 'auth' => $sub['keys']['auth']]];
    }
    $endpoint = $d['endpoint'] ?? null;
    if ($endpoint !== null && !$https($endpoint)) return null;

    $on = [];
    foreach (['favWarn', 'favDanger', 'anyWarn', 'anyDanger'] as $k) $on[$k] = !empty($d['on'][$k]);
    if ($on['favWarn']) $on['favDanger'] = true;   // "at warning" means warning or worse
    if ($on['anyWarn']) $on['anyDanger'] = true;

    $lists = [];
    foreach (['favs', 'ignored'] as $k) {
        $v = $d[$k] ?? [];
        if (!is_array($v) || count($v) > 1000) return null;
        /* A station id is a prefix and a code: `wl-1`, `kl-wl-0230501WL`, `prf-<32 hex>`, `camera-100003`.
           The first version of this pattern knew `wl-1` alone and refused every Kuala Lumpur and portal
           station, which locked those readers out of notifications entirely. Letters, digits and
           hyphens, bounded. Nothing here reaches a path or a query, so this is a shape check. */
        foreach ($v as $id) if (!is_string($id) || !preg_match('/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/D', $id)) return null;
        $lists[$k] = array_values($v);
    }
    return ['sub' => $sub, 'endpoint' => $endpoint, 'on' => $on] + $lists;
}

const PUSH_MAX_ROWS = 500;   // a ceiling on stored subscriptions, so a public POST cannot fill the disk

function pushTable(PDO $db): void {
    $db->exec('CREATE TABLE IF NOT EXISTS push (endpoint TEXT PRIMARY KEY, body TEXT, seen TEXT, sent TEXT,
                                                ts INTEGER) WITHOUT ROWID');
}

/* Store or delete one phone's document. An update keeps `seen` and `sent`, because a changed switch
   must not replay every alert the phone already heard. Throws InvalidArgumentException with an HTTP
   status as its code: 400 for a delete that names no endpoint, 429 for a full table. */
function pushStore(PDO $db, array $doc, int $now): void {
    if ($doc['sub'] === null) {
        if ($doc['endpoint'] === null) throw new InvalidArgumentException('no endpoint', 400);
        $db->prepare('DELETE FROM push WHERE endpoint = ?')->execute([$doc['endpoint']]);
        return;
    }
    $ep = $doc['sub']['endpoint'];
    $have = $db->prepare('SELECT 1 FROM push WHERE endpoint = ?');
    $have->execute([$ep]);
    if (!$have->fetchColumn() && (int)$db->query('SELECT COUNT(*) FROM push')->fetchColumn() >= PUSH_MAX_ROWS)
        throw new InvalidArgumentException('full', 429);
    $body = json_encode(['sub' => $doc['sub'], 'on' => $doc['on'], 'favs' => $doc['favs'], 'ignored' => $doc['ignored']]);
    $db->prepare("INSERT INTO push (endpoint, body, seen, sent, ts) VALUES (?, ?, '{}', '{}', ?)
                  ON CONFLICT(endpoint) DO UPDATE SET body = excluded.body, ts = excluded.ts")
       ->execute([$ep, $body, $now]);
}

/** The VAPID pair `push-keys.php` wrote, or null when there is none or it is unreadable. */
function pushKeys(): ?array {
    $k = json_decode((string)@file_get_contents(STATE . '/.vapid.json'), true);
    foreach (['publicKey', 'privateKey', 'subject'] as $f) if (!is_string($k[$f] ?? null)) return null;
    return ['publicKey' => $k['publicKey'], 'privateKey' => $k['privateKey'], 'subject' => $k['subject']];
}

/* The level a station is at for a phone, or null when it is at neither.
   Two levels, mapped from the client's tiers in js/util.js: danger is `now`, warning is `soon` and
   `heavy` plus a river at its own warning mark. A station the app itself sets aside never matches. */
function pushLevel(array $s, int $now): ?string {
    if (empty($s['online']) || ($s['backed'] ?? null) === false) return null;
    if ($now - readTs($s['updated'] ?? null, $now) > PUSH_STALE) return null;
    $st = (int)($s['status'] ?? 0);
    switch ($s['kind'] ?? '') {
        case 'river':
            return $st >= 3 ? 'danger' : ($st === 2 || !empty($s['rising']) ? 'warning' : null);
        case 'siren':
            return $st > 0 ? 'danger' : null;
        case 'gauge':
            if (!(($s['depth'] ?? 0) > 0)) return null;
            return $st >= 2 ? 'danger' : ($st >= 1 ? 'warning' : null);
        case 'rainfall':
            if (!(($s['hourly'] ?? 0) > 0)) return null;
            return $st >= 4 ? 'danger' : ($st === 3 ? 'warning' : null);
    }
    return null;
}

/* The stations this tick can read and that read calm or worse: online, fresh, not set aside as faulty,
   and with a status the feed actually published (-1 is a failed detail call). A station that is not
   in this set is UNKNOWN, which is not the same as safe. pushDiff() reads it so "All clear" is never
   sent for a river that merely went dark. Keyed by id. */
function pushKnown(array $stations, int $now): array {
    $out = [];
    foreach ($stations as $s) {
        if (!isset($s['id']) || empty($s['online']) || ($s['backed'] ?? null) === false) continue;
        if ((int)($s['status'] ?? 0) < 0) continue;
        if ($now - readTs($s['updated'] ?? null, $now) > PUSH_STALE) continue;
        $out[$s['id']] = true;
    }
    return $out;
}

/** Station id to level, for every station that is at one. */
function pushLevels(array $stations, int $now): array {
    $out = [];
    foreach ($stations as $s) {
        $l = pushLevel($s, $now);
        if ($l !== null && isset($s['id'])) $out[$s['id']] = $l;
    }
    return $out;
}

/* The part of `$levels` this phone listens to. A row names a threshold: "at warning" is warning or
   worse, so the warning switch takes both levels. `$ignored` outranks every switch. */
function pushMatch(array $levels, array $on, array $favs, array $ignored): array {
    $out = [];
    foreach ($levels as $id => $lvl) {
        if (in_array($id, $ignored, true)) continue;
        $fav = in_array($id, $favs, true);
        $danger = $lvl === 'danger';
        if (!empty($on['anyWarn'])
            || (!empty($on['anyDanger']) && $danger)
            || ($fav && !empty($on['favWarn']))
            || ($fav && !empty($on['favDanger']) && $danger)) $out[$id] = $lvl;
    }
    return $out;
}

/* What to tell one phone this tick. `$seen` is each matched station's level on the last tick, so a
   river that dips and climbs back wakes the phone again. `$sent` is the level and the time of the
   last notification about it, which is what the reminder reads. The reminder ignores the level in
   `$sent`, so a river that falls from danger to warning and stays there still gets its reminder. */
function pushDiff(array $matched, array $levels, array $seen, array $sent, int $now, ?array $known = null): array {
    $notify = [];
    foreach ($matched as $id => $lvl) {
        $new    = !isset($seen[$id]);
        $rose   = ($seen[$id] ?? null) === 'warning' && $lvl === 'danger';
        $remind = isset($sent[$id]) && $now - $sent[$id][1] >= PUSH_AGAIN;
        if ($new || $rose || $remind) $notify[] = $id;
    }
    /* A station heard about and now UNKNOWN: not at a level, and not readable either. "All clear" needs a
       station the app can read and that reads calm, so an unknown one blocks it and stays in `seen`,
       which also means its return at the same level is not news. It stops blocking after PUSH_STALE
       from the last notification about it, so a station that never comes back cannot hold the phone
       off "All clear" for ever. `$known` null means every station is readable, which is what the
       rules above this one were tested against. */
    $unknown = [];
    if ($known !== null)
        foreach ($seen as $id => $lvl)
            if (!isset($levels[$id]) && !isset($known[$id]) && isset($sent[$id]) && $now - $sent[$id][1] < PUSH_STALE)
                $unknown[$id] = $lvl;
    $allClear = $seen && !array_intersect_key($seen, $levels) && !$unknown;
    $sentOut = array_intersect_key($sent, $matched + $unknown);
    foreach ($notify as $id) $sentOut[$id] = [$matched[$id], $now];
    return ['notify' => $notify, 'allClear' => (bool)$allClear, 'seen' => $matched + $unknown, 'sent' => $sentOut];
}

/* The bare integer id of the nearest online camera with a picture, within PUSH_CAM_M of the station.
   `?cam=` keys on that integer, so `camera-9` is 9 and a KL camera keeps its offset. Same equirectangular
   distance the rest of api.php uses. */
function pushCam(array $s, array $stations): ?int {
    if (!is_numeric($s['lat'] ?? null) || !is_numeric($s['lng'] ?? null)) return null;
    $best = null;
    $bestM = PUSH_CAM_M + 1;
    foreach ($stations as $c) {
        if (($c['kind'] ?? '') !== 'camera' || empty($c['online']) || empty($c['image'])) continue;
        if (!is_numeric($c['lat'] ?? null) || !is_numeric($c['lng'] ?? null)) continue;
        if (!str_starts_with((string)($c['id'] ?? ''), 'camera-')) continue;
        $m = hypot($s['lat'] - $c['lat'], ($s['lng'] - $c['lng']) * cos(deg2rad($s['lat']))) * 111000;
        if ($m < $bestM) { $best = (int)substr($c['id'], 7); $bestM = $m; }
    }
    return $best;
}

/* One station's reading as a sentence. The mark is named because it is what makes the number mean
   something. An empty string means the feed gave no number to print. */
function pushLine(array $s): string {
    $m = fn($v, $d) => number_format((float)$v, $d, '.', '');
    switch ($s['kind'] ?? '') {
        case 'river':
            if (!is_numeric($s['level'] ?? null)) return '';
            return $m($s['level'], 2) . ' m.'
                . (is_numeric($s['danger'] ?? null) ? ' Danger mark ' . $m($s['danger'], 2) . ' m.' : '');
        case 'gauge':
            return is_numeric($s['depth'] ?? null) ? $m($s['depth'], 2) . ' m of water over the spot.' : '';
        case 'rainfall':
            return is_numeric($s['hourly'] ?? null) ? $m(round($s['hourly']), 0) . ' mm in an hour.' : '';
        case 'siren':
            return 'Siren sounding.';
    }
    return '';
}

/* The notification for the stations in `$ids`. One station reads as itself and opens its card. Several
   fold into a count by level, name the worst one, and open the alert list. `tag` is constant, so a new
   notification replaces the one before and a phone never holds more than one from this app. */
function pushBody(array $ids, array $matched, array $stations): array {
    $by = [];
    foreach ($stations as $s) if (isset($s['id'])) $by[$s['id']] = $s;

    $worstId = $ids[0];
    foreach ($ids as $id) if (($matched[$id] ?? '') === 'danger') { $worstId = $id; break; }
    $worst = $by[$worstId] ?? ['id' => $worstId];
    $name  = trim((string)($worst['name'] ?? $worstId));
    $line  = pushLine($worst);
    $cam   = pushCam($worst, $stations);

    if (count($ids) === 1) {
        $title = $name . ' at ' . ($matched[$worstId] ?? 'warning');
        $body  = $line;
        $url   = '#station=' . $worstId;
    } else {
        $n = ['danger' => 0, 'warning' => 0];
        foreach ($ids as $id) $n[$matched[$id] ?? 'warning']++;
        $title = implode(', ', array_filter([$n['danger'] ? $n['danger'] . ' at danger' : '',
                                             $n['warning'] ? $n['warning'] . ' at warning' : '']));
        $body  = $line === '' ? $name . '.' : $name . '. ' . $line;
        $url   = '#alerts';
    }
    return ['title' => $title, 'body' => $body, 'image' => $cam === null ? null : 'api.php?cam=' . $cam,
            'url' => $url, 'tag' => 'kvfw'];
}

function pushAllClear(): array {
    return ['title' => 'All clear', 'body' => 'No station you follow is at warning or danger.',
            'image' => null, 'url' => '#alerts', 'tag' => 'kvfw'];
}

function pushWebPush(array $keys): \Minishlink\WebPush\WebPush {
    return new \Minishlink\WebPush\WebPush(['VAPID' => $keys], ['TTL' => 3600, 'urgency' => 'high'], PUSH_TIMEOUT);
}

/* The sender. Runs at the end of a refresh, inside the refresh lock, for every stored phone.
   A phone's `seen` and `sent` move only once its message is accepted. A failed send leaves them as
   they were, so the next tick tries again and a flood warning is never recorded as heard when it was
   not. A 404 or 410 from the push service means the phone unsubscribed, and its row goes. So does a
   row with no readable subscription. One phone failing never stops the next. */
function pushSend(PDO $db, array $stations, int $now, float $budget = PUSH_BUDGET): void {
    $t0 = microtime(true);
    $keys = pushKeys();
    if (!$keys || !$stations) return;
    $rows = $db->query('SELECT endpoint, body, seen, sent FROM push')->fetchAll(PDO::FETCH_ASSOC);
    if (!$rows) return;

    $levels = pushLevels($stations, $now);
    $known  = pushKnown($stations, $now);
    $wp = pushWebPush($keys);
    $set = $db->prepare('UPDATE push SET seen = ?, sent = ? WHERE endpoint = ?');
    $del = $db->prepare('DELETE FROM push WHERE endpoint = ?');
    /* One phone at a time, each in its own try. The library encrypts inside the send, so a queue
       would throw out of flush() on the first subscription it cannot encrypt for, outside any
       per-phone guard, and cut off the rest of the refresh. Found in the first integration run.
       ponytail: sequential, which is right for a handful of phones. Past about twenty, queue the
       sends and give each one its own failure path. */
    foreach ($rows as $i => $r) {
        /* A wall-clock budget. This runs inside a request with PHP's 30 second limit, ahead of the
           camera capture and the two drips. A few phones whose push service hangs would otherwise spend
           the whole limit here, every tick, and starve both. A row this loop never reaches keeps its
           `seen` and `sent` as they were, which is the safe state, and the next tick tries it. */
        if (microtime(true) - $t0 >= $budget) {
            error_log('push: out of time, ' . (count($rows) - $i) . ' phone(s) wait for the next tick');
            break;
        }
        $ep = $r['endpoint'];
        try {
            $doc = json_decode($r['body'], true);
            $sub = $doc['sub'] ?? null;
            if (!is_array($sub)) { $del->execute([$ep]); continue; }
            $matched = pushMatch($levels, $doc['on'] ?? [], $doc['favs'] ?? [], $doc['ignored'] ?? []);
            $diff = pushDiff($matched, $levels, json_decode($r['seen'], true) ?: [],
                             json_decode($r['sent'], true) ?: [], $now, $known);
            $payload = $diff['notify'] ? pushBody($diff['notify'], $matched, $stations)
                     : ($diff['allClear'] ? pushAllClear() : null);
            if ($payload) {
                $report = $wp->sendOneNotification(\Minishlink\WebPush\Subscription::create($sub), json_encode($payload));
                if ($report->isSubscriptionExpired()) { $del->execute([$ep]); continue; }
                if (!$report->isSuccess()) {
                    error_log('push: ' . $ep . ' ' . $report->getReason());
                    continue;   // seen and sent stay as they were, so the next tick tries again
                }
            }
            $set->execute([json_encode($diff['seen']), json_encode($diff['sent']), $ep]);
        } catch (\Throwable $e) {
            /* Logged and kept. An exception here can be this machine's fault, such as a PHP with no
               OpenSSL configuration, and deleting on it would unsubscribe every phone for a fault that is
               not theirs. The phone re-posts its document each time the app opens, and a junk row
               costs one log line per tick until somebody deletes it by hand. */
            error_log('push: ' . $ep . ' ' . $e->getMessage());
        }
    }
}

/* One notification to one phone, on request, so a reader can test the whole path. Test mode cannot do
   it: that fakes a flood in the browser's copy of the payload and the server never sees it.
   Rate limited through forceAllowed(), site-wide. The check and the touch are not under a lock. Two
   presses in the same instant can both pass, and the cost is one extra test message. */
function pushTestSend(array $doc): array {
    $keys = pushKeys();
    if (!$keys || $doc['sub'] === null) return [false, 'no keys'];
    $stamp = STATE . '/.pushtest.stamp';
    [$allowed] = forceAllowed(time(), is_file($stamp) ? filemtime($stamp) : null, PUSH_TEST_EVERY);
    if (!$allowed) return [false, 'rate limited'];
    touch($stamp);
    $fake = [['id' => 'wl-0', 'kind' => 'river', 'name' => 'Test station', 'lat' => 0, 'lng' => 0,
              'level' => 5.32, 'danger' => 4.8]];
    $p = pushBody(['wl-0'], ['wl-0' => 'danger'], $fake);
    $p['url'] = '#alerts';   // the fake station is not on the map, so a card link would open nothing
    try {
        $r = pushWebPush($keys)->sendOneNotification(\Minishlink\WebPush\Subscription::create($doc['sub']), json_encode($p));
        return [$r->isSuccess(), (string)$r->getReason()];
    } catch (\Throwable $e) {
        error_log('push test: ' . $e->getMessage());
        return [false, 'error'];
    }
}
