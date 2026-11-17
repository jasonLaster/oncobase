#!/bin/sh
# SPIKE: rebuild the SSR bundle and run the bench.
cd "$(dirname "$0")/../.."
bunx vite build -c spike/ssr/vite.ssr.config.ts --ssr spike/ssr/entry-server.tsx --outDir .spike-ssr --emptyOutDir >/dev/null 2>&1 || exit 1
node spike/ssr/bench.mjs "$@"
