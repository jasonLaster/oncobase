import { describe, expect, test } from "bun:test";
import { formatFileLabel } from "./file-labels";

describe("formatFileLabel", () => {
  test("removes numeric ordering prefixes from displayed file labels", () => {
    expect(formatFileLabel("1-overview")).toBe("overview");
    expect(formatFileLabel("12-treatment-plan")).toBe("treatment plan");
  });

  test("formats date-prefixed file labels as readable dates", () => {
    expect(formatFileLabel("05-03-vitamin-d-low")).toBe("May 3rd - vitamin d low");
    expect(formatFileLabel("05-12---vahdat-consult-overview")).toBe(
      "May 12th - vahdat consult overview",
    );
    expect(formatFileLabel("05-13-echo-kernis-phm-tissue-sync-overview")).toBe(
      "May 13th - echo kernis phm tissue sync overview",
    );
    expect(formatFileLabel("04-21-phm-kernis-call-overview")).toBe(
      "April 21st - phm kernis call overview",
    );
  });

  test("keeps non-ordering numbers in displayed file labels", () => {
    expect(formatFileLabel("week-6-april-19-to-25")).toBe("week 6 april 19 to 25");
  });
});
