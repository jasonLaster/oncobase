import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { installWikiApiMocks } from "../e2e/fixtures";

// Run against a production build, not Vite's development transforms. Artifacts
// remain private: live screenshots can contain document content. Live traces
// deliberately omit DOM/network snapshots (and therefore response cookies).
const argument = (name: string, fallback: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
};
const origin = new URL(argument("url", "http://127.0.0.1:62141")).origin;
const source = argument("source", "fixture");
const phase = argument("phase", "candidate");
const runs = Number(argument("runs", "3"));
const cpu = Number(argument("cpu", "4"));
const scopeFilter = argument("scope", "all");
const device = argument("device", "all");
const output = path.resolve(import.meta.dirname, "../../../.playwright/performance-matrix", phase);
const results: Record<string, unknown>[] = [];
let activeCase = "setup";
const route = argument("path", "/wiki/logistics/insurance");
const article = '#root [data-test-id="document-article"] .wiki-markdown p';
const readySelector = argument("ready", article);
const viewports = { desktop: { width: 1440, height: 1000 }, mobile: { width: 390, height: 844 } };
type ReaderProbe = { skeleton: number; snapshot: number; sidebar: number; article: number; routeReady: number; login: number; longTasks: number[] };

if (!/^[a-z0-9_-]+$/i.test(phase) || !["fixture", "live"].includes(source) || !Number.isInteger(runs) || runs < 1 || runs > 20) {
  throw new Error("Use a simple phase name, fixture/live source, and 1-20 runs");
}
if (source === "fixture" && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname)) {
  throw new Error("Full fixture traces require a loopback test server");
}
if (!route.startsWith("/") || new URL(route, origin).origin !== origin || /[?#]/.test(route)) throw new Error("Use a same-origin pathname without query or fragment");

async function authenticate(context: BrowserContext) {
  const password = process.env.WIKI_PERF_PASSWORD;
  if (!password) throw new Error("WIKI_PERF_PASSWORD is required");
  // Keep authentication outside Playwright request logging and trace recording.
  const response = await fetch(`${origin}/api/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }), redirect: "manual", signal: AbortSignal.timeout(20_000),
  });
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  const ok = response.ok;
  await response.body?.cancel();
  if (!ok || !cookie) throw new Error("Authorized login failed");
  const separator = cookie.indexOf("=");
  await context.addCookies([{ name: cookie.slice(0, separator), value: cookie.slice(separator + 1),
    url: origin, httpOnly: true, secure: origin.startsWith("https:"), sameSite: "Lax" }]);
}

async function instrument(page: Page) {
  await page.addInitScript(selector => {
    const probe = { skeleton: 0, snapshot: 0, sidebar: 0, article: 0, routeReady: 0, login: 0, longTasks: [] as number[] };
    Object.assign(window, { __READER_PERF__: probe });
    new PerformanceObserver(list => probe.longTasks.push(...list.getEntries().map(entry => entry.duration)))
      .observe({ type: "longtask", buffered: true });
    new MutationObserver(() => {
      if (!probe.skeleton && document.querySelector('[data-test-id="page-loading"], [data-test-id="reader-boot-shell"]')) probe.skeleton = performance.now();
      if (!probe.snapshot && document.documentElement.dataset.wikiFirstFrame) probe.snapshot = performance.now();
      if (!probe.sidebar && document.querySelector('#root [data-test-id="sidebar-tree"] .wiki-shell-tree-root a')) probe.sidebar = performance.now();
      if (!probe.article && document.querySelector('#root [data-test-id="document-article"] .wiki-markdown p')) probe.article = performance.now();
      if (!probe.routeReady && document.querySelector(selector)) probe.routeReady = performance.now();
      if (!probe.login && document.querySelector('[data-test-id="login-page"] input')) probe.login = performance.now();
    }).observe(document, { childList: true, subtree: true });
  }, readySelector);
}

async function capture(page: Page, name: string) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const measurement = await page.evaluate(() => {
    const probe = (window as unknown as { __READER_PERF__: ReaderProbe }).__READER_PERF__;
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    return {
      ...probe,
      fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
      ttfb: navigation.responseStart, domContentLoaded: navigation.domContentLoadedEventEnd,
      blockingMs: probe.longTasks.reduce((sum, duration) => sum + Math.max(0, duration - 50), 0),
      api: resources.filter(resource => new URL(resource.name).pathname.startsWith("/api/wiki/"))
        .map(resource => ({ endpoint: new URL(resource.name).pathname, start: resource.startTime, duration: resource.duration })),
      transferBytes: resources.reduce((sum, resource) => sum + resource.transferSize, 0),
      domNodes: document.querySelectorAll("*").length,
      hiddenTreeNodes: document.querySelectorAll('[data-test-id="bottom-nav-sheet"][inert] .wiki-shell-tree-root *').length,
    };
  });
  await page.screenshot({ path: path.join(output, `${name}.png`) });
  return measurement;
}

async function waitForReader(page: Page) {
  await page.locator(readySelector).first().waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => !document.documentElement.dataset.wikiFirstFrame);
}

async function profile() {
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const [deviceName, viewport] of Object.entries(viewports)) {
      if (device !== "all" && device !== deviceName) continue;
      for (const scope of source === "fixture" ? ["login", "public", "session"] : ["login", "public"]) {
        if (scopeFilter !== "all" && scopeFilter !== scope) continue;
        for (let iteration = 0; iteration < runs; iteration++) {
          const id = `${deviceName}-${scope}-${iteration}`;
          activeCase = `${id}:setup`;
          const context = await browser.newContext({ viewport, extraHTTPHeaders: { "x-wiki-test-run": "1" } });
          let tracing = false;
          try {
            if (scope !== "login") await authenticate(context);
            const page = await context.newPage();
            page.setDefaultTimeout(30_000);
            let errors = 0;
            page.on("pageerror", () => errors++);
            if (source === "fixture") {
              const pages = Object.fromEntries(Array.from({ length: 6000 }, (_, index) => [
                `wiki/performance/group-${Math.floor(index / 500)}/page-${index}`,
                { title: `Performance page ${index}`, content: `# Performance page ${index}\n\nSynthetic performance fixture.`, tags: ["performance"] },
              ]));
              const requests = await installWikiApiMocks(page, {
                sessionAuthenticated: scope === "session", pageOverrides: pages,
                pageDelays: { "wiki/logistics/insurance": 350 },
              });
              requests.setManifestDelay(400);
              await page.route("**/api/wiki/session**", async request => {
                await new Promise(resolve => setTimeout(resolve, 200));
                await request.fallback();
              });
              await page.route("**/api/auth/session", request => request.fulfill({ json: { user: null } }));
            }
            const cdp = await context.newCDPSession(page);
            await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
            await instrument(page);
            await context.tracing.start({ screenshots: true, snapshots: source === "fixture", sources: false });
            tracing = true;
            const destination = scope === "login" ? "/login" : `${route}?scope=${scope}`;
            activeCase = `${id}:cold`;
            await page.goto(origin + destination, { waitUntil: "domcontentloaded" });
            if (scope === "login") await page.locator('[data-test-id="login-page"] input').waitFor();
            else await waitForReader(page);
            await page.screenshot({ path: path.join(output, `${id}-first-body.png`) });
            if (scope !== "login") {
              // Include manifest/first-frame persistence in readiness, not an
              // arbitrary sleep; this makes the following state genuinely warm.
              await page.waitForFunction(() => document.querySelector('#root [data-test-id="sidebar-tree"] .wiki-shell-tree-root a'));
              if (scope === "public" && readySelector === article) await page.waitForFunction(() => Object.keys(localStorage).some(key => key.startsWith("wiki-vite:first-frame:")));
            }
            const cold = await capture(page, `${id}-cold`);
            await page.reload({ waitUntil: "domcontentloaded" });
            activeCase = `${id}:warm`;
            if (scope === "login") await page.locator('[data-test-id="login-page"] input').waitFor();
            else await waitForReader(page);
            const warm = await capture(page, `${id}-warm`);
            const interactions: Record<string, unknown>[] = [];
            if (scope !== "login" && readySelector === article) {
              activeCase = `${id}:uncached-route`;
              await page.goto(`${origin}/about/Index?scope=${scope}`, { waitUntil: "domcontentloaded" });
              await waitForReader(page);
              const uncachedRoute = await capture(page, `${id}-uncached-route`);
              interactions.push({ state: "warm-code-and-manifest-uncached-body", ...uncachedRoute });
              await page.goto(origin + destination, { waitUntil: "domcontentloaded" });
              await waitForReader(page);
              if (source === "fixture") {
                if (deviceName === "mobile") await page.locator('[data-test-id="bottom-nav-trigger"]').click();
                activeCase = `${id}:tree`;
                const navigation = page.locator(deviceName === "mobile" ? '[data-test-id="bottom-nav-page-tree"]' : '#root [data-test-id="sidebar-tree"]');
                await navigation.getByRole("button", { name: "Expand performance", exact: true }).click();
                for (let index = 0; index < 4; index++) {
                  const timing = await navigation.evaluate(async root => {
                    const findButton = () => [...root.querySelectorAll<HTMLButtonElement>("button")].find(button => /^(Expand|Collapse) group 0$/.test(button.getAttribute("aria-label") ?? ""));
                    const button = findButton();
                    if (!button) throw new Error("Synthetic folder missing");
                    const start = performance.now();
                    button.click();
                    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
                    return { elapsed: performance.now() - start, expanded: findButton()?.getAttribute("aria-expanded"), nodes: root.querySelectorAll("*").length };
                  });
                  interactions.push({ state: "toggle-500-rows", ...timing });
                }
                await page.screenshot({ path: path.join(output, `${id}-tree.png`) });
              }
            }
            const result = { device: deviceName, scope, iteration, source, pathname: route, cold, warm, interactions, errors };
            results.push(result);
            await writeFile(path.join(output, "results.json"), JSON.stringify({ phase, origin, cpu, results }, null, 2));
            // No error payloads, headers, cookies, query strings or document text.
            console.log(JSON.stringify({ device: deviceName, scope, iteration, coldFcp: cold.fcp, coldArticle: "article" in cold ? cold.article : null,
              warmFcp: warm.fcp, warmArticle: "article" in warm ? warm.article : null, coldReady: cold.routeReady, warmReady: warm.routeReady, errors }));
          } finally {
            if (tracing) await context.tracing.stop({ path: path.join(output, `${id}.zip`) });
            await context.close();
          }
        }
      }
    }
  } finally { await browser.close(); }
}

try { await profile(); } catch {
  // Playwright errors can embed request headers or page content. Never print
  // the raw exception from an authenticated performance run.
  console.error(`Reader profiling failed at ${activeCase}. Inspect private local artifacts; request details withheld.`);
  process.exitCode = 1;
}
