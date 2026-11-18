// SPIKE: bun spike/ssr/preloads.ts — what the hydrate page fetches before it can hydrate.
import { readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const root = path.resolve(import.meta.dir, "../../.spike-client");
const html = readFileSync(path.join(root, "spike/ssr/hydrate.html"), "utf8");
const refs = [...html.matchAll(/(?:href|src)="\/(assets\/[^"]+\.(?:js|css))"/g)].map(m => m[1]!);
let total = 0;
const rows = refs.map(ref => {
  const gz = gzipSync(readFileSync(path.join(root, ref)), { level: 6 }).length;
  total += gz;
  return [ref, gz] as const;
}).sort((a, b) => b[1] - a[1]);
for (const [ref, gz] of rows) console.log(String((gz / 1024).toFixed(1)).padStart(7), "KiB", ref);
console.log(String((total / 1024).toFixed(1)).padStart(7), "KiB total gzip,", rows.length, "files");
