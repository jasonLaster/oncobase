# Cached-first reader after the HTML response

The reader still waits for ordinary HTML and renders with client-side React. There is no service worker, cached HTML document, server-rendered article, replacement database, or changed storage default. The user's accepted access policy is to show previously permitted cached content while checking it again in the background.

## Behavior

- Remember the actual LiveStore manifest/file tree and up to eight previously viewed Markdown bodies in a bounded presentation snapshot. The snapshot is at most 2 MiB and seven days old. It contains a complete identity/cache partition, reader version, original validation times and route bindings.
- Once JavaScript runs, use that snapshot to render the existing page, sidebar and search before identity verification or LiveStore startup finishes. Cached routes can navigate during this phase. A route without a saved body can still use its cached tree/index while the body loads.
- HTML already looks up the current account. Reuse that request's result as an opaque account tag, without another request or expensive permission computation. A known different account or signed-out HTML response cannot display the previous account's snapshot. If the account lookup is unavailable, the authorized stale-access assumption applies until revalidation.
- Open only the real store selected by the newly verified identity. A changed access partition discards the presentation. Empty temporary/new stores can restore the same verified snapshot through ordinary LiveStore events; an existing persisted store is never overwritten by it.
- Force a manifest refresh and current-page request on cached startup, even when the saved content hash is unchanged. New Markdown and file-tree changes update React. The article/navigation remain mounted across an unchanged handoff; scroll and search focus/query are preserved. A content update may replace changed text nodes.
- Sign-out, another tab's invalidation, account changes and confirmed API access failures clear remembered access. A generation token prevents old or queued writers from restoring it. Transient identity failures retain cached presentation and retry; they do not open an unverified private database.
- A route-only cookie hints that the next HTML response can omit its Markdown/metadata lookup. The normal site-login gate still runs, and hinted HTML is private/no-store with noindex. The hint cannot authorize an API or choose an account. `readerCache=0` retains the uncached comparison path; missing, expired, corrupt or unavailable browser storage falls back normally.

The HTML hint also avoids repeating the indexed canonical-document lookup for a cached route; explicit/legacy redirects still run, and the React canonical boundary reconciles the refreshed index.

Large snapshots use native browser gzip compression after paint and a bounded synchronous decoder on the next visit. The stored representation remains capped at 2 MiB; the decoded representation is capped at 16 MiB before the inflater allocates output. Small snapshots stay plain JSON. The writer is loaded separately after LiveStore is ready. Compression does not trim Markdown or navigation metadata, and a cancelled write cannot overwrite a newer route or auth generation.

## Validation before deployment

- 45 Chromium and 35 WebKit checks passed, with one existing Chromium-only worker case skipped in WebKit. The new cases cover cached public/private rendering, two cached routes before verification, new Markdown and a new tree entry, unchanged article/search DOM, scroll, account mismatch, denial, transient failure, opt-out, sign-out and cross-tab invalidation. The existing fresh-response/bootstrap/session tests also passed.
- 75 server and unit checks passed (816 assertions). Site gate, private responses, same-request account markers, origin/scope/version binding, age/size bounds, redaction and API authorization remain covered.
- Build/typecheck, ESLint and browser/server bundle budgets passed. The shell chunk's allowance increased by 832 bytes for the snapshot bridge and merged tree-expansion state; aggregate eager limits are unchanged, at about 1128 KiB measured. HTML's static server closure is about 109 KiB.
- The cache check preserved all six vendor bundles under an ordinary app edit. All 168 JS/CSS/WASM assets remained identical when only deployment metadata changed. This proves stable cache eligibility; bytecode reuse is browser-controlled and not claimed.
- React Doctor's three advisories concern the already-large ReaderStore, WikiPage and WikiSync functions. No functional diagnostic was reported; no rules were suppressed.

Two test expectations were corrected: file-tree labels use filename words rather than document titles or hyphens; the invalid-response fallback test must wait for its API request because the article can now appear before that asynchronous check completes.

## Controlled timings

`reader-cached-startup-2026-09-14.json` contains ten content-free samples from `scripts/profile-cached-reader.ts`, using the synthetic loopback server, headless Chromium, 1440×1000, real HTTP caching and no interception. Each CPU case starts a fresh context. Cached visits painted the article/navigation at 46–68 ms with normal CPU and 119–186 ms at 4× CPU. HTML completed in 1–2 ms, and all repeat samples transferred zero JavaScript bytes. Each cached sample painted before the real store was ready, subsequently reached it, and had no browser errors.

The public fresh-response comparison was similarly fast (48/129 ms), because that fixture already embeds its public body in HTML and has almost no server latency. These numbers demonstrate the cached-first path and HTTP reuse; they are not evidence of an additional production speedup or cold sub-500-ms guarantee. Production verification follows deployment.


## Integration with the current main branch

Rebased onto `91d512fc`, preserving the separate file-tree expansion fix. The combined build/typecheck and budgets passed. All twelve cached-startup tests passed again in Chromium and WebKit, and twelve focused tree/navigation checks passed, including saved expansion defaults, reloads, collapsing the active branch, and desktop/mobile sharing. A broader navigation command included production-only gate-login and archive-download checks unsupported by this synthetic server; it was stopped and is not counted as a passing suite. Existing server unit tests cover gate and redirect behavior.

## Production verification and large-vault correction

Release `487e1c4c` was deployed and verified in the authenticated native Chrome profile. The first visit painted its article at 594 ms; a warm reload took 291 ms. These visits used the existing fresh-response path: the new snapshot was not being reused. Opt-in, content-free diagnostics in `9a74e49d` identified a 4,076,362-byte snapshot with 6,974 indexed pages, exceeding the intended 2 MiB storage bound. The fallback worked, but the original small fixtures did not represent the live vault's size.

The correction adds lossless compression, a 7,001-page round-trip unit test, malformed/oversized decompression checks, and a browser case that restores a compressed snapshot larger than the uncompressed storage limit while identity verification is held. Production verification of that correction follows its deployment.
