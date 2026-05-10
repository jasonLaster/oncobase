import { expect, test } from "@playwright/test";
import { documentArticle, nextErrorOverlay } from "./fixtures";

const hiddenAssetPattern = /(^|\/)images\/|\.(avif|gif|jpe?g|png|svg|webp)$/i;

test.describe("Live backend P0 smokes", () => {
  test("clean browser renders a real route and keeps image-only asset paths out of the sidebar", async ({
    page,
    request,
  }) => {
    const manifestResponse = await request.get("/api/wiki/manifest", { timeout: 45_000 });
    expect(manifestResponse.ok(), await manifestResponse.text()).toBe(true);
    const manifest = await manifestResponse.json();
    const hiddenAssets = (manifest.assets as Array<{ path: string }>).filter((asset) =>
      hiddenAssetPattern.test(asset.path),
    );
    expect(hiddenAssets.length).toBeGreaterThan(0);

    await page.goto("/wiki/logistics/insurance?devtools=1", {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });

    await expect(documentArticle(page).locator(".page-header h1")).toContainText(/insurance/i, {
      timeout: 45_000,
    });
    await expect(documentArticle(page)).toContainText(/prior authorization|coverage|insurance/i);
    await expect(page.getByTestId("wiki-sidebar")).toBeVisible();
    await expect(
      page.getByTestId("wiki-sidebar").getByRole("button", { name: /images/i }),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("wiki-sidebar").getByRole("link", { name: hiddenAssetPattern }),
    ).toHaveCount(0);
    await expect(nextErrorOverlay(page)).toHaveCount(0);
  });
});
