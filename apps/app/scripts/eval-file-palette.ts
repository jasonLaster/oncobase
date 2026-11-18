/** Measures the synchronous file palette (fuzzy, no network) against a local vault.
 * `bun scripts/eval-file-palette.ts <vault dir> [--verbose]`
 * For each query: the rank of the first acceptable page and the time to rank,
 * plus the worst per-keystroke time while typing it. */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { buildWikiFilePaletteState, type WikiFilePalettePage } from "@oncobase/wiki-shell/file-palette";
import { formatFileLabel } from "@oncobase/wiki-content/file-labels";
import { paletteBoost } from "../src/shell/palette-boost";

export const CASES: Array<{ query: string; expect: RegExp }> = [
  { query: "tissue overview", expect: /^wiki\/(care\/tissue-and-data|omics\/specimen-to-sample-map)$/ },
  { query: "mastectom path report", expect: /^sources\/diagnostics\/11-03-surgical-pathology\/11-03-surgical-pathology$/ },
  { query: "path report", expect: /^sources\/diagnostics\/(11-03|09-24)-surgical-pathology\/\1-surgical-pathology$|kernis-path-report/ },
  { query: "treatment plan", expect: /^wiki\/care\/treatment-plan$/ },
  { query: "ctdna", expect: /^wiki\/(care\/ctdna-monitoring|diagnostics\/ctdna-mrd)$/ },
  { query: "insurance", expect: /^wiki\/logistics\/insurance$/ },
  { query: "meds", expect: /^wiki\/treatment\/medications$/ },
  { query: "clinical trials", expect: /^wiki\/treatment\/clinical-trials$/ },
  { query: "breast mri", expect: /^sources\/diagnostics\/08-24-breast-mri/ },
  { query: "jackson nipple", expect: /11-16---jordan-jackson-mastectomy-pathology-nipple-margin-overview$/ },
  { query: "care team", expect: /^wiki\/people\/medical-team$/ },
  { query: "budget", expect: /^wiki\/logistics\/budget$/ },
  { query: "specimen map", expect: /^wiki\/omics\/specimen-to-sample-map$/ },
  { query: "evee report", expect: /^wiki\/omics\/evee-report-overview$/ },
  { query: "taxes", expect: /^wiki\/logistics\/tax(\/index|\/tax-treatment)?$/ },
  { query: "week 30", expect: /^wiki\/updates\/week-30-/ },
  { query: "chemo day", expect: /^wiki\/treatment\/chemo-day$/ },
  { query: "results", expect: /^wiki\/care\/results$/ },
  { query: "pet ct", expect: /^sources\/diagnostics\/(06-10-cu-grip-petct|03-27-petct)$/ },
  { query: "signatera", expect: /^sources\/diagnostics\/09-21-signatera-ctdna/ },
  { query: "trop2", expect: /^sources\/diagnostics\/11-05-trop2-her3-ihc/ },
  { query: "scalp cooling", expect: /^wiki\/treatment\/scalp-cooling$/ },
  { query: "hrd", expect: /brca-hrd$|hrd-analysis-summary$/ },
  { query: "borowsky residual", expect: /10-05---sandy-borowsky-residual-tissue-assay-planning-overview$/ },
];

async function* markdown(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* markdown(path);
    else if (entry.name.endsWith(".md")) yield path;
  }
}
export async function vaultEntries(vault: string) {
  const field = (front: string, name: string) => front.match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "");
  const entries: WikiFilePalettePage[] = [];
  for await (const path of markdown(vault)) {
    const text = await readFile(path, "utf8");
    const front = text.startsWith("---") ? text.slice(3, text.indexOf("\n---", 3)) : "";
    let slug = relative(vault, path).replace(/\.md$/, "");
    if (slug.endsWith("/index")) slug = slug.slice(0, -"/index".length) || slug;
    const title = field(front, "title") ?? text.match(/^# (.+)$/m)?.[1];
    entries.push({ name: formatFileLabel(slug.split("/").at(-1)!), title, path: slug.split("/").join(" / "), slug, ...(process.argv.includes("--no-boost") ? {} : { boost: paletteBoost(slug) }) });
  }
  return entries;
}

if (import.meta.main) {
  const vault = process.argv[2];
  if (!vault) throw Error("Pass the vault directory");
  const verbose = process.argv.includes("--verbose");
  const entries = await vaultEntries(vault);
  // Warm the prepared index, as the open palette has.
  const t0 = performance.now(); buildWikiFilePaletteState(entries, "x"); const prepareMs = performance.now() - t0;
  console.log(`${entries.length} pages, prepare ${prepareMs.toFixed(0)} ms\n`);
  let top1 = 0, top3 = 0, worstKey = 0, reciprocal = 0;
  for (const { query, expect } of CASES) {
    let keyMax = 0;
    for (let i = 1; i <= query.length; i++) {
      const started = performance.now(); buildWikiFilePaletteState(entries, query.slice(0, i)); keyMax = Math.max(keyMax, performance.now() - started);
    }
    worstKey = Math.max(worstKey, keyMax);
    const results = buildWikiFilePaletteState(entries, query).visibleEntries;
    const rank = results.findIndex(page => expect.test(page.slug)) + 1;
    if (rank === 1) top1++; if (rank && rank <= 3) top3++; if (rank) reciprocal += 1 / rank;
    console.log(`${rank === 1 ? "✓" : rank && rank <= 3 ? "~" : "✗"} ${String(rank || "-").padStart(2)}  ${query.padEnd(24)} worst key ${keyMax.toFixed(1)} ms${verbose || rank !== 1 ? `\n      ${results.slice(0, 3).map(page => page.slug).join("\n      ")}` : ""}`);
  }
  console.log(`\ntop1 ${top1}/${CASES.length}  top3 ${top3}/${CASES.length}  MRR ${(reciprocal / CASES.length).toFixed(2)}  worst keystroke ${worstKey.toFixed(1)} ms`);
}
