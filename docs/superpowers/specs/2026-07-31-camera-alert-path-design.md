# Camera on the alert path

Date: 2026-07-31

## Purpose

The app stores 90 camera archives. Nothing connects a river at danger to a lens that points at it.
A reader who opens a camera cannot tell if the picture shows trouble. This design connects the two.

The design also corrects two claims the app makes today. It offers a camera up to 24 km away and
calls it the nearest one. It shows one still and calls it current, at any age.

## Scope

Four changes. Each one is small. Together they put a camera on the alert path.

1. Cap the nearest camera at 5 km.
2. Replace the still in the station panel with a 3-hour clip.
3. Mark a camera that has an alert within 2 km.
4. Color the archive timeline by what the river did at each frame.

## 1. Cap the nearest camera at 5 km

`nearestCam()` in `js/stations.js` takes a new cap, `CAM_MAX_KM` (5). Beyond the cap it returns
`null`, and the card says "no camera nearby".

The cap belongs in `nearestCam()` and nowhere else. `camNear()`, `camLink()` and the "you are here"
card all call it. One cap in one function keeps the three surfaces the same.

Measured against the current payload. 441 of 591 stations keep a camera link. 150 stations lose one.
Those 150 pointed at a lens 5 km to 24 km away. A lens that far away shows a different river.

## 2. The panel picture becomes a 3-hour clip

`camImg()` in `js/popup.js` still renders the live still first. The first paint stays instant. The
`image unavailable` path does not change. The wrapper gains `data-clip="<id>"` and a caption slot.

A new module, `js/clip.js`, owns the timer. It has the same shape as `js/ticker.js`. On `openSide()`
it finds `[data-clip]` and does one of two things.

- The camera id matches the running loop. The module does nothing.
- The camera id is new. The module fetches `?shots=<id>` once. It keeps frames newer than
  `now - 3h`. It preloads those frames. Then it cycles `src` every 1000 ms.

The first rule matters. It is not an optimization. `render()` rebuilds the open card on every poll.
A loop that restarted on each rebuild would jump back to frame 0 every 8 minutes.

The clip has no controls. The lightbox holds the controls, and it keeps them.

### Three states

| frames in the window | display | caption |
|---|---|---|
| 2 or more | the clip, looping, ending on the live still | `LAST 3 HOURS · 6 frames` |
| fewer than 2 | the live still, as the card shows it today | `LATEST IMAGE · 31/07/2026 18:00` |
| fewer than 2, and that still is over 3 hours old | the live still | `NOT CURRENT · 29/07/2026 14:31 · 46.2h ago` |

The fallback keeps the live still. It does not reach into the archive for an older frame. `?cam=`
fetches from JPS when the card opens, and the camera publishes its own stamp in `shot`. An empty
window means this server did not capture, not that the camera stopped. An archived frame from two
days ago in place of a live one would make the card worse.

`NOT CURRENT` is the word the cards already print on a reading over 24 hours old. A picture over
3 hours old makes the same claim about a different quantity. One word for one thing.

### Cost accepted

A preload of 6 frames costs about 1.5 MB on the first card open. `?shot=` is immutable for a year.
Every lap after the first costs nothing. Without the preload the first lap flickers.

## 3. The triangle

A filled warning glyph sits at the top left of the picture. It sits on a translucent dark disc.
The picture needs the disc. A bare glyph on a bright sky disappears. The pins carry a disc for the
same reason.

The glyph appears inside `.shotwrap` in the station panel and inside `.stage` in the lightbox. It
does not appear on the map pin. The pin already carries its own kind color.

### What raises it

A new helper, `camAlert(cam)`, goes in `js/stations.js` beside `nearestCam()`. That file holds
queries over the station set, and this is one.

The helper returns the worst tier among hot stations within `CAM_ALERT_KM` (2 km). Distance breaks
a tie. `isHot()` covers rivers and sirens only, so no other kind can raise the glyph.

| tier | color | tooltip |
|---|---|---|
| `now` | `--s-danger` | `SUNGAI KLANG (KLANG) at danger · 1.2 km away` |
| `soon` | `--s-warning` | `SUNGAI KLANG forecast to reach danger in 2.1 h · 1.2 km away` |
| `stale` | none | none |

`stale` shows nothing. A stale alert still lists in the panel, where words explain it. A colored
glyph on a picture has no room for those words, and an unexplained glyph is the wrong claim.

### The helper honors `isIgnored()`

A station the reader silenced must not raise a triangle. `PREFS.ignored` is the one suppression
control in this app. It already holds on the pins, the heat, the panel, the ticker and the toast.
This is a sixth surface, and it obeys the same rule.

### Two radii, on purpose

`CAM_MAX_KM` (5) answers "which camera do I offer". `CAM_ALERT_KM` (2) answers "does this picture
show the trouble". The app can offer a camera at 4.8 km and draw no triangle. That is correct.

The offer names the closest view available. The triangle makes a claim about the frame.

## 4. The timeline carries a tier per frame

`?shots=<id>` returns `[[ts, tier, stationId], …]` in place of `[ts, …]`. `tier` is `"now"`,
`"soon"` or `null`. Two clients read it: `js/timeline.js` and `js/clip.js`.

The server builds the tier for each frame in three steps.

1. Find rivers within `CAM_ALERT_KM` of the camera.
2. Take the last `.history.db` sample at or before the frame stamp.
3. Run `$assess()` at that sample index, and at the index before it for the on-delay.

Step 3 uses the live forecast function without a change. The docs state that `$assess()` takes a
sample index so the on-delay needs nothing persisted. That property makes the past replayable.

The `stationId` rides along so the client applies `isIgnored()`. The server never learns what the
reader ignores.

The server sends only the worst-tier station id. A tick from an ignored station falls to uncolored.
It does not fall back to the second-worst station.

Mark that with a `ponytail:` comment. Build the fallback if two hot stations near one camera turn
out to be common.

## 5. Limits

Three limits apply. Each one shows as an uncolored tick. None of them shows a wrong color.

1. **A siren can never color a past tick.** `?shots=` walks rivers only. `frameTiers()` scores a
   sample against the station's own danger mark, and a siren publishes none. `.history.db` does
   hold siren samples, as 0 or 1, so the data is not the gap. A siren still raises the live
   triangle. 57 of the 69 triangle-capable cameras have a river within 2 km, so most cameras still
   color their ticks.
2. **Levels retain 30 days. Frames retain a year.** The month range and the year range on the
   scrubber stay largely uncolored. Do not change the retention to fix this. The prune rule predates
   this feature and protects the disk.
3. **The static Pages build has no PHP.** `?shots=` fails there. `timeline.js` already handles that
   and draws no bar. `clip.js` shows the plain still with no loop. It still captions it: the failed
   `fetch` throws, and the idle branch prints `LATEST IMAGE` or `NOT CURRENT` from the payload stamp.

## 6. Measured

Numbers come from the current `.cache.json`. 90 cameras are online and carry an image.

| question | answer |
|---|---|
| stations that keep a camera link at 5 km | 441 of 591 |
| stations that lose their camera link | 150 |
| cameras that can ever raise a triangle at 2 km | 69 of 90 |
| of those, cameras with a river within 2 km | 57 |
| frames in a 3-hour window at `SHOT_EVERY` 30 min | 6 at most |

## 7. Files

| file | change |
|---|---|
| `js/config.js` | add `CAM_MAX_KM` and `CAM_ALERT_KM` |
| `js/stations.js` | cap `nearestCam()`, add `camAlert()` |
| `js/popup.js` | `camImg()` gains `data-clip` and a caption slot |
| `js/clip.js` | new. The 3-hour loop and its caption |
| `js/timeline.js` | color the ticks from the tier |
| `js/ui.js` | draw the triangle in the lightbox |
| `css/map.css` | triangle, caption |
| `css/chrome.css` | tick colors. `.tlticks` lives here, not in `css/base.css` |
| `js/map.js` | start the clip from `openSide()`, stop it from `closeSide()` |
| `index.html` | bump `?v=` on both stylesheets |
| `api.php` | join frames to history, return the tier |
| `shots.php` | none expected. Confirm during work |
| `docs/FEATURES.md` | record the feature and the trade-offs |

## 8. Verification

Run these checks before you report the work as done.

```bash
php -l api.php && php -l shots.php
php shots-test.php                                   # retention must stay green

# The new shape. Each row must be [ts, tier, stationId].
curl -sk "https://flood-exp.test/api.php?shots=1" | head -c 300

# Syntax-check the modules, clip.js included.
T=$(mktemp -d); for f in js/*.js; do cp "$f" "$T/$(basename ${f%.js}).mjs"; done
for f in "$T"/*.mjs; do node --check "$f" || echo "FAIL $f"; done

# Every file still serves. Check the type, because Herd answers a missing file with a 200.
for f in js/*.js css/*.css; do
  curl -sk -o /dev/null -w "%{content_type} $f\n" "https://flood-exp.test/$f"; done | grep -v 'javascript\|css'
```

Then open the page and check four things by eye.

1. A camera card plays a clip and stops at the caption you expect.
2. A station over 5 km from any camera says "no camera nearby".
3. A camera near a river at danger shows a red triangle with a tooltip.
4. The lightbox timeline colors the ticks, and an ignored station leaves them gray.

## 9. Not built

- **A control on the panel clip.** The lightbox holds the transport and the scrubber. Two places to
  learn one control is one too many.
- **A higher capture rate near an alert.** More frames in the window need more requests at JPS.
  `SHOT_EVERY` exists to cap that. Raise it only with a measurement that justifies the cost.
- **A second scoring rule for siren ticks.** Online sirens already reach `.history.db`, so the
  samples are there. A 0/1 log needs a rule of its own, because the forecast rule needs a danger
  mark. It would color the ticks for 12 more cameras.
- **A second-worst fallback when the reader ignores the worst station.** Rare. Marked in the code.
