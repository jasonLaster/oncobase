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

## Functional Cross-Check

After a Vite preview is deployed, run the legacy production e2e suite against it:

```sh
TEST_ENV=prod PLAYWRIGHT_BASE_URL=<vite-preview> bun --cwd apps/web test:prod
```

Expected failures are the burn-down list for later migration PRs. Do not port
RBAC, comments, timeline, DICOM, admin, or redirect behavior as part of this
PR's report-only harness.
