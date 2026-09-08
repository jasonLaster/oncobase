import { rm, unlink } from "node:fs/promises";
import { assertBuildAssets, assertPublicAssets } from "./public-assets";
import { criticalReaderCss } from "./critical-reader-css";
import { buildStaticReader } from "./build-static-reader";

const appDir = new URL("..", import.meta.url).pathname;

const outdir = `${appDir}/.vercel-functions`;
const indexPath = `${appDir}/dist/index.html`;
assertPublicAssets(`${appDir}/public`);
assertBuildAssets(`${appDir}/dist`);
const indexHtml = await Bun.file(indexPath).text();
const stylesheets = [...indexHtml.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)]
  .map(([tag]) => tag.match(/href="([^"]+)"/)?.[1]).filter((href): href is string => Boolean(href));
const criticalCss = criticalReaderCss((await Promise.all(stylesheets.map(href => {
  if (!/^\/assets\/[\w.-]+\.css$/.test(href)) throw new Error("Unexpected entry stylesheet");
  return Bun.file(`${appDir}/dist${href}`).text();
}))).join("\n"));
await rm(outdir, { recursive: true, force: true });
await Bun.write(`${outdir}/reader-critical.css`, criticalCss);
const staticPrefixes = await buildStaticReader({ appDir, indexHtml, criticalCss });
const result = await Bun.build({
  entrypoints: [
    `${appDir}/api-runtime/index.ts`,
    `${appDir}/api-runtime/root-app-shell.ts`,
  ],
  outdir,
  target: "node",
  format: "esm",
  splitting: true,
  minify: true,
  sourcemap: "external",
  define: {
    __WIKI_VITE_INDEX_HTML__: JSON.stringify(indexHtml),
    __WIKI_CRITICAL_CSS__: JSON.stringify(criticalCss),
  },
});

for (const log of result.logs) {
  const level = log.level === "error" ? "error" : "warn";
  console[level](log.message);
}

if (!result.success) {
  process.exit(1);
}

await Promise.all(["index", "root-app-shell"].map(async name => {
  const source = `${outdir}/${name}.js`;
  const target = `${outdir}/${name}.mjs`;
  await Bun.write(target, Bun.file(source));
}));

const gate = await Bun.build({ entrypoints: [`${appDir}/api-runtime/edge-gate.ts`], outdir,
  target: "browser", format: "esm", minify: true,
  define: { __WIKI_STATIC_READER_PREFIXES__: JSON.stringify(staticPrefixes) } });
if (!gate.success) {
  for (const log of gate.logs) console.error(log.message);
  process.exit(1);
}

if (process.env.WIKI_VITE_EMBED_APP_SHELL === "1") {
  // Vercel's filesystem routing serves a root index.html before evaluating the
  // catch-all rewrite. Keep the SPA shell inside the gated function so `/`
  // cannot bypass password enforcement, while hashed assets remain static.
  await unlink(indexPath);
}
