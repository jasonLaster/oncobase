import { expect, test } from "bun:test";
import { handleClientErrorRequest, type ClientErrorReport } from "./client-errors";

const report = {
  source: "pdf-viewer", stage: "render", path: "sources/a/report.pdf", page: 1,
  error: { name: "TypeError", message: "boom", stack: "at render" },
  context: { devicePixelRatio: 3, canvasWidth: 716, canvasHeight: 926, pdfjs: "6.4.299" },
};

function send(body: unknown, { origin = "https://example.test", method = "POST", testRun = false, raw }: { origin?: string; method?: string; testRun?: boolean; raw?: string } = {}) {
  const logged: ClientErrorReport[] = [];
  const request = new Request("https://example.test/api/client-errors", {
    method,
    headers: { origin, "content-type": "application/json", "user-agent": "iPhone Safari", ...(testRun ? { "x-wiki-test-run": "1" } : {}) },
    ...(method === "POST" ? { body: raw ?? JSON.stringify(body) } : {}),
  });
  return handleClientErrorRequest(request, entry => { logged.push(entry); }).then(response => ({ status: response.status, logged }));
}

test("logs a same-origin PDF viewer failure with the user agent", async () => {
  const { status, logged } = await send(report);
  expect(status).toBe(204);
  expect(logged).toEqual([{ ...report, userAgent: "iPhone Safari" } as ClientErrorReport]);
});

test("cross-site, QA, oversized and malformed reports are not logged", async () => {
  for (const [body, options, expected] of [
    [report, { origin: "https://evil.test" }, 403],
    [report, { testRun: true }, 204],
    [report, { method: "GET" }, 405],
    [null, { raw: "x".repeat(9000) }, 413],
    [null, { raw: "{not json" }, 400],
    [{ ...report, stage: "draw" }, {}, 400],
    [{ ...report, error: { name: "E", message: "m".repeat(1001) } }, {}, 400],
  ] as const) {
    const { status, logged } = await send(body, options);
    expect(status).toBe(expected);
    expect(logged).toEqual([]);
  }
});
