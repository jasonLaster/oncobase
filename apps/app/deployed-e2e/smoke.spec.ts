import { expect, request as playwrightRequest, test } from "@playwright/test";
import {
  article,
  gateCookieHeader,
  holdScripts,
  isPhone,
  paletteInput,
  passGate,
  ready,
  skipWithoutGate,
  SMOKE_PATH,
  SMOKE_SLUG,
  START_PATH,
  watchForFailures,
} from "./support";

// Run after a deploy: `bun run test:e2e:preview` (one browser, a preview or the
// standalone server) or `playwright test --config playwright.production.config.ts`
// (local only; the live site across browsers and phone widths). See support.ts
// for the environment each test needs; tests that need a credential skip without it.

let assertNoFailures: (() => void) | undefined;
test.beforeEach(async ({ page, baseURL }) => {
  assertNoFailures = watchForFailures(page, new URL(baseURL!).origin);
});
test.afterEach(() => assertNoFailures?.());

test("anonymous root and deep link use the same uncached gate; content APIs refuse without it", async ({ baseURL }) => {
  const anonymous = await playwrightRequest.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    // The bare domain is the landing page; a private link goes to sign-in with its destination.
    const root = await anonymous.get("/", { maxRedirects: 0 });
    expect(root.status()).toBe(200);
    expect(await root.text()).toContain('name="wiki-reader-access" content="landing"');
    const deep = await anonymous.get(SMOKE_PATH, { maxRedirects: 0 });
    expect(deep.status()).toBe(302);
    expect(new URL(deep.headers().location, baseURL).pathname).toBe("/sign-in");
    expect(deep.headers().location).toContain(`redirect=${encodeURIComponent(SMOKE_PATH)}`);
    for (const response of [root, deep]) {
      expect(response.headers()["cache-control"]).toBe("private, no-store");
      expect(response.headers().vary).toContain("Cookie");
      expect(response.headers().vary).toContain("Host");
    }

    // Content APIs say so with the same private headers.
    for (const path of [`/api/wiki/pages?slugs=${SMOKE_SLUG}`, "/api/download?type=markdown", "/api/file?path=sources/example.pdf"]) {
      const response = await anonymous.get(path);
      expect(response.status(), path).toBe(401);
      expect(response.headers()["cache-control"], path).toBe("private, no-store");
      expect(await response.json(), path).toEqual({ error: "Password gate authentication required" });
    }
    // The public surface stays reachable without it.
    expect((await anonymous.get("/api/wiki/session")).status()).toBe(200);
    expect((await anonymous.get("/api/auth/session")).status()).toBe(200);
  } finally {
    await anonymous.dispose();
  }
});

test("a gate cookie renders a wiki page from the configured backend", async ({ page, baseURL }) => {
  skipWithoutGate();
  await passGate(page, baseURL!);
  await page.goto(SMOKE_PATH, { waitUntil: "domcontentloaded" });

  await expect(page).toHaveTitle(/Insurance|Wiki/i);
  await expect(page.getByTestId("wiki-sidebar")).toBeVisible();
  await expect(page.getByTestId("sidebar-workspace-trigger")).toBeVisible();
  await expect(article(page)).toBeVisible();
  await expect(article(page).locator("h1")).toBeVisible();
  await expect(page.getByTestId("page-loading")).toHaveCount(0);
  // Developer chrome never ships.
  await expect(page.getByTestId("app-header")).toHaveCount(0);
  await expect(page.getByTestId("metrics-panel")).toHaveCount(0);
  await expect(page.getByTestId("livestore-devtools-footer")).toHaveCount(0);
  await expect(page.locator(".vite-error-overlay")).toHaveCount(0);
});

test("a client-rendered document keeps the gate and rejects retired cache URLs", async ({ browser, baseURL }) => {
  const anonymous = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    const page = await anonymous.newPage();
    await page.goto(START_PATH, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL((url) => url.pathname === "/sign-in" && url.searchParams.get("redirect") === START_PATH);
    await expect(page.getByTestId("sign-in-page")).toBeVisible();
    // The sign-in page must not have rendered any of the document.
    await expect(article(page)).toHaveCount(0);

    // The retired server-rendered cache namespace answers 404 at the edge and the function.
    const retired = await anonymous.request.get("/__reader/html/retired", { maxRedirects: 0 });
    expect(retired.status()).toBe(404);
  } finally {
    await anonymous.close();
  }
});

test("cold start: Search, Ask wiki and Sign in open in place on a client-rendered page", async ({ page, baseURL }) => {
  skipWithoutGate();
  await passGate(page, baseURL!);
  const gate = await holdScripts(page);
  await page.goto(START_PATH, { waitUntil: "commit" });
  // With scripts held, the parsed document has no document content: nothing is server-rendered to hydrate.
  await expect(page.locator("#root")).toHaveCount(1);
  await expect(page.locator("#root article, #root .wiki-markdown")).toHaveCount(0);
  await expect(page.locator("#wiki-html-first, #wiki-first-frame-snapshot")).toHaveCount(0);
  gate.release();
  await ready(page);
  const startPathname = new URL(page.url()).pathname;

  await page.getByTestId(isPhone(page) ? "mobile-header-search" : "sidebar-search").click();
  await expect(paletteInput(page)).toBeFocused();
  expect(new URL(page.url()).pathname).toBe(startPathname);
  await paletteInput(page).fill("insurance");
  await page.locator(`[role="option"][data-value="${SMOKE_SLUG}"]`).click();
  await expect(page).toHaveURL(new RegExp(`${SMOKE_PATH}$`));
  await expect(article(page).locator("h1").first()).toContainText(/insurance/i);
  await expect(paletteInput(page)).toHaveCount(0);

  await page.goBack();
  await ready(page);
  // The local stack has no chat identity provider, so the standalone self-check opts out of this step.
  if (!process.env.WIKI_VITE_SMOKE_SKIP_CHAT) {
    await page.getByTestId(isPhone(page) ? "mobile-ask-wiki" : "sidebar-ask-wiki").click();
    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.getByTestId("chat-composer-textarea")).toBeVisible();
    // Typed, never sent: the smoke test does not submit chats.
    await page.getByTestId("chat-composer-textarea").fill("Deploy smoke check, unsent");
    await expect(page.getByTestId("chat-submit-button")).toBeEnabled();
    await page.getByTestId("chat-composer-textarea").clear();
    await page.goBack();
    await ready(page);
  }

  if (isPhone(page)) await page.getByRole("button", { name: "Open page navigation", exact: true }).click();
  await page.getByTestId("sidebar-sign-in").filter({ visible: true }).click();
  const dialog = page.getByRole("dialog", { name: "Sign in", exact: true });
  await expect(dialog.getByLabel("Email", { exact: true })).toBeFocused();
  expect(new URL(page.url()).pathname).toBe(startPathname);
  expect(new URL(page.url()).search).toBe("");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("wiki-auth-dialog")).toHaveCount(0);
});

test("the theme persists across reload", async ({ page, baseURL }) => {
  skipWithoutGate();
  await passGate(page, baseURL!);
  await page.goto(SMOKE_PATH, { waitUntil: "domcontentloaded" });
  await ready(page);
  await page.keyboard.press("ControlOrMeta+Shift+K");
  await paletteInput(page).fill("Switch to Dark theme");
  await page.getByRole("button", { name: /Switch to Dark theme/ }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.reload({ waitUntil: "domcontentloaded" });
  await ready(page);
  await expect(page.locator("html")).toHaveClass(/dark/);

  // Leave the browser profile as found.
  await page.keyboard.press("ControlOrMeta+Shift+K");
  await paletteInput(page).fill("Switch to Light theme");
  await page.getByRole("button", { name: /Switch to Light theme/ }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("a shortcut pressed right after a refresh is queued and honoured", async ({ page, baseURL }) => {
  skipWithoutGate();
  await passGate(page, baseURL!);
  const scripts = await holdScripts(page);
  scripts.release();
  await page.goto(START_PATH, { waitUntil: "domcontentloaded" });
  await ready(page);

  scripts.hold();
  try {
    await page.reload({ waitUntil: "commit" });
    await expect(page.locator("#wiki-reader-shortcuts")).toHaveCount(1);
    await page.keyboard.press("ControlOrMeta+K");
    scripts.release();
    await expect(paletteInput(page)).toBeFocused();
    await paletteInput(page).fill("insurance");
    await page.locator(`[role="option"][data-value="${SMOKE_SLUG}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${SMOKE_PATH}$`));
    await expect(article(page).locator("h1").first()).toContainText(/insurance/i);
    // Once warm, the shortcut is immediate.
    await page.keyboard.press("ControlOrMeta+K");
    await expect(paletteInput(page)).toBeFocused({ timeout: 1_000 });
    await page.keyboard.press("Escape");
    await expect(paletteInput(page)).toHaveCount(0);
  } finally {
    scripts.release();
  }
});

test("PDFs stream with byte-range support", async ({ baseURL }) => {
  skipWithoutGate();
  const cookie = await gateCookieHeader(baseURL!);
  const api = await playwrightRequest.newContext({ baseURL, extraHTTPHeaders: { Cookie: cookie } });
  try {
    const manifestResponse = await api.get("/api/wiki/manifest", { timeout: 60_000 });
    expect(manifestResponse.ok(), await manifestResponse.text()).toBeTruthy();
    const { assets } = (await manifestResponse.json()) as { assets?: Array<{ kind: string; path: string }> };
    const pdf = assets?.find((asset) => asset.kind === "pdf" && asset.path.endsWith(".pdf"));
    test.skip(!pdf, "The deployment's manifest lists no PDF to range-read.");
    const url = `/api/file?path=${encodeURIComponent(pdf!.path)}`;

    const head = await api.get(url, { headers: { Range: "bytes=0-4" } });
    expect(head.status()).toBe(206);
    expect(head.headers()["accept-ranges"]).toBe("bytes");
    expect(head.headers()["content-type"]).toBe("application/pdf");
    expect(head.headers()["content-range"]).toMatch(/^bytes 0-4\/\d+$/);
    expect(head.headers()["cache-control"]).toBe("private, no-store");
    expect((await head.body()).toString()).toBe("%PDF-");
  } finally {
    await api.dispose();
  }
});

test("a session minted before this deploy still signs in after it", async ({ baseURL }) => {
  const cookie = process.env.WIKI_VITE_SMOKE_SESSION_COOKIE;
  test.skip(!cookie, "Needs WIKI_VITE_SMOKE_SESSION_COOKIE: the full Cookie header of a session signed in before the deploy.");
  const api = await playwrightRequest.newContext({ baseURL, extraHTTPHeaders: { Cookie: cookie! } });
  try {
    const account = await api.get("/api/auth/session");
    expect(account.ok()).toBeTruthy();
    expect((await account.json()).user, "the old session must still resolve to its account").toBeTruthy();
    const identity = await api.get("/api/wiki/session?scope=session");
    expect(identity.ok()).toBeTruthy();
    expect(await identity.json()).toMatchObject({ scope: "session", authenticated: true });
    expect(identity.headers()["cache-control"]).toBe("private, no-store");
  } finally {
    await api.dispose();
  }
});
