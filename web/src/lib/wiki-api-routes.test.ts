import { beforeEach, describe, expect, mock, test } from "bun:test";

type MockPage = {
  slug: string;
  title: string;
  tags: string[];
  description: string | null;
  content: string;
  contentHash: string;
  sensitive: boolean;
};

const mockPages: MockPage[] = [
  {
    slug: "index",
    title: "Home",
    tags: ["wiki"],
    description: "Public landing page",
    content: "# Home",
    contentHash: "hash-public-index",
    sensitive: false,
  },
  {
    slug: "private/plan",
    title: "Private Plan",
    tags: ["sensitive"],
    description: null,
    content: "# Private",
    contentHash: "hash-sensitive-plan",
    sensitive: true,
  },
  {
    slug: "research/paper",
    title: "Paper",
    tags: ["research"],
    description: null,
    content: "# Paper",
    contentHash: "hash-public-paper",
    sensitive: false,
  },
];

let mockSessionUser: { _id: string } | null = null;
let manifestFails = false;
let contentFallbackFails = false;
let filterPageBatchesAfterPagination = false;
const originalWikiViteAllowedOrigins = process.env.WIKI_VITE_ALLOWED_ORIGINS;

function visiblePages(includeSensitive?: boolean) {
  return mockPages.filter((page) => includeSensitive || !page.sensitive);
}

function paginate<T>(items: T[], cursor: string | null, numItems: number) {
  const start = cursor ? Number(cursor) : 0;
  const page = items.slice(start, start + numItems);
  const next = start + page.length;
  const isDone = next >= items.length;
  return {
    page,
    isDone,
    continueCursor: isDone ? null : String(next),
  };
}

mock.module("@/lib/session-user", () => ({
  getSessionUserFromRequest: async () => mockSessionUser,
}));

mock.module("@/lib/site-data", () => ({
  siteDataFromRequest: () => ({
    siteSlug: "diana",
    documents: {
      listManifestPage: async ({
        cursor,
        numItems,
        includeSensitive,
      }: {
        cursor: string | null;
        numItems: number;
        includeSensitive?: boolean;
      }) => {
        if (manifestFails) throw new Error("manifest metadata unavailable");
        return paginate(
          visiblePages(includeSensitive).map((page) => ({
            slug: page.slug,
            title: page.title,
            tags: page.tags,
            description: page.description,
            contentHash: page.contentHash,
            sensitive: page.sensitive,
            size: page.content.length,
          })),
          cursor,
          numItems,
        );
      },
      listPdfAssetPathsPage: async () => ({
        page: ["research/paper.pdf"],
        isDone: true,
        continueCursor: null,
      }),
      listFileAssetPathsPage: async () => ({
        page: ["images/scan.png"],
        isDone: true,
        continueCursor: null,
      }),
      getBySlug: async ({
        slug,
        includeSensitive,
      }: {
        slug: string;
        includeSensitive?: boolean;
      }) => visiblePages(includeSensitive).find((page) => page.slug === slug) ?? null,
      listPageWithContent: async ({
        cursor,
        numItems,
        includeSensitive,
      }: {
        cursor: string | null;
        numItems: number;
        includeSensitive?: boolean;
      }) => {
        if (contentFallbackFails) throw new Error("content metadata unavailable");
        if (!filterPageBatchesAfterPagination) {
          return paginate(visiblePages(includeSensitive), cursor, numItems);
        }
        const result = paginate(mockPages, cursor, numItems);
        return {
          ...result,
          page: result.page.filter((page) => includeSensitive || !page.sensitive),
        };
      },
    },
  }),
}));

const manifestRoute = await import("../app/api/wiki/manifest/route");
const pagesRoute = await import("../app/api/wiki/pages/route");
const sessionRoute = await import("../app/api/wiki/session/route");

describe("wiki prototype API routes", () => {
  beforeEach(() => {
    mockSessionUser = null;
    manifestFails = false;
    contentFallbackFails = false;
    filterPageBatchesAfterPagination = false;
    if (originalWikiViteAllowedOrigins == null) {
      delete process.env.WIKI_VITE_ALLOWED_ORIGINS;
    } else {
      process.env.WIKI_VITE_ALLOWED_ORIGINS = originalWikiViteAllowedOrigins;
    }
  });

  test("manifest omits sensitive pages for public requests", async () => {
    const response = await manifestRoute.GET(
      new Request("https://example.test/api/wiki/manifest"),
    );
    const body = await response.json();

    expect(response.headers.get("x-wiki-cache-scope")).toBe("public");
    expect(body.pages.map((page: { slug: string }) => page.slug)).toEqual([
      "index",
      "research/paper",
    ]);
    expect(JSON.stringify(body.compactTree)).not.toContain("private");
    expect(JSON.stringify(body.compactTree)).not.toContain("images");
    expect(body.assets.map((asset: { path: string }) => asset.path)).toContain("images/scan.png");
  });

  test("session manifest uses private cache headers and includes sensitive pages", async () => {
    mockSessionUser = { _id: "user-1" };
    const response = await manifestRoute.GET(
      new Request("https://example.test/api/wiki/manifest?scope=session"),
    );
    const body = await response.json();

    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("vary")).toContain("Cookie");
    expect(body.pages.map((page: { slug: string }) => page.slug)).toContain(
      "private/plan",
    );
  });

  test("manifest ETags are stable across generatedAt changes", async () => {
    const first = await manifestRoute.GET(
      new Request("https://example.test/api/wiki/manifest"),
    );
    const etag = first.headers.get("etag");
    const second = await manifestRoute.GET(
      new Request("https://example.test/api/wiki/manifest", {
        headers: etag ? { "if-none-match": etag } : undefined,
      }),
    );

    expect(etag).toBeTruthy();
    expect(second.status).toBe(304);
  });

  test("manifest can use explicit content-backed metadata fallback", async () => {
    manifestFails = true;
    const originalConsoleWarn = console.warn;
    console.warn = () => {};
    const response = await manifestRoute.GET(
      new Request("https://example.test/api/wiki/manifest"),
    ).finally(() => {
      console.warn = originalConsoleWarn;
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-wiki-manifest-source")).toBe("content-fallback");
    expect(body.pages[0].contentHash).toBe("hash-public-index");
    expect(body.pages[0].sensitive).toBe(false);
    expect(body.pages[0].size).toBe("# Home".length);
  });

  test("manifest fails closed when reliable metadata is unavailable", async () => {
    manifestFails = true;
    contentFallbackFails = true;
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
    console.error = () => {};
    console.warn = () => {};
    const response = await manifestRoute.GET(
      new Request("https://example.test/api/wiki/manifest"),
    ).finally(() => {
      console.error = originalConsoleError;
      console.warn = originalConsoleWarn;
    });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.error).toContain("metadata");
  });

  test("page batches paginate public markdown without leaking sensitive content", async () => {
    const response = await pagesRoute.GET(
      new Request("https://example.test/api/wiki/pages?limit=1"),
    );
    const body = await response.json();

    expect(body.pages).toHaveLength(1);
    expect(body.pages[0].slug).toBe("index");
    expect(body.continueCursor).toBe("1");

    const next = await pagesRoute.GET(
      new Request(
        `https://example.test/api/wiki/pages?limit=10&cursor=${body.continueCursor}`,
      ),
    );
    const nextBody = await next.json();
    expect(nextBody.pages.map((page: { slug: string }) => page.slug)).toEqual([
      "research/paper",
    ]);
  });

  test("page batches advance past empty filtered Convex pages", async () => {
    filterPageBatchesAfterPagination = true;
    const response = await pagesRoute.GET(
      new Request("https://example.test/api/wiki/pages?limit=1&cursor=1"),
    );
    const body = await response.json();

    expect(body.pages.map((page: { slug: string }) => page.slug)).toEqual([
      "research/paper",
    ]);
    expect(body.isDone).toBe(true);
    expect(body.continueCursor).toBe(null);
  });

  test("priority page fetches respect public and session scopes", async () => {
    const publicResponse = await pagesRoute.GET(
      new Request(
        "https://example.test/api/wiki/pages?slugs=private/plan,index",
      ),
    );
    const publicBody = await publicResponse.json();
    expect(publicBody.pages.map((page: { slug: string }) => page.slug)).toEqual([
      "index",
    ]);

    mockSessionUser = { _id: "user-1" };
    const sessionResponse = await pagesRoute.GET(
      new Request(
        "https://example.test/api/wiki/pages?scope=session&slugs=private/plan",
      ),
    );
    const sessionBody = await sessionResponse.json();
    expect(sessionResponse.headers.get("cache-control")).toContain("private");
    expect(sessionBody.pages[0].slug).toBe("private/plan");
  });

  test("session identity gates private stores with a server-issued cache key", async () => {
    const publicResponse = await sessionRoute.GET(
      new Request("https://example.test/api/wiki/session"),
    );
    const publicBody = await publicResponse.json();
    expect(publicBody.authenticated).toBe(false);
    expect(publicBody.cacheKey).toContain("public");

    const unauthorized = await sessionRoute.GET(
      new Request("https://example.test/api/wiki/session?scope=session"),
    );
    expect(unauthorized.status).toBe(401);

    mockSessionUser = { _id: "user-1" };
    const sessionResponse = await sessionRoute.GET(
      new Request("https://example.test/api/wiki/session?scope=session"),
    );
    const sessionBody = await sessionResponse.json();

    expect(sessionResponse.headers.get("cache-control")).toContain("no-store");
    expect(sessionBody.authenticated).toBe(true);
    expect(sessionBody.cacheKey).toContain("session");
    expect(sessionBody.userHash).toBeTruthy();
    expect(sessionBody.cacheKey).not.toContain("user-1");
  });

  test("wiki APIs expose CORS only to explicit Vite preview origins", async () => {
    process.env.WIKI_VITE_ALLOWED_ORIGINS = "https://wiki-vite.example";

    const preflight = await manifestRoute.OPTIONS(
      new Request("https://example.test/api/wiki/manifest", {
        method: "OPTIONS",
        headers: { Origin: "https://wiki-vite.example" },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(
      "https://wiki-vite.example",
    );
    expect(preflight.headers.get("access-control-allow-credentials")).toBe("true");

    const manifest = await manifestRoute.GET(
      new Request("https://example.test/api/wiki/manifest", {
        headers: { Origin: "https://wiki-vite.example" },
      }),
    );
    expect(manifest.headers.get("access-control-allow-origin")).toBe(
      "https://wiki-vite.example",
    );
    expect(manifest.headers.get("vary")).toContain("Origin");

    const denied = await pagesRoute.OPTIONS(
      new Request("https://example.test/api/wiki/pages", {
        method: "OPTIONS",
        headers: { Origin: "https://untrusted.example" },
      }),
    );
    expect(denied.status).toBe(403);
  });
});
