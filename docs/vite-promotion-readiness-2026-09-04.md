# Vite promotion readiness — second QA review

Review date: 2026-09-04. Starting commit: `5d717320` on `oncobase/main`.
Reference: `https://diana-tnbc.com` (Next). Candidate: `https://wiki-vite-zeta.vercel.app` (Vite).
This review does **not** move the live domain or authorize a cutover.
Required browser gates are the complete Chromium suite and WebKit smoke coverage.
Firefox is optional and explicitly outside the promotion gate at the user's request.

## Findings and repairs

| Priority | Finding | Evidence and repair |
| --- | --- | --- |
| P1 | MRI comparison images collapse on tablets | Computer-use exploration at 820×1000 found two loaded stacks and advancing counters, but both canvases had **zero height**. Reproduced in both Next and Vite: a shared component defect. Reserved usable image rows, bounded the details panel, and made layout depend on available component width, including an expanded sidebar. The repaired panes measure 385.5×537px at the original failure size. Nine cold-load sizes now assert canvas dimensions, completed decoding, working slice controls, and no horizontal overflow. |
| P1 | Denied browser storage leaves the reader loading indefinitely | WebKit reproduced the hang against both development and the deployed candidate. A separate storage probe confirmed `getDirectory()` rejected; the worker never reached the existing React error path. Vite now chooses a temporary, tab-local reader cache when OPFS is denied, consumes the library's eager rejected probe, and preserves pending cache cleanup for later. Online reading/navigation/reload and public/session isolation are regression-tested. This fallback does not promise persistent offline storage. |
| P2 | Mobile heading links land under the fixed header | Direct links/reloads and outline navigation could place the heading at y≈0 behind a 48px header. Next placed it at y≈48. Vite's content scroller now declares its scroll padding and the shared anchor helper respects it. Computer-use verification measured the repaired heading at y=48.16. Tests now check the lower visibility bound, not just “less than 180px.” |
| P2 | Article title/tag spacing drifts from Next | Matched desktop screenshots and measurements showed Vite's tag row 24px too low, displacing the entire body. Tags now belong inside the document header, with matching spacing and chip dimensions. At 1440×1000 the repaired article height matches Next at 2014.65px; the tag row starts at y=80. Updated synthetic desktop/mobile baselines were inspected. |
| P2 | Comparison status labels lose contrast in light theme | The deployed follow-up found dark foreground styling overriding the explicitly pale status colors. Shared diagnostic UI now resolves conflicting Tailwind classes, matching the legacy utility's override behavior. Secondary comparison labels also have sufficient contrast. Added light/dark axe contrast checks and a class-override unit regression. |
| P2 | Old text-search responses overwrite a newer query | Delayed-response tests against the immutable candidate reproduced both old results and old errors replacing the current query. Vite now invalidates outstanding text-search updates on query changes/unmount and stops carrying the previous query's retry schedule forward. Four request-order cases cover initial and exhaustive responses, including failures, without extending timeouts. |
| P1 release gate | Green main did not mean green Vite | The Vite workflow ran only on PRs/manual dispatch, omitted shared paths, and resolved only Preview environments even for main. Main now runs Vite static/unit/server checks and resolves the exact SHA's Vite Production deployment. Shared packages, shared web source, API adapters, and Vercel configuration trigger PR checks. |
| P2 release gate | Screenshot assertions were disabled in CI; only Chromium ran | Added a macOS screenshot job that compares committed baselines without updating them, plus WebKit reader/accessibility/anchor/calculator/storage smoke coverage. Linux Chromium shards retain geometry checks. Firefox remains available for optional local runs. |
| P1 evidence custody | Rich test artifacts are unsafe to publish from this repository | The GitHub repository is public. Clinical screenshots, signed sessions, response bodies, and traces stay local. Hosted runs disable live screenshots/traces and publish only sanitized test names/outcomes. The dedicated synthetic visual job may upload its PNG diffs. |

The storage fallback has a measured ~6 KiB compressed cost (<0.6% of the eager
asset budget). The bundle ceiling records that compatibility tradeoff explicitly;
other bundle limits remain unchanged. No clinical content, database schema, or
authorization policy was changed.

## Verification ledger

Final local/hosted results are recorded in the release addendum below. Evidence
collected before the repair commit:

| Method | Scope | Result |
| --- | --- | --- |
| Computer-use exploration | Matched desktop/mobile readers; mobile navigation → outline → heading; search → result → reload; timeline drag/category expansion; imaging catalog → comparison → next slice | Found and reproduced the spacing, anchor, and tablet defects; directly verified repaired geometry. |
| Deployed candidate E2E | Live data, APIs, routes, chat, anchored comments, all published imaging stacks, viewer tools/downloads, calculator | **63 passed / 4 skipped**, 255.3s. Live chat and anchored comment create → reload → global listing → cleanup both actually ran. |
| New tests against old candidate | 820px comparison; 393px mobile anchor/reload | Both failed for the observed product defects before the fixes. |
| Repaired Chromium focused run | Nine comparison sizes, heading anchors, ten visual tests | **28 passed / 1 skipped**; updated only the two intended reader screenshots, then inspected them. |
| Firefox and WebKit focused runs | Reader/outline, anchors, accessibility, calculator, denied storage | Each **24 passed / 6 skipped** in the exploratory 30-case selection. Four skips were a local-Convex-only API RBAC suite (not browser isolation proof); the others were preview login and Chromium-only OS clipboard permission automation. |
| Additional WebKit isolation run | Denied storage read/navigation/reload; public/session separation; session cache-key rotation | **4 passed / 0 skipped**. This is the browser isolation evidence, distinct from the skipped API RBAC suite. |
| Static and unit verification | Lint, typechecks, bundle budgets, shared packages, server contracts, private-artifact summary regression | Static checks passed; **228 unit tests passed**. |
| Standalone production server | Production build, API checks, gate and reader smoke | Passed, including **4 browser smoke tests**. |
| Production-build Chromium | Denied storage, nine comparison sizes, anchors, synthetic visuals | **30 passed / 1 skipped**. |
| Production-build WebKit | Reader, anchors, accessibility, calculator, page chrome, denied storage | **25 passed / 2 skipped** (local preview-login and Chromium-only OS clipboard automation). |
| Production-build WebKit imaging | 393px, 820px, and 1440px published comparisons | **3 passed / 0 skipped**. |
| Explicit deployed live AI ranking | Opt-in configured API request | **1 passed / 0 skipped** against the starting candidate; must repeat on the repaired deployment. |
| Final full local Chromium run | Complete 317-case suite on fresh port 61865 | **302 passed / 15 skipped / 0 failed / 0 flaky**, 695.7s. |

The final full-run skips comprise nine production-server-only gate/metadata/
redirect checks, four documented Next-SSR/table-fixture exclusions, opt-in live
AI ranking, and unavailable local Liveblocks. An earlier full run had the same
302 passes but failed the comment test because the local Liveblocks key was
invalid. The clean rerun explicitly removed that unusable local integration;
the deployed live comment story is still mandatory, not waived.

The four skips in the initial deployed 67-case selection were synthetic Host
routing, opt-in live AI ranking, local-only metadata mutation, and the older
locally seeded comparison test. They were **not** all Liveblocks skips. The new
published-comparison layout suite is runnable against a deployed candidate.

## Coverage audit

| Risk / transition | Evidence to require | Coverage and limits |
| --- | --- | --- |
| Cold/warm/deep-link route parity | Gate → page, alias, hash, reload, not-found; document completeness | `route-correctness`, `navigation`, `page-load-experience`, and strengthened `markdown-heading-anchors`; route inventory also checks legal/PII/admin/chat special cases outside the catch-all. |
| Cache/session boundaries | Expired manifest, denied OPFS, session rotation, sign-out retirement, no sensitive discovery | `manifest-cache`, `cache-retirement`, `session-recovery`, `storage-availability`; server/API RBAC needs a credentialed local run. Temporary storage must never be reported as durable offline coverage. |
| Stateful reader UI | Table expand/collapse across rails, width/scroll persistence, focus restoration, mobile sheets | Shared smart-table suites, comments, page chrome, navigation, accessibility. Matched screenshots supplement these; screenshots alone cannot prove interactions. |
| Out-of-order search | An earlier result/error or exhaustive refresh must not replace the current query | `search-request-order` deliberately holds the older request until the newer query is visible, then releases it and verifies the newer results remain. `search` also covers API errors/non-JSON responses, scope cookies, keyboard selection, snippets and result navigation. |
| Diagnostic usability | Decode both stacks, useful canvas size, reachable controls, pointer/keyboard slice change, reload | Existing viewer suite plus nine-size `dicom-comparison-layout`; checks both viewport breakpoints and actual available width. |
| Live service stories | Actual assistant response; anchored comment persistence and cleanup | Credentialed deployed checks, not mocked UI or a configured-status response. Standard hosted shards can still skip services lacking runner credentials. These require an explicit release run, not an assumption from aggregate green status. |
| API/auth/cache/security | Anonymous denial; signed sessions; public/session data; files/archives/byte ranges; bot metadata; Host isolation | Server unit tests, standalone checks, backend/multi-site/RBAC suites. Synthetic Host checks belong locally; Vercel does not accept injected synthetic hosts. |
| Browser compatibility | Full Chromium plus WebKit, keyboard-focused dialog invocation, browser storage denial | Browser selection is configurable and smoke coverage runs in CI. Firefox is outside the requested gate. OS clipboard-read permission automation remains Chromium-only. WebKit is engine coverage, not physical iPhone certification. |
| Production assets and performance | Production bundle and standalone server, worker/WASM startup, cache headers, bounded network retries | Static bundle budgets and standalone verification. Dev success alone does not prove deployed worker/asset behavior. Live long-tail search/manifest latency remains an operational watch item. |

Historical Next-only SSR-header/streaming tests and two declarative table fixture
differences remain documented exclusions, not silently counted passes. React
Doctor 0.9.13's changed-source review against the starting commit reported zero
errors and six advisory warnings: three existing build-script iteration chains,
the existing large reader/comparison components, and an unchanged non-component
export used by page chrome. These are maintainability follow-ups, not observed
parity failures; no broad component rewrite was folded into this release. Its
warning-level exit is not represented as a passing gate.

## Promotion and rollback checklist

1. Identify the exact pushed SHA and its **Vite** deployment; verify all new Vite
   checks and the existing Next checks. A successful Next deployment is not
   evidence about the Vite candidate. GitHub currently reports no branch
   protection or applicable rulesets on main: these checks are observable gates,
   not an enforced restriction on pushing. Repository-policy changes are outside
   this repair; enforce required checks before relying on an automatic cutover.
2. Run the credentialed live-service release selection on that immutable Vite
   deployment, including chat, anchored comments, imaging, and live AI search.
   Account for every skip explicitly; confirm cleanup of test-owned records.
3. Before moving the domain, verify effective project configuration: Convex
   target, gate/session compatibility, Liveblocks webhook destination/secret,
   Epic OAuth callback and cron ownership, asset/download origins, and caching.
   Unit tests validate adapters but do not prove external webhook delivery or
   account-wide Vercel settings. Avoid two active sync schedulers at cutover.
4. Record the current Next deployment/domain mapping as the rollback target.
   Promote only the already-verified candidate, with explicit cutover approval.
   No database migration is part of these fixes.
5. After domain reassignment, test the **real live hostname** anonymously and in
   a fresh signed-in session: deep-link gate, role-sensitive denial, search,
   comment, chat, imaging, and download. Check existing-session behavior too.
   Monitor error rate, 401/403/5xx, worker boot, search latency, and webhook/sync
   failures. Roll back the mapping if a core journey or access boundary regresses.

## Evidence custody

Local screenshots, traces, JSON reports, and logs are in ignored
`.playwright/qa-round-2/` and `apps/wiki-vite/test-results/`. They can contain
protected content and must not be committed or uploaded to a public report.
Browser emulation can scale captured pixels; CSS viewport/element measurements
are retained alongside screenshots for geometry claims. Committed visual
baselines contain synthetic fixture content only.

The visual UI audit guided matched-view captures and measurements; the React
review checked hook ordering, stable adapter lifetime and teardown, cache
isolation, and unchanged server authority. Container sizing follows the
[Tailwind container-query documentation](https://tailwindcss.com/docs/responsive-design#container-queries).

## Release addendum

The first repair commit, `2435aff7`, reached its exact Vite Production candidate
and passed the credentialed release selection: **40 passed / 1 skipped**
(synthetic Host routing). Live AI ranking, chat/Stop/navigation/reload/archive,
anchored comments with cleanup, imaging, downloads, gate security, and production
metadata actually ran. Vercel reported READY with that exact SHA; its initial
deployment-scoped 5xx scan returned no rows. The existing Next checks and the
new Vite static/unit/server/macOS visual jobs passed.

The newly enabled full hosted gates correctly stayed red. Follow-up reproduced
and repaired test assumptions about inherited gate cookies, local-only public
Liveblocks keys, server-provided metadata, redirect/rail timing, and Linux font
wrapping. The follow-up unit suite passes **229 tests**. Raw Playwright process
output is now also kept off public logs because reporters can print failures
even when a JSON output file is configured. A dedicated anonymous/synthetic
browser-startup probe provides safe boot diagnostics. Linux WebKit's initial
25-case failure is not waived: the latest hosted run must resolve it before
promotion readiness is claimed. macOS WebKit passes against both the local
production build and the immutable deployed candidate.

The next immutable candidate, `d383c8b5`, passed all four deployed Chromium
shards and the macOS screenshot gate, plus **42 passed / 1 skipped** in the
credentialed release selection. Linux WebKit's startup probe isolated a second
OPFS failure: `navigator.storage` is absent altogether. The locked LiveStore
adapter returned a proxy whose `then` property was a rejected promise, rather
than a callable promise method. Awaiting it both emitted an unhandled rejection
and misclassified persistent storage as available. A missing `getDirectory`
method also threw during import. A version-pinned Bun patch now exposes a real,
observed promise while preserving its rejection for the reader's memory fallback.
Five fresh-process dependency tests cover absent navigator/storage/method,
denied access, and available storage. Six browser stories cover reading,
navigation, reload and scope isolation under all three unavailable-storage modes.
The new missing-object/method stories failed against the unpatched deployment
and passed against the repaired production build.

Firefox's desktop runner now explicitly declares a mouse-capable pointer: Linux
headless Firefox can otherwise omit the hover-only permalink affordance, as
documented in [Tailwind's own Playwright configuration](https://github.com/tailwindlabs/tailwindcss/blob/main/packages/tailwindcss/playwright.config.ts).
The permalink test asserts that capability before testing real link copying.
The eleven-route mobile-chrome loop is split into independently timed tests;
this removes a reproduced whole-test timeout without weakening route assertions.

The deployed Next and Vite gate cookies were checked in both directions using
anonymous, own-cookie and cross-project requests: anonymous file requests returned
401, while both valid-cookie variants reached the expected missing-path 400.
This proves gate-signature compatibility, not existing account-session continuity
or cookie/domain behavior after a domain cutover; those remain cutover checks.

The release verdict must use the hosted checks attached to the pushed commit,
plus the credentialed release selection on its immutable Vite deployment URL.
Local results alone do not establish that deployment identity. The private
evidence index retains the exact SHA, deployment URL, hosted run, and release
test counts once that verification completes.

The storage-patch commit `1aa8e375` passed Linux WebKit (39 smoke cases plus
2 startup probes), all Chromium shards after one failed-shard rerun, the visual/
static/unit/server gates, and **48 credentialed release cases** (one synthetic
Host skip). Firefox's rerun failed on a different route. Two deployment-scoped
upstream connection timeouts were observed; subsequent endpoint reads recovered,
but this does not establish the cause of every browser failure. Rather than
waive those results, the public report now retains failure timestamps, fixed
error categories, known test-source locations and allowlisted reader-state
presence flags. It still excludes page text, arbitrary errors, cookies and raw
annotations. The readiness verdict remains conditional on final hosted results;
the private release index preserves the initial failures and operational caveat.

On `84697b02`, all four Chromium shards, WebKit and the visual/static/unit/server
gates passed on the first attempt. The subsequent `9769c1c6` candidate passed
**52 credentialed release cases / 1 synthetic-Host skip**, including all nine live
AI/chat cases previously skipped by hosted shards, plus live comments, imaging,
downloads, gate checks, metadata and unavailable-storage isolation. Its hosted
Chromium search assertion failed intermittently; safe diagnostics now distinguish
loading/error/empty/results states without publishing search content. Historical
failures remain in the private evidence index and are not counted as passes.

The final breadth pass prioritizes functional transitions rather than extending
Firefox investigation. It repeats the full local suite for locally seeded account,
admin, role/tag-access and multi-site checks, and adds request-order regressions.
A stale local optimized dependency returned 504 after the dependency patch; that
cache was moved aside recoverably and a fresh-port full run restarted. This is
recorded separately from product defects. Exact final counts and immutable
deployment identity are retained in the private release index after hosted gates
and the credentialed release selection finish.

The refreshed 336-case local run completed with **320 passed / 15 documented
skips / 1 failed**. All locally seeded admin, role/tag-access and multi-site
checks ran. The sole failure was the live timing story receiving an AI Gateway
connection timeout instead of a model response; the app rendered its recoverable
error. This first-attempt failure remains recorded even if the focused live
rerun recovers. The four new search-order regressions run separately from that
already-collected suite; both initial-response cases and the exhaustive-results
case fail against the older deployed candidate and pass after the repair.
The unchanged live-chat timing selection then recovered: **4 passed / 0 skipped**.
WebKit's expanded search run also exposed a test-only cookie inspection issue.
The abbreviated `headers()` omits security-related headers ([Playwright docs](https://playwright.dev/docs/api/class-request#request-headers)).
For fulfilled WebKit interceptions, even `allHeaders()` omits Cookie. An isolated
local HTTP control confirmed that the real request sends the synthetic cookie,
while the fulfilled mock omits it from inspection. Scope assertions run in every
engine; outgoing-cookie inspection is explicitly additional Chromium coverage,
not claimed as WebKit mock evidence. No application cookie policy was changed.
The complete search and request-order selections are now included in WebKit CI.

The `8cd4c096` candidate passed **56 credentialed release cases / 1 synthetic-Host
skip**, expanded WebKit, screenshots, static/unit/server gates and three Chromium
shards. The remaining shard failed the manual table-resize overflow assertion.
The test now waits for a stable, actionable handle, asserts that the actual
mouse-down engaged manual sizing, and polls the original overflow threshold.
No application code, timeout ceiling, or assertion threshold changed in this
follow-up. The initial hosted failure remains in the private release evidence.
