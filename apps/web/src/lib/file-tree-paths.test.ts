import { describe, expect, test } from "bun:test";
import { isHiddenFileTreeAssetPath, isHiddenFileTreePath } from "./file-tree-paths";

describe("isHiddenFileTreePath", () => {
  test("hides image directories", () => {
    expect(isHiddenFileTreePath("education/images/foo.png")).toBe(true);
    expect(isHiddenFileTreePath("images/hero-light.png")).toBe(true);
    expect(isHiddenFileTreePath("wiki/education/images")).toBe(true);
  });

  test("hides package and TypeScript config files", () => {
    expect(isHiddenFileTreePath("wiki/config/package.json")).toBe(true);
    expect(isHiddenFileTreePath("wiki/config/tsconfig.json")).toBe(true);
    expect(isHiddenFileTreePath("wiki/config/tsconfig.base.json")).toBe(true);
    expect(isHiddenFileTreePath("wiki/config/tsconfig-notes")).toBe(false);
  });

  test("keeps non-image asset directories visible", () => {
    expect(isHiddenFileTreePath("education/sources/paper.pdf")).toBe(false);
    expect(isHiddenFileTreePath("education/image-analysis/notes.md")).toBe(false);
  });

  test("hides root diagnostics viewer uploads without hiding diagnostics content pages", () => {
    expect(isHiddenFileTreePath("diagnostics/viewer-upload/report.pdf")).toBe(true);
    expect(
      isHiddenFileTreePath(
        "diagnostics/viewer-upload/019f10c4-3a56-7d51-a992-8a05f17c7e22/report.pdf",
      ),
    ).toBe(true);
    expect(isHiddenFileTreePath("wiki/diagnostics/index")).toBe(false);
    expect(isHiddenFileTreePath("sources/diagnostics/report")).toBe(false);
  });

  test("hides image file assets outside literal images directories", () => {
    expect(isHiddenFileTreeAssetPath("sources/paper-images/img-000.jpg")).toBe(true);
    expect(isHiddenFileTreeAssetPath("sources/paper-images/figure.svg")).toBe(true);
    expect(isHiddenFileTreeAssetPath("sources/paper-images/table.csv")).toBe(false);
  });
});
