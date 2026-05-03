import { describe, expect, test } from "bun:test";
import { isHiddenFileTreePath } from "./markdown";

describe("isHiddenFileTreePath", () => {
  test("hides assets inside images directories", () => {
    expect(isHiddenFileTreePath("education/images/foo.png")).toBe(true);
    expect(isHiddenFileTreePath("images/hero-light.png")).toBe(true);
  });

  test("keeps non-image asset directories visible", () => {
    expect(isHiddenFileTreePath("education/sources/paper.pdf")).toBe(false);
    expect(isHiddenFileTreePath("education/image-analysis/notes.md")).toBe(false);
  });
});
