import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isReaderAppRoute, READER_APP_ROUTES } from "./reader-app-routes";

function routerPaths(file: string) {
  const source = readFileSync(path.join(import.meta.dir, file), "utf8");
  return [...source.matchAll(/<Route\s+path="([^"]+)"/g)].map(match => match[1]!).filter(route => route !== "*");
}

describe("reader app routes", () => {
  test("lists exactly the routers' application paths", () => {
    const routes = [...routerPaths("App.tsx"), ...routerPaths("ImmersiveDicomRoot.tsx")];
    expect(routes.length).toBeGreaterThan(5);
    expect([...READER_APP_ROUTES as readonly string[]].sort()).toEqual([...new Set(routes)].sort());
  });

  test("matches static, parameter and splat routes, ignoring case", () => {
    for (const pathname of ["/chat", "/Chat", "/chat/abc", "/admin", "/admin/pages/x", "/tags/foo", "/diagnostics/imaging", "/pii-view/a/b"]) {
      expect(isReaderAppRoute(pathname)).toBe(true);
    }
  });

  test("leaves published page paths alone", () => {
    for (const pathname of ["/", "/wiki/chat", "/chat/a/b", "/chats", "/tags", "/tools", "/tools/other", "/diagnostics/other", "/about/Index"]) {
      expect(isReaderAppRoute(pathname)).toBe(false);
    }
  });
});
