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
        $out[strtolower(trim($name))] = ['tmin' => (int)$r['min_temp'], 'tmax' => (int)$r['max_temp']];
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

/* --- MET Malaysia warnings ------------------------------------------------------------------ */

/* Rows this map never shows. A seismic warning and an empty advisory say nothing about the weather
   here. */
const WARN_DROP = ['earthquake', 'tsunami', 'gempa', 'no advisory', 'tiada'];

/* Rows about the sea. Most name water this map does not reach, so they drop by default. */
const WARN_SEA = ['rough sea', 'strong wind', 'angin kencang', 'laut bergelora'];

/* The words MET uses when a warning is about water rather than land. The heading alone misses
   these rows: a storm at sea and a storm over a town are both "Warning on Thunderstorms". */
const WARN_WATER = ['waters of', 'perairan'];

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

        /* A row survives by naming somewhere this map covers. A marine row has a second way in:
           our stretch of the straits, with the far stretch cut out first. Both ways are open to a
           marine row on purpose — "the waters of Selangor" names the coast without naming the
           straits, and it is as much our weather as the straits are. */
        $near = false;
        foreach (WARN_HERE as $k) if (str_contains($where, $k)) { $near = true; break; }
        if (!$near && $sea) {
            foreach (WARN_SEA_FAR as $f) $where = str_replace($f, '', $where);
            foreach (WARN_SEA_KEEP as $k) if (str_contains($where, $k)) { $near = true; break; }
        }
        if (!$near) continue;

        $key = $title . '|' . $text;
        if (isset($seen[$key])) continue;
        $seen[$key] = true;

        $out[] = ['title' => $title, 'text' => $text,
                  'from' => (string)$r['valid_from'], 'to' => (string)$r['valid_to']];
    }
    usort($out, fn($a, $b) => strcmp($b['from'], $a['from']));
    return $out;
}
