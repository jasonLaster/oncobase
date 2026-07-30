import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

let gateAuthenticated = false;
let sessionUser: { _id: string } | null = null;
let canAccessSensitiveSlug = false;
let sensitiveAssetLookups = 0;
let documentSensitive = true;
let requestedAccessSlugs: string[] = [];
const originalFetch = globalThis.fetch;

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
    asset: { sensitive?: boolean },
    siblingDoc: { sensitive?: boolean } | null,
  ) => asset.sensitive === true || siblingDoc?.sensitive === true,
}));

mock.module("@/lib/local-diagnostics-paths", () => ({
  diagnosticsRootCandidates: () => [],
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
      getBySlug: async ({ slug }: { slug: string }) =>
        slug === sensitiveDocument.slug ? sensitiveDocument : null,
      getPdfAssetByPath: async ({
        includeSensitive,
      }: {
        includeSensitive?: boolean;
      }) => {
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
});

function request(path = "private/plan.pdf") {
  return {
    cookies: {
      get: () => gateAuthenticated ? { value: "valid-session" } : undefined,
    },
    headers: new Headers(),
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
    globalThis.fetch = mock(async () =>
      new Response("private", {
        headers: { "Content-Length": "7" },
      }),
    ) as unknown as typeof fetch;
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
});
