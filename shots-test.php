<?php
/* The one runnable check in this repo: `php shots-test.php`.
 *
 * Retention is the only rule here that can quietly destroy data. Everything else in the archive
 * either works or visibly does not — a frame fails to store, an endpoint 404s — but a prune that
 * puts a frame in the wrong bucket deletes months of camera history and looks exactly like a prune
 * that worked. It also has to be *idempotent*: it runs on every capture, so a rule that shaves one
 * extra frame per pass empties the archive over a week without ever being wrong in a single run.
 *
 * Uses a camera id no real camera has, and cleans up after itself. Nothing here touches the network.
 */

const HOST = 'unused-by-this-test';
require_once __DIR__ . '/shots.php';

const TEST_ID = 999999;
$fail = 0;
$ok = function (string $what, bool $pass) use (&$fail) {
    if (!$pass) $fail++;
    echo ($pass ? '  ok   ' : '  FAIL ') . $what . "\n";
};

// Frames alternate .webp / .jpg, because that is what the archive really holds — a frame is stored
// in whichever encoding came out smaller, and a prune that only knew one extension would leave every
// frame of the other one on disk for ever while reporting that it had thinned them.
$reset = function (int $now, int $span, int $every) {
    array_map('unlink', glob(shotDir(TEST_ID) . '/*.*') ?: []);
    @mkdir(shotDir(TEST_ID), 0777, true);
    $i = 0;
    for ($t = $now - $span; $t <= $now; $t += $every) {
        touch(shotDir(TEST_ID) . "/$t." . (++$i % 2 ? 'webp' : 'jpg'));
    }
};

// A fixed "now", so the test says the same thing whenever it is run.
$now = 1800000000;

echo "a year of 30-minute frames, pruned:\n";
$reset($now, 366 * 86400, 1800);
$before = count(shotList(TEST_ID));
pruneShots(TEST_ID, $now);
$kept = shotList(TEST_ID);

// Per tier: how many frames survived, and what the tier's own rule says there should be.
$band = fn(int $age) => $age <= 6 * 3600 ? '6h'
    : ($age <= 86400 ? '24h' : ($age <= 7 * 86400 ? 'week'
    : ($age <= 30 * 86400 ? 'month' : 'year')));
$n = [];
foreach ($kept as $t) $n[$band($now - $t)] = ($n[$band($now - $t)] ?? 0) + 1;

printf("  %d frames -> %d (%s)\n", $before, count($kept),
    implode(', ', array_map(fn($k, $v) => "$k:$v", array_keys($n), $n)));

/* Spacing, not a count. A count is a magic number that has to be recomputed by hand every time a
   tier moves, and it is off by one wherever a frame lands exactly on a tier boundary — which says
   nothing about whether the rule works. The interval between surviving neighbours *is* the rule. */
$gap = function (string $tier, int $step) use ($kept, $now, $band, $ok) {
    $in = array_values(array_filter($kept, fn($t) => $band($now - $t) === $tier));
    $gaps = [];
    for ($i = 1; $i < count($in); $i++) $gaps[] = $in[$i] - $in[$i - 1];
    /* Every gap is the tier's step except one — the handover, where the frame nearest the boundary
       is whatever the *finer* tier left standing, so it lands short. One short gap per tier is
       correct; two means a bucket was miscounted, and any gap longer than the step means a frame
       that should have survived was deleted. */
    $short = count(array_filter($gaps, fn($g) => $g < $step));
    $ok(sprintf('%-5s keeps one per %-3s (%d frames)', $tier, $step >= 86400
        ? $step / 86400 . 'd' : $step / 3600 . 'h', count($in)),
        $gaps && max($gaps) === $step && $short <= 1);
};
// The capture rate is 30 min, so the first two tiers keep everything they are given.
$gap('6h',    1800);
$gap('24h',   1800);
$gap('week',  6 * 3600);
$gap('month', 12 * 3600);
$gap('year',  7 * 86400);
$ok('nothing older than a year survives',  $now - min($kept) <= 365 * 86400);
$ok('no frame kept twice',                 count($kept) === count(array_unique($kept)));

// Idempotence: pruning again must change nothing. This is the one that catches an off-by-one in the
// bucket arithmetic, because that error only shows up on the second pass.
pruneShots(TEST_ID, $now);
$ok('a second prune is a no-op', shotList(TEST_ID) === $kept);

echo "edge cases:\n";
$reset($now, 0, 1800);                       // exactly one frame
pruneShots(TEST_ID, $now);
$ok('a single frame survives', count(shotList(TEST_ID)) === 1);

$reset($now, 400 * 86400, 400 * 86400);      // one frame, older than the last tier
pruneShots(TEST_ID, $now);
$ok('everything past the last tier is deleted', shotList(TEST_ID) === [$now]);

// Both extensions really are reachable and really are removable — the whole point of shotFile().
$reset($now, 3600, 1800);
$ok('a .jpg frame is found by shotFile', str_ends_with(shotFile(TEST_ID, $now - 1800) ?? '', '.jpg'));
// A week of alternating frames — long enough to cross three tiers and delete plenty of both
// extensions, short enough that the test stays a couple of seconds rather than 19,000 file writes.
$reset($now, 7 * 86400, 1800);
pruneShots(TEST_ID, $now);
$ok('no orphaned .jpg survives a prune',
    count(glob(shotDir(TEST_ID) . '/*.*')) === count(shotList(TEST_ID)));

array_map('unlink', glob(shotDir(TEST_ID) . '/*.*') ?: []);
@rmdir(shotDir(TEST_ID));

echo $fail ? "\n$fail FAILED\n" : "\nall passed\n";
exit($fail ? 1 : 0);
