import {
  streamText,
  stepCountIs,
  convertToModelMessages,
  type UIMessage,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import {
  getMarkdownFile,
  getAllSlugs,
  getAllTags,
  getPagesByTag,
} from "@/lib/markdown";
import { searchMarkdown } from "@/lib/search";

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const SYSTEM_PROMPT = `You are a research assistant for Diana's TNBC (triple-negative breast cancer) knowledge base. You help answer questions about Diana's diagnosis, treatment plan, research, and related medical topics.

You have access to tools that let you search and read wiki pages. Use them to find relevant information before answering. Always ground your answers in the wiki content when possible.

When citing information, mention which page it came from so the user can navigate there.

Key context:
- Patient: Diana Laster, age 36, diagnosed March 2026
- Diagnosis: Stage III TNBC, invasive ductal carcinoma, Grade 3
- Protocol: KEYNOTE-522 (Carboplatin + Paclitaxel + Pembrolizumab → AC)
- Care center: UCSF

Be direct, compassionate, and precise. Use medical terminology but explain it when needed.`;

export async function POST(request: Request) {
  const { messages } = (await request.json()) as {
    messages: UIMessage[];
  };

  const modelMessages = await convertToModelMessages(messages);

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
  });

  return result.toUIMessageStreamResponse();
}
