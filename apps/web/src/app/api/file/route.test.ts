import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

let gateAuthenticated = false;
let sessionUser: { _id: string } | null = null;
let canAccessSensitiveSlug = false;
let sensitiveAssetLookups = 0;
let documentSensitive = true;
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
      canUserAccessSlug: async ({
        slug,
        userId,
      }: {
        slug: string;
        userId: string;
      }) =>
        userId === "authorized-user" &&
        slug === sensitiveDocument.slug &&
        canAccessSensitiveSlug,
    },
    documents: {
      getBySlug: async () => sensitiveDocument,
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
      getFileAssetByPath: async () => null,
    },
  }),
}));

const { GET } = await import("./route");

afterAll(() => {
  globalThis.fetch = originalFetch;
});

function request() {
  return {
    cookies: {
      get: () => gateAuthenticated ? { value: "valid-session" } : undefined,
    },
    headers: new Headers(),
    nextUrl: new URL(
      "https://wiki.example/api/file?path=private%2Fplan.pdf",
    ),
  } as never;
}

describe("file route sensitive authorization", () => {
  beforeEach(() => {
    gateAuthenticated = false;
    sessionUser = null;
    canAccessSensitiveSlug = false;
    sensitiveAssetLookups = 0;
    documentSensitive = true;
    globalThis.fetch = mock(async () =>
      new Response("private", {
        headers: { "Content-Length": "7" },
      }),
    ) as unknown as typeof fetch;
  });

  test("rejects a known sensitive asset for a valid password-gate session", async () => {
    gateAuthenticated = true;

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("File not found");
    expect(sensitiveAssetLookups).toBe(0);
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
    expect(sensitiveAssetLookups).toBe(0);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  test("rejects a signed-in user without access to the sensitive slug", async () => {
    sessionUser = { _id: "unauthorized-user" };

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(sensitiveAssetLookups).toBe(0);
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
});
