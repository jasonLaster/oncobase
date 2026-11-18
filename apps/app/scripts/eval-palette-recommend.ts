/** Measures Jev-recommended pages in the file palette against a local vault.
 * `bun --env-file=<.env.local> scripts/eval-palette-recommend.ts <vault dir> [--model=typesafe-ai/jev]`
 * Builds the page index from the vault's markdown (slug, title, tags, description),
 * runs the reader's candidate step and the server's decision step, and prints
 * the fuzzy-only top results beside the recommendations. Semantic candidates
 * are off: they need the deployment's Convex vectors. */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { buildWikiFilePaletteState } from "@oncobase/wiki-shell/file-palette";
import { formatFileLabel } from "@oncobase/wiki-content/file-labels";
import { createPaletteRecommendHandler } from "../server/api/palette-recommend";
import type { ApiRouteRequest } from "../server/api-routes";
import { recommendCandidates } from "../src/shell/palette-recommend";
import type { PageIndexRow } from "../src/types";

const CASES: Array<{ query: string; expect: RegExp }> = [
  { query: "tissue overview", expect: /^wiki\/(care\/tissue-and-data|omics\/specimen-to-sample-map)$/ },
  { query: "mastectom path report", expect: /^sources\/diagnostics\/11-03-surgical-pathology\/11-03-surgical-pathology$/ },
];

const vault = process.argv[2];
if (!vault) throw Error("Pass the vault directory");
const model = process.argv.find(arg => arg.startsWith("--model="))?.slice(8);
if (model) process.env.PALETTE_JEV_MODELS = model;

async function* markdown(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* markdown(path);
    else if (entry.name.endsWith(".md")) yield path;
  }
}
const field = (front: string, name: string) => front.match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "");
const pages: PageIndexRow[] = [];
for await (const path of markdown(vault)) {
  const text = await readFile(path, "utf8");
  const front = text.startsWith("---") ? text.slice(3, text.indexOf("\n---", 3)) : "";
  const slug = relative(vault, path).replace(/\.md$/, "");
  const tags = field(front, "tags")?.replace(/^\[|\]$/g, "").split(",").map(tag => tag.trim()).filter(Boolean) ?? [];
  const title = field(front, "title") ?? text.match(/^# (.+)$/m)?.[1] ?? slug.split("/").at(-1)!;
  pages.push({ slug, title, tagsJson: JSON.stringify(tags), description: field(front, "description") ?? null, contentHash: null, sensitive: false, size: text.length });
}
const entries = pages.map(page => ({ name: formatFileLabel(page.slug.split("/").at(-1)!), title: page.title, path: page.slug.split("/").join(" / "), slug: page.slug }));
console.log(`${pages.length} pages from ${vault}\n`);

const verbose = process.argv.includes("--verbose");
const handler = createPaletteRecommendHandler({ semantic: async () => [], ...(verbose ? { recommendAt: 0, withinBest: 3, maxRecommended: 12 } : {}) });
let passed = 0;
for (const { query, expect } of CASES) {
  const fuzzy = buildWikiFilePaletteState(entries, query).searchResults ?? [];
  const candidates = recommendCandidates(pages, query, fuzzy.map(page => page.slug));
  const started = performance.now();
  const response = await handler({ request: new Request("http://local/api/wiki/palette-recommend?scope=session", { method: "POST", body: JSON.stringify({ query, candidates }) }) } as ApiRouteRequest);
  const body = await response.json() as { model?: string; results?: Array<{ slug: string; score: number }>; error?: string };
  const ms = Math.round(performance.now() - started);
  const ok = Boolean(body.results?.[0] && expect.test(body.results[0].slug));
  if (ok) passed++;
  console.log(`${ok ? "PASS" : "FAIL"} "${query}" — ${body.model ?? body.error} in ${ms} ms, ${candidates.length} candidates (expected page ${candidates.some(c => expect.test(c.slug)) ? "among them" : "MISSING"})`);
  console.log(`  fuzzy:       ${fuzzy.slice(0, 3).map(page => page.slug).join("\n               ") || "(none)"}`);
  console.log(`  recommended: ${body.results?.map(row => `${row.slug} (${row.score.toFixed(2)})`).join("\n               ") || "(none)"}\n`);
}
console.log(`${passed}/${CASES.length} passed`);
process.exit(passed === CASES.length ? 0 : 1);
