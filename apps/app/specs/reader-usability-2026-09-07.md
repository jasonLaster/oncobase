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

## Legacy sidebar comparison (September 8)

Ran the final Next.js implementation (`52e12889`, the parent of the web-app retirement) in a separate worktree on port 62173, alongside the current production build. The reference needed a local server-auth compatibility adapter for today's backend; its sidebar components and CSS were unchanged. Compared the real homepage in light and dark mode at 1280 × 900.

The earlier checks covered article CSS but missed actual sidebar parity. Restored the measured 16 px directory labels, 14 px desktop files, 30 px rows, root icons at x=18 and nested icons at x=44 (then 18 px per deeper level). Root rows have 4 px separation; the first child has 2 px separation. Restored section emphasis, semantic icons, hover disclosure chevrons, sign-in card styling, and the 40 px Ask/Search controls with a separate divider and non-shrinking icons.

The native sidebar now shares the live icon map and CSS classes, including the workspace, utility links and footer. Wiki opens immediately in the initial response. Native folder navigation still emits only visible branches; the compact public bootstrap and shared snapshot cache remain intact. The small icon-markup cache is bounded by the finite icon set and active state, avoiding repeated React icon rendering for large branches.

New browser regressions hold scripts and the manifest, abort external stylesheets, assert the measured legacy geometry in both themes, compare the entire sidebar before/after handoff, and sample every animation frame for a missing tree. They also exercise deeper indentation, hover disclosure, the initial sign-in destination and the mobile Files control. Streaming tests now scope paragraph assertions to the article because the initial sidebar also contains sign-in copy. Reviewed and refreshed the synthetic mobile navigation snapshot.

Validation for this follow-up: 60 Chromium UI/reader tests passed (one opt-in live probe skipped); the static-preview-only run's legacy redirect assertion requires the real application server and is checked separately against production. All 24 Firefox reader/sign-in cases passed across the main and focused reruns. Twenty targeted server/bootstrap/tree unit tests, the production build/typecheck, and unchanged bundle limits passed. Changed-code lint has no errors; Navigation's existing outline effect still emits its pre-existing state-in-effect warning.

Updated the performance harness to accept HTML-first handoff as readiness instead of waiting forever for the intentionally removed disk snapshot. It now records initial HTML readiness and interactive handoff separately.

Production verification at `51034573` / `dpl_8n8keH8rafKCCa5saosBTjGHhUUS`: all 26 measured desktop sidebar rows/controls match the Next.js reference in position, dimensions, font, weight, color, padding, gaps, radius and icon geometry/opacity. Light/dark native-to-interactive checks, real Search, nested folder expansion, JavaScript-disabled reading/navigation, and long-page reading-position preservation passed with zero browser errors. The real legacy redirect returned 308 to its canonical index, resolving the static-preview test limitation.

Two fresh desktop startup-only runs (unthrottled) measured FCP 264/136 ms and interactive article appearance 1215/1091 ms; reloads measured FCP 68/68 ms and article appearance 417/418 ms. These are small-sample observations and do not establish a universal 200 ms bound. The broader navigation benchmark timed out on its extra `/about/Index` navigation; it is excluded from these startup results. Private screenshots and measurements stay in local `.playwright` artifacts.
