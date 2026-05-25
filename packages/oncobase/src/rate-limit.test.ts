import { describe, expect, test } from "bun:test";
import {
  isRateLimitError,
  parseRetryDelayMs,
  readPositiveIntEnv,
} from "./rate-limit";

describe("publish rate limit helpers", () => {
  test("parses retry delay from OpenAI error messages", () => {
    expect(
      parseRetryDelayMs(
        new Error("429 Rate limit reached. Please try again in 264ms."),
      ),
    ).toBe(264);
    expect(
      parseRetryDelayMs(
        new Error("Rate limit reached. Please try again in 1.5 seconds."),
      ),
    ).toBe(1500);
  });

  test("parses retry delay from headers", () => {
    expect(parseRetryDelayMs({ headers: { "retry-after-ms": "1250" } })).toBe(
      1250,
    );
    expect(parseRetryDelayMs({ headers: { "retry-after": "2" } })).toBe(2000);
  });

  test("detects 429 rate limit errors", () => {
    expect(isRateLimitError({ status: 429 })).toBe(true);
    expect(isRateLimitError(new Error("429 Rate limit reached"))).toBe(true);
    expect(isRateLimitError(new Error("500 Server error"))).toBe(false);
  });

  test("reads positive integer env overrides", () => {
    process.env.TEST_PUBLISH_INT = "7";
    expect(readPositiveIntEnv("TEST_PUBLISH_INT", 3)).toBe(7);

    process.env.TEST_PUBLISH_INT = "0";
    expect(readPositiveIntEnv("TEST_PUBLISH_INT", 3)).toBe(3);
  });
});
