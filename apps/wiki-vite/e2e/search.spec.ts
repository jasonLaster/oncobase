import { expect, test } from "@playwright/test";
import { gotoWiki, installWikiApiMocks, waitForPageTitle } from "./fixtures";

test.describe("Local page finder", () => {
  test("finder from the header navigates to a cached page", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/");

    await page.getByTestId("header-search-input").fill("diagnosis");
    await page.getByRole("link", { name: /Diagnosis/ }).click();

    await expect(page).toHaveURL(/\/wiki\/diagnostics\/diagnosis$/);
    await waitForPageTitle(page, "Diagnosis");
  });

  test("empty local finder shows no results message", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/");

    await page.getByTestId("header-search-input").fill("zzzznonexistentquery999");

    await expect(page.getByText("No local matches")).toBeVisible();
  });

  test("public finder does not include sensitive pages", async ({ page }) => {
    await installWikiApiMocks(page, { sessionAuthenticated: true });
    await gotoWiki(page, "/");

    await page.getByTestId("header-search-input").fill("private plan");

    await expect(page.getByText("No local matches")).toBeVisible();
  });

  test("session finder can include sensitive pages in its separate store", async ({ page }) => {
    await installWikiApiMocks(page, { sessionAuthenticated: true });
    await gotoWiki(page, "/?scope=session");

    await page.getByTestId("header-search-input").fill("private plan");
    await page.getByRole("link", { name: /Private Plan/ }).click();

    await expect(page).toHaveURL(/\/private\/plan$/);
    await waitForPageTitle(page, "Private Plan");
    await expect(page.locator(".badge.sensitive")).toHaveText("sensitive");
  });

  test("header exposes backend search and chat handoffs", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/");

    await expect(page.getByRole("link", { name: "Search" })).toHaveAttribute("href", /\/search$/);
    await expect(page.getByRole("link", { name: "New Chat" })).toHaveAttribute("href", /\/chat$/);
  });

  test.skip("backend text search returns relevant results", async () => {
    // Canonical text search remains a backend/full-stack feature for v1.
    // The Vite reader may link to or call that backend route later, but it
    // should not rebuild full-text search from the local markdown cache.
  });

  test.skip("AI mode shows ranked results", async () => {
    // AI search remains a backend/full-stack feature for v1.
  });

  test.skip("AI mode results link to wiki pages", async () => {
    // AI search remains a backend/full-stack feature for v1.
  });

  test.skip("AI mode shows error states", async () => {
    // AI search remains a backend/full-stack feature for v1.
  });
});
