/** Verify an ordinary app edit does not invalidate stable library URLs.
 * Run serially: temporarily edits one source file and always restores it. */
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
const app = path.resolve(import.meta.dir, "..");
const sourcePath = path.join(app, "src/wiki-utils.ts");
const original = readFileSync(sourcePath, "utf8");
const probe = original.replace('return "unknown"', 'return "not available"');
if (probe === original) throw new Error("Update the ordinary-app-edit fixture");
const temp = mkdtempSync(path.join(tmpdir(), "wiki-bundle-cache-"));
function build(name: string) {
  const outDir = path.join(temp, name);
  const result = Bun.spawnSync(["bunx", "vite", "build", "--outDir", outDir, "--emptyOutDir"], { cwd: app, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode) throw new Error(result.stderr.toString());
  const dir = path.join(outDir, "assets");
  return readdirSync(dir).filter(name => /^vendor-.*\.js$/.test(name)).map(name => ({ name,
    body: readFileSync(path.join(dir, name), "utf8"), gzipBytes: gzipSync(readFileSync(path.join(dir, name))).length }));
}
try {
  const before = build("before");
  writeFileSync(sourcePath, probe);
  const after = build("after");
  const report = before.map(chunk => ({ name: chunk.name, gzipBytes: chunk.gzipBytes,
    unchanged: after.some(next => next.name === chunk.name && next.body === chunk.body),
    appImports: [...chunk.body.matchAll(/(?:from\s*|import\s*)"\.\/([^" ]+\.js)"/g)]
      .map(match => match[1]).filter(name => !/^(vendor-|rolldown-runtime-)/.test(name)) }));
  console.log(JSON.stringify(report, null, 2));
  if (report.length !== 6 || report.some(chunk => !chunk.unchanged || chunk.appImports.length)) {
    throw new Error("A vendor bundle depends on application code or changed with the app edit");
  }
} finally {
  writeFileSync(sourcePath, original);
  Bun.spawnSync(["/bin/rm", "-rf", temp]);
}
