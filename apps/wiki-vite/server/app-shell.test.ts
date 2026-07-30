import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getFunctionName, type FunctionReference } from "convex/server";
import { createWikiViteHandler } from "./app-shell";

const INDEX_HTML =
  "<!doctype html><html><head><title>Diana Wiki</title></head><body><div id=\"root\"></div></body></html>";

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
                  : "Public",
            description: "Public page",
            sensitive: false,
          };
        default:
          throw new Error(`Unexpected query ${getFunctionName(ref)}`);
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
      '<meta property="og:title" content="TNBC Knowledge Base" />',
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
        description: "Public page",
        socialTitle: "TNBC Knowledge Base",
      },
      {
        path: "/index",
        title: "Home — TNBC Knowledge Base",
        description: "Public page",
        socialTitle: "TNBC Knowledge Base",
      },
      {
        path: "/wiki/public",
        title: "Public — TNBC Knowledge Base",
        description: "Public page",
        socialTitle: "Public",
      },
      {
        path: "/tags/summary",
        title: "Tag: summary — TNBC Knowledge Base",
        description: "Pages tagged summary in TNBC Knowledge Base",
        socialTitle: "Tag: summary",
      },
      {
        path: "/search",
        title: "Search — TNBC Knowledge Base",
        description: "Search the TNBC Knowledge Base",
        socialTitle: "Search",
      },
    ];

    for (const route of cases) {
      const response = await handler(request(route.path, authenticated));
      const html = await response.text();

      expect(html).toContain(`<title>${route.title}</title>`);
      expect(html).toContain(
        `<meta name="description" content="${route.description}" />`,
      );
      expect(html).toContain(
        `<meta property="og:title" content="${route.socialTitle}" />`,
      );
      expect(html).toContain(
        `<meta name="twitter:title" content="${route.socialTitle}" />`,
      );
    }

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
