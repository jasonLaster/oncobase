import { expect } from "@playwright/test";
import { createServer } from "node:http";
import { test } from "./persistent-reader-fixture";
import { documentArticle, installWikiApiMocks, readerShellHtml, waitForPageTitle } from "./fixtures";

const slug = "wiki/logistics/insurance";

// A cold CSR document without a seeded article or navigation: exercise the
// failure path reported on a phone, independently of any production account.
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const html = await readerShellHtml(page);
  await page.route("**/*", route => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html", body: html }) : route.fallback());
});

test("cold article stays readable while the page list stalls, then navigation recovers automatically", async ({ page }) => {
  const requests = await installWikiApiMocks(page);
  requests.setManifestFailure(true);
  await page.goto(`/${slug}?devtools=1`);
  await waitForPageTitle(page, "Insurance");
  await expect(documentArticle(page)).toContainText("Claims follow-up");
  expect(requests.manifest).toHaveLength(1);
  requests.setManifestFailure(false);
  await expect.poll(() => requests.manifest.length, { timeout: 10_000 }).toBeGreaterThan(1);
  await expect(page.locator('[data-test-id="navigation-status"]').first()).toHaveAttribute("data-freshness", "current");
  await expect(documentArticle(page)).toContainText("Claims follow-up");
});

test("Retry fetches the article even when the empty page list keeps failing", async ({ page }) => {
  const requests = await installWikiApiMocks(page);
  requests.setManifestFailure(true);
  requests.setPageFailure(slug, 1);
  await page.goto(`/${slug}`);
  await expect(page.getByTestId("retry-page-fetch")).toBeVisible();
  await page.getByTestId("retry-page-fetch").click();
  await waitForPageTitle(page, "Insurance");
  await expect(documentArticle(page)).toContainText("Claims follow-up");
});

test("slow mobile article offers a retry that cancels the first request", async ({ page }) => {
  await installWikiApiMocks(page);
  let attempts = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/wiki/pages**", async route => {
    if (new URL(route.request().url()).searchParams.get("slugs") !== slug) return route.fallback();
    attempts++;
    if (attempts === 1) await held;
    return route.fallback();
  });
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    const state = { aborted: 0 };
    Object.assign(window, { readerPageRequests: state });
    window.fetch = (input, init) => {
      // Tracing wraps fetch arguments in a Request, preserving its signal.
      const url = input instanceof Request ? input.url : String(input);
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      if (url.includes("/api/wiki/pages")) signal?.addEventListener("abort", () => state.aborted++, { once: true });
      return original(input, init);
    };
  });
  try {
    await page.goto(`/${slug}`);
    await expect(page.getByTestId("page-activity")).toContainText("Taking longer than usual", { timeout: 15_000 });
    const retry = page.getByTestId("page-activity").getByRole("button", { name: "Try again" });
    await expect(retry).toBeInViewport();
    await page.screenshot({ path: "test-results/slow-network-mobile.png" });
    await retry.click();
    await waitForPageTitle(page, "Insurance");
    await expect.poll(() => page.evaluate(() => (window as unknown as { readerPageRequests: { aborted: number } }).readerPageRequests.aborted)).toBeGreaterThan(0);
    expect(attempts).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { release(); }
});

test("reconnecting retries an uncached article without reloading", async ({ page, context }) => {
  const requests = await installWikiApiMocks(page);
  requests.setPageFailure(slug, true);
  await page.goto(`/${slug}`);
  await expect(page.getByTestId("retry-page-fetch")).toBeVisible();
  await context.setOffline(true);
  requests.setPageFailure(slug, 0);
  await context.setOffline(false);
  await waitForPageTitle(page, "Insurance");
});

test("mobile reader shows received bytes while an HTTP body is still arriving", async ({ page, baseURL }) => {
  await installWikiApiMocks(page);
  const content = "# Streamed page\n\n" + "Synthetic text received over a slow connection. ".repeat(1500);
  const body = JSON.stringify({ siteSlug: "diana", scope: "public", generatedAt: "2026-09-15T00:00:00Z", isDone: true, continueCursor: null,
    pages: [{ slug, title: "Streamed page", content, contentHash: "stream-fixture", sensitive: false, tags: [], size: content.length }] });
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  // route.fulfill buffers the complete body. Use a real HTTP connection to
  // prove that progress appears before JSON can be parsed or committed.
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://fixture.invalid").pathname;
    if (pathname !== "/api/wiki/pages") {
      // Scripts and styles come from the server under test.
      try {
        const upstream = await page.request.get(new URL(request.url ?? "/", baseURL).toString());
        response.writeHead(upstream.status(), { "Content-Type": upstream.headers()["content-type"] ?? "application/octet-stream" });
        response.end(await upstream.body());
      } catch {
        // The page can still be loading assets when the test ends.
        if (!response.headersSent) response.writeHead(502);
        response.end();
      }
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.write(body.slice(0, -2));
    await pending;
    response.end(body.slice(-2));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  await page.route("**/api/wiki/pages**", route => route.continue());
  try {
    await page.goto(`http://127.0.0.1:${address.port}/${slug}`);
    await expect(page.getByTestId("page-activity")).toContainText(/KB received/, { timeout: 15_000 });
    await expect(documentArticle(page).locator(".wiki-markdown")).toHaveCount(0);
    await page.screenshot({ path: "test-results/slow-network-progress-mobile.png" });
    finish();
    await waitForPageTitle(page, "Streamed page");
  } finally {
    finish();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
