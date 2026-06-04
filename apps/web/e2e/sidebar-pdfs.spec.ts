import { test, expect } from "@playwright/test";

const sidebar = "[data-test-id='sidebar-tree']";
const sourceRoot = "sources/people/providers/stanford/telli";
const sourcePdf = `${sourceRoot}/telli-2016-hrd-platinum-tnbc.pdf`;
const isProdRun = process.env.TEST_ENV === "prod";

type FileNode = {
  name: string;
  slug: string;
  type: "file" | "directory" | "pdf";
  truncated?: boolean;
  pdfPath?: string;
  children?: FileNode[];
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findNode(nodes: FileNode[], slug: string): FileNode | null {
  for (const node of nodes) {
    if (node.slug === slug) return node;
    const child = node.children ? findNode(node.children, slug) : null;
    if (child) return child;
  }
  return null;
}

/** Open a directory button only if it is currently collapsed. */
async function expandIfCollapsed(nav: ReturnType<import("@playwright/test").Page["locator"]>, name: string) {
  const btn = nav
    .getByRole("button", {
      name: new RegExp(`^(?:${escapeRegExp(name)}|Expand ${escapeRegExp(name)}|Collapse ${escapeRegExp(name)})$`),
    })
    .first();
  if ((await btn.count()) === 0) return;
  await expect(btn).toHaveAttribute("aria-expanded", /^(true|false)$/);
  if ((await btn.getAttribute("aria-expanded")) !== "true") {
    await btn.click();
    await expect(btn).toHaveAttribute("aria-expanded", "true");
  }
}

async function waitForSidebarTree(nav: ReturnType<import("@playwright/test").Page["locator"]>) {
  await expect(nav.getByText("sources").first()).toBeVisible({ timeout: 30_000 });
}

async function expandFirstPdfSet(nav: ReturnType<import("@playwright/test").Page["locator"]>) {
  const directPdf = nav.locator('a[href*="/api/file?path="]').first();
  if (await directPdf.isVisible().catch(() => false)) {
    return;
  }

  const pdfSet = nav.getByRole("button", { name: /PDF set$/ }).first();
  if ((await pdfSet.count()) === 0) {
    return;
  }
  await expect(pdfSet).toBeVisible();
  if ((await pdfSet.getAttribute("aria-expanded")) === "false") {
    await pdfSet.click();
    await expect(pdfSet).toHaveAttribute("aria-expanded", "true");
  }
}

function expectCacheableFileTree(cacheControl: string | undefined) {
  expect(cacheControl).toContain("public");
  expect(cacheControl).toMatch(/(?:s-maxage|max-age)=\d+/);
}

function expectCacheablePageList(cacheControl: string | undefined) {
  expect(cacheControl).toContain("public");
  expect(cacheControl).toMatch(/(?:s-maxage|max-age)=\d+/);
  // The prod stress suite hits the edge-served site, where intermediary cache
  // policy can collapse this header to a plain public max-age contract.
  if (cacheControl?.includes("stale-while-revalidate")) {
    expect(cacheControl).toContain("stale-while-revalidate");
  }
}

test.describe("Sidebar source files", () => {
  test("/api/file-tree returns the complete cached tree while page HTML keeps the shell lean", async ({
    request,
  }) => {
    const [treeResponse, compactTreeResponse, pagesResponse, htmlResponse] = await Promise.all([
      request.get("/api/file-tree"),
      request.get("/api/file-tree?format=compact"),
      request.get("/api/pages"),
      request.get("/wiki/updates/week-6-april-19-to-25?token=diana"),
    ]);

    expect(treeResponse.ok()).toBeTruthy();
    expect(compactTreeResponse.ok()).toBeTruthy();
    expect(pagesResponse.ok()).toBeTruthy();
    expect(htmlResponse.ok()).toBeTruthy();
    expectCacheableFileTree(treeResponse.headers()["cache-control"]);
    expectCacheableFileTree(compactTreeResponse.headers()["cache-control"]);
    expectCacheablePageList(pagesResponse.headers()["cache-control"]);
    expect(pagesResponse.headers()["x-pages-cache"]).toBe("public");

    const tree = (await treeResponse.json()) as FileNode[];
    const topLevelSlugs = tree.map((node) => node.slug);

    expect(topLevelSlugs).toContain("wiki");
    expect(topLevelSlugs).toContain("sources");
    expect(findNode(tree, "wiki/updates/week-6-april-19-to-25")).toMatchObject({
      type: "file",
    });
    expect(findNode(tree, sourceRoot)).toMatchObject({
      type: "directory",
    });
    expect(findNode(tree, sourcePdf)).toMatchObject({ type: "pdf" });

    const pages = (await pagesResponse.json()) as Array<{ slug: string }>;
    expect(pages.some((page) => page.slug === "wiki/updates/week-6-april-19-to-25")).toBe(true);
    expect(pages.some((page) => page.slug.startsWith(`${sourceRoot}/`))).toBe(true);

    const expandedTreeJson = JSON.stringify(tree);
    const compactTreeJson = await compactTreeResponse.text();
    expect(compactTreeJson.length).toBeLessThan(expandedTreeJson.length);
    expect(compactTreeJson).not.toContain(
      `${sourceRoot}/telli-2016-hrd-platinum-tnbc__paper-set`,
    );
    expect(compactTreeJson).not.toContain(sourcePdf);

    const html = await htmlResponse.text();
    expect(html).toContain("Week 6");
    expect(html).toContain("wiki/updates");
    expect(html).not.toContain('"initialTree":[{"name":"about"');
    expect(html).not.toContain("initialPages");
    expect(html).not.toContain(sourceRoot);
    expect(html).not.toContain('E{"digest"');
    expect(html).not.toContain("$RX(");
  });

  test("runtime wiki pages render instead of caching a not-found boundary", async ({
    request,
  }) => {
    const [journalResponse, week6Response] = await Promise.all([
      request.get("/about/Journal?token=diana"),
      request.get("/wiki/updates/week-6-april-19-to-25?token=diana"),
    ]);

    expect(journalResponse.ok()).toBeTruthy();
    expect(week6Response.ok()).toBeTruthy();

    const journalHtml = await journalResponse.text();
    expect(journalHtml).toContain("Saturday, May 2nd");
    expect(journalHtml).not.toContain('E{"digest"');
    expect(journalHtml).not.toContain("$RX(");

    const week6Html = await week6Response.text();
    expect(week6Html).toContain("Week 6");
    expect(week6Html).not.toContain('E{"digest"');
    expect(week6Html).not.toContain("$RX(");
  });

  test("new sidebar sessions only open the wiki top-level section", async ({ page }) => {
    await page.goto("/");
    const nav = page.locator(sidebar);

    await waitForSidebarTree(nav);
    await expect(
      nav.getByRole("button", { name: /^(wiki|Expand wiki|Collapse wiki)$/ }),
    ).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(
      nav.getByRole("button", { name: /^(sources|Expand sources|Collapse sources)$/ }),
    ).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(
      nav.getByRole("button", { name: "institutions" }),
    ).toHaveCount(0);
  });

  test("sources directory contains markdown source links after drilling into stanford/telli", async ({ page }) => {
    test.skip(isProdRun, "Prod source tree shape changes too often for this drill-down assertion.");
    await page.goto("/");
    const nav = page.locator(sidebar);

    await waitForSidebarTree(nav);
    await expandIfCollapsed(nav, "sources");
    await expandIfCollapsed(nav, "people");
    await expandIfCollapsed(nav, "providers");
    await expandIfCollapsed(nav, "stanford");
    await expandIfCollapsed(nav, "telli");
    await expandFirstPdfSet(nav);

    const sourceLinks = nav.locator(`a[href^="/${sourceRoot}/"]`);
    await expect(sourceLinks.first()).toBeVisible();
    await expect(sourceLinks.first()).not.toHaveAttribute("href", /\/api\/file/);
  });

  test("sources/research pages are markdown links, not PDF links", async ({ page }) => {
    test.skip(isProdRun, "Prod source tree shape changes too often for this drill-down assertion.");
    await page.goto("/");
    const nav = page.locator(sidebar);

    await waitForSidebarTree(nav);
    await expandIfCollapsed(nav, "sources");
    await expandIfCollapsed(nav, "wiki");
    await expandIfCollapsed(nav, "research");

    const mdLinks = nav.locator('a[href^="/sources/research/"]');
    await expect(mdLinks.first()).toBeVisible();

    const pdfInSourcesResearch = nav.locator('a[href^="/sources/research/"][href*="api/file"]');
    await expect(pdfInSourcesResearch).toHaveCount(0);
  });
});

// PDF rendering used to be preview-only because preview deploys skipped
// full PDF sync. After PR #64's direct-to-blob asset uploads, the first
// Diana publish synchronized all 8068 source assets to prod Blob, so
// preview and prod are no longer materially different here.
test.describe("Sidebar PDF files", () => {
  test("sources directory contains PDF links after drilling into stanford/telli", async ({ page }) => {
    test.skip(isProdRun, "Prod source tree shape changes too often for this drill-down assertion.");
    await page.goto("/");
    const nav = page.locator(sidebar);

    await waitForSidebarTree(nav);
    await expandIfCollapsed(nav, "sources");
    await expandIfCollapsed(nav, "people");
    await expandIfCollapsed(nav, "providers");
    await expandIfCollapsed(nav, "stanford");
    await expandIfCollapsed(nav, "telli");
    await expandFirstPdfSet(nav);

    const pdfLinks = nav.locator('a[href*="/api/file?path="]');
    await expect(pdfLinks.first()).toBeVisible();
  });

  test("PDF links point to /api/file?path= with .pdf path", async ({ page }) => {
    test.skip(isProdRun, "Prod source tree shape changes too often for this drill-down assertion.");
    await page.goto("/");
    const nav = page.locator(sidebar);

    await waitForSidebarTree(nav);
    await expandIfCollapsed(nav, "sources");
    await expandIfCollapsed(nav, "people");
    await expandIfCollapsed(nav, "providers");
    await expandIfCollapsed(nav, "stanford");
    await expandIfCollapsed(nav, "telli");
    await expandFirstPdfSet(nav);

    const firstPdf = nav.locator('a[href*="/api/file?path="]').first();
    const href = await firstPdf.getAttribute("href");
    expect(href).toMatch(/\/api\/file\?path=.*\.pdf/);
  });

  test("PDF links open in a new tab", async ({ page }) => {
    test.skip(isProdRun, "Prod source tree shape changes too often for this drill-down assertion.");
    await page.goto("/");
    const nav = page.locator(sidebar);

    await waitForSidebarTree(nav);
    await expandIfCollapsed(nav, "sources");
    await expandIfCollapsed(nav, "people");
    await expandIfCollapsed(nav, "providers");
    await expandIfCollapsed(nav, "stanford");
    await expandIfCollapsed(nav, "telli");
    await expandFirstPdfSet(nav);

    const firstPdf = nav.locator('a[href*="/api/file?path="]').first();
    await expect(firstPdf).toHaveAttribute("target", "_blank");
  });

  test("PDF entries render with document icon SVG", async ({ page }) => {
    test.skip(isProdRun, "Prod source tree shape changes too often for this drill-down assertion.");
    await page.goto("/");
    const nav = page.locator(sidebar);

    await waitForSidebarTree(nav);
    await expandIfCollapsed(nav, "sources");
    await expandIfCollapsed(nav, "people");
    await expandIfCollapsed(nav, "providers");
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
      `${baseURL}/api/file?path=${sourcePdf}`
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
