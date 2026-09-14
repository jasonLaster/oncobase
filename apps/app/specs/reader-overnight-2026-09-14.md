# Overnight reader startup work — September 14, 2026

Target: initial usable reader below 500 ms while preserving client-side React, LiveStore, access isolation, and article continuity. Baseline production commit: `050c1ac3`.

## First release candidate

- Reuse a valid same-response public page payload to identify the public store on an explicitly public cold visit. Automatic visits may do so only when the server explicitly verified no account session and the gated HTML response is private/no-store. Shared HTML and saved browser identities cannot choose automatic scope. Identity refresh continues in the background, and the normal LiveStore boot path consumes the data.
- Deduplicate account lookups within one incoming request and site. Every subsequent request revalidates the session; errors are not retained across requests.
- Load the 76.0 KiB gzipped math engine only for documents with possible math. Prefetch it from the initial payload when needed. Server rendering retains its synchronous math support; an update introducing math keeps the previous article mounted until the engine arrives. Currency, fenced math, raw HTML math and equations retain their rendering behavior.
- All six vendor bundle URLs and bytes remain unchanged under an ordinary application edit, with no imports back into application chunks. Browsers can retain HTTP and bytecode caches; bytecode reuse itself is browser-controlled and was not measured.

## Controlled measurements

Article readiness is the visible React `.wiki-markdown` body, followed by 900 ms observing retractions and DOM-node continuity. Navigation records visible sidebar links. Each cell has three alternating-order samples, 48 loads total. The fixture uses fresh browser contexts for cold visits and reloads each context, a shared Chromium process, two synthetic pages, loopback HTML (about 1–4 ms), 200 ms identity latency, 400 ms manifest latency, and 350 ms body latency. Both distributions use the current synthetic server and the real gated-response handler; the baseline client ignores the new verified flag. Raw synthetic evidence is in `reader-overnight-2026-09-14.json`.

| CPU | Scope | Visit | Article before → after | Navigation before → after |
| --- | --- | --- | --- | --- |
| Normal | Explicit public | Cold | 476 → 281 ms | 469 → 274 ms |
| Normal | Explicit public | Reload | 134 → 132 ms | 132 → 130 ms |
| Normal | Automatic signed out | Cold | 466 → 287 ms | 460 → 280 ms |
| Normal | Automatic signed out | Reload | 316 → 134 ms | 312 → 131 ms |
| 4× slower | Explicit public | Cold | 715 → 634 ms | 693 → 609 ms |
| 4× slower | Explicit public | Reload | 320 → 311 ms | 313 → 303 ms |
| 4× slower | Automatic signed out | Cold | 704 → 618 ms | 680 → 594 ms |
| 4× slower | Automatic signed out | Reload | 402 → 304 ms | 394 → 297 ms |

All 48 loads had zero page-body requests, errors, article retractions, or body-node replacements. The earlier explicit-public-only experiment independently reduced normal cold loads from 473 to 289 ms. The math split's demonstrated benefit is 76 KiB less initial compressed JavaScript; this loopback experiment does not establish an additional CPU improvement from it.

These are controlled medians, not a production or device-wide sub-500-ms claim. Slow cold CPUs remain above target, and production HTML latency, network bandwidth and real document complexity still need accounting.

## Validation

- 18 Chromium and 18 WebKit browser checks passed: bootstrap fallback, delayed identity, restricted-account routes, public/session isolation, no store restart after identity refresh, currency/math rendering, optional math requests and article continuity while math loads.
- 38 focused bootstrap/session/math-loader unit tests and 48 renderer/session parity tests passed.
- Production build, app and shared Markdown typechecks, changed app-file ESLint, bundle budget and ordinary-edit vendor-cache check passed.
- React Doctor reported no errors. Warnings include existing WikiPage complexity and a two-page benchmark array lookup; moving the renderer preserved its public helper exports (Fast Refresh warnings). The browser wrapper intentionally retains previous committed document props for continuity, so they cannot be derived from the new props while math is pending.

## Safety and rejected shortcuts

- Do not replace the article during bootstrap-to-live updates or weaken cache partitioning.
- Do not assume a public page means the current account is signed out.
- Directly calling `loadSqlite3Wasm` to warm the worker would create an extra SQLite instance: the installed loader is not memoized.
- Pre-creating a LiveStore worker can lose its ready message before provider listeners attach. Avoid a new worker-pooling protocol solely for a benchmark.
- Keep LiveStore's fast snapshot path disabled: rapid reloads previously exposed partial SQLite snapshots.
- The math vendor group must have lower priority than Markdown so shared helpers do not pull the optional math engine into the eager graph.

## Continuation

Next bounded experiment: preload the reader's existing static module graph from initial HTML, only on reader routes, to overlap module downloads with entry startup. Preserve login and independent-tool isolation; do not preload optional features. Adopt only after measurement and browser checks.

This report is a live checkpoint. The heartbeat is `diana-overnight-startup-optimization`, hourly for eight runs, with a stop boundary of September 14 at 08:00 America/Los_Angeles. Worktree: `/Users/jasonlaster/.codex/worktrees/reader-bootstrap-cache/oncobase`. Preserve the dirty primary checkout. Do not claim the target based on a spinner, HTML response time, or one minimum sample.
