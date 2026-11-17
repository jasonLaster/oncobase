// SPIKE: bun spike/ssr/closure-list.ts <dir> <entry.js>  (static closure, largest first)
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const [dir, entry] = process.argv.slice(2);
const seen = new Set<string>();
const visit = (file: string) => {
  if (seen.has(file)) return;
  seen.add(file);
  for (const m of readFileSync(file, "utf8").matchAll(/(?:\bfrom|\bimport)\s*["'](\.{1,2}\/[^"']+\.js)["']/g)) visit(path.resolve(path.dirname(file), m[1]!));
};
visit(path.resolve(dir!, entry!));
for (const f of [...seen].sort((a, b) => statSync(b).size - statSync(a).size)) console.log((statSync(f).size / 1024).toFixed(1).padStart(8), path.basename(f));
