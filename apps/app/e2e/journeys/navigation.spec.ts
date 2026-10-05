import { expect, test } from "@playwright/test";
import {
  documentArticle,
  gotoWiki,
  installWikiApiMocks,
  openDirectory,
  viteErrorOverlay,
  waitForPageTitle,
} from "../fixtures";

/** Mocked reader navigation: routing edge cases the real-backend read journey does not cover. */
test.describe("reader navigation (mocked backend)", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
  });

  test("rendered mixed-case and legacy links canonicalize in the client, keeping query and hash", async ({ page }) => {
    await installWikiApiMocks(page, {
      pageOverrides: {
        "wiki/logistics/insurance": {
          content: `# Insurance

This page covers authorization and coverage notes.

[Mixed-case insurance](/wiki/Logistics/Insurance?view=compact#claims-follow-up)

[Legacy tumor reading](/wiki/education/reading-a-tumor?source=legacy#interpretation)

## Claims follow-up

Keep payer follow-up current.
`,
        },
        "wiki/education/reading-a-tumor/index": {
          title: "Reading a Tumor",
          tags: ["education"],
          content: `# Reading a Tumor

The canonical tumor-reading guide is loaded through the local page cache.

## Interpretation

Review morphology and biomarkers together.
`,
        },
      },
    });
    await gotoWiki(page, "/wiki/logistics/insurance");
    await page.evaluate(() => {
      document.documentElement.dataset.navigationProbe = "alive";
    });

    await documentArticle(page).getByRole("link", { name: "Mixed-case insurance" }).click();
    await expect(page).toHaveURL(/\/wiki\/logistics\/insurance\?view=compact#claims-follow-up$/);
    await waitForPageTitle(page, "Insurance");
    await expect(documentArticle(page)).toContainText("Keep payer follow-up current");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.navigationProbe))
      .toBe("alive");

    await documentArticle(page).getByRole("link", { name: "Legacy tumor reading" }).click();
    await expect(page).toHaveURL(
      /\/wiki\/education\/reading-a-tumor\/index\?source=legacy#interpretation$/,
    );
    await waitForPageTitle(page, "Reading a Tumor");
    await expect(documentArticle(page)).toContainText(
      "The canonical tumor-reading guide is loaded through the local page cache.",
    );
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.navigationProbe))
      .toBe("alive");
    await expect(viteErrorOverlay(page)).toHaveCount(0);
  });

  test("markdown aliases render in place and application aliases canonicalize without losing query or hash", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance.md");
    await expect(page).toHaveURL(/\/wiki\/logistics\/insurance\.md$/);
    await waitForPageTitle(page, "Insurance");
    await expect(documentArticle(page)).toContainText("Prior authorization");

    await page.evaluate(() => {
      window.history.pushState({}, "", "/timeline?studySet=follow-up#comparison");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page).toHaveURL(/\/diagnostics\?studySet=follow-up#comparison$/);
  });

  test("sidebar navigation commits the route while retaining readable content until markdown resolves", async ({ page }) => {
    await page.unroute("**/api/wiki/pages**");
    await installWikiApiMocks(page, {
      pageDelays: { "wiki/logistics/insurance": 5_000 },
    });
    await gotoWiki(page, "/");
    await waitForPageTitle(page, "Diana Wiki Home");
    const readBody = () =>
      documentArticle(page)
        .locator(".wiki-markdown")
        .evaluate((node) => {
          // Heading-link decorations can attach after paint; compare the actual article.
          const content = node.cloneNode(true) as Element;
          content.querySelectorAll(".heading-anchor").forEach((anchor) => anchor.remove());
          return content.textContent;
        });
    const previousBody = await readBody();

    await openDirectory(page, "logistics");
    await page.getByTestId("wiki-sidebar").getByRole("link", { name: "insurance" }).click();

    await expect(page).toHaveURL(/\/wiki\/logistics\/insurance$/);
    await expect(documentArticle(page).getByTestId("page-loading")).toHaveCount(0);
    await expect.poll(readBody).toBe(previousBody);
    await expect(page.getByRole("status").filter({ hasText: "Opening page…" })).toBeVisible();
    await waitForPageTitle(page, "Insurance");
    await expect(documentArticle(page)).toContainText("Prior authorization");
    await expect(page.getByTestId("page-activity")).toHaveCount(0);
  });

  test("the workspace menu offers archive links, restores focus, and navigates inside the client router", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");
    await page.evaluate(() => {
      document.documentElement.dataset.navigationProbe = "alive";
    });

    const actions = page.getByRole("button", { name: "Workspace menu" });
    await actions.click();
    const menu = page.getByRole("menu", { name: "Actions" });
    await expect(menu.getByRole("menuitem", { name: /Download wiki \(full\)/ })).toHaveAttribute(
      "href",
      /\/api\/download\?type=full&scope=public$/,
    );
    await expect(menu.getByRole("menuitem", { name: /Download wiki \(markdown\)/ })).toHaveAttribute(
      "href",
      /\/api\/download\?type=markdown&scope=public$/,
    );
    await expect(menu).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(actions).toBeFocused();

    await actions.click();
    await menu.getByRole("menuitem", { name: "Text Search" }).click();
    await expect(page).toHaveURL(/\/search\?.*tab=text/);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.navigationProbe))
      .toBe("alive");
  });

  test("source PDFs in the sidebar open through the file route in a new tab, while source pages stay markdown links", async ({ page }) => {
    await gotoWiki(page, "/");
    for (const directory of ["sources", "people", "providers", "stanford", "telli"]) {
      await openDirectory(page, directory);
    }
    const sidebar = page.getByTestId("wiki-sidebar");
    const sourceLink = sidebar.locator('a[href="/sources/people/providers/stanford/telli"]');
    await expect(sourceLink).toBeVisible();
    await expect(sourceLink).not.toHaveAttribute("href", /\/api\/file/);

    const pdf = sidebar.locator('a[href*="/api/file?path="]').first();
    await expect(pdf).toBeVisible();
    await expect(pdf).toHaveAttribute("href", /\/api\/file\?path=.*\.pdf/);
    await expect(pdf).toHaveAttribute("target", "_blank");

    await sourceLink.click();
    await waitForPageTitle(page, "Telli 2016 HRD Platinum TNBC");
  });

  test("note pages link to available sibling notes only, and unrelated pages show none", async ({ page }) => {
    const base = "sources/meeting-notes/09-13---care-planning";
    await installWikiApiMocks(page, {
      pageOverrides: Object.fromEntries(
        [`${base}-raw`, `${base}-formatted`, "archive/09-13---care-planning-overview"].map((slug) => [
          slug,
          { title: slug, tags: [], content: `# ${slug}\n\nMeeting notes.` },
        ]),
      ),
    });
    await gotoWiki(page, `/${base}-raw`);
    await waitForPageTitle(page, `${base}-raw`);
    const navigation = page.getByRole("navigation", { name: "Note pages" });
    await expect(navigation.getByRole("link")).toHaveCount(2);
    await expect(navigation.getByRole("link", { name: /^Overview/ })).toHaveCount(0);
    await expect(navigation.locator('[aria-current="page"]')).toHaveAttribute("href", `/${base}-raw`);

    await navigation.getByRole("link", { name: /^Formatted/ }).click();
    await waitForPageTitle(page, `${base}-formatted`);
    await expect(navigation.locator('[aria-current="page"]')).toHaveAttribute("href", `/${base}-formatted`);

    await gotoWiki(page, "/about/About");
    await waitForPageTitle(page, "About This Wiki");
    await expect(navigation).toHaveCount(0);
  });

  test("on a phone, sign in from the navigation sheet opens an account dialog that traps focus and restores it", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.route("**/api/auth/session", (route) => route.fulfill({ json: { user: null } }));
    await page.goto("/");
    await expect(page.getByTestId("document-article")).toBeVisible();
    await page.getByRole("button", { name: "Open page navigation", exact: true }).click();
    const prompt = page.getByTestId("sidebar-sign-in").filter({ visible: true });
    await prompt.click();
    const dialog = page.getByRole("dialog", { name: "Sign in", exact: true });
    await expect(dialog.getByLabel("Email", { exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Need an account? Sign up" })).toBeFocused();
    await dialog.getByRole("button", { name: "Need an account? Sign up" }).click();
    await expect(
      page.getByRole("dialog", { name: "Sign up", exact: true }).getByLabel("Name", { exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("wiki-auth-dialog")).toHaveCount(0);
    await expect(prompt).toBeFocused();
    await expect(page).toHaveURL(/\/$/);
  });
});
