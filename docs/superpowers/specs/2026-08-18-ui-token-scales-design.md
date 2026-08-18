# UI token scales

Date: 2026-08-18

## Goal

Give every size in this app a token. Take the values from Material Design 3.

The app holds 21 font sizes, 8 border radii and about 30 ad-hoc paddings. Nothing names them.
A person picks a size by eye, so the count grows on every change.

This work changes no color, no font and no visual style. It changes sizes only.

## What the audit measured

| axis | today | after |
|---|---|---|
| font sizes | 21 distinct values | 7 text rungs plus 5 icon rungs |
| border radii | 8 distinct values | 4 rungs plus the literal circles |
| padding | about 30 ad-hoc pairs | the 4dp grid |
| font weights | 400 and 500 | unchanged |

The variable font carries weights 100 to 900. This work does not spend them. That is a visual
change, and the reader scoped this pass to consistency alone.

## Two scales, not one

**32 of the 136 font-size declarations size an icon, not text.** An `.i` is a mask box.
So `font-size` sets the glyph box, not a type size.

A type scale and an icon scale answer different questions. One blind replacement puts icons on the
type ramp. That is the fault this section exists to prevent.

Read every declaration and classify it first. Do not run a global replacement over a px value.
`15px` on `.popname` is text. `15px` on `.sect > summary .i` is an icon.

## The token layer

Every token lives in the `:root` block of `css/base.css`. The palette already lives there, and
CLAUDE.md fixes that home. This work adds no second home.

Tokens divide into two kinds.

A **scale token** takes its value from M3. It moves pixels.

A **held token** carries a value this app computed, or a value JavaScript repeats. The token makes
the number easy to find. It does not make the number free to change.

### Type

| token | px | M3 role | absorbs | moves |
|---|---|---|---|---|
| `--text-micro` | 10 | none | 8, 9, 10 | 8 to 10, 9 to 10 |
| `--text-label-sm` | 11 | label-small | 11 | none |
| `--text-label-md` | 12 | label-medium | 12 | none |
| `--text-body-md` | 14 | body-medium | 13, 14 | 13 to 14 |
| `--text-body-lg` | 16 | body-large | 15, 16, 17 | 15 to 16, 17 to 16 |
| `--text-title-lg` | 22 | title-large | 18, 20, 22 | 18 to 22, 20 to 22 |
| `--text-headline-sm` | 24 | headline-small | 24, 32, 34, 36 | 32, 34, 36 to 24 |

### Icon

| token | px | absorbs |
|---|---|---|
| `--icon-sm` | 16 | 14, 15, 16 |
| `--icon-md` | 20 | 18, 20 |
| `--icon-lg` | 24 | 22, 24 |
| `--icon-xl` | 40 | 34, 40 |
| `--icon-2xl` | 48 | 48 |

### Shape

| token | px | absorbs |
|---|---|---|
| `--r-xs` | 4 | 2, 4 |
| `--r-sm` | 8 | 6, 8 |
| `--r-md` | 12 | 10, 12 |
| `--r-full` | 999 | 999 |

The 12 rules that state `50%` keep it. A circle is not a radius choice.

### Spacing

The M3 4dp grid: 4, 8, 12, 16, 24 and 32. Snap the odd values 3, 5, 7, 9, 10 and 14.

### Held tokens

| token | px | why the value holds |
|---|---|---|
| `--pin-box` | 39 | `render.js` repeats this as `iconSize` |
| `--pin-glyph` | 36 | sized against that box |
| `--pin-lg` | 48 | `showPlace()` repeats this as a divIcon size and anchor |
| `--pin-fav` | 17 | the smallest shape on the map, and a heart reads by shape |
| `--ctl-box` | 40 | 40 less 22 gives the 9px padding that abuts two boxes |
| `--ctl-glyph` | 22 | the other half of that arithmetic |
| `--tap-min` | 44 | the touch target floor for the phone zoom control |

Two paddings hold their value and take no token. `.pophead` keeps `padding-top: 18px`. `.acccol`
keeps `padding-top: 16px`. CLAUDE.md states the arithmetic behind each one.

**A token in CSS does not repair a constant in JavaScript.** `render.js` holds 39. `showPlace()`
holds 48 and the anchor 24, 44. This work adds a comment beside each held token. It names the
JavaScript twin. It does not plumb a CSS value into a module.

## The judgment calls

### 18px has no M3 rung

M3 offers 16 and it offers 22. It offers nothing between them. Eight text declarations read 18px.

**This spec sends them to 22.** That is a 4px rise on a section heading.

Shoot both values before commit 2 lands. If 16 reads better, amend this spec and then sweep. Do not
leave the choice to the person who runs the sweep.

### The micro rung deviates from M3, on purpose

M3 stops at 11px. M3 targets a consumer app. This app is dense telemetry.

Two rules need a rung below label-small. `.acc sup` is the provenance asterisk at 8px. `.wxnow` is
a weather micro-label at 9px. A rise to 11 grows the asterisk by 37 percent.

`.acc sup` carries `line-height: 0`. So a taller mark cannot disturb the bar measurement above it.
CLAUDE.md states that rule.

## Sequencing

Five commits. Each one reverts on its own.

| step | commit | visual risk |
|---|---|---|
| 1 | Define the tokens. Nothing reads them yet. | none |
| 2 | Sweep type and icons, 136 declarations | high |
| 3 | Sweep the radii, about 50 declarations | low |
| 4 | Sweep the padding, and honor the held list | medium |
| 5 | Remeasure the wordmark thresholds in `css/chrome.css` | none |

Commit 1 lands alone on purpose. That makes commits 2 to 4 pure substitutions. A reader of the diff
then sees values and nothing else.

**Bump the `?v=` number on every commit, not once at the end.** Herd serves CSS with
`max-age=10800`. Without a bump per step, the screenshots read a stale stylesheet.

## Verification

### The harness

`shot-tmp.html` sits in the project root and takes three parameters. They are the surface, the
width and the theme.

It writes the theme preference to `localStorage`. It sizes an iframe. It drives the app to the
surface. Chrome then captures the page with `--screenshot`.

`narrow-test.html` already uses this shape. A media query inside an iframe answers to the width of
that iframe. So no browser driver is necessary, and this adds no dependency.

Delete `shot-tmp.html` when the sweep lands.

### The matrix

This work changes sizes. It changes no color. Theme is a color axis, so the matrix drops it.

Ten surfaces at two widths, 1536 and 600, on the light theme. That is 20 shots per side and 40
shots in all. Add three dark spot checks on the drawer, the station card and the table.

The ten surfaces are the map with the drawer, the station card, the alert panel, the all-stations
table, the camera wall, the lightbox, About, the weather panel, the go-to search and the narrow
block.

Shoot before commit 1. Shoot again after commit 4. Read the pairs.

### What the shots hunt

1. Text that wrapped to a new line, or text that stopped wrapping.
2. A control whose box no longer lines up with a neighbor.
3. The wordmark ladder that picked a different rung at one width.
4. A table column that moved enough to change the row count on screen.
5. Anything clipped or truncated. CLAUDE.md names this the silent failure of the wordmark ladder.

### The five existing checks

| check | expectation |
|---|---|
| `title-test.html` | reports a failure by design. Commit 5 repairs the cause. |
| `narrow-test.html` | stays green. It asserts coverage and modality, never spacing. |
| `heat-test.html` | unaffected. It reads canvas pixels. |
| `shots-test.php` | unaffected |
| `php api.php --selftest` | unaffected |

**The check itself needs no edit, and an earlier draft of this spec said it did.** `title-test.html`
hardcodes no threshold. It measures the drawn spelling at fifteen widths. It then asserts three
properties. One spelling draws at a time. That spelling fits its rail. A narrower rail never draws a
longer spelling.

The three numbers that need remeasuring live in `css/chrome.css`. They are the container query
values 190, 282 and 93, at lines 46, 49 and 54. Each one is a measured font width at 22px Roboto,
plus 32 for the drop and its gap. This work moves the heading size, so all three go stale.

So the check reports a failure until commit 5 lands. Commit 5 edits the stylesheet, never the check.

## Documentation

CLAUDE.md states that documentation lands with the change. Two edits belong to this work.

`docs/FEATURES.md` records what shipped. It states why this app took the M3 scale. It states the
micro rung and the reason for it.

The Conventions section of CLAUDE.md gains one entry. Sizes come from tokens. Text and icons take
separate scales. A held token holds its value.

**Without that entry this work undoes itself.** The next person adds the 22nd font size, and
nothing on the page says not to.

## Out of scope

Do not add any of these to this pass.

- `clamp()` for fluid type. That moves sizes, and the reader scoped this pass to keep the look.
- `oklch()`, `@layer`, `@starting-style` and view transitions.
- The palette. The kind and status tokens carry four passes of contrast work.
- The font weights 600 and 700.
- `css/icons.css`, because a script generates it.
- The stylesheets under `vendor/`.

## Files

| file | change |
|---|---|
| `css/base.css` | the token block, and its own sweep |
| `css/chrome.css` | sweep |
| `css/map.css` | sweep |
| `index.html` | the version bump on each stylesheet link |
| `docs/FEATURES.md` | the record of this work |
| `CLAUDE.md` | one Conventions entry |
| `shot-tmp.html` | added, then deleted |

## Checks

```bash
# No px value may remain on a font-size outside the token block.
grep -n 'font-size: *[0-9]*px' css/base.css css/chrome.css css/map.css | grep -v ':root'

# Every token the stylesheets read must exist. An undefined custom property fails in silence.
grep -oh 'var(--\(text\|icon\|r\|pin\|ctl\|tap\)-[a-z0-9-]*' css/*.css | sort -u

# The two PHP checks that must stay green.
php shots-test.php
php api.php --selftest
```

Run `heat-test.html` and `narrow-test.html` from the Verify block of CLAUDE.md. Both must read PASS.
`title-test.html` must read PASS after commit 5, and it fails before that commit.

## What this ships unverified

Nobody has measured the three wordmark thresholds against the new heading size. Commit 5 does that
work, in `css/chrome.css`. Until it lands, `title-test.html` reports the failure this spec predicts.
