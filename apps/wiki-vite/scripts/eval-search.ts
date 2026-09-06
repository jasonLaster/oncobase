/**
 * Evaluate search strategies across different query types.
 * Compares: text search (BM25), vector search (semantic), and combined.
 *
 * Usage: npx tsx scripts/eval-search.ts
 */
import path from "path";
import dotenv from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import OpenAI from "openai";
import { api } from "../convex/_generated/api";

dotenv.config({ path: path.join(__dirname, "..", ".env.local") });
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL!;
const client = new ConvexHttpClient(CONVEX_URL);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Stop words (same as chat route) ──────────────────────────────────────────

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "in", "on", "at", "to",
  "for", "of", "with", "and", "or", "but", "not", "from", "by", "about",
  "what", "how", "does", "do", "can", "will", "should", "would", "could",
  "her", "his", "my", "our", "their", "this", "that", "these", "those",
  "it", "they", "we", "you", "i", "me", "she", "he",
  "before", "after", "during", "between", "through", "into", "like",
  "diana", "diana's", "tnbc", "breast", "cancer", "tumor", "treatment",
  "diagnosis", "patient", "doctor", "medical", "clinical", "results",
  "test", "tests", "ucsf", "stanford",
]);

const EXPANSIONS: Record<string, string[]> = {
  tnbc: ["triple-negative breast cancer"],
  pcr: ["pathologic complete response"],
  ctdna: ["circulating tumor DNA", "ctDNA"],
  mrd: ["minimal residual disease"],
  rcb: ["residual cancer burden"],
  hrd: ["homologous recombination deficiency"],
  stils: ["stromal tumor-infiltrating lymphocytes", "sTILs"],
  tmb: ["tumor mutational burden"],
  "keynote-522": ["pembrolizumab chemotherapy neoadjuvant"],
  pembro: ["pembrolizumab"],
  brca: ["BRCA1 BRCA2 germline mutation"],
  her2: ["HER2 erbb2"],
};

// ── Eval queries with expected relevant slugs ────────────────────────────────

interface EvalQuery {
  query: string;
  description: string;
  expectedSlugs: string[]; // partial matches OK
}

const EVAL_QUERIES: EvalQuery[] = [
  {
    query: "peptide vaccines for TNBC",
    description: "Specific treatment research topic",
    expectedSlugs: ["vaccine", "cancer-vaccine", "mRNA"],
  },
  {
    query: "What is the prognosis?",
    description: "Patient-specific question",
    expectedSlugs: ["prognosis"],
  },
  {
    query: "ctDNA monitoring after chemo",
    description: "Abbreviation + clinical concept",
    expectedSlugs: ["ctdna", "mrd"],
  },
  {
    query: "KEYNOTE-522 protocol side effects",
    description: "Named trial + treatment details",
    expectedSlugs: ["treatment-plan", "keynote", "medications"],
  },
  {
    query: "BRCA mutation and egg retrieval timing",
    description: "Cross-domain: genetics + fertility",
    expectedSlugs: ["brca", "fertility", "conception", "egg"],
  },
  {
    query: "scalp cooling cold caps",
    description: "Specific supportive care topic",
    expectedSlugs: ["scalp-cooling", "cold-cap"],
  },
  {
    query: "what biomarkers predict response",
    description: "Broad research question",
    expectedSlugs: ["biomarker", "predictive", "pcr", "stils"],
  },
  {
    query: "tumor infiltrating lymphocytes significance",
    description: "Expanded medical term",
    expectedSlugs: ["stils", "lymphocyte", "biomarker", "predictive"],
  },
  {
    query: "carboplatin paclitaxel dosing schedule",
    description: "Drug-specific question",
    expectedSlugs: ["treatment-plan", "medications", "chemo"],
  },
  {
    query: "SOX10 immunohistochemistry",
    description: "Niche diagnostic marker",
    expectedSlugs: ["sox10"],
  },
  {
    query: "day 4 biopsy tissue quality",
    description: "Specific procedure timing",
    expectedSlugs: ["day4-biopsy", "tissue"],
  },
  {
    query: "hyperbaric oxygen therapy cancer",
    description: "Alternative/adjunct therapy",
    expectedSlugs: ["hyperbaric", "hbo2t", "metabolic", "seyfried"],
  },
];

// ── Search strategies ────────────────────────────────────────────────────────

async function embed(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text.slice(0, 20000),
  });
  return res.data[0].embedding;
}

function generatePatterns(query: string): string[] {
  const patterns = new Set<string>();
  const clean = query.trim();
  if (!clean) return [];

  const sig = clean.split(/\s+/).filter((w) => w.length >= 2 && !STOP_WORDS.has(w.toLowerCase()));
  const cleaned = sig.join(" ");
  if (cleaned) patterns.add(cleaned);

  const lower = clean.toLowerCase();
  for (const [abbrev, alts] of Object.entries(EXPANSIONS)) {
    if (patterns.size >= 5) break;
    if (lower.includes(abbrev)) {
      for (const alt of alts) {
        if (patterns.size >= 5) break;
        patterns.add(alt);
      }
    }
  }

  if (sig.length >= 3) {
    const byLength = [...sig].sort((a, b) => b.length - a.length);
    for (const w of byLength.slice(0, 2)) {
      if (patterns.size >= 5) break;
      patterns.add(w);
    }
  }

  return Array.from(patterns).slice(0, 5);
}

type SearchResult = { slug: string; title: string };

async function textSearchSingle(query: string, limit = 10): Promise<SearchResult[]> {
  const results = await client.query(api.documents.search, { query, limit });
  return results.map((r) => ({ slug: r.slug, title: r.title }));
}

async function textSearchFanout(query: string, limit = 12): Promise<SearchResult[]> {
  const patterns = generatePatterns(query);
  const allResults = await Promise.all(
    patterns.map((p) => client.query(api.documents.search, { query: p, limit: 6 }))
  );
  const seen = new Set<string>();
  const merged: SearchResult[] = [];
  for (const results of allResults) {
    for (const r of results) {
      if (!seen.has(r.slug)) {
        seen.add(r.slug);
        merged.push({ slug: r.slug, title: r.title });
      }
    }
  }
  return merged.slice(0, limit);
}

async function vectorSearchOnly(query: string, limit = 10): Promise<SearchResult[]> {
  const embedding = await embed(query);
  const results = await client.action(api.documents.vectorSearch, { embedding, limit });
  return results.map((r) => ({ slug: r.slug, title: r.title }));
}

async function combinedSearch(query: string, limit = 12): Promise<SearchResult[]> {
  const [textResults, vecResults] = await Promise.all([
    textSearchFanout(query, 10),
    vectorSearchOnly(query, 6),
  ]);
  const seen = new Set<string>();
  const merged: SearchResult[] = [];
  for (const r of textResults) {
    if (!seen.has(r.slug)) { seen.add(r.slug); merged.push(r); }
  }
  for (const r of vecResults) {
    if (!seen.has(r.slug)) { seen.add(r.slug); merged.push(r); }
  }
  return merged.slice(0, limit);
}

// ── Scoring ──────────────────────────────────────────────────────────────────

function scoreResults(results: SearchResult[], expected: string[]): { hits: number; total: number; matchedSlugs: string[] } {
  const matchedSlugs: string[] = [];
  for (const exp of expected) {
    const found = results.find((r) =>
      r.slug.toLowerCase().includes(exp.toLowerCase()) ||
      r.title.toLowerCase().includes(exp.toLowerCase())
    );
    if (found) matchedSlugs.push(found.slug);
  }
  return { hits: matchedSlugs.length, total: expected.length, matchedSlugs };
}

// ── Main ─────────────────────────────────────────────────────────────────────

interface StrategyResult {
  name: string;
  totalHits: number;
  totalExpected: number;
  queryResults: Array<{
    query: string;
    hits: number;
    total: number;
    resultCount: number;
    matchedSlugs: string[];
    topResults: string[];
  }>;
}

async function evalStrategy(
  name: string,
  searchFn: (query: string) => Promise<SearchResult[]>
): Promise<StrategyResult> {
  const result: StrategyResult = { name, totalHits: 0, totalExpected: 0, queryResults: [] };

  for (const eq of EVAL_QUERIES) {
    const results = await searchFn(eq.query);
    const score = scoreResults(results, eq.expectedSlugs);
    result.totalHits += score.hits;
    result.totalExpected += score.total;
    result.queryResults.push({
      query: eq.query,
      hits: score.hits,
      total: score.total,
      resultCount: results.length,
      matchedSlugs: score.matchedSlugs,
      topResults: results.slice(0, 5).map((r) => r.slug),
    });
  }

  return result;
}

async function main() {
  console.log("=== Search Strategy Evaluation ===\n");
  console.log(`Running ${EVAL_QUERIES.length} eval queries across 4 strategies...\n`);

  const strategies: Array<{ name: string; fn: (q: string) => Promise<SearchResult[]> }> = [
    { name: "1. Text (single query)", fn: (q) => textSearchSingle(q, 10) },
    { name: "2. Text (fan-out)", fn: (q) => textSearchFanout(q, 12) },
    { name: "3. Vector only", fn: (q) => vectorSearchOnly(q, 10) },
    { name: "4. Combined (text fan-out + vector)", fn: (q) => combinedSearch(q, 12) },
  ];

  const allResults: StrategyResult[] = [];

  for (const strategy of strategies) {
    process.stdout.write(`Evaluating: ${strategy.name}...`);
    const result = await evalStrategy(strategy.name, strategy.fn);
    allResults.push(result);
    console.log(` ${result.totalHits}/${result.totalExpected} hits`);
  }

  // ── Detailed results ───────────────────────────────────────────────────────

  console.log("\n" + "=".repeat(80));
  console.log("DETAILED RESULTS");
  console.log("=".repeat(80));

  for (const eq of EVAL_QUERIES) {
    console.log(`\n▸ "${eq.query}" (${eq.description})`);
    console.log(`  Expected: ${eq.expectedSlugs.join(", ")}`);

    for (const strat of allResults) {
      const qr = strat.queryResults.find((r) => r.query === eq.query)!;
      const status = qr.hits === qr.total ? "✓" : qr.hits > 0 ? "◐" : "✗";
      console.log(`  ${status} ${strat.name}: ${qr.hits}/${qr.total} hits (${qr.resultCount} results)`);
      if (qr.matchedSlugs.length > 0) {
        console.log(`    Matched: ${qr.matchedSlugs.join(", ")}`);
      }
      console.log(`    Top 5: ${qr.topResults.join(", ")}`);
    }
  }

  // ── Summary table ──────────────────────────────────────────────────────────

  console.log("\n" + "=".repeat(80));
  console.log("SUMMARY");
  console.log("=".repeat(80));
  console.log("");
  console.log("Strategy".padEnd(40) + "Hits".padStart(6) + "Total".padStart(8) + "Rate".padStart(8));
  console.log("-".repeat(62));

  for (const strat of allResults) {
    const rate = ((strat.totalHits / strat.totalExpected) * 100).toFixed(1) + "%";
    console.log(
      strat.name.padEnd(40) +
      String(strat.totalHits).padStart(6) +
      String(strat.totalExpected).padStart(8) +
      rate.padStart(8)
    );
  }

  // ── Per-query winners ──────────────────────────────────────────────────────

  console.log("\n" + "=".repeat(80));
  console.log("PER-QUERY ANALYSIS: Where vector search helps");
  console.log("=".repeat(80));

  let vectorOnlyWins = 0;
  let textOnlyWins = 0;
  let bothEqual = 0;

  for (const eq of EVAL_QUERIES) {
    const textFanout = allResults[1].queryResults.find((r) => r.query === eq.query)!;
    const vectorOnly = allResults[2].queryResults.find((r) => r.query === eq.query)!;
    const combined = allResults[3].queryResults.find((r) => r.query === eq.query)!;

    if (combined.hits > textFanout.hits) {
      vectorOnlyWins++;
      console.log(`  ✚ "${eq.query}" — vector added ${combined.hits - textFanout.hits} hit(s)`);
    } else if (textFanout.hits > vectorOnly.hits) {
      textOnlyWins++;
    } else {
      bothEqual++;
    }
  }

  console.log(`\n  Vector added value: ${vectorOnlyWins}/${EVAL_QUERIES.length} queries`);
  console.log(`  Text was sufficient: ${textOnlyWins}/${EVAL_QUERIES.length} queries`);
  console.log(`  Both equal: ${bothEqual}/${EVAL_QUERIES.length} queries`);
  console.log("");
}

main().catch((err) => {
  console.error("Eval failed:", err);
  process.exit(1);
});
