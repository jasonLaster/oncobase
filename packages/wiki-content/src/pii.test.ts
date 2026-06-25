import { describe, expect, test } from "bun:test";
import { applyPiiRedactions, parseSitePiiPatterns, shouldShowPii } from "./pii";

describe("PII redaction", () => {
  test("redacts fallback Diana identifiers", () => {
    expect(applyPiiRedactions("Diana Laster MRN 88855655")).toBe(
      "the patient MRN [redacted MRN]",
    );
    expect(applyPiiRedactions("Laster, Diana MRN 88855655")).toBe(
      "the patient MRN [redacted MRN]",
    );
  });

  test("preserves Diana-facing labels while redacting full identifiers", () => {
    expect(
      applyPiiRedactions(
        "## Relevance to Diana\n\nDiana's plan mentions Diana Laster.",
      ),
    ).toBe("## Relevance to Diana\n\nDiana's plan mentions the patient.");
  });

  test("honors explicit redaction blocks and reveal mode", () => {
    const input = "Before\n\n:::redact[private]\nsecret\n:::\n\nAfter";
    expect(applyPiiRedactions(input)).toBe("Before\n\nprivate\n\nAfter");
    expect(applyPiiRedactions(input, { mode: "revealed" })).toContain("secret");
  });

  test("reveals inline redactions only for matching sensitive include criteria", () => {
    const input =
      'Public <redact sensitive-include="serova" fallback="">Serova-only note</redact> done.';

    expect(applyPiiRedactions(input)).toBe("Public  done.");
    expect(
      applyPiiRedactions(input, { sensitiveIncludes: ["echo"] }),
    ).toBe("Public  done.");
    expect(
      applyPiiRedactions(input, { sensitiveIncludes: ["serova"] }),
    ).toBe("Public Serova-only note done.");
  });

  test("supports fallback labels and sensitive include criteria on block redactions", () => {
    const input = `Before

:::redact sensitive-include="serova echo" fallback="Vendor detail hidden."
Serova detail for a matching reader.
:::

After`;

    expect(applyPiiRedactions(input)).toBe(
      "Before\n\nVendor detail hidden.\n\nAfter",
    );
    expect(
      applyPiiRedactions(input, { sensitiveIncludes: ["ECHO"] }),
    ).toBe("Before\n\nSerova detail for a matching reader.\n\nAfter");
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
