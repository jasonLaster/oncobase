import { describe, expect, mock, test } from "bun:test";
import { getFunctionName, type FunctionReference } from "convex/server";
import JSZip from "jszip";
import {
  createWikiApiHandler,
  isPasswordGateEnabled,
} from "./wiki-api";
import { traceBackendHandler, type BackendProfile } from "./backend-tracing";

process.env.WIKI_GATE_SESSION_SECRET = "wiki-api-test-gate-secret";
process.env.DIANA_WIKI_PASSWORD_HASH =
  "sha256:1b2fc9341a16ae4e30082965d537ae47c21a0f27fd43eab78330ed81751ae6db";

let fallbackBlobPath: string | null = null;
let fallbackBlobUrl: string | null = null;
let blobListCalls: Array<{ prefix: string; token: string }> = [];

// Route handlers load lazily, after this mock is installed; keep the rest of
// the real module (the publisher's blob helpers) available to them.
const realBlob = { ...await import("@vercel/blob") };
mock.module("@vercel/blob", () => ({
  ...realBlob,
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

async function gateCookie(
  handler: ReturnType<typeof createWikiApiHandler>,
) {
  const login = await handler(
    request("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "diana" }),
    }),
  );
  expect(login?.status).toBe(200);
  return cookieFrom(login!);
}

async function signupCookie(
  handler: ReturnType<typeof createWikiApiHandler>,
  email: string,
) {
  const passwordGateCookie = await gateCookie(handler);
  const signup = await handler(
    request("/api/auth/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: passwordGateCookie,
      },
      body: JSON.stringify({
        email,
        password: "correct horse battery",
      }),
    }),
  );
  expect(signup?.status).toBe(200);
  return `${passwordGateCookie}; ${cookieFrom(signup!)}`;
}

function createFakeConvexClient({
  deniedSlugs = [],
  failPasswordGateLookup = false,
  passwordHash,
  passwordGate = false,
  passwordGateState,
  extraPages = [],
  extraAssets = [],
}: {
  deniedSlugs?: string[];
  failPasswordGateLookup?: boolean;
  passwordHash?: string;
  passwordGate?: boolean;
  extraPages?: FakePage[];
  extraAssets?: FakeAsset[];
  passwordGateState?: {
    lookups?: number;
    passwordGate: boolean;
    passwordHash?: string;
  };
} = {}) {
  const deniedSlugSet = new Set(deniedSlugs);
  const users = new Map<string, FakeUser>();
  const sessions = new Map<string, FakeSession>();
  const pages: FakePage[] = [
    ...extraPages,
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
    ...extraAssets,
    {
      path: "sources/public/image.avif",
      blobUrl: "data:image/avif;base64,YXZpZg==",
      ownerSlugs: [],
      sizeBytes: 4,
      sensitive: false,
    },
    {
      path: "sources/public/source.pdf",
      blobUrl: "https://blob.example/source.pdf",
      ownerSlugs: [],
      sizeBytes: 9,
      sensitive: false,
    },
    {
      path: "legacy/unversioned.png",
      blobUrl: "https://blob.example/legacy-unversioned.png",
      sizeBytes: 7,
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
          if (failPasswordGateLookup) {
            throw new Error("site config unavailable");
          }
          if (passwordGateState) {
            passwordGateState.lookups =
              (passwordGateState.lookups ?? 0) + 1;
          }
          return {
            slug: args.slug,
            config: passwordGateState ?? { passwordGate, passwordHash },
          };
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
          const visiblePages = pages.filter((page) => (includeSensitive || !page.sensitive) && (!args.sensitiveOnly || page.sensitive === true));
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
        case "documents:searchCorpusPlan":
          return { ranges: [{ partition: 0, from: null, to: null }], documents: pages.filter(page => !page.sensitive).length, planned: true };
        case "documents:listSearchPages":
          return {
            page: pages.filter((page) => !page.sensitive)
              .map(({ slug, title, content }) => ({ slug, title, content, contentHash: slug })),
            isDone: true,
            continueCursor: "",
          };
        case "documents:search": {
          const query = String(args.query ?? "").toLowerCase();
          const limit = Number(args.limit ?? 10);
          return pages
            .filter(
              (page) =>
                !page.sensitive &&
                `${page.title}\n${page.content}`.toLowerCase().includes(query),
            )
            .slice(0, limit)
            .map((page) => ({
              slug: page.slug,
              title: page.title,
              tags: page.tags,
              excerpt: page.content,
            }));
        }
        case "documents:listPage":
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
        case "documents:listPdfAssetVisibilityPage": {
          const includeSensitive = args.includeSensitive === true;
          return {
            page: [
              {
                path: "sources/public/source.pdf",
                ownerSlugs: [],
                sensitive: false,
              },
              ...(includeSensitive
                ? [
                    {
                      path: "private/plan.pdf",
                      ownerSlugs: ["private/plan", "private/shared"],
                      sensitive: true,
                    },
                  ]
                : []),
            ],
            isDone: true,
            continueCursor: null,
          };
        }
        case "documents:listFileAssetVisibilityPage":
          return {
            page: extraAssets.filter(asset => args.includeSensitive || asset.sensitive === false)
              .map(({ path, ownerSlugs, sensitive }) => ({ path, ownerSlugs, sensitive })),
            isDone: true,
            continueCursor: null,
          };
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
        case "documents:listPdfAssetPathsPage":
          return {
            page: ["sources/public/source.pdf"],
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
        case "documents:getSensitivityBySlugs":
          return (args.slugs as string[]).flatMap((slug) => {
            const page = pages.find((candidate) => candidate.slug === slug);
            return page ? [{ slug, sensitive: page.sensitive === true }] : [];
          });
        case "access:canUserAccessSlug":
          return !deniedSlugSet.has(String(args.slug));
        case "access:listAllowedSensitiveManifestPage":
          return {
            page: pages.filter(page => page.sensitive === true && !deniedSlugSet.has(page.slug))
              .map(page => ({ slug: page.slug, title: page.title, tags: page.tags, description: null, contentHash: page.slug, sensitive: true, size: page.content.length })),
            isDone: true,
            continueCursor: null,
          };
        case "access:listAllowedSensitivePage":
          return { slugs: pages.filter(page => page.sensitive === true && !deniedSlugSet.has(page.slug)).map(page => page.slug), isDone: true, continueCursor: null };
        case "access:filterAccessibleSlugs":
          return (args.slugs as string[]).map((slug) => ({
            slug,
            allowed: !deniedSlugSet.has(slug),
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
        case "dicom:listSeries":
          expect(args.includeImages, "Catalog must not eagerly read every DICOM image").toBe(false);
          return [
            {
              _id: "series-1",
              seriesKey: "1.2.3",
              label: "2026-06-26 · MR · PHASE 2 SUB",
              relativeDirectory: "06-26-breast-mri/dicoms",
              modality: "MR",
              studyDescription: "BREAST MRI",
              seriesDescription: "PHASE 2 SUB",
              studyDate: "2026-06-26",
              seriesNumber: 101,
              imageCount: 1,
              images: [],
            },
          ];
        case "dicom:listSeriesImages":
          return [
            {
              _id: "image-1",
              fileName: "06-26-breast-mri-4013-MR.dcm",
              path: "06-26-breast-mri/dicoms/06-26-breast-mri-4013-MR.dcm",
              sizeBytes: 1024,
              uploadedAt: 0,
              instanceNumber: 1,
              imagePosition: [0, 0, -89.28],
              rows: 512,
              columns: 512,
              pixelSpacing: [0.7031, 0.7031],
            },
          ];
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
  test("public illustrations shared with wiki updates work through both file routes", async () => {
    const slug = "wiki/education/designing-a-vaccine/index";
    const owner = "wiki/updates/week-13";
    const image = "wiki/education/designing-a-vaccine/images/steps-light.png";
    const handler = createWikiApiHandler(createFakeConvexClient({ passwordGate: true,
      extraPages: [{ slug, title: "Vaccine design", content: "Lesson", tags: [] },
        { slug: owner, title: "Updates", content: "Update", tags: [] }],
      extraAssets: [{ path: image, ownerSlugs: [slug, owner], sensitive: false,
        blobUrl: "data:image/png;base64,aW1hZ2U=" }],
    }) as never);
    for (const endpoint of ["/api/education/file", "/api/education/api/file", "/api/file"]) {
      const response = await handler(request(`${endpoint}?path=${encodeURIComponent(image)}`));
      expect(response?.status).toBe(200);
      expect(await response!.text()).toBe("image");
      expect(response!.headers.get("cache-control")).toBe("private, no-store");
    }
    const manifest = await (await handler(request("/api/education/manifest")))!.json();
    expect(manifest.pages.map((page: { slug: string }) => page.slug)).toEqual([slug]);
    const cookie = await gateCookie(handler);
    const wikiImage = await handler(request(`/api/file?path=${encodeURIComponent(image)}`, { headers: { Cookie: cookie } }));
    expect(wikiImage?.status).toBe(200);
    expect(await wikiImage!.text()).toBe("image");
  });
  test("dedicated education endpoints keep public scope with or without a wiki password", async () => {
    const slug = "wiki/education/oncology-101/index";
    const image = "wiki/education/oncology-101/cartoon.png";
    for (const passwordGate of [true, false]) {
      const handler = createWikiApiHandler(createFakeConvexClient({ passwordGate,
        extraPages: [{ slug, title: "Oncology 101", content: "Public lesson <redact>Patient detail</redact>", tags: [] },
          { slug: "wiki/education/private-case", title: "Private case", content: "Private lesson", tags: [], sensitive: true }],
        extraAssets: [{ path: image, ownerSlugs: [slug], sensitive: false, blobUrl: "data:image/png;base64,aW1hZ2U=" },
          { path: "wiki/education/mixed.png", ownerSlugs: [slug, "private/plan"], sensitive: false, blobUrl: "data:image/png;base64,aW1hZ2U=" }],
      }) as never);
      const cookie = passwordGate ? await gateCookie(handler) : "wiki_user_session=test";
      for (const headers of [new Headers(), new Headers({ Cookie: cookie })]) {
        const manifestResponse = await handler(request("/api/education/manifest", { headers }));
        expect(manifestResponse?.status).toBe(200);
        expect(manifestResponse!.headers.get("cache-control")).toBe("private, no-store");
        const manifest = await manifestResponse!.json();
        expect(manifest.pages.map((page: { slug: string }) => page.slug)).toEqual([slug]);
        expect(JSON.stringify(manifest)).not.toContain("mixed.png");
        const batch = await (await handler(request(`/api/education/pages?slugs=${slug},private/plan,wiki/education/private-case`, { headers })))!.json();
        expect(batch.pages.map((page: { slug: string }) => page.slug)).toEqual([slug]);
        expect(JSON.stringify(batch)).not.toContain("Patient detail");
        const search = await (await handler(request("/api/education/search?q=Public", { headers })))!.json();
        expect(search.results.map((page: { slug: string }) => page.slug)).toEqual([slug]);
        expect((await handler(request(`/api/education/api/file?path=${image}`, { headers })))?.status).toBe(200);
        expect((await handler(request("/api/education/file?path=wiki/education/mixed.png", { headers })))?.status).toBe(404);
        expect((await handler(request("/api/education/file?path=sources/public/file.pdf", { headers })))?.status).toBe(404);
        const copy = await handler(request(`/api/education/page-copy?slug=${slug}`, { headers }));
        expect(await copy!.text()).not.toContain("Patient detail");
        expect((await handler(request("/api/education/pages?scope=session", { headers })))?.status).toBe(401);
        expect((await handler(request("/api/education/search?q=Public&scope=session", { headers })))?.status).toBe(401);
      }
      expect((await handler(request("/api/education/manifest", { method: "POST" })))?.status).toBe(405);
      expect((await handler(request("/api/education/chat")))?.status).toBe(404);
    }
  });
  test("anonymous Diana readers receive only redacted education pages, assets, and search results", async () => {
    const slug = "wiki/education/oncology-101/index";
    const image = "wiki/education/oncology-101/cartoon.png";
    const lab = "wiki/education/cellular-therapies/tools/lab.html";
    const handler = createWikiApiHandler(createFakeConvexClient({ passwordGate: true,
      extraPages: [
        { slug, title: "Oncology 101", tags: [], content: "# Oncology 101\n\nPublic lesson. <redact>Hidden patient detail</redact>" },
        { slug: "wiki/education/private-case", title: "Private case", tags: [], content: "Sensitive lesson", sensitive: true },
      ],
      extraAssets: [
        { path: image, ownerSlugs: [slug], sensitive: false, blobUrl: "data:image/png;base64,aW1hZ2U=" },
        { path: lab, ownerSlugs: [slug], sensitive: false, blobUrl: "data:text/html,<h1>Learning lab</h1>" },
        { path: "wiki/education/mixed.png", ownerSlugs: [slug, "private/plan"], sensitive: false, blobUrl: "data:image/png;base64,aW1hZ2U=" },
        { path: "wiki/education/unowned.png", ownerSlugs: [], sensitive: false, blobUrl: "data:image/png;base64,aW1hZ2U=" },
        { path: "wiki/education/private.png", ownerSlugs: [slug], sensitive: true, blobUrl: "data:image/png;base64,aW1hZ2U=" },
      ],
    }) as never);
    for (const query of ["scope=public", "scope=session&fallback=public"]) {
      const response = await handler(request(`/api/wiki/session?${query}`));
      expect(response?.status).toBe(200);
      expect(response!.headers.get("cache-control")).toBe("private, no-store");
      expect(await response!.json()).toMatchObject({ scope: "public", authenticated: false,
        cacheKey: expect.stringMatching(/:education$/) });
    }
    const manifestResponse = await handler(request("/api/wiki/manifest"));
    const manifest = await manifestResponse!.json();
    expect(manifest.pages.map((page: { slug: string }) => page.slug)).toEqual([slug]);
    expect(JSON.stringify(manifest)).not.toContain("private/plan");
    expect(JSON.stringify(manifest)).not.toContain("sources/public");
    expect(JSON.stringify(manifest)).not.toContain("mixed.png");
    expect(JSON.stringify(manifest)).not.toContain("unowned.png");
    const batch = await (await handler(request("/api/wiki/pages")))!.json();
    expect(batch.pages.map((page: { slug: string }) => page.slug)).toEqual([slug]);
    expect(JSON.stringify(batch)).not.toContain("Hidden patient detail");
    const search = await (await handler(request("/api/search?q=Public")))!.json();
    expect(search.results.map((page: { slug: string }) => page.slug)).toEqual([slug]);
    const imageResponse = await handler(request(`/api/file?path=${image}`));
    expect(imageResponse?.status).toBe(200);
    expect(imageResponse!.headers.get("content-type")).toBe("image/png");
    expect(imageResponse!.headers.get("cache-control")).toBe("private, no-store");
    const labResponse = await handler(request(`/api/file?path=${lab}`));
    expect(labResponse?.status).toBe(200);
    expect(labResponse!.headers.get("content-type")).toContain("text/html");
    expect(labResponse!.headers.get("content-security-policy")).toBe("sandbox allow-scripts allow-popups");
    expect(await labResponse!.text()).toContain("Learning lab");
    for (const path of ["mixed.png", "unowned.png", "private.png"]) {
      expect((await handler(request(`/api/file?path=wiki/education/${path}`)))?.status).toBe(404);
    }
    const copy = await handler(request(`/api/page-copy?slug=${slug}`));
    expect(copy?.status).toBe(200);
    expect(await copy!.text()).not.toContain("Hidden patient detail");
    expect((await handler(request("/api/page-copy?slug=wiki/education/private-case")))?.status).toBe(404);
    expect((await handler(request("/api/wiki/pages?scope=session")))?.status).toBe(401);
    expect((await handler(request("/api/search?q=Public&scope=session")))?.status).toBe(401);
    expect((await handler(request("/api/wiki/prefetch")))?.status).toBe(200);
    expect((await handler(request("/api/wiki/prefetch", { method: "POST" })))?.status).toBe(401);
    // The existing password still restores the full non-sensitive reader.
    const cookie = await gateCookie(handler);
    const full = await (await handler(request("/api/wiki/manifest", { headers: { Cookie: cookie } })))!.json();
    expect(full.pages.map((page: { slug: string }) => page.slug)).toContain("wiki/public");
    const identity = await (await handler(request("/api/wiki/session?scope=public", { headers: { Cookie: cookie } })))!.json();
    expect(identity.cacheKey).not.toEndWith(":education");
  });

  test("serves published AVIF assets with their image MIME type", async () => {
    const handler = createWikiApiHandler(createFakeConvexClient() as never);
    const response = await handler(request("/api/file?path=sources/public/image.avif"));
    expect(response?.status).toBe(200);
    expect(response!.headers.get("content-type")).toBe("image/avif");
    expect(await response!.text()).toBe("avif");
  });

  test("gates non-educational content APIs with private responses", async () => {
    const handler = createWikiApiHandler(
      createFakeConvexClient({ passwordGate: true }) as never,
    );
    const readerPaths = [
      "/api/wiki/convex-token",
      "/api/wiki/pages?slugs=wiki/public",
      "/api/timeline",
      "/api/diagnostic-studies",
      "/api/dicom/file?path=example.dcm",
      "/api/dicom/studies",
      "/api/dicom/annotations",
      "/api/dicom/comparisons",
      "/api/test/diagnostic-studies",
      "/api/test/dicom-comparisons",
      "/api/ai-search",
      "/api/chat",
      "/api/tools",
      "/api/liveblocks-auth",
      "/api/liveblocks-threads",
      "/api/liveblocks-add-comment",
      "/api/liveblocks-delete-thread",
      "/api/liveblocks-users",
      "/api/liveblocks-guest",
      "/api/download",
      "/api/file?path=sources/public/source.pdf",
      "/api/page-copy?slug=wiki/public",
    ];

    for (const path of readerPaths) {
      const response = await handler(request(path));
      expect(response?.status, path).toBe(401);
      expect(response!.headers.get("cache-control"), path).toBe(
        "private, no-store",
      );
      expect(response!.headers.get("vary"), path).toContain("Cookie");
      expect(response!.headers.get("vary"), path).toContain("Host");
      expect(await response!.json(), path).toEqual({
        error: "Password gate authentication required",
      });
    }
  });

  test("public education does not remove the gate on other wiki sites", async () => {
    const base = createFakeConvexClient({ passwordGate: true });
    const client = { ...base, async query(ref: FunctionReference<"query">, args: Record<string, unknown>) {
      if (getFunctionName(ref) === "sites:getByHost") return { slug: "other-wiki" };
      return base.query(ref, args);
    } };
    const handler = createWikiApiHandler(client as never);
    for (const path of ["/api/wiki/manifest", "/api/wiki/pages?slugs=wiki/education/index", "/api/search?q=lesson"]) {
      const response = await handler(new Request(`https://other-education-gate.example${path}`));
      expect(response?.status).toBe(401);
    }
    const education = await handler(new Request("https://other-education-gate.example/api/education/manifest"));
    expect(education?.status).toBe(404);
    expect(education!.headers.get("cache-control")).toBe("private, no-store");
  });

  test("allows a valid signed gate cookie across core content APIs", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL) =>
      new Response("%PDF-1.4", {
        headers: { "Content-Length": "8" },
      })) as typeof fetch;

    try {
      const handler = createWikiApiHandler(
        createFakeConvexClient({ passwordGate: true }) as never,
      );
      const gateCookieValue = await gateCookie(handler);
      const coreRequests = [
        request("/api/wiki/session", { headers: { Cookie: gateCookieValue } }),
        request("/api/wiki/prefetch", { headers: { Cookie: gateCookieValue } }),
        request("/api/wiki/manifest", { headers: { Cookie: gateCookieValue } }),
        request("/api/wiki/pages?slugs=wiki/public", {
          headers: { Cookie: gateCookieValue },
        }),
        request("/api/search?q=public", {
          headers: { Cookie: gateCookieValue },
        }),
        request("/api/download?type=markdown&scope=public", {
          headers: { Cookie: gateCookieValue },
        }),
        request("/api/file?path=sources/public/source.pdf", {
          headers: { Cookie: gateCookieValue },
        }),
        request("/api/page-copy?slug=wiki/public", {
          headers: { Cookie: gateCookieValue },
        }),
      ];

      for (const [index, gatedRequest] of coreRequests.entries()) {
        const response = await handler(gatedRequest);
        expect(response?.status, gatedRequest.url).toBe(200);
        if (index === 0) continue;
        expect(response!.headers.get("cache-control"), gatedRequest.url).toBe(
          "private, no-store",
        );
        expect(
          response!.headers.get("cdn-cache-control"),
          gatedRequest.url,
        ).toBeNull();
        expect(response!.headers.get("vary"), gatedRequest.url).toContain("Cookie");
        expect(response!.headers.get("vary"), gatedRequest.url).toContain("Host");
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("rejects an existing gate cookie after the configured password rotates", async () => {
    const originalHash = process.env.DIANA_WIKI_PASSWORD_HASH;
    const passwordGateState: {
      lookups?: number;
      passwordGate: boolean;
      passwordHash?: string;
    } = {
      passwordGate: true,
      passwordHash: originalHash,
    };
    const handler = createWikiApiHandler(
      createFakeConvexClient({
        passwordGate: true,
        passwordGateState,
      }) as never,
    );
    const cookie = await gateCookie(handler);

    expect(
      (
        await handler(
          request("/api/wiki/manifest", { headers: { Cookie: cookie } }),
        )
      )?.status,
    ).toBe(200);

    const lookupsBeforeRotation = passwordGateState.lookups ?? 0;
    passwordGateState.passwordHash = "sha256:rotated-password-hash";
    const afterRotation = await handler(
      request("/api/wiki/pages?slugs=wiki/public", { headers: { Cookie: cookie } }),
    );
    expect(afterRotation?.status).toBe(401);
    expect(passwordGateState.lookups).toBe(lookupsBeforeRotation + 1);
  });

  test("fails closed without caching a custom site's gate lookup failure", async () => {
    let lookups = 0;
    const client = {
      async query() {
        lookups += 1;
        throw new Error("site config unavailable");
      },
    };

    await expect(
      isPasswordGateEnabled(client as never, "custom"),
    ).rejects.toThrow("site config unavailable");
    await expect(
      isPasswordGateEnabled(client as never, "custom"),
    ).rejects.toThrow("site config unavailable");
    expect(lookups).toBe(2);

    const handler = createWikiApiHandler(
      createFakeConvexClient({ failPasswordGateLookup: true }) as never,
    );
    const response = await handler(
      new Request("http://custom.localhost/api/wiki/manifest", {
        headers: { Host: "custom.localhost" },
      }),
    );
    expect(response?.status).toBe(503);
    expect(response!.headers.get("cache-control")).toBe("private, no-store");
    expect(response!.headers.get("vary")).toContain("Cookie");
  });

  test("keeps login, auth, share previews, and service endpoints outside the API gate", async () => {
    const handler = createWikiApiHandler(
      createFakeConvexClient({ passwordGate: true }) as never,
    );
    const requests = [
      request("/api/login"),
      request("/api/auth/session"),
      request("/api/wiki/session"),
      request("/api/share-preview?path=%2Fwiki%2Fpublic"),
      request("/api/liveblocks-webhook"),
      request("/api/publish/unknown"),
      request("/api/integrations/epic/callback"),
    ];

    for (const exemptRequest of requests) {
      const response = await handler(exemptRequest);
      expect(response, exemptRequest.url).not.toBeNull();
      expect(await response!.clone().text(), exemptRequest.url).not.toContain(
        "Password gate authentication required",
      );
    }
  });

  test("does not register the retired no-op post-deploy endpoint", async () => {
    const handler = createWikiApiHandler(createFakeConvexClient() as never);
    expect(await handler(request("/api/post-deploy"))).toBeNull();
    expect(await handler(new Request("https://example.test/api/post-deploy", { method: "POST" }))).toBeNull();
  });

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

  test("shares one public corpus load across concurrent text searches", async () => {
    const client = createFakeConvexClient();
    const originalQuery = client.query.bind(client);
    let corpusLoads = 0;
    client.query = async (ref, args) => {
      if (getFunctionName(ref) === "documents:listSearchPages") {
        corpusLoads += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return originalQuery(ref, args);
    };
    const handler = createWikiApiHandler(client as never);

    const responses = await Promise.all([
      handler(request("/api/search?q=public")),
      handler(request("/api/search?q=body")),
    ]);

    expect(responses.map((response) => response?.status)).toEqual([200, 200]);
    expect(corpusLoads).toBe(1);
  });

  test("returns indexed results while a slow public corpus finishes warming", async () => {
    const client = createFakeConvexClient();
    const originalQuery = client.query.bind(client);
    let release = () => {};
    const corpusRead = new Promise<void>((resolve) => { release = resolve; });
    let corpusReads = 0;
    client.query = async (ref, args) => {
      if (getFunctionName(ref) === "documents:listSearchPages") {
        corpusReads += 1;
        await corpusRead;
      }
      return originalQuery(ref, args);
    };
    const profiles: BackendProfile[] = [];
    const handler = traceBackendHandler(
      createWikiApiHandler(client as never),
      { onProfile: profile => profiles.push(profile) },
    );
    const previousWait = process.env.WIKI_SEARCH_CORPUS_WAIT_MS;
    process.env.WIKI_SEARCH_CORPUS_WAIT_MS = "1";

    try {
      const response = await handler(request("/api/search?q=public"));
      expect(response?.status).toBe(200);
      expect(response!.headers.get("x-wiki-search-completeness")).toBe("indexed");
      // Interim results must not be replayed from a browser or CDN cache.
      expect(response!.headers.get("cache-control")).toBe("no-store");
      expect(await response!.json()).toEqual({
        complete: false,
        retryAfterMs: 1_000,
        results: [
          expect.objectContaining({
            excerpt: expect.stringContaining("Public wiki body"),
            slug: "wiki/public",
          }),
        ],
      });

      // The reader's retry waits for the load already in flight (no second
      // corpus read) and receives the cacheable exhaustive response.
      const retry = handler(request("/api/search?q=public", { headers: { "X-Wiki-Search-Wait": "exhaustive" } }));
      await new Promise((resolve) => setTimeout(resolve, 10));
      release();
      const exhaustive = await retry;
      expect(exhaustive!.headers.get("x-wiki-search-completeness")).toBe("exhaustive");
      expect(exhaustive!.headers.get("cache-control")).toContain("s-maxage=300");
      expect((await exhaustive!.json()).results.map((result: { slug: string }) => result.slug)).toEqual(["wiki/public"]);
      expect(corpusReads).toBe(1);

      // Fixed modes and counts only: prod traces show which path answered.
      expect(profiles.map(profile => profile.attributes)).toEqual([
        expect.objectContaining({ "search.mode": "indexed", "search.wait": "short", "search.corpus.wait": "budget-exceeded", "search.corpus.wait_budget_ms": 1, "search.corpus.state": "miss", "search.results": 1 }),
        expect.objectContaining({ "search.mode": "exhaustive", "search.wait": "exhaustive", "search.corpus.wait": "ready", "search.corpus.wait_budget_ms": 15_000, "search.corpus.state": "fresh",
          "search.corpus.pages": 1, "search.corpus.ranges": 1, "search.corpus.rpcs": 2, "search.corpus.planned": true, "search.results": 1 }),
      ]);
      expect(profiles[0]!.phases.map(phase => phase.name)).toContain("search.indexed");
      expect(profiles[1]!.phases.map(phase => phase.name)).toContain("search.match");
    } finally {
      release();
      if (previousWait == null) delete process.env.WIKI_SEARCH_CORPUS_WAIT_MS;
      else process.env.WIKI_SEARCH_CORPUS_WAIT_MS = previousWait;
    }
  });

  test("keeps text and AI search in the explicit reader scope", async () => {
    const handler = createWikiApiHandler(createFakeConvexClient() as never);
    const cookie = await signupCookie(
      handler,
      "search-reader@example.com",
    );

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
    expect(missingToken!.headers.get("location")).toBe(
      "http://127.0.0.1/sign-in?redirect=%2Fwiki%2Fpublic",
    );
    expect(missingToken!.headers.get("set-cookie")).toBeNull();

    const tokenLogin = await handler(
      request("/api/login?token=diana&redirect=%2Fwiki%2Fpublic"),
    );
    expect(tokenLogin?.status).toBe(302);
    expect(tokenLogin!.headers.get("cache-control")).toBe("private, no-store");
    expect(tokenLogin!.headers.get("set-cookie")).toBeNull();
    expect(tokenLogin!.headers.get("vary")).toContain("Cookie");
    expect(tokenLogin!.headers.get("location")).toBe(
      "http://127.0.0.1/sign-in?redirect=%2Fwiki%2Fpublic",
    );
    expect(tokenLogin!.headers.get("location")).not.toContain("token");

    for (const redirect of ["https://evil.example/phish", "//evil.example/phish"]) {
      const unsafeTokenLogin = await handler(
        request(
          `/api/login?token=diana&redirect=${encodeURIComponent(redirect)}`,
        ),
      );
      expect(unsafeTokenLogin?.status).toBe(302);
      expect(unsafeTokenLogin!.headers.get("location")).toBe(
        "http://127.0.0.1/sign-in?redirect=%2F",
      );
      expect(unsafeTokenLogin!.headers.get("set-cookie")).toBeNull();
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

  test("rejects malformed password-login bodies with 400 instead of failing", async () => {
    const handler = createWikiApiHandler(createFakeConvexClient() as never);
    const login = (body: string) => handler(request("/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
    }));
    for (const body of ["{not json", "", "null", "[]", '"diana"']) {
      const response = await login(body);
      expect(response?.status).toBe(400);
      expect(response!.headers.get("cache-control")).toBe("private, no-store");
      expect(response!.headers.get("set-cookie")).toBeNull();
    }
    const wrongType = await login(JSON.stringify({ password: ["diana"] }));
    expect(wrongType?.status).toBe(401);
    expect(wrongType!.headers.get("set-cookie")).toBeNull();
  });

  test("signs up, reads the session, rejects bad sign-in, and signs out without live Convex writes", async () => {
    const handler = createWikiApiHandler(
      createFakeConvexClient({ passwordGate: true }) as never,
    );
    const email = "reader@example.com";
    const password = "correct horse battery";

    const deniedSignup = await handler(
      request("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name: "Reader", password }),
      }),
    );
    expect(deniedSignup?.status).toBe(403);
    expect(deniedSignup!.headers.get("cache-control")).toBe(
      "private, no-store",
    );
    expect(deniedSignup!.headers.get("vary")).toContain("Cookie");

    const passwordGateCookie = await gateCookie(handler);
    const signup = await handler(
      request("/api/auth/signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: passwordGateCookie,
        },
        body: JSON.stringify({ email, name: "Reader", password }),
      }),
    );
    expect(signup?.status).toBe(200);
    const cookie = `${passwordGateCookie}; ${cookieFrom(signup!)}`;
    expect(await signup!.json()).toEqual({
      ok: true,
      user: { email, name: "Reader" },
    });

    const session = await handler(request("/api/auth/session", { headers: { Cookie: cookie } }));
    expect(session?.status).toBe(200);
    expect(await session!.json()).toEqual({ user: {
      _id: expect.any(String), createdAt: expect.any(Number),
      email, isAdmin: false, name: "Reader",
    } });

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
    const cookie = await signupCookie(
      handler,
      "archive-reader@example.com",
    );

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

  test("download access checks are batched instead of one RPC per page or asset", async () => {
    const fake = createFakeConvexClient({ deniedSlugs: ["private/plan"] });
    const calls: string[] = [];
    const counting = {
      ...fake,
      query: (ref: FunctionReference<"query">, args: Record<string, unknown>) => {
        calls.push(getFunctionName(ref));
        return fake.query(ref, args);
      },
    };
    const handler = createWikiApiHandler(counting as never);
    const cookie = await signupCookie(handler, "batched-archive@example.com");
    calls.length = 0;

    const archive = await handler(request("/api/download?type=full&scope=session", { headers: { Cookie: cookie } }));
    const zip = await JSZip.loadAsync(await archive!.arrayBuffer());
    expect(Object.keys(zip.files)).not.toContain("private/plan.zip");
    expect(Object.keys(zip.files)).not.toContain("private/plan.md");
    expect(Object.keys(zip.files)).toContain("biopsy/raw/dicom.zip");
    expect(calls).not.toContain("documents:getBySlug");
    expect(calls).not.toContain("access:canUserAccessSlug");
    expect(calls.filter(name => name === "documents:getSensitivityBySlugs")).toHaveLength(1);
    // One for the sensitive asset siblings, one for the sensitive markdown page.
    expect(calls.filter(name => name === "access:filterAccessibleSlugs")).toHaveLength(2);
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
      const gateCookieValue = await gateCookie(handler);

      const sensitive = await handler(
        request("/api/file?path=private%2Fimages%2Fscan.png", {
          headers: { Cookie: gateCookieValue },
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
          headers: { Cookie: gateCookieValue },
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

  test("does not fetch an asset with incomplete legacy visibility metadata", async () => {
    const originalFetch = globalThis.fetch;
    const fetchCalls: RequestInfo[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetchCalls.push(input as RequestInfo);
      return new Response("unexpected");
    }) as typeof fetch;

    try {
      const handler = createWikiApiHandler(createFakeConvexClient() as never);
      const cookie = await signupCookie(
        handler,
        "legacy-asset@example.com",
      );
      const response = await handler(
        request("/api/file?path=legacy%2Funversioned.png", {
          headers: { Cookie: cookie },
        }),
      );

      expect(response?.status).toBe(404);
      expect(response!.headers.get("cache-control")).toBe(
        "private, no-store",
      );
      expect(fetchCalls).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
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
        const gateCookieValue = await gateCookie(handler);
        const response = await handler(
          request("/api/file?path=sources/public/source.pdf", {
            headers: {
              Cookie: gateCookieValue,
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

  test("serves selected DICOM images with the shared geometry fields", async () => {
    const handler = createWikiApiHandler(createFakeConvexClient() as never);
    const response = await handler(request("/api/dicom/series?key=1.2.3"));

    expect(response?.status).toBe(200);
    const catalog = (await response!.json()) as { images: Array<Record<string, unknown>> };
    expect(Object.keys(catalog.images[0]!).sort()).toEqual([
      "byteLength",
      "columns",
      "fileName",
      "id",
      "imageId",
      "imagePosition",
      "instanceNumber",
      "modifiedAt",
      "pixelSpacing",
      "relativePath",
      "rows",
      "sortIndex",
    ]);
    expect(catalog.images[0]!.pixelSpacing).toEqual([0.7031, 0.7031]);
  });

  for (const query of ["", "?directory=06-26-breast-mri%2Fdicoms"]) test(`serves DICOM summaries (${query || "unfiltered"}) and lazily loads a selected series`, async () => {
    const handler = createWikiApiHandler(createFakeConvexClient() as never);
    const catalogResponse = await handler(
      request(`/api/dicom/studies${query}`),
    );

    expect(catalogResponse?.status).toBe(200);
    const catalog = (await catalogResponse!.json()) as {
      series: Array<{ images: unknown[]; seriesKey: string }>;
    };
    expect(catalog.series).toHaveLength(1);
    expect(catalog.series[0]).toMatchObject({
      seriesKey: "1.2.3",
      images: [],
    });

    const seriesResponse = await handler(
      request("/api/dicom/series?key=1.2.3"),
    );
    expect(seriesResponse?.status).toBe(200);
    const series = (await seriesResponse!.json()) as {
      images: Array<Record<string, unknown>>;
    };
    expect(series.images).toHaveLength(1);
    expect(series.images[0]).toMatchObject({
      imageId:
        "/api/dicom/file?path=06-26-breast-mri%2Fdicoms%2F06-26-breast-mri-4013-MR.dcm",
      pixelSpacing: [0.7031, 0.7031],
    });
  });
});

test("cold page batches share redaction configuration and keep client caches isolated", async () => {
  async function run() {
    const fake = createFakeConvexClient();
    let siteReads = 0;
    const handler = createWikiApiHandler({
      ...fake,
      async query(ref: FunctionReference<"query">, args: Record<string, unknown>) {
        if (getFunctionName(ref) === "sites:getBySlug") {
          siteReads++;
          await Bun.sleep(5);
        }
        if (getFunctionName(ref) === "documents:getBySlug") {
          return { slug: String(args.slug), title: "Fixture", content: "public body", tags: [] };
        }
        return fake.query(ref, args);
      },
    } as never);
    const response = await handler(request(`/api/wiki/pages?slugs=${Array.from({ length: 25 }, (_, i) => `wiki/public-${i}`).join(",")}`));
    expect(response!.status).toBe(200);
    expect((await response!.json()).pages).toHaveLength(25);
    // One gate lookup and one shared redaction lookup, even on a cold batch.
    expect(siteReads).toBe(2);
  }
  await run();
  await run();
});

test("failed redaction config reads fail closed and are retried", async () => {
  const fake = createFakeConvexClient();
  let siteReads = 0;
  const handler = createWikiApiHandler({
    ...fake,
    async query(ref: FunctionReference<"query">, args: Record<string, unknown>) {
      if (getFunctionName(ref) === "sites:getBySlug" && ++siteReads === 2) throw new Error("config unavailable");
      return fake.query(ref, args);
    },
  } as never);
  await expect(handler(request("/api/wiki/pages?slugs=wiki/public"))).rejects.toThrow("config unavailable");
  const response = await handler(request("/api/wiki/pages?slugs=wiki/public"));
  expect(response!.status).toBe(200);
  expect(siteReads).toBe(4);
});

test("search reads planned corpus ranges concurrently, follows continuations, and retries a failed corpus", async () => {
  const fake = createFakeConvexClient();
  let failRange = true;
  let inFlight = 0;
  let maxInFlight = 0;
  const reads: string[] = [];
  const handler = createWikiApiHandler({
    ...fake,
    async query(ref: FunctionReference<"query">, args: Record<string, unknown>) {
      const name = getFunctionName(ref);
      if (name === "documents:searchCorpusPlan") {
        return { ranges: [{ partition: 0, from: null, to: "b" }, { partition: 0, from: "b", to: "c" }, { partition: 0, from: "c", to: null }], documents: 4, planned: true };
      }
      if (name === "documents:listSearchPages") {
        reads.push(`${args.from}:${args.cursor}`);
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        if (args.from === "b" && failRange) throw new Error("range unavailable");
        const page = (slug: string) => ({ slug, title: slug, content: `fixture ${slug}`, contentHash: slug });
        if (args.from === null) return { page: [page("a")], isDone: true, continueCursor: "" };
        if (args.from === "b") return { page: [page("b")], isDone: true, continueCursor: "" };
        return args.cursor === null
          ? { page: [page("c")], isDone: false, continueCursor: "next" }
          : { page: [page("d")], isDone: true, continueCursor: "" };
      }
      return fake.query(ref, args);
    },
  } as never);
  await expect(handler(request("/api/search?q=fixture"))).rejects.toThrow("range unavailable");
  expect(maxInFlight).toBe(3);
  failRange = false;
  reads.length = 0;
  const response = await handler(request("/api/search?q=fixture"));
  // Plan order is kept for equal-score ties, across ranges and continuations.
  expect((await response!.json()).results.map((result: { slug: string }) => result.slug)).toEqual(["a", "b", "c", "d"]);
  expect(reads.sort()).toEqual(["b:null", "c:next", "c:null", "null:null"]);
});

test("prepared public search data is reused, but redaction changes and corpus expiry rebuild it", async () => {
  const fake = createFakeConvexClient();
  let corpusLoads = 0;
  let rules = ['/ALPHA/gi=>MASKED'];
  let offset = 0;
  const originalNow = Date.now;
  Date.now = () => originalNow() + offset;
  const handler = createWikiApiHandler({
    ...fake,
    async query(ref: FunctionReference<"query">, args: Record<string, unknown>) {
      const name = getFunctionName(ref);
      if (name === "sites:getBySlug") return { slug: args.slug, config: { passwordGate: false, piiPatterns: rules } };
      if (name === "documents:listSearchPages") {
        corpusLoads++;
        return { page: [{ slug: "public", title: "Fixture", content: "ALPHA\nBETA", contentHash: "fixture" }], isDone: true, continueCursor: "" };
      }
      return fake.query(ref, args);
    },
  } as never);
  const search = async (q: string) => {
    const response = await handler(request(`/api/search?q=${q}`));
    expect(response!.status).toBe(200);
    return (await response!.json()).results;
  };
  try {
    expect(await search("ALPHA")).toEqual([]);
    expect((await search("MASKED"))[0].matches).toEqual([{ lineNumber: 1, lineContent: "MASKED", matchStart: 0, matchEnd: 6 }]);
    expect(corpusLoads).toBe(1);
    // Configuration expires independently of the 60-second content cache.
    offset = 15_001;
    rules = ['/BETA/gi=>HIDDEN'];
    expect((await search("ALPHA"))[0].matches[0].lineContent).toBe("ALPHA");
    expect(await search("BETA")).toEqual([]);
    expect(corpusLoads).toBe(2);
    offset += 60_001;
    await search("ALPHA");
    expect(corpusLoads).toBe(3);
  } finally {
    Date.now = originalNow;
  }
});

test("session search reuses the public corpus and reads only authorized sensitive bodies", async () => {
  const fake = createFakeConvexClient({
    deniedSlugs: ["private/plan"],
    extraPages: [{ slug: "private/allowed", title: "Allowed", tags: [], content: "Sensitive allowed note", sensitive: true }],
  });
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    ...fake,
    async query(ref: FunctionReference<"query">, args: Record<string, unknown>) {
      calls.push({ name: getFunctionName(ref), args });
      return fake.query(ref, args);
    },
  };
  const handler = createWikiApiHandler(client as never);
  const cookie = await signupCookie(handler, "overlay-reader@example.com");
  const search = async (path: string, headers: HeadersInit = {}) => {
    const response = await handler(request(path, { headers }));
    expect(response?.status).toBe(200);
    return (await response!.json()).results.map((result: { slug: string }) => result.slug);
  };

  expect(await search("/api/search?q=public")).toEqual(["wiki/public"]);
  calls.length = 0;
  expect(await search("/api/search?q=note&scope=session", { Cookie: cookie })).toEqual(["private/allowed"]);
  expect(await search("/api/search?q=wiki&scope=session", { Cookie: cookie })).toEqual(["wiki/public"]);

  const bodyReads = calls.filter(call => call.name === "documents:listSearchPages" || call.name === "documents:getBySlug");
  // The public corpus came from the instance cache; no combined sensitive
  // corpus read, no body read of the denied page, and each allowed body once.
  expect(bodyReads.map(call => [call.name, call.args.slug ?? null])).toEqual([
    ["documents:getBySlug", "private/allowed"],
    ["documents:getBySlug", "private/shared"],
  ]);
  expect(calls.some(call => call.name === "access:canUserAccessSlug")).toBe(false);
  expect(calls.filter(call => call.name === "access:listAllowedSensitiveManifestPage")).toHaveLength(2);
});

test("session search redacts sensitive pages and never reuses one reader's grants for another", async () => {
  const fake = createFakeConvexClient();
  const denied = new Set<string>();
  const handler = createWikiApiHandler({
    ...fake,
    async query(ref: FunctionReference<"query">, args: Record<string, unknown>) {
      if (getFunctionName(ref) === "access:listAllowedSensitiveManifestPage") {
        const result = await fake.query(ref, args) as { page: Array<{ slug: string }> };
        return { ...result, page: result.page.filter(page => !denied.has(`${String(args.userId)}:${page.slug}`)) };
      }
      return fake.query(ref, args);
    },
  } as never);
  const first = await signupCookie(handler, "grant-one@example.com");
  const second = await signupCookie(handler, "grant-two@example.com");
  denied.add("user_2:private/plan");
  const search = async (cookie: string) => {
    const response = await handler(request("/api/search?q=sensitive%20note&scope=session", { headers: { Cookie: cookie } }));
    return (await response!.json()).results as Array<{ slug: string; matches: Array<{ lineContent: string }> }>;
  };

  const allowed = await search(first);
  expect(allowed.map(result => result.slug)).toEqual(["private/plan"]);
  expect(allowed[0]!.matches[0]!.lineContent).not.toContain("88855655");
  expect(await search(second)).toEqual([]);
});

test("an expired public corpus is served immediately while it reloads", async () => {
  const fake = createFakeConvexClient();
  let corpusLoads = 0;
  let release: (() => void) | undefined;
  let offset = 0;
  const originalNow = Date.now;
  Date.now = () => originalNow() + offset;
  const handler = createWikiApiHandler({
    ...fake,
    async query(ref: FunctionReference<"query">, args: Record<string, unknown>) {
      if (getFunctionName(ref) === "documents:listSearchPages" && ++corpusLoads === 2) {
        await new Promise<void>(resolve => { release = resolve; });
      }
      return fake.query(ref, args);
    },
  } as never);
  try {
    expect((await handler(request("/api/search?q=public")))!.status).toBe(200);
    offset = 61_000;
    const response = await handler(request("/api/search?q=public"));
    expect(response!.headers.get("x-wiki-search-completeness")).toBe("exhaustive");
    expect((await response!.json()).results.map((result: { slug: string }) => result.slug)).toEqual(["wiki/public"]);
    expect(corpusLoads).toBe(2);
    release!();
  } finally {
    Date.now = originalNow;
  }
});

test("a public corpus refresh re-reads only ranges whose fingerprint changed", async () => {
  const fake = createFakeConvexClient();
  let offset = 0;
  const originalNow = Date.now;
  Date.now = () => originalNow() + offset;
  const fingerprints = { a: "fa", b: "fb" };
  const reads: string[] = [];
  const handler = createWikiApiHandler({
    ...fake,
    async query(ref: FunctionReference<"query">, args: Record<string, unknown>) {
      const name = getFunctionName(ref);
      if (name === "documents:searchCorpusPlan") {
        return { ranges: [{ partition: 0, from: null, to: "b", fingerprint: fingerprints.a }, { partition: 0, from: "b", to: null, fingerprint: fingerprints.b }], documents: 2, planned: true };
      }
      if (name === "documents:listSearchPages") {
        const slug = args.from === null ? "a" : "b";
        reads.push(slug);
        return { page: [{ slug, title: slug, content: `needle ${slug} ${fingerprints[slug]}`, contentHash: fingerprints[slug] }], isDone: true, continueCursor: "" };
      }
      return fake.query(ref, args);
    },
  } as never);
  const lines = async () => {
    const response = await handler(request("/api/search?q=needle"));
    return (await response!.json()).results.map((result: { matches: Array<{ lineContent: string }> }) => result.matches[0]!.lineContent);
  };
  try {
    expect(await lines()).toEqual(["needle a fa", "needle b fb"]);
    expect(reads).toEqual(["a", "b"]);
    fingerprints.b = "fb2";
    offset = 61_000;
    await lines(); // stale; starts the background refresh
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(reads).toEqual(["a", "b", "b"]);
    expect(await lines()).toEqual(["needle a fa", "needle b fb2"]);
  } finally {
    Date.now = originalNow;
  }
});

test("manifest validation uses two backend queries and reads no document pages", async () => {
  const saved = process.env.WIKI_PREFETCH_SECRET;
  process.env.WIKI_PREFETCH_SECRET = "synthetic-manifest-http-key-00000000000000";
  const calls: string[] = [];
  const base = createFakeConvexClient();
  try {
    const client = { ...base, query: async (ref: FunctionReference<"query">, args: Record<string, unknown>) => {
      const name = getFunctionName(ref);
      calls.push(name);
      if (name === "manifestCache:current") return { hash: "current-manifest", url: "https://must-not-fetch.invalid/snapshot" };
      return base.query(ref, args);
    } };
    const handler = createWikiApiHandler(client as never);
    const response = await handler(request("/api/wiki/manifest", { headers: { "if-none-match": '\"current-manifest\"' } }));
    expect(response?.status).toBe(304);
    expect(response?.headers.get("x-wiki-manifest-source")).toBe("snapshot");
    expect(calls).toEqual(["sites:getBySlug", "manifestCache:current"]);
  } finally {
    if (saved === undefined) delete process.env.WIKI_PREFETCH_SECRET;
    else process.env.WIKI_PREFETCH_SECRET = saved;
  }
});

test("a snapshot miss serves the live manifest without awaiting the build request", async () => {
  const saved = process.env.WIKI_PREFETCH_SECRET;
  process.env.WIKI_PREFETCH_SECRET = "synthetic-manifest-http-key-00000000000000";
  const base = createFakeConvexClient();
  let buildRequests = 0;
  try {
    const client = { ...base,
      query: async (ref: FunctionReference<"query">, args: Record<string, unknown>) =>
        getFunctionName(ref) === "manifestCache:current" ? null : base.query(ref, args),
      mutation: async (ref: FunctionReference<"mutation">, args: Record<string, unknown>) => {
        if (getFunctionName(ref) !== "manifestCache:requestBuild") return base.mutation(ref, args);
        buildRequests++;
        return new Promise(() => {}); // A build request that never settles.
      } };
    const handler = createWikiApiHandler(client as never);
    for (let i = 0; i < 3; i++) {
      const response = await handler(request("/api/wiki/manifest"));
      expect(response?.status).toBe(200);
      expect(response?.headers.get("x-wiki-manifest-source")).not.toBe("snapshot");
    }
    expect(buildRequests).toBe(1); // Throttled per site and instance.
  } finally {
    if (saved === undefined) delete process.env.WIKI_PREFETCH_SECRET;
    else process.env.WIKI_PREFETCH_SECRET = saved;
  }
});

test("repeat snapshot hits read storage once per hash and representation", async () => {
  const saved = process.env.WIKI_PREFETCH_SECRET;
  const originalFetch = globalThis.fetch;
  process.env.WIKI_PREFETCH_SECRET = "synthetic-manifest-http-key-00000000000000";
  const base = createFakeConvexClient();
  let storageReads = 0;
  try {
    const live = await (await createWikiApiHandler(base as never)(request("/api/wiki/manifest")))!.text();
    const hash = JSON.parse(live).manifestHash as string;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input) !== "https://storage.invalid/snapshot") return originalFetch(input);
      storageReads++;
      return new Response(live);
    }) as typeof fetch;
    const client = { ...base, query: async (ref: FunctionReference<"query">, args: Record<string, unknown>) =>
      getFunctionName(ref) === "manifestCache:current" ? { hash, revision: 0, url: "https://storage.invalid/snapshot" } : base.query(ref, args) };
    const handler = createWikiApiHandler(client as never);
    for (let i = 0; i < 3; i++) {
      const response = await handler(request("/api/wiki/manifest"));
      expect(response?.headers.get("x-wiki-manifest-source")).toBe("snapshot");
      expect(await response!.text()).toBe(live);
    }
    expect(storageReads).toBe(1);
    const compact = await handler(request("/api/wiki/manifest?format=compact-v1"));
    expect((await compact!.json()).wireFormat).toBe("compact-v1");
    expect(storageReads).toBe(2);
    const validated = await handler(request("/api/wiki/manifest?format=compact-v1", { headers: { "if-none-match": `W/"${hash}"` } }));
    expect(validated?.status).toBe(304);
    expect(storageReads).toBe(2);
  } finally {
    globalThis.fetch = originalFetch;
    if (saved === undefined) delete process.env.WIKI_PREFETCH_SECRET;
    else process.env.WIKI_PREFETCH_SECRET = saved;
  }
});
