import JSZip from "jszip";
import { test, expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import { mockAISearch } from "./ai-search-mock";

const diagnosisPath = "/wiki/diagnostics/diagnosis";
const aboutPath = "/about/About";
const hiddenPatientName = "Diana Laster";
const hiddenMrn = "88855655";
const redactedBanner = "Patient identifiers hidden.";

function isTransientRequestError(error: unknown) {
  return (
    error instanceof Error &&
    /ECONNRESET|socket hang up|ETIMEDOUT|fetch failed/i.test(error.message)
  );
}

async function getWithTransientRetry(
  request: APIRequestContext,
  url: string,
  attempts = 3
): Promise<APIResponse> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await request.get(url, { timeout: 60_000 });
    } catch (error) {
      if (!isTransientRequestError(error) || attempt === attempts) {
        throw error;
      }

      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }

  throw lastError;
}

test.describe("PII redaction", () => {
  test("redacts server-rendered diagnosis identifiers by default", async ({
    page,
  }) => {
    await page.goto(diagnosisPath);
    const article = page.getByRole("article");

    await expect(page.getByRole("heading", { name: "Diagnosis" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/Patient identifiers hidden\./).first()).toBeVisible();
    await expect(article.getByText(/showPII/i)).toHaveCount(0);
    await expect(article.getByText(hiddenPatientName)).toHaveCount(0);
    await expect(article.getByText(hiddenMrn)).toHaveCount(0);
  });

  test("showPII does not reveal identifiers — content is redacted at publish", async ({
    page,
  }) => {
    // Convex stores only redacted markdown; the publisher never uploads
    // raw PII. Even with `?showPII=1`, the page must stay redacted.
    await page.goto(`${diagnosisPath}?showPII=1`);
    const article = page.getByRole("article");

    await expect(page.getByRole("heading", { name: "Diagnosis" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(article.getByText(hiddenPatientName)).toHaveCount(0);
    await expect(article.getByText(hiddenMrn)).toHaveCount(0);
  });

  test("redacts inline patient references on the about page", async ({
    page,
  }) => {
    await page.goto(aboutPath);
    const article = page.getByRole("article");

    await expect(page.getByRole("heading", { name: "About This Wiki" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      article.getByText(/personal medical knowledge base for managing a patient's/i).first()
    ).toBeVisible();
    await expect(article.getByText("a family member").first()).toBeVisible();
    await expect(article.getByText(hiddenPatientName)).toHaveCount(0);
  });

  test("text search excludes redacted identifiers", async ({ page }) => {
    await mockAISearch(page, { body: { results: [] } });

    for (const query of [hiddenMrn, hiddenPatientName]) {
      await page.goto(`/search?q=${encodeURIComponent(query)}`);

      const textSearchButton = page.getByTestId("search-tab-text");
      await expect(textSearchButton).toBeVisible({ timeout: 10_000 });
      await textSearchButton.click();

      await expect(page.getByTestId("search-text-empty")).toBeVisible({
        timeout: 30_000,
      });
    }
  });

  test("markdown downloads stay redacted even when showPII is requested", async ({
    request,
    baseURL,
  }) => {
    test.slow();

    const response = await getWithTransientRetry(
      request,
      `${baseURL}/api/download?type=markdown&showPII=1&token=diana`
    );

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/zip");

    const zip = await JSZip.loadAsync(await response.body());
    const diagnosis = await zip.file("wiki/diagnostics/diagnosis.md")?.async("string");
    const about = await zip.file("about/About.md")?.async("string");

    expect(diagnosis).toBeTruthy();
    expect(diagnosis).toContain(redactedBanner);
    expect(diagnosis).not.toContain("showPII");
    expect(diagnosis).not.toContain(hiddenPatientName);
    expect(diagnosis).not.toContain(hiddenMrn);
    if (about) {
      expect(about).toContain("a patient's");
      expect(about).not.toContain(hiddenPatientName);
    }
  });
});
