# Reader shortcut regression audit

Cmd+O was registered only after the interactive shell mounted. The initial HTML could be readable for several seconds before that listener existed. Selecting text in the initial article also retained the hidden/inert application root, including any command palette opened inside it.

The document head now installs the shared shortcut controller before the streamed article. React adopts that controller and any pending request without restarting an in-progress chord. Explicit palette requests release retained text selection once the matching article is ready and focus the revealed dialog. Escape cancels startup requests and chord timers; direct outline/action shortcuts cancel a pending file-palette timer.

The file palette now uses the same validated, store-local public navigation seed as the sidebar until the first authoritative manifest arrives. It deduplicates shortcut aliases. A received manifest, including an empty manifest, supersedes the seed. This fallback neither marks a manifest current nor changes document access checks.

## Regression coverage

- Cmd+O, Ctrl+O, Cmd+Shift+O and Cmd+Shift+K before application scripts arrive.
- Escape before scripts arrive, and opening again after startup.
- Opening and focusing the palette while native text selection retains the initial article.
- Finding provisional files before the manifest, removing retired files when it arrives, and keyboard navigation to a document.
- Executing the minified server's head script without the article or application modules.
- Shared controller adoption, pending chord timers, direct shortcut cancellation and teardown.

The existing browser suites also exercise sidebar geometry in both themes, stylesheet failure, native navigation without JavaScript, scope changes, modal focus, search, document rendering, and cache/recovery behavior.

## Running the audit

Build with `bun run build` in `apps/app`, then run `bun run check:bundle`. The LiveStore shell ceiling allows 64 additional gzip bytes for shared-import symbol churn; measured output is 16,775 gzip bytes against the previous 16,768-byte ceiling. No other bundle ceilings were increased.

Run SQLite-heavy unit files in separate Bun processes: their shared 16 MiB WASM heap can exhaust when every store suite runs in one process. This audit ran all tracked unit files that way, plus the new shared-controller suite.

The complete browser suite needs the production-build application server for API, metadata, redirects, PDF, download and chat-layout checks. A static Vite preview cannot satisfy those endpoints. Set `PLAYWRIGHT_BASE_URL` and `WIKI_VITE_PREVIEW_LOGIN_PASSWORD`, then run `bunx playwright test` from `apps/app`. Use the server's ordinary SPA default when combining live read-only endpoints with synthetic API fixtures; HTML-first suites inject their own synthetic server HTML. Otherwise the server's real initial article conflicts with mocked manifests. This audit's local server rejected backend mutations. Credential-dependent admin/live-write and opt-in live-model tests retain their normal skips.

Use `PLAYWRIGHT_BROWSER=firefox` or `webkit` to repeat `html-page-bootstrap.spec.ts`, `command-palette.spec.ts`, and `header-shell.spec.ts`. Test artifacts remain in the ignored local `.playwright/regression-audit` directory.

## Verified results

- All 85 previously tracked unit-test files passed: 693 tests. The new controller adds six passing cases, for 699 unit tests. The final related shared-shell/server run passed 32 cases across eight files.
- Complete Chromium suite against the application server: 427 passed, 41 skipped, zero failures (8.4 minutes).
- Focused Chromium palette/header/bootstrap/search suite: 68 passed, one skipped.
- Firefox palette/header/bootstrap suite: 47 passed, one skipped.
- WebKit: all seven new HTML-first palette regressions passed.
- Production build/typecheck, bundle budgets, and whitespace checks passed. Changed TSX lint has no errors; two existing effect-state warnings remain in CommandPalette.

The initial static-preview sweep passed 336 cases but could not serve the server-dependent cases. The final complete application-server run above supersedes it. One stale public-scope test now requests `?scope=public` explicitly, matching the intended automatic session scope for signed-in readers.

## First-open latency follow-up

The Vite rollback was cancelled before any branch, main, or deployment changes. The reader remains on Vite.

Cold production samples before this follow-up took approximately 800 ms from Cmd+O to visible input and 1,040 ms for Cmd+K. The palette chunk request began after the shortcut (and after the existing 600 ms chord window for Cmd+K).

The interactive host now prepares the split palette module when it mounts. Once prepared, it renders the component directly on request, avoiding both the first-interaction download and a fresh lazy boundary. The dialog remains unmounted until requested. A speculative failure leaves the existing lazy-loading and asset-recovery path available. The chord window and all keyboard mappings are unchanged.

The new browser regression requires the module request before any shortcut, waits for its dependency graph to evaluate, then blocks further script requests and verifies first-open focus and file navigation. This guards against moving the download back behind the first interaction. Build, typecheck, scoped lint, and existing bundle budgets pass. Browser results: 20 Chromium palette tests, 20 Firefox palette tests, and four WebKit first-open/chord/modal checks. The static-preview-only header test remains skipped.
