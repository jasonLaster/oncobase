import { expect, test } from "bun:test";
import { summarizePlaywright } from "../scripts/summarize-playwright";

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
        annotations: [{ description: privateMarker }],
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
