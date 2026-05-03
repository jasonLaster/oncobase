import { test, expect } from "@playwright/test";

const sidebar = "aside.hidden.md\\:flex nav";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Open a directory button only if it is currently collapsed (shows "▶"). */
async function expandIfCollapsed(nav: ReturnType<import("@playwright/test").Page["locator"]>, name: string) {
  const btn = nav.getByRole("button", { name: new RegExp(`^[▶▼]\\s*${escapeRegExp(name)}$`) }).first();
  if ((await btn.count()) === 0) return;
  const text = await btn.textContent();
  if (text?.includes("▶")) {
    await btn.click();
  }
}

async function waitForSidebarTree(nav: ReturnType<import("@playwright/test").Page["locator"]>) {
  await expect(
    nav.getByRole("button", { name: /^[▶▼]\s*sources$/ }).first()
  ).toBeVisible({ timeout: 30_000 });
}

async function expandFirstPdfSet(nav: ReturnType<import("@playwright/test").Page["locator"]>) {
  const pdfSet = nav.getByRole("button", { name: /PDF set$/ }).first();
  await expect(pdfSet).toBeVisible();
  const text = await pdfSet.textContent();
  if (text?.includes("▶")) {
    await pdfSet.click();
  }
}

test.describe("Sidebar source files", () => {
  test("sources directory contains markdown source links after drilling into stanford/telli", async ({ page }) => {
    await page.goto("/");
    const nav = page.locator(sidebar);

    await waitForSidebarTree(nav);
    // sources is open at depth=0 by default — no click needed
    await expandIfCollapsed(nav, "sources");
    await expandIfCollapsed(nav, "institutions");
    await expandIfCollapsed(nav, "stanford");
    await expandIfCollapsed(nav, "telli");
    await expandFirstPdfSet(nav);

    const sourceLinks = nav.locator('a[href^="/sources/institutions/stanford/telli/"]');
    await expect(sourceLinks.first()).toBeVisible();
    await expect(sourceLinks.first()).not.toHaveAttribute("href", /\/api\/file/);
  });

  test("wiki/research pages are markdown links, not PDF links", async ({ page }) => {
    await page.goto("/");
    const nav = page.locator(sidebar);

    await waitForSidebarTree(nav);
    await expandIfCollapsed(nav, "sources");
    await expandIfCollapsed(nav, "wiki");
    await expandIfCollapsed(nav, "research");

    const mdLinks = nav.locator('a[href^="/wiki/research/"]');
    await expect(mdLinks.first()).toBeVisible();

    const pdfInWiki = nav.locator('a[href^="/wiki/research/"][href*="api/file"]');
    await expect(pdfInWiki).toHaveCount(0);
  });
});

// PDF rendering used to be preview-only because preview deploys skipped
// full PDF sync. After PR #64's direct-to-blob asset uploads, the first
// Diana publish synchronized all 8068 source assets to prod Blob, so
// preview and prod are no longer materially different here.
test.describe("Sidebar PDF files", () => {
  test("sources directory contains PDF links after drilling into stanford/telli", async ({ page }) => {
    await page.goto("/");
    const nav = page.locator(sidebar);

    await waitForSidebarTree(nav);
    // sources is open at depth=0 by default — no click needed
    await expandIfCollapsed(nav, "sources");
    await expandIfCollapsed(nav, "institutions");
    await expandIfCollapsed(nav, "stanford");
    await expandIfCollapsed(nav, "telli");
    await expandFirstPdfSet(nav);

    const pdfLinks = nav.locator('a[href*="/api/file?path="]');
    await expect(pdfLinks.first()).toBeVisible();
  });

  test("PDF links point to /api/file?path= with .pdf path", async ({ page }) => {
    await page.goto("/");
    const nav = page.locator(sidebar);

    await waitForSidebarTree(nav);
    await expandIfCollapsed(nav, "sources");
    await expandIfCollapsed(nav, "institutions");
    await expandIfCollapsed(nav, "stanford");
    await expandIfCollapsed(nav, "telli");
    await expandFirstPdfSet(nav);

    const firstPdf = nav.locator('a[href*="/api/file?path="]').first();
    const href = await firstPdf.getAttribute("href");
    expect(href).toMatch(/\/api\/file\?path=.*\.pdf/);
  });

  test("PDF links open in a new tab", async ({ page }) => {
    await page.goto("/");
    const nav = page.locator(sidebar);

    await waitForSidebarTree(nav);
    await expandIfCollapsed(nav, "sources");
    await expandIfCollapsed(nav, "institutions");
    await expandIfCollapsed(nav, "stanford");
    await expandIfCollapsed(nav, "telli");
    await expandFirstPdfSet(nav);

    const firstPdf = nav.locator('a[href*="/api/file?path="]').first();
    await expect(firstPdf).toHaveAttribute("target", "_blank");
  });

  test("PDF entries render with document icon SVG", async ({ page }) => {
    await page.goto("/");
    const nav = page.locator(sidebar);

    await waitForSidebarTree(nav);
    await expandIfCollapsed(nav, "sources");
    await expandIfCollapsed(nav, "institutions");
    await expandIfCollapsed(nav, "stanford");
    await expandIfCollapsed(nav, "telli");
    await expandFirstPdfSet(nav);

    const firstPdf = nav.locator('a[href*="/api/file?path="]').first();
    await expect(firstPdf.locator("svg")).toBeVisible();
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
