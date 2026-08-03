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
$gap('week',  3 * 3600);
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

/* --- the anchors ---------------------------------------------------------------------------------
 * A tier's third number is the clock time its slots aim at. The constants are hand-computed — the
 * target time in UTC, modulo the step — which is exactly the kind of number that is wrong without a
 * symptom. The prune would keep one frame per 12 hours as asked, at the wrong hour, for ever.
 *
 * Asserted against `time()`, never against the epoch. Malaysia ran UTC+7:30 until 1982, so PHP
 * renders a 1970 instant 30 minutes early and a correct anchor would look broken.
 */
echo "\nanchors:\n";
date_default_timezone_set('Asia/Kuala_Lumpur');

$AIM = [
    2 => ['week',  '01:00, then every 3 hours', fn(int $t) => date('i', $t) === '00' && (int)date('G', $t) % 3 === 1],
    3 => ['month', '04:00 and 16:00',           fn(int $t) => date('i', $t) === '00' && in_array((int)date('G', $t), [4, 16], true)],
    4 => ['year',  'Monday 16:00',              fn(int $t) => date('D H:i', $t) === 'Mon 16:00'],
];
foreach ($AIM as $i => [$name, $desc, $want]) {
    [, $step, $anchor] = SHOT_TIERS[$i];
    $slot = intdiv(time() - $anchor + intdiv($step, 2), $step);
    $t    = $anchor + $slot * $step;
    $ok(sprintf('%-5s aims at %-26s (this slot: %s)', $name, $desc, date('D j M Y H:i', $t)), $want($t));
}
$ok('the 6h and 24h tiers take no anchor', SHOT_TIERS[0][2] === 0 && SHOT_TIERS[1][2] === 0);

/* Two frames in one slot. The nearer one to the target survives, whichever order they arrived in.
   "Newest in the bucket" passes the first of these two and fails the second. */
echo "\nnearest the target wins:\n";
$pair = function (int $a, int $b) {
    array_map('unlink', glob(shotDir(TEST_ID) . '/*.*') ?: []);
    @mkdir(shotDir(TEST_ID), 0777, true);
    touch(shotDir(TEST_ID) . "/$a.webp");
    touch(shotDir(TEST_ID) . "/$b.jpg");
};
[, $mStep, $mAnchor] = SHOT_TIERS[3];                 // the month tier, one frame per 12 h
$slot   = intdiv($now - 10 * 86400 - $mAnchor + intdiv($mStep, 2), $mStep);
$target = $mAnchor + $slot * $mStep;                  // about 10 days back, inside the month tier

$pair($target - 2 * 3600, $target + 5 * 3600);
pruneShots(TEST_ID, $now);
$ok('the earlier frame wins when it is nearer', shotList(TEST_ID) === [$target - 2 * 3600]);

$pair($target - 5 * 3600, $target + 3600);
pruneShots(TEST_ID, $now);
$ok('the later frame wins when it is nearer',   shotList(TEST_ID) === [$target + 3600]);

$pair($target - 2 * 3600, $target + 5 * 3600);
pruneShots(TEST_ID, $now);
$kept2 = shotList(TEST_ID);
pruneShots(TEST_ID, $now);
$ok('a second prune leaves the winner alone',   shotList(TEST_ID) === $kept2);

array_map('unlink', glob(shotDir(TEST_ID) . '/*.*') ?: []);
@rmdir(shotDir(TEST_ID));

/* --- frameTiers -------------------------------------------------------------------------------
 * The tier a frame was taken under. A wrong answer here paints a calm afternoon red, or leaves a
 * flood gray, and either one is a lie told by a color on a photograph.
 * The fake $assess below returns an ETA straight from a table, so this tests the join — which
 * sample a frame lands on, and the on-delay — and not the forecast maths. api.php's own assess()
 * is tested by the map every time it runs.
 */
echo "\nframeTiers:\n";

$mark    = 3.0;
$samples = [[1000, 1.0], [2000, 1.5], [3000, 2.0], [4000, 3.2], [5000, 3.4]];
//            i=0         i=1          i=2          i=3          i=4
// Fake forecast: index 0 is outside the cutoff; indices 1, 2, 3, 4 are inside.
$eta  = [0 => null, 1 => 1.0, 2 => 1.0, 3 => 0.5, 4 => 0.2];  // Index 1 corrected from null to test on-delay properly
$fake = fn(array $pts, int $i, ?float $m) => [null, $eta[$i] ?? null];

$t = frameTiers([500, 1500, 2500, 3500, 4500], $samples, $mark, 3.0, $fake);

$ok('a frame older than every sample is unscored', !isset($t[500]));
$ok('a frame on a calm sample is unscored',        !isset($t[1500]));
// 2500 lands on index 1 (eta 1.0), but its predecessor index 0 has eta null. On-delay requires both.
$ok('one sample inside the cutoff is not soon',    !isset($t[2500]));
// 3500 lands on index 2: eta 1.0 and the sample before it 1.0. Two in a row is the on-delay.
$ok('two samples inside the cutoff is soon',       ($t[3500] ?? null) === 'soon');
// 4500 lands on index 3, level 3.2, at or over the mark. Observed beats forecast.
$ok('a level at the mark is now',                  ($t[4500] ?? null) === 'now');

// 6000 is after the last sample, so the walk pins at index 4, level 3.4. Observed beats forecast.
$t2 = frameTiers([6000], $samples, $mark, 3.0, $fake);
$ok('a frame after all samples scores from the end', ($t2[6000] ?? null) === 'now');

$ok('no danger mark scores nothing', frameTiers([4500], $samples, null, 3.0, $fake) === []);
$ok('no samples score nothing',      frameTiers([4500], [], $mark, 3.0, $fake) === []);

echo $fail ? "\n$fail FAILED\n" : "\nall passed\n";
exit($fail ? 1 : 0);
