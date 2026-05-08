import { expect, type Page } from "@playwright/test";

export const mockAIResults = {
  results: [
    {
      slug: "wiki/treatment/keynote-522",
      title: "KEYNOTE-522 Protocol",
      tags: ["treatment", "immunotherapy"],
      relevance: 9,
      summary: "Core treatment protocol for this TNBC case.",
    },
    {
      slug: "wiki/diagnostics/diagnosis",
      title: "Diagnosis Overview",
      tags: ["diagnostics"],
      relevance: 7,
      summary: "Initial diagnosis and staging details.",
    },
  ],
};

type MockAISearchOptions = {
  body?: Record<string, unknown> | string;
  contentType?: string;
  status?: number;
};

export async function mockAISearch(
  page: Page,
  {
    body = mockAIResults,
    contentType = "application/json",
    status = 200,
  }: MockAISearchOptions = {}
) {
  let calls = 0;

  await page.route("**/api/ai-search", (route) => {
    calls += 1;
    return route.fulfill({
      headers: { "cache-control": "no-store" },
      status,
      contentType,
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  });

  return {
    async waitForRequest() {
      await expect
        .poll(() => calls, { timeout: 60_000 })
        .toBeGreaterThan(0);
    },
  };
}
