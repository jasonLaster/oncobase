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

  // Sidebar workspace header + footer (the new chrome — no top header).
  expect(html).toContain('aria-label="Workspace menu"');
  expect(html).toContain("Diana TNBC");
  expect(html).toContain("Ask wiki");
  expect(html).toContain('aria-label="Collapse sidebar"');
  expect(html).toContain(pageCase.heading);

  if (pageCase.bodyText) {
    expect(html).toContain(pageCase.bodyText);
  }
}

async function blockAppScripts(page: Page) {
  await page.route(/.*\.js(\?.*)?$/, (route) => route.abort());
}

function sidebar(page: Page) {
  return page.getByTestId("sidebar");
}

async function assertDesktopFirstPaint(page: Page, pageCase: PageLoadCase) {
  await page.setViewportSize(desktopViewport);
  await blockAppScripts(page);
  await page.goto(withMagicLink(pageCase.route), { waitUntil: "commit" });

  const sb = sidebar(page);

  await expect(sb).toBeVisible();
  await expect(page.getByTestId("sidebar-workspace-trigger")).toBeVisible();
  await expect(page.getByTestId("sidebar-search")).toBeVisible();
  await expect(page.getByTestId("sidebar-ask-wiki")).toBeVisible();

  const sidebarBox = await sb.boundingBox();
  expect(sidebarBox).not.toBeNull();
  expect(sidebarBox!.width).toBeGreaterThan(120);
}

test.describe("Page load experience", () => {
  test.describe.configure({ timeout: 90_000 });

  test("server-rendered shell keeps sidebar chrome across key routes", async ({ request }) => {
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

  test("mobile initial paint keeps the bottom-nav affordance", async ({ page }) => {
    await page.setViewportSize(mobileViewport);
    await blockAppScripts(page);
    await page.goto(withMagicLink("/about/Index"), { waitUntil: "commit" });

    const bottomBar = page.getByTestId("bottom-nav-trigger");

    await expect(bottomBar).toBeVisible();

    const bottomBarBox = await bottomBar.boundingBox();
    expect(bottomBarBox).not.toBeNull();
    expect(bottomBarBox!.y).toBeGreaterThan(mobileViewport.height - 120);
    expect(bottomBarBox!.y + bottomBarBox!.height).toBeLessThanOrEqual(
      mobileViewport.height + 1
    );
  });
});
