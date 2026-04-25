import { describe, expect, test } from "bun:test";
import { searchMarkdown } from "./search";

describe("searchMarkdown PII redaction", () => {
  test("does not return raw patient identifiers as searchable text", async () => {
    for (const query of ["Diana Laster", "88855655"]) {
      const results = await searchMarkdown(query);

      expect(results).toEqual([]);
    }
  });

  test("returns redacted replacement text without hidden source values", async () => {
    const results = await searchMarkdown("Patient identifiers hidden");
    const diagnosis = results.find(
      (result) => result.slug === "wiki/diagnostics/diagnosis"
    );

    expect(diagnosis).toBeTruthy();
    expect(diagnosis?.matches.length).toBeGreaterThan(0);
    for (const match of diagnosis?.matches ?? []) {
      expect(match.lineContent).not.toContain("Diana Laster");
      expect(match.lineContent).not.toContain("88855655");
    }
  });
});
