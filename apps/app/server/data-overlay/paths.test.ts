import { expect, test } from "bun:test";
import { dataOverlayHosts, isDataOverlayHost, rawRequestPath } from "./host";
import { assertKeyUnderPrefix, parseDataPath, safeDataNext, urlPathForKey } from "./paths";

const keyOf = (path: string) => {
  const route = parseDataPath(path);
  return route.kind === "object" ? `${route.visibility}:${route.key}` : route.kind;
};

test("public paths map under public/, /private/ paths under private/", () => {
  expect(keyOf("/")).toBe("index");
  expect(keyOf("/index.json")).toBe("index-json");
  expect(keyOf("/rna/kh022.h5ad")).toBe("public:public/rna/kh022.h5ad");
  expect(keyOf("/private/curefirst/a.pdf")).toBe("private:private/curefirst/a.pdf");
  expect(keyOf("/private")).toBe("private-root");
  expect(keyOf("/my%20file.csv")).toBe("public:public/my file.csv");
  // Prefix boundary: only the exact first segment "private" is private.
  expect(keyOf("/privatex/a")).toBe("public:public/privatex/a");
  expect(keyOf("/Private/a")).toBe("public:public/Private/a");
  expect(keyOf("/public/a")).toBe("public:public/public/a");
  expect(keyOf("/_auth/callback")).toBe("auth");
  expect(keyOf("/_auth/other")).toBe("invalid");
});

test("traversal, encoded traversal and separator tricks are rejected", () => {
  for (const path of [
    "/public/../private/x", "/../private/x", "/a/../../private/x", "/a/./b", "/.", "/..",
    "/%2e%2e/private/x", "/%2E%2E/private/x", "/a/%2e%2e/private/x", "/.%2e/private/x", "/%2e/x",
    "/a%2fb", "/a%2F..%2Fprivate", "/a%5cb", "/a%5C..%5Cprivate", "/a\\..\\private", "/a\\b",
    "/%252e%252e/private/x", "/a%252fb", "/%25", "/a%00b", "/a\u0000b", "/a%0ab", "/a\nb", "/a%7fb",
    "//private/x", "///x", "/a//b", "/a/", "/private/", "/private//curefirst/x", "/private/curefirst/",
    "", "private/x", "x", "/%", "/%zz", "/%c0%ae%c0%ae/private",
  ]) {
    expect({ path, kind: parseDataPath(path).kind }).toEqual({ path, kind: "invalid" });
  }
  expect(parseDataPath(null).kind).toBe("invalid");
  expect(parseDataPath(`/${"a".repeat(1100)}`).kind).toBe("invalid");
});

test("a key is asserted to sit strictly under its prefix", () => {
  expect(assertKeyUnderPrefix("public/a/b", "public/")).toBe("public/a/b");
  for (const [key, prefix] of [
    ["public/", "public/"], ["public/../private/x", "public/"], ["publicx/a", "public/"],
    ["private/x", "public/"], ["public//a", "public/"], ["public/a", "public"],
  ]) {
    expect(() => assertKeyUnderPrefix(key!, prefix!)).toThrow();
  }
});

test("keys round-trip through their URL, and shadowed public keys have none", () => {
  for (const key of ["public/a/b c.csv", "private/curefirst/x (1).pdf", "public/privatex/a"]) {
    const path = urlPathForKey(key)!;
    const route = parseDataPath(path);
    expect(route.kind === "object" && route.key).toBe(key);
  }
  for (const key of ["public/private/x", "public/_auth/x", "public/index.json", "staging/x", "public/a%b", "public/a\\b", "public/"]) {
    expect(urlPathForKey(key)).toBeNull();
  }
});

test("sign-in destinations stay on the data host", () => {
  expect(safeDataNext("/private/curefirst/a.pdf")).toBe("/private/curefirst/a.pdf");
  for (const next of ["//evil.example/x", "https://evil.example", "/\\evil.example", "/_auth/callback", "/../x", null, ""]) {
    expect(safeDataNext(next)).toBe("/");
  }
});

test("the raw path is read from the rewrite without URL normalization", () => {
  expect(rawRequestPath("/api/app-shell?__path=private/curefirst/a.pdf&token=x")).toBe("/private/curefirst/a.pdf");
  expect(rawRequestPath("/api/app-shell?__path=public/../private/x")).toBe("/public/../private/x");
  expect(rawRequestPath("/api/app-shell?__path=%2e%2e/private/x")).toBe("/../private/x");
  expect(rawRequestPath("/api/app-shell?__path=")).toBe("/");
  expect(rawRequestPath("/api/app-shell?__path=a&__path=private/x")).toBeNull();
  expect(rawRequestPath("/api/app-shell?__path=%zz")).toBeNull();
  expect(rawRequestPath("http://data.localhost:62003/a/%2e%2e/private/x?y=1#z")).toBe("/a/%2e%2e/private/x");
  // Whatever arrives, normalization never turns it into a valid private key.
  for (const url of ["/api/app-shell?__path=public/../private/x", "/api/app-shell?__path=a%2f..%2fprivate%2fx", "/x/%2e%2e/private/y"]) {
    expect(parseDataPath(rawRequestPath(url)).kind).toBe("invalid");
  }
});

test("only the data hosts are dispatched to the overlay", () => {
  const production = { NODE_ENV: "production" };
  expect(isDataOverlayHost("data.diana-tnbc.com", production)).toBe(true);
  expect(isDataOverlayHost("DATA.diana-tnbc.com:443", production)).toBe(true);
  for (const host of ["diana-tnbc.com", "data.diana-tnbc.com.evil.example", "xdata.diana-tnbc.com", "data.localhost", null]) {
    expect(isDataOverlayHost(host, production)).toBe(false);
  }
  expect(isDataOverlayHost("data.localhost:62003", { NODE_ENV: "development" })).toBe(true);
  expect(dataOverlayHosts({ NODE_ENV: "production", DATA_OVERLAY_HOSTS: "a.example, B.example:8080" })).toEqual(["a.example", "b.example"]);
});
