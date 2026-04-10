/**
 * Generate and store embeddings for documents in Convex.
 * Skips documents whose content hasn't changed since last embedding.
 *
 * Usage: bun scripts/ingest-embeddings.ts [--force]
 *
 * Requires OPENAI_API_KEY and NEXT_PUBLIC_CONVEX_URL env vars.
 */
import path from "path";
import dotenv from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import OpenAI from "openai";
import { api } from "../convex/_generated/api";

dotenv.config({ path: path.join(__dirname, "..", ".env.local") });
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!CONVEX_URL) {
  console.error("NEXT_PUBLIC_CONVEX_URL not set");
  process.exit(1);
}

const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) {
  console.error("OPENAI_API_KEY not set — skipping embedding generation");
  process.exit(0);
}

const client = new ConvexHttpClient(CONVEX_URL);
const openai = new OpenAI({ apiKey: OPENAI_KEY });
const force = process.argv.includes("--force");

const BATCH_SIZE = 50;
const MAX_CHARS = 20000;

async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  const truncated = texts.map((t) => t.slice(0, MAX_CHARS));
  try {
    const res = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: truncated,
    });
    return res.data.map((d) => d.embedding);
  } catch {
    console.log("    Batch failed, falling back to individual embeddings...");
    return Promise.all(
      truncated.map(async (t) => {
        try {
          const res = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: t.slice(0, MAX_CHARS),
          });
          return res.data[0].embedding;
        } catch (e) {
          console.warn(`    Skipping text (${t.length} chars): ${(e as Error).message}`);
          return null;
        }
      })
    );
  }
}

async function main() {
  // Fetch embedding status to determine which docs need re-embedding
  const status = await client.action(api.documents.embeddingStatus, {});
  console.log(`Found ${status.length} documents`);

  const toEmbed: Array<{ slug: string; contentHash: string | undefined }> = [];
  let skipped = 0;

  for (const doc of status) {
    if (!force && doc.embeddingHash && doc.contentHash === doc.embeddingHash) {
      skipped++;
      continue;
    }
    toEmbed.push({ slug: doc.slug, contentHash: doc.contentHash });
  }

  if (toEmbed.length === 0) {
    console.log(`All ${skipped} documents already have up-to-date embeddings. Nothing to do.`);
    return;
  }

  console.log(`Skipped ${skipped} unchanged, generating embeddings for ${toEmbed.length} documents...`);

  let processed = 0;
  for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
    const batch = toEmbed.slice(i, i + BATCH_SIZE);

    // Fetch full content for this batch
    const docs = await Promise.all(
      batch.map(async (b) => {
        const full = await client.query(api.documents.getBySlug, { slug: b.slug });
        return full ? { slug: b.slug, contentHash: b.contentHash, text: `${full.title}\n\n${full.content}`.slice(0, 32000) } : null;
      })
    );

    const validDocs = docs.filter((d): d is NonNullable<typeof d> => d !== null);
    const embeddings = await embedBatch(validDocs.map((d) => d.text));

    await Promise.all(
      validDocs.map((doc, j) => {
        const emb = embeddings[j];
        if (!emb) return Promise.resolve();
        return client.mutation(api.documents.upsertEmbedding, {
          slug: doc.slug,
          embedding: emb,
          embeddingHash: doc.contentHash,
        });
      })
    );

    processed += validDocs.length;
    console.log(`  Embedded ${processed}/${toEmbed.length}`);
  }

  console.log("Done!");
}

main().catch((err) => {
  console.warn("Embedding ingestion failed (non-fatal):", (err as Error).message);
  process.exit(0);
});
