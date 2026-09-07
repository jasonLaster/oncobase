# Reader spinner: response-body timeout gap

Investigated September 7, 2026 against production commit
`57fe635a8df512faf8f326099c9cc869dd4bcd11`, deployment
`dpl_92EDy1Znzz99PT17RKhQHMHXEhDs`.

## Findings and confidence

The shared content client contains a confirmed indefinite-wait bug. In
`packages/wiki-content/src/index.ts`, `fetchJson` returned `response.json()`
without awaiting it inside its `try` block. JavaScript therefore ran `finally`
and cleared the request timeout as soon as response headers arrived. A body
that never completed could leave session identity, page content, or a full
manifest fetch pending indefinitely.

An initial session identity wait happens before the reader mounts LiveStore.
The existing 15-second LiveStore startup watchdog cannot recover this wait.
The manifest validation helper already awaits its body inside the timeout;
it was not affected.

This is a reproducible way to strand the initial spinner, not a confirmed
attribution of the user's original production incident. No network trace of
that original stalled request was available. A LiveStore follower waiting on
the leader lock is also not sufficient evidence of a deadlock.

## Live checks

Production remained on the same ready deployment. An isolated Chromium
context, using the existing shared-password login flow and public reader,
produced these measured results:

| Scenario | Article visible | Search dialog visible |
| --- | ---: | ---: |
| Fresh context | 3.255 seconds | 4.069 seconds |
| Reload | 1.448 seconds | 2.250 seconds |
| Second tab with the first open | 1.463 seconds | 2.271 seconds |

Session discovery returned 401 for the absent user session and then 200 for
public scope, as intended. Manifest and page requests returned 200. No body
fetch failures or storage fallback warnings occurred in these probes.

The earlier Search nonresponse was not reproduced after explicitly activating
the user's Chrome tab. The native Search button opened the Go to page dialog
and focused Search pages. Background-tab automation affected that earlier
check; it is not evidence of a separate confirmed Search defect. This later
tab was using the public reader, so it does not establish current health of a
private user-session cache.

## Change

Await the JSON body inside `fetchJson`'s existing `try` block. This keeps the
AbortController deadline and timeout error translation active until body
consumption finishes. The configured limits remain 30 seconds for initial
session discovery and the caller's existing timeout elsewhere. No cache,
authentication, database schema, or deployment configuration changes are
needed.

## Regression evidence

Unit tests start a loopback HTTP server that sends successful response headers
and a partial JSON body, then leaves the connection open. They cover
`fetchSessionIdentity`, `fetchPages`, and `fetchManifest`.

The browser regression uses the same real streaming response, because
Playwright `route.fulfill` alone delivers a completed body and would miss the
failure. It verifies that the initial spinner is visible before the deadline,
then advances the browser clock and requires the session error state with the
timeout message and no loading indicator.

Before the fix, the unit request exceeded its deadline and the browser never
entered recovery. With the fix, both the unit and browser regressions pass.

Validation:

- Shared content unit suite: 68 passed.
- Session and LiveStore startup browser suite: 16 passed in Chromium,
  including orphaned locks, silent workers, leader handoff, and cache isolation.
- New browser regression: passed in Chromium and Firefox.
- Production build, app TypeScript, shared content TypeScript, bundle budgets,
  and focused ESLint passed.

The patch was prepared in an isolated checkout. Production was not changed by
this investigation.
