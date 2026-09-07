# Reader startup stall, September 6, 2026

## Observed incident

The production domain responded with HTTP 200 at login, but an authenticated
reader stayed on its loading skeleton. The user's console reported a LiveStore
follower waiting for `livestore-tab-lock-wiki-vite-reader-v4-diana-public-...`
and `GetRecreateSnapshot` taking longer than two seconds. Closing the site's
browser tabs and reopening resolved it. A diagnostic browser visit also remained
on the loading skeleton.

The original lock holder and worker state were not captured before recovery.
We cannot identify the exact initiating race retrospectively. In particular,
the lock-wait message alone is normal follower behavior, not proof of a deadlock.

## Source examination

Baseline: `4a76d399` on `oncobase/main`; LiveStore 0.3.1, with the existing OPFS
promise patches and disabled optimistic snapshot fast path retained.

- The persisted adapter elects a leader with an origin/store Web Lock. Followers
  queue for leadership in the background, while requesting a snapshot through
  the shared worker. They do not need to own the lock to boot normally.
- Shared-worker request forwarding waits for a leader context. A missing or
  silent leader/shared worker can leave snapshot acquisition pending. The
  library logs slow requests but does not turn this into a boot error.
- Existing app retry logic only handles reported/thrown errors. It has no
  deadline for a silent store, or for the preceding OPFS availability probe.
- Cached first-frame HTML hides the React root until hydration completes. A
  recovery UI must dismiss it explicitly.
- Default LiveStore session IDs use sessionStorage, which duplicated/opener tabs
  can copy. That is distinct from the shared client ID, which should persist.
- Retry state previously survived identity changes. The provider also handles
  prop changes internally; an explicit keyed identity boundary avoids reusing
  any boot/retry state across site/scope/cache-key changes.

## Changes

1. Bound the OPFS probe to three seconds. Denial, absence, or silence selects the
   existing in-memory adapter. Consume late rejections and never let late success
   replace a temporary store already running.
2. Give each loading attempt a 15-second deadline, independent of stage updates.
   On persistent-store timeout, unmount the provider and boot temporary storage.
   LiveStore's unmount cleanup cancels the old Effect scope and its lock request.
   Do not steal locks, broadcast a reset, or delete persistent databases.
3. If temporary storage also stalls, show a finite recovery state with Reload
   and instructions to close other tabs/restart the browser. Handle intentional
   provider shutdown with the same visible recovery controls.
4. Cancel watchdogs during layout cleanup, including successful startup and
   StrictMode cleanup. Reset recovery and retry state by full store identity;
   remount the error boundary per retry rather than updating an unmounted one.
5. Give each document a fresh session ID, while preserving the stable store ID,
   client identity, schema and public/session partitions.
6. Dismiss read-only first-frame HTML when entering fallback or recovery.

## Tradeoffs and limits

Temporary storage is an online reader cache. It needs the API to repopulate and
is not retained after reload; the existing persistent cache is left intact.
The next full load attempts persistence again. We do not permanently disable
storage or migrate/bump the cache generation. Browser suspension can delay timer
execution until JavaScript resumes. This change bounds startup; it is not a
health monitor for an already-running store or a fix for server/network outages.
No production deployment is part of this change.

## Validation

See the final validation results recorded below. Browser scenarios use synthetic
API fixtures against the compiled production build on loopback, with a local
preview test-auth value; they do not publish data or modify production settings.

- App unit suite: 162 passed, zero failures. The focused storage/retry/cache
  suite also passed (37 tests, included in the broader suite).
- Production build and TypeScript checks passed. Existing large-chunk advisory
  remains; the enforced bundle budget passes (reader shell 15.9 KiB gzip against
  a 16.0 KiB limit). Recovery UI loads only when needed.
- Focused ESLint and `git diff --check` passed.
- Chromium and Firefox each passed the eight storage availability/privacy tests
  (denied, absent storage, absent getDirectory, and never-settling probe).
- Startup fault tests cover orphaned lock ownership/data preservation and lock
  request cleanup; healthy followers and leader handoff; repeated reloads;
  silent shared workers behind a cached first frame; silent SQLite/WASM with a
  terminal recovery screen; leaving during boot; different shared-worker URLs
  across a deployment; and copied legacy session IDs. Final rerun results below.

The version-overlap test changes the shared-worker script URL while a healthy
older tab retains the leader lock. The new tab reaches the startup deadline,
recovers, and the older tab remains interactive. This establishes a reproducible
failure class, not retrospective proof of the original incident's trigger.

WebKit was not run for this change. Its ephemeral contexts deny OPFS; durable
multi-tab lock behavior needs the repository's dedicated persistent-profile
fixture, rather than treating a memory-fallback pass as OPFS coverage.

Final production-build rerun: all seven startup scenarios passed in Chromium
and all seven passed in Firefox (about 1.6 minutes per browser), including the
explicit timeout assertion for version overlap, seeded `livestore:sessionId:`
legacy IDs, and advancing the clock after healthy startup to detect stale timers.
Together with the eight availability cases per browser, 30 browser cases passed.
The terminal recovery screenshot was visually inspected: heading, guidance and
Reload button are visible, with no cached first-frame overlay.

Reproduction tests: `apps/app/e2e/store-startup.spec.ts` and
`apps/app/e2e/storage-availability.spec.ts`. Run with Playwright against a built
loopback standalone server and the repository's local preview test-auth setup.
Do not run fault injection against a user's live production browser.
