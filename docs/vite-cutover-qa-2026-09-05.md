# Vite cutover QA

Status: **promoted** on September 5, 2026 (approximately 01:14 UTC September 6).
`diana-tnbc.com` and `www.diana-tnbc.com` now serve Vite at application release
`b1b19bbcef467826ae837ae095cbb4fe86a9deea`. The application code is unchanged
from `1f90eff4`; the intervening commit only aligns the shared text-search
assertion with the existing 30-second product latency budget. Epic is excluded
at the owner's direction. Private traces,
screenshots, backend receipts and deployment identities are retained locally
under `.playwright/cutover/`; do not upload them to this public repository.

## Findings and changes

- Deployed reader reloads exposed an exclusive OPFS-handle race in LiveStore
  0.3.1. A document-unload worker termination hook did not solve it and was
  removed. The dependency patch retries only `NoModificationAllowedError` when
  acquiring existing files, up to 40 times at 50 ms intervals. It preserves
  exclusive locking and all cache data; permission and other errors still fail
  immediately. The analogous upstream investigation is
  [LiveStore #244](https://github.com/livestorejs/livestore/issues/244).
- Cached first-frame HTML must disappear before a checkpoint can count as an
  interactive reader. Hidden empty snapshot containers on standalone pages do
  not count as visible cached content.
- Prose-link CSS overrode heading-anchor opacity and decoration. Excluding
  heading anchors restores hover/focus behavior without removing the accessible
  underline from inline prose links.
- Earlier in this cutover pass, Vite session responses were aligned with Next's
  public user ID and creation timestamp. Shared cross-version tests now verify
  cookie transfer, role changes and backend sign-out revocation.
- The shared real chat story now verifies provider response persistence, Stop
  propagation, reload after cancellation, archive and restore. It deletes the
  exact owned conversation and messages after browser closure; account,
  comment, guest and isolated annotation fixtures similarly verify teardown.
- The scoped missing AVIF repair restored only the published asset previously
  identified by content hash. No general vault publication was performed.

## Earlier focused verification

| Check | Evidence |
| --- | --- |
| Cross-version sessions, both directions and browsers | 4 passed on deployed Next/Vite at `8d66900a` |
| Production-build rapid reloads | 40 reloads across Chromium/WebKit and 393/1440 px; keyboard interaction after every reload |
| Heading hover/focus and prose-link styling | Passed in Chromium and WebKit |
| Real chat response, Stop, archive/restore | 2 passed on the local production build, with real backend cleanup |
| Vite unit tests | 119 passed |
| Markdown unit tests | 46 passed |
| Typecheck, production build, repository lint | Passed; lint command uses the repository's configured package scope |
| Frozen dependency install | Passed with the committed SQLite patch |
| Bundle gate | Passed with an explicit 500-byte gzip allowance for bounded OPFS acquisition; no chunk-budget removal |
| Independent completed-phase reconciliation | 261 journals checked; all owned records absent, zero unfinished journals at that checkpoint |

These are separate, named phases—not a single clean full-suite run. Earlier
candidate failures remain in their original reports. The hosted `8d66900a`
candidate passed 54 cases before the reload failure; a further discovery phase
passed 58 before the same race appeared on unknown-route navigation. Neither
result alone authorized promotion. The subsequent deployed-candidate results
below established the release gate for the dependency patch.

The Next baseline also failed shared assertions: inline-link accessibility,
mobile archived-chat navigation, mobile comment sign-in visibility, and a text
search readiness deadline. These are not evidence of new Vite regressions, nor
are they a reason to weaken the shared assertions. Full Next/Vite visual parity
was not established by those interrupted baseline phases alone.

## Deployed candidate and paired visual evidence

- All 110 distinct Chromium scenarios have passing results across the initial
  candidate and remaining-case phases. The initial run stopped at a 20-second
  text-search assertion; the shared assertion now uses the existing 30-second
  text-search budget. The initial failure is retained, not erased by rerunning.
- The full candidate WebKit phase passed all 110 scenarios with no retries.
- Paired Next/Vite runs passed 43 scenario pairs with 71 matched screenshot
  checkpoints across Chromium and WebKit. These were separate phases, not one
  uninterrupted green matrix. The Next mobile calculator reload emitted RSC
  prefetch errors; its failed baseline trace remains available, and that case
  was explicitly excluded from the separate 21-pair WebKit completion phase.
- Reviewed screenshots include mobile reader/navigation, desktop tables,
  landscape decoded DICOM comparisons and the edited calculator. Small sidebar
  typography, spacing and icon differences remain; this is not pixel identity.
  The largest measured differences were in mobile navigation (2.52% Chromium,
  1.98% WebKit); pixel percentages are evidence, not automatic approval.
- Immediately before promotion, both hosts exposed identical inventories of
  6,628 public pages and content hashes. This checks manifest equality, not an
  independent byte hash of every page body.
- All applicable CI checks passed for `b1b19bbc`, including all four deployed
  Vite shards, WebKit smoke, macOS visual, unit, static and server checks.

The retained directories distinguish candidate, paired, interrupted and live
phases. Passing and failing traces remain local; none are public CI artifacts.
Successful service and persistence stories use real backends. Deliberate
empty/error and delayed-response tests still inject or hold failures to verify
the UI's handling; those do not count as provider or persistence evidence.

## Post-promotion production QA

Against `https://diana-tnbc.com` at `b1b19bbc`:

| Phase | Result |
| --- | --- |
| Full Chromium shared suite | 110 passed, 0 failed/skipped/flaky; 11.2 minutes |
| Full WebKit shared suite | 110 passed, 0 failed/skipped/flaky; 12.2 minutes |
| Retained live traces | 220, one per test; screenshots and DOM snapshots included |
| Fresh gate/API smoke | Apex and www passed anonymous rejection and authenticated manifest reads |
| Existing browser continuity | Original cookie and service worker survived promotion; interactive reload passed |

The live phases used real services with exact-owned fixture cleanup, no test
retries and no Firefox. Coverage includes responsive reader/keyboard flows,
rapid reloads, real chat response/Stop/archive/restore, comments, isolated image
annotations, decoded imaging, PDF ranges, AVIF, text/AI search, canonical URLs,
forged-cookie rejection, account revocation and calculator URL restoration.
The session peer during these live runs was www, which now also serves Vite;
these are hostname-continuity results, not additional cross-Next/Vite evidence.

Independent reconciliation after both live phases checked 844 completed journal
files (including retained attachment copies), found zero unfinished journals,
and passed all 47 fresh backend absence checks. Test-owned guests, accounts,
conversations/messages, annotation fixtures and comment threads were absent.
The timestamped private receipt is from 2026-09-06 01:31:07 UTC.

## Production configuration and rollback

Both frontends use the same production Convex backend. Existing gate/account
cookies and permission revocation were exercised across frontends. Vite uses
same-origin APIs, and its Liveblocks webhook rejects an unsigned request as an
invalid signature. Actual provider webhook delivery remains unverified.

Only the `diana-tnbc.com` and `www.diana-tnbc.com` project domains were moved.
The Susan domain remains on Next; the shared Next project was retained.
Private before/after receipts record exact project and deployment identities.
Rollback is the reverse domain move for these two hostnames only, followed by
alias and sign-in/reader verification. Do not delete the Next project or move
Susan as part of a rollback.

A pre-cutover persistent browser profile retained its original signed cookie
and Next service worker. After promotion it loaded Vite, expanded the reader
table, reloaded and opened the keyboard palette without signing in again.
The old worker only handles compact file-tree requests, not document navigation.
Manual Chrome exploration on the live hostname also passed reader/table,
palette lookup and post-reload interaction using the existing browser session.
