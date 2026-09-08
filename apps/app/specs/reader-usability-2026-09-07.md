# HTML-first reader usability follow-up

The initial HTML reader must include working file navigation, hand off to a usable application, and expose recovery actions when startup fails.

## Changes

- Render native file-tree disclosure controls and document/file links from the published public manifest. Current document ancestors start open. Mobile readers have a native Files disclosure.
- Send only the top level and current/selected branches. Native folder links select a branch with `?tree=...`; the full interactive tree follows when the app starts. This avoids transferring more than 1 MiB of mostly hidden navigation markup on every page.
- Send the small native tree before article markup, so it is visible even while a long article is still streaming. Seed the interactive sidebar from a compact public tree in the same response; a delayed manifest no longer causes an empty sidebar at handoff. This presentation-only seed never marks a manifest current or suppresses access validation, and the authoritative tree replaces it even when empty.
- Key HTML by deployment identity as well as content/policy so old asset references cannot be reused after a release. A missing entry module retries once, then retains native reading/navigation with an explicit Reload link.
- Include the complete site revision in the HTML cache fingerprint: a change to another document can change this page's navigation too.
- Start HTML-first readers with tab-local storage. A cache worker belonging to another deployment/tab cannot delay these readers. The ordinary SPA still uses its persistent cache, with a three-second deadline before its existing temporary fallback. Existing disk caches and other tabs' locks are preserved.
- Accept a fresh live article even when it supersedes the HTML content hash or has no usable bootstrap payload. Keep waiting for the matching route. The complete compiled stylesheet is inlined and retained for the application, avoiding a second CSS download and a cascade change at handoff.
- Expose terminal store/session/app and page-fetch recovery states rather than hiding their actions behind the initial HTML.
- Preserve failed-import errors while an automatic reload is pending; swallowing the Vite error can resolve a lazy import as undefined. Allow one automatic reload per entry build rather than exhausting recovery for an entire tab session.
- Bound animation-frame scheduling of the app entrypoint so background tabs can start too.

## Validation

Synthetic browser cases cover JavaScript-disabled folder navigation, mobile navigation, held JavaScript/CSS, changed/invalid/missing bootstrap payloads, long-article fragments and scroll position, restrictions, session recovery, silent workers, old-version leaders, orphaned locks, and healthy follower tabs. Unit coverage checks navigation escaping, encoded HTML invalidation after a navigation-only revision, and the existing access/cache contracts.

The live public manifest was read using the existing server identity and prefetch configuration. It contains 6,622 document/file entries, reachable through the branch navigation. HTML-first storage is a tab-local online cache; persistent cache warming across reloads is not provided by this path.

## Styling and navigation continuity

The selector-based critical CSS extraction omitted utility rules and stylesheet dependencies. The initial response now includes the exact compiled CSS cascade. Desktop and mobile browser tests compare headings, links, lists, quotes, inline code, and utility layouts before and after applying the built stylesheet. The application remains styled and Search works with every stylesheet request blocked; no external CSS request is needed for startup.

The complete public tree is 375,623 bytes as compact JSON in the measured site snapshot, rather than more than 1 MiB of hidden DOM. It arrives after the readable article, then seeds the sidebar before consumers mount. The native branch remains in the streaming prefix. Tests hold the manifest indefinitely while expanding a live folder and verify removed entries disappear when the authoritative manifest arrives.

## Continued optimization

A fresh server navigation snapshot read measured 612–710 ms locally against production. The compact public tree is now shared through Vercel Runtime Cache by site and full content revision. Function instances can reuse it without another snapshot query/download. Concurrent reads are coalesced; failed snapshots are retried; a shared-cache lookup has a 100 ms deadline and falls back to the authoritative snapshot. Gate decisions and session trees are never stored here.

The full inline stylesheet remains through handoff, removing the duplicate stylesheet transfer and load dependency. The LiveStore shell budget grows by 128 bytes to account for the navigation seed hook (measured output 16,678 gzip bytes); all other bundle limits remain unchanged.

Run SQLite-heavy unit suites separately: the fixed-size WASM heap can exhaust its 16 MiB allocation when all store suites share one Bun process. The 6,600-entry manifest regression passes in its own process. Production browser verification must also confirm the real manifest imports successfully.

Production rollout and performance measurements are recorded after browser verification. The original 200 ms target concerns initial readable content; interactive readiness is measured separately.

Validated locally: 32 Chromium browser tests, 23 Firefox reader tests, 126 server/bootstrap/unit tests plus 7 isolated LiveStore schema tests, TypeScript, changed-code lint, and bundle budgets. Desktop/mobile screenshots are retained in the local verification artifacts.
