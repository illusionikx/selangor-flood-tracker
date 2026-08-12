# Playback speed on the camera lightbox

Date: 2026-08-12

## What it does

The camera lightbox plays one archived frame per second. A year range holds 52 frames. That clip
runs for 52 seconds. A reader who wants the shape of the week does not want to wait.

This adds one button. The button cycles the playback speed through 1x, 1.5x and 2x. It returns to
1x on the next press.

The button lives in the lightbox only. The station panel clip has no controls, by design.

The change carries one rule beyond the new button. Compare mode disables the play button as well.
See the compare section below.

## The control

Add one button to `index.html`:

```html
<button class="icon tlspeed" title="Playback speed (1x)" aria-label="Playback speed 1x"
><i class="i i-1x_mobiledata"></i></button>
```

It sits inside `.tlleft`, between `.tltransport` and `.tlcmp`.

The layout needs no new CSS. `.tlleft` is already a flex row with a 10px gap. The new button takes
a gap on each side. The row then holds three groups instead of two.

Rewrite the comment on `.tlleft` in `css/chrome.css`. It states "the five buttons" and "compare is
not one of the four beside it". Both counts are wrong after this change.

The button does not flash on a press. The flash listener sits on `.tltransport`, and this button is
outside that group. The compare button beside it does not flash either. The glyph changes on every
press, which states the result better than a ripple.

### The three glyphs

Add three rules to `css/icons.css`. Bump `?v=` on the stylesheet link.

| state | token | fetch |
|---|---|---|
| 1x | `--i-1x_mobiledata` | `1x_mobiledata/fill1/24px.svg` |
| 1.5x | `--i-speed_1_5x` | `speed_1_5x/fill1/24px.svg` |
| 2x | `--i-speed_2x` | `speed_2x/fill1/24px.svg` |

Material Symbols publishes no `speed_1x`. The set steps from `speed_0_75x` to `speed_1_2x`.
`1x_mobiledata` is the drawing this control needs. It shows the numerals `1x` at the same 320-unit
cap height as the other two glyphs.

Each token keeps its upstream name. A reader can then refetch it from the URL at the top of
`icons.css`. The `title` on the button states the purpose instead. `--i-last_page` sets this precedent.
That token drives the "Go to now" button under its own upstream name.

## The rate

Add a rate table, an index and one node handle to `js/timeline.js`:

```js
const RATES = [1, 1.5, 2];
const speed = tl.querySelector('.tlspeed');
let rate = 0;
```

The play interval becomes `FRAME_MS / RATES[rate]`. That gives 1000 ms, 667 ms and 500 ms.

`FRAME_MS` stays at 1000. Its comment stays as written. One frame per second is still the pace of
looking. This button is the exit from that pace on a long range.

## The press

The handler advances the index, repaints the button, then restarts playback:

```js
rate = (rate + 1) % RATES.length;
paintSpeed();
stop();
toggle();
```

`stop()` then `toggle()` covers both states you can press this button in. A running clip restarts on
the frame it is on, at the new pace. A paused clip starts.

Two existing rules apply with no new code. `stop()` clears `lead`, so a press during the opening
two-second delay cancels that delay. Every other deliberate move already does this. And `toggle()`
holds its own `frames.length < 2` guard.

## Compare disables play and speed

`setCompare()` disables two buttons whenever the divider is up. It enables them again when the
divider goes down. One line holds the rule:

```js
play.disabled = speed.disabled = !ab.hidden;
```

`docs/FEATURES.md` already states the reason. Pressing compare pauses playback. A reader who raises
the divider has chosen one frame to hold against the live one. A clip carries that frame away.

This finishes that rule rather than changing it. Compare paused the clip. Compare now keeps it
paused. The state is one state, and the two buttons that leave it are the two that go dark.

**Both step buttons stay enabled. "Go to now" stays enabled. The seek bar stays enabled.** Each one
moves the position and none starts a clip. `go()` calls `stop()` first, so all three already end at
a paused frame. A reader can still walk the archive against the live picture.

The speed glyph keeps stating the current rate on a disabled button. A disabled control means the
reader cannot change the rate here. It does not mean the rate stopped applying.

Add one rule to `css/chrome.css`:

```css
#tl .icon:disabled { opacity: .4; pointer-events: none; }
```

`pointer-events: none` removes the hover background in both control-bar shapes. The plain shape and
the `PLAYER_OVERLAY` block each paint their own hover, so one declaration covers both.

### What needs no change

The picture is the play button, and `stage.onclick` already tests `ab.hidden`. It does nothing while
the divider is up.

Space and `k` map to the play button through `KEYS`. The handler calls `play.click()`. A browser
fires no click on a disabled button, so the keys go quiet on their own.

`toggle()` needs no guard of its own. Every path into it is already closed while the divider is up.
`stage.onclick` tests `ab.hidden`. The range handler tests `ab.hidden`. The opening delay cannot
survive, because `cmp.onclick` calls `stop()` and `stop()` clears `lead`.

`lastPos()` keeps its compare branch. That branch now serves `go()` alone, which is what holds the
step buttons off the live frame while the divider is up. Update its comment to say so.

## The rate does not survive a close

`reset()` sets `rate` back to 0 and repaints the button.

`reset()` runs at the top of every `openTimeline()` call. Every camera therefore opens at 1x. No
value reaches `PREFS`, and no value reaches `localStorage`.

## Accent above 1x

`paintSpeed()` puts the `on` class on the button whenever `rate` is not 0.

`#tl .icon.on` already paints that state. It works in the plain control bar and in the overlay bar.
This needs no new CSS.

The accent earns its place. `#tl .icon` sets `font-size: 20px`, so the numerals stand about 6.7px
tall. The accent states "this clip runs fast" without a reader reading the numerals.

## The accessible name

`paintSpeed()` is the one function that writes the button. It sets four things per state: the glyph
class, the `on` class, the `title` and the `aria-label`.

- `title="Playback speed (1x)"`
- `aria-label="Playback speed 1x"`

The button takes no `aria-pressed`. That attribute states two states, and this control has three.

The button takes no keyboard binding. Every key in `KEYS` maps to a button that lights up under
`.click()`. This button does not light up.

## Files

| file | change |
|---|---|
| `index.html` | one button, between `.tltransport` and `.tlcmp` |
| `css/icons.css` | three glyph rules, and a `?v=` bump |
| `css/chrome.css` | one disabled rule, and a rewritten `.tlleft` comment |
| `js/timeline.js` | `RATES`, `rate`, `paintSpeed()`, the click handler, the interval delay, `setCompare()`, `reset()`, the `lastPos()` comment |
| `docs/FEATURES.md` | the feature and the reasoning |

## Deliberately not built

- **No persistence.** You asked for a rate that does not survive the session. A stored rate also
  starts the next camera at a pace the reader set on a different one.
- **No slow side.** Material Symbols publishes `speed_0_5x` and `speed_0_75x`. A frame already
  stands for 30 minutes to a week. A reader who wants longer on one frame uses the pause button.
- **No keyboard binding.** See the accessible name section above.
- **No speed control on the station panel clip.** `js/clip.js` carries no controls. That is its
  design, and the lightbox is where a reader sits with a camera.
- **No change to `FRAME_MS`.** The default pace is correct. This button is the exception to it.
- **No disabled step buttons under compare.** You asked to keep them. They move the position and
  they start no clip.
- **No focus rescue when play goes dark.** Focus falls to the dialog. The keyboard bindings sit on
  the dialog, so the arrows and `End` still answer.

## What breaks it

Google can rename `1x_mobiledata`. The rule in `icons.css` holds the path, not the URL, so a rename
breaks no running copy. It breaks the refetch only.

A missing glyph paints nothing. It cannot paint a readable English word. `css/icons.css` states that
rule at the top of the file.
