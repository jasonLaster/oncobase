/**
 * Evaluate AI search mode with question-oriented queries.
 * Tests the full pipeline: embedding → vector search → GPT scoring → results.
 * Verifies that natural language questions return relevant, ranked results.
 *
 * Usage: bun --env-file=.env.local --env-file=.env scripts/eval-ai-search.ts
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { embed } from "../src/lib/embeddings";
import { generateObject } from "ai";
import { z } from "zod";

// Load env: run with `bun --env-file=.env.local --env-file=.env scripts/eval-ai-search.ts`
// or set OPENAI_API_KEY, AI_GATEWAY_API_KEY, NEXT_PUBLIC_CONVEX_URL in your shell

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL!;
const convex = new ConvexHttpClient(CONVEX_URL);

const scoreSchema = z.object({
  relevance: z.number().min(0).max(10),
  summary: z.string(),
});

// ── Question-oriented eval queries ──────────────────────────────────────────

interface EvalQuery {
  query: string;
  description: string;
  /** Partial slug/title substrings that should appear in results */
  expectedHits: string[];
  /** Minimum number of results expected */
  minResults: number;
}

const EVAL_QUERIES: EvalQuery[] = [
  // Natural language questions (no exact keyword matches)
  {
    query: "what are the various ways we can test drugs",
    description: "Broad question with no direct keyword match",
    expectedHits: ["drug", "treatment", "chemo"],
    minResults: 1,
  },
  {
    query: "how do doctors know if the cancer is responding to treatment",
    description: "Patient-oriented question about response monitoring",
    expectedHits: ["response", "pcr", "mri", "imaging", "biomarker"],
    minResults: 2,
  },
  {
    query: "what happens after chemotherapy is done",
    description: "Question about post-treatment planning",
    expectedHits: ["surgery", "adjuvant", "treatment-plan", "mastectomy"],
    minResults: 2,
  },
  {
    query: "why is triple negative breast cancer harder to treat",
    description: "Conceptual question about TNBC biology",
    expectedHits: ["tnbc", "triple", "diagnosis", "subtype"],
    minResults: 2,
  },
  {
    query: "can you preserve fertility during cancer treatment",
    description: "Cross-domain: fertility + oncology",
    expectedHits: ["fertility", "egg", "conception", "pregnancy"],
    minResults: 1,
  },
  {
    query: "what blood tests show if cancer is still there",
    description: "Patient question about liquid biopsy / ctDNA",
    expectedHits: ["ctdna", "blood", "mrd", "circulating", "biomarker"],
    minResults: 1,
  },
  {
    query: "is immunotherapy effective for stage 3 breast cancer",
    description: "Treatment efficacy question",
    expectedHits: ["immunotherapy", "pembrolizumab", "keynote", "treatment"],
    minResults: 2,
  },
  {
    query: "what are the side effects of carboplatin",
    description: "Drug-specific side effects",
    expectedHits: ["carboplatin", "medication", "side-effect", "treatment-plan"],
    minResults: 1,
  },
  {
    query: "how do organoids help with cancer research",
    description: "Research methodology question",
    expectedHits: ["organoid", "model", "drug", "sensitivity"],
    minResults: 1,
  },
  {
    query: "what is the difference between lumpectomy and mastectomy",
    description: "Surgical options comparison",
    expectedHits: ["lumpectomy", "mastectomy", "surgery"],
    minResults: 1,
  },
  // Keyword queries that should still work
  {
    query: "KEYNOTE-522 schedule",
    description: "Direct keyword query (regression check)",
    expectedHits: ["treatment-plan", "keynote"],
    minResults: 2,
  },
  {
    query: "diagnosis staging",
    description: "Short keyword query (regression check)",
    expectedHits: ["diagnosis", "staging"],
    minResults: 2,
  },
];

// ── Pipeline stages ─────────────────────────────────────────────────────────

interface StageResult {
  vectorResults: Array<{ slug: string; title: string; score: number }>;
  textSlugs: string[];
  mergedSlugs: string[];
  scoredDocs: Array<{ slug: string; title: string; relevance: number; summary: string }>;
  finalResults: Array<{ slug: string; title: string; relevance: number; summary: string }>;
  error?: string;
}

async function runPipeline(query: string, textSlugs: string[] = []): Promise<StageResult> {
  const result: StageResult = {
    vectorResults: [],
    textSlugs,
    mergedSlugs: [],
    scoredDocs: [],
    finalResults: [],
  };

  try {
    // Stage 1: Embed and vector search
    const queryEmbedding = await embed(query);
    const vectorResults = await convex.action(api.documents.vectorSearch, {
      embedding: queryEmbedding,
      limit: 12,
    });
    result.vectorResults = vectorResults;

    // Stage 2: Merge slugs
    const mergedSlugs = new Set(textSlugs.slice(0, 12));
    for (const vr of vectorResults) {
      mergedSlugs.add(vr.slug);
    }
    result.mergedSlugs = Array.from(mergedSlugs);

    if (result.mergedSlugs.length === 0) {
      return result;
    }

    // Stage 3: Fetch doc content
    const [diagnosisDoc, ...docs] = await Promise.all([
      convex.query(api.documents.getBySlug, { slug: "wiki/diagnostics/diagnosis" }),
      ...result.mergedSlugs.slice(0, 16).map((slug) =>
        convex.query(api.documents.getBySlug, { slug })
      ),
    ]);

    const diagnosisContext = diagnosisDoc
      ? `Patient: Diana Laster, Age 36, Diagnosed March 2026\n${diagnosisDoc.content.slice(0, 1500)}`
      : "Patient: Diana Laster, Age 36, Stage III TNBC, IDC Grade 3, KEYNOTE-522 protocol";

    const docsWithContent = docs.filter((d): d is NonNullable<typeof d> => d !== null);

    // Stage 4: Score with GPT (batches of 4)
    const BATCH_SIZE = 4;
    for (let i = 0; i < docsWithContent.length; i += BATCH_SIZE) {
      const batch = docsWithContent.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (doc) => {
          try {
            const { object } = await generateObject({
              model: "openai/gpt-5.4-mini",
              maxOutputTokens: 200,
              schema: scoreSchema,
              prompt: `You are evaluating a search result for the query: "${query}"

Diana's diagnosis context:
${diagnosisContext}

Document: "${doc.title}" (${doc.slug})
Tags: ${doc.tags.join(", ") || "none"}
Content preview:
${doc.content.slice(0, 800)}

Score this document's relevance to the query (0-10). A score of 5+ means it directly addresses the query topic. A score of 3-4 means it's tangentially related. Write a 1-2 sentence summary explaining the relevance.`,
            });
            return {
              slug: doc.slug,
              title: doc.title,
              relevance: object.relevance,
              summary: object.summary,
            };
          } catch (e) {
            const msg = (e as Error).message ?? "";
            console.error(`  ✗ Scoring failed for ${doc.slug}: ${msg.slice(0, 100)}`);
            return null;
          }
        })
      );
      result.scoredDocs.push(
        ...batchResults.filter((r): r is NonNullable<typeof r> => r !== null)
      );
    }

    // Stage 5: Filter and sort
    result.finalResults = result.scoredDocs
      .filter((r) => r.relevance >= 2)
      .sort((a, b) => b.relevance - a.relevance);

  } catch (e) {
    result.error = (e as Error).message;
  }

  return result;
}

// ── Scoring ─────────────────────────────────────────────────────────────────

function checkHits(
  results: Array<{ slug: string; title: string }>,
  expectedHits: string[]
): { found: string[]; missed: string[] } {
  const found: string[] = [];
  const missed: string[] = [];
  for (const exp of expectedHits) {
    const match = results.find(
      (r) =>
        r.slug.toLowerCase().includes(exp.toLowerCase()) ||
        r.title.toLowerCase().includes(exp.toLowerCase())
    );
    if (match) found.push(exp);
    else missed.push(exp);
  }
  return { found, missed };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== AI Search Eval: Question-Oriented Queries ===\n");
  console.log(`Running ${EVAL_QUERIES.length} queries through the full AI search pipeline.\n`);

  let totalPassed = 0;
  let totalFailed = 0;
  const queryTimings: Array<{ query: string; ms: number }> = [];

  for (let i = 0; i < EVAL_QUERIES.length; i++) {
    const eq = EVAL_QUERIES[i];
    process.stdout.write(`[${i + 1}/${EVAL_QUERIES.length}] "${eq.query}" `);

    const start = Date.now();
    const result = await runPipeline(eq.query);
    const elapsed = Date.now() - start;
    queryTimings.push({ query: eq.query, ms: elapsed });

    if (result.error) {
      console.log(`\n  ✗ ERROR: ${result.error}`);
      totalFailed++;
      continue;
    }

    const { found, missed } = checkHits(result.finalResults, eq.expectedHits);
    const hasMinResults = result.finalResults.length >= eq.minResults;
    const passed = found.length > 0 && hasMinResults;

    if (passed) {
      totalPassed++;
      console.log(`✓ (${elapsed}ms)`);
    } else {
      totalFailed++;
      console.log(`✗ (${elapsed}ms)`);
    }

    // Details
    console.log(`  ${eq.description}`);
    console.log(`  Vector candidates: ${result.vectorResults.length} | Merged: ${result.mergedSlugs.length} | Scored: ${result.scoredDocs.length} | Final: ${result.finalResults.length}`);

    if (result.finalResults.length > 0) {
      console.log(`  Results:`);
      for (const r of result.finalResults.slice(0, 5)) {
        const shortSlug = r.slug.split("/").slice(-2).join("/");
        console.log(`    ${r.relevance}/10 | ${shortSlug} — ${r.summary.slice(0, 80)}`);
      }
    } else {
      console.log(`  No results passed threshold (scored ${result.scoredDocs.length} docs)`);
      if (result.scoredDocs.length > 0) {
        console.log(`  Top scores: ${result.scoredDocs.sort((a, b) => b.relevance - a.relevance).slice(0, 3).map(r => `${r.slug.split("/").pop()} (${r.relevance})`).join(", ")}`);
      }
    }

    if (found.length > 0) console.log(`  Hits: ${found.join(", ")}`);
    if (missed.length > 0) console.log(`  Missed: ${missed.join(", ")}`);
    console.log("");
  }

  // ── Summary ─────────────────────────────────────────────────────────────────

  console.log("=".repeat(70));
  console.log("SUMMARY");
  console.log("=".repeat(70));
  console.log(`  Passed: ${totalPassed}/${EVAL_QUERIES.length}`);
  console.log(`  Failed: ${totalFailed}/${EVAL_QUERIES.length}`);
  console.log(`  Pass rate: ${((totalPassed / EVAL_QUERIES.length) * 100).toFixed(0)}%`);

  const avgMs = queryTimings.reduce((s, t) => s + t.ms, 0) / queryTimings.length;
  const maxMs = Math.max(...queryTimings.map((t) => t.ms));
  console.log(`  Avg latency: ${avgMs.toFixed(0)}ms`);
  console.log(`  Max latency: ${maxMs}ms`);

  // Slowest queries
  const sorted = [...queryTimings].sort((a, b) => b.ms - a.ms);
  console.log(`\n  Slowest queries:`);
  for (const t of sorted.slice(0, 3)) {
    console.log(`    ${t.ms}ms — "${t.query}"`);
  }

  console.log("");
  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Eval failed:", err);
  process.exit(1);
});
