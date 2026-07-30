import { expect, test } from "@playwright/test";
import { documentArticle, nextErrorOverlay } from "./fixtures";

test.describe("Live backend P0 smokes", () => {
  test("clean browser renders a real route with a PDF-only bootstrap asset index", async ({
    page,
    request,
  }, testInfo) => {
    // Talks to the live Convex backend. Manifest/page-body fetches can take 5-15s on a cold cache,
    // so the test budget needs to cover manifest + cold page fetch + sidebar hydration.
    testInfo.setTimeout(120_000);

    const manifestResponse = await request.get("/api/wiki/manifest", { timeout: 60_000 });
    expect(manifestResponse.ok(), await manifestResponse.text()).toBe(true);
    const manifest = await manifestResponse.json();
    const manifestAssets = manifest.assets as Array<{ kind: string; path: string }>;
    expect(manifestAssets.length).toBeGreaterThan(0);
    expect(
      manifestAssets.every((asset) => asset.kind === "pdf" && asset.path.endsWith(".pdf")),
    ).toBe(true);

    await page.goto("/wiki/logistics/insurance?devtools=1", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await expect(documentArticle(page).locator(".page-header h1")).toContainText(/insurance/i, {
      timeout: 60_000,
    });
    await expect(documentArticle(page)).toContainText(/prior authorization|coverage|insurance/i);
    await expect(page.getByTestId("wiki-sidebar")).toBeVisible();
    await expect(
      page.getByTestId("wiki-sidebar").getByRole("button", { name: /images/i }),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("wiki-sidebar").getByRole("link", { name: /\.png$/i }),
    ).toHaveCount(0);
    await expect(nextErrorOverlay(page)).toHaveCount(0);
  });
});
