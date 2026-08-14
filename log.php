<?php
/* Where a browser error lands. js/oops.js is the only caller.
 *
 * This is a public endpoint that writes to disk, so it takes the four guards such an endpoint needs
 * and nothing else. It accepts POST alone. It reads a bounded number of bytes rather than whatever
 * arrives. It refuses a body that is not JSON. It stops writing at a fixed file size.
 *
 * It records no IP address. The report already carries the page, the browser and the stack, which is
 * everything needed to find the fault. Who saw it is not part of that.
 *
 * Read the file with `Get-Content .client-errors.log -Tail 20` on Windows, or `tail` elsewhere.
 * One line is one report.
 */

ini_set('error_log', __DIR__ . '/.php-error.log');   // the same file api.php writes to

/* Every time this app prints is Malaysian, and a log that disagrees is a log a reader has to convert
   before comparing it to a reading. api.php pins the same zone. This file does not require api.php,
   so it pins its own. */
date_default_timezone_set('Asia/Kuala_Lumpur');

const MAX_BODY = 4096;         // a stack trace is about 500 bytes. This is generous.
const MAX_FILE = 5_000_000;    // ponytail: stop at 5 MB. Add rotation if the file ever fills.

http_response_code(204);       // answer first. The browser wants no content and waits for nothing.
header('Content-Type: text/plain');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') exit;

$body = file_get_contents('php://input', false, null, 0, MAX_BODY);
if ($body === false || $body === '') exit;

/* Refuse anything that is not a JSON object. This is the check that keeps the file readable: one
   line per report, and every line parses. A hostile caller can still write 5 MB of valid JSON, and
   the size ceiling above is the answer to that. */
$rec = json_decode($body, true);
if (!is_array($rec)) exit;

$file = __DIR__ . '/.client-errors.log';
if (is_file($file) && filesize($file) >= MAX_FILE) exit;

/* One report is one line, so a newline inside the JSON would split it in two. json_encode writes no
   raw newline, and re-encoding what was decoded also drops any field this app did not send. */
$line = date('c') . ' ' . json_encode($rec, JSON_UNESCAPED_SLASHES) . "\n";
file_put_contents($file, $line, FILE_APPEND | LOCK_EX);
