<?php
/* Reads a payload on standard input and complains when it is wrong.
 *
 * The cron that keeps this site alive already fetches `api.php` every five minutes, and it threw the
 * answer away. That answer carries the alarm. This file is the pipe it now goes through, so the
 * check costs no extra request, no service and no third party. See docs/DEPLOY.md for the cron line.
 *
 * A dead site is caught the same way. `curl` writes nothing, the decode fails, and that is a fault.
 *
 * It reports a CHANGE of state and never a state. A fault that repeats every five minutes for a week
 * is 2,016 identical lines, and an alarm nobody can act on is the cry-wolf failure the alert design
 * standard in docs/FEATURES.md rejects. The recovery is reported too, or a cleared fault looks open
 * for ever.
 */

ini_set('error_log', __DIR__ . '/.php-error.log');
date_default_timezone_set('Asia/Kuala_Lumpur');

/* 679 stations on a healthy poll. This catches a collapse, not a wobble. A merge that loses one feed
   still clears 300, so `parsed` below is what actually names that case. */
const FLOOR = 300;

$p = json_decode(stream_get_contents(STDIN), true);
$bad = [];

if (!is_array($p) || !isset($p['stations'])) {
    $bad[] = 'no payload';   // the site is down, or it answered something that is not the payload
} else {
    /* `metwarn` is deliberately absent from this list. Zero warnings is the ordinary state of a
       calm day, not a broken scrape. It read 0 on the poll behind this file.

       `jpsmet` and `floodalert` are absent for the same reason, and `floodalert` more strongly.
       getdisse.php answered `[]` on every fetch during its design. `sources.old` below is what
       names a notice feed that has stopped moving.

       `gaz.pending` and `hist.pending` are absent too, on purpose. Both reach 0 when their drip
       finishes, which is the healthy end state. An alarm that fires on success is the cry-wolf
       failure the alert design standard in docs/FEATURES.md rejects. */
    foreach (['kl', 'national', 'met', 'metday', 'portalrf'] as $k)
        if ((int)($p['sources'][$k]['parsed'] ?? 0) === 0) $bad[] = "$k parsed 0 rows";

    /* `portalrf.parsed` above catches a moved table or a broken hidden-input pair. This catches the
       other half: the table still parses, but every row failed to join a station we already hold. */
    if ((int)($p['sources']['portalrf']['applied'] ?? 0) === 0) $bad[] = 'portalrf applied 0 rows';

    /* A stored copy parses as well as a fresh one, so the parse counters cannot see this. */
    if (!empty($p['sources']['stale'])) $bad[] = 'stale pages: ' . implode(' ', $p['sources']['stale']);

    /* A stale answer is not a missing one, so `stale` above cannot see this. Every row of
       api.data.gov.my/weather/warning was seven days old on 2026-08-17 and every counter stayed
       quiet, because the fetch had succeeded. */
    if (!empty($p['sources']['old'])) $bad[] = 'old sources: ' . implode(' ', $p['sources']['old']);

    if (($p['upstreamOk'] ?? true) === false) $bad[] = 'serving stale cache';
    if (count($p['stations']) < FLOOR)        $bad[] = count($p['stations']) . ' stations';
}

$now  = $bad ? implode(', ', $bad) : 'ok';
$file = __DIR__ . '/.watch.state';
$was  = is_file($file) ? trim(file_get_contents($file)) : 'ok';

if ($now !== $was) {
    error_log($bad ? 'watch: ' . $now : 'watch: recovered');
    file_put_contents($file, $now);
}

/* Exit 1 on a fault. Nothing reads this today. A cron with MAILTO set mails on a non-zero exit, so
   this is one free channel for anybody who wants it. */
exit($bad ? 1 : 0);
