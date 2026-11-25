import { expect, test } from "@playwright/test";
import { article, keepAllResourceTimings, openPage, passGate, requireLocalStack } from "./helpers";

requireLocalStack();

test.describe("reading the wiki (real backend)", () => {
  test.beforeEach(async ({ page }) => passGate(page));

  test("home renders and wiki links navigate in the client with working history", async ({ page }) => {
    await openPage(page, "/", "Local Fixture Wiki");
    await page.evaluate(() => { (window as unknown as { __marker: number }).__marker = 1; });

    await article(page).getByRole("link", { name: "Treatment notes" }).click();
    await expect(page).toHaveURL(/\/wiki\/treatment$/);
    await expect(article(page)).toHaveAccessibleName("Treatment notes");
    // Same document: the click was handled by the router, not a page load.
    expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(1);

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(article(page)).toHaveAccessibleName("Local Fixture Wiki");
    await page.goForward();
    await expect(article(page)).toHaveAccessibleName("Treatment notes");
  });

  test("the sidebar opens a folder, navigates, and remembers its state across reload", async ({ page }) => {
    await openPage(page, "/");
    const sidebar = page.getByTestId("wiki-sidebar");
    await sidebar.getByRole("treeitem", { name: "biomarkers" }).click();
    await sidebar.getByRole("link", { name: /pd.l1/ }).click();
    await expect(page).toHaveURL(/\/wiki\/biomarkers\/pd-l1$/);
    await expect(article(page)).toHaveAccessibleName("PD-L1");

    await page.reload();
    await expect(sidebar.getByRole("link", { name: /pd.l1/ })).toBeVisible();
  });

  test("a deep link opens its sidebar branch, scrolls to its heading, and headings update the hash", async ({ page }) => {
    await openPage(page, "/wiki/treatment#open-questions");
    await expect(page.getByTestId("wiki-sidebar").getByRole("link", { name: "treatment" })).toBeVisible();
    await expect(page.locator("#open-questions")).toBeInViewport();

    await article(page).getByRole("heading", { name: "Change log" }).click();
    await expect(page).toHaveURL(/#change-log$/);
  });

  test("the outline lists headings and jumps to one", async ({ page }) => {
    await openPage(page, "/wiki/treatment");
    const outline = page.getByTestId("page-outline");
    await outline.getByRole("button", { name: "Open outline" }).click();
    await outline.getByRole("button", { name: "Change log" }).click();
    await expect(page).toHaveURL(/#change-log$/);
  });

  test("a wide table expands over the page and collapses again", async ({ page }) => {
    await openPage(page, "/wiki/treatment");
    const toggle = article(page).getByRole("button", { name: /expand table/i }).first();
    await toggle.click();
    const layer = page.locator(".table-expansion-layer").first();
    await expect(layer).toBeVisible();
    await expect(layer).toContainText("Carboplatin");
    await page.getByRole("button", { name: "Collapse table" }).click();
    await expect(layer).toHaveCount(0);
  });

  test("an embedded image opens in the theater with a download link", async ({ page }) => {
    await openPage(page, "/wiki/treatment");
    await article(page).getByRole("button", { name: /^Open image/ }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("link", { name: "Download image" })).toHaveAttribute("href", /\/api\/file\?path=.*treatment-timeline\.png/);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("revisiting a page makes no body request (P11)", async ({ page }) => {
    await keepAllResourceTimings(page);
    const manifest = page.waitForResponse(response => response.url().includes("/api/wiki/manifest") && response.status() === 200);
    await openPage(page, "/", "Local Fixture Wiki");
    await manifest;
    const visit = async () => {
      await article(page).getByRole("link", { name: "Treatment notes" }).click();
      await expect(article(page)).toHaveAccessibleName("Treatment notes");
      await expect(article(page)).toContainText("Current plan");
      await page.goBack();
      await expect(article(page)).toHaveAccessibleName("Local Fixture Wiki");
    };
    await visit();
    await page.evaluate(() => performance.clearResourceTimings());
    await visit();
    const bodies = await page.evaluate(() => performance.getEntriesByType("resource")
      .filter(entry => entry.name.includes("/api/wiki/pages")).map(entry => entry.name));
    expect(bodies, "a stored body with the manifest's hash is not requested again").toEqual([]);
  });

  test("a versioned image is reopened from the HTTP cache in a new document (P11)", async ({ page }) => {
    const path = "/api/file?path=wiki%2Fimages%2Ftreatment-timeline.png";
    const readImage = (url: string) => page.evaluate(async (src) => {
      const response = await fetch(src, { headers: { Accept: "image/png" } });
      if (!response.ok) throw new Error(`Image request returned ${response.status}`);
      await response.arrayBuffer();
      const timings = performance.getEntriesByName(new URL(src, location.href).href) as PerformanceResourceTiming[];
      return {
        hash: response.headers.get("etag")?.replace(/"/g, ""),
        transferSize: timings.at(-1)?.transferSize ?? -1,
      };
    }, url);

    // Wiki startup can evict the fixture from Chromium's in-memory HTTP cache.
    // Use small same-origin documents and fetch to exercise the HTTP cache.
    await page.goto("/robots.txt");
    const unversioned = await readImage(path);
    expect(unversioned.hash, "ETag names the stored image").toBeTruthy();
    expect(unversioned.transferSize, "unversioned first load").toBeGreaterThan(0);
    const versioned = `${path}&v=${unversioned.hash}`;
    expect((await readImage(versioned)).transferSize, "versioned first load").toBeGreaterThan(0);

    await page.goto("/llms.txt");
    expect((await readImage(versioned)).transferSize, "versioned image is cached in the new document").toBe(0);
    expect((await readImage(path)).transferSize, "unversioned image in the new document stays no-store").toBeGreaterThan(0);
  });

  test("a tag page lists its tagged pages and links to them", async ({ page }) => {
    await page.goto("/tags/treatment");
    await expect(page.getByRole("link", { name: /Treatment notes/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Timeline/ })).toBeVisible();
    await page.getByRole("link", { name: /Timeline/ }).first().click();
    await expect(page).toHaveURL(/\/wiki\/timeline$/);
  });

  test("source PDFs are served as PDFs", async ({ page }) => {
    const response = await page.request.get("/api/file?path=sources/papers/sample-trial.pdf");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/pdf");
  });

  test("an unknown page shows an actionable not-found state", async ({ page }) => {
    await page.goto("/wiki/does-not-exist");
    const state = page.locator('[data-reader-unavailable="true"]').filter({ visible: true });
    await expect(state).toBeVisible();
    await state.getByRole("link", { name: "Back to the wiki" }).or(state.getByRole("link", { name: "Go home" })).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(article(page)).toHaveAccessibleName("Local Fixture Wiki");
  });

  test("on a phone, the navigation sheet opens a page, traps focus, and restores it on close", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPage(page, "/");
    const trigger = page.getByRole("button", { name: "Open page navigation", exact: true });
    await trigger.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await sheet.getByRole("link", { name: "timeline" }).click();
    await expect(page).toHaveURL(/\/wiki\/timeline$/);
    await expect(article(page)).toHaveAccessibleName("Timeline");
  });
});
