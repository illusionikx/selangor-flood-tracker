# Flood Watch brand kit

The source of truth for the Flood Watch identity. App files (`icon.svg`, `icon-*.png`, `vendor/` fonts) are copies
baked from here. Full guideline: the **Flood Watch Brand Guidelines** doc. How to apply it to the app:
[`MIGRATION.md`](MIGRATION.md).

## The mark

The **Breach**: a water-level marker (▽) dipping below a water surface, the overlap flipped (XOR). White on volt
blue in the tile; volt, white or black on its own.

## Colour

| Name | Hex | Use |
| --- | --- | --- |
| Volt | `#0038FF` | Brand, app accent (light theme), icon tile |
| Volt Light | `#8AA4FF` | App accent on the dark theme, dark icon glyph |
| Water | `#5B86FF` | Illustration only |
| Shallow | `#E6ECFF` | Tinted panels |
| Ink | `#0B0D10` | Wordmark and text on brand material |
| Paper | `#FFFFFF` | Base |
| Night | `#0A1233` | Dark brand fields |

Never brand: the status colours (`--s-*`) and sensor-kind colours (`--k-*`) in `css/base.css`.

## Type

Archivo Expanded 900 (wordmark, display) · JetBrains Mono 500 (readings, descriptor) · Roboto (app UI, unchanged).
All SIL OFL 1.1, self-hosted.

## Folders

| Folder | Contents |
| --- | --- |
| `logo/` | Mark (volt / white / black), tile, wordmark (ink / white / volt), horizontal and stacked lockups, reverse versions. All outlined SVG, no font needed. |
| `icon/web/` | favicon (svg, ico, 16/32/48), apple-touch-icon 180, PWA 192/512 (`any`) and maskable 192/512, notification badge, `manifest-icons.json`. |
| `icon/ios/` | `AppIcon.appiconset` (default, dark, tinted 1024 + `Contents.json`) and `icon-composer/` layers for iOS 26+. |
| `icon/android/` | Adaptive icon (`res/mipmap-anydpi-v26`, vector foreground + monochrome, background colour), legacy mipmaps mdpi–xxxhdpi, Play Store 512. |
| `tokens/` | `tokens.json` (everything above, machine-readable) and `brand.css` (drop-in CSS custom properties and `@font-face`). |
| `fonts/` | `archivo-expanded.woff2`, `jetbrains-mono.woff2`, licences. |
| `social/` | Share card 1200 × 630. |

## Rules in one breath

Clear space = ⅓ of the mark height. Minimum: mark 16 px, lockup 120 px wide. No status colour, gradient, outline or
text in the mark. Square icon art is never pre-rounded for iOS or Play.
