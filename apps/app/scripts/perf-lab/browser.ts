// Browser side of the perf lab: device profiles, sign-in, CDP instrumentation
// and the in-page observers every scenario reads.
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "@playwright/test";
import { LOCAL_CARE_USER, LOCAL_GATE_PASSWORD } from "../local-stack-env";

export { chromium };
export type { Browser, BrowserContext, Page };

/** First paragraph of the rendered article: "the article is visible". */
export const ARTICLE = '[data-test-id="document-article"] .wiki-markdown p';
export const TREE_ROW = "[data-tree-row]";
export const TREE_ROOT = ".wiki-shell-tree-root";
export const PALETTE_INPUT = '[data-test-id="command-palette-input"]';

type Network = { latency: number; down: number; up: number };
export type Profile = {
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  cpu: number;
  network: Network | null;
};

export const PROFILES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false, cpu: 1, network: null },
  // Lighthouse-style mid-tier phone on slow 4G: 4x CPU slowdown, 1.6 Mbps down,
  // 750 Kbps up, 150 ms RTT (CDP throughput is bytes per second).
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, cpu: 4, network: { latency: 150, down: (1.6 * 1024 * 1024) / 8, up: (750 * 1024) / 8 } },
} satisfies Record<string, Profile>;
export type ProfileName = keyof typeof PROFILES;

export function launchBrowser() {
  return chromium.launch({ headless: true });
}

/**
 * A fresh, isolated browser context (empty HTTP cache and storage).
 * `signedIn` passes the site gate and signs in as the local care-team user.
 * Sign-in uses fetch + addCookies: Playwright's request API throws on the
 * server's Set-Cookie headers under Bun.
 */
export async function newContext(browser: Browser, base: string, profile: ProfileName, { signedIn }: { signedIn: boolean }) {
  const p = PROFILES[profile];
  const context = await browser.newContext({ viewport: p.viewport, deviceScaleFactor: p.deviceScaleFactor, isMobile: p.isMobile, hasTouch: p.hasTouch, colorScheme: "light" });
  if (signedIn) await context.addCookies((await signInCookies(base)).map((c) => ({ ...c, url: base, httpOnly: true, sameSite: "Lax" as const })));
  return context;
}

export async function signInCookies(base: string) {
  const jar = new Map<string, string>();
  const post = async (path: string, data: unknown) => {
    const response = await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}) },
      body: JSON.stringify(data),
      redirect: "manual",
    });
    if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0]!;
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    await response.body?.cancel();
  };
  await post("/api/login", { password: LOCAL_GATE_PASSWORD });
  await post("/api/auth/signin", { email: LOCAL_CARE_USER.email, password: LOCAL_CARE_USER.password });
  return [...jar].map(([name, value]) => ({ name, value }));
}

export type Request = {
  path: string;
  type: string;
  status: number;
  /** Encoded bytes on the wire: loadingFinished's total (headers + body), else the body chunks received so far. */
  bytes: number;
  cached: boolean;
  /** The request ended in loadingFailed (the app often aborts a fetch after reading its body). */
  aborted: boolean;
  /** Milliseconds relative to the page's performance.timeOrigin (same clock as performance.now()); end is NaN while in flight. */
  start: number;
  end: number;
  /** [time, encoded bytes] per received body chunk, on the page clock. */
  chunks: Array<[number, number]>;
};

type RawRequest = { url: string; type: string; status: number; bytes: number; cached: boolean; aborted: boolean; start: number; end: number; chunks: Array<[number, number]> };

/** Bytes this request had transferred by page time `t`. */
export function bytesBy(r: Request, t: number) {
  if (Number.isFinite(r.end) && r.end <= t) return r.bytes;
  return r.chunks.reduce((sum, [at, bytes]) => (at <= t ? sum + bytes : sum), 0);
}

export type Instrumented = {
  cdp: CDPSession;
  setCpu(rate: number): Promise<void>;
  /** Requests so far, on the page clock. Call after the page has committed. */
  requests(): Promise<Request[]>;
};

/**
 * Attach CDP network tracking and throttling to `page`, and install the
 * in-page observers (LCP, long tasks, event timing, first-seen probes) before
 * any script runs. CDP timestamps are monotonic seconds; they are mapped onto
 * the page clock through the document request's wall time, so request end
 * times compare directly with in-page marks such as "article visible".
 */
export async function instrument(page: Page, profile: ProfileName, base: string): Promise<Instrumented> {
  const p: Profile = PROFILES[profile];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  const setCpu = (rate: number) => cdp.send("Emulation.setCPUThrottlingRate", { rate }).then(() => undefined);
  if (p.cpu > 1) await setCpu(p.cpu);
  if (p.network) await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: p.network.latency, downloadThroughput: p.network.down, uploadThroughput: p.network.up });
  const raw = new Map<string, RawRequest>();
  let wallOffset: number | undefined;
  cdp.on("Network.requestWillBeSent", (e) => {
    if (e.type === "Document" && wallOffset === undefined && e.wallTime) wallOffset = e.wallTime - e.timestamp;
    raw.set(e.requestId, { url: e.request.url, type: e.type ?? "Other", status: 0, bytes: 0, cached: false, aborted: false, start: e.timestamp, end: 0, chunks: [] });
  });
  cdp.on("Network.dataReceived", (e) => {
    const r = raw.get(e.requestId);
    if (r && e.encodedDataLength) { r.chunks.push([e.timestamp, e.encodedDataLength]); if (!r.end) r.bytes += e.encodedDataLength; }
  });
  cdp.on("Network.loadingFailed", (e) => { const r = raw.get(e.requestId); if (r && !r.end) { r.aborted = true; r.end = e.timestamp; } });
  cdp.on("Network.responseReceived", (e) => {
    const r = raw.get(e.requestId);
    if (r) { r.status = e.response.status; r.cached = r.cached || !!e.response.fromDiskCache || !!e.response.fromPrefetchCache; }
  });
  cdp.on("Network.requestServedFromCache", (e) => { const r = raw.get(e.requestId); if (r) r.cached = true; });
  cdp.on("Network.loadingFinished", (e) => { const r = raw.get(e.requestId); if (r) { r.bytes = Math.max(e.encodedDataLength, r.bytes); r.end = e.timestamp; } });
  await page.addInitScript(installObservers, { article: ARTICLE, tree: TREE_ROW });
  return {
    cdp,
    setCpu,
    async requests() {
      const origin = await page.evaluate(() => performance.timeOrigin);
      const offset = wallOffset ?? 0;
      const toPage = (t: number) => Math.round((t + offset) * 1000 - origin);
      return [...raw.values()].map((r) => ({
        path: r.url.startsWith(base) ? r.url.slice(base.length) : r.url,
        type: r.type,
        status: r.status,
        bytes: r.bytes,
        cached: r.cached,
        aborted: r.aborted,
        start: toPage(r.start),
        end: r.end ? toPage(r.end) : Number.NaN,
        chunks: r.chunks.map(([t, bytes]): [number, number] => [toPage(t), bytes]),
      }));
    },
  };
}

export type PageObservations = {
  lcp: number;
  fcp: number;
  first: Record<string, number>;
  longTasks: Array<[number, number]>;
  events: Array<{ name: string; start: number; duration: number; interactionId: number }>;
};

/** Runs in the page before any app script (serialized by addInitScript). */
function installObservers(probes: { article: string; tree: string }) {
  const lab: PageObservations = { lcp: 0, fcp: 0, first: {}, longTasks: [], events: [] };
  (window as unknown as { __perfLab: PageObservations }).__perfLab = lab;
  type Entry = PerformanceEntry & { interactionId?: number };
  const observe = (type: string, onEntry: (e: Entry) => void, extra: Record<string, unknown> = {}) => {
    try {
      new PerformanceObserver((list) => { for (const e of list.getEntries()) onEntry(e as Entry); }).observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
    } catch { /* unsupported entry type */ }
  };
  observe("largest-contentful-paint", (e) => { lab.lcp = e.startTime; });
  observe("paint", (e) => { if (e.name === "first-contentful-paint") lab.fcp = e.startTime; });
  observe("longtask", (e) => { lab.longTasks.push([Math.round(e.startTime), Math.round(e.duration)]); });
  observe("event", (e) => { lab.events.push({ name: e.name, start: Math.round(e.startTime), duration: Math.round(e.duration), interactionId: e.interactionId ?? 0 }); }, { durationThreshold: 16 });
  const check = () => {
    for (const [key, selector] of Object.entries(probes)) if (!(key in lab.first) && document.querySelector(selector)) lab.first[key] = performance.now();
  };
  new MutationObserver(check).observe(document, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", check);
}

export function observations(page: Page): Promise<PageObservations> {
  return page.evaluate(() => (window as unknown as { __perfLab: PageObservations }).__perfLab);
}

/** Never wait for networkidle: polling, telemetry and prefetch keep the network busy. */
export const settle = (page: Page, ms: number) => page.waitForTimeout(ms);
