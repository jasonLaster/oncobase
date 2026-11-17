// SPIKE: NODE_ENV=production node spike/ssr/split.mjs — markdown-only vs whole first frame.
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const mod = await import(new URL("../../.spike-ssr/entry-server.js", import.meta.url));
const { createElement } = await import("react");
const median = async (fn, n = 15) => {
  const s = [];
  for (let i = 0; i < n; i++) { const t = performance.now(); await fn(); s.push(performance.now() - t); }
  s.sort((a, b) => a - b);
  return +s[n >> 1].toFixed(1);
};
for (const name of ["normal", "panel18", "large30"]) {
  const fx = JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
  const md = fx.initial.page.content;
  if (mod.mayContainMath(md)) await mod.preloadMarkdownMath();
  if (mod.documentMayNeedRawHtml(md)) await mod.preloadRawHtml();
  const markdownOnly = await median(() => mod.renderToString(createElement(mod.WikiMarkdown, { content: md, currentSlug: fx.initial.page.slug })));
  const empty = { ...fx, initial: { ...fx.initial, page: { ...fx.initial.page, content: "# t\n\nx" } } };
  const chromeOnly = await median(() => mod.renderToString(createElement(mod.ServerFirstFrame, empty)));
  const whole = await median(() => mod.renderToString(createElement(mod.ServerFirstFrame, fx)));
  console.log(JSON.stringify({ name, markdownOnlyMs: markdownOnly, chromeWithTinyArticleMs: chromeOnly, wholeFirstFrameMs: whole }));
}
