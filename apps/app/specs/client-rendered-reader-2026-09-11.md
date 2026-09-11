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
