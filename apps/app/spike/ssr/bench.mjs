// SPIKE: node spike/ssr/bench.mjs [renderToString|stream] [iterations]
// Imports the vite --ssr build of entry-server.tsx with no DOM globals, the
// way the Vercel Node function would, and times first-frame renders.
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const mode = process.argv[2] ?? "renderToString";
const iterations = Number(process.argv[3] ?? 20);
const t0 = performance.now();
const mod = await import(new URL("../../.spike-ssr/entry-server.js", import.meta.url));
const importMs = performance.now() - t0;
const { createElement } = await import("react");
const fixtures = Object.fromEntries(["normal", "panel18", "large30"].map(name =>
  [name, JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"))]));

const errors = [];
async function render(fx) {
  const md = fx.initial.page.content;
  if (process.env.PRELOAD !== "0") {
    if (mod.mayContainMath(md)) await mod.preloadMarkdownMath();
    if (mod.documentMayNeedRawHtml(md)) await mod.preloadRawHtml();
  }
  const element = createElement(mod.ServerFirstFrame, fx);
  if (mode === "stream") {
    const stream = await mod.renderToReadableStream(element, { onError: e => { errors.push(String(e?.message ?? e)); } });
    await stream.allReady;
    return await new Response(stream).text();
  }
  return mod.renderToString(element);
}

const results = { runtime: `node ${process.version}`, mode, importMs: Math.round(importMs) };
for (const [name, fx] of Object.entries(fixtures)) {
  const first = performance.now();
  const html = await render(fx);
  const firstMs = performance.now() - first;
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const s = performance.now();
    await render(fx);
    samples.push(performance.now() - s);
  }
  samples.sort((a, b) => a - b);
  results[name] = {
    markdownBytes: fx.initial.page.size,
    htmlBytes: Buffer.byteLength(html),
    tables: (html.match(/<table/g) ?? []).length,
    hasArticle: html.includes("wiki-markdown"),
    hasTree: html.includes('role="tree"') || html.includes("data-tree"),
    firstRenderMs: +firstMs.toFixed(1),
    p50Ms: +samples[Math.floor(samples.length / 2)].toFixed(1),
    p90Ms: +samples[Math.floor(samples.length * 0.9)].toFixed(1),
  };
  if (process.env.DUMP) (await import("node:fs")).writeFileSync(new URL(`./out/${name}-${mode}.html`, import.meta.url), html);
}
results.errors = [...new Set(errors)].slice(0, 10);
console.log(JSON.stringify(results, null, 2));
