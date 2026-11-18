// SPIKE: bun spike/ssr/profile.ts <fixture> — CPU profile (mobile lab profile)
// from hydrateRoot to +400 ms; prints self time by function and by file.
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { installSsrReplay } from "./replay";

const root = path.resolve(import.meta.dir, "../..");
const name = process.argv[2] ?? "panel18";
const mod = await import(path.join(root, ".spike-ssr/entry-server.js"));
const { createElement } = await import("react");
const template = readFileSync(path.join(root, ".spike-client/spike/ssr/hydrate.html"), "utf8");
const fx = JSON.parse(readFileSync(path.join(import.meta.dir, `fixtures/${name}.json`), "utf8"));
const stream = await mod.renderToReadableStream(createElement(mod.ServerFirstFrame, fx));
await stream.allReady;
const html = template.replace("<!--spike-head-->", `<script>(${installSsrReplay.toString()})()</script>`)
  .replace("<!--spike-root-->", await new Response(stream).text())
  .replace("<!--spike-fixture-->", `<script id="spike-fixture" type="application/json">${JSON.stringify(fx).replace(/</g, "\\u003c")}</script>`);
const served = process.env.GATE === "1" ? html.replace(/<script type="module" crossorigin src="(\/assets\/hydrate-[^"]+)"><\/script>/, '<script type="module" blocking="render" crossorigin src="$1"></script>') : html;
const server = Bun.serve({ port: 62251, async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === fx.url) return new Response(served, { headers: { "Content-Type": "text/html" } });
  const file = Bun.file(path.join(root, ".spike-client", url.pathname));
  return (await file.exists()) ? new Response(file) : new Response("missing", { status: 404 });
} });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
if (process.env.THROTTLE !== "0") {
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 });
}
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
await cdp.send("Profiler.start");
await page.goto(`http://127.0.0.1:62251${fx.url}?profile`);
await page.waitForTimeout(Number(process.env.WAIT_MS ?? 9000));
const { profile } = await cdp.send("Profiler.stop") as any;
const call = await page.evaluate(() => performance.getEntriesByName("ssr-hydrate-call")[0]?.startTime ?? 0);
await browser.close();
server.stop(true);

// Map sample timestamps (µs, profile clock) onto page time via the hydrate call.
const nodes = new Map<number, any>(profile.nodes.map((n: any) => [n.id, n]));
let t = profile.startTime;
const times: number[] = [];
for (const delta of profile.timeDeltas) { t += delta; times.push(t); }
// Find the first sample inside hydrateRoot's caller (entry-client top level) as anchor.
const parent = new Map<number, number>();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const anchorPattern = process.env.ANCHOR ? new RegExp(process.env.ANCHOR) : /hydrateRoot|hydrate-/;
const inStack = (id: number) => { for (let cur: number | undefined = id; cur !== undefined; cur = parent.get(cur)) { const f = nodes.get(cur)?.callFrame; if (f && anchorPattern.test(f.url + f.functionName)) return true; } return false; };
const anchorIdx = profile.samples.findIndex((id: number) => inStack(id));
const anchor = anchorIdx >= 0 ? times[anchorIdx]! : times[0]!;
const windowMs = Number(process.env.WINDOW_MS ?? 400);
const byFn = new Map<string, number>();
const byFile = new Map<string, number>();
for (let i = 0; i < profile.samples.length; i++) {
  const rel = (times[i]! - anchor) / 1000;
  if (rel < 0 || rel > windowMs) continue;
  const node = nodes.get(profile.samples[i]);
  const dt = (profile.timeDeltas[i + 1] ?? 0) / 1000;
  const fn = `${node.callFrame.functionName || "(anon)"} ${path.basename(node.callFrame.url)}:${node.callFrame.lineNumber}`;
  byFn.set(fn, (byFn.get(fn) ?? 0) + dt);
  const file = path.basename(node.callFrame.url) || node.callFrame.functionName;
  byFile.set(file, (byFile.get(file) ?? 0) + dt);
}
const top = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v.toFixed(1).padStart(7)} ms  ${k}`).join("\n");
console.log(`hydrate call at ${Math.round(call)} ms; window ${windowMs} ms after the first hydrate sample (CPU 4x)`);
console.log("--- by file\n" + top(byFile, 15));
console.log("--- by function\n" + top(byFn, 30));
