// SPIKE: bun spike/ssr/debug-body.ts — does the lazy article body hydrate?
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dir, "../..");
const mod = await import(path.join(root, ".spike-ssr/entry-server.js"));
const { createElement } = await import("react");
const template = readFileSync(path.join(root, ".spike-client/spike/ssr/hydrate.html"), "utf8");
const fx = JSON.parse(readFileSync(path.join(import.meta.dir, "fixtures/normal.json"), "utf8"));
const stream = await mod.renderToReadableStream(createElement(mod.ServerFirstFrame, fx));
await stream.allReady;
const body = await new Response(stream).text();
const html = template.replace("<!--spike-root-->", body).replace("<!--spike-fixture-->", `<script id="spike-fixture" type="application/json">${JSON.stringify(fx).replace(/</g, "\\u003c")}</script>`);
const requests: string[] = [];
const server = Bun.serve({ port: 62251, async fetch(request) {
  const url = new URL(request.url);
  requests.push(url.pathname);
  if (url.pathname === fx.url) return new Response(html, { headers: { "Content-Type": "text/html" } });
  const file = Bun.file(path.join(root, ".spike-client", url.pathname));
  return (await file.exists()) ? new Response(file) : new Response("missing", { status: 404 });
} });
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", m => console.log("console", m.type(), m.text().slice(0, 300)));
page.on("pageerror", e => console.log("pageerror", e.message));
await page.goto(`http://127.0.0.1:62251${fx.url}`);
await page.waitForTimeout(3000);
console.log(await page.evaluate(() => {
  const a = document.querySelector(".wiki-markdown a");
  return { link: a?.outerHTML.slice(0, 160), linkProps: a ? Object.keys(a).filter(k => k.startsWith("__react")) : null,
    markdown: Object.keys(document.querySelector(".wiki-markdown")!).filter(k => k.startsWith("__react")),
    recoverable: (window as any).__SPIKE__.recoverable };
}));
console.log(requests.filter(r => r.includes("Article") || r.includes("markdown") || r.includes("renderer")));
await browser.close();
server.stop(true);
