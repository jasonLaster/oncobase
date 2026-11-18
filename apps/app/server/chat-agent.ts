// The wiki chat agent: tools, model, routing and step policy. The HTTP route
// (chat-route.ts) and the eval (scripts/eval-chat.ts) both build from here, so
// the eval measures exactly what production runs.
import { stepCountIs, type ModelMessage, type SystemModelMessage, type ToolSet } from "ai";
import { z } from "zod";
import { chatHeadingAnchor, findInChatPage, readChatPageFromDocuments } from "@oncobase/wiki-content/chat-tools";
import {
  generateChatSearchPatterns,
  wikiChatFallbackModels,
  wikiChatGatewayOptions,
  wikiChatModel,
  type WikiChatAudience,
} from "@oncobase/wiki-content/chat-route";
import { applyPiiRedactions, type PiiPattern } from "@oncobase/wiki-content/pii";
import type { SearchablePage } from "./search-corpus";

type PageRow = { slug: string; title: string; tags?: string[]; description?: string | null; sensitive?: boolean };
type SearchRow = PageRow & { excerpt?: string };
type FullPage = PageRow & { tags: string[]; content: string };

/** What the tools may read. Implementations enforce the viewer's access. */
export type WikiChatDocuments = {
  search(args: { query: string; limit?: number }): Promise<SearchRow[]>;
  getBySlug(args: { slug: string; includeSensitive?: boolean }): Promise<FullPage | null>;
  list(): Promise<PageRow[]>;
  getByTag(args: { tag: string }): Promise<PageRow[]>;
  listTags(): Promise<string[]>;
  vectorSearch(args: { embedding: number[]; limit?: number }): Promise<PageRow[]>;
  /** Every page this viewer may read, PII-redacted, as lines (the reader's
   * text-search corpus). Null when it is not ready in time. */
  searchablePages?(): Promise<SearchablePage[] | null>;
};

const GREP_PAGE_LIMIT = 15;
const GREP_LINES_PER_PAGE = 3;
const GREP_LINE_CHARS = 300;

/** Literal, case-insensitive line matches across the wiki, most matches first,
 * each with the section anchor it sits under so the answer can cite it. */
export function grepSearchablePages(pages: SearchablePage[], query: string, folder?: string) {
  const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const prefix = folder?.replace(/^\/+|\/+$/g, "");
  const hits: Array<{ page: SearchablePage; lines: number[] }> = [];
  for (const page of pages) {
    if (prefix && !page.slug.startsWith(`${prefix}/`) && page.slug !== prefix) continue;
    const lines: number[] = [];
    for (let index = 0; index < page.lines.length; index++) if (regex.test(page.lines[index]!)) lines.push(index);
    if (lines.length) hits.push({ page, lines });
  }
  hits.sort((a, b) => b.lines.length - a.lines.length);
  const headingAbove = (lines: string[], index: number) => {
    for (let at = index; at >= 0; at--) {
      const match = lines[at]!.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
      if (match) return chatHeadingAnchor(match[1]!.trim());
    }
    return undefined;
  };
  return {
    query,
    total_pages: hits.length,
    results: hits.slice(0, GREP_PAGE_LIMIT).map(({ page, lines }) => ({
      slug: page.slug,
      title: page.title,
      match_count: lines.length,
      matches: lines.slice(0, GREP_LINES_PER_PAGE).map((index) => {
        const anchor = headingAbove(page.lines, index);
        return { line: index + 1, text: page.lines[index]!.trim().slice(0, GREP_LINE_CHARS), ...(anchor ? { anchor } : {}) };
      }),
    })),
  };
}

/** Tool loop length. The last step is forced to answer (see prepareStep). */
export const WIKI_CHAT_MAX_STEPS = 20;
const SEARCH_RESULT_LIMIT = 12;

export function createWikiChatTools({
  documents,
  piiPatterns,
  embedQuery,
}: {
  documents: WikiChatDocuments;
  piiPatterns: PiiPattern[] | undefined;
  embedQuery: (query: string) => Promise<number[] | null>;
}) {
  const redact = (value: string) => applyPiiRedactions(value, { patterns: piiPatterns });
  // search_wiki and read_page already redact titles; the listing tools match.
  const redactListing = <T extends { title?: string; description?: string | null }>(row: T): T => ({
    ...row,
    ...(typeof row.title === "string" ? { title: redact(row.title) } : {}),
    ...(typeof row.description === "string" ? { description: redact(row.description) } : {}),
  });

  return {
    search_wiki: {
      description:
        "Search across all wiki pages and source documents by keywords and meaning. Use a few specific words.",
      inputSchema: z.object({
        query: z.string().describe("What you're looking for"),
      }),
      execute: async ({ query }: { query: string }) => {
        const patterns = generateChatSearchPatterns(query);
        const textSearchPromise = Promise.all(
          patterns.map((pattern) => documents.search({ query: pattern, limit: 6 })),
        );
        const vectorSearchPromise = (async () => {
          const embedding = await embedQuery(query);
          if (!embedding) return [];
          return documents.vectorSearch({ embedding, limit: 6 });
        })().catch(() => []);

        const [textResults, vectorResults] = await Promise.all([textSearchPromise, vectorSearchPromise]);
        const seen = new Set<string>();
        const merged: Array<{ slug: string; title: string; tags: string[]; excerpt?: string }> = [];
        const add = (result: SearchRow | PageRow, excerpt?: string) => {
          if (!result?.slug || !result.title || !Array.isArray(result.tags)) return;
          if (seen.has(result.slug)) return;
          seen.add(result.slug);
          merged.push({
            slug: result.slug,
            title: redact(result.title),
            tags: result.tags!,
            excerpt: excerpt ? redact(excerpt) : undefined,
          });
        };
        // Interleave keyword patterns so the first, cleanest pattern cannot
        // crowd out what the expansions found.
        for (let rank = 0; rank < 6; rank++) {
          for (const results of textResults) {
            const result = results[rank];
            if (result) add(result, result.excerpt);
          }
        }
        for (const result of vectorResults) add(result);
        if (merged.length === 0) {
          return { results: [], hint: "Nothing matched. Try fewer or different words, a synonym, or the PAGE INDEX." };
        }
        return merged.slice(0, SEARCH_RESULT_LIMIT);
      },
    },
    grep_wiki: {
      description:
        "Find exact text across every page (case-insensitive literal match, like grep). Best for names, drugs, genes, " +
        "test names, trial IDs, dates and numbers. Returns matching lines with the section anchor to cite.",
      inputSchema: z.object({
        text: z.string().min(2).describe('Exact text to find, e.g. "olaparib" or "Ki-67"'),
        folder: z.string().optional().describe('Only pages under this folder, e.g. "sources/meeting-notes"'),
      }),
      execute: async ({ text, folder }: { text: string; folder?: string }) => {
        const pages = await documents.searchablePages?.().catch(() => null);
        if (!pages) return { error: "Exact-text search is not available right now. Use search_wiki instead." };
        const result = grepSearchablePages(pages, text, folder);
        return result.total_pages
          ? result
          : { ...result, hint: "No page contains that exact text. Try a shorter or alternative spelling, or search_wiki." };
      },
    },
    read_page: {
      description:
        'Read a wiki page by slug. Add "#anchor" to start at a section. Long pages return one part at a time with ' +
        "truncated: true, a sections outline and next_offset; pass offset to continue reading.",
      inputSchema: z.object({
        slug: z.string().describe('Page slug, optionally with a section, e.g. "wiki/treatment/plan#surgery"'),
        offset: z.number().int().min(0).optional().describe("Character offset to read from (from next_offset or a section)"),
      }),
      execute: async ({ slug, offset }: { slug: string; offset?: number }) =>
        readChatPageFromDocuments(documents, slug, { patterns: piiPatterns, offset }),
    },
    find_in_page: {
      description:
        "Find where a page mentions specific words (all words, case-insensitive). Returns excerpts with their section " +
        "anchors. Use on long pages, transcripts and reports instead of reading them end to end.",
      inputSchema: z.object({
        slug: z.string().describe("Page slug"),
        query: z.string().describe("One or a few words that must appear together"),
      }),
      execute: async ({ slug, query }: { slug: string; query: string }) =>
        findInChatPage(documents, slug, query, { patterns: piiPatterns }),
    },
    list_pages: {
      description: "List all available wiki pages.",
      inputSchema: z.object({}),
      execute: async () => (await documents.list()).map(redactListing),
    },
    get_pages_by_tag: {
      description: "Find all pages that have a specific tag.",
      inputSchema: z.object({ tag: z.string().describe("The tag to search for") }),
      execute: async ({ tag }: { tag: string }) => (await documents.getByTag({ tag })).map(redactListing),
    },
    list_tags: {
      description: "List all tags used across the wiki.",
      inputSchema: z.object({}),
      execute: () => documents.listTags(),
    },
  } satisfies ToolSet;
}

/**
 * On the last allowed step the model may not call tools, so a long search
 * always ends in an answer instead of an empty reply.
 */
export function wikiChatPrepareStep({ stepNumber, messages }: { stepNumber: number; messages: ModelMessage[] }) {
  return {
    // Mark the newest message so the next step reads everything before it
    // (pages already fetched) from Anthropic's prompt cache. Other providers
    // ignore the marker and cache prefixes on their own.
    messages: withCacheMarker(messages),
    ...(stepNumber >= WIKI_CHAT_MAX_STEPS - 1 ? { toolChoice: "none" as const, activeTools: [] as never[] } : {}),
  };
}

const CACHE_MARKER = { anthropic: { cacheControl: { type: "ephemeral" } } } as const;

function withCacheMarker(messages: ModelMessage[]): ModelMessage[] {
  const last = messages.at(-1);
  if (!last) return messages;
  const marked = {
    ...last,
    providerOptions: { ...last.providerOptions, anthropic: { ...last.providerOptions?.anthropic, ...CACHE_MARKER.anthropic } },
  } as ModelMessage;
  return [...messages.slice(0, -1), marked];
}

/** The system prompt (rules, diagnosis, page index) as one cached prefix. */
export function wikiChatSystem(prompt: string): SystemModelMessage {
  return { role: "system", content: prompt, providerOptions: CACHE_MARKER };
}

/**
 * Model, routing and loop settings shared by the route and the eval. `model`
 * pins one model with no fallbacks (the eval measures one model per row).
 */
export function wikiChatRunSettings({
  env = process.env,
  audience,
  model,
}: { env?: Record<string, string | undefined>; audience: WikiChatAudience; model?: string }) {
  const primary = model ?? wikiChatModel(env, audience);
  return {
    model: primary,
    audience,
    providerOptions: {
      gateway: wikiChatGatewayOptions(model ? [] : wikiChatFallbackModels(env, audience, primary)),
      // OpenAI summaries are opt-in; the provider's raw reasoning stays private.
      openai: { reasoningSummary: "auto" },
    },
    maxOutputTokens: 32_000,
    stopWhen: stepCountIs(WIKI_CHAT_MAX_STEPS),
    prepareStep: wikiChatPrepareStep,
  };
}

/** Shown and saved when a run ends without any answer text. */
export const WIKI_CHAT_EMPTY_ANSWER =
  "I couldn't finish an answer to that. Please try again, or ask a narrower question.";
