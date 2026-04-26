import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const sourceRoot = new URL("./", import.meta.url).pathname;
const forbidden = [
  /\bDiana\b/i,
  /\bTNBC\b/i,
  /\bObsidian\b/i,
  /search_wiki/,
  /read_page/,
  /convex\/_generated/,
  /@\//,
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return sourceFiles(path);
    if (!/\.(ts|tsx)$/.test(entry)) return [];
    if (/\.test\.(ts|tsx)$/.test(entry)) return [];
    return [path];
  });
}

describe("package boundary", () => {
  test("keeps host-specific knowledge outside the chat package", () => {
    const offenders = sourceFiles(sourceRoot).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return forbidden
        .filter((pattern) => pattern.test(source))
        .map((pattern) => `${path.replace(sourceRoot, "")}: ${pattern}`);
    });

    expect(offenders).toEqual([]);
  });
});
