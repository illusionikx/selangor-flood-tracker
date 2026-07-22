# Deployment

Two targets, and they are not the same app.

| | GitHub Pages | Debian server |
|---|---|---|
| what runs | nothing — static files | `api.php` on every poll |
| freshness | 15–30 min (cron is best-effort) | 5 min |
| camera stills | hotlinked from JPS | proxied |
| **camera timeline** | **absent** | full |
| trend / `rising` | yes (history cached between bakes) | yes |
| filters, ignore, table, alerts | identical — all client-side | identical |
| cost | free | electricity + ~1.1 GB/day of your line |

Pages is the shop window: no server, no disk, nothing to keep running. The Debian box is the real
thing, and the only place the camera archive can exist at all.

---

## GitHub Pages

Already wired: [`.github/workflows/pages.yml`](../.github/workflows/pages.yml). Push to `main` or
wait for the quarter-hourly cron; the workflow runs the PHP on a runner and publishes its output as
`api.json` beside the static files. The two builds differ by **one line** — `STATIC` in
`js/config.js`, flipped by `sed` during the bake.

**Enable it once:** repo → Settings → Pages → Source: **GitHub Actions**. Nothing else.

### What Pages cannot do, and why

- **No camera timeline.** It needs a filesystem that survives between runs and a PHP process to
  write to it. A runner has neither, and the archive is ~2.9 GB — far past any artifact limit. The
  bar simply does not appear: `js/timeline.js` looks for `?cam=` in the image URL, the static build
  hotlinks JPS directly, so there is no id to ask about and no request is made. Nothing to disable.
- **No `?cam=` proxy.** Upstream serves the same stills over TLS, so an https page can hotlink them.
  That works but means the visitor's browser talks to JPS directly.
- **Freshness.** GitHub's cron is best-effort and routinely runs late. Upstream stamps readings to
  the quarter hour, so the lag is roughly one reading, not many.
- **The cron switches itself off** after 60 days with no commits to the repo. GitHub emails first.
  A commit — any commit — resets the clock.
- **The trend history is a cache**, not storage. `.history.db` is restored from
  `actions/cache` between bakes and evicted after 7 days unused. A quiet fortnight costs the samples,
  and every `rising` flag goes false for an hour while they rebuild.

The bake **fails rather than publishes** if the payload comes back with under 100 stations — a failed
bake leaves the last good deployment up, which is the right failure for a flood map.

---

## Debian server (home)

### Spec

The binding constraint is **disk**, and it is entirely the camera archive.

| | steady state | note |
|---|---|---|
| `shots/` | **~2.9 GB** | 169 frames × 89 cameras × ~190 KB, at 720p |
| `.history.db` | **~200 MB** | 30-day retention, ~2,100 rows/hour |
| `.cache.json` | 350 KB | one payload |
| app + `lib/` + `vendor/` | ~5 MB | |

`shots/` is ~2.9 GB **at 720p**. Setting `SHOT_W = 1024` in `shots.php` roughly halves it to ~1.6 GB
and changes nothing else. Both figures are a ceiling, not a growth curve — retention holds them flat
once a year has passed.

**Recommended:**

| | minimum | comfortable |
|---|---|---|
| CPU | 2 cores, any x86-64 or ARM64 — a Pi 4 is enough | 4 cores |
| RAM | 1 GB | 2 GB |
| disk | 16 GB | **32 GB SSD** |
| network | any home broadband | — |

Nothing here is CPU-bound in the normal case. The one spike is the capture pass: 90 JPEGs decoded
and re-encoded every 30 minutes, ~25 s wall on this laptop, and GD holds a 1280×720 bitmap (~3.7 MB)
per image with 10 in flight. A Pi 4 will take longer and still finish inside the window.

**Storage: use an SSD, not an SD card.** The archive writes ~90 files every 30 minutes and deletes a
similar number — 8,600 file writes a day, for ever. That is an SD card's failure mode exactly.

**Bandwidth:** ~1.1 GB/day pulled *from JPS*, almost all of it camera stills. Outbound depends on
visitors. If your line is metered or shared, this is the number to check first; `SHOT_EVERY` in
`shots.php` is the dial (60 min halves it, and halves the 6-hour tier's density with it).

### Install

```bash
sudo apt update
sudo apt install -y nginx php-fpm php-curl php-gd php-sqlite3 php-mbstring php-xml \
                    composer git
php -v                      # composer.json requires >=8.2; developed against 8.2, CI bakes on 8.3
php -m | grep -E 'gd|curl|sqlite3|dom'
php -r 'print_r(array_intersect_key(gd_info(), ["JPEG Support"=>1,"WebP Support"=>1]));'
```

`php-gd` **must** report JPEG and WebP — without them every frame fails to store and the archive
stays silently empty. `php-xml` is what `symfony/dom-crawler` needs; without it both HTML scrapers
return nothing and the payload's `sources` counters go to zero (which is the alarm — see CLAUDE.md).

```bash
sudo mkdir -p /srv/flood && sudo chown $USER:www-data /srv/flood
git clone https://github.com/illusionikx/selangor-flood-tracker.git /srv/flood
cd /srv/flood
composer install --no-dev            # writes lib/, NOT vendor/ — vendor/ is hand-managed browser assets

# api.php writes four things; www-data must own all of them.
sudo -u www-data mkdir -p shots
sudo chown www-data:www-data . shots
```

That last line matters: `.cache.json`, `.history.db`, `.refresh.lock` and `shots/` are all created by
PHP at runtime, in the app directory. If `www-data` cannot write there the site serves an error object
and never caches anything.

### nginx

```nginx
server {
    listen 80;
    server_name flood.example.org;
    root /srv/flood;
    index index.html;

    # Everything that is not a real file is the single page.
    location / { try_files $uri $uri/ /index.html; }

    location = /api.php {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.2-fpm.sock;
        # A cold rebuild fans out ~270 upstream calls and can take 20s; a capture round adds ~25s.
        fastcgi_read_timeout 120;
    }

    # api.php is the ONLY php that may be requested. shots.php and sources.php are libraries —
    # they emit nothing today, but "harmless when called directly" is not a property to rely on.
    location ~ \.php$ { return 404; }

    # State, not content. None of this is ever served directly.
    location ~ ^/(shots|lib)/ { return 404; }
    location ~ /\.          { return 404; }   # .cache.json, .history.db, .refresh.lock, .git
    location ~ ^/(composer\.(json|lock)|shots-test\.php)$ { return 404; }

    # Stylesheets carry ?v=; the modules do not, so they must not be cached hard.
    location ~* \.(css|woff2)$ { expires 30d; add_header Cache-Control "public"; }
    location ~* \.js$          { expires 5m;  add_header Cache-Control "public"; }
    location = /index.html     { expires -1;  add_header Cache-Control "no-cache"; }

    gzip on;
    gzip_types application/json application/javascript text/css image/svg+xml;
}
```

`fastcgi_read_timeout` is not optional. The default 60 s is survivable but a cold start that also
triggers a capture round has taken 40 s here, and a 504 mid-rebuild leaves the visitor with nothing.

### Keep the cache warm — this is the important bit

Under Herd there is no `fastcgi_finish_request`, so a refresh happens *inside* somebody's request and
they wait for it. On a real server the fix is to make sure nobody ever is that somebody:

```bash
sudo tee /etc/cron.d/flood >/dev/null <<'EOF'
*/5 * * * * www-data curl -fsS -o /dev/null http://127.0.0.1/api.php
EOF
```

Five minutes matches `TTL`. With this running, every visitor gets a warm cache instantly, and the
30-minute camera capture — the pass that adds ~25 s to one refresh in six — is always paid by cron
rather than by a person. The `flock` on `.refresh.lock` means the cron and a visitor can never
rebuild at once.

### HTTPS, from a home connection

**Cloudflare Tunnel is the right answer here**, not port forwarding:

```bash
# cloudflared tunnel create flood && ... ; then point the tunnel at http://127.0.0.1:80
sudo apt install -y cloudflared
```

No open inbound ports, no dynamic-DNS chase when the ISP rotates your address, TLS terminated for
free, and your home IP is not in public DNS. If you do forward 80/443 instead, use certbot
(`sudo apt install certbot python3-certbot-nginx`) and accept that the address is published.

Either way, keep the disclaimer visible. This is not an official warning channel, and a home
connection has a plainly worse availability story than JPS's own portals.

### Operating it

```bash
php shots-test.php                                    # retention still correct — must stay green
curl -s localhost/api.php | php -r 'echo json_encode(json_decode(stream_get_contents(STDIN),true)["sources"]),"\n";'
du -sh /srv/flood/shots                               # watch it approach ~2.9 GB and then stop
find /srv/flood/shots -name '*.*' | wc -l             # ~169 x cameras once a year has passed
```

**`parsed: 0` in `sources` means a scraped table moved**, not that the rivers went quiet. The
scrapers fail silently by design; those counters are the alarm.

**Back up `.history.db` and `shots/` or accept losing them.** Neither can be rebuilt — the frames
only exist because the server was running when they were taken, and there is no upstream archive to
re-fetch. `.history.db` at least regenerates over an hour; `shots/` is simply gone. A weekly
`rsync` of both to another disk is enough.

**Do not `rm -rf shots/` to re-test capture** — `rm shots/.last` expires the 30-minute stamp instead.
Same for the payload cache: `touch -d '2020-01-01' .cache.json`, never delete `.history.db`.

### Updating

```bash
cd /srv/flood && git pull && composer install --no-dev
```

No build step, so that is the whole deploy. Bump the `?v=` on the stylesheet links when a CSS file
changes (`index.html`), and hard-reload after a `js/` change — ES module imports carry no cache
buster.

---

## What is *not* set up here

- **No process to supervise.** There is no daemon; PHP-FPM and nginx are the only services, and both
  are packaged. If the app is broken, it is broken per-request.
- **No rate limiting.** The `flock` guard protects *JPS* from this server, not this server from the
  internet. Behind a Cloudflare Tunnel that is Cloudflare's problem; on a bare forwarded port,
  consider `limit_req` on `/api.php`.
- **No metrics.** The status chip's `tookMs`, `details.ok/requested` and `sources` counters are the
  only instrumentation, and they are only visible to someone looking at the page.
- **Serving `shots/` directly from nginx** would be cheaper than `readfile()` through PHP, but it
  would be a second door into the archive with its own validation story. One door.
