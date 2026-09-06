# Reader performance and parity pass — September 6, 2026

## Scope and comparison

Baseline: `f9cac026` (the deployed, Next-retired `apps/app` application). Candidate: optimization checkpoint `6b6cdba6` plus the follow-up changes in this report's commit. This comparison does not mix Next retirement or application-directory changes into the optimization diff.

The changes remove startup dependencies and duplicate work: an immediate accessible HTML loading shell; parallel reader-module/session loading and independent current-document/manifest fetching; indexed canonical-route lookups reused for metadata; shared authentication state; shared tree/search projections; memoized markdown; deferred chat navigation and snapshot persistence; and windowed rendering for large file trees. The redundant lazy boundary around the primary document renderer is deleted; the entire reader still stays behind the lazy login boundary. No authorization rule, backend schema, secret, or deployment-retirement policy is changed.

Review also corrected out-of-order authentication refreshes, duplicate document/shortcut keys in the flattened tree, cached first-frame controls that looked enabled before their handlers existed, and Safari search-trigger focus restoration. Snapshot text stays readable while its controls are explicitly disabled/busy and removed from keyboard tab order. Full-suite QA caught a parallel-fetch race: successful manifest readiness could erase an earlier body failure and leave an infinite loader. A separate current-body error field now preserves the retry UI regardless of manifest response order; the regression deliberately delays manifest success until after body failure.

## Measurement method

`scripts/profile-reader.ts` runs both production builds locally against the same backend configuration, serially without competing builds or test runners. Chromium uses 4× CPU throttling, unthrottled networking, desktop 1440×1000 and mobile-sized 390×844 viewports. Each cell has three fresh browser contexts; values below are medians, not statistical guarantees or physical-phone measurements.

Each context measures empty browser/storage caches, a same-page reload, and a different uncached document with warm code/manifest. First contentful paint (FCP), actual article DOM readiness, navigation readiness and login-input readiness are separate milestones. A fast skeleton is not a claim that the document or login form is already interactive.

- Controlled fixtures: 6,000 synthetic pages, 200 ms session delay, 400 ms manifest delay and 350 ms current-body delay. Public and synthetic signed-in identities are covered. Playwright routing disables HTTP cache, so fixture reloads demonstrate persisted application-cache behavior, not browser asset-cache performance.
- Real backend: anonymous login and password-unlocked public reader, without API mocks. Browser HTTP cache operates normally. The supplied site password is not a separate signed-in account session, so real account-authenticated performance is not established.
- Local gate credentials are process-local test configuration; real document/manifest requests still exercise the existing backend. No backend documents, accounts or comments are written by these profiles. Browser contexts close after every case.
- Live traces retain screenshot filmstrips but omit DOM/network snapshots to avoid recording session headers. Screenshots and traces remain private in ignored `.playwright/performance-matrix/` directories. Authentication values and document text are not printed in timing output.

An initial synthetic fixture recomputed its entire page inventory once per page when resolving descriptions. That quadratic harness bug was fixed before both final comparison runs. Earlier non-`final` measurements must not be used as application speedup evidence.

## Controlled results

Times are milliseconds, baseline → candidate. Article readiness excludes the read-only first-frame snapshot.

| Viewport / identity | Cold FCP | Cold article | Warm FCP | Warm article | Uncached body, warm code/manifest |
| --- | ---: | ---: | ---: | ---: | ---: |
| Desktop / public | 1,480 → 232 | 2,919 → 1,924 | 264 → 224 | 1,131 → 857 | 945 → 924 |
| Desktop / synthetic signed-in | 1,488 → 236 | 2,914 → 1,919 | 1,340 → 228 | 1,620 → 1,352 | 1,701 → 1,402 |
| Mobile / public | 1,420 → 236 | 2,861 → 1,885 | 256 → 224 | 1,138 → 850 | 923 → 882 |
| Mobile / synthetic signed-in | 1,408 → 232 | 2,844 → 1,846 | 1,336 → 224 | 1,615 → 1,339 | 1,438 → 1,387 |

Login FCP improves from 532 → 144 ms desktop and 520 → 144 ms mobile, while actual login-input readiness is essentially unchanged (503 → 494 ms and 486 → 495 ms). Controlled cold navigation readiness is also essentially unchanged (~2.6 seconds); the requested document now becomes readable without waiting for the full navigation inventory.

Expanding a 500-row folder takes 96 → 20 ms desktop/public and 93 → 19 ms mobile/public (click through two animation frames). Rendered navigation elements fall from 3,675 → 266 and 3,683 → 210 respectively. Closed mobile-tree descendants fall from 93 → 0. Synthetic signed-in results are similar. This measures rendering work, not network speed.

Private evidence: `baseline-fixture-final/` and `candidate-reader-fixture-final/`, each containing `results.json`, per-case traces, and first-body/cold/warm/uncached-route/tree screenshots. All 36 final controlled cases completed without page errors. The earlier `candidate-fixture-final/` predates deletion of the nested document lazy boundary and is not the final candidate.

## Real-backend results and verification

| Viewport / password-unlocked reader | Cold FCP | Cold article | Warm FCP | Warm article | Uncached body, warm code/manifest |
| --- | ---: | ---: | ---: | ---: | ---: |
| Desktop | 1,248 → 244 | 6,230 → 1,752 | 252 → 244 | 1,297 → 1,180 | 1,800 → 2,023 |
| Mobile | 1,160 → 240 | 5,925 → 1,678 | 244 → 244 | 1,307 → 1,120 | 1,814 → 1,794 |

The biggest real-backend gain is uncached first-document reading without waiting for the site's full manifest. Navigation readiness remains around 5.7–6.0 seconds; the warm-code/different-document cell is mixed, not an across-the-board win. Server/backend variation is visible: baseline desktop cold article samples were 9,467/6,230/5,951 ms versus candidate 1,850/1,752/1,742 ms. The baseline's minute-expiring canonical-slug scan also produces occasional slow responses; the ordinary correctly cased route now uses an indexed lookup, while true misses retain canonical resolution.

Real-backend artifacts: `baseline-live-final/` and `candidate-reader-live-final/`. All 24 cases completed with zero page errors. Earlier `candidate-live-final/` and preload/eager probes are diagnostic evidence, not the final candidate comparison. Real-backend testing caught a warm-load regression (~1.67 seconds) that the initial fixture comparison missed. Preloading did not fix it; deleting the redundant primary-document lazy boundary did. Final candidate measurements above were rerun after that deletion.

Twelve paired screenshots (desktop/mobile × login/public/synthetic signed-in × cold/warm, run 1) had zero differing pixels at pixelmatch threshold 0.1, with no baseline updates. Desktop and mobile reader pairs were also visually inspected. Loading feedback is intentionally different before readiness; final content and layout remain matched.

Static verification passed: shared-package builds/typechecks, repository lint (warnings, no errors), app production build and bundle budget. The final eager reader graph is 1,183.5 KiB gzip, below the unchanged 1,204.6 KiB aggregate ceiling. The obsolete standalone `WikiPage` chunk expectation is removed because it is now in the lazy reader's static import graph; the measured 15.6 KiB shell has a 16 KiB per-chunk ceiling. The aggregate graph-based gate still includes the document code.

All 212 unit tests pass (1,080 assertions), including indexed-lookup reuse/canonical fallback, LiveStore query-projection isolation, alias ancestor preservation, and unique flattened occurrence keys. The 11 dedicated browser performance-contract tests pass.

- Complete Chromium suite: **327 passed, 35 explicitly skipped, zero failures** (362 cases). Private report: `chromium-verified-report/index.html`; per-test traces: `chromium-verified/`. The skips include credential-dependent and local-only scenarios; they are not represented as verified account/chat writes.
- Extended WebKit suite: **145 passed, two explicitly skipped, zero failures** (147 cases), covering reader startup, public/session navigation, large-tree keyboard reachability, cache durability/retirement, denied storage, search/palette, accessibility, responsive geometry, and smart-table expansion/resizing. Private report: `webkit-release-report/index.html`; traces: `webkit-release/`.
- Real-backend browser exploration: password login, home rendering, local file search, document navigation and folder expansion succeeded without browser errors. Screenshots remain private. The 24 real-backend timing cases are additional to the test suites.

The successful complete runs supersede the earlier diagnostic runs with failures; no retries or baseline updates were used to turn those failures green. The application fixes and corrected lifecycle/capability assertions were verified in fresh runs. Final browser test code includes the deferred-snapshot completion assertion; it passed the full WebKit run and an additional ten-case durable-cache pass.

### Browser harness corrections

The expanded WebKit run initially failed durable-cache assumptions that were not exercised by the existing WebKit CI smoke selection. The same retirement test failed against main. In this local Playwright WebKit build, ephemeral contexts deny OPFS and separate persistent profile directories still expose prior OPFS state for the same origin. Durable-cache and worker tests therefore use a fresh persistent profile **and** a unique loopback origin per test. A local TCP relay preserves the app's actual requests without mocking storage; teardown closes workers, removes only that unique origin's reader namespaces, closes the relay, and deletes the temporary profile. These tests require a loopback server in WebKit. Chromium continues using the ordinary fixture unchanged. Denied/missing-storage tests continue using temporary contexts and exercise the recovery adapter separately.

Retirement instrumentation pins the StorageManager object and seeds its fake legacy directories once. Tests verify both removal of the matching namespace and survival of an unrelated namespace. The first-frame test awaits deferred persistence after live-reader handoff rather than assuming storage retirement is synchronous with rendering.

WebKit's interception API rejects synthetic 304 responses. Its fixture revalidation returns the current 200 representation instead; Chromium and server tests retain actual 304 coverage. WebKit runs the visual geometry assertions with `--ignore-snapshots` because the checked-in pixel baselines are Chromium-specific. Chromium performs the unchanged golden-image comparisons; WebKit retains screenshots and traces for inspection. No browser-specific pixel baselines were invented or updated.

## Remaining limits

### Specialist-route cross-check

After removing the nested document lazy boundary, three serial fresh-context desktop/public runs per route checked that specialist routes did not inherit a material startup regression. The same 6,000-page fixture and 4× CPU setting were used for both builds. Readiness means the route's search input, smart-table toggle, or timeline scroll region exists, not that every downstream operation has completed.

| Route | Cold route readiness | Warm route readiness | Cold FCP |
| --- | ---: | ---: | ---: |
| Search | 1,735 → 1,586 | 1,153 → 1,118 | 1,528 → 244 |
| Table examples | 2,894 → 1,804 | 1,565 → 1,198 | 1,640 → 236 |
| Diagnostics | 1,725 → 1,674 | 1,158 → 1,194 | 1,460 → 244 |

All 18 cases completed without browser errors. Diagnostics warm readiness was 37 ms slower in these small samples; this is not evidence of an across-the-board speedup. Private evidence: `{baseline,candidate}-{search,tables,diagnostics}-final/`. No speculative specialist-route changes were added after this check.

### Unverified environments

Signed-in fixture hydration still takes about 1.35 seconds at 4× CPU throttling. Login-input readiness and complete-manifest navigation readiness are not claimed to improve. The existing conservative LiveStore recovery path remains enabled; it was not traded away for a faster but less reliable boot.

These local production-build results do not establish CDN cache-hit behavior, production serverless cold-start percentiles, poor-network performance, physical mobile performance, or real signed-in-account timings. Firefox is intentionally out of scope. A production release needs verification of the exact pushed SHA, deployment, aliases and hosted checks, not just a successful local build.

## Reproduce

Build main and candidate with the same authorized backend configuration and run each standalone server on a separate loopback port. Supply the authorized gate password through the environment, not a checked-in credential or trace:

```sh
bun apps/app/scripts/profile-reader.ts --url http://127.0.0.1:62141 --phase candidate-reader-fixture-final --source fixture --device all --runs 3 --cpu 4
bun apps/app/scripts/profile-reader.ts --url http://127.0.0.1:62141 --phase candidate-reader-live-final --source live --device all --runs 3 --cpu 4
```

Set `WIKI_PERF_PASSWORD` outside the command output. Never upload the private artifact directories to public CI or commit storage state. Compare identical harness revisions and distinguish synthetic identity fixtures from authorized real account sessions.
