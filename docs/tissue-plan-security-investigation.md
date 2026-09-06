# Recurring tissue-plan warning: September 6, 2026

## Findings

The application regression and the recurring Codex precaution are separate issues.

The original report was tracked in `apps/web/public/tissue-plan.html` by the May 28 OSS-layout commit `713923d5`. It was not a generated test fixture. The migration task records that copying it to Vite's public assets briefly exposed it before the password-gated catch-all. Deleting it from the current app and rejecting unreviewed static assets addressed that deployment path.

This investigation began in a different, older checkout: `codex/harden-navigation-prod-stress-20260624` at `725d7d91`. It still had the tracked Next.js report. Thirteen other existing legacy worktrees also retain that historical Next.js path. This is inherited Git content, not evidence of test regeneration. Those other worktrees were inspected without changing them. Do not use old checkouts as production release sources without bringing forward the current security fixes.

In the current application checkout, public-asset tests create generic synthetic files under OS temporary directories and remove them in `afterEach`. The auth regression test requests the retired URL but never writes it. The report remains absent from current public assets and build output after testing.

## Changes made here

- Removed the stale report from this checkout's Next.js public directory.
- Added a reviewed asset allowlist at `apps/web/scripts/security/public-assets.ts`.
- Called that check from `apps/web/next.config.ts`, before development serving or production builds. Unexpected files, directories, and symlinks cause an explicit error. Reader reports and exports must use authenticated routes.
- Added synthetic temporary-directory regression tests, which do not recreate the original report or contain clinical data.

These are local changes in the legacy checkout. No deployment or change to the active migration/prefetch work was made. The current `apps/app` production code already has its own public and build-output guards.

## Verification

- Fetched `oncobase/main`: `193b2ed778fbd50e713cb94db547755e1c749357`.
- Vercel production deployment `dpl_L2KfrwmTgXn3MMjnGRLx7dXux8qg` is READY at that exact SHA.
- Confirmed guard commit `80405636593e36a19309b7b21ec66fa1f54b66f9` is an ancestor of current main. The deployed build command invokes the guarded build script.
- Both `diana-tnbc.com` and `www.diana-tnbc.com`: `/tissue-plan.html` and its `?download=1` variant return 302 to login anonymously, with `Cache-Control: private, no-store`, and 404 after an authorized login. Login cookies stayed in memory and were not printed or saved.
- Current application asset tests: 13 passed. Current public and build-output validation also passed.
- Legacy asset tests: 7 passed. Next configuration loaded successfully. Focused ESLint and `git diff --check` passed.

## What remains unresolved

The affected Codex task is `01a069d1-c1fc-7721-82d3-b866d9f13176` (QA Vite migration parity). Its later turns were blocked with `Potentially unintended activity` while working on unrelated reader optimizations. The user-provided dialog repeats the original migration incident and says guard commit `80405636` was not deployed; that specific claim conflicts with the currently verified deployment.

This does not establish why the review keeps repeating or that every historical concern is closed. The dialog also mentions a previously printed signed login cookie and older deployment/Git-history review. Those historical questions were not resolved by the current-path tests. No secret rotation, deletion of historical deployments, Git-history rewrite, or safety-setting change was performed here. No repository change can be claimed to clear Codex's review state.

## Sanitized feedback draft

Repeated precaution dialogs in Codex task `01a069d1-c1fc-7721-82d3-b866d9f13176` continue to describe an earlier static-asset authorization incident during subsequent unrelated optimization work. Please investigate whether the review is retaining stale remediation state. In particular, it says guard commit `80405636` is not deployed, although the production deployment is verified at descendant `193b2ed7`. Current anonymous requests redirect to login and authenticated requests return 404; synthetic asset regression tests pass and do not recreate the file. Historical token and deployment-history concerns should remain distinguishable from the verified current deployment. Expected behavior: reflect current evidence and explain any remaining actionable concern without repeatedly reporting an obsolete deployment claim. Please do not include clinical report content, authentication cookies, environment files, or raw session logs in the feedback attachment.

The supported feedback entry point is the slash-command menu in the affected task's composer. Review any proposed session attachment before submitting it. See [official troubleshooting guidance](https://learn.chatgpt.com/docs/reference/troubleshooting#feedback-and-logs). This draft has not been sent.
