# Move the app bar controls into an M3 navigation rail

Date: 2026-08-21. Branch: `m3`.

## The problem

The app bar carries a wordmark, a status dot, an alert marquee and five controls. The five controls
are `#menu`, `#find`, `#alertBtn`, `#locate` and `#apps`. Two of them open a panel of their own. One
of them expands to a 300px search box, which pushes the other controls along the bar.

M3 names a component for this set. A navigation rail holds the destinations of an app on the leading
edge. A top app bar holds a headline and a small number of actions. This app puts eight destinations
in a bar built for two or three.

## What ships

### Layout

Two new tokens sit beside `--hdr`, `--gap`, `--seam` and `--pane-w`.

| token | above 600px | below 600px |
|---|---|---|
| `--rail-w` | 96px | 0 |
| `--navbar-h` | 0 | 64px |

The map card reads both:

```css
#map { inset: calc(var(--hdr) + var(--gap))
              calc(var(--pane-w) + var(--seam))
              calc(var(--navbar-h) + var(--gap))
              calc(var(--rail-w) + var(--gap)); }
```

Every furniture box that adds `--pane-w` today gains the term for the edge it measures from.
`#legend` is the only box on the leading edge. It adds `--rail-w` to its `left`, and subtracts the
same number from its `max-width`. `#pills` centers on
`calc(50% + var(--rail-w) / 2 - var(--pane-w) / 2)`. Below 600px, `#credit`, `#legend`, `#paint`,
`#pills`, the Leaflet zoom control and `#paintmenu` each add `--navbar-h` to `bottom`.

### The rail, above 600px

`<nav id="rail">`. The numbers come from `NavigationRail/navigation-rail.css` in bczak/m3you, the
same reference `css/chrome.css` already cites.

    container    96px wide, padding-block 44px 20px, background surface
    items        gap 4px, each item min-height 64px
    icon         24px
    label        title-small, on-surface-variant, bold when active
    indicator    56 by 32, corner-full, secondary-container, top 6px

The rail holds seven items in two sections:

    Filters
    Alerts
    Search
    Table
    Cameras
    ----------
    Help
    About

`#apps` stays at the foot of the rail, under a flex spacer. It holds the theme picker and nothing
else. The menu keeps the `.menu` class, so the delegated placement handler in `js/ui.js` needs no
new code.

The rail takes no menu slot and no FAB slot. M3 puts a compose action in the FAB slot. No control
here composes anything.

Seven items, a divider and the padding M3 states measure about 520px. So the item list scrolls under a
window about 600px tall. `.md-navigation-rail__items` carries `overflow-y: auto` for that, and this
app takes the same rule.

### The bar, below 600px

`<nav id="navbar">`. The numbers come from `NavigationBar/navigation-bar.css` in the same repo.

    container    min-height 64px, padding-block 4px
    safe area    padding-bottom calc(4px + env(safe-area-inset-bottom, 0px))
    item         flex 1 1 0, icon over label
    indicator    the same 56 by 32 pill

The bar holds the five destinations. Help, About and Theme go to `#apps`, which returns to the first
row of the app bar. The other four buttons vacate that row.

The viewport meta tag gains `viewport-fit=cover`. Without it the `env()` above reads 0 on iOS.

### The app bar

The app bar keeps the wordmark, the status dot and the alert marquee at both widths. It keeps
`#apps` below 600px. It carries no other control.

### Search

`#gotoBox` leaves `.hactions` and becomes a third box inside `#pane`. The two boxes today are
`#bar` and `#side`. The weather card draws inside `#side` under a `@wx-` key.

A new body class `find` joins `drawer` and `side`. `syncPane()` in `js/map.js` tests it. The
`--pane-w` rule in `css/chrome.css` reads it. The occupant inherits `--m3-swap`, the full-screen
dialog below 600px, and the rule that one pane holds one occupant.

The phone rule at `css/chrome.css:2442` gives the search the row the marquee holds. Delete it.

### The locate button

`#locate` moves to the zoom cluster on the map, beside `#paint`. It acts on the map. A navigation rail
holds destinations. This app already states the rule: a control the reader reaches for while looking
at the map goes on the map.

### The selected state

An item is active while the surface it opens is on screen. A bare map selects nothing. A station
card selects nothing. A weather card selects nothing.

`syncPane()` already watches the body classes through a `MutationObserver`. It writes the rail too.
One writer, which is the shape `syncHeat()` established.

The active color reuses the selected language this app already holds. `.seg label:has(:checked)` paints
`background: var(--accent)` and `color: var(--surface)`. So the bridge in `css/base.css` gains two
lines:

```css
--md-sys-color-secondary-container: var(--accent);
--md-sys-color-on-secondary-container: var(--surface);
```

M3 paints that pill in a low-chroma tint. This app holds one surface tone, and it already declines
`surface-container-high` for the same reason. A tint mixed here is a color that lives outside
`css/base.css`.

### The pane below 600px

`#pane` keeps `showModal()` below 600px. It covers the bottom bar.

So below 600px every destination hides the navigation that reached it. The bar is a launcher there,
and never a state display. A reader takes two presses to move from one destination to another.

This is a cost, and the repository owner accepted it on 2026-08-21. The other option reverses a
documented decision. That decision gives the pane the top layer, a real focus trap and an inert page
behind it.

The active indicator therefore reads above 600px alone.

## The checks

Three of the seven runnable checks meet this change.

`m3-check.html` reads every `<dialog>` into a roll call. The rail and the bar are each a `<nav>`,
so neither joins that roll call. Each needs an assertion block of its own instead. `FURNITURE`
gains `#navbar`. The leading edge gains an assertion, beside the trailing-edge one it already holds.
The loop over the pane occupants grows from two to three.

`title-test.html` guards the wordmark ladder. Above 600px the title rail does not move, because
`header h1` caps at 300px. Below 600px the freed row can move the wordmark up a rung. Read the
result. Do not assume it.

`paint-check.html` measures `#paint` against the zoom box. The rail does not reach either one. The
`--navbar-h` offset does.

## Not built

- No expanded 220px rail, and no control to expand one.
- No modal rail.
- No `Map` item that means "nothing is open".
- No rail slot for `#locate`.
- No second copy of the bar inside `#pane`.

## Evidence for each decision

**The bar keeps the wordmark.** The rail takes the leading edge, so the bar has room for the marquee
it already carries. `--hdr` does not move above 600px.

**A bottom bar below 600px.** M3 states no rail under 600px. A 96px rail takes 27% of a 360px
screen.

**Five destinations.** M3 caps a navigation bar at five items. One composition serves both shapes.

**Search opens in the pane.** A 96px rail cannot hold a 300px field. `#pane` is the search view M3 states at
compact width, and a side sheet above it.

**Help and About are rail items.** The repository owner asked for them on 2026-08-21. A divider
separates them from the five destinations, which is the secondary rail section M3 states.

---

# Amendment, 2026-08-24

The repository owner asked for five changes. Three of them were already in flight in the working
tree when the request arrived. Each entry states what ships, what it reverses, and what it costs.

## 1. Filters draws `filter_alt`

The rail item for the filters carried `menu`, which names a navigation drawer holding a list of
destinations. The pane holds a district picker, an ignored list and a favorites list. So the
item names a filter and now draws one.

`--i-filter_alt` joins `css/icons.css` by the refetch the header of that file states.

## 2. The search floats over the leading top corner, above 600px

`#gotoBox` leaves `#pane` on a desktop. It becomes a floating box over the map, on the leading
edge under the app bar. Below 600px it stays a pane occupant.

**This reverses Task 1 on one width, and the cost is on record.** The search moved into the pane
because a 96px rail cannot hold a 300px field. That reason still holds — the box floats over the map
rather than sitting in the rail. The second cost is older. `CLAUDE.md` records the search as a 300px box parked over the
top-right of the map. It spent that much map on every screen that never used it. This is the same trade at the other corner. The repository owner accepted it on 2026-08-24.

The box stays collapsed to its rail item until a reader asks for it. So the map pays for it only
while a search stands open.

Below 600px nothing changes. A 300px floating box on a 360px screen is the whole screen.

## 3. The brand moves into the rail, and the status dot goes

The `<h1>` moves from the app bar into the rail above 600px, and back to the app bar below it. One
heading, two homes. `js/ui.js` moves it on the breakpoint. A second copy is a second `<h1>` for
a screen reader to read.

M3 states no brand slot for a navigation rail. So the brand takes the geometry of the one slot M3 states
beside the menu, which is the FAB slot: 56px tall with 4px above it, centered while the
rail collapses.

**The status dot goes, and only the glyph stays.** Delete `#net`.

**The cost is real and the repository owner accepted it.** That dot was the only always-visible
signal that the feed is alive. `#netstats` carries `tookMs`, `cacheAge`, the per-source counters and
`sources.stale`, and a hover over the mark is what opened it. So the popover re-anchors to the brand glyph
in the rail. A hover over that glyph opens it. The diagnostics stay reachable. Nothing on
screen reports a stale poll at a glance any more.

## 4. The rail expands and collapses

M3 states both variants and this app now ships both. The numbers come from
`NavigationRail/navigation-rail.css` in bczak/m3you.

    collapsed   96px, items centered, label under the icon
    expanded    220px, `padding-inline: 20px`, items box 180px wide at `gap: 0`
    item        56px tall when expanded, leading aligned, surface `border-radius: 28px`
    indicator   `inset: 0` when expanded, rather than the 56 by 32 pill
    menu slot   56px tall, leading aligned when expanded and centered when collapsed
    motion      `duration-short2` on `easing-standard`, which is NOT `--m3-travel`

**This reverses the "Not built" line above.** That line refused an expanded rail and a control
to expand one. The repository owner asked for both on 2026-08-24.

`--m3-rail` carries the motion. Four edges read it: the rail, the leading edge of the app bar, the
leading inset of the map, and the diagnostics popover. So the four cannot drift apart.

`PREFS` holds the state, the way it holds every other reader setting.

`#railToggle` is the control. It draws `menu_open`. A `:has()` rule turns it 180 degrees when the
rail opens. So one glyph names the direction the press moves the rail. Nothing keeps two marks in
step.

## 5. The ticker spans both panes

The app bar starts where the rail ends and runs to the trailing edge, so it covers the map card and
the supporting pane together. `left: var(--rail-w)` is the whole of it, and it answers both widths:
below 600px `--rail-w` is 0 and the supporting pane is a destination over the map, so the bar spans
the map alone.

**So the rail runs the full height of the window on the leading edge**, from the top rather than
from under the app bar. `m3-check.html` asserted the old shape and now asserts this one.

**This reverses the layout section above.** The app bar spanned the window and the rail started
under it.

## What this amendment does not change

The five destinations, the divider, Help and About, and the theme button under the spacer. The
locate button on the map. The selected state and what it tracks. The navigation bar below 600px.
`#pane` keeping `showModal()` below 600px.

# Amendment, 2026-08-24 (second)

The repository owner asked for three more changes. Each one names a component the earlier design
approximated.

## 6. Search takes M3's FAB slot

`NavigationRail/navigation-rail.css` places a FAB between the menu slot and the items. The search
moves out of the item list and takes that slot, directly under the brand.

**A FAB is an action. A rail item is a destination.** Only a destination can be the current one. So
the search carries no indicator pill and no `aria-current` any more. `aria-expanded` states whether
the search is on screen.

**One writer, and it is `railSync()` in `js/map.js`.** `setFind()` wrote that attribute before.
`setDrawer()` clears the `find` class directly below 600px, so a write inside `setFind()` alone goes
stale on that path. This is the rule this repository already states for every derived fact.

The numbers are `Fab/fab.css`'s own medium FAB. A 56px box, `shape-corner-large`, a 24px glyph, and
the primary pair. Elevation is `--shadow`, this app's one elevation.

**Collapsed it shows no label. Expanded it draws M3's extended form**: the same height,
`padding-inline: 16px`, and the label beside the glyph.

**It states `min-width` and never `width`.** A box sized by its own content travels between the two
states. A `56px` to `auto` pair cannot animate at all. The label clips to zero rather than leaving
the flow, so the box has something to grow from.

**The 12px gap rides the label, not the FAB.** A flex `gap` applies between two items even when one
of them measures nothing. So a gap on the container pushes the glyph off the centre of a collapsed
FAB by 6px.

## 7. The bar and the results are two surfaces

Above 600px the docked search was one card holding the field and the list. It is two boxes now, each
with its own tone, its own elevation and its own corner.

`Search/search.css` draws the search bar as a pill of its own. The results sit on a separate raised
surface under it. One card put the control and its answer on one tone, under one shadow, so a reader
read one surface rather than two.

`#findpane` paints nothing at this width. `#gotoBox` is the column inside it, and that column states
the 8px between the two boxes.

**A hidden results box contributes no gap**, so a bar with nothing to say stands alone.

**The search bar keeps its focus ring.** The single-card rule carried `#goto:focus { outline: none }`,
which beat the base stylesheet's own `:focus-visible` ring for a keyboard reader too. That rule is
gone.

## What this second amendment does not change

The four remaining destinations, the divider, Help and About, and the theme button. The brand slot.
The rail's own widths and its motion. The docked card's placement, its cap against the pane, or the
ways out of it. The search below 600px, which is still M3's full-screen search view inside `#pane`.

## 8. The search bar leads with a back arrow

`Search/search.css` draws the docked search bar as a row: a leading icon, then the field. The
leading icon of an active search view is a back arrow, and it dismisses the view.

**So the bar is the surface, not the field.** `#gotobar` holds the corner, the tone and the
elevation. `#goto` inside it paints nothing.

`padding-inline: 4px 8px` around a 48px target puts the arrow's glyph centre 28px in. That is where
every full-screen bar in this app already lands one.

**The arrow draws above 600px alone.** Below 600px the search is M3's full-screen search view inside
`#pane`, and `#findHead` already leads with the same arrow. Two arrows on one surface is one control
drawn twice, and each looks right on its own.

## 9. The results take M3's own list

M3's one-line list item: a 56dp row, `padding-inline: 16px`, a 16dp gap, a 24dp leading icon, and
`body-large` for the name. A row in a list carries no corner, so the 6px pill is gone.

**Scoped to `#gotoHits`, never to `.picklist`.** Three other lists wear that class: the district
filter, the ignored list and the favorites list. Each is a filter row inside a pane, and none of
them is a search result.

**Hover and keyboard selection stop being one look.** M3 draws a hover as a state layer, `on-surface`
at 8%. A selected row is where the keyboard stands, and it keeps the accent tint. Both painted the
same tint before, so moving a mouse across the list erased the one mark that says what Enter opens.

**The supporting line states its own size.** `.muted` carries a 12px declaration, and a declaration
on the element beats anything a row inherits. So `body-medium` is written on `#gotoHits .nm small`
or the line draws at 12.

# Amendment, 2026-08-24 (third)

## 10. A collapsed rail carries the destinations and nothing else

The brand, the divider, Help and About draw at 220px alone. The four destinations, the search FAB
and the theme button draw at both widths.

The divider goes with them. It separates the four destinations from Help and About, and with both
of those gone it separates nothing.

**This costs the diagnostics popover while the rail is shut.** `#netstats` opens on
`body:has(#brand .mark:hover)`, and a hidden brand has no hover to give. One press of the rail
toggle brings it back. The About dialog's Developer section still holds the source counters.

**`title-test.html` needed a new question.** It read which wordmark rung drew by asking each span
for its computed `display`. A `display: none` on an ANCESTOR does not change that value, so a shut
rail reported a spelling on a heading that generates no box. The test is `getClientRects().length`
now, which is empty whichever ancestor decided it.

## 11. The theme is two states and the button is the switch

`#railApps` held a popover carrying a three-way pill: Auto, Light and Dark. One press flips the
theme now, and there is no box to open.

**A first visit still opens the way the reader's desktop looks.** The system's answer seeds
`PREFS.theme` once and is then stored. Nothing follows the system after that. A stored theme is a
theme the reader owns, and a page that restyles itself at sunset is what "no auto" refuses.

**The glyph and the words name the next press, never the theme on screen.** A reader can already see
the shade they are looking at.

**`#appMenu` and `.seg` are deleted.** That popover held four destination tiles, which are rail items
now, and the theme row. `.seg` was this app's own sunken track and the theme pill was its only
markup. The lightbox range selector shared those rules and keeps its own numbers under `.tlranges`
and `.tlr`.

The `themePick` migration went too. It existed to stop a resolved value from the old two-state
toggle reading as a deliberate pick. A resolved value IS the pick again.

**This reverses the three-state theme control described in `CLAUDE.md`.** That section, and the
`#appMenu` entries beside it, are now wrong. Task 7 corrects them.

**Task 6 loses its stated plan for Help and About.** The plan put those two rows back into
`#appMenu` below 600px. That element no longer exists, so the navigation bar needs a home of its own
for them.

## 12. One column, one size

Every glyph in the rail stands on one leading edge and draws at one size, at both rail widths.
Three did not, and the repository owner named it on 2026-08-24.

**Two faults.** The menu button and the theme button take `.icon`, which draws 22px against M3's
24px for a rail glyph. And an open rail leads an item with `padding-inline: 16px`, while those two
buttons and the brand mark each started on the rail's own 20px padding edge. Measured: items at
left 36, and 29, 20 and 29 for the three.

**M3's own reference leaves that offset.** `NavigationRail/navigation-rail.css` starts the menu
button on the padding edge and pads an item 16px inside it, so that file draws two columns. A reader
sees one column with three glyphs out of it, and reads it as a fault.

A 40px button centres a 24px glyph, so 8px of the 16px lead is the button's own box. The rule states
that arithmetic as a `calc()` rather than the 8 it comes to.

**The brand's own box gives up the lead it now carries.** It was 180px, the 220px rail less its own
20px of inline padding. It is 164px, because `.railbrand` leads with 16px more and the rail clips.

**The mark went to 24px and both wordmark thresholds moved 2px with it.** The drop and its gap add
32 rather than 30. Neither move changes what draws: the only real box is 164px, which clears 147 and
never reaches 215.

**`m3-check.html` asserts the property, never the 36 and the 24.** A rail at another padding, or an
icon at another size, still has to draw one column. A pair of literals passes a rail that moved every
glyph together and fails one that moved none.
