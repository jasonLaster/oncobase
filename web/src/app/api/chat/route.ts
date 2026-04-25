import {
  streamText,
  stepCountIs,
  smoothStream,
  convertToModelMessages,
  type UIMessage,
} from "ai";
import { connection } from "next/server";
import { z } from "zod";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { embed } from "@/lib/embeddings";
import { fastTextModel } from "@/lib/ai";
import { applyPiiRedactions } from "@/lib/pii-redaction";
import { createConvexFlusher } from "./_flusher";

function getConvex() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return new ConvexHttpClient(url);
}

const SYSTEM_PROMPT_BASE = `You are a research assistant for a triple-negative breast cancer (TNBC) knowledge base. You help answer questions about the patient's diagnosis, treatment plan, research, and related medical topics.

You have access to tools that let you search and read wiki pages. Use them to find relevant information before answering. Always ground your answers in the wiki content when possible.

IMPORTANT CITATION RULES:
- ALWAYS cite sources using inline markdown links: [Page Title](/slug)
- Every factual claim should have a citation. Aim for 5+ citations per response.
- Example: "The treatment plan uses [KEYNOTE-522](/wiki/treatment/treatment-plan), which includes..."
- Cite specific source pages when referencing research: [Sahin 2026](/sources/research-articles/sahin-2026-tnbc-mrna-vaccine)
- Do NOT list sources at the end — weave them inline throughout your response.

Search strategy:
- FIRST check the PAGE INDEX below — if the question maps directly to a known page (e.g. "treatment plan" → wiki/treatment/plan/index, "diagnosis" → wiki/diagnostics/diagnosis), use read_page immediately without searching
- Use search_wiki for broad discovery when you're not sure which page has the answer
- After searching, read the 2-3 most relevant pages before answering
- When you read a page, check its linked_pages list — these are pages referenced in the text. Follow links that are directly relevant to the question (e.g. a treatment page linking to a specific trial or meeting notes). Skip generic links like "diagnosis" or "prognosis" unless they're what the user asked about.
- Do NOT use list_pages — use the PAGE INDEX instead

Be direct, compassionate, and precise. Use medical terminology but explain it when needed.`;

async function buildSystemPrompt(): Promise<string> {
  const convex = getConvex();
  const [indexDoc, diagnosisDoc] = await Promise.all([
    convex.query(api.documents.getBySlug, { slug: "index" }),
    convex.query(api.documents.getBySlug, { slug: "wiki/diagnostics/diagnosis" }),
  ]);

  let prompt = SYSTEM_PROMPT_BASE;

  if (diagnosisDoc) {
    prompt += `\n\n## PATIENT DIAGNOSIS\n\n${applyPiiRedactions(diagnosisDoc.content)}`;
  }

  if (indexDoc) {
    prompt += `\n\n## PAGE INDEX\n\nUse these slugs with read_page to get full content:\n\n${applyPiiRedactions(indexDoc.content)}`;
  }

  return prompt;
}

/**
 * Generate search patterns from a query for parallel fan-out.
 *
 * Convex uses Tantivy (BM25) which already handles multi-term queries well —
 * it tokenizes, ranks by term frequency and proximity. So we don't need
 * bigram fan-out for phrase matching. The real value of fan-out is:
 *
 * 1. Cleaned query (domain stop words removed) — the primary search
 * 2. Abbreviation expansions — "ctdna" and "circulating tumor DNA" are
 *    different tokens so BM25 can't match across them
 * 3. Individual specific terms — when the cleaned query is long, a single
 *    precise term like "pembrolizumab" can surface docs the full query misses
 *
 * Example: "peptide vaccines for TNBC" →
 *   ["peptide vaccines", "triple-negative breast cancer", "vaccines", "peptide"]
 */
function generateSearchPatterns(query: string): string[] {
  const patterns = new Set<string>();
  const clean = query.trim();
  if (!clean) return [];

  const stopWords = new Set([
    // English stop words
    "a", "an", "the", "is", "are", "was", "were", "in", "on", "at", "to",
    "for", "of", "with", "and", "or", "but", "not", "from", "by", "about",
    "what", "how", "does", "do", "can", "will", "should", "would", "could",
    "her", "his", "my", "our", "their", "this", "that", "these", "those",
    "it", "they", "we", "you", "i", "me", "she", "he",
    "before", "after", "during", "between", "through", "into", "like",
    // Domain-generic terms — too broad, would match nearly every document
    // NOTE: "treatment", "diagnosis", "test" were removed from this list —
    // they appear in key page titles/slugs and stripping them breaks
    // common queries like "What is the treatment plan?"
    "diana", "diana's", "tnbc", "breast", "cancer", "tumor",
    "patient", "doctor", "medical", "clinical", "results",
    "ucsf", "stanford",
  ]);

  // 1. Cleaned query — strip stop words, keep the meaningful terms together
  //    BM25 proximity ranking works best with all terms in one query
  const significantWords = clean
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !stopWords.has(w.toLowerCase()));
  const cleaned = significantWords.join(" ");
  if (cleaned) patterns.add(cleaned);

  // 2. Medical abbreviation expansions — these use completely different tokens
  //    so BM25 can't bridge them; we need separate queries
  const expansions: Record<string, string[]> = {
    tnbc: ["triple-negative breast cancer"],
    pcr: ["pathologic complete response"],
    ctdna: ["circulating tumor DNA", "ctDNA"],
    mrd: ["minimal residual disease"],
    rcb: ["residual cancer burden"],
    hrd: ["homologous recombination deficiency"],
    stils: ["stromal tumor-infiltrating lymphocytes", "sTILs"],
    tmb: ["tumor mutational burden"],
    "keynote-522": ["pembrolizumab chemotherapy neoadjuvant"],
    "k-522": ["KEYNOTE-522"],
    ac: ["doxorubicin cyclophosphamide"],
    pembro: ["pembrolizumab"],
    idc: ["invasive ductal carcinoma"],
    nact: ["neoadjuvant chemotherapy"],
    hbo2t: ["hyperbaric oxygen therapy"],
    pd: ["programmed death ligand"],
    brca: ["BRCA1 BRCA2 germline mutation"],
    her2: ["HER2 erbb2"],
  };

  const lower = clean.toLowerCase();
  for (const [abbrev, alts] of Object.entries(expansions)) {
    if (patterns.size >= 5) break;
    if (lower.includes(abbrev)) {
      for (const alt of alts) {
        if (patterns.size >= 5) break;
        patterns.add(alt);
      }
    }
  }

  // 3. Individual specific terms — only when query has 3+ significant words,
  //    search the top 2 most specific (longest) terms individually
  if (significantWords.length >= 3) {
    const byLength = [...significantWords].sort((a, b) => b.length - a.length);
    for (const w of byLength.slice(0, 2)) {
      if (patterns.size >= 5) break;
      patterns.add(w);
    }
  }

  return Array.from(patterns).slice(0, 5);
}

export async function POST(request: Request) {
  await connection();

  // Fail fast on missing credentials
  if (!process.env.AI_GATEWAY_API_KEY) {
    return new Response(
      JSON.stringify({ error: "AI_GATEWAY_API_KEY is not configured. Add it to .env.local to enable chat." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const { messages, conversationId } = (await request.json()) as {
    messages: UIMessage[];
    conversationId?: string;
  };

  const modelMessages = await convertToModelMessages(messages);
  const convId = conversationId as Id<"conversations"> | undefined;
  const convex = getConvex();

  // Mark stream as active immediately so clients see the waiting state
  if (convId) {
    convex
      .mutation(api.conversations.updateStreaming, {
        conversationId: convId,
        text: "",
      })
      .catch(() => {});
  }

  const flusher = createConvexFlusher({ convex, conversationId: convId });

  const systemPrompt = await buildSystemPrompt();

  const result = streamText({
    model: fastTextModel(), // see scripts/eval-chat.ts for model leaderboard
    maxOutputTokens: 50000,
    system: systemPrompt,
    messages: modelMessages,
    stopWhen: stepCountIs(10),
    experimental_transform: smoothStream({ delayInMs: 25, chunking: "word" }),
    tools: {
      search_wiki: {
        description:
          "Search across all wiki pages and source documents. Automatically fans out into multiple parallel searches using different query patterns for comprehensive results. Just describe what you're looking for naturally.",
        inputSchema: z.object({
          query: z.string().describe("What you're looking for — can be a phrase or topic"),
        }),
        execute: async ({ query }: { query: string }) => {
          // Generate multiple search patterns from the query
          const patterns = generateSearchPatterns(query);

          // Fan out: text search + vector search in parallel
          const textSearchPromise = Promise.all(
            patterns.map((p) => getConvex().query(api.documents.search, { query: p, limit: 6 }))
          );

          // Vector search — embed the query and find semantically similar docs
          const vectorSearchPromise = (async () => {
            try {
              if (!process.env.OPENAI_API_KEY) return [];
              const queryEmbedding = await embed(query);
              return await getConvex().action(api.documents.vectorSearch, {
                embedding: queryEmbedding,
                limit: 6,
              });
            } catch {
              // Vector search is best-effort — fall back to text-only
              return [];
            }
          })();

          const [allTextResults, vectorResults] = await Promise.all([
            textSearchPromise,
            vectorSearchPromise,
          ]);

          // Merge and deduplicate by slug, preserving order
          // Text results first (BM25 ranked), then vector results (semantic)
          const seen = new Set<string>();
          const merged: Array<{ slug: string; title: string; tags: string[]; excerpt?: string }> = [];

          for (const results of allTextResults) {
            for (const r of results) {
              if (!seen.has(r.slug)) {
                seen.add(r.slug);
                merged.push({
                  ...r,
                  title: applyPiiRedactions(r.title),
                  excerpt: r.excerpt ? applyPiiRedactions(r.excerpt) : undefined,
                });
              }
            }
          }

          // Append vector search results (semantic matches text search may miss)
          for (const r of vectorResults) {
            if (!seen.has(r.slug)) {
              seen.add(r.slug);
              merged.push({
                slug: r.slug,
                title: applyPiiRedactions(r.title),
                tags: r.tags,
              });
            }
          }

          return merged.slice(0, 12);
        },
      },
      read_page: {
        description:
          "Read the full content of a specific wiki page by its slug. Returns the page content plus a list of linked_pages found in the text — evaluate these as candidates for further reading.",
        inputSchema: z.object({
          slug: z
            .string()
            .describe(
              'The page slug, e.g. "wiki/treatment/treatment-plan" or "sources/meeting-notes/319---stanford-med-onc"'
            ),
        }),
        execute: async ({ slug }: { slug: string }) => {
          const doc = await getConvex().query(api.documents.getBySlug, { slug });
          if (!doc) return { error: `Page not found: ${slug}` };
          const content = applyPiiRedactions(doc.content);

          // Extract wikilinks [[slug]] and [[slug|label]] from content
          const linkRegex = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g;
          const linkedSlugs = new Set<string>();
          let match;
          while ((match = linkRegex.exec(content)) !== null) {
            const linked = match[1].trim();
            // Skip Terminology anchors and self-links
            if (linked.startsWith("about/Terminology") || linked === slug) continue;
            linkedSlugs.add(linked);
          }

          // Batch-resolve linked page titles (best-effort, cap at 10)
          const slugsToResolve = Array.from(linkedSlugs).slice(0, 10);
          const linkedPages = (
            await Promise.all(
              slugsToResolve.map(async (s) => {
                const linked = await getConvex().query(api.documents.getBySlug, { slug: s });
                return linked
                  ? { slug: linked.slug, title: applyPiiRedactions(linked.title) }
                  : null;
              })
            )
          ).filter((p): p is { slug: string; title: string } => p !== null);

          return {
            slug: doc.slug,
            title: applyPiiRedactions(doc.title),
            tags: doc.tags,
            content: content.slice(0, 8000),
            linked_pages: linkedPages,
          };
        },
      },
      list_pages: {
        description:
          "List all available wiki pages to discover what content exists.",
        inputSchema: z.object({}),
        execute: async () => {
          return await getConvex().action(api.documents.list, {});
        },
      },
      get_pages_by_tag: {
        description: "Find all pages that have a specific tag.",
        inputSchema: z.object({
          tag: z.string().describe("The tag to search for"),
        }),
        execute: async ({ tag }: { tag: string }) => {
          return await getConvex().action(api.documents.getByTag, { tag });
        },
      },
      list_tags: {
        description: "List all tags used across the wiki.",
        inputSchema: z.object({}),
        execute: async () => {
          return await getConvex().action(api.documents.listTags, {});
        },
      },
    },
    onAbort: async () => {
      await flusher.finalizeAbort();
    },
    onChunk: ({ chunk }) => {
      if (!convId) return;
      if (chunk.type === "text-delta") {
        flusher.pushText((chunk as { text: string }).text);
      } else if (chunk.type === "tool-call") {
        const tc = chunk as unknown as Record<string, unknown>;
        const toolArgs = tc.args || tc.input;
        flusher.pushToolCall({
          type: `tool-${tc.toolName}`,
          toolName: tc.toolName as string,
          toolCallId: tc.toolCallId as string,
          input: toolArgs,
          state: "calling",
        });
      } else if (chunk.type === "tool-result") {
        const tr = chunk as unknown as { toolCallId: string; result: unknown };
        // Strip large content from tool results to keep the streaming row small.
        const result = tr.result;
        let output: unknown;
        if (
          typeof result === "object" &&
          result !== null &&
          "content" in (result as Record<string, unknown>)
        ) {
          const r = result as Record<string, unknown>;
          output = Object.fromEntries(
            Object.entries(r).filter(([k]) => k !== "content")
          );
        } else if (Array.isArray(result)) {
          // For search results, keep just slug/title.
          output = (result as Array<Record<string, unknown>>).map((r) => ({
            slug: r.slug,
            title: r.title,
          }));
        } else {
          output = result;
        }
        flusher.updateToolResult(tr.toolCallId, output);
      }
    },
    onError: async (event) => {
      const errMsg =
        event.error instanceof Error ? event.error.message : String(event.error);
      console.error("Chat stream error:", errMsg);
      const isAuth =
        errMsg.includes("Authentication") ||
        errMsg.includes("401") ||
        errMsg.includes("Unauthorized");
      const isCredits = errMsg.includes("credits") || errMsg.includes("402");
      const userMsg = isAuth
        ? "API key is invalid or missing. Check your AI_GATEWAY_API_KEY in .env.local."
        : isCredits
          ? "Out of API credits. Check your Vercel AI Gateway usage."
          : `Something went wrong: ${errMsg}`;
      await flusher.finalizeError(userMsg);
    },
    onFinish: async ({ text, steps }) => {
      if (!convId) return;
      // Build UI-compatible parts from steps for full restoration.
      const uiParts: Array<Record<string, unknown>> = [];
      for (const step of steps) {
        for (const r of step.reasoning) {
          if (r.text) uiParts.push({ type: "reasoning", text: r.text });
        }
        for (const tc of step.toolCalls) {
          const tr = (
            step as unknown as {
              toolResults?: Array<{ toolCallId: string; result: unknown }>;
            }
          ).toolResults?.find((r) => r.toolCallId === tc.toolCallId);
          uiParts.push({
            type: `tool-${tc.toolName}`,
            toolName: tc.toolName,
            toolCallId: tc.toolCallId,
            input:
              (tc as unknown as Record<string, unknown>).args ??
              (tc as unknown as Record<string, unknown>).input,
            output: tr?.result ?? null,
            state: "output-available",
          });
        }
        if (step.text) uiParts.push({ type: "text", text: step.text });
      }
      await flusher.finalize(
        text
          ? [
              {
                role: "assistant",
                content: text,
                // Phase 2: parts is union(string, array); write native array.
                parts: uiParts as unknown as string,
                createdAt: Date.now(),
              },
            ]
          : []
      );
    },
  });

  try {
    return result.toUIMessageStreamResponse();
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : "An unexpected error occurred";
    const isCredits = msg.includes("credits") || msg.includes("402");
    console.error("Chat stream error:", msg);
    return new Response(
      JSON.stringify({
        error: isCredits
          ? "Out of API credits. Check your Vercel AI Gateway usage."
          : `Chat error: ${msg}`,
      }),
      { status: isCredits ? 402 : 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
