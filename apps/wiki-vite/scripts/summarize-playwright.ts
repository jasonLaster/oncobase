import { readFileSync, writeFileSync } from "node:fs";

type Suite = {
  suites?: Suite[];
  specs?: Array<{
    title: string;
    file: string;
    tests: Array<{ projectName: string; status: string }>;
  }>;
};

type Report = {
  suites: Suite[];
  stats: { expected: number; unexpected: number; flaky: number; skipped: number; duration: number };
};

/** Raw reports may contain protected page text, cookies and API responses.
 * Only publish known test names and outcomes to this public repository. */
export function summarizePlaywright(report: Report) {
  const tests: Array<{ file: string; title: string; browser: string; status: string }> = [];
  function visit(suite: Suite) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        tests.push({ file: spec.file, title: spec.title, browser: test.projectName, status: test.status });
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  for (const suite of report.suites) visit(suite);
  return {
    passed: report.stats.expected,
    failed: report.stats.unexpected,
    flaky: report.stats.flaky,
    skipped: report.stats.skipped,
    durationMs: report.stats.duration,
    tests,
  };
}

if (import.meta.main) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error("Usage: summarize-playwright.ts input.json summary.json");
  const summary = summarizePlaywright(JSON.parse(readFileSync(input, "utf8")) as Report);
  writeFileSync(output, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}
