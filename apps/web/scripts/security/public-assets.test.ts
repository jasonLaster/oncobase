import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPublicAssets } from "./public-assets";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixtureDirectory() {
  const directory = mkdtempSync(path.join(tmpdir(), "legacy-public-assets-"));
  directories.push(directory);
  return directory;
}

test("legacy public assets contain only reviewed application files", () => {
  expect(() => assertPublicAssets(fileURLToPath(new URL("../../public/", import.meta.url)))).not.toThrow();
});

for (const filename of ["report.html", "report.HTML", "report.pdf", "report.json", "report.zip"]) {
  test(`rejects an accidentally restored public report: ${filename}`, () => {
    const directory = fixtureDirectory();
    writeFileSync(path.join(directory, filename), "Synthetic test content");
    expect(() => assertPublicAssets(directory)).toThrow("Unapproved anonymous public assets");
  });
}

test("rejects nested public directories and symlinks to approved filenames", () => {
  const directory = fixtureDirectory();
  mkdirSync(path.join(directory, "reports"));
  expect(() => assertPublicAssets(directory)).toThrow("Unapproved anonymous public assets");
  rmSync(path.join(directory, "reports"), { recursive: true });
  symlinkSync("/nonexistent-test-target", path.join(directory, "favicon.svg"));
  expect(() => assertPublicAssets(directory)).toThrow("Unapproved anonymous public assets");
});
