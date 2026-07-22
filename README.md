# Klang Valley Flood Watch

Live flood telemetry for Selangor, Kuala Lumpur and Putrajaya on one interactive map, merged from
three JPS (Jabatan Pengairan dan Saliran) sources that each publish part of the picture.

The official portals split their stations across separate tabs and tables, one per state and one per
sensor type. This pulls them into a single Leaflet map, adds trend and threshold context none of the
sources expose, and keeps working when an upstream goes down.

## What it shows

| Layer | Data |
|---|---|
| River level | Current metres, alert / warning / danger thresholds, rate of rise, hours to danger |
| Rainfall | Last hour and today in mm, hourly history, status from none to very heavy |
| Flood gauge | Flood depth over the marked spot (negative = dry ground) |
| Siren | Triggered / idle, and when it last checked in |
| CCTV | Latest still from the camera, with timestamp |

Every station carries its district, state and main river basin, plus which feed its reading came
from — the three sources disagree by a few centimetres, and an unattributed number would read as a
bug rather than as normal.

## Sources

| Source | Provides |
|---|---|
| [Public Infobanjir](https://publicinfobanjir.water.gov.my/) | National JPS. Water levels and thresholds; takes priority wherever it carries a station |
| [JPS Selangor](https://infobanjirjps.selangor.gov.my/) | Selangor stations, and the only source for cameras, sirens and gauges |
| [JPS Wilayah Persekutuan](https://infobanjirjpskl.water.gov.my/) | Kuala Lumpur and Putrajaya |

Only the first publishes JSON — no CORS headers, hence the server-side proxy. The other two are
scraped from their HTML tables, which is why `sources.php` reads columns by attribute where the
markup allows it and guards on row width where it doesn't.

## Beyond the sources

- **Rate of rise** — upstream reports a level but no direction. [api.php](api.php) keeps its own
  samples and derives dH/dt in metres per hour, the standard hydrological measure.
- **Hours to danger** — a station is "on alert" when, at the rate it is climbing now, it would reach
  *its own* danger mark within three hours. A fixed m/h can't do that job: 0.2 m/h is a quiet
  afternoon on a big river 4 m below danger and an emergency on a drain 30 cm below it.
- **Graphs on a real time axis** — level as a line, rainfall as bars (rain is an amount collected
  over a period, so a line between two readings would claim a value that never existed).
- **One mast, one pin** — a rainfall gauge, a river gauge, a siren and a camera on the same pole are
  published as four stations at one coordinate. They are grouped into one pin with one popup.
- **Stale over blank** — if upstream is unreachable, the last good payload is served with
  `upstreamOk: false` and its age, rather than an empty map.
- **CCTV over HTTPS** — upstream advertises camera stills over plain http, which an https page
  can't load. They're proxied server-side, and only for camera ids already in the cache. (The static
  build hotlinks them instead: the same files are served over TLS, they're just not advertised.)

## Running it

Needs PHP 8.2+ with cURL, DOM and pdo_sqlite, plus [Composer](https://getcomposer.org) for the one
server-side dependency.

```bash
composer install          # writes lib/ — the app fatals without it
php -S localhost:8000
```

Then open http://localhost:8000. On [Herd](https://herd.laravel.com) or Valet, just visit the site
link — no config.

The front end has no build step and no dependencies: `index.html` loads ES modules directly, and
Leaflet and the fonts are vendored in `vendor/`.

`.cache.json` and `.history.db` are written next to `api.php` and are gitignored. Delete them to
reset — but note that deleting `.history.db` discards the level history, so trends and graphs go
blank for an hour while they rebuild.

## Hosting it on GitHub Pages

Pages serves files, not PHP, so [the workflow](.github/workflows/pages.yml) runs the PHP itself on a
15-minute schedule and publishes the result as `api.json` beside the static assets. Enable it once:
make the repo public, then set **Settings → Pages → Source** to *GitHub Actions*. It also runs on
push, so the first deploy doesn't wait for the cron.

The two builds differ by one line — `STATIC` in [js/config.js](js/config.js), flipped by the bake.
It decides whether the page fetches `api.json` or `api.php`, and whether camera stills come from the
proxy or straight from upstream over TLS.

What that costs: cron is best-effort and often late, so the map runs 15–30 minutes behind rather
than 5. GitHub disables the schedule after 60 days without a commit. The level history rides in the
Actions cache, which is evicted after 7 days unused — the schedule keeps it warm, but a long quiet
spell will cost the samples. If liveness matters more than the zero bill, run it on any host with
PHP and cron and none of this applies.

## Layout

    index.html   markup only — no inline CSS or JS
    api.php      proxy, cache, source merge, history, CCTV passthrough
    sources.php  scrapers for the two HTML-only feeds
    css/ js/     styles and ES modules, one concern per file
    vendor/      Leaflet + plugins + fonts, hand-vendored so there's no build step
    lib/         Composer's vendor dir (gitignored — *not* vendor/)
    docs/        what exists and why, including what was deliberately not built
    .github/     the Pages bake — runs the PHP on a schedule so Pages can serve it static

## Notes

Data is republished from JPS and is only as fresh and correct as the source. This is not an official
service and not an official warning channel — for a safety decision, check
[publicinfobanjir.water.gov.my](https://publicinfobanjir.water.gov.my/) and follow JPS and NADMA
directly.
