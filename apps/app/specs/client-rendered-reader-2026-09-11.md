# Client-rendered reader — September 11, 2026

The reader now renders through React from startup. Initial documents contain an empty application root, normal styles and scripts, route metadata, and a JavaScript-required notice. No server article/sidebar or saved HTML copy is shown and later replaced.

## Runtime changes

- The deployed root handler always selects the client-rendered app. `WIKI_HTML_FIRST`, `WIKI_HTML_FIRST_EXPERIMENT`, and `WIKI_HTML_CDN` cannot re-enable the handoff.
- Edge middleware no longer rewrites document requests into the old HTML CDN namespace. It strips internal reader headers and rejects the retired namespace; the application handler continues to enforce the password gate.
- The entry document no longer restores saved HTML, disables cloned controls, or hides React behind a snapshot. Startup retires old HTML cache entries. Structured content caches and their identity boundaries remain active.
- Removed the component that cloned and saved rendered HTML. Cache retirement now depends on validated reader data, without waiting for DOM capture.
- Removed the HTML-specific temporary-store shortcut and sidebar presentation-cookie writes. The normal client storage fallback, saved folder preferences, immediate mounted palette, and queued startup shortcuts remain.

The old renderer remains reachable only through the explicit local experiment harness and its tests. It is not selected by deployment configuration. The separate Next.js comparison branch is unchanged.

## Verification

Build, type checking, bundle budget, scoped lint, and 544 unit tests pass. Browser coverage includes held startup scripts, old saved HTML, refreshed keyboard shortcuts, anonymous account dialogs, mobile navigation, unavailable storage, data cache retirement, background refresh, saved widths, delayed workers, and history. Real-data checks exercise the same entry paths without replacing backend responses. Tests do not submit account forms, chats, or comments.

The intended tradeoff is that initial content waits for JavaScript. Loading UI is rendered by React; displayed reader controls are never inert clones awaiting a handoff.

## Production result

Runtime release: `37c1a333551e8d7d29c6ebae26ce936b8b21df48`, deployment `dpl_6dypwA9VQVLnhz2ucAM3UgFMd18z`, verified at `https://diana-tnbc.com`.

Local verification finished with 544 passing unit tests and 151 passing browser checks, plus one intentionally skipped opt-in live probe. The lifecycle run initially hit an obsolete snapshot-readiness assertion; its corrected cache-refresh test passed on rerun.

The production matrix covered 90 cases across Chromium, Firefox, and WebKit at desktop and phone widths. The first run produced 83 passes, 4 failures, and 3 intentional skips (desktop saved-folder checks on phone layouts). Two Firefox failures came from Playwright retrieving an intercepted navigation response body; the regression now inspects the actual document with scripts held instead. Chat tests release the artificial network interception before ordinary reload.

After rerunning both affected scenarios in all six configurations, the combined result is **86 passing cases, 1 failing case, and 3 intentional skips**. The remaining failure is the WebKit phone chat history/reload test's strict browser-error assertion: canceled manifest, page, and account-session requests report access-control errors. Its navigation, history, reload, and composer assertions pass. The analogous WebKit cancellation diagnostic existed before this change; it remains reported rather than suppressed. This result does not establish that every browser flow is error-free.

No same-origin 5xx responses were captured by the matrix. Deployment log sampling also returned no 5xx records. Private screenshots, traces, and runtime error details remain local under `.playwright/csr-production-first-matrix/` and `.playwright/production-reader/`.
