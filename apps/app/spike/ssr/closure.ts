// SPIKE: bun spike/ssr/closure.ts <dir> <entry.js>
// Bytes a cold function evaluates before its first render (static imports),
// and everything reachable including dynamic imports, with gzip for each.
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const [dir, entry] = process.argv.slice(2);
function closure(includeDynamic: boolean) {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    const pattern = includeDynamic
      ? /(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}\/[^"']+\.js)["']/g
      : /(?:\bfrom|\bimport)\s*["'](\.{1,2}\/[^"']+\.js)["']/g;
    for (const match of source.matchAll(pattern)) visit(path.resolve(path.dirname(file), match[1]!));
  };
  visit(path.resolve(dir!, entry!));
  const files = [...seen];
  const bytes = files.reduce((sum, f) => sum + statSync(f).size, 0);
  const gzip = files.reduce((sum, f) => sum + gzipSync(readFileSync(f), { level: 6 }).length, 0);
  return { files: files.length, KiB: +(bytes / 1024).toFixed(1), gzipKiB: +(gzip / 1024).toFixed(1) };
}
console.log(JSON.stringify({ static: closure(false), withDynamic: closure(true) }));
