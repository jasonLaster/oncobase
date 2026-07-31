import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";
import { createWikiGateCookieValue } from "./wiki-gate-session";

function request(
  path: string,
  init: ConstructorParameters<typeof NextRequest>[1] = {},
) {
  const headers = new Headers(init.headers);
  headers.set("Host", "localhost");
  return new NextRequest(`http://localhost${path}`, {
    ...init,
    headers,
  });
}

describe("legacy wiki API password gate", () => {
  test.each([
    "/api/wiki/manifest",
    "/api/wiki/pages?slugs=wiki/public",
    "/api/file?path=sources%2Fpublic.pdf",
  ])("rejects anonymous content requests for %s", async (path) => {
    const response = await proxy(request(path));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
    expect(await response.json()).toEqual({
      error: "Password gate authentication required",
    });
  });

  test("keeps the public wiki session bootstrap available", async () => {
    const response = await proxy(request("/api/wiki/session"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  test("lets content API preflights reach their CORS handlers", async () => {
    const response = await proxy(
      request("/api/wiki/manifest", { method: "OPTIONS" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  test("rejects a previously signed content cookie after password rotation", async () => {
    const previousGateSecret = process.env.WIKI_GATE_SESSION_SECRET;
    const previousPasswordHash = process.env.DIANA_WIKI_PASSWORD_HASH;
    try {
      process.env.WIKI_GATE_SESSION_SECRET = "next-proxy-gate-test-secret";
      process.env.DIANA_WIKI_PASSWORD_HASH = "sha256:old-password";
      const cookie = await createWikiGateCookieValue("diana");

      const beforeRotation = await proxy(
        request("/api/wiki/manifest", {
          headers: { Cookie: `authed=${cookie}` },
        }),
      );
      expect(beforeRotation.status).toBe(200);
      expect(beforeRotation.headers.get("x-middleware-next")).toBe("1");

      process.env.DIANA_WIKI_PASSWORD_HASH = "sha256:new-password";
      const afterRotation = await proxy(
        request("/api/wiki/manifest", {
          headers: { Cookie: `authed=${cookie}` },
        }),
      );
      expect(afterRotation.status).toBe(401);
    } finally {
      process.env.WIKI_GATE_SESSION_SECRET = previousGateSecret;
      process.env.DIANA_WIKI_PASSWORD_HASH = previousPasswordHash;
    }
  });
});
