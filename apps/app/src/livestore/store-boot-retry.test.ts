import { describe, expect, test } from "bun:test";
import {
  STORE_BOOT_MAX_ATTEMPTS,
  shouldRetryStoreBoot,
  toBootError,
} from "./store-boot-retry";

describe("shouldRetryStoreBoot", () => {
  test("retries a transient boot failure exactly once", () => {
    const error = new Error("LiveStore.UnexpectedError: failed to open OPFS store");
    expect(shouldRetryStoreBoot(error, 0)).toBe(true);
    expect(shouldRetryStoreBoot(error, 1)).toBe(false);
    expect(shouldRetryStoreBoot(error, 5)).toBe(false);
  });

  test("keeps the retry budget at a single automatic re-boot", () => {
    expect(STORE_BOOT_MAX_ATTEMPTS).toBe(2);
  });

  test("does not retry chunk/style load failures", () => {
    for (const message of [
      "Failed to fetch dynamically imported module: https://x/assets/LiveStoreRoot-abc.js",
      "Unable to preload CSS for /assets/src-BrbTFx9E.css",
      "Importing a module script failed.",
    ]) {
      expect(shouldRetryStoreBoot(new Error(message), 0)).toBe(false);
    }
  });

  test("retries non-Error boot failures", () => {
    expect(shouldRetryStoreBoot("worker terminated", 0)).toBe(true);
    expect(shouldRetryStoreBoot(undefined, 0)).toBe(true);
  });
});

describe("toBootError", () => {
  test("passes Error instances through", () => {
    const error = new Error("boom");
    expect(toBootError(error)).toBe(error);
  });

  test("wraps non-Error values", () => {
    const wrapped = toBootError("worker terminated");
    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped.message).toBe("worker terminated");
  });
});
