import { test } from "@playwright/test";

// Production metadata hardening (page-specific title/description, canonical, OG, Twitter,
// robots, public/private cache headers, gate redirects, and bot-vs-browser branches) is
// covered by `bun --cwd apps/wiki-vite verify:standalone`, which runs the standalone Bun
// server and asserts the HTML that the Vite dev server intentionally does not patch.
//
// This dev-server placeholder is intentionally a no-op so the suite still tracks the file
// for parity with the current `apps/web/e2e` layout without misrepresenting where coverage lives.
test("metadata coverage is owned by the standalone server smoke", () => {});
