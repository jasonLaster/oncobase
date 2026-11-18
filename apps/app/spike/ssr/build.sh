#!/bin/sh
# SPIKE: rebuild the SSR bundle and the client build of the hydrate page.
cd "$(dirname "$0")/../.." || exit 1
bunx vite build -c spike/ssr/vite.ssr.config.ts --ssr spike/ssr/entry-server.tsx --outDir .spike-ssr --emptyOutDir >/dev/null 2>&1 || { echo "ssr build failed"; exit 1; }
bunx vite build -c spike/ssr/vite.client.config.ts >/dev/null 2>&1 || { echo "client build failed"; exit 1; }
bun spike/ssr/preloads.ts | tail -1
