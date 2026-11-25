import { describe, expect, test } from "bun:test";
import {
  applyPiiRedactions,
  findRedactionSpans,
  parseSitePiiPatterns,
  shouldShowPii,
} from "./pii.ts";

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

  test("preserves inline and reference-style link destinations while redacting link text", () => {
    const input = [
      "[Diana Laster](https://example.test/Diana%20Laster)",
      "",
      "[MRN 88855655][patient-record]",
      "",
      "[patient-record]: https://example.test/files/88855655.pdf",
    ].join("\n");

    expect(applyPiiRedactions(input)).toBe(
      [
        "[the patient](https://example.test/Diana%20Laster)",
        "",
        "[MRN [redacted MRN]][patient-record]",
        "",
        "[patient-record]: https://example.test/files/88855655.pdf",
      ].join("\n"),
    );
  });

  test("restores every destination of a link-heavy page exactly once", () => {
    const links = Array.from({ length: 120 }, (_, index) =>
      `[Diana Laster ${index}](sources/88855655-${index}.pdf)`);
    expect(applyPiiRedactions(links.join("\n"))).toBe(
      links.map((_, index) => `[the patient ${index}](sources/88855655-${index}.pdf)`).join("\n"),
    );
  });

  test("parses truthy showPII query values", () => {
    expect(shouldShowPii("true")).toBe(true);
    expect(shouldShowPii(["1"])).toBe(true);
    expect(shouldShowPii("false")).toBe(false);
  });

  test("tracks nesting when :::columns appears inside :::redact without leaking", () => {
    const input = [
      "Public intro",
      "",
      ":::redact[Private comparison]",
      ":::columns",
      "### Left",
      "secret left",
      "### Right",
      "secret right",
      ":::",
      "still secret after columns",
      ":::",
      "",
      "Public outro",
    ].join("\n");

    const redacted = applyPiiRedactions(input, { patterns: [] });
    expect(redacted).toBe("Public intro\n\nPrivate comparison\n\nPublic outro");
    expect(redacted).not.toContain("secret");
    expect(redacted).not.toContain("still secret");

    const revealed = applyPiiRedactions(input, { mode: "revealed", patterns: [] });
    expect(revealed).toContain("secret left");
    expect(revealed).toContain("still secret after columns");
    expect(revealed).toContain(":::columns");

    const spans = findRedactionSpans(input);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.content).toContain("still secret after columns");
  });

  test("handles :::redact nested inside :::columns without consuming the outer closer", () => {
    const input = [
      ":::columns",
      "### Column A",
      ":::redact[Hidden note]",
      "private detail",
      ":::",
      "### Column B",
      "visible detail",
      ":::",
    ].join("\n");

    const redacted = applyPiiRedactions(input, { patterns: [] });
    expect(redacted).toBe([
      ":::columns",
      "### Column A",
      "",
      "Hidden note",
      "",
      "### Column B",
      "visible detail",
      ":::",
    ].join("\n"));
    expect(redacted).not.toContain("private detail");
  });

  test("ignores bare ::: inside fenced code blocks inside :::redact", () => {
    const input = [
      ":::redact[Hidden code]",
      "```md",
      ":::columns",
      "example",
      ":::",
      "```",
      "secret tail",
      ":::",
      "",
      "After",
    ].join("\n");

    const redacted = applyPiiRedactions(input, { patterns: [] });
    expect(redacted).toBe("Hidden code\n\nAfter");
  });
});
