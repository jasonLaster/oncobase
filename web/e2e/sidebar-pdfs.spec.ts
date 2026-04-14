import { test, expect } from "@playwright/test";

const sidebar = "aside.hidden.md\\:flex nav";

/** Open a directory button only if it is currently collapsed (shows "▶"). */
async function expandIfCollapsed(nav: ReturnType<import("@playwright/test").Page["locator"]>, name: string) {
  const btn = nav.getByRole("button", { name }).first();
  const text = await btn.textContent();
  if (text?.includes("▶")) {
    await btn.click();
  }
}

test.describe("Sidebar PDF files", () => {
  test("sources directory contains PDF links after drilling into stanford/telli", async ({ page }) => {
    await page.goto("/");
    const nav = page.locator(sidebar);

    // sources is open at depth=0 by default — no click needed
    await expandIfCollapsed(nav, "institutions");
    await expandIfCollapsed(nav, "stanford");
    await expandIfCollapsed(nav, "telli");

    const pdfLinks = nav.locator('a[href*="/api/file?path="]');
    await expect(pdfLinks.first()).toBeVisible();
  });

  test("PDF links point to /api/file?path= with .pdf path", async ({ page }) => {
    await page.goto("/");
    const nav = page.locator(sidebar);

    await expandIfCollapsed(nav, "institutions");
    await expandIfCollapsed(nav, "stanford");
    await expandIfCollapsed(nav, "telli");

    const firstPdf = nav.locator('a[href*="/api/file?path="]').first();
    const href = await firstPdf.getAttribute("href");
    expect(href).toMatch(/\/api\/file\?path=.*\.pdf/);
  });

  test("PDF links open in a new tab", async ({ page }) => {
    await page.goto("/");
    const nav = page.locator(sidebar);

    await expandIfCollapsed(nav, "institutions");
    await expandIfCollapsed(nav, "stanford");
    await expandIfCollapsed(nav, "telli");

    const firstPdf = nav.locator('a[href*="/api/file?path="]').first();
    await expect(firstPdf).toHaveAttribute("target", "_blank");
  });

  test("PDF entries render with document icon SVG", async ({ page }) => {
    await page.goto("/");
    const nav = page.locator(sidebar);

    await expandIfCollapsed(nav, "institutions");
    await expandIfCollapsed(nav, "stanford");
    await expandIfCollapsed(nav, "telli");

    const firstPdf = nav.locator('a[href*="/api/file?path="]').first();
    await expect(firstPdf.locator("svg")).toBeVisible();
  });

  test("wiki/research pages are markdown links, not PDF links", async ({ page }) => {
    // Navigate to a wiki/research page so that section is expanded in sidebar
    await page.goto("/wiki/research/paper-catalog");
    const nav = page.locator(sidebar);

    const mdLinks = nav.locator('a[href^="/wiki/research/"]');
    await expect(mdLinks.first()).toBeVisible();

    // None of the wiki/research links should be PDF links
    const pdfInWiki = nav.locator('a[href^="/wiki/research/"][href*="api/file"]');
    await expect(pdfInWiki).toHaveCount(0);
  });
});

test.describe("PDF serving via /api/file", () => {
  test("returns PDF content for a known file (local)", async ({ request, baseURL }) => {
    if (process.env.TEST_ENV === "prod") return;

    const res = await request.get(
      `${baseURL}/api/file?path=sources/institutions/stanford/telli/telli-2016-hrd-platinum-tnbc.pdf`
    );
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/pdf");
  });

  test("returns 400 for non-PDF paths", async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/api/file?path=wiki/diagnostics/diagnosis.md`);
    expect(res.status()).toBe(400);
  });

  test("returns 400 when path param is missing", async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/api/file`);
    expect(res.status()).toBe(400);
  });

  test("prevents path traversal", async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/api/file?path=../../etc/passwd`);
    expect([400, 404]).toContain(res.status());
  });
});
