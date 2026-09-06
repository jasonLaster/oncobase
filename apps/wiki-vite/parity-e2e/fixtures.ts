import { expect, test as base, type Page, type TestInfo } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

export { expect };
export const readerPath = "/wiki/logistics/insurance";
export const article = (page: Page) => page.locator("article").filter({ visible: true }).first();
export const modifier = process.platform === "darwin" ? "Meta" : "Control";

// Both projects use this exact fixture. No host sniffing, cache injection,
// or framework-specific assertions belong in this suite.
export const test = base.extend<{ evidence: void }>({
  evidence: [async ({ page, context }, use, info) => {
    // This fixture is also imported by the legacy comments suite. Its safety
    // and private-artifact requirements must not depend on which config ran it.
    if (process.env.CI || process.env.PARITY_REAL_BACKENDS !== "1" || !process.env.PARITY_CONVEX_URL) {
      throw new Error("Real parity tests are local-only and require PARITY_REAL_BACKENDS=1 and PARITY_CONVEX_URL.");
    }
    const errors: Array<{ message: string; stack?: string; path: string }> = [];
    const writes: string[] = [];
    const guest = { id: `guest_parity_${randomUUID()}`, name: "QA parity guest" };
    const guestJournal = info.outputPath("guest-cleanup.json");
    const pendingGuestWrites = new Set<unknown>();
    const guestWriteErrors: string[] = [];
    let guestUsed = false;
    const recordGuest = (state: string) => writeFile(guestJournal, JSON.stringify({
      state, guestId: guest.id, baseURL: info.project.use.baseURL,
    }, null, 2));
    await recordGuest("pending");
    page.on("pageerror", (error) => errors.push({
      message: error.message, stack: error.stack, path: page.url(),
    }));
    context.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method())) {
        writes.push(`${request.method()} ${pathname}`);
        if (["/api/liveblocks-guest", "/api/liveblocks-auth"].includes(pathname)) {
          guestUsed = true;
          pendingGuestWrites.add(request);
        }
      }
    });
    context.on("response", (response) => { pendingGuestWrites.delete(response.request()); });
    context.on("requestfailed", (request) => {
      if (pendingGuestWrites.delete(request)) guestWriteErrors.push("Guest write completion unknown");
    });
    await page.addInitScript((guest) => {
      const serialized = encodeURIComponent(JSON.stringify(guest));
      localStorage.setItem("liveblocks_guest", serialized);
      document.cookie = `liveblocks_guest=${serialized}; path=/; samesite=lax`;
      // Set a reproducible first visit, but do not reset user changes on reload.
      if (!sessionStorage.getItem("parity-initialized")) {
        localStorage.setItem("theme", "light");
        localStorage.setItem("sidebar-width", "0");
        localStorage.setItem("wiki-outline-open", "false");
        sessionStorage.setItem("parity-initialized", "1");
      }
    }, guest);
    try { await use(); }
    finally {
      try {
        // Stop new work before removing the context's exact guest identity.
        try { await expect.poll(() => pendingGuestWrites.size, { timeout: 15_000 }).toBe(0); }
        catch { guestWriteErrors.push("Guest writes still pending at teardown"); }
        for (const openPage of context.pages()) await openPage.close({ runBeforeUnload: false })
          .catch(() => { guestWriteErrors.push("Browser closure failed"); });
        if (guestUsed) {
          const convex = new ConvexHttpClient(process.env.PARITY_CONVEX_URL);
          const args = { siteSlug: "diana", guestIds: [guest.id] };
          const before = await convex.query(makeFunctionReference<"query">("guestNames:getByIds"), args);
          if (before[guest.id] !== undefined) {
            expect(before[guest.id], "Only remove the test's owned guest profile").toBe(guest.name);
            await convex.mutation(makeFunctionReference<"mutation">("guestNames:remove"), { siteSlug: "diana", guestId: guest.id });
          }
          expect(await convex.query(makeFunctionReference<"query">("guestNames:getByIds"), args)).toEqual({});
        }
        expect(guestWriteErrors, "Unknown writes block the next phase").toEqual([]);
        await recordGuest("clean");
      } catch (error) {
        await recordGuest("cleanup-failed");
        throw error;
      } finally {
        await info.attach("guest-cleanup", { path: guestJournal, contentType: "application/json" });
      }
      await info.attach("browser-health", {
        body: JSON.stringify({ errors, writes }, null, 2), contentType: "application/json",
      });
      expect(errors, "Uncaught browser errors").toEqual([]);
    }
  }, { auto: true }],
});

export async function signIn(page: Page) {
  const response = await page.request.post("/api/login", {
    data: { password: process.env.WIKI_VITE_PREVIEW_LOGIN_PASSWORD },
  });
  expect(response.status(), "Password gate login").toBe(200);
}

export async function openReader(page: Page, path = readerPath) {
  await signIn(page);
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(article(page).getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expect(article(page).locator("p,table").first()).toBeVisible();
}

export async function checkpoint(page: Page, info: TestInfo, name: string) {
  await test.step(`Checkpoint: ${name}`, async () => {
    // A cached HTML first frame is not an interactive, hydrated reader.
    await expect(page.locator("#wiki-first-frame-snapshot")).toHaveCount(0);
    await expect(page.locator("vite-error-overlay,[data-nextjs-dialog]")).toHaveCount(0);
    await expect(page.getByTestId("page-loading").filter({ visible: true })).toHaveCount(0);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    const layout = await page.evaluate(() => {
      const bounds = (selector: string) => Array.from(document.querySelectorAll(selector))
        .map((element) => element.getBoundingClientRect()).filter((r) => r.width && r.height)
        .map(({ x, y, width, height }) => ({ x, y, width, height }));
      return {
        path: location.pathname + location.search + location.hash,
        title: document.title,
        viewport: { width: innerWidth, height: innerHeight },
        overflow: document.documentElement.scrollWidth > innerWidth,
        article: bounds("article"), heading: bounds("h1"), canvas: bounds("canvas"),
        searchSummary: document.querySelector('[data-test-id="search-text-summary"]')?.textContent ?? null,
      };
    });
    expect(layout.overflow, `${name}: horizontal document overflow`).toBe(false);
    await info.attach(`${name}.json`, { body: JSON.stringify(layout, null, 2), contentType: "application/json" });
    const path = info.outputPath(`${name}.png`);
    await page.screenshot({ path, animations: "disabled" });
    await info.attach(name, { path, contentType: "image/png" });
  });
}
