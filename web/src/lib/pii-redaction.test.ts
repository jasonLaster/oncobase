import { describe, expect, test } from "bun:test";
import {
  applyPiiRedactions,
  shouldShowPii,
} from "./pii-redaction";

describe("applyPiiRedactions", () => {
  test("hides inline redactions and preserves labels by default", () => {
    const input =
      'Patient: <redact label="the patient">Diana Laster</redact>\nMRN: <redact>88855655</redact>';

    expect(applyPiiRedactions(input)).toBe("Patient: the patient\nMRN:");
  });

  test("reveals inline and block redactions when requested", () => {
    const input = `:::redact[hidden]
**Patient:** Diana Laster
**MRN:** 88855655
:::

<redact label="the patient">Diana</redact> is responding well.`;

    expect(applyPiiRedactions(input, { mode: "revealed" })).toContain(
      "**Patient:** Diana Laster"
    );
    expect(applyPiiRedactions(input, { mode: "revealed" })).toContain(
      "Diana is responding well."
    );
    expect(applyPiiRedactions(input, { mode: "revealed" })).not.toContain(
      "hidden"
    );
  });

  test("removes block redactions from default output", () => {
    const input = `Before

:::redact
**Patient:** Diana Laster
**MRN:** 88855655
:::

After`;

    expect(applyPiiRedactions(input)).toBe("Before\n\nAfter");
  });

  test("trims block labels and hides multiline inline spans", () => {
    const input = `Before

:::redact[  Patient summary hidden.  ]
Diana Laster
88855655
:::

Call <redact label='the clinic'>Jason
at jason.laster.11@gmail.com</redact> today.`;

    expect(applyPiiRedactions(input)).toBe(
      "Before\n\nPatient summary hidden.\n\nCall the clinic today."
    );
  });

  test("applies fallback replacements for known identifiers", () => {
    const input =
      "DIANA LASTER's MRN is 88855655 and the report says Laster, Diana with DOB 12/11/1989. Contact diana.pechter@gmail.com.";

    expect(applyPiiRedactions(input)).toBe(
      "the patient's MRN is [redacted MRN] and the report says the patient with DOB [redacted DOB]. Contact [redacted email]."
    );
  });

  test("does not apply fallback replacements in revealed mode", () => {
    const input =
      "Diana Laster has MRN 88855655 and DOB 11-Dec-1989.";

    expect(applyPiiRedactions(input, { mode: "revealed" })).toBe(input);
  });

  test("preserves explicit non-patient Diana references in fallback mode", () => {
    expect(applyPiiRedactions("Reviewed by Diana Pechter and Diana L.")).toBe(
      "Reviewed by Diana Pechter and Diana L."
    );
    expect(applyPiiRedactions("Reviewed by DIANA PECHTER and DIANA L.")).toBe(
      "Reviewed by DIANA PECHTER and DIANA L."
    );
    expect(applyPiiRedactions("DIANA called the clinic.")).toBe(
      "the patient called the clinic."
    );
  });

  test("preserves markdown link destinations while redacting visible labels", () => {
    const input = [
      "[Diana page](/sources/research/diana-schedule)",
      "",
      "[prad-asco]: /sources/research/papers/asco-2026-diana-schedule-and-people#p-rad",
    ].join("\n");

    expect(applyPiiRedactions(input)).toBe(
      [
        "[the patient page](/sources/research/diana-schedule)",
        "",
        "[prad-asco]: /sources/research/papers/asco-2026-diana-schedule-and-people#p-rad",
      ].join("\n"),
    );
  });
});

describe("shouldShowPii", () => {
  test("accepts common truthy values", () => {
    expect(shouldShowPii("1")).toBe(true);
    expect(shouldShowPii("TRUE")).toBe(true);
    expect(shouldShowPii(["yes"])).toBe(true);
    expect(shouldShowPii("on")).toBe(true);
  });

  test("rejects falsey and missing values", () => {
    expect(shouldShowPii("0")).toBe(false);
    expect(shouldShowPii("false")).toBe(false);
    expect(shouldShowPii("off")).toBe(false);
    expect(shouldShowPii("")).toBe(false);
    expect(shouldShowPii(undefined)).toBe(false);
  });
});
