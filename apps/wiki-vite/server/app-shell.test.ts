import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getFunctionName, type FunctionReference } from "convex/server";
import { createWikiViteHandler } from "./app-shell";

const INDEX_HTML =
  "<!doctype html><html><head><title>Diana Wiki</title></head><body><div id=\"root\"></div></body></html>";
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

function fakeClient() {
  return {
    async query(ref: FunctionReference<"query">, args: Record<string, unknown>) {
      switch (getFunctionName(ref)) {
        case "sites:getBySlug":
          return { slug: args.slug, config: { passwordGate: true } };
        case "documents:listManifestPage":
          return {
            page: [{ slug: "wiki/public" }],
            isDone: true,
            continueCursor: null,
          };
        case "documents:getBySlug":
          if (args.slug === "search") return null;
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
            sensitive: false,
          };
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
    distDir = await mkdtemp(path.join(tmpdir(), "wiki-vite-app-shell-"));
    await mkdir(path.join(distDir, "assets"));
    await writeFile(path.join(distDir, "index.html"), INDEX_HTML);
    await writeFile(path.join(distDir, "assets", "app-deadbeef.js"), "export {};");
  });

  afterEach(async () => {
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

  test("serves authenticated HTML privately while keeping hashed assets immutable", async () => {
    const handler = createWikiViteHandler({
      client: fakeClient() as never,
      distDir,
    });

    for (const pathname of ["/", "/wiki/public"]) {
      const response = await handler(
        request(pathname, { headers: { Cookie: "authed=true" } }),
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

  test("keeps every password-gated shell out of indexes without exposing canonicals", async () => {
    const handler = createWikiViteHandler({
      client: fakeClient() as never,
      distDir,
    });

    for (const pathname of ["/", "/index", "/about/About", "/search"]) {
      const response = await handler(
        request(pathname, { headers: { Cookie: "authed=true" } }),
      );
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
      expect(html).not.toContain('rel="canonical"');
      expect(html).not.toContain('property="og:url"');
    }

    const home = await handler(request("/", { headers: { Cookie: "authed=true" } }));
    const homeHtml = await home.text();
    expect(homeHtml).toContain(
      '<meta name="twitter:title" content="TNBC Knowledge Base" />',
    );
    expect(homeHtml).toContain(
      '<meta property="og:title" content="Home" />',
    );

    const about = await handler(
      request("/about/About", { headers: { Cookie: "authed=true" } }),
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
    const authenticated = { headers: { Cookie: "authed=true" } };
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
        request(pathname, { headers: { Cookie: "authed=true" } }),
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
        headers: { Cookie: "authed=true" },
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
        headers: { Cookie: "authed=true" },
      }),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1/about/Index?view=compact",
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
      request("/", { headers: { Cookie: "authed=true" } }),
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
