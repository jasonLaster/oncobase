# E2E Flake Heuristics

This page tracks recurring failure modes from CI and the heuristics we use to decide whether to harden product code, harden a test, or keep watching.

## Current Failure Modes

### Static shell versus streamed content

Observed in the May 4, May 7, and May 8, 2026 scheduled `E2E Stress Test` runs on `main`.

Symptoms:

- `page-load-experience.spec.ts` sees the header and loading shell, then times out waiting for `article h1:visible`.
- The mobile first-paint test finds a bottom navigation button named `[...slug]` or cannot find a button named `Index`.
- The May 7-8 runs sometimes reached only the authenticated header shell, or later lost the sidebar/content frame while scripts were blocked.
- The May 8 branch stress run `25571279045` still occasionally reached only the authenticated header shell at browser first paint, while the raw server HTML check for the same routes was the stronger proof that sidebar/content/heading markup streamed.
- The follow-up May 8 branch stress run `25572888318` showed the same `/wiki/diagnostics/diagnosis` no-JS browser case hanging when optional geometry/performance probes waited for sidebar/content or paint entries after visible header chrome had already rendered.
- The same run saw one transient `apiRequestContext.get: socket hang up` while fetching raw shell HTML.
- Retries usually pass, which points to slow streaming or request-time data resolution rather than a deterministic render failure.

Heuristics:

- For no-JS first-paint tests, assert immediate chrome first, then accept either visible streamed document content or the loading shell.
- Avoid optional `locator.boundingBox()` or `performance.getEntriesByType("paint")` probes for elements that are not required to be present in the no-JS browser shell; those probes can wait until the test timeout under production load.
- Do not make no-JS assertions depend on client-only route state such as hydrated pathname-derived labels.
- Keep at least one server HTML test that proves the requested heading is present in the streamed HTML.
- Retry raw server-shell fetches on transient socket/network errors before classifying them as app regressions.

Mitigations in this branch:

- `page-load-experience.spec.ts` keeps no-JS first-paint assertions scoped to visible app chrome. The server HTML test owns the deterministic streamed-content assertions.
- The server HTML test keeps proving requested headings are present in the streamed HTML.
- The server HTML test retries transient socket/network failures so production stress noise does not mask real shell regressions.
- The mobile bottom affordance is located by its structural fixed-bottom selector instead of its hydrated page title.
- The no-JS first-paint browser checks use the same `?token=diana` magic-link path as the server HTML checks, so a missing or stale storage-state cookie cannot turn a production stress repeat into a partial unauthenticated shell assertion.

### Client-side navigation waits

Observed in the May 7 and May 8, 2026 scheduled `E2E Stress Test` runs on `main`.

Symptoms:

- `navigation.spec.ts` repeatedly times out at `page.waitForURL(/\/about\/Journal$/)`.
- The failure log says Playwright is `waiting for navigation until "load"`.
- The page snapshot still shows the original page, while the target sidebar link is visible and clickable.
- Related command-palette and markdown-heading navigation checks use the same full-navigation wait shape.

Heuristics:

- For Next.js client-side transitions, assert the URL with `expect(page).toHaveURL(...)` after the click or keypress instead of waiting for a document `load` event.
- Keep the destination content assertion separate, so a real app navigation failure still fails on visible page state.

Mitigations in this branch:

- Sidebar, command-palette, and markdown-heading navigation tests now trigger the interaction first and then poll `page.url()` with `expect(page).toHaveURL(...)`.

### Hidden duplicate markdown links

Observed in the May 8, 2026 branch stress run `25571279045`.

Symptoms:

- Same-page and cross-page markdown link tests time out in `locator.click(...)`.
- The Playwright call log says the element is not visible even though the page snapshot shows the target page fully rendered.
- The selector matches duplicate markdown links where the first match can be hidden in a responsive or overflowed table-of-contents region.

Heuristics:

- Link-click tests should filter to the visible matching anchor before clicking.
- Keep the post-click URL and scroll-state assertions, so a real app navigation regression still fails on observable behavior.

Mitigations in this branch:

- Markdown same-page and cross-page link tests now click the first visible matching anchor.
- Markdown command-palette navigation uses the same retrying palette opener as the main navigation suite.

### Command palette selection races

Observed in PR checks and the May 4, 2026 stress run.

Symptoms:

- `navigation.spec.ts` times out waiting for `/search`.
- The log shows the page navigated to a fuzzy `research` result instead of the exact `search` page.
- Opening the palette via keyboard can race hydration on slow CI runners.
- A test-level `/api/pages` mock can be bypassed when the root layout already provides `initialPages`, turning a fake command target into a deterministic timeout.

Heuristics:

- Exact page-name or slug matches should outrank fuzzy matches.
- Tests should open the palette by polling visible UI rather than sleeping and pressing a shortcut.
- Tests should select or assert a result by stable `cmdk` value where possible.
- Command-palette navigation tests should use a real published page entry unless the app code path under test is specifically the API fallback.

Mitigations in this branch:

- `CommandPalette` ranks exact slug/name matches ahead of fuzzysort scores.
- The command palette navigation test opens the palette through the visible `Find files` button and waits for the input to be editable.
- The test asserts the exact `data-value="about/Journal"` result before pressing Enter.

### Search tab state versus async text search

Observed as a flaky retry in PR checks.

Symptoms:

- The empty-search test clicks `Text Search`, then times out waiting for `No results for`.
- The UI can still be in the shared text-search loading state.

Heuristics:

- Switching tabs is not enough; wait for the shared search state to settle before asserting final copy.
- Prefer helper-level polling over one-off assertion timeouts for search states.

Mitigations in this branch:

- `search.spec.ts` reuses `openTextSearch` and `waitForTextSearchState` before asserting the empty-state message.

### AI search mock timing and route isolation

Observed in local full-suite Playwright verification on May 8, 2026.

Symptoms:

- `search.spec.ts` AI-mode tests timed out waiting for a mocked `/api/ai-search` request.
- The page rendered `No relevant results for ...` while the current test's mock call counter stayed at zero.
- Later AI-mode tests could pass, indicating the app behavior was not deterministically broken.
- Local text search can take roughly 20 seconds before AI mode starts, which matched the old mock wait timeout.

Heuristics:

- Avoid `page.context().route(...)` for per-test mocks when a worker may reuse a browser context across tests.
- Prefer `page.route(...)` so the mock and its call counter are scoped to the current page lifecycle.
- AI mode should render the loading state while the text-search prepass is still running.
- Mock request waits should allow for the local text-search prepass before `/api/ai-search` is issued.

Mitigations in this branch:

- `mockAISearch` now registers its `/api/ai-search` mock on the `page` instead of the shared browser context.
- AI mode keeps showing `Analyzing results with AI...` until the text-search prepass has completed, and the search spec waits longer for the mock AI request.

### Shell payload size regressions

Observed as a deterministic preview failure before `origin/main` moved past `3e17fe58`.

Symptoms:

- Page HTML contains paths such as `sources/people/providers/stanford/telli`.
- `/api/file-tree?format=compact` is the same size as `/api/file-tree`.
- A whole-document `not.toContain("sources/...")` assertion can fail deterministically when streamed page content or Flight payloads legitimately mention source paths.

Heuristics:

- Treat this as a deterministic regression, not a flake, when it fails both first run and retry.
- Keep checking full API tree correctness separately from shell payload compactness.
- Scope shell assertions to the serialized shell prop, such as `initialTree`, rather than arbitrary strings that can appear in the document body.

Current status:

- Already addressed on `origin/main` by avoiding serialized full trees in the shell and loading the compact tree client-side.
- The shell-size test now checks that the full tree is not serialized as `initialTree`, while allowing streamed markdown content to reference source paths.

### React streaming markers in raw HTML

Observed in the May 5 and May 6, 2026 scheduled `E2E Stress Test` runs.

Symptoms:

- `source-loading-boundary.spec.ts` sees the expected loading shell and final source heading in raw HTML.
- The same HTML sometimes contains React's `$RX(` streaming marker, making a whole-document `not.toContain("$RX(")` assertion fail even when the page renders cleanly.

Heuristics:

- Treat React streaming markers as framework transport details, not app error overlays.
- Keep asserting the loading shell, final content, and absence of Next's visible error overlay markers.

Mitigations in this branch:

- `source-loading-boundary.spec.ts` no longer fails on `$RX(` and instead checks that the raw HTML does not include `data-nextjs-dialog`.

### Local dev harness collisions

Observed while stress-testing this branch locally.

Symptoms:

- Playwright silently reuses another worktree's server on `localhost:3000`.
- `bun dev` fails before tests start because `convex dev` needs interactive setup.
- Next dev blocks HMR resources when the test `baseURL` uses `127.0.0.1` instead of `localhost`.

Heuristics:

- Treat web server startup failures separately from app/test failures.
- Use a dedicated `PLAYWRIGHT_PORT` for local stress loops.
- Prefer starting `dev:app` for Playwright's local web server; CI and preview tests use deployed Convex data, and local `convex dev` can be an interactive setup step rather than a test dependency.

Mitigations in this branch:

- `playwright.config.ts` supports `PLAYWRIGHT_PORT` and `PLAYWRIGHT_BASE_URL`.
- Local Playwright starts `bun dev:app` instead of `bun dev`.

### PR checks that never reached E2E

Observed in recent `PR Checks` runs on May 6 and May 8, 2026.

Symptoms:

- Several failed PR workflow runs had `E2E (Preview)` skipped because an upstream job failed.
- Run `25537842493` failed in `Resolve Preview URL` and `Static` typecheck before preview E2E could start.
- Runs `25460014964` and `25459926355` reported no executed job steps on the failed jobs, which is consistent with cancelled or superseded checks rather than a browser-test failure.
- Runs `25569536278` and `25569396816` were cancelled by newer pushes through the workflow concurrency group.
- The latest successful e2e-preview evidence found in this sweep was run `25460970667`, where `E2E (Preview)` passed after the flaky-test branch update.

Heuristics:

- Do not bucket skipped `E2E (Preview)` jobs as e2e regressions unless the `Run e2e tests against preview` step actually ran and failed.
- Track preview URL resolution separately from browser-test failures.
- Treat concurrency cancellations as superseded evidence; inspect the newest run for that PR branch instead.

Current status:

- No recent PR-check run inspected here showed a failed `Run e2e tests against preview` step. The actionable browser failures are in the scheduled stress workflow.

## Stress Testing Notes

Preferred local command for this branch:

```sh
PLAYWRIGHT_PORT=3107 bunx playwright test \
  e2e/navigation.spec.ts e2e/search.spec.ts e2e/page-load-experience.spec.ts \
  --project=tests --repeat-each=10 --workers=1 --reporter=list
```

Use `PLAYWRIGHT_PORT` when another worktree already has `localhost:3000`; this prevents false confidence from reusing the wrong dev server.

Preferred CI command:

```sh
bunx playwright test --project=tests --repeat-each=10 --reporter=list,html
```

For nightly production coverage, use the existing `E2E Stress Test` workflow dispatch with `runs=10`.
