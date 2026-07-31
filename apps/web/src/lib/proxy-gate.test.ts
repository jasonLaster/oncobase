import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

function request(path: string, init: RequestInit = {}) {
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
});
