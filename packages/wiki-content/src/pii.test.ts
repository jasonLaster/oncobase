import { describe, expect, test } from "bun:test";
import { applyPiiRedactions, parseSitePiiPatterns, shouldShowPii } from "./pii";

describe("PII redaction", () => {
  test("redacts fallback Diana identifiers", () => {
    expect(applyPiiRedactions("Diana Laster MRN 88855655")).toBe(
      "the patient MRN [redacted MRN]",
    );
    expect(applyPiiRedactions("Diana's treatment plan")).toBe(
      "the patient's treatment plan",
    );
  });

  test("honors explicit redaction blocks and reveal mode", () => {
    const input = "Before\n\n:::redact[private]\nsecret\n:::\n\nAfter";
    expect(applyPiiRedactions(input)).toBe("Before\n\nprivate\n\nAfter");
    expect(applyPiiRedactions(input, { mode: "revealed" })).toContain("secret");
  });

  test("uses site-specific patterns without Diana fallback leakage", () => {
    const patterns = parseSitePiiPatterns(["/Friend Name/g=>the friend"]);
    expect(applyPiiRedactions("Friend Name met Diana", { patterns })).toBe(
      "the friend met Diana",
    );
  });

  test("parses truthy showPII query values", () => {
    expect(shouldShowPii("true")).toBe(true);
    expect(shouldShowPii(["1"])).toBe(true);
    expect(shouldShowPii("false")).toBe(false);
  });
});
