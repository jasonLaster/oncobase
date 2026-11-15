import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { VIEWPORTS, type Auth, type Surface, type Theme, type ViewportName } from "./surfaces";

export const GATES_DIR = import.meta.dirname;
export const APP_DIR = path.resolve(GATES_DIR, "..");
/** Per-test ratchet fragments written in update mode; merged by ratchet-teardown.ts. */
export const FRAGMENTS_DIR = path.join(APP_DIR, ".playwright/surfaces/ratchet-fragments");

const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])$/;

/**
 * The suite only ever runs against a local stack: its screenshots are uploaded from a public
 * repository's CI, which is safe only because the fixture vault is synthetic.
 */
export function assertLocalBaseURL(raw: string) {
  const url = new URL(raw);
  if (!LOCAL_HOSTS.test(url.hostname)) {
    throw new Error(`Surface gates run only against the local stack; refusing base URL ${raw}`);
  }
  return url;
}

export const surfacesPort = () => process.env.SURFACES_PORT || "63010";
export const baseURL = () => assertLocalBaseURL(`http://127.0.0.1:${surfacesPort()}`).origin;
/** The marketing site answers on oncobase.localhost (browsers resolve *.localhost to loopback). */
export const marketingURL = () => `http://oncobase.localhost:${surfacesPort()}`;

export const UPDATE_RATCHET = process.env.SURFACES_RATCHET === "update";

const CREDENTIALS: Record<"care" | "owner", { email: string; password: string }> = {
  care: { email: "care@local.test", password: "local-care-password" },
  owner: { email: "owner@local.test", password: "local-admin-password" },
};

/**
 * Logs in with fetch, not context.request: Playwright under Bun throws while parsing the
 * server's Set-Cookie headers.
 */
export async function sessionCookies(auth: Auth) {
  if (auth === "public") return [];
  const origin = baseURL();
  const jar: string[] = [];
  const post = async (route: string, body: unknown) => {
    const response = await fetch(origin + route, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(jar.length ? { Cookie: jar.join("; ") } : {}) },
      body: JSON.stringify(body),
      redirect: "manual",
    });
    if (!response.ok) throw new Error(`${route} failed with ${response.status}`);
    for (const cookie of response.headers.getSetCookie()) jar.push(cookie.split(";")[0]!);
    await response.body?.cancel();
  };
  await post("/api/login", { password: "diana" });
  if (auth !== "gate") await post("/api/auth/signin", CREDENTIALS[auth]);
  return jar.map((pair) => {
    const index = pair.indexOf("=");
    return { name: pair.slice(0, index), value: pair.slice(index + 1), url: origin, httpOnly: true, sameSite: "Lax" as const };
  });
}

export async function newSurfaceContext(
  browser: Browser,
  options: { auth: Auth; theme: Theme; viewport: ViewportName },
): Promise<BrowserContext> {
  const mobile = options.viewport === "mobile";
  const [context, cookies] = await Promise.all([browser.newContext({
    viewport: VIEWPORTS[options.viewport],
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
    colorScheme: options.theme,
    reducedMotion: "reduce",
    locale: "en-US",
    timezoneId: "UTC",
    extraHTTPHeaders: { "x-wiki-test-run": "1" },
  }), sessionCookies(options.auth)]);
  if (cookies.length) await context.addCookies(cookies);
  return context;
}

export function surfaceURL(surface: Surface) {
  return (surface.host === "marketing" ? marketingURL() : baseURL()) + surface.path;
}

/** Fonts loaded, images decoded, two frames painted. Never networkidle: the reader polls. */
export async function settle(page: Page, ms = 400) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Lazy images below the fold never load, so wait only for eager or on-screen ones, and not forever.
    const onScreen = (image: HTMLImageElement) => {
      const rect = image.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
    };
    const pending = [...document.images].filter((image) => !image.complete && (image.loading !== "lazy" || onScreen(image))).map(
      (image) => new Promise((resolve) => { image.addEventListener("load", resolve, { once: true }); image.addEventListener("error", resolve, { once: true }); }),
    );
    await Promise.race([Promise.all(pending), new Promise((resolve) => setTimeout(resolve, 5_000))]);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await finishTransitions(page);
  await page.waitForTimeout(ms);
}

/** Waits until running CSS transitions and animations have finished (bounded). */
export async function finishTransitions(page: Page, timeoutMs = 1_000) {
  await page.evaluate(async (timeout) => {
    const running = document.getAnimations()
      .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
      .map((animation) => animation.finished.catch(() => undefined));
    await Promise.race([Promise.all(running), new Promise((resolve) => setTimeout(resolve, timeout))]);
  }, timeoutMs);
}

/**
 * The reader's sidebar tree renders after the article. Tab counts and screenshots depend on it,
 * so wait until its row count is non-zero and unchanged across two readings.
 */
async function waitForSidebarTree(page: Page) {
  // The desktop sidebar or, on mobile, the open navigation sheet's copy of the tree.
  const tree = page.locator('[data-test-id="sidebar-tree"], [data-test-id="bottom-nav-sheet"][role="dialog"]').filter({ visible: true });
  if (!(await tree.count())) return;
  const rows = page.locator("[data-tree-row]").filter({ visible: true });
  let previous = -1;
  for (let attempt = 0; attempt < 40; attempt++) {
    const count = await rows.count();
    if (count > 0 && count === previous) return;
    previous = count;
    await page.waitForTimeout(250);
  }
  throw new Error("The sidebar tree never settled");
}

export async function openSurface(page: Page, surface: Surface, { runBefore = true } = {}) {
  await page.goto(surfaceURL(surface), { waitUntil: "domcontentloaded" });
  await page.locator(surface.ready).filter({ visible: true }).first().waitFor({ timeout: 20_000 });
  await waitForSidebarTree(page);
  await settle(page, 800);
  if (runBefore && surface.before) {
    await surface.before(page);
    await waitForSidebarTree(page);
    await settle(page);
  }
}

// ---------------------------------------------------------------------------
// Ratchet files: checked-in records of today's known failures that may only shrink.

export function readJSON<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** In update mode, record this test's current state; ratchet-teardown.ts merges the fragments. */
export function writeFragment(ratchet: string, key: string, value: unknown) {
  const dir = path.join(FRAGMENTS_DIR, ratchet);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${encodeURIComponent(key)}.json`), JSON.stringify({ key, value }));
}

export const RATCHET_HINT = "Run `bun run surfaces:ratchet` against the local stack and commit the smaller file.";
