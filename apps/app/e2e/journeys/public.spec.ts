import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from "@playwright/test";
import { makePublicWikiSessionIdentity, WIKI_READER_CACHE_VERSION } from "@oncobase/wiki-content";
import { documentArticle, gotoWiki, installWikiApiMocks } from "../fixtures";

// Signed-out visitors: the landing page, sign-in, terms, education, theme and
// link previews. Tests that need the deployed gate are skipped locally.
const signedOut = { storageState: { cookies: [], origins: [] } };
const deployed = Boolean(process.env.PLAYWRIGHT_BASE_URL);
const previewBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const previewBypassHeaders: Record<string, string> = previewBypassSecret
  ? { "x-vercel-protection-bypass": previewBypassSecret }
  : {};

test.describe("signed-out landing and sign-in", () => {
  test.use(signedOut);
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("the landing page lays out its sections and navigates to sign-in", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "It takes a village.", level: 1 })).toBeVisible();

    // Sections appear in order, and Oncobase's open-source band comes first of the features.
    const order = await page.evaluate(() =>
      ["story", "platform", "inside", "education"].map(
        (id) => document.getElementById(id)!.getBoundingClientRect().top + scrollY,
      ),
    );
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    await expect(
      page.locator("#platform").getByRole("link", { name: /View Oncobase on GitHub/ }),
    ).toHaveAttribute("href", "https://github.com/jasonLaster/oncobase");

    // The sub header lists this page's sections; the primary row is the same on every public page.
    const sections = page.getByRole("navigation", { name: "Page sections" });
    for (const [link, heading] of [
      ["Our story", "#story-title"],
      ["Oncobase", "#platform-title"],
      ["What’s inside", "#inside-title"],
      ["Education", "#education-title"],
    ]) {
      await sections.getByRole("link", { name: link, exact: true }).click();
      await expect(page.locator(heading)).toBeInViewport();
      await expect(sections.getByRole("link", { name: link, exact: true })).toHaveAttribute(
        "aria-current",
        "location",
      );
    }
    // Features and the comparison live on their own pages.
    const primary = page.getByRole("navigation", { name: "Main navigation" });
    expect(await primary.getByRole("link").allTextContents()).toEqual(["Features", "Compare"]);
    await expect(primary.getByRole("link", { name: "Features", exact: true })).toHaveAttribute(
      "href",
      "/features",
    );
    await expect(primary.getByRole("link", { name: "Compare", exact: true })).toHaveAttribute(
      "href",
      "/compare",
    );
    // On a phone the header stays two rows tall, with the primary links in the sub header's row.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(primary).toBeHidden();
    await expect(sections.getByRole("link", { name: "Compare", exact: true })).toBeVisible();
    expect((await page.locator(".lp-header-shell").boundingBox())!.height).toBeLessThanOrEqual(112);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(page.locator("footer").getByRole("link", { name: "Compare" })).toHaveAttribute(
      "href",
      "/compare",
    );
    await expect(
      page.locator("#platform").getByRole("link", { name: /See everything it can do/ }),
    ).toHaveAttribute("href", "/features");

    // Education and terms are public links; the password form lives on its own page.
    await expect(
      page.getByRole("link", { name: "Browse educational content" }).first(),
    ).toHaveAttribute("href", "/education");
    await expect(page.getByRole("link", { name: "Terms & conditions" })).toHaveAttribute(
      "href",
      "/terms-and-conditions",
    );
    await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByLabel("Password", { exact: true })).toBeInViewport();

    await page.goto("/login");
    await page.getByRole("link", { name: "View Diana’s knowledge base", exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test("the education cartoons lead with two, follow with three, and swipe on phones", async ({
    page,
  }) => {
    for (const width of [1440, 393]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/login");
      const guides = page.locator(".lp-guides");
      await expect(guides.locator("> .lp-guide")).toHaveCount(5);
      const boxes = await guides
        .locator("> .lp-guide")
        .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().toJSON()));
      if (width > 700) {
        expect(boxes[1]!.y).toBe(boxes[0]!.y);
        expect(boxes[3]!.y).toBe(boxes[2]!.y);
        expect(boxes[4]!.y).toBe(boxes[2]!.y);
        expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height);
        expect(await guides.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      } else {
        // One row that scrolls sideways, about one card tall, with the next card peeking in.
        expect(new Set(boxes.map((box) => box.y)).size).toBe(1);
        expect(await guides.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
        expect(boxes[1]!.x).toBeLessThan(width);
        expect(boxes[0]!.height).toBeLessThan(520);
      }
      // Every cartoon opens a public guide, and the tour cards open the features page.
      for (const href of await guides.locator("a").evaluateAll((links) => links.map((link) => link.getAttribute("href")))) {
        expect(href).toMatch(/^\/education\//);
      }
      for (const card of await page.locator(".lp-tour > a").all()) {
        expect(await card.getAttribute("href")).toMatch(/^\/features#/);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });

  test("the landing page makes no reader or clinical data requests", async ({ page }) => {
    const readerRequests: string[] = [];
    await page.route("**/api/wiki/**", async (route) => {
      // Page-view telemetry is a write-only beacon, not reader data.
      if (!route.request().url().endsWith("/api/wiki/telemetry"))
        readerRequests.push(route.request().url());
      await route.fulfill({ status: 503, body: "{}" });
    });
    await page.goto("/login");
    // Images are lazy; visit each so every themed variant is requested.
    await expect(page.locator("#landing-main img")).toHaveCount(7);
    for (const image of await page.locator("#landing-main img").all()) {
      await image.scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0),
        )
        .toBe(true);
    }
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.locator("footer")).toBeInViewport();
    expect(readerRequests).toEqual([]);

    // The server's landing response at "/" also never asks for a reader session.
    await page.route(
      (url) => url.pathname === "/",
      async (route) => {
        const response = await route.fetch();
        const html = (await response.text()).replace(
          "</head>",
          '<meta name="wiki-reader-access" content="landing" /></head>',
        );
        await route.fulfill({ response, body: html });
      },
    );
    const sessionRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/wiki/session")
        sessionRequests.push(request.url());
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "It takes a village." })).toBeVisible();
    expect(sessionRequests).toEqual([]);
  });

  test("sign-in reports connection and server failures and allows a retry", async ({ page }) => {
    let attempt = 0;
    await page.route("**/api/login", async (route) => {
      attempt++;
      if (attempt === 1) await route.abort("failed");
      else await route.fulfill({ status: 503, body: "{}" });
    });
    await page.goto("/sign-in");
    const enter = page.getByRole("button", { name: "Enter Diana’s knowledge base", exact: true });
    await page.getByLabel("Password", { exact: true }).fill("test-password");
    await enter.click();
    await expect(page.getByRole("alert")).toHaveText("Unable to connect. Please try again.");
    await expect(enter).toBeEnabled();
    await enter.click();
    await expect(page.getByRole("alert")).toHaveText(
      "Sign in is temporarily unavailable. Please try again.",
    );
  });

  test("a private link asks for the password and continues to the original page", async ({
    page,
  }) => {
    await page.route("**/api/login", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
    );
    await page.route("**/wiki/care/index", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<title>Current care</title>" }),
    );
    await page.goto("/login");
    const contents = page.locator(".lp-contents");
    // Published guides need no password; clinical pages route through sign-in.
    await expect(contents.getByRole("link", { name: "Designing a vaccine" })).toHaveAttribute(
      "href",
      "/education/designing-a-vaccine/index",
    );
    const currentCare = contents.getByRole("link", { name: /^Current care/ });
    await expect(currentCare).toHaveAccessibleName("Current care Sign in required");
    await currentCare.click();
    await expect(page).toHaveURL(/\/sign-in\?redirect=%2Fwiki%2Fcare%2Findex$/);
    await expect(
      page.getByText("Enter the shared password to continue to the page you opened."),
    ).toBeVisible();
    await page.getByLabel("Password", { exact: true }).fill("test-password");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/wiki\/care\/index$/);

    // A redirect param goes straight to sign-in; a bare visit shows the landing page.
    await page.goto("/login?redirect=%2Fwiki%2Fcare%2Findex");
    await expect(page.getByTestId("sign-in-page")).toBeVisible();
    await expect(page).toHaveTitle("Sign in — Diana TNBC Knowledge Base");
    await page.goto("/login");
    await expect(page.getByTestId("login-page")).toBeVisible();
    await expect(page.getByTestId("sign-in-page")).toHaveCount(0);
  });

  test("the theme follows the system, is remembered when overridden, and reaches sign-in", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    const failedAssets: string[] = [];
    page.on("response", (response) => {
      if (response.url().includes("/landing/") && response.status() >= 400)
        failedAssets.push(response.url());
    });
    await page.goto("/login");
    const toggle = page.getByRole("button", { name: "Dark theme" });
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("html")).toHaveClass(/dark/);
    expect(await page.evaluate(() => localStorage.getItem("theme"))).toBeNull();
    const themed = page.locator("#landing-main img[src*='-light.'], #landing-main img[src*='-dark.']");
    await expect(themed).toHaveCount(7);
    expect(
      await themed.evaluateAll((images) =>
        images.every((image) => image.getAttribute("src")!.includes("-dark.")),
      ),
    ).toBe(true);

    // Light differs from the system, so it is remembered across reloads.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await page.reload();
    await expect(page.getByRole("button", { name: "Dark theme" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("light");
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await expect(
      page.locator("#landing-main img[src*='-dark.']"),
    ).toHaveCount(0);

    // The choice carries to the sign-in page.
    await page.getByRole("link", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.locator(".si-cartoon img")).toHaveAttribute(
      "src",
      /sign-in-cartoon-light\.webp$/,
    );

    // Choosing the system's own theme goes back to following the system.
    await page.getByRole("button", { name: "Dark theme" }).click();
    expect(await page.evaluate(() => localStorage.getItem("theme"))).toBeNull();
    await expect(page.locator(".si-cartoon img")).toHaveAttribute(
      "src",
      /sign-in-cartoon-dark\.webp$/,
    );
    expect(failedAssets).toEqual([]);
  });

  for (const route of [
    { path: "/login", testId: "login-page" },
    { path: "/sign-in", testId: "sign-in-page" },
    { path: "/features", testId: "features-page" },
    { path: "/compare", testId: "compare-page" },
    { path: "/terms-and-conditions", testId: "terms-and-conditions" },
  ]) {
    test(`${route.path} does not require the reader session or database`, async ({
      page,
    }) => {
      // An expired reader session must not block sign-in or public terms.
      await page.addInitScript(() => localStorage.setItem("wiki-vite-scope", "session"));
      const readerRequests: string[] = [];
      await page.route("**/api/wiki/**", async (request) => {
        readerRequests.push(new URL(request.request().url()).pathname);
        await request.fulfill({ status: 503, contentType: "application/json", body: "{}" });
      });
      const databaseModules: string[] = [];
      page.on("request", (request) => {
        if (/LiveStoreRoot/.test(request.url())) databaseModules.push("LiveStoreRoot");
      });
      await page.goto(route.path);
      await expect(page.getByTestId(route.testId)).toBeVisible();
      await expect(page.getByTestId("session-recovery")).toHaveCount(0);
      await expect(page.getByTestId("wiki-sidebar")).toHaveCount(0);
      expect(readerRequests).toEqual([]);
      expect(databaseModules).toEqual([]);
    });
  }
});

test.describe("education guests (deployed gate)", () => {
  test.use({ ...signedOut, extraHTTPHeaders: { "x-wiki-test-run": "1" } });
  test.skip(!deployed, "Requires the standalone app-shell password gate.");
  const slug = "wiki/education/oncology-101/index";
  const route = `/${slug}`;

  test("guests read, browse, and search education without a password", async ({ page, request }) => {
    test.setTimeout(90_000);
    const manifest = await (await request.get("/api/wiki/manifest")).json();
    expect(manifest.pages.length).toBeGreaterThan(0);
    expect(
      manifest.pages.every(
        (entry: { slug: string; sensitive: boolean }) =>
          entry.slug.startsWith("wiki/education/") && !entry.sensitive,
      ),
    ).toBe(true);
    // The text-search API can return a partial indexed response while warming.
    await expect
      .poll(
        async () => {
          const search = await (await request.get("/api/search?q=immunotherapy")).json();
          expect(
            search.results.every((entry: { slug: string }) => entry.slug.startsWith("wiki/education/")),
          ).toBe(true);
          return search.results.length;
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);

    // The public library opens without the care reader.
    const readerRequests: string[] = [];
    page.on("request", (req) => {
      if (/\/api\/(?:wiki|auth|timeline|diagnostic-studies|chat)\b/.test(new URL(req.url()).pathname))
        readerRequests.push(req.url());
    });
    await page.goto("/education");
    await expect(page.getByRole("heading", { name: "The education library" })).toBeVisible();
    const input = page.getByRole("searchbox", { name: "Search education", exact: true });
    await page.keyboard.press("ControlOrMeta+k");
    await expect(input).toBeFocused();
    await input.fill("immunotherapy");
    await input.press("Enter");
    await expect(page).toHaveURL(/\/education\/search\?q=immunotherapy$/);
    await expect.poll(() => page.locator(".edu-result").count(), { timeout: 60_000 }).toBeGreaterThan(0);
    await page.locator(".edu-result").first().click();
    await expect(page.getByTestId("education-article").getByRole("heading", { level: 1 })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: /Results for/ })).toBeVisible();
    expect(readerRequests).toEqual([]);

    // One article image loads, and care content still demands a password.
    await page.goto(route);
    await expect(page.getByRole("heading", { name: /Oncology 101/, level: 1 })).toBeVisible();
    const cartoon = page.getByRole("img", { name: "immune recognition cartoon", exact: true });
    await cartoon.scrollIntoViewIfNeeded();
    await expect
      .poll(() => cartoon.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0))
      .toBe(true);
    await page.getByRole("link", { name: "Diagnostics", exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in\?redirect=/);
    for (const endpoint of [
      "/api/timeline",
      "/api/diagnostic-studies",
      "/api/wiki/convex-token",
      "/api/wiki/pages?slugs=wiki/care/index",
      "/api/chat",
    ]) {
      const response = await request.get(endpoint);
      expect(response.status(), endpoint).toBe(401);
    }
  });

  test("a remembered full-wiki cache cannot paint in the education guest reader", async ({
    page,
    request,
    baseURL,
  }) => {
    const manifest = await (await request.get("/api/wiki/manifest")).json();
    const batch = await (await request.get(`/api/wiki/pages?slugs=${slug}`)).json();
    const origin = new URL(baseURL!).origin;
    const partition = `${origin}|${origin}`;
    const marker = "Previously authorized care cache must not render";
    const snapshot = {
      version: 1,
      partition,
      readerVersion: WIKI_READER_CACHE_VERSION,
      identity: makePublicWikiSessionIdentity("diana"),
      accountTag: "public",
      validatedAt: Date.now(),
      manifest,
      bodies: [
        {
          pathname: route,
          fetchedAt: Date.now(),
          page: { ...batch.pages[0], content: `# ${marker}` },
        },
      ],
    };
    type Leak = { educationCacheLeak: boolean };
    await page.addInitScript(
      ({ key, snapshot, marker }) => {
        localStorage.setItem(key, JSON.stringify(snapshot));
        (window as unknown as Leak).educationCacheLeak = false;
        new MutationObserver(() => {
          if (document.body?.innerText.includes(marker))
            (window as unknown as Leak).educationCacheLeak = true;
        }).observe(document, { childList: true, subtree: true });
      },
      { key: `wiki-vite:startup:${WIKI_READER_CACHE_VERSION}:${partition}`, snapshot, marker },
    );
    await page.goto(route);
    await expect(page.getByRole("heading", { name: /Oncology 101/, level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Collapse education", exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as Leak).educationCacheLeak)).toBe(false);
  });
});

test.describe("link previews and metadata", () => {
  test("client navigation replaces every route-specific metadata field", async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/wiki/logistics/insurance");
    await expect(page).toHaveTitle("Insurance — TNBC Knowledge Base");
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Insurance");
    await expect(page.locator('meta[name="twitter:description"]')).toHaveAttribute(
      "content",
      "Insurance planning notes.",
    );
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute("content", "article");

    await documentArticle(page)
      .locator(".tag-row")
      .getByRole("link", { name: "insurance", exact: true })
      .click();
    await expect(page).toHaveURL(/\/tags\/insurance$/);
    await expect(page).toHaveTitle("Tag: insurance — TNBC Knowledge Base");
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
      "content",
      '1 pages tagged "insurance"',
    );
    // Article-only fields do not leak onto the tag page.
    await expect(page.locator('meta[property="og:type"]')).toHaveCount(0);
    await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute(
      "content",
      "TNBC Knowledge Base",
    );
  });

  test.describe("deployed server", () => {
    test.skip(!deployed, "Production metadata is patched by the standalone/Vercel server, not Vite.");

    test("serves page-specific metadata to link preview bots without a login cookie", async ({
      baseURL,
    }) => {
      const bot = await playwrightRequest.newContext({
        baseURL,
        extraHTTPHeaders: {
          ...previewBypassHeaders,
          "user-agent": "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
        },
        storageState: { cookies: [], origins: [] },
      });
      try {
        const home = await getHtml(bot, "/");
        const insurance = await getHtml(bot, "/wiki/logistics/insurance");
        // A shared bare domain previews the landing page for signed-out readers.
        expect(readTitle(home)).toBe("Diana TNBC Knowledge Base");
        expect(readMeta(home, "og:title")).toBe("It takes a village");
        expect(readMeta(home, "twitter:card")).toBe("summary_large_image");
        const image = readMeta(home, "og:image");
        expect(new URL(image).pathname).toBe("/landing/og-image.jpg");
        const imageResponse = await bot.get(image);
        expect(imageResponse.ok()).toBe(true);
        expect(imageResponse.headers()["content-type"]).toContain("image/jpeg");

        expect(readTitle(insurance)).toBe("Insurance & supplemental benefits Planning — TNBC Knowledge Base");
        expect(readMeta(insurance, "og:title")).toBe("Insurance & supplemental benefits Planning");
        for (const html of [home, insurance]) {
          expect(readMeta(html, "robots")).toBe("noindex,nofollow");
          expect(html).not.toContain('rel="canonical"');
          expect(html).not.toContain("Diana Laster");
          expect(html).not.toContain("MRN");
        }
      } finally {
        await bot.dispose();
      }
    });

    test("keeps normal unauthenticated page requests behind login", async ({ baseURL }) => {
      const anonymous = await playwrightRequest.newContext({
        baseURL,
        extraHTTPHeaders: previewBypassHeaders,
        storageState: { cookies: [], origins: [] },
      });
      try {
        const response = await anonymous.get("/wiki/logistics/insurance", { maxRedirects: 0 });
        expect(response.status()).toBe(302);
        expect(response.headers().location).toContain(
          "/sign-in?redirect=%2Fwiki%2Flogistics%2Finsurance",
        );
      } finally {
        await anonymous.dispose();
      }
    });
  });
});

function decodeHtml(value: string) {
  return value.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

function readTitle(html: string) {
  const match = html.match(/<title>([^<]+)<\/title>/);
  return match ? decodeHtml(match[1]) : "";
}

function readMeta(html: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(
    new RegExp(`<meta\\s+(?:name|property)=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`),
  );
  return match ? decodeHtml(match[1]) : "";
}

async function getHtml(request: APIRequestContext, path: string) {
  const response = await request.get(path);
  const html = await response.text();
  expect(response.ok(), html).toBeTruthy();
  return html;
}
