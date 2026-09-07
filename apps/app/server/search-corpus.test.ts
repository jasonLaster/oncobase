import { expect, test } from "bun:test";
import { prepareSearchPage, redactionConfigurationKey } from "./search-corpus";

test("prepared search data contains only redacted lines and metadata", () => {
  const result = prepareSearchPage({ slug: "public", title: "Private name", content: 'before <redact fallback="withheld">private detail</redact> after\nline two' }, [{ pattern: /Private name/g, replacement: "Title" }]);
  expect(result).toEqual({ slug: "public", title: "Title", lines: ["before withheld after", "line two"] });
  expect(result).not.toHaveProperty("content");
  expect(JSON.stringify(result)).not.toContain("private detail");
});

test("redaction cache keys distinguish defaults, empty rules, flags and replacements", () => {
  expect(redactionConfigurationKey(undefined)).not.toBe(redactionConfigurationKey([]));
  const base = [{ pattern: /person/g, replacement: "hidden" }];
  expect(redactionConfigurationKey(base)).toBe(redactionConfigurationKey([{ pattern: new RegExp("person", "g"), replacement: "hidden" }]));
  expect(redactionConfigurationKey(base)).not.toBe(redactionConfigurationKey([{ pattern: /person/gi, replacement: "hidden" }]));
  expect(redactionConfigurationKey(base)).not.toBe(redactionConfigurationKey([{ pattern: /person/g, replacement: "changed" }]));
});
