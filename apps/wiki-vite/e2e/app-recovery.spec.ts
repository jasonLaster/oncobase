import { expect, test } from "@playwright/test";
import { installWikiApiMocks } from "./fixtures";

test.describe("app recovery boundary", () => {
  test("shows a recovery screen instead of a blank root when the shell fails to load", async ({
    page,
  }) => {
    await installWikiApiMocks(page);

    // Simulate a returning visitor whose persisted store/chunk can no longer be
    // loaded: fail the lazy LiveStore shell import. Without an error boundary
    // this leaves an empty #root; with one it surfaces a recovery screen.
    await page.route(/LiveStoreRoot/, (route) => route.abort());

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const recovery = page.getByTestId("app-recovery");
    await expect(recovery).toBeVisible();
    await expect(recovery).toContainText("This reader hit a snag");
    await expect(page.getByTestId("app-recovery-reset")).toBeVisible();

    const rootHtml = await page.locator("#root").innerHTML();
    expect(rootHtml.length).toBeGreaterThan(0);
  });
});
