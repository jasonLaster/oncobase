# SPIKE: P3 server-rendering measurements (do not ship)

Throwaway harness behind `plans/2026-11-17-server-rendering-plan.md`. Nothing
here is imported by the app or the server, and no app source is changed in
this commit. The app-source edits the spike needs live in patch files: apply
them only while measuring, never commit them as-is.

- `server-safety.patch`: the three render guards from the first spike (§2.1).
- `hydration-path.patch`: everything the paint-to-responsive spike changed in
  `src/` (it includes the guards). Lazy sectioned article body with sequential
  hydration gates (`pages/ArticleBody.tsx`), Suspense around the sidebar and
  the drawer tree, palette shortcut adopted in a layout effect, region
  `<Profiler>`s. Apply one patch or the other, not both.

```sh
cd apps/app
git apply spike/ssr/hydration-path.patch         # temporary
bun spike/ssr/make-fixtures.ts                    # synthetic fixtures -> spike/ssr/fixtures/
./spike/ssr/build.sh                              # SSR bundle + client build of hydrate.html, prints critical-path KiB
bun spike/ssr/preloads.ts                         # what the page must fetch before it can hydrate

# Paint-to-responsive gap, mobile lab profile, 5 cold loads per page (port SPIKE_PORT=62251):
SPIKE_GATE=1 SPIKE_CV=1 SPIKE_OFFSET=16 SPIKE_REPLAY=1 NODE_ENV=production bun spike/ssr/gap.ts > spike/ssr/out/gap.json
python3 -I spike/ssr/gap-summary.py spike/ssr/out/gap.json "label"
#   SPIKE_PROBE=click|shortcut|link   SPIKE_OFFSET=<ms after paint> (6000 = idle baseline)
#   SPIKE_REPLAY=1 capture/replay script   SPIKE_GATE=1 render-blocking entry
#   SPIKE_CV=1 content-visibility on sections   SPIKE_BLOCK_JS=1 abort the entry bundle
#   SPIKE_PAGES=normal,panel18   SPIKE_RUNS=5   SPIKE_WARMUPS=2

# CPU profile around the root commit (unminified client build):
SPIKE_NOMINIFY=1 bunx vite build -c spike/ssr/vite.client.config.ts
GATE=1 ANCHOR=spikeCommitMarker WINDOW_MS=300 NODE_ENV=production bun spike/ssr/profile.ts panel18
# Region render timings: SPIKE_PROFILING=1 ./spike/ssr/build.sh, then gap.ts (results carry `prof`).

# First spike: render time, bundle, cold start, hydration matrix
NODE_ENV=production node spike/ssr/bench.mjs stream 20
NODE_ENV=production node spike/ssr/split.mjs
SPIKE_BUNDLE_ALL=1 bunx vite build -c spike/ssr/vite.ssr.config.ts --ssr spike/ssr/entry-server.tsx --outDir .spike-ssr-bundled --emptyOutDir --minify
bun spike/ssr/closure.ts .spike-ssr-bundled entry-server.js
NODE_ENV=production node spike/ssr/coldstart.mjs .spike-ssr-bundled normal
NODE_ENV=production bun spike/ssr/hydrate-check.ts > spike/ssr/out/hydrate.json

git apply -R spike/ssr/hydration-path.patch && rm -f src/pages/ArticleBody.tsx
rm -rf .spike-ssr .spike-ssr-bundled .spike-client
```
