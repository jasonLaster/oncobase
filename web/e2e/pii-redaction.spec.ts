import JSZip from "jszip";
import { test, expect, type APIRequestContext, type APIResponse } from "@playwright/test";

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

  test("reveals diagnosis identifiers only when showPII is present", async ({
    page,
  }) => {
    await page.goto(`${diagnosisPath}?showPII=1`);
    const article = page.getByRole("article");

    await expect(
      article.getByText(new RegExp(`Patient:\\s*${hiddenPatientName}`)).first()
    ).toBeVisible({
      timeout: 10_000,
    });
    await expect(article.getByText(new RegExp(`MRN:\\s*${hiddenMrn}`)).first()).toBeVisible();
    await expect(article.getByText(redactedBanner)).toHaveCount(0);
  });

  test("reveals diagnosis identifiers for alternate truthy showPII values", async ({
    page,
  }) => {
    await page.goto(`${diagnosisPath}?showPII=TRUE`);
    const article = page.getByRole("article");

    await expect(
      article.getByText(new RegExp(`Patient:\\s*${hiddenPatientName}`)).first()
    ).toBeVisible({
      timeout: 10_000,
    });
    await expect(article.getByText(new RegExp(`MRN:\\s*${hiddenMrn}`)).first()).toBeVisible();
  });

  test("does not reveal diagnosis identifiers for falsey showPII values", async ({
    page,
  }) => {
    await page.goto(`${diagnosisPath}?showPII=0`);
    const article = page.getByRole("article");

    await expect(page.getByRole("heading", { name: "Diagnosis" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(redactedBanner).first()).toBeVisible();
    await expect(article.getByText(hiddenPatientName)).toHaveCount(0);
    await expect(article.getByText(hiddenMrn)).toHaveCount(0);
  });

  test("preserves reveal mode for markdown suffix requests", async ({
    page,
  }) => {
    await page.goto(`${diagnosisPath}.md?showPII=yes`);
    const article = page.getByRole("article");

    await expect(
      article.getByText(new RegExp(`Patient:\\s*${hiddenPatientName}`)).first()
    ).toBeVisible({
      timeout: 10_000,
    });
    await expect(article.getByText(new RegExp(`MRN:\\s*${hiddenMrn}`)).first()).toBeVisible();
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
    for (const query of [hiddenMrn, hiddenPatientName]) {
      await page.goto(`/search?q=${encodeURIComponent(query)}`);

      const textSearchButton = page.getByRole("button", { name: "Text Search" });
      await expect(textSearchButton).toBeVisible({ timeout: 10_000 });
      await textSearchButton.click();

      await expect(
        page.locator("div").filter({ hasText: /No results for/i }).last()
      ).toBeVisible({
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
