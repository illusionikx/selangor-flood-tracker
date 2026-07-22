# Selangor Flood Watch

Track and reorganize data of flood, siren and river camera with data from
[Info Banjir JPS Selangor](https://infobanjirjps.selangor.gov.my) into one single interactive map.

The official portal splits its stations across separate tabs and tables. This pulls all of them
into a single Leaflet map, adds trend and threshold context the source doesn't expose, and keeps
working when upstream goes down.

## What it shows

| Layer | Data |
|---|---|
| Rainfall | Hourly and daily mm, status from none to very heavy |
| River level | Current metres, alert / warning / danger thresholds, level as a ratio of danger |
| Flood gauge | Flood depth over the marked spot (negative = dry ground) |
| Siren | Location and online state |
| CCTV | Latest still from the camera, with timestamp |

Every station carries its district and main river basin, plus whether the station itself is online.

## Beyond the source

- **Trend** — upstream reports a river level but no direction, so [api.php](api.php) samples each
  station over time and derives the change over the retained window (24 points, ~2h).
- **Sparkline history** — same samples, drawn per station.
- **One map, one request** — ~5 upstream endpoints fetched concurrently, merged, cached for 5 min.
- **Stale over blank** — if upstream is unreachable, the last good payload is served with
  `upstreamOk: false` and its age, rather than an empty map.
- **CCTV over HTTPS** — upstream advertises camera stills over plain http, which an https page
  can't load. They're proxied server-side, and only for camera ids already in the cache.

## Running it

Needs PHP with cURL. Anything that serves the folder works:

```bash
php -S localhost:8000
```

Then open http://localhost:8000. On [Herd](https://herd.laravel.com) or Valet, just visit the
site link — no config.

`.cache.json` and `.history.json` are written next to `api.php` and are gitignored. Delete them to
reset; history rebuilds itself as you keep the page open.

## Layout

    index.html   the whole frontend — map, filters, panels
    api.php      proxy, cache, history, CCTV passthrough
    vendor/      Leaflet + plugins + fonts, vendored so there's no build step

## Notes

Data is republished from JPS Selangor and is only as fresh and correct as the source. Not an
official service, and not something to make a safety decision on — check
[infobanjirjps.selangor.gov.my](https://infobanjirjps.selangor.gov.my) for that.
