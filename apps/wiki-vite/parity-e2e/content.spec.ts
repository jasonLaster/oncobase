import { createHash } from "node:crypto";
import { test, expect, signIn, openReader, article, checkpoint } from "./fixtures";

test("published page content hashes and manifest inventory", async ({ page }, info) => {
  await signIn(page);
  const manifestResponse = await page.request.get("/api/wiki/manifest?scope=public");
  expect(manifestResponse.status()).toBe(200);
  const manifest = await manifestResponse.json();
  expect(manifest.pages.length).toBeGreaterThan(100);
  const slugs = ["wiki/logistics/insurance", "about/Terminology", "wiki/diagnostics/diagnosis"];
  const response = await page.request.get(`/api/wiki/pages?scope=public&slugs=${slugs.join(",")}`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.pages.map((page: { slug: string }) => page.slug).sort()).toEqual(slugs.sort());
  await info.attach("content-contract", { contentType: "application/json", body: JSON.stringify({
    inventory: manifest.pages.map((page: { slug: string; contentHash: string }) => [page.slug, page.contentHash]).sort(),
    pages: body.pages.map((page: { slug: string; content: string }) => ({ slug: page.slug, sha256: createHash("sha256").update(page.content).digest("hex") })).sort((a: { slug: string }, b: { slug: string }) => a.slug.localeCompare(b.slug)),
  }) });
});

test("published PDF supports authenticated byte ranges", async ({ page }) => {
  await signIn(page);
  const response = await page.request.get("/api/file?path=sources%2Fdiagnostics%2F401-breast-mri.pdf", {
    headers: { Range: "bytes=0-31" },
  });
  expect(response.status()).toBe(206);
  expect(response.headers()["content-type"]).toContain("application/pdf");
  expect(response.headers()["content-range"]).toMatch(/^bytes 0-31\/\d+$/);
  const body = await response.body();
  expect(body.length).toBe(32);
  expect(body.subarray(0, 5).toString()).toBe("%PDF-");
});

test("published vaccine article AVIF asset is available", async ({ page }) => {
  await signIn(page);
  const response = await page.request.get("/api/file?path=sources%2Fresearch%2Fpapers%2Fcancer-vaccines%2Fimages%2F3f641eb4ab6c367340c58be37a335e11_MD5.avif");
  expect(response.status(), "Published article references this image; a missing asset is not a passing preview").toBe(200);
  expect(response.headers()["content-type"]).toBe("image/avif");
});

for (const width of [393, 1440]) {
  test(`tag links preserve article navigation at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await openReader(page);
    const link = article(page).locator('a[href="/tags/insurance"]');
    await link.click();
    await expect(page).toHaveURL(/\/tags\/insurance$/);
    await expect(page.locator('a[href="/wiki/logistics/insurance"]').filter({ visible: true }).first()).toBeVisible();
    await checkpoint(page, info, "tag-results");
    await page.goBack();
    await expect(article(page).getByRole("table").first()).toBeVisible();
  });
  test(`published markdown image theater opens and closes at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await openReader(page, "/sources/research/papers/cui-2026-haiku-spatial-biology/cui-2026-haiku-spatial-biology");
    const opener = article(page).getByRole("button", { name: "Open image: HAIKU", exact: true }).first();
    await expect(opener).toBeVisible();
    await opener.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("img")).toBeVisible();
    await expect.poll(() => dialog.getByRole("img").evaluate((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    const imageBounds = (await dialog.getByRole("img").boundingBox())!;
    expect(imageBounds.width, "Preview fills the available stage, not only its native pixels").toBeGreaterThan(width - 60);
    expect(imageBounds.height).toBeGreaterThan(850);
    await expect(page.getByRole("link", { name: "Download image" })).toHaveAttribute("href", /.+/);
    await checkpoint(page, info, "image-theater");
    await page.getByRole("button", { name: "Close image preview" }).click();
    await expect(dialog).toBeHidden();
  });
}
