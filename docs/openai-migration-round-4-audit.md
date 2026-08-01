# Wiki-Vite Launch Audit — Round Four

This audit starts from the three migration reports:

- `openai-migration.md`: production parity, security, cache, and shell audit
- `openai-migration-round-2.md`: renderer/API differential and test-validity audit
- `openai-migration-round-3.md`: open-queue investigation and focused fixes

It then checks the product contracts under `apps/web/specs`, the platform
inventory in `docs/features.md`, the Vite architecture in
`apps/wiki-vite/README.md`, and both apps' E2E suites. The objective is not to
equate a high test count with launch readiness. A contract is covered only when
the test reaches the named behavior through the Vite surface.

## Themes across the three rounds

### 1. Parallel implementations drift at their seams

The most consequential divergences occurred where legacy and Vite implement the
same contract through different machinery: server HTML versus React markdown,
Next route handlers versus the standalone Bun handler, SSR metadata versus HTML
patching, and production-bundled versus dev-served workers. Shared types did not
prevent semantic drift in links, PDF chips, custom-element props, DICOM fields,
or codec startup.

**Audit rule:** compare outputs and response shapes at the boundary. Do not
infer parity from two independently green suites.

### 2. Setup success is not evidence that the named subject ran

Round two found tests whose password gate, seeding request, or anonymous
context failed before reaching the assertion they were named for. Round three
found the same class in live chat authentication and asynchronous browser
teardown. Conditional skips and environment-dependent tests need an explicit
second check: which contract did the executed path actually observe?

**Audit rule:** capture the first meaningful product assertion after auth,
fixture creation, and route loading. Treat early 401s, redirects, empty stores,
and setup-only assertions as coverage failures.

### 3. Temporal state is a first-class product boundary

Many failures appeared only after a transition: client navigation, password
rotation, stale manifest refresh, sidebar rerender, a second annotation tool,
page reload, repeated browser contexts, or a worker shutting down. Single-load
smokes systematically miss this class.

**Audit rule:** every stateful surface needs at least one transition test and
one reload/recovery test; persistent browser storage also needs an ordered or
long-lived-session test.

### 4. Authorization must cover discovery and sidecars, not only page bodies

The first round expanded access checks from documents to manifests, search,
files, archives, assets, metadata, tags, comments, and cache retirement. Later
rounds showed how easily a newly gated endpoint invalidates an older test.

**Audit rule:** verify deny-by-default at list, direct-fetch, transformed,
cached, copied, downloaded, and AI/tool boundaries.

### 5. Responsive and spatial behavior needs real input

Mobile sheets, timeline panning, comments rails, table overlays, and viewer
tools can look correct in a static screenshot while pointer capture, wheel
ownership, touch thresholds, focus, or rail geometry is broken.

**Audit rule:** pair geometry assertions with actual pointer, wheel, keyboard,
and focus interactions on desktop and mobile viewports.

### 6. Development, standalone, preview, and production are distinct runtimes

The DICOM codec failure existed only in the Vite development module graph;
metadata and robots behavior belongs to the standalone server; synthetic Host
tests cannot run on Vercel previews; live chat/admin behavior depends on Convex
and model credentials.

**Audit rule:** label every proof by runtime and keep at least one check for
each boundary whose implementation differs.

### 7. Documentation and fixtures age independently from implementation

Round two found DICOM fixtures two studies behind. Current feature specs still
describe legacy test ownership even when Vite is the launch target, and several
current-state documents mix legacy Next architecture with shared product
contracts.

**Audit rule:** every durable product contract should identify its Vite proof,
its legacy-only clauses, and any intentionally deferred behavior.

## Contract-to-test inventory

The repository currently has 40 Vite E2E spec files. Static inspection finds
308 `test` declarations before parameterized expansion and conditional skips.
The post-audit ordered run collected 294 outcomes: 264 passed, 29 were explicit
environment/runtime skips, and the only failure was the cold exhaustive text
search timeout described below. After reducing that search from three
sequential Convex corpus pages to one, two focused cold runs passed in 28.1 and
12.3 seconds. The raw count is less important than the gaps below.

| Contract area | Current Vite evidence | Audit status |
| --- | --- | --- |
| Shell, navigation, aliases, metadata | Navigation, route-correctness, metadata, page-chrome, page-load, visual, standalone server tests | Strong. The hard-skipped `header-shell` case is a legacy SSR contract; Vite's client-first shell is covered after hydration and standalone metadata is covered separately. This distinction should remain explicit. |
| Markdown, links, assets, diagrams | Shared unit tests plus heading, currency, image-theater, table, timeline-gantt, page-chrome, and sidebar/file E2E | Good but structurally vulnerable. There is no committed fixture table that renders the same corpus through both server and React pipelines and compares normalized semantics. Round two used differential analysis, but the durable tests are still split by implementation. |
| Password gate and session lifecycle | Unit/server API tests, auth-gate-security, session-recovery, backend-api | Strong. Includes rotation, forged cookies, redirect safety, scope separation, and private caching. |
| Sensitive content and PII | Server API tests, PII E2E, role E2E, tag access, cache retirement | Strong for page/search/tool/archive boundaries. Live comments against sensitive rooms remains dependent on the comments gap below. |
| Multi-site isolation | Server scoping tests and local synthetic-Host E2E | Strong locally. Preview skips Host-injection cases because Vercel owns the preview host; this is a runtime limitation, not silent coverage. |
| Search and local finder | Search E2E, backend API, command palette, multi-site/PII tests | Strong across empty/loading/results/keyboard/scope. Exhaustive text search remains a performance watch: a cold 271-document scan ranged from 12 to 45+ seconds during this audit even after its backend round trips were reduced. Live AI ranking remains opt-in and credential-dependent. |
| Chat | Chat UI, performance, navigation resilience, backend stream/tool tests | Good for Vite and live Convex/model paths. Live QA found and fixed the stale active conversation after archive, and corrected the live test so a 401 or echoed user text cannot masquerade as an assistant response. Several live tests legitimately skip without credentials; CI must surface the skip count. |
| Comments and review | 11 Vite tests versus the legacy suite's 48 named interaction tests | **Major gap.** Vite covers disabled/unavailable states, basic rail/navigation, empty global page, and API validation. It does not exercise successful page/selection comment creation, anchored highlights and thread deep links, edit/delete/copy menus, resolve/reaction/reply flows, guest identity persistence, or a populated global timeline through the Vite backend. Shared package reuse lowers component drift but does not prove Vite auth, routing, API, and layout integration. |
| Diagnostics timeline | Full timeline interaction test plus seven regression tests | Good. Manual QA is still needed for real pointer/wheel behavior, dense drill-in readability, and mobile marker-origin drags. |
| DICOM imaging and comparison | 33-test Vite viewer suite, comparison regression, server response-shape test, diagnostics unit tests | Strong. Desktop/mobile catalog loading and calibrated-ruler deep links now have explicit Vite coverage. The viewer and comparison entry points are isolated from the unused wiki LiveStore projection, closing the ordered OPFS reload corruption without changing measured layout. |
| Smart tables | 12 expansion tests, examples, performance test | Strong automated geometry coverage. The documented comments/outline-rail transition, real trackpad feel, multi-table sequence, and tablet fallback remain manual-only. |
| Downloads, files, copy, and sharing | Backend archive/file tests, menu-link assertions, page-copy, DICOM share, image download, PII and multi-site tests | Good at the API boundary. A real browser download from the actions menu is not asserted end to end. |
| Admin and RBAC UI | Controlled live admin access and bulk-user tests plus role E2E | Good for current launch paths after round three. |
| Medical deduction tool | Dedicated product contract plus three Vite E2E tests | Good. Formatted inputs, clamping, computed results, named sliders, keyboard grid selection, multi-year state, and mobile overflow are covered. |
| Epic FHIR lab integration | Four focused Vite server unit tests | API normalization and unauthenticated denial are covered; authorize/callback/sync happy paths require external Epic configuration and have no E2E rehearsal. This is an integration gap, not necessarily a reader-launch blocker. |
| LiveStore/offline/recovery | Manifest/cache/session/app-recovery E2E and extensive unit tests | Strong for ordinary cache transitions. The audit reproduced the ordered DICOM `database disk image is malformed` failure, then removed DICOM's unnecessary LiveStore dependency. The complete 33-test DICOM sequence and the later ordered matrix crossed annotation reloads without another corruption event. |
| Accessibility | Focus/modal assertions in palette and mobile navigation; accessible names throughout | Partial. The chat contract explicitly records no axe-core CI, and there is no cross-surface automated accessibility smoke. Manual keyboard/focus QA is required for launch. |

## Documentation gaps

1. The main product contract, `apps/web/specs/features.md`, is explicitly an
   `apps/web` implementation inventory. It mixes shared behavior with Next-only
   details such as RSC, PPR, filesystem search, and build workflows. It cannot
   serve as the Vite launch checklist without the mapping above.
2. `apps/web/specs/diagnostic-timeline.md` still names only legacy E2E owners.
   The DICOM contract now names the Vite owner and its loading/ruler proofs.
3. `apps/wiki-vite/README.md` says deeper comments and chat resilience are
   backlog, but chat resilience is active and substantial while comments is the
   true remaining integration gap. The statement is stale.
4. The medical deduction calculator gap was closed with
   `apps/web/specs/medical-deduction.md`; it should be added to any future
   generated feature index.
5. The launch runtime boundary is scattered across migration reports. The
   matrix must distinguish Vite dev, standalone Bun, Vercel preview, and live
   service proofs so a skipped runtime is visible.

## Testing gaps to close before launch

### P0

1. Add a successful Vite comments integration path when Liveblocks credentials
   are available, with explicit skips when they are not. At minimum: create a
   page comment, create/select an anchored comment, open its thread URL, and
   verify a populated global timeline entry.

### P1

2. Add a durable markdown differential contract that feeds the same fixture
   cases through both renderers and compares normalized links, asset proxying,
   PDF chips, headings, tables, redaction labels, and protocol links.
3. Add one cross-surface accessibility smoke covering landmarks, obvious
   accessible-name failures, dialogs, and keyboard focus restoration.
4. Set and monitor a launch latency budget for exhaustive text search. The
   round-trip reduction keeps current cold runs inside the existing E2E timeout,
   but the user-visible 12–30 second range is still too slow to call complete.

### P2 or explicitly deferred

5. Exercise a browser download initiated from the actions menu.
6. Add an Epic authorize/callback/sync rehearsal using a deterministic fake
   FHIR server if the integration is part of the Vite launch scope.
7. Automate the table/comments right-rail transition once the comments
   integration harness is reliable.

## Exploratory QA charter

The manual pass should intentionally target the transition seams that escaped
earlier rounds:

1. Cold load, warm navigation, reload, back/forward, mixed-case alias, and
   missing route.
2. Desktop, narrow mobile, tablet, and mobile landscape navigation/focus.
3. Command palette, actions menu, theme changes, copy, downloads, and account
   transitions.
4. Markdown links, PDF/image theater, Mermaid, headings, wide tables, and source
   provenance.
5. Search modes, keyboard selection, no-result/error states, and reader scope.
6. Comments available/unavailable states and every interaction credentials
   permit.
7. Diagnostics timeline wheel/pointer/dialog flows.
8. Imaging table, single DICOM viewer, comparison viewer, tools, ruler,
   annotations, share links, reload, and repeated viewer contexts.
9. Chat new/archive/reopen/stop/navigation/reload flows with live services.
10. Admin and sensitive-content denial/allow paths.

Findings from that pass should be appended below with exact route, viewport,
input sequence, console/network evidence, severity, and fix commit.

## Exploratory findings

| Severity | Route / runtime | Input and evidence | Disposition |
| --- | --- | --- | --- |
| P0 | `/tools/dicom-viewer`, ordered Vite E2E | Drawing an annotation and hard-reloading after the preceding diagnostics/viewer sequence reproduced `database disk image is malformed`; the recovery card replaced the viewer. | Fixed by mounting DICOM viewer/comparison outside the unused wiki LiveStore projection (`cdc2a604`). All 33 DICOM tests pass, including reload, ruler, mobile touch, and delayed-image cases; live reload makes zero `/api/wiki/*` requests and preserves the prior 256/320/581px rail geometry. |
| P1 | `/about/Index`, live Vite | The canonical route retained an infinite loader because route aliasing did not map to the root content slug. | Fixed and covered cold/warm (`563aa94d`). |
| P1 | `/wiki/missing/not-here`, live Vite after a successful article navigation | A warm validated manifest left the unknown route in `page-loading` indefinitely with no failed body request. | Fixed by materializing the missing state from the validated index; cold and warm not-found tests pass (`fa37eebd`). |
| P1 | `/chat`, live Convex/model | Sent `audit-pong-2026-08-01`, received the exact assistant reply, then archived the active conversation. The sidebar removed it but the URL and messages stayed stale. | Fixed by synchronizing history replacement with router state and resetting the active surface on archive (`994ecff3`). The live test now authenticates and asserts an assistant message rather than matching echoed user text. |
| P1 | standalone Bun server | The production smoke contradicted gated bot metadata policy, omitted deterministic gate credentials, and expected the retired `v1` cookie. | Verification contract repaired; build, API/gate checks, and four preview tests pass (`80e9b634`). |
| P1 performance | `/search?q=diagnosis`, live backend | Text search returned 271 matches across 111 files in roughly 14 seconds manually, varied to about 30 seconds for a no-result query, and once exceeded the 45-second ordered-test timeout. | Reduced sequential Convex corpus pages from three to one (`360f2039`). Focused cold runs passed in 28.1 and 12.3 seconds. Keep a launch latency budget open. |
| P2 accessibility | `/tools/medical-deduction`, 1440px and 390px | The calculator computed correctly, but sliders had no names and heatmap selection required a pointer. | Added slider names, Enter/Space grid selection, a product contract, and desktop/mobile functional E2E (`5eb976a9`). |
| Pass | `/tools/dicom-compare?comparison=mri-comparison-2026-04-01-vs-2026-06-26`, 1440px | Two canvases rendered at 124/246 and 112/254; exact-z matching, six pair presets, Pan/Zoom state, next matched slice, and pair switching worked without runtime errors. | Comparison parity confirmed. The local legacy Next dev route could not resolve the baseline series, which reinforces runtime-labeled proofs but is not a Vite launch defect. |
| Pass | `/tools/dicom-viewer?id=biopsy-2026-04-10&image=6`, 390x844 | Real canvas rendered, next slice updated the URL from image 6 to 7, mobile study controls worked, and document width remained exactly 390px. | Mobile viewer behavior confirmed; explicit catalog/ruler contracts added (`4fa26095`). |
| Pass | `/diagnostics?studySet=audit#marker`, 390x844 | Alias canonicalized to `/diagnostics`; real pointer drags moved the date window from Apr 2–Aug 1 to Mar 13–Jul 12, and the start handle resized it to Mar 29–Jul 12 with no horizontal overflow. | Timeline spatial interaction confirmed. |
| Pass | `/wiki/logistics/insurance.md`, 1440px, and `/table-examples`, 390px | Expanded tables stayed between the 256px sidebar and right rails; collapse, wheel ownership, theme persistence, article navigation, browser back, and mobile in-flow fallback worked. | Table queue behavior confirmed. Clipboard read was browser-permission-blocked, while the automated copy test passed. |
| Coverage gap | `/comments`, live Liveblocks | Five populated global threads loaded and old thread routes canonicalized. The document rail showed existing content and the signed-out prompt. | Read/navigation path confirmed. Successful create/anchor/reply/edit/delete/resolve flows remain the largest Vite integration gap because this audit did not mutate live comments without a deterministic cleanup harness. |
