import { expect, test, type Page } from "@playwright/test";
import { article, CARE, passGate, READER, requireLocalStack } from "./helpers";

// Real backend, no route mocks: runs against `bun run local:stack`, which seeds
// a care-team user (sees `private/`) and a reader with no role.
const PRIVATE_PAGE = "/private/care-team-notes";
const PRIVATE_MARKER = "Next oncology visit";

requireLocalStack();

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto("/?reader-action=signin");
  const dialog = page.getByRole("dialog", { name: "Sign in", exact: true });
  await dialog.getByLabel("Email", { exact: true }).fill(user.email);
  await dialog.getByLabel("Password", { exact: true }).fill(user.password);
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Workspace menu" }).click();
  // Wait for the request: navigating first aborts it and leaves the session alive.
  const done = page.waitForResponse((r) => r.url().includes("/api/auth/signout"));
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  expect((await done).ok(), "sign-out request").toBeTruthy();
  // The app reloads itself after sign-out; let it settle before navigating.
  await expect(page.getByTestId("sidebar-sign-in").filter({ visible: true })).toBeVisible();
}

/** The reader's own "not available" state, so absence is never a blank page. */
const unavailable = (page: Page) => page.locator('[data-reader-unavailable="true"]').filter({ visible: true });

test.describe("account access (real backend)", () => {
  test.beforeEach(async ({ page }) => passGate(page));

  test("a signed-out reader gets a sign-in path, not the sensitive page", async ({ page }) => {
    await page.goto(PRIVATE_PAGE);
    await expect(unavailable(page)).toBeVisible();
    await expect(unavailable(page).getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(page.getByText(PRIVATE_MARKER)).toHaveCount(0);
  });

  test("a signed-in reader without a role still cannot read it", async ({ page }) => {
    await signIn(page, READER);
    await page.goto(PRIVATE_PAGE);
    await expect(unavailable(page)).toBeVisible();
    await expect(unavailable(page).getByRole("link", { name: "Sign in" })).toHaveCount(0);
    await expect(page.getByText(PRIVATE_MARKER)).toHaveCount(0);
  });

  test("a care-team reader reads it, keeps it across reload, and loses it on sign-out", async ({ page }) => {
    await signIn(page, CARE);
    await page.goto(PRIVATE_PAGE);
    await expect(article(page)).toContainText(PRIVATE_MARKER);

    await page.reload();
    await expect(article(page)).toContainText(PRIVATE_MARKER);

    await signOut(page);
    await page.goto(PRIVATE_PAGE);
    await expect(unavailable(page)).toBeVisible();
    await expect(page.getByText(PRIVATE_MARKER)).toHaveCount(0);
    await page.goBack();
    await expect(page.getByText(PRIVATE_MARKER)).toHaveCount(0);
  });

  test("switching accounts never shows the previous account's private content", async ({ page }) => {
    await signIn(page, CARE);
    await page.goto(PRIVATE_PAGE);
    await expect(article(page)).toContainText(PRIVATE_MARKER);
    await signOut(page);
    await signIn(page, READER);
    await page.goto(PRIVATE_PAGE);
    await expect(unavailable(page)).toBeVisible();
    await expect(page.getByText(PRIVATE_MARKER)).toHaveCount(0);
  });

  test("text search finds the private page for the care team and hides it from a reader without a role", async ({ page }) => {
    const search = async () => {
      await page.goto("/search?q=oncology+visit");
      await page.getByRole("button", { name: "Text Search" }).click();
      await expect(page.getByTestId("search-text-summary").or(page.getByTestId("search-text-empty"))).toBeVisible();
    };

    await signIn(page, CARE);
    await search();
    await expect(page.getByTestId("search-text-file").filter({ hasText: /care-team-notes/ })).toBeVisible();
    await signOut(page);

    await signIn(page, READER);
    await search();
    await expect(page.getByText(/care-team-notes/)).toHaveCount(0);
  });
});
