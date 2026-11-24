import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

/** The reader's SSR renderer (scripts/build-reader-ssr.ts), under the functions output. */
export const READER_SSR_DIR = "reader-ssr";
export const READER_SSR_ENTRY = "server-entry.js";

/** Modules the SSR renderer evaluates when a response first imports it. */
export function readerSsrModules(directory: string) {
  return staticModuleClosure(path.join(directory, READER_SSR_DIR), [READER_SSR_ENTRY]);
}

const KiB = 1024;
// Keep generous space for access/metadata logic, while catching accidental
// eager imports of the multi-megabyte API router and optional features.
export const READER_SERVER_BUDGET_BYTES = 200 * KiB;
// The router, the gate/access helpers and the hot reader routes measured
// 182 KiB once features moved behind the route table (2135 KiB before). An
// eager import of archiver, the AI SDK, Liveblocks or Blob exceeds this.
export const API_SERVER_BUDGET_BYTES = 256 * KiB;
// The SSR renderer (React's server renderer, the reader shell and the markdown
// pipeline, fully bundled) measured 1,021.0 KiB in 31 modules on 2026-11-17.
// It is never a static import of the HTML handler, which keeps its own 200 KiB
// budget; a response loads it lazily, so this is cold-start cost only.
// The UI SDK migration server-renders the shell's Tree, Resizable, Drawer,
// Menu, Dialog and Tooltip parts: 932.1 KiB in 43 modules on main -> 1,277.3
// KiB in 92 modules (UI SDK ships one small module per part). Cold start only.
export const READER_SSR_BUDGET_BYTES = 1_320 * KiB;

export function serverBudgetFailures(directory: string) {
  const reader = readerServerModules(directory);
  const apiModules = apiServerModules(directory);
  console.log(`Reader HTML startup: ${(reader.bytes / KiB).toFixed(1)} KiB in ${reader.files.length} modules`);
  console.log(`API startup: ${(apiModules.bytes / KiB).toFixed(1)} KiB in ${apiModules.files.length} modules`);
  const failures: string[] = [];
  if (existsSync(path.join(directory, READER_SSR_DIR, READER_SSR_ENTRY))) {
    const ssr = readerSsrModules(directory);
    console.log(`Reader SSR renderer: ${(ssr.bytes / KiB).toFixed(1)} KiB in ${ssr.files.length} modules`);
    if (ssr.bytes > READER_SSR_BUDGET_BYTES) failures.push(`Reader SSR renderer modules exceed ${READER_SSR_BUDGET_BYTES / KiB} KiB`);
    const importsRenderer = (source: string) => [...source.matchAll(/(?:\bfrom|\bimport)\s*["']\.\/([^"']+)["']/g)]
      .some(match => match[1]!.startsWith(`${READER_SSR_DIR}/`));
    if (reader.files.some(name => importsRenderer(readFileSync(path.join(directory, name), "utf8")))) {
      failures.push("The HTML handler statically imports the SSR renderer; load it with import()");
    }
  } else {
    failures.push(`Reader SSR renderer not built (${READER_SSR_DIR}/${READER_SSR_ENTRY})`);
  }
  if (reader.bytes > READER_SERVER_BUDGET_BYTES) failures.push(`Reader HTML startup modules exceed ${READER_SERVER_BUDGET_BYTES / KiB} KiB`);
  if (apiModules.bytes > API_SERVER_BUDGET_BYTES) failures.push(`API startup modules exceed ${API_SERVER_BUDGET_BYTES / KiB} KiB`);
  return failures;
}

export function assertReaderServerBudget(directory: string) {
  const failures = serverBudgetFailures(directory);
  if (failures.length) throw new Error(failures.join("; "));
}
