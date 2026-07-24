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
  write to it. A runner has neither, and the archive is ~3.7 GB — far past any artifact limit. The
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

**LXC container: 12 GB, 2 cores, 1 GB RAM.** Steady state is ~6 GB, so that is 2× headroom and it
never grows past it.

| | steady state | note |
|---|---|---|
| Debian rootfs + nginx + php-fpm + extensions | ~1.5 GB | no kernel, no swap, no boot partition |
| apt cache & logs, a year with rotation | ~0.5 GB | |
| `shots/` | **~3.7 GB** | 165 frames × 89 cameras × ~245 KB |
| `.history.db` | ~200 MB | 30-day retention, ~2,100 rows/hour |
| `.cache.json` | 350 KB | one payload |
| app + `lib/` + `vendor/` | 2 MB | |

On bare metal add the OS proper and buy the cheapest 128 GB SSD — at these sizes the disk question
is moot, and **an SSD rather than an SD card is the part that matters**: the archive writes ~90 files
every 30 minutes and deletes a similar number, ~8,600 writes a day for ever, which is an SD card's
failure mode exactly.

### The archive does not grow without bound

This is the number people expect to be scary and isn't. Retention thins a frame by its *age*, with a
hard cut at one year, so the last tier deletes as fast as capture adds:

| age | frames per camera | archive |
|---|---|---|
| 1 day | 48 | 1.1 GB |
| 7 days | 72 | 1.6 GB |
| 30 days | 118 | 2.6 GB |
| 90 days | 126 | 2.8 GB |
| **1 year** | **165** | **3.7 GB** |
| 2 years | 165 | 3.7 GB — flat, for ever |

Most of it lands in the first month; the next eleven add under a gigabyte, because past 30 days you
are keeping one frame a week. Scale at **~40 MB per camera per year** if JPS publishes more.

Where the frames actually are, which is what decides which knob is worth turning:

| window | frames | share |
|---|---|---|
| < 6 h | 12 | 7% |
| 6–24 h | 36 | 21% |
| 1–7 d | 24 | 14% |
| 7–30 d | 46 | 27% |
| 30 d – 1 y | 47 | 28% |

**55% of the archive is older than a week** — the part nobody scrubs — while the 6-hour replay the
feature exists for is 7% of it. So if it ever needs to be smaller, thin the tail (`SHOT_TIERS`:
month → 24 h, year → 14 d) for −28% that nobody will notice, or drop `SHOT_W` to 1024 for −45% of
sharpness. **Do not reach for `SHOT_EVERY`**: an hour instead of 30 minutes saves 15% of disk and
halves the density of the 6-hour replay, which is the worst trade on the table.

### CPU, RAM, network

Nothing is CPU-bound in the normal case. The one spike is the capture pass: 90 stills fetched every
30 minutes, decoded to check them, and GD holds a 1280×720 bitmap (~3.7 MB) per image with 10 in
flight. ~25 s wall here; a Pi 4 takes longer and still finishes well inside the window.

**Bandwidth: ~1.1 GB/day pulled *from JPS***, almost all of it camera stills. Pruning cannot reduce
this — every frame captured is kept at full density for the first 24 hours, so nothing is fetched and
discarded. `SHOT_EVERY` is the only dial, with the trade named above. Upstream does honour
conditional GET (`If-Modified-Since` → 304, zero bytes), which would be free to add, but at
30-minute intervals only 2 cameras in 90 are stalled enough to benefit.

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

**On an unprivileged LXC — the usual Proxmox setup — that `chown` is not the whole story if `shots/`
is a bind mount.** The container's `www-data` is uid 33 inside, but the kernel maps it to **100033 on
the host** (33 + the default 100000 offset). A directory bind-mounted from the host therefore has to
be owned by 100033 *on the host*, not by 33:

```bash
# On the Proxmox host, for a bind-mounted archive dir (skip this if shots/ lives on the
# container's own rootfs — the in-container chown above is then sufficient):
chown -R 100033:100033 /path/on/host/to/shots
```

Get this wrong and the failure is silent in the worst way: PHP cannot write the frame, `captureShots()`
returns 0, and the site looks completely healthy — live map, live stills, everything but an archive
that never fills. `du -sh shots` staying at zero after an hour is the tell. Keeping `shots/` on the
container's own rootfs sidesteps it entirely, at the cost of the archive living inside the container
image rather than on separately-managed storage.

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

### The cron is not optional — it is what runs the site

**This whole app is request-driven. `api.php` only does work when something calls it**, so with no
traffic nothing polls, nothing is captured, and nothing is sampled. A site nobody visited overnight
has no camera frames and no history for that night — and on a flood map the worst gaps would land at
3 a.m. during a storm, which is exactly the replay you would later want. Do not think of this cron as
a cache optimisation. It *is* the thing that keeps the site alive; visitors are just people reading a
cache it keeps warm.

```bash
sudo tee /etc/cron.d/flood >/dev/null <<'EOF'
*/5 * * * * www-data curl -fsS -o /dev/null http://127.0.0.1/api.php
EOF
```

Five minutes matches `TTL`, so it does three jobs at once:

- **the camera archive fills 24/7** instead of only while someone happens to be watching;
- **`rising` and the trend flags always have their hour of history** — after a gap they go null, and
  everything keyed off them (alerts, the rising filter, heat weighting) goes quiet for an hour;
- **the first real visitor gets a warm cache instantly** rather than paying for a cold ~15 s rebuild.
  Under Herd there is no `fastcgi_finish_request`, so a refresh happens *inside* somebody's request
  and they wait for it; the cron makes sure nobody is ever that somebody, and the 30-minute camera
  capture — the pass that adds ~25 s to one refresh in six — is always paid here rather than by a
  person. The `flock` on `.refresh.lock` means the cron and a visitor can never rebuild at once.

It is a `curl` on a timer, not a daemon — nothing to supervise, one local HTTP request every five
minutes.

**The machine must therefore stay awake.** This keeps PHP working around the clock, so a host that
suspends when idle will not fire the cron and you are back to gaps. On an always-on container or a Pi
this is automatic; on a desktop that sleeps, disable sleep or the archive is only as continuous as
the machine is. (`systemd` timers work equally well if you prefer them to `cron.d` — the requirement
is a call every five minutes, not the mechanism.)

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
du -sh /srv/flood/shots                               # watch it approach ~3.7 GB and then stop
find /srv/flood/shots -name '*.*' | wc -l             # ~165 x cameras once a year has passed
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
