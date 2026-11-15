import { expect, test } from "bun:test";
import { isProbePath, shellOutcome, shellPathClass } from "./shell-telemetry";

test("scanner paths are probes; reader paths never are", () => {
  for (const path of ["/.env", "/.git/config", "/.claude/settings.json", "/.docker/config.json", "/wp-login.php", "/wp-admin/setup-config.php",
    "/wp-content/plugins/x/readme.txt", "/xmlrpc.php", "/index.php", "/backup.sql", "/config.bak", "/api/.env", "/WP-ADMIN", "/cgi-bin/test.cgi", "/wiki/.git/config"]) {
    expect([path, isProbePath(path)]).toEqual([path, true]);
  }
  for (const path of ["/", "/wiki/treatment/plan", "/sources/emails/2026-03/note", "/wiki/logistics/insurance.md", "/.well-known/security.txt",
    "/assets/index-abc123.js", "/favicon.ico", "/sitemap.xml", "/wiki/wp-admin-notes", "/wiki/environment", "/education/cells", "/tags/php",
    "/wiki/logistics/notes.bak", "/sources/exports/dump.sql"]) {
    expect([path, isProbePath(path)]).toEqual([path, false]);
  }
});

test("path classes keep the first segment family and never a slug", () => {
  expect(shellPathClass("/")).toBe("root");
  expect(shellPathClass("/wiki/treatment/PRIVATE")).toBe("wiki");
  expect(shellPathClass("/sources/PRIVATE")).toBe("sources");
  expect(shellPathClass("/assets/missing-chunk.js")).toBe("assets");
  expect(shellPathClass("/apple-touch-icon.png")).toBe("file");
  expect(shellPathClass("/sign-in")).toBe("sign-in");
  expect(shellPathClass("/PRIVATE-legacy-page")).toBe("other");
  expect(shellPathClass("/.env")).toBe("probe");
});

test("outcomes separate documents, redirects, missing assets and probes", () => {
  expect(shellOutcome(200, "wiki", "text/html; charset=utf-8")).toBe("document");
  expect(shellOutcome(302, "wiki", null)).toBe("redirect");
  expect(shellOutcome(404, "assets", "text/plain")).toBe("asset-miss");
  expect(shellOutcome(404, "file", "text/plain")).toBe("asset-miss");
  expect(shellOutcome(404, "other", "text/plain")).toBe("not-found");
  expect(shellOutcome(404, "probe", "text/plain")).toBe("probe");
  expect(shellOutcome(200, "file", "text/markdown")).toBe("asset");
  expect(shellOutcome(503, "wiki", "text/plain")).toBe("error");
});
