/**
 * Evaluate chat agent quality across multiple models in parallel.
 * Uses Sonnet 4.6 as an LLM judge for readability, plus heuristic scoring.
 *
 * Usage:
 *   npx tsx scripts/eval-chat.ts                    # all default models
 *   npx tsx scripts/eval-chat.ts gpt-5.4-mini       # single model (prefix match)
 *   npx tsx scripts/eval-chat.ts --question "X?"    # custom question for all models
 *
 * --- Leaderboard (2026-04-07, with index+diagnosis in prompt) ---
 *
 * | Model                        | Overall | Retrieval | Tools | Citations | Readability | Speed  | $/query |
 * |------------------------------|---------|-----------|-------|-----------|-------------|--------|---------|
 * | openai/gpt-5.4-mini          |   9.6   |    9.6    |   9   |    10     |     TBD     |  6.4s  |  TBD    |
 * | google/gemini-2.5-flash      |   9.2   |    10     |  8.4  |    8.8    |     TBD     | 12.6s  |  TBD    |
 * | anthropic/claude-sonnet-4    |   8.6   |    9.5    |   9   |    7.5    |     TBD     | 32.8s  |  TBD    |
 */
import {
  streamText,
  generateText,
  stepCountIs,
  type ModelMessage,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(__dirname, "..", ".env.local") });
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!CONVEX_URL) { console.error("NEXT_PUBLIC_CONVEX_URL not set"); process.exit(1); }
const convex = new ConvexHttpClient(CONVEX_URL);

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

// --- Cost per 1M tokens (input/output) from OpenRouter ---
const COST_PER_1M: Record<string, { input: number; output: number }> = {
  "openai/gpt-5.4-mini":          { input: 1.00, output: 4.00 },
  "openai/gpt-4.1-mini":          { input: 0.40, output: 1.60 },
  "anthropic/claude-sonnet-4":    { input: 3.00, output: 15.00 },
  "anthropic/claude-sonnet-4.6":  { input: 3.00, output: 15.00 },
  "anthropic/claude-opus-4.6":    { input: 15.00, output: 75.00 },
  "google/gemini-2.5-flash":      { input: 0.15, output: 0.60 },
  "google/gemini-3.1-flash-lite-preview": { input: 0.10, output: 0.40 },
  "moonshotai/kimi-k2":           { input: 0.60, output: 2.40 },
  "qwen/qwen3.5-flash-02-23":    { input: 0.10, output: 0.40 },
};

// --- System prompt ---
const SYSTEM_PROMPT_BASE = `You are a research assistant for Diana's TNBC (triple-negative breast cancer) knowledge base. You help answer questions about Diana's diagnosis, treatment plan, research, and related medical topics.

You have access to tools that let you search and read wiki pages. Use them to find relevant information before answering. Always ground your answers in the wiki content when possible.

IMPORTANT CITATION RULES:
- ALWAYS cite sources using inline markdown links: [Page Title](/slug)
- Every factual claim should have a citation. Aim for 5+ citations per response.
- Example: "Diana is on [KEYNOTE-522](/wiki/treatment/treatment-plan) which includes..."
- Do NOT list sources at the end — weave them inline throughout your response.

Search strategy:
- Use the PAGE INDEX below to find the right slug, then use read_page to get details
- Use search_wiki for broad discovery when you're not sure which page has the answer
- After searching, read the 2-3 most relevant pages before answering
- Do NOT use list_pages — use the PAGE INDEX instead

Be direct, compassionate, and precise. Use medical terminology but explain it when needed.`;

let cachedSystemPrompt: string | null = null;
async function getSystemPrompt(): Promise<string> {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  const [indexDoc, diagnosisDoc] = await Promise.all([
    convex.query(api.documents.getBySlug, { slug: "index" }),
    convex.query(api.documents.getBySlug, { slug: "wiki/diagnostics/diagnosis" }),
  ]);
  let prompt = SYSTEM_PROMPT_BASE;
  if (diagnosisDoc) prompt += `\n\n## DIANA'S DIAGNOSIS\n\n${diagnosisDoc.content}`;
  if (indexDoc) prompt += `\n\n## PAGE INDEX\n\nUse these slugs with read_page to get full content:\n\n${indexDoc.content}`;
  cachedSystemPrompt = prompt;
  return prompt;
}

// --- Search fan-out ---
function generateSearchPatterns(query: string): string[] {
  const patterns = new Set<string>();
  const clean = query.trim();
  if (clean) patterns.add(clean);
  const words = clean.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length >= 2) {
    for (let i = 0; i < words.length - 1 && patterns.size < 5; i++) {
      patterns.add(`${words[i]} ${words[i + 1]}`);
    }
  }
  const expansions: Record<string, string> = {
    tnbc: "triple-negative breast cancer", pcr: "pathologic complete response",
    ctdna: "circulating tumor DNA", mrd: "minimal residual disease",
    rcb: "residual cancer burden", "keynote-522": "pembrolizumab chemotherapy",
    ac: "doxorubicin cyclophosphamide", pembro: "pembrolizumab",
  };
  for (const [abbrev, expansion] of Object.entries(expansions)) {
    if (clean.toLowerCase().includes(abbrev)) patterns.add(expansion);
  }
  return Array.from(patterns).slice(0, 4);
}

// --- Tool definitions ---
interface ToolEvent { tool: string; input: Record<string, unknown>; output: unknown; durationMs: number; resultCount?: number; }

function createTools(events: ToolEvent[]) {
  return {
    search_wiki: {
      description: "Search wiki pages. Fans out into multiple parallel searches automatically.",
      inputSchema: z.object({ query: z.string().describe("What you're looking for") }),
      execute: async ({ query }: { query: string }) => {
        const start = Date.now();
        const patterns = generateSearchPatterns(query);
        const allResults = await Promise.all(patterns.map((p) => convex.query(api.documents.search, { query: p, limit: 6 })));
        const seen = new Set<string>();
        const merged: Array<{ slug: string; title: string; tags: string[]; excerpt: string }> = [];
        for (const results of allResults) for (const r of results) if (!seen.has(r.slug)) { seen.add(r.slug); merged.push(r); }
        const final = merged.slice(0, 12);
        events.push({ tool: "search_wiki", input: { query, patterns }, output: final.map((r) => ({ slug: r.slug, title: r.title })), durationMs: Date.now() - start, resultCount: final.length });
        return final;
      },
    },
    read_page: {
      description: "Read the full content of a specific wiki page by its slug.",
      inputSchema: z.object({ slug: z.string() }),
      execute: async ({ slug }: { slug: string }) => {
        const start = Date.now();
        const doc = await convex.query(api.documents.getBySlug, { slug });
        const result = doc ? { slug: doc.slug, title: doc.title, tags: doc.tags, content: doc.content.slice(0, 8000) } : { error: `Page not found: ${slug}` };
        events.push({ tool: "read_page", input: { slug }, output: doc ? { slug: doc.slug, title: doc.title } : { error: "not found" }, durationMs: Date.now() - start });
        return result;
      },
    },
    list_pages: {
      description: "List all available wiki pages.",
      inputSchema: z.object({}),
      execute: async () => {
        const start = Date.now();
        const results = await convex.query(api.documents.list, {});
        events.push({ tool: "list_pages", input: {}, output: `${results.length} pages`, durationMs: Date.now() - start, resultCount: results.length });
        return results;
      },
    },
    get_pages_by_tag: {
      description: "Find all pages that have a specific tag.",
      inputSchema: z.object({ tag: z.string() }),
      execute: async ({ tag }: { tag: string }) => {
        const start = Date.now();
        const results = await convex.query(api.documents.getByTag, { tag });
        events.push({ tool: "get_pages_by_tag", input: { tag }, output: results, durationMs: Date.now() - start, resultCount: results.length });
        return results;
      },
    },
    list_tags: {
      description: "List all tags used across the wiki.",
      inputSchema: z.object({}),
      execute: async () => {
        const start = Date.now();
        const results = await convex.query(api.documents.listTags, {});
        events.push({ tool: "list_tags", input: {}, output: `${results.length} tags`, durationMs: Date.now() - start, resultCount: results.length });
        return results;
      },
    },
  };
}

// --- Eval result ---
interface EvalResult {
  model: string;
  question: string;
  toolEvents: ToolEvent[];
  responseText: string;
  stepCount: number;
  totalDurationMs: number;
  scores: {
    retrieval: number;
    toolUsage: number;
    citations: number;
    length: number;
    readability: number;
    cost: number;
    overall: number;
  };
  costUsd: number;
  issues: string[];
}

// --- Heuristic scoring ---
function heuristicScore(events: ToolEvent[], text: string): { retrieval: number; toolUsage: number; citations: number; length: number; issues: string[] } {
  const issues: string[] = [];
  const searches = events.filter((e) => e.tool === "search_wiki");
  const reads = events.filter((e) => e.tool === "read_page");
  const listPages = events.filter((e) => e.tool === "list_pages");

  let retrieval = 10;
  if (searches.length === 0 && reads.length === 0) { retrieval = 2; issues.push("No retrieval"); }
  const emptySearches = searches.filter((e) => e.resultCount === 0);
  if (emptySearches.length > 0) { retrieval -= emptySearches.length * 2; issues.push(`${emptySearches.length} empty searches`); }
  for (const s of searches) { const q = s.input.query as string; if (q && q.split(/\s+/).length > 5) { retrieval -= 1; issues.push("Long search query"); } }
  retrieval = Math.max(0, Math.min(10, retrieval));

  let toolUsage = 7;
  if (reads.length === 0 && searches.length > 0) { toolUsage -= 3; issues.push("Searched but never read pages"); }
  if (reads.length > 0) toolUsage += 2;
  if (listPages.length > 0) { toolUsage -= 1; issues.push("Used list_pages"); }
  if (events.length > 15) { toolUsage -= 2; issues.push(`${events.length} tool calls (excessive)`); }
  toolUsage = Math.max(0, Math.min(10, toolUsage));

  const linkCount = (text.match(/\[.+?\]\(\/.+?\)/g) || []).length;
  let citations = Math.min(10, linkCount * 2);
  if (linkCount === 0) { issues.push("No citations"); citations = 0; }

  const wordCount = text.split(/\s+/).length;
  let length = 7;
  if (wordCount < 50) { length = 3; issues.push(`${wordCount} words (too short)`); }
  else if (wordCount < 100) length = 5;
  else if (wordCount > 800) { length = 5; issues.push(`${wordCount} words (too long)`); }
  else if (wordCount >= 150 && wordCount <= 500) length = 10;

  return { retrieval, toolUsage, citations, length, issues };
}

// --- LLM judge (Sonnet 4.6) ---
async function judgeReadability(question: string, response: string): Promise<number> {
  try {
    const result = await generateText({
      model: openrouter.chat("google/gemini-2.5-flash"), // cheap judge; swap to sonnet-4.6 when credits allow
      system: `You are an evaluator scoring a medical research assistant's response for readability and helpfulness.
Score from 1-10 where:
1-3: Confusing, poorly organized, hard to follow
4-6: Adequate but could be clearer or better structured
7-8: Clear, well-organized, good use of formatting
9-10: Excellent — easy to scan, well-structured, compassionate, actionable

Consider: structure, clarity, use of headers/bullets, medical jargon explained, empathy, actionability.
Respond with ONLY a JSON object: {"score": N, "reason": "one sentence"}`,
      prompt: `Question: ${question}\n\nResponse:\n${response.slice(0, 3000)}`,
    });
    const parsed = JSON.parse(result.text.replace(/```json\n?|\n?```/g, "").trim());
    return Math.max(1, Math.min(10, parsed.score));
  } catch (err) {
    console.error(`  [judge] Error: ${(err as Error).message?.slice(0, 80)}`);
    return 5; // default if judge fails
  }
}

// --- Cost estimation ---
function estimateCost(model: string, text: string, systemPromptLen: number, toolEvents: ToolEvent[]): number {
  const costs = COST_PER_1M[model];
  if (!costs) return 0;
  // Rough token estimation: 1 token ≈ 4 chars
  const inputChars = systemPromptLen + 200 + toolEvents.reduce((sum, e) => sum + JSON.stringify(e.output).length, 0);
  const outputChars = text.length;
  const inputTokens = inputChars / 4;
  const outputTokens = outputChars / 4;
  return (inputTokens * costs.input + outputTokens * costs.output) / 1_000_000;
}

function costScore(costUsd: number): number {
  if (costUsd <= 0.001) return 10;
  if (costUsd <= 0.005) return 9;
  if (costUsd <= 0.01) return 8;
  if (costUsd <= 0.02) return 7;
  if (costUsd <= 0.05) return 5;
  if (costUsd <= 0.10) return 3;
  return 1;
}

// --- Run one question for one model ---
async function runOne(question: string, model: string): Promise<EvalResult> {
  const events: ToolEvent[] = [];
  const tools = createTools(events);
  const systemPrompt = await getSystemPrompt();
  const start = Date.now();
  const messages: ModelMessage[] = [{ role: "user", content: question }];

  const result = await streamText({
    model: openrouter.chat(model),
    system: systemPrompt,
    messages,
    stopWhen: stepCountIs(10),
    tools,
  });

  const response = await result;
  const text = await response.text;
  const steps = (await response.steps).length;
  const durationMs = Date.now() - start;

  const h = heuristicScore(events, text);
  const readability = await judgeReadability(question, text);
  const costUsd = estimateCost(model, text, systemPrompt.length, events);
  const cost = costScore(costUsd);

  const overall = Math.round(
    (h.retrieval * 0.2 + h.toolUsage * 0.15 + h.citations * 0.2 + h.length * 0.1 + readability * 0.2 + cost * 0.15) * 10
  ) / 10;

  return {
    model, question, toolEvents: events, responseText: text,
    stepCount: steps, totalDurationMs: durationMs, costUsd,
    scores: { retrieval: h.retrieval, toolUsage: h.toolUsage, citations: h.citations, length: h.length, readability, cost, overall },
    issues: h.issues,
  };
}

// --- Run all questions for one model ---
async function runModel(model: string, questions: string[]): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  for (const q of questions) {
    try {
      results.push(await runOne(q, model));
    } catch (err) {
      console.error(`  [${model}] ❌ "${q.slice(0, 40)}": ${(err as Error).message}`);
    }
  }
  return results;
}

// --- Test questions ---
const TEST_QUESTIONS = [
  "What is Diana's treatment plan?",
  "What clinical trials should Diana consider?",
  "Explain the prognosis for stage III TNBC",
  "What is ctDNA monitoring and why does it matter?",
  "What mRNA vaccines are being studied for TNBC?",
  "Who is on Diana's medical team?",
  "What side effects should Diana expect from KEYNOTE-522?",
  "What happens if Diana doesn't achieve pCR?",
];

const DEFAULT_MODELS = [
  "openai/gpt-5.4-mini",
  "google/gemini-2.5-flash",
  "openai/gpt-4.1-mini",
  // "anthropic/claude-sonnet-4",     // add back when credits available
  // "anthropic/claude-sonnet-4.6",
];

// --- Main ---
async function main() {
  // Parse args
  let models = DEFAULT_MODELS;
  let questions = TEST_QUESTIONS;

  const args = process.argv.slice(2);
  const qIdx = args.indexOf("--question");
  if (qIdx >= 0 && args[qIdx + 1]) {
    questions = [args[qIdx + 1]];
    args.splice(qIdx, 2);
  }
  if (args.length > 0) {
    // Filter models by prefix match
    const filter = args[0].toLowerCase();
    const matched = DEFAULT_MODELS.filter((m) => m.toLowerCase().includes(filter));
    if (matched.length > 0) models = matched;
    else models = [args[0]]; // treat as exact model ID
  }

  // Pre-cache system prompt
  await getSystemPrompt();

  console.log(`\n📊 Chat Agent Eval — ${models.length} models × ${questions.length} questions\n${"=".repeat(70)}\n`);

  // Run all models in parallel
  const allResults = await Promise.all(
    models.map(async (model) => {
      const startTime = Date.now();
      process.stdout.write(`  ⏳ ${model}...\n`);
      const results = await runModel(model, questions);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      process.stdout.write(`  ✓  ${model} done (${elapsed}s)\n`);
      return { model, results };
    })
  );

  // --- Print leaderboard ---
  console.log(`\n${"=".repeat(70)}\n📊 LEADERBOARD\n`);

  const avg = (arr: number[]) => arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : 0;

  type ModelSummary = {
    model: string;
    overall: number;
    retrieval: number;
    toolUsage: number;
    citations: number;
    readability: number;
    length: number;
    cost: number;
    avgDuration: number;
    avgCostUsd: number;
    issues: string[];
    questionCount: number;
  };

  const summaries: ModelSummary[] = allResults.map(({ model, results }) => {
    const allIssues: Record<string, number> = {};
    for (const r of results) for (const issue of r.issues) {
      const key = issue.replace(/"[^"]*"/g, '"..."');
      allIssues[key] = (allIssues[key] || 0) + 1;
    }
    return {
      model,
      overall:     avg(results.map((r) => r.scores.overall)),
      retrieval:   avg(results.map((r) => r.scores.retrieval)),
      toolUsage:   avg(results.map((r) => r.scores.toolUsage)),
      citations:   avg(results.map((r) => r.scores.citations)),
      readability: avg(results.map((r) => r.scores.readability)),
      length:      avg(results.map((r) => r.scores.length)),
      cost:        avg(results.map((r) => r.scores.cost)),
      avgDuration: avg(results.map((r) => r.totalDurationMs / 1000)),
      avgCostUsd:  avg(results.map((r) => r.costUsd)),
      issues: Object.entries(allIssues).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v}x ${k}`),
      questionCount: results.length,
    };
  }).sort((a, b) => b.overall - a.overall);

  // Table header
  const pad = (s: string, n: number) => s.padEnd(n);
  const rpad = (s: string, n: number) => s.padStart(n);
  console.log(
    `  ${pad("Model", 32)} ${rpad("Score", 5)} ${rpad("Retr", 5)} ${rpad("Tools", 5)} ${rpad("Cite", 5)} ${rpad("Read", 5)} ${rpad("Cost$", 5)} ${rpad("Speed", 7)} ${rpad("$/qry", 8)}`
  );
  console.log(`  ${"─".repeat(82)}`);

  for (const s of summaries) {
    const costStr = s.questionCount > 0 ? `$${s.avgCostUsd.toFixed(4)}` : "—";
    console.log(
      `  ${pad(s.model, 32)} ${rpad(String(s.overall), 5)} ${rpad(String(s.retrieval), 5)} ${rpad(String(s.toolUsage), 5)} ${rpad(String(s.citations), 5)} ${rpad(String(s.readability), 5)} ${rpad(String(s.cost), 5)} ${rpad(s.avgDuration.toFixed(1) + "s", 7)} ${rpad(costStr, 8)}`
    );
  }

  // Issues per model
  console.log();
  for (const s of summaries) {
    if (s.issues.length > 0) {
      console.log(`  ${s.model}: ${s.issues.join(", ")}`);
    }
  }

  // Per-question breakdown for top model
  if (summaries.length > 0 && questions.length > 1) {
    const top = summaries[0];
    const topResults = allResults.find((r) => r.model === top.model)!.results;
    console.log(`\n${"=".repeat(70)}\n📋 Per-question detail: ${top.model}\n`);
    for (const r of topResults) {
      const searches = r.toolEvents.filter((e) => e.tool === "search_wiki");
      const reads = r.toolEvents.filter((e) => e.tool === "read_page");
      const links = (r.responseText.match(/\[.+?\]\(\/.+?\)/g) || []).length;
      const words = r.responseText.split(/\s+/).length;
      console.log(`  ❓ ${r.question}`);
      console.log(`     ${(r.totalDurationMs / 1000).toFixed(1)}s | ${searches.length} searches | ${reads.length} reads | ${links} links | ${words} words | readability=${r.scores.readability} | $${r.costUsd.toFixed(4)}`);
      if (r.issues.length) console.log(`     ⚠️  ${r.issues.join("; ")}`);
    }
  }

  console.log();
}

main().catch((err) => {
  console.error("Eval failed:", err);
  process.exit(1);
});
