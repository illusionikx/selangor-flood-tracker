# Flood Watch rebrand: migration plan

Plan only. Nothing here has been applied to the app yet. Work on a branch (`brand/o4`), one phase per commit, and
run the checks at the end of each phase. Line numbers are as of 2026-11-24.

**The rule this plan follows: calm UI, loud brand.** The app keeps its neutral surfaces and its M3 components. Volt
blue replaces the old accent and owns the brand moments (mark, wordmark, splash, share card). Status colours
(`--s-*`), sensor-kind colours (`--k-*`), the map and the heat washes do not change.

## Decisions (2026-11-25)

| Question | Decision |
| --- | --- |
| Selected navigation item | **Ink (inverse surface), revised the same day from pale tint.** Light: `#1F1F1F` pill, white icon (16.5:1). Dark: `#E8EAED` pill, `#202124` icon (13.4:1). No blue, no new colour. |
| Readings in JetBrains Mono | **Now, with the rebrand.** Phase 6 is part of the main sequence, not optional. |
| Installed Android app launch screen | **Volt blue.** `manifest.json` `background_color: #0038FF`. |
| Buttons | **Bold.** Filled volt primary, filled ink secondary, underlined text button; Archivo Expanded capitals; 12px corners; 48px tall. Phase 5b. |
| Sensor kind colours | **Vivid.** One chroma for all kinds, 0.119 → 0.150; hues and the three lightnesses unchanged. Phase 1b. |

---

## Phase 0 · Prepare

- Branch `brand/o4`.
- Copy `branding/fonts/*.woff2` into `vendor/`.
- Keep `branding/` in the repo as the source of truth; app files are copies baked from it.

## Phase 1 · Colour tokens (one-line theme change)

| File | Line | Change |
| --- | --- | --- |
| `css/base.css` | 7 | `--accent: #1a73e8` → `#0038FF`. 6.98:1 on white, 6.27:1 on `--hover`. |
| `css/base.css` | 390 | dark `--accent: #8ab4f8` → `#8AA4FF`. 6.77:1 on #202124, 5.47:1 on #303134. |
| `css/base.css` | 39, and `css/chrome.css` 4012 | Update the comments that quote `#8ab4f8`. |
| `css/base.css` | after line 7 | Add the `--brand-*` constants and `--font-display` / `--font-mono` from `tokens/brand.css`. |

Everything that already reads `--accent` follows: primary buttons, links, the selected navigation indicator
(`--md-sys-color-secondary-container`), the focus ring (`--focus-ring`), the brand mark, the ticker's closing lockup,
the About logo and the splash. Nothing else is recoloured.

**Selected navigation item: ink (decided).** Bridge the M3 role to the inverse surface this file already defines,
in `css/base.css` (it replaces the comment block at 50–56 that maps the indicator to `--accent`):

```css
:root {
  --md-sys-color-secondary-container: var(--md-sys-color-inverse-surface);     /* --on-surface: #1F1F1F / #E8EAED */
  --md-sys-color-on-secondary-container: var(--md-sys-color-inverse-on-surface); /* --surface: #FFFFFF / #202124 */
}
```

Both tokens already flip with the theme, so one declaration serves light and dark: 16.5:1 on light, 13.4:1 on dark.
No new surface tone, so the palette rule in CLAUDE.md needs no new line; only the comment explaining the bridge
changes (the selected pill is ink, so the volt accent stays reserved for actions and the mark). `m3-check.html`
reads the rail and bar indicators; update its expected colour.

## Phase 1b · Sensor kind colours, vivid (decided 2026-11-25)

The kind palette keeps its rule and changes one number: **chroma 0.119 → 0.150** for every kind. Hues
(238 / 298 / 358 / 58 / 118 / 178, plus weather 208, source 328, notice 268) and the three lightnesses (paper 0.620,
pin and panel 0.690, dark 0.760) do not move. Camera, weather and a few dark-theme values are clipped by sRGB below
0.150, the way camera already was.

| Token | Paper block (`:root`, L 0.620) | Pin + panel block (`.pin, #side`, L 0.690) | Dark block (L 0.760) |
| --- | --- | --- | --- |
| `--k-river` | #0290ce | #11a6ec | #4abdfe |
| `--k-rainfall` | #926fd4 | #a784eb | #bc9cff |
| `--k-siren` | #cb5a86 | #e3709b | #fb85b1 |
| `--k-gauge` | #c66b01 | #df8028 | #f79643 |
| `--k-mast` | #7f9101 | #94a722 | #a9bd40 |
| `--k-camera` | #019c86 | #00b49b | #08cdb1 |
| `--k-weather` | #0497a7 | #05afc1 | #07c7dc |
| `--k-source` | #b561b3 | #cc77ca | #e48de1 |
| `--k-notice` | #5f80e0 | #7495f8 | #90aeff |

Where: `css/base.css` 268–287 (paper), 413–417 (dark), 503–507 (pin and panel). `kind-color-lab.html` 201:
`const C = 0.119` → `0.150`, then open the lab and confirm it reports the app matches. The heat washes
(`RAIN_HEAT`, the water gradient) are not kind colours and do not change.

**Costs, accepted by the owner:**

- The flood-gauge brown moves closer to the alert amber: OKLab ΔE 5.3 → 3.9 on a pin. A gauge at its alert mark
  turns amber anyway; a calm gauge and an alerting river can look alike at a glance. Watch this one.
- 0.150 is near the top of the rule's 0.09–0.16 window, so the distance between kinds and the vivid status set
  (0.17–0.23) shrinks. Kinds stay further from each other (minimum ΔE 11.8 → 14.0).
- Contrast: paper glyphs 3.4–3.9:1 on white (unchanged band); pin and panel glyphs 2.6–3.0:1 on white (the same
  sub-3:1 cost CLAUDE.md already records for the panel); dark 7.0–8.0:1 on #202124.

**CLAUDE.md (Colour language)** must change with it: “One chroma for all six, at 0.119” → 0.150, with the date and
the reason (the owner asked for bolder kind colours), and the gauge/amber cost added to the costs it lists.

## Phase 2 · Fonts

| File | Change |
| --- | --- |
| `vendor/fonts.css` | Add the two `@font-face` blocks from `tokens/brand.css` (Archivo, JetBrains Mono). Same Latin `unicode-range` as Roboto. |
| `index.html` CSP | No change: fonts are same-origin. |
| `build.mjs` | Confirm the two woff2 files are copied to `site/` (it copies `vendor/`). |

Roboto stays the UI face. Archivo is display only (wordmark, splash, About). JetBrains Mono for readings is Phase 6,
and ships with the rebrand.

## Phase 3 · The mark (`icon.svg` and the `--i-flood` mask)

`icon.svg` stays **the bare glyph on transparency**, the one drawing everything else is baked from. Replace its
contents with `branding/icon/web/icon-mono.svg` (viewBox `0 0 100 100`).

Why it must stay bare: `js/alerts.js` 255–284 paints the red alert favicon by drawing `icon.svg` and filling it
with `--s-danger` using `source-in`. A tiled `icon.svg` would come out as a solid red square.

`php icon-build.php` prints the new `--i-flood` rule → paste over `css/icons.css` line 68. Every place that draws
`i-flood` updates with it:

- `index.html` 244, 251 (splash), 287 (`#brand`), 322 (`menuAbout`), 393 (rail pill), 460 (About logo), 930 and 1001 (Help)
- `js/ticker.js` 218 (closing lockup)

The XOR hole in the glyph shows the surface behind it, which is correct in a mask.

## Phase 4 · App icons

Rewrite `icon-build.php`. The icons are now an **opaque volt tile with a white glyph**, not a blue glyph on
transparency.

| Output | Spec | Replaces |
| --- | --- | --- |
| `icon-192.png`, `icon-512.png` | Rounded tile, purpose `any` | Blue glyph on transparency |
| `icon-maskable-192.png`, `icon-maskable-512.png` | Full-bleed square, glyph at 0.84 inside the 80% safe circle | (new) |
| `icon-180.png` | Opaque square, no pre-rounding (iOS rounds it) | White tile with blue glyph |
| `favicon.svg`, `favicon.ico` | Rounded tile | `icon-192.png` used as the favicon |
| `badge-96.png` | White glyph on transparency (Android notification badge is an alpha mask) | `icon-192.png` as badge |

Ready-made copies of all of these are in `branding/icon/web/`. The build script should still bake them from
`icon.svg` so the drawing lives in one place.

Then:

- `manifest.json`: replace `icons` with `branding/icon/web/manifest-icons.json`; set `background_color` to `#0038FF`
  (decided: volt launch screen for the installed Android app) and keep `theme_color` `#ffffff`.
- `index.html` 39–47: `<link rel="icon" href="favicon.svg?v=4" type="image/svg+xml">` plus an `.ico` fallback;
  bump every `?v=3` to `?v=4` (here and in the manifest), as the comment there requires.
- `build.mjs` 171: add `icon-maskable-192.png`, `icon-maskable-512.png`, `favicon.svg`, `favicon.ico`, `badge-96.png`
  to the copy list.
- `sw.js` 113: `badge: at('badge-96.png')`.
- `js/alerts.js` 267: the red state should become **a `--s-danger` rounded tile with the white glyph**, so it still
  reads as our icon in a tab strip full of tiles. Draw the tile, then the glyph with `destination-out` /
  white fill. The comment's rule (token, not hex; repaint only on a flip) stands.

## Phase 5 · Wordmark and lockups

The wordmark becomes **FLOOD WATCH** in Archivo Expanded 900, with **KLANG VALLEY** as a JetBrains Mono descriptor.

Measured widths of `FLOOD WATCH`: 154 px at 16 px, 174 at 18, 193 at 20, 212 at 22.

| Place | File | Change |
| --- | --- | --- |
| App bar / rail `#brand` | `index.html` 286–293, `css/chrome.css` 161–200, 294–321 | New ladder: mark + `FLOOD WATCH` + descriptor → mark + `FLOOD WATCH` → mark only. The old `Klang Valley Flood Watch` / `KV Flood Watch` spellings go. Rail width 164 px holds `FLOOD WATCH` at 15 px. |
| About logo `.logo` | `index.html` 460, `css/chrome.css` 888–905 | Stacked lockup: mark over wordmark over descriptor. |
| Ticker closing lockup | `js/ticker.js` 218, `css/chrome.css` 777–783 | Mark + `FLOOD WATCH` in Archivo at the ticker's size. |
| Splash `#splash` | `index.html` 250–262, `css/chrome.css` 4130–4160 | Brand moment: volt background, white mark, white wordmark. The NO INTERNET / server warnings sit in a white card so their status colours never land on blue. |
| `<title>`, manifest `name` | unchanged | Still “Klang Valley Flood Watch” for search. |

`title-test.html` guards the wordmark ladder in rendered pixels. Its thresholds must be re-measured for the new
face, in both homes (app bar and rail), on both targets.

## Phase 5b · Buttons, bold (decided 2026-11-25)

**The style.** Three variants of M3's common button, one shared class instead of the four ad-hoc ones today
(`.mtext`, `.tbtn`, `.link`, and per-pane buttons):

| Variant | Light | Dark | Use |
| --- | --- | --- | --- |
| `.btn.primary` | `--accent` fill (#0038FF), white label (6.98:1) | #8AA4FF fill, #202124 label (6.77:1) | The ONE main act on a surface: Near me, Remove all, Try again |
| `.btn.secondary` | Ink fill (#1F1F1F), white label | #E8EAED fill, #202124 label | A second act beside it: Show on map, Raw payload |
| `.btn.text` | `--on-surface` label, underlined | same | Cancel, Back, low-stakes acts |

Shared: `min-height: 48px`; `padding: 0 24px`; `border-radius: 12px` (`--md-sys-shape-corner-medium`);
Archivo Expanded 800, 13px, `font-stretch: 125%`, `letter-spacing: .02em`, `text-transform: uppercase`; the label
stays sentence case in the markup (screen readers read words, not shouting); hover and press use the existing
`--m3-state-hover` / `--m3-state-press` mixes; focus ring is `--focus-ring` as everywhere else; disabled is the M3
38% / 12% pair.

**Treading carefully: the guardrails**

1. **One primary per surface.** Never two volt buttons side by side. The confirm dialog is primary + text.
2. **Never a status colour.** A destructive confirm stays volt and names the act (“Remove all”), as `ask()` already
   requires. Red stays the map's.
3. **Short labels.** Two words, about 14 characters. Archivo capitals are wide: “SHOW ON MAP” at 13px is about
   135px. Below 600px, a row of two buttons that does not fit stacks full-width, primary on top (except dialog
   footers, which stay on one line, text button first).
4. **Only common buttons change.** Icon buttons, chips, menu items, list action rows, the rail and navigation bar,
   the seek bar controls and FABs keep their M3 shapes and Roboto. Grep `<button` (52 in `index.html` plus
   those written by `js/`) and classify each before touching it.
5. **Touch target stays ≥ 48px**, which this style raises from the current 40px.

**Where**

| File | Change |
| --- | --- |
| `css/base.css` | New `.btn`, `.btn.primary`, `.btn.secondary`, `.btn.text` beside `.link` (806–813). `.link` becomes an alias of `.btn.text` or is retired. |
| `css/chrome.css` 3490–3505 | `.tbtn` (alert bulk action) → `.btn.text`. |
| `css/chrome.css` (`.mtext`, `.mdlgfoot`) | Confirm dialog: `#confirmNo` → `.btn.text`, `#confirmYes` → `.btn.primary`. |
| `index.html` 262 | Splash “Try again” → `.btn.primary` (on the white warning card, never on volt). |
| `index.html` 855–856 | The two confirm buttons. |
| `js/alerts.js` 53 | `class="tbtn"` → `class="btn text"`. |
| Settings developer rows | Stay M3 list action rows; not buttons. |

**Docs and checks.** `CLAUDE.md`'s writing standard says sentence case for every rendered string and lists the
ALL-CAPS blocks as the exception; add buttons to that exception, noting the caps are CSS only. `m3-check.html`
measures the confirm dialog footer and the text button; update its expected heights (40 → 48) and corners.
`keys-test.html` checks focus rings resolve to one width and colour; no change expected.

## Phase 6 · Readings in mono (decided: ships with the rebrand)

`font-family: var(--font-mono); font-variant-numeric: tabular-nums` on station values, meter labels, graph axes and
the table's number columns (`js/popup.js`, `js/table.js`, `js/sparktip.js` and their CSS). Widths change, so the
phone name column and the table `min-width` (one number in two places, see GOTCHAS) need re-measuring.
`m3-check.html` and `paint-check.html` will catch overflow.

## Phase 7 · Social and store

- Ship `branding/social/og-image-1200x630.png` as `og-image.png`; add `og:title`, `og:description`, `og:image`
  (absolute URL on the Pages build) and `twitter:card` to `index.html`. CSP needs no change.
- Native wrappers (if the app is ever packaged): `branding/icon/ios/` and `branding/icon/android/` are drop-in.

## Phase 8 · Help screenshots

`php help-build.php` after Phases 1–5. The rail, the brand and the accent appear in the shots.

## Phase 9 · Stale references

| File | Line | Change |
| --- | --- | --- |
| `m3-check.html` | 2064 | Hard-coded `#1a73e8` → read `--accent`. |
| `icon-color-lab.html` | 27, 31 | Update or mark retired (it compares the old blue). |
| `icon-build.php` | 17 | `INK` constant goes with the rewrite. |

## Phase 10 · Docs (same commit as the change, per CLAUDE.md)

- `docs/FEATURES.md`: a “Rebrand: the Breach mark and volt accent” entry. What changed, why (the audit and rounds in
  the design canvas), trade-offs (louder selected pill, new font bytes ~74 KB, wordmark ladder re-measured), and what
  was deliberately not done (no brand colour on the map, Roboto kept for UI).
- `CLAUDE.md` file table: `icon.svg`, `icon-build.php`, `icon-180.png`, `icon-192/512.png`, new maskable and
  favicon files, `vendor/` fonts, `branding/`.
- `docs/GOTCHAS.md` 642: “The app icons are transparent, so `purpose` must stay `any`” is no longer true. Replace it:
  the `any` icons are opaque rounded tiles and the maskable pair carries its own safe zone.
- `docs/GOTCHAS.md` 654: iOS still needs `icon-180.png`; it is now an opaque square, not a white tile.
- New gotcha: `icon.svg` must stay a bare glyph because the red favicon is painted from it.

## Phase 11 · Verify

1. `npm run build:check`
2. `php shots-test.php`, `php api.php --selftest` (should be untouched)
3. `heat-test.html`, `map-limits-test.html` (source only; should be untouched)
4. `m3-check`, `paint-check`, `title-test`, `narrow-test`, `keys-test`, `route-test` on the source **and** with
   `?base=/site/`
5. By eye: light and dark theme; rail open and closed; a phone at 360 px; the red favicon; an installed PWA on
   Android (maskable icon, launch screen) and iOS (home-screen icon).

Expected failures to fix, not ignore: `title-test` (new wordmark widths); `m3-check` where it reads the accent or
the navigation indicator colour (now ink); `m3-check` and `paint-check` wherever mono readings change a
measured width (station card, table name column and `min-width`, chip counts).

## Rollback

Every phase is one commit. Phase 1 alone is a two-line revert.
