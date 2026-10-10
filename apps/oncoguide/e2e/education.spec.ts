import { expect, test } from "@playwright/test";
const autophagy = "/education/molecular-profiling/evee-pathways/01-autophagy-and-proteostasis/";
test("lessons, aliases and metadata work as static HTML without JavaScript", async ({ browser, request }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${test.info().project.use.baseURL}${autophagy}`);
  await expect(page.getByTestId("education-article").getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://oncoguide.cc${autophagy}`);
  const alias = await request.get(autophagy.replace("/education/", "/wiki/education/"));
  expect(alias.ok()).toBe(true);
  expect(await alias.text()).toContain("THE EDUCATION LIBRARY");
  const sitemap = await request.get("/sitemap.xml");
  expect(await sitemap.text()).toContain(`https://oncoguide.cc${autophagy}`);
  await context.close();
});
test("search, themes, mobile navigation and shared image theater work", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "The education library" })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  const input = page.getByRole("searchbox", { name: "Search education" });
  await expect(input).toBeFocused();
  await input.fill("autophagy"); await input.press("Enter");
  await expect.poll(() => page.locator(".edu-result").count()).toBeGreaterThan(0);
  const result = page.locator(".edu-result").first();
  const resultTitle = await result.getByRole("heading").textContent();
  await result.click();
  await expect(page.getByTestId("education-article").getByRole("heading", { level: 1 })).toHaveText(resultTitle!);
  await page.getByRole("link", { name: "All topics", exact: true }).last().click();
  await expect(page.getByRole("heading", { name: "The education library" })).toBeVisible();
  await page.goto("/education/guides/start-here/01-read-the-labels/");
  const theme = page.getByRole("button", { name: "Dark theme", exact: true });
  await theme.click(); await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload(); await expect(page.locator("html")).toHaveClass(/dark/);
  await page.locator('article img[data-theater-image]:visible').first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close image preview", exact: true }).click();
  await theme.click(); await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open education navigation" }).click();
  await expect(page.getByRole("navigation", { name: "Education navigation" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
test("every lesson and both image themes load without Diana API dependencies", async ({ context, request }) => {
  test.setTimeout(300_000);
  const response = await request.get("/education-manifest.json");
  expect(response.ok()).toBe(true);
  const manifest = await response.json() as { pages: Array<{ slug: string; title: string }> };
  expect(manifest.pages.length).toBeGreaterThan(0);
  const queue = [...manifest.pages]; const failures: string[] = []; let images = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    const page = await context.newPage();
    page.on("request", req => { if (/diana-tnbc\.com|blob\.vercel-storage\.com/.test(req.url())) failures.push(`Runtime dependency: ${req.url()}`); });
    try {
      for (let entry = queue.shift(); entry; entry = queue.shift()) {
        const pathname = `/education/${entry.slug.slice("wiki/education/".length)}/`;
        try {
          await page.goto(pathname, { waitUntil: "domcontentloaded" });
          const article = page.getByTestId("education-article");
          await expect(article.getByRole("heading", { level: 1 })).toHaveText(entry.title);
          if (await article.locator(".mermaid-placeholder").count()) failures.push(`Unrendered diagram: ${entry.slug}`);
          const result = await article.locator("img").evaluateAll(async elements => Promise.all(elements.map(async element => {
            const image = element as HTMLImageElement; image.loading = "eager";
            let timer: ReturnType<typeof setTimeout> | undefined; let decoded = false;
            try { await Promise.race([image.decode(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error("timeout")), 15_000); })]); decoded = true; }
            catch { /* Collect every broken image. */ } finally { clearTimeout(timer); }
            return { src: image.currentSrc || image.src, loaded: decoded && image.complete && image.naturalWidth > 0 };
          })));
          images += result.length;
          failures.push(...result.filter(image => !image.loaded).map(image => `${entry.slug}: ${image.src}`));
          const legacy = await request.get(`/wiki/education/${entry.slug.slice("wiki/education/".length)}/`);
          if (!legacy.ok()) failures.push(`Missing wiki alias: ${entry.slug}`);
        } catch (error) { failures.push(`${entry.slug}: ${String(error)}`); }
      }
    } finally { await page.close(); }
  }));
  console.info(`OncoGuide audit: ${manifest.pages.length} lessons, ${images} image elements, ${failures.length} failures`);
  expect(images).toBeGreaterThan(0); expect(failures).toEqual([]);
});
