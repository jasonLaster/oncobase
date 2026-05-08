import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";

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
    bodyText: "Patient identifiers hidden.",
  },
  {
    route: "/sources/meeting-notes/04-09---dirbas-biopsy-planning-overview",
    heading: "Dr. Dirbas Biopsy Planning Call — April 8, 2026",
  },
  {
    route: "/sources/diagnostics/04-10-stanford-research-consent",
    heading: "Stanford University Research Consent Form — OCR",
  },
];

function withMagicLink(route: string) {
  const separator = route.includes("?") ? "&" : "?";
  return `${route}${separator}token=diana`;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableShellFetchError(error: unknown) {
  return (
    error instanceof Error &&
    /socket hang up|ECONNRESET|ETIMEDOUT|network|fetch failed/i.test(error.message)
  );
}

async function getServerShellResponse(
  request: APIRequestContext,
  pageCase: PageLoadCase
) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await request.get(withMagicLink(pageCase.route));
      if (response.ok() || response.status() < 500 || attempt === 3) {
        return response;
      }

      lastError = new Error(`Server shell returned ${response.status()}`);
    } catch (error) {
      lastError = error;
      if (!isRetryableShellFetchError(error)) {
        throw error;
      }
    }

    await delay(500 * attempt);
  }

  throw lastError;
}

async function assertServerShellHtml(
  request: APIRequestContext,
  pageCase: PageLoadCase
) {
  const response: APIResponse = await getServerShellResponse(request, pageCase);

  expect(response.ok()).toBeTruthy();

  const html = await response.text();

  expect(html).toContain('aria-label="Home"');
  expect(html).toContain('placeholder="Search wiki..."');
  expect(html).toContain('aria-label="New chat"');
  expect(html).toContain('aria-label="Find files (⌘P)"');
  expect(html).toContain('aria-label="Actions"');
  expect(html).toContain('aria-label="Collapse sidebar"');
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

function headerSearchInput(page: Page) {
  return appHeader(page).locator('input[placeholder="Search wiki..."]').first();
}

async function assertDesktopFirstPaint(page: Page, pageCase: PageLoadCase) {
  await page.setViewportSize(desktopViewport);
  await blockAppScripts(page);
  await page.goto(withMagicLink(pageCase.route), { waitUntil: "commit" });

  const searchInput = headerSearchInput(page);
  const header = appHeader(page);

  await expect(header).toBeVisible();
  await expect(searchInput).toBeVisible();
  await expect(page.getByRole("button", { name: "New chat" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Find files (⌘P)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Actions" })).toBeVisible();

  const headerBox = await header.boundingBox();
  expect(headerBox).not.toBeNull();
  expect(headerBox!.height).toBeGreaterThan(40);
}

test.describe("Page load experience", () => {
  test.describe.configure({ timeout: 90_000 });

  test("server-rendered shell keeps header and layout chrome across key routes", async ({ request }) => {
    for (const pageCase of pageCases) {
      await test.step(pageCase.route, async () => {
        await assertServerShellHtml(request, pageCase);
      });
    }
  });

  for (const pageCase of pageCases) {
    test(`desktop initial paint keeps chrome for ${pageCase.route}`, async ({ page }) => {
      await assertDesktopFirstPaint(page, pageCase);
    });
  }

  test("desktop initial paint honors a collapsed sidebar preference", async ({ page }) => {
    await page.setViewportSize(desktopViewport);
    await page.addInitScript(() => {
      localStorage.setItem("sidebar-width", "0");
    });
    await blockAppScripts(page);
    await page.goto(withMagicLink("/about/Index"), { waitUntil: "commit" });

    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeHidden();
  });

  test("mobile initial paint keeps header and bottom page affordance", async ({ page }) => {
    await page.setViewportSize(mobileViewport);
    await blockAppScripts(page);
    await page.goto(withMagicLink("/about/Index"), { waitUntil: "commit" });

    const header = appHeader(page);
    const bottomBar = page.locator("button.md\\:hidden.fixed.bottom-0").first();

    await expect(header).toBeVisible();
    await expect(headerSearchInput(page)).toBeVisible();
    await expect(bottomBar).toBeVisible();

    const [headerBox, bottomBarBox] = await Promise.all([
      header.boundingBox(),
      bottomBar.boundingBox(),
    ]);

    expect(headerBox).not.toBeNull();
    expect(bottomBarBox).not.toBeNull();

    expect(bottomBarBox!.y).toBeGreaterThan(mobileViewport.height - 120);
    expect(bottomBarBox!.y + bottomBarBox!.height).toBeLessThanOrEqual(
      mobileViewport.height + 1
    );
  });
});
