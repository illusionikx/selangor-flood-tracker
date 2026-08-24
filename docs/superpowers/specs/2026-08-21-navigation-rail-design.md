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

## 13. The menu glyph names the rail's own state

M3 draws `menu` on a collapsed rail and `menu_open` on an expanded one. The repository owner asked
for that pair on 2026-08-24.

One `menu_open` turned 180 degrees stood here first. That names the direction of the next press
rather than the state the rail is in.

**This reverses section 4 of the first amendment**, which stated the rotation and the reason for it.

`.i` masks with `var(--i)` and `.i-menu` sets that from one class, so two ids and a class win the
override. The swap needs no second element and no JS, and it reads the same `body.railopen` class
every other expanded-rail rule reads.

**A mask cannot tween**, so the swap is instant and carries no transition.

**`m3-check.html` reads `mask-image` against a probe, never the token.** A computed `--i` is not
evidence that anything painted. `paint-check.html` states that rule from its own experience, where a
rule resolved the right token and drew a blank plate.

## 14. The filters glyph never drew

Item 1 of the first amendment moved `#railFilters` to `filter_alt`. It changed the markup and left
the writer that overwrote it, so the new glyph never drew once.

`setDrawer()` in `js/ui.js` rewrote that item's class to `menu` or `menu_open` on every call. That is
right for the hamburger this control was in the app bar, and wrong for a rail item. It ran on the
first `setDrawer()` of every landing, so a reader saw the old glyph and the markup said otherwise.

**A rail item states its selection through M3's indicator pill, not through its glyph.** One glyph,
one meaning. `railSync()` in `js/map.js` drives the pill.

**`aria-expanded` moved to `railSync()` with it.** `setFind()` clears the `drawer` class directly
below 600px, so a write inside `setDrawer()` goes stale on that path. That is the fault the search
FAB already had.

**`m3-check.html` now reads every rail item's glyph against a probe wearing the class its own markup
names**, at both drawer states. Nothing here compared the two before, so reading the markup was the
only evidence the item drew what it said.

## 15. The table item draws `table`

`list_alt` is a list, and the destination is a table. `table_view` was fitted first and the
repository owner rejected it on sight, so `table` is what ships.

**Two markup sites moved together.** The rail item, and the Help glossary entry that names the same
control. Help draws a picture of each control, and a glyph changed on the rail alone leaves Help
stating a control that does not exist.

`list_alt` had no other user, so it is deleted from `css/icons.css` rather than left as a token
nothing names.

**`m3-check.html` reads the Help glossary against the rail**, for five controls. Nothing compared
those two before, which is the same gap that let `filter_alt` sit unread in the markup for a whole
wave.

**Help is stale in ways this section does not fix.** It still carries an `App bar` heading over
controls that live in the rail, a whole `Menu` section for a popover that is deleted, and a Theme
entry describing an Auto setting that is gone. Task 7 corrects them.

## 16. The news moves inside the map card

Above 600px the ticker was a strip across the whole window, above both panes. It took 64px off the
top of everything. The repository owner asked for that space back on 2026-08-24.

`<header>` is a long pill inside the map card now, on the card's own 12px furniture inset, the same
one `#legend` and `#credit` take. `--hdr` is `0px` at that width, so the map card starts at `--gap`
and the supporting pane starts at the very top of the window.

**Below 600px nothing changes.** The ticker is still a header row there, beside the brand. A phone
has no second pane, so there is no space above one to take back, and the brand has nowhere else to
live until the navigation bar lands.

**The pill steps aside on both edges, and each edge rides the motion that edge already has.**
`right` takes the pane's own `--m3-travel` and `left` takes `--m3-rail`.

**The trailing inset is `--seam` and never `--gap`.** A box measuring from the card's trailing edge
measures across the space between the two panes. This shipped with both terms for one measurement,
and the pill stopped 28px short of the card against 12px on the leading side.

**`--top-free` is the one token for the top of the map's free area.** Four boxes read it: the badges,
the toast, the docked search's top and that card's own height cap. Above 600px it clears the pill.
Below 600px it comes to the same `--hdr + 12px` those boxes always read, so the two widths cannot
drift.

**`#netstats` left `<header>` for the document.** A 236px popover cannot be positioned from a 40px
pill. It is fixed against the window now and states the rail term itself, which reverses the note
that said the rail term was never that rule's to add. The mark that opens it lives in the rail, so
the rail is what it stands beside.

**The pill joins the pairwise furniture sweep** in `m3-check.html` and the overlap sweep in
`paint-check.html`. It is a box floating over the map like every other one, and each box is correct
on its own right up until it lands on a neighbour.

## 17. The pill at both widths, and one gap all round

The repository owner asked for two things on 2026-08-24: the phone follows the pill, and the space
around the map card is equal on every edge.

### The pill on a phone

`--hdr` is `0px` at both widths now. The phone bar was 85px in two rows, the brand on one and the
news on the other. Both ride one 40px pill inside the map, 12px in from a full-bleed map's own
edges. Every token in the pill's offsets is 0 on a phone, so one rule answers both widths.

**The brand there is 32px of mark, and the wordmark is what pays for the news.** A 336px pill at a
360px window holds `KV Flood Watch` at 156px and leaves the strip 148, of which 112 is its own fade
ramp. That is a news window nobody can read. Under 93px of container the shared ladder draws the drop
alone, and 32 is well under it.

**So `.w-lg` is deleted.** `Klang Valley Flood Watch` needs 279px in a bar and 215 in the rail. The
bar is gone and the open rail is 164px, so no box in this app can draw it. A rung with no box is a
span, a rule and a threshold that all state a fact about nothing. `KVFW` went the same way earlier,
under the same rule. The full name still draws on the splash and in the About pane, which carry their
own markup.

**The phone ticker kept three rules written for the second row** and one of them overflowed the
document. `flex: 1 0 100%` in a 336px pill drew a 328px strip starting 56px in, so the page ran to
384px and a scrollbar drew along the bottom of the map. The strip takes what is left of the pill now.

### One gap all round

`--map-l` and `--map-r` are the map card's own two insets, as tokens. Every box that floats on the
map measures from one of them, and each was stating the arithmetic itself.

**The trailing one is a `max()`, and that is the repair.** It read `--pane-w + --seam` alone, so a
shut pane left the card 8px from the window against 16px on the other three edges. `--seam` is the
space between two panes. With no pane beside it, that edge owes the window a `--gap` like any other.

**`--pane-w` moved to `:root`.** A custom property inherits its computed value, so a `--pane-w`
written on the body never reaches `--map-r` declared above it: the trailing inset resolved against a
permanent 0 and the card kept 16px with the pane open beside it. `:root:has(body…)` is what lets a
body class move a root-level token. `--rail-w` states the same rule from its own side, and this is
the second time this app has paid for it.

## 18. The phone app bar comes back, holding the glyph alone

The repository owner asked for this on 2026-08-24, as the start of a new phone design. It reverses
the phone half of section 17 and keeps the rest.

**`--hdr` is 64px below 600px and `0px` above it.** 64 is M3's own small top app bar. Above 600px the
rail runs the full height and nothing stands over the two panes, so `<header>` does not draw there at
all. A drawn one is a 64px band of surface holding nothing.

**The bar holds the brand glyph, centred, and nothing else yet.** `justify-content: center` on
`header` is what centres it. The brand is 32px of mark, which is under the 93px where the shared
ladder draws the drop alone, so the wordmark needs no rule of its own here.

**The news stayed on the map.** `#ticker` is the pill itself now, and it left `<header>` in the
markup. Above 600px there is no bar to be a child of, and below it the bar holds the brand instead.
Every rule that made it a flex item is gone with the row it shared: `flex: 1 1 0`, `min-width: 0`, a
16px trailing margin off a row of buttons, and a 30px height inside a taller bar.

**The map keeps its own top corner on a phone, and that only reads because the bar is above it.** A
16px radius on a full-bleed box notches the two screen corners and shows the page through them. With
a bar over the top edge, those corners sit against the bar's own surface. The bottom corner stays
square, because that edge IS the screen edge.

**The checks moved with the element.** Every desktop assertion that named `header` names `#ticker`
now, in `m3-check.html` and in `paint-check.html`'s overlap sweep alike. Ten new assertions cover the
phone bar, the centred glyph and the card corner under it.

## 19. The theme switch is the phone bar's one trailing action

The repository owner asked for it on 2026-08-24.

The rail is `display: none` below 600px. So `#railApps` had no home there, and a phone carried no
theme control at all. The button moves into `<header>` on the breakpoint now, the way `#brand`
already moves. `place()` in `js/ui.js` does both in one function.

**One node, two homes.** A second copy in the markup is a second control for a screen reader to
find, and `js/ui.js` writes the glyph and the label onto one element.

**It is absolutely positioned, and that keeps the brand centred.** This is M3's center-aligned small
top app bar, whose title centres in the container rather than in the space the actions leave. A flex
item on the trailing end pushes the mark off centre by half the button's own width. A matching
spacer on the leading end holds it, and that is one more box to keep in step with a control that can
change size.

**8px puts the glyph centre 28px inside the trailing edge.** `.icon` is a 40px box around a 24px
glyph. 28 is the number every app bar in this app already lands a trailing glyph on.

**The glyph size lost its `#rail` prefix.** It is a property of the button and not of either home.
Stated twice, the two drift the day one moves.

Four new assertions in `m3-check.html`: the button is in the bar, its glyph centre is 28px inside the
trailing edge, it is out of flow, and it keeps its 24px glyph. The brand's own centre assertion runs
with the button already in the bar, so a spacer-based repair fails there rather than passing.
