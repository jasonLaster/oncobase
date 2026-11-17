// SPIKE: NODE_ENV=production node spike/ssr/coldstart.mjs <bundle dir> [fixture]
// One fresh process: module evaluation of the fully bundled SSR entry, then the
// first render (cold JIT) and a second render (warm), for the given fixture.
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const dir = process.argv[2] ?? ".spike-ssr-bundled";
const name = process.argv[3] ?? "normal";
const t0 = performance.now();
const mod = await import(new URL(`../../${dir}/entry-server.js`, import.meta.url));
const { createElement } = await import("react");
const importMs = performance.now() - t0;
const fx = JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
async function render() {
  const md = fx.initial.page.content;
  if (mod.mayContainMath(md)) await mod.preloadMarkdownMath();
  if (mod.documentMayNeedRawHtml(md)) await mod.preloadRawHtml();
  const stream = await mod.renderToReadableStream(createElement(mod.ServerFirstFrame, fx));
  await stream.allReady;
  return (await new Response(stream).text()).length;
}
const t1 = performance.now();
await render();
const firstMs = performance.now() - t1;
const t2 = performance.now();
await render();
const secondMs = performance.now() - t2;
console.log(JSON.stringify({ fixture: name, importMs: Math.round(importMs), firstRenderMs: Math.round(firstMs), secondRenderMs: Math.round(secondMs), rssMiB: Math.round(process.memoryUsage().rss / 1048576) }));
