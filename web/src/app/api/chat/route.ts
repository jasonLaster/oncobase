import {
  streamText,
  stepCountIs,
  convertToModelMessages,
  type UIMessage,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { embed } from "@/lib/embeddings";

function getConvex() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return new ConvexHttpClient(url);
}

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const SYSTEM_PROMPT_BASE = `You are a research assistant for Diana's TNBC (triple-negative breast cancer) knowledge base. You help answer questions about Diana's diagnosis, treatment plan, research, and related medical topics.

You have access to tools that let you search and read wiki pages. Use them to find relevant information before answering. Always ground your answers in the wiki content when possible.

IMPORTANT CITATION RULES:
- ALWAYS cite sources using inline markdown links: [Page Title](/slug)
- Every factual claim should have a citation. Aim for 5+ citations per response.
- Example: "Diana is on [KEYNOTE-522](/wiki/treatment/treatment-plan) which includes..."
- Cite specific source pages when referencing research: [Sahin 2026](/sources/research-articles/sahin-2026-tnbc-mrna-vaccine)
- Do NOT list sources at the end — weave them inline throughout your response.

Search strategy:
- Use the PAGE INDEX below to find the right slug, then use read_page to get details
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
    prompt += `\n\n## DIANA'S DIAGNOSIS\n\n${diagnosisDoc.content}`;
  }

  if (indexDoc) {
    prompt += `\n\n## PAGE INDEX\n\nUse these slugs with read_page to get full content:\n\n${indexDoc.content}`;
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
 * Example: "peptide vaccines for Diana's TNBC" →
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
    "diana", "diana's", "tnbc", "breast", "cancer", "tumor", "treatment",
    "diagnosis", "patient", "doctor", "medical", "clinical", "results",
    "test", "tests", "ucsf", "stanford",
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
  const { messages, conversationId } = (await request.json()) as {
    messages: UIMessage[];
    conversationId?: string;
  };

  const modelMessages = await convertToModelMessages(messages);
  const convId = conversationId as Id<"conversations"> | undefined;

  // Mark stream as active immediately so clients see the waiting state
  if (convId) {
    getConvex().mutation(api.conversations.updateStreaming, {
      conversationId: convId,
      text: "",
    }).catch(() => {});
  }

  // Streaming parts + text flush to Convex
  let currentText = "";
  const streamingParts: Array<Record<string, unknown>> = [];
  let flushQueued = false;
  let lastFlush = 0;
  const FLUSH_INTERVAL = 500; // ms

  function scheduleFlush() {
    if (!convId || flushQueued) return;
    const now = Date.now();
    const wait = Math.max(0, FLUSH_INTERVAL - (now - lastFlush));
    flushQueued = true;
    setTimeout(async () => {
      flushQueued = false;
      lastFlush = Date.now();
      try {
        await getConvex().mutation(api.conversations.updateStreaming, {
          conversationId: convId,
          text: currentText,
          parts: JSON.stringify(streamingParts),
        });
      } catch {
        // Best-effort
      }
    }, wait);
  }

  function flushNow() {
    if (!convId) return;
    getConvex().mutation(api.conversations.updateStreaming, {
      conversationId: convId,
      text: currentText,
      parts: JSON.stringify(streamingParts),
    }).catch(() => {});
    lastFlush = Date.now();
  }

  const systemPrompt = await buildSystemPrompt();

  const result = streamText({
    model: openrouter.chat("openai/gpt-5.4-mini"), // see scripts/eval-chat.ts for model leaderboard
    maxOutputTokens: 50000,
    system: systemPrompt,
    messages: modelMessages,
    stopWhen: stepCountIs(10),
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
                merged.push(r);
              }
            }
          }

          // Append vector search results (semantic matches text search may miss)
          for (const r of vectorResults) {
            if (!seen.has(r.slug)) {
              seen.add(r.slug);
              merged.push({ slug: r.slug, title: r.title, tags: r.tags });
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

          // Extract wikilinks [[slug]] and [[slug|label]] from content
          const linkRegex = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g;
          const linkedSlugs = new Set<string>();
          let match;
          while ((match = linkRegex.exec(doc.content)) !== null) {
            const linked = match[1].trim();
            // Skip Terminology anchors and self-links
            if (linked.startsWith("Terminology") || linked === slug) continue;
            linkedSlugs.add(linked);
          }

          // Batch-resolve linked page titles (best-effort, cap at 10)
          const slugsToResolve = Array.from(linkedSlugs).slice(0, 10);
          const linkedPages = (
            await Promise.all(
              slugsToResolve.map(async (s) => {
                const linked = await getConvex().query(api.documents.getBySlug, { slug: s });
                return linked ? { slug: linked.slug, title: linked.title } : null;
              })
            )
          ).filter((p): p is { slug: string; title: string } => p !== null);

          return {
            slug: doc.slug,
            title: doc.title,
            tags: doc.tags,
            content: doc.content.slice(0, 8000),
            linked_pages: linkedPages,
          };
        },
      },
      list_pages: {
        description:
          "List all available wiki pages to discover what content exists.",
        inputSchema: z.object({}),
        execute: async () => {
          return await getConvex().query(api.documents.list, {});
        },
      },
      get_pages_by_tag: {
        description: "Find all pages that have a specific tag.",
        inputSchema: z.object({
          tag: z.string().describe("The tag to search for"),
        }),
        execute: async ({ tag }: { tag: string }) => {
          return await getConvex().query(api.documents.getByTag, { tag });
        },
      },
      list_tags: {
        description: "List all tags used across the wiki.",
        inputSchema: z.object({}),
        execute: async () => {
          return await getConvex().query(api.documents.listTags, {});
        },
      },
    },
    onAbort: async () => {
      if (convId) {
        try {
          // Save whatever partial text we accumulated as the assistant message
          await Promise.all([
            currentText
              ? getConvex().mutation(api.conversations.saveMessages, {
                  conversationId: convId,
                  messages: [
                    {
                      role: "assistant" as const,
                      content: currentText,
                      createdAt: Date.now(),
                    },
                  ],
                })
              : Promise.resolve(),
            getConvex().mutation(api.conversations.clearStreaming, {
              conversationId: convId,
            }),
          ]);
        } catch {
          // Best-effort
        }
      }
    },
    onChunk: ({ chunk }) => {
      if (!convId) return;
      if (chunk.type === "text-delta") {
        currentText += (chunk as { text: string }).text;
        // Update or create trailing text part
        const last = streamingParts[streamingParts.length - 1];
        if (last && last.type === "text") {
          last.text = (last.text as string) + (chunk as { text: string }).text;
        } else {
          streamingParts.push({ type: "text", text: (chunk as { text: string }).text });
        }
        scheduleFlush();
      } else if (chunk.type === "tool-call") {
        const tc = chunk as unknown as Record<string, unknown>;
        const toolArgs = tc.args || tc.input;
        streamingParts.push({
          type: `tool-${tc.toolName}`,
          toolName: tc.toolName as string,
          toolCallId: tc.toolCallId as string,
          input: toolArgs,
          state: "calling",
        });
        flushNow();
      } else if (chunk.type === "tool-result") {
        const tr = chunk as unknown as { toolCallId: string; result: unknown };
        const part = streamingParts.find(
          (p) => (p.toolCallId as string) === tr.toolCallId
        );
        if (part) {
          // Strip large content from tool results to keep payload small
          const result = tr.result as Record<string, unknown> | unknown;
          if (typeof result === "object" && result !== null && "content" in (result as Record<string, unknown>)) {
            const r = result as Record<string, unknown>;
            part.output = Object.fromEntries(Object.entries(r).filter(([k]) => k !== "content"));
          } else if (Array.isArray(result)) {
            // For search results, keep just slug/title
            part.output = (result as Array<Record<string, unknown>>).map(
              (r) => ({ slug: r.slug, title: r.title })
            );
          } else {
            part.output = result;
          }
          part.state = "output-available";
        }
        flushNow();
      }
    },
    onFinish: async ({ text, steps }) => {
      if (convId) {
        // Build UI-compatible parts from steps for full restoration
        const uiParts: Array<Record<string, unknown>> = [];
        for (const step of steps) {
          // Reasoning
          for (const r of step.reasoning) {
            if (r.text) {
              uiParts.push({ type: "reasoning", text: r.text });
            }
          }
          // Tool calls with results
          for (const tc of step.toolCalls) {
            const tr = (step as unknown as { toolResults?: Array<{ toolCallId: string; result: unknown }> })
              .toolResults?.find((r) => r.toolCallId === tc.toolCallId);
            uiParts.push({
              type: `tool-${tc.toolName}`,
              toolName: tc.toolName,
              toolCallId: tc.toolCallId,
              input: (tc as unknown as Record<string, unknown>).args ?? (tc as unknown as Record<string, unknown>).input,
              output: tr?.result ?? null,
              state: "output-available",
            });
          }
          // Text
          if (step.text) {
            uiParts.push({ type: "text", text: step.text });
          }
        }

        try {
          // Save message FIRST, then clear streaming — so the final message
          // is available before streamingText goes undefined (prevents flash)
          if (text) {
            await getConvex().mutation(api.conversations.saveMessages, {
              conversationId: convId,
              messages: [
                {
                  role: "assistant" as const,
                  content: text,
                  parts: JSON.stringify(uiParts),
                  createdAt: Date.now(),
                },
              ],
            });
          }
          await getConvex().mutation(api.conversations.clearStreaming, {
            conversationId: convId,
          });
        } catch (e) {
          console.error("Failed to save assistant message:", e);
        }
      }
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
          ? "Out of API credits. Please add credits at openrouter.ai/settings/keys."
          : `Chat error: ${msg}`,
      }),
      { status: isCredits ? 402 : 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
