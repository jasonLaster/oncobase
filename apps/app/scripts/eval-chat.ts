/**
 * Wiki chat eval: runs the production agent (tools, prompt, step policy and
 * gateway routing from server/chat-agent.ts) against a local copy of the
 * vault, then scores each answer on gold facts, citations and cost.
 *
 *   bun --env-file=<repo>/.env.local apps/app/scripts/eval-chat.ts [vault] \
 *     [--tasks=core,november-log] [--models=a/b,c/d] [--cases=id,id] [--limit=N] [--runs=N]
 *     [--judge=model] [--out=file.json] [--verbose]
 *
 * Gold tasks hold patient facts, so they never live in this (public) repo.
 * `--tasks` names JSON files in WIKI_CHAT_EVAL_DIR (default: the vault's
 * sibling `evals/chat/`), or gives paths. A task:
 *   { id, question, facts: string[] | {fact, page, quote}[], pages?: (regex | {pattern, flags})[],
 *     required_pages?: slug[], absent?: boolean, note?: string }
 * `required_pages` are pages the answer needs; the eval reports how many the
 * agent read, searched in or cited (page recall). Tasks may set
 * `exclude_pages` (regexes) to hide pages, e.g. the log that summarizes them.
 *
 * The vault stands in for production content (the whole vault is published).
 * It is read as a signed-out viewer: sensitive pages are excluded and PII is
 * redacted by the same tool code production uses. Requests go through AI
 * Gateway with zero data retention and no prompt training, like production.
 * Fallback models are disabled so each row measures one model.
 */
import { homedir } from "node:os";
import path from "node:path";
import { generateText } from "ai";
import { z } from "zod";
import { readVaultDocuments } from "../../../packages/oncobase/src/walk-vault";
import { chatPageSections } from "@oncobase/wiki-content/chat-tools";
import { WIKI_CHAT_DIAGNOSIS_SLUGS, composeWikiChatSystemPrompt } from "@oncobase/wiki-content/chat-route";
import { applyPiiRedactions } from "@oncobase/wiki-content/pii";
import { createWikiChatTools, wikiChatRunSettings, type WikiChatDocuments } from "../server/chat-agent";
import { prepareSearchPage } from "../server/search-corpus";

type GoldFact = string | { fact: string; page?: string; quote?: string };
type TaskFile = { name?: string; exclude_pages?: Array<string | { pattern: string; flags?: string }>; tasks: RawTask[] };
type RawTask = {
  id: string; question: string; facts: GoldFact[]; pages?: Array<string | { pattern: string; flags?: string }>;
  required_pages?: string[]; absent?: boolean; note?: string;
};
type Case = {
  id: string; question: string; facts: string[]; pages: RegExp[]; required: string[]; absent?: boolean; note?: string;
};
const toRegExp = (value: string | { pattern: string; flags?: string }) =>
  typeof value === "string" ? new RegExp(value) : new RegExp(value.pattern, value.flags);

// ---------- vault-backed documents ----------

const args = process.argv.slice(2);
const flag = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const vault = args.find((arg) => !arg.startsWith("--")) ?? path.join(homedir(), "src/projects/diana-tnbc/obsidian");
const verbose = args.includes("--verbose");
const evalDir = process.env.WIKI_CHAT_EVAL_DIR ?? path.join(path.dirname(path.resolve(vault)), "evals/chat");

const taskFiles: TaskFile[] = await Promise.all((flag("tasks") ?? "core").split(",").map(async (name) => {
  const file = name.includes("/") || name.endsWith(".json") ? name : path.join(evalDir, `${name}.json`);
  return JSON.parse(await Bun.file(file).text()) as TaskFile;
}));
const CASES: Case[] = taskFiles.flatMap((file) => file.tasks.map((task) => {
  const facts = task.facts.map((fact) => (typeof fact === "string" ? fact : fact.fact));
  const required = task.required_pages ?? [...new Set(task.facts.flatMap((fact) => (typeof fact === "object" && fact.page ? [fact.page] : [])))];
  const pages = task.pages?.map(toRegExp) ?? required.map((slug) => new RegExp(`^${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  return { id: task.id, question: task.question, facts, pages, required, absent: task.absent, note: task.note };
}));
const excluded = taskFiles.flatMap((file) => file.exclude_pages ?? []).map(toRegExp);

const allDocs = readVaultDocuments(vault);
const docs = allDocs.filter((doc) => !doc.sensitive && !excluded.some((pattern) => pattern.test(doc.slug)));
const bySlug = new Map(allDocs.map((doc) => [doc.slug, doc]));
const publicBySlug = new Map(docs.map((doc) => [doc.slug, doc]));
const tokenize = (value: string) => value.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? [];
const docTokens = docs.map((doc) => {
  const counts = new Map<string, number>();
  for (const token of tokenize(doc.content)) counts.set(token, (counts.get(token) ?? 0) + 1);
  return { doc, counts, title: new Set(tokenize(`${doc.title} ${doc.slug.replace(/[/-]/g, " ")}`)) };
});
const documentFrequency = new Map<string, number>();
for (const { counts } of docTokens) for (const token of counts.keys()) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);

/** Stand-in for Convex's full-text index: BM25-like over content, title boost. */
function searchDocs(query: string, limit = 6) {
  const terms = [...new Set(tokenize(query))].filter((term) => documentFrequency.has(term));
  if (!terms.length) return [];
  const scored = docTokens.map(({ doc, counts, title }) => {
    let score = 0;
    for (const term of terms) {
      const tf = counts.get(term) ?? 0;
      const idf = Math.log(1 + docs.length / (documentFrequency.get(term) ?? 1));
      score += idf * ((tf * 2.2) / (tf + 1.2)) + (title.has(term) ? idf * 2 : 0);
    }
    return { doc, score };
  }).filter((row) => row.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  return scored.map(({ doc }) => {
    const line = doc.content.split("\n").find((candidate) => terms.some((term) => candidate.toLowerCase().includes(term))) ?? "";
    return { slug: doc.slug, title: doc.title, tags: doc.tags, excerpt: line.slice(0, 240) };
  });
}

const searchable = docs.map((doc) => prepareSearchPage(doc, undefined));
const documents: WikiChatDocuments = {
  search: async ({ query, limit }) => searchDocs(query, limit),
  // Like Convex: a signed-out read sees public pages; includeSensitive only
  // reveals that a sensitive page exists so read_page can say "unavailable".
  getBySlug: async ({ slug, includeSensitive }) => (includeSensitive ? bySlug : publicBySlug).get(slug) ?? null,
  list: async () => docs.map(({ slug, title, tags }) => ({ slug, title, tags })),
  getByTag: async ({ tag }) => docs.filter((doc) => doc.tags.includes(tag)).map(({ slug, title, tags }) => ({ slug, title, tags })),
  listTags: async () => [...new Set(docs.flatMap((doc) => doc.tags))].sort(),
  vectorSearch: async () => [],
  searchablePages: async () => searchable,
};

const redact = (value: string) => applyPiiRedactions(value, { patterns: undefined });
const diagnosis = WIKI_CHAT_DIAGNOSIS_SLUGS.map((slug) => publicBySlug.get(slug)).find(Boolean);
const systemPrompt = composeWikiChatSystemPrompt({
  diagnosis: diagnosis ? redact(diagnosis.content) : null,
  index: publicBySlug.get("index") ? redact(publicBySlug.get("index")!.content) : null,
});

// ---------- pricing ----------

type Pricing = { input: number; output: number; cacheRead?: number; cacheWrite?: number };
const pricing = new Map<string, Pricing>();
async function loadPricing() {
  const response = await fetch("https://ai-gateway.vercel.sh/v1/models");
  if (!response.ok) throw new Error(`Model catalog request failed: ${response.status}`);
  const body = (await response.json()) as { data: Array<{ id: string; pricing?: Record<string, string> }> };
  for (const model of body.data) {
    const p = model.pricing;
    if (!p?.input || !p.output) continue;
    pricing.set(model.id, {
      input: Number(p.input), output: Number(p.output),
      cacheRead: p.input_cache_read ? Number(p.input_cache_read) : undefined,
      cacheWrite: p.input_cache_write ? Number(p.input_cache_write) : undefined,
    });
  }
}

type Usage = { inputTokens?: number; outputTokens?: number; inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number }; cachedInputTokens?: number };
function costOf(model: string, usage: Usage) {
  const price = pricing.get(model);
  if (!price) return NaN;
  const cacheRead = usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens ?? 0;
  const cacheWrite = usage.inputTokenDetails?.cacheWriteTokens ?? 0;
  const fresh = Math.max(0, (usage.inputTokens ?? 0) - cacheRead - cacheWrite);
  return fresh * price.input + cacheRead * (price.cacheRead ?? price.input) + cacheWrite * (price.cacheWrite ?? price.input)
    + (usage.outputTokens ?? 0) * price.output;
}

// ---------- scoring ----------

const LINK = /\]\((\/[^)\s]+)\)/g;
function checkCitations(text: string) {
  const links = [...text.matchAll(LINK)].map((match) => match[1]!);
  let pageOk = 0, anchorOk = 0, anchors = 0;
  const broken: string[] = [];
  for (const link of links) {
    const [rawSlug, anchor] = decodeURI(link).slice(1).split("#");
    const slug = rawSlug!.replace(/\/$/, "");
    const doc = bySlug.get(slug) ?? bySlug.get(`${slug}/index`);
    if (!doc) { broken.push(link); continue; }
    pageOk++;
    if (anchor) {
      anchors++;
      if (chatPageSections(doc.content).some((section) => section.anchor === anchor)) anchorOk++;
      else broken.push(link);
    }
  }
  return { links: links.length, pageOk, anchors, anchorOk, broken, cited: links.map((link) => link.slice(1).split("#")[0]!) };
}

const JudgeSchema = z.object({
  facts: z.array(z.object({ fact: z.string(), verdict: z.enum(["correct", "missing", "wrong"]) })),
  fabricated: z.boolean().describe("The answer states specific results, values or events the expected facts contradict, or (for an absent case) invents any"),
  absent_handled: z.boolean().describe("For an absent case: the answer clearly says the wiki has no such information. True otherwise."),
  quality: z.number().min(1).max(10).describe("Clarity and usefulness for a patient's family member"),
  reason: z.string(),
});

async function judge(c: Case, answer: string, judgeModel: string) {
  const { output } = await generateText({
    model: judgeModel,
    providerOptions: { gateway: { zeroDataRetention: true, disallowPromptTraining: true } },
    output: (await import("ai")).Output.object({ schema: JudgeSchema }),
    system: "You grade a medical knowledge-base assistant against facts taken from its own wiki. Judge only against the expected facts; do not use outside knowledge. A fact is correct when the answer states it (paraphrase is fine), missing when absent, wrong when the answer contradicts it.",
    prompt: `Question: ${c.question}\n${c.absent ? "This is an ABSENT case: the wiki has no answer.\n" : ""}Expected facts:\n${c.facts.map((fact) => `- ${fact}`).join("\n")}\n\nAnswer:\n${answer.slice(0, 12_000)}`,
  });
  return output;
}

type Run = {
  model: string; case: string; run: number; ok: boolean; error?: string;
  seconds: number; steps: number; tools: Record<string, number>; truncatedReads: number; continuedReads: number;
  finish: string; costUsd: number; words: number;
  retrieval: boolean; required: number; requiredFound: number; facts: number; factsCorrect: number; factsWrong: number; fabricated: boolean; absentHandled: boolean; quality: number;
  links: number; brokenLinks: string[]; judgeReason?: string; answer?: string;
};

async function runCase(model: string, c: Case, run: number, judgeModel: string): Promise<Run> {
  const started = performance.now();
  const base = { model, case: c.id, run };
  const { audience: _audience, ...settings } = wikiChatRunSettings({ audience: "person", model });
  try {
    const tools = createWikiChatTools({ documents, piiPatterns: undefined, embedQuery: async () => null });
    const result = await generateText({
      ...settings,
      system: systemPrompt,
      messages: [{ role: "user", content: c.question }],
      tools,
      abortSignal: AbortSignal.timeout(240_000),
    });
    const seconds = (performance.now() - started) / 1000;
    const toolCounts: Record<string, number> = {};
    const touched = new Set<string>();
    let truncatedReads = 0, continuedReads = 0;
    for (const step of result.steps) {
      for (const call of step.toolCalls) {
        toolCounts[call.toolName] = (toolCounts[call.toolName] ?? 0) + 1;
        const input = call.input as { slug?: string; offset?: number };
        if (input.slug) touched.add(input.slug.split("#")[0]!.replace(/^\//, ""));
        if (call.toolName === "read_page" && (input.offset !== undefined || input.slug?.includes("#"))) continuedReads++;
      }
      for (const toolResult of step.toolResults) {
        const output = toolResult.output as { truncated?: boolean } | undefined;
        if (toolResult.toolName === "read_page" && output?.truncated) truncatedReads++;
      }
    }
    const text = result.text;
    const citations = checkCitations(text);
    for (const slug of citations.cited) touched.add(slug);
    const retrieval = c.pages.length === 0 || [...touched].some((slug) => c.pages.some((pattern) => pattern.test(slug)));
    const requiredFound = c.required.filter((slug) => touched.has(slug)).length;
    const graded = text.trim() ? await judge(c, text, judgeModel) : null;
    const facts = graded?.facts ?? [];
    return {
      ...base, ok: true, seconds, steps: result.steps.length, tools: toolCounts, truncatedReads, continuedReads,
      finish: result.finishReason, costUsd: costOf(model, result.totalUsage as Usage), words: text.split(/\s+/).filter(Boolean).length,
      retrieval, required: c.required.length, requiredFound, facts: c.facts.length, factsCorrect: facts.filter((fact) => fact.verdict === "correct").length,
      factsWrong: facts.filter((fact) => fact.verdict === "wrong").length, fabricated: graded?.fabricated ?? false,
      absentHandled: graded?.absent_handled ?? false, quality: graded?.quality ?? 0,
      links: citations.links, brokenLinks: citations.broken, judgeReason: graded?.reason, answer: text,
    };
  } catch (error) {
    return {
      ...base, ok: false, error: (error as Error).message.slice(0, 300), seconds: (performance.now() - started) / 1000,
      steps: 0, tools: {}, truncatedReads: 0, continuedReads: 0, finish: "error", costUsd: 0, words: 0, retrieval: false, required: c.required.length, requiredFound: 0,
      facts: c.facts.length, factsCorrect: 0, factsWrong: 0, fabricated: false, absentHandled: false, quality: 0, links: 0, brokenLinks: [],
    };
  }
}

async function pool<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>) {
  const results: R[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!);
    }
  }));
  return results;
}

const DEFAULT_MODELS = [
  "anthropic/claude-sonnet-5.5",
  "openai/gpt-6.2-astra",
  "openai/gpt-5.6-luna",
  "deepseek/deepseek-v4.1-flash-1017",
  "deepseek/deepseek-v4-pro-0813",
  "alibaba/qwen3.7-plus",
  "zai/glm-5.3-flash",
  "minimax/minimax-m3.1-flash",
];

async function main() {
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) throw new Error("Set AI_GATEWAY_API_KEY (or run with --env-file .env.local)");
  const models = flag("models")?.split(",").map((model) => model.trim()).filter(Boolean) ?? DEFAULT_MODELS;
  const selected = flag("cases")?.split(",");
  const limit = Number(flag("limit") ?? Infinity);
  const cases = (selected ? CASES.filter((c) => selected.includes(c.id)) : CASES).slice(0, limit);
  const runs = Number(flag("runs") ?? 1);
  const judgeModel = flag("judge") ?? "anthropic/claude-opus-5.5";
  for (const c of cases) for (const pattern of c.pages) {
    if (!docs.some((doc) => pattern.test(doc.slug))) console.warn(`  ! ${c.id}: no public page matches ${pattern}`);
  }
  await loadPricing();
  console.log(`${CASES.length} tasks from ${taskFiles.map((file) => file.name ?? "?").join(", ")}; ${docs.length} pages (${allDocs.length - docs.length} sensitive or excluded); prompt ${Math.round(systemPrompt.length / 1000)}k chars; diagnosis ${diagnosis ? diagnosis.slug : "MISSING"}`);
  console.log(`${models.length} models x ${cases.length} cases x ${runs} run(s); judge ${judgeModel}\n`);

  const all = await Promise.all(models.map(async (model) => {
    const jobs = cases.flatMap((c) => Array.from({ length: runs }, (_, run) => ({ c, run })));
    const results = await pool(jobs, 3, ({ c, run }) => runCase(model, c, run, judgeModel).then((result) => {
      const mark = !result.ok ? "ERR " : result.factsCorrect === result.facts && !result.fabricated ? "PASS" : "    ";
      console.log(`  ${mark} ${model.padEnd(36)} ${c.id.padEnd(15)} ${result.ok ? `${result.factsCorrect}/${result.facts} facts${result.fabricated ? " FABRICATED" : ""}, ${result.steps} steps, ${result.seconds.toFixed(0)}s, $${result.costUsd.toFixed(4)}` : result.error}`);
      return result;
    }));
    return results;
  }));
  const rows = all.flat();

  const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const pct = (value: number) => `${Math.round(value * 100)}%`;
  console.log(`\n${"Model".padEnd(36)} ${"Facts".padStart(6)} ${"Pass".padStart(5)} ${"Fab".padStart(4)} ${"Retr".padStart(5)} ${"Pages".padStart(6)} ${"Qual".padStart(5)} ${"Links".padStart(6)} ${"Bad".padStart(4)} ${"Steps".padStart(6)} ${"Secs".padStart(5)} ${"$/q".padStart(8)} ${"Err".padStart(4)}`);
  const summaries = models.map((model) => {
    const mine = rows.filter((row) => row.model === model);
    const done = mine.filter((row) => row.ok);
    const factTotal = done.reduce((sum, row) => sum + row.facts, 0);
    const summary = {
      model,
      facts: factTotal ? done.reduce((sum, row) => sum + row.factsCorrect, 0) / factTotal : 0,
      pass: mine.length ? done.filter((row) => row.factsCorrect === row.facts && !row.fabricated && (!CASES.find((c) => c.id === row.case)?.absent || row.absentHandled)).length / mine.length : 0,
      fabricated: done.filter((row) => row.fabricated).length,
      retrieval: done.length ? done.filter((row) => row.retrieval).length / done.length : 0,
      recall: (() => { const need = done.reduce((sum, row) => sum + row.required, 0); return need ? done.reduce((sum, row) => sum + row.requiredFound, 0) / need : NaN; })(),
      quality: mean(done.map((row) => row.quality)),
      links: mean(done.map((row) => row.links)),
      broken: done.reduce((sum, row) => sum + row.brokenLinks.length, 0),
      steps: mean(done.map((row) => row.steps)),
      seconds: mean(done.map((row) => row.seconds)),
      cost: mean(done.map((row) => row.costUsd)),
      errors: mine.length - done.length,
    };
    return summary;
  }).sort((a, b) => b.facts - a.facts || a.cost - b.cost);
  for (const s of summaries) {
    console.log(`${s.model.padEnd(36)} ${pct(s.facts).padStart(6)} ${pct(s.pass).padStart(5)} ${String(s.fabricated).padStart(4)} ${pct(s.retrieval).padStart(5)} ${(Number.isNaN(s.recall) ? "-" : pct(s.recall)).padStart(6)} ${s.quality.toFixed(1).padStart(5)} ${s.links.toFixed(1).padStart(6)} ${String(s.broken).padStart(4)} ${s.steps.toFixed(1).padStart(6)} ${s.seconds.toFixed(0).padStart(5)} ${("$" + s.cost.toFixed(4)).padStart(8)} ${String(s.errors).padStart(4)}`);
  }
  console.log("\nFacts = gold facts stated correctly; Pass = every fact, nothing fabricated; Fab = answers with fabricated specifics;");
  console.log("Retr = read or cited an expected page; Pages = share of required pages read, searched in or cited;");
  console.log("Bad = citation links to a missing page or anchor.");

  if (verbose) for (const row of rows.filter((row) => row.ok && (row.factsCorrect < row.facts || row.fabricated || row.brokenLinks.length))) {
    console.log(`\n--- ${row.model} / ${row.case}: ${row.judgeReason}\n    tools ${JSON.stringify(row.tools)} truncated=${row.truncatedReads} continued=${row.continuedReads}${row.brokenLinks.length ? `\n    broken ${row.brokenLinks.join(" ")}` : ""}`);
  }
  const out = flag("out");
  if (out) {
    await Bun.write(out, JSON.stringify({ at: new Date().toISOString(), judge: judgeModel, summaries, rows }, null, 2));
    console.log(`\nWrote ${out}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
