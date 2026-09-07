# Ranked background page caching

After the visible page and its manifest are ready, the reader warms likely next
pages one at a time. Opening a warmed page uses its cached body immediately. A
body older than 30 seconds revalidates on navigation without removing the visible
content; changed manifest hashes also trigger replacement of stale content.

## Ranking

`convex/pageVisitStats` stores one aggregate row per site and page: slug, priority,
and last visit time. It stores no reader identity or individual browsing history.
The gated application server records visible-page visits after the reader is
idle. Prefetch GETs never record visits. Repeated visits are coalesced per page
within one minute on the backend and within ten minutes in the mounted reader.
This is a popularity signal, not an exact page-view counter.

Scores combine visit frequency with exponential recency decay, using a 30-day
half-life. Log-space scores allow an indexed descending query without periodic
rescoring jobs. The backend reads at most 300 ranked rows, appends configured
preview seed slugs for cold starts, and rechecks documents for deletion. HTTP
responses filter sensitive candidates through the reader's current access scope
and return at most 200 slugs, without counts or timestamps.

## Resource policy

- Keep the active page first, then up to 20 recent pages, then the global ranking,
  then other recently fetched cached bodies.
- Target at most 150 bodies and 8 MiB of UTF-8 body content. Keep the active page
  even if it alone exceeds the budget. Actual fetched bytes are checked before a
  background body is stored; manifest sizes reserve a conservative UTF-8 bound.
- Evict only body rows, preserving the manifest and navigation metadata. Older
  cached bodies are measured in SQLite so prior UTF-16 size fields cannot
  undercount them. The planner does not copy body strings into JavaScript.
- These limits are for materialized body content, not the whole LiveStore
  database. Its event log and indexes add overhead; eviction does not compact
  historical events. Stop background work at 80% of the browser storage quota.
- Wait for two seconds of idle time. Use one request at a time; yield to user
  input, navigation, active body refreshes, and manifest validation. Pause when
  offline, hidden, saving data, on a slow 2G connection, or under storage pressure.
- Refresh rankings every five minutes. Failed ranking requests back off for that
  interval; cancellation to serve foreground work remains immediately retryable
  after the normal idle delay. Body failures also receive bounded backoff.
- The manual Warm cache action uses the same scheduler and budgets, with an
  additional bounded fallback list when ranking history is sparse.

## Link intent and early page context

A mouse hover or keyboard focus held for 350 ms promotes one known document to
an intent fetch. Delegated listeners cover document and sidebar links without
per-link subscriptions. Brief pointer flyovers, touch pointers, external links,
downloads, links with query parameters, same-page anchors, and unknown manifest
slugs are ignored. The next available scheduler turn skips ranking/visit work to
fetch the intended body; an already-running background request remains serial.
Intent never generates visit counts and observes the same count, byte, visibility,
network, storage-pressure, and foreground-work restrictions as normal warming.

While an uncached public document loads, its local manifest supplies its real
title, tags, and description. The body remains an accessible loading placeholder.
The shared document layout keeps the title at the same coordinates when the body
arrives, including on mobile. Sensitive or unknown destinations retain a neutral
skeleton until their body/access result resolves. Cached bodies keep the existing
stale-while-revalidate behavior.

`e2e/reader-intent.spec.ts` proves mouse and keyboard warming by blocking all body
networking before navigation, exercises speculation exclusions/resource pressure,
and holds body responses to verify useful early context and stable title geometry.

## Authorization and configuration

The existing site password gate protects `/api/wiki/prefetch`. Session-scoped
rankings also require a valid user session and filter protected slugs using the
same access service as content reads. Visit POSTs require a same-origin JSON
request and an accessible, existing document. Responses are private and no-store.

Direct Convex ranking and visit functions require `WIKI_PREFETCH_SECRET`, a
server-only random key of at least 32 characters. Configure the same value in
the Vercel production application and its Convex deployment. Never expose it
through a browser-prefixed variable. Missing configuration disables global
ranking and recording without breaking reading or explicit/local cache warming.
Preview environments should use their own backend/key pairing when enabled.

Browser fixtures mock the ranking endpoint by default. Real-backend QA sends
`x-wiki-test-run: 1` to opt out of visit recording; this does not grant reader
access or bypass the password gate. Temporary persistent WebKit profiles use
unique loopback origins and an in-memory cleanup response. Test content and
storage state are not copied into public assets or committed.

## Verification

Unit coverage exercises decay arithmetic, direct backend key enforcement,
site-scoped reads and writes, reload coalescing, deleted pages, HTTP access and
CSRF boundaries, cache count/byte limits, and body-only eviction.

Browser coverage exercises a prefetched page opening without another body
request, foreground-first loading and revalidation, cancellation on navigation,
retry after an interrupted ranking request, resource-pressure pauses, and stale
content hot-swapping without a loader. The foreground-refresh and interrupted-
ranking tests both failed before their corresponding scheduler fixes.

Run the browser suite against a local production build with global recording
disabled and the usual fixture password. Use a fresh loopback server port and
keep artifacts in the ignored `.playwright/` directory. Commands:

```sh
bun --cwd apps/app test:unit
bun --cwd apps/app build
bun --cwd apps/app check:bundle
# Set PLAYWRIGHT_BASE_URL and the authorized test login password externally.
bun --cwd apps/app test:e2e e2e/background-prefetch.spec.ts e2e/manifest-cache.spec.ts e2e/page-load-experience.spec.ts e2e/reader-performance.spec.ts e2e/auth-gate-security.spec.ts
```

Production verification must confirm the exact pushed SHA, deployment and hosted
checks, an enabled authenticated ranking response, and preserved anonymous gate
behavior. Do not infer live enablement solely from local mocked tests.
