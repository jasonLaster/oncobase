import { expect, test } from "bun:test";
import { clientReaderGate } from "./client-reader-gate";
import { READER_CONTEXT_HEADER, READER_VERSION_HEADER } from "./reader-cache-context";

test("client routes preserve the request without entering the retired HTML cache", () => {
  for (const path of ["/", "/wiki/example", "/search", "/chat", "/api/wiki/manifest"]) {
    const response = clientReaderGate(new Request(`https://wiki.example${path}`, { headers: {
      Cookie: "authed=gate-session", [READER_CONTEXT_HEADER]: "forged", [READER_VERSION_HEADER]: "old",
    } }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("x-middleware-request-cookie")).toBe("authed=gate-session");
    expect(response.headers.get(`x-middleware-request-${READER_CONTEXT_HEADER}`)).toBeNull();
    expect(response.headers.get(`x-middleware-request-${READER_VERSION_HEADER}`)).toBeNull();
  }
});

test("the retired internal HTML namespace stays inaccessible", () => {
  for (const path of ["/__reader/html/old", "/%5F%5Freader/html/old"]) {
    expect(clientReaderGate(new Request(`https://wiki.example${path}`)).status).toBe(404);
  }
});
