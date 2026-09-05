# Vite first-principles review

Release status is superseded by [the shared Playwright QA review](shared-playwright-parity.md).
The later paired run was stopped after an annotation mock escaped to production;
the synthetic test annotation was removed and verified. Earlier Vite-only green
counts below are historical evidence, not current promotion approval.

QA base commit: `fb051b25` (then `oncobase/main`). This review preserves the existing
wiki product: its content, access rules, URLs, stateful tools and familiar UI.
Vite should make the client simpler to operate and navigation fast; it should
not require a wiki database just to show sign-in or public legal information.

## What was removed or simplified

| Finding | Evidence | Change |
| --- | --- | --- |
| Standalone pages were coupled to reader startup | Login and terms both failed when a saved reader session could not be resolved. They do not consume the reader projection. | One browser router now selects standalone versus reader roots for cold loads, client navigation and history. Removed duplicate imaging routes, nested router ownership and unreachable sidebar/mobile-navigation branches. Reader-session bootstrap remains lazy in its own module. |
| Recovery assumed it owned every database on the origin | The old reset test explicitly expected deletion of unrelated OPFS directories and IndexedDB databases. LiveStore's persisted reader uses named OPFS directories, not those unrelated databases. | Deleted the blanket IndexedDB wipe and restricted OPFS deletion to the reader's versioned directory namespace. The regression now proves unrelated storage is preserved. |
| Terms depended on Next-only prose styling | Matched screenshots showed 16px plain headings and compressed paragraphs in Vite, versus Next's 30px/24px heading hierarchy. Desktop/mobile typography tests failed before the repair. | Replaced the obsolete class with the existing shared `wiki-markdown` class. No new CSS or legal-copy changes. |
| A duplicate accessibility utility defeated responsive labels | Tablet tool labels remained absolutely positioned and clipped despite `sm:not-sr-only`. The 820px regression failed against the old production build. | Deleted the unlayered hand-written `.sr-only` definition. Tailwind now owns both hiding and responsive restoration; all nine imaging sizes assert the intended label state. |
| Anonymous trailing-slash URLs hit the gate before normalization | `/terms-and-conditions/` incorrectly redirected to sign-in, while Next first returns a permanent redirect to public terms. The new anonymous GET/HEAD regression failed with 302 instead of 308. | Moved the existing slash normalization ahead of the shell gate. No additional redirect mechanism. The canonical protected URL still requires sign-in, with query parameters and private cache headers preserved. |

No dependencies, schema changes, backend routes, new automation systems, visual
baselines, or higher bundle ceilings were added. The moved session bootstrap is
explicitly included in the eager-reader budget so moving bytes between chunks
cannot disguise an initial-load regression. The entry remains about 17.2 KiB
gzip, and the reader's full eager graph is about 1201.8 KiB, within existing caps.

## What was deliberately kept

- **LiveStore and the cache projection:** a read-only wiki does not inherently
  require an event-log/SQLite stack. This is the largest remaining architectural
  weight. It is nevertheless active, not dead code: cache-first navigation,
  reload restoration, manifest replacement, content invalidation and scope
  isolation have concrete coverage. A smaller replacement needs measured cold,
  warm, offline and privacy comparisons; it is not a safe deletion-only cleanup.
- **Public first-frame snapshots, bounded boot recovery, and denied-OPFS fallback:**
  these preserve demonstrated startup/recovery behavior. The snapshot remains
  public-only; it is not an alternate authorization source.
- **Search ordering and chat cancellation safeguards:** deterministic earlier
  regressions established why they exist. Removing them would reintroduce data
  races, not simplify the product contract.
- **Shared renderer, table, chat, comments and diagnostic packages:** both hosts
  consume their behavior. Their complexity is supported by interactions that
  a screenshot alone cannot test.
- **The Next application and remaining host adapters:** Next still serves the
  live domain and is the rollback reference. Vite also still imports compatible
  source from it. Deleting it before cutover is not safe.

No broader redesign or cache replacement is justified by this review's evidence.
The five changes remove 80 net lines of production source; the separate lazy
bootstrap module is included in that count. Added tests are not counted as
production simplification.

## Test-coverage audit

The useful gaps were in the assertions and setup, not simply the number of tests:
the reset test blessed overly broad deletion, standalone routes were exercised
with a healthy reader, tool visibility did not prove responsive text visibility,
terms had no typography contract, and slash redirects were tested only after
authentication. Each now has a regression that failed before the corresponding
fix. No test was removed or weakened to obtain green status.

The final full run also exposed a chat test phase error: it refreshed immediately
after conversation creation, before any `/api/chat` request, while the draft was
still being prepared. The unchanged test passed five immediate repetitions, so
that rerun alone was not treated as a fix. Both navigation/refresh stories now
wait for the real chat request and require an **assistant** reply; the old
whole-log assertion could pass on the user's prompt. No chat production code or
timeouts were changed.

The existing cache-retirement, session-recovery and manifest-cache stories cover
why the retained cache machinery exists, including public-to-sensitive changes,
offline previous-version first frames, denied persistence and scope rotation.
Imaging tests go beyond screenshots to decoding, slice controls, URL restoration,
annotations, touch tools and downloads. Synthetic visual baselines cover light
and dark palettes plus desktop/mobile shell geometry. These are stronger release
signals than an arbitrary aggregate line-coverage percentage.

## QA scope and evidence

The local evidence is under ignored `.playwright/qa-round-2/principles-*`.
Clinical screenshots, browser sessions, traces and raw logs must stay private.
The private `principles-evidence.md` index maps results to their local artifacts.

| Initial first-principles gate (superseded by traced follow-up below) | Result |
| --- | --- |
| Complete isolated Chromium | 333 passed / 15 scoped skips / 1 chat harness timeout; follow-up below |
| Strengthened complete chat-resilience suite, repeated twice | 14 passed / 0 skipped, failed or flaky |
| Production WebKit | 87 passed / 2 scoped skips / 0 failed or flaky |
| Final production Chromium gate, metadata, startup, standalone and visual checks | 24 passed / 0 skipped, failed or flaky |
| Production standalone server/API verification | Passed, including 4 browser smokes |
| Shared and Vite unit tests | 245 passed / 0 failed |
| Lint, shared/Vite/Next typechecks, build and unchanged bundle budgets | Passed |
| Real AI ranking against the local production build | 1 passed |
| Changed-component React review | 0 errors; 5 pre-existing advisory warnings, not a clean-warning claim |

WebKit covers the settled frontend. The final server-only slash-order repair
was followed by all unit/static/server checks and the production Chromium set.

- Complete Chromium suite, including local admin/RBAC/multi-site fixtures, cache
  invalidation, search failure/order, chat Stop/recovery, diagrams, tables,
  downloads, calculator and diagnostic tools.
- Production-build WebKit: reader/accessibility/anchors/search/calculator/cache
  isolation plus standalone routing and all nine comparison layouts.
- Production server/API and password-gate checks, including anonymous deep links,
  signed gate sessions, headers, route metadata and browser startup controls.
- Committed synthetic visual comparisons; no baseline updates.
- Fresh matched Next/Vite captures at 393, 720, 820, 1440 and 1920 CSS pixels.
  The 720px reader is a reflow-width check, not physical-device certification.
  Terms now match Next's exact desktop/mobile article geometry; login and paired
  image geometry match too. Responsive tool labels were separately inspected.
- DICOM image-pixel control across Next, deployed Vite and the local production
  candidate: sampled image-region hashes and window ranges match. An earlier
  screenshot brightness difference was not accepted as a product finding
  without that control. No image-processing or windowing code was changed.
- Hands-on browser exploration of public terms, entry into the reader, password
  sign-in with preserved deep link, command-palette selection and browser Back.
- Repository lint, Vite/shared-package and Next typechecks, production build,
  unchanged bundle budgets, unit tests and a changed-component React review.

The first broad pass completed with 332 passed / 15 scoped skips. Two additional
terms cases and the responsive-label assertions were then added. The next run
completed with 333 passed, 15 skipped and one same-document navigation failure:
a concurrent package rebuild triggered a Vite reload during that test. It was
not counted as green. The complete suite was restarted after all builds finished.
The same story independently passed in production Chromium and WebKit.

That isolated run passed the same-document assertion, with no build restarts or
HMR reload failures, but timed out on the premature chat refresh described above.
The corrected complete chat-resilience suite then passed twice (14 executions),
including actual assistant output after navigation and reload. The only changes
after the full run were these strengthened tests and documentation, not product
source. Keep the raw full-run outcomes distinct from the corrected focused
verification; neither failing full run is represented as uninterrupted green.

The early entry-size failure was fixed by keeping reader-only bootstrap out of
standalone routes; no budget was raised. WebKit exposed two harness assumptions:
a pre-authenticated /login correctly redirects to the wiki, and line-height
serializes as 27.200001px. Tests now clear the gate cookie for anonymous sign-in
and compare numeric layout values. These are not waived product failures.

Standard local skips remain explicit: production-only server tests are covered
on the production build, Next-only SSR/fixture differences remain exclusions,
and live AI/comments require separate configured-service checks. The local
production build's opt-in live AI ranking passed. Fresh credentials for local
Liveblocks are unavailable; deployed-service evidence must not be mislabeled as
verification of an undeployed frontend.

This review does not reassign the live domain. External callback/webhook/cron
ownership and live-host session verification remain the cutover checklist in
[the promotion-readiness report](vite-promotion-readiness-2026-09-04.md).

## Paired trace coverage

The follow-up uses `apps/wiki-vite/playwright.parity.config.ts` to run the same
eight browser journeys against Next and Vite. Every executed journey retains
a trace with screenshots, DOM snapshots and source, including successful runs.
Each named `Checkpoint:` step also attaches a full-viewport PNG and JSON layout
measurements with the same name in both projects. This provides 24 comparable
states per host, not just a screenshot at the end of each test.

The journeys cover desktop reader/table expansion, mobile navigation/outline,
public terms/password deep links, desktop/mobile text search and history,
desktop/mobile calculator edits/reload, and tablet imaging controls/reload. The ordinary full
suite remains the broader functional gate; the paired suite supplements it.

To reproduce, set `WIKI_VITE_PREVIEW_LOGIN_PASSWORD` privately in the shell and
start the candidate's production server, then run from the repository root:

```sh
PARITY_NEXT_URL=https://diana-tnbc.com \
PARITY_VITE_URL=http://127.0.0.1:61902 \
bun --cwd apps/wiki-vite test:e2e --config=playwright.parity.config.ts

bunx playwright show-report .playwright/qa-round-2/paired-report --host 127.0.0.1 --port 61904
```

In the report, select the same journey in the `next` and `vite` projects and
compare matching checkpoint attachments. Open each trace to inspect the action,
DOM, screenshot, console and request leading to that state. Use `--trace=on` on
ordinary local E2E runs to retain passing traces there too. Skipped tests have no
completed journey to compare and must remain separately accounted for.

The paired configuration rejects CI runs because these are **private live-data
artifacts**, not public synthetic baselines. Its report and traces stay under
ignored `.playwright/qa-round-2/`. Do not upload them to public CI or a remote
trace-hosting service. The first commissioning run is retained separately: its
mobile helper incorrectly required a desktop-only table control, and its reload
expectation incorrectly assumed comparison slice URLs were persisted. Both
hosts exhibit the same existing behavior; the corrected journeys do not add
new product requirements. A slow initial Next desktop search is retained as
reference-host evidence, not attributed to Vite.

## Findings from the checkpoint review

The paired evidence found a material omission despite green calculator behavior
tests: its imported Next component was outside Tailwind's Vite source discovery.
The values and controls worked, but its responsive grids, input accents, summary
hierarchy and card backgrounds were absent. The fix adds the **single imported
calculator source**, not the whole Next tree, and deletes the unnecessary reader
header wrappers in favor of the existing calculator layout. Desktop/mobile
regressions now assert typography, centered usable width and input clearance.
Both failed against the pre-fix production build. No tax logic changed.

Restoring the backgrounds also exposed insufficient contrast in small muted
labels. The existing accessibility gate caught it. The calculator now scopes a
slightly darker light-mode muted text color; this deliberate difference from
Next preserves readability rather than copying its contrast defect. Dark-mode
muted text is unchanged. The page remains lazy and no bundle cap was raised.

The mobile sheet backdrop lacked Next's 2px blur. The existing shared backdrop
now uses the matching blur and 50% shade. A computed-style regression failed
before the repair and is covered alongside focus trapping and Escape recovery.

Expanding WebKit coverage to the full mobile-focus story found a real dismissal
gap: pointer activation did not focus the opener, so the sheet restored focus to
the page instead of its navigation button. Both shared/default and Vite reader
triggers now focus themselves before opening. The existing Escape/focus-return
assertion was kept unchanged; no focus trap rewrite was needed.

The traces also caught premature **test checkpoints**, not product defects:

- A visible heading can still sit above a loading skeleton. Article checkpoints
  now await loaded body content and absence of the page loader.
- Search can show an interim subset while the exhaustive result loads. Paired
  screenshots now await completion; both hosts then return the same result/file
  counts and navigate to the same first article.
- A changed image counter does not prove the new paired images have decoded.
  Both loading overlays must clear before each imaging checkpoint.
- Both mobile sheets close via opacity and pointer-event state, not removal of
  their layout box. The paired test asserts those actual end states.
- A table-handle check sampled opacity during its 120ms transition. It now
  places the pointer outside the table and waits for the same required zero
  opacity/no-background state; the resize behavior assertions remain intact.

Remaining minor differences are explicitly not pixel identity: copy/close icon
strokes, mobile slug capitalization, and Vite's initial active-outline highlight
(already protected by its navigation tests). Default calculator values may be
serialized into the Vite URL earlier; edited values and reload behavior agree.
No broader redesign is warranted by these differences.

Local Liveblocks configuration must clear the legacy `LIVEBLOCKS_API_KEY` alias
as well as `LIVEBLOCKS_SECRET_KEY` when valid local credentials are unavailable.
One follow-up run accidentally inherited the stale alias and received a provider
403. That failure is retained as environment evidence, not counted as passing
integration verification. The test's temporary user cleanup completed; no test
comment was successfully created. Live comments remain an explicit deployed-
candidate gate, not a waived local success.

## Traced follow-up results

Source was frozen after the WebKit focus repair. No package builds or product
edits run concurrently with the final complete Chromium suite.

| Gate | Latest result | Local evidence |
| --- | --- | --- |
| Complete Chromium, all 351 collected tests | 336 passed / 15 documented skips / 0 failed or flaky; 336 passing traces verified | `parity-release-chromium.json`, `parity-release-html/` |
| Expanded production WebKit | 113 passed / 2 skipped / 0 failed or flaky; 113 passing traces verified | `parity-release-webkit.json` |
| Production Chromium repair/accessibility/table/visual gate | 43 passed / 0 skipped, failed or flaky; 43 passing traces verified | `parity-reviewed-focus.json` |
| Production Chromium API, security, metadata and live AI gate | 37 passed / 1 scoped skip / 0 failed or flaky; 37 passing traces verified | `parity-traced-production.json` |
| Final shared/Vite units | 245 passed / 0 failed | `parity-release-unit.log` |
| Final lint, typechecks, production build and bundle limits | Passed, plus Next typecheck | `parity-release-static.log`, `parity-release-next-typecheck.log` |
| Paired browser journeys, latest run | Vite 8/8 passed; Next 7/8 passed, desktop search exceeded 20 seconds | `paired-results.json`, `paired-report/` |
| Additional pointer-grid selection and four-year planning | Passed on both Next and Vite, with separate retained traces | `{next,vite}-calculator-pointer-planner.zip` |

All paths above are relative to ignored `.playwright/qa-round-2/`; browser trace
attachments also live in ignored per-run output directories under the Vite app.
The production API gate predates visual/focus-only repairs; its server code is
unchanged. Final WebKit and complete Chromium cover the final frontend.

The final complete Chromium run finished uninterrupted in 16.3 minutes, with
zero retries. All 336 executed passing tests have an existing trace attachment.
The seven committed macOS screenshot baselines were genuinely compared; none
was updated. WebKit's two skips are the already-authenticated login story and
OS clipboard permission automation. Chromium's 15 skips separate production-
server checks (covered above), opt-in live integrations and Next-only fixtures.

The paired report must **not** be summarized as an uninterrupted all-green latest
run. A preceding run passed 16/16, but one auth-return screenshot still captured
Next's untagged streaming skeleton. The final auth checkpoint explicitly waits
for its table. That last run captured 45 settled screenshots and retained all
16 traces; Next desktop search timed out again. The private `paired-evidence.md`
index links all 24 comparison states per host, using three explicitly labeled
earlier successful Next desktop-search screenshots where needed. It links the
latest timeout trace too. No retry or longer assertion timeout hides this result.

An independent Next timing trace returned HTTP 200 at 12.2 seconds and displayed
results at 13.2 seconds, corroborating intermittent reference-host latency. Both
settled hosts return 2,203 text matches in 609 files and select the same article.
The later Vite focus-return change does not change the paired screenshots' layout.

Every comparison PNG was checked at identical dimensions. Raw pixel differences
were used for triage, not as a new acceptance threshold: 22 of 24 comparisons
were below 1% changed pixels, with the largest difference caused by a roughly
6px mobile article spacing offset and text/icon strokes. All screenshots remain
private. The committed synthetic baseline suite was not regenerated or loosened.
Hands-on browser exploration additionally exercised the calculator's entry,
input commit, multi-year checkbox and four-year plan; its session was closed.

The cumulative production diff removes 74 net lines, including the moved lazy
bootstrap and the additional focus handlers. Final eager graph: about 1202.8 KiB
gzip, within the original cap. No dependencies or new production automation were
added. The React checklist kept the calculator lazy, retained shared behavior,
and avoided new state/effects for the focus fix.

Earlier interrupted or failing full runs remain separately named. In particular,
`parity-traced-chromium` has the transition-frame table assertion failure;
`parity-final` was stopped after the newly styled calculator exposed contrast;
`parity-reviewed` was stopped after the stale Liveblocks alias surfaced. None is
presented as a completed passing full gate. The final local comments preflight
explicitly reports `configured: false`, `reason: credentials-missing`.

### Source and promotion boundary

The remote advanced during QA to `860ff81d` ("Switch production chat default to
GPT-5.6 Luna"), changing three chat-route/test files that do not overlap this
working diff. It was inspected but not merged mid-run. These results apply to
the `fb051b25` checkout plus the reviewed local fixes, **not** to an integrated
`860ff81d` candidate. Before releasing, integrate that newer main commit and
revalidate the model-dependent chat path, then verify live comments and the
remaining deployed-host cutover checklist. No commit, push, deployment or live
domain reassignment was made by this follow-up.
