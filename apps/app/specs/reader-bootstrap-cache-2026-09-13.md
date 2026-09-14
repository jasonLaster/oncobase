# CSR page bootstrap and stable JavaScript caching

Implemented on `codex/reader-bootstrap-cache`, based on `origin/main` at `46328729`. This report records the local pre-release validation. The unrelated primary checkout remains untouched.

## Behavior

The normal client-rendered document response now includes a bounded inert JSON block containing the current redacted public page. It reuses the document lookup already required for metadata and the request-scoped policy already checked by the password gate. React still renders the article. The existing LiveStore boot hook consumes the data once, seeds the current page before reader components mount, and suppresses the duplicate page-body request. Manifest validation continues to reconcile changed revisions and removed/restricted pages.

Restricted documents, missing revisions, invalid or oversized payloads retain the existing API path. The payload is limited to 1 MiB of escaped JSON. Site, origin, API origin, route, schema version, page shape and receipt age remain validated. HTML-sensitive characters are escaped. Password-gated responses remain private/no-store. The bootstrap does not select an account or grant access. HTML-first rendering remains a test-harness option only.

The existing immutable HTTP cache policy and content-hashed asset filenames were already correct. The previous vendor grouping allowed Effect and LiveStore to import `wiki-utils`, and markdown to import other application/shared chunks. Transitive dependency grouping with explicit ownership priorities removes those dependencies. A change to an application utility now preserves all five vendor bundle URLs and bytes. The same edit on the baseline invalidated Effect and LiveStore (206.3 KiB gzip combined); the cache-stability check deliberately fails against that baseline and passes against the candidate. React stays in its own chunk; specialist features remain lazy.

Startup gzip size changes from 1,199.4 KiB to 1,198.5 KiB. The LiveStore/markdown per-chunk limits were reallocated to include their dependencies; the aggregate startup and lazy limits are unchanged. This is primarily cache-retention work, not a substantial bundle-size reduction. The first deployment of the new grouping will invalidate the regrouped vendor assets once.

## Measurement method

The production-build benchmark serves synthetic content over real loopback HTTP with gzip assets, the normal app-shell handler, and a two-document manifest. It uses no Playwright request interception, preserving the browser HTTP cache. The baseline uses the saved unchanged production build and omits the data payload; the candidate uses the new build and bootstrap. Both use the same current handler and synthetic policy, so this isolates client startup/body-request effects rather than modeling real backend response latency.

Each pair uses independent persistent browser profiles, alternates mode order, and measures first load, reload, third load and a new browser process reopening the profile. Public scope is explicit. Fixed endpoint delays are 200 ms for identity, 400 ms for manifest and 350 ms for a page-body request. Network bandwidth is otherwise unthrottled. A 4x CPU setting is a synthetic slowdown, not a physical phone. Article readiness is a frame-based observation of the actual React markdown body, separate from loading-shell FCP and the existing component-local route timer. The warm cases include both browser and application caches.

Page resource timing records transferred JavaScript bytes; it does not enumerate every nested worker resource. These small synthetic samples are not production percentiles, real account-session timings, or a cold-internet 200 ms guarantee.

## Results

48 completed loads, zero page errors. Three paired runs per CPU setting; medians below are milliseconds. All 24 candidate loads seeded the current page and made zero body requests. All six baseline cold loads made one body request. All repeat loads in both modes had zero page-observed JavaScript transfer, including after browser restart.

| CPU slowdown | Visit | Baseline article | Candidate article |
| --- | --- | ---: | ---: |
| 1x | cold | 1,473 | 1,112 |
| 1x | reload | 405 | 418 |
| 1x | hot | 410 | 416 |
| 1x | restart | 473 | 469 |
| 4x | cold | 1,628 | 1,280 |
| 4x | reload | 465 | 480 |
| 4x | hot | 454 | 468 |
| 4x | restart | 670 | 680 |

Cold readiness improves by 361 ms (24.5%) at normal CPU and 348 ms (21.4%) at 4x slowdown, consistent with removing the imposed 350 ms body request. Repeat-load differences are small (candidate reload medians are 13–15 ms slower); there is no measured warm-start speedup. Startup still exceeds 200 ms in this fixture. The imposed identity delay alone is 200 ms on a cold load, so this is not a test of whether a fast backend could meet the target.

The next experiment should measure the remaining identity, library evaluation, database boot and render stages, then test rendering before LiveStore as separately scoped work. This change deliberately retains the existing database startup path.

## Bytecode caching

Stable external URLs and source bytes allow browser-managed compiled-code reuse. There is no application API that guarantees all JavaScript will skip parsing or compilation. Diagnostic Chromium traces recorded module-cache production and compilation activity, but did not establish universal bytecode-cache hits or zero parsing. Cache warmth is therefore reported from HTTP transfer evidence, not assumed from trace event names. Detailed compile tracing is opt-in because its overhead would contaminate ordinary timing comparisons.

This follows [V8's code-cache guidance](https://v8.dev/blog/code-caching-for-devs): stable library scripts support reuse, while cache heuristics and lazy compilation remain browser-controlled. No service worker, eval-based loader, or manually serialized bytecode was introduced.

## Reproduce

Save an unchanged build before applying the changes:

```sh
mkdir -p .playwright/bootstrap-cache
cp -R apps/app/dist .playwright/bootstrap-cache/baseline-dist
```

After building the candidate, from the repository root:

```sh
bun apps/app/scripts/profile-bootstrap-cache.ts
bun --cwd apps/app check:bundle-cache
```

The bundle cache check makes one temporary application-utility edit, performs two builds outside the normal output directory, compares vendor URLs/bytes/imports, and restores the source in a finally block. Run it serially, outside performance timing runs. Private benchmark artifacts live under `.playwright/bootstrap-cache/`; isolated browser profiles are removed after each mode. `PROFILE_TRACE=1` enables diagnostic compile traces, and `PROFILE_SERVE=1 PROFILE_PORT=62173` keeps the synthetic preview running for browser verification.

## Verification

- Production build, TypeScript, changed-file ESLint, aggregate/per-chunk bundle checks and whitespace checks passed.
- 36 focused unit tests passed, covering server gating/redaction, data-only serialization, bounds, payload validation and LiveStore seeding.
- The three new CSR browser tests passed in Chromium and WebKit (six passes): public and synthetic account-session bootstrap, no duplicate body request, client navigation/back, revision refresh, public restriction, and invalid-payload fallback.
- Built-reader markdown currency/math, image theater and smart-table coverage: 11 passed, two existing explicit skips. No baseline updates.
- The candidate vendor-cache stability check passed for all five vendor chunks. The identical probe on baseline failed for Effect/LiveStore URL churn, as expected. Temporary source/config edits were restored.
- The synthetic reader was visually inspected in a browser. The complete 48-load timing run had zero runtime errors.

The representative page is small. These measurements do not establish live-backend A/B results, physical-device performance, real account-session timings, or 200 ms readiness. The source patch leaves LiveStore startup in place for a separately measured next step.
