<?php
// The two extra upstreams. Neither publishes JSON — both render server-side HTML tables — so this
// scrapes them. Scraping is fragile by definition, so every parser here is written to fail loudly
// on a *layout* change (row/column counts are returned to the caller and surface in the status
// chip) and quietly on a *data* change (a station missing a cell is skipped, not guessed at).
//
//   publicinfobanjir.water.gov.my  national JPS portal. Authoritative readings and thresholds, but
//                                  publishes NO coordinates and runs 0-30 min behind the state
//                                  feeds — it can never place a pin, only correct one.
//   infobanjirjpskl.water.gov.my   JPS Wilayah Persekutuan (SPHTN). Covers KL, which the Selangor
//                                  API does not, and does carry coordinates.
//
// Parsing is symfony/dom-crawler: CSS selectors over the same libxml engine the rest of PHP uses,
// plus masterminds/html5 for a browser-grade parse of markup neither portal validates. Installed
// into lib/ rather than vendor/, which holds the front end's un-managed JS.

require_once __DIR__ . '/lib/autoload.php';

use Symfony\Component\DomCrawler\Crawler;

const NAT = 'https://publicinfobanjir.water.gov.my/index.php/aras-air/data-paras-air/aras-air-data/';
const KL  = 'https://infobanjirjpskl.water.gov.my/';

// Both portals use -9999 for "station reported nothing". Rendered with thousands separators in one
// place and not the other, so strip those before comparing.
function numOrNull(string $s): ?float {
    $s = str_replace([',', ' '], '', trim($s));
    return ($s === '' || !is_numeric($s) || (float)$s <= -9990) ? null : (float)$s;
}

/** Upstream stamps are MYT, sometimes without seconds. Normalise to the Selangor API's format. */
function myTime(string $s): ?string {
    $s = trim(preg_replace('/\s+/', ' ', $s));
    foreach (['d/m/Y H:i:s', 'd/m/Y H:i'] as $f) {
        $d = DateTime::createFromFormat($f, $s);
        if ($d) return $d->format('d/m/Y H:i:s');
    }
    return null;
}

/**
 * One page as a Crawler. The KL endpoints return bare `<tr>` fragments, which both parsers discard
 * unless they sit inside a table, so everything is wrapped — harmless for a whole document.
 */
function crawl(string $html): Crawler {
    return new Crawler($html === '' ? '<table></table>' : '<table>' . $html . '</table>');
}

$text = fn(Crawler $c) => trim(preg_replace('/\s+/', ' ', $c->text('')));

/**
 * National portal water levels, keyed by JPS station code — the same code the Selangor API exposes
 * as `station_Id` and the KL tables print in their ID column, which is what makes the merge possible.
 * Columns are read by their `data-th` attribute rather than by position, so a reordered or inserted
 * column can't silently shift every reading one place to the left.
 */
function nationalLevels(array $pages): array {
    global $text;
    $out = [];
    foreach ($pages as $html) {
        if (!$html) continue;
        crawl($html)->filter('tr.item')->each(function (Crawler $tr) use (&$out, $text) {
            $r = [];
            $tr->filter('td')->each(function (Crawler $td) use (&$r, $text) {
                $r[$td->attr('data-th') ?? ''] = $text($td);
            });
            $code = $r['Station ID'] ?? '';
            if ($code === '') return;
            $out[$code] = [
                'level'    => numOrNull($r['wl'] ?? ''),
                'alert'    => numOrNull($r['Alert'] ?? ''),
                'warning'  => numOrNull($r['Warning'] ?? ''),
                'danger'   => numOrNull($r['Danger'] ?? ''),
                'updated'  => myTime($r['Last Update'] ?? ''),
                'name'     => $r['Station Name'] ?? '',
                'district' => $r['District'] ?? '',
            ];
        });
    }
    return $out;
}

/** URLs for the national tables. Only the states we can actually put on a map are worth fetching. */
function nationalUrls(array $states = ['SEL', 'WLH', 'PTJ']): array {
    $u = [];
    foreach ($states as $s) $u['nat-' . $s] = NAT . '?state=' . $s . '&district=ALL&station=ALL&lang=en';
    return $u;
}

/* The rainfall district ids, because that table has no working All route.
   `Rainfall/LatestData/All` holds the connection open until the client gives up, and it has done so
   since 07/08/2026. Its water-level twin answers in 3.9 s on the same host, so the host is up and
   one handler on it is not. Each district answers in about a second, so this asks for them one at a
   time. The ids are not a range. 1 to 11 are the districts the site's own dropdown offers. 23, 24,
   25 and 27 carry seven more stations, in Gombak, Pandan, Ampang and Bentong, that the dropdown
   never lists. Measured 2026-08-12: ids 12 to 22, 28 and 30 answer 500, ids 26 and 29 answer 200
   with no rows, and nothing from 31 to 60 carries a row. A fall in `kl.parsed` is the alarm the day
   JPS moves an id. */
const KL_RAIN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 23, 24, 25, 27];

function klUrls(): array {
    $u = ['kl-wl' => KL . 'WaterLevel/LatestData/All'];
    foreach (KL_RAIN as $d) $u["kl-rain-$d"] = KL . 'Rainfall/LatestData/' . $d;
    return $u;
}

/**
 * KL (SPHTN) stations. Column positions are fixed here because these tables carry no `data-th` —
 * the guard is the row width, so a layout change drops the rows and shows up as `klRows: 0` in the
 * diagnostics instead of writing rainfall into the water-level column.
 *
 * Coordinates are only available as arguments to the row's `loadMapPage(lat, lng, …)` onclick.
 */
function klStations(array $pages): array {
    $out = [];

    // 0 no. · 1 code · 2 status · 3 name · 4 district · 5 basin · 6 sub-basin · 7 updated
    // 8 level · 9 normal · 10 alert · 11 warning · 12 danger · 13 trend icon
    foreach (klRows($pages['kl-wl'] ?? '') as [$c, $tds]) {
        [$lat, $lng] = klLatLng($tds->eq(3));
        if ($lat === null) continue;                       // no pin, no point
        $out[] = [
            'kind' => 'river', 'code' => $c[1], 'name' => $c[3], 'district' => $c[4], 'basin' => $c[5],
            'lat' => $lat, 'lng' => $lng,
            'level' => numOrNull($c[8]), 'alert' => numOrNull($c[10]),
            'warning' => numOrNull($c[11]), 'danger' => numOrNull($c[12]),
            'updated' => myTime($c[7]),
        ];
    }

    /* Rainfall arrives one district per page, so the rows are merged before they are read. See
       KL_RAIN above for why there is no single page to read instead. Each page is a whole document,
       so the rows are merged and not the markup. A station belongs to one district, and the codes
       were measured to be unique across every page, so this needs no dedupe. */
    $rain = [];
    foreach ($pages as $k => $html) {
        if (str_starts_with($k, 'kl-rain-')) $rain = array_merge($rain, klRows($html));
    }

    // 0 no. · 1 code · 2 status · 3 name · 4 district · 5 updated · 6-11 last six days · 12 today · 13 last hour
    foreach ($rain as [$c, $tds]) {
        [$lat, $lng] = klLatLng($tds->eq(3));
        if ($lat === null) continue;
        $out[] = [
            'kind' => 'rainfall', 'code' => $c[1], 'name' => $c[3], 'district' => $c[4], 'basin' => null,
            'lat' => $lat, 'lng' => $lng,
            'hourly' => numOrNull($c[13]), 'daily' => numOrNull($c[12]),
            'updated' => myTime($c[5]),
        ];
    }
    return $out;
}

/** Rows of exactly 14 cells, as [cell text, the cells themselves]. Both KL tables are 14 wide. */
function klRows(string $html): array {
    global $text;
    $out = [];
    crawl($html)->filter('tr')->each(function (Crawler $tr) use (&$out, $text) {
        $tds = $tr->children('td');                  // direct children only: these pages nest tables
        if (count($tds) !== 14) return;
        $out[] = [$tds->each($text), $tds];
    });
    return $out;
}

/** `onclick="loadMapPage(3.23545, 101.75, 'Water Level', …)"` is the only place coordinates appear. */
function klLatLng(Crawler $nameCell): array {
    foreach ($nameCell->filter('a')->each(fn(Crawler $a) => $a->attr('onclick') ?? '') as $onclick) {
        if (preg_match('/loadMapPage\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/', $onclick, $m)) {
            return [(float)$m[1], (float)$m[2]];
        }
    }
    return [null, null];
}

/* The national portal's rainfall table. Three requests, one per state, and the two hidden inputs
   the search form carries. Without `loginStatus` and `language` the endpoint returns the form
   itself, which is why CLAUDE.md recorded this endpoint as returning no rows. */
const PRF = 'https://publicinfobanjir.water.gov.my/wp-content/themes/shapely/agency/searchresultrainfall.php';

function portalRainUrls(array $states = ['SEL', 'WLH', 'PTJ']): array {
    $u = [];
    foreach ($states as $s) {
        $u['prf-' . $s] = PRF . '?state=' . $s . '&district=ALL&station=ALL&loginStatus=0&language=1';
    }
    return $u;
}

/* Rows of exactly 13 cells, as [cell text, the cells themselves].
 *
 * NO DATA ROW ON THIS PAGE CARRIES AN OPENING <tr>. The tbody holds one empty row, then about 31
 * stray closing tags, then every row as a bare run of <td> cells ending in </tr>. Both parsers drop
 * a cell that sits outside a row, so crawl()->filter('tr') finds 4 elements here and none of them
 * holds a td child. The existing wrap cannot help: it supplies a missing table, and this page is
 * missing its rows instead.
 *
 * So `portalRows()` splits the body on the closing tag and wraps each chunk as a row of its own.
 * That is a repair, and the 13-cell guard checks that the shape it produced is the shape expected.
 * Measured on the live Selangor page: 239 chunks, all 13 cells.
 *
 * 13 and not 14. The header block names 14 columns at colspan 1 and every data row holds 13 cells,
 * so a parser that trusts the headers reads every value one column to the left in silence. */
function portalRows(string $html): array {
    global $text;
    $out = [];
    foreach (explode('</tr>', $html) as $chunk) {
        if (!str_contains($chunk, '<td')) continue;
        $tds = crawl('<tr>' . $chunk . '</tr>')->filter('tr')->children('td');
        if (count($tds) !== 13) continue;
        $out[] = [$tds->each($text), $tds];
    }
    return $out;
}

/* Portal rainfall stations, one entry per row.
 *
 * 0 no. · 1 code · 2 name · 3 district · 4 updated · 5-10 six daily totals OLDEST first
 * 11 rainfall from midnight (today) · 12 total 1 hour (now)
 *
 * Only cells 0 and 1 carry `data-th`, so this function reads the rest by position under the width
 * guard, the same rule the SPHTN parser obeys. Testing measured the mapping, not read off the
 * headers: against JPS on the 150 stations that join, cell 12 matches the hourly reading on 96% and
 * cell 11 matches the daily on 95%. Read in header order those fall to 49% and 23%.
 *
 * `days` keeps all six because the last of them is yesterday's whole total, which is what bridges a
 * midnight in the running total. See portalOdo() in api.php.
 *
 * `graphId` rides in cell 11's link and is the key the 7 day series takes. A row without the link
 * keeps a null id and simply takes no history backfill.
 *
 * `graphId` IS A STRING, NEVER CAST TO INT. MEASURED against the live SEL/WLH/PTJ pages on
 * 2026-08-15: 308 rows carry a `stationid=` link, and 72 of them — Taman Sri Muda among them —
 * carry a trailing underscore the site's own link puts there, `stationid=3015084_`. The digit run
 * alone, `3015084`, is a DIFFERENT id to the endpoint the id is for: it answers with an empty
 * array, while the id with its underscore answers with the station's own 7 day history. An earlier
 * version of this function cast to `(int)`, which silently drops that underscore and silently
 * empties the backfill for every one of those 72 rows — a quarter of everything this join places.
 * The regex now captures the underscore where the page prints one and nothing where it does not,
 * and seriesUrl() takes the result verbatim. */
function portalRain(array $pages): array {
    $out = [];
    foreach ($pages as $html) {
        if (!$html) continue;
        foreach (portalRows($html) as [$c, $tds]) {
            $days = [];
            for ($i = 5; $i <= 10; $i++) $days[] = numOrNull($c[$i]);
            $href = $tds->eq(11)->filter('a')->count() ? ($tds->eq(11)->filter('a')->attr('href') ?? '') : '';
            $out[] = [
                'code'     => ($c[1] ?? '') === '' ? null : $c[1],
                'name'     => $c[2],
                'district' => $c[3],
                'updated'  => myTime($c[4] ?? ''),
                'days'     => $days,
                'daily'    => numOrNull($c[11]),
                'hourly'   => numOrNull($c[12]),
                'graphId'  => preg_match('/stationid=(\d+_?)/', $href, $m) ? $m[1] : null,
            ];
        }
    }
    return $out;
}

/* The portal's own station search, which is the only place it publishes a coordinate.
   Three characters or more, and it is a SUBSTRING search rather than a prefix one — `q=sg.`
   returned 1,208 rows on 15 August, including names carrying `sg.` in the middle. It answers for
   the whole country, so a caller filters to the states it draws. */
const GAZ = 'https://publicinfobanjir.water.gov.my/wp-content/themes/enlighten/query/searchstation_control.php';

function gazUrl(string $q): string {
    return GAZ . '?' . http_build_query(['q' => $q]);
}

/* `{"loc":[lat,lng],"title":"Name, District, State"}` into something with named parts.
   The title is comma separated and the NAME ITSELF CAN HOLD A COMMA, so the split takes the last
   two parts as district and state and rejoins everything before them as the name.
   A zero coordinate is dropped. JPS publishes those on cameras too, and CAM_FIX exists because a
   coordinate this app invents is worse than none. */
function gazParse(string $json): array {
    $rows = json_decode($json, true);
    if (!is_array($rows)) return [];
    $out = [];
    foreach ($rows as $r) {
        $lat = (float)($r['loc'][0] ?? 0);
        $lng = (float)($r['loc'][1] ?? 0);
        if (!$lat || !$lng) continue;
        // A sentinel is not always zero, so the falsy check above does not catch every bad point.
        // The live station table holds two rows at -9999.0000, -9999.0000 (SUNGAI SENTUL AOP6-3 and
        // AOP7-7), and -9999 is truthy in PHP. Nothing else bounds a placement: gazCorroborated()
        // in api.php only fires where a district already holds 3 stations, so a sparse district
        // waves a sentinel straight through. BOX is [west, north, east, south] — api.php's own
        // coverage box, read here rather than kept as a second copy — a second copy drifts.
        if ($lng < BOX[0] || $lat > BOX[1] || $lng > BOX[2] || $lat < BOX[3]) continue;
        $parts = array_map('trim', explode(',', (string)($r['title'] ?? '')));
        if (count($parts) < 3) continue;
        $state    = array_pop($parts);
        $district = array_pop($parts);
        $out[] = [
            'name' => implode(', ', $parts), 'district' => $district, 'state' => $state,
            'lat'  => $lat, 'lng' => $lng,
        ];
    }
    return $out;
}

/* The station's own 7 day rainfall history — a public JSON feed under the portal's `enlighten`
 * theme, not a scrape. Distinct from GAZ above: that answers a substring search over station
 * NAMES, this answers by `graphId`, the id the rainfall table's own link carries — see
 * portalRain(). A backfill uses it to build a running rainfall total for the days before this app
 * first polled a station, so a 24 and 72 hour window can answer on the first poll rather than
 * after two days of ordinary polling.
 *
 * MEASURED against the live endpoint on 2026-08-15, three stations, up to 8 days each. The field
 * names in the task this function was briefed from do not exist on the real endpoint — `tarikh`,
 * `raw`, `clean` and `chourly` were guesses, and every one is wrong. The real feed carries
 * `date_time` (no seconds), `clean_rainfall`, `cum_hourly` and `cum_daily`. There is no single
 * rolling-total field to confuse with the disjoint bucket, which is the risk the brief warned
 * about — there are two, and neither is the one to sum. See seriesParse() below for which one is.
 */
const SERIES = 'https://publicinfobanjir.water.gov.my/wp-content/themes/enlighten/query/getrainfalllast7days.php';

// A STRING, not an int — see the measurement on portalRain()'s own `graphId` line. Some ids carry
// a trailing underscore the endpoint requires, and (int) silently drops it.
function seriesUrl(string $graphId): string {
    return SERIES . '?' . http_build_query(['station' => $graphId]);
}

/* 7 days of 5 minute buckets, as [unix seconds, mm], ascending.
 *
 * `clean_rainfall` AND NOTHING ELSE. It is the disjoint 5-minute bucket, so disjoint buckets add
 * up — the whole reason this backfill can build a running total for days this app never polled.
 * `cum_hourly` is a rolling window and summing a rolling window counts the same rain many times
 * over.
 *
 * MEASURED on Sg. Selangor di Teluk Penyamun Jeti (F2): a burst from 09:25 to 09:50 pushed
 * `cum_hourly` and `cum_daily` to the same 111.5 together — while nothing had yet fallen out of
 * the rolling hour, a rolling total and a running total read identically. A gap to 10:50 then
 * reset `cum_hourly` to that one bucket alone (0.5) while `cum_daily` kept the running 112.0. Over
 * 8 days on 3 stations, `clean_rainfall` summed across one calendar day reproduced `cum_daily`'s
 * own end-of-day figure exactly, every time.
 *
 * SCORE ANY CHECK OF THIS ON A STATION WITH RAIN IN THE WINDOW. A dry station agrees with either
 * reading — twelve zeros sum to a zero, so it cannot tell a rolling window from a disjoint one.
 *
 * `date_time` parses on DateTime::createFromFormat(), never strtotime(). strtotime() reads a bare
 * slash-separated date as American m/d/y, so a day past 12 fails outright and a day at or under 12
 * only looks right by accident — the same trap myTime() above already guards against on the other
 * two scraped feeds.
 *
 * Stamps are Malaysian wall clock with no offset, the same as every other reading here.
 *
 * A NEGATIVE BUCKET IS SKIPPED, THE SAME RULE numOrNull() ALREADY STATES FOR THIS HOST'S TWO
 * SIBLING FEEDS. Rain over five minutes cannot be negative, so a negative reading is a fault, not
 * a measurement — and this host uses -9999 as its no-reading sentinel on those siblings, so a
 * sentinel here is a live possibility, not a hypothetical one. seedRebase() below builds a running
 * sum out of this series and pins only its LAST value to the live total it joins; one bad bucket
 * anywhere earlier would dip the sum and stay a real backwards step between two adjacent samples,
 * which no constant offset afterward can undo. Skipping the bucket removes it from the sum
 * entirely, so the running total stays non-decreasing by construction rather than by luck.
 */
function seriesParse(string $json): array {
    $rows = json_decode($json, true);
    if (!is_array($rows)) return [];
    $tz = new DateTimeZone('Asia/Kuala_Lumpur');
    $out = [];
    foreach ($rows as $r) {
        $d = DateTime::createFromFormat('d/m/Y H:i', trim((string)($r['date_time'] ?? '')), $tz);
        if (!$d) continue;
        $v = numOrNull((string)($r['clean_rainfall'] ?? ''));
        if ($v === null || $v < 0) continue;
        $out[] = [$d->getTimestamp(), $v];
    }
    usort($out, fn($a, $b) => $a[0] <=> $b[0]);
    return $out;
}

/**
 * The pure half of the history seed's rebasing join — no I/O, no database, so it can be tested
 * offline rather than only by hand against the live drip. `$pts` is a parsed 7-day series
 * (ascending, as seriesParse() returns). `$firstLive` is the earliest `[ts, value]` this app has
 * already stored for the station's own running total, or null where there is none yet. Returns the
 * `[ts, value]` rows to insert; the caller does the fetching and the writing.
 *
 * The seed has to JOIN the running total this app already keeps, not restart it. By the time a
 * station's turn in the drip comes up, live polling may already have written samples for it — a
 * LARGER number at a NEWER timestamp than a seed starting from zero would produce. accWindow()
 * reads a total that only climbs, so a seed ending below the first live sample is a station whose
 * 24 and 72 hour windows go null the moment the two series meet.
 *
 * With no live sample, there is nothing to join to, and the seed is the whole series, starting
 * from zero — the same starting rule portalOdo() uses for a station with no total yet. With one,
 * this keeps only the buckets OLDER than it (the ground the live series already owns is not seeded
 * again) and lets `R` be the raw running total at the last of those. Offsetting every kept value by
 * `firstLive`'s own value minus `R` makes the LAST returned value equal `firstLive`'s value
 * exactly, so the join has no step in it and no direction to go backwards in. Early values may land
 * negative under that offset, which is harmless: accWindow() only ever subtracts two samples, so a
 * constant offset cancels out of every window it touches.
 *
 * A non-decreasing `$pts` in is what makes this return a non-decreasing result — a constant offset
 * cannot repair a dip already inside the sum, only shift the whole line up or down. seriesParse()
 * above is what keeps a bad bucket out of `$pts` in the first place.
 */
function seedRebase(array $pts, ?array $firstLive): array {
    $firstTs = $firstLive !== null ? (int)$firstLive[0] : null;

    $run = 0.0;
    $toInsert = [];
    foreach ($pts as [$ts2, $mm]) {
        $run = round($run + $mm, 1);
        if ($firstTs !== null && $ts2 >= $firstTs) break;   // the live series owns this ground
        $toInsert[] = [$ts2, $run];
    }
    $r      = $toInsert ? end($toInsert)[1] : 0.0;
    $offset = $firstLive !== null ? ((float)$firstLive[1] - $r) : 0.0;

    $out = [];
    foreach ($toInsert as [$ts2, $raw]) $out[] = [$ts2, round($raw + $offset, 1)];
    return $out;
}

/** Water-level status from thresholds: the scraped feeds publish values, not a status code. */
function wlStatus(?float $lvl, ?float $alert, ?float $warning, ?float $danger): int {
    if ($lvl === null) return -1;
    if ($danger  !== null && $lvl >= $danger)  return 3;
    if ($warning !== null && $lvl >= $warning) return 2;
    if ($alert   !== null && $lvl >= $alert)   return 1;
    return 0;
}

/**
 * A flood gauge's rung, from the depth over the spot it watches.
 *
 * Four rungs against two published marks, which is the same shape `gaugeTone()` draws client-side
 * and has to stay so: dry ground is 0, any standing water at all is 1, the 0.15 m warning mark is 2,
 * the 0.3 m danger mark is 3. The middle rung exists because upstream publishes three codes against
 * its two marks, so water shallower than 0.15 m shared a code with dry ground — and a wet spot
 * painted like a dry one is the one thing a flood gauge must never do.
 *
 * Here rather than in the browser for the reason every status is here: one definition. `gaugeTone()`
 * reads the code upstream published for the *current* reading; this scores a stored depth, which
 * upstream never scored at all.
 */
function gaugeStatus(?float $depth, ?float $warning, ?float $danger): int {
    if ($depth === null) return -1;
    if ($depth <= 0) return 0;
    if ($danger  !== null && $depth >= $danger)  return 3;
    if ($warning !== null && $depth >= $warning) return 2;
    return 1;
}

/** JPS rainfall intensity classes (mm in the last hour), as published on the national portal. */
function rainStatus(?float $hourly): int {
    if ($hourly === null) return -1;
    if ($hourly > 60) return 4;
    if ($hourly > 30) return 3;
    if ($hourly > 10) return 2;
    return $hourly > 0 ? 1 : 0;
}

/* --- MET Malaysia nowcast ------------------------------------------------------------------- */

/**
 * MET publishes three rungs in Bahasa. Test "tiada hujan" before "hujan", because the first
 * contains the second and the order is the whole rule.
 *
 * -1 means "MET wrote something this parser does not know". The caller drops the whole marker on
 * it. Do not read an unknown word as clear. That hides a layout change behind calm weather, which is
 * the one way a scraper must not fail.
 */
function metRung(string $word): int {
    $w = strtolower(trim(preg_replace('/\s+/', ' ', $word)));
    if (str_contains($w, 'tiada hujan')) return 0;
    if (str_contains($w, 'lebat'))       return 2;
    if (str_contains($w, 'hujan'))       return 1;
    return -1;
}

/** "03:10 PM" to "15:10". Everything this app prints is 24-hour and Malaysian. */
function metClock(string $ampm): ?string {
    $d = DateTime::createFromFormat('h:i A', trim(preg_replace('/\s+/', ' ', $ampm)));
    return $d ? $d->format('H:i') : null;
}

/**
 * Every point on the nowcast page. The page renders its Leaflet map on the server, so the data is
 * in 294 `L.marker(...)` statements and there is no second request to intercept.
 *
 * Returns one entry per readable marker. `rungs` holds seven values, index 0 being now and index 6
 * being three hours out. `clocks` is parallel to it, with index 0 null because now has no clock.
 *
 * This function drops a marker whole when any of its seven values is unreadable. It drops one that
 * carries fewer than six forecast steps, and one whose stamp will not parse. A drop lowers
 * `sources.met.parsed`, which is the only alarm a silent scraper gets.
 */
function metPoints(string $html): array {
    $out = [];
    preg_match_all(
        "/L\.marker\(\[\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\][^)]*\)\s*\.addTo\([^)]*\)\s*\.bindPopup\('(.*?)'\)/s",
        $html, $ms, PREG_SET_ORDER);

    foreach ($ms as [, $lat, $lng, $pop]) {
        if (!preg_match('/font-bold[^>]*>([^<]+)</', $pop, $n)) continue;
        if (!preg_match('/Sekarang:\s*([^<]+)</', $pop, $now)) continue;
        if (!preg_match('/kemaskini\s*:\s*([\d\/]+\s+[\d:]+\s*[AP]M)/i', $pop, $st)) continue;

        preg_match_all('/(\d\d:\d\d\s*[AP]M)\s*:\s*([^<]+)</i', $pop, $steps, PREG_SET_ORDER);
        if (count($steps) < 6) continue;
        $steps = array_slice($steps, 0, 6);

        $rungs  = [metRung($now[1])];
        $clocks = [null];
        foreach ($steps as [, $when, $what]) {
            $rungs[]  = metRung($what);
            $clocks[] = metClock($when);
        }
        // Index 0 holds null on purpose, because now has no clock. So this test covers steps 1 to 6.
        if (in_array(-1, $rungs, true) || in_array(null, array_slice($clocks, 1), true)) continue;

        $stamp = DateTime::createFromFormat('d/m/Y h:i A', preg_replace('/\s+/', ' ', trim($st[1])),
                                            new DateTimeZone('Asia/Kuala_Lumpur'));
        if (!$stamp) continue;

        $out[] = [
            'name'   => trim(preg_replace('/\s+/', ' ', $n[1])),
            'lat'    => (float)$lat,
            'lng'    => (float)$lng,
            'rungs'  => $rungs,
            'clocks' => $clocks,
            'stamp'  => $stamp->getTimestamp(),
        ];
    }
    return $out;
}

/**
 * The two facts the card sentence needs, out of seven values.
 *
 * The span runs from the FIRST occurrence of the worst rung to the LAST, not across the first
 * unbroken run of it. Measured on one live page, 17 of 137 wet markers hold the worst rung in more
 * than one block — `[0,0,0,1,0,1,1]` is real. First-run logic reports "Rain 16:10 until 16:40" and
 * hides the return. Spanning first to last overstates one dry half hour and understates nothing,
 * which is the direction a flood app must be wrong in.
 *
 * `to` names the step AFTER the last wet one, because MET labels instants and the rain stops
 * somewhere between the two. Naming the later one has the reader wait slightly too long. Naming the
 * earlier one has them stop too early.
 *
 * `open` is true when the worst rung still holds at the final MET step. `to` then carries that final
 * clock, and the card says "past" rather than "until" — the outlook ended, not the rain.
 */
function metSpan(array $rungs, array $clocks): ?array {
    $worst = max($rungs);
    if ($worst < 1) return null;

    $at    = array_keys($rungs, $worst, true);
    $first = $at[0];
    $last  = end($at);
    $open  = $last === count($rungs) - 1;

    return [
        'now'  => $rungs[0],
        'hr1'  => $rungs[2],
        'rung' => $worst,
        'from' => $first === 0 ? null : $clocks[$first],
        'to'   => $open ? $clocks[$last] : $clocks[$last + 1],
        'open' => $open,
    ];
}

/* --- MET Malaysia daily forecast ------------------------------------------------------------ */

/**
 * Forecast temperatures for the day, keyed by lowercase district name.
 *
 * The endpoint answers for three tiers of place — `Ds###` district, `St###` state, `Tn###` town.
 * This parser reads only the district tier. The `api.php` module normalizes a station district
 * field, which gives a join with no coordinates and no radius. A state row carries a name that
 * collides with a district on another feed. Keeping it produces a silent wrong answer.
 *
 * These two numbers forecast the day. MET publishes no free observed temperature. The card must
 * print the word "today" beside them for that reason.
 */
function metDaily(string $json): array {
    $rows = json_decode($json, true);
    if (!is_array($rows)) return [];

    $out = [];
    foreach ($rows as $r) {
        $id   = $r['location']['location_id']   ?? '';
        $name = $r['location']['location_name'] ?? '';
        if (!str_starts_with($id, 'Ds') || $name === '') continue;
        if (!isset($r['min_temp'], $r['max_temp'])) continue;
        $row = ['tmin' => (int)$r['min_temp'], 'tmax' => (int)$r['max_temp']];
        /* `sky` exists because the nowcast has no word for cloud. Its whole vocabulary is
           `Tiada Hujan`, `Hujan` and `Hujan Lebat`, and `Tiada Hujan` means no rain, not clear sky.
           So the map drew a sun over an overcast afternoon and had nothing else to draw.
           This feed does carry cloud. Measured 2026-08-18 over 500 rows, `summary_forecast` holds
           nine values built from four phenomena: no rain, `Mendung`, `Hujan` and `Ribut petir`.
           The four are mutually exclusive on a row, so one word names the day's headline.
           Two of the four are read. `mendung` is cloud and `ribut petir` is a thunderstorm. Rain is
           not, because the nowcast already answers for the instant the map draws, and no rain is
           the absence of a headline. `wxSky()` in js/config.js decides which rungs each of the two
           may touch: cloud refines a dry rung and a storm refines a wet one. The order here is
           belt and braces. The four phenomena do not co-occur on a row, so nothing tested first
           can steal a row from the test after it. */
        $sum = strtolower((string)($r['summary_forecast'] ?? ''));
        if (str_contains($sum, 'ribut petir'))   $row['sky'] = 'storm';
        elseif (str_contains($sum, 'mendung'))   $row['sky'] = 'cloud';
        $out[strtolower(trim($name))] = $row;
    }
    return $out;
}

/**
 * Both MET URLs, keyed for the page cache.
 *
 * The filter limits the forecast to one day, which cuts the response from 585 KB to 103 KB. That
 * puts a date inside the cache key, so the row from the day before dies the moment the date rolls.
 * api.php prunes those, the same way it prunes stale `place:` rows.
 */
function metUrls(int $now): array {
    return [
        'met-now'  => MET_URL,
        'met-day'  => MET_DAY_URL . '?filter=' . date('Y-m-d', $now) . '@date',
        'met-warn' => MET_WARN_URL,
    ];
}

/* The five requests behind the two notice pages this app reads.
 *
 * This app fetches `jps-beat` and never surfaces it. `met_cyclone.json` carries a row at all times.
 * `jps-rain` goes legitimately empty on most days, so that row is the only liveness evidence it
 * has. `WARN_DROP` already holds `no advisory`, so the permanent row can never reach a screen.
 *
 * `data/met_earthquake.json` is absent on purpose. `WARN_DROP` holds `earthquake` and `tsunami`, so
 * every row of that file drops. Fetching it spends a request to discard the answer. */
function jpsUrls(): array {
    return [
        'jps-flood' => JPS_NOTICE . 'query/getdisse.php',
        'jps-rain'  => JPS_NOTICE . 'data/met_rain22.json',
        'jps-storm' => JPS_NOTICE . 'data/met_thunderain2.json',
        'jps-sea'   => JPS_NOTICE . 'data/met_gelora.json',
        'jps-beat'  => JPS_NOTICE . 'data/met_cyclone.json',
    ];
}

/* --- lenient JSON ---------------------------------------------------------------------------- */

/* JPS writes raw newline characters inside JSON string values, so `json_decode()` returns null on
   `met_gelora.json`. The failure is silent, because a null decode and an empty feed look the same
   to a caller that tests `is_array()`. So this returns null for one and an empty array for the
   other, and the liveness rule in api.php reads that difference.
 *
 * The scan tracks whether the cursor sits inside a string literal and honors the backslash escape.
 * It escapes any control character it finds inside a string. It changes nothing outside one.
 *
 * Measured 2026-08-17 against all five JPS MET files. Four decode the same either way.
 * `met_gelora.json` goes from a parse failure to 2 rows. */
function jsonLoose(string $s): ?array {
    $out = '';
    $in  = false;
    $esc = false;
    $n   = strlen($s);
    for ($i = 0; $i < $n; $i++) {
        $c = $s[$i];
        if ($esc) {
            $out .= ord($c) < 0x20 ? match ($c) {
                "\n"    => '\\n',
                "\r"    => '\\r',
                "\t"    => '\\t',
                default => sprintf('\\u%04x', ord($c)),
            } : $c;
            $esc = false;
            continue;
        }
        if ($c === '\\' && $in)  { $out .= $c; $esc = true;  continue; }
        if ($c === '"')          { $in = !$in; $out .= $c;   continue; }
        if ($in && ord($c) < 0x20) {
            $out .= match ($c) {
                "\n"    => '\\n',
                "\r"    => '\\r',
                "\t"    => '\\t',
                default => sprintf('\\u%04x', ord($c)),
            };
            continue;
        }
        $out .= $c;
    }
    $j = json_decode($out, true);
    return is_array($j) ? $j : null;
}

/* --- MET Malaysia warnings ------------------------------------------------------------------ */

/* Rows this map never shows. A seismic warning and an empty advisory say nothing about the weather
   here. */
const WARN_DROP = ['earthquake', 'tsunami', 'gempa', 'no advisory', 'tiada'];

/* Rows about the sea. Most name water this map does not reach, so they drop by default. */
const WARN_SEA = ['rough sea', 'strong wind', 'angin kencang', 'laut bergelora'];

/* The words MET uses when a warning is about water rather than land. The heading alone misses
   these rows: a storm at sea and a storm over a town are both "Warning on Thunderstorms". */
const WARN_WATER = ['waters of', 'perairan'];

/* How long a warning keeps interrupting. Measured from the start of its own validity, not from
   when we first read it — a warning issued overnight is already old when somebody opens the page
   at eight, and stamping it fresh then would restart a clock MET has already run down.
   Six hours, because MET issues these with hours of lead and the useful window is the early one.
   The panel is unaffected and lists a warning for its whole validity. Only the ticker reads this. */
const WARN_FRESH = 21600;

/* The one stretch of sea that counts. The Straits of Melaka is the Selangor coast. Port Klang
   stands on it, so rough water there reaches the area this map covers. Water off Phuket, Samui,
   Layang-Layang, Palawan and Sulu does not. A marine row survives only by naming these straits. */
const WARN_SEA_KEEP = ['straits of melaka', 'straits of malacca', 'selat melaka'];

/* The straits run about 800 km, and naming them is not the same as naming our stretch of them.
   MET writes "the waters of Northern Straits of Melaka and Samui" for water off Kedah, Penang and
   Thailand, roughly 300 km from Port Klang. That row contains "straits of melaka" and passed the
   list above on those three words alone, which put a warning about Thai water on the ticker.
   So a far stretch is cut out of the text before the keep test reads it, rather than blocked by a
   test of its own. Cutting rather than blocking is what keeps a row naming two stretches: strip
   the northern mention from "Northern Straits of Melaka and Central Straits of Melaka" and the
   central one still answers. A row that names only the far stretch has nothing left to match. */
const WARN_SEA_FAR = ['northern straits of melaka', 'northern straits of malacca',
                      'utara selat melaka', 'selat melaka utara'];

/* The places this map covers. A warning over land must name one of them.
   The last pair is wider than the rest on purpose. MET names some warnings by coast, not by
   state, and Selangor sits on the west coast of the peninsula. A row that reads "the west coast
   of Peninsular Malaysia" reaches this map without naming it.
   A warning for the whole peninsula still drops. Add 'semenanjung' and 'peninsular' the day that
   trade goes the other way, and expect more warnings about other states too. */
const WARN_HERE = ['selangor', 'kuala lumpur', 'putrajaya', 'lembah klang', 'klang valley',
                   'wilayah persekutuan', 'west coast', 'pantai barat'];

/* Does this text name somewhere this map covers?
 *
 * A marine text has a second way in: our stretch of the Straits of Melaka, with the far stretch cut
 * out before the keep test reads it. Cutting rather than testing is what keeps a text naming two
 * stretches — strip the northern mention from "Northern Straits of Melaka and Central Straits of
 * Melaka" and the central one still answers. CLAUDE.md names the row that needed this rule.
 *
 * The straits are open to a marine text alone. A land text must name a state or a district. */
function hereNames(string $text, bool $sea): bool {
    $where = strtolower($text);
    foreach (WARN_HERE as $k) if (str_contains($where, $k)) return true;
    if (!$sea) return false;
    foreach (WARN_SEA_FAR as $f) $where = str_replace($f, '', $where);
    foreach (WARN_SEA_KEEP as $k) if (str_contains($where, $k)) return true;
    return false;
}

/* Keep only the parts of a bulletin that name somewhere this map covers.
 *
 * MET writes one warning across several regions in one row. `met_gelora.json` carried 1,795
 * characters across 16 lines on 2026-08-17. It names Sarawak, Sabah, Selangor, Perlis, Kedah and
 * Perak together.
 *
 * A row-level place test keeps that row on one word. The panel then prints a wall of text that is
 * mostly about Borneo. On the measured row this returns a single 203-character sentence.
 *
 * The split runs on a newline or on a period followed by a space. A period inside a number carries
 * no space after it, so "4.5 meters" stays whole.
 *
 * An empty return means the text names nowhere here. The caller decides what that means. The gate
 * is a separate test on the combined English and Malay text, and this narrows the English alone. */
function hereParts(string $text, bool $sea): string {
    $keep = [];
    foreach (preg_split('/\n+|(?<=\.)\s+/', $text) as $part) {
        $p = trim($part);
        if ($p !== '' && hereNames($p, $sea)) $keep[] = $p;
    }
    return implode(' ', $keep);
}

/**
 * Every MET warning live at $now, newest first.
 *
 * metWarnings() drops a row on five tests. It drops a row whose stamps do not parse. It drops a
 * row outside its own validity window. It drops a seismic warning or an empty advisory. It drops a
 * row that names nowhere this map covers. It drops a row that repeats a title and text it already
 * kept.
 *
 * The place test uses one of two word lists. A marine row must name the Straits of Melaka: that
 * water is the Selangor coast. Every other row must name a state or district here.
 */
function metWarnings(string $json, int $now): array {
    $rows = json_decode($json, true);
    if (!is_array($rows)) return [];

    $out = [];
    $seen = [];
    foreach ($rows as $r) {
        /* `heading_en` is this row's own heading. `warning_issue.title_en` is the bulletin it
           arrived in, and one bulletin carries rows of different severities: five rows of one
           sample all read "Third Category Warning on Strong Winds and Rough Seas" while their own
           headings read Third Category, Second Category, First Category and, twice, a thunderstorm
           warning. Printing the bulletin title states a severity MET did not give this row, which
           is the one thing an alert surface must never invent. The bulletin title is the fallback,
           because a row with no heading still needs a name. */
        $title = trim((string)($r['heading_en'] ?? ''));
        if ($title === '') $title = trim((string)($r['warning_issue']['title_en'] ?? ''));
        $text  = trim((string)($r['text_en'] ?? ''));
        if ($title === '' && $text === '') continue;

        $from = strtotime((string)($r['valid_from'] ?? ''));
        $to   = strtotime((string)($r['valid_to'] ?? ''));
        if (!$from || !$to || $now < $from || $now > $to) continue;

        $hay = strtolower($title . ' ' . (string)($r['heading_en'] ?? ''));
        foreach (WARN_DROP as $bad) if (str_contains($hay, $bad)) continue 2;

        /* The place test reads English and Malay text, because MET writes some rows in one
           language only. */
        $where = strtolower($text . ' ' . (string)($r['text_bm'] ?? ''));

        /* Is this row about water? The heading is not enough on its own. MET files a storm over
           the sea as "Warning on Thunderstorms", the same words it uses over land, so a heading
           test alone reads a marine row as a land one and judges it by the wrong list. The text
           says which it is: MET writes "over the waters of" for a marine row every time. */
        $sea = false;
        foreach (WARN_SEA as $s) if (str_contains($hay, $s)) { $sea = true; break; }
        if (!$sea) foreach (WARN_WATER as $s) if (str_contains($where, $s)) { $sea = true; break; }

        /* The gate reads the combined English and Malay text. MET writes some rows in one
           language only. This gate does not change, so it keeps every row it kept before. */
        if (!hereNames($where, $sea)) continue;

        /* The displayed text narrows to the parts naming somewhere this map covers. It falls back
           to the whole English text, because a row can qualify on its Malay half alone and then
           have nothing to narrow. */
        $narrow = hereParts($text, $sea);
        if ($narrow !== '') $text = $narrow;

        $key = $title . '|' . $text;
        if (isset($seen[$key])) continue;
        $seen[$key] = true;

        /* `fresh` is how long this warning still interrupts, and it is scored here rather than in
           the browser for the same reason a status is: MET stamps Malaysian wall clock with no
           offset, so a reader in another zone would age it by their own clock and get a different
           answer. This file already runs pinned to Asia/Kuala_Lumpur.
           The alert panel lists a warning for its whole validity. The ticker carries it only while
           `fresh`. One live sample was valid for three days, and a strip that repeats the same
           sentence for three days is the standing banner nobody reads by the second — the exact
           thing the alert design standard warns about. The split follows what the two surfaces are
           for: the panel is a directory you open, the ticker is an interruption you did not ask
           for. An interruption has to end. The directory does not. */
        /* The ISO shape, not the raw field. `jpsMetWarnings()` and `floodAlerts()` both normalize to
           this same shape, because `warnWhen()` in js/ui.js tests for it and the merge sort in
           mergeNotices() is a strcmp over this field. Both held today only because
           api.data.gov.my happens to already emit a `T` between the date and the time — state the
           shape by construction instead of relying on that. */
        $out[] = ['title' => $title, 'text' => $text,
                  'from' => date('Y-m-d\TH:i:s', $from), 'to' => date('Y-m-d\TH:i:s', $to),
                  'fresh' => ($now - $from) < WARN_FRESH,
                  // One array carries every notice, and these two separate them. `weather` renders
                  // as this row always has. See mergeNotices().
                  'kind' => 'weather', 'src' => 'met'];
    }
    usort($out, fn($a, $b) => strcmp($b['from'], $a['from']));
    return $out;
}

/* --- the JPS mirror of the MET bulletins ----------------------------------------------------- */

/* `publicinfobanjir.water.gov.my/ramalan/met-alert/` reads five static JSON files. They mirror the
 * same MET bulletins `api.data.gov.my/weather/warning` carries, and they mirror them fresher.
 *
 * Measured 2026-08-17. Every data.gov.my row carried an issue stamp of 2026-08-10. This mirror
 * answered with rows issued that morning. Two of them named the waters of Selangor.
 *
 * The row shape belongs to JPS. Every rule below is the rule `metWarnings()` already applies,
 * reading a differently named field.
 *
 * This app does not fetch `met_earthquake.json`. `WARN_DROP` holds `earthquake` and `tsunami`, so
 * every row of that file drops. Fetching it spends a request to discard the answer. */
function jpsMetWarnings(string $json, int $now): array {
    $rows = jsonLoose($json);
    if ($rows === null) return [];

    $out = [];
    foreach ($rows as $r) {
        if (!is_array($r)) continue;

        /* `Heading_EN` is the heading for this row. `Title_EN` names the bulletin kind, and it
           repeats across rows of different severities. So `Title_EN` is the fallback and never the
           first choice. `metWarnings()` already states this rule about `warning_issue.title_en`. */
        $title = trim((string)($r['Heading_EN'] ?? ''));
        if ($title === '') $title = trim((string)($r['Title_EN'] ?? ''));
        $text  = trim((string)($r['Msg_EN'] ?? ''));
        $bm    = trim((string)($r['Msg_MY'] ?? ''));
        if ($title === '' && $text === '') continue;

        /* JPS stamps `17-08-2026 08:00:00`. `strtotime()` reads that correctly, because PHP assumes
           the European d-m-y order when the separator is a dash. Measured 2026-08-17. */
        $from = strtotime((string)($r['Valid_from'] ?? ''));
        $to   = strtotime((string)($r['Valid_to'] ?? ''));
        if (!$from || !$to || $now < $from || $now > $to) continue;

        $hay = strtolower($title);
        foreach (WARN_DROP as $bad) if (str_contains($hay, $bad)) continue 2;

        /* Is this row about water? The heading is not enough on its own. MET files a storm over the
           sea as "Warning on Thunderstorms", the same words it uses over land. */
        $where = strtolower($text . ' ' . $bm);
        $sea = false;
        foreach (WARN_SEA as $s) if (str_contains($hay, $s)) { $sea = true; break; }
        if (!$sea) foreach (WARN_WATER as $s) if (str_contains($where, $s)) { $sea = true; break; }

        if (!hereNames($where, $sea)) continue;
        $narrow = hereParts($text, $sea);
        if ($narrow !== '') $text = $narrow;

        /* The ISO shape, because `warnWhen()` in js/ui.js tests for it and prints the raw string
           otherwise. The merge sort is a strcmp over this field for the same reason. */
        $out[] = ['title' => $title, 'text' => $text,
                  'from' => date('Y-m-d\TH:i:s', $from), 'to' => date('Y-m-d\TH:i:s', $to),
                  'fresh' => ($now - $from) < WARN_FRESH,
                  'kind' => 'weather', 'src' => 'jps'];
    }
    return $out;
}

/* --- the JPS flood alert --------------------------------------------------------------------- */

/* The notification types `getdisse.php` publishes, and the word each one gets on screen.
 *
 * The three withdrawals are absent on purpose. `NT_TM` Termination, `NT_RC` Recall and `NT_NF` No
 * Flood all cancel an earlier alert.
 *
 * Every surface here renders a notice only inside its validity window. An alert that ended leaves
 * the panel without help. A withdrawal row restates that. It also appears alone whenever the alert
 * it withdraws expired between two polls. */
const FLOOD_KEEP = [
    'NT_7D'  => 'Early',
    'NT_2D'  => 'Final',
    'NT_UP'  => 'Update',
    'NT_DF'  => 'Siren',
    'NT_MET' => 'Meteorological',
];

/* The JPS flood forecast, from `publicinfobanjir.water.gov.my/ramalan/amaran-banjir/`.
 *
 * This is the only true flood alarm among the three notice feeds. It carries a validity window, an
 * update type and a withdrawal path. That is what the alert design standard asks an alert to have.
 *
 * THIS PARSER HAS NEVER SEEN A ROW. `getdisse.php` answered `[]` on every fetch during the design.
 * The field names come from the consumer JavaScript on the JPS page.
 *
 * That is evidence and not a guess, and nobody has tested it against real data. The first non-empty
 * response is the moment to check it by hand. Do not widen it to handle a shape nobody has seen.
 *
 * The row carries map geometry too. Nothing plots it, so nothing here parses it. */
function floodAlerts(string $json, int $now): array {
    /* `jsonLoose()`, not `json_decode()`. JPS writes raw newline characters inside JSON string
       values — see jsonLoose()'s own comment, and pageHasData()'s `jps-` arm, which already accepts
       this body on that ground. A `json_decode()` here disagreed with the acceptance gate: a body
       with a raw newline in POINew passed pageHasData() and got stored, then read as zero rows by
       this function. Nothing named the loss, because the fetch had in fact succeeded. */
    $rows = jsonLoose($json);
    if (!is_array($rows)) return [];

    $out = [];
    foreach ($rows as $r) {
        if (!is_array($r)) continue;

        $code = (string)($r['NotificationTypeCode'] ?? '');
        if (!isset(FLOOD_KEEP[$code])) continue;

        /* JPS operators hide a message through their own `update_showhidefloodalert.php` endpoint.
           That flag is a decision the source made, and this app does not overrule a source. */
        if ((string)($r['hide'] ?? '0') === '1') continue;

        /* This needs both ends. Nothing can retire a row with no end, and every surface here
           renders inside a window. `EstimatedDT` is the forecast start and `MessageDT` is when JPS
           issued the message, so the first is the better start and the second is the fallback. */
        $from = strtotime((string)($r['EstimatedDT'] ?? '')) ?: strtotime((string)($r['MessageDT'] ?? ''));
        $to   = strtotime((string)($r['EstimatedEndDT'] ?? ''));
        if (!$from || !$to || $now > $to) continue;

        /* `POINew` is a `!`-delimited list of the points this alert names. A reader needs the
           places, not the delimiter. */
        $pois = array_values(array_filter(array_map('trim', explode('!', (string)($r['POINew'] ?? '')))));
        $state = trim((string)($r['State'] ?? ''));

        /* A flood alert is about land, so the straits test does not apply. The state carries a row
           alone. A point list this app cannot read is no reason to drop a flood forecast. */
        if (!hereNames($state . ' ' . implode(' ', $pois), false)) continue;

        /* `fresh` is how long this keeps interrupting, so it measures from when JPS issued the
           message and never from the forecast start. An NT_7D Early alert names a window seven days
           out. Measured from that start, `$now - $from` goes negative and the test is trivially
           true, so one tile would hold the ticker for a week. That is the standing banner the alert
           design standard rejects.
           No fallback to `$from`. On an NT_7D row `$from` is the forecast start, which is in the
           future, so falling back there makes `fresh` trivially true and the tile holds the ticker
           for a week — the exact failure this seam exists to prevent, reopened through the
           fallback. With no parseable issue time the row still lists in the panel and simply never
           interrupts. A missed interruption beats a banner that does not end. */
        $said = strtotime((string)($r['MessageDT'] ?? ''));

        $out[] = ['title' => 'Flood alert · ' . FLOOD_KEEP[$code],
                  'text'  => $pois ? implode(', ', $pois) . ($state !== '' ? " ($state)" : '') : $state,
                  'from'  => date('Y-m-d\TH:i:s', $from),
                  'to'    => date('Y-m-d\TH:i:s', $to),
                  'fresh' => $said && ($now - $said) < WARN_FRESH,
                  'kind'  => 'flood', 'src' => 'jps'];
    }
    return $out;
}

/* --- one array, and the two ways a notice feed announces its own death ------------------------ */

/* Every producer emits one row shape. So the merge is a concatenation, a sort and the duplicate
 * test `metWarnings()` already ran inside one source.
 *
 * The key is the title and the validity window. It is NOT the text.
 *
 * A JPS notice feed is an archive of reissues, not a picture of now. MET reissues one standing
 * bulletin every few hours, under one heading and one window. `met_gelora.json` held 18 rows on
 * 2026-08-18. Eight of those were one bulletin valid 17 August to 21 August, reissued eight times.
 *
 * Each reissue rewords its own list of areas. `hereParts()` then narrows each one to the sentences
 * that name somewhere this map covers. So three of those eight reached three different strings. A
 * key over the text read them as three warnings, and a reader met one bulletin three times.
 *
 * The window is what identifies a bulletin. The text is what changes between issues of it.
 *
 * The newest issue wins, and the order is what decides that. `usort()` is stable in PHP 8. JPS
 * publishes newest first, and `jpsMetWarnings()` keeps that order. So the first row for a key is
 * the newest issue of it. Check that claim again before you sort this array anywhere else.
 *
 * The key lowercases the title. JPS writes a heading in capitals and `data.gov.my` does not.
 *
 * KNOWN LIMIT. The two MET sources word one bulletin differently. JPS writes "SECOND CATEGORY
 * WARNING ON STRONG WINDS AND ROUGH SEAS" where data.gov.my writes "Warning on Strong Wind and
 * Rough Seas (Second Category)".
 *
 * An exact key cannot join those, so a reader can meet one bulletin twice while both sources run.
 * That is visible rather than silent, which is the trade taken here. A fuzzy key invents a match,
 * and a wrong join hides a real warning. */
function mergeNotices(array ...$sets): array {
    $all = array_merge(...$sets);
    /* A strcmp is enough because every producer emits ISO. See jpsMetWarnings() for why. */
    usort($all, fn($a, $b) => strcmp((string)$b['from'], (string)$a['from']));

    $out  = [];
    $seen = [];
    foreach ($all as $r) {
        $k = strtolower(trim((string)$r['title'])) . "\x00"
           . (string)$r['from'] . "\x00" . (string)$r['to'];
        if (isset($seen[$k])) continue;
        $seen[$k] = true;
        $out[] = $r;
    }
    return $out;
}

/* The newest issue stamp in a RAW notice body, or 0 where the body holds no row.
 *
 * This reads the feed and not the filtered output. `met-warn` yielded 0 rows through the geography
 * filter on 2026-08-17 and still held 7 rows upstream, every one issued on 2026-08-10. The
 * staleness lives in the feed, so the test has to read the feed.
 *
 * The `jps-` branch assumes a body shaped like the met_*.json mirror, which carries `Valid_from`.
 * `getdisse.php` carries `EstimatedDT` instead and answers 0 here. Task 6 keeps `jps-flood` out of
 * the age loop for that reason. A caller that adds it needs a field for it first. */
function noticeNewest(string $key, string $body): int {
    $jps  = str_starts_with($key, 'jps-');
    $rows = $jps ? jsonLoose($body) : json_decode($body, true);
    if (!is_array($rows)) return 0;

    $field = $jps ? 'Valid_from' : 'valid_from';
    $t = 0;
    foreach ($rows as $r) {
        if (!is_array($r)) continue;
        $t = max($t, strtotime((string)($r[$field] ?? '')) ?: 0);
    }
    return $t;
}

/* Did this source answer with nothing recent?
 *
 * Zero rows is NOT old. A calm day is the ordinary state of a warning feed, and an alarm on quiet
 * is the cry-wolf failure the alert design standard rejects.
 *
 * The heartbeat below covers a feed that goes legitimately empty. This is a different fault from
 * `sources.stale`, which names a page that did not answer at all. */
function noticeOld(string $key, string $body, int $now, int $max): bool {
    $t = noticeNewest($key, $body);
    return $t > 0 && $t < $now - $max;
}

/* `met_cyclone.json` carries a row at all times. It read `No Advisory` on 2026-08-17.
 * `WARN_DROP` already holds `no advisory`, so the heartbeat can never reach a surface. It needs no
 * new rule to keep it off one.
 *
 * An empty or unreadable file marks the whole JPS MET mirror as old. `jps-rain` goes legitimately
 * empty on most days, so this is the only liveness evidence it has. */
function beatDead(string $body): bool {
    $rows = jsonLoose($body);
    return $rows === null || $rows === [];
}

/* --- MET nowcast, as a map layer ------------------------------------------------------------- */

/**
 * A stable key for one MET nowcast point.
 *
 * The name is the only identity MET publishes. A coordinate is a float and it moves when MET nudges
 * a marker, so it cannot key a database row. A rename orphans the history for that point instead,
 * and RETAIN prunes the orphan 30 days later.
 */
function wxSlug(string $name): string {
    $s = strtolower(trim(preg_replace('/\s+/', ' ', $name)));
    return trim(preg_replace('/[^a-z0-9]+/', '-', $s), '-');
}

/**
 * The points inside the coverage box.
 *
 * `$box` is [west, north, east, south], the order api.php states for BOX.
 */
function wxInBox(array $pts, array $box): array {
    [$w, $n, $e, $s] = $box;
    return array_values(array_filter($pts, fn($p) =>
        $p['lng'] >= $w && $p['lng'] <= $e && $p['lat'] <= $n && $p['lat'] >= $s));
}
