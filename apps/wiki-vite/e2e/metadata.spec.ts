import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from "@playwright/test";

const DEFAULT_DESCRIPTION = "Breast cancer research and treatment knowledge base";
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
      const insurance = await getHtml(botRequest, "/wiki/logistics/insurance");

      expect(readTitle(insurance)).toBe("Insurance \u2014 TNBC Knowledge Base");
      expect(readMetaContent(insurance, "og:title")).toBe("Insurance");
      expect(readMetaContent(insurance, "og:description")).toBeTruthy();
      expect(readMetaContent(insurance, "description")).not.toBe(DEFAULT_DESCRIPTION);
      expect(readMetaContent(insurance, "robots")).toBe("noindex,nofollow");
      expect(insurance).not.toContain("Diana Laster");
      expect(insurance).not.toContain("MRN");
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
});
