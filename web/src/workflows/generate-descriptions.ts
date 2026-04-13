/**
 * Durable workflow for generating AI descriptions for wiki pages.
 *
 * Triggered post-deploy via /api/warm-cache. For each page in Convex that
 * lacks a description, calls OpenRouter to generate one and saves it back.
 * Already-described pages are skipped (idempotent).
 */

import { FatalError } from "workflow";

interface DocPage {
  slug: string;
  title: string;
  description: string | null;
  content: string;
}

async function fetchPagesBatch(cursor: string | null): Promise<{
  page: DocPage[];
  isDone: boolean;
  continueCursor: string;
}> {
  "use step";
  const { fetchQuery } = await import("convex/nextjs");
  const { api } = await import("../../convex/_generated/api");

  type PageResult = {
    page: Array<{ slug: string; title: string; description?: string | null; content: string }>;
    isDone: boolean;
    continueCursor: string;
  };

  const result = (await fetchQuery(api.documents.listPageWithDescriptions, {
    cursor,
    numItems: 50,
  })) as PageResult;

  return {
    page: result.page.map((d) => ({
      slug: d.slug,
      title: d.title,
      description: d.description ?? null,
      content: d.content,
    })),
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}

async function generateAndSaveBatch(docs: Array<{ slug: string; title: string; content: string }>): Promise<number> {
  "use step";

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new FatalError("OPENROUTER_API_KEY not set");

  const { fetchMutation } = await import("convex/nextjs");
  const { api } = await import("../../convex/_generated/api");
  const { createOpenAI } = await import("@ai-sdk/openai");
  const { generateText } = await import("ai");

  const openrouter = createOpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
  });

  let saved = 0;
  await Promise.all(
    docs.map(async (doc) => {
      try {
        const { text } = await generateText({
          model: openrouter.chat("openai/gpt-4.1-mini"),
          maxOutputTokens: 80,
          system:
            "You write one-sentence descriptions for wiki pages in a breast cancer research knowledge base. Write a single sentence (max 155 characters) summarizing what the page covers. No quotes, no trailing period required.",
          prompt: `Page title: ${doc.title}\n\nContent:\n${doc.content.slice(0, 2000)}`,
        });
        const description = text.trim();
        if (!description) return;
        await fetchMutation(api.documents.setDescription, { slug: doc.slug, description });
        saved++;
      } catch (err) {
        console.warn(`[generate-descriptions] Failed for ${doc.slug}:`, err);
      }
    })
  );

  return saved;
}

export async function generateDescriptionsWorkflow() {
  "use workflow";

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.log("[generate-descriptions] OPENROUTER_API_KEY not set — skipping");
    return;
  }

  console.log("[generate-descriptions] Workflow started");

  let cursor: string | null = null;
  let isDone = false;
  let totalSaved = 0;
  let totalSkipped = 0;
  let batchNum = 0;

  while (!isDone) {
    const { page, isDone: done, continueCursor } = await fetchPagesBatch(cursor);
    isDone = done;
    cursor = continueCursor;

    const needsDescription = page.filter((d) => !d.description);
    totalSkipped += page.length - needsDescription.length;

    if (needsDescription.length > 0) {
      const saved = await generateAndSaveBatch(needsDescription);
      totalSaved += saved;
    }

    console.log(`[generate-descriptions] Batch ${++batchNum}: ${needsDescription.length} generated, ${page.length - needsDescription.length} skipped`);
  }

  console.log(`[generate-descriptions] Complete: ${totalSaved} saved, ${totalSkipped} already had descriptions`);
}
