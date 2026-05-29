import { describe, expect, test } from "bun:test";
import {
  hasSensitiveTag,
  isSensitiveFrontmatter,
  normalizeFrontmatterTags,
} from "./sensitive-pages";

describe("sensitive page metadata", () => {
  test("treats sensitive: true as sensitive", () => {
    expect(isSensitiveFrontmatter({ sensitive: true })).toBe(true);
    expect(isSensitiveFrontmatter({ sensitive: "yes" })).toBe(true);
    expect(isSensitiveFrontmatter({ sensitive: "false" })).toBe(false);
  });

  test("treats an exact sensitive tag as sensitive", () => {
    expect(isSensitiveFrontmatter({ tags: ["PII", "sensitive"] })).toBe(true);
    expect(isSensitiveFrontmatter({ tags: ["sensitivity-analysis"] })).toBe(false);
  });

  test("normalizes frontmatter tags defensively", () => {
    expect(normalizeFrontmatterTags([" sensitive ", 123, "", "wiki"])).toEqual([
      "sensitive",
      "wiki",
    ]);
    expect(normalizeFrontmatterTags("serova, echo")).toEqual(["serova", "echo"]);
    expect(hasSensitiveTag(["Sensitive"])).toBe(true);
  });
});
