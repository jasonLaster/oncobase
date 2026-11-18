import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { READER_SSR_BUDGET_BYTES, READER_SSR_DIR, READER_SSR_ENTRY, readerSsrModules, serverBudgetFailures } from "./reader-server-budget";

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A minimal functions output: the HTML handler, the API entry and optionally the SSR renderer. */
function functionsOutput(ssr: { entryBytes: number; chunkBytes?: number } | null) {
  dir = mkdtempSync(path.join(tmpdir(), "reader-server-budget-"));
  writeFileSync(path.join(dir, "handler.js"), 'export const timing = "wiki-shell;dur=";');
  writeFileSync(path.join(dir, "root-app-shell.mjs"), 'import "./handler.js";');
  writeFileSync(path.join(dir, "index.mjs"), "export {};");
  if (ssr) {
    mkdirSync(path.join(dir, READER_SSR_DIR));
    writeFileSync(path.join(dir, READER_SSR_DIR, READER_SSR_ENTRY), `import "./chunk-a.js";${" ".repeat(ssr.entryBytes)}`);
    writeFileSync(path.join(dir, READER_SSR_DIR, "chunk-a.js"), " ".repeat(ssr.chunkBytes ?? 0));
    // A lazy route chunk the renderer never imports statically.
    writeFileSync(path.join(dir, READER_SSR_DIR, "lazy-route.js"), " ".repeat(READER_SSR_BUDGET_BYTES));
  }
  return dir;
}

test("the SSR renderer is measured by its own static closure", () => {
  const out = functionsOutput({ entryBytes: 100, chunkBytes: 200 });
  const ssr = readerSsrModules(out);
  expect(ssr.files.sort()).toEqual(["chunk-a.js", READER_SSR_ENTRY]);
  expect(serverBudgetFailures(out)).toEqual([]);
});

test("an oversized renderer fails its own budget", () => {
  const out = functionsOutput({ entryBytes: 10, chunkBytes: READER_SSR_BUDGET_BYTES });
  expect(serverBudgetFailures(out).join("\n")).toContain("Reader SSR renderer modules exceed");
});

test("the HTML handler may load the renderer lazily, never statically", () => {
  const out = functionsOutput({ entryBytes: 10 });
  writeFileSync(path.join(out, "handler.js"), 'export const timing = "wiki-shell;dur="; export const load = () => import("./reader-ssr/server-entry.js");');
  expect(serverBudgetFailures(out)).toEqual([]);
  writeFileSync(path.join(out, "handler.js"), 'import "./reader-ssr/server-entry.js"; export const timing = "wiki-shell;dur=";');
  expect(serverBudgetFailures(out).join("\n")).toContain("statically imports the SSR renderer");
});

test("a functions build without the renderer fails", () => {
  expect(serverBudgetFailures(functionsOutput(null)).join("\n")).toContain("Reader SSR renderer not built");
});
