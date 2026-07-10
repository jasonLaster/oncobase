# Wiki Parity Harness

Report-only tools for comparing the legacy Next wiki (`https://diana-tnbc.com`)
with a Vite preview or production origin. These scripts do not fail CI on drift;
they write reports for migration burn-down.

## Manifest Diff

```sh
bun scripts/parity/manifest-diff.ts https://wiki-vite-zeta.vercel.app --out test-results/parity-manifest.md
```

The default legacy origin is `https://diana-tnbc.com`. Override it with
`PARITY_LEGACY_ORIGIN`.

For session-scoped manifests, provide cookies from a logged-in browser session:

```sh
PARITY_COOKIE_HEADER='authed=true; wiki_user_session=...' \
  bun scripts/parity/manifest-diff.ts https://wiki-vite-zeta.vercel.app --session --out test-results/parity-manifest-session.md
```

Use `PARITY_LEGACY_COOKIE_HEADER` and `PARITY_VITE_COOKIE_HEADER` when the two
origins need different cookie headers.

The report compares:

- corpus-level `manifestHash`
- page set, `contentHash`, and `size`
- `compactTree`
- asset set, `contentHash`, and `size`

## Visual Diff

The visual harness is a Playwright project. It first fetches manifests from both
origins and aborts before screenshots unless the `manifestHash` values match.

```sh
PARITY_VITE_ORIGIN=https://wiki-vite-zeta.vercel.app \
PARITY_LOGIN_PASSWORD=diana \
  bunx playwright test -c scripts/parity/visual-diff.config.ts
```

Outputs are written to `test-results/parity-visual/` by default:

- `report.md`
- `report.html`
- desktop `1440px` and mobile `390px` full-page screenshots for each slug

Set `PARITY_VISUAL_LIMIT=20` for a bounded sample while iterating. Set
`PARITY_VISUAL_OUTPUT_DIR` to move the report.

The screenshot masks follow the existing Vite visual parity convention:
`.metrics-panel`, `.topbar-status`, and `.page-footer`.

## Visual Journeys

The journey harness captures app routes and interaction states that are outside
the wiki manifest slug set: chat, search, diagnostics, DICOM, comments, tags,
admin, command palettes, sidebar collapse, and mobile navigation. Run it once
per origin, writing screenshots into label-specific directories, then diff the
two directories:

```sh
PARITY_ORIGIN=https://diana-tnbc.com \
PARITY_ORIGIN_LABEL=legacy \
PARITY_LOGIN_PASSWORD=diana \
PARITY_JOURNEY_OUTPUT_DIR=test-results/parity-journeys/legacy \
  bunx playwright test -c scripts/parity/visual-journeys.config.ts

PARITY_ORIGIN=https://wiki-vite-zeta.vercel.app \
PARITY_ORIGIN_LABEL=vite \
PARITY_LOGIN_PASSWORD=diana \
PARITY_JOURNEY_OUTPUT_DIR=test-results/parity-journeys/vite \
  bunx playwright test -c scripts/parity/visual-journeys.config.ts

bun scripts/parity/journey-diff.ts \
  --legacy test-results/parity-journeys/legacy \
  --vite test-results/parity-journeys/vite \
  --out test-results/parity-journeys/diff \
  --threshold 0.02
```

Outputs are named `<checkpoint>-<viewport>.png` for captures. Each capture also
tries to write `<checkpoint>-<viewport>.txt` containing normalized
`innerText` from `main` when present, otherwise `body`; emoji are preserved.
Text sidecars are best-effort, and `journey-diff.ts` remains compatible with
older PNG-only capture directories.

Diff outputs are named `<checkpoint>-<viewport>-DIFF.png`. The diff report is
written to `report.md` and `report.html`, sorted by perceptual diff percentage
in the main table. Before the main table, both reports include a
`Semantic differences below pixel threshold` section for pairs below the pixel
review threshold that still have text-token drift or a localized diff cluster.
The reports include `text Δ` (added plus removed token count, with
`+added/-removed` detail), cluster count, largest cluster pixel count, largest
cluster bounds as `x,y,w,h`, and a localized flag. The HTML report also shows
up to eight added and removed sample tokens for each text diff.

The diff script crops both images to the common top-left dimensions and runs
`pixelmatch` with `threshold: 0.15` and `includeAA: false`. It labels connected
diff-pixel clusters with 4-connectivity and flags a pair as localized when the
largest cluster is at least `2500` px by default. Override the localized floor
with `--localized-floor` or `PARITY_JOURNEY_LOCALIZED_CLUSTER_FLOOR`.
Override the global pixel review threshold with `--threshold` or
`PARITY_JOURNEY_REVIEW_THRESHOLD`.

Set `PARITY_COOKIE_HEADER` instead of `PARITY_LOGIN_PASSWORD` when reusing a
logged-in browser session. Label-specific cookie overrides are also supported
with `PARITY_ORIGIN_COOKIE_HEADER`, `PARITY_LEGACY_COOKIE_HEADER`, and
`PARITY_VITE_COOKIE_HEADER`.

The journey checkpoints are best-effort and report-only: missing routes,
missing data such as chat conversations, or unavailable admin access are logged
and skipped without aborting the rest of the run.

## Functional Cross-Check

After a Vite preview is deployed, run the legacy production e2e suite against it:

```sh
TEST_ENV=prod PLAYWRIGHT_BASE_URL=<vite-preview> bun --cwd apps/web test:prod
```

Expected failures are the burn-down list for later migration PRs. Do not port
RBAC, comments, timeline, DICOM, admin, or redirect behavior as part of this
PR's report-only harness.
