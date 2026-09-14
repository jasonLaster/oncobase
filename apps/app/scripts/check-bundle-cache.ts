/** Verify app edits preserve vendor URLs and metadata-only deployments preserve
 * every JS/CSS/WASM asset while updating HTML deployment diagnostics.
 * Run serially: temporarily edits one source file and always restores it. */
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
const app = path.resolve(import.meta.dir, "..");
const sourcePath = path.join(app, "src/wiki-utils.ts");
const original = readFileSync(sourcePath, "utf8");
const probe = original.replace('return "unknown"', 'return "not available"');
if (probe === original) throw new Error("Update the ordinary-app-edit fixture");
const temp = mkdtempSync(path.join(tmpdir(), "wiki-bundle-cache-"));
const beforeSha = "a".repeat(40);
const afterSha = "b".repeat(40);
function build(name: string, commitSha = beforeSha) {
  const outDir = path.join(temp, name);
  const result = Bun.spawnSync(["bunx", "vite", "build", "--outDir", outDir, "--emptyOutDir"], {
    cwd: app, env: { ...process.env, VITE_VERCEL_GIT_COMMIT_SHA: commitSha,
      VITE_VERCEL_URL: `${commitSha}.example.com`, VITE_VERCEL_GIT_COMMIT_MESSAGE: `Deployment ${commitSha}` }, stdout: "pipe", stderr: "pipe",
  });
  if (result.exitCode) throw new Error(result.stderr.toString());
  const dir = path.join(outDir, "assets");
  const names = readdirSync(dir);
  const assets = names.filter(name => /\.(?:js|css|wasm)$/.test(name)).sort().map(name => ({ name,
    hash: createHash("sha256").update(readFileSync(path.join(dir, name))).digest("hex") }));
  const vendor = names.filter(name => /^vendor-.*\.js$/.test(name)).map(name => ({ name,
    body: readFileSync(path.join(dir, name), "utf8"), gzipBytes: gzipSync(readFileSync(path.join(dir, name))).length }));
  const metadataInJavaScript = names.filter(name => name.endsWith(".js") && readFileSync(path.join(dir, name), "utf8").includes(commitSha));
  return { vendor, assets, metadataInJavaScript, html: readFileSync(path.join(outDir, "index.html"), "utf8") };
}
try {
  const before = build("before");
  writeFileSync(sourcePath, probe);
  const after = build("after");
  const report = before.vendor.map(chunk => ({ name: chunk.name, gzipBytes: chunk.gzipBytes,
    unchanged: after.vendor.some(next => next.name === chunk.name && next.body === chunk.body),
    appImports: [...chunk.body.matchAll(/(?:from\s*|import\s*)"\.\/([^" ]+\.js)"/g)]
      .map(match => match[1]).filter(name => !/^(vendor-|rolldown-runtime-)/.test(name)) }));
  console.log(JSON.stringify(report, null, 2));
  if (report.length !== 6 || report.some(chunk => !chunk.unchanged || chunk.appImports.length)) {
    throw new Error("A vendor bundle depends on application code or changed with the app edit");
  }
  writeFileSync(sourcePath, original);
  const metadataOnly = build("metadata-only", afterSha);
  const unchangedAssets = JSON.stringify(before.assets) === JSON.stringify(metadataOnly.assets);
  const metadataChanged = before.html.includes(`name="wiki-build-commit" content="${beforeSha}"`) &&
    metadataOnly.html.includes(`name="wiki-build-commit" content="${afterSha}"`);
  const metadataAbsentFromJavaScript = before.metadataInJavaScript.length === 0 && metadataOnly.metadataInJavaScript.length === 0;
  console.log(JSON.stringify({ metadataOnlyDeployment: { assets: before.assets.length, unchangedAssets, metadataChanged, metadataAbsentFromJavaScript } }));
  if (!unchangedAssets || !metadataChanged || !metadataAbsentFromJavaScript) throw new Error("Deployment metadata invalidated browser assets or was omitted from HTML");
} finally {
  writeFileSync(sourcePath, original);
  Bun.spawnSync(["/bin/rm", "-rf", temp]);
}
