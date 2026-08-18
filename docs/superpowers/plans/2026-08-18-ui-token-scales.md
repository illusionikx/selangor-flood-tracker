# UI Token Scales Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every ad-hoc size in the three stylesheets with a token whose value comes from Material Design 3.

**Architecture:** One token block in the `:root` of `css/base.css`. Two size scales, because 32 of the 136 `font-size` declarations size an icon mask rather than text. Seven held tokens carry values this app computed or JavaScript repeats, and those values do not move. Six commits, each independently revertable, verified by a before/after screenshot pass.

**Tech Stack:** Plain CSS custom properties. No build step, no preprocessor, no dependency. Headless Chrome for the screenshot harness.

**Spec:** `docs/superpowers/specs/2026-08-18-ui-token-scales-design.md`

## Global Constraints

- **Work on `main` directly.** No feature branch.
- **Bump `?v=` on the touched stylesheet in `index.html` in every commit that edits CSS.** Current values: `css/base.css?v=128`, `css/chrome.css?v=182`, `css/map.css?v=150`. Herd serves CSS with `max-age=10800`, so an unbumped edit is invisible for three hours.
- **Do not touch the palette.** Every `--k-*`, `--s-*`, `--me`, `--fav` and `--wx-*` token stays exactly as it is.
- **Do not touch `css/icons.css`** (a script generates it) or anything under `vendor/`.
- **Do not add `clamp()`, `oklch()`, `@layer`, `@starting-style` or view transitions.** This pass changes sizes only.
- **Prose written into files follows Simplified Technical English.** Active voice, maximum 20 words per sentence, no semicolons, no contractions, American spelling. Run `python "C:/Users/illus/.claude/ste-lint.py" < FILE` on `docs/FEATURES.md` and `CLAUDE.md` after editing. Aim for 0, and ignore `long_paragraph` counts raised by tables.
- **This plan splits the spec's commit 2 into two commits,** one for icons and one for text. A 136-declaration commit is hard to review. Nothing about what ships changes.

---

### Task 1: Screenshot harness and the before set

**Files:**
- Create: `shot-tmp.html` (untracked, deleted in Task 8)
- Create: `.shots-before/` (untracked, deleted in Task 8)

**Interfaces:**
- Consumes: nothing.
- Produces: `.shots-before/<surface>-<width>.png`, 20 files. Task 7 shoots the matching after set and compares them pair by pair.

The harness loads the app in an iframe that fills the window. So Chrome's `--window-size` sets the width the app sees. It writes the `prefs` blob before the iframe loads. `js/state.js` reads `localStorage` at module evaluation, so a later write arrives too late.

- [ ] **Step 1: Write the harness**

Create `shot-tmp.html`:

```html
<!doctype html>
<meta charset="utf-8">
<title>shot</title>
<style>html,body{margin:0;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:0;display:block}</style>
<body>
<script>
/* Throwaway. Drives the app to one surface so Chrome --screenshot can capture it.
   Deleted when the token sweep lands. See docs/superpowers/plans/2026-08-18-ui-token-scales.md */
const q = new URLSearchParams(location.search);
const surface = q.get('s') || 'map';
const theme = q.get('t') || 'light';

// state.js reads localStorage at module evaluation, so the prefs must land before the iframe loads.
const prefs = { theme, drawer: surface === 'map', wx: surface === 'weather' };
localStorage.setItem('prefs', JSON.stringify(prefs));

const wait = ms => new Promise(r => setTimeout(r, ms));
const f = document.createElement('iframe');
f.src = './index.html';
document.body.appendChild(f);

f.onload = async () => {
  const d = f.contentDocument, w = f.contentWindow;
  const el = id => d.getElementById(id);
  const click = id => el(id) && el(id).click();

  // The splash refuses to clear until the first payload lands. Give the poll room.
  for (let i = 0; i < 60 && !d.querySelector('#splash.gone'); i++) await wait(500);
  await wait(1500);

  if (surface === 'card' || surface === 'lightbox') {
    // A pin is inside a cluster at landing zoom, so reach a station through the table instead.
    click('data'); await wait(1200);
    const row = d.querySelector('#dataBody [data-go]');
    if (row) { row.click(); await wait(1200); }
    if (surface === 'card') el('dataBox').close();
    else { const img = d.querySelector('#sideBody [data-clip]'); if (img) img.click(); await wait(2500); }
  }
  if (surface === 'alerts') { click('alertBtn'); await wait(800); }
  if (surface === 'table') { click('data'); await wait(2000); }
  if (surface === 'cams') { click('cams'); await wait(4000); }
  if (surface === 'about') { click('about'); await wait(800); }
  if (surface === 'find') { click('find'); await wait(600);
    const i = d.querySelector('#gotoBox input'); if (i) { i.value = 'kl'; i.dispatchEvent(new w.Event('input')); }
    await wait(800); }
  // 'map', 'weather' and 'narrow' need no click. Prefs and window width already put them on screen.
  await wait(1000);
};
</script>
```

- [ ] **Step 2: Verify the harness reaches one surface**

Run:

```bash
cd /d/Herd/flood-exp
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --ignore-certificate-errors --virtual-time-budget=45000 --window-size=1536,900 \
  --screenshot="D:\Herd\flood-exp\.probe.png" "https://flood-exp.test/shot-tmp.html?s=table&t=light"
```

Expected: `.probe.png` exists and shows the all-stations table dialog open over the map. If it shows the splash, raise `--virtual-time-budget`. Delete `.probe.png` afterward.

- [ ] **Step 3: Shoot the before set**

Run:

```bash
cd /d/Herd/flood-exp && mkdir -p .shots-before
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
for s in map card alerts table cams lightbox about weather find narrow; do
  for w in 1536 600; do
    [ "$s" = narrow ] && w=280
    "$CHROME" --headless=new --disable-gpu --ignore-certificate-errors \
      --virtual-time-budget=45000 --window-size=$w,900 \
      --screenshot="D:\Herd\flood-exp\.shots-before\\$s-$w.png" \
      "https://flood-exp.test/shot-tmp.html?s=$s&t=light"
  done
done
for s in map card table; do
  "$CHROME" --headless=new --disable-gpu --ignore-certificate-errors \
    --virtual-time-budget=45000 --window-size=1536,900 \
    --screenshot="D:\Herd\flood-exp\.shots-before\\$s-dark.png" \
    "https://flood-exp.test/shot-tmp.html?s=$s&t=dark"
done
ls .shots-before | wc -l
```

Expected: 22 files (10 surfaces at 2 widths, plus 3 dark spot checks, less the narrow duplicate).

- [ ] **Step 4: Read every before shot**

Open each file in `.shots-before/`. Confirm each one shows the surface it names and not a splash screen or a blank map. A before shot that captured the wrong state makes the whole comparison worthless.

- [ ] **Step 5: No commit**

`shot-tmp.html` and `.shots-before/` stay untracked. Add nothing to git in this task.

---

### Task 2: Define the token block

**Files:**
- Modify: `css/base.css` — insert after the existing `:root` block that ends with `--hdr: 64px;`
- Modify: `index.html:73` — bump `css/base.css?v=128` to `?v=129`

**Interfaces:**
- Consumes: nothing.
- Produces: the custom property names every later task substitutes in. Exact names: `--text-micro`, `--text-label-sm`, `--text-label-md`, `--text-body-md`, `--text-body-lg`, `--text-title-lg`, `--text-headline-sm`, `--icon-sm`, `--icon-md`, `--icon-lg`, `--icon-xl`, `--icon-2xl`, `--r-xs`, `--r-sm`, `--r-md`, `--r-full`, `--pin-box`, `--pin-glyph`, `--pin-lg`, `--pin-fav`, `--cluster-box`, `--ctl-box`, `--ctl-glyph`, `--tap-min`.

- [ ] **Step 1: Add the token block**

Insert into `css/base.css`, directly after the closing brace of the `:root` block holding `--hdr: 64px`:

```css
/* --- size scales ------------------------------------------------------------------------------ */

/* Every size in this app comes from one of the two scales below. The values are Material Design 3's
   own type scale and shape scale, which is the same rule this repo already follows for component
   behaviour: where M3 names the thing, take the number from the spec rather than invent one.

   **There are two scales because there are two populations.** An `.i` is a box of `currentColor`
   with a glyph masked out of it, so `font-size` on one sets the glyph box and not a type size. 32
   of the 136 font-size declarations do that. A type ramp and an icon ramp answer different
   questions, and putting an icon on the type ramp is the fault this split exists to prevent.

   The held block at the foot is different again. Those values are arithmetic this app already did,
   or numbers a JavaScript module repeats. A token makes each one easy to find. It does not make it
   free to change. Read the comment beside any held token before moving it. */
:root {
  /* Type. M3 label-small through headline-small.
     --text-micro is the one rung M3 does not publish. M3 stops at 11px because M3 targets a
     consumer app, and this one is dense telemetry: `.acc sup` is a provenance asterisk and `.wxnow`
     is a weather micro-label. Raising those to 11 grows the asterisk by 37%. `.acc sup` carries
     `line-height: 0`, so a taller mark cannot disturb the bar measurement above it. */
  --text-micro: 10px;
  --text-label-sm: 11px;
  --text-label-md: 12px;
  --text-body-md: 14px;
  --text-body-lg: 16px;
  --text-title-lg: 22px;
  --text-headline-sm: 24px;

  /* Icons, as the mask box an `.i` paints into. */
  --icon-sm: 16px;
  --icon-md: 20px;
  --icon-lg: 24px;
  --icon-xl: 40px;
  --icon-2xl: 48px;

  /* Shape. M3's scale, less the rungs nothing here uses. A rule stating `50%` keeps it: a circle is
     not a radius choice, and 12 rules mean exactly that. */
  --r-xs: 4px;
  --r-sm: 8px;
  --r-md: 12px;
  --r-full: 999px;

  /* Held. Each value below is load-bearing, and the comment says what holds it. */
  /* The station pin box. **`render.js:167` repeats this as `iconSize: [39, 39]`**, which is what
     actually positions the marker over its station. The two move together or the pin lies. */
  --pin-box: 39px;
  --pin-glyph: 36px;
  /* The "you are here" and "searched place" pins. **`map.js:436` and `locate.js:99` repeat this as
     `iconSize: [48, 48]` with `iconAnchor: [24, 44]`.** */
  --pin-lg: 48px;
  /* The favorite heart on a pin corner. 17 rather than 15 because a heart reads by its shape, and
     it is the smallest shape on the map. */
  --pin-fav: 17px;
  /* The cluster badge box. **`map.js:183` repeats this as `iconSize: [25, 25]`.** */
  --cluster-box: 24px;
  /* An icon button. 40 less 22 leaves 9px of padding a side, and that padding is what lets two of
     these boxes abut. `.pophead > .dots` sits at `right: 32px` on that arithmetic. */
  --ctl-box: 40px;
  --ctl-glyph: 22px;
  /* The smallest thing a thumb hits reliably. The phone zoom control is sized to it. */
  --tap-min: 44px;
}
```

- [ ] **Step 2: Verify nothing changed on screen**

Run:

```bash
cd /d/Herd/flood-exp
sed -i 's|css/base.css?v=128|css/base.css?v=129|' index.html
grep -n 'css/base.css' index.html
```

Expected: `?v=129`. Nothing reads the new tokens yet, so the page must look identical. Reload the app and confirm.

- [ ] **Step 3: Commit**

```bash
git add css/base.css index.html
git commit -m "Define the size token block

Two scales, because 32 of the 136 font-size declarations size an icon
mask and not text. A held block carries the values that JavaScript
repeats or that this app computed.

Nothing reads these tokens yet. The next four commits are pure
substitution, so their diffs show values and nothing else."
```

---

### Task 3: Sweep the icon declarations

**Files:**
- Modify: `css/base.css` lines 350, 362, 370, 437, 479, 489, 807
- Modify: `css/chrome.css` lines 56, 133, 215, 221, 243, 297, 309, 339, 490, 564, 755, 945, 1126, 1253, 1305, 1340, 1368, 1390, 1861, 1882, 1896
- Modify: `css/map.css` lines 317, 439
- Modify: `index.html` — bump all three stylesheet versions

**Interfaces:**
- Consumes: `--icon-sm`, `--icon-md`, `--icon-lg`, `--icon-xl`, `--icon-2xl`, `--pin-lg` from Task 2.
- Produces: nothing later tasks read.

This is the enumerable half of the font-size sweep, so it lands first and alone. Every declaration below sizes a mask box.

- [ ] **Step 1: Apply the icon substitutions**

Replace the `font-size` value on each of these lines. The table states every substitution.

| file:line | selector | from | to |
|---|---|---|---|
| `base.css:350` | `.picklist .xp .i` | 18px | `var(--icon-md)` |
| `base.css:362` | `.picklist .fvm` | 15px | `var(--icon-sm)` |
| `base.css:370` | `.alert.grouped .slist .i.fvm` | 14px | `var(--icon-sm)` |
| `base.css:437` | `.sect > summary .i` | 15px | `var(--icon-sm)` |
| `base.css:479` | `.link .i` | 16px | `var(--icon-sm)` |
| `base.css:489` | `.badge .i` | 14px | `var(--icon-sm)` |
| `base.css:807` | `.camfail .i` | 22px | `var(--icon-lg)` |
| `chrome.css:56` | `header h1 .brand` | 24px | `var(--icon-lg)` |
| `chrome.css:133` | `#ticker .tk-i .i` | 15px | `var(--icon-sm)` |
| `chrome.css:215` | `.logo .i` | 40px | `var(--icon-xl)` |
| `chrome.css:221` | `.modalhead .dclose` | 20px | `var(--icon-md)` |
| `chrome.css:243` | `#aboutBox .notice .i` | 20px | `var(--icon-md)` |
| `chrome.css:297` | `#testbadge .i, #risebadge .i` | 18px | `var(--icon-md)` |
| `chrome.css:309` | `#aboutBox .logo .i` | 34px | `var(--icon-xl)` |
| `chrome.css:339` | `.docbox .ctl .i` | 18px | `var(--icon-md)` |
| `chrome.css:490` | `table.data .gline i.pc` | 14px | `var(--icon-sm)` |
| `chrome.css:564` | `.mi .i` | 18px | `var(--icon-md)` |
| `chrome.css:755` | `#warnBox .modalhead .i` | 22px | `var(--icon-lg)` |
| `chrome.css:945` | `.camsay .i` | 15px | `var(--icon-sm)` |
| `chrome.css:1126` | `.info > .i` | 16px | `var(--icon-sm)` |
| `chrome.css:1253` | `#toast .thead .i` | 18px | `var(--icon-md)` |
| `chrome.css:1305` | `.tally .i` | 15px | `var(--icon-sm)` |
| `chrome.css:1340` | `.slist .i` | 18px | `var(--icon-md)` |
| `chrome.css:1368` | `.warngrp .alerthead .i` | 18px | `var(--icon-md)` |
| `chrome.css:1390` | `.noticegrp .alerthead .i` | 18px | `var(--icon-md)` |
| `chrome.css:1861` | `#narrowBox .mark` | 40px | `var(--icon-xl)` |
| `chrome.css:1882` | `#splash .mark` | 48px | `var(--icon-2xl)` |
| `chrome.css:1896` | `#splashWarn .state .i` | 20px | `var(--icon-md)` |
| `map.css:317` | `.pin.place` | 48px | `var(--pin-lg)` |
| `map.css:439` | `.camwarn .i` | 16px | `var(--icon-sm)` |

`map.css:317` also carries `width: 48px; height: 48px`. Replace both with `var(--pin-lg)`.

- [ ] **Step 2: Leave two declarations alone, on purpose**

`css/base.css:234` reads `.rate .i { font-size: 1.2em }`. That is relative to its parent and belongs to no rung. Leave it.

`css/chrome.css:334` reads `.docbox .pins .cluster { width: 28px; height: 28px; font-size: 12px }`. That is a legend sample of the cluster badge inside Help prose, deliberately larger than the real 24px badge. Leave all three values.

- [ ] **Step 3: Verify every icon value resolved**

Run:

```bash
cd /d/Herd/flood-exp
# No px font-size may remain on a selector that sizes an icon.
grep -n 'font-size:' css/base.css css/chrome.css css/map.css \
 | grep -E '\.i[ .{,:]|\.i$|\.mark|\.brand|\.fvm|i\.pc|\.dclose' | grep 'px'
```

Expected: two lines only, `base.css:234` (the `1.2em`, which holds no `px`, so it will not match) and nothing else. If any line reports a `px` value, it was missed.

- [ ] **Step 4: Confirm no token is undefined**

Run:

```bash
cd /d/Herd/flood-exp
for t in $(grep -oh 'var(--\(icon\|pin\)-[a-z0-9-]*' css/*.css | sed 's/var(//' | sort -u); do
  grep -q -- "$t:" css/base.css || echo "UNDEFINED: $t"; done; echo "checked"
```

Expected: `checked` with no `UNDEFINED` line. An undefined custom property paints nothing and raises no error.

- [ ] **Step 5: Bump the versions and look at the page**

```bash
cd /d/Herd/flood-exp
sed -i 's|css/base.css?v=129|css/base.css?v=130|; s|css/chrome.css?v=182|css/chrome.css?v=183|; s|css/map.css?v=150|css/map.css?v=151|' index.html
grep -n 'css/.*\.css?v=' index.html
```

Then open the app. Check the app bar glyphs, the drawer section arrows, the alert list icons and the splash mark. Every icon must still be centered in its control.

- [ ] **Step 6: Commit**

```bash
git add css/base.css css/chrome.css css/map.css index.html
git commit -m "Point every icon size at the icon scale

30 declarations size a mask box rather than text. They take the icon
rungs, which is a separate scale from the type ramp.

Two are left alone. `.rate .i` is relative at 1.2em. The Help legend's
cluster sample is deliberately larger than the real badge."
```

---

### Task 4: Sweep the text declarations

**Files:**
- Modify: `css/base.css`, `css/chrome.css`, `css/map.css` — every remaining `font-size` with a `px` value
- Modify: `index.html` — bump all three stylesheet versions

**Interfaces:**
- Consumes: the seven `--text-*` tokens from Task 2.
- Produces: nothing later tasks read.

- [ ] **Step 1: Settle the 18px question before sweeping**

The spec commits to 18 becoming 22 and requires the comparison to happen first. Eight text declarations read 18px, and M3 offers 16 or 22 with nothing between.

Shoot both. Apply 18 to `var(--text-title-lg)` and shoot the drawer and station card. Then apply 18 to `var(--text-body-lg)` and shoot the same two. Read the four images.

If 16 reads better, edit the spec's type table and its judgment-call section before continuing. Do not carry an undocumented choice into the sweep.

- [ ] **Step 2: Enumerate what remains**

Run:

```bash
cd /d/Herd/flood-exp
grep -n 'font-size: *[0-9]*px' css/base.css css/chrome.css css/map.css
```

Every line this prints is text, because Task 3 removed the icon declarations. Expect about 104 lines.

- [ ] **Step 3: Apply the text substitutions**

Map each value by this table. It is the spec's type table, repeated so nobody reads two documents at once.

| from | to |
|---|---|
| 8px, 9px, 10px | `var(--text-micro)` |
| 11px | `var(--text-label-sm)` |
| 12px | `var(--text-label-md)` |
| 13px, 14px | `var(--text-body-md)` |
| 15px, 16px, 17px | `var(--text-body-lg)` |
| 18px, 20px, 22px | `var(--text-title-lg)` |
| 24px, 32px, 34px, 36px | `var(--text-headline-sm)` |

Four declarations take a held token instead, because their value is arithmetic and not a type choice:

| file:line | selector | to |
|---|---|---|
| `map.css:171` | `.pin` font-size 36px | `var(--pin-glyph)` |
| `map.css:271` | `.pin .fv` font-size 17px | `var(--pin-fav)` |
| `map.css:396` | `.leaflet-control-zoom a` font-size 22px | `var(--ctl-glyph)` |
| `map.css:78` | `.pophead > .dots` font-size 22px | `var(--ctl-glyph)` |
| `map.css:334` | `.cluster` width and height 24px | `var(--cluster-box)` |

`map.css:334` keeps its `font-size: 11px` on the text ramp as `var(--text-label-sm)`. Only the box is held, because `map.js:183` repeats the box as `iconSize` and nothing repeats the type size.

`map.css:171` also carries `width: 39px; height: 39px`. Replace both with `var(--pin-box)`. `map.css:396` carries `width: 44px; height: 44px; line-height: 44px`. Replace all three with `var(--tap-min)`. `map.css:78` carries `width: 40px; height: 40px`. Replace both with `var(--ctl-box)`. `map.css:307` (`.pin.me`) carries `width: 48px; height: 48px; font-size: 48px`. Replace all three with `var(--pin-lg)`.

- [ ] **Step 4: Verify no px font-size survives**

Run:

```bash
cd /d/Herd/flood-exp
grep -n 'font-size: *[0-9]*px' css/base.css css/chrome.css css/map.css
```

Expected: one line only, `chrome.css:334`, the Help legend cluster sample Task 3 left alone.

- [ ] **Step 5: Confirm no token is undefined**

Run:

```bash
cd /d/Herd/flood-exp
for t in $(grep -oh 'var(--\(text\|icon\|pin\|ctl\|tap\|cluster\)-[a-z0-9-]*' css/*.css | sed 's/var(//' | sort -u); do
  grep -q -- "$t:" css/base.css || echo "UNDEFINED: $t"; done; echo "checked"
```

Expected: `checked` with no `UNDEFINED` line.

- [ ] **Step 6: Bump the versions and commit**

```bash
cd /d/Herd/flood-exp
sed -i 's|css/base.css?v=130|css/base.css?v=131|; s|css/chrome.css?v=183|css/chrome.css?v=184|; s|css/map.css?v=151|css/map.css?v=152|' index.html
git add css/base.css css/chrome.css css/map.css index.html
git commit -m "Point every text size at the type scale

21 distinct font sizes become 7 rungs from M3's type scale. Four sizes
take a held token instead, because their value is arithmetic against a
control box rather than a type choice."
```

---

### Task 5: Sweep the radii

**Files:**
- Modify: `css/base.css`, `css/chrome.css`, `css/map.css`
- Modify: `index.html` — bump all three stylesheet versions

**Interfaces:**
- Consumes: `--r-xs`, `--r-sm`, `--r-md`, `--r-full` from Task 2.
- Produces: nothing later tasks read.

- [ ] **Step 1: Enumerate**

```bash
cd /d/Herd/flood-exp
grep -n 'border-radius:' css/base.css css/chrome.css css/map.css
```

- [ ] **Step 2: Substitute**

| from | to |
|---|---|
| 2px, 4px | `var(--r-xs)` |
| 6px, 8px | `var(--r-sm)` |
| 10px, 12px | `var(--r-md)` |
| 999px | `var(--r-full)` |

Leave `50%` exactly as it is, in all 12 rules. A circle is not a radius choice.

Two rules carry a multi-value radius: `8px 0 0 8px` and `0 0 8px 8px`. Substitute each `8px` inside them and keep the zeros as `0`.

- [ ] **Step 3: Verify**

```bash
cd /d/Herd/flood-exp
grep -n 'border-radius:' css/base.css css/chrome.css css/map.css | grep 'px'
```

Expected: no output. Every remaining `border-radius` reads a token, `50%`, `0` or `inherit`.

- [ ] **Step 4: Look at the page**

Check the chips in the drawer, the badges on a station card, the dialogs, the legend card and the cluster badges. A pill that lost `--r-full` renders as a rectangle and is obvious.

- [ ] **Step 5: Bump and commit**

```bash
cd /d/Herd/flood-exp
sed -i 's|css/base.css?v=131|css/base.css?v=132|; s|css/chrome.css?v=184|css/chrome.css?v=185|; s|css/map.css?v=152|css/map.css?v=153|' index.html
git add css/base.css css/chrome.css css/map.css index.html
git commit -m "Point every radius at the shape scale

8 distinct radii become 4 rungs from M3's shape scale. The 12 rules
that state 50% keep it, because a circle is not a radius choice."
```

---

### Task 6: Sweep the padding

**Files:**
- Modify: `css/base.css`, `css/chrome.css`, `css/map.css`
- Modify: `index.html` — bump all three stylesheet versions

**Interfaces:**
- Consumes: nothing. Spacing lands as literal 4dp-grid values, not tokens.
- Produces: nothing later tasks read.

Spacing takes no token, and that is deliberate. A `--space-8` token that always reads `8px` buys a name for a number every reader already understands. The value of this axis is the grid, not the indirection.

- [ ] **Step 1: Enumerate the off-grid values**

```bash
cd /d/Herd/flood-exp
grep -n 'padding: *[^;]*' css/base.css css/chrome.css css/map.css | grep -E '\b(1|2|3|5|6|7|9|10|11|13|14|15|18|22)px'
```

- [ ] **Step 2: Snap each to the nearest grid step**

The grid is 4, 8, 12, 16, 24, 32. Round to the nearest step. On a tie, round up: a control gaining a pixel of room is safer than one losing it.

So 3 and 5 become 4. 6, 7, 9 and 10 become 8. 11, 13 and 14 become 12. 15 and 18 become 16. 22 becomes 24. Leave 1px and 2px hairlines alone, because those are borders expressed as padding and rounding one to 4 quadruples it.

- [ ] **Step 3: Honor the held list**

**Do not touch these two declarations.** Each is arithmetic CLAUDE.md documents.

| file | declaration | why |
|---|---|---|
| `css/map.css` | `.pophead { padding-top: 18px }` | 8 plus half the button's 40, less half a 15px/1.3 line. `#sideClose` and `.pophead > .dots` both read that result. |
| `css/base.css` | `.acccol { padding-top: 16px }` | Reserves the label above a percentage-height bar. A change rescales all five rain columns. |

`.pophead > .dots ~ .popname` carries `padding-right: 78px`, and `.pophead > .dots` sits at `right: 32px`. Both come from the same arithmetic. Leave both.

- [ ] **Step 4: Look at every surface**

Open the app and walk the drawer, a station card, the alert panel, the table, the camera wall and About. Padding is where a sweep breaks alignment, and a 2px change reads as a control that came loose.

- [ ] **Step 5: Bump and commit**

```bash
cd /d/Herd/flood-exp
sed -i 's|css/base.css?v=132|css/base.css?v=133|; s|css/chrome.css?v=185|css/chrome.css?v=186|; s|css/map.css?v=153|css/map.css?v=154|' index.html
git add css/base.css css/chrome.css css/map.css index.html
git commit -m "Snap the padding to the 4dp grid

About 30 ad-hoc pairs land on 4, 8, 12, 16, 24 and 32. Ties round up,
because a control gaining a pixel is safer than one losing it.

Three declarations hold. Their values are arithmetic against a control
box, and CLAUDE.md states each one."
```

---

### Task 7: The after set, the comparison, and the wordmark remeasure

**Files:**
- Create: `.shots-after/` (untracked, deleted in Task 8)
- Modify: `css/chrome.css:46`, `:49`, `:54` — the three container query thresholds

**Interfaces:**
- Consumes: `.shots-before/` from Task 1.
- Produces: a green `title-test.html`.

**`title-test.html` takes no edit.** It hardcodes no threshold. It measures the drawn spelling at
fifteen widths. It then asserts three properties. One spelling draws at a time. That spelling fits
its rail. A narrower rail never draws a longer spelling. The stale numbers sit in the stylesheet.

- [ ] **Step 1: Shoot the after set**

Run the same loop as Task 1 Step 3, writing to `.shots-after` instead of `.shots-before`.

```bash
cd /d/Herd/flood-exp && mkdir -p .shots-after
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
for s in map card alerts table cams lightbox about weather find narrow; do
  for w in 1536 600; do
    [ "$s" = narrow ] && w=280
    "$CHROME" --headless=new --disable-gpu --ignore-certificate-errors \
      --virtual-time-budget=45000 --window-size=$w,900 \
      --screenshot="D:\Herd\flood-exp\.shots-after\\$s-$w.png" \
      "https://flood-exp.test/shot-tmp.html?s=$s&t=light"
  done
done
for s in map card table; do
  "$CHROME" --headless=new --disable-gpu --ignore-certificate-errors \
    --virtual-time-budget=45000 --window-size=1536,900 \
    --screenshot="D:\Herd\flood-exp\.shots-after\\$s-dark.png" \
    "https://flood-exp.test/shot-tmp.html?s=$s&t=dark"
done
ls .shots-after | wc -l
```

- [ ] **Step 2: Read each pair and hunt five faults**

Open `.shots-before/<name>.png` and `.shots-after/<name>.png` together, one pair at a time, all 22 pairs. Look for exactly these:

1. Text that wrapped to a new line, or text that stopped wrapping.
2. A control whose box no longer lines up with a neighbor.
3. The wordmark ladder picking a different rung at the same width.
4. A table column that moved enough to change the row count on screen.
5. Anything clipped or truncated. CLAUDE.md names truncation the silent failure of the wordmark ladder.

Write down every difference found. A difference is not automatically a fault. The sweep is meant to move text. The question is whether the new position is right.

- [ ] **Step 3: Run the four checks that must stay green**

```bash
cd /d/Herd/flood-exp
php shots-test.php
php api.php --selftest
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --ignore-certificate-errors --virtual-time-budget=15000 --dump-dom \
  https://flood-exp.test/heat-test.html | perl -0777 -ne 'print $1 if /<pre id="out">([^<]*)</s'
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --ignore-certificate-errors --virtual-time-budget=35000 --window-size=1200,900 --dump-dom \
  https://flood-exp.test/narrow-test.html | perl -0777 -ne 'print $1 if /<pre id="out">(.*?)<\/pre>/s'
```

Expected: `shots-test.php` and `--selftest` both green. `heat-test` reads PASS. `narrow-test` reads PASS.

- [ ] **Step 4: Run title-test and read the failure**

```bash
cd /d/Herd/flood-exp
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --ignore-certificate-errors --virtual-time-budget=40000 --window-size=1800,1000 --dump-dom \
  https://flood-exp.test/title-test.html | perl -0777 -ne 'print $1 if /<pre id="out">(.*?)<\/pre>/s'
```

Expected: FAIL, with one or more lines reading `"<spelling>" wants NNNpx of a NNNpx rail`. The spec predicts this. The three container query values are measured widths at 22px Roboto, and Task 4 moved the heading size.

- [ ] **Step 5: Read the heading's new computed size**

The three thresholds are derived from it, so measure it rather than assume which rung Task 4 gave it.

```bash
cd /d/Herd/flood-exp
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --ignore-certificate-errors --virtual-time-budget=20000 --window-size=1536,900 --dump-dom \
  https://flood-exp.test/ | grep -o 'header h1[^}]*' | head -3
```

If that is unclear, open the app and read `getComputedStyle(document.querySelector('header h1')).fontSize` in the console. Call the result `S`.

- [ ] **Step 6: Remeasure the three spellings**

The ladder is four spellings at three thresholds. `css/chrome.css` currently holds 282, 190 and 93. Those are measured font widths of 247, 156 and 59px, plus 32 for the drop and its gap.

Measure the three spellings again at `S`:

```bash
cd /d/Herd/flood-exp
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --ignore-certificate-errors --virtual-time-budget=20000 --dump-dom \
  --window-size=1800,400 'data:text/html,<style>@font-face{font-family:R;src:url(https://flood-exp.test/vendor/roboto.woff2)}
span{font:400 22px R,sans-serif;white-space:nowrap}</style>
<span id=a>Klang Valley Flood Watch</span><span id=b>KV Flood Watch</span><span id=c>KVFW</span>
<pre id=out></pre><script>onload=()=>{setTimeout(()=>{out.textContent=[a,b,c].map(e=>Math.ceil(e.getBoundingClientRect().width)).join(" ")},1500)}</script>' \
  | perl -0777 -ne 'print $1 if /<pre id="out">(.*?)<\/pre>/s'
```

Replace `22px` in that snippet with `S`. The snippet prints three widths, for the long, medium and short spellings in that order.

Add 32 to each. Those three numbers are the new thresholds.

- [ ] **Step 7: Write the three numbers into css/chrome.css**

`css/chrome.css:49` holds `@container (min-width: 282px)`. Replace 282 with the long spelling's number.

`css/chrome.css:46` holds `@container (min-width: 190px)`. Replace 190 with the medium spelling's number.

`css/chrome.css:54` holds `@container (max-width: 93px)`. Replace 93 with the short spelling's number, less one. That rule hides the wordmark below the threshold, so it sits one pixel under the rung above it.

Update the comment above each rule to state the new measured width. Those comments are what the next reader remeasures against.

- [ ] **Step 8: Confirm title-test is green**

Re-run Step 4's command. Expected: PASS.

If a line still reads `wants NNNpx of a NNNpx rail`, the threshold for that spelling is too low. If a line reads `a narrower rail drew a LONGER spelling`, two thresholds crossed over. If a line reads `N spellings drawn at once`, a selector lost on specificity. CLAUDE.md states that every rule goes through `.word >` for exactly that reason.

- [ ] **Step 9: Bump and commit**

```bash
cd /d/Herd/flood-exp
sed -i 's|css/chrome.css?v=186|css/chrome.css?v=187|' index.html
git add css/chrome.css index.html
git commit -m "Remeasure the wordmark ladder thresholds

The three container query values are measured font widths, and the type
sweep moved the heading size. The spec predicted this failure.

title-test.html needs no edit. It hardcodes no threshold and measures
the drawn spelling at fifteen widths."
```

---

### Task 8: Documentation and cleanup

**Files:**
- Modify: `docs/FEATURES.md` — append a section
- Modify: `CLAUDE.md` — one entry in the Conventions section
- Delete: `shot-tmp.html`, `.shots-before/`, `.shots-after/`

**Interfaces:**
- Consumes: everything above.
- Produces: the rule that stops this work undoing itself.

- [ ] **Step 1: Append to docs/FEATURES.md**

Append this section. Replace `NN` with whichever value won Task 4 Step 1. Replace the three threshold numbers with the ones Task 7 measured.

```markdown
### Every size comes from a token now

The app held 21 font sizes, 8 border radii and about 30 ad-hoc paddings. Nothing named any of
them. A person picked a size by eye, so the count grew on every change. Three sizes did one job:
11px, 12px and 13px shared 65 declarations between them.

The values come from Material Design 3. That is the rule this repo already follows for component
behavior. Where M3 names the thing, take the number from the spec rather than invent one. An
external standard also needs no defending in a review.

**There are two scales, because there are two populations.** 32 of the 136 font-size declarations
sized an icon and not text. An `.i` is a box of `currentColor` with a glyph masked out of it. So
`font-size` on one sets the glyph box. A type ramp and an icon ramp answer different questions.
One blind replacement would have put every icon on the type ramp.

**One rung deviates from M3, and the provenance asterisk is why.** M3 stops at 11px, because M3
targets a consumer app. This one is dense telemetry. `.acc sup` marks a derived rain total at 8px
and `.wxnow` labels the weather at 9px. A rise to 11 grows the asterisk by 37 percent. `--text-micro`
holds both at 10px instead. `.acc sup` carries `line-height: 0`, so a taller mark cannot disturb
the bar measurement above it.

**18px had no M3 rung.** M3 offers 16 and it offers 22, with nothing between. Eight text
declarations read 18px. Both values were drawn and compared on screen, and NN won.

**A held token is not a scale token.** `--pin-box` is 39px, and `render.js` repeats it as an
`iconSize`. `--pin-lg` is 48px, and `map.js` and `locate.js` both repeat it with an anchor.
`--cluster-box` is 24px, and `map.js` repeats that too. A pin whose CSS box and JavaScript box
disagree stops pointing at its station. `--ctl-box` and `--ctl-glyph` are 40px and 22px, and the
9px of padding between them is what lets two icon buttons abut.

**Spacing took the 4dp grid and no token.** A name for `8px` buys nothing a reader did not already
have. Ties round up, because a control gaining a pixel is safer than one losing it.

**The wordmark thresholds were measured again.** They are container query values in
`css/chrome.css`, and each is a font width plus 32 for the drop and its gap. The type sweep moved
the heading size, so all three went stale. `title-test.html` needed no edit. It hardcodes no
threshold and measures the drawn spelling at fifteen widths.

A throwaway harness verified the sweep. It drove the app to ten surfaces at two widths and shot
each one before and after. The harness is deleted. What it found is above.
```

Then lint it. Maximum 20 words a sentence, active voice, no semicolons, no contractions.

- [ ] **Step 2: Add one entry to the Conventions section of CLAUDE.md**

Draft:

```markdown
- **Every size comes from a token, and there are two scales.** The values are Material Design 3's
  type scale and shape scale, in the `:root` of `css/base.css`. **Text and icons do not share a
  ramp.** An `.i` is a mask box, so `font-size` on one sets a glyph and not a type size. 32 of the
  136 declarations did that when this landed. `--text-micro` is the one rung M3 does not publish,
  and the provenance asterisk is why. **A held token is not a scale token.** `--pin-box`,
  `--pin-lg` and `--cluster-box` are each repeated in a JavaScript module as an `iconSize`, so the
  two move together or a marker stops pointing at its station. `--ctl-box` and `--ctl-glyph` are
  arithmetic that lets two icon buttons abut. Read the comment beside a held token before moving
  it. Spacing takes the 4dp grid and no token, because a name for `8px` buys nothing.
```

- [ ] **Step 3: Lint both documents**

```bash
cd /d/Herd/flood-exp
python "C:/Users/illus/.claude/ste-lint.py" < docs/FEATURES.md
python "C:/Users/illus/.claude/ste-lint.py" < CLAUDE.md
```

Expected: every count 0 except `long_paragraph`, which tables raise falsely.

- [ ] **Step 4: Delete the harness**

```bash
cd /d/Herd/flood-exp
rm -rf shot-tmp.html .shots-before .shots-after .probe.png
git status --short
```

Expected: only `docs/FEATURES.md` and `CLAUDE.md` modified. No untracked file remains.

- [ ] **Step 5: Commit**

```bash
git add docs/FEATURES.md CLAUDE.md
git commit -m "Record the token scales in the docs

FEATURES.md states what shipped and why M3 supplied the values.
CLAUDE.md gains the rule that stops this work undoing itself.

Without that rule the 22nd font size arrives next month, and nothing
on the page says not to."
```

---

## Rollback

Every commit reverts on its own, and each one carries its own `?v=` bump. A `git revert` of one commit restores the previous values and the previous version number together.

If Task 4 lands and the page reads wrong, revert that one commit. The token block from Task 2 survives, and the icon sweep from Task 3 survives with it.
