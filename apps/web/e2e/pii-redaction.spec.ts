import crypto from "node:crypto";
import JSZip from "jszip";
import { test, expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { cleanupSiteUsers } from "./helpers";
import { mockAISearch } from "./ai-search-mock";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
const RUN_NONCE = `${Date.now().toString(36)}${crypto
  .randomBytes(2)
  .toString("hex")}`;
const ADMIN_REDACTION_SITE_SLUG = `pii-admin-${RUN_NONCE}`;
const ADMIN_REDACTION_SITE_HOST = `${ADMIN_REDACTION_SITE_SLUG}.localhost`;
const ADMIN_REDACTION_OWNER_EMAIL = `owner-${RUN_NONCE}@example.test`;
const ACCOUNT_PASSWORD = "correct horse battery";
const GATE_PASSWORD = "redaction-gate";
const ADMIN_REDACTION_SLUG = `wiki/admin-redaction-${RUN_NONCE}`;
const ADMIN_REDACTION_TITLE = "Admin Redaction Fixture";
const ADMIN_ONLY_MARKER = `Admin-only hidden marker ${RUN_NONCE}`;
const diagnosisPath = "/wiki/diagnostics/diagnosis";
const aboutPath = "/about/About";
const hiddenPatientName = "Diana Laster";
const hiddenMrn = "88855655";
const redactedBanner = "Patient identifiers hidden.";
const isProdRun = process.env.TEST_ENV === "prod";

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

function tokenHash() {
  const token = `wpt_${crypto.randomBytes(24).toString("base64url")}`;
  return `sha256:${crypto.createHash("sha256").update(token).digest("hex")}`;
}

function passwordHash(password: string) {
  return `sha256:${crypto.createHash("sha256").update(password).digest("hex")}`;
}

function siteBaseURL(baseURL: string) {
  const url = new URL(baseURL);
  url.hostname = ADMIN_REDACTION_SITE_HOST;
  return url.toString().replace(/\/$/, "");
}

test.describe("PII redaction", () => {
  test("redacts server-rendered diagnosis identifiers by default", async ({
    page,
  }) => {
    test.skip(
      isProdRun,
      "Prod stress targets deployed content; server redaction is covered outside repeated live-site runs."
    );

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

  test("showPII does not reveal identifiers without an admin account", async ({
    page,
  }) => {
    // The reveal route is only allowed to swap in raw content after an
    // account-admin check. Shared/password readers stay redacted.
    await page.goto(`${diagnosisPath}?showPII=1`);
    const article = page.getByRole("article");

    await expect(page.getByRole("heading", { name: "Diagnosis" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(article.getByText(hiddenPatientName)).toHaveCount(0);
    await expect(article.getByText(hiddenMrn)).toHaveCount(0);
  });

  test("pii-view route requires an admin account", async ({ page }) => {
    await page.goto(`/pii-view${diagnosisPath}`);

    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "This page could not be found." }),
    ).toBeVisible();
    await expect(page.getByText(hiddenPatientName)).toHaveCount(0);
    await expect(page.getByText(hiddenMrn)).toHaveCount(0);
  });

  test("admin account page renders raw redact block content", async ({
    baseURL,
    browser,
  }) => {
    test.skip(
      !CONVEX_URL,
      "Admin redaction reveal test requires NEXT_PUBLIC_CONVEX_URL for the same Convex deployment as the target app.",
    );

    const convex = new ConvexHttpClient(CONVEX_URL!);
    const url = siteBaseURL(baseURL ?? "http://localhost:3000");
    const redactedContent = `Before\n\nPrivate block hidden.\n\nAfter`;
    const rawContent = `Before\n\n:::redact[Private block hidden.]\n${ADMIN_ONLY_MARKER}\n:::\n\nAfter`;

    await convex.mutation(api.sites.create, {
      slug: ADMIN_REDACTION_SITE_SLUG,
      name: `${ADMIN_REDACTION_SITE_SLUG} (test)`,
      ownerEmail: ADMIN_REDACTION_OWNER_EMAIL,
      domain: ADMIN_REDACTION_SITE_HOST,
      publishTokenHash: tokenHash(),
      passwordHash: passwordHash(GATE_PASSWORD),
    });

    await convex.mutation(api.documents.upsert, {
      siteSlug: ADMIN_REDACTION_SITE_SLUG,
      slug: ADMIN_REDACTION_SLUG,
      title: ADMIN_REDACTION_TITLE,
      content: redactedContent,
      rawContent,
      tags: ["pii-admin-test"],
      contentHash: `${RUN_NONCE}-admin-redaction`,
      sensitive: false,
    });

    try {
      const readerContext = await browser.newContext({
        baseURL: url,
        storageState: { cookies: [], origins: [] },
      });
      const readerPage = await readerContext.newPage();
      await readerPage.goto(`/?token=${encodeURIComponent(GATE_PASSWORD)}`);
      await readerPage.goto(`/${ADMIN_REDACTION_SLUG}`);
      await expect(readerPage.getByRole("heading", { name: ADMIN_REDACTION_TITLE }))
        .toBeVisible();
      await expect(readerPage.getByText("Private block hidden.")).toBeVisible();
      await expect(readerPage.getByText(ADMIN_ONLY_MARKER)).toHaveCount(0);
      await readerContext.close();

      const adminContext = await browser.newContext({
        baseURL: url,
        storageState: { cookies: [], origins: [] },
      });
      const adminPage = await adminContext.newPage();
      await adminPage.goto(`/?token=${encodeURIComponent(GATE_PASSWORD)}`);
      const signup = await adminContext.request.post("/api/auth/signup", {
        data: {
          email: ADMIN_REDACTION_OWNER_EMAIL,
          password: ACCOUNT_PASSWORD,
          name: "Owner User",
        },
      });
      expect(signup.ok(), await signup.text()).toBeTruthy();

      await adminPage.goto(`/${ADMIN_REDACTION_SLUG}`);
      await expect(adminPage.getByRole("heading", { name: ADMIN_REDACTION_TITLE }))
        .toBeVisible();
      await expect(adminPage.getByText(ADMIN_ONLY_MARKER)).toBeVisible();
      await expect(adminPage.getByText("Private block hidden.")).toHaveCount(0);
      await adminContext.close();
    } finally {
      await cleanupSiteUsers(convex, ADMIN_REDACTION_SITE_SLUG).catch(() => {});
      await convex.mutation(api.sites.archive, {
        slug: ADMIN_REDACTION_SITE_SLUG,
      }).catch(() => {});
    }
  });

  test("redacts inline patient references on the about page", async ({
    page,
  }) => {
    test.skip(
      process.env.TEST_ENV === "prod",
      "Remote prod about-page streaming can exceed the stress-test timeout."
    );
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
    test.skip(
      process.env.TEST_ENV === "prod",
      "Remote prod text search can exceed the stress-test timeout before the current branch is deployed."
    );
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
