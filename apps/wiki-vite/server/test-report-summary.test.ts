import { expect, test } from "bun:test";
import { safeFailureDetails, summarizePlaywright } from "../scripts/summarize-playwright";

test("public test summaries retain outcomes without raw errors, annotations, config or attachments", () => {
  const privateMarker = "PRIVATE_TEST_PAYLOAD";
  const report = {
    config: { token: privateMarker },
    errors: [{ message: privateMarker }],
    stats: { expected: 1, unexpected: 1, flaky: 0, skipped: 1, duration: 123 },
    suites: [{ suites: [{ specs: [{
      title: "reader loads",
      file: "reader.spec.ts",
      tests: [{
        projectName: "webkit",
        status: "unexpected",
        annotations: [{ description: privateMarker }, { type: `qa-health:${privateMarker}` }],
        results: [{ error: privateMarker, stdout: [privateMarker], attachments: [privateMarker] }],
      }],
    }] }] }],
  };
  const summary = summarizePlaywright(report);
  expect(summary).toEqual({
    passed: 1, failed: 1, flaky: 0, skipped: 1, durationMs: 123,
    tests: [{ file: "reader.spec.ts", title: "reader loads", browser: "webkit", status: "unexpected" }],
  });
  expect(JSON.stringify(summary)).not.toContain(privateMarker);
});

test("reader health publishes allowlisted presence flags without annotation descriptions", () => {
  const summary = summarizePlaywright({
    stats: { expected: 0, unexpected: 1, flaky: 0, skipped: 0, duration: 1 },
    suites: [{ specs: [{ title: "reader boots", file: "page-chrome.spec.ts", tests: [{
      status: "unexpected", projectName: "firefox",
      annotations: [{ type: "qa-health:page-loading", description: "PRIVATE_TEST_PAYLOAD" }],
    }] }] }],
  });
  expect(summary.tests[0]?.readerHealth).toEqual(["page-loading"]);
  expect(JSON.stringify(summary)).not.toContain("PRIVATE_TEST_PAYLOAD");
});

test("failure diagnostics expose known locations and timing but no private message or payload", () => {
  const result = safeFailureDetails({
    status: "failed", startTime: "2026-09-05T00:12:00.000Z", duration: 15000,
    errors: [{
      message: "PRIVATE_TEST_PAYLOAD expect.toBeVisible timed out",
      stack: "at /home/runner/app/e2e/page-chrome.spec.ts:185:60\nat /private/secret.ts:8:2\nat /app/e2e/fixtures.ts:624:25",
    }],
  }, "page-chrome.spec.ts");
  expect(result).toEqual({
    status: "failed", startTime: "2026-09-05T00:12:00.000Z", durationMs: 15000,
    locations: ["page-chrome.spec.ts:185", "fixtures.ts:624"], categories: ["toBeVisible"],
  });
  expect(JSON.stringify(result)).not.toContain("PRIVATE_TEST_PAYLOAD");
  expect(JSON.stringify(result)).not.toContain("secret");
  expect(safeFailureDetails({ status: "passed" }, "page-chrome.spec.ts")).toBeUndefined();
});

test("navigation failure categories never include target URLs or cookie payloads", () => {
  const result = safeFailureDetails({ status: "failed", error: {
    message: "page.goto: Navigation to https://private.invalid/PRIVATE_TEST_PAYLOAD is interrupted by another navigation; Cookie: PRIVATE_TEST_PAYLOAD",
  } }, "storage-availability.spec.ts");
  expect(result?.categories).toEqual(["page.goto", "interrupted by another navigation"]);
  expect(JSON.stringify(result)).not.toContain("PRIVATE_TEST_PAYLOAD");
  expect(JSON.stringify(result)).not.toContain("private.invalid");
});
