import { generateText, Output } from "ai";
import { ConvexHttpClient } from "convex/browser";
import OpenAI from "openai";
import { z } from "zod";
import { applyPiiRedactions, parseSitePiiPatterns } from "../../../packages/wiki-content/src/pii.js";
import { api } from "../../../web/convex/_generated/api.js";

const MAX_CANDIDATES = 12;
const SCORE_BATCH_SIZE = 4;
const TEXT_MODEL = "openai/gpt-5.4-mini";
const EMBEDDING_MODEL = "text-embedding-3-small";

const scoreSchema = z.object({
  relevance: z.number().min(0).max(10),
  summary: z.string().describe("1-2 sentence summary of why this page is relevant"),
});

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

function compactSlugs(slugs: string[]) {
  return Array.from(
    new Set(slugs.map((slug) => slug.trim()).filter(Boolean)),
  ).slice(0, MAX_CANDIDATES);
}

async function fallbackTextSlugs(
  client: ConvexHttpClient,
  siteSlug: string,
  query: string,
  includeSensitive: boolean,
) {
  const results = await client.query(
    api.documents.search,
    withSiteSlug(siteSlug, {
      query,
      limit: MAX_CANDIDATES,
      includeSensitive,
    }),
  );
  return results.map((result) => result.slug);
}

async function vectorSlugs(
  client: ConvexHttpClient,
  siteSlug: string,
  query: string,
  includeSensitive: boolean,
) {
  const embedding = await embedQuery(query);
  if (!embedding) return [];
  const results = await client.action(
    api.documents.vectorSearch,
    withSiteSlug(siteSlug, {
      embedding,
      limit: MAX_CANDIDATES,
      includeSensitive,
    }),
  );
  return results.map((result) => result.slug);
}

async function fetchCandidateDocs(
  client: ConvexHttpClient,
  siteSlug: string,
  slugs: string[],
  includeSensitive: boolean,
) {
  const docs = await Promise.all(
    compactSlugs(slugs).map((slug) =>
      client.query(
        api.documents.getBySlug,
        withSiteSlug(siteSlug, { slug, includeSensitive }),
      ),
    ),
  );
  return docs.filter((doc): doc is NonNullable<(typeof docs)[number]> => doc !== null);
}

export async function handleAiSearchRequest({
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
      {
        status: 405,
        headers: { Allow: "POST" },
      },
    );
  }

  try {
    const { query, slugs = [] } = (await request.json()) as {
      query?: string;
      slugs?: string[];
    };
    const normalizedQuery = query?.trim() ?? "";
    if (!normalizedQuery) {
      return Response.json({ results: [] });
    }

    const site = await client.query(api.sites.getBySlug, { slug: siteSlug });
    const configuredPiiPatterns = parseSitePiiPatterns(site?.config.piiPatterns);
    const piiPatterns = configuredPiiPatterns.length > 0
      ? configuredPiiPatterns
      : siteSlug === "diana"
        ? undefined
        : [];
    const redact = (text: string) => applyPiiRedactions(text, { patterns: piiPatterns });

    const [textSlugs, semanticSlugs, diagnosisDoc] = await Promise.all([
      slugs.length > 0
        ? Promise.resolve(slugs)
        : fallbackTextSlugs(client, siteSlug, normalizedQuery, includeSensitive),
      vectorSlugs(client, siteSlug, normalizedQuery, includeSensitive),
      client.query(
        api.documents.getBySlug,
        withSiteSlug(siteSlug, {
          slug: "wiki/diagnostics/diagnosis",
          includeSensitive,
        }),
      ),
    ]);

    const candidateDocs = await fetchCandidateDocs(
      client,
      siteSlug,
      [...textSlugs, ...semanticSlugs],
      includeSensitive,
    );

    if (candidateDocs.length === 0) {
      return Response.json({ results: [] });
    }

    const diagnosisContext = diagnosisDoc
      ? redact(diagnosisDoc.content).slice(0, 1500)
      : "Stage III TNBC, IDC Grade 3, KEYNOTE-522 protocol";

    const scored: Array<{
      slug: string;
      title: string;
      tags: string[];
      relevance: number;
      summary: string;
    } | null> = [];

    for (let index = 0; index < candidateDocs.length; index += SCORE_BATCH_SIZE) {
      const batch = candidateDocs.slice(index, index + SCORE_BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (doc) => {
          try {
            const { output } = await generateText({
              model: TEXT_MODEL,
              maxOutputTokens: 200,
              output: Output.object({ schema: scoreSchema }),
              prompt: `You are evaluating a search result for the query: "${normalizedQuery}"

Patient diagnosis context:
${diagnosisContext}

Document: "${doc.title}" (${doc.slug})
Tags: ${doc.tags.join(", ") || "none"}
Content preview:
${redact(doc.content).slice(0, 800)}

Score this document's relevance to the query from 0 to 10. A score of 5+ means it directly addresses the query topic. A score of 3-4 means it is tangentially related. Write a 1-2 sentence summary explaining the relevance.`,
            });
            return {
              slug: doc.slug,
              title: redact(doc.title),
              tags: doc.tags,
              relevance: output.relevance,
              summary: output.summary,
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("limit") || message.includes("402") || message.includes("403")) {
              throw error;
            }
            console.error(`[wiki-vite-ai-search] scoring failed for ${doc.slug}:`, message);
            return null;
          }
        }),
      );
      scored.push(...batchResults);
    }

    const results = scored
      .filter((result): result is NonNullable<typeof result> =>
        Boolean(result && result.relevance >= 2),
      )
      .sort((a, b) => b.relevance - a.relevance);

    return Response.json(
      { results },
      {
        headers: includeSensitive
          ? {
              "Cache-Control": "private, no-store",
              Vary: "Accept, Cookie, Host",
              "X-Wiki-Cache-Scope": "session",
            }
          : {
              "Cache-Control": "private, no-store",
              Vary: "Accept, Host",
              "X-Wiki-Cache-Scope": "public",
            },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI search failed";
    console.error("[wiki-vite-ai-search] request failed:", error);
    if (message.includes("limit") || message.includes("402") || message.includes("403")) {
      return Response.json(
        { results: [], error: "AI search quota or authorization failed." },
        { status: 402 },
      );
    }
    return Response.json({ results: [], error: message }, { status: 500 });
  }
}
