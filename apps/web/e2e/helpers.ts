import { expect, type Locator, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

export function nextErrorOverlay(page: Page) {
  return page.locator(
    "[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay"
  );
}

export function sidebar(page: Page) {
  return page.locator('[data-test-id="sidebar"]:visible').first();
}

export function documentArticle(page: Page) {
  return page.getByTestId("document-article").first();
}

export async function waitForDocumentArticle(page: Page, timeout = 30_000) {
  await page.waitForFunction(
    () =>
      Array.from(
        document.querySelectorAll<HTMLElement>('[data-test-id="document-article"]')
      ).some((article) => {
        const rect = article.getBoundingClientRect();
        const style = window.getComputedStyle(article);
        const textLength = (article.textContent ?? "").replace(/\s+/g, " ").trim().length;
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          textLength > 40
        );
      }),
    { timeout }
  );
  return documentArticle(page);
}

export function chatComposer(page: Page) {
  return page.getByTestId("chat-composer-textarea");
}

export function chatSubmitButton(page: Page) {
  return page.getByTestId("chat-submit-button");
}

export function chatLog(page: Page) {
  return page.getByTestId("chat-message-log");
}

export async function openCommandPalette(page: Page) {
  const dialog = page.locator('[role="dialog"]').first();
  const input = dialog.locator("[data-slot=command-input]");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await input.isVisible().catch(() => false)) break;
    await sidebar(page).getByTestId("sidebar-search").click();
    await input.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
  }

  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(input).toBeEditable({ timeout: 15_000 });
  return input;
}

export async function waitForVisible(locator: Locator, timeout = 15_000) {
  await expect
    .poll(async () => locator.isVisible().catch(() => false), { timeout })
    .toBe(true);
}

export async function cleanupSiteUsers(
  convex: ConvexHttpClient,
  siteSlug: string,
) {
  const users = await convex.query(api.access.listUsersWithRoles, {
    siteSlug,
  });
  const userIds = users.map((user) => user._id);
  if (userIds.length === 0) return;

  await convex.mutation(api.access.deleteUsers, {
    siteSlug,
    userIds,
  });
}
