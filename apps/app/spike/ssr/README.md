# SPIKE: P3 server-rendering measurements (do not ship)

Throwaway harness behind `plans/2026-11-17-server-rendering-plan.md`. Nothing
here is imported by the app or the server, and no app source is changed. The
render guards the spike needed are in `server-safety.patch`: apply them only
while measuring, never commit them as-is.

```sh
cd apps/app
git apply spike/ssr/server-safety.patch          # temporary
bun spike/ssr/make-fixtures.ts                    # synthetic fixtures -> spike/ssr/fixtures/
bunx vite build -c spike/ssr/vite.ssr.config.ts --ssr spike/ssr/entry-server.tsx --outDir .spike-ssr --emptyOutDir
NODE_ENV=production node spike/ssr/bench.mjs stream 20          # render time (also: renderToString)
NODE_ENV=production node spike/ssr/split.mjs                    # markdown vs chrome
SPIKE_BUNDLE_ALL=1 bunx vite build -c spike/ssr/vite.ssr.config.ts --ssr spike/ssr/entry-server.tsx --outDir .spike-ssr-bundled --emptyOutDir --minify
bun spike/ssr/closure.ts .spike-ssr-bundled entry-server.js     # renderer bundle size
NODE_ENV=production node spike/ssr/coldstart.mjs .spike-ssr-bundled normal
bunx vite build -c spike/ssr/vite.client.config.ts              # client build of the same tree
NODE_ENV=production bun spike/ssr/hydrate-check.ts > spike/ssr/out/hydrate.json   # port SPIKE_PORT (62251)
python3 -I spike/ssr/summarize.py spike/ssr/out/hydrate.json
git apply -R spike/ssr/server-safety.patch
rm -rf .spike-ssr .spike-ssr-bundled .spike-client
```

`hydrate-check.ts` accepts `SPIKE_ONLY=<condition substring>` and `SPIKE_REPEAT=<n>`.
