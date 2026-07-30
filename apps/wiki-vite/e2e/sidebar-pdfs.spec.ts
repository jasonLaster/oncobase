import { expect, test, type Page } from "@playwright/test";
import { gotoWiki, installWikiApiMocks, openDirectory, waitForPageTitle } from "./fixtures";

async function openSourcePath(page: Page) {
  await openDirectory(page, "sources");
  await openDirectory(page, "people");
  await openDirectory(page, "providers");
  await openDirectory(page, "stanford");
  await openDirectory(page, "telli");
}

test.describe("Sidebar source files", () => {
  test("/api/wiki/manifest returns the full tree shape while the route shell stays lean", async ({
    request,
  }) => {
    const manifestResponse = await request.get("/api/wiki/manifest?scope=public", {
      timeout: 45_000,
    });
    expect(manifestResponse.ok()).toBeTruthy();
    const isPartialManifest =
      manifestResponse.headers()["x-wiki-manifest-partial"] === "true";
    if (process.env.PLAYWRIGHT_BASE_URL) {
      expect(isPartialManifest).toBe(false);
    } else if (isPartialManifest) {
      expect(manifestResponse.headers()["x-wiki-manifest-source"]).toBe(
        "bounded-content-fallback",
      );
    }

    const manifest = await manifestResponse.json();
    const slugs = (manifest.pages as Array<{ slug: string }>).map((entry) => entry.slug);
    expect(slugs.length).toBeGreaterThan(0);
    expect(slugs.some((slug) => slug.startsWith("wiki/"))).toBe(true);
    if (!isPartialManifest) {
      expect(slugs.some((slug) => slug.startsWith("sources/"))).toBe(true);
      expect(slugs).toContain("wiki/updates/week-8-may-3-to-9");
      expect(slugs).toContain("about/overview/key-context");
    }

    expect(Array.isArray(manifest.assets)).toBe(true);
    const assets = manifest.assets as Array<{ kind: string; path: string }>;
    expect(assets.some((asset) => asset.kind === "pdf" && asset.path.endsWith(".pdf"))).toBe(true);
  });

  test("runtime wiki pages render instead of returning a not-found shell", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/wiki/updates/week-5-april-12-to-18");

    await waitForPageTitle(page, "Week 5: April 12 to 18");
    await expect(
      page.getByTestId("document-article").locator("h1").first(),
    ).toContainText("Week 5");
  });

  test("sources directory contains markdown source links after drilling into stanford/telli", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/");

    await openSourcePath(page);
    const sourceLink = page
      .getByTestId("wiki-sidebar")
      .locator('a[href="/sources/people/providers/stanford/telli"]');
    await expect(sourceLink).toBeVisible();
    await expect(sourceLink).not.toHaveAttribute("href", /\/api\/file/);

    await sourceLink.click();
    await waitForPageTitle(page, "Telli 2016 HRD Platinum TNBC");
  });

  test("wiki/research-style pages are markdown links, not PDF links", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/");

    await openDirectory(page, "examples");
    const tablePage = page
      .getByTestId("wiki-sidebar")
      .getByRole("link", { name: "smart table" });
    await expect(tablePage).toBeVisible();
    await expect(tablePage).not.toHaveAttribute("href", /\/api\/file/);

    const pdfInWiki = page
      .getByTestId("wiki-sidebar")
      .locator('a[href^="/wiki/"][href*="/api/file"]');
    await expect(pdfInWiki).toHaveCount(0);
  });
});

test.describe("Sidebar PDF files", () => {
  test("sources directory contains PDF links after drilling into stanford/telli", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/");

    await openSourcePath(page);
    const pdfLink = page.getByTestId("wiki-sidebar").locator('a[href*="/api/file?path="]').first();
    await expect(pdfLink).toBeVisible();
  });

  test("PDF links point to /api/file?path= with .pdf path", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/");

    await openSourcePath(page);
    const firstPdf = page
      .getByTestId("wiki-sidebar")
      .locator('a[href*="/api/file?path="]')
      .first();
    const href = await firstPdf.getAttribute("href");
    expect(href).toMatch(/\/api\/file\?path=.*\.pdf/);
  });

  test("PDF links open in a new tab", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/");

    await openSourcePath(page);
    const firstPdf = page
      .getByTestId("wiki-sidebar")
      .locator('a[href*="/api/file?path="]')
      .first();
    await expect(firstPdf).toHaveAttribute("target", "_blank");
  });

  test("PDF entries render with a document icon SVG", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/");

    await openSourcePath(page);
    const firstPdf = page
      .getByTestId("wiki-sidebar")
      .locator('a[href*="/api/file?path="]')
      .first();
    await expect(firstPdf.locator("svg")).toHaveCount(1);
  });
});

test.describe("PDF serving via /api/file", () => {
  test("returns 400 when path param is missing", async ({ request }) => {
    const response = await request.get("/api/file");
    expect(response.status()).toBe(400);
  });

  test("returns 400 for non-PDF / non-asset paths", async ({ request }) => {
    const response = await request.get("/api/file?path=wiki/diagnostics/diagnosis.md");
    expect(response.status()).toBe(400);
  });

  test("returns 400 for unsupported file extensions", async ({ request }) => {
    const response = await request.get("/api/file?path=sources/example.exe");
    expect(response.status()).toBe(400);
  });

  test("prevents path traversal", async ({ request }) => {
    const response = await request.get("/api/file?path=../../etc/passwd");
    expect([400, 404]).toContain(response.status());
  });
});
