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

let mockSessionUser: { id: string } | null = null;

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
      }) =>
        paginate(
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
        ),
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
      }) => paginate(visiblePages(includeSensitive), cursor, numItems),
    },
  }),
}));

const manifestRoute = await import("../app/api/wiki/manifest/route");
const pagesRoute = await import("../app/api/wiki/pages/route");

describe("wiki prototype API routes", () => {
  beforeEach(() => {
    mockSessionUser = null;
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
  });

  test("session manifest uses private cache headers and includes sensitive pages", async () => {
    mockSessionUser = { id: "user-1" };
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

    mockSessionUser = { id: "user-1" };
    const sessionResponse = await pagesRoute.GET(
      new Request(
        "https://example.test/api/wiki/pages?scope=session&slugs=private/plan",
      ),
    );
    const sessionBody = await sessionResponse.json();
    expect(sessionResponse.headers.get("cache-control")).toContain("private");
    expect(sessionBody.pages[0].slug).toBe("private/plan");
  });
});
