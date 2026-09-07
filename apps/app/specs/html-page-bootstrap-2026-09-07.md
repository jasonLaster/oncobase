# Readable HTML and cached rendering — implementation follow-up

The HTML-first experiment now carries the current public page as a validated data payload, and the app consumes it before rendering its reader. This implements the initial-page bootstrap and render-cache recommendations from the earlier investigation. The article remains readable before the full application is interactive.

The change is local on `codex/initial-page-performance`; production has not been changed. `WIKI_HTML_FIRST=1` enables the application path, with the existing experiment flag retained for compatibility. `?html-first=off` still selects the normal reader. The loopback preview remains available through the experiment harness at `http://127.0.0.1:62009/__experiment/start`.

## Result

The updated A/B measured 24 local loads: three fresh browser contexts per mode and CPU setting, each followed by a reload. All used home revision `index:831515f095d851bb`. Network and server process were warm; CPU settings were normal and 4× slowdown. These are small local samples, not a production latency guarantee.

| First visit | Normal reader: article | HTML-first: readable article | HTML-first: live article |
|---|---:|---:|---:|
| Normal CPU | 1,342 ms | **309 ms** | 1,192 ms |
| 4× slowdown | 1,727 ms | **238 ms** | 1,479 ms |

The normal reader needs one page-body API request on a cold visit. The bootstrapped reader made **zero body API requests in all 12 HTML-first cold/reload samples**. First-visit handoff was approximately 150–250 ms sooner than the normal reader, while the article was readable much earlier. Identity, workers, the database, and enhanced controls still initialize separately.

Reload reading remained approximately 0.19–0.22 seconds in both modes. All samples had zero browser errors and private, no-store HTML. HTML-first samples recorded no layout shift. Calculated gzip size of the current HTML response was 5,951 bytes versus 2,935 bytes for the normal shell, about 3 KiB extra including the page data. Exact transfer compression depends on the deployment.

Aggregate results are in `html-page-bootstrap-2026-09-07.json`; private per-load records are in the ignored `.playwright/html-first/` directory. The previous experiment's aggregate report remains unchanged for comparison.

## Page bootstrap

The authorized HTML response contains the redacted public article plus an inert JSON data block. The data block escapes HTML-sensitive characters and has a 1 MiB wire-size limit. The client validates its format version, reader version, site, origin, API origin, pathname, slug, page shape, and public classification. It accepts it only during the first minute of that HTML response.

LiveStore's boot hook installs this page before any reader component mounts. This prevents an older persisted body from briefly replacing the fresh server HTML. A source hash match does not prevent replacement: the redacted text can have changed without a source revision change.

The payload does not choose an account identity. Existing public/session identity resolution still completes before the store is selected. A public page can be seeded into the already authorized session reader; no restricted data enters this bootstrap or the public snapshot cache. The data block is removed after its first attempt so a later identity change or recovery cannot replay old visibility. Recovery without the data block uses the normal API path.

The initial route does not fetch the body again. The manifest is still revalidated, including when an old cached manifest would otherwise count as fresh. An updated revision triggers the existing page fetch; deletion or restriction removes the body through existing reconciliation. A confirmed unavailable result also removes the early HTML even when a reader is selecting text. Ordinary handoff preserves scroll, focus, and selection.

## Render cache

Rendering is cached after the current document lookup and API redaction. Password-gate enforcement and response cache headers remain unchanged. Restricted pages are excluded from early HTML and its payload.

The bounded process cache uses least-recently-used eviction, at most eight entries, 512,000 bytes per entry, and 2,048,000 bytes total. Its key includes renderer version, site, slug, source revision, and actual redacted markdown. A changed redaction policy therefore invalidates the representation even if the source hash is unchanged. The existing API's 15-second policy cache remains in effect. Fresh visibility is checked before reuse, so a warmed rendering cannot serve a subsequently restricted document.

This caches rendering CPU work behind access checks. It does not make gated HTML a public CDN object, cache authorization decisions, or add account-only HTML caching.

## Verification

- 49 unit tests passed across payload validation, actual LiveStore boot/materialization, schema reconciliation, session resolution, render-cache reuse/eviction, password gating, visibility changes, and redaction-policy refresh.
- Five browser tests passed in both Chromium and WebKit: HTML with scripts held; handoff while the full manifest is held; zero duplicate body fetch; revision updates; restriction during text selection; invalid payload fallback; and session/public cache isolation.
- The payload is consumed once and removed from the document. A new reader store cannot automatically replay it after an access change.
- Agent-browser verified the live-content preview, a successful seed/handoff, and zero current-page body requests.
- Live-content checks passed with JavaScript disabled, scripts or the manifest held, desktop and mobile layouts, scroll/focus/selection preservation, revision fallback, a blocked body API, and WebKit handoff.
- TypeScript, production build, focused ESLint, total bundle budgets, and whitespace checks passed. The new reader hook brings the LiveStore shell to 16,427 bytes gzip, 43 bytes above the previous 16 KiB ceiling; that individual ceiling is now 16.25 KiB. The payload-loading code is explicitly counted as eager for budget purposes. Total eager assets are approximately 1,197 KiB, within the unchanged aggregate limit.

The earlier experiment's simplified pre-interactive navigation and conservative markup sanitizer remain. Rich diagrams, math, full document metadata, and broader layout parity still warrant preview verification before enabling this across all public documents. Account-only rendering remains outside this public-page optimization.

## Reproduce

From the repository root:

```sh
bun apps/app/scripts/serve-html-first-experiment.ts
HTML_FIRST_PROFILE_ONLY=1 bun apps/app/scripts/profile-html-first.ts
```

Run the synthetic browser suite against that local production-build server:

```sh
cd apps/app
PLAYWRIGHT_BASE_URL=http://127.0.0.1:62009 bunx playwright test e2e/html-page-bootstrap.spec.ts
PLAYWRIGHT_BASE_URL=http://127.0.0.1:62009 PLAYWRIGHT_BROWSER=webkit bunx playwright test e2e/html-page-bootstrap.spec.ts
```

The loopback harness uses a synthetic local gate session and must not be deployed. Its convenience unlock route is separate from the application handler.
