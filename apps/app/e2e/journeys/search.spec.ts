import { expect, test, type Page, type Request } from "@playwright/test";
import { documentArticle, gotoWiki, installWikiApiMocks, waitForPageTitle } from "../fixtures";

/** Mocked search failure injection and ordering; real-backend text search lives in find.spec.ts. */

const SEARCH_QUERY = "diagnosis";

const mockAIResults = {
  results: [
    {
      slug: "wiki/diagnostics/diagnosis",
      title: "Diagnosis Overview",
      tags: ["diagnostics"],
      relevance: 9,
      summary: "Initial diagnosis and staging details match this query.",
    },
    {
      slug: "wiki/logistics/insurance",
      title: "Insurance",
      tags: ["logistics", "coverage"],
      relevance: 7,
      summary: "Coverage notes are indirectly relevant to diagnosis logistics.",
    },
  ],
};

type MockSearchOptions = {
  body?: Record<string, unknown> | string;
  contentType?: string;
  status?: number;
};

async function mockTextSearch(page: Page, { body, contentType = "application/json", status = 200 }: MockSearchOptions = {}) {
  const requests: Request[] = [];
  await page.route("**/api/search?**", (route) => {
    requests.push(route.request());
    return route.fulfill({
      body: typeof body === "string" ? body : JSON.stringify(body ?? { results: [] }),
      contentType,
      status,
    });
  });
  return {
    requests,
    waitForRequest: () => expect.poll(() => requests.length, { timeout: 60_000 }).toBeGreaterThan(0),
  };
}

async function mockAISearch(page: Page, { body = mockAIResults, contentType = "application/json", status = 200 }: MockSearchOptions = {}) {
  const requests: Request[] = [];
  await page.route("**/api/ai-search**", (route) => {
    requests.push(route.request());
    return route.fulfill({
      body: typeof body === "string" ? body : JSON.stringify(body),
      contentType,
      headers: { "cache-control": "no-store" },
      status,
    });
  });
  return {
    requests,
    waitForRequest: () => expect.poll(() => requests.length, { timeout: 60_000 }).toBeGreaterThan(0),
  };
}

test.describe("search (mocked backend)", () => {
  for (const [phase, staleOutcome] of [
    ["initial", "results"],
    ["exhaustive", "error"],
  ] as const) {
    test(`a late ${phase} text-search ${staleOutcome} cannot replace the current query`, async ({ page }) => {
      await installWikiApiMocks(page);
      await page.route("**/api/ai-search**", (route) => route.fulfill({ json: { results: [] } }));
      let releaseOldRequest!: () => void;
      const oldRequest = new Promise<void>((resolve) => {
        releaseOldRequest = resolve;
      });
      let oldRequestStarted = false;
      let oldRequestAborted = false;
      let earlierRequests = 0;
      page.on("requestfailed", (request) => {
        if (new URL(request.url()).searchParams.get("q") === "earlier") oldRequestAborted = true;
      });
      await page.route("**/api/search?**", async (route) => {
        const query = new URL(route.request().url()).searchParams.get("q");
        if (query === "earlier") {
          earlierRequests += 1;
          if (phase === "exhaustive" && earlierRequests === 1) {
            await route.fulfill({
              json: {
                complete: false,
                retryAfterMs: 1000,
                results: [{ slug: "fixture/earlier", title: "Earlier indexed match", excerpt: "earlier indexed marker" }],
              },
            });
            return;
          }
          oldRequestStarted = true;
          await oldRequest;
          // The reader aborts a superseded query; answering it must not matter.
          if (oldRequestAborted) return route.fulfill({ status: 204 }).catch(() => undefined);
        }
        await route.fulfill({
          status: query === "earlier" && staleOutcome === "error" ? 500 : 200,
          json:
            query === "earlier" && staleOutcome === "error"
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

        await expect.poll(() => oldRequestAborted).toBe(true);
        releaseOldRequest();
        // Give React the completed old request's update before inspecting the UI.
        await page.evaluate(
          () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
        );
        await expect(input).toHaveValue("current");
        await expect(page.getByText("current response marker")).toBeVisible();
        await expect(page.getByText("earlier response marker")).toHaveCount(0);
        await expect(page.getByText("Old query failed", { exact: false })).toHaveCount(0);
      } finally {
        releaseOldRequest();
      }
    });
  }

  test("text search keeps retrying, a bounded number of times, while results stay incomplete", async ({ page }) => {
    let requests = 0;
    let completeAfter = Number.POSITIVE_INFINITY;
    await page.route("**/api/search?**", (route) => {
      requests += 1;
      const complete = requests > completeAfter;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          complete
            ? { results: [{ slug: "wiki/diagnostics/diagnosis", title: "Diagnosis", matches: [{ lineContent: "diagnosis exact line", lineNumber: 7 }] }] }
            : { complete: false, retryAfterMs: 1_000, results: [{ slug: "wiki/diagnostics/diagnosis", title: "Diagnosis", excerpt: "diagnosis indexed result" }] },
        ),
      });
    });
    await mockAISearch(page);
    await installWikiApiMocks(page);

    // A retry that is itself incomplete schedules another one.
    completeAfter = 2;
    await page.goto("/search?q=diagnosis&tab=text", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("search-text-summary")).toContainText("1 result in 1 file", { timeout: 10_000 });
    await expect(page.getByTestId("search-text-summary")).not.toContainText("full results loading");
    expect(requests).toBe(3);

    // A query that never completes stops after three retries, keeping its
    // indexed results without promising more.
    requests = 0;
    completeAfter = Number.POSITIVE_INFINITY;
    await page.goto("/search?q=diagnoses&tab=text", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("diagnosis indexed result")).toBeVisible();
    await expect.poll(() => requests, { timeout: 10_000 }).toBe(4);
    await expect(page.getByTestId("search-text-summary")).not.toContainText("full results loading");
    await page.waitForTimeout(1_500);
    expect(requests).toBe(4);
  });

  test("AI mode ranks results with scores, tags and page links, and shows an empty state", async ({ page }) => {
    await mockTextSearch(page);
    const ai = await mockAISearch(page);
    await installWikiApiMocks(page);
    await page.goto(`/search?q=${encodeURIComponent("mock ai ranked results")}`, { waitUntil: "domcontentloaded" });

    await ai.waitForRequest();
    await expect(page.getByTestId("search-tab-ai")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("search-ai-summary")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("search-ai-result").first()).toContainText("9/10");
    await expect(page.getByText("7/10").first()).toBeVisible();
    await expect(page.getByText("diagnostics").first()).toBeVisible();
    await expect(
      page.getByTestId("search-ai-result").and(page.locator("a[href='/wiki/diagnostics/diagnosis']")).first(),
    ).toBeVisible();

    await page.unroute("**/api/ai-search**");
    await mockAISearch(page, { body: { results: [] } });
    await page.goto("/search?q=zzzznonexistentquery999", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("search-ai-empty")).toBeVisible({ timeout: 10_000 });
  });

  test("AI mode shows a readable error for API and non-JSON failures", async ({ page }) => {
    await mockTextSearch(page);
    await installWikiApiMocks(page);
    await mockAISearch(page, { body: { results: [], error: "API key limit reached." }, status: 402 });
    await page.goto("/search?q=mock+ai+error+response", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("search-ai-error")).toContainText("API key limit reached.", { timeout: 15_000 });

    await page.unroute("**/api/ai-search**");
    await mockAISearch(page, {
      body: "<html><body>Internal Server Error</body></html>",
      contentType: "text/html",
      status: 500,
    });
    await page.goto("/search?q=mock+ai+html+failure", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("search-ai-error")).toContainText("Search failed with 500 Internal Server Error.", {
      timeout: 15_000,
    });
  });

  test("scope: public finder excludes sensitive pages, session finder includes them, and requests carry the scope", async ({
    baseURL,
    browserName,
    context,
    page,
  }) => {
    await installWikiApiMocks(page, { sessionAuthenticated: true });
    await gotoWiki(page, "/?scope=public");
    await page.getByTestId("sidebar-search").click();
    await page.getByTestId("command-palette-input").fill("private plan");
    await expect(page.getByText("No pages found.")).toBeVisible();

    await gotoWiki(page, "/?scope=session");
    await page.getByTestId("sidebar-search").click();
    await page.getByTestId("command-palette-input").fill("private plan");
    await page.getByRole("option", { name: "plan private" }).click();
    await expect(page).toHaveURL(/\/private\/plan$/);
    await waitForPageTitle(page, "Private Plan");
    await expect(documentArticle(page)).toContainText("Sensitive session-only planning note");

    await context.addCookies([{ name: "wiki_user_session", value: "valid-e2e-session", url: baseURL! }]);
    const text = await mockTextSearch(page, {
      body: { results: [{ slug: "wiki/diagnostics/diagnosis", title: "Diagnosis", excerpt: "diagnosis notes" }] },
    });
    const ai = await mockAISearch(page);
    for (const scope of ["public", "session"] as const) {
      text.requests.length = 0;
      ai.requests.length = 0;
      await page.goto(`/search?q=${SEARCH_QUERY}&scope=${scope}`, { waitUntil: "domcontentloaded" });
      await Promise.all([text.waitForRequest(), ai.waitForRequest()]);
      for (const apiRequest of [text.requests.at(-1)!, ai.requests.at(-1)!]) {
        expect(new URL(apiRequest.url()).searchParams.get("scope")).toBe(scope);
        // WebKit's fulfilled interceptions omit Cookie even in allHeaders().
        if (browserName !== "webkit") {
          expect((await apiRequest.allHeaders()).cookie).toContain("wiki_user_session=valid-e2e-session");
        }
      }
    }
  });

  test("text mode renders markdown snippets, and groups line matches with counts, highlights and source links", async ({ page }) => {
    await mockTextSearch(page, {
      body: {
        results: [
          {
            slug: "wiki/diagnostics/diagnosis",
            title: "Diagnosis",
            excerpt: "### Diagnosis context\n\n**diagnosis and staging** happened in [the diagnosis note](/wiki/diagnostics/diagnosis).",
            tags: ["diagnostics"],
          },
        ],
      },
    });
    await mockAISearch(page);
    await installWikiApiMocks(page);
    await page.goto("/search?q=diagnosis&tab=text", { waitUntil: "domcontentloaded" });
    const snippet = page.getByTestId("search-text-result").first();
    await expect(snippet).toContainText("Diagnosis context");
    await expect(snippet).toContainText("diagnosis and staging");
    await expect(snippet).not.toContainText("###");
    await expect(snippet).not.toContainText("**");
    await expect(snippet).not.toContainText("](");

    await page.unroute("**/api/search?**");
    await mockTextSearch(page, {
      body: {
        results: [
          {
            slug: "about/log/april",
            title: "April log",
            matches: [
              { lineNumber: 4, lineContent: "The first diagnosis update.", matchStart: 10, matchEnd: 19 },
              { lineNumber: 12, lineContent: "**Diagnosis** planning continued.", matchStart: 2, matchEnd: 11 },
            ],
          },
          {
            slug: "wiki/diagnostics/diagnosis",
            title: "Diagnosis",
            matches: [{ lineNumber: 7, lineContent: "Diagnosis and staging details.", matchStart: 0, matchEnd: 9 }],
          },
        ],
      },
    });
    await page.goto("/search?q=diagnosis&tab=text", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("search-text-summary")).toHaveText("3 results in 2 files");
    await expect(page.getByTestId("search-text-directory").filter({ hasText: "about" })).toContainText("2");
    await expect(page.locator("mark")).toHaveCount(3);
    const aprilFile = page.getByTestId("search-text-file").filter({ hasText: "april" });
    await aprilFile.click();
    await expect(page.getByTestId("search-text-result")).toHaveCount(1);
    await aprilFile.click();
    await expect(page.getByTestId("search-text-result")).toHaveCount(3);
    await page.getByTestId("search-text-result").filter({ hasText: "Diagnosis and staging details." }).click();
    await expect(page).toHaveURL(/\/wiki\/diagnostics\/diagnosis$/);
    await waitForPageTitle(page, "Diagnosis");
  });
});
