import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

export default class FailOnSkipReporter implements Reporter {
  private failedAttempts = new Set<string>();
  private skipped: string[] = [];

  onTestEnd(test: TestCase, result: TestResult) {
    const title = test.titlePath().join(" > ");
    if (result.status === "skipped") {
      this.skipped.push(title);
    } else if (result.status !== "passed") {
      this.failedAttempts.add(title);
    }
  }

  async onEnd(result: FullResult) {
    if (this.skipped.length === 0 && this.failedAttempts.size === 0) return;

    if (this.skipped.length > 0) {
      console.error(
        `Production smoke must not skip tests. Skipped:\n${this.skipped
          .map((title) => `- ${title}`)
          .join("\n")}`,
      );
    }
    if (this.failedAttempts.size > 0 && result.status === "passed") {
      console.error(
        `Production smoke must not pass through retries. Flaky:\n${[
          ...this.failedAttempts,
        ]
          .map((title) => `- ${title}`)
          .join("\n")}`,
      );
    }
    return { status: "failed" as const };
  }
}
