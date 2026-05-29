import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from "@playwright/test";

const DEFAULT_DESCRIPTION = "Breast cancer research and treatment knowledge base";
const LINK_PREVIEW_USER_AGENT =
  "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)";
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
  expect(response.ok()).toBeTruthy();
  return response.text();
}

test.describe("page metadata", () => {
  test("renders page-specific title and description for authenticated wiki pages", async ({ request }) => {
    const diagnosis = await getHtml(request, "/wiki/diagnostics/diagnosis");
    const survival = await getHtml(request, "/wiki/prognosis/survival-statistics");

    expect(readTitle(diagnosis)).toBe("Diagnosis \u2014 TNBC Knowledge Base");
    expect(readTitle(survival)).toBe("Survival statistics \u2014 TNBC Knowledge Base");

    const diagnosisDescription = readMetaContent(diagnosis, "description");
    const survivalDescription = readMetaContent(survival, "description");

    expect(diagnosisDescription).toBeTruthy();
    expect(survivalDescription).toBeTruthy();
    expect(diagnosisDescription).not.toBe(DEFAULT_DESCRIPTION);
    expect(survivalDescription).not.toBe(DEFAULT_DESCRIPTION);
    expect(diagnosisDescription).not.toBe(survivalDescription);
    expect(readMetaContent(diagnosis, "og:title")).toBe("Diagnosis");
    expect(readMetaContent(survival, "og:title")).toBe("Survival statistics");
  });

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
      const diagnosis = await getHtml(botRequest, "/wiki/diagnostics/diagnosis");
      const survival = await getHtml(botRequest, "/wiki/prognosis/survival-statistics");

      expect(readTitle(diagnosis)).toBe("Diagnosis \u2014 TNBC Knowledge Base");
      expect(readTitle(survival)).toBe("Survival statistics \u2014 TNBC Knowledge Base");
      expect(readMetaContent(diagnosis, "og:title")).toBe("Diagnosis");
      expect(readMetaContent(survival, "og:title")).toBe("Survival statistics");
      expect(readMetaContent(diagnosis, "description")).not.toBe(DEFAULT_DESCRIPTION);
      expect(diagnosis).not.toContain("MRN");
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
      const response = await anonymousRequest.get("/wiki/diagnostics/diagnosis", {
        maxRedirects: 0,
      });

      expect(response.status()).toBe(307);
      expect(response.headers().location).toContain(
        "/login?redirect=%2Fwiki%2Fdiagnostics%2Fdiagnosis"
      );
    } finally {
      await anonymousRequest.dispose();
    }
  });
});
