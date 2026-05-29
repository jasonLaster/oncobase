import { expect, test, type Page } from "@playwright/test";

type CompactFileNode =
  | ["d", string, CompactFileNode[], (string | null)?, string?]
  | ["f", string, string?]
  | ["p", string, string?];

const sidebar = "[data-test-id='sidebar-tree']";
const staleTree: CompactFileNode[] = [
  ["d", "cached", [["f", "stale-page"]]],
];
const freshTree: CompactFileNode[] = [
  ["d", "fresh", [["f", "updated-page"]]],
];
const isProdRun = process.env.TEST_ENV === "prod";

async function expandDirectory(
  nav: ReturnType<import("@playwright/test").Page["locator"]>,
  name: string,
) {
  const button = nav.getByRole("button", { name }).first();
  await expect(button).toBeVisible();
  if ((await button.getAttribute("aria-expanded")) === "false") {
    await button.click();
  }
}

async function mockFileTreeApi(page: Page) {
  const requests: string[] = [];
  let releaseFreshTree = () => {};
  const freshTreeRelease = new Promise<void>((resolve) => {
    releaseFreshTree = resolve;
  });

  await page.route("**/api/file-tree?**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.search);

    if (url.searchParams.get("scope") === "session") {
      await route.fulfill({ status: 204 });
      return;
    }

    await freshTreeRelease;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(freshTree),
    });
  });

  return { releaseFreshTree, requests };
}

test.describe("Navigation file tree SWR", () => {
  test.skip(
    isProdRun,
    "The SWR cache replacement test mocks navigation internals and is covered outside deployed-prod stress."
  );

  test("shows cached full tree after hydration, then replaces it with the fresh tree", async ({
    page,
  }) => {
    const fileTreeApi = await mockFileTreeApi(page);

    await page.addInitScript(
      ({ treeJson }) => {
        const originalGetItem = sessionStorage.getItem.bind(sessionStorage);
        sessionStorage.getItem = (key: string) => {
          if (
            key.startsWith(`${window.location.origin}:file-tree:v2:`) &&
            key.endsWith(":public")
          ) {
            return JSON.stringify({ version: "v2", tree: JSON.parse(treeJson) });
          }
          return originalGetItem(key);
        };
      },
      { treeJson: JSON.stringify(staleTree) },
    );

    await page.goto("/");
    const nav = page.locator(sidebar);

    await expect(nav.getByRole("button", { name: "cached" })).toBeVisible();
    await expandDirectory(nav, "cached");
    await expect(nav.getByRole("link", { name: "stale page" })).toHaveAttribute(
      "href",
      "/cached/stale-page",
    );

    fileTreeApi.releaseFreshTree();

    await expect(nav.getByRole("button", { name: "fresh" })).toBeVisible();
    await expandDirectory(nav, "fresh");
    await expect(nav.getByRole("link", { name: "updated page" })).toHaveAttribute(
      "href",
      "/fresh/updated-page",
    );
    await expect(nav.getByRole("button", { name: "cached" })).toHaveCount(0);

    expect(fileTreeApi.requests).toEqual(
      expect.arrayContaining([
        expect.stringContaining("scope=public"),
        expect.stringContaining("scope=session"),
      ]),
    );
    expect(
      fileTreeApi.requests.find((request) => request.includes("scope=public")),
    ).toEqual(expect.stringMatching(/cacheKey=.*%3Afile-tree%3Av2%3A.*%3Apublic/));
  });
});
