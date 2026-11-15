import { describe, expect, test } from "bun:test";
import {
  announcesManifestCheck,
  MANIFEST_MAX_IDLE_MS,
  nextManifestCheckDelay,
  nextManifestRetryDelay,
  timerMayCheck,
} from "./manifest-poll-policy";

describe("manifest poll policy", () => {
  test("unattended checks start at the freshness window and back off to five minutes", () => {
    expect([0, 1, 2, 3, 4, 5, 50].map(checks => nextManifestCheckDelay("session", checks)))
      .toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000]);
    expect([0, 1, 2, 3, 50].map(checks => nextManifestCheckDelay("public", checks)))
      .toEqual([60_000, 120_000, 240_000, 300_000, 300_000]);
    expect(nextManifestCheckDelay("session", -1)).toBe(30_000);
  });

  test("an idle visible tab makes at most a quarter of the old fixed-interval requests", () => {
    const requestsInAnHour = (scope: "session" | "public") => {
      let elapsed = 0;
      let checks = 0;
      while (elapsed + nextManifestCheckDelay(scope, checks) <= 60 * 60_000) elapsed += nextManifestCheckDelay(scope, checks++);
      return checks;
    };
    expect(requestsInAnHour("session")).toBeLessThanOrEqual(120 / 4);
    expect(requestsInAnHour("public")).toBeLessThanOrEqual(60 / 4);
  });

  test("failed refreshes retry with the same ceiling", () => {
    expect([0, 1, 2, 3, 4, 50].map(nextManifestRetryDelay))
      .toEqual([30_000, 60_000, 120_000, 240_000, MANIFEST_MAX_IDLE_MS, MANIFEST_MAX_IDLE_MS]);
  });

  test("only checks the reader asked for, or needs, change the visible status", () => {
    expect(announcesManifestCheck("timer", true)).toBe(false);
    expect(announcesManifestCheck("attention", true)).toBe(false);
    expect(announcesManifestCheck("load", true)).toBe(true);
    expect(announcesManifestCheck("user", true)).toBe(true);
    // Nothing on screen yet: the reader is waiting on this request.
    expect(announcesManifestCheck("timer", false)).toBe(true);
    expect(announcesManifestCheck("attention", false)).toBe(true);
  });

  test("timers do not check from a hidden tab", () => {
    expect(timerMayCheck("hidden")).toBe(false);
    expect(timerMayCheck("visible")).toBe(true);
  });
});
