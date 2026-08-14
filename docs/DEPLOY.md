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

### Proxmox LXC

Where this actually runs. Unprivileged is correct — nothing needs host privileges except
`/dev/net/tun`, and only if you want Tailscale.

```bash
pct create 112 local:vztmpl/debian-13-standard_13.0-1_amd64.tar.zst \
  --hostname floodwatch --cores 2 --memory 1024 --swap 512 \
  --rootfs local-lvm:12 --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --unprivileged 1 --onboot 1 --start 1
```

`--onboot 1` is not cosmetic. **The cron is the app** (see below), so a container that does not come
back after a host reboot is a hole in the camera archive and the trend history, and neither backfills.
Keep `shots/` on the container's own rootfs — the 12 GB spec assumes it, and a host bind mount drags
in the uid trap below for no benefit unless the archive must live on separately-managed storage.

Four things bite here and nowhere else:

- **`/run/php` does not exist, so php-fpm will not start.** It exits `78/EX_CONFIG`, and there is no
  journal to explain why, because Debian dropped the package's `systemd-tmpfiles` dependency
  *specifically for container use* — which is exactly where the directory then fails to appear.
  Downstream this is a 502 on `api.php` and an offline-looking map; the real cause is only in
  `/var/log/nginx/error.log`. Fix with a drop-in, never by editing the unit — a `php-fpm` upgrade
  overwrites `/usr/lib/systemd/system/php8.4-fpm.service` and the fix would vanish silently:

  ```bash
  mkdir -p /etc/systemd/system/php8.4-fpm.service.d
  printf '[Service]\nRuntimeDirectory=php\nRuntimeDirectoryMode=0755\nRuntimeDirectoryPreserve=yes\n' \
    > /etc/systemd/system/php8.4-fpm.service.d/runtime-dir.conf
  systemctl daemon-reload && systemctl restart php8.4-fpm
  ```

- **The web console is blank and accepts no keys**, while `pct enter` and `pct console` both work
  fine. It is a setting, not a fault: `pct set 112 --cmode shell`. The default `tty` mode needs a
  getty on `/dev/console` that several Debian-family templates never start. Do **not** go down the
  `console-getty` road — on trixie it fails `243/CREDENTIALS` in an unprivileged container, and
  fixing that still leaves the console blank, because that is not what the button talks to.

- **The minimal template has no `sudo`.** You are root; drop it rather than installing it.

- **Tailscale needs `/dev/net/tun` passed in**, or `tailscaled` starts and immediately dies. Container
  stopped, on the *host*:

  ```bash
  modprobe tun && echo tun > /etc/modules-load.d/tun.conf
  printf 'lxc.cgroup2.devices.allow: c 10:200 rwm\nlxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file\n' >> /etc/pve/lxc/112.conf
  ```

Back it up with `vzdump 112 --storage local --mode snapshot --compress zstd`. That covers the one
thing on the box that cannot be rebuilt.

### Install

```bash
apt update                  # as root — a minimal LXC template has no sudo
apt install -y nginx php-fpm php-curl php-gd php-sqlite3 php-mbstring php-xml \
               composer git curl
php -v                      # >=8.2 required; developed on 8.2, CI bakes on 8.3, Debian 13 ships 8.4
ls /run/php/                # the FPM unit and socket are named for that version — check, don't assume
php -m | grep -E 'gd|curl|sqlite3|dom'
php -r 'print_r(array_intersect_key(gd_info(), ["JPEG Support"=>1,"WebP Support"=>1]));'
```

`php-gd` **must** report JPEG and WebP — without them every frame fails to store and the archive
stays silently empty. `php-xml` is what `symfony/dom-crawler` needs; without it both HTML scrapers
return nothing and the payload's `sources` counters go to zero (which is the alarm — see CLAUDE.md).

```bash
mkdir -p /srv/flood
git clone https://github.com/illusionikx/selangor-flood-tracker.git /srv/flood
cd /srv/flood
composer install --no-dev            # writes lib/, NOT vendor/ — vendor/ is hand-managed browser assets

# PHP writes six things; www-data must own all of them. -R because the auto-update cron below
# runs git as www-data, and git refuses a repo it does not own.
mkdir -p shots
chown -R www-data:www-data /srv/flood
```

That last line matters: `.cache.json`, `.history.db`, `.refresh.lock`, `shots/`, `.php-error.log` and
`.client-errors.log` are all created by PHP at runtime, in the app directory. If `www-data` cannot
write there the site serves an error object and never caches anything. The two logs fail more quietly
than the rest. PHP cannot report that it failed to open the file it reports failures into.

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
        # The unversioned symlink, not php8.4-fpm.sock — it survives a PHP major upgrade.
        fastcgi_pass unix:/run/php/php-fpm.sock;
        # A cold rebuild fans out ~270 upstream calls and can take 20s; a capture round adds ~25s.
        # Measured 45s on a 2-core LXC when a cold start and a capture round landed together.
        fastcgi_read_timeout 120;
    }

    # The browser's error reporter (js/oops.js beacons here). It appends one line and returns 204,
    # so it needs none of api.php's timeout. An exact `location =` match beats the regex 404 below
    # whatever the order, which is the same reason /api.php works. Drop this block and client error
    # reporting fails silently: the beacon posts into a 404 and nothing is ever written.
    location = /log.php {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php-fpm.sock;
        fastcgi_read_timeout 10;
    }

    # api.php and log.php are the ONLY php that may be requested. shots.php and sources.php are
    # libraries — they emit nothing today, but "harmless when called directly" is not a property
    # to rely on.
    location ~ \.php$ { return 404; }

    # State, not content. None of this is ever served directly.
    location ~ ^/(shots|lib)/ { return 404; }
    location ~ /\.          { return 404; }   # .cache.json, .history.db, .refresh.lock, .git,
                                              # .user.ini, .php-error.log, .client-errors.log
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

**The dotfile rule already covers the two logs, and that is load-bearing.** `.php-error.log` and
`.client-errors.log` each start with a dot, so `location ~ /\.` answers 404 for both. A stack trace
names the path of every file in it. A browser report names the page and the browser of a reader. Do
not rename either log to a name without the leading dot.

`log.php` writes to disk and anybody can reach it. The 5 MB ceiling inside that file is the backstop,
and it is deliberate rather than tidy. Add `limit_req` on that location if this site ever draws real
traffic. `.php-error.log` has no ceiling of its own, so add it to `logrotate` or truncate it by hand.

### The cron is not optional — it is what runs the site

**This whole app is request-driven. `api.php` only does work when something calls it**, so with no
traffic nothing polls, nothing is captured, and nothing is sampled. A site nobody visited overnight
has no camera frames and no history for that night — and on a flood map the worst gaps would land at
3 a.m. during a storm, which is exactly the replay you would later want. Do not think of this cron as
a cache optimisation. It *is* the thing that keeps the site alive; visitors are just people reading a
cache it keeps warm.

```bash
tee /etc/cron.d/flood >/dev/null <<'EOF'
*/5 * * * * www-data curl -fsS http://127.0.0.1/api.php | php /srv/flood/watch.php
EOF
```

The payload used to go to `/dev/null`. It now goes through `watch.php`, which is the whole of the
monitoring on this box — see **Watching it** below. The request is the same request either way.

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

#### The same job on Herd, under Windows

A development box needs this as much as a server does, and for the third reason above. Herd has no
`fastcgi_finish_request`, so a rebuild runs inside a reader request and that reader waits for it.
Measured on this machine: a cached poll answers in 0.1 seconds, a rebuild takes 4.2 seconds, and a
rebuild that also runs the camera capture takes 23.7 seconds. A reader who lands on the last of
those waits all of it.

Windows has no `cron`. Task Scheduler does the same job. Run this once, in PowerShell, as the
account that uses the site:

```powershell
$n = 'flood-exp-warm'
Unregister-ScheduledTask -TaskName $n -Confirm:$false -ErrorAction SilentlyContinue
# cmd.exe, because Task Scheduler runs one program and this needs a pipe. The payload goes to
# watch.php rather than to NUL — see "Watching it" above. Replace `php` with the full path from
# `(Get-Command php).Source` if the task runs with a PATH that lacks it.
$a = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument (
     '/c curl.exe -fsS --ssl-no-revoke --max-time 240 https://flood-exp.test/api.php' +
     ' | php D:\Herd\flood-exp\watch.php')
$t = New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
     -RepetitionInterval (New-TimeSpan -Minutes 5)
$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
     -StartWhenAvailable -MultipleInstances IgnoreNew `
     -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$p = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited
Register-ScheduledTask -TaskName $n -Action $a -Trigger $t -Settings $s -Principal $p `
     -Description 'Keeps api.php warm, the camera archive filling and the trend history unbroken.'
```

Four of those arguments carry a reason:

- **`--ssl-no-revoke`.** Windows curl uses schannel, and schannel asks the certificate for a
  revocation endpoint. Herd signs its own certificate with a local authority, which publishes none,
  so the check fails with `CRYPT_E_NO_REVOCATION_CHECK` and curl exits 35. The flag drops that one
  check on a request to your own machine. Do not reach for plain `http://` instead. Herd answers
  that with a 301.
- **`-LogonType S4U`.** The task then runs in session 0 and opens no console window every five
  minutes. It needs no stored password. Windows refuses S4U to some accounts. If
  `Register-ScheduledTask` reports an access error, change it to `-LogonType Interactive`. The task
  then runs only inside your login session, and a console window appears for a second each time.
  Windows refused S4U on the machine that runs this app. `-LogonType Password` is the third choice.
  It runs the task in session 0 and opens no window. It needs a stored password on the prompt. The
  flashing window is a fair reason to turn the task off on a development box.
  `Disable-ScheduledTask flood-exp-warm` stops it and keeps the registration.
  `Enable-ScheduledTask` starts it again. A development box loses only its own archive and history
  while the task is off. A server must never run this way, because there the timer is the app.
- **`-MultipleInstances IgnoreNew`.** A capture round can outlast the five-minute gap. The `flock`
  on `.refresh.lock` already stops two rebuilds at once, so a second task run only waits and
  then serves a cache. Skipping it costs less.
- **`-StartWhenAvailable`.** A laptop that slept through a run makes the next one up as soon as it
  wakes, rather than waiting for the following slot.

Check it and remove it with:

```powershell
Get-ScheduledTask flood-exp-warm | Get-ScheduledTaskInfo   # LastRunTime, LastTaskResult 0
Unregister-ScheduledTask -TaskName flood-exp-warm -Confirm:$false
```

`LastTaskResult` holds the exit code from curl. 0 is a fetch, 35 is the certificate check above, and 28 is a
timeout.

The machine must stay awake for any of this, the same requirement the Debian box has. A Windows
desktop that sleeps keeps no archive while it sleeps.

### HTTPS, from a home connection

Two answers, and the choice is *who should be able to see it*, not which is better.

**Private — Tailscale.** If the map is for you and a handful of people, this is the whole job:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up                 # prints a login URL
tailscale serve --bg 80      # https://<host>.<tailnet>.ts.net, real cert, tailnet only
```

Nothing is exposed, the cert renews itself, no certbot and no tunnel daemon. Needs the `/dev/net/tun`
passthrough above. **The IP addresses stay plain http** — `http://100.x.y.z/` and the LAN address are
*not* the served URL, and a browser is right to call them insecure; only the MagicDNS name carries the
cert. `tailscale funnel` is the flag that would make it public, and it is not the same decision.

**Public — Cloudflare Tunnel**, not port forwarding:

```bash
# cloudflared tunnel create flood && ... ; then point the tunnel at http://127.0.0.1:80
apt install -y cloudflared
```

No open inbound ports, no dynamic-DNS chase when the ISP rotates your address, TLS terminated for
free, and your home IP is not in public DNS. If you do forward 80/443 instead, use certbot
(`apt install certbot python3-certbot-nginx`) and accept that the address is published.

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

### Watching it

The cron above already fetches `api.php` every five minutes, and it threw the answer away. That
answer carries the alarm. Pipe it through `watch.php` instead. The check then costs no extra request,
no service, no container, no account and no third party.

**What it checks.** `kl`, `national`, `met` and `metday` must each parse more than zero rows.
`sources.stale` must be empty. `upstreamOk` must be true. The station count must clear 300, which
catches a collapse rather than a wobble. Empty input is a fault too, so a dead site reports itself
through the same path.

**What it ignores on purpose.** `metwarn.parsed` reads 0 on any calm day, because no warning is in
force. It read 0 on the poll behind this note. An alarm there fires most days and teaches a reader
to ignore the log.

**It reports a change of state, never a state.** A fault repeated every five minutes for a week is
2,016 identical lines. An alarm nobody acts on is the cry-wolf failure the alert design standard
rejects. It reports the recovery too, or a cleared fault looks open forever. `.watch.state` holds the
last verdict, and `watch.php` compares against it.

Output goes to `.php-error.log`. That keeps one file to read when something looks wrong.
`.client-errors.log` holds the browser side, one JSON line per report. Both are absent on a healthy
day.

**What it cannot catch.** `watch.php` runs on the machine it watches. A machine that is off runs no
cron and says nothing. That failure is the loud one, and you meet it the moment you open the site.
The silent failures are the class this catches, and they are the ones that hide behind a green
status dot.

**To get a message on a phone**, add one line beside the `error_log()` call in `watch.php`. A push
service such as ntfy needs no account and reaches a machine behind a home router. That contacts a
third party from PHP alone. The browser still talks to this origin and to the basemap host, so the
claim in the About pane holds.

An external uptime service is the only thing that answers "is the whole box alive". It also needs the
site to be reachable from the internet. Add one when this runs somewhere public, and not before.

### Updating

```bash
cd /srv/flood && git pull && composer install --no-dev
```

No build step, so that is the whole deploy. Bump the `?v=` on the stylesheet links when a CSS file
changes (`index.html`), and hard-reload after a `js/` change — ES module imports carry no cache
buster.

Worth automating, since it is a `git pull` on a timer and nothing else. Append to the same cron file:

```bash
COMPOSER_HOME=/srv/flood/.composer
*/15 * * * * www-data cd /srv/flood && git pull -q --ff-only && composer install --no-dev -q --no-interaction
```

Three details carry the weight. **`--ff-only`** refuses to merge, so a stray edit on the box stops
deploys loudly instead of quietly generating merge commits on a deploy target. **`www-data`, not
root** — git rejects a repo it does not own, and root would leave root-owned files in a tree PHP
writes to; `COMPOSER_HOME` is set because www-data's `$HOME` is not writable under cron. And it is
safe against the state files: `.cache.json`, `.history.db` and `shots/` are gitignored, so a deploy
can never cost you history or camera frames.

Same command as a script, so it is one word by hand and identical to what cron runs:

```bash
printf '#!/bin/sh\nexec su -s /bin/sh www-data -c '"'"'cd /srv/flood && git pull --ff-only && composer install --no-dev --no-interaction'"'"'\n' > /usr/local/bin/update
chmod +x /usr/local/bin/update
```

`update` then works inside the container and as `pct exec 112 -- update` from the host. Running plain
`git` as root in `/srv/flood` fails with *dubious ownership* — that is the guard working, not a fault.

Cache behaviour is already right for this: `index.html` is no-cache and `js/` is 5 minutes, so clients
pick up a deploy on their own. **CSS is the exception** — 30 days, busted only by the `?v=`. Forget to
bump it and the server is updated while the browser is not.

---

## What is *not* set up here

- **No process to supervise.** There is no daemon; PHP-FPM and nginx are the only services, and both
  are packaged. If the app is broken, it is broken per-request.
- **No rate limiting.** The `flock` guard protects *JPS* from this server, not this server from the
  internet. Behind a Cloudflare Tunnel that is Cloudflare's problem; on a bare forwarded port,
  consider `limit_req` on `/api.php`.
- **No metrics.** The status chip's `tookMs`, `details.ok/requested` and `sources` counters are the
  only instrumentation, and they are only visible to someone looking at the page. *Errors* are
  covered now — see **Watching it** above for the two monitors and the two log files.
- **No push alerting.** `watch.php` writes a line to `.php-error.log` and tells nobody. Nothing on
  this box sends a message anywhere. Add one call beside its `error_log()` if you want one — see
  **Watching it** above.
- **Serving `shots/` directly from nginx** would be cheaper than `readfile()` through PHP, but it
  would be a second door into the archive with its own validation story. One door.
