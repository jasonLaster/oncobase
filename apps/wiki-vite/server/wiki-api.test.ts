import { describe, expect, mock, test } from "bun:test";
import { getFunctionName, type FunctionReference } from "convex/server";
import JSZip from "jszip";
import { createWikiApiHandler } from "./wiki-api";

process.env.WIKI_GATE_SESSION_SECRET = "wiki-api-test-gate-secret";
process.env.DIANA_WIKI_PASSWORD_HASH =
  "sha256:1b2fc9341a16ae4e30082965d537ae47c21a0f27fd43eab78330ed81751ae6db";

let fallbackBlobPath: string | null = null;
let fallbackBlobUrl: string | null = null;
let blobListCalls: Array<{ prefix: string; token: string }> = [];

mock.module("@vercel/blob", () => ({
  list: async ({
    prefix,
    token,
  }: {
    limit: number;
    prefix: string;
    token: string;
  }) => {
    blobListCalls.push({ prefix, token });
    return {
      blobs:
        fallbackBlobPath === prefix && fallbackBlobUrl
          ? [{ pathname: prefix, url: fallbackBlobUrl }]
          : [],
    };
  },
}));

type FakeUser = {
  _id: string;
  email: string;
  name: string | null;
  passwordHash: string;
  passwordSalt: string;
};

type FakeSession = {
  tokenHash: string;
  userId: string;
  expiresAt: number;
};

type FakePage = {
  slug: string;
  title: string;
  content: string;
  tags: string[];
  sensitive?: boolean;
};

type FakeAsset = {
  blobUrl: string;
  ownerSlugs?: string[];
  path: string;
  sensitive?: boolean;
  sizeBytes?: number;
};

function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Host", "127.0.0.1");
  return new Request(`http://127.0.0.1${path}`, {
    ...init,
    headers,
  });
}

function cookieFrom(response: Response) {
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  expect(cookie).toBeTruthy();
  return cookie!;
}

async function signupCookie(
  handler: ReturnType<typeof createWikiApiHandler>,
  email: string,
) {
  const signup = await handler(
    request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: "correct horse battery",
      }),
    }),
  );
  expect(signup?.status).toBe(200);
  return cookieFrom(signup!);
}

function createFakeConvexClient({
  deniedSlugs = [],
}: {
  deniedSlugs?: string[];
} = {}) {
  const deniedSlugSet = new Set(deniedSlugs);
  const users = new Map<string, FakeUser>();
  const sessions = new Map<string, FakeSession>();
  const pages: FakePage[] = [
    {
      slug: "wiki/public",
      title: "Public",
      tags: ["public"],
      content: "# Public\n\nPublic wiki body.",
    },
    {
      slug: "private/plan",
      title: "Private Plan",
      tags: ["private"],
      content: "# Private Plan\n\nSensitive note for Diana Laster and MRN 88855655.",
      sensitive: true,
    },
    {
      slug: "private/shared",
      title: "Shared owner",
      tags: ["private"],
      content: "# Shared owner",
      sensitive: true,
    },
  ];
  const assets: FakeAsset[] = [
    {
      path: "sources/public/source.pdf",
      blobUrl: "https://blob.example/source.pdf",
      sizeBytes: 9,
    },
    {
      path: "private/images/scan.png",
      blobUrl: "https://blob.example/private-scan.png",
      ownerSlugs: ["private/plan"],
      sensitive: true,
      sizeBytes: 7,
    },
    {
      path: "private/plan.pdf",
      blobUrl: "https://blob.example/private-plan.pdf",
      ownerSlugs: ["private/plan", "private/shared"],
      sensitive: true,
      sizeBytes: 7,
    },
  ];

  return {
    async query(ref: FunctionReference<"query">, args: Record<string, unknown>) {
      switch (getFunctionName(ref)) {
        case "sites:getBySlug":
          return { slug: args.slug, config: { passwordGate: true } };
        case "users:getByEmailForAuth":
          return users.get(String(args.email)) ?? null;
        case "users:getSessionUser": {
          const session = sessions.get(String(args.tokenHash));
          if (!session || session.expiresAt <= Date.now()) return null;
          const user = [...users.values()].find((candidate) => candidate._id === session.userId);
          return user
            ? {
                _id: user._id,
                email: user.email,
                name: user.name,
                createdAt: Date.now(),
              }
            : null;
        }
        case "documents:listPageWithContent": {
          const includeSensitive = args.includeSensitive === true;
          const visiblePages = pages.filter((page) => includeSensitive || !page.sensitive);
          return {
            page: visiblePages.map((page) => ({
              ...page,
              description: null,
              contentHash: page.slug,
              sensitive: page.sensitive === true,
            })),
            isDone: true,
            continueCursor: null,
          };
        }
        case "documents:listManifestPage": {
          const includeSensitive = args.includeSensitive === true;
          const visiblePages = pages.filter((page) => includeSensitive || !page.sensitive);
          return {
            page: visiblePages.map((page) => ({
              slug: page.slug,
              title: page.title,
              tags: page.tags,
              description: null,
              contentHash: page.slug,
              sensitive: page.sensitive === true,
              size: page.content.length,
            })),
            isDone: true,
            continueCursor: null,
          };
        }
        case "documents:listPdfAssetsPage":
          return {
            page: [
              {
                path: "sources/public/source.pdf",
                blobUrl: "data:application/pdf;base64,JVBERi0xLjQKJUVPRgo=",
              },
            ],
            isDone: true,
            continueCursor: null,
          };
        case "documents:listFileAssetsPage": {
          const includeSensitive = args.includeSensitive === true;
          return {
            page: [
              {
                path: "biopsy/raw/dicom.zip",
                blobUrl: "data:application/zip;base64,UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==",
              },
              ...(includeSensitive
                ? [
                    {
                      path: "private/plan.zip",
                      blobUrl: "data:application/zip;base64,UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==",
                    },
                  ]
                : []),
            ],
            isDone: true,
            continueCursor: null,
          };
        }
        case "documents:getBySlug": {
          const includeSensitive = args.includeSensitive === true;
          const page = pages.find((candidate) => candidate.slug === args.slug);
          if (!page || (page.sensitive && !includeSensitive)) return null;
          return {
            ...page,
            description: null,
            contentHash: page.slug,
            sensitive: page.sensitive === true,
          };
        }
        case "access:canUserAccessSlug":
          return !deniedSlugSet.has(String(args.slug));
        case "access:filterAccessibleSlugs":
          return (args.slugs as string[]).map((slug) => ({
            slug,
            allowed: true,
            hasDocument: pages.some((candidate) => candidate.slug === slug),
          }));
        case "documents:listPdfAssets":
          return [
            {
              path: "sources/public/source.pdf",
              blobUrl: "data:application/pdf;base64,JVBERi0xLjQKJUVPRgo=",
            },
          ];
        case "documents:listFileAssets": {
          const includeSensitive = args.includeSensitive === true;
          return [
            {
              path: "biopsy/raw/dicom.zip",
              blobUrl: "data:application/zip;base64,UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==",
            },
            ...(includeSensitive
              ? [
                  {
                    path: "private/plan.zip",
                    blobUrl: "data:application/zip;base64,UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==",
                  },
                ]
              : []),
          ];
        }
        case "documents:getBySlug":
          return pages.find((page) => page.slug === args.slug) ?? null;
        case "documents:getPdfAssetByPath":
        case "documents:getFileAssetByPath": {
          const asset = assets.find((candidate) => candidate.path === args.path);
          if (!asset) return null;
          const siblingSlug = asset.path.replace(/\.[^/.]+$/, "");
          const sibling = pages.find((page) => page.slug === siblingSlug);
          const sensitive = asset.sensitive ?? sibling?.sensitive === true;
          if (sensitive && args.includeSensitive !== true) return null;
          return asset;
        }
        default:
          throw new Error(`Unexpected query ${getFunctionName(ref)}`);
      }
    },
    async mutation(ref: FunctionReference<"mutation">, args: Record<string, unknown>) {
      switch (getFunctionName(ref)) {
        case "users:create": {
          const email = String(args.email);
          if (users.has(email)) throw new Error("An account with that email already exists");
          const user: FakeUser = {
            _id: `user_${users.size + 1}`,
            email,
            name: typeof args.name === "string" ? args.name : null,
            passwordHash: String(args.passwordHash),
            passwordSalt: String(args.passwordSalt),
          };
          users.set(email, user);
          return user._id;
        }
        case "users:createSession": {
          sessions.set(String(args.tokenHash), {
            tokenHash: String(args.tokenHash),
            userId: String(args.userId),
            expiresAt: Number(args.expiresAt),
          });
          return `session_${sessions.size}`;
        }
        case "users:deleteSession": {
          const deleted = sessions.delete(String(args.tokenHash));
          return { deleted };
        }
        default:
          throw new Error(`Unexpected mutation ${getFunctionName(ref)}`);
      }
    },
  };
}

describe("wiki Vite API auth and scoped archive behavior", () => {
  test("returns redacted line-level text search matches with source locations", async () => {
    const handler = createWikiApiHandler(createFakeConvexClient() as never);
    const response = await handler(request("/api/search?q=public"));

    expect(response?.status).toBe(200);
    expect(response!.headers.get("x-wiki-cache-scope")).toBe("public");
    expect(await response!.json()).toEqual({
      results: [
        {
          filePath: "wiki/public",
          slug: "wiki/public",
          title: "Public",
          matches: [
            {
              lineNumber: 1,
              lineContent: "# Public",
              matchStart: 2,
              matchEnd: 8,
            },
            {
              lineNumber: 3,
              lineContent: "Public wiki body.",
              matchStart: 0,
              matchEnd: 6,
            },
          ],
        },
      ],
    });
  });

  test("keeps text and AI search in the explicit reader scope", async () => {
    const handler = createWikiApiHandler(createFakeConvexClient() as never);
    const signup = await handler(
      request("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "search-reader@example.com",
          password: "correct horse battery",
        }),
      }),
    );
    const cookie = cookieFrom(signup!);

    const publicText = await handler(
      request("/api/search?q=sensitive&scope=public", {
        headers: { Cookie: cookie },
      }),
    );
    expect(publicText?.status).toBe(200);
    expect(publicText!.headers.get("x-wiki-cache-scope")).toBe("public");
    expect(publicText!.headers.get("cache-control")).toContain("public");
    expect(publicText!.headers.get("vary")).not.toContain("Cookie");
    expect(await publicText!.json()).toEqual({ results: [] });

    const defaultText = await handler(
      request("/api/search?q=sensitive", {
        headers: { Cookie: cookie },
      }),
    );
    expect(defaultText?.status).toBe(200);
    expect(defaultText!.headers.get("x-wiki-cache-scope")).toBe("public");
    expect(await defaultText!.json()).toEqual({ results: [] });

    const sessionText = await handler(
      request("/api/search?q=sensitive&scope=session", {
        headers: { Cookie: cookie },
      }),
    );
    expect(sessionText?.status).toBe(200);
    expect(sessionText!.headers.get("x-wiki-cache-scope")).toBe("session");
    expect(sessionText!.headers.get("cache-control")).toContain("private");
    expect(sessionText!.headers.get("vary")).toContain("Cookie");
    expect(await sessionText!.json()).toEqual({
      results: [
        expect.objectContaining({
          slug: "private/plan",
          matches: [
            expect.objectContaining({
              lineContent: expect.stringContaining("Sensitive note"),
            }),
          ],
        }),
      ],
    });

    const unauthorizedText = await handler(
      request("/api/search?q=sensitive&scope=session"),
    );
    expect(unauthorizedText?.status).toBe(401);
    expect(unauthorizedText!.headers.get("cache-control")).toBe("private, no-store");
    expect(unauthorizedText!.headers.get("x-wiki-cache-scope")).toBe("session");

    const publicAi = await handler(
      request("/api/ai-search?scope=public", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: JSON.stringify({ query: "" }),
      }),
    );
    expect(publicAi?.status).toBe(200);
    expect(publicAi!.headers.get("x-wiki-cache-scope")).toBe("public");
    expect(publicAi!.headers.get("cache-control")).toBe("private, no-store");
    expect(publicAi!.headers.get("vary")).not.toContain("Cookie");
    expect(await publicAi!.json()).toEqual({ results: [] });

    const sessionAi = await handler(
      request("/api/ai-search?scope=session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: JSON.stringify({ query: "" }),
      }),
    );
    expect(sessionAi?.status).toBe(200);
    expect(sessionAi!.headers.get("x-wiki-cache-scope")).toBe("session");
    expect(sessionAi!.headers.get("cache-control")).toBe("private, no-store");
    expect(sessionAi!.headers.get("vary")).toContain("Cookie");
    expect(await sessionAi!.json()).toEqual({ results: [] });

    const unauthorizedAi = await handler(
      request("/api/ai-search?scope=session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "" }),
      }),
    );
    expect(unauthorizedAi?.status).toBe(401);
    expect(unauthorizedAi!.headers.get("cache-control")).toBe("private, no-store");
    expect(unauthorizedAi!.headers.get("x-wiki-cache-scope")).toBe("session");
  });

  test("keeps password-login redirects and responses out of shared caches", async () => {
    const handler = createWikiApiHandler(createFakeConvexClient() as never);

    const missingToken = await handler(request("/api/login?redirect=%2Fwiki%2Fpublic"));
    expect(missingToken?.status).toBe(302);
    expect(missingToken!.headers.get("cache-control")).toBe("private, no-store");
    expect(missingToken!.headers.get("vary")).toContain("Cookie");

    const tokenLogin = await handler(
      request("/api/login?token=diana&redirect=%2Fwiki%2Fpublic"),
    );
    expect(tokenLogin?.status).toBe(302);
    expect(tokenLogin!.headers.get("cache-control")).toBe("private, no-store");
    expect(tokenLogin!.headers.get("set-cookie")).toContain("authed=v1.");
    expect(tokenLogin!.headers.get("vary")).toContain("Cookie");
    expect(tokenLogin!.headers.get("location")).toBe("http://127.0.0.1/wiki/public");

    for (const redirect of ["https://evil.example/phish", "//evil.example/phish"]) {
      const unsafeTokenLogin = await handler(
        request(
          `/api/login?token=diana&redirect=${encodeURIComponent(redirect)}`,
        ),
      );
      expect(unsafeTokenLogin?.status).toBe(302);
      expect(unsafeTokenLogin!.headers.get("location")).toBe("http://127.0.0.1/");
    }

    const passwordLogin = await handler(
      request("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "diana" }),
      }),
    );
    expect(passwordLogin?.status).toBe(200);
    expect(passwordLogin!.headers.get("cache-control")).toBe("private, no-store");
    expect(passwordLogin!.headers.get("vary")).toContain("Cookie");
  });

  test("signs up, reads the session, rejects bad sign-in, and signs out without live Convex writes", async () => {
    const handler = createWikiApiHandler(createFakeConvexClient() as never);
    const email = "reader@example.com";
    const password = "correct horse battery";

    const signup = await handler(
      request("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name: "Reader", password }),
      }),
    );
    expect(signup?.status).toBe(200);
    const cookie = cookieFrom(signup!);
    expect(await signup!.json()).toEqual({
      ok: true,
      user: { email, name: "Reader" },
    });

    const session = await handler(request("/api/auth/session", { headers: { Cookie: cookie } }));
    expect(session?.status).toBe(200);
    expect(await session!.json()).toEqual({ user: { email, isAdmin: false, name: "Reader" } });

    const badSignin = await handler(
      request("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "wrong-password" }),
      }),
    );
    expect(badSignin?.status).toBe(401);

    const signout = await handler(
      request("/api/auth/signout", {
        method: "POST",
        headers: { Cookie: cookie },
      }),
    );
    expect(signout?.status).toBe(200);
    expect(signout!.headers.get("set-cookie")).toContain("Max-Age=0");

    const afterSignout = await handler(request("/api/auth/session", { headers: { Cookie: cookie } }));
    expect(await afterSignout!.json()).toEqual({ user: null });
  });

  test("keeps public and session zip archives scoped and redacted", async () => {
    const handler = createWikiApiHandler(createFakeConvexClient() as never);
    const signup = await handler(
      request("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "archive-reader@example.com",
          password: "correct horse battery",
        }),
      }),
    );
    const cookie = cookieFrom(signup!);

    const publicArchive = await handler(request("/api/download?type=markdown&scope=public"));
    expect(publicArchive?.status).toBe(200);
    expect(publicArchive!.headers.get("x-wiki-cache-scope")).toBe("public");
    const publicZip = await JSZip.loadAsync(await publicArchive!.arrayBuffer());
    expect(Object.keys(publicZip.files)).toContain("wiki/public.md");
    expect(Object.keys(publicZip.files)).not.toContain("private/plan.md");

    const sessionArchive = await handler(
      request("/api/download?type=markdown&scope=session", {
        headers: { Cookie: cookie },
      }),
    );
    expect(sessionArchive?.status).toBe(200);
    expect(sessionArchive!.headers.get("x-wiki-cache-scope")).toBe("session");
    expect(sessionArchive!.headers.get("cache-control")).toContain("private");
    const sessionZip = await JSZip.loadAsync(await sessionArchive!.arrayBuffer());
    expect(Object.keys(sessionZip.files)).toContain("private/plan.md");
    const privateBody = await sessionZip.file("private/plan.md")!.async("string");
    expect(privateBody).not.toContain("Diana Laster");
    expect(privateBody).not.toContain("88855655");

    const fullArchive = await handler(request("/api/download?type=full&scope=public&limit=1"));
    const fullZip = await JSZip.loadAsync(await fullArchive!.arrayBuffer());
    expect(Object.keys(fullZip.files)).toContain("sources/public/source.pdf");
    expect(Object.keys(fullZip.files)).toContain("biopsy/raw/dicom.zip");
    expect(Object.keys(fullZip.files)).not.toContain("private/plan.zip");

    const sessionFullArchive = await handler(
      request("/api/download?type=full&scope=session&limit=1", {
        headers: { Cookie: cookie },
      }),
    );
    const sessionFullZip = await JSZip.loadAsync(await sessionFullArchive!.arrayBuffer());
    expect(Object.keys(sessionFullZip.files)).toContain("private/plan.zip");
  });

  test("serves a nested sensitive asset when the signed-in user can access every owner", async () => {
    const originalFetch = globalThis.fetch;
    const fetchCalls: RequestInfo[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetchCalls.push(input as RequestInfo);
      return new Response("private", {
        headers: { "Content-Length": "7" },
      });
    }) as typeof fetch;

    try {
      const handler = createWikiApiHandler(createFakeConvexClient() as never);
      const cookie = await signupCookie(
        handler,
        "nested-owner@example.com",
      );
      const response = await handler(
        request("/api/file?path=private%2Fimages%2Fscan.png", {
          headers: { Cookie: cookie },
        }),
      );

      expect(response?.status).toBe(200);
      expect(response!.headers.get("cache-control")).toContain("private");
      expect(response!.headers.get("x-wiki-cache-scope")).toBe("session");
      expect(response!.headers.get("vary")).toContain("Cookie");
      expect(fetchCalls).toEqual(["https://blob.example/private-scan.png"]);
      expect(await response!.text()).toBe("private");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("rejects a sensitive asset when the signed-in user lacks any recorded owner", async () => {
    const originalFetch = globalThis.fetch;
    const fetchCalls: RequestInfo[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetchCalls.push(input as RequestInfo);
      return new Response("private");
    }) as typeof fetch;

    try {
      const handler = createWikiApiHandler(
        createFakeConvexClient({
          deniedSlugs: ["private/shared"],
        }) as never,
      );
      const cookie = await signupCookie(
        handler,
        "partial-owner@example.com",
      );
      const response = await handler(
        request("/api/file?path=private%2Fplan.pdf", {
          headers: { Cookie: cookie },
        }),
      );

      expect(response?.status).toBe(404);
      expect(response!.headers.get("cache-control")).toBe(
        "private, no-store",
      );
      expect(response!.headers.get("vary")).toContain("Cookie");
      expect(fetchCalls).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("denies gate-only sensitive assets while keeping gated public files private", async () => {
    const originalFetch = globalThis.fetch;
    const fetchCalls: RequestInfo[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetchCalls.push(input as RequestInfo);
      return new Response("public", {
        headers: { "Content-Length": "6" },
      });
    }) as typeof fetch;

    try {
      const handler = createWikiApiHandler(createFakeConvexClient() as never);
      const login = await handler(
        request("/api/login?token=diana&redirect=%2F"),
      );
      const gateCookie = cookieFrom(login!);

      const sensitive = await handler(
        request("/api/file?path=private%2Fimages%2Fscan.png", {
          headers: { Cookie: gateCookie },
        }),
      );
      expect(sensitive?.status).toBe(404);
      expect(sensitive!.headers.get("cache-control")).toBe(
        "private, no-store",
      );
      expect(sensitive!.headers.get("vary")).toContain("Cookie");
      expect(fetchCalls).toEqual([]);

      const publicFile = await handler(
        request("/api/file?path=sources%2Fpublic%2Fsource.pdf", {
          headers: { Cookie: gateCookie },
        }),
      );
      expect(publicFile?.status).toBe(200);
      expect(publicFile!.headers.get("cache-control")).toContain("private");
      expect(publicFile!.headers.get("x-wiki-cache-scope")).toBe("public");
      expect(fetchCalls).toEqual(["https://blob.example/source.pdf"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not fetch a tombstoned or unknown asset", async () => {
    const originalFetch = globalThis.fetch;
    const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
    const fetchCalls: RequestInfo[] = [];
    process.env.BLOB_READ_WRITE_TOKEN = "test-blob-token";
    fallbackBlobPath = "sites/diana/files/deleted/scan.png";
    fallbackBlobUrl = "https://blob.example/recovered-scan.png";
    blobListCalls = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetchCalls.push(input as RequestInfo);
      return new Response("unexpected");
    }) as typeof fetch;

    try {
      const handler = createWikiApiHandler(createFakeConvexClient() as never);
      const cookie = await signupCookie(
        handler,
        "missing-asset@example.com",
      );
      const response = await handler(
        request("/api/file?path=deleted%2Fscan.png", {
          headers: { Cookie: cookie },
        }),
      );

      expect(response?.status).toBe(404);
      expect(response!.headers.get("cache-control")).toBe(
        "private, no-store",
      );
      expect(fetchCalls).toEqual([]);
      expect(blobListCalls).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalBlobToken === undefined) {
        delete process.env.BLOB_READ_WRITE_TOKEN;
      } else {
        process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken;
      }
      fallbackBlobPath = null;
      fallbackBlobUrl = null;
      blobListCalls = [];
    }
  });

  for (const fallbackPath of [
    "sites/diana/files/sources/public/source.pdf",
    "files/sources/public/source.pdf",
  ]) {
    test(`recovers a stale active Blob URL from ${fallbackPath}`, async () => {
      const originalFetch = globalThis.fetch;
      const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
      const fetchCalls: Array<{
        input: RequestInfo | URL;
        range: string | null;
      }> = [];
      process.env.BLOB_READ_WRITE_TOKEN = "test-blob-token";
      fallbackBlobPath = fallbackPath;
      fallbackBlobUrl = "https://blob.example/recovered-source.pdf";
      blobListCalls = [];
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        fetchCalls.push({
          input,
          range: new Headers(init?.headers).get("Range"),
        });
        if (input === "https://blob.example/source.pdf") {
          return new Response("stale", { status: 404 });
        }
        return new Response("abc", {
          status: 206,
          headers: {
            "Accept-Ranges": "bytes",
            "Content-Length": "3",
            "Content-Range": "bytes 0-2/9",
          },
        });
      }) as typeof fetch;

      try {
        const handler = createWikiApiHandler(createFakeConvexClient() as never);
        const login = await handler(
          request("/api/login?token=diana&redirect=%2F"),
        );
        const gateCookie = cookieFrom(login!);
        const response = await handler(
          request("/api/file?path=sources/public/source.pdf", {
            headers: {
              Cookie: gateCookie,
              Range: "bytes=0-2",
            },
          }),
        );

        expect(response?.status).toBe(206);
        expect(response!.headers.get("accept-ranges")).toBe("bytes");
        expect(response!.headers.get("content-range")).toBe("bytes 0-2/9");
        expect(response!.headers.get("content-length")).toBe("3");
        expect(response!.headers.get("cache-control")).toContain("private");
        expect(response!.headers.get("vary")).toContain("Cookie");
        expect(response!.headers.get("x-wiki-cache-scope")).toBe("public");
        expect(await response!.text()).toBe("abc");
        expect(fetchCalls).toEqual([
          {
            input: "https://blob.example/source.pdf",
            range: "bytes=0-2",
          },
          {
            input: "https://blob.example/recovered-source.pdf",
            range: "bytes=0-2",
          },
        ]);
        expect(blobListCalls).toEqual(
          fallbackPath.startsWith("sites/")
            ? [
                {
                  prefix: "sites/diana/files/sources/public/source.pdf",
                  token: "test-blob-token",
                },
              ]
            : [
                {
                  prefix: "sites/diana/files/sources/public/source.pdf",
                  token: "test-blob-token",
                },
                {
                  prefix: "files/sources/public/source.pdf",
                  token: "test-blob-token",
                },
              ],
        );
      } finally {
        globalThis.fetch = originalFetch;
        if (originalBlobToken === undefined) {
          delete process.env.BLOB_READ_WRITE_TOKEN;
        } else {
          process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken;
        }
        fallbackBlobPath = null;
        fallbackBlobUrl = null;
        blobListCalls = [];
      }
    });
  }

  test("preserves a recovered Blob 416 response and range metadata", async () => {
    const originalFetch = globalThis.fetch;
    const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
    process.env.BLOB_READ_WRITE_TOKEN = "test-blob-token";
    fallbackBlobPath = "sites/diana/files/sources/public/source.pdf";
    fallbackBlobUrl = "https://blob.example/recovered-source.pdf";
    blobListCalls = [];
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      expect(new Headers(init?.headers).get("Range")).toBe("bytes=99-100");
      if (input === "https://blob.example/source.pdf") {
        return new Response("stale", { status: 404 });
      }
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": "bytes */9" },
      });
    }) as typeof fetch;

    try {
      const handler = createWikiApiHandler(createFakeConvexClient() as never);
      const response = await handler(
        request("/api/file?path=sources/public/source.pdf", {
          headers: { Range: "bytes=99-100" },
        }),
      );

      expect(response?.status).toBe(416);
      expect(response!.headers.get("content-range")).toBe("bytes */9");
      expect(response!.headers.get("x-wiki-cache-scope")).toBe("public");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalBlobToken === undefined) {
        delete process.env.BLOB_READ_WRITE_TOKEN;
      } else {
        process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken;
      }
      fallbackBlobPath = null;
      fallbackBlobUrl = null;
      blobListCalls = [];
    }
  });

  test("passes Range through /api/file and streams 206 responses", async () => {
    const originalFetch = globalThis.fetch;
    const fetchCalls: RequestInfo[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push(input as RequestInfo);
      expect(new Headers(init?.headers).get("Range")).toBe("bytes=0-3");
      return new Response("abcd", {
        status: 206,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Length": "4",
          "Content-Range": "bytes 0-3/9",
        },
      });
    }) as typeof fetch;

    try {
      const handler = createWikiApiHandler(createFakeConvexClient() as never);
      const response = await handler(
        request("/api/file?path=sources/public/source.pdf", {
          headers: { Range: "bytes=0-3" },
        }),
      );

      expect(fetchCalls).toHaveLength(1);
      expect(response?.status).toBe(206);
      expect(response!.headers.get("accept-ranges")).toBe("bytes");
      expect(response!.headers.get("content-range")).toBe("bytes 0-3/9");
      expect(response!.headers.get("content-length")).toBe("4");
      expect(await response!.text()).toBe("abcd");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("preserves an upstream 416 response and range metadata", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Range")).toBe("bytes=99-100");
      return new Response(null, {
        status: 416,
        headers: {
          "Content-Range": "bytes */9",
        },
      });
    }) as typeof fetch;

    try {
      const handler = createWikiApiHandler(createFakeConvexClient() as never);
      const response = await handler(
        request("/api/file?path=sources/public/source.pdf", {
          headers: { Range: "bytes=99-100" },
        }),
      );

      expect(response?.status).toBe(416);
      expect(response!.headers.get("content-range")).toBe("bytes */9");
      expect(response!.headers.get("x-wiki-cache-scope")).toBe("public");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
