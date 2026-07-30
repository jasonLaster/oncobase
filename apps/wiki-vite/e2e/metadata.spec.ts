import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  documentArticle,
  gotoWiki,
  installWikiApiMocks,
} from "./fixtures";

const DEFAULT_DESCRIPTION = "Breast cancer research and treatment knowledge base";
const INSURANCE_DESCRIPTION =
  "Overview of fall 2026 open enrollment options for 2027 plans focusing on supplemental insurance to mitigate future financial risks for breast cancer...";
const INSURANCE_TITLE = "Insurance & supplemental benefits Planning";
const LINK_PREVIEW_USER_AGENT =
  "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)";
const runsAgainstProductionServer = Boolean(process.env.PLAYWRIGHT_BASE_URL);
const previewBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

function previewBypassHeaders(): Record<string, string> {
  if (!previewBypassSecret) {
    return {};
  }

  return { "x-vercel-protection-bypass": previewBypassSecret };
}

function decodeHtml(value: string) {
  return value
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&");
}

function readTitle(html: string) {
  const match = html.match(/<title>([^<]+)<\/title>/);
  return match ? decodeHtml(match[1]) : "";
}

function readMetaContent(html: string, selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(
    new RegExp(`<meta\\s+(?:name|property)=["']${escapedSelector}["'][^>]*content=["']([^"']+)["'][^>]*>`)
  );
  return match ? decodeHtml(match[1]) : "";
}

async function getHtml(request: APIRequestContext, path: string) {
  const response = await request.get(path);
  const html = await response.text();
  expect(response.ok(), html).toBeTruthy();
  return html;
}

async function expectClientMetadata(
  page: Page,
  expected: {
    description: string;
    openGraphDescription: string;
    openGraphTitle: string;
    title: string;
    twitterDescription: string;
    twitterTitle: string;
  },
) {
  await expect(page).toHaveTitle(expected.title);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    expected.description,
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    expected.openGraphTitle,
  );
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
    "content",
    expected.openGraphDescription,
  );
  await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute(
    "content",
    expected.twitterTitle,
  );
  await expect(page.locator('meta[name="twitter:description"]')).toHaveAttribute(
    "content",
    expected.twitterDescription,
  );
}

test.describe("client route metadata", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
  });

  test("replaces every route-specific field across article, tag, and search navigation", async ({
    page,
  }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");
    await expectClientMetadata(page, {
      title: "Insurance — TNBC Knowledge Base",
      description: "Insurance planning notes.",
      openGraphTitle: "Insurance",
      openGraphDescription: "Insurance planning notes.",
      twitterTitle: "Insurance",
      twitterDescription: "Insurance planning notes.",
    });
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute(
      "content",
      "article",
    );
    await page.evaluate(() => {
      document.documentElement.dataset.metadataNavigationProbe = "alive";
    });

    await documentArticle(page)
      .locator(".tag-row")
      .getByRole("link", { name: "insurance", exact: true })
      .click();
    await expect(page).toHaveURL(/\/tags\/insurance$/);
    await expectClientMetadata(page, {
      title: "Tag: insurance — TNBC Knowledge Base",
      description: '1 pages tagged "insurance"',
      openGraphTitle: "Tag: insurance",
      openGraphDescription: '1 pages tagged "insurance"',
      twitterTitle: "TNBC Knowledge Base",
      twitterDescription: DEFAULT_DESCRIPTION,
    });
    await expect(page.locator('meta[property="og:type"]')).toHaveCount(0);

    await page.getByRole("button", { name: "Workspace menu" }).click();
    await page
      .getByRole("menu", { name: "Actions" })
      .getByRole("menuitem", { name: "Text Search" })
      .click();
    await expect(page).toHaveURL(/\/search(?:\?|$)/);
    await expectClientMetadata(page, {
      title: "Search — TNBC Knowledge Base",
      description: "Search across all wiki pages",
      openGraphTitle: "Search",
      openGraphDescription: "Search across all wiki pages",
      twitterTitle: "TNBC Knowledge Base",
      twitterDescription: DEFAULT_DESCRIPTION,
    });
    await expect(page.locator('meta[property="og:type"]')).toHaveCount(0);

    await page.getByTestId("wiki-sidebar").locator('a[href="/"]').click();
    await expect(page).toHaveURL(/\/$/);
    await expectClientMetadata(page, {
      title: "Home — TNBC Knowledge Base",
      description: DEFAULT_DESCRIPTION,
      openGraphTitle: "Home",
      openGraphDescription: DEFAULT_DESCRIPTION,
      twitterTitle: "TNBC Knowledge Base",
      twitterDescription: DEFAULT_DESCRIPTION,
    });
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute(
      "content",
      "website",
    );
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.dataset.metadataNavigationProbe,
        ),
      )
      .toBe("alive");
  });
});

test.describe("production page metadata", () => {
  test.skip(
    !runsAgainstProductionServer,
    "Production metadata is patched by the standalone/Vercel server, not the Vite dev server.",
  );

  test("serves page-specific metadata to link preview bots without a login cookie", async ({ baseURL }) => {
    const botRequest = await playwrightRequest.newContext({
      baseURL,
      extraHTTPHeaders: {
        ...previewBypassHeaders(),
        "user-agent": LINK_PREVIEW_USER_AGENT,
      },
      storageState: { cookies: [], origins: [] },
    });

    try {
      const home = await getHtml(botRequest, "/");
      const insurance = await getHtml(botRequest, "/wiki/logistics/insurance");
      const tag = await getHtml(botRequest, "/tags/summary");
      const search = await getHtml(botRequest, "/search");

      expect(readTitle(home)).toBe("Home — TNBC Knowledge Base");
      expect(readMetaContent(home, "description")).toBe(DEFAULT_DESCRIPTION);
      expect(readMetaContent(home, "og:title")).toBe("Home");
      expect(readMetaContent(home, "twitter:title")).toBe("TNBC Knowledge Base");

      expect(readTitle(insurance)).toBe(`${INSURANCE_TITLE} — TNBC Knowledge Base`);
      expect(readMetaContent(insurance, "description")).toBe(INSURANCE_DESCRIPTION);
      expect(readMetaContent(insurance, "og:title")).toBe(INSURANCE_TITLE);
      expect(readMetaContent(insurance, "twitter:title")).toBe(INSURANCE_TITLE);

      expect(readTitle(tag)).toBe("Tag: summary — TNBC Knowledge Base");
      expect(readMetaContent(tag, "description")).toBe('6 pages tagged "summary"');
      expect(readMetaContent(tag, "og:title")).toBe("Tag: summary");
      expect(readMetaContent(tag, "twitter:title")).toBe("TNBC Knowledge Base");

      expect(readTitle(search)).toBe("Search — TNBC Knowledge Base");
      expect(readMetaContent(search, "description")).toBe("Search across all wiki pages");
      expect(readMetaContent(search, "og:title")).toBe("Search");
      expect(readMetaContent(search, "twitter:title")).toBe("TNBC Knowledge Base");

      for (const html of [home, insurance, tag, search]) {
        expect(readMetaContent(html, "robots")).toBe("noindex,nofollow");
        expect(html).not.toContain('rel="canonical"');
        expect(html).not.toContain('property="og:url"');
        expect(html).not.toContain("Diana Laster");
        expect(html).not.toContain("MRN");
      }
    } finally {
      await botRequest.dispose();
    }
  });

  test("keeps normal unauthenticated page requests behind login", async ({ baseURL }) => {
    const anonymousRequest = await playwrightRequest.newContext({
      baseURL,
      extraHTTPHeaders: previewBypassHeaders(),
      storageState: { cookies: [], origins: [] },
    });

    try {
      const response = await anonymousRequest.get("/wiki/logistics/insurance", {
        maxRedirects: 0,
      });

      expect(response.status()).toBe(302);
      expect(response.headers().location).toContain(
        "/login?redirect=%2Fwiki%2Flogistics%2Finsurance"
      );
    } finally {
      await anonymousRequest.dispose();
    }
  });

  test("keeps authenticated gated routes noindex with site-level home social metadata", async ({
    request,
  }) => {
    for (const path of ["/", "/index", "/about/About", "/search", "/login"]) {
      const html = await getHtml(request, path);
      expect(readMetaContent(html, "robots")).toBe("noindex, nofollow");
      expect(html).not.toContain('rel="canonical"');
    }

    const home = await getHtml(request, "/");
    expect(readTitle(home)).toBe("Home — TNBC Knowledge Base");
    expect(readMetaContent(home, "description")).toBe(DEFAULT_DESCRIPTION);
    expect(readMetaContent(home, "og:title")).toBe("Home");
    expect(readMetaContent(home, "twitter:title")).toBe("TNBC Knowledge Base");

    const about = await getHtml(request, "/about/About");
    expect(readTitle(about)).toBe("About This Wiki — TNBC Knowledge Base");
    expect(readMetaContent(about, "twitter:title")).toBe("About This Wiki");

    const tag = await getHtml(request, "/tags/summary");
    expect(readTitle(tag)).toBe("Tag: summary — TNBC Knowledge Base");
    expect(readMetaContent(tag, "description")).toBe('6 pages tagged "summary"');
    expect(readMetaContent(tag, "og:title")).toBe("Tag: summary");
    expect(readMetaContent(tag, "twitter:title")).toBe("TNBC Knowledge Base");
    expect(readMetaContent(tag, "twitter:description")).toBe(DEFAULT_DESCRIPTION);

    const search = await getHtml(request, "/search");
    expect(readTitle(search)).toBe("Search — TNBC Knowledge Base");
    expect(readMetaContent(search, "description")).toBe("Search across all wiki pages");
    expect(readMetaContent(search, "og:title")).toBe("Search");
    expect(readMetaContent(search, "twitter:title")).toBe("TNBC Knowledge Base");
    expect(readMetaContent(search, "twitter:description")).toBe(DEFAULT_DESCRIPTION);

    const login = await request.get("/login", { maxRedirects: 0 });
    expect(login.status()).toBe(302);
    expect(login.headers().location).toMatch(/\/$/);
    expect(login.headers()["cache-control"]).toBe("private, no-store");
    expect(login.headers().vary).toContain("Cookie");
    expect(login.headers().vary).toContain("Host");
  });
});
