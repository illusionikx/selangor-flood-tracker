<?php
/* `php push-keys.php [--subject=https://your.host]` — makes the VAPID key pair once.
 *
 * VAPID is how a push service learns that the messages come from this server. The pair goes in
 * .vapid.json, which is gitignored and excluded from the deploy rsync. A second run refuses to
 * overwrite it: a new pair would orphan every phone already subscribed, because each subscription
 * is bound to the public key it was made with. Run by hand, never in a request.
 */

if (PHP_SAPI !== 'cli') exit;

require __DIR__ . '/lib/autoload.php';
// The state directory, by the rule at `STATE` in api.php, so the key lands where api.php reads it.
$state = is_file(dirname(__DIR__) . '/build.mjs') ? dirname(__DIR__) : __DIR__;
$file = $state . '/.vapid.json';
if (is_file($file)) {
    fwrite(STDERR, "Refusing to overwrite $file. A new pair would orphan every subscribed phone.\n");
    exit(1);
}

$subject = 'https://floodwatch.taila2a82f5.ts.net';
foreach ($argv as $a) if (str_starts_with($a, '--subject=')) $subject = substr($a, 10);

$k = Minishlink\WebPush\VAPID::createVapidKeys();
file_put_contents($file, json_encode(
    ['publicKey' => $k['publicKey'], 'privateKey' => $k['privateKey'], 'subject' => $subject],
    JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
echo "Wrote $file\n";
