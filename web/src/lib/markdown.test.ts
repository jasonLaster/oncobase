import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { getCanonicalSlug, getFileTree } from "./markdown";

function createVault(files: Record<string, string | Buffer>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "file-tree-"));

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  return dir;
}

describe("getCanonicalSlug", () => {
  test("returns the on-disk casing for mixed-case wiki routes", () => {
    expect(getCanonicalSlug("ABOUT/jOuRnAl")).toBe("about/Journal");
  });

  test("returns null for missing slugs", () => {
    expect(getCanonicalSlug("about/does-not-exist")).toBeNull();
  });
});

describe("getFileTree", () => {
  test("groups PDF, analysis, and markdown siblings into a badged directory", () => {
    const vault = createVault({
      "papers/sample-paper.md": "# Sample Paper",
      "papers/sample-paper-analysis.md": "# Analysis",
      "papers/sample-paper.pdf": Buffer.alloc(256),
    });

    const tree = getFileTree(vault);
    const papers = tree.find((node) => node.name === "papers");
    const group = papers?.children?.find((node) => node.name === "sample-paper");

    expect(group).toMatchObject({
      name: "sample-paper",
      slug: "papers/sample-paper__paper-set",
      type: "directory",
      badge: "PDF set",
    });
    expect(group?.children?.map((node) => node.name)).toEqual(["PDF", "Analysis", "Markdown"]);
  });

  test("treats overview pages as analysis files for PDF sets", () => {
    const vault = createVault({
      "storm.md": "# Storm",
      "storm-overview.md": "# Overview",
      "storm.pdf": Buffer.alloc(256),
    });

    const tree = getFileTree(vault);
    const group = tree.find((node) => node.name === "storm");

    expect(group?.badge).toBe("PDF set");
    expect(group?.children?.map((node) => node.name)).toEqual(["PDF", "Overview", "Markdown"]);
  });

  test("does not group incomplete paper artifacts", () => {
    const vault = createVault({
      "paper.md": "# Paper",
      "paper-analysis.md": "# Analysis",
    });

    const tree = getFileTree(vault);

    expect(tree.some((node) => node.badge === "PDF set")).toBe(false);
    expect(tree.map((node) => node.name)).toEqual(["paper", "paper-analysis"]);
  });
});
