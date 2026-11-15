import { expect, test, type Page } from "@playwright/test";
import { documentArticle, gotoWiki, installWikiApiMocks, waitForPageTitle } from "../fixtures";

// What a full page load gives a keyboard or screen-reader user for free and a
// client-rendered reader has to do itself: a way past the navigation, focus and
// an announcement on the new page, the reader's place after Back, and the
// current page visible in the file tree.

const focused = (page: Page) => page.evaluate(() => {
  const element = document.activeElement as HTMLElement | null;
  return { tag: element?.tagName ?? null, testId: element?.getAttribute("data-test-id") ?? null, id: element?.id ?? null,
    text: element?.textContent?.trim().slice(0, 60) ?? null, inMain: Boolean(element?.closest("main")) };
});
const mainScrollTop = (page: Page) => page.evaluate(() => Math.round(document.getElementById("main-content")!.scrollTop));
const longPage = (title: string) => `# ${title}\n\n${Array.from({ length: 80 }, (_, index) => `Paragraph ${index + 1} of ${title}. Enough text to make this page scroll well past one screen.`).join("\n\n")}`;

test.describe("keyboard path through the reader", () => {
  test.skip(({ browserName }) => browserName === "webkit", "Safari tabs to links only with a system setting; focus order is covered in Chromium.");

  test("the first Tab stop skips to the page, in two keystrokes", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/wiki/logistics/insurance");
    await waitForPageTitle(page, "Insurance");

    await page.keyboard.press("Tab");
    expect(await focused(page)).toMatchObject({ testId: "skip-link", text: "Skip to content" });
    await expect(page.getByTestId("skip-link")).toBeInViewport();

    await page.keyboard.press("Enter");
    expect(await focused(page)).toMatchObject({ tag: "MAIN", id: "main-content" });
    // The URL is untouched: a hash would re-run routing and anchor handling.
    expect(new URL(page.url()).hash).toBe("");

    await page.keyboard.press("Tab");
    expect((await focused(page)).inMain).toBe(true);
  });

  test("opening a page moves focus to its title and announces it", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/wiki/logistics/insurance");
    await waitForPageTitle(page, "Insurance");
    await expect(page.getByTestId("route-announcer")).toHaveText("");

    const link = page.getByTestId("wiki-sidebar").getByRole("link", { name: "index", exact: true });
    await link.focus();
    await page.keyboard.press("Enter");
    await waitForPageTitle(page, "Diana Wiki Home");

    await expect(page.getByTestId("route-announcer")).toHaveText("Loaded Diana Wiki Home");
    await expect.poll(() => focused(page)).toMatchObject({ tag: "H1", inMain: true, text: expect.stringContaining("Diana Wiki Home") });
  });

  test("a slow page is announced when it arrives, not when it was requested", async ({ page }) => {
    await installWikiApiMocks(page, { pageDelays: { index: 1_200 } });
    await gotoWiki(page, "/wiki/logistics/insurance");
    await waitForPageTitle(page, "Insurance");

    await page.getByTestId("wiki-sidebar").getByRole("link", { name: "index", exact: true }).click();
    // The previous article stays on screen while the destination loads: nothing to announce yet.
    await expect(documentArticle(page)).toContainText("Insurance");
    await expect(page.getByTestId("route-announcer")).toHaveText("");
    await waitForPageTitle(page, "Diana Wiki Home");
    await expect(page.getByTestId("route-announcer")).toHaveText("Loaded Diana Wiki Home");
  });

  test("Back returns to where the reader was; a new visit starts at the top", async ({ page }) => {
    await installWikiApiMocks(page, { pageOverrides: {
      "wiki/logistics/insurance": { content: longPage("Insurance") },
      index: { content: longPage("Diana Wiki Home") },
    } });
    await gotoWiki(page, "/wiki/logistics/insurance");
    await waitForPageTitle(page, "Insurance");
    await page.evaluate(() => document.getElementById("main-content")!.scrollTo({ top: 900 }));
    await expect.poll(() => mainScrollTop(page)).toBe(900);

    await page.getByTestId("wiki-sidebar").getByRole("link", { name: "index", exact: true }).click();
    await waitForPageTitle(page, "Diana Wiki Home");
    await expect.poll(() => mainScrollTop(page)).toBe(0);
    await page.evaluate(() => document.getElementById("main-content")!.scrollTo({ top: 400 }));
    await expect.poll(() => mainScrollTop(page)).toBe(400);

    await page.goBack();
    await waitForPageTitle(page, "Insurance");
    await expect.poll(() => mainScrollTop(page)).toBe(900);

    await page.goForward();
    await waitForPageTitle(page, "Diana Wiki Home");
    await expect.poll(() => mainScrollTop(page)).toBe(400);
  });

  test("a deep link shows its row in the file tree, and the tree stays where the reader scrolls it", async ({ page }) => {
    const folder = Object.fromEntries(Array.from({ length: 70 }, (_, index) => {
      const name = `note-${String(index).padStart(2, "0")}`;
      return [`wiki/archive/${name}`, { title: `Archive ${name}`, tags: ["archive"], content: `# Archive ${name}\n\nSynthetic note.` }];
    }));
    await installWikiApiMocks(page, { pageOverrides: folder });
    await page.setViewportSize({ width: 1280, height: 720 });
    await gotoWiki(page, "/wiki/archive/note-55");
    await waitForPageTitle(page, "Archive note-55");

    const row = page.getByTestId("wiki-sidebar").locator('[aria-current="page"]');
    await expect(row).toBeInViewport();

    // Once is enough: scrolling the tree away must not snap it back.
    const tree = page.locator(".wiki-shell-tree-root");
    await tree.evaluate(element => { element.parentElement!.scrollTop = 0; });
    await page.waitForTimeout(800);
    expect(await tree.evaluate(element => element.parentElement!.scrollTop)).toBe(0);
    await expect(row).not.toBeInViewport();
  });
});
