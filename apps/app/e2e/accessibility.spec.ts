import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";
import { gotoWiki, installWikiApiMocks } from "./fixtures";

type AxeWindow = Window & {
  axe: {
    run: (
      context: Document,
      options: Record<string, unknown>,
    ) => Promise<{
      violations: Array<{
        help: string;
        helpUrl: string;
        id: string;
        impact: string | null;
        nodes: Array<{ html: string; target: string[] }>;
      }>;
    }>;
  };
};

async function expectNoSeriousAccessibilityViolations(page: Page, surface: string) {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const results = await (window as unknown as AxeWindow).axe.run(document, {
      resultTypes: ["violations"],
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
      },
    });
    return results.violations
      .filter((violation) =>
        violation.impact === "critical" || violation.impact === "serious"
      )
      .map((violation) => ({
        help: violation.help,
        helpUrl: violation.helpUrl,
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.map((node) => ({
          html: node.html,
          target: node.target,
        })),
      }));
  });

  expect(violations, `${surface} has serious accessibility violations`).toEqual([]);
}

async function installCommentsMocks(page: Page) {
  await page.route("**/api/liveblocks-auth", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ configured: false, reason: "credentials-missing" }),
    }),
  );
  await page.route("**/api/liveblocks-threads**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ threads: [], userNames: {} }),
    }),
  );
}

test.describe("cross-surface accessibility smoke", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
  });

  test("reader shell and command dialog have names and restore keyboard focus", async ({
    page,
  }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");
    await expectNoSeriousAccessibilityViolations(page, "reader article");

    const trigger = page.getByTestId("sidebar-search");
    await trigger.focus();
    await trigger.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Go to page" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("combobox", { name: "Search pages" }),
    ).toBeFocused();
    await expectNoSeriousAccessibilityViolations(page, "command palette dialog");

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("a keyboard-only pass reaches the palette, search, and sign-in dialog with visible, contained focus", async ({
    page,
  }) => {
    await page.route("**/api/auth/session", (route) => route.fulfill({ json: { user: null } }));
    const focusIsVisible = () =>
      page.evaluate(() => document.activeElement?.matches(":focus-visible") ?? false);

    await gotoWiki(page, "/wiki/logistics/insurance");
    await expect(page.getByTestId("document-article")).toBeVisible();

    // Reader -> palette: focus lands in the combobox, stays inside on Tab, and returns on Escape.
    const trigger = page.getByTestId("sidebar-search");
    await trigger.focus();
    await page.keyboard.press("Enter");
    const palette = page.getByRole("dialog", { name: "Go to page" });
    await expect(palette.getByRole("combobox", { name: "Search pages" })).toBeFocused();
    expect(await focusIsVisible()).toBe(true);
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      expect(await palette.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(await focusIsVisible()).toBe(true);

    // Palette -> search: the workspace menu opens with the keyboard and leads to the search box.
    const workspace = page.getByRole("button", { name: "Workspace menu" });
    await workspace.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", { name: "Actions" });
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: "Text Search" }).focus();
    expect(await focusIsVisible()).toBe(true);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/search(?:\?|$)/);
    const searchBox = page.getByRole("textbox", { name: "Search the wiki" });
    await searchBox.focus();
    await page.keyboard.type("insurance");
    await expect(searchBox).toHaveValue("insurance");
    expect(await focusIsVisible()).toBe(true);

    // Search -> sign-in dialog: focus is trapped inside and restored to the prompt on Escape.
    await page.goto("/");
    await expect(page.getByTestId("document-article")).toBeVisible();
    const prompt = page.getByTestId("sidebar-sign-in").filter({ visible: true });
    await prompt.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Sign in", exact: true });
    await expect(dialog.getByLabel("Email", { exact: true })).toBeFocused();
    expect(await focusIsVisible()).toBe(true);
    await page.keyboard.press("Shift+Tab");
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("wiki-auth-dialog")).toHaveCount(0);
    await expect(prompt).toBeFocused();
  });

  test("search, comments, diagnostics, and calculator avoid serious violations", async ({
    page,
  }) => {
    await page.goto("/search", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("textbox", { name: "Search the wiki" }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Search results" })).toBeVisible();
    await expectNoSeriousAccessibilityViolations(page, "search");

    await installCommentsMocks(page);
    await page.goto("/comments", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Comments" })).toBeVisible();
    await expectNoSeriousAccessibilityViolations(page, "comments");

    await page.goto("/diagnostics", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("diagnostic-timeline")).toBeVisible();
    await expectNoSeriousAccessibilityViolations(page, "diagnostics timeline");

    await page.goto("/tools/medical-deduction", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("medical-deduction-page")).toBeVisible();
    await expectNoSeriousAccessibilityViolations(page, "medical deduction calculator");
  });
});
