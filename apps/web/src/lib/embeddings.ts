import OpenAI from "openai";
import {
  countEmbeddingTokens,
  embedWithChunking,
  prepareForEmbedding,
  type EmbeddingsCreate,
} from "@diana-tnbc/wiki-content/embeddings";

export { countEmbeddingTokens, prepareForEmbedding };

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (client) return client;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not configured. Embeddings are only available at runtime.",
    );
  }

  client = new OpenAI({ apiKey });
  return client;
}

const createEmbeddings: EmbeddingsCreate = async (input) => {
  const response = await getClient().embeddings.create({
    model: "text-embedding-3-small",
    input,
  });
  return response.data.map((entry) => entry.embedding);
};

/**
 * Generate a single 1536-dim embedding for arbitrary-length text.
 * Long inputs are chunked on token boundaries and mean-pooled into one
 * vector. Inline base64 assets and oversized code blocks are stripped
 * from the embedding input only.
 */
export async function embed(text: string): Promise<number[]> {
  return embedWithChunking(text, createEmbeddings);
}

/**
 * Generate embeddings for multiple texts. Each text is chunked and
 * pooled independently; callers concerned about throughput should
 * parallelize across embedBatch invocations.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  return Promise.all(texts.map((text) => embed(text)));
}
