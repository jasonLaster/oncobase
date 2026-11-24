# Opportunities and analytics (2026-11-23)

Status: analysis only. Nothing in this document is implemented. Revised the same day: O2 was withdrawn as a measurement artifact. Scope: the `apps/app` reader, its server and Convex backend, and the shared packages. Dimensions, weighted the same way as the 11-13 proposal: performance highest, then reliability, server cost, architecture, accessibility and design.

The three predecessors are `plans/2026-11-13-application-improvement-proposal.md` (item IDs P, M, A, X, D) and `plans/2026-11-17-server-rendering-plan.md` (SSR stages). The UI SDK migration plan on branch `ui-sdk-migration` covers X3, X4 and most of D2. This report does not duplicate it.

## 1. Summary

The site is no longer the one the 11-13 proposal measured.

- **It is about 14 times bigger.** Production has 8,746 pages (583 sensitive), 14,431 assets and 146 MB of markdown. The proposal assumed 616 public pages and a 40 KB manifest. One top-level folder holds 6,280 of the pages and 84% of the markdown bytes.
- **The reader's manifest is now 1.06–1.11 MB gzip (5.25 MB raw) on the wire.** The reader downloads it on every cold load. It downloads it again after almost every publish, because there are about 40 publishes a day and there are no deltas.
- **The perf lab does not see any of this.** Its synthetic vault has 2,312 pages and a 57 KB manifest.

Real users are about 50 reader boots a day, and about 80% of them are signed in. What they experience:

- First paint is fine to fair:
  - LCP p50 1.17 s, p75 2.15 s, p95 4.06 s.
  - A repeat visit painted from the startup snapshot has LCP p75 1.73 s.
- The cost has moved after paint:
  - Desktop total blocking time p90 is 849 ms.
  - Touch INP p75 is 424 ms.
  - The local store's first full sync (`sync-ready`) went from about 1.3 s to about 3 s at p50.

The biggest server costs are not real users either:

- Labelled CI traffic is 99.0% of browser boots and 56% of Convex time.
- After CI, the single largest Convex consumer is the publisher's sync preflight. It downloads the whole vault's content before every publish it runs, about 36% of real Convex time.

**Where SSR stage 1 ranks:** fourth, behind three items (O0, O1 and O3; O4 is a server-cost item). SSR stage 1 is public-scope documents only. Public-scope readers are about 19% of real reader clients, and only their cold loads benefit. That is a handful of loads a week, each gaining about 0.4–0.5 s of first paint. Stage 1 is worth doing as the foundation for stage 2 (signed-in documents, which is where real users are), but on its own it is not the best next move. The items above it reach every real user or make the rest measurable, and do not depend on SSR. Section 4 has the reasoning.

## 2. How this was measured

All numbers are from 2026-11-16 to 2026-11-23, except where marked. Traffic is clean from 11-16 on: client spans label themselves via `navigator.webdriver` and server spans via `x-wiki-test-run`.

**Axiom (`oncobase-traces`, EU edge).**
- `bun scripts/query-traces.ts --env-file ~/.config/oncobase/axiom.env --since 7d --report`, plus ad-hoc APL through `--query`.
- "Real" means `tostring(['attributes.custom']['oncobase.synthetic']) != 'true'`.
- Browser vitals come from `['attributes.custom']['measurement.duration_ms']`, grouped by `reader.startup`, `reader.viewport`, `reader.input` and `reader.route_type`.
- The queries are reproduced in the appendix.

**Production probes (read-only), using the authorized QA account.**
- The probes signed in through `/api/login` and `/api/auth/signin` and labelled every request with `x-wiki-test-run: 1`.
- The manifest was fetched both ways, `?scope=public&format=compact-v1` as a gate guest and `?scope=session&format=compact-v1` signed in, and sized after decoding.
- One load was traced with the CDP Network domain to list the wasm, worker and manifest requests.
- No page content was saved. The only figures kept are counts, sizes and timings.

**Production mobile-profile loads.**
- Profile: 390×844, DPR 3, 4× CPU, 1.6 Mbps and 150 ms RTT, as in the lab, through Playwright and Chromium.
- 5 cold loads each, signed in and as a gate guest, of a neutral ~8.6 KB page.
- **Results:** median article paint 3.31 s signed in and 3.60 s as a gate guest. Signed-in is no slower than public. These runs had the HTTP cache off because of request interception (see O2).
- **Caveat:** nova (2 vCPU, 3.8 GB) was shared with other agent sessions, at load average 9–37 during the runs. The timings are inflated against the laptop's 2.35 s from 11-17. Read them as relative only. Byte counts are unaffected.

**Not done, and why.**
- **`bun run perf:lab`:** not run on nova, because the machine was saturated and the numbers would not be comparable with the laptop baselines. The lab's vault also no longer resembles production (O0).
- **Vercel Web Analytics, Speed Insights and runtime logs:** no Vercel MCP tools or CLI credentials on nova.
- **The Convex usage dashboard:** no Convex CLI auth on nova.
- The Convex database-bandwidth figures below are therefore derived from span counts and content sizes, not read from billing.

**Code reading.** Three parallel read-only audits covered the client paint path, the server and Convex, and accessibility, design and architecture. I re-checked the claims that drive the ranking myself. Where two audits disagreed, the code decided (for example, A7 is not done: `server/http-adapter.ts:91-95` still builds the `Request` without a signal).

## 3. Real-user scorecard (7 days, labelled traffic only)

**Traffic**

| Metric | Value |
| --- | --- |
| Browser boots, real / CI | 361 / 36,268 (CI 99.0%) |
| Real reader clients by manifest scope | session 162, public 38 (distinct client trace ids on `/api/wiki/manifest`) |

**Load vitals**

| Metric | n | p50 | p75 | p90 | p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| LCP, all routes | 268 | 1,165 | 2,153 | 3,262 | 4,059 |
| LCP, startup from snapshot | 124 | 976 | 1,732 | – | 3,395 |
| LCP, startup from inline payload | 36 | 1,536 | 2,624 | – | 3,387 |
| LCP, startup from network | 31 | 1,924 | 3,268 | – | 11,672 |
| LCP, landing `/` (wide + narrow) | 18 | ~2,100 | ~3,100 | – | 5,712 |
| LCP, `/chat` | 8 | 3,288 | – | – | – |

- 20% of all loads have LCP over 2.5 s.
- Small samples make the landing and chat rows indicative only.

**Main-thread blocking and input latency**

| Metric | n | p50 | p75 | p90 | p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| TBT, desktop wiki | 145 | 127 | 239 | 849 | – |
| INP, pointer | 95 | 56 | 88 | – | 448 |
| INP, touch | 19 | 144 | 424 | – | 856 |

- 23% of desktop wiki loads have TBT over 300 ms.
- 8 of the 19 touch INP samples are over 200 ms.

**Store, sync and documents**

| Metric | n | p50 | p75 | p95 |
| --- | ---: | ---: | ---: | ---: |
| Reader ready | 188 | 995 | 1,990 | 3,534 |
| Store boot complete | 212 | 1,165 | 2,424 | 3,827 |
| First full sync (`sync-ready`) | 212 | 3,262 | 4,946 | 14,712 |
| Document TTFB (`nav-document`) | 345 | 74 | 275 | 594 |

`sync-ready` daily p50 was 1.2–1.4 s on 11-11 to 11-15 (mixed traffic) and has been 2.4–4.9 s since 11-16.

**Session manifest (server)**

| Request | n | p50 | p75 | p95 |
| --- | ---: | ---: | ---: | ---: |
| Revalidation, nothing changed (`known`) | 1,066 | 79 | 117 | 1,143 |
| Cold overlay, since the 11-19 fix | ~80 | ~1,350 | ~1,450 | ~2,000 |
| Rebuild after a publish (`manifest.build`) | 123 | 3,752 | – | 7,210 |

**HTML documents for app routes (server)**

| Route | n | p50 | p95 |
| --- | ---: | ---: | ---: |
| `/chat` | 9 | 2,163 | 2,694 |
| `/admin` | 4 | 1,383 | 1,714 |
| `/diagnostics` | 6 | 1,466 | 2,765 |

Two things follow:

- Repeat visits are carried by the localStorage startup snapshot, which is 46% of LCP samples.
- About 80% of real readers are signed in, so anything scoped to public documents reaches about one reader in five.

## 4. Ranked opportunities

How to read this:

- **Reach** is real users unless marked CI.
- **Gain** is an estimate unless marked measured.
- **Sizes:** S is up to two days, M up to a week, L several weeks.

### O0. Make the perf lab look like production (measurement; do first)

- **Evidence.**
  - Lab vault: 2,312 pages, 57 KB-gzip manifest.
  - Production: 8,746 pages, 14,431 assets, 1.06–1.11 MB manifest, and a startup snapshot that encodes to 1.54 MB of base64 against a 2 MiB cap.
  - None of O1–O3 can show up in the lab today, and SSR stage 1's exit numbers would be measured against the wrong site.
- **Change.** Add a `--scale prod` option to `scripts/perf-lab/vault.ts`: about 9k pages, 14k assets, one 6k-page folder, and the same size distribution (p50 5.2 KB, p95 74 KB, max 908 KB). Keep the content synthetic. Add `sync-ready`, post-paint TBT and an interaction-during-sync probe to the loads.
- **Reach:** measurement truth for everything below. **Cost:** S. **Risk:** low.
- **Maps to:** M1.

### O1. Shrink the manifest and stop re-downloading it (highest real-user impact)

- **Evidence.**
  - `compact-v1` is 1,061 KB gzip for a gate guest and 1,105 KB signed in, 5.25 MB raw.
  - Raw split: pages 3.03 MB, assets 1.71 MB, tree 0.51 MB.
  - Signed-in: 281 of 1,351 real requests in 7 days returned the full body (`snapshot-overlay` and `-cached`). Every publish changes the hash, and there were about 40 publishes a day (scoped begins).
  - On the 1.6 Mbps profile the manifest alone is about 5.4 s of link time. In the prod mobile runs it had not finished 15 s after navigation, while the rest of the load was 1.47 MB.
  - Once it arrives, the page and the store parse 5 MB of JSON and materialise about 23k rows. The tree is built from 8.7k pages.
  - Real-user `sync-ready` p50 is about 3 s, p95 14.7 s.
- **Change, in order:**
  1. Move assets out of the manifest into their own lazily fetched index, keyed by the same revision. The reader needs them only to version file URLs and to list related files.
  2. Drop or truncate the per-page `description`.
  3. Serve deltas keyed by the revision the client already sends in `?known=`: return the rows changed since that revision, and fall back to a full manifest when the gap is too big.
  4. Load the 6k-page folder's subtree on expand, not up front. The palette's full-index search would then query the server or a lazily loaded index for that folder.
- **Reach:** every real reader, on cold loads and on the first check after each publish.
- **Gain:**
  - (1)+(2) remove roughly half the bytes and parse.
  - (3) turns a 1.1 MB re-download after each publish into a few KB.
  - Expect `sync-ready` p50 back near 1.3 s and less post-paint blocking (see O3).
- **Cost:** M for (1)–(2), M–L for (3), L for (4).
- **Risk:** medium.
  - LiveStore materializers must stay set-based.
  - The palette's offline full-tree search changes behaviour.
  - Access revocation must still remove rows: a delta has to carry tombstones, and `accessRevision` must force a full read.
- **Maps to:** P5 ("serve manifest deltas keyed by revision"), P16. New scale evidence.

### O2. Withdrawn: the "duplicate wasm download" was a measurement artifact

- The first version of this report said `wa-sqlite.wasm` downloads twice on every cold load. That came from a probe that labelled traffic with `context.route`.
- Playwright disables the HTTP cache while request interception is on.
- Re-measured with `setExtraHTTPHeaders` instead, the second request (from the store's own load, about 0.5 s after the head script's) is served from disk cache with 0 bytes. The head-script prefetch works as designed.
- **Consequence for measurement:** any production check that adds `x-wiki-test-run` through `context.route` measures a cold load with no HTTP cache. That includes this report's mobile runs (§2) and probably the 11-17 production check. Those loads over-count bytes for anything fetched twice by design. `perf:lab` does not intercept, so its numbers are unaffected. For future production probes, use the CDP `Network.setExtraHTTPHeaders` on the page target, scoped to the origin, or accept the cache-off caveat.

### O3. Take the startup snapshot off the main thread's hot path

- **Evidence (code, plus production sizes).**
  - The snapshot is the warm first paint for 46% of real LCP samples.
  - Each navigation to a new path rewrites it. The write key includes `pathname` (`src/bootstrap/startup-cache-write-policy.ts:17-20`).
  - Each rewrite rebuilds a manifest object from 8.7k page rows, with a `JSON.parse` of each row's tags and of the 0.5 MB tree (`ReaderStartupCacheWriter.tsx:51-66`). It then stringifies about 5 MB, gzips it (off-thread, via `CompressionStream`), base64-encodes it and writes about 1.5 MB to localStorage synchronously. All of that runs in one idle callback.
  - Each warm boot does `atob`, `gunzipSync` (fflate, on the paint path) and validation of every page before the first render (`WikiViteRoot.tsx:131-136`, `reader-startup-cache.ts:60-79`).
  - At production scale the encoded manifest alone is 1.54 MB against `STARTUP_CACHE_MAX_BYTES` = 2 MiB. Bodies are evicted first, so at roughly 30% more manifest growth the write fails, the snapshot is removed, and repeat-visit LCP falls from p75 1.73 s to the 2.6–3.3 s of the other paths, with no error anywhere.
- **Hypothesis to test in O0's lab** (not yet attributed): this per-navigation work is a large share of the desktop TBT p90 of 849 ms and the touch INP p75 of 424 ms.
- **Change.**
  - Rewrite the manifest part only when `manifestHash` changes.
  - Store bodies under their own keys, written on navigation or on `pagehide`.
  - Store the manifest already in reader shape: tags as arrays, the sidebar tree prebuilt.
  - Validate the current page and tree first, and defer the rest.
  - Record a telemetry span when a write fails for size.
  - With O1 the stored manifest shrinks too.
- **Reach:** every real reader on every navigation and warm boot.
- **Gain:** removes a multi-MB stringify and storage write per navigation and a 5 MB decode before warm paint. It also prevents a cliff that would roughly double repeat-visit LCP.
- **Cost:** S–M. **Risk:** low. SSR stage 3 deletes the layer anyway, so this is a bridge, not a redesign.
- **Maps to:** P16, A1 (cache layers), SSR §5.

### O4. The publisher's sync preflight downloads the whole vault per publish (largest real server cost)

- **Evidence.**
  - `/api/publish/sync/documents`: 5,037 requests in 7 days, p50 528 ms.
  - Behind it, `documents:listPageWithContent`: 2,773 s of Convex time, about 36% of all real (non-CI) Convex time.
  - Each run is one `scoped/begin` followed by 48 sequential pages, about 65 s of wall-clock (traced on 11-23 at 15:58 UTC). That is about 105 runs a week.
  - Each run reads every body. At 146 MB of markdown that is a lower bound of about 15 GB a week of database reads, or more if `rawContent` travels too. This is derived, not read from billing.
  - The diffing endpoint `sync/plan` exists, but it was called twice in 7 days. And it also reads every body server-side, just to compare hashes (`server/publish-api.ts:840-870`).
  - The caller is not in this repo's CI. It runs with whatever triggers the vault's publishes. `packages/oncobase/src/sync.ts:250` falls back to the full listing only when `sync/plan` returns 404, which suggests an older client.
- **Change.**
  - A hash-only Convex query over `documentMeta` (slug, contentHash, sensitive) for `sync/plan`. Then fetch bodies only for the slugs that differ.
  - Make sure the vault's publisher is on a version that calls `sync/plan`.
  - Skip the preflight for scoped publishes unless asked: it is already off by default for a scope, so the caller must be passing `--sync-first`.
- **Reach:** server cost and publish latency, which is the user's own agents. Readers are affected indirectly: fewer long reads on shared instances.
- **Gain:** about −2,700 s of Convex time a week (−36% of real), roughly −15 GB a week of reads, and about −60 s per publish.
- **Cost:** S–M. **Risk:** low. The fallback stays.
- **Maps to:** P23 (adjacent).
- **Question for you:** what runs these publishes, and why with a sync first?

### SSR stage 1 (the queued default), for comparison

- **What it buys.** In the spike, public-scope documents paint at about 1.86–1.97 s with a paint-to-responsive gap of 78 ms median (89 ms worst), against about 2.3 s client-rendered. So it is −0.4 to −0.5 s of first paint on cold public loads, with no gain on warm loads, where the snapshot already paints at p75 1.73 s.
- **Reach.** About 19% of real reader clients are public scope (38 of about 200 a week). Only their cold loads benefit, about a quarter of loads. Signed-in readers, about 80%, get nothing until stage 2.
- **What it does not touch.** O1–O3, which is where real users' post-paint time goes at production scale.
- **Cost and risk.** M–L, medium–high.
  - The open risks are unchanged: clicks before the gated paint are lost on same-site navigation; a stray `await` breaks the gate; footnotes and IDs break across sections; and typing before hydration, real devices and the stalled-JS valve are untested.
  - The user's rule stands: gap under 100 ms on the mobile lab profile before anything user-visible lands.
- **Answer to the size-cap question (SSR open question 2).** 64 KiB of markdown covers 93.8% of pages by count. 539 pages exceed it and 98 exceed 128 KiB. Page-view weighting is not available, because traces do not record slugs.
- **Verdict.** Do it, but as stages 1 and 2 together after O0–O3. Stage 1 alone moves a handful of loads a week, and its exit measurement needs O0's production-scale lab to mean anything. SSR also needs O3's snapshot work less once stage 3 deletes the snapshot, but stage 3 is weeks away and the size cliff is not.

### O5. The deployed CI suite is most of the server bill (CI)

- **Evidence.**
  - Synthetic traffic in 7 days: 36,268 browser boots, 179,941 server requests, and 9,620 s of Convex time out of 17,237 s total (56%).
  - The heaviest single source is the education search specs: 133 cold corpus loads of about 68 `listSearchPages` calls each, 4,019 s, 23% of all Convex time.
  - Next: CI `/api/file` at 2,302 s and CI HTML shells at 1,538 s.
- **Change.** Move the corpus-heavy and file-heavy deployed specs to a preview deployment or the local stack. Keep a small labelled smoke run against production.
- **Reach:** CI. **Gain:** about −55% of Convex time and a matching share of function time. **Cost:** S. **Risk:** less post-deploy coverage on production; this is decision 4 in the 11-13 proposal.
- **Maps to:** M2.

### O6. Search corpus loads cost 5–9 s on a cold instance

- **Evidence.**
  - `search.corpus.fetch`: real p95 6,978 ms; CI p50 5,566 ms.
  - Real `/api/tools` p95 7.0 s and `/api/mcp` p95 9.0 s, on small volume (43 and 31 requests).
  - The per-instance cache hit 38 times and missed 32.
  - Each load pages full bodies through `documents:listSearchPages` at a p50 of 470 ms per call.
- **Change.** Build the search corpus or index at publish time into a content-addressed artifact, like the public manifest artifact (P10), and load it in one read.
- **Reach:** chat, Talk, MCP and `/search` users. CI cost through O5.
- **Gain:** cold search from about 6 s to under 1 s. Removes most of `listSearchPages`.
- **Cost:** M. **Risk:** low–medium. Redaction must be applied before the artifact is written.
- **Maps to:** P10 (pattern), new.

### O7. App-route HTML pages walk the whole manifest

- **Evidence.**
  - `/chat` documents take p50 2,163 ms of server time, `/admin` 1,383 ms and `/diagnostics` 1,466 ms. `/tools` p95 is 2,275 ms. Each does about 20 Convex calls.
  - One trace shows `shell.canonical` taking 486 of 604 ms in sequential `documents:listManifestPage` pages.
  - The cause: `canonicalSlugRedirectResponse` (`server/app-shell.ts:212-245`) treats `chat`, `admin` and similar paths as possible miscased slugs. It builds the full slug map 512 rows at a time, caches it for 60 s per instance, and does not single-flight.
  - Education 404s pay the same price, p95 2,285 ms.
  - Real chat LCP p50 is 3.3 s.
- **Change.** Return early for registered app routes. Derive the canonical map from the cached manifest snapshot, keyed by revision, and single-flight it.
- **Reach:** real users of chat, admin, tools and diagnostics, plus bot 404s. **Gain:** about −1.3 to −2 s TTFB on those routes (measured shape). **Cost:** S. **Risk:** low.
- **Maps to:** new (P19-adjacent).

### O8. Signed-in manifest: rebuild after publish, and the cold overlay

- **Evidence.**
  - The first reader after a publish rebuilds the snapshot: `manifest.build` p50 3.75 s, p95 7.2 s, 123 times in 7 days. Others queue behind it (`manifest.queue` p95 883 ms).
  - This is the 1.1 s p95 of the otherwise 79 ms `known` check.
  - The cold overlay is still p50 about 1.35 s. It pages every live PDF row, public ones included, because `pdfAssets` lacks the sensitive index `fileAssets` has (`convex/schema.ts:290` against `:311`). It then serializes the full manifest per user.
- **Change.**
  - Build the snapshot when a publish completes (`scoped/complete`, `finish`), not on the first read.
  - Add `by_site_sensitive_live_path` to `pdfAssets`.
  - Longer term, serve the overlay as a delta on top of the public base artifact. That is also the server half of O1's deltas.
- **Reach:** every signed-in reader after each of about 40 publishes a day.
- **Gain:** p95 of the revalidation check from about 1.1 s to about 0.1 s; cold overlay about −0.5 s.
- **Cost:** S (index, eager build) to M (delta). **Risk:** low–medium.
- **Maps to:** P10, A6.

### O9. Large-page rendering is still parsed on every visit

- **Evidence.**
  - Real route render p75 is 200 ms and p95 369 ms (n = 243). Lab: 1,062 ms at 4× CPU for a 279 KB page.
  - P12 (parse cache), P13 (`flushSync` at `src/shell/Navigation.tsx:400`) and P14 (`content-visibility` only above 128 KB) are not done.
  - From code, to confirm with an A/B: `WikiPage` passes a `resolveLinkHref` that changes when the store's assets arrive (`src/pages/WikiPage.tsx:240,276-277,595`). That may re-parse the article once per boot.
  - Smart-table enhancement reads layout for every table on mount (`packages/smart-table/src/enhance-table.ts:568-577`).
- **Change.** Keep the resolver stable (resolve inside the link component through `AssetVersionsContext`). Then add P12's content-hash parse cache, P13's transition, and viewport-gated table enhancement.
- **Reach:** readers of large pages; 539 pages are over 64 KiB. **Gain:** removes a duplicate parse per boot, and makes revisits of large pages cheap. **Cost:** S (resolver) to M. **Risk:** low.
- **Maps to:** P12, P13, P14.

### Reliability and security (not ranked against performance; all S unless noted)

- **R1. Agent and auth endpoints have no durable rate limit.**
  - Affected: `/api/login`, `/api/auth/signin`, `/api/auth/tokens`, `/api/mcp`, `/api/tools`, `/api/chat`.
  - An MCP POST runs every JSON-RPC message in the batch with `Promise.all`, uncapped, under a 64 MiB body limit (`server/api/mcp.ts:103-105`, `server/http-adapter.ts:7`).
  - Sign-in hashing is blocking `scryptSync` (`server/user-auth.ts:15`).
  - Access tokens last a year and are accepted as `?access_token=` on every route, which puts them in platform logs.
  - Fix: cap batches at about 8, add a Convex- or WAF-backed limiter, accept the query-string token on `/api/mcp` only, and shorten its lifetime. Maps to A7. Size S–M.
- **R2. Client disconnects cancel nothing** (A7, not done: `server/http-adapter.ts:91-95`).
  - Palette-recommend embeddings and LLM calls, Blob proxying and Convex reads all run to completion for clients that have left.
  - Volume is low today (52 palette-recommend requests a week). Decide explicitly whether chat should keep generating after a disconnect.
- **R3. Chat PII-redaction gap.** Chat's local `getPiiPatterns` caches "no patterns" for 15 s after a failed site read (`server/chat-route.ts:183-200`). The shared `reader-access.getPiiPatterns` deliberately throws instead. Use the shared function.
- **R4. 1,155 refused telemetry batches (403) in 7 days.** 958 of them were on 11-19. They carry no rejection reason, so a burst of real-user data was lost without explanation. Add the reason to the span and find the 11-19 cause. Maps to M3.
- **R5. Palette queries are stored verbatim with no expiry.** Up to 200 characters, not redacted (`convex/palettePicks.ts:25`, `schema.ts:245`). On a medical site this is the most sensitive new data store. Redact with the site PII patterns, add a 30–90 day purge cron, and mention it in the privacy copy.
- **R6. A wiki-edit approval does GitHub writes, a publish and embeddings inside one 60 s request.** p50 4.6 s today; multi-page edits can hit the limit (`server/wiki-edit-service.ts:527-575`). Move the publish to a scheduled job. Size M.

### Accessibility and design (items the UI SDK plan does not cover)

- **Y1. New surfaces skip every gate.** Surface Gates runs only on `pull_request` (`.github/workflows/surface-gates.yml:5-7`), and most work since 11-18 was pushed straight to main. Cellularity, Talk, the review panel and the image theater are not in `surfaces.ts`. Run the gates on push to main and add those surfaces. Size S.
- **Y2. Talk:**
  - Focus falls to `<body>` when the launcher and Start button unmount.
  - Consent is one unversioned flag that can't be withdrawn (`src/talk/TalkPanel.tsx:38,53`).
  - A `role="status"` announces every turn over the voice.
  - Size S.
- **Y3. Review panel:**
  - Arrow keys follow `proposal.files` order, not the visible sorted tree.
  - Focus drops to `<body>` after Approve or Reject.
  - A global Escape listener closes it under other layers (`packages/wiki-shell/src/wiki-edit-review-panel.tsx:342-351,398-408`).
  - Size S–M. UI SDK 2.8 replaces the tree and tabs; the focus-after-action fix is separate.
- **Y4. Tables and status, still unowned.**
  - X5: every smart table is a tab stop, with no `aria-expanded` or `scope`.
  - X6: "Checking…" is still announced on every poll (`src/shell/ReaderStatus.tsx:30,36`).
  - Size S each.
- **Y5. Cellularity diagrams are mouse-only.**
  - `<g onClick>`, unlabelled canvases and no `aria-pressed`.
  - Dark-mode borders are invisible.
  - The 3D animation loop never stops and ignores reduced motion.
  - Size M.
- **Status of the 11-13 items:**
  - Done: X1, D5, D6, A2.
  - Mostly done: X8, though only 14 hand-picked jsx-a11y rules are on and visual diffs are report-only; A5.
  - Partial: X2, X7, D3.
  - Not done: D1, D4, A4, A8 (now worse: `wiki-comments/src/index.tsx` is 1,925 lines), A9, A10, A11.

### Smaller performance items (fold into the items above where noted)

- Background prefetch wakes every 2 s while the tab is hidden or offline, and every 30 s while visible, even when its plan is empty (`src/sync/BackgroundPrefetch.tsx:62,104`). Stop on hidden and resume on `visibilitychange`. Size S. Maps to P7.
- `StoreHost` (about 825 KiB gzip of Effect and LiveStore) is imported in the first effect after paint (`src/ReaderRoot.tsx:116-128`). Start it at idle when the page already painted from the payload or the snapshot. Size S–M. Maps to P2.
- The fast-path snapshot reads the state database twice and compares the copies byte by byte on the page thread (`src/livestore/fast-path-snapshot.ts:95,136-152`). At production scale the database is several MB. Size S.
- Lucide per-icon trim (open decision): no new evidence. The previous recommendation (leave it, or try one lazy icon group) stands, and it is small next to O1–O3.

## 5. Recommendation

Proposed order. Each item is independent, and each lands with its own measurement.

1. **O0** (production-scale lab vault), so the rest can be measured. Size S.
2. **O7** (app-route canonical scan). S, low risk and measurable today.
3. **O3** (snapshot write and read path, plus a size-failure span), before the 2 MiB cliff. Size S–M.
4. **O4** (hash-only sync plan) and **O5** (move heavy deployed specs off production). Together they remove about 90% of avoidable Convex time. S–M. O4 needs your answer on what runs the publishes.
5. **O1** (manifest: split assets out, then deltas), together with **O8** (build at publish, then overlay deltas). Size M–L. This is the change that matters most at production scale.
6. **SSR stages 1 and 2** as one programme, measured on O0's lab, with the existing 100 ms gap rule.

In parallel, cheap and outside the performance track: R1 (MCP batch cap and rate limits), R5 (palette query retention) and Y1 (gates on main).

## 6. Decisions needed

1. Which items to take on, and in what order. The default queue was SSR stage 1. I recommend O0 → O7 → O3 → O4/O5 → O1/O8 → SSR 1+2.
2. **O4:** what runs about 15 sync-first publishes a day (about 105 a week), and may it switch to `sync/plan`?
3. **O5:** may the corpus- and file-heavy deployed specs move off production?
4. **O1:** may the palette's offline full-index search over the 6k-page folder become server-backed or lazily loaded?
5. **Access for a second pass:** a Vercel token (Speed Insights, function GB-hours) and Convex dashboard access (database bandwidth). These would turn the derived cost figures in O4 and O5 into billed ones. I did not try to work around their absence on nova.

## Appendix: queries

The APL is abbreviated. `C` stands for `['attributes.custom']` and `R` for `['oncobase-traces'] | where tostring(C['oncobase.synthetic']) != 'true' and _time > datetime(2026-11-16)`.

- **Vitals:** `R | where name=='reader.vital-lcp' | extend v=todouble(C['measurement.duration_ms']) | summarize n=count(), p50=percentile(v,50), p75=percentile(v,75), p95=percentile(v,95) by tostring(C['reader.startup'])`. The same shape for `reader.vital-inp` by `reader.input`, and for `reader.vital-tbt` by `reader.viewport` and `reader.route_type`.
- **Reader scope:** `R | where name=='wiki /api/wiki/manifest' | summarize n=count(), clients=dcount(tostring(C['oncobase.client.trace_id'])) by tostring(C['manifest.scope'])`.
- **Convex time by route:** `['oncobase-traces'] | where name startswith 'convex.' | summarize n=count(), s=sum(duration/1ms)/1000 by syn=tostring(C['oncobase.synthetic'])=='true', tostring(C['oncobase.request.route'])`.
- **Publish burst:** `['oncobase-traces'] | where name startswith 'wiki /api/publish/' and _time > datetime(2026-11-23T15:00Z) | project _time, name, duration`.
- **App-route documents:** `R | where name=='wiki /reader/shell' and tostring(C['shell.outcome'])=='document' | summarize p50=percentile(duration/1ms,50), calls=percentile(todouble(C['convex.calls']),50) by tostring(C['shell.path_class'])`. One trace was then expanded with `where trace_id == …`.
- **Manifest phases:** `R | where name in ('manifest.build','manifest.overlay','manifest.queue') | summarize percentile(duration/1ms,50), percentile(duration/1ms,95) by name, bin(_time,2d)`.
- **Search corpus:** `['oncobase-traces'] | where name=='convex.query documents:listSearchPages' | summarize n=count(), traces=dcount(trace_id), s=sum(duration/1ms)/1000 by route, syn`.
- **Production manifest size:** a signed-in `GET /api/wiki/manifest?scope=session&format=compact-v1` with `x-wiki-test-run: 1`, measured as the encoded byte count, the decoded byte count, and the byte count of each top-level field.
