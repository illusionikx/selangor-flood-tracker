# Flood Watch rebrand: deployment plan

Decided 2026-11-25. Code changes are in [`MIGRATION.md`](MIGRATION.md); this file covers order, gates and deployment.

**A push to `main` is a deploy.** `.github/workflows/pages.yml` bakes GitHub Pages on every push, and the Debian
box pulls `main` every 15 minutes (docs/DEPLOY.md, Updating). So all work happens on branches, and nothing is
merged until its checks pass on the source and the build.

## Releases

Integration branch `brand/o4`; one branch per release, merged to `main` with `--no-ff` so one revert undoes one
release. No fixed dates: each ships when its gate passes; R2 and R3 follow once the previous release has run clean
for a day. No canary: Pages and the box follow `main` together.

| Release | MIGRATION.md phases | Server-side change |
| --- | --- | --- |
| R0 · Kit | 0: commit `branding/`, copy fonts to `vendor/` | none |
| R1 · Identity | 1 (accent, ink nav), 2 (fonts), 3 (mark), 4 (icons), 5 (wordmark, splash), 7 (share card), 8 (Help shots), 9, 10 (docs) | nginx cache rule, below |
| R2 · Controls and type | 5b (bold buttons), 6 (mono readings) | none |
| R3 · Vivid sensor colours | 1b | none |

Each release carries its own `docs/FEATURES.md` entry and CLAUDE.md / GOTCHAS edits in the same branch.
Rerun `php help-build.php` at the end of R1 and R2.

## Gate before every merge

```
php icon-build.php            # R1 only
npm run build:check
php shots-test.php
php api.php --selftest
```

Then `m3-check`, `paint-check`, `title-test`, `narrow-test`, `keys-test`, `route-test` on the source and with
`?base=/site/`; `heat-test` and `map-limits-test` on the source. Finish with `npm run build`.

Expected to need updating, and nothing else may be red:
- R1: `title-test` (wordmark ladder), `m3-check` (accent, navigation indicator colour).
- R2: `m3-check` (button height 40 → 48, corners), `paint-check` / `m3-check` where mono changes a measured width.

By eye: light and dark, rail open and closed, 360 px, splash with its warning card, the red alert favicon in test
mode; R2: confirm dialog and a station card on a phone; R3: a calm flood-gauge pin beside an alerting river pin.

## Deploying

1. R1 only, on the box, before merging. The one-day cache rule matches `icon-\d+\.png` and misses the new files:

   ```
   location ~* ^/(border\.json|manifest\.json|favicon\.(svg|ico)|badge-\d+\.png|icon-(maskable-)?\d+\.png|og-image\.png|img/) {
   ```

   `nginx -t && systemctl reload nginx`. Update the same line in `docs/DEPLOY.md`.
2. Merge to `main` with `--no-ff`; push. **Ask the owner before this step.**
3. Pages: watch the Actions run; a failed bake leaves the last deployment live.
4. Box: wait for the cron or run `pct exec 112 -- update` plus the build and rsync lines from docs/DEPLOY.md.
   Never force past a failed `--ff-only`.
5. Verify both sites: favicon, `manifest.json`, one station card; on the box also a `?cam=` still and the camera
   timeline (proves the rsync excludes held).

## Caches

Hashed CSS/JS and the service worker shell refresh themselves. Not hashed, R1: bump `?v=3` → `?v=4` for the icons
in `index.html` and `manifest.json`, and the `vendor/fonts.css` link. Android re-mints the installed icon within a
day or two; an existing iOS install keeps the old icon until re-added. `icon.svg` must stay a bare glyph, because
the red alert favicon is painted from it.

## Rollback and rules

- `git revert -m 1 <merge commit>` on `main`, push. Both targets redeploy themselves. Runtime state
  (`shots/`, `.history.db`, `.cache.json`, `.vapid.json`) is never touched by a deploy.
- Do not merge while any station is at danger or a MET warning is in force.
- After each deploy, check `.client-errors.log`, `.php-error.log` and the Actions history the next day.
