# Next retirement and retained-logic consolidation

September 5, 2026 (Pacific). This follows the [Vite cutover](vite-cutover-qa-2026-09-05.md).

## What was removed

- The tracked `apps/web` Next implementation, Next dependencies, framework-only chat adapters, and old Next build/deployment/test workflows.
- Superseded report-only parity scripts, four large captured browser-tree JSON files, starter assets, and a one-off chat cancellation script without verified teardown.
- The permanently skipped Next streaming test. Current Vite browser tests and screenshot baselines remain.

## What remains and where

- `apps/wiki-vite/convex`: the same shared backend schema and functions. No database migration or clinical-data deletion was performed.
- `apps/wiki-vite/server`: same-origin API handlers, shared account hashing/session constants, and site-scoped blob helpers.
- `apps/wiki-vite/scripts`: retained publishing, administration, upload, and diagnostic seed tools.
- `apps/wiki-vite/src/pages/medical-deduction-calculator.tsx`: the existing calculator implementation, now local to its only app consumer.
- `apps/wiki-vite/redirects.json`: retained link compatibility. User-facing legacy URLs are not obsolete code and were preserved.
- Shared React/content/markdown/chat/diagnostic packages remain framework-independent.

Vercel production builds now run Convex deployment from the Vite app directory. One Vite CI workflow owns static, unit, standalone-server, deployed-browser and visual checks; CLI unit coverage is included in its unit command.

The current app and architecture guides describe Vite ownership. Historical migration logs are retained as history, not executable deployment instructions. Private environment files, traces, and local build residue were not committed or recursively deleted.

## Susan and hosting

The exact `susan-bc` test site was archived in Convex. Fresh host lookup no longer resolves it; its stored data remains recoverable with `sites:restore`.

The old `diana-tnbc` Vercel project was deleted after checking that both Diana custom domains belonged to `diana-tnbc-wiki-vite`. Its remaining domains were Susan's test domain and its default `vercel.app` domain. A fresh project lookup returned 404, and both Diana aliases still belonged to Vite.

The removed hosted Next deployment is no longer a rollback target. Next source is recoverable from Git at `52e12889`; normal production rollback should use a retained Vite deployment.

## Verification

- All nine workspace typechecks passed; frozen dependency installation passed with no Next package in the lockfile.
- Shared/package/CLI unit suite passed; the final Vite app unit run passed 133 tests.
- Lint, production build and bundle budgets passed. Lint retains existing React-hook and unused-disable warnings; they were not hidden or expanded into unrelated refactoring.
- Standalone production-server probes and all four Chromium preview smoke tests passed.
- Full local Chromium suite: 319 passed, 32 skipped, no failures or retries. This run preceded removal of the one permanently skipped Next-only case. These tests include mocked scenarios and environment-dependent skips; they are not a substitute for real-backend verification.
- A focused rerun exposed a readiness bug in the test helper: it could click the cached read-only first frame. The helper now waits for the interactive reader and asserts directory expansion; the original failure trace is retained privately.
- Final focused navigation, loading, and source-boundary rerun: 38 passed, 5 server-only cases skipped on the dev server, no failures or retries.
- Manual browser exploration verified the password gate and rendered reader, with screenshots and no browser errors.

The first hosted cleanup build (`b87407ee`) found a missing build prerequisite: retained operator tools import the publisher CLI's generated types. Local generated artifacts had masked that dependency. The app's typecheck/build now builds the CLI first. The failed frontend build did not replace the working Diana deployment; Convex deployed the unchanged moved functions successfully.

Private evidence is under `.playwright/next-retirement/`. Deployed verification must use the exact new commit, real backends, test-owned records, and fresh teardown checks. Traces, screenshots, signed sessions, and backend receipts must not be uploaded to this public repository.
