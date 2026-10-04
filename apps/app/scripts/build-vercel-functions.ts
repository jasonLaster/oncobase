import { rm, unlink } from "node:fs/promises";
import { assertBuildAssets, assertPublicAssets } from "./public-assets";
import { assertReaderServerBudget } from "./reader-server-budget";

const appDir = new URL("..", import.meta.url).pathname;

const outdir = `${appDir}/.vercel-functions`;
const indexPath = `${appDir}/dist/index.html`;
assertPublicAssets(`${appDir}/public`);
assertBuildAssets(`${appDir}/dist`);
const indexHtml = await Bun.file(indexPath).text();
await rm(outdir, { recursive: true, force: true });
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
  },
});

for (const log of result.logs) {
  const level = log.level === "error" ? "error" : "warn";
  console[level](log.message);
}

if (!result.success) {
  process.exit(1);
}

for (const name of ["index", "root-app-shell"]) {
  const source = `${outdir}/${name}.js`;
  const target = `${outdir}/${name}.mjs`;
  await Bun.write(target, Bun.file(source));
}

assertReaderServerBudget(outdir);

const gate = await Bun.build({ entrypoints: [`${appDir}/api-runtime/edge-gate.ts`], outdir,
  target: "browser", format: "esm", minify: true });
if (!gate.success) {
  for (const log of gate.logs) console.error(log.message);
  process.exit(1);
}

if (process.env.WIKI_VITE_EMBED_APP_SHELL === "1") {
  // Vercel's filesystem routing serves a root index.html before evaluating the
  // catch-all rewrite. Keep the SPA shell inside the gated function so `/`
  // cannot bypass password enforcement, while hashed assets remain static.
  await unlink(indexPath);
  // Let the server choose the crawler policy for each site and its public education routes.
  await rm(`${appDir}/dist/robots.txt`, { force: true });
}
