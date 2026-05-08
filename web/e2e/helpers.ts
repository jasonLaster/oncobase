import { expect, type Locator, type Page } from "@playwright/test";

export function nextErrorOverlay(page: Page) {
  return page.locator(
    "[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay"
  );
}

export function appHeader(page: Page) {
  return page.getByTestId("app-header");
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
        await page.getByTestId("header-command-palette").click();
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
