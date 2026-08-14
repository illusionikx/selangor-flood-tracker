<?php
// Proxy + cache for infobanjirjps.selangor.gov.my (no CORS headers upstream, so we fetch server-side).
// ponytail: sqlite for level history, flat file for the payload cache (one blob, nothing to query).

/* Where a session auto-starts, the file session handler takes an exclusive lock on the session file
   for the whole request. Every request that carries the PHPSESSID of one browser therefore runs one
   at a time. Six concurrent stills measured 1.9, 3.0, 4.3, 5.4, 6.1 and 6.9
   seconds, which is a clean staircase. The same six with no shared cookie finished in 3.4 seconds
   together. Four cheap requests finish in 347 ms, so the worker pool is not the reason.
   Ninety camera tiles queue that way, and the five minute poll queues behind them.
   Nothing in this repository reads `$_SESSION`, so the lock protects nothing and costs the whole
   camera wall. Release it before any work starts.
   `.user.ini` now sets `session.auto_start=0` for this directory, so on most requests there is no
   session to close and this line does nothing. Keep the line. A server that ignores `.user.ini`
   still needs it, and this file has to be correct on a machine it does not own. */
if (session_status() === PHP_SESSION_ACTIVE) session_write_close();

/* Send this app's errors to a file of its own. Without this, `error_log()` below writes to stderr,
   which a FastCGI server folds into its own error log next to every unrelated line it writes. The
   log on the machine this was added on held about 28,000 lines, and an uncaught exception from here
   was one of them.
   This is `ini_set()` rather than an ini file because `__DIR__` finds the right path on both deploy
   targets. A committed absolute path is correct on one of them at most. */
ini_set('error_log', __DIR__ . '/.php-error.log');

/* A fatal after the first header() sends an HTML error page under a JSON content type, so a client
   that asked for JSON gets a parse error rather than something it can act on. The ?place= handler
   already carries this guard for its own route. This covers every route, including the payload,
   which is every poll this page makes.
   Both handlers refuse to write once the body has started. A payload already on the wire must not
   gain a JSON object glued to its end, and captureShots() runs after that point on every sixth
   poll. A truncated payload the client can report is better than a corrupted one it cannot.
   These register above the two require_once lines on purpose. Composer's autoloader raises
   E_USER_ERROR when a platform check fails, and that happens inside a require. Registering after
   the requires leaves the one failure most likely to greet a fresh checkout uncovered. */
$fatalJson = function (): void {
    if (headers_sent()) return;
    /* Discard whatever is buffered first. This host serves with `display_errors=1` and
       `html_errors=1`, so PHP writes an HTML "Fatal error" fragment into the buffer the moment a
       non-exception fatal fires, which is before this runs. Left in place, the body is that
       fragment with a JSON object glued to its end, and a client can parse neither.
       Nothing buffered at this point is worth keeping. Either it is that fragment, or it is a
       payload this request will never finish writing. `headers_sent()` above is what protects a
       response that already went out: a payload is about 340 KB against a 4096 byte buffer, so it
       has long since flushed and this returns before reaching here.
       A catchable Error takes a different path. `set_exception_handler` intercepts it before PHP's
       display path runs, so that case was already clean and stays clean. */
    while (ob_get_level() > 0) ob_end_clean();
    header('Content-Type: application/json');
    http_response_code(500);
    echo json_encode(['error' => 'server error']);
};
set_exception_handler(function (Throwable $e) use ($fatalJson) {
    // PHP stops logging on its own once a handler is set, so an uncaught exception would otherwise
    // be a silent 500 with no record of what threw.
    error_log('api.php uncaught: ' . $e);
    $fatalJson();
});
register_shutdown_function(function () use ($fatalJson) {
    $e = error_get_last();
    if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) $fatalJson();
});

require_once __DIR__ . '/sources.php';   // the two scraped upstreams (national portal + KL)
require_once __DIR__ . '/shots.php';     // the camera archive: capture, retention, lookup

const API   = 'https://infobanjirjps.selangor.gov.my/JPSAPI/api/';
const TTL   = 300;   // upstream updates hourly; 5 min is plenty
const SCRAPE_TTL = 900;  // scraped HTML pages: slow to render, and updated no faster than this
// The sparkline draws on a clock axis, so history windows by time, not by count. One point per
// bucket: 12h of 5-minute polls is 144 points on each of 106 rivers, for a graph 300px wide.
const SPARK_WIN    = 12 * 3600;
const SPARK_BUCKET = 900;    // 15 min — 48 points across the window at most
// Rainfall buckets by the clock hour. `hourlyRainfall` is a rolling one-hour total, so samples 15
// minutes apart overlap. Drawn as separate periods they show the same rain four times over.
const RAIN_BUCKET  = 3600;
// Trend is a rate of rise in m/hour. JPS publishes none, so we derive it: the MEDIAN OF EVERY
// PAIRWISE SLOPE in the window (Theil-Sen), not a chord. A chord breaks on one bad reading — the
// two-point version reported 9.61 m/h on Sg. Kerayong, and the archive holds 846 steps of 0.5 m,
// 63 of which reverted on the next sample. A median takes 29% bad points for ~200 divisions.
const TREND_MIN = 600;    // 10 min — the closest two samples may be and still form a usable pair
const TREND_MAX = 10800;  // 3 h  — older than this says nothing about now
// "Rising" is a forecast, not a rate: at this climb, the station reaches its OWN danger mark within
// RISE_ETA hours. A fixed m/h cannot do that. 0.2 m/h is a quiet afternoon on a river 4 m below
// danger and an emergency on a drain 30 cm below it. The floor exists because levels come to the
// centimetre: over the shortest pair we accept, one 1 cm tick is 0.06 m/h, so under 0.1 is rounding.
// Measured in calm weather, 0.05 m/h sat on the p90 of normal movement and flagged 1 hour in 10.
const RISE_FLOOR = 0.10;  // m/hour — below this the rate is sensor rounding, not a climb
const RISE_ETA   = 3;     // hours to its own danger mark
// A tide is a rise. It climbs 0.5-0.7 m/h twice a day at the gates and jetties (PINTU AIR IJOK,
// BANDAR KLANG, TELUK PENYAMUN) and never reaches danger, so extrapolating one is a daily false
// alarm. So the level must beat its own 24-hour high: a tide stays inside yesterday's envelope and
// a flood breaks it. It must also hold two polls — ISA-18.2's on-delay. One poll gave 48 flips.
const RISE_DAY = 86400;
// Sirens report a daily heartbeat (most stamp 08:00). Two missed days is out of contact, not idle.
const SIREN_STALE = 48 * 3600;
/* How often every siren refreshes `statusLastUpdate`. The list carries the status, so a quiet
   siren needs its detail only to keep that timestamp current. Two things read it: the SIREN_STALE
   check above, and the stamp on every siren sample in `.history.db`.
   One hour, not six. The siren history pass stamps each sample from this field, and the
   `(station, ts)` primary key drops a repeated stamp. A six hour value therefore folds six hours of
   samples into one row. It also spends 12.5% of the 48 hour budget before the check above runs. */
const SIREN_TTL   = 3600;
const SIREN_STAMP = __DIR__ . '/.siren.stamp';
/* Range from a siren to the river that siren watches. JPS sounds a siren at the Amaran mark, so the
   alarm is a claim about a level we already hold. A 1 with no high river behind it is a stuck relay.
   Measured: 194 of 212 sirens have a river inside 5 km, 133 inside 2 km, 9 have none inside 10 km.
   5 km is where the curve flattens. Generous on purpose. Too wide only keeps a doubtful alarm
   standing. Too narrow silences a real one. */
const SIREN_KM = 5.0;
const SITE_M = 50;   // metres — stations this close are sensors on one mast, not separate places
/* JPS shuffled the coordinates inside one batch of cameras. The feed puts Kayu Ara's position under
   1285 and Tanjung Karang's under 1287, so 1279 drew in Sepang and 1288 in Bangi, 34 km and 83 km
   from their own names. List and detail carry the same wrong value, so there is nothing upstream to
   prefer. Five ways in, weakest first. Never a bare guess.

   1. Geocode AND district median, both required — two checks that fail in different ways. A name
      alone is not enough: "Bukit Serdang" (1285) geocodes to Seri Kembangan, 30 km outside its own
      district, because a second place carries that name.
   2. A same-named station of another kind beats both, because it is upstream stating where the
      place is. 1277 took the TAMAN DESA KEMUNING mast. Its geocode was 200 m off, outside SITE_M,
      so the camera drew as a place of its own beside a mast it belongs on. 1280 ranks the two
      routes: the geocode for "Sungai Lui" lands 2.3 km from the KG. SG. LUI mast, next to another
      station on the same river. A gazetteer answers about a river. The mast states the place.
      1283 moved off a geocode the same way, onto the JENDERAM HILIR mast 1.9 km from it.
   3. A near name never gets in on its own. 1282 reads "Kg Simpang Balak" and the siren reads
      "KG. SG. BALAK" — Sungai, not Simpang. The district carries it: the published point was not in
      Hulu Langat and the siren is. Marked SOMEWHAT CONFIRMED, and the next reader can overrule it.
   4. The swap read from the other end. Correcting 1279 orphans its published point, and the five
      stations nearest that point are all in Kuala Langat — the district of 1285, the only Kuala
      Langat camera in the batch. Both halves must hold: the neighbours agree on a district, and one
      uncorrected camera is filed under it.
   5. Strongest: that swap solved for the whole batch at once. The shuffle is one closed
      permutation, not a scatter. Name the station nearest each suspect point, and thirteen of the
      fourteen name another camera in the batch inside 550 m. The cycle runs
      1276→1280→1287→1288→1284→1278→1282→1277→1281→1286→1289→1283→1276, with 1279 and 1285 swapped
      as a pair. One camera and one point are left over and can only be each other, so 1281 takes
      the point published for 1277 with no gazetteer hit and no same-named mast. Rebuild the whole
      map before you argue about one pin.

   The cycle also names the cameras NOT in the shuffle. 1271, 1272, 1273, 1274, 1275, 1315 and 1316
   sit near a station of their own name, and the cycle closes without them. They are correct. 1272
   and 1315 were called wrong here for months on a failed gazetteer lookup alone. 1289 says it from
   the other side: no gazetteer holds Rimba KDR, and JPS publishes a RIMBA KDR mast in the district
   it files the camera under. Search the payload first.
   CAM_FIX_KM retires the table by itself. An override applies only while the feed still disagrees,
   so the day JPS corrects a station we follow the feed again. */
const CAM_FIX_KM = 2.0;
/* Eleven more cameras carry a second and unrelated fault: 239, 240, 241, 242, 244, 245, 246, 247,
   1249, 1250 and 1261 are published at lat 0, lng 0 rather than at a wrong point. Nothing to swap
   and no cycle to solve — the shuffle misfiles real points, and this batch has no point at all.
   Seven (239, 240, 242, 245, 1249, 1250, 1261) took route 2 above: a station of another kind,
   already in the payload, carrying the same name.
   Two, 241 and 247, had only a near name — Taman Daya Meru reads close to PEKAN MERU, and Taman
   Teluk Gedung Indah close to SG. KEMBONG DI PULAU INDAH. Route 3 applies, so the district carries
   each of them and both are marked SOMEWHAT CONFIRMED.
   The last two had neither. Taman Selat Damai (244) and Bukit Hijau (246) carry the median of their
   district's non-camera stations, because no station of either name exists in the payload. A median
   is a coordinate this file invented, and an invented coordinate is worse than one we can show
   belongs to upstream. Check these two by hand. Delete them rather than keep them if nobody can
   confirm where the camera stands.
   CAM_FIX_KM retires all eleven the same way. A camera at 0, 0 disagrees with any point in this
   state by thousands of kilometres, so the override holds until JPS publishes a real one. */
const CAM_FIX = [
    239  => [3.17862, 101.42951],     // Jalan Sebaya              — the SIREN JALAN SEBAYA site, Klang, LOCATION CONFIRMED
    240  => [3.18646, 101.41317],     // Jalan Bukit Payung        — the SIREN JALAN BUKIT PAYUNG site, Klang, LOCATION CONFIRMED
    241  => [3.13646, 101.43895],     // Taman Daya Meru           — the PEKAN MERU rainfall and river mast, Klang, SOMEWHAT CONFIRMED
    242  => [3.02880, 101.47849],     // Taman Maznah              — the TAMAN MAZNAH flood gauge, Klang, LOCATION CONFIRMED
    244  => [2.995089, 101.410330],     // Taman Selat Damai       — physically found in Klang, LOCATION CONFIRMED
    245  => [3.15525, 101.47284],     // Kg Budiman                — the KG BUDIMAN rainfall and river mast, Petaling, LOCATION CONFIRMED
    246  => [3.243218, 101.391635],     // Bukit Hijau               — physically found at Jeram, LOCATION CONFIRMED
    247  => [2.91654, 101.32121],     // Taman Teluk Gedung Indah  — the SG. KEMBONG DI PULAU INDAH mast, Klang, SOMEWHAT CONFIRMED
    1249 => [3.02427, 101.53335],     // Jalan Jitu                — the SIREN JLN JITU TSM site, Klang, LOCATION CONFIRMED
    1250 => [3.03525, 101.52778],     // Kolam Takungan TSM        — the SIREN KOLAM TSM site, Klang, LOCATION CONFIRMED
    1261 => [3.02963, 101.52589],     // Kunci Air TSM             — the SIREN KUNCI AIR TSM site, Klang, LOCATION CONFIRMED
    1276 => [3.093060, 101.406711],     // Sg. Puluh Aman Perdana   — the point 1283 was published at, LOCATION CONFIRMED
    1277 => [3.02151, 101.52422],       // Taman Desa Kemuning      — the mast of that name, LOCATION CONFIRMED
    1278 => [3.194995, 101.533625],       // Paya Jaras               — published 33 km away, in Serdang, LOCATION CONFIRMED
    1279 => [3.120836, 101.6017783],    // Kolam Sg Kayu Ara        — published 34 km away, in Sepang, LOCATION CONFIRMED
    1280 => [3.17379, 101.86914],       // Sg Lui                   — the KG. SG. LUI mast, LOCATION CONFIRMED
    1281 => [3.09389, 101.79128],       // Sg Betong                — the point 1277 was published at, LOCATION CONFIRMED
    1282 => [3.00959, 101.77177],       // Kg Simpang Balak         — the SIREN KG. SG. BALAK site, SOMEWHAT CONFIRMED
    1283 => [2.89697, 101.72834],       // Jenderam Hilir           — the mast of that name, LOCATION CONFIRMED
    1284 => [2.94060, 101.74336],       // Kolam Takungan Sg Merab  — the K/TAKUNGAN SG. MERAB mast, LOCATION CONFIRMED
    1285 => [2.8272222, 101.6567808],   // Kg Bukit Serdang         — the point 1279 was published at
    1286 => [3.58450, 101.59203],       // Kg Jawa Kerling          — the SIREN KG. JAWA KERLING mast, 278 m from the point 1281 was published at, LOCATION CONFIRMED
    1287 => [3.198805, 101.760541],     // RP SK Hulu Klang       — published 69 km away, in Tanjung Karang, LOCATION CONFIRMED
    1288 => [3.424508, 101.181142],     // Pekan Tanjung Karang     — published 83 km away, in Bangi, LOCATION CONFIRMED
    1289 => [3.70943, 101.17493],       // Rimba KDR                — the mast of that name, LOCATION CONFIRMED
];
/* How close a sensor must be to a camera before its alert is allowed onto that camera's frames.
   js/config.js carries the same 2 for the live warning glyph. Change both together. */
const CAM_ALERT_KM = 2;
/* The lowest rainfall reading that is JPS's top class. `rainStatus()` in sources.php scores
   `> 60` as class 4, and frameTiers() compares with `>=`, so the two agree only at a value the
   feed cannot publish between. JPS reports rainfall to one decimal, so 60.1 is that value. */
const RAIN_DANGER = 60.1;
const CACHE = __DIR__ . '/.cache.json';
/* The camera still cache. Every ?cam= request used to reach JPS, so N readers on the camera wall
   aimed N times 90 fetches at one agency. 300 seconds is the lifetime the Cache-Control
   on this endpoint already claims, and it matches POLL_MS in js/config.js. A still cannot change
   faster than the payload that names it.
   CAM_URLS is a small map of camera id to image URL, written at the end of each rebuild. The
   handler used to decode all 312 KB of .cache.json to read one string out of it. */
const CAM_TTL  = 300;
const CAM_DIR  = __DIR__ . '/.cam';
const CAM_URLS = __DIR__ . '/.cams.json';
/* How long a stale still may stand in for a live one when the fetch fails. An upstream blip should
   cost a slightly old picture rather than the No picture panel. An upstream that stays down must
   not leave a frame of any age on screen with nothing saying so. */
const CAM_STALE = 3600;
const LOCK  = __DIR__ . '/.refresh.lock';   // held for the length of a rebuild; see below
const HIST  = __DIR__ . '/.history.db';
const READ  = 86400;         // seconds of history loaded per poll (trend + sparkline)
const RETAIN = 30 * 86400;   // seconds kept on disk; older samples are pruned
/* Seconds of odometer history loaded per poll. The longest window is 72 hours and a baseline has to
   sit behind it, so this carries 8 hours of margin. A poll that arrives late still finds a sample
   older than the far end of the window rather than reporting nothing. */
const ACC_READ = 80 * 3600;

/* A forced refresh skips the file cache, so it costs a full ~270-request fan-out at JPS. The button
   is public, so the guard sits here, not in the browser. One force a minute site-wide caps the
   worst case at ~4.5 requests a second. A cold rebuild already fires 270 in three seconds, which is
   90 a second, so the button cannot make a burst this site does not already make. */
const FORCE_EVERY = 60;
const FORCE_STAMP = __DIR__ . '/.force.stamp';

/* Place search. One uncached lookup a second site-wide: Nominatim's policy asks no more, and this
   proxy is a public URL. A cached hit skips the limit, because it costs OpenStreetMap nothing. */
const PLACE_EVERY = 1;
const PLACE_STAMP = __DIR__ . '/.place.stamp';
// A lock of its own, not the stamp file. Opening the stamp with mode 'c' creates and stamps it as a
// side effect of the check, so the first request would find a stamp it had just made.
const PLACE_LOCK  = __DIR__ . '/.place.lock';
const PLACE_TTL   = 30 * 86400;   // place names do not move
const NOMINATIM   = 'https://nominatim.openstreetmap.org/search';
/* The coverage box: Selangor, Kuala Lumpur and Putrajaya. The 683 stations span latitude 2.6088 to
   3.8470 and longitude 100.8229 to 101.9215, plus 0.1 degrees of margin so an edge place resolves.
   Nominatim reads `viewbox` as west,north,east,south. Published as `box`, a diagnostic beside
   `siteM` and `ttl` below. No client script reads it today. */
const BOX = [100.72, 3.95, 102.02, 2.50];

/* MET Malaysia. Two products, two hosts, both reached from PHP only — the browser still talks to
   this origin and to CARTO and to nothing else.
   MET_KM is the radius a nowcast point speaks across. It comes from the decorrelation distance
   for rainfall, which grows with the period measured: about 7.8 km at 10 minutes and about 26.5 km
   at 3 hours. The card states a claim about a 3-hour window, so 16.5 km sits well inside it. A line
   that ever claims rain is falling AT THIS MOMENT needs a much tighter radius, near 3 km. Do not
   reuse this constant for one.
   It was 15.0, and the 1.5 km bought 17 stations. `metSection()` in `js/popup.js` hides the whole
   weather section when MET answers a station with a temperature and no rain, and 53 stations were
   hidden that way. Eleven of them sat at 15.0 to 15.5 km, which is the cutoff and not the physics.
   The 36 still hidden sit at 16.6 to 27.0 km. Do not chase those with a bigger number. The far end
   is Sabak Bernam, where MET built one point for a 28 km cell, and a radius that reaches it is the
   cell-scaled rule this file already rejects. The card names the point and the distance now, so a
   reader can weigh a claim made 16 km away. */
const MET_URL     = 'https://www.met.gov.my/nowcasting/';
const MET_DAY_URL = 'https://api.data.gov.my/weather/forecast/';
const MET_KM      = 16.5;
const MET_STALE   = 7200;    // 2 h — an old projection is worse than none
const MET_DAY_TTL = 21600;   // 6 h — the forecast changes once a day

/* MET warnings. A warning is worth having late and worthless stale, so the cache holds it a short
   time only. */
const MET_WARN_URL = 'https://api.data.gov.my/weather/warning';
const MET_WARN_TTL = 900;    // 15 min

date_default_timezone_set('Asia/Kuala_Lumpur'); // upstream timestamps are local MYT, unlabelled

const HOST = 'infobanjirjps.selangor.gov.my';

// slope and assess live here, above the early-returning endpoints, so ?shots= can reach assess too.
// Hoisted out of the refresh path unchanged below; only the function heads moved.

/** Theil-Sen: the median of every pairwise slope in the window, in m/hour. Null if no pair spans. */
function slope(array $pts, int $at): ?float {
    $win = [];
    foreach ($pts as $p) if ($at - $p[0] >= 0 && $at - $p[0] <= TREND_MAX) $win[] = $p;
    $n = count($win);
    $sl = [];
    for ($i = 0; $i < $n; $i++) for ($j = $i + 1; $j < $n; $j++) {
        $dt = $win[$j][0] - $win[$i][0];
        if ($dt >= TREND_MIN) $sl[] = ($win[$j][1] - $win[$i][1]) / ($dt / 3600);
    }
    if (!$sl) return null;
    sort($sl);
    $m = count($sl);
    return $m % 2 ? $sl[($m - 1) / 2] : ($sl[intdiv($m, 2) - 1] + $sl[intdiv($m, 2)]) / 2;
}

/** Judge one sample. Returns [rate m/h, hours to $mark], the ETA null unless it is really climbing.
 *  Takes an index, not the latest point, so the previous poll faces the same rules. That is the
 *  whole on-delay, with nothing persisted. */
function assess(array $pts, int $i, ?float $mark): array {
    [$at, $lvl] = $pts[$i];
    $rate = slope(array_slice($pts, 0, $i + 1), $at);
    if ($rate === null || $rate < RISE_FLOOR || $i < 2 || $mark === null) return [$rate, null];
    // Strictly higher across three samples. Allowing equality let a level that had not moved in
    // five polls climb on a rate left over from an earlier step: a closed gate reported 0.9 h.
    if ($lvl <= $pts[$i - 2][1]) return [$rate, null];
    $day = [];
    foreach ($pts as $p) if ($p[0] < $at && $at - $p[0] <= RISE_DAY) $day[] = $p[1];
    if ($day && $lvl < max($day)) return [$rate, null];   // still inside its own daily envelope
    return [$rate, round(max(0, ($mark - $lvl) / $rate), 2)];
}

/**
 * Is a siren's alarm backed by the water it is wired to?
 *
 * True when a river inside SIREN_KM is at its Amaran mark, false when rivers are in reach and none
 * is, null when there is none to ask. Do not collapse the three: false is evidence against the
 * alarm, null is no evidence, and a siren nobody can check keeps the benefit of the doubt.
 *
 * Duration was tried first and fails in the direction that matters. JPS repeats the alarm every
 * 3 hours at Amaran and every 5 at Bahaya while the water stays up, so a real flood holds a siren
 * on for half a day. Any cutoff short enough to catch a stuck relay dismisses the real one.
 *
 * $rivers is [[lat, lng, status], …]. Status 2 is Amaran and 3 is Bahaya — see wlStatus().
 */
function sirenBacked(float $lat, float $lng, array $rivers): ?bool {
    $asked = false;
    foreach ($rivers as [$rlat, $rlng, $status]) {
        // Equirectangular, like every other distance in this file: at this latitude and over 5 km
        // the error against a great circle is centimetres, and the answer is a yes or no at 5 km.
        if (hypot($rlat - $lat, ($rlng - $lng) * cos(deg2rad($lat))) * 111 > SIREN_KM) continue;
        $asked = true;
        if ($status >= 2) return true;
    }
    return $asked ? false : null;
}

/**
 * The MET point nearest a station, or null when none is within MET_KM.
 *
 * This is Thiessen assignment, which is the same answer a Voronoi tessellation over the MET points
 * gives — a Voronoi cell holds exactly the area nearer its own seed than any other. So the polygons
 * are not built. `argmin` gives the identical result.
 *
 * Interpolation is not an option here and that is not a compromise. MET publishes a CATEGORY, and an
 * average of "Tiada Hujan" and "Hujan Lebat" is "Hujan", a reading MET never made. Kriging and
 * inverse distance weighting both beat Thiessen for areal rainfall in millimetres, and neither can
 * touch a category.
 *
 * Returns [point, km]. Equirectangular, like every other distance in this file.
 */
function metNearest(float $lat, float $lng, array $points): ?array {
    $best = null;
    $bestKm = INF;
    foreach ($points as $p) {
        $km = hypot($p['lat'] - $lat, ($p['lng'] - $lng) * cos(deg2rad($lat))) * 111;
        if ($km < $bestKm) { $bestKm = $km; $best = $p; }
    }
    return ($best !== null && $bestKm <= MET_KM) ? [$best, $bestKm] : null;
}

/**
 * The published position of a camera, or the corrected one where JPS shuffled a batch. See CAM_FIX.
 * Cameras only, because the shuffle touched no other kind, and only while the feed disagrees by
 * more than CAM_FIX_KM. That last test stops the table going stale: once JPS publishes the right
 * coordinate the feed wins again, with nothing to edit here.
 */
function camFix(string $kind, int $id, float $lat, float $lng): array {
    if ($kind !== 'camera' || !isset(CAM_FIX[$id])) return [$lat, $lng];
    [$flat, $flng] = CAM_FIX[$id];
    // Equirectangular, as everywhere else in this file — see sirenBacked() above.
    $off = hypot($flat - $lat, ($flng - $lng) * cos(deg2rad($flat))) * 111;
    return $off > CAM_FIX_KM ? [$flat, $flng] : [$lat, $lng];
}

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

/**
 * Is this body a picture?
 *
 * A status code cannot decide what a body is. JPS answers a maintenance window with a short HTML
 * notice under HTTP 200, which is why pageHasData() guards the scraped pages in this file. Here the
 * cost is higher: an unchecked body is written to disk, served for CAM_TTL, and then offered again
 * as the stale fallback. One bad response becomes a standing failure.
 *
 * getimagesizefromstring() returns false for anything that is not an image, so it answers the
 * question directly rather than guessing from a length or a header.
 */
function camImageOk(string $body): bool {
    return $body !== '' && @getimagesizefromstring($body) !== false;
}

// ?cam=<id> streams a CCTV still. Upstream advertises these over plain http, which an https page
// can't load, so we fetch server-side. Only ids we already hold a URL for — never an arbitrary URL.
if (isset($_GET['cam'])) {
    $id  = (int)$_GET['cam'];
    $hit = $id > 0 ? CAM_DIR . "/$id.jpg" : null;

    /* A cached still answers without a lookup and without touching JPS. This is the whole point of
       the endpoint: 90 tiles times every reader used to be 90 times every reader at the agency. */
    if ($hit && is_file($hit) && ($age = time() - filemtime($hit)) < CAM_TTL) {
        header('Content-Type: image/jpeg');
        /* The remaining life of this file, not the whole of CAM_TTL. The disk cache and the browser
           cache compose: a file served at 299 seconds old under `max-age=300` reaches a reader 599
           seconds old, while both layers claim 300. This is the rule the ?sheet= header already
           follows, where a cached strip may not outlive one capture cycle. */
        header('Cache-Control: max-age=' . max(1, CAM_TTL - $age));
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
    if (!camImageOk($img)) {
        /* Serve a recent stale still rather than a broken picture. Bounded by CAM_STALE: a blip
           costs a slightly old frame, and an outage falls through to the failure panel the client
           already draws for a dead camera. */
        if ($hit && is_file($hit) && time() - filemtime($hit) < CAM_STALE) {
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
        if (file_put_contents($tmp, $img, LOCK_EX) === false || !@rename($tmp, $hit)) @unlink($tmp);
    }
    header('Content-Type: image/jpeg');
    /* 300s = POLL_MS in js/config.js and CAM_TTL above. All three move together. */
    header('Cache-Control: max-age=' . CAM_TTL);
    echo $img;
    exit;
}

/* ?place=<query> — turn a place name into a coordinate, inside the coverage area only.
   This adds no third party to the browser. The browser still talks only to this origin and to
   CARTO's basemap tiles (js/map.js, named in the About pane's Credits). Nominatim is reached from
   here, server-side, which is what keeps the About pane's privacy paragraph honest.
   Explicit, never per keystroke: the client calls this only when the reader picks the search row,
   as Nominatim's usage policy asks. */
if (isset($_GET['place'])) {
    header('Content-Type: application/json');
    $q = placeQuery(placeParam($_GET['place']));
    if ($q === null) {
        http_response_code(400);
        echo json_encode(['places' => [], 'error' => 'invalid place query']);
        exit;
    }

    /* The `page` table again, not a new store: one more slow upstream read with a long life.
       Created here as well as in the refresh path, because a place search can be the first thing
       that ever touches this file.
       Caught, unlike the refresh path's connect. This handler already sent Content-Type:
       application/json above, so an uncaught PDOException — unwritable .history.db, locked file,
       disk full — puts PHP's fatal-error page inside a response a client parses as JSON.
       A connect failure costs only the cache: $db stays null, the reads and writes below are
       skipped, and the lookup still runs and still passes the rate limit two blocks down. */
    $db = null;
    try {
        $db = new PDO('sqlite:' . HIST, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $db->exec('PRAGMA journal_mode=WAL');
        $db->exec('CREATE TABLE IF NOT EXISTS page (url TEXT PRIMARY KEY, ts INTEGER, body TEXT) WITHOUT ROWID');
    } catch (\Throwable $e) {
        $db = null;
    }

    $key = 'place:' . $q;
    if ($db) {
        $sel = $db->prepare('SELECT ts, body FROM page WHERE url = ?');
        $sel->execute([$key]);
        $hit = $sel->fetch(PDO::FETCH_ASSOC);
        if ($hit && time() - (int)$hit['ts'] < PLACE_TTL) {
            header('Cache-Control: max-age=600');
            echo $hit['body'];
            exit;
        }
    }

    /* The limit guards the uncached path only. A repeat search costs OpenStreetMap nothing, so
       refusing it would punish the reader for a request that never leaves this box.
       Read-decide-write must be one atomic step. Two concurrent requests for two *different*
       uncached queries otherwise read the same stale mtime, both see themselves as first this
       second, and both call Nominatim. Two tabs or a reload race is ordinary traffic here, not an
       adversary. Nothing else serializes callers on this path, so this mtime check is the whole
       guard and has to be correct alone.
       The lock is taken, used and released here, never held across the fetch below. The fetch takes
       about a second cold, and holding the lock that long queues every reader behind the slowest. */
    $lock = fopen(PLACE_LOCK, 'c');
    flock($lock, LOCK_EX);
    // PHP's stat cache holds filemtime() per request, so a read after another process touched the
    // file inside this lock returns the old value. Without this the lock serializes without fixing.
    clearstatcache();
    [$allowed] = forceAllowed(
        time(), is_file(PLACE_STAMP) ? filemtime(PLACE_STAMP) : null, PLACE_EVERY);
    if ($allowed) touch(PLACE_STAMP);
    flock($lock, LOCK_UN);
    fclose($lock);
    if (!$allowed) {
        http_response_code(429);
        echo json_encode(['places' => [], 'error' => 'rate limited']);
        exit;
    }

    $url = NOMINATIM . '?' . http_build_query([
        'q'            => $q,
        'format'       => 'jsonv2',
        'limit'        => 8,
        'countrycodes' => 'my',
        'viewbox'      => implode(',', BOX),
        'bounded'      => 1,
    ]);
    // fetchAll, never file_get_contents — the same rule the whole file follows. It also carries the
    // identifying User-Agent that Nominatim's policy requires.
    $raw = json_decode(fetchAll([$url], 1, false)[$url] ?? '', true);
    if (!is_array($raw)) {
        http_response_code(502);
        echo json_encode(['places' => [], 'error' => 'unavailable']);
        exit;
    }

    /* Four fields, nothing else. The raw response is large, its shape moves between versions, and
       the client must not depend on a schema we do not own. `display_name` is the full address.
       Its first part repeats `name`, so the detail line takes the next three: district, state and
       usually the postcode area. */
    $places = [];
    foreach ($raw as $r) {
        $name = trim((string)($r['name'] ?? ''));
        $full = (string)($r['display_name'] ?? '');
        if ($name === '') $name = trim(explode(',', $full)[0] ?? '');
        if ($name === '') continue;
        $parts = array_slice(array_map('trim', explode(',', $full)), 1, 3);
        $places[] = [
            'name'   => $name,
            'detail' => implode(', ', array_filter($parts)),
            'lat'    => (float)($r['lat'] ?? 0),
            'lon'    => (float)($r['lon'] ?? 0),
        ];
    }

    $body = json_encode(['places' => $places, 'error' => null]);
    if ($db) {
        $db->prepare('INSERT OR REPLACE INTO page (url, ts, body) VALUES (?, ?, ?)')
           ->execute([$key, time(), $body]);
        /* The scraper's page rows are a fixed, small set and can never grow. A place row is keyed
           by whatever a reader typed into a public URL, so the table grows without bound unless
           something prunes it. Scoped to `place:%`: the scraped rows have their own shorter TTL and
           fixed keys. Runs on the uncached path only, which is already the slow one. */
        $db->prepare("DELETE FROM page WHERE url LIKE 'place:%' AND ts < ?")
           ->execute([time() - PLACE_TTL]);
    }
    header('Cache-Control: max-age=600');
    echo $body;
    exit;
}

/* ?shots=<id> — which frames exist, and what the river beside the camera was doing at each one.
   The client asks when a lightbox opens and when a camera card opens.
   Shape is [[ts, tier, stationId], …]. `tier` is "now", "soon" or null.
   Rivers, gauges, sirens and rainfall, each against its own mark — the four kinds the live warning
   glyph can name, so the picture and the strip agree on every frame. Only the river gets `soon`,
   because only the river has a rate to project. Two things leave a tier null, and both draw an
   uncolored tick: the frame is older than the 30 days of levels we keep, or nothing with a mark
   sits within CAM_ALERT_KM. */
if (isset($_GET['shots'])) {
    header('Content-Type: application/json');
    header('Cache-Control: max-age=60');
    $id     = (int)$_GET['shots'];
    $frames = shotList($id);
    $rows   = array_map(fn($ts) => [$ts, null, null], $frames);

    $st  = is_file(CACHE) ? (json_decode(file_get_contents(CACHE), true)['stations'] ?? []) : [];
    $cam = null;
    foreach ($st as $s) if ($s['kind'] === 'camera' && $s['id'] === 'camera-' . $id) { $cam = $s; break; }

    if ($cam && $frames && is_file(HIST)) {
        $km = function (array $a, array $b): float {
            $x = ($a['lat'] - $b['lat']) * 111;
            $y = ($a['lng'] - $b['lng']) * 111 * cos(deg2rad($a['lat']));
            return sqrt($x * $x + $y * $y);
        };
        try {
            // Read-only. This connection must never be able to write .history.db, and a read-write
            // handle that is the last one open checkpoints the WAL on close.
            $db = new PDO('sqlite:' . HIST, null, null, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::SQLITE_ATTR_OPEN_FLAGS => PDO::SQLITE_OPEN_READONLY,
            ]);
            // Start a day before the first frame. assess() looks back RISE_DAY for the tide guard, so
            // a frame near the window's start needs that much history too, or the guard runs short.
            $sel = $db->prepare('SELECT ts, level FROM level WHERE station = ? AND ts >= ? ORDER BY ts');

            /* sirenBacked()'s question, asked of each frame's own moment: was a river within
               SIREN_KM at its Amaran mark when the shutter went? Without it a stuck relay paints a
               month of calm photographs red — measured at 10 of 19 frames on Pekan Banting and 4 of
               19 on Kg. Melayu Subang, both with rivers metres below their marks throughout.
               `frameTiers` against the river's *warning* mark is the whole scorer. It returns `now`
               for exactly the frames that river was at Amaran for. The live rule reads today's
               river. This one cannot: a picture from last week is judged by last week's water.
               Same benefit of the doubt as live — no river in reach leaves the tiers alone. Called
               only for a siren that scored, so the 189 pairs in range cost nothing until one reads 1. */
            $sirenFrames = function (array $siren, array $tiers) use ($st, $km, $sel, $frames): array {
                $asked = false;
                $backedAt = [];
                foreach ($st as $r) {
                    if ($r['kind'] !== 'river' || empty($r['warning']) || !$r['lat']) continue;
                    if ($km($siren, $r) > SIREN_KM) continue;
                    $asked = true;
                    $sel->execute([$r['id'], $frames[0] - RISE_DAY]);
                    $s = array_map(fn($x) => [(int)$x['ts'], (float)$x['level']], $sel->fetchAll(PDO::FETCH_ASSOC));
                    foreach (frameTiers($frames, $s, (float)$r['warning'], 0, fn() => [null, null]) as $ts => $t) {
                        $backedAt[$ts] = true;
                    }
                }
                return $asked ? array_intersect_key($tiers, $backedAt) : $tiers;
            };

            $best = [];   // frameTs => [rank, tier, stationId, distKm] — see the tie-break note below
            foreach ($st as $r) {
                /* Each kind against its own mark. A river and a gauge publish one. A siren is 0 or 1
                   here, and 1 is the whole of "sounding". Rainfall takes JPS's own class boundary.
                   Anything else — a camera — has nothing to score. */
                $mark = match ($r['kind']) {
                    'river', 'gauge' => empty($r['danger']) ? null : (float)$r['danger'],
                    'siren'          => 1.0,
                    'rainfall'       => RAIN_DANGER,
                    default          => null,
                };
                if ($mark === null) continue;
                $d = $km($cam, $r);
                if ($d > CAM_ALERT_KM) continue;
                $sel->execute([$r['id'], $frames[0] - RISE_DAY]);
                $samples = array_map(fn($x) => [(int)$x['ts'], (float)$x['level']], $sel->fetchAll(PDO::FETCH_ASSOC));
                /* Only a river carries a forecast. Standing water, a sounding siren and rain now are
                   observed states with no rate to project, so those three take an assess that never
                   answers. That turns the `soon` half of frameTiers off. Same split as live, where
                   `isHot()` forecasts rivers and nothing else. */
                $tiers = $r['kind'] === 'river'
                    ? frameTiers($frames, $samples, $mark, RISE_ETA, 'assess')
                    : frameTiers($frames, $samples, $mark, 0, fn() => [null, null]);
                // A siren's 1 is a claim about a river, here as much as live. Ask the water.
                if ($r['kind'] === 'siren' && $tiers) $tiers = $sirenFrames($r, $tiers);
                foreach ($tiers as $ts => $t) {
                    $rank = $t === 'now' ? 0 : 1;
                    /* Worse tier wins, nearer river breaks a tie. camAlert() in js/stations.js ranks
                       the live glyph the same way. The two must agree, or a reader ignores the river
                       named on screen and the tick stays colored on another river in range. */
                    if (!isset($best[$ts]) || $rank < $best[$ts][0]
                        || ($rank === $best[$ts][0] && $d < $best[$ts][3])) {
                        $best[$ts] = [$rank, $t, $r['id'], $d];
                    }
                }
            }
            /* Only the worst-tier station rides along, so the client can drop a tick raised by an
               ignored sensor. It falls to uncolored, not to the second-worst river.
               ponytail: two hot rivers within 2 km of one camera is rare. If that changes, send a
               tier per station and let the client pick. */
            foreach ($rows as $k => $row) {
                if (isset($best[$row[0]])) $rows[$k] = [$row[0], $best[$row[0]][1], $best[$row[0]][2]];
            }
        } catch (\Throwable $e) {
            // A broken read must not become a cached 200 with a fatal-error body. Fall back to the
            // plain frame list. The client already renders null tiers as an uncolored strip.
            $rows = array_map(fn($ts) => [$ts, null, null], $frames);
        }
    }
    echo json_encode($rows);
    exit;
}

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
        /* Refuse a frame the archive has stopped refreshing. The caller asked for a picture that
           stands in for now, and this route answering 404 is what sends the camera wall to the live
           feed, and from there to the No picture panel if that is dead too. The `&t=` form is
           unaffected: it names one exact frame and a reader asking for a specific past moment is
           entitled to it however old it is. */
        $t = shotFresh($t, time());
    }
    $f = $id > 0 && $t > 0 ? shotFile($id, $t) : null;
    if (!$f) { http_response_code(404); exit; }
    // A frame is stored in whichever format was smaller, so the type comes off the file we found.
    header('Content-Type: ' . (str_ends_with($f, '.webp') ? 'image/webp' : 'image/jpeg'));
    header('Cache-Control: ' . shotCache($exact));
    readfile($f);
    exit;
}

/* ?sheet=<id> — the strip: every frame inside the clip window, side by side in one WebP, at
   SHEET_W x SHEET_H a cell. See buildSheet() in shots.php for how and why it is built on request
   rather than inside captureShots(). Same integer-only intake as ?cam=, ?shot= and ?shots=. No
   string parameter belongs on this handler: (int) is silent on an array, which is why those three
   never had the problem ?place= did. See the cast gotcha in CLAUDE.md. */
if (isset($_GET['sheet'])) {
    $path = buildSheet((int)$_GET['sheet'], time());
    if (!$path) { http_response_code(404); exit; }
    header('Content-Type: image/webp');
    /* Not `immutable`, unlike the frame above. A stored frame never changes once written, so a year
       is honest there. A strip's bytes at this same URL change every time captureShots() lays a new
       frame, up to once every SHOT_EVERY (30 min), so `immutable` here is a lie a browser holds for
       a year: reopen a camera after one capture cycle and you keep the old strip with no way to
       notice. max-age=900 is half of SHOT_EVERY, so a reopen inside that window is free and a
       cached strip can never outlive one capture cycle by more than that margin. */
    header('Cache-Control: public, max-age=900');
    readfile($path);
    exit;
}

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

/**
 * The reading stamp for one siren, gauge or camera.
 *
 * A siren this rebuild did not fetch keeps the timestamp it already had. Not fetching a siren is
 * not evidence that it reported now. Without this, readTs() falls back to the poll time. That is
 * the one thing a sample stamp must never be, and it defeats the (station, ts) key. See the
 * reading-stamp gotcha in CLAUDE.md.
 *
 * Only a siren carries a stamp forward. A gauge and a camera must never borrow one.
 *
 * @param array $seen siren id to last known stamp, from the payload of the previous rebuild
 */
function stationUpdated(array $fg, array $sn, string $kind, int $id, array $seen): ?string {
    return $fg['statusLastUpdate'] ?? $sn['statusLastUpdate']
        ?? ($kind === 'siren' ? ($seen["siren-$id"] ?? null) : null);
}

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

/* The age ceiling on the newest-frame route, as a function so --selftest can reach the shipped rule.
 * It returns the timestamp to serve, and 0 for "answer 404". Written inline first, which left the
 * check restating the arithmetic instead of calling it: `SHOT_FRESH - 60 <= SHOT_FRESH` is true
 * however this route behaves. A rule a test cannot call is a rule the test cannot guard. */
function shotFresh(int $t, int $now): int {
    return $t && $now - $t > SHOT_FRESH ? 0 : $t;
}

/**
 * May a forced refresh run now?
 *
 * @param int      $now       unix seconds
 * @param int|null $lastForce mtime of FORCE_STAMP, or null when no force has ever run
 * @return array{0: bool, 1: string} allowed, and why
 */
function forceAllowed(int $now, ?int $lastForce, int $window = FORCE_EVERY): array {
    if ($lastForce === null) return [true, 'first'];
    $since = $now - $lastForce;
    // A stamp in the future means a clock moved, not that someone forced a refresh in the future.
    // Refusing until it catches up would disable the button for as long as the skew lasts.
    if ($since < 0) return [true, 'clock moved'];
    return $since >= $window ? [true, 'ok'] : [false, 'rate limited'];
}

/**
 * Serve the cache instead of rebuilding? This one expression decides whether a request reaches JPS
 * at all, so the self-check exercises it directly rather than through a 270-request fan-out.
 */
function serveFromCache(int $age, bool $mine, bool $force): bool {
    return ($age < TTL && !$force) || !$mine;
}

/**
 * What a page-cache row becomes after a fetch attempt. Returns [write the row, the body to write].
 *
 * This server stamps every page it asked for, whether or not that page answered. A failure keeps the
 * copy already stored. Stamping only a success leaves a dead upstream stuck. Its ts never advances,
 * so $want selects it on every rebuild, and each rebuild pays the full CURLOPT_TIMEOUT for an answer
 * that is not coming. The KL rainfall table hung that way for four days and put 25 seconds on every
 * poll, which is most of what a reader waited for.
 *
 * This server never stamps a page it did not ask for. A new stamp on a fresh row would push its next
 * fetch out forever.
 *
 * Offline like forceAllowed() and serveFromCache(), and for the same reason. It decides how often
 * this server contacts an upstream.
 */
function pageRow(bool $asked, string $got, string $had): array {
    return [$asked, $got !== '' ? $got : $had];
}

/**
 * Does this body carry the kind of document the key names?
 *
 * A status code cannot answer that. The national portal serves a maintenance window as a 320-byte
 * `Notis Gangguan` notice under HTTP 200, and pageRow() stores whatever it is handed. So the notice
 * replaced two good tables, the readings for KL and Putrajaya went with them, and every counter
 * stayed quiet because the fetch had in fact succeeded.
 *
 * A body that fails here is treated as a fetch that never answered. The stored copy stays, the row
 * is stamped so the retry backs off, and the key lands in sources.stale where a reader can see it.
 *
 * Each test asks only what kind of document arrived. The parsers still do the reading. `met-now` is
 * tested on the map scaffolding rather than on a marker, because a nowcast with nothing to report is
 * a real state and must not read as an outage.
 */
function pageHasData(string $key, string $body): bool {
    if ($body === '') return false;
    return match (true) {
        $key === 'met-day', $key === 'met-warn' => json_decode($body) !== null,
        $key === 'met-now'                      => str_contains($body, 'map.setView'),
        /* The portal rainfall page carries no <tr> on a data row — see portalRows(). Its header
           holds four, and the empty form page holds the same four, so the shared test passes on a
           page with nothing in it. `data-th='No'` appears once per data row and nowhere else. */
        str_starts_with($key, 'prf-')           => str_contains($body, "data-th='No'"),
        default                                 => str_contains($body, '<tr'),
    };
}

/* Which region each page speaks for. Only the national portal is known to publish a notice, so only
   its keys are here. A key absent from this table can still be recognised as a notice, and it simply
   contributes no region — the reader is told the source is down without a claim about where. */
const NOTICE_REGION = [
    'nat-SEL' => 'Selangor',
    'nat-WLH' => 'Kuala Lumpur',
    'nat-PTJ' => 'Putrajaya',
];

/**
 * Which known outage notice is this body, if any?
 *
 * The national portal answers a service outage with a page titled `Notis Gangguan`, under HTTP 200.
 * pageHasData() already refuses it, which keeps the stored table on the map. This function reads the
 * same body one step further and asks whether the source stated its own failure, because a source
 * that says it is down is worth repeating to a reader and a timeout is not.
 *
 * The test is the title, never the body text and never the image path. A table that prints these two
 * words in a cell is still a table, and a file name is something JPS can rename without telling
 * anyone.
 */
function noticeOf(string $body): ?string {
    if ($body === '') return null;
    return preg_match('~<title>\s*Notis\s+Gangguan~i', $body) ? 'publicinfobanjir' : null;
}

/* The `page` table also remembers the notice found on each page, under this reserved key prefix. The
   `place:` cache reserves a prefix in the same table for the same reason. No scraped URL can collide
   with either one. */
const NOTICE_KEY = 'notice:';

/**
 * What to do with a page's remembered notice after a fetch attempt.
 *
 * The memory exists because the page cache does not refetch every poll. pageRow() stamps a page that
 * failed, so a dead source backs off for SCRAPE_TTL while the payload rebuilds every TTL. Reading
 * this poll's fetch alone therefore found the notice on one rebuild in three. The banner appeared
 * and vanished every five minutes while the source stayed down.
 *
 * Only a fetch carries news. A poll that did not ask learns nothing and must leave the memory alone.
 *
 * Returns 'set' to remember this id, 'clear' to forget, and 'keep' to leave the memory as it is.
 */
function noticeRow(bool $asked, ?string $id): string {
    if (!$asked) return 'keep';
    return $id === null ? 'clear' : 'set';
}

/**
 * Normalize and validate a place query. Returns the normalized string, or null when it is unusable.
 *
 * Separate from the endpoint so the self-check can exercise it without a network call, exactly as
 * forceAllowed() and serveFromCache() are. The query never builds a path or a URL — it becomes one
 * query-string parameter to one fixed host — so the `?cam=` rule holds by construction here too.
 *
 * Not the client's squash(): that one strips punctuation to match station names, and `kg.` and `kg`
 * are different queries to a geocoder.
 */
function placeQuery(string $raw): ?string {
    // preg_replace with /u returns null on invalid UTF-8, and trim(null) is deprecated. The notice
    // lands in a response already typed application/json, breaking the parse for a client that sent
    // one bad byte. Reject here: the contract belongs to the validator, not to its caller.
    if (!mb_check_encoding($raw, 'UTF-8')) return null;
    $q = trim(preg_replace('/\s+/u', ' ', $raw));
    $n = mb_strlen($q);
    if ($n < 2 || $n > 80) return null;
    return mb_strtolower($q);
}

/**
 * The one call site that turns $_GET['place'] into the string placeQuery() expects.
 *
 * PHP's (string) cast on an array does not throw. It emits `Warning: Array to string conversion`
 * and yields the literal "Array", five characters that pass placeQuery() clean. ?place[]=x makes
 * $_GET['place'] an array, so the cast prints that warning into a response already typed
 * application/json, and then spends the site-wide rate limit on a garbage query. `?cam=` and
 * `?shots=` escaped this because `(int)` on an array is silent.
 * The fix sits here, not in placeQuery(). The validator's contract is about the content of a
 * string. Whether the value handed to it is one is the caller's job.
 */
function placeParam(mixed $v): string {
    return is_string($v) ? $v : '';
}

/* Rain over a window, as the difference of two odometer readings.
 *
 * `cumulativeRainfall` only ever climbs, so the rain between two samples is one subtraction. That is
 * the whole reason this reads an odometer instead of adding up `hourly` buckets. A sum loses the
 * rain in every gap and reports a small number with nothing to say it is short — this box has held
 * 9 of the last 24 clock hours, and a sum renders that as a dry day. A difference cannot lose rain.
 * A missed poll widens the window instead, and the payload can measure that wider window, so this
 * returns the span it actually covered and the card prints it.
 *
 * $odo must be ascending by timestamp, which is what the `ORDER BY ts` on the load gives.
 *
 * $partial opts a caller into a SHORT window. With no sample at or before the far end, the
 * measurement runs from the oldest sample there is, and the third return element says so. That is
 * still a difference and it still cannot lose rain. It covers less ground than the window names, so
 * the card prints a second asterisk on it and the readout gives the span it really covered. A window
 * this app measured over 20.9 h and labelled beats an em dash for the two days the archive takes to
 * fill.
 *
 * TWO WINDOWS CAN COME BACK WITH THE SAME SPAN, AND BOTH ARE PUBLISHED. The earliest record is the
 * earliest record, so an archive 23 h deep answers 24 h and 72 h with the same 23 h difference, each
 * marked short. Both columns then draw one number at one height. An earlier version dropped the
 * longer of the pair, on the reasoning that two equal bars read as a measurement of the 49 hours
 * between them. That is gone on purpose. A dash tells a reader nothing at all, and the mark plus the
 * span in the readout carry the shortfall on both columns. Do not put the drop back.
 *
 * $partial is false by default, which forbids the short answer outright. rainBacked() needs that:
 * it asks whether an hour of claimed rain reached the odometer, and a window narrower than the hour
 * would call live rain faulty. A wider window can only add rain, which is the safe way to be wrong.
 * A narrower one is the unsafe way.
 *
 * Returns [mm, spanHours, short], or null where the archive cannot answer:
 *   - nothing stored for this station yet
 *   - no sample at or before the far end, and the caller allowed no short answer
 *   - the odometer went backwards, which is the 1 January reset
 *   - both ends landed on one sample, so there is no span to measure
 */
function accWindow(array $odo, int $now, int $win, bool $partial = false): ?array {
    if (!$odo) return null;
    $last  = end($odo);
    $cut   = $now - $win;
    $base  = null;
    $short = false;
    foreach ($odo as $p) {
        if ($p[0] > $cut) break;
        $base = $p;
    }
    if ($base === null) {
        if (!$partial) return null;
        $base  = $odo[0];
        $short = true;
    }
    if ($base[0] === $last[0]) return null;
    if ($last[1] < $base[1]) return null;                 // the odometer reset
    return [round($last[1] - $base[1], 1), round(($last[0] - $base[0]) / 3600, 1), $short];
}

/* Rain over the last N whole clock hours, added from one reading per hour.
 *
 * The fallback for a feed that publishes no 3 hour total of its own. `hourlyRainfall` is a ROLLING
 * hour, so one reading per clock hour is the most that can be added without counting the same rain
 * twice. That is the same rule RAIN_BUCKET states for the graph.
 *
 * Null unless every hour in the window carries a reading. A short sum is indistinguishable from
 * light rain, and this app must never report a dry hour it did not see.
 */
function accHours(array $points, int $now, int $hours): ?float {
    $bucket = [];
    foreach ($points as [$ts, $v]) $bucket[intdiv($ts, 3600)] = $v;  // ascending, so the newest wins
    $top = intdiv($now, 3600);
    $sum = 0.0;
    for ($i = 0; $i < $hours; $i++) {
        if (!isset($bucket[$top - $i])) return null;
        $sum += $bucket[$top - $i];
    }
    return round($sum, 1);
}

/**
 * Is a rain gauge's hourly total backed by the odometer on the same station?
 *
 * `hourlyRainfall` is a rolling one hour total and `cumulativeRainfall` only climbs, so rain the
 * first claims has to appear in the second across that same hour. True when the odometer rose,
 * false when it did not move while the gauge still claims rain, null when nothing can be asked —
 * the archive cannot reach back an hour, or the station publishes no odometer at all, which is
 * every KL gauge.
 *
 * Do not collapse the three. False is evidence against the reading and null is no evidence, and a
 * gauge nobody can check keeps the benefit of the doubt. That is `sirenBacked()`'s rule, and this
 * is the same shape of question: a reading is a claim, and another field of the same payload is the
 * check on it.
 *
 * **The window is the hour the reading itself names, and that is the whole safety of this.** A real
 * burst leaves the odometer flat immediately afterwards while the rolling hour still carries the
 * total, so a flat odometer over any longer window proves nothing and would call live rain faulty.
 * Over the hour the reading claims, flat is decisive. Measured 2026-08-14: T.K.P.M SG. KELAMBU held
 * 4.5 mm for twelve hours with an odometer that never moved and a daily total of 0.
 *
 * `accWindow()` does the reading, so a sparse archive widens the window rather than failing. That
 * widening can only add rain, so it can only move the answer toward true, which is the safe way for
 * it to be wrong.
 */
function rainBacked(?float $hourly, array $odo, int $now): ?bool {
    if ($hourly === null || $hourly <= 0) return null;   // no claim, so nothing to check
    $w = accWindow($odo, $now, 3600);
    return $w === null ? null : $w[0] > 0;
}

/* A station name reduced for comparison. Comparison only — never stored, never rendered.
   The two feeds spell one place several ways: `Kg. Melayu Ampang`, `KG MELAYU AMPANG`,
   `Kg.Melayu  Ampang`. Case, punctuation and spacing carry no information here, so they go. */
function portalKey(string $name): string {
    return strtolower(preg_replace('/[^a-z0-9]/i', '', $name));
}

/* Which portal row belongs to which station this app already holds.
 *
 * Three rules, strongest first, and nothing weaker is accepted:
 *
 *   1. the national station code, which 145 of 231 rainfall stations carry on both sides
 *   2. an equal name under portalKey()
 *   3. a UNIQUE suffix — the rainfall table drops the river prefix the portal's own gazetteer
 *      carries, so `Desa Pinggiran Putra (F2)` is the tail of `Sg.Langat di Desa Pinggiran Putra
 *      (F2)`. Exactly one candidate may end with it. A suffix that fits two identifies neither.
 *
 * A NEAR NAME IS NOT EVIDENCE. 17 rainfall stations have a close name and no equal one, and they
 * keep the source they have. This is the rule CAM_FIX states from the other side: a value this app
 * invents is worse than one it can show belongs to upstream.
 *
 * TWO ROWS CAN CLAIM ONE STATION. Measured, 262 rows match 252 distinct stations, because 10 rows
 * collide — one wins on the code and another on the name. The code wins, and the loser goes in
 * `clash` rather than disappearing. A silent pick here is a reading swapped for another station's
 * reading, on a station somebody watches, with nothing to say it happened.
 *
 * Returns:
 *   hit    stationId => row index, the winner for each station
 *   used   row index => true, every row that found a home
 *   clash  [stationId, winning row, losing row], one entry per collision
 */
function portalMatch(array $rows, array $stations, string $kind): array {
    $mine = array_values(array_filter($stations, fn($s) => $s['kind'] === $kind));

    /* Three indexes, because evidence identifies a station only where it is unique on BOTH sides.
       A code two rows carry names neither of them. A code two of OUR stations carry is worse: it
       hands one station another station's rain. Both happen in the live feed. */
    $byCode = $byName = $mineByCode = [];
    foreach ($rows as $i => $r) {
        if (($r['code'] ?? '') !== '') $byCode[$r['code']][] = $i;
        $byName[portalKey($r['name'] ?? '')][] = $i;
    }
    foreach ($mine as $s) {
        if (($s['code'] ?? '') !== '') $mineByCode[$s['code']][] = $s['id'];
    }

    $cand = $clash = [];
    foreach ($mine as $s) {
        $key  = portalKey($s['name'] ?? '');
        $code = $s['code'] ?? '';

        // Rung 3. JAMBATAN S.K.C shares code 3813001 with Tanjung Malim, and taking the first row
        // gave it Tanjung Malim's rain. BATU 9 and BATU 20 share 3118104 on our own side.
        $codeRow = null;
        if ($code !== '') {
            $there = $byCode[$code] ?? [];
            $here  = $mineByCode[$code] ?? [];
            if (count($there) === 1 && count($here) === 1) $codeRow = $there[0];
            elseif ($there) $clash[] = ['code', $s['id'], $code];
        }

        /* Rung 2 is an equal name, and rung 1 is a suffix that exactly one row ends with. An
           ambiguous equal name REFUSES here. It never falls through to the suffix rule, because a
           name two rows carry proves ambiguity more strongly than a suffix proves identity. */
        $nameRow = null;
        $nameRung = 0;
        $named = $byName[$key] ?? [];
        if (count($named) === 1) {
            $nameRow = $named[0];
            $nameRung = 2;
        } elseif (count($named) > 1) {
            $clash[] = ['name', $s['id'], $key];
        } elseif ($key !== '') {
            $ends = [];
            foreach ($rows as $i => $r) {
                $rk = portalKey($r['name'] ?? '');
                if ($rk !== $key && str_ends_with($rk, $key)) $ends[] = $i;
            }
            if (count($ends) === 1) { $nameRow = $ends[0]; $nameRung = 1; }
        }

        // The code wins, and this names the row it beat rather than dropping it in silence.
        if ($codeRow !== null && $nameRow !== null && $codeRow !== $nameRow) {
            $clash[] = [$s['id'], $codeRow, $nameRow];
        }
        $row = $codeRow ?? $nameRow;
        if ($row !== null) $cand[$s['id']] = [$row, $codeRow !== null ? 3 : $nameRung];
    }

    /* A portal row is one physical gauge, so it belongs to one station. Five rows were awarded to
       two stations each before this pass. The stronger rung wins, and two equal claims identify
       neither of them. */
    $perRow = [];
    foreach ($cand as $sid => [$row, $rung]) $perRow[$row][] = [$sid, $rung];

    $hit = $used = [];
    foreach ($perRow as $row => $claims) {
        usort($claims, fn($a, $b) => $b[1] <=> $a[1]);
        if (count($claims) > 1) {
            $clash[] = ['row', $row, array_column($claims, 0)];
            if ($claims[0][1] === $claims[1][1]) continue;
        }
        $hit[$claims[0][0]] = $row;
        $used[$row] = true;
    }
    return ['hit' => $hit, 'used' => $used, 'clash' => $clash];
}

/* `php api.php --selftest` — the guards above, checked offline. Here rather than in a second test
   file: the rules are arithmetic on a few integers, and a separate test would need a third file to
   hold them. CLI only, and it exits before the first header. */
if (PHP_SAPI === 'cli' && in_array('--selftest', $argv ?? [], true)) {
    $fail = 0;
    $ok = function (string $what, bool $pass) use (&$fail) {
        if (!$pass) $fail++;
        echo ($pass ? '  ok   ' : '  FAIL ') . $what . "\n";
    };
    $now = 1800000000;

    echo "forceAllowed():\n";
    $ok('no stamp at all is allowed',            forceAllowed($now, null)[0] === true);
    $ok('a stamp 61s old is allowed',            forceAllowed($now, $now - 61)[0] === true);
    $ok('a stamp exactly 60s old is allowed',    forceAllowed($now, $now - 60)[0] === true);
    $ok('a stamp 59s old is refused',            forceAllowed($now, $now - 59)[0] === false);
    $ok('a stamp from this second is refused',   forceAllowed($now, $now)[0] === false);
    $ok('a refusal says why',                    forceAllowed($now, $now)[1] === 'rate limited');
    /* A stamp in the future would lock the button out until the clock caught up. Same hazard
       readTs() guards on a JPS reading: a clock we do not own moved. */
    $ok('a stamp from the future is allowed',    forceAllowed($now, $now + 3600)[0] === true);
    $ok('the window is honored when passed',     forceAllowed($now, $now - 10, 5)[0] === true);

    echo "\nshotFresh():\n";
    $ok('the ceiling is two capture cycles', SHOT_FRESH === 2 * SHOT_EVERY);
    $ok('a frame inside the ceiling stands', shotFresh($now - SHOT_FRESH + 60, $now) === $now - SHOT_FRESH + 60);
    $ok('a frame on the ceiling stands',     shotFresh($now - SHOT_FRESH, $now) === $now - SHOT_FRESH);
    $ok('a frame past the ceiling is 404',   shotFresh($now - SHOT_FRESH - 60, $now) === 0);
    $ok('a frame from this second stands',   shotFresh($now, $now) === $now);
    /* An empty archive is 0 already, and 0 must stay 0 rather than become "no ceiling applied".
       shotList() returning [] is what puts it there. */
    $ok('an empty archive stays 404',        shotFresh(0, $now) === 0);
    /* A stamp in the future is the same hazard forceAllowed() guards above: a clock we do not own
       moved. A frame from ahead of now is not stale, so it stands. */
    $ok('a frame from the future stands',    shotFresh($now + 3600, $now) === $now + 3600);

    echo "\npayloadEtag():\n";
    /* Two reads of one build, one second apart. The bodies differ, and the ETag must not — this is
       the assertion that keeps the 304 alive, and nothing on a live server would report its loss. */
    $b1 = '{"fetched":"x","stations":[1,2],"cacheAge":0,"tookMs":40}';
    $b2 = '{"fetched":"x","stations":[1,2],"cacheAge":287,"tookMs":40}';
    $ok('cacheAge does not move the ETag',   payloadEtag($b1) === payloadEtag($b2));
    $ok('a reading does move the ETag',
        payloadEtag($b1) !== payloadEtag('{"fetched":"x","stations":[1,3],"cacheAge":0,"tookMs":40}'));
    $ok('a rebuild moves the ETag',
        payloadEtag($b1) !== payloadEtag('{"fetched":"y","stations":[1,2],"cacheAge":0,"tookMs":40}'));
    // A body with no cacheAge at all hashes as itself, rather than failing the replace and the call.
    $ok('a body without cacheAge still hashes', payloadEtag('{"a":1}') === '"' . md5('{"a":1}') . '"');
    $ok('the ETag is quoted',                str_starts_with(payloadEtag($b1), '"'));

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

    echo "\nstationUpdated():\n";
    $seen = ['siren-7' => '01/08/2026 09:00:00'];
    $ok('a fetched siren uses its own stamp',
        stationUpdated([], ['statusLastUpdate' => 'new'], 'siren', 7, $seen) === 'new');
    $ok('an unfetched siren keeps the old one',
        stationUpdated([], [], 'siren', 7, $seen) === '01/08/2026 09:00:00');
    $ok('an unknown siren still gets null',
        stationUpdated([], [], 'siren', 99, $seen) === null);
    $ok('a camera never borrows a siren stamp',
        stationUpdated([], [], 'camera', 7, $seen) === null);
    $ok('a gauge reads its own detail first',
        stationUpdated(['statusLastUpdate' => 'fg'], [], 'gauge', 7, $seen) === 'fg');

    echo "\nportalRain():\n";
    /* The live page's own shape: an empty row, stray closing tags, then bare cell runs. A fixture
       that supplies the missing <tr> would test a page this upstream does not serve. */
    $prfFixture = "<table><tbody><tr></tr></tr></tr>"
        . "<td data-th='No'>1</td><td data-th='Station ID'>0232331RF</td>"
        . "<td>S.M.K Bandar Kinrara (F2)</td><td>Petaling</td><td>15/08/2026 00:00:00</td>"
        . "<td>0.0</td><td>0.0</td><td>2.5</td><td>0.0</td><td>0.0</td><td>7.5</td>"
        . "<td><a href='/index.php/rf-graph/?stationid=27398'>7.5</a></td>"
        . "<td class='info'>0.0</a></td></tr>"
        // A row with no code, no graph link and a -9999 hour. All three happen upstream.
        . "<td data-th='No'>2</td><td data-th='Station ID'></td>"
        . "<td>Jave Setia (F2)</td><td>Petaling</td><td>15/08/2026 00:00:00</td>"
        . "<td>0.0</td><td>0.0</td><td>0.0</td><td>0.0</td><td>0.0</td><td>5.0</td>"
        . "<td>5.0</td><td class='info'>-9,999.00</td></tr>"
        // Twelve cells. A row this shape is a layout change, and it must be dropped.
        . "<td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td>"
        . "<td>x</td><td>x</td><td>x</td><td>x</td><td>x</td><td>x</td></tr>"
        . "</tbody></table>";

    $prf = portalRain(['prf-SEL' => $prfFixture]);
    $ok('two rows survive the width guard',  count($prf) === 2);
    $ok('the code comes off data-th',        $prf[0]['code'] === '0232331RF');
    $ok('the name is cell 2',                $prf[0]['name'] === 'S.M.K Bandar Kinrara (F2)');
    $ok('the district is cell 3',            $prf[0]['district'] === 'Petaling');
    $ok('the stamp is normalised',           $prf[0]['updated'] === '15/08/2026 00:00:00');
    /* The mapping the header block gets wrong. Cell 11 is today and cell 12 is the hour. Read in
       header order they land one column left, which puts today's total under last Tuesday's date. */
    $ok('cell 11 is the day, not a daily column', $prf[0]['daily'] === 7.5);
    $ok('cell 12 is the hour',               $prf[0]['hourly'] === 0.0);
    $ok('the six daily columns are kept',    $prf[0]['days'] === [0.0, 0.0, 2.5, 0.0, 0.0, 7.5]);
    $ok('yesterday is the last of the six',  end($prf[0]['days']) === 7.5);
    $ok('the graph id comes off the link',   $prf[0]['graphId'] === 27398);
    $ok('a missing code is null',            $prf[1]['code'] === null);
    $ok('a missing graph link is null',      $prf[1]['graphId'] === null);
    $ok('-9999 is no reading',               $prf[1]['hourly'] === null);
    $ok('an empty page yields nothing',      portalRain(['prf-SEL' => '']) === []);
    /* The form the endpoint serves without its two hidden inputs. It holds a table and no row, so
       pageHasData() lets it through and the parser has to answer for it. */
    $ok('a form page yields nothing',        portalRain(['prf-SEL' => '<table><tbody></tbody></table>']) === []);

    echo "\nportalRainUrls():\n";
    $ok('three states, three keys',          array_keys(portalRainUrls()) === ['prf-SEL', 'prf-WLH', 'prf-PTJ']);
    $ok('the hidden inputs ride in the url', str_contains(portalRainUrls()['prf-SEL'], 'loginStatus=0&language=1'));

    echo "\naccWindow():\n";
    $odo = [[$now - 80 * 3600, 1000.0], [$now - 72 * 3600, 1010.0],
            [$now - 24 * 3600, 1050.0], [$now, 1080.0]];
    $ok('24h is the difference over 24h',   accWindow($odo, $now, 24 * 3600) === [30.0, 24.0, false]);
    $ok('72h is the difference over 72h',   accWindow($odo, $now, 72 * 3600) === [70.0, 72.0, false]);
    /* The point of the odometer. The baseline is 30 hours back rather than 24, and the answer says
       so instead of claiming a 24 hour figure it does not have. A WIDER window is not a short one:
       the far end is covered, so this keeps one asterisk. */
    $ok('a stale baseline reports its real span',
        accWindow([[$now - 30 * 3600, 1000.0], [$now, 1012.0]], $now, 24 * 3600) === [12.0, 30.0, false]);
    $ok('no baseline in range gives null',
        accWindow([[$now - 2 * 3600, 1000.0], [$now, 1005.0]], $now, 24 * 3600) === null);
    /* A year-to-date total resets on 1 January. Publishing the negative would draw a bar backwards
       and poison a reader's idea of a wet week. */
    $ok('a reset gives null, never a negative',
        accWindow([[$now - 25 * 3600, 2400.0], [$now, 12.0]], $now, 24 * 3600) === null);
    $ok('one sample cannot answer',
        accWindow([[$now - 25 * 3600, 1000.0]], $now, 24 * 3600) === null);
    $ok('an empty archive gives null',      accWindow([], $now, 24 * 3600) === null);
    /* A genuinely dry day is 0 mm and must not be confused with an unanswerable window. The chart
       draws a zero bar for one and an em dash for the other. */
    $ok('a dry window is zero, not null',
        accWindow([[$now - 25 * 3600, 1000.0], [$now, 1000.0]], $now, 24 * 3600) === [0.0, 25.0, false]);

    /* The short answer. A young archive reaches 20.9 h and the 24 h window is asked for. Measuring
       what there is beats an em dash for the two days it takes to fill, as long as the answer says
       how far it really reached. */
    $young = [[$now - 20.9 * 3600, 1000.0], [$now, 1006.5]];
    $ok('a short window is refused by default',
        accWindow($young, $now, 24 * 3600) === null);
    $ok('a short window answers when the caller allows it',
        accWindow($young, $now, 24 * 3600, true) === [6.5, 20.9, true]);
    /* rainBacked() passes no flag, so it can never be handed a window narrower than the hour it asks
       about. A 20 minute window showing no rise is no evidence that an hour of rain is faulty. */
    $ok('rainBacked cannot draw a short window',
        accWindow([[$now - 1200, 1000.0], [$now, 1000.0]], $now, 3600) === null);
    // The short path obeys the reset guard and the one-sample guard the full path already obeys.
    $ok('a short window still refuses a reset',
        accWindow([[$now - 20 * 3600, 2400.0], [$now, 12.0]], $now, 24 * 3600, true) === null);
    $ok('a short window still needs two samples',
        accWindow([[$now - 20 * 3600, 1000.0]], $now, 24 * 3600, true) === null);

    /* Both long windows anchor to the earliest record, and BOTH publish it. An archive 23 h deep
       answers 24 h and 72 h with one 23 h difference, each marked short. An earlier version dropped
       the longer of the pair. These two assertions are what stops it coming back. */
    $reach23 = [[$now - 23 * 3600, 1000.0], [$now, 1006.5]];
    $ok('23h of records answers the 24h window',
        accWindow($reach23, $now, 24 * 3600, true) === [6.5, 23.0, true]);
    $ok('and answers the 72h window with the same span',
        accWindow($reach23, $now, 72 * 3600, true) === [6.5, 23.0, true]);
    /* A WIDENED window is not a short one, so the pair can carry different marks over one number.
       PUNCAK ATHENEUM holds 27 h: its 24 h window covers more ground than it names and keeps one
       asterisk, and its 72 h window covers less and takes two. */
    $reach27 = [[$now - 27 * 3600, 1000.0], [$now, 1006.5]];
    $ok('a 27h archive covers the 24h window whole',
        accWindow($reach27, $now, 24 * 3600, true) === [6.5, 27.0, false]);
    $ok('and falls short on the 72h window',
        accWindow($reach27, $now, 72 * 3600, true) === [6.5, 27.0, true]);

    echo "\naccHours():\n";
    $h3 = [[$now - 2 * 3600, 4.0], [$now - 3600, 6.0], [$now, 2.0]];
    $ok('three whole hours add up',         accHours($h3, $now, 3) === 12.0);
    /* The reason KL's 3 hour bar can go blank. Two hours of rain plus one hour of silence is not a
       3 hour total, and reporting it as one would call a gap dry. */
    $ok('a missing hour gives null',
        accHours([[$now - 2 * 3600, 4.0], [$now, 2.0]], $now, 3) === null);
    $ok('an empty history gives null',      accHours([], $now, 3) === null);
    $ok('the newest reading in an hour wins',
        accHours([[$now - 2 * 3600, 4.0], [$now - 3600, 6.0], [$now - 3000, 9.0], [$now, 2.0]],
                 $now, 3) === 15.0);
    $ok('three dry hours are zero, not null',
        accHours([[$now - 2 * 3600, 0.0], [$now - 3600, 0.0], [$now, 0.0]], $now, 3) === 0.0);

    echo "\nrainBacked():\n";
    // The odometer climbed 4.5 mm across the hour the gauge is claiming. The reading stands.
    $rose = [[$now - 2 * 3600, 680.5], [$now - 1800, 685.0], [$now, 685.0]];
    $ok('a reading the odometer confirms is backed', rainBacked(4.5, $rose, $now) === true);
    /* The measured fault. The gauge claims 4.5 mm in the last hour and its own total has not moved
       across that hour, so the claim has no rain behind it. */
    $flat = [[$now - 12 * 3600, 685.0], [$now - 3600, 685.0], [$now, 685.0]];
    $ok('a reading the odometer denies is not backed', rainBacked(4.5, $flat, $now) === false);
    /* Benefit of the doubt, the same rule sirenBacked() obeys. A gauge nobody can check is not a
       gauge caught lying, and these three cases are every KL station plus a young archive. */
    $ok('no odometer at all cannot be asked',   rainBacked(4.5, [], $now) === null);
    $ok('an archive too young cannot be asked',
        rainBacked(4.5, [[$now - 600, 685.0], [$now, 685.0]], $now) === null);
    $ok('an odometer reset cannot be asked',
        rainBacked(4.5, [[$now - 2 * 3600, 2400.0], [$now, 4.5]], $now) === null);
    // A gauge claiming nothing is not making a claim, so there is nothing to back or to deny.
    $ok('a dry gauge is never marked faulty',   rainBacked(0.0, $flat, $now) === null);
    $ok('a gauge with no reading is not asked', rainBacked(null, $flat, $now) === null);
    /* The reason the window is the hour the reading names and not a longer one. Rain fell 40
       minutes ago and stopped, so the odometer is flat right now while the rolling hour still
       carries the total. A longer window would call this live rain faulty. */
    $burst = [[$now - 2 * 3600, 680.5], [$now - 2400, 685.0], [$now - 600, 685.0], [$now, 685.0]];
    $ok('a burst that has stopped is still backed', rainBacked(4.5, $burst, $now) === true);

    echo "\nportalKey():\n";
    $ok('case and punctuation go',    portalKey('S.M.K Bandar Kinrara (F2)') === 'smkbandarkinraraf2');
    $ok('spacing goes',               portalKey('  Kg.  Melayu   Ampang ') === 'kgmelayuampang');
    $ok('two spellings meet',         portalKey('Sg. Klang') === portalKey('SG KLANG'));

    echo "\nportalMatch():\n";
    $stations = [
        ['id' => 'rf-1', 'kind' => 'rainfall', 'code' => '0232331RF', 'name' => 'Bandar Kinrara'],
        ['id' => 'rf-2', 'kind' => 'rainfall', 'code' => null,        'name' => 'Kg Melayu Ampang'],
        ['id' => 'rf-3', 'kind' => 'rainfall', 'code' => null,        'name' => 'Desa Pinggiran Putra (F2)'],
        ['id' => 'rf-4', 'kind' => 'rainfall', 'code' => null,        'name' => 'Taman Sri Muda'],
        ['id' => 'wl-9', 'kind' => 'river',    'code' => '0232331RF', 'name' => 'Bandar Kinrara'],
    ];
    $rows = [
        0 => ['code' => '0232331RF', 'name' => 'Anything At All'],
        1 => ['code' => null,        'name' => 'KG. MELAYU AMPANG'],
        2 => ['code' => null,        'name' => 'Sg.Langat di Desa Pinggiran Putra (F2)'],
        3 => ['code' => null,        'name' => 'Taman Sri Mudah'],
    ];
    $m = portalMatch($rows, $stations, 'rainfall');
    $ok('a code beats a name',            $m['hit']['rf-1'] === 0);
    $ok('an equal name joins',            $m['hit']['rf-2'] === 1);
    $ok('a unique suffix joins',          $m['hit']['rf-3'] === 2);
    $ok('a near name never joins',        !isset($m['hit']['rf-4']));
    $ok('a river is not matched here',    !isset($m['hit']['wl-9']));
    $ok('used names every joined row',    $m['used'] === [0 => true, 1 => true, 2 => true]);
    $ok('nothing clashes here',           $m['clash'] === []);

    /* The collision the accounting found: 262 rows match 252 stations, so 10 rows claim a station
       another row already took. The code match wins and the loser is logged. */
    $clashRows = [
        0 => ['code' => '0232331RF', 'name' => 'Somewhere Else'],
        1 => ['code' => null,        'name' => 'Bandar Kinrara'],
    ];
    $c = portalMatch($clashRows, $stations, 'rainfall');
    $ok('the code row wins a collision',  $c['hit']['rf-1'] === 0);
    $ok('the name row is not used',       !isset($c['used'][1]));
    $ok('the collision is logged',        $c['clash'] === [['rf-1', 0, 1]]);

    /* Two gazetteer-style names both ending in one suffix. Neither may join: a suffix that fits two
       candidates identifies nothing, and picking either invents a fact. */
    $twoWay = [
        ['id' => 'rf-5', 'kind' => 'rainfall', 'code' => null, 'name' => 'Kuala Lumpur'],
    ];
    $ambiguous = [
        0 => ['code' => null, 'name' => 'Sg. Klang di Kuala Lumpur'],
        1 => ['code' => null, 'name' => 'Sg. Gombak di Kuala Lumpur'],
    ];
    $a = portalMatch($ambiguous, $twoWay, 'rainfall');
    $ok('an ambiguous suffix joins nothing', $a['hit'] === []);

    /* A code two rows carry identifies neither of them, and the name rule gets its chance instead.
       JAMBATAN S.K.C reached its own row this way once the code stopped outranking it. */
    $dupCode = [
        0 => ['code' => '3813001', 'name' => 'Tanjung Malim'],
        1 => ['code' => '3813001', 'name' => 'Jambatan SKC'],
    ];
    $d = portalMatch($dupCode, [
        ['id' => 'rf-201', 'kind' => 'rainfall', 'code' => '3813001', 'name' => 'JAMBATAN S.K.C'],
    ], 'rainfall');
    $ok('a code on two rows falls to the name', $d['hit']['rf-201'] === 1);

    /* A code two of OUR stations carry identifies neither. BATU 9 took BATU 20's rain this way. */
    $shared = [0 => ['code' => '3118104', 'name' => 'Batu 20']];
    $sh = portalMatch($shared, [
        ['id' => 'rf-230', 'kind' => 'rainfall', 'code' => '3118104', 'name' => 'BATU 9, HULU LANGAT'],
        ['id' => 'rf-236', 'kind' => 'rainfall', 'code' => '3118104', 'name' => 'BATU 20, HULU LANGAT'],
    ], 'rainfall');
    $ok('a code on two of ours joins neither',  $sh['hit'] === []);

    /* One row, two stations, one of them holding the stronger rung. The row is one gauge. */
    $one = [0 => ['code' => 'X1', 'name' => 'Bukit Fraser']];
    $o = portalMatch($one, [
        ['id' => 'rf-212', 'kind' => 'rainfall', 'code' => 'X1',  'name' => 'SOMEWHERE ELSE'],
        ['id' => 'rf-939', 'kind' => 'rainfall', 'code' => null,  'name' => 'Bukit Fraser'],
    ], 'rainfall');
    $ok('one row goes to the stronger claim',   $o['hit'] === ['rf-212' => 0]);

    /* Two equal claims on one row identify neither, and the row stays unclaimed. */
    $tie = [0 => ['code' => null, 'name' => 'Jenderam Hulu']];
    $t = portalMatch($tie, [
        ['id' => 'rf-260', 'kind' => 'rainfall', 'code' => null, 'name' => 'Jenderam Hulu'],
        ['id' => 'rf-832', 'kind' => 'rainfall', 'code' => null, 'name' => 'Jenderam Hulu'],
    ], 'rainfall');
    $ok('two equal claims identify neither',    $t['hit'] === []);

    echo "\nserveFromCache():\n";
    $ok('a fresh cache is served',                 serveFromCache(10, true, false) === true);
    $ok('a force rebuilds a fresh cache',          serveFromCache(10, true, true) === false);
    $ok('a force that lost the lock is served',    serveFromCache(10, false, true) === true);
    $ok('a stale cache rebuilds',                  serveFromCache(TTL + 1, true, false) === false);
    $ok('a cache at exactly TTL rebuilds',         serveFromCache(TTL, true, false) === false);
    $ok('a stale cache that lost the lock waits',  serveFromCache(TTL + 1, false, false) === true);
    $ok('a forced loser never rebuilds',           serveFromCache(TTL + 1, false, true) === true);

    echo "\npageRow():\n";
    $ok('a page that answered is stored',          pageRow(true, 'new', 'old') === [true, 'new']);
    $ok('a page that failed is stamped, old copy', pageRow(true, '', 'old') === [true, 'old']);
    $ok('a first fetch that failed is stamped',    pageRow(true, '', '') === [true, '']);
    $ok('an unasked page is never stamped',        pageRow(false, '', 'old')[0] === false);

    echo "\npageHasData():\n";
    $ok('a table page is data',          pageHasData('nat-SEL', "<table><tr class='item'><td>1</td></tr>") === true);
    // The 320-byte Notis Gangguan the national portal serves under HTTP 200 while it is down.
    $ok('a notice page is not data',     pageHasData('nat-SEL', '<html><title>Notis Gangguan</title></html>') === false);
    $ok('an empty body is not data',     pageHasData('nat-SEL', '') === false);
    $ok('valid JSON is data',            pageHasData('met-warn', '[{"a":1}]') === true);
    $ok('an empty JSON list is data',    pageHasData('met-day', '[]') === true);
    $ok('a notice is not JSON',          pageHasData('met-day', '<html>Notis Gangguan</html>') === false);
    $ok('the nowcast map is data',       pageHasData('met-now', '<script>map.setView([3,101],8)</script>') === true);
    // A quiet nowcast publishes the map and no markers. That is weather, not an outage.
    $ok('a nowcast with no markers is data', pageHasData('met-now', 'map.setView([3,101],8)') === true);
    $ok('a nowcast notice is not data',  pageHasData('met-now', '<html>Notis Gangguan</html>') === false);

    echo "\npageHasData() on the portal pages:\n";
    $ok('a portal page with a row passes',   pageHasData('prf-SEL', "<td data-th='No'>1</td>") === true);
    $ok('a portal form page fails',          pageHasData('prf-SEL', "<table><tr><th>No.</th></tr></table>") === false);
    $ok('an empty body fails',               pageHasData('prf-SEL', '') === false);
    $ok('the other tables keep the tr test',  pageHasData('nat-SEL', "<tr class='item'>") === true);

    echo "\nnoticeOf():\n";
    $ok('the notice page returns its id',  noticeOf('<html><title> Notis Gangguan </title><body></body></html>') === 'publicinfobanjir');
    $ok('a real table is not a notice',    noticeOf("<table><tr class='item'><td>1</td></tr></table>") === null);
    $ok('an empty body is not a notice',   noticeOf('') === null);
    // The match is on the title, not on the body. A table that happens to print the words in a cell
    // is still a table, and treating it as an outage would take a working feed off the map.
    $ok('the words in body text do not match', noticeOf('<html><title>Aras Air</title><body>Notis Gangguan</body></html>') === null);
    $ok('case and spacing do not matter',  noticeOf('<TITLE>notis   gangguan</TITLE>') === 'publicinfobanjir');

    echo "\nnoticeRow():\n";
    /* The first two are the whole point of the memory. Two rebuilds in three refetch no page, and on
       those the banner has to stand on what the last fetch found. */
    $ok('an unasked page keeps the memory',   noticeRow(false, 'publicinfobanjir') === 'keep');
    $ok('an unasked clean page keeps it too', noticeRow(false, null) === 'keep');
    $ok('a fetched notice is remembered',     noticeRow(true, 'publicinfobanjir') === 'set');
    $ok('a fetched page with no notice ends it', noticeRow(true, null) === 'clear');

    echo "\nplaceQuery():\n";
    $ok('a plain query normalizes',    placeQuery('Bandar Utama') === 'bandar utama');
    $ok('runs of space collapse',      placeQuery("  kg.   sg   lui \n") === 'kg. sg lui');
    $ok('one character is refused',    placeQuery('a') === null);
    $ok('two characters are allowed',  placeQuery('pj') === 'pj');
    $ok('whitespace only is refused',  placeQuery("   \t ") === null);
    $ok('80 characters are allowed',   placeQuery(str_repeat('a', 80)) === str_repeat('a', 80));
    $ok('81 characters are refused',   placeQuery(str_repeat('a', 81)) === null);

    echo "\nplaceParam():\n";
    $ok('a plain string passes through',  placeParam('kg lui') === 'kg lui');
    // ?place[]=x makes $_GET['place'] an array. (string) on that is a silent-looking "Array" that
    // would clear placeQuery()'s length check; placeParam() must refuse it outright instead.
    $ok('an array becomes empty string',  placeParam(['x']) === '');
    $ok('null becomes empty string',      placeParam(null) === '');
    $ok('empty string stays refused',     placeQuery(placeParam([])) === null);

    /* The bug is not the return value — the accidental path already returns null. It is that the
       call *emits* a deprecation, and `?place=` sets Content-Type: application/json first. One
       notice ahead of the body gives the client a parse error, so this counts diagnostics, not
       answers. An error handler rather than ob_start(): buffering sees the notice only while
       display_errors is on, so that check would pass on a box configured otherwise. */
    $notices = 0;
    set_error_handler(function ($no) use (&$notices) { $notices++; return true; });
    $bad = placeQuery("bandar \xB1\x31 utama");
    restore_error_handler();
    $ok('invalid UTF-8 is refused',       $bad === null);
    $ok('invalid UTF-8 raises no notice', $notices === 0);

    /* The place lookup reuses forceAllowed(): same arithmetic on the same two integers, with its
       own stamp file and window. A second copy is a second thing to get wrong. */
    echo "\nplace rate limit:\n";
    $ok('a lookup one second later is allowed',
        forceAllowed($now, $now - 1, PLACE_EVERY)[0] === true);
    $ok('a second lookup in one second is refused',
        forceAllowed($now, $now, PLACE_EVERY)[0] === false);

    /* sirenBacked() decides whether a sounding siren is believed, and a wrong answer is silent both
       ways: too strict and a real evacuation alarm never reaches the panel, too loose and the app
       bar sits red for days on a stuck relay. The coordinates are real — SIREN PEKAN BANTING and
       its only river 4.26 km off, and KG. MELAYU SUBANG, the 127-hour alarm this rule was for. */
    echo "\nsirenBacked():\n";
    [$slat, $slng] = [2.811543, 101.508659];        // SIREN PEKAN BANTING
    $near = [1.68, 2.7];                            // KG. SG. MANGGIS: level, Amaran mark
    $ok('no rivers in reach is unknown, not refused',
        sirenBacked($slat, $slng, []) === null);
    $ok('a river 4.3 km off below Amaran refuses',
        sirenBacked($slat, $slng, [[2.849, 101.531, 0]]) === false);
    $ok('the same river at Amaran backs it',
        sirenBacked($slat, $slng, [[2.849, 101.531, 2]]) === true);
    $ok('Bahaya backs it too',
        sirenBacked($slat, $slng, [[2.849, 101.531, 3]]) === true);
    // Status 1 is Siaga, one mark below the level JPS says makes a siren sound.
    $ok('Siaga alone does not back it',
        sirenBacked($slat, $slng, [[2.849, 101.531, 1]]) === false);
    $ok('one river up among quiet ones backs it',
        sirenBacked($slat, $slng, [[2.849, 101.531, 0], [2.80, 101.50, 3]]) === true);
    // A flooding river on the other side of the state says nothing about this siren.
    $ok('a river past SIREN_KM is not asked',
        sirenBacked($slat, $slng, [[3.20, 101.70, 3]]) === null);
    $ok('a far flood cannot back a near refusal',
        sirenBacked($slat, $slng, [[2.849, 101.531, 0], [3.20, 101.70, 3]]) === false);

    /* camFix() overrides a coordinate the feed publishes, which is the one thing in this file that
       makes the map disagree with its source on purpose. Both directions have to hold: it must move
       a camera JPS has in the wrong state, and it must get out of the way the moment JPS is right.
       The numbers are the real ones — camera 1279 is Kolam Sg Kayu Ara, published in Sepang. */
    echo "\ncamFix():\n";
    [$plat, $plng] = [2.8272222, 101.6567808];      // what the feed publishes for 1279
    [$tlat, $tlng] = CAM_FIX[1279];                 // where Kayu Ara is
    $ok('a shuffled camera is moved to the corrected point',
        camFix('camera', 1279, $plat, $plng) === [$tlat, $tlng]);
    $ok('a camera not in the table is left alone',
        camFix('camera', 1269, $plat, $plng) === [$plat, $plng]);
    // The table is keyed by camera id, and every kind has its own id space — siren 1279 is a siren.
    $ok('another kind sharing the id is left alone',
        camFix('siren', 1279, $plat, $plng) === [$plat, $plng]);
    $ok('the table retires itself once the feed agrees',
        camFix('camera', 1279, $tlat, $tlng) === [$tlat, $tlng]);
    // Just inside CAM_FIX_KM: close enough that JPS is describing the same place, so the feed wins.
    $ok('a small disagreement defers to the feed',
        camFix('camera', 1279, $tlat + 0.01, $tlng) === [$tlat + 0.01, $tlng]);
    $ok('a large disagreement does not',
        camFix('camera', 1279, $tlat + 0.05, $tlng) === [$tlat, $tlng]);
    // Every entry must be inside the coverage box, or a typo would park a camera in another country.
    foreach (CAM_FIX as $id => [$flat, $flng]) {
        $ok("camera $id lands inside the coverage box",
            $flat >= BOX[3] && $flat <= BOX[1] && $flng >= BOX[0] && $flng <= BOX[2]);
    }

    /* The nowcast page bakes its data into L.marker() calls, so the parser is the only contract we
       have with it. A wording change must drop the marker, not read as clear weather — that is what
       the -1 rung is for, and what makes met.parsed fall when MET moves something. */
    echo "\nmetRung():\n";
    $ok('tiada hujan is clear',        metRung('Tiada Hujan') === 0);
    $ok('hujan is rain',               metRung('Hujan') === 1);
    $ok('hujan lebat is heavy',        metRung('Hujan Lebat') === 2);
    $ok('case does not matter',        metRung('  tiada   hujan ') === 0);
    $ok('the parser refuses an unknown word',  metRung('Ribut Petir') === -1);

    echo "\nmetClock():\n";
    $ok('an afternoon time converts',  metClock('03:10 PM') === '15:10');
    $ok('a morning time converts',     metClock('09:40 AM') === '09:40');
    $ok('noon converts',               metClock('12:10 PM') === '12:10');
    $ok('midnight converts',           metClock('12:40 AM') === '00:40');
    $ok('the parser refuses rubbish',  metClock('later') === null);

    echo "\nmetPoints():\n";
    $mk = fn(string $name, string $now, array $six) =>
        "lov[1] = L.marker([3.10220, 101.64480], {icon: cerahIcon}).addTo(mymap).bindPopup('"
        . "<span class=\"font-bold\">$name</span><br /><br /><span class=\"cuaca\">Sekarang: $now</span>"
        . "<br /><br /><span class=\"cuaca2\">Ramalan pada: <br />"
        . implode('', array_map(
            fn($v, $i) => '<span class="cuaca2">' . sprintf('%02d:10 PM', 3 + $i) . ": $v</span><br />",
            $six, array_keys($six)))
        . "<br /> <small>Tarikh kemaskini : 11/08/2026 02:40 PM</small>');";

    $one = metPoints($mk('Petaling Jaya', 'Tiada Hujan',
        ['Hujan', 'Hujan', 'Hujan Lebat', 'Tiada Hujan', 'Tiada Hujan', 'Tiada Hujan']));
    $ok('one marker parses',        count($one) === 1);
    $ok('the name comes through',   ($one[0]['name'] ?? '') === 'Petaling Jaya');
    $ok('the coordinate parses',    abs(($one[0]['lat'] ?? 0) - 3.1022) < 1e-6);
    $ok('seven rungs come out',     count($one[0]['rungs'] ?? []) === 7);
    $ok('now carries the first rung',  ($one[0]['rungs'][0] ?? -9) === 0);
    $ok('the parser reads heavy rain',   ($one[0]['rungs'][3] ?? -9) === 2);
    $ok('the parser reads 24 hour clocks',  ($one[0]['clocks'][1] ?? '') === '15:10');
    $ok('now carries no clock',     array_key_exists(0, $one[0]['clocks'] ?? [])
                                    && $one[0]['clocks'][0] === null);
    $ok('the stamp is a unix time', ($one[0]['stamp'] ?? 0) > 1000000000);

    /* A marker MET words differently must vanish, so the counter falls and somebody looks. */
    $bad = metPoints($mk('Nowhere', 'Ribut Petir',
        ['Hujan', 'Hujan', 'Hujan', 'Hujan', 'Hujan', 'Hujan']));
    $ok('an unreadable rung drops the marker', $bad === []);
    $ok('an empty page parses to nothing',     metPoints('') === []);

    /* The card sentence reads its two facts from the span. This is the one piece of logic here that
       can go quietly wrong. It runs first-to-last, not first-unbroken-run: 17 of 137 wet markers on
       one live page held the worst rung in more than one block, and reporting only the first block
       hides a return of the rain. */
    echo "\nmetSpan():\n";
    $ck = [null, '15:10', '15:40', '16:10', '16:40', '17:10', '17:40'];

    $ok('all clear says nothing',
        metSpan([0, 0, 0, 0, 0, 0, 0], $ck) === null);

    $a = metSpan([0, 0, 0, 2, 2, 0, 0], $ck);
    $ok('a later block reports its start',   $a['from'] === '16:10');
    $ok('and the first dry step after it',   $a['to'] === '17:10');
    $ok('and remains closed',                $a['open'] === false);
    $ok('and carries the worst rung',        $a['rung'] === 2);
    $ok('and the rung now',                  $a['now'] === 0);
    $ok('and the rung one hour out',         $a['hr1'] === 0);

    $b = metSpan([2, 2, 0, 0, 0, 0, 0], $ck);
    $ok('rain now carries no start',         $b['from'] === null);
    $ok('and ends at the first dry step',    $b['to'] === '15:40');

    $c = metSpan([2, 2, 2, 2, 2, 2, 2], $ck);
    $ok('rain to the last step remains open',  $c['open'] === true);
    $ok('and reports the final clock',       $c['to'] === '17:40');
    $ok('and still carries no start',        $c['from'] === null);

    /* The broken pattern. Rain at 16:10, dry at 16:40, raining again and still raining at the end. */
    $d = metSpan([0, 0, 0, 1, 0, 1, 1], $ck);
    $ok('a broken block spans first to last', $d['from'] === '16:10');
    $ok('and stays open past the window',     $d['open'] === true);
    $ok('and reports the final clock',        $d['to'] === '17:40');

    /* hr1 is step index 2, which is one hour out, and it is its own column on the card. */
    $e = metSpan([0, 0, 1, 2, 2, 0, 0], $ck);
    $ok('hr1 reads step index 2',            $e['hr1'] === 1);
    $ok('and does not change the worst rung', $e['rung'] === 2);

    /* The forecast call answers for three tiers of place. Only the district tier joins to a station,
       because api.php already normalizes `district`. A state row named "Selangor" otherwise
       overwrites a district of the same name on a day from another feed. */
    echo "\nmetDaily():\n";
    $rows = json_encode([
        ['location' => ['location_id' => 'Ds057', 'location_name' => 'Petaling'],
         'min_temp' => 24, 'max_temp' => 34],
        ['location' => ['location_id' => 'St008', 'location_name' => 'Selangor'],
         'min_temp' => 20, 'max_temp' => 40],
        ['location' => ['location_id' => 'Tn066', 'location_name' => 'Pelabuhan Klang'],
         'min_temp' => 21, 'max_temp' => 41],
        ['location' => ['location_id' => 'Ds058', 'location_name' => 'Kuala Lumpur'],
         'min_temp' => 25, 'max_temp' => 33],
    ]);
    $day = metDaily($rows);
    $ok('the parser keeps district rows',   isset($day['petaling']));
    $ok('the key comes back lowercase',     ($day['petaling']['tmax'] ?? 0) === 34);
    $ok('the minimum comes through',        ($day['petaling']['tmin'] ?? 0) === 24);
    $ok('the parser keeps a second district', ($day['kuala lumpur']['tmax'] ?? 0) === 33);
    $ok('the parser drops state rows',      !isset($day['selangor']));
    $ok('the parser drops town rows',       !isset($day['pelabuhan klang']));
    $ok('two districts come back in all',   count($day) === 2);
    $ok('rubbish parses to nothing',        metDaily('not json') === []);
    $ok('an empty body parses to nothing',  metDaily('') === []);

    /* The radius is the whole claim. A point inside it speaks for the station, a point outside it
       says nothing at all, and no station takes a value from a point it cannot reach. */
    echo "\nmetNearest():\n";
    $pts = [
        ['name' => 'Shah Alam',   'lat' => 3.0719, 'lng' => 101.5170],
        ['name' => 'Kuala Lumpur','lat' => 3.1593, 'lng' => 101.7114],
    ];
    // TAMAN SRI MUDA, 3.037984 / 101.534493 — about 4 km from Shah Alam.
    $near = metNearest(3.037984, 101.534493, $pts);
    $ok('the nearer point wins',       ($near[0]['name'] ?? '') === 'Shah Alam');
    $ok('the distance comes back',     $near[1] > 3.0 && $near[1] < 5.0);

    // F.D.C SEKINCHAN, 3.5 / 101.1 — far outside MET_KM of either point.
    $ok('a point out of reach gets nothing', metNearest(3.5, 101.1, $pts) === null);
    $ok('an empty list gets nothing',        metNearest(3.0379, 101.5344, []) === null);

    /* The warning feed publishes no location at all. This test dates from one live fetch. Every
       live row that day named waters near Phuket and Samui: real weather, and useless on this
       map. So the kind filter works as an exclude list. An include list drops a warning MET
       rewords. A dropped flood warning is the one failure this test must catch. */
    echo "\nmetWarnings():\n";
    $wnow = 1786400000;
    $row = fn(string $title, string $text, int $from, int $to) => [
        'warning_issue' => ['title_en' => $title, 'issued' => ''],
        'valid_from' => date('Y-m-d\TH:i:s', $from),
        'valid_to'   => date('Y-m-d\TH:i:s', $to),
        'heading_en' => $title, 'text_en' => $text,
    ];
    $rain = $row('Thunderstorms Warning', 'Thunderstorms over Selangor', $wnow - 60, $wnow + 3600);
    $sea  = $row('Third Category Warning on Strong Winds and Rough Seas',
                 'Waves over the waters of Phuket', $wnow - 60, $wnow + 3600);
    $old  = $row('Thunderstorms Warning', 'Yesterday', $wnow - 7200, $wnow - 3600);
    $soon = $row('Thunderstorms Warning', 'Tomorrow', $wnow + 3600, $wnow + 7200);

    $w = metWarnings(json_encode([$rain, $sea, $old, $soon]), $wnow);
    $ok('a live rain warning survives',    count($w) === 1);
    $ok('and it carries its text',         ($w[0]['text'] ?? '') === 'Thunderstorms over Selangor');
    $ok('the parser drops a far sea warning', !array_filter($w, fn($x) => str_contains($x['text'], 'Phuket')));
    $ok('the parser drops an expired row', !array_filter($w, fn($x) => $x['text'] === 'Yesterday'));
    $ok('the parser drops a future row',   !array_filter($w, fn($x) => $x['text'] === 'Tomorrow'));

    /* The Straits of Melaka is the Selangor coast. Port Klang stands on it, so a marine warning
       naming those straits stays, and one naming only distant water drops.
       These four assertions replace two that asserted the opposite. They used
       "Northern Straits of Melaka and Samui" as the row that belongs here, and it does not: that
       water is off Kedah, Penang and Thailand, about 300 km from Port Klang. The straits run about
       800 km, so the name alone does not place a row on our stretch of them. The bug was written
       into the test that was meant to catch it, which is why the far case now has a test of its
       own in both languages. */
    $near = $row('Third Category Warning on Strong Winds and Rough Seas',
                 'Waves over the waters of Straits of Melaka', $wnow - 60, $wnow + 3600);
    $far  = $row('Third Category Warning on Strong Winds and Rough Seas',
                 'Waves over the waters of Northern Straits of Melaka and Samui',
                 $wnow - 60, $wnow + 3600);
    $nearBm = $row('Amaran Angin Kencang dan Laut Bergelora', '', $wnow - 60, $wnow + 3600);
    $nearBm['text_bm'] = 'Ombak di perairan Selat Melaka';
    $farBm  = $row('Amaran Angin Kencang dan Laut Bergelora', '', $wnow - 60, $wnow + 3600);
    $farBm['text_bm'] = 'Ombak di perairan Utara Selat Melaka';

    /* Both stretches at once. Cutting the far name out rather than testing for it is what keeps
       this row: the central mention still answers after the northern one is gone. */
    $both = $row('Third Category Warning on Strong Winds and Rough Seas',
                 'Waves over the waters of Northern Straits of Melaka and Central Straits of Melaka',
                 $wnow - 60, $wnow + 3600);

    /* MET files a storm over water as "Warning on Thunderstorms", the same words it uses over
       land, so the heading cannot say which it is. The text can: it names the waters. */
    $wet = $row('Warning on Thunderstorms',
                'Thunderstorms over the waters of Selangor', $wnow - 60, $wnow + 3600);

    $ok('a Straits of Melaka sea warning stays',
        count(metWarnings(json_encode([$near]), $wnow)) === 1);
    $ok('the Malay wording matches too',
        count(metWarnings(json_encode([$nearBm]), $wnow)) === 1);
    $ok('the northern straits are not our straits',
        metWarnings(json_encode([$far]), $wnow) === []);
    $ok('the Malay northern wording drops too',
        metWarnings(json_encode([$farBm]), $wnow) === []);
    $ok('a row naming both stretches stays',
        count(metWarnings(json_encode([$both]), $wnow)) === 1);
    $ok('a storm over our waters is not judged as land',
        count(metWarnings(json_encode([$wet]), $wnow)) === 1);
    $ok('a sea warning for other waters still drops',
        metWarnings(json_encode([$sea]), $wnow) === []);

    /* The row's own heading, never the bulletin it arrived in. One bulletin carries rows of
       different severities: five rows of one live sample all read "Third Category Warning on
       Strong Winds and Rough Seas" while their own headings read Third Category, Second Category,
       First Category, and twice a thunderstorm warning. Printing the bulletin title states a
       severity MET did not give this row. */
    $mixed = $row('Bulletin title', 'Thunderstorms over Selangor', $wnow - 60, $wnow + 3600);
    $mixed['heading_en'] = 'Warning on Strong Wind and Rough Seas (First Category)';
    $ok('the row heading wins over the bulletin title',
        metWarnings(json_encode([$mixed]), $wnow)[0]['title']
            === 'Warning on Strong Wind and Rough Seas (First Category)');

    /* A row with no heading still needs a name, so the bulletin title is the fallback. */
    $noHead = $row('Bulletin title', 'Thunderstorms over Selangor', $wnow - 60, $wnow + 3600);
    $noHead['heading_en'] = '';
    $ok('the bulletin title is the fallback',
        metWarnings(json_encode([$noHead]), $wnow)[0]['title'] === 'Bulletin title');

    /* `fresh` gates the ticker and nothing else. A warning stays listed for its whole validity and
       stops interrupting after WARN_FRESH. Both halves need a test: one wrong edit either drops a
       live warning from the panel, or leaves a three-day advisory scrolling for three days. */
    $new = $row('Thunderstorms Warning', 'Storms over Selangor', $wnow - 60, $wnow + 86400);
    $old2 = $row('Thunderstorms Warning', 'Storms over Selangor',
                 $wnow - WARN_FRESH - 60, $wnow + 86400);
    $ok('a new warning is fresh',        metWarnings(json_encode([$new]),  $wnow)[0]['fresh'] === true);
    $ok('an old warning is still listed', count(metWarnings(json_encode([$old2]), $wnow)) === 1);
    $ok('an old warning stops being fresh',
        metWarnings(json_encode([$old2]), $wnow)[0]['fresh'] === false);
    $ok('fresh is measured from validity, not from now',
        metWarnings(json_encode([$row('Thunderstorms Warning', 'Storms over Selangor',
            $wnow - WARN_FRESH + 600, $wnow + 86400)]), $wnow)[0]['fresh'] === true);

    $dupe = metWarnings(json_encode([$rain, $rain, $rain]), $wnow);
    $ok('three identical rows collapse to one', count($dupe) === 1);

    $none = $row('No Advisory', '', $wnow, $wnow);
    $none['valid_from'] = '';
    $none['valid_to']   = '';
    $ok('a row with no validity drops',      metWarnings(json_encode([$none]), $wnow) === []);
    $ok('rubbish parses to nothing',         metWarnings('not json', $wnow) === []);
    $ok('an empty body parses to nothing',   metWarnings('', $wnow) === []);

    /* A kind MET has not published before must still show, so long as it names somewhere here.
       The kind is not on any list. The place is what admits it. */
    $odd = $row('Flash Flood Warning', 'Flooding expected in Klang, Selangor', $wnow - 60, $wnow + 3600);
    $ok('an unknown kind still shows', count(metWarnings(json_encode([$odd]), $wnow)) === 1);

    /* The place test on a land row, checked both ways. One half admits every state in the
       country. The other half silences the one this map serves. Both need a check, or a wrong
       edit hides in either one. */
    $away = $row('Thunderstorms Warning', 'Thunderstorms over Kelantan and Terengganu',
                 $wnow - 60, $wnow + 3600);
    $ok('a land warning naming nowhere here drops',
        metWarnings(json_encode([$away]), $wnow) === []);

    $kl = $row('Thunderstorms Warning', 'Thunderstorms over Kuala Lumpur', $wnow - 60, $wnow + 3600);
    $pj = $row('Thunderstorms Warning', 'Ribut petir di Putrajaya', $wnow - 60, $wnow + 3600);
    $lk = $row('Thunderstorms Warning', 'Hujan lebat di Lembah Klang', $wnow - 60, $wnow + 3600);
    $ok('Kuala Lumpur matches',   count(metWarnings(json_encode([$kl]), $wnow)) === 1);
    $ok('Putrajaya matches',      count(metWarnings(json_encode([$pj]), $wnow)) === 1);
    $ok('Lembah Klang matches',   count(metWarnings(json_encode([$lk]), $wnow)) === 1);

    /* MET words some warnings by coast rather than by state, and Selangor is on the west coast.
       A row worded that way covers this map without naming it, so it has to pass. The
       peninsula-wide wording deliberately does not, and both halves need a test to hold that
       line. */
    $wc = $row('Continuous Rain Warning', 'Heavy rain over the west coast of Peninsular Malaysia',
               $wnow - 60, $wnow + 3600);
    $wcBm = $row('Amaran Hujan Berterusan', '', $wnow - 60, $wnow + 3600);
    $wcBm['text_bm'] = 'Hujan lebat di pantai barat Semenanjung Malaysia';
    $pen = $row('Continuous Rain Warning', 'Heavy rain over Peninsular Malaysia',
                $wnow - 60, $wnow + 3600);

    $ok('a west coast warning matches',    count(metWarnings(json_encode([$wc]), $wnow)) === 1);
    $ok('pantai barat matches too',        count(metWarnings(json_encode([$wcBm]), $wnow)) === 1);
    $ok('a peninsula wide warning still drops', metWarnings(json_encode([$pen]), $wnow) === []);

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

    echo $fail ? "\n$fail FAILED\n" : "\nall ok\n";
    exit($fail ? 1 : 0);
}

header('Content-Type: application/json');
$t0 = microtime(true);

/** Age from when the payload was actually fetched — mtime doubles as a lock and gets touched. */
function cachedPayload(): array {
    $j = json_decode(@file_get_contents(CACHE), true) ?: [];
    /* `forced` and `forceWhy` describe the request that built this file, not the one reading it.
       PHP's array + is left-biased, so the defaults sit on the LEFT to beat what the file holds.
       Every cached read passes through here, so no exit can replay a stale value. */
    /* `cacheAge` sits on the LEFT for the same reason, and it did not. The stored file already
       carries a `cacheAge` of 0, written by the rebuild that made it, so a computed value on the
       right lost to it on every read and this field reported 0 however long the payload had sat.
       The status popover reads it to say whether a poll came from JPS or from the file cache, and
       it therefore said JPS on every poll. See payloadEtag() for the half that had to move with
       this one. */
    return ['forced' => false, 'forceWhy' => null]
         + ['cacheAge' => max(0, time() - strtotime($j['fetched'] ?? 'now'))]
         + $j;
}

/**
 * Set the two validators on a payload response, and return the ETag.
 *
 * Three exits echo a payload and only one of them may exit, so the headers live here and the
 * exiting behavior lives in sendPayload() below. One function sets these headers, so no exit can
 * drift from the others. A default written into one exit alone reached none of the others once
 * already, which is the `forced` flag gotcha in CLAUDE.md.
 */
/* The ETag names the build, not the moment somebody read it.
 *
 * `cacheAge` counts up every second a payload sits in the file cache. Hash it and the validator
 * moves on every poll, no two requests ever match, and the 304 stops firing — silently, because a
 * validator that never matches is not an error, just a full 33 KB body every time. That is why the
 * cacheAge repair above could not ship on its own: it was harmless only while the field was frozen
 * at 0, and the ETag was stable only because of that.
 *
 * Blanked rather than cut, so the hash still depends on the field being there. A separate function
 * from the header writing, so --selftest can call the rule rather than restate it.
 */
function payloadEtag(string $body): string {
    return '"' . md5(preg_replace('/"cacheAge":\d+/', '"cacheAge":0', $body, 1)) . '"';
}

function payloadValidators(string $body): string {
    $etag = payloadEtag($body);
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

function serveCache(array $extra = []): never {
    // $extra is left-biased, so an explicit refusal passed in here still overrides. The defaults
    // for an ordinary poll live in cachedPayload() now, since every exit reads through it.
    sendPayload(json_encode($extra + cachedPayload(), JSON_UNESCAPED_SLASHES));
}

/* Exactly one rebuild may be in flight at a time, process-wide.
 *
 * A cold rebuild fans out ~270 concurrent requests at JPS. Two visitors on an expired cache is 540,
 * three is 810. That is not a busy site, it is the shape of a flood from one address, and the
 * fastest way to have this IP blocked by the agency the whole page depends on. The window is real:
 * the rebuild takes ~3.5s warm and ~15s cold, and every open tab polls on its own 5-minute timer.
 *
 * `touch(CACHE)` used to claim the refresh, but only inside the `fastcgi_finish_request` branch,
 * and Herd's SAPI is `cgi-fcgi`, which lacks that function. So nothing claimed anything and every
 * concurrent miss stampeded. A lock file does not depend on the SAPI.
 *
 * The loser serves the stale payload rather than waiting. It is at most one poll old, and holding a
 * connection open 15s for data the caller already has is worse than data five minutes stale. */
$lock = fopen(LOCK, 'c');
$mine = $lock && flock($lock, LOCK_EX | LOCK_NB);

/* The Developer section's "Refresh now". It expires the *file* cache only. The scraped pages keep
   their own 15-minute cache in the `page` table, and the KL rainfall table takes ten seconds
   upstream, so re-scraping would triple the cost of one button press.
   Not a second refresh path: it falls into the same lock, and a loser still serves stale cache.
   GET only, because a cache-busting side effect does not belong on a non-idempotent method. That
   does not stop a prefetch, which issues a GET like any read. The rate limit does. */
$asked = ($_GET['force'] ?? '') === '1';
$force = $asked && ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET';
$forceWhy = $asked && !$force ? 'not a GET' : '';
if ($force) {
    [$allowed, $forceWhy] = forceAllowed(time(), is_file(FORCE_STAMP) ? filemtime(FORCE_STAMP) : null);
    if (!$allowed) $force = false;
}

if (is_file(CACHE)) {
    $age = time() - filemtime(CACHE);
    if (serveFromCache($age, $mine, $force)) {
        /* Name the reason that actually stopped this force, most specific first. A request refused
           before the lock knows why. One that reached the lock and lost does not. */
        $why = !$asked ? ''
             : (!$force ? $forceWhy
             : (!$mine  ? 'another refresh is running'
                        : 'cache is fresh'));
        serveCache($asked ? ['forced' => false, 'forceWhy' => $why] : []);
    }
    /* The stamp is spent here, not above, so a force the lock turned away keeps its budget. No
       fan-out happened, so charging it a minute charges it for nothing. */
    if ($force) touch(FORCE_STAMP);
    // One upstream table takes ~10s to render, so blocking the page means a blank map for that
    // long. Hand back the stale payload, then refresh with the connection closed.
    // A force is the exception. Nobody asked to see an ordinary poll's rebuild. Refresh now exists
    // so a reader can see what the rebuild produced, so it waits in the foreground.
    if (!$force && function_exists('fastcgi_finish_request')) {
        /* Not sendPayload(): this branch keeps working after the response, so it must not exit here.
           The validators still have to match the other two exits, or a reader on the deploy target
           gets a payload with no ETag while everybody else gets one. */
        $body = json_encode(cachedPayload(), JSON_UNESCAPED_SLASHES);
        payloadValidators($body);
        echo $body;
        fastcgi_finish_request();
        ignore_user_abort(true);
    }
    // CLI (and any SAPI without that call) just falls through and refreshes in the foreground.
} elseif (!$mine) {
    // True cold start with nothing to serve. Waiting is the only honest option — but wait on the
    // lock, so the arrivals queue behind one rebuild instead of each starting their own.
    flock($lock, LOCK_EX);
    if (is_file(CACHE)) serveCache();   // the winner finished while we waited; use what it wrote
}

/**
 * The last SPARK_WIN of samples, one per bucket, as [ts, level]. Keeps the newest sample in each
 * bucket, never an average: this is a level graph, and an average smooths away the short sharp rise
 * the graph exists to show.
 *
 * $peak keeps the highest value in the bucket instead. For sirens, where samples are 0/1 and a
 * trigger that stopped inside one bucket is the whole point of the graph.
 *
 * $score, where a kind has one, appends the status that sample was at: [ts, value, code]. The hover
 * readout colours by it and marks anything at the warning rung or above. Scored HERE, not in the
 * browser, for the same reason the live reading is: there is one definition of a status in this app
 * and it is this file's, through wlStatus()/rainStatus(). A client comparing a historical value to
 * the marks beside it is a second definition, and the second one always drifts.
 * Kinds without a scorer keep the two-element shape, and every reader destructures [ts, value].
 */
function sparkPoints(array $points, int $now, int $bucket = SPARK_BUCKET, bool $peak = false,
                     ?callable $score = null): array {
    $out = [];
    foreach ($points as [$ts, $v]) {
        if ($now - $ts > SPARK_WIN) continue;
        $b = intdiv($ts, $bucket);
        if ($peak && isset($out[$b]) && $out[$b][1] >= $v) continue;
        $r = round($v, 3);
        $out[$b] = $score ? [$ts, $r, $score($r)] : [$ts, $r];
    }
    ksort($out);
    return array_values($out);
}

/**
 * The timestamp a reading was taken, not the one we happened to poll on.
 *
 * Two different clocks, and the gap is not small. Upstream changes a value every ~25 min (median,
 * over the archive) and we poll every ~8.5 min, so a level is a staircase: the same number arrives
 * four or five times. Storing each arrival at `now` puts the step at our poll, so both ends of a
 * rate carry up to a poll interval of error — over a short baseline, a rate wrong by 100%. That is
 * every phantom climb on a station whose level had not moved in five polls.
 *
 * The reading's own stamp also makes the (station, ts) primary key work: a repeated reading is one
 * row, not five. JPS stamps to the UPCOMING slot (17:45 at 17:36), so a future stamp is normal and
 * is pulled back to now rather than treated as an error.
 */
function readTs(?string $updated, int $now): int {
    $d = $updated ? DateTime::createFromFormat('d/m/Y H:i:s', $updated) : false;
    return $d ? min($now, $d->getTimestamp()) : $now;
}

/** Fetch many URLs concurrently. Returns [url => decoded|null], or [url => body] when $json is off. */
function fetchAll(array $urls, int $concurrency = 20, bool $json = true): array {
    $mh = curl_multi_init();
    $out = $handles = [];
    $queue = array_values($urls);
    $add = function () use (&$queue, &$handles, $mh) {
        if (!$queue) return;
        $url = array_shift($queue);
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 25,
            // Contact URL in the UA: this box pulls ~1.1 GB/day off JPS from one residential IP,
            // the most conspicuous shape a web log has. Better their sysadmin reads what it is than
            // guesses. Identifying yourself is the polite form and the safe one.
            CURLOPT_USERAGENT      => 'flood-exp/1.0 (+https://github.com/illusionikx/selangor-flood-tracker)',
            CURLOPT_FOLLOWLOCATION => true,   // the national portal 301s to its canonical path
            CURLOPT_MAXREDIRS      => 3,
        ]);
        curl_multi_add_handle($mh, $ch);
        $handles[(int)$ch] = $url;
    };
    for ($i = 0; $i < $concurrency; $i++) $add();

    do {
        curl_multi_exec($mh, $running);
        curl_multi_select($mh, 0.5);
        while ($info = curl_multi_info_read($mh)) {
            $ch = $info['handle'];
            $body = curl_multi_getcontent($ch);
            /* An error page is not data. Upstream answers 404 and 500 with a full HTML page, and
               without this the page cache stores one under the name of a table, `?cam=` serves one
               as image/jpeg, and pageRow() writes it over the good copy it already had. Every caller
               here already treats an empty body as a failed fetch, so this reuses that path. */
            if (curl_getinfo($ch, CURLINFO_HTTP_CODE) >= 400) $body = '';
            $out[$handles[(int)$ch]] = $json ? json_decode($body, true) : $body;
            curl_multi_remove_handle($mh, $ch);
            curl_close($ch);
            $add();
            $running = 1; // keep looping while the queue drains
        }
    } while ($running > 0 || $queue);

    curl_multi_close($mh);
    return $out;
}


$lists = fetchAll([
    'rainfall' => API . 'StationRainfalls',
    'river'    => API . 'StationRiverLevels',
    'siren'    => API . 'StationSirens',
    'gauge'    => API . 'StationFloodGauges',
    'camera'   => API . 'CCTVS',
]);
$get = fn($k) => $lists[API . $k] ?? [];

$rainfallList = $get('StationRainfalls');
$riverList    = $get('StationRiverLevels');

if (!$rainfallList && !$riverList) {
    // Upstream is down: serve the last good payload rather than a blank map, and say so.
    if (is_file(CACHE)) serveCache(['upstreamOk' => false, 'error' => 'upstream unreachable']);
    http_response_code(502);
    echo json_encode(['upstreamOk' => false, 'error' => 'upstream unreachable']);
    exit;
}

// Detail calls carry the actual mm / metres. Lists only carry status codes.
$detailUrls = [];
foreach ($rainfallList as $s) $detailUrls["rf-{$s['stationId']}"] = API . 'StationRainfalls/' . $s['stationId'];
foreach ($riverList as $s)    $detailUrls["wl-{$s['stationId']}"] = API . 'StationRiverLevels/' . $s['stationId'];
foreach ($get('CCTVS') as $s) $detailUrls["cam-{$s['stationId']}"] = API . 'CCTVS/' . $s['stationId'];
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
foreach ($get('StationFloodGauges') as $s) $detailUrls["fg-{$s['stationId']}"] = API . 'StationFloodGauges/' . $s['stationId'];
$now = time();

// Level history lives in sqlite (pdo_sqlite ships with PHP, so still no dependencies). The payload
// cache stays a flat file: it is one blob, always written and read whole, with nothing to query.
$db = new PDO('sqlite:' . HIST, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$db->exec('PRAGMA journal_mode=WAL');  // two concurrent cold refreshes no longer lose each other's samples
$db->exec('CREATE TABLE IF NOT EXISTS level (
    station TEXT    NOT NULL,
    ts      INTEGER NOT NULL,
    level   REAL    NOT NULL,
    PRIMARY KEY (station, ts)
) WITHOUT ROWID');  // the key also makes a retried poll idempotent — INSERT OR IGNORE and move on
$db->exec('CREATE TABLE IF NOT EXISTS page (url TEXT PRIMARY KEY, ts INTEGER, body TEXT) WITHOUT ROWID');

// The scraped pages ride along in the same concurrent batch, but on their own clock: the KL rainfall
// table takes ~10s to render upstream, against ~0.3s for a JSON call, and none of these sources
// updates faster than a quarter hour. Refetching them every 5 minutes would triple the cost of a
// poll for data that cannot have changed. A page that fails to fetch falls back to the last copy we
// stored — a slow upstream should cost freshness, never a whole region's worth of pins.
$extraUrls = nationalUrls() + klUrls() + metUrls($now) + portalRainUrls();
$stored = [];
foreach ($db->query('SELECT url, ts, body FROM page') as $r) $stored[$r['url']] = $r;
// The daily forecast and the warning feed each keep their own clock. Everything else keeps SCRAPE_TTL.
$ttlFor = fn(string $k) => match ($k) {
    'met-day'  => MET_DAY_TTL,
    'met-warn' => MET_WARN_TTL,
    default    => SCRAPE_TTL,
};
$want = [];
foreach ($extraUrls as $k => $u) {
    if (($stored[$u]['ts'] ?? 0) < $now - $ttlFor($k)) $want[$k] = $u;
}

$raw = fetchAll($detailUrls + $want, 20, false);
$details = [];
foreach ($detailUrls as $u) $details[$u] = json_decode($raw[$u] ?? '', true);

$keep = $db->prepare('INSERT OR REPLACE INTO page (url, ts, body) VALUES (?, ?, ?)');
$drop = $db->prepare('DELETE FROM page WHERE url = ?');
$pages = [];
/* Which pages this server asked for and did not get. pageRow() stamps a failure, so the `ts` column
   no longer shows a dead upstream — it advances on every attempt whether or not the page answered.
   That is the point of the stamp and it costs the one signal a reader had. This list is the
   replacement, and it rides in `sources` next to the parse counters for the same reason: a scraped
   feed fails silently, so the diagnostics have to say so. A key here means the map is drawing a
   stored copy of that table. `kl.parsed` cannot say it, because a stored copy parses as well as a
   fresh one. */
$pagesStale = [];
/* The notice each page last showed the server, page key => notice id. $stored already holds every
   row of the table, so the memory costs no second query. See noticeRow() for why it is remembered at
   all. */
$seen = [];
foreach ($stored as $su => $sr) {
    if (str_starts_with($su, NOTICE_KEY)) $seen[substr($su, strlen(NOTICE_KEY))] = $sr['body'];
}
foreach ($extraUrls as $k => $u) {
    $got = $raw[$u] ?? '';
    $id  = null;
    if (!pageHasData($k, $got)) {
        /* Read the raw body before the next line clears it. A notice is the one failure that states
           its own cause, so it is the only one a reader hears about. Everything else stays in
           $pagesStale, which the status popover already carries. */
        $id = noticeOf($got);
        $got = '';
    }
    switch (noticeRow(isset($want[$k]), $id)) {
        case 'set':
            $keep->execute([NOTICE_KEY . $k, $now, $id]);
            $seen[$k] = $id;
            break;
        case 'clear':
            $drop->execute([NOTICE_KEY . $k]);
            unset($seen[$k]);
            break;
    }
    [$write, $body] = pageRow(isset($want[$k]), $got, $stored[$u]['body'] ?? '');
    if (isset($want[$k]) && $got === '') $pagesStale[] = $k;
    if ($write) $keep->execute([$u, $now, $body]);
    $pages[$k] = $body;
}

/* Built from the memory, never from the loop above. A poll that refetched nothing still states the
   outage it was told about last time.
   Walked in $extraUrls order rather than in $seen order. The regions become a sentence a reader
   reads, so they keep the order the source list declares. Walking the memory instead hands that
   sentence the order sqlite returns rows in, and the region names move for no reason.
   A key this build no longer asks for contributes nothing, so a row left over from an older build is
   inert and no reader has to clean it up. */
$noticeHits = [];      // notice id => [region, …]
foreach ($extraUrls as $k => $u) {
    if (isset($seen[$k], NOTICE_REGION[$k])) $noticeHits[$seen[$k]][] = NOTICE_REGION[$k];
}

/* One entry per notice, never one per page. Three national pages carry the same notice, and three
   identical tiles on the strip claim one outage three times. */
$notices = [];
foreach ($noticeHits as $id => $regions) {
    $notices[] = ['id' => $id, 'regions' => array_values(array_unique($regions))];
}
$page = fn(string $k) => $pages[$k] ?? '';

/* The national portal's rainfall table, parsed here so every later pass can read it. Nothing
   consumes a reading from it yet. */
$prf = portalRain(array_intersect_key($pages, portalRainUrls()));

// The forecast URL carries the current date, so no later request reads a row a day old again. Two
// days of slack cover a clock that slips backward, so the delete never removes a row this code wants.
$db->prepare('DELETE FROM page WHERE url LIKE ? AND ts < ?')
   ->execute([MET_DAY_URL . '%', $now - 2 * 86400]);

/* MET publishes its own stamp, and that stamp decides whether the nowcast is worth keeping. A
   projection more than MET_STALE old describes weather that has already happened, and a card stating
   old weather is worse than a card stating nothing — the same rule that renders an offline gauge grey
   rather than steady. */
$metPts = metPoints($page('met-now'));
/* Two counts, because one cannot answer two questions. `parsed` is what the page yielded and is
   the alarm for a layout change: MET moves something and it falls to 0. `fresh` is what survived
   the stamp test and is what the map actually drew from. Publishing only the survivors made a
   quiet upstream look exactly like a broken parser — both report 0 — and the Verify line in
   CLAUDE.md tells a reader that 0 means MET moved something. It only means that when `parsed` is
   0. `parsed` high and `fresh` 0 is an upstream that has stopped updating, which is a different
   fault with a different fix. */
$metParsed = count($metPts);
$metPts = array_values(array_filter($metPts, fn($p) => $p['stamp'] >= $now - MET_STALE));
$metDay = metDaily($page('met-day'));
$metWarn = metWarnings($page('met-warn'), $now);

// One-off carry-over from the flat file, so trends survive the switch instead of going null for an
// hour. Deletes itself; drop this block once no deployment has a .history.json left.
if (is_file($old = __DIR__ . '/.history.json')) {
    $ins = $db->prepare('INSERT OR IGNORE INTO level (station, ts, level) VALUES (?, ?, ?)');
    $db->beginTransaction();
    foreach (json_decode(file_get_contents($old), true) ?: [] as $k => $points) {
        foreach ($points as $p) $ins->execute([$k, $p[0], $p[1]]);
    }
    $db->commit();
    unlink($old);
}

$hist = [];
foreach ($db->query('SELECT station, ts, level FROM level WHERE ts >= ' . ($now - READ) . ' ORDER BY ts') as $r) {
    $hist[$r['station']][] = [(int)$r['ts'], (float)$r['level']];
}
/* The odometer series, on its own clock. `$hist` loads READ, which is 24 hours and right for a
   trend, and short for a 72 hour total. So the cumulative keys take a second read at ACC_READ.
   The `#c` suffix keeps them in the one table with no schema change, and RETAIN prunes them with
   everything else. No station id ends in `#c`, so these rows can never be read as a level. */
$odo = [];
foreach ($db->query('SELECT station, ts, level FROM level WHERE station LIKE \'%#c\' AND ts >= '
                    . ($now - ACC_READ) . ' ORDER BY ts') as $r) {
    $odo[$r['station']][] = [(int)$r['ts'], (float)$r['level']];
}
$samples = [];

$stations = [];

foreach ($rainfallList as $s) {
    $d = $details[API . 'StationRainfalls/' . $s['stationId']] ?? [];
    $stations[] = [
        'kind'     => 'rainfall',
        'id'       => 'rf-' . $s['stationId'],
        'name'     => $s['stationName'],
        'district' => $s['districtName'],
        'basin'    => $s['mainRiverBasin'],
        'lat'      => (float)$s['latitude'],
        'lng'      => (float)$s['longitude'],
        // -1 none .. 4 very heavy. The list publishes -1 on 144 of 233 gauges that are reporting a
        // real number, so where there is a reading the class comes from rainStatus(), the same one
        // the scraped feeds use. One definition of a status, and it is this file's.
        'status'   => (int)$s['status'] < 0 && isset($d['hourlyRainfall'])
                        ? rainStatus((float)$d['hourlyRainfall']) : (int)$s['status'],
        'online'   => (int)$s['stationStatus'] === 1,
        'code'     => $s['station_Id'] ?? null,   // national JPS code — the key the other feeds share
        'source'   => 'selangor',
        'hourly'   => $d['hourlyRainfall']     ?? null,
        // Both are already in the detail response and both were discarded on every poll until now.
        // `hour3` saves adding up clock hours, and `cumulative` is a year-to-date odometer — see
        // accWindow(). Neither reaches a browser: the acc block below reads them and then drops them.
        'hour3'      => $d['threeHoursRainfall']  ?? null,
        'cumulative' => $d['cumulativeRainfall']  ?? null,
        'daily'    => $d['dailyRainfall']      ?? null,
        'updated'  => $d['statusLastUpdate']   ?? null,
    ];
}

foreach ($riverList as $s) {
    $d   = $details[API . 'StationRiverLevels/' . $s['stationId']] ?? [];
    $key = 'wl-' . $s['stationId'];
    $lvl = isset($d['waterLevel1']) ? (float)$d['waterLevel1'] : null;

    $danger = $d['wL1SPDanger'] ?? null;
    $stations[] = [
        'kind'     => 'river',
        'id'       => $key,
        'name'     => $s['stationName'],
        'district' => $s['districtName'],
        'basin'    => $s['mainRiverBasin'],
        'lat'      => (float)$s['latitude'],
        'lng'      => (float)$s['longitude'],
        /* -1 offline, 0 normal, 1 alert, 2 warning, 3 danger. The list carries -1 on 15 stations
           that are online and reporting, so where there is a reading and a mark the code comes from
           wlStatus(), the same one the national portal's rows use. A status the reader can check
           against the number beside it beats one the feed asserts and the number contradicts. */
        'status'   => (int)$s['wL1Status'] < 0 && $lvl !== null
          ? wlStatus($lvl, $d['wL1SPAlert'] ?? null, $d['wL1SPWarning'] ?? null, $danger)
          : (int)$s['wL1Status'],
        'online'   => (int)$s['stationStatus'] === 1,
        'level'    => $lvl,
        'alert'    => $d['wL1SPAlert']  ?? null,
        'warning'  => $d['wL1SPWarning'] ?? null,
        'danger'   => $danger,
        'code'     => $s['station_Id'] ?? null,
        'source'   => 'selangor',
        'updated'  => $d['waterLevel1LastUpdate'] ?? null,
    ];
}

/* The last `statusLastUpdate` this server saw for each siren, read from the payload it wrote on the
   previous rebuild. A siren we did not fetch this time keeps the timestamp it already had.
   Not fetching a siren is not evidence that it reported now. Without this, readTs() falls back to
   the poll time, which is the one thing a sample stamp must never be. It also defeats the
   (station, ts) key that holds a repeated reading to one row: measured at 6 rows per siren per
   hour against a daily heartbeat. See the reading-stamp gotcha in CLAUDE.md. */
$sirenSeen = [];
foreach ((json_decode((string)@file_get_contents(CACHE), true)['stations'] ?? []) as $p) {
    if (($p['kind'] ?? '') === 'siren' && !empty($p['updated'])) $sirenSeen[$p['id']] = $p['updated'];
}

foreach ([['siren', 'StationSirens'], ['gauge', 'StationFloodGauges'], ['camera', 'CCTVS']] as [$kind, $ep]) {
    foreach ($get($ep) as $s) {
        $cam = $kind === 'camera' ? ($details[API . 'CCTVS/' . $s['stationId']] ?? []) : [];
        // Gauges report flood depth over the marked spot: negative is dry ground.
        $fg  = $kind === 'gauge' ? ($details[API . 'StationFloodGauges/' . $s['stationId']] ?? []) : [];
        // Siren detail exists only for the timestamp — the list says a siren is "online" forever,
        // including ones that last reported over a year ago.
        $sn  = $kind === 'siren' ? ($details[API . 'StationSirens/' . $s['stationId']] ?? []) : [];
        $updated = stationUpdated($fg, $sn, $kind, (int)$s['stationId'], $sirenSeen);

        // A siren that hasn't checked in for two of its daily heartbeats is not idle, it is out of
        // contact — and "IDLE" on a dead siren is the most dangerous thing this map could print.
        // No timestamp at all is left alone: that is missing evidence, not evidence of failure.
        $stale = $kind === 'siren' && $updated
              && ($t = DateTime::createFromFormat('d/m/Y H:i:s', $updated))
              && $now - $t->getTimestamp() > SIREN_STALE;

        [$lat, $lng] = camFix($kind, (int)$s['stationId'], (float)$s['latitude'], (float)$s['longitude']);

        $stations[] = [
            'image'    => $cam['imageUrl'] ?? null,
            'shot'     => isset($cam['lastUpdate']) ? date('d/m/Y H:i:s', strtotime($cam['lastUpdate'])) : null,
            'depth'    => $fg['floodLevel'] ?? null,
            'warning'  => $fg['spWarning']  ?? null,
            'danger'   => $fg['spDanger']   ?? null,
            'kind'     => $kind,
            'id'       => $kind . '-' . $s['stationId'],
            'name'     => trim($s['stationName']),
            'district' => $s['districtName'],
            'basin'    => $s['mainRiverBasin'],
            'lat'      => $lat,
            'lng'      => $lng,
            'status'   => (int)($fg['status'] ?? $s['status'] ?? 0),
            'online'   => !$stale && (bool)($s['isOnline'] ?? ((int)($s['stationStatus'] ?? 0) === 1)),
            'source'   => 'selangor',
            'updated'  => $updated,
        ];
    }
}

/** SPHTN covers two federal territories and labels neither; only Putrajaya names itself. */
function klState(?string $district): string {
    return stripos($district ?? '', 'putrajaya') !== false ? 'Putrajaya' : 'Kuala Lumpur';
}

// --- KL (SPHTN) ------------------------------------------------------------------------------
// Adds Kuala Lumpur, which the Selangor API does not cover. Its catchment reaches into Selangor, so
// some of its stations are ones we already hold: same mast, different id space (the two feeds share
// no station codes at all), which is why the de-duplication is by position rather than by key.
// The whole page set, because rainfall now arrives as one page per district and klStations() picks
// its own keys out by prefix. See KL_RAIN in sources.php.
$kl = klStations($pages);
$klAdded = $klDupes = 0;
foreach ($kl as $s) {
    foreach ($stations as $have) {
        if ($have['kind'] === $s['kind'] && abs($have['lat'] - $s['lat']) < 0.002
                                         && abs($have['lng'] - $s['lng']) < 0.002) {
            $klDupes++;
            continue 2;   // ~200 m apart and the same kind: one mast, and we already have it
        }
    }
    $klAdded++;
    $stations[] = $s['kind'] === 'river' ? [
        'kind' => 'river', 'id' => 'kl-wl-' . $s['code'], 'name' => $s['name'],
        'district' => $s['district'], 'basin' => $s['basin'], 'lat' => $s['lat'], 'lng' => $s['lng'],
        'status' => wlStatus($s['level'], $s['alert'], $s['warning'], $s['danger']),
        'online' => $s['level'] !== null,
        'level' => $s['level'], 'alert' => $s['alert'], 'warning' => $s['warning'], 'danger' => $s['danger'],
        'code' => $s['code'], 'source' => 'kl', 'state' => klState($s['district']),
        'updated' => $s['updated'],
    ] : [
        'kind' => 'rainfall', 'id' => 'kl-rf-' . $s['code'], 'name' => $s['name'],
        'district' => $s['district'], 'basin' => null, 'lat' => $s['lat'], 'lng' => $s['lng'],
        'status' => rainStatus($s['hourly']), 'online' => $s['hourly'] !== null,
        'hourly' => $s['hourly'], 'daily' => $s['daily'],
        'code' => $s['code'], 'source' => 'kl', 'state' => klState($s['district']),
        'updated' => $s['updated'],
    ];
}

// --- National portal -------------------------------------------------------------------------
// Authoritative per the operator's call, so its reading and thresholds win wherever the station code
// matches — at the cost of up to 30 min more lag than the state feeds, which is the trade we chose.
// It publishes no coordinates, so it can only ever correct a station another feed already placed;
// the ones it alone knows about are counted and dropped rather than pinned at a guessed location.
$nat = nationalLevels(array_map($page, array_keys(nationalUrls())));
$natUsed = [];
foreach ($stations as &$s) {
    $n = ($s['kind'] === 'river' && $s['code']) ? ($nat[$s['code']] ?? null) : null;
    if (!$n || $n['level'] === null) continue;
    $natUsed[$s['code']] = true;
    $s['level']   = $n['level'];
    $s['alert']   = $n['alert']   ?? $s['alert'];
    $s['warning'] = $n['warning'] ?? $s['warning'];
    $s['danger']  = $n['danger']  ?? $s['danger'];
    $s['updated'] = $n['updated'] ?? $s['updated'];
    $s['online']  = true;
    // The portal publishes values, not a status code, so status is re-derived from its own
    // thresholds — mixing its level with the state feed's status code would let the two disagree.
    $s['status']  = wlStatus($s['level'], $s['alert'], $s['warning'], $s['danger']);
    $s['source']  = 'national';
}
unset($s);

// --- Rainfall history --------------------------------------------------------------------------
// Rain now is the river's rise in an hour, so this is the earlier signal of the two — worth keeping
// even though nothing computes a trend from it. Same table, same window; only the bucket differs.
foreach ($stations as &$s) {
    if ($s['kind'] !== 'rainfall' || !isset($s['hourly'])) continue;
    $key = $s['id'];
    $ts  = readTs($s['updated'] ?? null, $now);
    // This poll's own reading is not in the table yet, so it is appended to every series read here.
    $pts = array_merge($hist[$key] ?? [], [[$ts, (float)$s['hourly']]]);
    $s['history'] = sparkPoints($pts, $now, RAIN_BUCKET, false, fn($v) => rainStatus($v));
    $samples[$key] = [$ts, (float)$s['hourly']];

    /* Five nested windows, computed here because the client works nothing out. Each entry is
       [mm, derived, spanHours], and null where nothing can answer honestly. `derived` is a ladder
       of three rungs rather than a flag, and the card prints one asterisk per rung: 0 read straight
       off a feed, 1 this app worked it out over the whole window, 2 this app worked it out over a
       shorter window and the readout names the span it really covered.
       The five keys are declared up front so the order is fixed whatever any of them resolves to. */
    $acc = ['h1' => null, 'h3' => null, 'day' => null, 'h24' => null, 'h72' => null];
    $acc['h1'] = [round((float)$s['hourly'], 1), 0, null];
    if (($s['daily'] ?? null) !== null) $acc['day'] = [round((float)$s['daily'], 1), 0, null];

    // Selangor publishes a 3 hour total. KL publishes none, so those 37 stations add clock hours,
    // and go blank rather than report a sum with an hour missing out of it.
    if (($s['hour3'] ?? null) !== null) {
        $acc['h3'] = [round((float)$s['hour3'], 1), 0, null];
    } elseif (($sum = accHours($pts, $now, 3)) !== null) {
        $acc['h3'] = [$sum, 1, null];
    }

    /* 24 and 72 hours need the odometer, which only Selangor publishes. The 38 KL gauges answer
       neither window and never will, so their two columns carry an em dash and the readout on it
       says why. Do not close that gap by adding up `hourly` buckets — see accWindow() above.

       Both windows may answer over a shorter span than they name, and then both say so. */
    if (($s['cumulative'] ?? null) !== null) {
        $series = array_merge($odo[$key . '#c'] ?? [], [[$ts, (float)$s['cumulative']]]);
        foreach (['h24' => 86400, 'h72' => 259200] as $k => $win) {
            if (($w = accWindow($series, $now, $win, true)) !== null)
                $acc[$k] = [$w[0], $w[2] ? 2 : 1, $w[1]];
        }
        /* Nothing filters the pair. Both windows anchor to the oldest sample there is, so a young
           archive answers both with one number over one span, each marked short. See accWindow()
           above for the version that dropped the longer one and why it is gone. */
        $s['backed'] = rainBacked($s['hourly'] ?? null, $series, $now);
        /* The oldest odometer sample this station has, which is the baseline of any short answer.
           The card reads only whether this key is HERE: a gauge that publishes no running total has
           none, and that is the one thing separating a permanent dash from a waiting one. The card
           deliberately prints no clock time, so the value itself is for whoever opens the raw
           payload. Do not delete it on the strength of that — the presence test needs the key. */
        $s['accFrom'] = $series[0][0];
        $samples[$key . '#c'] = [$ts, (float)$s['cumulative']];
    }

    $s['acc'] = $acc;
    unset($s['hour3'], $s['cumulative']);   // read here, never sent to a browser
}
unset($s);

// --- Gauge history -----------------------------------------------------------------------------
// Depth over a flood-prone spot is a level like any other, so it takes the same table, window and
// bucket as a river. A line between two readings is honest: the water really was in between. No
// trend or ETA off it — the marks are 0.15 m and 0.3 m, and a rate against numbers that small from
// a centimetre sensor is mostly noise. The graph answers what a gauge is asked: filling or draining.
foreach ($stations as &$s) {
    // Offline gauges are frozen on old flood readings — several still hold April's 3.55 m. Sampling
    // one every poll would draw a flat line at a number from months ago, which is the one thing a
    // graph of it must not do: a straight line reads as "steady", not as "nobody is listening".
    if ($s['kind'] !== 'gauge' || !isset($s['depth']) || !$s['online']) continue;
    $key = $s['id'];
    $ts  = readTs($s['updated'] ?? null, $now);
    $hist[$key] = array_merge($hist[$key] ?? [], [[$ts, (float)$s['depth']]]);
    $s['history'] = sparkPoints($hist[$key], $now, SPARK_BUCKET, false,
        fn($v) => gaugeStatus($v, $s['warning'] ?? null, $s['danger'] ?? null));
    $samples[$key] = [$ts, (float)$s['depth']];
}
unset($s);

// --- Siren history -------------------------------------------------------------------------------
// A siren is 0 or 1, so this is a log, not a trend. The popup draws it as a band, never a line.
// "Silent for the last 12 hours" is the answer a siren pin is opened for, and the only evidence for
// it used to be a heartbeat timestamp. Out-of-contact sirens are skipped like offline gauges: a
// flat IDLE band from a sensor nobody can hear is a lie.
// ponytail: full-resolution samples. Bucket to the hour if the table bloats.
//
// Every placed river, as [lat, lng, status], for sirenBacked() below. Built once — 212 sirens
// against 109 rivers is 23k distance tests, but inside the loop it is a list built 212 times.
$riverMarks = [];
foreach ($stations as $r) {
    if ($r['kind'] === 'river' && $r['lat'] && $r['lng']) $riverMarks[] = [$r['lat'], $r['lng'], (int)$r['status']];
}
foreach ($stations as &$s) {
    if ($s['kind'] !== 'siren' || !$s['online']) continue;
    $key = $s['id'];
    $ts  = readTs($s['updated'] ?? null, $now);
    $hist[$key] = array_merge($hist[$key] ?? [], [[$ts, (float)$s['status']]]);
    $s['history'] = sparkPoints($hist[$key], $now, SPARK_BUCKET, true);
    $samples[$key] = [$ts, (float)$s['status']];
    /* Does the water agree that this siren is sounding? Decided here, against river statuses that
       are final by this point — the national override has already run — so "still sounding" has one
       definition and it is this file's. The client reads the flag, exactly as it reads `rising`.
       Only asked of a siren that claims to be sounding: a quiet one has nothing to check. */
    $s['backed'] = $s['status'] > 0 ? sirenBacked($s['lat'], $s['lng'], $riverMarks) : null;
}
unset($s);

// --- Sites -------------------------------------------------------------------------------------
// A rainfall gauge, a river gauge and sometimes a camera share one mast, and every feed publishes
// them as separate stations at the same point. 113 pairs hold two or more, and another 46 sit a few
// metres apart because two feeds typed the same mast differently. One place, one `site` key, one
// pin.
//
// Grouped greedily in build order, so the first station at a spot defines it. Measured on 671
// placed stations: 0 m leaves 546 pins, 25 m leaves 435, 50 m leaves 417, then it crawls — 414 at
// 75 m, 408 at 100 m — until 200 m swallows separate installations. The distribution is bimodal:
// sensors are bolted to one mast or hundreds of metres apart, so almost everything worth merging is
// inside 25 m. 50 m buys the 18 masts that straddle a river or span one compound.
$sites = [];
foreach ($stations as &$s) {
    $s['site'] = null;
    if (!$s['lat'] || !$s['lng']) continue;
    foreach ($sites as $key => [$lat, $lng]) {
        $m = hypot($lat - $s['lat'], ($lng - $s['lng']) * cos(deg2rad($lat))) * 111000;
        if ($m <= SITE_M) { $s['site'] = $key; continue 2; }
    }
    $sites[$s['id']] = [$s['lat'], $s['lng']];   // its own id keys the site it starts
    $s['site'] = $s['id'];
}
unset($s);

// --- Trend -------------------------------------------------------------------------------------
// Runs last, over whichever reading won: a rate computed from a level we then overrode would be a
// rate for a number nobody is shown.
// slope and assess are named functions defined above, near ?cam=, so the ?shots= endpoint can reach
// them too. That endpoint returns early and never enters the refresh path below.

foreach ($stations as &$s) {
    if ($s['kind'] !== 'river') continue;
    $key = $s['id'];
    $lvl = $s['level'];
    $s['rate'] = $s['eta'] = null;
    $s['rising'] = false;
    $s['history'] = [];
    $s['ratio'] = ($lvl !== null && ($s['danger'] ?? null)) ? round($lvl / $s['danger'], 3) : null;
    if ($lvl === null) continue;

    $ts = readTs($s['updated'] ?? null, $now);
    $points = $hist[$key] ?? [];
    // Same stamp as the last sample means the same reading came back. Append nothing.
    if (!$points || end($points)[0] !== $ts) $points[] = [$ts, $lvl];
    $hist[$key] = $points;
    $last = count($points) - 1;

    // Hours to its own danger mark at the current rate. Reported whenever it is climbing at all, so
    // the popup can say "4 h away" on a station that isn't flagged — the flag is a cutoff on this
    // number, and a cutoff nobody can see the other side of is just an assertion.
    $mark = $s['danger'] ?? $s['warning'] ?? $s['alert'] ?? null;
    [$rate, $eta] = assess($points, $last, $mark);
    $s['rate'] = $rate === null ? null : round($rate, 3);
    $s['eta']  = $eta;
    // Two consecutive polls, both inside the cutoff. One is a spike.
    $prev = $last > 0 ? assess($points, $last - 1, $mark)[1] : null;
    $s['rising'] = $eta !== null && $eta <= RISE_ETA && $prev !== null && $prev <= RISE_ETA;
    // The SPHTN arrow no longer stands in at cold start: "Rising" is now a claim about reaching a
    // danger mark within hours, and a bare direction arrow is no evidence for that.
    // [unix seconds, metres, status] — the graph plots against the clock, so it needs the clock, and
    // the readout names the band each sample was in.
    $s['history'] = sparkPoints($points, $now, SPARK_BUCKET, false,
        fn($v) => wlStatus($v, $s['alert'] ?? null, $s['warning'] ?? null, $s['danger'] ?? null));
    $samples[$key] = [$ts, $lvl];
}
unset($s);

// --- State + district tidy-up -------------------------------------------------------------------
// No feed publishes a state, so it is taken from *which feed placed the pin*, which is knowledge we
// already have and not a guess from the name: the Selangor API only covers Selangor, SPHTN only
// covers KL and Putrajaya. Guessing from district names would be worse than useless here — KL has a
// Gombak constituency and Selangor has a Gombak district, and they are different places.
// It is stamped where the station is *built*, not here: `source` is later overwritten to 'national'
// wherever that portal's reading wins, which would have relabelled every matched KL river Selangor.
// Known imprecision: SPHTN publishes a few stations just over the KL border (Bentong is in Pahang)
// and they end up filed under Kuala Lumpur. Better a station in the wrong list than one nowhere.
//
// Case is normalised at the same time because the two feeds disagree — "HULU SELANGOR" against
// "Bukit Bintang" — and a filter list mixing both reads as two different data sets.
foreach ($stations as &$s) {
    $s['state'] ??= 'Selangor';                  // set by the SPHTN block; everything else is Selangor
    $s['district'] = $s['district']
        ? mb_convert_case(trim($s['district']), MB_CASE_TITLE, 'UTF-8')
        : null;
}
unset($s);

// Freshness of the readings themselves (upstream stamps them "d/m/Y H:i:s"), not just of our fetch.
$sourceTs = 0;
foreach ($stations as $s) {
    if (empty($s['updated'])) continue;
    $d = DateTime::createFromFormat('d/m/Y H:i:s', $s['updated']);
    if ($d) $sourceTs = max($sourceTs, $d->getTimestamp());
}

/* Weather onto stations. Two joins, because the two feeds key differently. The nowcast joins by
   distance, since MET places its points by town and nothing links them to a station code. The
   forecast joins by district, which needs no coordinates at all.
   This adds no alert surface. Nothing here touches a status, a colour or a count. */
$metMatched = $metDayMatched = 0;

foreach ($stations as &$s) {
    $met = [];

    if ($metPts && $s['lat'] && $s['lng']) {
        $hit = metNearest($s['lat'], $s['lng'], $metPts);
        if ($hit) {
            [$p, $km] = $hit;
            /* The join carries `now` and `hr1` whenever a point is in reach, because the card gives
               each of them a column and "clear" is an answer. Only the span keys — rung, from, to,
               open — depend on there being rain to describe, and metSpan() returns null when there
               is not. The `+` operator keeps the left side, so the two copies of `now` agree by
               construction.
               `stamp` is MET's own issue time for this nowcast, which the card's ⋮ menu prints. It
               is not our poll time and must not become one: this page is cached for SCRAPE_TTL, so a
               reader would otherwise be told a forecast was minutes old when MET issued it an hour
               ago. metPoints() drops any marker whose stamp will not parse, so a point that reaches
               here always has one. */
            $span = metSpan($p['rungs'], $p['clocks']);
            $met = ['at'  => $p['name'], 'km'  => round($km, 1), 'stamp' => $p['stamp'],
                    'now' => $p['rungs'][0], 'hr1' => $p['rungs'][2]] + ($span ?: []);
            $metMatched++;
        }
    }

    /* Kuala Lumpur is one district to MET and thirteen constituencies to JPS — Segambut, Batu,
       Setiawangsa and the rest. Every one of them carries state "Kuala Lumpur", so the state is
       the key there. Every other station keys on district name alone.
       That is safe here, for two measured reasons. MET publishes 157 district
       rows and repeats no name among them, so its map cannot collide with itself. Our own station
       set holds exactly one ambiguous district name, "gombak", which sits in Selangor and in Kuala
       Lumpur. The branch above already separates those two. Re-measure both counts before you widen
       this join to another state. */
    $dk = $s['state'] === 'Kuala Lumpur' ? 'kuala lumpur' : strtolower(trim((string)$s['district']));
    if (isset($metDay[$dk])) {
        $met += $metDay[$dk];
        $metDayMatched++;
    }

    if ($met) $s['met'] = $met;
}
unset($s);

$payload = json_encode([
    'fetched'  => date('c'),
    'stations' => $stations,
    'cacheAge' => 0,
    'ttl'      => TTL,
    'upstreamOk' => true,
    'forced'   => $force,
    // forceWhy explains a refusal. A successful force has nothing to explain, so it publishes null
    // rather than the self-check label ('ok', 'first' or 'clock moved') forceAllowed() returned.
    'forceWhy' => $force ? null : ($forceWhy ?: null),
    'sourceUpdated' => $sourceTs ? date('c', $sourceTs) : null,
    'tookMs'   => (int)round((microtime(true) - $t0) * 1000),
    // Published so the map can draw the mast radius it actually grouped by, rather than keeping a
    // second copy of this number client-side for the two to drift apart.
    'siteM'    => SITE_M,
    // Diagnostics only, like siteM and ttl above: the box this endpoint bounds Nominatim results
    // to, published so curl or the Developer section's Raw payload link shows the real numbers. No
    // client script reads it. js/ui.js's out-of-area message is a hand-written list of state names,
    // which a box cannot generate — a box has no idea it covers "Selangor".
    'box'      => BOX,
    'endpoints' => [
        'StationRainfalls'  => count($rainfallList),
        'StationRiverLevels'=> count($riverList),
        'StationSirens'     => count($get('StationSirens')),
        'StationFloodGauges'=> count($get('StationFloodGauges')),
        'CCTVS'             => count($get('CCTVS')),
    ],
    'details'  => ['requested' => count($detailUrls), 'ok' => count(array_filter($details))],
    // Scrapers fail by returning nothing, so the counts are the alarm: klAdded 0 or natMatched 0
    // means a table layout moved, not that the rivers went quiet.
    'sources'  => [
        'kl'       => ['parsed' => count($kl), 'added' => $klAdded, 'merged' => $klDupes],
        'national' => ['parsed' => count($nat), 'applied' => count($natUsed),
                       'unmapped' => count($nat) - count($natUsed)],
        'met'      => ['parsed' => $metParsed, 'fresh' => count($metPts), 'matched' => $metMatched],
        'metday'   => ['parsed' => count($metDay), 'matched' => $metDayMatched],
        'metwarn'  => ['parsed' => count($metWarn)],
        'portalrf' => ['parsed' => count($prf)],
        // Empty on a healthy poll. A key here names a table the map is drawing from a stored copy.
        'stale'    => $pagesStale,
    ],
    // A regional notice, not a station reading. isHot() and every count in alerts() read the
    // station list alone, and this key feeds neither — see js/alerts.js for the rule.
    'warnings' => $metWarn,
    // Empty on a healthy poll, so a reader of this key needs no special case. See noticeOf().
    'notices'  => $notices,
    'offline'  => count(array_filter($stations, fn($s) => !$s['online'])),
], JSON_UNESCAPED_SLASHES);

$ins = $db->prepare('INSERT OR IGNORE INTO level (station, ts, level) VALUES (?, ?, ?)');
$db->beginTransaction();
foreach ($samples as $k => [$ts, $v]) $ins->execute([$k, $ts, $v]);
$db->exec('DELETE FROM level WHERE ts < ' . ($now - RETAIN));
$db->commit();

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
if (file_put_contents($camTmp, json_encode($camMap), LOCK_EX) === false || !@rename($camTmp, CAM_URLS)) {
    @unlink($camTmp);
}

file_put_contents(CACHE, $payload, LOCK_EX);
/* Not sendPayload(): captureShots() still has to run below, so this exit must not exit either. The
   validators come from the same function as the other two exits.
   The guard is for the deploy target. There the fastcgi branch above answers a reader from stale
   cache, closes the connection, and falls through to here to rebuild. It has already set these
   headers for that reader. Setting them again after the connection closes warns in the log and
   reaches nobody. `headers_sent()` is true exactly in that case and false on every other path. */
if (!headers_sent()) payloadValidators($payload);
echo $payload;

/* Last, and still inside the refresh lock. The payload is already on the wire, so nothing the map
   needs is waiting on this — but with no `fastcgi_finish_request` under Herd the connection cannot
   actually be closed, so one poll in six takes a few seconds longer than the rest. That is the cost
   of not having a background worker; a cron on api.php would spend it where nobody is watching.
   `ignore_user_abort` so a client that gave up doesn't leave a half-written capture behind. */
ignore_user_abort(true);
flush();
captureShots($stations);
