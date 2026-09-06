# Vite cutover QA

Status at this checkpoint: **not yet promoted**. `diana-tnbc.com` and `www`
remain on Next. Epic is excluded at the owner's direction. Private traces,
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

## Verified before the new deployed-candidate run

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
result authorizes promotion. The new dependency patch must pass the exact
deployed-candidate gate before changing production domains.

The Next baseline also failed shared assertions: inline-link accessibility,
mobile archived-chat navigation, mobile comment sign-in visibility, and a text
search readiness deadline. These are not evidence of new Vite regressions, nor
are they a reason to weaken the shared assertions. Full Next/Vite visual parity
has not yet been established by these interrupted baseline phases.

## Production configuration and remaining release gate

Both frontends use the same production Convex backend. Existing gate/account
cookies and permission revocation were exercised across frontends. Vite uses
same-origin APIs, and its Liveblocks webhook rejects an unsigned request as an
invalid signature. Actual provider webhook delivery remains unverified.

Only the `diana-tnbc.com` and `www.diana-tnbc.com` project domains are in cutover
scope. Keep the Next project and its deployment for rollback; do not move the
Susan domain. Record the exact deployment SHA and domain mapping immediately
before promotion, then repeat real-hostname functional, security, visual and
cleanup checks after promotion. A known core reader failure blocks cutover.
