# Reader loading on an unreliable mobile connection

## Findings

The reported train session has no captured trace, so its exact cause is unconfirmed. A controlled cold-network run reproduced a related failure before any article API request: downloading SQLite took about 16 seconds, exceeding the 3-second persisted-store deadline and then the 15-second temporary-store deadline. The reader downloaded SQLite twice and reached terminal recovery with no JavaScript errors.

Inspection also found concrete recovery problems: an empty manifest failure had no timed retry, Retry page could wait for the manifest again, reconnecting did not independently retry the article, and obsolete foreground requests could keep using bandwidth after navigation. Both foreground requests already ran independently on cold startup, with a 30-second deadline that covers the body as well as headers.

## Changes

- Give cold database startup a fixed budget based on observed large runtime downloads, capped at 90 seconds. Cached/fast starts keep their existing short lock-recovery deadlines. Slow transfer evidence prevents canceling and restarting a healthy download. Startup now also offers a longer-wait cue and retry.
- Retry the requested article directly, even without an index. A manual retry cancels its previous request. A route change cancels obsolete article requests; store replacement cancels outstanding foreground work.
- Retry an empty page list after 5 seconds, then back off to 10, 20 and 30 seconds. Connectivity restoration retries the article and navigation. Ordinary manifest checks retain the existing cached-content behavior.
- Show a quiet loading cue first; after 8 seconds show a longer-wait message, actual received data size and a retry button. The mobile page list has its own progress and retry. Offline text distinguishes loss of connectivity from ongoing work.
- Negotiate `format=compact-v1` for manifests. Tuples remove repeated field names while preserving every field, the tree, schema and revision hash. Older clients still receive ordinary JSON; new clients accept ordinary responses from older servers.
- Gzip large manifest and article responses when accepted, preserving gate/cache headers and encoding variants. Stream the incoming body to collect progress, then validate and import the complete snapshot atomically. Interrupted JSON never replaces a complete cache.
- Keep session startup on the identity-only client. Rich transfer controls live with the reader rather than the initial loading component. The shell chunk allowance increases by 1 KiB for controls and adaptive deadlines; entry and aggregate eager limits remain unchanged.

The byte count is decoded data received, not an estimated percentage or wire-byte count. Browsers expose the response as a stream, while compressed Content-Length describes the encoded payload. See [Response.body](https://developer.mozilla.org/en-US/docs/Web/API/Response/body) and [Content-Length](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Length).

## Transfer experiment

`bun apps/app/scripts/measure-manifest-transfer.ts` uses 5,000 synthetic pages with unique hashes, descriptions, tags and 20 sections.

| Representation | JSON bytes | Gzip bytes | Transfer at 256 kbps, excluding latency |
| --- | ---: | ---: | ---: |
| Existing objects | 1,247,300 | 161,177 | 5.04 s |
| Compact tuples | 902,326 | 158,879 | 4.96 s |

Compact tuples reduce raw JSON by 27.7%, but only reduce gzip bytes by 1.4%. Compression is the substantial transfer saving when an intermediary has not already compressed the response. These measurements do not establish a production latency improvement or explain a minute-long startup.

## Further optimization priorities

1. Measure code, worker/SQLite startup and API timing separately on an actual cold phone. The current aggregate eager budget includes about 1.1 MiB gzip of code, workers, styles and SQLite. At 256 kbps, those bytes alone represent roughly 36 seconds of transfer, though some work can overlap with readable content.
2. Preserve the existing requested-page bootstrap and early React reader. Moving more storage/search work after article readiness is likely to matter more than further shortening JSON field names.
3. A separately versioned navigation-first stream could show a validated tree before the full metadata index arrives. This patch streams download progress but does not expose a half-imported manifest as authoritative navigation.
4. Keep the selected article outside background batches. The backend already supports multi-page requests and overlaps manifest work; batching small background pages could save round trips on healthy connections, but would increase wasted bytes and head-of-line delay on the train. Existing bounded prefetch continues to yield to foreground requests.

## Cold network reproduction

Run the build, then `bun apps/app/scripts/serve-slow-network-fixture.ts` in one terminal and `bun apps/app/scripts/profile-slow-network.ts http://127.0.0.1:62184` in another. `PROFILE_PORT` changes the fixture port. For the browser regression suite, set `PLAYWRIGHT_BASE_URL` to that fixture instead of starting a production-connected development server.

`profile-slow-network.ts` ran against a synthetic production-build server with no seeded page, no HTTP/reader cache, a 390×844 viewport, 256 kbps download, 400 ms latency and 4× CPU slowdown. Before the adaptive deadline, the article never became available within the probe's timeout: two SQLite downloads each took about 16 seconds, and no article request began. With the fix, the article appeared in **40.5 seconds**, with zero page errors or horizontal overflow. The identity, manifest and article requests took 456, 511 and 557 ms respectively. The page observed 1,059,282 transferred resource bytes; nested worker requests are not included in that count.

This demonstrates recovery from a reproducible slow-download startup failure, not a fast startup on a poor connection. It is one controlled sample rather than production percentiles or proof of the original phone session's cause. Runtime download volume remains the largest opportunity for improving this extreme cold case.

## Validation

Synthetic tests cover complete/partial cache behavior, empty-cache recovery, direct retry, reconnect, cancellation, actual streamed HTTP bodies, Unicode split across chunks, malformed/truncated payloads, gzip negotiation and legacy compatibility. Chromium and WebKit use a 390×844 viewport for the new mobile scenarios. Visual review checks the loading controls, overflow and keyboard focus treatment. No production deployment or physical-train validation is claimed.

The 98 focused unit tests, application/content type checks, production build and bundle checks passed. The shell chunk budget has the explicit 1 KiB allowance described above. Changed-file lint has no new warnings; the existing mobile outline effect warning remains.

The final browser runs passed 21 Chromium checks (including cache, worker/SQLite startup and recovery) and five WebKit mobile checks. The tests use the production build with synthetic fixtures. The separate 256 kbps benchmark above used real HTTP transfers without request interception.

## Integration with current main — September 27

Reconciled the original reader patch with `9c2a1c9e`, retaining reader trace propagation, the portable manifest tree builder, and revision-fenced session overlays. The session overlay regression now also checks compact, gzip-encoded responses and private cache headers. The browser cancellation probe handles both URL/init fetch calls and Request objects created by tracing.

Validation on this combined tree: 408 app unit tests and 85 content-package tests pass, as do app/content typechecks, the production build and bundle budgets. Targeted ESLint has no errors; the existing Navigation effect warning remains. The broad unit run exposed an outdated security-test inventory count (120 versus 121 after the new access query); the count was updated without weakening the authorization assertions. Chromium startup, cache and slow-network coverage and WebKit mobile slow-network coverage were rerun against the synthetic production build. These checks do not establish live latency improvements; the earlier 40.5-second throttled measurement remains a historical sample.
