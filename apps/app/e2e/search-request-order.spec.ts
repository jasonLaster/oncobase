import { expect, test } from "@playwright/test";
import { installWikiApiMocks } from "./fixtures";

for (const [phase, staleOutcome] of [
  ["initial", "results"], ["initial", "error"],
  ["exhaustive", "results"], ["exhaustive", "error"],
] as const) {
  test(`a late ${phase} text-search ${staleOutcome} cannot replace the current query`, async ({ page }) => {
    await installWikiApiMocks(page);
    await page.route("**/api/ai-search**", (route) => route.fulfill({ json: { results: [] } }));
    let releaseOldRequest!: () => void;
    const oldRequest = new Promise<void>((resolve) => { releaseOldRequest = resolve; });
    let oldRequestStarted = false;
    let earlierRequests = 0;
    await page.route("**/api/search?**", async (route) => {
      const query = new URL(route.request().url()).searchParams.get("q");
      if (query === "earlier") {
        earlierRequests += 1;
        if (phase === "exhaustive" && earlierRequests === 1) {
          await route.fulfill({ json: {
            complete: false,
            retryAfterMs: 1000,
            results: [{ slug: "fixture/earlier", title: "Earlier indexed match", excerpt: "earlier indexed marker" }],
          } });
          return;
        }
        oldRequestStarted = true;
        await oldRequest;
      }
      await route.fulfill({
        status: query === "earlier" && staleOutcome === "error" ? 500 : 200,
        json: query === "earlier" && staleOutcome === "error"
          ? { error: "Old query failed" }
          : { results: [{ slug: `fixture/${query}`, title: `${query} result`, excerpt: `${query} response marker` }] },
      });
    });

    try {
      await page.goto("/search?q=earlier&tab=text", { waitUntil: "domcontentloaded" });
      await expect.poll(() => oldRequestStarted).toBe(true);
      const input = page.getByTestId("search-form-input");
      await input.fill("current");
      await input.press("Enter");
      await expect(page.getByText("current response marker")).toBeVisible();

      releaseOldRequest();
      await expect.poll(() => page.evaluate(() =>
        window.__WIKI_VITE_OBSERVABILITY__?.search.filter((metric) => metric.mode === "text" && metric.query === "earlier").length,
      )).toBe(phase === "exhaustive" ? 2 : 1);
      // Give React the completed old request's update before inspecting the UI.
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(input).toHaveValue("current");
      await expect(page.getByText("current response marker")).toBeVisible();
      await expect(page.getByText("earlier response marker")).toHaveCount(0);
      await expect(page.getByText("Old query failed", { exact: false })).toHaveCount(0);
    } finally {
      releaseOldRequest();
    }
  });
}
