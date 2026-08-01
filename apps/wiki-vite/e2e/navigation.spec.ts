import { stat } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  documentArticle,
  gotoWiki,
  installWikiApiMocks,
  nextErrorOverlay,
  openDirectory,
  waitForPageTitle,
} from "./fixtures";
import { ensurePasswordGateSession, passwordGateCookie } from "./gate-auth";

const runsAgainstProductionServer = Boolean(process.env.PLAYWRIGHT_BASE_URL);

test.describe("Production server redirects", () => {
  test.skip(
    !runsAgainstProductionServer,
    "Server redirects are owned by the standalone/Vercel server, not the Vite dev server.",
  );

  test("serves the about index canonical redirect before rendering", async ({ request }) => {
    const cookie = await passwordGateCookie(request);
    const response = await request.get("/about/index", {
      headers: { Cookie: cookie },
      maxRedirects: 0,
    });

    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toMatch(/\/about\/Index$/);
  });

  test("redirects the about directory to its canonical index page", async ({ request }) => {
    const cookie = await passwordGateCookie(request);
    const response = await request.get("/about", {
      headers: { Cookie: cookie },
      maxRedirects: 0,
    });

    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toMatch(/\/about\/Index$/);
  });

  test("serves markdown article aliases through the app shell", async ({ request }) => {
    const cookie = await passwordGateCookie(request);
    const response = await request.get("/wiki/logistics/insurance.md", {
      headers: { Cookie: cookie },
    });

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/html");
    await expect(response.text()).resolves.toContain('<div id="root">');
  });

  test("permanently removes article trailing slashes", async ({ request }) => {
    const cookie = await passwordGateCookie(request);
    const response = await request.get("/wiki/logistics/insurance/?view=compact", {
      headers: { Cookie: cookie },
      maxRedirects: 0,
    });

    expect(response.status()).toBe(308);
    expect(response.headers()["location"]).toMatch(
      /\/wiki\/logistics\/insurance\?view=compact$/,
    );
  });

  test("redirects mixed-case wiki paths to canonical casing", async ({ request }) => {
    const cookie = await passwordGateCookie(request);
    const response = await request.get("/wiki/Logistics/Insurance", {
      headers: { Cookie: cookie },
      maxRedirects: 0,
    });

    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toMatch(/\/wiki\/logistics\/insurance$/);
  });
});

test.describe("Page viewing and sidebar navigation", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
  });

  test("home page loads with wiki content", async ({ page }) => {
    await gotoWiki(page, "/");

    await waitForPageTitle(page, "Diana Wiki Home");
    await expect(page.getByTestId("app-header")).toHaveCount(0);
    await expect(page.getByTestId("wiki-sidebar")).toBeVisible();
    await expect(documentArticle(page)).toContainText("local Vite reader fixture");
    await expect(documentArticle(page).locator(".wiki-shell-page-header")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copy page as markdown" })).toHaveCount(0);
    await expect(documentArticle(page).locator(".tag-row")).toHaveCount(0);
    await expect(nextErrorOverlay(page)).toHaveCount(0);
  });

  test("renders a markdown article alias without changing its URL", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance.md");

    await expect(page).toHaveURL(/\/wiki\/logistics\/insurance\.md$/);
    await waitForPageTitle(page, "Insurance");
    await expect(documentArticle(page)).toContainText("Prior authorization");
    await expect(nextErrorOverlay(page)).toHaveCount(0);
  });

  test("serves legacy redirect entries before the SPA catch-all", async ({ request }) => {
    const response = await request.get("/wiki/education/reading-a-tumor", {
      maxRedirects: 0,
    });
    expect([307, 308]).toContain(response.status());
    expect(response.headers()["location"]).toContain(
      "/wiki/education/reading-a-tumor/index",
    );
  });

  test("canonicalizes application aliases without losing query or hash", async ({
    page,
  }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");

    await page.evaluate(() => {
      window.history.pushState(
        {},
        "",
        "/timeline?studySet=follow-up#comparison",
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    await expect(page).toHaveURL(
      /\/diagnostics\?studySet=follow-up#comparison$/,
    );
  });

  test("shared actions menu exposes command, theme, and archive actions when signed out", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");

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
    await expect(menu.getByRole("menuitem", { name: /Theme:/ })).toBeVisible();
    await expect(menu.getByText("Account")).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Sign in" })).toHaveCount(0);
    await expect(menu).toHaveCSS("width", "224px");
    await expect(menu).toHaveCSS("border-radius", "10px");
    await expect(menu.getByRole("menuitem").first()).toHaveCSS("min-height", "28px");
    await expect(menu.getByRole("menuitem").first()).toHaveCSS("border-radius", "8px");
    await expect(menu).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(actions).toBeFocused();

    await actions.click();
    await menu.getByRole("menuitem", { name: /Command palette/ }).click();
    await expect(page.getByTestId("command-palette")).toBeVisible();
  });

  test("actions menu downloads the scoped markdown archive in the browser", async ({ page }) => {
    test.setTimeout(120_000);
    await page.unroute("**/api/download**");
    await ensurePasswordGateSession(page);
    await gotoWiki(page, "/wiki/logistics/insurance");

    await page.getByRole("button", { name: "Workspace menu" }).click();
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("menu", { name: "Actions" })
      .getByRole("menuitem", { name: "Download wiki (markdown)" })
      .click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe("diana-tnbc-wiki-markdown.zip");
    await expect(download.failure()).resolves.toBeNull();
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    expect((await stat(downloadPath!)).size).toBeGreaterThan(1_000);
    await expect(page).toHaveURL(/\/wiki\/logistics\/insurance$/);
  });

  test("same-origin actions menu navigation stays in the client router", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");
    await page.evaluate(() => {
      document.documentElement.dataset.navigationProbe = "alive";
    });

    await page.getByRole("button", { name: "Workspace menu" }).click();
    await page
      .getByRole("menu", { name: "Actions" })
      .getByRole("menuitem", { name: "Text Search" })
      .click();

    await expect(page).toHaveURL(/\/search\?.*tab=text/);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.navigationProbe))
      .toBe("alive");
  });

  test("fresh sidebar state expands wiki only", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("wiki-vite-expanded-directories");
    });
    await gotoWiki(page, "/");

    const sidebar = page.getByTestId("wiki-sidebar");
    await expect(sidebar.getByRole("button", { name: "Collapse wiki" })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: "Expand about" })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: "Expand sources" })).toBeVisible();
  });

  test("shared actions menu exposes account actions when signed in", async ({ page }) => {
    await page.route("**/api/auth/session", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            email: "admin@example.test",
            isAdmin: true,
            name: "Admin Example",
          },
        }),
      });
    });
    await page.route("**/api/auth/signout", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await gotoWiki(page, "/wiki/logistics/insurance");

    await page.getByRole("button", { name: "Workspace menu" }).click();
    const menu = page.getByRole("menu", { name: "Actions" });
    await expect(menu.getByText("Account")).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Admin Example", exact: true })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Admin", exact: true })).toHaveAttribute(
      "href",
      "/admin",
    );
    await expect(menu.getByRole("menuitem", { name: "Sign out", exact: true })).toBeVisible();
  });

  test("navigates to a page via sidebar", async ({ page }) => {
    await gotoWiki(page, "/");

    await openDirectory(page, "logistics");
    await page.getByTestId("wiki-sidebar").getByRole("link", { name: "insurance" }).click();

    await expect(page).toHaveURL(/\/wiki\/logistics\/insurance$/);
    await waitForPageTitle(page, "Insurance");
    await expect(documentArticle(page)).toContainText("Prior authorization");
  });

  test("canonicalizes rendered mixed-case and legacy links without reloading", async ({ page }) => {
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

    await documentArticle(page)
      .getByRole("link", { name: "Mixed-case insurance" })
      .click();

    await expect(page).toHaveURL(
      /\/wiki\/logistics\/insurance\?view=compact#claims-follow-up$/,
    );
    await waitForPageTitle(page, "Insurance");
    await expect(documentArticle(page)).toContainText("Keep payer follow-up current");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.navigationProbe))
      .toBe("alive");

    await documentArticle(page)
      .getByRole("link", { name: "Legacy tumor reading" })
      .click();

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
    await expect(nextErrorOverlay(page)).toHaveCount(0);
  });

  test("sidebar navigation commits the route before delayed markdown resolves", async ({ page }) => {
    await page.unroute("**/api/wiki/pages**");
    await installWikiApiMocks(page, {
      pageDelays: { "wiki/logistics/insurance": 5_000 },
    });
    await gotoWiki(page, "/");

    await openDirectory(page, "logistics");
    await page.getByTestId("wiki-sidebar").getByRole("link", { name: "insurance" }).click();

    await expect(page).toHaveURL(/\/wiki\/logistics\/insurance$/);
    await expect(documentArticle(page).getByTestId("page-loading")).toBeVisible();
    await waitForPageTitle(page, "Insurance");
    await expect(documentArticle(page)).toContainText("Prior authorization");
  });

  test("deep links auto-expand the active sidebar branch", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");

    const sidebar = page.getByTestId("wiki-sidebar");
    await expect(sidebar.getByRole("link", { name: "insurance" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "insurance" })).toHaveClass(/active/);
  });

  test("sidebar exposes accessible expansion and current-page state", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");

    await expect(
      page.getByTestId("wiki-sidebar").getByRole("link", { name: "insurance" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByTestId("wiki-sidebar").getByRole("button", { name: "Collapse wiki" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  test("root index keeps the legacy unselected sidebar state", async ({ page }) => {
    await gotoWiki(page, "/");

    const desktopIndex = page
      .getByTestId("sidebar-tree")
      .getByRole("link", { name: "index", exact: true })
      .first();
    await expect(desktopIndex).toHaveAttribute("href", "/");
    await expect(desktopIndex).not.toHaveAttribute("aria-current", "page");
    await expect(desktopIndex).not.toHaveClass(/active/);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId("bottom-nav-trigger").click();
    const mobileIndex = page
      .getByTestId("bottom-nav-page-tree")
      .getByRole("link", { name: "index", exact: true })
      .first();
    await expect(mobileIndex).toHaveAttribute("href", "/");
    await expect(mobileIndex).not.toHaveAttribute("aria-current", "page");
    await expect(mobileIndex).not.toHaveClass(/active/);
  });

  test("sidebar directory expansion persists across reloads", async ({ page }) => {
    await gotoWiki(page, "/");

    await openDirectory(page, "logistics");
    await expect(page.getByTestId("wiki-sidebar").getByRole("link", { name: "insurance" })).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("wiki-sidebar").getByRole("link", { name: "insurance" })).toBeVisible();
  });

  test("sidebar lets users collapse the active branch and persists the choice", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");

    const sidebar = page.getByTestId("wiki-sidebar");
    await expect(sidebar.getByRole("link", { name: "insurance" })).toBeVisible();
    await sidebar.getByRole("button", { name: "Collapse wiki" }).click();
    await expect(sidebar.getByRole("link", { name: "insurance" })).toBeHidden();

    await page.reload();
    await expect(sidebar.getByRole("link", { name: "insurance" })).toBeHidden();

    await sidebar.getByRole("button", { name: "Expand wiki" }).click();
    await expect(sidebar.getByRole("link", { name: "insurance" })).toBeVisible();
  });

  test("sidebar and source palette omit non-reader image assets", async ({ page }) => {
    await gotoWiki(page, "/");

    await expect(page.getByTestId("wiki-sidebar").getByRole("button", { name: /images/i })).toHaveCount(0);
    await expect(page.getByTestId("wiki-sidebar").getByRole("link", { name: /pathology-slide/ })).toHaveCount(0);

    await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+K" : "Control+Shift+K");
    await page.getByRole("button", { name: /Browse source PDFs/ }).click();
    await page.getByTestId("command-palette-input").fill("pathology");
    await expect(page.getByTestId("command-palette")).toContainText("No source PDFs found");
  });

  test("sidebar rail can collapse, expand, resize, and persist width", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await gotoWiki(page, "/");

    const layout = page.locator("[data-sidebar-layout]");
    const expandedRail = page.locator("[data-sidebar-expanded-rail]").first();
    await expect(layout).toHaveAttribute("data-sidebar-state", "expanded");
    await expect(expandedRail).toBeVisible();
    await expect(expandedRail).toHaveCSS("width", "256px");

    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(layout).toHaveAttribute("data-sidebar-state", "collapsed");
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    await expect(page.getByTestId("wiki-sidebar")).toBeHidden();

    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect(layout).toHaveAttribute("data-sidebar-state", "expanded");

    const handle = page.locator("[data-sidebar-resize-handle]");
    const box = await handle.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 30);
    await page.mouse.down();
    await page.mouse.move(box!.x + 96, box!.y + 30);
    await page.mouse.up();
    await expect
      .poll(async () => Number.parseFloat(await expandedRail.evaluate((node) => getComputedStyle(node).width)))
      .toBeGreaterThan(340);

    await page.reload();
    await expect
      .poll(async () => Number.parseFloat(await expandedRail.evaluate((node) => getComputedStyle(node).width)))
      .toBeGreaterThan(340);
  });

  test("page shows tags and sensitive scope without debug cache footer", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance?devtools=1");

    await expect(documentArticle(page).locator(".tag-row").getByRole("link", { name: "logistics" })).toBeVisible();
    await expect(documentArticle(page).locator(".tag-row").getByRole("link", { name: "insurance" })).toBeVisible();
    await expect(documentArticle(page).locator(".page-footer")).toHaveCount(0);
    await expect(page.getByTestId("scope-switcher").getByRole("link", { name: "Public" })).toHaveClass(/active/);
  });

  test("tag pages group visible tagged pages", async ({ page }) => {
    await page.goto("/tags/logistics", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("tag-page")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tag: logistics" })).toBeVisible();
    await expect(page.getByTestId("tag-page").getByRole("link", { name: "Insurance" })).toBeVisible();
  });

  test("medical deduction tool route loads", async ({ page }) => {
    await page.goto("/tools/medical-deduction", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("medical-deduction-page")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Medical Expense Deduction Calculator" })).toBeVisible();
  });

  test("local quick switcher opens with Ctrl+K and navigates on Enter", async ({ page }) => {
    await gotoWiki(page, "/");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    const input = page.getByTestId("command-palette-input");
    await expect(input).toBeFocused();
    await input.fill("insurance");
    await expect(page.getByTestId("command-palette").getByRole("option", { name: /insurance/ })).toBeVisible();
    await input.press("Enter");

    await expect(page).toHaveURL(/\/wiki\/logistics\/insurance$/);
    await waitForPageTitle(page, "Insurance");
  });
});
