import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from "@playwright/test";

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

    const login = await getHtml(request, "/login");
    expect(readTitle(login)).toBe("TNBC Knowledge Base");
    expect(readMetaContent(login, "og:title")).toBe("TNBC Knowledge Base");
  });
});
