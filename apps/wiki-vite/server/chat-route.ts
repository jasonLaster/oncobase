import {
  consumeStream,
  convertToModelMessages,
  createIdGenerator,
  smoothStream,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { ConvexHttpClient } from "convex/browser";
import OpenAI from "openai";
import { z } from "zod";
import { createConvexFlusher } from "@diana-tnbc/chat/flusher";
import { getCachedSystemPrompt } from "@diana-tnbc/chat/system-prompt-cache";
import { applyPiiRedactions } from "@diana-tnbc/wiki-content/pii";
import { readChatPageFromDocuments } from "@diana-tnbc/wiki-content/chat-tools";
import { api } from "../../../web/convex/_generated/api.js";
import type { Id } from "../../../web/convex/_generated/dataModel.js";

const generateMessageId = createIdGenerator({ prefix: "msg", size: 16 });
const generateRunId = createIdGenerator({ prefix: "run", size: 16 });
const TEXT_MODEL = "openai/gpt-5.4-mini";
const EMBEDDING_MODEL = "text-embedding-3-small";
const CANCEL_POLL_INTERVAL_MS = 1000;

const ChatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        id: z.string().optional(),
        role: z.enum(["user", "assistant", "system"]),
        parts: z.array(z.unknown()).optional(),
        content: z.string().optional(),
      }),
    )
    .min(1, "messages must not be empty"),
  conversationId: z.string().optional(),
});

const SYSTEM_PROMPT_BASE = `You are a research assistant for a triple-negative breast cancer (TNBC) knowledge base. You help answer questions about the patient's diagnosis, treatment plan, research, and related medical topics.

You have access to tools that let you search and read wiki pages. Use them to find relevant information before answering. Always ground your answers in the wiki content when possible.

IMPORTANT CITATION RULES:
- ALWAYS cite sources using compact inline markdown links: [short label](/slug#section-anchor)
- Every factual claim should have a citation. Aim for 5+ citations per response.
- Prefer the most specific page anchor when the source has an obvious heading or section; otherwise cite the page.
- Do NOT list sources at the end — weave them inline throughout your response.

Search strategy:
- FIRST check the PAGE INDEX below — if the question maps directly to a known page, use read_page immediately without searching
- Use search_wiki for broad discovery when you're not sure which page has the answer
- After searching, read the 2-3 most relevant pages before answering
- When you read a page, check its linked_pages list and follow links that are directly relevant to the question
- If read_page returns content exactly "unavailable", say that the source is unavailable instead of treating it as a missing page
- Do NOT use list_pages — use the PAGE INDEX instead

Be direct, compassionate, and precise. Use medical terminology but explain it when needed.`;

let openaiClient: OpenAI | null = null;

function withSiteSlug<TArgs extends object>(siteSlug: string, args: TArgs): TArgs & { siteSlug: string } {
  return { ...args, siteSlug };
}

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  openaiClient ??= new OpenAI({ apiKey });
  return openaiClient;
}

async function embedQuery(query: string) {
  const client = getOpenAIClient();
  if (!client) return null;
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: query,
  });
  return response.data[0]?.embedding ?? null;
}

function compactToolResult(result: unknown): unknown {
  if (
    typeof result === "object" &&
    result !== null &&
    "content" in (result as Record<string, unknown>)
  ) {
    const record = result as Record<string, unknown>;
    return Object.fromEntries(Object.entries(record).filter(([key]) => key !== "content"));
  }
  if (Array.isArray(result)) {
    return (result as Array<Record<string, unknown>>).map((record) => ({
      slug: record.slug,
      title: record.title,
      href: record.href,
      anchor: record.anchor,
    }));
  }
  return result;
}

function generateSearchPatterns(query: string): string[] {
  const patterns = new Set<string>();
  const clean = query.trim();
  if (!clean) return [];

  const stopWords = new Set([
    "a", "an", "the", "is", "are", "was", "were", "in", "on", "at", "to",
    "for", "of", "with", "and", "or", "but", "not", "from", "by", "about",
    "what", "how", "does", "do", "can", "will", "should", "would", "could",
    "her", "his", "my", "our", "their", "this", "that", "these", "those",
    "it", "they", "we", "you", "i", "me", "she", "he",
    "before", "after", "during", "between", "through", "into", "like",
    "diana", "diana's", "tnbc", "breast", "cancer", "tumor",
    "patient", "doctor", "medical", "clinical", "results",
    "ucsf", "stanford",
  ]);

  const significantWords = clean
    .split(/\s+/)
    .filter((word) => word.length >= 2 && !stopWords.has(word.toLowerCase()));
  const cleaned = significantWords.join(" ");
  if (cleaned) patterns.add(cleaned);

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
  for (const [abbreviation, alternatives] of Object.entries(expansions)) {
    if (patterns.size >= 5) break;
    if (!lower.includes(abbreviation)) continue;
    for (const alternative of alternatives) {
      if (patterns.size >= 5) break;
      patterns.add(alternative);
    }
  }

  if (significantWords.length >= 3) {
    for (const word of [...significantWords].sort((a, b) => b.length - a.length).slice(0, 2)) {
      if (patterns.size >= 5) break;
      patterns.add(word);
    }
  }

  return Array.from(patterns).slice(0, 5);
}

function documentsGateway(
  client: ConvexHttpClient,
  siteSlug: string,
  includeSensitive: boolean,
) {
  return {
    search: (args: { query: string; limit?: number }) =>
      client.query(
        api.documents.search,
        withSiteSlug(siteSlug, { ...args, includeSensitive }),
      ),
    getBySlug: (args: { slug: string }) =>
      client.query(
        api.documents.getBySlug,
        withSiteSlug(siteSlug, { ...args, includeSensitive }),
      ),
    list: () =>
      client.action(api.documents.list, withSiteSlug(siteSlug, { includeSensitive })),
    getByTag: (args: { tag: string }) =>
      client.action(api.documents.getByTag, withSiteSlug(siteSlug, args)),
    listTags: () =>
      client.action(api.documents.listTags, withSiteSlug(siteSlug, {})),
    vectorSearch: (args: { embedding: number[]; limit?: number }) =>
      client.action(
        api.documents.vectorSearch,
        withSiteSlug(siteSlug, { ...args, includeSensitive }),
      ),
  };
}

async function loadSystemPrompt(
  client: ConvexHttpClient,
  siteSlug: string,
  includeSensitive: boolean,
) {
  const documents = documentsGateway(client, siteSlug, includeSensitive);
  const [indexDoc, diagnosisDoc] = await Promise.all([
    documents.getBySlug({ slug: "index" }),
    documents.getBySlug({ slug: "wiki/diagnostics/diagnosis" }),
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

async function buildSystemPrompt(
  client: ConvexHttpClient,
  siteSlug: string,
  includeSensitive: boolean,
) {
  const cacheKey = `${siteSlug}:${includeSensitive ? "session" : "public"}`;
  return getCachedSystemPrompt(cacheKey, () => loadSystemPrompt(client, siteSlug, includeSensitive));
}

export async function handleChatRequest({
  request,
  client,
  siteSlug,
  includeSensitive,
}: {
  request: Request;
  client: ConvexHttpClient;
  siteSlug: string;
  includeSensitive: boolean;
}) {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: "POST" } },
    );
  }

  const requestId = crypto.randomUUID().slice(0, 8);
  let parsedBody: z.infer<typeof ChatRequestSchema>;
  try {
    parsedBody = ChatRequestSchema.parse(await request.json());
  } catch (error) {
    const issues =
      error instanceof z.ZodError
        ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
        : "invalid request body";
    return Response.json(
      { error: { code: "validation", message: issues } },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }

  if (!process.env.AI_GATEWAY_API_KEY) {
    return Response.json(
      { error: "AI_GATEWAY_API_KEY is not configured. Add it to the deployment environment to enable chat." },
      { status: 500, headers: { "x-request-id": requestId } },
    );
  }

  const messages = parsedBody.messages as unknown as UIMessage[];
  const modelMessages = await convertToModelMessages(messages);
  const convId = parsedBody.conversationId as Id<"conversations"> | undefined;
  const runId = generateRunId();
  const documents = documentsGateway(client, siteSlug, includeSensitive);

  if (convId) {
    await client
      .mutation(
        api.conversations.beginRun,
        withSiteSlug(siteSlug, { conversationId: convId, runId }),
      )
      .catch(() => {});
  }

  const userStopSignal = new AbortController();
  const composedAbortSignal = AbortSignal.any([request.signal, userStopSignal.signal]);
  let lastCancelPoll = 0;
  async function maybeAbortOnCancel() {
    if (!convId) return;
    const now = Date.now();
    if (now - lastCancelPoll < CANCEL_POLL_INTERVAL_MS) return;
    lastCancelPoll = now;
    try {
      const state = await client.query(
        api.conversations.getCancelState,
        withSiteSlug(siteSlug, { conversationId: convId }),
      );
      if (state?.canceledAt) userStopSignal.abort();
    } catch {
      // Best effort only; transient Convex failures should not kill generation.
    }
  }

  const flusher = createConvexFlusher({
    convex: client,
    conversations: api.conversations,
    conversationId: convId,
    runId,
    siteSlug,
  });
  const systemPrompt = await buildSystemPrompt(client, siteSlug, includeSensitive);

  const result = streamText({
    model: TEXT_MODEL,
    maxOutputTokens: 50000,
    system: systemPrompt,
    messages: modelMessages,
    stopWhen: stepCountIs(10),
    abortSignal: composedAbortSignal,
    experimental_transform: smoothStream({ delayInMs: 25, chunking: "word" }),
    tools: {
      search_wiki: {
        description:
          "Search across all wiki pages and source documents. Describe what you're looking for naturally.",
        inputSchema: z.object({
          query: z.string().describe("What you're looking for"),
        }),
        execute: async ({ query }: { query: string }) => {
          const patterns = generateSearchPatterns(query);
          const textSearchPromise = Promise.all(
            patterns.map((pattern) => documents.search({ query: pattern, limit: 6 })),
          );
          const vectorSearchPromise = (async () => {
            const embedding = await embedQuery(query);
            if (!embedding) return [];
            return documents.vectorSearch({ embedding, limit: 6 });
          })().catch(() => []);

          const [textResults, vectorResults] = await Promise.all([
            textSearchPromise,
            vectorSearchPromise,
          ]);
          const seen = new Set<string>();
          const merged: Array<{ slug: string; title: string; tags: string[]; excerpt?: string }> = [];

          for (const results of textResults) {
            for (const result of results) {
              if (seen.has(result.slug)) continue;
              seen.add(result.slug);
              merged.push({
                ...result,
                title: applyPiiRedactions(result.title),
                excerpt: result.excerpt ? applyPiiRedactions(result.excerpt) : undefined,
              });
            }
          }

          for (const result of vectorResults) {
            if (seen.has(result.slug)) continue;
            seen.add(result.slug);
            merged.push({
              slug: result.slug,
              title: applyPiiRedactions(result.title),
              tags: result.tags,
            });
          }

          return merged.slice(0, 12);
        },
      },
      read_page: {
        description:
          "Read the full content of a specific wiki page by its slug. Returns page content and linked pages.",
        inputSchema: z.object({
          slug: z.string().describe('Page slug, e.g. "wiki/treatment/treatment-plan"'),
        }),
        execute: async ({ slug }: { slug: string }) =>
          readChatPageFromDocuments(
            {
              getBySlug: (args) => documents.getBySlug(args),
            },
            slug,
          ),
      },
      list_pages: {
        description: "List all available wiki pages.",
        inputSchema: z.object({}),
        execute: () => documents.list(),
      },
      get_pages_by_tag: {
        description: "Find all pages that have a specific tag.",
        inputSchema: z.object({ tag: z.string().describe("The tag to search for") }),
        execute: ({ tag }: { tag: string }) => documents.getByTag({ tag }),
      },
      list_tags: {
        description: "List all tags used across the wiki.",
        inputSchema: z.object({}),
        execute: () => documents.listTags(),
      },
    },
    onAbort: async () => {
      await flusher.finalizeAbort();
    },
    onChunk: ({ chunk }) => {
      void maybeAbortOnCancel();
      if (!convId) return;
      if (chunk.type === "text-delta") {
        flusher.pushText((chunk as { text: string }).text);
      } else if (chunk.type === "tool-call") {
        const toolCall = chunk as unknown as Record<string, unknown>;
        flusher.pushToolCall({
          type: `tool-${toolCall.toolName}`,
          toolName: toolCall.toolName as string,
          toolCallId: toolCall.toolCallId as string,
          input: toolCall.args ?? toolCall.input,
          state: "calling",
        });
      } else if (chunk.type === "tool-result") {
        const toolResult = chunk as unknown as { toolCallId: string; result: unknown };
        flusher.updateToolResult(toolResult.toolCallId, compactToolResult(toolResult.result));
      }
    },
    onError: async (event) => {
      const message = event.error instanceof Error ? event.error.message : String(event.error);
      const isAuth = message.includes("Authentication") || message.includes("401") || message.includes("Unauthorized");
      const isCredits = message.includes("credits") || message.includes("402");
      const userMessage = isAuth
        ? "API key is invalid or missing. Check AI_GATEWAY_API_KEY."
        : isCredits
          ? "Out of API credits. Check Vercel AI Gateway usage."
          : `Something went wrong: ${message}`;
      await flusher.finalizeError(userMessage, generateMessageId());
    },
    onFinish: async ({ text, steps }) => {
      if (!convId) return;
      const uiParts: Array<Record<string, unknown>> = [];
      for (const step of steps) {
        for (const reasoning of step.reasoning) {
          if (reasoning.text) uiParts.push({ type: "reasoning", text: reasoning.text });
        }
        for (const toolCall of step.toolCalls) {
          const toolResult = (
            step as unknown as {
              toolResults?: Array<{ toolCallId: string; result: unknown }>;
            }
          ).toolResults?.find((candidate) => candidate.toolCallId === toolCall.toolCallId);
          uiParts.push({
            type: `tool-${toolCall.toolName}`,
            toolName: toolCall.toolName,
            toolCallId: toolCall.toolCallId,
            input:
              (toolCall as unknown as Record<string, unknown>).args ??
              (toolCall as unknown as Record<string, unknown>).input,
            output: toolResult ? compactToolResult(toolResult.result) : null,
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
                parts: uiParts as unknown as string,
                createdAt: Date.now(),
                messageId: generateMessageId(),
              },
            ]
          : [],
      );
    },
  });

  try {
    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      generateMessageId,
      consumeSseStream: consumeStream,
      headers: { "x-request-id": requestId },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "An unexpected error occurred";
    const isCredits = message.includes("credits") || message.includes("402");
    return Response.json(
      {
        error: isCredits
          ? "Out of API credits. Check Vercel AI Gateway usage."
          : `Chat error: ${message}`,
      },
      {
        status: isCredits ? 402 : 500,
        headers: { "x-request-id": requestId },
      },
    );
  }
}
