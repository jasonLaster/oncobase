import { expect, type Locator, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

export function nextErrorOverlay(page: Page) {
  return page.locator(
    "[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay"
  );
}

export function sidebar(page: Page) {
  return page.getByTestId("sidebar");
}

export function documentArticle(page: Page) {
  return page.getByTestId("document-article").first();
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
  const input = page.locator("[data-slot=command-input]");

  await expect
    .poll(
      async () => {
        await page.getByTestId("sidebar-search").click();
        return input.isVisible().catch(() => false);
      },
      { timeout: 15_000 }
    )
    .toBe(true);

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
