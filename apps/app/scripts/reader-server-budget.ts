import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Count the modules initialized for HTML, excluding dynamic API features. */
export function readerServerModules(directory: string) {
  const handler = readdirSync(directory).find(name => name.endsWith(".js") &&
    readFileSync(path.join(directory, name), "utf8").includes("wiki-shell;dur="));
  if (!handler) throw new Error("Built reader HTML handler was not found");
  const files = new Set<string>();
  function visit(name: string) {
    if (files.has(name)) return;
    files.add(name);
    const source = readFileSync(path.join(directory, name), "utf8");
    for (const match of source.matchAll(/(?:\bfrom|\bimport)\s*["']\.\/([^"'/]+\.js)["']/g)) visit(match[1]);
  }
  visit(handler);
  visit("root-app-shell.mjs");
  return { handler, files: [...files], bytes: [...files].reduce((sum, name) => sum + statSync(path.join(directory, name)).size, 0) };
}

export function assertReaderServerBudget(directory: string) {
  const result = readerServerModules(directory);
  // Keep generous space for access/metadata logic, while catching accidental
  // eager imports of the multi-megabyte API router and optional features.
  const budget = 200 * 1024;
  console.log(`Reader HTML startup: ${(result.bytes / 1024).toFixed(1)} KiB in ${result.files.length} modules`);
  if (result.bytes > budget) throw new Error("Reader HTML startup modules exceed 200 KiB");
}
