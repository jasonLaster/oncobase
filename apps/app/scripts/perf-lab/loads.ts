// Page-load scenarios: cold and warm, signed-in article and signed-out landing.
import { ARTICLE, bytesBy, instrument, newContext, observations, settle, type Browser, type BrowserContext, type ProfileName, type Request } from "./browser";
import { PAGES } from "./vault";

export const LOAD_SCENARIOS = ["signed-in-cold", "signed-in-warm", "landing-cold", "landing-warm"] as const;
export type LoadScenario = (typeof LOAD_SCENARIOS)[number];

/** One load. Times are ms from navigation start; bytes are on-the-wire (gzip via the proxy, plus headers). */
export type LoadSample = {
  ok: boolean;
  articleMs: number;
  treeMs: number;
  lcpMs: number;
  fcpMs: number;
  longestTaskMs: number;
  requests: number;
  cachedRequests: number;
  bytes: number;
  jsBytes: number;
  jsFiles: number;
  cssBytes: number;
  wasmBytes: number;
  apiBytes: number;
  /** When the full manifest finished arriving (signed-in only; the largest `/api/wiki/manifest` response). */
  manifestMs: number;
  manifestBytes: number;
  /** Total blocking time (sum of long-task time over 50 ms) from navigation to the end of the settle window. */
  blockingMs: number;
  /** Bytes received before the article first appeared (signed-in) or before LCP (landing), including partial bodies. */
  bytesBeforeArticle: number;
  jsBytesBeforeArticle: number;
  jsFilesBeforeArticle: number;
  wasmBytesBeforeArticle: number;
  apiBytesBeforeArticle: number;
};

// Fixed settle after the ready signal; never networkidle (polling, telemetry
// and prefetch keep the network busy). Long enough for LCP and the tree.
const SETTLE_MS: Record<ProfileName, number> = { desktop: 4000, mobile: 8000 };
const TIMEOUT_MS = 90_000;
// A production-scale manifest is about 1 MB: minutes on the mobile link at worst.
const MANIFEST_WAIT_MS = 180_000;

const isJs = (r: Request) => r.type === "Script" || /\.m?js(\?|$)/.test(r.path);
const isWasm = (r: Request) => /\.wasm(\?|$)/.test(r.path);
const isCss = (r: Request) => r.type === "Stylesheet" || /\.css(\?|$)/.test(r.path);
const isApi = (r: Request) => r.path.startsWith("/api/");

async function load(context: BrowserContext, base: string, profile: ProfileName, path: string, signedIn: boolean, cold: boolean): Promise<LoadSample> {
  const page = await context.newPage();
  try {
    const tools = await instrument(page, profile, base);
    await page.goto(base + path, { waitUntil: "commit", timeout: TIMEOUT_MS });
    const ready = signedIn ? ARTICLE : "h1";
    const ok = await page.waitForSelector(ready, { timeout: TIMEOUT_MS }).then(() => true, () => false);
    // "Tree" is first presence in the DOM: on mobile the sidebar is a closed drawer, never visible.
    if (ok && signedIn) await page.waitForSelector("[data-tree-row]", { state: "attached", timeout: 30_000 }).catch(() => undefined);
    // Cold signed-in loads also wait for the full manifest, which arrives after
    // the first paint, so its cost (and the work after it) falls inside the
    // window. A warm load only revalidates it (a small `?known=` answer).
    const fullManifest = async () => (await tools.requests())
      .filter((r) => r.path.startsWith("/api/wiki/manifest") && Number.isFinite(r.end) && r.bytes > 2048)
      .sort((a, b) => b.bytes - a.bytes)[0];
    if (ok && signedIn && cold) {
      const deadline = Date.now() + MANIFEST_WAIT_MS;
      while (!(await fullManifest()) && Date.now() < deadline) await page.waitForTimeout(250);
    }
    await settle(page, SETTLE_MS[profile]);
    const obs = await observations(page);
    const requests = (await tools.requests()).filter((r) => !r.path.startsWith("data:"));
    const articleMs = signedIn ? (obs.first.article ?? Number.NaN) : Number.NaN;
    const manifest = signedIn ? await fullManifest() : undefined;
    const cutoff = signedIn ? articleMs : obs.lcp || Number.NaN;
    const sum = (rs: Request[], f: (r: Request) => boolean = () => true) => rs.filter(f).reduce((a, r) => a + r.bytes, 0);
    // Bytes received by the cutoff, counting partial bodies of requests still in flight.
    const sumBefore = (f: (r: Request) => boolean = () => true) => requests.filter(f).reduce((a, r) => a + bytesBy(r, cutoff), 0);
    const finishedBefore = requests.filter((r) => Number.isFinite(r.end) && r.end <= cutoff);
    return {
      ok,
      articleMs: Math.round(articleMs),
      treeMs: signedIn ? Math.round(obs.first.tree ?? Number.NaN) : Number.NaN,
      lcpMs: Math.round(obs.lcp),
      fcpMs: Math.round(obs.fcp),
      longestTaskMs: Math.max(0, ...obs.longTasks.map((t) => t[1])),
      manifestMs: manifest ? Math.round(manifest.end) : Number.NaN,
      manifestBytes: manifest ? manifest.bytes : Number.NaN,
      blockingMs: obs.longTasks.reduce((sum, t) => sum + Math.max(0, t[1] - 50), 0),
      requests: requests.length,
      cachedRequests: requests.filter((r) => r.cached).length,
      bytes: sum(requests),
      jsBytes: sum(requests, isJs),
      jsFiles: requests.filter(isJs).length,
      cssBytes: sum(requests, isCss),
      wasmBytes: sum(requests, isWasm),
      apiBytes: sum(requests, isApi),
      bytesBeforeArticle: Number.isFinite(cutoff) ? sumBefore() : Number.NaN,
      jsBytesBeforeArticle: Number.isFinite(cutoff) ? sumBefore(isJs) : Number.NaN,
      jsFilesBeforeArticle: Number.isFinite(cutoff) ? finishedBefore.filter(isJs).length : Number.NaN,
      wasmBytesBeforeArticle: Number.isFinite(cutoff) ? sumBefore(isWasm) : Number.NaN,
      apiBytesBeforeArticle: Number.isFinite(cutoff) ? sumBefore(isApi) : Number.NaN,
    };
  } finally {
    await page.close();
  }
}

/**
 * One iteration of every load scenario on one profile. Each cold load gets a
 * fresh context (empty cache and storage); the warm load is a second page in
 * the same context after the first has closed.
 */
export async function runLoadIteration(browser: Browser, base: string, profile: ProfileName): Promise<Record<LoadScenario, LoadSample>> {
  const pair = async (signedIn: boolean) => {
    const context = await newContext(browser, base, profile, { signedIn });
    try {
      const path = signedIn ? `/${PAGES.article}` : "/";
      const cold = await load(context, base, profile, path, signedIn, true);
      await new Promise((resolve) => setTimeout(resolve, 600));
      const warm = await load(context, base, profile, path, signedIn, false);
      return [cold, warm] as const;
    } finally {
      await context.close();
    }
  };
  const [signedInCold, signedInWarm] = await pair(true);
  const [landingCold, landingWarm] = await pair(false);
  return { "signed-in-cold": signedInCold, "signed-in-warm": signedInWarm, "landing-cold": landingCold, "landing-warm": landingWarm };
}
