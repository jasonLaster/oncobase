/** Judges the file palette with Jev instead of hand-labelled answers.
 *
 *   bun --env-file=<.env.local> scripts/eval-palette-judge.ts generate <vault> <cases.json> [--pages=60]
 *   bun --env-file=<.env.local> scripts/eval-palette-judge.ts run <vault> <cases.json> [--cache=scores.json] [--out=report.json] [--only=substr] [--misses]
 *
 * `generate` samples pages across the vault's folders and asks a writing model
 * for the short queries a reader would type to reach each one. `run` takes each
 * query, ranks it the way the palette does (fuzzy, then the Recommended
 * candidates), and asks Jev to score every page either step surfaced plus the
 * page the query was written for. Jev's scores stand in for labels: the eval
 * reports how far each step's first page falls below the best page Jev found.
 * Cases describe real pages, so keep the cases file out of this public repo. */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { buildWikiFilePaletteState, type WikiFilePalettePage } from "@oncobase/wiki-shell/file-palette";
import { formatFileLabel } from "@oncobase/wiki-content/file-labels";
import { createDecider, DECISION_MODELS } from "@oncobase/education/decisions";
import { MATCH_PRIOR, recommendQuestions, selectRecommended, WIKI_LAYOUT, type PaletteCandidate } from "../server/api/palette-recommend";
import { paletteBoost } from "../src/shell/palette-boost";
import { recommendCandidates } from "../src/shell/palette-recommend";
import type { PageIndexRow } from "../src/types";

type Case = { query: string; slug: string; style: string };
const [mode, vault, casesPath] = process.argv.slice(2);
if (!mode || !vault || !casesPath) throw Error("Usage: eval-palette-judge.ts generate|run <vault> <cases.json>");
const flag = (name: string) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const token = process.env.AI_GATEWAY_API_KEY;
if (!token) throw Error("AI_GATEWAY_API_KEY is not set (pass --env-file)");

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
const bodies = new Map<string, string>();
for await (const path of markdown(vault)) {
  const text = await readFile(path, "utf8");
  const front = text.startsWith("---") ? text.slice(3, text.indexOf("\n---", 3)) : "";
  let slug = relative(vault, path).replace(/\.md$/, "");
  if (slug.endsWith("/index")) slug = slug.slice(0, -"/index".length) || slug;
  const tags = field(front, "tags")?.replace(/^\[|\]$/g, "").split(",").map(tag => tag.trim()).filter(Boolean) ?? [];
  const title = field(front, "title") ?? text.match(/^# (.+)$/m)?.[1] ?? slug.split("/").at(-1)!;
  pages.push({ slug, title, tagsJson: JSON.stringify(tags), description: field(front, "description") ?? null, contentHash: null, sensitive: false, size: text.length });
  bodies.set(slug, (front ? text.slice(text.indexOf("\n---", 3) + 4) : text).slice(0, 600));
}
const bySlug = new Map(pages.map(page => [page.slug, page]));
const entries: WikiFilePalettePage[] = pages.map(page => ({ name: formatFileLabel(page.slug.split("/").at(-1)!), title: page.title, path: page.slug.split("/").join(" / "), slug: page.slug, boost: paletteBoost(page.slug) }));
const candidateOf = (slug: string): PaletteCandidate => {
  const page = bySlug.get(slug);
  const tags = page ? JSON.parse(page.tagsJson) as string[] : [];
  return { slug, title: page?.title, ...(tags.length ? { tags: tags.slice(0, 8) } : {}), ...(page?.description ? { description: page.description.slice(0, 300) } : {}) };
};

if (mode === "generate") {
  // Folders a reader opens, weighted toward what they open most.
  const STRATA: Array<[RegExp, number]> = [
    [/^wiki\/(?!education\/)/, 0.4], [/^wiki\/education\//, 0.05],
    [/^sources\/(diagnostics|medical-records|test-results)\//, 0.2],
    [/^sources\/meeting-notes\/.*-overview$/, 0.2], [/^sources\/emails?\//, 0.1],
    [/^(?!wiki\/|sources\/(diagnostics|medical-records|test-results|meeting-notes|emails?)\/)/, 0.05],
  ];
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const total = Number(flag("pages") ?? 60);
  const chosen = STRATA.flatMap(([pattern, share]) => {
    const pool = pages.filter(page => pattern.test(page.slug) && !/\/attachments\/|-(raw|formatted)$/.test(page.slug));
    return Array.from({ length: Math.round(total * share) }, () => pool.splice(Math.floor(random() * pool.length), 1)[0]).filter(Boolean) as PageIndexRow[];
  });
  const cases: Case[] = [];
  for (let at = 0; at < chosen.length; at += 10) {
    const batch = chosen.slice(at, at + 10);
    const prompt = `People open pages of a family's cancer-care wiki with a quick page finder (like Cmd+K). For each page below, write the two queries someone would actually type to reach it: "topic" (2-4 words naming what the page is about, the way a family member says it, not copying the title) and "terse" (1-3 words, abbreviated or partly typed, lowercase, as typed in a hurry). Answer with JSON only: [{"slug": "...", "topic": "...", "terse": "..."}].\n\n${batch.map(page => `slug: ${page.slug}\ntitle: ${page.title}\n${page.description ? `description: ${page.description}\n` : ""}starts: ${bodies.get(page.slug)!.replace(/\s+/g, " ").slice(0, 300)}`).join("\n\n")}`;
    const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: flag("writer") ?? "anthropic/claude-sonnet-5.5", messages: [{ role: "user", content: prompt }] }),
    });
    if (!response.ok) throw Error(`writer answered ${response.status}: ${await response.text()}`);
    const text = (await response.json() as { choices: Array<{ message: { content: string } }> }).choices[0]!.message.content;
    const rows = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1)) as Array<{ slug: string; topic: string; terse: string }>;
    for (const row of rows) if (bySlug.has(row.slug)) cases.push({ query: row.topic, slug: row.slug, style: "topic" }, { query: row.terse, slug: row.slug, style: "terse" });
    console.log(`${cases.length} queries`);
  }
  await writeFile(casesPath, JSON.stringify(cases, null, 2));
  process.exit(0);
}

const decide = createDecider({ token: () => token, models: DECISION_MODELS, timeoutMs: 15_000 });
const POOL = 60;
const cases = (JSON.parse(await readFile(casesPath, "utf8")) as Case[]).filter(item => !flag("only") || item.query.includes(flag("only")!));
const cachePath = flag("cache");
const cache: Record<string, Record<string, number>> = cachePath ? JSON.parse(await readFile(cachePath, "utf8").catch(() => "{}")) : {};
const promptKey = Bun.hash(WIKI_LAYOUT + recommendQuestions([{ slug: "x" }])[0]!.instructions).toString(36);
// Warm the prepared index, as the open palette has.
buildWikiFilePaletteState(entries, "x");

type Row = {
  query: string; style: string; target: string; best: number; bestSlugs: string[];
  sync: Array<{ slug: string; score: number }>; candidates: Array<{ slug: string; score: number }>; recommended: Array<{ slug: string; score: number }>;
  targetScore: number; syncTargetRank: number; recommendedTargetRank: number; candidateHasTarget: boolean; candidateHasBest: boolean;
};
const report: Row[] = [];
const run = async (item: Case): Promise<Row> => {
  const sync = (buildWikiFilePaletteState(entries, item.query).visibleEntries).map(page => page.slug);
  const candidates = recommendCandidates(pages, item.query, sync);
  const pool = [...new Set([...sync.slice(0, 10), ...candidates.map(page => page.slug), item.slug])].slice(0, POOL);
  if (!pool.includes(item.slug)) pool[pool.length - 1] = item.slug;
  // Scores are cached per prompt, so a ranking change only asks about pages it newly surfaces.
  const known = cache[`${promptKey}|${item.query}`] ??= {};
  const ask = pool.filter(slug => known[slug] === undefined);
  if (ask.length) {
    const decision = await decide({ reader_typed: item.query, wiki_layout: WIKI_LAYOUT }, recommendQuestions(ask.map(candidateOf)));
    ask.forEach((slug, position) => { known[slug] = decision.answers.get(`p${position}`)?.score ?? 0; });
  }
  const score = new Map(pool.map(slug => [slug, known[slug]!]));
  const best = Math.max(...score.values());
  const recommended = selectRecommended(candidates.map(page => ({ slug: page.slug, rank: page.rank, score: score.get(page.slug) ?? 0 })), { matchPrior: Number(flag("prior") ?? MATCH_PRIOR) }).map(({ slug, score }) => ({ slug, score }));
  return {
    query: item.query, style: item.style, target: item.slug, best,
    bestSlugs: pool.filter(slug => score.get(slug)! >= best - 0.25),
    sync: sync.slice(0, 5).map(slug => ({ slug, score: score.get(slug) ?? 0 })),
    recommended, candidates: candidates.map(page => ({ slug: page.slug, score: score.get(page.slug) ?? 0 })), targetScore: score.get(item.slug) ?? 0,
    syncTargetRank: sync.indexOf(item.slug) + 1,
    recommendedTargetRank: recommended.findIndex(row => row.slug === item.slug) + 1,
    candidateHasTarget: candidates.some(page => page.slug === item.slug),
    candidateHasBest: candidates.some(page => score.get(page.slug)! >= best - 0.25),
  };
};
for (let at = 0; at < cases.length; at += 6) {
  report.push(...await Promise.all(cases.slice(at, at + 6).map(item => run(item).catch(error => { console.error(`"${item.query}": ${error}`); return null; }))).then(rows => rows.filter((row): row is Row => Boolean(row))));
  process.stdout.write(`\r${report.length}/${cases.length}`);
}
console.log("\n");

const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const mrr = (ranks: number[]) => mean(ranks.map(rank => rank ? 1 / rank : 0));
const summary = (rows: Row[], label: string) => {
  const syncTop = rows.map(row => row.sync[0]?.score ?? 0), recTop = rows.map(row => row.recommended[0]?.score ?? (row.sync[0]?.score ?? 0));
  console.log(`${label.padEnd(8)} n=${String(rows.length).padStart(3)}  ` +
    `judge regret sync ${mean(rows.map((row, i) => row.best - syncTop[i]!)).toFixed(2)} rec ${mean(rows.map((row, i) => row.best - recTop[i]!)).toFixed(2)}  ` +
    `top1≈best sync ${rows.filter((row, i) => syncTop[i]! >= row.best - 0.25).length} rec ${rows.filter((row, i) => recTop[i]! >= row.best - 0.25).length}  ` +
    `target MRR sync ${mrr(rows.map(row => row.syncTargetRank)).toFixed(2)} rec ${mrr(rows.map(row => row.recommendedTargetRank)).toFixed(2)}  ` +
    `recall target ${rows.filter(row => row.candidateHasTarget).length} best ${rows.filter(row => row.candidateHasBest).length}  empty rec ${rows.filter(row => !row.recommended.length).length}`);
};
summary(report, "all");
for (const style of new Set(report.map(row => row.style))) summary(report.filter(row => row.style === style), style);
if (cachePath) await writeFile(cachePath, JSON.stringify(cache));
const out = flag("out");
if (out) await writeFile(out, JSON.stringify(report, null, 2));
if (process.argv.includes("--misses")) {
  for (const row of report.filter(row => (row.sync[0]?.score ?? 0) < row.best - 0.25 || !row.candidateHasTarget)) {
    console.log(`\n"${row.query}" (${row.style}) best ${row.best.toFixed(2)} target ${row.target} ${row.targetScore.toFixed(2)}${row.candidateHasTarget ? "" : " NOT A CANDIDATE"}`);
    console.log(`  best: ${row.bestSlugs.slice(0, 3).join(", ")}`);
    console.log(`  sync: ${row.sync.slice(0, 3).map(r => `${r.slug} ${r.score.toFixed(2)}`).join(", ")}`);
    console.log(`  rec:  ${row.recommended.slice(0, 3).map(r => `${r.slug} ${r.score.toFixed(2)}`).join(", ") || "(none)"}`);
  }
}
