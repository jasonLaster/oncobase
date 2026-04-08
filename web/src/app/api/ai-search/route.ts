import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";

function getConvex() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return new ConvexHttpClient(url);
}

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const scoreSchema = z.object({
  relevance: z.number().min(0).max(10),
  summary: z.string().describe("1-2 sentence summary of why this page is relevant"),
});

export async function POST(request: Request) {
  const { query, slugs } = (await request.json()) as {
    query: string;
    slugs: string[];
  };

  if (!query || slugs.length === 0) {
    return Response.json({ results: [] });
  }

  const convex = getConvex();

  // Fetch diagnosis context and doc content in parallel
  const [diagnosisDoc, ...docs] = await Promise.all([
    convex.query(api.documents.getBySlug, { slug: "wiki/diagnostics/diagnosis" }),
    ...slugs.slice(0, 12).map((slug) =>
      convex.query(api.documents.getBySlug, { slug })
    ),
  ]);

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
              model: openrouter.chat("openai/gpt-5.4-mini"),
              maxOutputTokens: 200,
              schema: scoreSchema,
              prompt: `You are evaluating a search result for the query: "${query}"

Diana's diagnosis context:
${diagnosisContext}

Document: "${doc.title}" (${doc.slug})
Tags: ${doc.tags.join(", ") || "none"}
Content preview:
${doc.content.slice(0, 800)}

Score this document's relevance to the query (0-10) and write a 1-2 sentence summary of why it's relevant to Diana's case.`,
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
        { results: [], error: "API key limit reached. Increase your limit at openrouter.ai/settings/keys." },
        { status: 402 }
      );
    }
    return Response.json({ results: [], error: msg }, { status: 500 });
  }

  const results = allScored
    .filter((r): r is NonNullable<typeof r> => r !== null && r.relevance >= 3)
    .sort((a, b) => b.relevance - a.relevance);

  return Response.json({ results });
}
