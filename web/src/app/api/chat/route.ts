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
 * Generate multiple search patterns from a query for parallel fan-out.
 * Takes a natural language query and produces 2-4 short search patterns
 * that cover different angles: exact terms, synonyms, abbreviations.
 */
function generateSearchPatterns(query: string): string[] {
  const patterns = new Set<string>();

  // Original query (trimmed)
  const clean = query.trim();
  if (clean) patterns.add(clean);

  // Split into individual key terms (2+ chars) and search each
  const words = clean.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length >= 2) {
    // Pairs of adjacent words
    for (let i = 0; i < words.length - 1 && patterns.size < 5; i++) {
      patterns.add(`${words[i]} ${words[i + 1]}`);
    }
  }

  // Medical abbreviation expansions
  const expansions: Record<string, string> = {
    tnbc: "triple-negative breast cancer",
    pcr: "pathologic complete response",
    ctdna: "circulating tumor DNA",
    mrd: "minimal residual disease",
    rcb: "residual cancer burden",
    "keynote-522": "pembrolizumab chemotherapy",
    "k-522": "KEYNOTE-522",
    ac: "doxorubicin cyclophosphamide",
    pembro: "pembrolizumab",
  };

  for (const [abbrev, expansion] of Object.entries(expansions)) {
    if (clean.toLowerCase().includes(abbrev)) {
      patterns.add(expansion);
    }
  }

  // Cap at 4 patterns to avoid excessive API calls
  return Array.from(patterns).slice(0, 4);
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

          // Fan out: run all searches in parallel
          const allResults = await Promise.all(
            patterns.map((p) => getConvex().query(api.documents.search, { query: p, limit: 6 }))
          );

          // Merge and deduplicate by slug, preserving order
          const seen = new Set<string>();
          const merged: Array<{ slug: string; title: string; tags: string[]; excerpt: string }> = [];
          for (const results of allResults) {
            for (const r of results) {
              if (!seen.has(r.slug)) {
                seen.add(r.slug);
                merged.push(r);
              }
            }
          }
          return merged.slice(0, 12);
        },
      },
      read_page: {
        description:
          "Read the full content of a specific wiki page by its slug.",
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
          return {
            slug: doc.slug,
            title: doc.title,
            tags: doc.tags,
            content: doc.content.slice(0, 8000),
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

  return result.toUIMessageStreamResponse();
}
