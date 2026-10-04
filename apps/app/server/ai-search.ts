import { generateText, Output } from "ai";
import { ConvexHttpClient } from "convex/browser";
import OpenAI from "openai";
import { z } from "zod";
import { applyPiiRedactions, parseSitePiiPatterns } from "@oncobase/wiki-content/pii";
import { api } from "../convex/_generated/api.js";
import { traceBackendPhase } from "./backend-tracing";

const MAX_CANDIDATES = 12;
// Every candidate is scored concurrently: one round trip, not three rounds.
const SCORE_CONCURRENCY = 12;
const SCORE_TIMEOUT_MS = 20_000;
const TEXT_MODEL = "openai/gpt-5.4-mini";
const EMBEDDING_MODEL = "text-embedding-3-small";

const scoreSchema = z.object({
  relevance: z.number().min(0).max(10),
  summary: z.string().describe("1-2 sentence summary of why this page is relevant"),
});

let openaiClient: OpenAI | null = null;

type SearchScope = "public" | "session";

function requestedSearchScope(request: Request): SearchScope {
  return new URL(request.url).searchParams.get("scope") === "session"
    ? "session"
    : "public";
}

function searchHeaders(scope: SearchScope) {
  return {
    "Cache-Control": "private, no-store",
    Vary: scope === "session" ? "Accept, Cookie, Host" : "Accept, Host",
    "X-Wiki-Cache-Scope": scope,
  };
}

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
  const response = await traceBackendPhase("external.openai", () => client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: query,
  }));
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

function isRateLimitMessage(message: string) {
  return message.includes("limit") || message.includes("402") || message.includes("403");
}

/** Run every task with at most `limit` in flight. The first rejection rejects
 * the whole run and stops starting new tasks, as sequential rounds did. */
async function mapConcurrent<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  let failed = false;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try { results[index] = await run(items[index]!); }
      catch (error) { failed = true; throw error; }
    }
  }));
  return results;
}

export async function handleAiSearchRequest({
  request,
  client,
  siteSlug,
  includeSensitive,
  allowedSensitiveSlugs,
  generate = generateText,
}: {
  request: Request;
  client: ConvexHttpClient;
  siteSlug: string;
  includeSensitive: boolean;
  /** One batched access evaluation for the reader; returns the allowed subset. */
  allowedSensitiveSlugs?: (slugs: string[]) => Promise<Set<string>>;
  generate?: typeof generateText;
}) {
  const scope = requestedSearchScope(request);
  const scopedIncludeSensitive = scope === "session" && includeSensitive;
  const responseHeaders = searchHeaders(scope);

  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      {
        status: 405,
        headers: { ...responseHeaders, Allow: "POST" },
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
      return Response.json({ results: [] }, { headers: responseHeaders });
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
        : fallbackTextSlugs(client, siteSlug, normalizedQuery, scopedIncludeSensitive),
      vectorSlugs(client, siteSlug, normalizedQuery, scopedIncludeSensitive),
      client.query(
        api.documents.getBySlug,
        withSiteSlug(siteSlug, {
          slug: "wiki/diagnostics/diagnosis",
          includeSensitive: scopedIncludeSensitive,
        }),
      ),
    ]);

    const fetchedDocs = await fetchCandidateDocs(
      client,
      siteSlug,
      [...textSlugs, ...semanticSlugs],
      scopedIncludeSensitive,
    );
    // One access evaluation covers every sensitive candidate and the context page.
    const sensitiveSlugs = [...new Set([...fetchedDocs, diagnosisDoc]
      .filter(doc => doc?.sensitive === true).map(doc => doc!.slug))];
    const allowed = sensitiveSlugs.length > 0 && allowedSensitiveSlugs
      ? await allowedSensitiveSlugs(sensitiveSlugs)
      : new Set<string>();
    const isVisible = (doc: { slug: string; sensitive?: boolean }) => doc.sensitive !== true || allowed.has(doc.slug);
    const candidateDocs = fetchedDocs.filter(isVisible);

    if (candidateDocs.length === 0) {
      return Response.json({ results: [] }, { headers: responseHeaders });
    }

    const visibleDiagnosisDoc = diagnosisDoc && isVisible(diagnosisDoc) ? diagnosisDoc : null;
    const diagnosisContext = visibleDiagnosisDoc
      ? redact(visibleDiagnosisDoc.content).slice(0, 1500)
      : "Stage III TNBC, IDC Grade 3, KEYNOTE-522 protocol";

    // A quota or authorization failure aborts the remaining calls.
    const fatal = new AbortController();
    const scored = await traceBackendPhase("external.ai-gateway", () => mapConcurrent(
      candidateDocs,
      SCORE_CONCURRENCY,
      async (doc) => {
        try {
          const { output } = await generate({
            model: TEXT_MODEL,
            maxOutputTokens: 200,
            output: Output.object({ schema: scoreSchema }),
            abortSignal: AbortSignal.any([fatal.signal, AbortSignal.timeout(SCORE_TIMEOUT_MS)]),
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
            sensitive: Boolean(doc.sensitive),
            sources: [
              {
                label: "page",
                title: redact(doc.title),
                href: `/${doc.slug}`,
              },
            ],
            summary: output.summary,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (isRateLimitMessage(message)) {
            fatal.abort(error);
            throw error;
          }
          // A sibling's quota failure already decides the response.
          if (fatal.signal.aborted) throw error;
          console.error(`[wiki-vite-ai-search] scoring failed for ${doc.slug}:`, message);
          return null;
        }
      },
    ));

    const results = scored
      .filter((result): result is NonNullable<typeof result> =>
        Boolean(result && result.relevance >= 2),
      )
      .sort((a, b) => b.relevance - a.relevance);

    return Response.json(
      { results },
      { headers: responseHeaders },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI search failed";
    console.error("[wiki-vite-ai-search] request failed:", error);
    if (isRateLimitMessage(message)) {
      return Response.json(
        { results: [], error: "AI search quota or authorization failed." },
        { status: 402, headers: responseHeaders },
      );
    }
    return Response.json(
      { results: [], error: message },
      { status: 500, headers: responseHeaders },
    );
  }
}
