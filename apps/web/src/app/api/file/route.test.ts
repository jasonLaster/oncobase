import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let gateAuthenticated = false;
let sessionUser: { _id: string } | null = null;
let canAccessSensitiveSlug = false;
let sensitiveAssetLookups = 0;
let documentSensitive = true;
let requestedAccessSlugs: string[] = [];
let siblingLookupFails = false;
let assetLookupFails = false;
let rawBlobLookups = 0;
let primaryFetchStatus = 200;
let fallbackFetchStatus = 200;
let diagnosticsRoots: string[] = [];
const originalFetch = globalThis.fetch;
const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
const originalNodeEnv = process.env.NODE_ENV;

const sensitiveDocument = {
  slug: "private/plan",
  get sensitive() {
    return documentSensitive;
  },
};

mock.module("next/server", () => ({
  connection: async () => {},
  NextResponse: class NextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));

mock.module("@/lib/wiki-gate-session", () => ({
  hasValidWikiGateCookie: async () => gateAuthenticated,
  wikiGateCookieName: () => "authed",
}));

mock.module("@/lib/session-user", () => ({
  getSessionUserFromRequest: async () => sessionUser,
}));

mock.module("@/lib/asset-visibility", () => ({
  isStoredAssetSensitive: (
    asset: { sensitive?: boolean } | null,
    siblingDoc: { sensitive?: boolean } | null,
  ) => asset?.sensitive === true || siblingDoc?.sensitive === true,
}));

mock.module("@/lib/local-diagnostics-paths", () => ({
  diagnosticsRootCandidates: () => diagnosticsRoots,
}));

mock.module("@vercel/blob", () => ({
  list: async ({ prefix }: { prefix: string }) => {
    rawBlobLookups += 1;
    return {
      blobs: [{
        pathname: prefix,
        url: "https://assets.example/fallback-file",
      }],
    };
  },
}));

mock.module("@/lib/site-data", () => ({
  siteDataFromRequest: () => ({
    siteSlug: "diana",
    access: {
      canUserAccessSlug: async (
        { slug, userId }: { slug: string; userId: string },
      ) => {
        requestedAccessSlugs.push(slug);
        return (
          userId === "authorized-user" &&
          (slug === sensitiveDocument.slug || slug === "private/owner") &&
          canAccessSensitiveSlug
        );
      },
    },
    documents: {
      getBySlug: async ({ slug }: { slug: string }) => {
        if (siblingLookupFails) throw new Error("sibling metadata unavailable");
        return slug === sensitiveDocument.slug ? sensitiveDocument : null;
      },
      getPdfAssetByPath: async ({
        includeSensitive,
      }: {
        includeSensitive?: boolean;
      }) => {
        if (assetLookupFails) throw new Error("asset metadata unavailable");
        if (includeSensitive) {
          sensitiveAssetLookups += 1;
        } else if (documentSensitive) {
          return null;
        }
        return {
          blobUrl: "https://assets.example/private-plan.pdf",
          sensitive: documentSensitive,
          sizeBytes: 7,
        };
      },
      getFileAssetByPath: async ({
        includeSensitive,
        path,
      }: {
        includeSensitive?: boolean;
        path: string;
      }) => {
        if (assetLookupFails) throw new Error("asset metadata unavailable");
        if (path === "deleted/scan.png") return null;
        if (path === "public/fallback.png") {
          return {
            blobUrl: "https://assets.example/stale-primary-file",
            ownerSlugs: ["public/fallback"],
            sensitive: false,
            sizeBytes: 7,
          };
        }
        if (path !== "private/images/scan.png" || !includeSensitive) {
          return null;
        }
        sensitiveAssetLookups += 1;
        return {
          blobUrl: "https://assets.example/private-scan.png",
          ownerSlugs: ["private/owner"],
          sensitive: true,
          sizeBytes: 7,
        };
      },
    },
  }),
}));

const { GET } = await import("./route");

afterAll(() => {
  globalThis.fetch = originalFetch;
  if (originalBlobToken === undefined) {
    delete process.env.BLOB_READ_WRITE_TOKEN;
  } else {
    process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken;
  }
  if (originalNodeEnv === undefined) {
    Reflect.deleteProperty(process.env, "NODE_ENV");
  } else {
    Reflect.set(process.env, "NODE_ENV", originalNodeEnv);
  }
});

function request(path = "private/plan.pdf", range?: string) {
  return {
    cookies: {
      get: () => gateAuthenticated ? { value: "valid-session" } : undefined,
    },
    headers: new Headers(range ? { Range: range } : undefined),
    nextUrl: new URL(
      `https://wiki.example/api/file?path=${encodeURIComponent(path)}`,
    ),
  } as never;
}

function expectPrivateDenial(response: Response) {
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("Cookie, Host");
}

describe("file route sensitive authorization", () => {
  beforeEach(() => {
    gateAuthenticated = false;
    sessionUser = null;
    canAccessSensitiveSlug = false;
    sensitiveAssetLookups = 0;
    documentSensitive = true;
    requestedAccessSlugs = [];
    siblingLookupFails = false;
    assetLookupFails = false;
    rawBlobLookups = 0;
    primaryFetchStatus = 200;
    fallbackFetchStatus = 200;
    diagnosticsRoots = [];
    process.env.BLOB_READ_WRITE_TOKEN = "file-route-test-token";
    Reflect.set(process.env, "NODE_ENV", originalNodeEnv ?? "test");
    globalThis.fetch = mock(async (input) => {
      const url = typeof input === "string" ? input : input.url;
      const status = url.includes("fallback-file")
        ? fallbackFetchStatus
        : primaryFetchStatus;
      return new Response(status === 416 ? null : "private", {
        status,
        headers: status === 416
          ? { "Content-Range": "bytes */7" }
          : { "Content-Length": "7" },
      });
    }) as unknown as typeof fetch;
  });

  test("rejects a known sensitive asset for a valid password-gate session", async () => {
    gateAuthenticated = true;

    const response = await GET(request());

    expectPrivateDenial(response);
    expect(await response.text()).toBe("File not found");
    expect(sensitiveAssetLookups).toBe(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test("keeps public assets available and private-cached behind the password gate", async () => {
    gateAuthenticated = true;
    documentSensitive = false;

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "private, max-age=60, stale-while-revalidate=3600",
    );
    expect(sensitiveAssetLookups).toBe(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  test("keeps anonymous public assets publicly cached", async () => {
    documentSensitive = false;

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=86400",
    );
    expect(response.headers.get("vary")).toBe("Range");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  test("rejects a signed-in user without access to the sensitive slug", async () => {
    sessionUser = { _id: "unauthorized-user" };

    const response = await GET(request());

    expectPrivateDenial(response);
    expect(sensitiveAssetLookups).toBe(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test("serves a sensitive asset to an authorized signed-in user", async () => {
    gateAuthenticated = true;
    sessionUser = { _id: "authorized-user" };
    canAccessSensitiveSlug = true;

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("private");
    expect(response.headers.get("cache-control")).toBe(
      "private, max-age=60, stale-while-revalidate=3600",
    );
    expect(response.headers.get("vary")).toBe("Cookie, Range");
    expect(sensitiveAssetLookups).toBe(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  test("rejects a nested sensitive asset for anonymous and gate-only requests", async () => {
    documentSensitive = false;

    const anonymous = await GET(request("private/images/scan.png"));
    expectPrivateDenial(anonymous);

    gateAuthenticated = true;
    const gateOnly = await GET(request("private/images/scan.png"));
    expectPrivateDenial(gateOnly);

    expect(sensitiveAssetLookups).toBe(2);
    expect(requestedAccessSlugs).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test("serves a nested sensitive asset when the signed-in user can access every owner", async () => {
    documentSensitive = false;
    sessionUser = { _id: "authorized-user" };
    canAccessSensitiveSlug = true;

    const response = await GET(request("private/images/scan.png"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "private, max-age=60, stale-while-revalidate=3600",
    );
    expect(requestedAccessSlugs).toEqual(["private/owner"]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  test("rejects a nested sensitive asset when the signed-in user lacks owner access", async () => {
    documentSensitive = false;
    sessionUser = { _id: "unauthorized-user" };

    const response = await GET(request("private/images/scan.png"));

    expectPrivateDenial(response);
    expect(requestedAccessSlugs).toEqual(["private/owner"]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test("never resurrects a tombstoned file through raw Blob fallback", async () => {
    documentSensitive = false;

    const anonymous = await GET(request("deleted/scan.png"));
    expectPrivateDenial(anonymous);

    gateAuthenticated = true;
    const gateOnly = await GET(request("deleted/scan.png"));
    expectPrivateDenial(gateOnly);

    gateAuthenticated = false;
    sessionUser = { _id: "authorized-user" };
    canAccessSensitiveSlug = true;
    const signedIn = await GET(request("deleted/scan.png"));
    expectPrivateDenial(signedIn);

    expect(rawBlobLookups).toBe(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test("preserves a direct upstream 416 response and its range metadata", async () => {
    documentSensitive = false;
    primaryFetchStatus = 416;

    const response = await GET(request("private/plan.pdf", "bytes=99-100"));

    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */7");
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=86400",
    );
    expect(rawBlobLookups).toBe(0);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  test("preserves a fallback upstream 416 response and its range metadata", async () => {
    documentSensitive = false;
    primaryFetchStatus = 404;
    fallbackFetchStatus = 416;

    const response = await GET(
      request("public/fallback.png", "bytes=99-100"),
    );

    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */7");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=86400",
    );
    expect(rawBlobLookups).toBe(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  test("keeps signed-in development diagnostics available when sibling metadata fails", async () => {
    const diagnosticsRoot = await mkdtemp(
      join(tmpdir(), "oncobase-file-route-"),
    );
    try {
      const uploadRoot = join(
        diagnosticsRoot,
        "_deidentified-viewer-upload",
      );
      await mkdir(uploadRoot, { recursive: true });
      await writeFile(join(uploadRoot, "scan.dcm"), "private");
      diagnosticsRoots = [diagnosticsRoot];
      siblingLookupFails = true;
      sessionUser = { _id: "authorized-user" };

      const response = await GET(
        request("diagnostics/viewer-upload/scan.dcm"),
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("private");
      expect(response.headers.get("cache-control")).toBe(
        "private, max-age=60, stale-while-revalidate=3600",
      );
      expect(rawBlobLookups).toBe(0);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      await rm(diagnosticsRoot, { recursive: true, force: true });
    }
  });

  test("fails closed in production when sibling metadata is unavailable", async () => {
    siblingLookupFails = true;
    sessionUser = { _id: "authorized-user" };
    Reflect.set(process.env, "NODE_ENV", "production");

    const response = await GET(
      request("diagnostics/viewer-upload/scan.dcm"),
    );

    expectPrivateDenial(response);
    expect(rawBlobLookups).toBe(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
