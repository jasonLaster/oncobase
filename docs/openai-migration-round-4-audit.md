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

The repository currently has 42 Vite E2E spec files. Static inspection finds
315 `test` declarations before parameterized expansion and conditional skips.
The final credentialed post-fix run collected 299 outcomes: 285 passed, 14 were
explicit environment/runtime skips, and none failed. Earlier audit runs found
an exhaustive text-search budget failure, a malformed admin modal DOM, a stale
palette contrast assertion, and repeatable malformed OPFS snapshots. Those
findings are included below rather than hidden by the final green count. The
raw count is less important than whether the named live and transition paths
actually ran.

| Contract area | Current Vite evidence | Audit status |
| --- | --- | --- |
| Shell, navigation, aliases, metadata | Navigation, route-correctness, metadata, page-chrome, page-load, visual, standalone server tests | Strong. The hard-skipped `header-shell` case is a legacy SSR contract; Vite's client-first shell is covered after hydration and standalone metadata is covered separately. This distinction should remain explicit. |
| Markdown, links, assets, diagrams | Shared unit tests, a cross-renderer semantic fixture matrix, plus heading, currency, image-theater, table, timeline-gantt, page-chrome, and sidebar/file E2E | Strong. The durable differential contract now compares headings, wikilinks, assets, PDF chips, smart tables, explicit redaction labels, and safe protocol handling through both renderers. |
| Password gate and session lifecycle | Unit/server API tests, auth-gate-security, session-recovery, backend-api | Strong. Includes rotation, forged cookies, redirect safety, scope separation, and private caching. |
| Sensitive content and PII | Server API tests, PII E2E, role E2E, tag access, cache retirement | Strong for page/search/tool/archive boundaries. Live comments against sensitive rooms remains dependent on the comments gap below. |
| Multi-site isolation | Server scoping tests and local synthetic-Host E2E | Strong locally. Preview skips Host-injection cases because Vercel owns the preview host; this is a runtime limitation, not silent coverage. |
| Search and local finder | Search E2E, backend API, command palette, multi-site/PII tests, server timing headers, and browser observability | Strong across empty/loading/results/keyboard/scope. Public search coalesces duplicate work and waits 15 seconds for exhaustive line matches; if the corpus is still cold it returns redacted indexed candidates within the 30-second budget, labels the response, keeps those results visible, and retries in the background. Session-sensitive corpora are never shared. Live AI ranking remains opt-in and credential-dependent. |
| Chat | Chat UI, performance, navigation resilience, backend stream/tool tests | Good for Vite and live Convex/model paths. Live QA found and fixed the stale active conversation after archive, and corrected the live test so a 401 or echoed user text cannot masquerade as an assistant response. Several live tests legitimately skip without credentials; CI must surface the skip count. |
| Comments and review | Fifteen Vite rail/navigation/API tests plus a credentialed Liveblocks action-level integration story | Strong. The live story creates an account, anchors a selection comment, waits for server persistence, verifies copy/edit/reaction/document reply/resolve/re-open, reloads the exact thread URL, replies from the populated global timeline, rehydrates both replies on the document, then deletes the Liveblocks thread and temporary Convex user with absence checks. |
| Diagnostics timeline | Full timeline interaction test plus seven regression tests | Good. Manual QA is still needed for real pointer/wheel behavior, dense drill-in readability, and mobile marker-origin drags. |
| DICOM imaging and comparison | 33-test Vite viewer suite, comparison regression, server response-shape test, diagnostics unit tests | Strong. Desktop/mobile catalog loading and calibrated-ruler deep links now have explicit Vite coverage. The viewer and comparison entry points no longer boot the unused wiki projection. The wider persisted-store snapshot race was fixed independently, preserving the normal wiki sidebar on diagnostics pages. |
| Smart tables | 12 expansion tests, examples, performance test | Strong automated geometry coverage. The documented comments/outline-rail transition, real trackpad feel, multi-table sequence, and tablet fallback remain manual-only. |
| Downloads, files, copy, and sharing | Backend archive/file tests, real actions-menu browser download, page-copy, DICOM share, image download, PII and multi-site tests | Strong. Playwright waits for the browser download and verifies the saved ZIP; manual QA independently produced a valid 43,259,157-byte Markdown archive with 6,417 entries. |
| Admin and RBAC UI | Controlled live admin access and bulk-user tests plus role E2E | Strong for current launch paths. Exploratory output found and fixed the role editor modal being rendered inside `<tbody>`; the regression test now fails on those React DOM errors. |
| Medical deduction tool | Dedicated product contract plus three Vite E2E tests | Good. Formatted inputs, clamping, computed results, named sliders, keyboard grid selection, multi-year state, and mobile overflow are covered. |
| Epic FHIR lab integration | Four focused Vite server unit tests | API normalization and unauthenticated denial are covered. Authorize/callback/sync happy paths are explicitly excluded from this P1 launch goal at the user's direction and remain deferred. |
| LiveStore/offline/recovery | Manifest/cache/session/app-recovery E2E and extensive unit tests | Strong after a launch-blocking durability correction. Two of three earlier full runs reproduced `database disk image is malformed`, including on the normal diagnostics page after returning from DICOM. DICOM no longer boots an unused wiki store, and the persisted adapter now asks its leader worker for a recreated snapshot instead of importing an optimistic client-side OPFS image. The exact failing transition passed 10 consecutive repeats, all 33 DICOM tests passed, and the final 299-outcome ordered matrix completed without corruption. |
| Accessibility | Axe smoke plus focus/modal assertions and accessible names | Strong launch smoke. Axe scans cover the reader, command palette, text search, comments, diagnostics, and calculator. The audit fixed low-contrast palette paths and keyboard-inaccessible diagnostic timeline regions; focus restoration is asserted. This is not a substitute for a full WCAG audit. |

## Documentation gaps

1. The main product contract, `apps/web/specs/features.md`, is explicitly an
   `apps/web` implementation inventory. It mixes shared behavior with Next-only
   details such as RSC, PPR, filesystem search, and build workflows. It cannot
   serve as the Vite launch checklist without the mapping above.
2. `apps/web/specs/diagnostic-timeline.md` still names only legacy E2E owners.
   The DICOM contract now names the Vite owner and its loading/ruler proofs.
3. `apps/wiki-vite/README.md` now records the live comment integration boundary
   and the indexed-to-exhaustive cold-search behavior. The broader
   `apps/web/specs/features.md` inventory still needs future per-feature Vite
   ownership rather than relying on migration reports.
4. The medical deduction calculator gap was closed with
   `apps/web/specs/medical-deduction.md`; it should be added to any future
   generated feature index.
5. The launch runtime boundary is scattered across migration reports. The
   matrix must distinguish Vite dev, standalone Bun, Vercel preview, and live
   service proofs so a skipped runtime is visible.
6. The comments contract still described a page-level composer that neither
   current reader exposes. It now records selection-only creation, signed-out
   write restrictions, anchored-only timelines, and the Vite proof owners.

## Launch gap disposition

### Closed in this P1 round

1. Successful Liveblocks create, anchored selection, copy/edit/reaction/reply,
   resolve/re-open, thread URL reload, signed-in global reply, and deterministic
   remote/local cleanup.
2. Shared server/React Markdown semantic differential coverage.
3. Cross-surface axe and keyboard/focus smoke.
4. Enforced 30-second public text-search budget with completeness headers,
   browser observability, coalesced corpus work, and an indexed cold fallback
   that upgrades to exhaustive line matches in the background.
5. A real browser download initiated from the actions menu and validated as a
   readable ZIP.

### P2 or explicitly deferred

1. Epic authorize/callback/sync rehearsal is intentionally excluded from this
   launch goal. Re-open it only if Epic is declared part of the reader launch.
2. Automate the table/comments right-rail transition and the two declarative
   smart-table cases that remain explicitly skipped with written runtime
   reasons.
3. Investigate remote manifest latency. Several final-run requests exercised
   the designed 20-second bounded fallback and recovered successfully, but the
   warning is a useful post-P1 performance signal.

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
| P0 | `/tools/dicom-viewer` and `/diagnostics/imaging`, ordered Vite E2E | Drawing an annotation and hard-reloading first reproduced `database disk image is malformed`. A later full run proved DICOM isolation alone was insufficient: returning from the viewer to the normal diagnostics sidebar imported another malformed persisted snapshot. | Fixed in two layers. DICOM viewer/comparison no longer boot the unused wiki projection (`cdc2a604`), and LiveStore now requests a leader-recreated snapshot instead of racing an optimistic client-side OPFS read (`ed12add7`). The exact failing transition passed 10 consecutive repeats, all 33 DICOM tests passed, and the final 294-test matrix was green. Live viewer reload still makes zero `/api/wiki/*` requests and preserves the prior 256/320/581px rail geometry. |
| P1 | `/about/Index`, live Vite | The canonical route retained an infinite loader because route aliasing did not map to the root content slug. | Fixed and covered cold/warm (`563aa94d`). |
| P1 | `/wiki/missing/not-here`, live Vite after a successful article navigation | A warm validated manifest left the unknown route in `page-loading` indefinitely with no failed body request. | Fixed by materializing the missing state from the validated index; cold and warm not-found tests pass (`fa37eebd`). |
| P1 | `/chat`, live Convex/model | Sent `audit-pong-2026-08-01`, received the exact assistant reply, then archived the active conversation. The sidebar removed it but the URL and messages stayed stale. | Fixed by synchronizing history replacement with router state and resetting the active surface on archive (`994ecff3`). The live test now authenticates and asserts an assistant message rather than matching echoed user text. |
| P1 | standalone Bun server | The production smoke contradicted gated bot metadata policy, omitted deterministic gate credentials, and expected the retired `v1` cookie. | Verification contract repaired; build, API/gate checks, and four preview tests pass (`80e9b634`). |
| P1 performance | `/search?q=diagnosis&tab=text`, live backend and browser | The first manual cold pass issued two Strict Mode requests and completed in 38.7 seconds. Coalescing brought a fresh-browser run to 15.34 seconds, but a later ordered API run still measured 33,034 ms against the 30-second budget. | Fixed in layers: corpus work is shared (`cee3537f`), then a 15-second public wait returns labeled, redacted indexed candidates while exhaustive line matches keep warming (`3ce374bf`). A forced real-backend fallback passed in 602 ms; the final full run passed the normal cold gate in 9.6 seconds. The UI announces and background-refreshes incomplete results. |
| P1 | `/admin/roles`, credentialed Vite E2E | Opening Edit rendered `RoleDialog` as a sibling of `<tr>` inside `<tbody>`, producing React invalid-DOM and hydration errors even though the save flow passed. | `RoleDialog` now portals to `document.body`, and the live admin test fails on either invalid-`tbody` console error (`5fcf65df`). |
| P1 | anchored comment thread URL, live Liveblocks | A newly created thread persisted and its direct endpoint resolved, but the room thread list could lag after reload, leaving the exact linked thread temporarily absent. | The comments package fetches a missing linked thread directly and merges it until the room index catches up. The credentialed create/reload/global-timeline/cleanup story passed in the final run (`61d79fa4`). |
| P1 | document comments rail, Vercel preview with live Liveblocks | Action-level QA found Liveblocks dropdowns and the emoji picker at `z-index: auto`, below the fixed rail, and showed that optimistic mutations can race a just-created thread. | Vite now carries the legacy `.lb-portal { z-index: 50 !important; }` contract (`62e3077e`). The live gate waits for server-observed creation and verifies copy plus persisted edit/reaction/replies/resolve/deep-link/global/delete behavior rather than trusting the optimistic DOM (`e65c61d6`). |
| P2 accessibility | command palette and diagnostics timeline | Axe found the selected file path below contrast threshold and horizontally scrollable diagnostic regions unavailable to keyboard users. | Palette paths use readable foreground/opacity and timeline regions have names and keyboard focus. Both cross-surface axe tests and the updated theme contract pass (`0d2bb7af`, `aac38c5c`). |
| P2 accessibility | `/tools/medical-deduction`, 1440px and 390px | The calculator computed correctly, but sliders had no names and heatmap selection required a pointer. | Added slider names, Enter/Space grid selection, a product contract, and desktop/mobile functional E2E (`5eb976a9`). |
| Pass | `/tools/dicom-compare?comparison=mri-comparison-2026-06-26-vs-2026-07-17`, live Vite at 1280px | Both real MRI canvases rendered at 128/254 and 177/260. Z-matched preset selection worked; Next matched slice advanced both counters to 129/254 and 178/260 with no browser errors. | Comparison viewer parity confirmed manually and by the dynamic-metadata E2E. |
| Pass | `/tools/dicom-viewer?id=biopsy-2026-04-10&image=6`, 390x844 | Real canvas rendered, next slice updated the URL from image 6 to 7, mobile study controls worked, and document width remained exactly 390px. | Mobile viewer behavior confirmed; explicit catalog/ruler contracts added (`4fa26095`). |
| Pass | `/diagnostics?studySet=audit#marker`, 390x844 | Alias canonicalized to `/diagnostics`; real pointer drags moved the date window from Apr 2–Aug 1 to Mar 13–Jul 12, and the start handle resized it to Mar 29–Jul 12 with no horizontal overflow. | Timeline spatial interaction confirmed. |
| Pass | `/`, 1280px, plus the full smart-table matrix | The real index table expanded into the available content lane without navigation or rail overlap. The complete suite covered collapse, wheel ownership, theme/style persistence, responsive fallback, column resize, overflow, and cleanup. | Table expansion launch queue confirmed. Two declarative fixture cases remain explicitly skipped with documented implementation differences. |
| Pass | Workspace menu → Download wiki (markdown), live browser | Manual automation saved a 43,259,157-byte archive containing 6,417 entries; `unzip -t` reported no errors. The final Playwright browser-download contract also passed. | Browser download gap closed (`61c1d37e`). The manual temporary artifact was moved to Trash and is recoverable there. |
| Watch | `/api/wiki/manifest`, live backend under full-suite load | Several requests reached the designed 20-second full-manifest timeout, logged the bounded-fallback warning, returned a valid scoped response, and allowed their tests to pass. | Not a P1 correctness failure because the provisional/fallback and retry paths worked. Keep as a post-P1 latency investigation rather than suppressing the warning. |

## Final verification snapshot

- `verify:wiki-vite:static`: lint, package/app typechecks, production Vite
  build, standalone function build, and bundle budget passed.
- `verify:wiki-vite:unit`: 220 focused unit tests passed across smart table,
  diagnostics, wiki content, markdown, shell, and Vite packages.
- `verify:wiki-vite:server`: build, gate/API verification, and four preview
  browser tests passed.
- Full credentialed Vite E2E: 285 passed, 14 explicitly skipped for unavailable
  or runtime-specific prerequisites, zero failed across 299 outcomes.
- Live comments: account signup, anchored create, server persistence,
  copy/edit/reaction/document reply/resolve/re-open, direct thread URL reload,
  signed-in global reply, exact Liveblocks deletion, and Convex-user cleanup all
  passed without leaving the test thread or user behind.
- Browser download: the actions-menu Playwright contract passed; independent
  manual verification produced a valid 43,259,157-byte, 6,417-entry ZIP.
- Search: normal final-suite cold search passed in 9.6 seconds; a forced
  real-backend indexed fallback passed in 602 ms and the background exhaustive
  upgrade is covered in browser E2E.
- DICOM durability: the 33-test serial file passed; the previously failing
  imaging/sidebar/viewer/back sequence also passed 10 consecutive repeats, and
  manual June–July comparison QA rendered/advanced both paired stacks.

No known P1 from this audit remains open. Epic FHIR authorize/callback/sync is
explicitly outside the goal. The remaining queue is deeper comments/table
coverage plus the non-blocking manifest-latency watch, not a known broken
green-path launch regression.
