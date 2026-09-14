/** Controlled CSR benchmark. Synthetic content over real loopback HTTP: no
 * Playwright request interception (which would disable the browser HTTP cache).
 * Persistent profiles are private, isolated and deleted after each paired run.
 * Run from repo root; pass a saved baseline dist as the first argument. */
import { chromium } from "@playwright/test";
import { getFunctionName } from "convex/server";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { buildCompactTreeFromManifest, makePublicWikiSessionIdentity, WIKI_MANIFEST_SCHEMA_VERSION } from "@oncobase/wiki-content";
import { createWikiViteHandler } from "../server/app-shell";

const output = path.resolve(".playwright/bootstrap-cache");
mkdirSync(output, { recursive: true });
// Isolate each paired run: repeated persistent-browser launches in one Bun
// process can stall after several restarts. Child runs also bound cleanup.
if (!process.env.PROFILE_WORKER && process.env.PROFILE_SERVE !== "1") {
  const combined: unknown[] = [];
  for (const cpu of [1, 4]) for (let run = 1; run <= Number(process.env.PROFILE_RUNS ?? 3); run++) {
    const result = Bun.spawnSync(["bun", import.meta.path, ...process.argv.slice(2)], {
      env: { ...process.env, PROFILE_WORKER: "1", PROFILE_CPU: String(cpu), PROFILE_RUN: String(run) },
      stdout: "inherit", stderr: "inherit", timeout: 90_000,
    });
    if (result.exitCode) throw new Error(`Profile failed: cpu=${cpu}, run=${run}`);
    combined.push(...JSON.parse(readFileSync(path.join(output, `samples-${cpu}-${run}.json`), "utf8")).samples);
  }
  writeFileSync(path.join(output, "samples.json"), JSON.stringify({ samples: combined }, null, 2));
  process.exit(0);
}
const candidateDir = path.resolve("apps/app/dist");
const baselineDir = path.resolve(process.argv[2] ?? path.join(output, "baseline-dist"));
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const pages = ["index", "wiki/second"].map((slug, i) => {
  const content = `# ${i ? "Second page" : "Cache benchmark"}\n\n` +
    "A synthetic article for measuring client-side rendering.\n\n".repeat(30) +
    `[${i ? "Home" : "Second page"}](${i ? "/" : "/wiki/second"})\n`;
  return { slug, title: i ? "Second page" : "Cache benchmark", content,
    contentHash: hash(`${slug}:${content}`), size: Buffer.byteLength(content), sensitive: false, tags: [] };
});
const inventory = pages.map(({ content: _, ...page }) => ({ ...page, description: null }));
const manifest = { schemaVersion: WIKI_MANIFEST_SCHEMA_VERSION, siteSlug: "diana", scope: "public",
  pages: inventory, assets: [], compactTree: buildCompactTreeFromManifest(inventory, []),
  generatedAt: "2026-09-13T00:00:00.000Z", manifestHash: hash(JSON.stringify(inventory)) };
const fakeClient = { async query(ref: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) {
  switch (getFunctionName(ref)) {
    case "sites:getBySlug": case "sites:getByDomain": return { slug: "diana", config: { passwordGate: false } };
    case "documents:getBySlug": return pages.find(page => page.slug === args.slug) ?? null;
    case "users:getSessionUser": return null;
    default: throw new Error(`Unexpected fixture query: ${getFunctionName(ref)}`);
  }
} };
const handlers = Object.fromEntries(await Promise.all((["baseline", "candidate"] as const).map(async mode => {
  const distDir = mode === "baseline" ? baselineDir : candidateDir;
  return [mode, createWikiViteHandler({ client: fakeClient as never, distDir,
    indexHtml: readFileSync(path.join(distDir, "index.html"), "utf8") })];
})));
let mode = "candidate";
let bodyRequests = 0;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const server = Bun.serve({ hostname: "127.0.0.1", port: Number(process.env.PROFILE_PORT ?? 0), async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === "/api/wiki/session") {
    await delay(200);
    return url.searchParams.get("scope") === "session" ? json({ error: "Session required" }, 401) : json(makePublicWikiSessionIdentity("diana"));
  }
  if (url.pathname === "/api/wiki/manifest") { await delay(400); return json(manifest); }
  if (url.pathname === "/api/wiki/pages") {
    bodyRequests++;
    await delay(350);
    return json({ siteSlug: "diana", scope: "public", generatedAt: manifest.generatedAt,
      pages: pages.filter(p => url.searchParams.get("slugs")?.split(",").includes(p.slug)), isDone: true, continueCursor: null });
  }
  if (url.pathname === "/api/wiki/prefetch") return json({ enabled: false, slugs: [] });
  if (url.pathname.startsWith("/api/")) return json({ authenticated: false, user: null });
  const response = await handlers[mode](request);
  if (response.headers.get("Content-Type")?.includes("text/html")) {
    let html = await response.text();
    if (mode === "baseline") html = html.replace(/<script id="wiki-page-bootstrap"[\s\S]*?<\/script><script>[\s\S]*?<\/script>/, "");
    return new Response(html, { status: response.status, headers: response.headers });
  }
  // Compress production assets over HTTP rather than assuming gzip transfer sizes.
  if (response.status === 200 && /\.(js|css|wasm)$/.test(url.pathname)) {
    const headers = new Headers(response.headers);
    headers.set("Content-Encoding", "gzip");
    return new Response(gzipSync(Buffer.from(await response.arrayBuffer())), { headers });
  }
  return response;
} });
const origin = `http://127.0.0.1:${server.port}`;
console.log(JSON.stringify({ origin, mode, fixture: { sessionMs: 200, manifestMs: 400, bodyMs: 350, pages: pages.length } }));
if (process.env.PROFILE_SERVE === "1") await new Promise(() => {});
const samples: Record<string, unknown>[] = [];
try {
  for (const cpu of [Number(process.env.PROFILE_CPU ?? 1)]) for (const run of [Number(process.env.PROFILE_RUN ?? 1)]) {
    for (mode of run % 2 ? ["baseline", "candidate"] : ["candidate", "baseline"]) {
      console.log(JSON.stringify({ phase: "launch", mode, cpu, run }));
      const profile = mkdtempSync(path.join(tmpdir(), "wiki-cache-profile-"));
      let context = await chromium.launchPersistentContext(profile, { viewport: { width: 1440, height: 1000 }, headless: true });
      try {
        for (const visit of ["cold", "reload", "hot", "restart"]) {
          if (visit === "restart") {
            await context.close();
            context = await chromium.launchPersistentContext(profile, { viewport: { width: 1440, height: 1000 }, headless: true });
          }
          const page = context.pages()[0] ?? await context.newPage();
          const cdp = await context.newCDPSession(page);
          await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
          const errors: string[] = [];
          page.on("pageerror", error => errors.push(error.message));
          const trace: { name: string; dur?: number; args?: Record<string, unknown> }[] = [];
          cdp.on("Tracing.dataCollected", event => trace.push(...event.value as unknown as typeof trace));
          if (process.env.PROFILE_TRACE === "1") await cdp.send("Tracing.start", { categories: "v8,devtools.timeline,disabled-by-default-v8.compile", transferMode: "ReportEvents" });
          await page.addInitScript(() => {
            const target = window as typeof window & { __cacheProbe?: number };
            const check = () => {
              const article = document.querySelector('#root [data-test-id="document-article"] .wiki-markdown');
              if (article && getComputedStyle(article).visibility !== "hidden" && article.getBoundingClientRect().height > 0) {
                // Observe across frames, separately from the existing route timer.
                requestAnimationFrame(() => { target.__cacheProbe ??= performance.now(); });
              } else requestAnimationFrame(check);
            };
            requestAnimationFrame(check);
          });
          bodyRequests = 0;
          if (visit === "reload" || visit === "hot") await page.reload({ waitUntil: "domcontentloaded" });
          else await page.goto(origin + "/?scope=public", { waitUntil: "domcontentloaded" });
          await page.waitForFunction(() => (window as typeof window & { __cacheProbe?: number }).__cacheProbe, undefined, { timeout: 30_000 });
          // Allow manifest reconciliation and cache writes to complete before repeat loads.
          await page.waitForTimeout(900);
          const data = await page.evaluate(() => {
            const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
            const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
            return { articleMs: (window as typeof window & { __cacheProbe?: number }).__cacheProbe,
              htmlMs: nav.responseEnd, fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime,
              seeded: performance.getEntriesByName("wiki-page-bootstrap-seeded").length > 0,
              js: resources.filter(r => new URL(r.name).pathname.endsWith(".js")).map(r => ({ path: new URL(r.name).pathname, transfer: r.transferSize, encoded: r.encodedBodySize })) };
          });
          if (process.env.PROFILE_TRACE === "1") {
            const completed = new Promise<void>(resolve => cdp.once("Tracing.tracingComplete", () => resolve()));
            await cdp.send("Tracing.end"); await completed;
          }
          const compileEvents = trace.filter(e => /compile|cache/i.test(e.name));
          const result = { mode, cpu, run, visit, bodyRequests, errors, ...data,
            jsTransfer: data.js.reduce((sum, r) => sum + r.transfer, 0),
            compileEvents: Object.fromEntries([...new Set(compileEvents.map(e => e.name))].map(name => [name,
              { count: compileEvents.filter(e => e.name === name).length, durationMs: compileEvents.filter(e => e.name === name).reduce((s, e) => s + (e.dur ?? 0), 0) / 1000 }])) };
          samples.push(result);
          console.log(JSON.stringify({ mode, cpu, run, visit, articleMs: Math.round(data.articleMs!), bodyRequests, jsTransfer: result.jsTransfer, errors: errors.length }));
          if (mode === "candidate" && run === 1 && cpu === 1 && visit === "cold") await page.screenshot({ path: path.join(output, "candidate.png") });
          writeFileSync(path.join(output, `samples-${cpu}-${run}.json`), JSON.stringify({ origin, samples }, null, 2));
          if (errors.length) throw new Error(errors.join("\n"));
          if (mode === "candidate" && (!data.seeded || bodyRequests)) throw new Error("Bootstrap must seed the article without a body request");
          // Context closure owns CDP cleanup; do not detach during navigation.
        }
      } finally {
        console.log(JSON.stringify({ phase: "closing", mode, cpu, run }));
        await context.close();
        console.log(JSON.stringify({ phase: "removing-profile", mode, cpu, run }));
        Bun.spawnSync(["/bin/rm", "-rf", profile]);
        console.log(JSON.stringify({ phase: "profile-removed", mode, cpu, run }));
      }
    }
  }
} finally { server.stop(true); }
