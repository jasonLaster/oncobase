import { generateObject } from "ai";
import { z } from "zod";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import { embed } from "@/lib/embeddings";
import { fastTextModel } from "@/lib/ai";

function getConvex() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return new ConvexHttpClient(url);
}

const scoreSchema = z.object({
  relevance: z.number().min(0).max(10),
  summary: z.string().describe("1-2 sentence summary of why this page is relevant"),
});

export async function POST(request: Request) {
  const { query, slugs } = (await request.json()) as {
    query: string;
    slugs: string[];
  };

  if (!query) {
    return Response.json({ results: [] });
  }

  const convex = getConvex();

  // Run vector search in parallel with text-based slug fetching
  // This ensures natural language queries find relevant docs even with 0 text matches
  const [queryEmbedding, diagnosisDoc] = await Promise.all([
    embed(query),
    convex.query(api.documents.getBySlug, { slug: "wiki/diagnostics/diagnosis" }),
  ]);

  const vectorResults = await convex.action(api.documents.vectorSearch, {
    embedding: queryEmbedding,
    limit: 12,
  });

  // Merge text-search slugs with vector-search slugs, deduplicating
  const mergedSlugs = new Set(slugs.slice(0, 12));
  for (const vr of vectorResults) {
    mergedSlugs.add(vr.slug);
  }
  const allSlugs = Array.from(mergedSlugs);

  if (allSlugs.length === 0) {
    return Response.json({ results: [] });
  }

  // Fetch doc content for all candidate slugs
  const docs = await Promise.all(
    allSlugs.map((slug) =>
      convex.query(api.documents.getBySlug, { slug })
    ),
  );

  const diagnosisContext = diagnosisDoc
    ? `Patient: Diana Laster, Age 36, Diagnosed March 2026\n${diagnosisDoc.content.slice(0, 1500)}`
    : "Patient: Diana Laster, Age 36, Stage III TNBC, IDC Grade 3, KEYNOTE-522 protocol";

  const docsWithContent = docs.filter(
    (d): d is NonNullable<typeof d> => d !== null
  );

  if (docsWithContent.length === 0) {
    return Response.json({ results: [] });
  }

  // Score each document in parallel (batches of 4 to avoid rate limits)
  const BATCH_SIZE = 4;
  const allScored: Array<{
    slug: string;
    title: string;
    tags: string[];
    relevance: number;
    summary: string;
  } | null> = [];

  try {
    for (let i = 0; i < docsWithContent.length; i += BATCH_SIZE) {
      const batch = docsWithContent.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (doc) => {
          try {
            const { object } = await generateObject({
              model: fastTextModel(),
              maxOutputTokens: 200,
              schema: scoreSchema,
              prompt: `You are evaluating a search result for the query: "${query}"

Diana's diagnosis context:
${diagnosisContext}

Document: "${doc.title}" (${doc.slug})
Tags: ${doc.tags.join(", ") || "none"}
Content preview:
${doc.content.slice(0, 800)}

Score this document's relevance to the query (0-10). A score of 5+ means it directly addresses the query topic. A score of 3-4 means it's tangentially related. Write a 1-2 sentence summary explaining the relevance.`,
            });
            return {
              slug: doc.slug,
              title: doc.title,
              tags: doc.tags,
              relevance: object.relevance,
              summary: object.summary,
            };
          } catch (e) {
            const msg = (e as Error).message ?? "";
            if (msg.includes("limit") || msg.includes("402") || msg.includes("403")) {
              throw e;
            }
            console.error(`AI scoring failed for ${doc.slug}:`, msg);
            return null;
          }
        })
      );
      allScored.push(...batchResults);
    }
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (msg.includes("limit") || msg.includes("402") || msg.includes("403")) {
      return Response.json(
        { results: [], error: "API key limit reached. Check your Vercel AI Gateway usage." },
        { status: 402 }
      );
    }
    return Response.json({ results: [], error: msg }, { status: 500 });
  }

  const results = allScored
    .filter((r): r is NonNullable<typeof r> => r !== null && r.relevance >= 2)
    .sort((a, b) => b.relevance - a.relevance);

  return Response.json({ results });
}
