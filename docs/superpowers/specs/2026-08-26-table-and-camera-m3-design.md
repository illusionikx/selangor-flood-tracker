# The all-stations table and the camera wall, on the M3 standard

Date: 2026-08-26

## Goal

Bring `#dataBox` and `#camBox` onto Material Design 3, at both widths. Make the two panels obey the
same header, the same back button and the same inset as the other panels.

## The constraint that shapes this work

**M3 publishes no data table component.** M2 published one. M3 did not carry it over. So no
reference file can supply this table. Every part of it borrows a named M3 component, or it states a
divergence and says why.

The camera wall has the opposite property. A tile maps onto M3's card. Most of that work is
transcription.

## What already matches

The app bar and the back arrow match. Both panels draw `#sideHead`'s medium flexible top app bar,
stated once in `css/chrome.css`. Both lead with the back arrow at both widths. This work changes
neither.

## What is wrong today

Every item below states a measurement. None of them is a guess.

- **One panel states four insets.** The headline sits 16px in. The filter field sits 16px in. A
  table row's name sits 20px in, and 14px on a phone. The camera grid sits 20px in, and 12px on a
  phone. So the headline and the first column under it do not line up, at either width.
- **Neither panel reads the bottom safe area.** Only `--navbar-h` reads
  `env(safe-area-inset-bottom)`. Both panels take `100dvh` on a phone. So `#camCount` and the last
  table row sit under the iOS home indicator.
- **The sort control is 30px tall.** M3 states a 48dp minimum touch target. A phone reader taps a
  column head and often misses it.
- **The name column takes 220px of a 360px screen.** That is 61% of the width. The table scrolls
  sideways behind that column, so a reading has about 140px to draw in.
- **The filter field is a plain input.** It shares one rule with `select` and `#goto` in
  `css/base.css`. It matches no M3 component.

The hover panel is correct as it stands. `js/table.js` already opens it on a click, so a phone
reader reaches it.

## Decisions

The repository owner made all five. This document states every cost. The repository owner accepts
every one of them.

### 1. The table keeps its columns

The rows stay a grid of columns. Each part borrows a named M3 component. The alternative was one
M3 list item per place. That alternative loses the column scan, and a reader cannot run an eye down
one sensor kind.

### 2. A camera tile becomes an M3 filled card

The alert border stays at 2px. It is this app's status language, not a card outline. An outlined
card states a 1dp neutral line instead. Around a 254px tile, 1dp of red is much quieter than 2px.

### 3. The filter becomes an M3 search bar

**Cost, accepted.** In M3 a search bar opens a search view. These two fields filter what is already
on screen. The go-to box is a real search view, and it wears the same shape. So this app now draws
one search shape for two behaviors. The alternative was M3's outlined text field, which is the
honest component and draws a second field shape.

### 4. The cell badges become M3 assist chips

**This reverses a rule in CLAUDE.md.** That rule says the chip conversion stops at the pane,
because a 32dp chip in a table cell is a row height. The repository owner reversed it on
2026-08-26. Delete the old rule. Do not leave two rules that disagree.

The chip carries the **reading** as its label. It does not carry the status word. So `light` and
`ankle deep` leave the cell.

**Cost, accepted.** The status word leaves three cells. The hover panel still states it, and that
panel opens on a click, so a phone reader reaches the word in one tap.

### 5. A river cell keeps its meter and gains a chip

The river cell has no badge today. It draws a mini meter and the level under it. It now draws the
meter, and a chip under the meter.

**Cost, accepted.** A river cell measures about 84px. Every other cell measures about 52px. So the
table reads at two row heights. Measured on the cached payload: 459 places, 118 with a river (26%)
and 341 without (74%). So about one row in four runs tall.

## The shell, both panels

### One inset

`#dataBox` and `#camBox` each declare `--pane`, the way `.docbox` already does. Every box below the
app bar reads it back:

- the search bar's `margin-inline`
- the count line
- `#camGrid` and its skeleton
- `td.nm`, `.dhead th` and the sticky corner cell

Four numbers become one number.

### The compact value moves to 16px

`.docbox` sets `--pane: 18px` on a phone. Move it to 16px. The app bar states its headline 16px in,
at every width. 24px under a 16px headline reads as deliberate indentation. 18px under it reads as
a mistake. 16px lands the body on the app bar's own line.

This is one number, and it corrects all five panels at once.

### The bottom safe area

Below 600px, `#camCount` and `table.data` add `env(safe-area-inset-bottom, 0px)` to their own
bottom padding. Above 600px neither panel touches the window edge, so neither needs it.

### The search bar

Both fields take one class. The numbers come from the M3 Expressive component set's
`Search/search.css`:

- 56dp container, full corner (28dp)
- `surface-container-high`
- a 24dp leading `search` glyph, 16dp in
- `body-large` text
- a trailing `close` glyph that clears the field

Both fields leave the `select, #goto` rule in `css/base.css`.

### The count line

`#dataCount` and `#camCount` become M3's list subheader: `title-small` in `on-surface-variant`,
48dp, at `--pane`. That is the component the alert panel, the Notices pane and Settings already
draw.

`#camCount` keeps its place under the grid. That divergence carries its own reason already.

### The progress bar

`#camBar` takes M3's linear progress indicator colour roles and its 4dp height. It keeps its seam
placement.

It declines three parts of the M3 Expressive variant: the rounded ends, the 4dp gap between the
active indicator and the track, and the stop indicator. Each of those shapes a widget parked in a
layout. This bar is the state of a boundary, and `css/chrome.css` already argues that.

## The table

### Column heads

- `label-large` in `on-surface-variant`
- sentence case, not the uppercase letter-spaced block they draw today
- 56dp tall, which reaches M3's minimum touch target

The sort mark becomes `arrow_upward` at 18dp. Today it is a CSS triangle drawn from borders. That
triangle exists only because an uppercase letter-spaced cell cannot hold a glyph. Sentence case
removes that reason.

`table.data .dhead th` sticks at `top: 30px` today, which is `.chead`'s own height. The head grows
to 56dp, so that offset must follow. State the two numbers together, or the district head parks
over the column heads.

### District heads

They become M3's list subheader, the same component the count line takes. So the table, the alert
panel, the Notices pane and Settings all head a group the same way.

### A row

A row takes M3's state layer: `on-surface` at 8% on hover and 10% on press. Today it takes
`var(--hover)` on hover and nothing on press.

The `here` row keeps its accent tint and its inset rail. That is a marker, not a state, so the two
never collide.

### A cell

| kind | today | after |
|---|---|---|
| siren | one badge | one chip, label `idle` / `triggered` / `offline` |
| rainfall | badge `light`, then `4 mm/h` | one chip, label `4 mm/h` |
| flood gauge | badge `ankle deep`, then `0.2 m deep` | one chip, label `0.2 m deep` |
| river | meter, then `1.74 m` | meter, then one chip, label `1.74 m` |
| camera | `Show image` button | unchanged |
| no sensor | `—` | unchanged |

The chip is M3's assist chip, the same component `#sideKinds` and the alert head already draw: 32dp,
`shape-corner-small`, a 1dp outline, `label-large`, an 18dp leading icon.

**The colour splits the way M3 splits it.** The label takes `on-surface`. The 18dp leading icon
takes the status hue. A chip whose label wears the status starts under 4.5:1 against its own tint,
which is the contrast problem `.state` in `css/base.css` already records.

So the column scan becomes a column of coloured dots at a fixed position. It was a column of filled
colour bands. That is weaker, and it is the accepted cost of decision 4.

The camera cell keeps its button. A button is not a chip, and `Show image` is an action.

### The phone

The name column drops from 220px to 160px below 600px. 220px is 61% of a 360px screen.

### The hover panel

`.tipbox` becomes M3's rich tooltip:

- `surface-container`, a 12dp corner
- `title-small` head
- `body-medium` rows

It is a `popover` already, and it already holds a head over rows. So this is tokens and numbers
only.

## The camera wall

### A tile

`.camtile` becomes M3's filled card:

- `surface-container-highest`
- a 12dp corner, up from 10px
- no outline
- a state layer at 8% on hover and 10% on press

Today the tile draws `--hover` at a 10px corner, and it answers a pointer with nothing.

### What does not move

- The 2px alert border, in `--s-danger` and `--s-warning`. See decision 2.
- The `unmapped` dashed border. It says "not a control" without reaching for a status hue.
- The overlay name, the alert phrase and the note. They sit on a photograph, so their literal
  whites and their gradient are correct already, and `css/chrome.css` argues each one.
- The grid, the 16:9 ratio and `grid-auto-rows: min-content`. Each one carries a measured reason,
  and one of them records a fault that drew every tile over the two below it.

## Divergences to write into CLAUDE.md

1. A search bar in this app filters in place and opens no view. One shape, two behaviors.
2. A camera tile is an M3 filled card with a 2px status border. That border is not a card outline.
3. The table's row height is not uniform. A river cell is about 84px and every other cell is about
   52px.
4. `#camBar` declines three parts of the M3 Expressive linear progress indicator.

Delete the rule that says the chip conversion stops at the pane. See decision 4.

## Files

| file | what changes |
|---|---|
| `index.html` | the two filter fields, the two count lines |
| `css/chrome.css` | most of this work |
| `css/base.css` | the field rule loses two selectors, `--pane` moves to 16px on a phone |
| `js/table.js` | the cell builder, the sort mark |
| `css/icons.css` | `arrow_upward` and `close`, where either one is absent |
| `m3-check.html` | one block per surface |
| `CLAUDE.md` | the four divergences, and one deletion |
| `docs/FEATURES.md` | what shipped and why |

## The check

`m3-check.html` grows one block per surface. It runs at 360px and again at 1200px. It asserts:

- the headline's left edge against the first column's left edge, which is the one-inset rule
- the search bar's height and its corner
- the sort target's height
- the tile's container tone and its corner
- a chip cell's height, and a river cell's height
- the two deletions, so a half-finished revert cannot ship markup that draws and errors nowhere

A deletion needs an assertion. Markup left behind by a partial revert draws on screen and reports
no error.

## Not doing

- No change to the app bar or the back button. Both match already.
- No change to the grid, the tile ratio or the row heights of the wall.
- No M3 list item conversion for table rows. See decision 1.
- No change to `#lightbox` or `#warnBox`. Both are basic dialogs at every width.
