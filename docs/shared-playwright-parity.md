# Shared Next / Vite parity gate

**Historical checkpoint; superseded by [the cutover report](vite-cutover-qa-2026-09-05.md).** The user explicitly
chose real services with cleanup after each phase. The shared annotation flow
now uses real catalog records, image bytes and annotation persistence, followed
by verified deletion. The prior incident and incomplete release run remain
part of the evidence below; the new focused checks do not replace a full gate.

During the previous final run, a delayed
annotation PUT escaped browser route mocks and the browser write guard around
a WebKit reload. A synthetic annotation reached the live backend. Both suites
and the local candidate server were stopped. The exact test annotation was
removed after checking its ID, text, image and unchanged timestamp; a fresh
production read confirmed zero remaining annotations in that series. Earlier
traces showed the series was empty before the test. An empty annotation-set row
remains. Private incident details and original traces are retained under
`.playwright/shared-parity/annotation-containment-incident.json`.

A read-only audit of 1,649 retained traces found three successful unmocked
annotation saves to that same test image across the full runs, plus two AI
searches and six Liveblocks authentication requests. Requests recorded as
aborted are not proof that the server performed no work. The incident is not
limited to screenshot noise or a single assertion failure.

Browser mocks are **not** a sufficient safety boundary. The temporary blanket
isolation requirement has been replaced with explicit real-backend opt-in,
unique test-owned records, pre-write ownership journals, fresh persisted reads,
and teardown verification. The runner is serial and stops at the first failure.
An interrupted process cannot guarantee teardown: inspect its pending journals
and reconcile those exact IDs before starting another phase. Never sweep a
whole site, restore a snapshot over live data, or delete by a broad name prefix.

The same `apps/wiki-vite/parity-e2e/*.spec.ts` files run on both hosts. Within
each browser, projects differ **only by base URL**. The default matrix is Next
and Vite in Chromium and WebKit; Firefox is intentionally excluded. There are
no host-specific assertions, project-name conditionals, retries, or hidden
expected-failure annotations in the tests.

The earlier eight-journey suite did not establish full parity. Likewise, the
earlier 336 Chromium / 113 WebKit passing results were Vite-only evidence.
This gate replaces that assumption with explicit paired executions. It does
not turn untested authenticated write paths into passing results.

## Run and review

Start a freshly built candidate production server. Set the password privately
and use explicit reference/candidate URLs:

```sh
export PARITY_NEXT_URL="<an accessible Next baseline deployment>"
export PARITY_VITE_URL="https://diana-tnbc.com"
export PARITY_REAL_BACKENDS=1
export PARITY_CONVEX_URL="<the real Convex backend used by both apps>"
# Set WIKI_VITE_PREVIEW_LOGIN_PASSWORD privately.
# Annotation setup/complete teardown also needs PARITY_CONVEX_CLEANUP_KEY,
# supplied privately to the test process only, never the browser/app server.
bun --cwd apps/wiki-vite test:e2e:parity
bun --cwd apps/wiki-vite report:e2e:parity
bunx playwright show-report .playwright/shared-parity/report --host 127.0.0.1 --port 61914
```

`PARITY_BROWSERS=chromium` selects one complete paired browser run.
After cutover, both Diana production hostnames serve Vite: using them as the
two URLs checks hostname continuity, not Next/Vite parity. A Next deployment
must also have working site resolution and deployment-protection access before
it can serve as a new baseline.
`PARITY_OUTPUT_DIR` is relative to `apps/wiki-vite`, unless absolute. Use a new
directory for each run; the runner replaces its result directory. Keep source
and built assets frozen throughout a release run. Use HTTPS for production-mode
servers: Secure cookies are not sent by Playwright's independent API client over
plain HTTP. Deployed-host checks are not evidence for unpublished local changes.

Every executed test retains its passing or failing trace, including DOM
snapshots, source, requests and screenshots. Named `Checkpoint:` steps attach
settled screenshots and geometry. The comparison report matches **same-run**
test/browser/checkpoint keys, displays missing counterparts, and links both
traces. It never substitutes an older successful reference screenshot.

Pixel differences are triage evidence, **not a visual pass threshold**. Inspect
the paired screenshots and their traces. Reference-host failures, candidate
failures, missing checkpoints and missing traces must be reported separately.
All artifacts are ignored and private: clinical content and signed sessions
must not be uploaded to public CI or a remote trace viewer. Both the runner
and report command refuse CI execution.

## Data boundaries

- Reader, text search, published imaging, PDFs and page hashes use real
  published content. Text search deliberately exercises both Next's server
  action and Vite's HTTP API; mocking only the latter is not paired evidence.
- AI-search success uses the real provider. Deliberate empty/error rendering
  still injects responses and is identified as fault-injection evidence. Provider
  usage, audit logs and billing are not reversible application test records.
- Comments use identical public HTTP mocks for signed-out/empty states and
  the account dialog. This proves frontend behavior, not Liveblocks writes.
- Browser requests are observed, not treated as containable by interception.
  Each context has an explicit test guest identity; provider-created guest rows
  are removed and read back after the context stops issuing work.
- Annotation editing/delete/undo/reload uses **no browser request mocks**. Setup
  creates one temporary catalog series and one image alias under an exact UUID
  namespace, referencing a published image blob. Existing clinical records and
  blobs are not changed. The UI's actual series request must identify that
  namespace before drawing. Teardown waits for mutation acknowledgements, closes
  the page, clears annotations through the real API, removes the owned empty
  annotation/catalog rows by exact ID, and verifies absence through both database
  and application reads. The cleanup key stays out of browser traces.
- The existing live anchored-comment test is imported, not copied, into the
  shared suite. It creates a unique account/comment, verifies persisted readback,
  and deletes the owned thread, account, sessions and guest identity afterward.
- Persisted chat, RBAC, admin and cross-site write scenarios still need the same
  ownership/cleanup conversion before their older suites can run on live data.
  Do not remove the existing isolated-backend guards from those suites or treat
  an unsent chat draft as persistence coverage.

## Real-backend phase evidence

- `.playwright/shared-parity/real-annotations-catalog-2`: four functional passes,
  Next/Vite × Chromium/WebKit, four traces and six paired screenshots. Each test
  deleted three owned rows and verified zero remaining. Screenshot review caught
  a premature reload checkpoint (annotation visible while the image still loaded);
  the test now also waits for the canvas, loader and slice counter before capture.
- `.playwright/shared-parity/real-annotations-settled`: the corrected checkpoint
  passed all four executions, retained four traces and all six paired checkpoints,
  and verified deletion of three owned rows per test. Reload screenshots now show
  the same decoded image and annotation placement. Differences of 0.15–0.33% still
  include deployed Vite's heavier labels and hidden desktop toolbar text, so this
  is not a blanket visual sign-off. The deployed stylesheet has an extra unlayered
  `.sr-only` rule overriding responsive text visibility; the current local built
  stylesheet no longer contains that duplicate. Verify the eventual hosted build.
- `.playwright/shared-parity/real-annotations-reconciliation.json`: the six empty
  rows left by earlier harness trials were individually verified and deleted.
  The first real-catalog failed trial also cleaned both setup rows successfully.
- An unfiltered catalog check exposed a shared app bug: `dicom:listSeries` with
  `includeImages: true` fails on the real inventory; both HTTP handlers then
  returned an empty local catalog. Both handlers now request summaries only;
  the selected-series endpoint already supplies images. Both changed handlers
  returned the live inventory successfully with zero eager images. Unit coverage
  now fails if either catalog path asks for every image.
- `.playwright/shared-parity/real-comments-vite-reload`: Vite Chromium passed
  real comment creation, server readback, deep-link reload, and the global list.
  The thread, account/sessions, and guest identity were removed and read back.
  The identical corrected test on deployed Next (`real-comments-visible`) failed
  at reload: the room list returned zero threads while direct/server reads still
  contained the new thread. Vite already has a direct linked-thread fetch fallback;
  Next's legacy comments implementation does not. This is a baseline failure,
  not a matched visual pass. Both failed and passing trials verified cleanup.
  That diagnostic still forced a fresh global-list request and is superseded by
  the unmodified-request check below for the global UI contract.
- `.playwright/shared-parity/real-comments-unmodified`: removed the global-list
  route override entirely. Vite Chromium passed. WebKit reached all three comment
  checkpoints but failed the uncaught-browser-error assertion during navigation;
  both runs verified thread/account/guest cleanup. One rejection maps to the
  installed Liveblocks 3.18.1 `RoomProvider` comment-event handler awaiting
  `room.getThread()` without error handling; the other errors came from the old
  deployed automatic page warmer (already deleted in the local candidate).
  [Upstream room implementation](https://github.com/liveblocks/liveblocks/blob/main/packages/liveblocks-react/src/room.tsx)
  also marks that error handling as a TODO. No global error suppression, artificial
  delay or retry was added to convert this into a pass. The dependency boundary
  remains unresolved; verification stopped there under the verification skill.
- `.playwright/shared-parity/real-backend-reconciliation-final.json`: independent
  fresh reads checked 15 exact annotation namespaces, 11 test accounts, 14 guest
  identities and the 11 test comments through both deployed hosts (62 checks).
  All were absent. This does not delete or reclassify the historical empty row
  in the original clinical series described in the incident section above.

## Existing-suite coverage audit

Every one of the 47 existing Vite spec files is accounted for below. “Paired”
means the named user-facing contracts have shared coverage, not that all
implementation-specific assertions in the old file were copied unchanged.
Existing host-specific regressions remain useful and are not deleted.

| Existing spec | Shared coverage / retained boundary |
| --- | --- |
| accessibility | Paired real reader, search, calculator, terms; keyboard focus and dialogs |
| admin-access | Isolated-backend gate: administrator and signed-out authorization |
| admin-users-bulk | Isolated-backend gate: bulk account changes and cleanup |
| app-recovery | Vite-only bootstrap and import-failure recovery |
| auth-gate-security | Paired anonymous pages/APIs, forged cookie, invalid password |
| backend-api | Paired public-content hashes, gate, PDF ranges; provider/archive internals retained |
| browser-preflight | Vite-only WebAssembly/browser startup requirements |
| cache-retirement | Vite-only versioned cache custody and cleanup |
| chat-nav-resilience | Isolated-backend gate: real send/Stop/reload/recovery persistence |
| chat-perf | Isolated-backend gate: streamed completion and timing |
| chat | Paired draft, archive navigation and responsive layout; send/archive writes gated |
| command-palette | Paired files, empty results, selection semantics, chords, themes and history |
| comments-live | Same live anchored-comment test imported on both hosts; explicit test-owned cleanup; reply/resolve still unpaired |
| comments | Paired document/global signed-out states, filters and account dialog |
| diagnostic-timeline | Paired loaded timeline, zoom/reset, responsive navigation; detailed seeded interactions retained |
| diagnostics-regression | Paired imaging entry and responsive timelines; synthetic marker cases retained |
| dicom-comparison-layout | Paired nine viewport sizes, decoded canvases, slice and tool controls |
| dicom-viewer | Paired image URL/reload, published stacks/PDFs and real annotation edit/delete/undo/reload with complete cleanup; other drawing tools remain separate gates |
| header-shell | Next-specific prerender/SSR contract, not a Vite hydration requirement |
| image-theater | Paired published markdown image dialog and download affordance |
| live-data | Paired public manifest/content inventory and hashes |
| livestore-devtools | Vite-only opt-in development inspector |
| manifest-cache | Vite-only cache freshness, pagination, partial manifest and replacement |
| markdown-currency | Synthetic renderer-specific currency fixtures retained; calculator values paired |
| markdown-heading-anchors | Paired deep-link reload and fixed-header clearance at mobile/desktop |
| medical-deduction | Paired input/clamping, keyboard grid, four-year customization and URL restoration |
| metadata | Paired route title checkpoints and canonical navigation; SSR/private metadata internals retained |
| multi-site-isolation | Isolated-backend gate: cross-site authorization; synthetic Host routing retained |
| navigation | Paired reader, files, history, canonical URLs and workspace downloads |
| page-chrome | Paired title, tags and menu geometry; OS clipboard validation retained separately |
| page-load-experience | Paired loaded/reflow/404 states; Vite cache timing and fault injection remain host-specific |
| pii-redaction | Shared renderer fixtures retained; isolated backend needed for raw/redacted role comparisons |
| role-based-access | Isolated-backend gate: public/viewer/admin/PII role boundaries |
| route-correctness | Paired canonical URLs, terms, tag navigation; authenticated admin route gated |
| search-request-order | Paired delayed real text-search response; deterministic Vite transport cases retained |
| search | Paired live text and common-boundary AI success/empty/error/navigation states |
| session-recovery | Paired password deep link; LiveStore scope/identity recovery host-specific; user scope authorization gated |
| sidebar-pdfs | Paired published PDF byte ranges; full seeded sidebar traversal retained |
| source-loading-boundary | Next SSR streaming vs Vite projection timing remains implementation-specific |
| standalone-routes | Paired public terms and standalone tools; Vite startup-with-broken-store regression retained |
| storage-availability | Vite-only denied OPFS/IndexedDB/localStorage fallback |
| table-examples | Paired all example expansion/collapse/mobile-resize contracts |
| table-expansion | Paired article/examples expansion and responsive reflow; detailed drag/wheel persistence retained |
| table-performance | Host-specific animation/layout performance probes retained |
| tag-page-access | Paired public tag navigation; role-dependent tag visibility gated |
| timeline-gantt | Synthetic Mermaid Gantt rendering remains a shared-fixture coverage gap |
| visual-parity | Existing synthetic baselines retained; new same-run live checkpoints compared separately |

## Findings from the expanded review

The first complete matrix executed 104 cases per project: 416 executions, with
349 passing and 67 failing. It retained all 416 traces, matched 262 screenshot
checkpoints, identified 43 missing counterparts, and found no difference in the
paired published manifest inventory or sampled page SHA-256 hashes. These are
diagnostic results **before** the interaction/layout follow-up, not a green gate.
Artifacts: ignored `.playwright/shared-parity/final/`.

| Finding | Scoped repair / disposition |
| --- | --- |
| Text search issued unnecessary AI requests | Only run AI search in AI mode. The shared read-only write guard detected the unwanted requests. |
| Vite omitted explicit theme commands | Reuse the shared theme preference functions for Dark, Light and System commands; exercise real commands and reload persistence. |
| Reader links relied on color, and overflow tables were not keyboard reachable | Underline prose links and make smart-table/calculator scrollers focusable. These intentional accessibility improvements differ from the deployed reference. |
| Account dialogs lacked Escape/focus containment; WebKit skipped buttons during Tab navigation | Keep keyboard focus inside dialogs/navigation, restore opener focus, and explicitly handle each Tab step. |
| Published AVIF images were not supported end-to-end | Add AVIF to the shared resolver, both file MIME maps and the publisher asset inventory. Delete the duplicated server extension list; add format, file-handler and owner-visibility inheritance regressions. The discovered article's image is absent from the backend but exists in the source vault; the publisher previously omitted this extension. Keep that content-readiness check failing until a separately authorized scoped asset publish. Do not bypass asset authorization or silently substitute another image. |
| Background reader updates closed image previews | Preserve markdown component type identity across rerenders. A regression confirms a 304 manifest refresh no longer destroys an open preview. |
| Reader content was mounted twice through an extra lazy comments boundary | Delete that boundary and duplicate article fallback. The lightweight shared comments wrapper already lazily loads its interactive implementation. |
| Mobile immersive imaging reserved space for absent reader chrome | Remove that bottom padding for immersive routes and assert the comparison workspace owns the full viewport. |
| Typography looked heavier than the reference | Match the reference's font smoothing. Existing synthetic visual baselines remain unchanged. |
| Desktop image previews stopped at native image size | Make the shared preview image fill its stage with `object-fit: contain`, matching the Next image adapter. Assert stage dimensions as well as successful image decoding. |
| Reader chrome used inconsistent tablet breakpoints | Align Vite's mobile header and shared outline rail with the reference's 768px breakpoint. Assert mobile-header visibility at all seven reader widths. |
| Every cold reader downloaded up to 80 unrelated pages | Delete automatic cache warming. Cache pages when visited; preserve the explicit warm-cache action and verify that no unrelated body is fetched before that action. |
| Imaging reloads leaked rejected speculative cache promises | Traces pinpointed Cornerstone's discarded `putImageLoadObject` promise. Delete the two duplicate nearby-image prefetchers and their call sites; active image navigation and its normal cache remain. No global error suppression or dependency monkey patch. |

The image test now targets the common **Open image** button contract. Next's
server-rendered image has `role="button"`; Vite wraps an image in a button.
Requiring an `img` accessibility role on the opener incorrectly excluded Next.
Inside the preview, both must expose and actually decode an image.

Trace review also caught two evidence errors: a search race test compared an
initial 100-result batch with the legitimate completed current-query batch,
and an imaging reload checkpoint could observe a hidden loader before the
viewer had mounted. The shared tests now wait for complete search results and
for the reloaded canvas, requested slice counter and final loader clearance.
Mobile comment checkpoints also require the sheet and sign-in prompt to be in
the viewport, not merely present in layout. Earlier artifacts retain their
original failures/screenshots; they are not rewritten as passing evidence.

The second complete matrix (`final-2`) had 356 passing / 60 failing executions,
with all 416 traces, 254 matched checkpoints and 57 missing counterparts. Its
large image-theater and tablet-reader diffs led to the additional repairs above.
The targeted follow-up then passed 22 Chromium/WebKit executions, including
the formerly failing imaging/reader reload paths, plus 25 existing reader and
imaging regressions. These focused passes do not replace the final full matrix.

## Latest evidence and remaining work

The final follow-up (`final-3`) was deliberately interrupted for containment:
301 passed, 48 failed, 4 interrupted, and 63 not run. It retained 353 traces,
189 matched screenshot checkpoints and 99 missing counterparts. Do not report
the unexecuted cases as passes or use this run as read-only release evidence.

| Project | Passed | Failed | Interrupted | Not run |
| --- | ---: | ---: | ---: | ---: |
| Next Chromium | 88 | 16 | 0 | 0 |
| Vite Chromium | 101 | 3 | 0 | 0 |
| Next WebKit | 76 | 27 | 1 | 0 |
| Vite WebKit | 36 | 2 | 3 | 63 |

The Vite failures include the missing published AVIF, cold calculator/unknown
route loading timeouts, and the annotation reload scenario. The interrupted
legacy Chromium suite had 183 passes, 1 failed pending-image loading test,
1 interruption, 26 skips and 141 not run. The earlier Vite-only green counts
must not be substituted for these current incomplete results.

Manual same-run screenshot review verified the repaired tablet layout and
image preview. The 768px Chromium reader pair differs by 0.02% of pixels and
the desktop preview by 0.17%, versus 8.07% and 40.68% before their fixes. The
single-viewer restored image pair differs by 0.04%. These are review measurements,
not automatic pass thresholds or a complete visual sign-off. Intentional prose
link underlines and a different copy icon remain. Missing/state-mismatched
reference checkpoints still require review on fresh, identified deployments.

Hands-on Chrome exploration also covered the dark tablet reader, sidebar,
outline expansion and heading jumps (heading landed 24px below the viewport top),
with no horizontal overflow. Browser viewport and panel preferences were
restored afterward. Earlier hands-on checks exercised themes/reload, mobile
imaging and the published image theater.

Historical completed code checks: Vite build, lint, Vite/shared/Next typechecks, unchanged
bundle limits (1204.0 KiB eager / 4334.0 KiB total gzip), 253 relevant unit tests,
15 Next file-handler tests, and 28 publisher unit tests. The new safety gate was
verified to refuse running without an isolated backend before test execution.
The product build stayed frozen during `final-3`; its fingerprints are in the
private `provenance.json`. Publisher recognition and the runner safety gate were
updated separately afterward. No commit, push, deployment or domain promotion
was performed.

The real-backend follow-up passed `verify:wiki-vite:static` and
`verify:wiki-vite:unit` (264 unit tests), two additional Next DICOM catalog route
tests, and the Next typecheck. The latest shared fixture/comments changes also
passed Vite typechecking. The isolated-only runner policy described in the
historical checks was replaced by explicit real-backend opt-in and exact-record
cleanup; the fixture itself enforces this even when imported by the legacy suite.
The full 420-execution matrix has not been rerun. Real AI success is configured
but not executed in this follow-up. No push or promotion has occurred.

## Promotion boundary

Passing this paired UI suite alone is **not** full promotion approval. Remaining
gates include conversion of the authenticated write matrix to exact test-owned
records with verified real-backend cleanup, seeded markdown/media
edge cases and Gantt rendering, complete archive integrity, remaining annotation
tools and durable writes, live provider configuration, and final hosted deployment checks.
Do not relabel these as implementation-specific merely because they are hard
to run on both hosts. Record them as missing shared user-facing coverage.

The working candidate also predates newer `oncobase/main` chat-model changes.
Integrate and verify the eventual release SHA before pushing/promoting; a local
paired run does not reassign the live domain.
