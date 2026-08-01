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

## Remaining research queue

1. `admin-users-bulk` and `chat-perf` still require controlled live backends to
   distinguish regressions from service/model latency.
2. `table-expansion:33` remains the known-red table case from round two and
   needs an isolated fixture/reproduction before changing table behavior.
3. Confirm product intent for Vite-only source-file links and for the opposing
   robots meta directives. Both are explicit behavior decisions, not failures
   to patch opportunistically.
4. Run the broader migration matrix before release. This kickoff verifies each
   changed story and its adjacent shell behavior; it does not claim a new
   production-parity certification or deploy anything.
