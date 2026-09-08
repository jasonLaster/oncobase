# HTML-first reader usability follow-up

The initial HTML reader must include working file navigation, hand off to a usable application, and expose recovery actions when startup fails.

## Changes

- Render native file-tree disclosure controls and document/file links from the published public manifest. Current document ancestors start open. Mobile readers have a native Files disclosure.
- Keep collapsed branches as inert text until opened when scripting is enabled; without JavaScript their complete native markup is available.
- Send article markup before the full tree, reserving sidebar space so streaming the tree does not move the article.
- Include the complete site revision in the HTML cache fingerprint: a change to another document can change this page's navigation too.
- Start HTML-first readers with tab-local storage. A cache worker belonging to another deployment/tab cannot delay these readers. The ordinary SPA still uses its persistent cache, with a three-second deadline before its existing temporary fallback. Existing disk caches and other tabs' locks are preserved.
- Accept a fresh live article even when it supersedes the HTML content hash or has no usable bootstrap payload. Keep waiting for the matching route and applied stylesheet.
- Expose terminal store/session/app and page-fetch recovery states rather than hiding their actions behind the initial HTML.
- Bound animation-frame scheduling of the app entrypoint so background tabs can start too.

## Validation

Synthetic browser cases cover JavaScript-disabled folder navigation, mobile navigation, held JavaScript/CSS, changed/invalid/missing bootstrap payloads, long-article fragments and scroll position, restrictions, session recovery, silent workers, old-version leaders, orphaned locks, and healthy follower tabs. Unit coverage checks navigation escaping, encoded HTML invalidation after a navigation-only revision, and the existing access/cache contracts.

The live public manifest was read using the existing server identity and prefetch configuration. It contains 6,622 rendered document/file links. HTML-first storage is a tab-local online cache; persistent cache warming across reloads is not provided by this path.

Production rollout and performance measurements are recorded after browser verification. The original 200 ms target concerns initial readable content; interactive readiness is measured separately.
