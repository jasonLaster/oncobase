# React Doctor client rendering audit — 2026-09-27

React Doctor 0.9.14 scanned the existing working tree across the Vite app and six React packages. Unrelated work was preserved. These scan counts describe the original working tree at audit time, before the release commit.

```sh
npx -y react-doctor@0.9.14 . --yes --no-supply-chain --no-telemetry --json --json-out /tmp/oncobase-react-doctor.json
```

The comparison below includes only each project's `src/` diagnostics, excluding backend, scripts, and generated server bundles. No score service was used. The adjacent JSON preserves the normalized findings.

| Client source diagnostics | Before | After |
| --- | ---: | ---: |
| Performance warnings | 15 | 6 |
| All findings | 176 | 163 |

## Changes

- Memoize chat runtime and comment menu context values to avoid notifying consumers on unrelated parent renders.
- Reuse four Intl formatters, preserving locale, timezone, and precision options.
- Keep transient IME composition state in a ref while preserving Enter submission guards.
- Stabilize the file palette's empty recent-slug default and close callback, reading the latest committed handler without restarting its focus/overflow lifecycle. Move scrolling outside the state updater.
- Initialize command palette outline/recent data on mount, reset selection in query/mode events, and key the host by requested mode. The host already unmounts closed palettes. Use an effect event for Escape and clean up the focus timer.
- Cache parsed and sorted tag counts independently of the query, avoiding a full page-tag parse and sort on each keystroke.
- Lazily initialize the calculator's formatted slider draft.

## Validation and limits

- Typechecks pass for the app and all four changed packages.
- Targeted app ESLint checks, production build, and `git diff --check` pass. Large-chunk build warnings remain.
- 74 unit tests pass: wiki-shell 36, diagnostics 19, wiki-comments 10, chat 9.
- All 24 command-palette Chromium tests pass, covering keyboard selection, mode shortcuts, focus restoration, scroll reset, and theme-driven parent rerenders.
- The added theme test also passes against the original file palette. It is compatibility coverage, not evidence of a reproduced old callback-reset bug.
- The initial browser run failed before article mounting with Vite's `504 Outdated Optimize Dep`; subsequent server runs passed.

No interaction latency or React Profiler timing improvement was measured. This is static optimization plus functional validation.

The six remaining client performance warnings involve array lookup patterns, a DICOM inversion flag, attachment URL lifetime, serial local DICOM processing, and SearchPage results-query state. SearchPage's state is read through a memo, so the tool's handler-only claim should not be blindly applied. Serial DICOM work needs a memory/concurrency review. Other effect, DICOM annotation, accessibility, and maintainability findings remain. No findings were suppressed to improve the counts.

## Release validation

The scoped patch applied cleanly to remote `oncobase/main` at `5a6cf53a` in a separate worktree. App build/typecheck, changed-package typechecks, 74 package unit tests, targeted lint, and all 24 command-palette Chromium tests also passed on that release base. Unrelated original-checkout work was excluded. The first release browser run exposed an existing clock setup race (`Cannot fast-forward to the past`); setting a fixed installation time and pausing one second later makes the shortcut timing test deterministic.
