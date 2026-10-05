import { expect, test } from "@playwright/test";
import { passwordGateCookie } from "./gate-auth";

test.describe("Sidebar source files", () => {
  test("/api/wiki/manifest returns the full tree shape while the route shell stays lean", async ({
    request,
  }) => {
    const cookie = await passwordGateCookie(request);
    const manifestResponse = await request.get("/api/wiki/manifest?scope=public", {
      headers: { Cookie: cookie },
      timeout: 45_000,
    });
    expect(manifestResponse.ok()).toBeTruthy();
    const isPartialManifest =
      manifestResponse.headers()["x-wiki-manifest-partial"] === "true";
    if (process.env.PLAYWRIGHT_BASE_URL) {
      expect(isPartialManifest).toBe(false);
    } else if (isPartialManifest) {
      expect(manifestResponse.headers()["x-wiki-manifest-source"]).toBe(
        "bounded-content-fallback",
      );
    }

    const manifest = await manifestResponse.json();
    const slugs = (manifest.pages as Array<{ slug: string }>).map((entry) => entry.slug);
    expect(slugs.length).toBeGreaterThan(0);
    expect(slugs.some((slug) => slug.startsWith("wiki/"))).toBe(true);
    if (!isPartialManifest) {
      expect(slugs.some((slug) => slug.startsWith("sources/"))).toBe(true);
      expect(slugs).toContain("wiki/updates/week-8-may-3-to-9");
      expect(slugs).toContain("about/overview/key-context");
    }

    expect(Array.isArray(manifest.assets)).toBe(true);
    const assets = manifest.assets as Array<{ kind: string; path: string }>;
    expect(assets.some((asset) => asset.kind === "pdf" && asset.path.endsWith(".pdf"))).toBe(true);
  });
});

test.describe("PDF serving via /api/file", () => {
  // /api/file sits behind the site password gate, so these validation checks
  // need a signed gate session or they only ever observe the 401.
  test("returns 400 when path param is missing", async ({ request }) => {
    const response = await request.get("/api/file", {
      headers: { Cookie: await passwordGateCookie(request) },
    });
    expect(response.status()).toBe(400);
  });

  test("returns 400 for non-PDF / non-asset paths", async ({ request }) => {
    const response = await request.get("/api/file?path=wiki/diagnostics/diagnosis.md", {
      headers: { Cookie: await passwordGateCookie(request) },
    });
    expect(response.status()).toBe(400);
  });

  test("returns 400 for unsupported file extensions", async ({ request }) => {
    const response = await request.get("/api/file?path=sources/example.exe", {
      headers: { Cookie: await passwordGateCookie(request) },
    });
    expect(response.status()).toBe(400);
  });

  test("prevents path traversal", async ({ request }) => {
    const response = await request.get("/api/file?path=../../etc/passwd", {
      headers: { Cookie: await passwordGateCookie(request) },
    });
    expect([400, 404]).toContain(response.status());
  });

  test("requires a password gate session before validating input", async ({ request }) => {
    // Deployed suites start with a gate cookie; this assertion must explicitly
    // remove it rather than accidentally validating authenticated input.
    const response = await request.get("/api/file?path=../../etc/passwd", {
      headers: { Cookie: "" },
    });
    expect(response.status()).toBe(401);
  });
});
