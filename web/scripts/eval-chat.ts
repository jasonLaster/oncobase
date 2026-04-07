/**
 * Evaluate chat agent quality by sending test questions and analyzing tool usage.
 *
 * Usage: npx tsx scripts/eval-chat.ts
 */
import {
  streamText,
  stepCountIs,
  type CoreMessage,
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

const SYSTEM_PROMPT = `You are a research assistant for Diana's TNBC (triple-negative breast cancer) knowledge base. You help answer questions about Diana's diagnosis, treatment plan, research, and related medical topics.

You have access to tools that let you search and read wiki pages. Use them to find relevant information before answering. Always ground your answers in the wiki content when possible.

IMPORTANT CITATION RULES:
- ALWAYS cite sources using inline markdown links: [Page Title](/slug)
- Every factual claim should have a citation. Aim for 5+ citations per response.
- Example: "Diana is on [KEYNOTE-522](/wiki/treatment/treatment-plan) which includes..."
- Cite specific source pages when referencing research: [Sahin 2026](/sources/research-articles/sahin-2026-tnbc-mrna-vaccine)
- Do NOT list sources at the end — weave them inline throughout your response.

Search strategy:
- Use short, focused queries with 1-3 key terms (e.g. "prognosis", "mRNA vaccine", "clinical trials")
- Run 2-3 searches with different terms to get broad coverage
- NEVER use more than 4 words in a search query
- If a search returns 0 results, try simpler/different keywords
- After searching, read the 2-3 most relevant pages before answering
- Do NOT use list_pages — always use search_wiki instead

Key context:
- Patient: Diana Laster, age 36, diagnosed March 2026
- Diagnosis: Stage III TNBC, invasive ductal carcinoma, Grade 3
- Protocol: KEYNOTE-522 (Carboplatin + Paclitaxel + Pembrolizumab → AC)
- Care center: UCSF

Be direct, compassionate, and precise. Use medical terminology but explain it when needed.`;

// --- Tool definitions (same as route.ts but with logging) ---
interface ToolEvent {
  tool: string;
  input: Record<string, unknown>;
  output: unknown;
  durationMs: number;
  resultCount?: number;
}

function createTools(events: ToolEvent[]) {
  return {
    search_wiki: {
      description:
        "Search across all wiki pages and source documents. Use short, focused queries with 1-3 key terms (e.g. 'clinical trials', 'prognosis', 'mRNA vaccine'). Run multiple searches with different terms rather than one long query. Searches both titles and content.",
      inputSchema: z.object({
        query: z.string().describe("Short search query, 1-3 key terms"),
      }),
      execute: async ({ query }: { query: string }) => {
        const start = Date.now();
        const results = await convex.query(api.documents.search, { query, limit: 8 });
        events.push({
          tool: "search_wiki",
          input: { query },
          output: results.map((r: { slug: string; title: string }) => ({ slug: r.slug, title: r.title })),
          durationMs: Date.now() - start,
          resultCount: results.length,
        });
        return results;
      },
    },
    read_page: {
      description: "Read the full content of a specific wiki page by its slug.",
      inputSchema: z.object({
        slug: z.string().describe('The page slug, e.g. "wiki/treatment/treatment-plan"'),
      }),
      execute: async ({ slug }: { slug: string }) => {
        const start = Date.now();
        const doc = await convex.query(api.documents.getBySlug, { slug });
        const result = doc
          ? { slug: doc.slug, title: doc.title, tags: doc.tags, content: doc.content.slice(0, 8000) }
          : { error: `Page not found: ${slug}` };
        events.push({
          tool: "read_page",
          input: { slug },
          output: doc ? { slug: doc.slug, title: doc.title } : { error: "not found" },
          durationMs: Date.now() - start,
        });
        return result;
      },
    },
    list_pages: {
      description: "List all available wiki pages to discover what content exists.",
      inputSchema: z.object({}),
      execute: async () => {
        const start = Date.now();
        const results = await convex.query(api.documents.list, {});
        events.push({
          tool: "list_pages",
          input: {},
          output: `${results.length} pages`,
          durationMs: Date.now() - start,
          resultCount: results.length,
        });
        return results;
      },
    },
    get_pages_by_tag: {
      description: "Find all pages that have a specific tag.",
      inputSchema: z.object({ tag: z.string() }),
      execute: async ({ tag }: { tag: string }) => {
        const start = Date.now();
        const results = await convex.query(api.documents.getByTag, { tag });
        events.push({
          tool: "get_pages_by_tag",
          input: { tag },
          output: results,
          durationMs: Date.now() - start,
          resultCount: results.length,
        });
        return results;
      },
    },
    list_tags: {
      description: "List all tags used across the wiki.",
      inputSchema: z.object({}),
      execute: async () => {
        const start = Date.now();
        const results = await convex.query(api.documents.listTags, {});
        events.push({
          tool: "list_tags",
          input: {},
          output: `${results.length} tags`,
          durationMs: Date.now() - start,
          resultCount: results.length,
        });
        return results;
      },
    },
  };
}

// --- Heuristic scoring ---
interface EvalResult {
  question: string;
  toolEvents: ToolEvent[];
  responseText: string;
  stepCount: number;
  totalDurationMs: number;
  scores: {
    searchQuality: number;      // 0-10: did searches find relevant results?
    toolUsage: number;          // 0-10: appropriate number and type of tool calls?
    citationQuality: number;    // 0-10: does response cite sources with links?
    responseLength: number;     // 0-10: appropriate length (not too short/long)?
    overall: number;            // weighted average
  };
  issues: string[];
}

function scoreResult(question: string, events: ToolEvent[], text: string, steps: number, durationMs: number): EvalResult {
  const issues: string[] = [];

  // Search quality
  const searches = events.filter((e) => e.tool === "search_wiki");
  const emptySearches = searches.filter((e) => e.resultCount === 0);
  const emptyQuerySearches = searches.filter((e) => !(e.input.query as string));
  let searchQuality = 10;
  if (searches.length === 0) { searchQuality = 2; issues.push("No searches performed"); }
  if (emptySearches.length > 0) {
    searchQuality -= emptySearches.length * 2;
    issues.push(`${emptySearches.length}/${searches.length} searches returned 0 results`);
  }
  if (emptyQuerySearches.length > 0) {
    searchQuality -= emptyQuerySearches.length * 3;
    issues.push(`${emptyQuerySearches.length} searches with empty query`);
  }
  // Long query penalty
  for (const s of searches) {
    const q = s.input.query as string;
    if (q && q.split(/\s+/).length > 5) {
      searchQuality -= 1;
      issues.push(`Long search query: "${q}"`);
    }
  }
  searchQuality = Math.max(0, Math.min(10, searchQuality));

  // Tool usage
  const reads = events.filter((e) => e.tool === "read_page");
  const listPages = events.filter((e) => e.tool === "list_pages");
  let toolUsage = 7;
  if (reads.length === 0 && searches.length > 0) {
    toolUsage -= 3;
    issues.push("Searched but never read any pages");
  }
  if (reads.length > 0) toolUsage += 2;
  if (listPages.length > 0) {
    toolUsage -= 1;
    issues.push("Used list_pages (expensive, prefer search)");
  }
  if (events.length > 15) {
    toolUsage -= 2;
    issues.push(`Excessive tool calls: ${events.length}`);
  }
  toolUsage = Math.max(0, Math.min(10, toolUsage));

  // Citation quality
  const linkCount = (text.match(/\[.+?\]\(\/.+?\)/g) || []).length;
  let citationQuality = Math.min(10, linkCount * 2);
  if (linkCount === 0) {
    issues.push("No inline citations/links in response");
    citationQuality = 0;
  }

  // Response length
  const wordCount = text.split(/\s+/).length;
  let responseLength = 7;
  if (wordCount < 50) { responseLength = 3; issues.push(`Very short response: ${wordCount} words`); }
  else if (wordCount < 100) { responseLength = 5; }
  else if (wordCount > 800) { responseLength = 5; issues.push(`Very long response: ${wordCount} words`); }
  else if (wordCount >= 150 && wordCount <= 500) { responseLength = 10; }

  const overall = Math.round(
    (searchQuality * 0.3 + toolUsage * 0.25 + citationQuality * 0.25 + responseLength * 0.2) * 10
  ) / 10;

  return {
    question,
    toolEvents: events,
    responseText: text,
    stepCount: steps,
    totalDurationMs: durationMs,
    scores: { searchQuality, toolUsage, citationQuality, responseLength, overall },
    issues,
  };
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

// --- Run eval ---
async function runOne(question: string, model: string): Promise<EvalResult> {
  const events: ToolEvent[] = [];
  const tools = createTools(events);
  const start = Date.now();

  const messages: CoreMessage[] = [{ role: "user", content: question }];

  const result = await streamText({
    model: openrouter.chat(model),
    system: SYSTEM_PROMPT,
    messages,
    stopWhen: stepCountIs(10),
    tools,
  });

  // Consume the result
  const response = await result;
  const text = await response.text;
  const steps = (await response.steps).length;

  return scoreResult(question, events, text, steps, Date.now() - start);
}

async function main() {
  const model = process.argv[2] || "openai/gpt-4.1-mini";
  const questions = process.argv[3]
    ? [process.argv.slice(3).join(" ")]
    : TEST_QUESTIONS;

  console.log(`\n📊 Chat Agent Eval — model: ${model}\n${"=".repeat(60)}\n`);

  const results: EvalResult[] = [];

  for (const q of questions) {
    process.stdout.write(`❓ ${q}\n`);
    try {
      const result = await runOne(q, model);
      results.push(result);

      // Print summary
      const { scores, toolEvents, issues } = result;
      const searches = toolEvents.filter((e) => e.tool === "search_wiki");
      const reads = toolEvents.filter((e) => e.tool === "read_page");
      const words = result.responseText.split(/\s+/).length;
      const links = (result.responseText.match(/\[.+?\]\(\/.+?\)/g) || []).length;

      console.log(`   ⏱  ${(result.totalDurationMs / 1000).toFixed(1)}s | ${result.stepCount} steps | ${toolEvents.length} tool calls`);
      console.log(`   🔍 ${searches.length} searches (${searches.filter((s) => s.resultCount === 0).length} empty) | 📄 ${reads.length} reads | 🔗 ${links} citations | 📝 ${words} words`);
      console.log(`   📈 search=${scores.searchQuality} tools=${scores.toolUsage} cite=${scores.citationQuality} len=${scores.responseLength} → overall=${scores.overall}`);

      if (issues.length > 0) {
        console.log(`   ⚠️  ${issues.join("; ")}`);
      }

      // Show search queries
      for (const s of searches) {
        const q = s.input.query as string;
        console.log(`      🔍 "${q}" → ${s.resultCount} results (${s.durationMs}ms)`);
      }
      for (const r of reads) {
        console.log(`      📄 ${r.input.slug} (${r.durationMs}ms)`);
      }
      console.log();
    } catch (err) {
      console.log(`   ❌ Error: ${(err as Error).message}\n`);
    }
  }

  // Print aggregate
  if (results.length > 1) {
    console.log(`${"=".repeat(60)}\n📊 AGGREGATE (${results.length} questions)\n`);
    const avg = (arr: number[]) => Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10;
    console.log(`   Search Quality: ${avg(results.map((r) => r.scores.searchQuality))}`);
    console.log(`   Tool Usage:     ${avg(results.map((r) => r.scores.toolUsage))}`);
    console.log(`   Citations:      ${avg(results.map((r) => r.scores.citationQuality))}`);
    console.log(`   Response Len:   ${avg(results.map((r) => r.scores.responseLength))}`);
    console.log(`   Overall:        ${avg(results.map((r) => r.scores.overall))}`);
    console.log(`   Avg Duration:   ${avg(results.map((r) => r.totalDurationMs / 1000))}s`);

    // Common issues
    const allIssues: Record<string, number> = {};
    for (const r of results) {
      for (const issue of r.issues) {
        // Generalize specific queries
        const key = issue.replace(/"[^"]*"/g, '"..."');
        allIssues[key] = (allIssues[key] || 0) + 1;
      }
    }
    if (Object.keys(allIssues).length > 0) {
      console.log(`\n   Common issues:`);
      for (const [issue, count] of Object.entries(allIssues).sort((a, b) => b[1] - a[1])) {
        console.log(`     ${count}x ${issue}`);
      }
    }
    console.log();
  }
}

main().catch((err) => {
  console.error("Eval failed:", err);
  process.exit(1);
});
