import { test, expect, openReader, signIn, checkpoint } from "./fixtures";

// Identical public HTTP boundaries on both hosts. This proves frontend states,
// never Liveblocks persistence or account authorization.
test.beforeEach(async ({ page }) => {
  for (const [path, body] of [
    ["auth/session", { user: null }],
    ["liveblocks-auth", { configured: true, siteSlug: "diana" }],
    ["liveblocks-users", { users: {} }],
    ["liveblocks-guest", { ok: true }],
    ["liveblocks-threads**", { threads: [], userNames: {} }],
  ] as const) {
    await page.route(`**/api/${path}`, (route) => route.fulfill({
      status: path === "liveblocks-auth" && route.request().method() === "POST" ? 401 : 200,
      json: body,
    }));
  }
});

for (const width of [393, 1440]) {
  test(`document comments and account sign-in at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await openReader(page);
    await (width < 768 ? page.getByTestId("mobile-header-comments") : page.getByRole("button", { name: "Open comments", exact: true })).click();
    await expect(page.getByText("Sign in to leave a comment").filter({ visible: true })).toBeVisible();
    if (width < 768) {
      await expect(page.getByTestId("mobile-comments-panel").filter({ visible: true })).toBeInViewport();
      await expect(page.getByText("Sign in to leave a comment").filter({ visible: true })).toBeInViewport();
    }
    await checkpoint(page, info, "signed-out-comments");
    await page.getByTestId("comments-sign-in-state").filter({ visible: true }).getByRole("button", { name: "Sign in", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Sign in" });
    await expect(dialog.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Email", { exact: true })).toBeFocused();
    for (let index = 0; index < 8; index++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
    await checkpoint(page, info, "account-dialog");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
  test(`global comments empty and filter states at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await signIn(page);
    await page.goto("/comments");
    await expect(page.getByRole("button", { name: "View all comments" })).toBeVisible();
    await expect(page.getByText("No open comments")).toBeVisible();
    await checkpoint(page, info, "open-comments-empty");
    await page.getByRole("button", { name: "View all comments" }).click();
    await expect(page.getByRole("button", { name: "Open only" })).toBeVisible();
    await checkpoint(page, info, "all-comments-empty");
  });
}
