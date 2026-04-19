import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

type PageLoadCase = {
  route: string;
  heading: string;
  bodyText?: string;
};

const desktopViewport = { width: 1440, height: 960 };
const mobileViewport = { width: 390, height: 844 };

const pageCases: PageLoadCase[] = [
  {
    route: "/about/Index",
    heading: "Index",
    bodyText: "Weekly Updates",
  },
  {
    route: "/wiki/diagnostics/diagnosis",
    heading: "Diagnosis",
    bodyText: "Patient:",
  },
  {
    route: "/sources/meeting-notes/409---dirbas-biopsy-planning-overview",
    heading: "Dr. Dirbas Biopsy Planning Call — April 8, 2026",
  },
  {
    route: "/sources/diagnostics/410-stanford-research-consent",
    heading: "Stanford University Research Consent Form — OCR",
  },
];

function withMagicLink(route: string) {
  const separator = route.includes("?") ? "&" : "?";
  return `${route}${separator}token=diana`;
}

async function assertServerShellHtml(
  request: APIRequestContext,
  pageCase: PageLoadCase
) {
  const response = await request.get(withMagicLink(pageCase.route));

  expect(response.ok()).toBeTruthy();

  const html = await response.text();

  expect(html).toContain('aria-label="Home"');
  expect(html).toContain('placeholder="Search wiki..."');
  expect(html).toContain('aria-label="Find files (⌘P)"');
  expect(html).toContain('aria-label="Actions"');
  expect(html).toContain('aria-label="Collapse sidebar"');
  expect(html).toContain("Chat with wiki");
  expect(html).toContain(pageCase.heading);

  if (pageCase.bodyText) {
    expect(html).toContain(pageCase.bodyText);
  }
}

async function blockAppScripts(page: Page) {
  await page.route(/.*\.js(\?.*)?$/, (route) => route.abort());
}

function appHeader(page: Page) {
  return page.locator("header").filter({ has: page.getByLabel("Home") }).first();
}

async function assertDesktopFirstPaint(page: Page, pageCase: PageLoadCase) {
  await page.setViewportSize(desktopViewport);
  await blockAppScripts(page);
  await page.goto(pageCase.route, { waitUntil: "commit" });

  const searchInput = page.getByPlaceholder("Search wiki...");
  const header = appHeader(page);
  const sidebar = page.locator("aside.hidden.md\\:flex").first();
  const title = page.locator("article h1:visible").first();

  await expect(header).toBeVisible();
  await expect(searchInput).toBeVisible();
  await expect(page.getByRole("link", { name: "New chat" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Find files (⌘P)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Actions" })).toBeVisible();
  await expect(sidebar).toBeVisible();
  await expect(title).toHaveText(pageCase.heading);

  if (pageCase.bodyText) {
    await expect(page.getByText(pageCase.bodyText, { exact: false }).first()).toBeVisible();
  }

  // Chromium exposes FP/FCP but not the deprecated FMP metric, so FCP is our
  // closest browser-level proxy for "meaningful content hit the screen".
  await page.waitForFunction(() =>
    performance
      .getEntriesByType("paint")
      .some((entry) => entry.name === "first-contentful-paint")
  );

  const [headerBox, sidebarBox, titleBox] = await Promise.all([
    header.boundingBox(),
    sidebar.boundingBox(),
    title.boundingBox(),
  ]);

  expect(headerBox).not.toBeNull();
  expect(sidebarBox).not.toBeNull();
  expect(titleBox).not.toBeNull();

  expect(headerBox!.height).toBeGreaterThan(40);
  expect(sidebarBox!.width).toBeGreaterThan(180);
  expect(titleBox!.y).toBeGreaterThan(headerBox!.y + headerBox!.height - 1);

  const paintNames = await page.evaluate(() =>
    performance.getEntriesByType("paint").map((entry) => entry.name)
  );

  expect(paintNames).toContain("first-paint");
  expect(paintNames).toContain("first-contentful-paint");
}

test.describe("Page load experience", () => {
  test("server-rendered shell keeps header and layout chrome across key routes", async ({ request }) => {
    for (const pageCase of pageCases) {
      await test.step(pageCase.route, async () => {
        await assertServerShellHtml(request, pageCase);
      });
    }
  });

  for (const pageCase of pageCases) {
    test(`desktop initial paint keeps chrome and content frame for ${pageCase.route}`, async ({ page }) => {
      await assertDesktopFirstPaint(page, pageCase);
    });
  }

  test("mobile initial paint keeps header and bottom page affordance", async ({ page }) => {
    await page.setViewportSize(mobileViewport);
    await blockAppScripts(page);
    await page.goto("/about/Index", { waitUntil: "commit" });

    const header = appHeader(page);
    const bottomBar = page.getByRole("button", { name: /Index/ }).first();
    const title = page.locator("article h1:visible").first();

    await expect(header).toBeVisible();
    await expect(page.getByPlaceholder("Search wiki...")).toBeVisible();
    await expect(bottomBar).toBeVisible();
    await expect(title).toHaveText("Index");

    await page.waitForFunction(() =>
      performance
        .getEntriesByType("paint")
        .some((entry) => entry.name === "first-contentful-paint")
    );

    const [headerBox, bottomBarBox, titleBox] = await Promise.all([
      header.boundingBox(),
      bottomBar.boundingBox(),
      title.boundingBox(),
    ]);

    expect(headerBox).not.toBeNull();
    expect(bottomBarBox).not.toBeNull();
    expect(titleBox).not.toBeNull();

    expect(titleBox!.y).toBeGreaterThan(headerBox!.y + headerBox!.height - 1);
    expect(bottomBarBox!.y).toBeGreaterThan(mobileViewport.height - 120);
    expect(bottomBarBox!.y + bottomBarBox!.height).toBeLessThanOrEqual(
      mobileViewport.height + 1
    );
  });
});
