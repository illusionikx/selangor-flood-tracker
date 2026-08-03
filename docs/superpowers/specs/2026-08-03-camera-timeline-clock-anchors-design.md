# Camera timeline: clock anchors

Date: 2026-08-03

## Problem

The camera archive files each frame by `floor(ts / step)` and keeps the newest frame in the bucket.
Both `pruneShots()` in `shots.php` and `thin()` in `js/timeline.js` use that rule.

The rule aligns buckets to UTC midnight. Malaysia runs UTC+8. So the frame that survives lands at an
hour nobody chose:

| viewer range | step | frames land near (MYT) |
|---|---|---|
| week | 3 h | 01:30, 04:30, 07:30 … |
| month | 12 h | 07:30 and 19:30 |
| year | 7 d | Thursday |

A reader cannot predict the capture time of a stored frame. Two frames in one clip come from
different times of day. The month range shows morning and evening pictures with no reason for either.

## Goal

Aim each range at a clock time the reader chooses:

| viewer range | aims at (MYT) |
|---|---|
| week | 01:00, then every 3 hours |
| month | 04:00 and 16:00 |
| year | Monday 16:00 |

Where no frame exists at a target time, show the closest frame there is.

The 24-hour range does not change. Its step is the capture rate, so it has no time of day to aim at.

## Design

### One rule, both sides

A tier gains a third number. The number is the **anchor**, the clock time its slots aim at. The slot
and the target become:

    slot   = floor((ts - anchor + step / 2) / step)
    target = anchor + slot * step

The frame nearest its target wins the slot. That replaces "newest in the bucket" on the server and on
the client. Both sides write the same expression. So the two sides cannot file a slot-edge
frame two ways.

The rule bounds the error itself. A frame never sits further than half a step from its own target.
A slot with no frame is absent from the list, exactly as an empty bucket is today. So "closest
frame" needs no tolerance value and no empty slots to skip.

### The anchors

Each anchor is the target time in UTC, modulo the step:

| tier | step | anchor | aims at (MYT) |
|---|---|---|---|
| 6 h | keep every frame | 0 | not applicable |
| 24 h | 30 min | 0 | not applicable |
| week | 3 h | 7200 | 01:00, then every 3 hours |
| month | 12 h | 28800 | 04:00 and 16:00 |
| year | 7 d | 374400 | Monday 16:00 |

The three targets nest. 16:00 sits on the 3-hour grid. Monday 16:00 sits on the 12-hour grid.

So a frame that ages from the week tier to the month tier to the year tier keeps hitting its
target. It does not drift once per tier.

The 6-hour tier keeps every frame, so it has no bucket to anchor. The 24-hour tier steps at the
capture rate, so it has no time of day to aim at. Both take anchor 0.

Anchor 0 is not the same as no change. The 24-hour tier then keeps the frame nearest each half
hour mark, where it used to keep the newest frame in each half-hour bucket. Capture runs every 30
minutes, so a bucket holds one frame and the two rules agree. The uniform rule avoids a second
code path for two tiers. The 88 deleted frames counted below include this effect.

### The frame stamp

The stamp under the picture reads `14 Nov, 17:00`. It carries no year and no weekday. The year range
holds frames 365 days old, so a frame from last November reads the same as one from this November.

Add both: `Mon 03 Aug 2026, 16:00`. The `MYT` formatter in `js/timeline.js` gains `weekday: 'short'`
and `year: 'numeric'`. It feeds `.btime` and `.abtime`, the only stamps the lightbox prints.

The weekday earns its place on the year range. That range aims at Monday 16:00, so the weekday is
what tells the reader the anchor holds and which week the frame belongs to.

`en-GB` renders the weekday as `Fri, 14 Nov 2025, 17:00`, with two commas. `stamp()` drops the first
one. `String.replace` takes a string and replaces one match. This formatter names its own locale, so
the first comma is always the weekday comma.

Print both on every frame, not only on old ones. A rule that hides the year most of the time gives
the reader nothing to trust when the year does appear. The stamp grows to 22 characters.

The width is safe in both states. In compare mode `paint()` writes `live` into `.btime`, so only
`.abtime` carries a stamp. Outside compare mode the CSS hides `.abtime`. So the picture never holds
two full stamps.

Two other formatters keep their present shape. `MYT_STAMP` in `js/clip.js` already carries the year
and does date arithmetic, not display. `MYT_CLOCK` in `js/popup.js` labels a 12-hour graph.

### Changes

| file | change |
|---|---|
| `shots.php` | `SHOT_TIERS` gains the anchor column. `pruneShots()` swaps its bucket key and its winner test. |
| `js/timeline.js` | `RANGES` gains `anchor`. `thin(list, step, anchor)` picks the nearest frame. |
| `js/timeline.js` | The `MYT` formatter gains `weekday: 'short'` and `year: 'numeric'`. `stamp()` drops the first comma. |
| `js/timeline.js` | Range labels state the clock time. Example: `week, 3 hours per frame from 01:00`. |
| `js/timeline.js` | The comment above `setRange` names a 6-hour stop that no longer exists. Correct it. |
| `shots-test.php` | Three assertions. See below. |
| `CLAUDE.md`, `docs/FEATURES.md` | Record the rule and the gotcha. |

Nothing else reads the bucket rule. `?shots=`, `frameTiers()`, `clip.js` and `drawTicks()` take the
frame list and do not change.

## Test

`shots-test.php` gains three assertions:

1. Each anchor resolves to the stated MYT clock time. Assert against a current timestamp. This is
   the assertion that matters. A hand written constant is the part that goes wrong without a symptom.
2. Given two frames in one slot, the frame nearer the target survives.
3. `pruneShots()` stays idempotent. A second run deletes nothing.

Malaysia is UTC+8. The anchors are modular arithmetic and read no timezone table.

## Accepted costs

**The change deletes 88 stored frames.** The first capture after this change re-files the archive
on the new grid. 88 of 1337 frames lose their slot to a nearer frame.

Every one of them sits 33 to 119 minutes from a frame that survives. The window there steps 3 or 12
hours. The count covers the 90 cameras stored on 2026-08-03. The user accepted this loss. One rule
now covers the whole archive.

**The grid fills as frames age.** Retention works on age. So the month grid is correct 7 days after
the change, and the year grid is correct after 30 days. Frames already pruned keep their old times.

**A sparse archive still shows off-target frames.** Capture runs when a poll runs. A machine without
a cron stores frames in bursts, with gaps of days. The closest frame to 04:00 can then be 6 hours
away. The stamp under the picture stays the real capture time, so the picture states its own age.

## Not built

- A viewer-facing time picker. Three fixed schedules cover the request. Add a picker when they stop.
- A maximum distance, past which a slot shows nothing. The bucket rule already bounds the error to
  half a step.
- Any rewrite of the frames already stored.
