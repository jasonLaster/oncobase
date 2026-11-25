import { expect, test } from "@playwright/test";
import { gotoWiki, installWikiApiMocks } from "./fixtures";

const slug = "wiki/logistics/insurance";
const history = {
  slug,
  sensitive: false,
  current: { title: "Insurance", updatedAt: Date.UTC(2026, 10, 20, 15) },
  versions: [
    { id: "v2", title: "Insurance", versionAt: Date.UTC(2026, 9, 2, 15), source: "publish", size: 40 },
    { id: "v1", title: "Insurance notes", versionAt: Date.UTC(2026, 6, 1, 15), source: "git", commitSha: "a".repeat(40), commitMessage: "First draft", size: 30 },
  ],
};

test("the history menu lists past versions and opens one in place of the live page", async ({ page }) => {
  await installWikiApiMocks(page);
  const requests: string[] = [];
  await page.route("**/api/page-versions**", route => {
    const url = new URL(route.request().url());
    requests.push(url.search);
    expect(url.searchParams.get("slug")).toBe(slug);
    const id = url.searchParams.get("id");
    if (!id) return route.fulfill({ json: history });
    if (id === "v1") return route.fulfill({ json: { ...history.versions[1], slug, tags: [], content: "Synthetic first draft body.\n\n## Old section\n\nRemoved later." } });
    return route.fulfill({ status: 404, json: { error: "Not found" } });
  });

  await gotoWiki(page, `/${slug}`);
  // Nothing is fetched until the reader opens the menu.
  expect(requests).toEqual([]);
  const trigger = page.getByRole("button", { name: "Page history", exact: true });
  await trigger.click();
  const menu = page.getByRole("menu", { name: "Page history" });
  await expect(menu.getByRole("menuitem")).toHaveCount(3);
  await expect(menu.getByTestId("page-history-current")).toContainText("Current version");
  await expect(menu.getByTestId("page-history-version").nth(1)).toContainText("First draft");
  await page.screenshot({ path: ".playwright/page-history/menu.png" });

  await menu.getByTestId("page-history-version").nth(1).click();
  await expect(page).toHaveURL(new RegExp(`/${slug}\\?version=v1$`));
  const banner = page.getByTestId("page-version-banner");
  await expect(banner).toContainText("You are viewing this page as it was on");
  await expect(banner).toContainText("First draft");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Insurance notes");
  await expect(page.getByText("Removed later.")).toBeVisible();
  await page.screenshot({ path: ".playwright/page-history/version.png" });

  // Reloading the version URL shows the same past version.
  await page.reload();
  await expect(page.getByTestId("page-version-banner")).toHaveAttribute("data-version-status", "ready");
  await expect(page.getByText("Removed later.")).toBeVisible();

  await page.getByTestId("page-version-current").click();
  await expect(page).toHaveURL(new RegExp(`/${slug}$`));
  await expect(page.getByTestId("page-version-banner")).toHaveCount(0);
  await expect(page.getByText("Removed later.")).toHaveCount(0);
});

test("an unknown version falls back to the live page with a notice", async ({ page }) => {
  await installWikiApiMocks(page);
  await page.route("**/api/page-versions**", route => route.fulfill({ status: 404, json: { error: "Not found" } }));
  await gotoWiki(page, `/${slug}?version=gone`);
  await expect(page.getByTestId("page-version-banner")).toContainText("not available");
  await page.getByRole("button", { name: "Page history", exact: true }).click();
  await expect(page.getByRole("menu", { name: "Page history" })).toContainText("History unavailable");
});
