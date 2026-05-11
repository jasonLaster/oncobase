import {
  streamText,
  stepCountIs,
  smoothStream,
  convertToModelMessages,
  createIdGenerator,
  consumeStream,
  type UIMessage,
} from "ai";
import { connection } from "next/server";
import { z } from "zod";
import { ConvexHttpClient } from "convex/browser";
import type { Id } from "@convex/_generated/dataModel";
import { embed } from "@/lib/embeddings";
import { fastTextModel } from "@/lib/ai";
import { applyPiiRedactions } from "@/lib/pii-redaction";
import { resolveServerConvexUrl } from "@/lib/convex-url";
import {
  createConvexFlusher,
  getCachedSystemPrompt,
} from "@diana-tnbc/chat/route";
import {
  ChatRequestSchema,
  compactChatToolResult,
  generateChatSearchPatterns,
} from "@diana-tnbc/wiki-content/chat-route";
import { siteSlugFromRequest } from "@/lib/site";
import { siteDataFromSlug } from "@/lib/site-data";
import { readChatPage } from "@/lib/chat-page-reader";

const generateMessageId = createIdGenerator({ prefix: "msg", size: 16 });
const generateRunId = createIdGenerator({ prefix: "run", size: 16 });

function getConvex() {
  const url = resolveServerConvexUrl();
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return new ConvexHttpClient(url);
}

const SYSTEM_PROMPT_BASE = `You are a research assistant for a triple-negative breast cancer (TNBC) knowledge base. You help answer questions about the patient's diagnosis, treatment plan, research, and related medical topics.

You have access to tools that let you search and read wiki pages. Use them to find relevant information before answering. Always ground your answers in the wiki content when possible.

IMPORTANT CITATION RULES:
- ALWAYS cite sources using compact inline markdown links: [short label](/slug#section-anchor)
- Every factual claim should have a citation. Aim for 5+ citations per response.
- Prefer the most specific page anchor when the source has an obvious heading or section; otherwise cite the page.
- Example: "The treatment plan uses [KEYNOTE-522](/wiki/treatment/treatment-plan#keynote-522), which includes..."
- Cite specific source pages when referencing research: [Sahin 2026](/sources/research/papers/sahin-2026-tnbc-mrna-vaccine)
- Do NOT list sources at the end — weave them inline throughout your response.

Search strategy:
- FIRST check the PAGE INDEX below — if the question maps directly to a known page (e.g. "treatment plan" → wiki/treatment/plan/index, "diagnosis" → wiki/diagnostics/diagnosis), use read_page immediately without searching
- Use search_wiki for broad discovery when you're not sure which page has the answer
- After searching, read the 2-3 most relevant pages before answering
- When you read a page, check its linked_pages list — these are pages referenced in the text. Follow links that are directly relevant to the question (e.g. a treatment page linking to a specific trial or meeting notes). Skip generic links like "diagnosis" or "prognosis" unless they're what the user asked about.
- If read_page returns content exactly "unavailable", the page exists but its contents are not available to chat. Say that the source is unavailable instead of treating it as a missing page.
- Do NOT use list_pages — use the PAGE INDEX instead

Be direct, compassionate, and precise. Use medical terminology but explain it when needed.`;

async function loadSystemPrompt(siteSlug: string): Promise<string> {
  const siteData = siteDataFromSlug(siteSlug);
  const [indexDoc, diagnosisDoc] = await Promise.all([
    siteData.documents.getBySlug({ slug: "index" }),
    siteData.documents.getBySlug({
      slug: "wiki/diagnostics/diagnosis",
    }),
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

function buildSystemPrompt(siteSlug: string): Promise<string> {
  // System prompts are site-scoped (per-site index + diagnosis docs).
  // The cache key is the slug so each site keeps its own cached
  // prompt instead of clobbering each other.
  return getCachedSystemPrompt(siteSlug, () => loadSystemPrompt(siteSlug));
}

export async function POST(request: Request) {
  await connection();

  const requestId = crypto.randomUUID().slice(0, 8);

  // Fail fast on missing credentials
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.error(`[chat ${requestId}] missing AI_GATEWAY_API_KEY`);
    return new Response(
      JSON.stringify({ error: "AI_GATEWAY_API_KEY is not configured. Add it to .env.local to enable chat." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // PR 28 review: validate body before convertToModelMessages.
  let parsedBody: z.infer<typeof ChatRequestSchema>;
  try {
    parsedBody = ChatRequestSchema.parse(await request.json());
  } catch (err) {
    const issues =
      err instanceof z.ZodError
        ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
        : "invalid request body";
    console.error(`[chat ${requestId}] validation failed:`, issues);
    return new Response(
      JSON.stringify({ error: { code: "validation", message: issues } }),
      {
        status: 400,
        headers: { "Content-Type": "application/json", "x-request-id": requestId },
      }
    );
  }
  const messages = parsedBody.messages as unknown as UIMessage[];

  const modelMessages = await convertToModelMessages(messages);
  const convId = parsedBody.conversationId as Id<"conversations"> | undefined;
  const siteSlug = siteSlugFromRequest(request);
  const convex = getConvex();
  const siteData = siteDataFromSlug(siteSlug, convex);
  const runId = generateRunId();
  console.log(
    `[chat ${requestId}] start conv=${convId ?? "n/a"} run=${runId} msgs=${messages.length}`
  );

  // Begin the run server-side: sets activeRunId and clears any prior
  // canceledAt + streaming row in one atomic patch. From this point on,
  // any flush from a *prior* run with a different runId is a no-op (the
  // mutation rejects mismatched runIds).
  if (convId) {
    await siteData.conversations
      .beginRun({
        conversationId: convId,
        runId,
      })
      .catch(() => {});
  }

  // Compose abort signals so BOTH the explicit Stop button AND the request
  // lifecycle (disconnect / abort) cancel the model. Spec acceptance:
  // "The server must pass `request.signal` to `streamText` so Stop and
  // disconnects cancel provider work." Stop writes `canceledAt` via Convex
  // and aborts the userStopSignal once the throttled poll picks it up.
  const userStopSignal = new AbortController();
  const composedAbortSignal = AbortSignal.any([
    request.signal,
    userStopSignal.signal,
  ]);
  let lastCancelPoll = 0;
  const CANCEL_POLL_INTERVAL_MS = 1000;

  async function maybeAbortOnCancel() {
    if (!convId) return;
    const now = Date.now();
    if (now - lastCancelPoll < CANCEL_POLL_INTERVAL_MS) return;
    lastCancelPoll = now;
    try {
      const state = await siteData.conversations.getCancelState({
        conversationId: convId,
      });
      if (state?.canceledAt) {
        console.log(`[chat ${requestId}] user-cancel detected, aborting`);
        userStopSignal.abort();
      }
    } catch {
      // Best-effort; don't fail the stream on a transient query error.
    }
  }

  const flusher = createConvexFlusher({
    convex,
    conversations: siteData.conversations.refs,
    conversationId: convId,
    runId,
    siteSlug,
  });

  const systemPrompt = await buildSystemPrompt(siteSlug);

  const result = streamText({
    model: fastTextModel(), // see scripts/eval-chat.ts for model leaderboard
    maxOutputTokens: 50000,
    system: systemPrompt,
    messages: modelMessages,
    stopWhen: stepCountIs(10),
    abortSignal: composedAbortSignal,
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
          const patterns = generateChatSearchPatterns(query);

          const textSearchPromise = Promise.all(
            patterns.map((p) =>
              siteData.documents.search({
                query: p,
                limit: 6,
              }),
            ),
          );

          const vectorSearchPromise = (async () => {
            try {
              if (!process.env.OPENAI_API_KEY) return [];
              const queryEmbedding = await embed(query);
              return await siteData.documents.vectorSearch({
                embedding: queryEmbedding,
                limit: 6,
              });
            } catch {
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
          return readChatPage(siteData, slug);
        },
      },
      list_pages: {
        description:
          "List all available wiki pages to discover what content exists.",
        inputSchema: z.object({}),
        execute: async () => {
          return await siteData.documents.list();
        },
      },
      get_pages_by_tag: {
        description: "Find all pages that have a specific tag.",
        inputSchema: z.object({
          tag: z.string().describe("The tag to search for"),
        }),
        execute: async ({ tag }: { tag: string }) => {
          return await siteData.documents.getByTag({
            tag,
          });
        },
      },
      list_tags: {
        description: "List all tags used across the wiki.",
        inputSchema: z.object({}),
        execute: async () => {
          return await siteData.documents.listTags();
        },
      },
    },
    onAbort: async () => {
      await flusher.finalizeAbort();
    },
    onChunk: ({ chunk }) => {
      // Poll for user cancel on every chunk (throttled to 1Hz inside).
      void maybeAbortOnCancel();
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
        flusher.updateToolResult(tr.toolCallId, compactChatToolResult(tr.result));
      }
    },
    onError: async (event) => {
      const errMsg =
        event.error instanceof Error ? event.error.message : String(event.error);
      console.error(`[chat ${requestId}] stream error:`, errMsg);
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
      await flusher.finalizeError(userMsg, generateMessageId());
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
            // PR 28 review: same compaction as the streaming path so completed
            // assistant rows don't carry the 8KB read_page page content.
            output: tr ? compactChatToolResult(tr.result) : null,
            state: "output-available",
          });
        }
        if (step.text) uiParts.push({ type: "text", text: step.text });
      }
      console.log(
        `[chat ${requestId}] finished textLen=${text?.length ?? 0} steps=${steps.length}`
      );
      await flusher.finalize(
        text
          ? [
              {
                role: "assistant",
                content: text,
                // Phase 2: parts is union(string, array); write native array.
                parts: uiParts as unknown as string,
                createdAt: Date.now(),
                // Phase 7: server-generated id for idempotent saveMessages.
                messageId: generateMessageId(),
              },
            ]
          : []
      );
    },
  });

  try {
    return result.toUIMessageStreamResponse({
      // PR 28 review: stable UI message identity across the SSE round-trip.
      originalMessages: messages,
      generateMessageId,
      // PR 28 review: use the AI SDK's consumeStream so the tee'd UI-message
      // stream is drained even when the visible UI is backed by another
      // transport (Convex mirror). This honors backpressure + abort handling
      // correctly without the hand-rolled `after()` reader.
      consumeSseStream: consumeStream,
      headers: { "x-request-id": requestId },
    });
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : "An unexpected error occurred";
    const isCredits = msg.includes("credits") || msg.includes("402");
    console.error(`[chat ${requestId}] response error:`, msg);
    return new Response(
      JSON.stringify({
        error: isCredits
          ? "Out of API credits. Check your Vercel AI Gateway usage."
          : `Chat error: ${msg}`,
      }),
      { status: isCredits ? 402 : 500, headers: { "Content-Type": "application/json", "x-request-id": requestId } }
    );
  }
}
