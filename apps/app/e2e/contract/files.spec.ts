import { expect, test } from "@playwright/test";
import { assertPrivate, gatedContext, requireLocalStack, signedInContext } from "./helpers";

// /api/file: input validation, the extension allowlist, traversal, byte ranges
// and per-asset visibility. Replaces the file halves of backend-api and
// sidebar-pdfs.
requireLocalStack();

const PDF = "wiki/logistics/insurance-card.pdf";
const CARE = { email: "care@local.test", password: "local-care-password" };

test("file requests are validated, allowlisted, traversal-proof, range-capable and visibility-checked", async ({ baseURL }) => {
  const reader = await gatedContext(baseURL!);
  const care = await signedInContext(baseURL!, CARE);
  try {
    // Rejected before any storage lookup.
    const rejected: Array<[string, number, RegExp]> = [
      ["/api/file", 400, /Missing path/],
      ["/api/file?path=sources/example.exe", 400, /not supported/],
      ["/api/file?path=wiki/diagnostics/diagnosis.md", 400, /not supported/],
      ["/api/file?path=../../etc/passwd", 400, /not supported/],
      ["/api/file?path=%2Fetc%2Fpasswd", 400, /not supported/],
    ];
    for (const [path, status, message] of rejected) {
      const response = await reader.get(path);
      expect(response.status(), path).toBe(status);
      expect(await response.text(), path).toMatch(message);
    }
    // Traversal dressed up as an allowed type resolves to a path that does not exist.
    for (const path of ["..%2F..%2Fetc%2Fpasswd.pdf", "wiki/%2e%2e/%2e%2e/secret.pdf", "wiki/..\\..\\secret.pdf"]) {
      const response = await reader.get(`/api/file?path=${path}`);
      expect(response.status(), path).toBe(404);
      expect(await response.text(), path).not.toContain("root:");
    }

    // An allowed asset streams with its own type, and ranges are honoured exactly.
    const whole = await reader.get(`/api/file?path=${PDF}`);
    expect(whole.status()).toBe(200);
    expect(whole.headers()["content-type"]).toBe("application/pdf");
    expect(whole.headers()["accept-ranges"]).toBe("bytes");
    assertPrivate(whole, "pdf");
    const bytes = await whole.body();
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");

    const head = await reader.get(`/api/file?path=${PDF}`, { headers: { Range: "bytes=0-4" } });
    expect(head.status()).toBe(206);
    expect(head.headers()["content-range"]).toBe(`bytes 0-4/${bytes.length}`);
    expect((await head.body()).toString()).toBe("%PDF-");
    const tail = await reader.get(`/api/file?path=${PDF}`, { headers: { Range: "bytes=500-999999" } });
    expect(tail.status()).toBe(206);
    expect(tail.headers()["content-range"]).toBe(`bytes 500-${bytes.length - 1}/${bytes.length}`);
    expect(Buffer.compare(await tail.body(), bytes.subarray(500))).toBe(0);
    const beyond = await reader.get(`/api/file?path=${PDF}`, { headers: { Range: "bytes=999999-" } });
    expect(beyond.status()).toBe(416);

    // A sensitive asset is absent for a gate-only reader and present for the care team.
    const sensitive = "/api/file?path=private/lab-report.pdf";
    expect((await reader.get(sensitive)).status()).toBe(404);
    const granted = await care.get(sensitive);
    expect(granted.status()).toBe(200);
    expect(granted.headers()["content-type"]).toBe("application/pdf");
    assertPrivate(granted, "sensitive pdf");
  } finally {
    await Promise.all([reader.dispose(), care.dispose()]);
  }
});
