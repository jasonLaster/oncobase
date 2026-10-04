import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Built modules a root evaluates before running: its transitive static imports. */
export function staticModuleClosure(directory: string, roots: string[]) {
  const files = new Set<string>();
  function visit(name: string) {
    if (files.has(name)) return;
    files.add(name);
    const source = readFileSync(path.join(directory, name), "utf8");
    // Static `import ... from "./x.js"` and `import "./x.js"`; `import("./x.js")` stays lazy.
    for (const match of source.matchAll(/(?:\bfrom|\bimport)\s*["']\.\/([^"'/]+\.js)["']/g)) visit(match[1]);
  }
  for (const root of roots) visit(root);
  return { files: [...files], bytes: [...files].reduce((sum, name) => sum + statSync(path.join(directory, name)).size, 0) };
}

/** Count the modules initialized for HTML, excluding dynamic API features. */
export function readerServerModules(directory: string) {
  const handler = readdirSync(directory).find(name => name.endsWith(".js") &&
    readFileSync(path.join(directory, name), "utf8").includes("wiki-shell;dur="));
  if (!handler) throw new Error("Built reader HTML handler was not found");
  return { handler, ...staticModuleClosure(directory, [handler, "root-app-shell.mjs"]) };
}

/** Count the modules initialized by the API function, excluding lazily loaded route features. */
export function apiServerModules(directory: string) {
  return staticModuleClosure(directory, ["index.mjs"]);
}

const KiB = 1024;
// Keep generous space for access/metadata logic, while catching accidental
// eager imports of the multi-megabyte API router and optional features.
export const READER_SERVER_BUDGET_BYTES = 200 * KiB;
// The router, the gate/access helpers and the hot reader routes measured
// 182 KiB once features moved behind the route table (2135 KiB before). An
// eager import of archiver, the AI SDK, Liveblocks or Blob exceeds this.
export const API_SERVER_BUDGET_BYTES = 256 * KiB;

export function serverBudgetFailures(directory: string) {
  const reader = readerServerModules(directory);
  const apiModules = apiServerModules(directory);
  console.log(`Reader HTML startup: ${(reader.bytes / KiB).toFixed(1)} KiB in ${reader.files.length} modules`);
  console.log(`API startup: ${(apiModules.bytes / KiB).toFixed(1)} KiB in ${apiModules.files.length} modules`);
  const failures: string[] = [];
  if (reader.bytes > READER_SERVER_BUDGET_BYTES) failures.push(`Reader HTML startup modules exceed ${READER_SERVER_BUDGET_BYTES / KiB} KiB`);
  if (apiModules.bytes > API_SERVER_BUDGET_BYTES) failures.push(`API startup modules exceed ${API_SERVER_BUDGET_BYTES / KiB} KiB`);
  return failures;
}

export function assertReaderServerBudget(directory: string) {
  const failures = serverBudgetFailures(directory);
  if (failures.length) throw new Error(failures.join("; "));
}
