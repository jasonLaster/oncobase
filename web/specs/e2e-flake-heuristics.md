# E2E Flake Heuristics

This page tracks recurring failure modes from CI and the heuristics we use to decide whether to harden product code, harden a test, or keep watching.

## Current Failure Modes

### Static shell versus streamed content

Observed in the May 4, 2026 scheduled `E2E Stress Test` on `main` at `3e17fe58`.

Symptoms:

- `page-load-experience.spec.ts` sees the header and loading shell, then times out waiting for `article h1:visible`.
- The mobile first-paint test finds a bottom navigation button named `[...slug]` or cannot find a button named `Index`.
- Retries usually pass, which points to slow streaming or request-time data resolution rather than a deterministic render failure.

Heuristics:

- For no-JS first-paint tests, assert immediate chrome first, then give streamed document content a longer timeout.
- Do not make no-JS assertions depend on client-only route state such as hydrated pathname-derived labels.
- Keep at least one server HTML test that proves the requested heading is present in the streamed HTML.

Mitigations in this branch:

- `page-load-experience.spec.ts` gives streamed headings 45 seconds inside a 90 second test budget.
- The mobile bottom affordance is located by its structural fixed-bottom selector instead of its hydrated page title.

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

### Shell payload size regressions

Observed as a deterministic preview failure before `origin/main` moved past `3e17fe58`.

Symptoms:

- Page HTML contains paths such as `sources/institutions/stanford/telli`.
- `/api/file-tree?format=compact` is the same size as `/api/file-tree`.
- A whole-document `not.toContain("sources/...")` assertion can fail deterministically when streamed page content or Flight payloads legitimately mention source paths.

Heuristics:

- Treat this as a deterministic regression, not a flake, when it fails both first run and retry.
- Keep checking full API tree correctness separately from shell payload compactness.
- Scope shell assertions to the serialized shell prop, such as `initialTree`, rather than arbitrary strings that can appear in the document body.

Current status:

- Already addressed on `origin/main` by avoiding serialized full trees in the shell and loading the compact tree client-side.
- The shell-size test now checks that the full tree is not serialized as `initialTree`, while allowing streamed markdown content to reference source paths.

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
