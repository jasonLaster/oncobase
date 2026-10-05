import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";

// Tier E: post-deploy smoke against a real deployment (a Vercel preview,
// production, or the standalone server). Real responses only: no mocks, no
// chat or comment submissions, no account creation. Delay gates hold real
// scripts to exercise startup races; they never replace API data.
//
//   PLAYWRIGHT_BASE_URL                  origin under test (production config defaults to the live site)
//   WIKI_VITE_SMOKE_COOKIE               a signed gate cookie ("authed=v2...") for the deployment, or
//   WIKI_VITE_PREVIEW_LOGIN_PASSWORD     the site password, to mint one
//   WIKI_VITE_SMOKE_PATH                 a readable page (default: /wiki/logistics/insurance)
//   WIKI_VITE_SMOKE_START_PATH           the page cold-start flows open (default: a long review article)
//   WIKI_VITE_SMOKE_SKIP_CHAT            set to skip the Ask wiki step (the local stack has no chat identity)
//   WIKI_VITE_SMOKE_SESSION_COOKIE       full Cookie header of a signed-in session minted before this deploy

export const SMOKE_PATH = process.env.WIKI_VITE_SMOKE_PATH ?? "/wiki/logistics/insurance";
export const START_PATH = process.env.WIKI_VITE_SMOKE_START_PATH ?? "/wiki/research/reviews/breast-conservation-survival";
/** The slug the palette must find; derived from the smoke page. */
export const SMOKE_SLUG = SMOKE_PATH.replace(/^\//, "");

export const article = (page: Page) => page.locator('#root [data-test-id="document-article"]');
export const paletteInput = (page: Page) => page.getByTestId("command-palette-input");
export const isPhone = (page: Page) => page.viewportSize()!.width < 768;

const needsGate = () => !process.env.WIKI_VITE_SMOKE_COOKIE && !process.env.WIKI_VITE_PREVIEW_LOGIN_PASSWORD;
export const skipWithoutGate = () => test.skip(needsGate(), "Needs WIKI_VITE_SMOKE_COOKIE or WIKI_VITE_PREVIEW_LOGIN_PASSWORD.");

/** A Cookie header that passes the site password gate. */
export async function gateCookieHeader(baseURL: string) {
  const supplied = process.env.WIKI_VITE_SMOKE_COOKIE;
  if (supplied) return supplied;
  const context = await playwrightRequest.newContext({ baseURL });
  try {
    const login = await context.post("/api/login", { data: { password: process.env.WIKI_VITE_PREVIEW_LOGIN_PASSWORD } });
    expect(login.ok(), "site password login").toBeTruthy();
    const cookie = login.headers()["set-cookie"]?.split(";")[0];
    expect(cookie, "signed gate cookie").toMatch(/^authed=.+/);
    return cookie!;
  } finally {
    await context.dispose();
  }
}

/** Passes the gate in the page's browser context. */
export async function passGate(page: Page, baseURL: string) {
  await page.context().setExtraHTTPHeaders({ Cookie: await gateCookieHeader(baseURL) });
}

/** Opens the page and waits until the client-rendered reader shows its document. */
export async function ready(page: Page) {
  await expect(article(page).locator(".wiki-markdown")).toBeVisible();
  await expect(page.locator("#wiki-html-first")).toHaveCount(0);
  await expect(page.getByTestId("store-startup-recovery")).toHaveCount(0);
}

/** Holds every script request until `release()` (and again after `hold()`), so startup races are deterministic. */
export async function holdScripts(page: Page) {
  let gate: Promise<void> | null = null;
  let open: () => void = () => {};
  const hold = () => { gate = new Promise<void>((resolve) => { open = resolve; }); };
  hold();
  await page.route("**/*", async (route) => {
    if (gate && route.request().resourceType() === "script") await gate;
    await route.fallback();
  });
  return { hold, release: () => open() };
}

/** Browser errors and same-origin 5xx responses fail the test they happen in. */
export function watchForFailures(page: Page, origin: string) {
  const errors: string[] = [];
  const failed: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === origin && response.status() >= 500) failed.push(`${response.status()} ${url.pathname}`);
  });
  return () => {
    expect(errors, "Unhandled browser exceptions").toEqual([]);
    expect(failed, "Same-origin 5xx responses").toEqual([]);
  };
}
