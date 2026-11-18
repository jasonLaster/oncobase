import {
  consumeStream,
  convertToModelMessages,
  createIdGenerator,
  smoothStream,
  streamText,
  type UIMessage,
} from "ai";
import { ConvexHttpClient } from "convex/browser";
import OpenAI from "openai";
import { z } from "zod";
import { createConvexFlusher } from "../../../packages/chat/src/flusher.js";
import { orderedMutations } from "./convex-mutations";
import { runAfterResponse } from "./background";
import { getCachedSystemPrompt } from "../../../packages/chat/src/system-prompt-cache.js";
import {
  ChatRequestSchema,
  WIKI_CHAT_DIAGNOSIS_SLUGS,
  compactChatToolResult,
  composeWikiChatSystemPrompt,
  wikiChatAudience,
} from "@oncobase/wiki-content/chat-route";
import { applyPiiRedactions, parseSitePiiPatterns, type PiiPattern } from "@oncobase/wiki-content/pii";
import { api } from "../convex/_generated/api.js";
import { getDocumentsByTag, listDocuments } from "./document-listing";
import type { Id } from "../convex/_generated/dataModel.js";
import { createFakeChatModel, isFakeChatModelEnabled } from "./fake-chat-model";
import { WIKI_CHAT_EMPTY_ANSWER, createWikiChatTools, wikiChatRunSettings } from "./chat-agent";
import { getSearchCorpus } from "./api/search";
import type { SessionUser } from "./reader-access";

const generateMessageId = createIdGenerator({ prefix: "msg", size: 16 });
const generateRunId = createIdGenerator({ prefix: "run", size: 16 });
const EMBEDDING_MODEL = "text-embedding-3-small";
const CANCEL_POLL_INTERVAL_MS = 1000;
const PII_PATTERN_CACHE_TTL_MS = 15_000;
// grep_wiki waits this long for a cold text-search corpus, then the model is
// told to use search_wiki; the load continues and serves the next call.
const GREP_CORPUS_WAIT_MS = 20_000;

let closedControllerGuardInstalled = false;

function isClosedStreamControllerError(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return (
    error instanceof Error &&
    code === "ERR_INVALID_STATE" &&
    /Controller is already closed/i.test(error.message)
  );
}

function installClosedControllerGuard() {
  if (closedControllerGuardInstalled) return;
  closedControllerGuardInstalled = true;
  process.on("uncaughtException", (error) => {
    if (isClosedStreamControllerError(error)) {
      console.warn(
        "[wiki-vite-chat] ignored closed AI stream controller after client abort",
      );
      return;
    }
    throw error;
  });
}

type PiiPatternEntry = {
  patterns: PiiPattern[] | undefined;
  expires: number;
};

const piiPatternCache = new Map<string, PiiPatternEntry>();

let openaiClient: OpenAI | null = null;

function withSiteSlug<TArgs extends object>(siteSlug: string, args: TArgs): TArgs & { siteSlug: string } {
  return { ...args, siteSlug };
}

/** Conversation calls act for one viewer: Convex rejects other owners' rows. */
function asOwner<TArgs extends object>(siteSlug: string, ownerKey: string, args: TArgs) {
  return { ...args, siteSlug, ownerKey };
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

export function documentsGateway(
  client: ConvexHttpClient,
  siteSlug: string,
  includeSensitive: boolean,
  canAccessSlug?: (slug: string) => Promise<boolean>,
) {
  const filterPage = async <T extends { slug: string; sensitive?: boolean }>(page: T | null) => {
    if (!page?.sensitive) return page;
    return canAccessSlug && (await canAccessSlug(page.slug)) ? page : null;
  };
  const filterPages = async <T extends { slug: string; sensitive?: boolean }>(
    pages: Array<T | null>,
  ): Promise<T[]> => {
    const visible: T[] = [];
    for (const page of pages) {
      if (!page) continue;
      if (page.sensitive === false) {
        visible.push(page);
        continue;
      }
      const doc = page.sensitive === true
        ? page
        : await client.query(
            api.documents.getBySlug,
            withSiteSlug(siteSlug, { slug: page.slug, includeSensitive: true }),
          );
      if (doc?.sensitive !== true) {
        visible.push(page);
        continue;
      }
      if (canAccessSlug && (await canAccessSlug(page.slug))) {
        visible.push(page);
      }
    }
    return visible;
  };

  return {
    search: (args: { query: string; limit?: number }) =>
      client
        .query(
          api.documents.search,
          withSiteSlug(siteSlug, { ...args, includeSensitive }),
        )
        .then(filterPages),
    getBySlug: (args: { slug: string; includeSensitive?: boolean }) =>
      client
        .query(
          api.documents.getBySlug,
          withSiteSlug(siteSlug, {
            ...args,
            includeSensitive: args.includeSensitive ?? includeSensitive,
          }),
        )
        .then(filterPage),
    list: () =>
      listDocuments(client, withSiteSlug(siteSlug, { includeSensitive }))
        .then(filterPages),
    getByTag: (args: { tag: string }) =>
      getDocumentsByTag(client, withSiteSlug(siteSlug, { ...args, includeSensitive }))
        .then(filterPages),
    listTags: async () => {
      const pages = await listDocuments(client, withSiteSlug(siteSlug, { includeSensitive }))
        .then(filterPages);
      return Array.from(new Set(pages.flatMap((page) => page.tags))).sort();
    },
    vectorSearch: (args: { embedding: number[]; limit?: number }) =>
      client
        .action(
          api.documents.vectorSearch,
          withSiteSlug(siteSlug, { ...args, includeSensitive }),
        )
        .then(filterPages),
  };
}

async function getPiiPatterns(client: ConvexHttpClient, siteSlug: string) {
  const now = Date.now();
  const cached = piiPatternCache.get(siteSlug);
  if (cached && cached.expires > now) return cached.patterns;

  const site = await client.query(api.sites.getBySlug, { slug: siteSlug }).catch(() => null);
  const configuredPatterns = parseSitePiiPatterns(site?.config?.piiPatterns);
  const patterns = configuredPatterns.length > 0
    ? configuredPatterns
    : siteSlug === "diana"
      ? undefined
      : [];
  piiPatternCache.set(siteSlug, {
    patterns,
    expires: now + PII_PATTERN_CACHE_TTL_MS,
  });
  return patterns;
}

type SystemPromptEntry = {
  prompt: string;
  /** Sensitive pages whose content is in `prompt`; each hit re-checks access. */
  sensitiveSlugs: string[];
};

async function loadSystemPrompt(
  client: ConvexHttpClient,
  siteSlug: string,
  includeSensitive: boolean,
  canAccessSlug?: (slug: string) => Promise<boolean>,
): Promise<SystemPromptEntry> {
  const documents = documentsGateway(client, siteSlug, includeSensitive, canAccessSlug);
  const piiPatterns = await getPiiPatterns(client, siteSlug);
  const redact = (value: string) => applyPiiRedactions(value, { patterns: piiPatterns });
  const [indexDoc, ...diagnosisCandidates] = await Promise.all([
    documents.getBySlug({ slug: "index" }),
    ...WIKI_CHAT_DIAGNOSIS_SLUGS.map((slug) => documents.getBySlug({ slug })),
  ]);
  const diagnosisDoc = diagnosisCandidates.find(Boolean) ?? null;

  const prompt = composeWikiChatSystemPrompt({
    diagnosis: diagnosisDoc ? redact(diagnosisDoc.content) : null,
    index: indexDoc ? redact(indexDoc.content) : null,
  });
  const sensitiveSlugs = [indexDoc, diagnosisDoc]
    .filter((doc): doc is NonNullable<typeof doc> => doc?.sensitive === true)
    .map((doc) => doc.slug);
  return { prompt, sensitiveSlugs };
}

async function buildSystemPrompt(
  client: ConvexHttpClient,
  siteSlug: string,
  includeSensitive: boolean,
  canAccessSlug?: (slug: string) => Promise<boolean>,
  accessCacheKey = "public",
) {
  const cacheKey = `${siteSlug}:${includeSensitive ? "session" : "public"}:${accessCacheKey}`;
  const load = () => loadSystemPrompt(client, siteSlug, includeSensitive, canAccessSlug);
  const entry = await getCachedSystemPrompt(cacheKey, load);
  // The cache outlives a role revocation. A prompt that embeds sensitive page
  // content is reused only while the viewer can still read every such page;
  // otherwise rebuild it under the viewer's current access (and don't cache).
  if (entry.sensitiveSlugs.length > 0) {
    const allowed = canAccessSlug
      ? await Promise.all(entry.sensitiveSlugs.map((slug) => canAccessSlug(slug)))
      : [];
    if (allowed.length !== entry.sensitiveSlugs.length || allowed.some((ok) => !ok)) return (await load()).prompt;
  }
  return entry.prompt;
}

export async function handleChatRequest({
  request,
  client,
  siteSlug,
  ownerKey,
  includeSensitive,
  canAccessSlug,
  accessCacheKey,
  sessionUser = null,
}: {
  request: Request;
  client: ConvexHttpClient;
  siteSlug: string;
  /** Hashed conversation owner (server/chat-owner.ts). Required: omitting it
   * would make Convex treat the call as a legacy unrestricted server write. */
  ownerKey: string;
  includeSensitive: boolean;
  canAccessSlug?: (slug: string) => Promise<boolean>;
  accessCacheKey?: string;
  /** Signed-in viewer: grep_wiki searches the pages they may read. */
  sessionUser?: SessionUser | null;
}) {
  installClosedControllerGuard();

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

  if (!isFakeChatModelEnabled() && !process.env.AI_GATEWAY_API_KEY) {
    return Response.json(
      { error: "AI_GATEWAY_API_KEY is not configured. Add it to the deployment environment to enable chat." },
      { status: 500, headers: { "x-request-id": requestId } },
    );
  }

  const messages = parsedBody.messages as unknown as UIMessage[];
  const modelMessages = await convertToModelMessages(messages);
  const convId = parsedBody.conversationId as Id<"conversations"> | undefined;
  const runId = generateRunId();
  const documents = documentsGateway(client, siteSlug, includeSensitive, canAccessSlug);

  if (convId) {
    // Current clients reset before the request becomes stoppable. Never clear
    // their marker here: Stop may already have arrived before this function.
    if (!parsedBody.cancelResetHandled) await client
      .mutation(
        api.conversations.clearCancel,
        asOwner(siteSlug, ownerKey, { conversationId: convId }),
        { skipQueue: true },
      )
      .catch(() => {});
    await client
      .mutation(
        api.conversations.beginRun,
        asOwner(siteSlug, ownerKey, { conversationId: convId, runId }),
        { skipQueue: true },
      )
      .catch(() => {});

    // Deployed Convex functions can briefly lag this source during a rollout.
    // If Stop aborted the fetch while beginRun was in flight, re-assert the
    // marker after startup so an older beginRun implementation cannot erase it.
    if (request.signal.aborted) {
      await client
        .mutation(
          api.conversations.cancelStream,
          asOwner(siteSlug, ownerKey, { conversationId: convId }),
          { skipQueue: true },
        )
        .catch(() => {});
    }
  }

  const userStopSignal = new AbortController();
  // The HTTP response owns the live SSE stream. Disconnects abort the current
  // run; the client can recover from a persisted trailing user message via
  // auto-resume when the conversation route remounts.
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
        asOwner(siteSlug, ownerKey, { conversationId: convId }),
      );
      if (state?.canceledAt) userStopSignal.abort();
    } catch {
      // Best effort only; transient Convex failures should not kill generation.
    }
  }

  // Do not start provider work when Stop arrived before the first model chunk.
  await maybeAbortOnCancel();
  if (composedAbortSignal.aborted) {
    if (convId) await client.mutation(api.conversations.clearStreaming,
      asOwner(siteSlug, ownerKey, { conversationId: convId, runId }), { skipQueue: true }).catch(() => {});
    return new Response(null, { status: 204 });
  }

  // Ordered among this run's writes, independent of other requests'.
  const runWrites = orderedMutations(client);
  const flusher = createConvexFlusher({
    // Every streamed/persisted write is bound to the requesting owner so a
    // caller cannot append (possibly sensitive) answers to someone else's row.
    convex: { mutation: (ref, args) => runWrites.mutation(ref, { ...args, ownerKey }) },
    conversations: api.conversations,
    conversationId: convId,
    runId,
    siteSlug,
  });
  const systemPrompt = await buildSystemPrompt(
    client,
    siteSlug,
    includeSensitive,
    canAccessSlug,
    accessCacheKey,
  );
  const piiPatterns = await getPiiPatterns(client, siteSlug);
  const searchablePages = async () => {
    const corpus = getSearchCorpus(client, siteSlug, includeSensitive ? sessionUser : null, piiPatterns);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), GREP_CORPUS_WAIT_MS); });
    try {
      return await Promise.race([corpus.pages, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const tools = createWikiChatTools({
    documents: { ...documents, searchablePages },
    piiPatterns,
    embedQuery,
  });
  const { audience, ...settings } = wikiChatRunSettings({ audience: wikiChatAudience(process.env, request.headers) });

  const result = streamText({
    ...settings,
    model: isFakeChatModelEnabled() ? (createFakeChatModel() as never) : settings.model,
    system: systemPrompt,
    messages: modelMessages,
    abortSignal: composedAbortSignal,
    experimental_transform: smoothStream({ delayInMs: 25, chunking: "word" }),
    tools,
    onAbort: async () => {
      await flusher.finalizeAbort();
    },
    onChunk: ({ chunk }) => {
      void maybeAbortOnCancel();
      if (!convId) return;
      if (chunk.type === "text-delta") {
        flusher.pushText((chunk as { text: string }).text);
      } else if (chunk.type === "reasoning-delta") {
        flusher.pushReasoning(chunk.text);
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
        flusher.updateToolResult(toolResult.toolCallId, compactChatToolResult(toolResult.result));
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
      // The last step cannot call tools, so this is rare: a model that stopped
      // without writing. Save a visible reply rather than nothing.
      if (!text.trim()) {
        await flusher.finalizeError(WIKI_CHAT_EMPTY_ANSWER, generateMessageId());
        return;
      }
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
            output: toolResult ? compactChatToolResult(toolResult.result) : null,
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
      // Drain the stream after a client disconnect so onFinish persists the
      // reply; keep the function alive for it rather than racing a freeze.
      consumeSseStream: ({ stream }) => runAfterResponse(consumeStream({ stream }), "chat stream drain"),
      headers: { "x-request-id": requestId, "x-oncobase-chat-audience": audience },
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
