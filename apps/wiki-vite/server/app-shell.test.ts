import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getFunctionName, type FunctionReference } from "convex/server";
import { createWikiGateSession } from "@oncobase/wiki-content/gate-session";
import { createWikiViteHandler } from "./app-shell";

const TEST_GATE_SECRET = "app-shell-test-gate-secret";
const TEST_GATE_HASH = "sha256:app-shell-test-password";
const INDEX_HTML =
  "<!doctype html><html><head><link rel=\"icon\" type=\"image/svg+xml\" href=\"/favicon.svg\" /><title>Diana Wiki</title></head><body><div id=\"root\"></div></body></html>";
const LONG_DESCRIPTION =
  "Overview of fall 2026 open enrollment options for 2027 plans focusing on supplemental insurance to mitigate future financial risks for breast cancer patients and their families.";
const TRUNCATED_DESCRIPTION =
  "Overview of fall 2026 open enrollment options for 2027 plans focusing on supplemental insurance to mitigate future financial risks for breast cancer...";

function request(pathname: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Host", "127.0.0.1");
  return new Request(`http://127.0.0.1${pathname}`, {
    ...init,
    headers,
  });
}

async function authenticatedHeaders(extraCookie = "") {
  const token = await createWikiGateSession({
    gateVersion: JSON.stringify([true, TEST_GATE_HASH]),
    secret: TEST_GATE_SECRET,
    siteSlug: "diana",
  });
  return {
    Cookie: `authed=${token}${extraCookie ? `; ${extraCookie}` : ""}`,
  };
}

function fakeClient({ canAccessSensitive = true, passwordGate = true } = {}) {
  return {
    async query(ref: FunctionReference<"query">, args: Record<string, unknown>) {
      switch (getFunctionName(ref)) {
        case "sites:getBySlug":
          return {
            slug: args.slug,
            config: {
              passwordGate,
              passwordHash: TEST_GATE_HASH,
            },
          };
        case "documents:listManifestPage":
          return {
            page: [{ slug: "wiki/public" }],
            isDone: true,
            continueCursor: null,
          };
        case "documents:listPdfAssetPathsPage":
          return {
            page: [],
            isDone: true,
            continueCursor: null,
          };
        case "documents:getBySlug":
          if (args.slug === "search") return null;
          if (args.slug === "private/plan") {
            if (args.includeSensitive !== true) return null;
            return {
              slug: "private/plan",
              title: "Private Plan",
              content: "# Private Plan",
              description: "Sensitive treatment planning details.",
              sensitive: true,
            };
          }
          return {
            slug: args.slug,
            title:
              args.slug === "index"
                ? "Index"
                : args.slug === "about/About"
                  ? "About This Wiki"
                  : args.slug === "wiki/long"
                    ? "Long Article"
                  : "Public",
            description: args.slug === "wiki/long" ? LONG_DESCRIPTION : "Public page",
            content: `# ${String(args.slug)}`,
            sensitive: false,
          };
        case "users:getSessionUser":
          return { _id: "user-1" };
        case "access:canUserAccessSlug":
          return canAccessSensitive;
        default:
          throw new Error(`Unexpected query ${getFunctionName(ref)}`);
      }
    },
    async action(ref: FunctionReference<"action">) {
      switch (getFunctionName(ref)) {
        case "documents:getByTag":
          return Array.from({ length: 6 }, (_, index) => ({
            slug: `wiki/tagged-${index}`,
          }));
        default:
          throw new Error(`Unexpected action ${getFunctionName(ref)}`);
      }
    },
  };
}

describe("wiki Vite app-shell password gate", () => {
  let distDir = "";

  beforeEach(async () => {
    process.env.WIKI_GATE_SESSION_SECRET = TEST_GATE_SECRET;
    distDir = await mkdtemp(path.join(tmpdir(), "wiki-vite-app-shell-"));
    await mkdir(path.join(distDir, "assets"));
    await writeFile(path.join(distDir, "index.html"), INDEX_HTML);
    await writeFile(path.join(distDir, "assets", "app-deadbeef.js"), "export {};");
    await writeFile(
      path.join(distDir, "favicon.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    );
    await writeFile(path.join(distDir, "robots.txt"), "User-agent: *\nDisallow: /\n");
  });

  afterEach(async () => {
    delete process.env.WIKI_GATE_SESSION_SECRET;
    await rm(distDir, { recursive: true, force: true });
  });

  test("gates anonymous root and deep links with private redirect responses", async () => {
    const handler = createWikiViteHandler({
      client: fakeClient() as never,
      distDir,
    });

    for (const pathname of ["/", "/wiki/public?view=compact"]) {
      const response = await handler(request(pathname));

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        `http://127.0.0.1/login?redirect=${encodeURIComponent(pathname)}`,
      );
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("vary")).toContain("Cookie");
      expect(response.headers.get("vary")).toContain("Host");
    }
  });

  test("gates standalone content APIs but accepts a signed gate cookie", async () => {
    const handler = createWikiViteHandler({
      client: fakeClient() as never,
      distDir,
    });

    for (const pathname of [
      "/api/wiki/manifest",
      "/api/wiki/pages?slugs=wiki/public",
      "/api/search?q=public",
      "/api/download?type=markdown",
      "/api/file?path=sources/public/source.pdf",
    ]) {
      const response = await handler(request(pathname));
      expect(response.status, pathname).toBe(401);
      expect(response.headers.get("cache-control"), pathname).toBe(
        "private, no-store",
      );
      expect(response.headers.get("vary"), pathname).toContain("Cookie");
      expect(response.headers.get("vary"), pathname).toContain("Host");
    }

    const authenticated = await handler(
      request("/api/wiki/pages?slugs=wiki/public", {
        headers: await authenticatedHeaders(),
      }),
    );
    expect(authenticated.status).toBe(200);
  });

  test("serves terms publicly with legal metadata while the wiki remains gated", async () => {
    const handler = createWikiViteHandler({
      client: fakeClient() as never,
      distDir,
    });

    const response = await handler(request("/terms-and-conditions"));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("<title>Terms and Conditions — TNBC Knowledge Base</title>");
    expect(html).toContain(
      '<meta name="description" content="Terms and conditions for the Diana TNBC Knowledge Base." />',
    );
    expect(response.headers.get("location")).toBeNull();
  });

  test("rejects the unsigned legacy gate cookie", async () => {
    const handler = createWikiViteHandler({
      client: fakeClient() as never,
      distDir,
    });

    const response = await handler(
      request("/", { headers: { Cookie: "authed=true" } }),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1/login?redirect=%2F",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
    expect(response.headers.get("vary")).toContain("Host");
  });

  test("never exchanges a password-bearing query for a gate session", async () => {
    const handler = createWikiViteHandler({
      client: fakeClient() as never,
      distDir,
    });

    const response = await handler(
      request("/wiki/public?token=diana&view=compact"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1/login?redirect=%2Fwiki%2Fpublic%3Fview%3Dcompact",
    );
    expect(response.headers.get("location")).not.toContain("token");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  test("keeps authenticated login redirects on the current origin", async () => {
    const handler = createWikiViteHandler({
      client: fakeClient() as never,
      distDir,
    });
    const headers = await authenticatedHeaders();

    const local = await handler(
      request("/login?redirect=%2Fwiki%2Fpublic%3Fview%3Dcompact", { headers }),
    );
    expect(local.status).toBe(302);
    expect(local.headers.get("location")).toBe(
      "http://127.0.0.1/wiki/public?view=compact",
    );

    for (const redirect of ["https://evil.example/phish", "//evil.example/phish"]) {
      const unsafe = await handler(
        request(`/login?redirect=${encodeURIComponent(redirect)}`, { headers }),
      );
      expect(unsafe.status).toBe(302);
      expect(unsafe.headers.get("location")).toBe("http://127.0.0.1/");
    }
  });

  test("serves authenticated HTML privately while keeping hashed assets immutable", async () => {
    const handler = createWikiViteHandler({
      client: fakeClient() as never,
      distDir,
    });

    for (const pathname of ["/", "/wiki/public"]) {
      const response = await handler(
        request(pathname, { headers: await authenticatedHeaders() }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("vary")).toContain("Cookie");
      expect(await response.text()).toContain('<div id="root"></div>');
    }

    const asset = await handler(request("/assets/app-deadbeef.js"));
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  test("serves the favicon and a gate-aware robots policy outside the password gate", async () => {
    const handler = createWikiViteHandler({
      client: fakeClient() as never,
      distDir,
    });

    const favicon = await handler(request("/favicon.svg"));
    expect(favicon.status).toBe(200);
    expect(favicon.headers.get("content-type")).toBe("image/svg+xml");
    expect(favicon.headers.get("cache-control")).toBe("no-cache");

    const robots = await handler(request("/robots.txt"));
    expect(robots.status).toBe(200);
    expect(robots.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(robots.headers.get("cache-control")).toBe("no-cache");
    expect(robots.headers.get("vary")).toBe("Host");
    expect(await robots.text()).toBe("User-agent: *\nDisallow: /\n");

    const publicHandler = createWikiViteHandler({
      client: fakeClient({ passwordGate: false }) as never,
      distDir,
    });
    const publicRobots = await publicHandler(request("/robots.txt"));
    expect(await publicRobots.text()).toBe("User-agent: *\nAllow: /\n");

    const shell = await handler(
      request("/", { headers: await authenticatedHeaders() }),
    );
    expect(await shell.text()).toContain(
      '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />',
    );
  });

  test("keeps every password-gated shell out of indexes without exposing canonicals", async () => {
    const handler = createWikiViteHandler({
      client: fakeClient() as never,
      distDir,
    });

    for (const pathname of ["/", "/index", "/about/About", "/search"]) {
      const response = await handler(
        request(pathname, { headers: await authenticatedHeaders() }),
      );
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
      expect(html).not.toContain('rel="canonical"');
      expect(html).not.toContain('property="og:url"');
    }

    const home = await handler(request("/", { headers: await authenticatedHeaders() }));
    const homeHtml = await home.text();
    expect(homeHtml).toContain(
      '<meta name="twitter:title" content="TNBC Knowledge Base" />',
    );
    expect(homeHtml).toContain(
      '<meta property="og:title" content="Home" />',
    );

    const about = await handler(
      request("/about/About", { headers: await authenticatedHeaders() }),
    );
    expect(await about.text()).toContain(
      '<meta name="twitter:title" content="About This Wiki" />',
    );

    const login = await handler(request("/login?redirect=%2F"));
    const loginHtml = await login.text();
    expect(loginHtml).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(loginHtml).toContain(
      '<meta name="twitter:title" content="TNBC Knowledge Base" />',
    );
    expect(loginHtml).not.toContain('rel="canonical"');
  });

  test("renders route-specific titles, descriptions, and social metadata before hydration", async () => {
    const handler = createWikiViteHandler({
      client: fakeClient() as never,
      distDir,
    });
    const authenticated = { headers: await authenticatedHeaders() };
    const cases = [
      {
        path: "/",
        title: "Home — TNBC Knowledge Base",
        description: "Breast cancer research and treatment knowledge base",
        openGraphTitle: "Home",
        twitterTitle: "TNBC Knowledge Base",
      },
      {
        path: "/index",
        title: "Home — TNBC Knowledge Base",
        description: "Breast cancer research and treatment knowledge base",
        openGraphTitle: "Home",
        twitterTitle: "TNBC Knowledge Base",
      },
      {
        path: "/wiki/public",
        title: "Public — TNBC Knowledge Base",
        description: "Public page",
        openGraphTitle: "Public",
        twitterTitle: "Public",
      },
      {
        path: "/tags/summary",
        title: "Tag: summary — TNBC Knowledge Base",
        description: '6 pages tagged "summary"',
        openGraphTitle: "Tag: summary",
        twitterTitle: "TNBC Knowledge Base",
      },
      {
        path: "/search",
        title: "Search — TNBC Knowledge Base",
        description: "Search across all wiki pages",
        openGraphTitle: "Search",
        twitterTitle: "TNBC Knowledge Base",
      },
      {
        path: "/comments",
        title: "Comments — TNBC Knowledge Base",
        description: "Recent comments and discussions",
        openGraphTitle: "Comments",
        twitterTitle: "TNBC Knowledge Base",
      },
      {
        path: "/chat/thread-1",
        title: "Chat — TNBC Knowledge Base",
        description: "Ask questions about TNBC research and treatment",
        openGraphTitle: "Chat",
        twitterTitle: "TNBC Knowledge Base",
      },
      {
        path: "/diagnostics",
        title: "Diagnostics — TNBC Knowledge Base",
        description: "Breast cancer research and treatment knowledge base",
        openGraphTitle: "TNBC Knowledge Base",
        twitterTitle: "TNBC Knowledge Base",
      },
      {
        path: "/diagnostics/imaging",
        title: "Diagnostic Imaging — TNBC Knowledge Base",
        description: "Breast cancer research and treatment knowledge base",
        openGraphTitle: "TNBC Knowledge Base",
        twitterTitle: "TNBC Knowledge Base",
      },
      {
        path: "/tools/dicom-viewer",
        title: "DICOM Viewer — TNBC Knowledge Base",
        description: "Breast cancer research and treatment knowledge base",
        openGraphTitle: "TNBC Knowledge Base",
        twitterTitle: "TNBC Knowledge Base",
      },
      {
        path: "/tools/dicom-compare",
        title: "DICOM Comparison — TNBC Knowledge Base",
        description: "Breast cancer research and treatment knowledge base",
        openGraphTitle: "TNBC Knowledge Base",
        twitterTitle: "TNBC Knowledge Base",
      },
      {
        path: "/tools/medical-deduction",
        title: "Medical Expense Deduction Calculator — TNBC Knowledge Base",
        description: "Breast cancer research and treatment knowledge base",
        openGraphTitle: "TNBC Knowledge Base",
        twitterTitle: "TNBC Knowledge Base",
      },
      {
        path: "/admin/users",
        title: "Admin Users — TNBC Knowledge Base",
        description: "Breast cancer research and treatment knowledge base",
        openGraphTitle: "TNBC Knowledge Base",
        twitterTitle: "TNBC Knowledge Base",
      },
    ];

    for (const route of cases) {
      const response = await handler(request(route.path, authenticated));
      const html = await response.text();
      const escapedDescription = route.description.replace(/"/g, "&quot;");

      expect(html).toContain(`<title>${route.title}</title>`);
      expect(html).toContain(
        `<meta name="description" content="${escapedDescription}" />`,
      );
      expect(html).toContain(
        `<meta property="og:title" content="${route.openGraphTitle}" />`,
      );
      expect(html).toContain(
        `<meta name="twitter:title" content="${route.twitterTitle}" />`,
      );
    }

    const article = await handler(request("/wiki/long", authenticated));
    const articleHtml = await article.text();
    expect(articleHtml).toContain(
      `<meta name="description" content="${TRUNCATED_DESCRIPTION}" />`,
    );
    expect(articleHtml).toContain(
      `<meta name="twitter:description" content="${TRUNCATED_DESCRIPTION}" />`,
    );

    const login = await handler(request("/login?redirect=%2F"));
    const loginHtml = await login.text();
    expect(loginHtml).toContain("<title>TNBC Knowledge Base</title>");
    expect(loginHtml).toContain(
      '<meta name="description" content="Breast cancer research and treatment knowledge base" />',
    );
    expect(loginHtml).toContain(
      '<meta property="og:title" content="TNBC Knowledge Base" />',
    );
  });

  test("renders sensitive metadata only for an authorized user session", async () => {
    const handler = createWikiViteHandler({
      client: fakeClient() as never,
      distDir,
    });
    const authenticated = {
      headers: {
        Cookie: (await authenticatedHeaders("wiki_user_session=session-token")).Cookie,
      },
    };

    const authorized = await handler(request("/private/plan", authenticated));
    const authorizedHtml = await authorized.text();

    expect(authorized.status).toBe(200);
    expect(authorized.headers.get("cache-control")).toBe("private, no-store");
    expect(authorized.headers.get("vary")).toContain("Cookie");
    expect(authorizedHtml).toContain(
      "<title>Private Plan — TNBC Knowledge Base</title>",
    );
    expect(authorizedHtml).toContain(
      '<meta name="description" content="Sensitive treatment planning details." />',
    );
    expect(authorizedHtml).toContain(
      '<meta name="robots" content="noindex, nofollow" />',
    );
    expect(authorizedHtml).not.toContain('rel="canonical"');
    expect(authorizedHtml).not.toContain('property="og:url"');
  });

  test("does not expose sensitive metadata without per-slug session access", async () => {
    const handler = createWikiViteHandler({
      client: fakeClient({ canAccessSensitive: false }) as never,
      distDir,
    });

    const anonymousHeaders: Array<Record<string, string>> = [
      await authenticatedHeaders(),
      await authenticatedHeaders("wiki_user_session=session-token"),
      { "User-Agent": "Slackbot-LinkExpanding 1.0" },
    ];
    for (const headers of anonymousHeaders) {
      const response = await handler(request("/private/plan", { headers }));
      const html = await response.text();

      expect(html).not.toContain("Private Plan");
      expect(html).not.toContain("Sensitive treatment planning details.");
      expect(html).not.toContain('rel="canonical"');
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  test("serves the same route metadata to preview bots without exposing canonicals", async () => {
    const handler = createWikiViteHandler({
      client: fakeClient() as never,
      distDir,
    });
    const botHeaders = { "User-Agent": "Slackbot-LinkExpanding 1.0" };
    const cases = [
      {
        path: "/",
        title: "Home — TNBC Knowledge Base",
        description: "Breast cancer research and treatment knowledge base",
        openGraphTitle: "Home",
        twitterTitle: "TNBC Knowledge Base",
      },
      {
        path: "/wiki/long",
        title: "Long Article — TNBC Knowledge Base",
        description: TRUNCATED_DESCRIPTION,
        openGraphTitle: "Long Article",
        twitterTitle: "Long Article",
      },
      {
        path: "/tags/summary",
        title: "Tag: summary — TNBC Knowledge Base",
        description: '6 pages tagged "summary"',
        openGraphTitle: "Tag: summary",
        twitterTitle: "TNBC Knowledge Base",
      },
      {
        path: "/search",
        title: "Search — TNBC Knowledge Base",
        description: "Search across all wiki pages",
        openGraphTitle: "Search",
        twitterTitle: "TNBC Knowledge Base",
      },
    ];

    for (const route of cases) {
      const response = await handler(request(route.path, { headers: botHeaders }));
      const html = await response.text();
      const escapedDescription = route.description.replace(/"/g, "&quot;");

      expect(response.status).toBe(200);
      expect(html).toContain(`<title>${route.title}</title>`);
      expect(html).toContain(
        `<meta name="description" content="${escapedDescription}">`,
      );
      expect(html).toContain(
        `<meta property="og:title" content="${route.openGraphTitle}">`,
      );
      expect(html).toContain(
        `<meta name="twitter:title" content="${route.twitterTitle}">`,
      );
      expect(html).toContain('<meta name="robots" content="noindex,nofollow">');
      expect(html).not.toContain('rel="canonical"');
      expect(html).not.toContain('property="og:url"');
    }
  });

  test("serves markdown article aliases through the app shell", async () => {
    const handler = createWikiViteHandler({
      client: fakeClient() as never,
      distDir,
    });

    for (const pathname of ["/wiki/public.md", "/wiki/public.mdx"]) {
      const response = await handler(
        request(pathname, { headers: await authenticatedHeaders() }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(await response.text()).toContain(
        "<title>Public — TNBC Knowledge Base</title>",
      );
    }
  });

  test("permanently removes trailing slashes while preserving query parameters", async () => {
    const handler = createWikiViteHandler({
      client: fakeClient() as never,
      distDir,
    });

    const response = await handler(
      request("/wiki/public/?view=compact", {
        headers: await authenticatedHeaders(),
      }),
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1/wiki/public?view=compact",
    );
  });

  test("preserves the explicit about directory canonical redirect", async () => {
    const handler = createWikiViteHandler({
      client: fakeClient() as never,
      distDir,
    });

    const response = await handler(
      request("/about?view=compact", {
        headers: await authenticatedHeaders(),
      }),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1/about/Index?view=compact",
    );
  });

  test("preserves legacy application route canonicals and query parameters", async () => {
    const handler = createWikiViteHandler({
      client: fakeClient() as never,
      distDir,
    });
    const headers = await authenticatedHeaders();

    const timeline = await handler(
      request("/timeline?studySet=follow-up", { headers }),
    );
    expect(timeline.status).toBe(307);
    expect(timeline.headers.get("location")).toBe(
      "http://127.0.0.1/diagnostics?studySet=follow-up",
    );

    const adminAccess = await handler(
      request("/admin/access?view=hidden", { headers }),
    );
    expect(adminAccess.status).toBe(307);
    expect(adminAccess.headers.get("location")).toBe(
      "http://127.0.0.1/admin/pages?view=hidden",
    );
  });

  test("serves a function-embedded shell when no static root index exists", async () => {
    await rm(path.join(distDir, "index.html"));
    const handler = createWikiViteHandler({
      client: fakeClient() as never,
      distDir,
      indexHtml: INDEX_HTML,
    });

    const anonymous = await handler(request("/"));
    expect(anonymous.status).toBe(302);

    const authenticated = await handler(
      request("/", { headers: await authenticatedHeaders() }),
    );
    expect(authenticated.status).toBe(200);
    expect(await authenticated.text()).toContain('<div id="root"></div>');
  });

  test("never caches login HTML across authentication state", async () => {
    const handler = createWikiViteHandler({
      client: fakeClient() as never,
      distDir,
    });

    const response = await handler(request("/login?redirect=%2F"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
  });
});
