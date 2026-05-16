import { test, expect, type Page } from "@playwright/test";
import { documentArticle, openCommandPalette } from "./helpers";

// Desktop sidebar locator
const sidebar = "[data-test-id='sidebar-tree']";

async function holdRouteUntilReleased(page: Page, url: string) {
  let releaseRoute = () => {};
  const routeSeen = new Promise<void>((resolve) => {
    void page.route(url, async (route) => {
      resolve();
      await new Promise<void>((release) => {
        releaseRoute = release;
      });
      await route.continue();
    });
  });

  return {
    routeSeen,
    releaseRoute: () => releaseRoute(),
  };
}

async function expectSingleSelectedSidebarItem(
  page: Page,
  { href, text }: { href: string; text: string },
) {
  const nav = page.locator(sidebar);
  const selectedItem = nav.locator('[data-selected-file-tree-item="true"]');

  await expect(selectedItem).toHaveCount(1);
  await expect(selectedItem).toHaveText(text);
  await expect(selectedItem).toHaveAttribute("href", href);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function expandDirectory(page: Page, name: string) {
  const nav = page.locator(sidebar);
  const toggle = nav
    .getByRole("button", {
      name: new RegExp(`^(?:${escapeRegExp(name)}|Expand ${escapeRegExp(name)}|Collapse ${escapeRegExp(name)})$`),
    })
    .first();

  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
}

test.describe("Page viewing & sidebar navigation", () => {
  test("serves the about index canonical redirect before rendering", async ({ request }) => {
    const response = await request.get("/about/index?token=diana", {
      maxRedirects: 0,
    });

    expect([307, 308]).toContain(response.status());
    expect(response.headers().location).toMatch(/\/about\/Index\?token=diana$/);
  });

  test("home page loads with wiki content", async ({ page }) => {
    await page.goto("/");
    await expect(documentArticle(page)).toBeVisible();
    const nav = page.locator(sidebar);
    await expect(nav.getByText("sources").first()).toBeVisible();
    await expect(nav.getByText("wiki").first()).toBeVisible();
  });

  test("navigate to a page via sidebar", async ({ page }) => {
    await page.goto("/");
    const nav = page.locator(sidebar);
    await expandDirectory(page, "about");
    const journalLink = nav.getByRole("link", { name: "Journal" });

    await expect(journalLink).toHaveAttribute("href", "/about/Journal");
    await expect(journalLink).toBeVisible();
    await journalLink.click();
    await expect(page).toHaveURL(/\/about\/Journal$/);
    await expect(page.locator("h1").first()).toBeVisible();
  });

  test("sidebar selection follows the clicked file before navigation settles", async ({ page }) => {
    await page.goto("/wiki/treatment/plan/index");
    const nav = page.locator(sidebar);
    await expectSingleSelectedSidebarItem(page, {
      href: "/wiki/treatment/plan/index",
      text: "plan",
    });

    const { releaseRoute, routeSeen } = await holdRouteUntilReleased(
      page,
      "**/wiki/treatment/plan/ctdna-schedule**",
    );

    await nav.getByRole("link", { name: "ctdna schedule" }).click({
      noWaitAfter: true,
    });
    await routeSeen;

    await expectSingleSelectedSidebarItem(page, {
      href: "/wiki/treatment/plan/ctdna-schedule",
      text: "ctdna schedule",
    });

    releaseRoute();
    await expect(page).toHaveURL(/\/wiki\/treatment\/plan\/ctdna-schedule$/);
  });

  test("file palette selection follows the chosen file before navigation settles", async ({ page }) => {
    await page.goto("/wiki/treatment/plan/index");
    await expectSingleSelectedSidebarItem(page, {
      href: "/wiki/treatment/plan/index",
      text: "plan",
    });

    const { releaseRoute, routeSeen } = await holdRouteUntilReleased(
      page,
      "**/wiki/treatment/chemo-day**",
    );

    const input = await openCommandPalette(page);
    await input.fill("chemo day");
    const result = page
      .locator('[cmdk-item][data-value="wiki/treatment/chemo-day"]')
      .first();
    await expect(result).toBeVisible();
    await result.click({ noWaitAfter: true });
    await routeSeen;

    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    await expectSingleSelectedSidebarItem(page, {
      href: "/wiki/treatment/chemo-day",
      text: "chemo day",
    });

    releaseRoute();
    await expect(page).toHaveURL(/\/wiki\/treatment\/chemo-day$/);
  });

  test("index-backed directories link to their index while keeping index first", async ({ page }) => {
    await page.goto("/wiki/treatment/plan/index");

    await expandDirectory(page, "wiki");
    await expandDirectory(page, "treatment");
    await expandDirectory(page, "plan");

    const nav = page.locator(sidebar);
    const planLink = nav.getByRole("link", { name: "plan", exact: true }).first();
    const indexLink = nav
      .locator('a[href="/wiki/treatment/plan/index"]')
      .filter({ hasText: /^index$/ })
      .first();
    const ctdnaLink = nav.getByRole("link", { name: "ctdna schedule", exact: true }).first();

    await expect(planLink).toHaveAttribute("href", "/wiki/treatment/plan/index");
    await expect(planLink.locator("svg")).toBeVisible();
    await expect(indexLink).toHaveAttribute("href", "/wiki/treatment/plan/index");

    const indexBox = await indexLink.boundingBox();
    const ctdnaBox = await ctdnaLink.boundingBox();
    expect(indexBox).not.toBeNull();
    expect(ctdnaBox).not.toBeNull();
    expect(indexBox!.y).toBeLessThan(ctdnaBox!.y);

    await planLink.click();
    await expect(ctdnaLink).toBeHidden();
    await planLink.click();
    await expect(ctdnaLink).toBeVisible();
    await expect(page).toHaveURL(/\/wiki\/treatment\/plan\/index$/);
    await expectSingleSelectedSidebarItem(page, {
      href: "/wiki/treatment/plan/index",
      text: "plan",
    });
  });

  test("meeting note sets select their overview by default", async ({ page }) => {
    await page.goto("/sources/meeting-notes/05-13---echo-kernis-phm-tissue-sync-overview");

    const nav = page.locator(sidebar);
    const selectedItem = nav.locator('[data-selected-file-tree-item="true"]');

    await expect(selectedItem).toHaveCount(1);
    await expect(selectedItem).toHaveAttribute(
      "href",
      "/sources/meeting-notes/05-13---echo-kernis-phm-tissue-sync-overview",
    );
    await expect(selectedItem).toContainText("May 13th - echo kernis phm tissue sync");
    await expect(selectedItem).toContainText("Notes set");

    const activeSet = selectedItem.locator("xpath=../..");
    await expect(activeSet.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "href",
      "/sources/meeting-notes/05-13---echo-kernis-phm-tissue-sync-overview",
    );
    await expect(activeSet.getByRole("link", { name: "Formatted" })).toHaveAttribute(
      "href",
      "/sources/meeting-notes/05-13---echo-kernis-phm-tissue-sync-formatted",
    );
    await expect(activeSet.getByRole("link", { name: "Raw" })).toHaveAttribute(
      "href",
      "/sources/meeting-notes/05-13---echo-kernis-phm-tissue-sync-raw",
    );
  });

  test("redirects mixed-case wiki paths to canonical casing", async ({ page }) => {
    await page.goto("/about/index");
    await expect(page).toHaveURL(/\/about\/Index$/);
    await expect(page.locator("h1").first()).toBeVisible();
  });

  test("page shows tags and copy button", async ({ page }) => {
    await page.goto("/wiki/diagnostics/diagnosis");
    await expect(page.locator("h1").first()).toContainText("Diagnosis");
    await expect(page.getByRole("link", { name: "TNBC" }).first()).toBeVisible();
    await expect(
      page.locator('button[aria-label="Copy page as markdown"]').first()
    ).toBeVisible();
  });

  test("actions menu opens with theme and download", async ({ page }) => {
    await page.goto("/");
    const actions = page.getByTestId("sidebar-workspace-trigger");
    const themeItem = page.getByRole("menuitem", {
      name: /Theme: (System|Dark|Light)/,
    });

    await expect(actions).toBeVisible();
    await actions.click();
    if (!(await themeItem.isVisible({ timeout: 3_000 }).catch(() => false))) {
      await actions.click();
    }

    await expect(themeItem).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Download wiki (full)" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Download wiki (markdown)" })).toBeVisible();
  });

  test("command palette opens with Ctrl+K", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("sidebar-search")).toBeVisible();
    const commandInput = page.locator('[role="dialog"] [role="combobox"]').first();

    await expect
      .poll(
        async () => {
          await page.keyboard.press("Control+k");
          return commandInput.isVisible().catch(() => false);
        },
        { timeout: 15_000 }
      )
      .toBe(true);
  });

  test("command palette shows pages before typing when there are no recents", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("cmd-palette-recent");
    });

    await openCommandPalette(page);

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog.getByText("No pages found.")).toHaveCount(0);
    await expect(dialog.locator('[cmdk-item]').first()).toBeVisible();
    await expect(dialog.locator('[cmdk-item]').first().locator(".text-xs")).not.toBeEmpty();
    await expect(dialog.locator('[cmdk-item][data-value*="Journal"]').first()).toBeVisible();
  });

  test("command palette shows recent pages and all pages before typing", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem("cmd-palette-recent", JSON.stringify(["about/Journal"]));
    });

    await openCommandPalette(page);

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog.getByText("Recent pages")).toBeVisible();
    await expect(dialog.getByText("All pages")).toBeVisible();
    await expect(dialog.locator('[cmdk-item]').first()).toHaveAttribute("data-value", /Journal/);
    await expect(dialog.locator('[cmdk-item]').nth(1)).toBeVisible();

    const recentHeader = await dialog.getByText("Recent pages").boundingBox();
    const recentItem = await dialog.locator('[cmdk-item]').first().boundingBox();
    const allPagesHeader = await dialog.getByText("All pages").boundingBox();
    const allPagesItem = await dialog.locator('[cmdk-item]').nth(1).boundingBox();

    expect(recentHeader).not.toBeNull();
    expect(recentItem).not.toBeNull();
    expect(allPagesHeader).not.toBeNull();
    expect(allPagesItem).not.toBeNull();

    expect(recentItem!.y - (recentHeader!.y + recentHeader!.height)).toBeLessThan(12);
    expect(allPagesItem!.y - (allPagesHeader!.y + allPagesHeader!.height)).toBeLessThan(12);
  });

  test("command palette resets scroll position when reopened", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("cmd-palette-recent");
    });

    await openCommandPalette(page);
    const listbox = page.locator("#page-palette-list");
    await expect(listbox).toBeVisible();
    await expect(page.locator('[cmdk-item]').first()).toBeVisible();
    await expect.poll(
      () => listbox.evaluate((element) => element.scrollHeight > element.clientHeight)
    ).toBe(true);

    await listbox.evaluate((element) => {
      element.scrollTop = 600;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await expect.poll(() => listbox.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    await page.keyboard.press("Escape");
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    await openCommandPalette(page);

    await expect.poll(() => page.locator("#page-palette-list").evaluate((element) => element.scrollTop)).toBe(0);
    await expect(page.locator('[cmdk-item]').first()).toBeVisible();
  });

  test("command palette Enter navigation does not flash the outline palette", async ({ page }) => {
    await page.goto("/");
    const input = await openCommandPalette(page);
    await input.fill("Journal");
    const journalItem = page.locator('[cmdk-item][data-value="about/Journal"]').first();
    await expect(journalItem).toBeVisible();
    await expect(journalItem).toHaveAttribute("aria-selected", "true");

    await page.evaluate(() => {
      const win = window as typeof window & {
        __outlineDialogEvents?: string[];
        __outlineDialogObserver?: MutationObserver;
      };

      win.__outlineDialogEvents = [];
      const collectOutlineDialogs = () => {
        for (const dialog of Array.from(document.querySelectorAll('[role="dialog"]'))) {
          const text = dialog.textContent ?? "";
          if (text.includes("Outline") || text.includes("Search headings")) {
            win.__outlineDialogEvents?.push(text);
          }
        }
      };

      collectOutlineDialogs();
      win.__outlineDialogObserver = new MutationObserver(collectOutlineDialogs);
      win.__outlineDialogObserver.observe(document.body, {
        attributes: true,
        childList: true,
        subtree: true,
      });
    });

    await input.press("Enter");
    await expect(page).toHaveURL(/\/about\/Journal$/);
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);

    const result = await page.evaluate(() => {
      const win = window as typeof window & {
        __outlineDialogEvents?: string[];
        __outlineDialogObserver?: MutationObserver;
      };
      win.__outlineDialogObserver?.disconnect();

      return {
        openDialogCount: document.querySelectorAll('[role="dialog"]').length,
        outlineDialogEvents: win.__outlineDialogEvents ?? [],
      };
    });

    expect(result.openDialogCount).toBe(0);
    expect(result.outlineDialogEvents).toEqual([]);
  });

  test("outline palette jumps to a selected heading", async ({ page }) => {
    await page.goto("/table-examples");

    const headings = page.locator("article h2[id], article h3[id]");
    await expect(headings.first()).toBeVisible();
    const heading = headings.last();

    const id = await heading.getAttribute("id");
    const headingText = await heading.evaluate((node) => {
      const clone = node.cloneNode(true) as HTMLElement;
      clone.querySelectorAll(".heading-anchor").forEach((anchor) => anchor.remove());
      return (clone.textContent ?? "").replace(/(?:\s*#\s*)+$/, "").trim();
    });

    if (!id || !headingText) {
      throw new Error("Expected the first table example heading to have text and an id");
    }

    await expect.poll(async () => {
      return page.evaluate((targetId) => {
        const target = document.getElementById(targetId);
        if (!target) return false;
        return target.getBoundingClientRect().top > window.innerHeight;
      }, id);
    }, { timeout: 15_000 }).toBe(true);

    await page.keyboard.press("Meta+Shift+O");
    const input = page.getByPlaceholder("Search headings…");
    await expect(input).toBeVisible();
    const dialog = page.locator('[role="dialog"]').filter({ has: input });

    await input.fill(headingText);
    const targetItem = dialog.locator("[cmdk-item]").filter({ hasText: headingText }).first();
    await expect(targetItem).toHaveAttribute("aria-selected", "true");

    await input.press("Enter");

    await expect.poll(async () => {
      return page.evaluate((targetId) => {
        const target = document.getElementById(targetId);
        if (!target) return false;
        return (
          target.getBoundingClientRect().top < 220 &&
          target.getBoundingClientRect().bottom > 0
        );
      }, id);
    }, { timeout: 15_000 }).toBe(true);
  });
});
