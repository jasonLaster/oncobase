import { test, expect, signIn, article, checkpoint } from "./fixtures";
import { TEXT_SEARCH_LATENCY_BUDGET_MS } from "../src/search-performance";

for (const width of [393, 1440]) {
  for (const mode of ["text", "ai"] as const) {
    test(`${mode} search results, URL state and navigation at ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 1000 });
      await signIn(page);
      // Next uses a server action, Vite an API. Text search must use live data
      // on both; an API-only mock does not establish paired search coverage.
      // Success uses the real provider too. Only deliberate empty/error cases
      // below inject responses; those are not persistence/provider evidence.
      await page.goto(`/search?q=insurance&tab=${mode}`);
      const link = page.getByTestId(mode === "ai" ? "search-ai-result" : "search-text-result").first();
      // Use the product's existing exhaustive-search budget on both hosts,
      // rather than the shorter generic UI assertion timeout.
      await expect(link).toBeVisible({ timeout: mode === "text" ? TEXT_SEARCH_LATENCY_BUDGET_MS : 20_000 });
      await expect(link).toContainText(/insurance/i);
      const destination = new URL((await link.getAttribute("href"))!, page.url()).pathname;
      await checkpoint(page, info, "ranked-results");
      await link.click();
      await expect.poll(() => new URL(page.url()).pathname).toBe(destination);
      await expect(article(page).getByRole("heading", { level: 1 })).toBeVisible();
      await page.goBack();
      await expect(link).toBeVisible();
      await expect(page.getByTestId("search-form-input")).toHaveValue("insurance");
      await checkpoint(page, info, "restored-results");
    });

    for (const state of ["empty", "error"] as const) {
      test(`${mode} search ${state} state at ${width}px`, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 1000 });
        await signIn(page);
        await page.route("**/api/ai-search**", (route) => route.fulfill({
          status: state === "error" ? 503 : 200,
          json: state === "error" ? { error: "Parity service unavailable" } : { results: [] },
        }));
        if (mode === "text" && state === "error") {
          // Same failed data boundary, no fabricated server-action wire format.
          await page.route("**/*", async (route) => {
            const request = route.request(), pathname = new URL(request.url()).pathname;
            if (request.resourceType() !== "document" && ["/search", "/api/search"].includes(pathname)) await route.abort("failed");
            else await route.fallback();
          });
        }
        const query = state === "empty" ? "zzzznonexistentquery938719" : "insurance";
        await page.goto(`/search?q=${query}&tab=${mode}`);
        await expect(page.getByText(state === "error" ? /Parity service unavailable|search failed|unable to search|failed to fetch/i : /no .*results|no .*matches/i).first()).toBeVisible();
        await checkpoint(page, info, state);
      });
    }
  }
}

test("text search ignores a late response for the previous query", async ({ page }, info) => {
  await signIn(page);
  let release!: () => void, observed!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const seen = new Promise<void>((resolve) => { observed = resolve; });
  await page.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    const dataRead = request.resourceType() !== "document" && ["/search", "/api/search"].includes(url.pathname);
    if (dataRead && (request.postData() || url.search).includes("germline")) { observed(); await held; }
    await route.fallback();
  });
  try {
    await page.goto("/search?q=germline&tab=text");
    await seen;
    const input = page.getByTestId("search-form-input");
    await input.fill("insurance"); await input.press("Enter");
    const results = page.getByTestId("search-text-result");
    await expect(results.first()).toBeVisible();
    await expect(results.first()).toContainText(/insurance/i);
    // Compare the completed current query, not its provisional first batch.
    await expect(page.getByTestId("search-text-summary")).not.toContainText("full results loading");
    const before = await results.allTextContents();
    const oldResponse = page.waitForResponse((response) => {
      const request = response.request();
      return request.resourceType() !== "document" && (request.postData() || new URL(request.url()).search).includes("germline");
    });
    release();
    await (await oldResponse).finished();
    await expect(results).toHaveText(before);
    await checkpoint(page, info, "latest-query-wins");
  } finally { release(); }
});
