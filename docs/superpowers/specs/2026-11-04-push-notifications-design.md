# Push notifications — design

Date: 2026-11-04. Status: reviewed, waiting for the repository owner's approval.

## Intent

A housemate installs the app on a phone from `https://floodwatch.taila2a82f5.ts.net`, turns
notifications on in Settings, and closes the app. When a river reaches its danger mark, the phone
shows a notification with the station name, the reading and the nearest camera picture. A tap opens
the app on that station's card.

Today the app has no push code. The only "new alert" signal is the desktop toast in `js/toast.js`.
It needs the tab open and the poll running. A closed app on a phone runs no timer and no fetch.

## Goals

- A notification reaches a phone while the app is closed.
- The reader picks what wakes the phone, in Settings, with a master switch and four rows under it.
- One notification per phone per poll, however many stations changed in that poll.
- The same station does not wake the phone twice for the same state.
- The feature obeys the alert design standard in `docs/FEATURES.md`.

## Non-goals

- Quiet hours. A flood at 3 a.m. is the point of the app. The master switch is the quiet hour.
- A notification on a MET weather warning or a JPS notice. Those are claims about an area. The
  warning surface already carries them. This feature pushes station readings only.
- GitHub Pages. That target has no server and no cron, so it cannot send. The Settings section
  hides there, through the existing `STATIC` flag.
- A camera picture on iPhone. Apple drops the `image` field. The text still arrives.

## Anti-goals

- A phone that buzzes on every poll during a monsoon. That trains the reader to ignore it, which
  is the cry-wolf failure the standard names.
- A notification about a reading the app itself sets aside as faulty or stale.
- A notification that names a sensor the reader ignored.
- A new third party in the browser. The browser talks to this origin, the basemap host and the push
  service its own vendor runs (Google for Chrome, Apple for Safari). PHP talks to those push
  services. Nothing else.

## Constraints

- Push needs https. The box serves the app at `https://floodwatch.taila2a82f5.ts.net` with a
  valid certificate today, confirmed on the owner's phone on 2026-11-04. `docs/DEPLOY.md` gains
  the `tailscale serve --bg 80` line that gives a fresh box the same.
- The audience is the housemates on one tailnet. A handful of phones. No queue, no batching
  library, no worker process. One PHP loop in the cron tick is enough.
- iPhone needs iOS 16.4 or later, the app on the home screen, and the permission asked from a tap
  inside the installed app.
- The source runs unbuilt and the build is what ships. `sw.js` gains handlers. When `build.mjs`
  writes the two shell lines, it must keep those handlers.
- The box serves the unbuilt source tree and pulls `main` every quarter hour. Nobody but the owner
  touches the box. So the owner runs `composer install` and `php push-keys.php` there once, by
  hand, after the merge. The plan states both as the owner's steps.
- The server knows nothing about a reader. The favorites and the ignored list live in the phone's
  `localStorage`. The phone must send them.

## Decided

### What triggers a notification

Two levels, matched in PHP against the payload `api.php` just built. The rule mirrors `isHot()`
and `tier()` in `js/util.js`, and the divergence is written beside it.

| level | station condition |
|---|---|
| danger | river `status` 3 or more. Siren `status` above 0. Flood gauge `depth` 0.3 m or more. Rainfall `status` 4 or more (above 60 mm an hour). This is the `now` tier. |
| warning | river `status` 2 (its warning mark) or `rising` true. Flood gauge `depth` 0.15 m or more. Rainfall `status` 3 (above 30 mm an hour). This is the `soon` and `heavy` tiers plus the river's own warning mark. |

A station with `backed === false` never matches. That is the server's own faulty verdict, and it
is applied without the client's `hideFaulty` preference, which the server cannot read.

A station with `online` false, or a reading stamped more than 24 hours ago, never matches. That is
`isStale()`. The alert list keeps a stale station on screen and says why. A push cannot say why, so
it stays silent.

A station in the phone's ignored list never matches. `PREFS.ignored` is the one suppression in
this app, and it holds on every surface.

### The four switches

Settings gains a Notifications section with one master switch and four rows under it:

1. Favorites at warning.
2. Favorites at danger.
3. Any station at warning.
4. Any station at danger.

A row names a threshold, not a level. "At warning" means warning or worse. So the warning row
implies the danger row of its group. When a warning row is on, the UI switches its danger row on
and locks it. The repository owner agreed to that reading on 2026-11-04.

Default is off for all five. The browser grants no permission without a tap, so nothing can be on
at install. The four rows are disabled while the master is off. Turning the master on asks the
browser for permission. If the browser refuses, the master stays off and the row's supporting line
says "Blocked in the browser's site settings".

Every row is an M3 switch, the same component test mode already uses.

### When a station sends again

If one of these is true, the phone hears about the station:

- The station enters a level it was not at on the last tick.
- The level rises from warning to danger.
- The station holds the same level for `PUSH_AGAIN` (6 hours) after the last notification about
  it. ISA-18.2 calls this a standing alarm reminder. The constant lives in `api.php`.

A level that falls to warning from danger sends nothing. A station that clears sends nothing by
itself. When every station the phone heard about sits below warning, the phone gets one
"All clear" notification. The test is against the level itself, not against the phone's
switches. So a reader with only the danger rows on never hears "All clear" while a river still
sits at its warning mark. CAP names the message `AllClear`, and the standard already states that
quiet is stated and never implied.

The server keeps two maps per phone, and both are my call. `seen` is the level of each matched
station on the last tick. `sent` is the level and the time of the last notification about it.
The entry and rise rules diff against `seen`, so a river that dips to warning and climbs back
to danger wakes the phone again. The reminder rule reads the clock in `sent`.

### One notification per tick

All stations that qualify for a phone in one tick fold into one notification.

- One station: title is the station name and level. Body is the reading and its mark. Example:
  `Sungai Klang at Jalan Tun Razak — danger`. Then `5.32 m. Danger mark 4.80 m.` as the body.
  The picture is the current still of the nearest camera, through `?cam=<id>`. The camera must sit
  within `PUSH_CAM_M` (1 km) of the station. The tap opens the station's card.
- Several stations: title is the count by level. Example: `2 at danger, 14 at warning`. Body
  names the worst station the way a single notification does. The picture is that station's
  camera. The tap opens the alert list.

Both forms use `tag` set to one constant, so a new notification replaces the one before it rather
than stacking. One phone never holds more than one notification from this app.

Worst case is one notification per phone every 5 minutes while a monsoon moves stations about.
That is 12 an hour against ISA-18.2's target of 6. Each one reports a change, which is the rule
`watch.php` already follows. Accepted, and the master switch is the reader's answer.

### What the phone sends the server

On every change to the master switch, a row, the favorites or the ignored list, the phone posts
one JSON document to `api.php?push=1`:

```
{ sub: <PushSubscription JSON>, on: [favWarn, favDanger, anyWarn, anyDanger],
  favs: [station ids], ignored: [station ids] }
```

The server stores it in `.history.db`, in a new table:

```
push(endpoint TEXT PRIMARY KEY, body TEXT, seen TEXT, sent TEXT, ts INTEGER)
```

`seen` is a JSON map of station id to level, as of the last tick. `sent` is a JSON map of
station id to `[level, unix time]` for the last notification about it. Turning the master off posts the same document
with `sub: null`, and the server deletes the row.

The posts from the favorites and the ignored list are debounced by 2 seconds, because a reader
clears a list one row at a time.

### Sending

Sending runs at the end of a refresh in `api.php`, inside the refresh lock, BEFORE
`captureShots()`. The camera capture is the slow step, and it hit PHP's 30 second limit in testing,
so a sender queued behind it never ran. A flood warning must not wait on the camera archive. The
sender also has its own wall-clock budget of 8 seconds, so a push service that hangs cannot starve
the capture and the drips. The cron already calls `api.php` every 5 minutes, so no new cron line and
no new file for the pipe. This changed during the build, and `docs/FEATURES.md` records why.

"All clear" needs a station the app can read. In one tick a station can go offline, go stale, be
set aside as faulty, or fail its detail call. That station is UNKNOWN, and unknown is not safe. It
blocks "All clear" and stays in `seen`. It stops blocking one day after the last notification about it. A
second change from the review: a station id is letters, digits and hyphens, up to 64. The first
pattern knew `wl-1` alone and refused every Kuala Lumpur and portal station.

The sender is the `minishlink/web-push` Composer package, installed into `lib/` beside
`symfony/dom-crawler`. A push service answering 404 or 410 means the phone unsubscribed, and the
row is deleted.

VAPID keys identify this server to the push services. `php push-keys.php` makes one pair, once,
into `.vapid.json`, gitignored. `api.php?push=key` serves the public half to the browser.

The sending loop reads every `push` row. For each row it computes the matched set from its `on`,
`favs` and `ignored`. It diffs that set against `sent` and sends at most one notification. It
writes `sent` back. A send that throws logs one line and moves to the next phone, so one dead
subscription cannot stop the rest.

### The service worker

`sw.js` gains two handlers. `push` reads the JSON payload and calls `showNotification()` with
title, body, `image`, `tag`, `icon` (`icon-192.png`) and `data.url`. If a window of this app is open,
`notificationclick` focuses it. If none is open, it opens `data.url`.

The app gains one hash reader in `js/app.js`. `#station=<id>` opens that station's card after the
first poll. `#alerts` opens the alert list. Both run once and clear the hash.

### A test send

Test mode fakes the flood in the browser's copy of the payload, and the server never sees it. So
the section gains one action row, "Send a test notification". It posts the phone's own
subscription to `api.php?push=test`. The server sends one notification to that subscription
alone, with the single-station form and a fixed station. The handler is rate-limited through
`forceAllowed()` at 60 seconds, site-wide, the same guard the force refresh uses. It is my call.

### Settings on a phone that cannot push

A browser without `PushManager`, or a page not on https, shows the master switch disabled. The
supporting line says why. On iPhone Safari outside the home screen it reads "Needs the installed
app". Elsewhere it reads "Not available in this browser".

### Tests

- `php api.php --selftest` gains cases for the match rule. One station per level and per kind.
  One faulty, one stale, one ignored, each matching nothing. One diff case per sending rule:
  new, risen, reminder due, reminder not due, all clear.
- `m3-check.html` gains the five Settings rows to its switch roll call.
- `docs/VERIFY.md` gains a hand test: turn the master on, press "Send a test notification",
  make sure that the phone buzzes within a few seconds.

### Documentation

- `docs/FEATURES.md` gains a "Push notifications" section, and the alert design standard section
  gains a line for how this surface clears it.
- `docs/DEPLOY.md` gains the `tailscale serve` step, the Composer package, the key step and the
  `.vapid.json` exclude in the rsync. It also states that the https name is a new origin. A phone
  that installed the app from `http://100.111.93.120` keeps its favorites and its ignored list on
  that old origin. The reader reinstalls from the https name and enters both lists again.
- `CLAUDE.md` gains `push-keys.php`, `.vapid.json` and the two new `api.php` handlers.

## Left to the builder

- Exact wording of every row and every notification, within the writing rules in `CLAUDE.md`.
- Where in the Settings main page the section sits.
- The nearest-camera search in PHP. `nearestCam` in `js/stations.js` is the shape to copy.
- Whether a river's warning text quotes the warning mark or the danger mark. The danger mark is
  the one the reader wants, and my guess is that both forms quote it.
