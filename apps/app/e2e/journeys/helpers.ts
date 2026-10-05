import { expect, test, type Page } from "@playwright/test";

/** Local-stack journeys: real backend, no route mocks. */
export const requireLocalStack = () =>
  test.skip(!process.env.NEXT_PUBLIC_CONVEX_URL, "Requires the local stack: bun run local:stack exec -- bunx playwright test e2e/journeys");

export const GATE_PASSWORD = "diana";
export const CARE = { email: "care@local.test", password: "local-care-password" };
export const READER = { email: "reader@local.test", password: "local-reader-password" };

export const article = (page: Page) => page.locator("article").filter({ visible: true }).first();

export async function passGate(page: Page) {
  const response = await page.request.post("/api/login", { data: { password: GATE_PASSWORD } });
  expect(response.ok(), "site password gate").toBeTruthy();
}

/** Opens a page and waits until the reader has rendered its document (the article is named by the page title). */
export async function openPage(page: Page, path: string, title?: string) {
  await page.goto(path);
  await expect(article(page)).toBeVisible();
  if (title) await expect(article(page)).toHaveAccessibleName(title);
}

export const modKey = process.platform === "darwin" ? "Meta" : "Control";
