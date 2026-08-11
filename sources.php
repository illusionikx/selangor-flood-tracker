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

function klUrls(): array {
    return ['kl-wl' => KL . 'WaterLevel/LatestData/All', 'kl-rf' => KL . 'Rainfall/LatestData/All'];
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

    // 0 no. · 1 code · 2 status · 3 name · 4 district · 5 updated · 6-11 last six days · 12 today · 13 last hour
    foreach (klRows($pages['kl-rf'] ?? '') as [$c, $tds]) {
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
        // Index 0 is deliberately null — now has no clock — so only steps 1 to 6 are tested.
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
