# Wiki-Vite Migration Research — Round Three Kickoff

This pass starts from the round-two release commit `0afd2e27` and follows the
open items in `openai-migration-round-2.md`, using `openai-migration.md` as the
original parity baseline. The work is isolated on
`codex/openai-migration-round-3`; no deployment or release is part of this
kickoff.

## Fixed in this pass

### 1. The Vite comparison DICOM viewer now decodes both stacks

The round-two report correctly narrowed the failure to decoding, but worker
contention was not the cause. The comparison manifest, study metadata, and
DICOM file requests were all successful. The affected images use JPEG Lossless
transfer syntax `1.2.840.10008.1.2.4.70`.

The decoder worker failed while linking its module graph:

```text
SyntaxError: ...codec-libjpeg-turbo-8bit/... does not provide an export named 'default'
```

Cornerstone's worker statically imports all codec adapters. Several installed
codec packages expose CommonJS/UMD factory files through ESM-style subpath
exports. Vite's dev server served those factories without converting them, so
the worker never reached its Comlink `expose` call. The unresolved worker RPC
made both `setStack()` calls appear to hang indefinitely.

`vite.config.ts` now pre-bundles the four Cornerstone codec factories and
`jpeg-lossless-decoder-js`. This is intentionally a development dependency
optimization; the production build already bundles the decoder graph.

Evidence after the change:

- Paired comparison MRI stacks: passed, with both loading overlays cleared.
- Single-study stack and image deep link: passed.
- The focused comparison test completes in about 10 seconds instead of timing
  out with two permanent loading overlays.

### 2. Mobile timeline panning now works when a drag starts on a marker

The failing drag began directly on the planned late-June Signatera marker. The
old handler rejected interactive descendants so marker taps would keep working.
That also meant the timeline never owned a drag that started on a marker; the
test's pointer then crossed the floating chat control and viewport edge.

The mobile handler now captures the pointer on the original hit target, waits
for a four-pixel movement threshold, and suppresses the marker click only after
a real drag. This keeps normal event selection intact while allowing the
visible date range to pan across overlays and outside the viewport.

The existing regression test exercises both halves of the contract: it selects
the Signatera marker first, then drags from another marker and observes a new
`data-visible-range`.

### 3. The static bundle budget is green again

The failure was not addressed by simply widening the eager budget.

- The reader shell imported `@oncobase/diagnostics/dicom` only to render the
  diagnostics sidebar. That barrel also retained the viewer clients in the
  eager graph. A dedicated `@oncobase/diagnostics/dicom/sidebar` export now
  keeps the approximately 23 KiB gzip DICOM client chunk lazy while loading a
  roughly 1.2 KiB sidebar chunk eagerly.
- The LiveStore diagnostics footer is opt-in but was bundled for every reader.
  It now loads only when the devtools query preference makes it visible.
- Eager gzip fell from 1206.4 KiB to 1183.1 KiB, below the existing 1196.8 KiB
  total budget.
- The LiveStore shell fell from about 15.7 KiB to 14.8 KiB gzip. Its individual
  ceiling is deliberately rebaselined to 15,360 bytes, below the pre-trim
  artifact while leaving a small amount of chunk-hash variance.

`bun --cwd apps/wiki-vite check:bundle` now passes. Lazy assets remain within
their existing 3.4 MB gzip budget.

### 4. Bulk admin selection no longer crashes on checkbox changes

The controlled live-backend run reproduced `admin-users-bulk` as a product
bug, not backend latency. The checkbox handler read
`event.currentTarget.checked` from inside a React state updater, after React had
already cleared the event's `currentTarget`. The handler now captures the
boolean before scheduling the update. The live bulk-user story passes 1/1.

### 5. Chat performance now measures an authenticated live stream

`chat-perf` was aborting because the smoke test submitted to `/api/chat`
without establishing a password-gate session. It now uses the shared gate
helper, checks the assistant response rather than any message node, records
submit/first-token/stream-end milestones, and archives the Convex conversation
it creates. The controlled live suite passes 4/4.

### 6. Robots policy now follows the access-gate decision

The migration baseline intentionally makes public, non-sensitive pages
indexable when the gate is disabled. The contradictory static
`Disallow: /` response was the stale behavior. The standalone server now emits
`Allow: /` only when the gate is disabled and emits `Disallow: /` when the gate
is enabled or its configuration fails closed. The response also opts out of
caching and varies by host.

The Vite-only `Source files` section remains intentional. It predates this
migration, has an explicit reader contract and E2E coverage, and exposes useful
provenance for pages whose source links are already authorized. No parity-only
removal was warranted.

### 7. `table-expansion:33` is not reproducible

The round-two known-red case, "keeps the expanded table between the sidebar and
outline rails," passes in isolation, 10/10 repeated runs, the complete 12-test
table expansion file, and the broader matrix. No product or test change was
made because the current behavior is stable under the original fixture.

### 8. Repeated DICOM annotation drawing preserves the active tool

Selecting an annotation updates the controlled share-link selection. When the
user chose another drawing tool, clearing that selection retriggered the image
reset effect and immediately deactivated the tool. The reset remains scoped to
series/image changes; a separate effect continues to apply requested
annotation selections. Browser coverage now also waits for the chosen
Cornerstone tool to become active before dragging.

The annotation reload and multi-selection stories pass together 2/2.

### 9. Browser-context teardown is deterministic

`tag-page-access` started closing three contexts without awaiting them. Under
the broad matrix this raced Playwright trace shutdown and produced a truncated
trace archive. Teardown now awaits all three closes; the focused story passes.

## Verification completed

- `bun run lint`
- `bun --cwd packages/diagnostics typecheck`
- `bun --cwd packages/diagnostics test:unit` — 15 passed
- `bun --cwd apps/wiki-vite typecheck`
- `bun --cwd apps/wiki-vite test:unit` — 84 passed
- `bun --cwd apps/wiki-vite build`
- `bun --cwd apps/wiki-vite check:bundle`
- DICOM paired comparison plus single-study deep-link E2E — 2 passed
- DICOM diagnostics/stack rail E2E — 1 passed
- Mobile diagnostics swimlane/pan E2E — 1 passed
- LiveStore devtools footer E2E — 5 passed
- Live admin bulk-user E2E — 1 passed
- Authenticated live chat performance E2E — 4 passed
- Robots/app-shell unit suite — 19 passed
- Table expansion E2E — 1 passed isolated, 10/10 repeated, 12/12 full file
- DICOM annotation reload and multi-selection E2E — 2 passed
- Tag-page access E2E — 1 passed

The first broader local matrix run reached 263 passed, 14 skipped, 2 failed,
and 5 not run across 284 tests. It confirmed the comparison viewer,
table-expansion, admin, and chat fixes in the wider sequence. The two failures
were the tag teardown race fixed above and the DICOM reload path discussed
below. A post-fix ordered DICOM-file run reached 23 passed before the remaining
reload failure, leaving 5 tests unrun.

## Remaining research queue

1. **Resolve the sequence-only LiveStore OPFS corruption as its own migration.**
   The DICOM annotation reload passes in isolation and alongside the
   multi-selection story. After 23 earlier DICOM contexts in one long-lived
   worker, however, the same reload can fail twice while querying `fileTree`
   with `database disk image is malformed`. LiveStore's web adapter uses OPFS
   and a SharedWorker, and its current documentation describes an experimental
   `awaitSharedWorkerTermination` option specifically for a new instance racing
   a previous worker's shutdown:
   [WebAdapterOptions](https://docs.livestore.dev/api/adapter-web/type-aliases/webadapteroptions/).
   That option is available in LiveStore 0.4, but a trial upgrade showed that
   0.4 also replaces the current React provider/useStore contract with
   registry-managed lifecycle APIs:
   [StoreRegistry](https://docs.livestore.dev/api/react/classes/storeregistry/).
   The experiment was reverted rather than leave a partial, type-invalid
   dependency upgrade. The next atomic change should migrate the provider and
   consumers, enable the shutdown guard where single-tab ownership permits it,
   and rerun the ordered DICOM and full matrices.
2. **Rerun the complete 284-test matrix after that persistence migration.**
   This round has closed or reclassified every other round-two queue item, but
   it does not claim production-parity certification or deploy anything while
   the ordered reload path remains red.
