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
