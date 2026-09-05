import { readFileSync, writeFileSync } from "node:fs";

type Result = { status?: string; startTime?: string; duration?: number; error?: unknown; errors?: unknown[] };
export const publicReaderHealthFlags = ["page-loading", "store-boot-retry", "document-article", "search-page", "search-ai-loading", "search-ai-error", "search-ai-empty", "search-ai-summary", "search-text-summary", "mobile-page-header", "session-recovery", "login-route", "empty-root"] as const;

/** Extract only fixed categories, timing, and locations in known test sources. */
export function safeFailureDetails(result: Result, file: string) {
  if (!result.status || !["failed", "timedOut", "interrupted"].includes(result.status)) return undefined;
  const messages = (result.errors ?? [result.error]).flatMap((error) => {
    if (!error || typeof error !== "object") return [];
    const value = error as { message?: unknown; stack?: unknown };
    return [value.message, value.stack].filter((text): text is string => typeof text === "string");
  }).join("\n");
  const locations = new Set<string>();
  for (const source of [file.split("/").at(-1)!, "fixtures.ts"]) {
    const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const match of messages.matchAll(new RegExp(`${escaped}:(\\d+):\\d+`, "g"))) {
      locations.add(`${source}:${Number(match[1])}`);
    }
  }
  return {
    status: result.status,
    durationMs: Number.isFinite(result.duration) ? result.duration : undefined,
    startTime: typeof result.startTime === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(result.startTime) ? result.startTime : undefined,
    locations: [...locations],
    categories: ["NS_BINDING_ABORTED", "ETIMEDOUT", "page.goto", "waitForRequest", "toBeVisible", "toHaveCount", "toHaveURL", "Test timeout", "TimeoutError"].filter((token) => messages.includes(token)),
  };
}

type Suite = {
  suites?: Suite[];
  specs?: Array<{
    title: string;
    file: string;
    tests: Array<{ projectName: string; status: string; results?: Result[]; annotations?: Array<{ type?: string; description?: unknown }> }>;
  }>;
};

type Report = {
  suites: Suite[];
  stats: { expected: number; unexpected: number; flaky: number; skipped: number; duration: number };
};

/** Raw reports may contain protected page text, cookies and API responses.
 * Only publish known test names and outcomes to this public repository. */
export function summarizePlaywright(report: Report) {
  const tests: Array<{ file: string; title: string; browser: string; status: string; failures?: Array<NonNullable<ReturnType<typeof safeFailureDetails>>>; readerHealth?: string[] }> = [];
  function visit(suite: Suite) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        const failures = (test.results ?? []).flatMap((result) => {
          const details = safeFailureDetails(result, spec.file);
          return details ? [details] : [];
        });
        const readerHealth = publicReaderHealthFlags.filter((flag) => test.annotations?.some((annotation) => annotation.type === `qa-health:${flag}`));
        tests.push({ file: spec.file, title: spec.title, browser: test.projectName, status: test.status, ...(failures.length ? { failures } : {}), ...(readerHealth.length ? { readerHealth } : {}) });
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
