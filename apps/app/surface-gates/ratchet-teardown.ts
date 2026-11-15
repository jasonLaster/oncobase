/**
 * Global teardown. In update mode (SURFACES_RATCHET=update) each test wrote its current state
 * as a fragment; fold them into the checked-in ratchet files. Keys that were not run keep their
 * recorded value, so a filtered update (--grep) only rewrites what it ran. A null fragment
 * means "nothing failing" and removes the key.
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FRAGMENTS_DIR, GATES_DIR, UPDATE_RATCHET, readJSON } from "./support";

export const RATCHET_FILES: Record<string, string> = {
  axe: path.join(GATES_DIR, "known-axe-violations.json"),
  keyboard: path.join(GATES_DIR, "known-keyboard-failures.json"),
};

function sortKeys(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]));
}

export default async function teardown() {
  if (!UPDATE_RATCHET || !existsSync(FRAGMENTS_DIR)) return;
  for (const [ratchet, file] of Object.entries(RATCHET_FILES)) {
    const dir = path.join(FRAGMENTS_DIR, ratchet);
    if (!existsSync(dir)) continue;
    const recorded = readJSON<Record<string, unknown>>(file, {});
    let changed = 0;
    for (const name of readdirSync(dir)) {
      const { key, value } = JSON.parse(readFileSync(path.join(dir, name), "utf8")) as { key: string; value: unknown };
      if (value === null) delete recorded[key];
      else recorded[key] = value;
      changed++;
    }
    writeFileSync(file, `${JSON.stringify(sortKeys(recorded), null, 2)}\n`);
    console.log(`[surfaces] ${path.relative(process.cwd(), file)}: merged ${changed} results, ${Object.keys(recorded).length} keys recorded`);
  }
  rmSync(FRAGMENTS_DIR, { recursive: true, force: true });
}
