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
import {
  getMarkdownFile,
  getAllSlugs,
  getAllTags,
  getPagesByTag,
} from "@/lib/markdown";
import { searchMarkdown } from "@/lib/search";

function getConvex() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return new ConvexHttpClient(url);
}

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const SYSTEM_PROMPT = `You are a research assistant for Diana's TNBC (triple-negative breast cancer) knowledge base. You help answer questions about Diana's diagnosis, treatment plan, research, and related medical topics.

You have access to tools that let you search and read wiki pages. Use them to find relevant information before answering. Always ground your answers in the wiki content when possible.

IMPORTANT: When citing information from a wiki or source page, use inline markdown links in the format [Page Title](/slug). For example: [Treatment Plan](/wiki/treatment-plan) or [Stanford Med Onc Notes](/sources/meeting-notes/319---stanford-med-onc). This lets the user click directly to the source. Use these inline citations throughout your response, not just at the end.

Key context:
- Patient: Diana Laster, age 36, diagnosed March 2026
- Diagnosis: Stage III TNBC, invasive ductal carcinoma, Grade 3
- Protocol: KEYNOTE-522 (Carboplatin + Paclitaxel + Pembrolizumab → AC)
- Care center: UCSF

Be direct, compassionate, and precise. Use medical terminology but explain it when needed.`;

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

  // Streaming text flush to Convex
  let accumulatedText = "";
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
      if (accumulatedText) {
        try {
          await getConvex().mutation(api.conversations.updateStreaming, {
            conversationId: convId,
            text: accumulatedText,
          });
        } catch {
          // Best-effort
        }
      }
    }, wait);
  }

  const result = streamText({
    model: openrouter.chat("anthropic/claude-sonnet-4"),
    system: SYSTEM_PROMPT,
    messages: modelMessages,
    stopWhen: stepCountIs(10),
    tools: {
      search_wiki: {
        description:
          "Search across all wiki pages and source documents for a keyword or phrase. Returns matching pages with relevant line excerpts.",
        inputSchema: z.object({
          query: z.string().describe("The search term or phrase"),
        }),
        execute: async ({ query }: { query: string }) => {
          const results = await searchMarkdown(query);
          return results.slice(0, 8).map((r) => ({
            slug: r.slug,
            title: r.title,
            matchCount: r.matches.length,
            excerpts: r.matches
              .slice(0, 3)
              .map((m) => m.lineContent.trim()),
          }));
        },
      },
      read_page: {
        description:
          "Read the full content of a specific wiki page by its slug.",
        inputSchema: z.object({
          slug: z
            .string()
            .describe(
              'The page slug, e.g. "wiki/treatment-plan" or "sources/meeting-notes/319---stanford-med-onc"'
            ),
        }),
        execute: async ({ slug }: { slug: string }) => {
          const file = getMarkdownFile(slug);
          if (!file) return { error: `Page not found: ${slug}` };
          return {
            slug: file.slug,
            title: file.title,
            tags: file.frontmatter.tags || [],
            content: file.content.slice(0, 8000),
          };
        },
      },
      list_pages: {
        description:
          "List all available wiki pages to discover what content exists.",
        inputSchema: z.object({}),
        execute: async () => {
          const slugs = getAllSlugs();
          return slugs.map((s) => {
            const file = getMarkdownFile(s);
            return {
              slug: s,
              title: file?.title || s,
              tags: (file?.frontmatter.tags as string[]) || [],
            };
          });
        },
      },
      get_pages_by_tag: {
        description: "Find all pages that have a specific tag.",
        inputSchema: z.object({
          tag: z.string().describe("The tag to search for"),
        }),
        execute: async ({ tag }: { tag: string }) => {
          return getPagesByTag(tag);
        },
      },
      list_tags: {
        description: "List all tags used across the wiki.",
        inputSchema: z.object({}),
        execute: async () => {
          return getAllTags();
        },
      },
    },
    onAbort: async () => {
      if (convId) {
        try {
          // Save whatever partial text we accumulated as the assistant message
          await Promise.all([
            accumulatedText
              ? getConvex().mutation(api.conversations.saveMessages, {
                  conversationId: convId,
                  messages: [
                    {
                      role: "assistant" as const,
                      content: accumulatedText,
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
      if (convId && chunk.type === "text-delta") {
        accumulatedText += (chunk as { text: string }).text;
        scheduleFlush();
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
          await Promise.all([
            text
              ? getConvex().mutation(api.conversations.saveMessages, {
                  conversationId: convId,
                  messages: [
                    {
                      role: "assistant" as const,
                      content: text,
                      parts: JSON.stringify(uiParts),
                      createdAt: Date.now(),
                    },
                  ],
                })
              : Promise.resolve(),
            getConvex().mutation(api.conversations.clearStreaming, {
              conversationId: convId,
            }),
          ]);
        } catch (e) {
          console.error("Failed to save assistant message:", e);
        }
      }
    },
  });

  return result.toUIMessageStreamResponse();
}
