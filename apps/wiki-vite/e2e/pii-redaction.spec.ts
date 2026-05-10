import { expect, test } from "@playwright/test";
import { documentArticle, gotoWiki, installWikiApiMocks } from "./fixtures";

const RAW_IDENTIFIERS = /Diana Laster|88855655|jason\.laster\.11@gmail\.com/i;

test.describe("P0 PII parity", () => {
  test("redacts rendered diagnosis identifiers by default", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/wiki/diagnostics/diagnosis");

    await expect(documentArticle(page)).toContainText("the patient");
    await expect(documentArticle(page)).toContainText("[redacted MRN]");
    await expect(documentArticle(page)).not.toContainText(RAW_IDENTIFIERS);
  });

  test("showPII does not reveal identifiers because content is redacted at the API boundary", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/wiki/diagnostics/diagnosis?showPII=1");

    await expect(documentArticle(page)).not.toContainText(RAW_IDENTIFIERS);
    await expect(documentArticle(page)).toContainText("[redacted MRN]");
  });

  test("redacts inline patient references on the about page", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/about/About");

    await expect(documentArticle(page)).toContainText("the patient");
    await expect(documentArticle(page)).not.toContainText(RAW_IDENTIFIERS);
  });

  test("text search excludes redacted identifiers", async ({ page }) => {
    await installWikiApiMocks(page);
    await page.route("**/api/search**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              slug: "wiki/diagnostics/diagnosis",
              title: "Diagnosis",
              excerpt: "the patient has MRN [redacted MRN]",
              tags: ["diagnostics"],
            },
          ],
        }),
      });
    });

    await page.goto("/search?q=Diana%20Laster", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("search-results")).toContainText("[redacted MRN]");
    await expect(page.getByTestId("search-results")).not.toContainText(RAW_IDENTIFIERS);
  });

  test("AI search summaries and chat tool citations exclude redacted identifiers", async ({ page }) => {
    await installWikiApiMocks(page);
    await page.route("**/api/search**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              slug: "wiki/diagnostics/diagnosis",
              title: "Diagnosis",
              excerpt: "the patient diagnosis note",
              tags: ["diagnostics"],
            },
          ],
        }),
      });
    });
    await page.route("**/api/ai-search", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              slug: "wiki/diagnostics/diagnosis",
              title: "Diagnosis",
              tags: ["diagnostics"],
              relevance: 9,
              summary: "the patient diagnosis note references [redacted MRN].",
            },
          ],
        }),
      });
    });
    await page.route("**/api/tools", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          slug: "wiki/diagnostics/diagnosis",
          title: "Diagnosis",
          content: "the patient has MRN [redacted MRN]",
          linked_pages: [],
        }),
      });
    });

    await page.goto("/search?q=diagnosis&mode=ai", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("search-results")).toContainText("[redacted MRN]");
    await expect(page.getByTestId("search-results")).not.toContainText(RAW_IDENTIFIERS);

    const toolResponse = await page.evaluate(async () => {
      const response = await fetch("/api/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "read_page", args: { slug: "wiki/diagnostics/diagnosis" } }),
      });
      return response.text();
    });
    expect(toolResponse).toContain("[redacted MRN]");
    expect(toolResponse).not.toMatch(RAW_IDENTIFIERS);
  });

  test("markdown downloads stay redacted even when showPII is requested", async ({ page }) => {
    await installWikiApiMocks(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const pageCopy = await page.evaluate(async () => {
      const response = await fetch("/api/page-copy?slug=wiki/diagnostics/diagnosis&showPII=1");
      return response.text();
    });
    expect(pageCopy).toContain("[redacted MRN]");
    expect(pageCopy).not.toMatch(RAW_IDENTIFIERS);

    const fullDownload = await page.evaluate(async () => {
      const response = await fetch("/api/download?type=full&showPII=1");
      return response.text();
    });
    expect(fullDownload).toContain("[redacted MRN]");
    expect(fullDownload).not.toMatch(RAW_IDENTIFIERS);
  });
});
