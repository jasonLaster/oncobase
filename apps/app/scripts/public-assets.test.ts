import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertBuildAssets, assertPublicAssets } from "./public-assets";

const temporaryDirectories: string[] = [];
function fixtureDirectory() {
  const directory = mkdtempSync(path.join(tmpdir(), "wiki-public-assets-"));
  temporaryDirectories.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test("reader HTML cannot bypass the gate through Vite public assets", () => {
  const publicDirectory = fileURLToPath(new URL("../public/", import.meta.url));
  expect(() => assertPublicAssets(publicDirectory)).not.toThrow();
});

for (const filename of ["document.html", "document.HTML", "document.htm", "document.xhtml", "document.md", "document.json", "document.pdf", ".hidden", "nested/document.html"]) {
  test(`rejects unreviewed public file ${filename}`, () => {
    const directory = fixtureDirectory();
    mkdirSync(path.dirname(path.join(directory, filename)), { recursive: true });
    writeFileSync(path.join(directory, filename), "Synthetic test content");
    expect(() => assertPublicAssets(directory)).toThrow("Unapproved anonymous public assets");
  });
}

test("rejects public symlinks even with an approved filename", () => {
  const directory = fixtureDirectory();
  symlinkSync("/nonexistent-test-target", path.join(directory, "favicon.svg"));
  expect(() => assertPublicAssets(directory)).toThrow("symbolic links");
});

test("permits only the SPA entry, reviewed root assets, and non-HTML generated assets", () => {
  const directory = fixtureDirectory();
  mkdirSync(path.join(directory, "assets"));
  for (const filename of ["index.html", "favicon.svg", "assets/app-hash.js", "assets/worker-hash.wasm", "assets/style-hash.css"]) {
    writeFileSync(path.join(directory, filename), "Synthetic test content");
  }
  expect(() => assertBuildAssets(directory)).not.toThrow();
  writeFileSync(path.join(directory, "assets", "document.HTML"), "Synthetic test content");
  expect(() => assertBuildAssets(directory)).toThrow("Unapproved static build output");
});

test("rejects root HTML produced outside public assets", () => {
  const directory = fixtureDirectory();
  writeFileSync(path.join(directory, "document.html"), "Synthetic test content");
  expect(() => assertBuildAssets(directory)).toThrow("Unapproved static build output");
});
