import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });
test.skip(!process.env.PLAYWRIGHT_BASE_URL, "Requires the public education server.");

test("every public education illustration loads and keeps its wiki file URL", async ({ context, request }) => {
  test.setTimeout(300_000);
  const response = await request.get("/api/education/manifest");
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  const queue: Array<{ slug: string }> = [...manifest.pages];
  expect(queue.length).toBeGreaterThan(0);
  const images = new Set<string>();
  const failures: string[] = [];
  await Promise.all(Array.from({ length: 3 }, async () => {
    const page = await context.newPage();
    try {
      while (queue.length) {
        const { slug } = queue.shift()!;
        const route = slug.slice("wiki/education/".length).split("/").map(encodeURIComponent).join("/");
        await page.goto(`/education/${route}`, { waitUntil: "networkidle" });
        await expect(page.locator("article .wiki-markdown")).toBeVisible();
        const results = await page.locator("article img").evaluateAll(async elements => {
          const imgs = elements as HTMLImageElement[];
          await Promise.all(imgs.map(image => {
            image.loading = "eager";
            return image.decode().catch(() => {});
          }));
          return imgs.map(image => ({ src: image.getAttribute("src")!, width: image.naturalWidth }));
        });
        for (const image of results) {
          images.add(image.src);
          if (!image.width) failures.push(`${slug}: ${image.src}`);
        }
      }
    } finally { await page.close(); }
  }));
  expect(images.size).toBeGreaterThan(0);
  expect(failures, "Broken public education images").toEqual([]);
  // The same underlying assets must remain available through the existing wiki route.
  for (const src of images) {
    const url = new URL(src, "https://wiki.invalid");
    if (!url.pathname.startsWith("/api/education/")) continue;
    const wiki = await request.get(`/api/file${url.search}`);
    expect(wiki.ok(), src).toBe(true);
    expect(wiki.headers()["content-type"], src).toMatch(/^image\//);
  }
});
