/**
 * Durable workflow for generating and storing OpenAI embeddings.
 *
 * Replaces the build-time ingest-embeddings.ts script. Runs post-deploy so it
 * doesn't block next build — embeddings only power semantic search, not page
 * rendering. Documents whose contentHash matches their embeddingHash are skipped
 * (already up to date).
 *
 * Steps:
 *   1. collectDocsToEmbed  — paginate embeddingStatusPage, return slugs needing work
 *   2. embedBatch (×N)     — fetch content, call OpenAI, store embedding
 *
 * Each step is independently retryable. If OpenAI rate-limits a batch, only
 * that batch retries.
 */

import { FatalError, RetryableError } from "workflow";

const BATCH_SIZE = 50;
const MAX_CHARS = 20_000;

// ─── steps ───────────────────────────────────────────────────────────────────

async function collectDocsToEmbed(): Promise<Array<{ slug: string; contentHash: string | undefined }>> {
  "use step";
  const { fetchQuery } = await import("convex/nextjs");
  const { api } = await import("../../convex/_generated/api");

  type StatusPage = {
    page: Array<{ slug: string; contentHash: string | undefined; embeddingHash: string | undefined }>;
    isDone: boolean;
    continueCursor: string;
  };

  const toEmbed: Array<{ slug: string; contentHash: string | undefined }> = [];
  let cursor: string | null = null;
  let isDone = false;
  let total = 0;

  while (!isDone) {
    const page = (await fetchQuery(api.documents.embeddingStatusPage, {
      cursor,
      numItems: 100,
    })) as StatusPage;

    for (const doc of page.page) {
      total++;
      if (!doc.embeddingHash || doc.contentHash !== doc.embeddingHash) {
        toEmbed.push({ slug: doc.slug, contentHash: doc.contentHash });
      }
    }

    isDone = page.isDone;
    cursor = page.continueCursor;
  }

  console.log(`[ingest-embeddings] ${toEmbed.length} of ${total} docs need embeddings`);
  return toEmbed;
}

async function embedBatch(
  docs: Array<{ slug: string; contentHash: string | undefined }>
): Promise<number> {
  "use step";

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new FatalError("OPENAI_API_KEY not set");

  const { fetchQuery, fetchMutation } = await import("convex/nextjs");
  const { api } = await import("../../convex/_generated/api");
  const OpenAI = (await import("openai")).default;
  const openai = new OpenAI({ apiKey: openaiKey });

  // Fetch full content for each slug in parallel
  const contents = await Promise.all(
    docs.map(async ({ slug, contentHash }) => {
      const doc = await fetchQuery(api.documents.getBySlug, { slug });
      if (!doc) return null;
      return {
        slug,
        contentHash,
        text: `${doc.title}\n\n${doc.content}`.slice(0, MAX_CHARS),
      };
    })
  );
  const valid = contents.filter((d): d is NonNullable<typeof d> => d !== null);
  if (valid.length === 0) return 0;

  // Generate embeddings — retry on rate-limit
  let embeddings: (number[] | null)[];
  try {
    const res = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: valid.map((d) => d.text),
    });
    embeddings = res.data.map((d) => d.embedding);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("429") || msg.toLowerCase().includes("rate")) {
      throw new RetryableError(`OpenAI rate limited: ${msg}`, { retryAfter: "30s" });
    }
    // Fall back to one-by-one to isolate bad inputs
    embeddings = await Promise.all(
      valid.map(async ({ text, slug }) => {
        try {
          const res = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: text.slice(0, MAX_CHARS),
          });
          return res.data[0].embedding;
        } catch (e) {
          console.warn(`[ingest-embeddings] Skipping ${slug}: ${(e as Error).message}`);
          return null;
        }
      })
    );
  }

  // Store embeddings back to Convex
  let stored = 0;
  await Promise.all(
    valid.map(async ({ slug, contentHash }, i) => {
      const emb = embeddings[i];
      if (!emb) return;
      await fetchMutation(api.documents.upsertEmbedding, {
        slug,
        embedding: emb,
        embeddingHash: contentHash,
      });
      stored++;
    })
  );

  console.log(`[ingest-embeddings] Batch: ${stored}/${valid.length} stored`);
  return stored;
}

// ─── workflow orchestrator ────────────────────────────────────────────────────

export async function ingestEmbeddingsWorkflow() {
  "use workflow";

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    console.log("[ingest-embeddings] OPENAI_API_KEY not set — skipping");
    return;
  }

  console.log("[ingest-embeddings] Workflow started");
  const t0 = Date.now();

  const docs = await collectDocsToEmbed();
  if (docs.length === 0) {
    console.log("[ingest-embeddings] All embeddings up to date");
    return;
  }

  let totalStored = 0;
  let batchNum = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const stored = await embedBatch(docs.slice(i, i + BATCH_SIZE));
    totalStored += stored;
    console.log(`[ingest-embeddings] Batch ${++batchNum}/${Math.ceil(docs.length / BATCH_SIZE)}: ${totalStored} total stored`);
  }

  console.log(`[ingest-embeddings] Complete: ${totalStored}/${docs.length} embeddings stored in ${Date.now() - t0}ms`);
}
