import { describe, expect, test } from "bun:test";
import { markdownTitleToText } from "./markdown-title";

describe("markdownTitleToText", () => {
  test("uses markdown link labels for plain-text title surfaces", () => {
    expect(markdownTitleToText("[I-SPY2](https://www.ispytrials.org/) Trial")).toBe(
      "I-SPY2 Trial",
    );
  });

  test("uses wikilink aliases and file names", () => {
    expect(markdownTitleToText("[[sources/foo|Foo]] and [[wiki/bar.md]]")).toBe(
      "Foo and bar",
    );
  });
});
