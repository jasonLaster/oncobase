import { describe, expect, test } from "bun:test";
import { classifyPage } from "../app/(main)/admin/access/access-rule-utils";

describe("classifyPage", () => {
  test("matches canonical rules against legacy sensitive tags", () => {
    expect(
      classifyPage(
        {
          slug: "sources/legacy-serova",
          title: "Legacy Serova",
          tags: ["serova-sensitive"],
        },
        {
          includePathPatterns: [],
          excludePathPatterns: [],
          includeTags: ["serova"],
          excludeTags: [],
          emailPatterns: [],
        },
      ).status,
    ).toBe("included");
  });

  test("matches legacy rules against sensitive include values", () => {
    expect(
      classifyPage(
        {
          slug: "sources/serova",
          title: "Serova",
          tags: [],
          sensitiveInclude: ["serova"],
        },
        {
          includePathPatterns: [],
          excludePathPatterns: [],
          includeTags: ["serova-sensitive"],
          excludeTags: [],
          emailPatterns: [],
        },
      ).status,
    ).toBe("included");
  });
});
