import OpenAI from "openai";
import { Tiktoken } from "js-tiktoken/lite";
import cl100k_base from "js-tiktoken/ranks/cl100k_base";

let client: OpenAI | null = null;

function getClient() {
  if (client) {
    return client;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not configured. Embeddings are only available at runtime.",
    );
  }

  client = new OpenAI({ apiKey });
  return client;
}

// text-embedding-3-* caps each input at 8192 tokens. Stay safely
// under that for the input itself plus any tokenizer drift between
// js-tiktoken and OpenAI's server.
const EMBED_MAX_TOKENS = 7_500;
const CODE_BLOCK_MAX_CHARS = 2_000;

let encoder: Tiktoken | null = null;
function getEncoder() {
  if (!encoder) encoder = new Tiktoken(cl100k_base);
  return encoder;
}

// Strip embedding-irrelevant noise. The full markdown still goes to
// /api/publish/document — only the embedding input is cleaned. The big
// offender is base64-encoded inline images, where each char is ~1 token.
export function prepareForEmbedding(text: string): string {
  return text
    .replace(/data:[^)\s"']+/g, "[inline-asset]")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "[svg]")
    .replace(/```[\s\S]*?```/g, (block) =>
      block.length > CODE_BLOCK_MAX_CHARS
        ? "```\n[code block omitted]\n```"
        : block,
    );
}

function chunkByTokens(text: string, maxTokens: number): string[] {
  const enc = getEncoder();
  const tokens = enc.encode(text);
  if (tokens.length <= maxTokens) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < tokens.length; i += maxTokens) {
    chunks.push(enc.decode(tokens.slice(i, i + maxTokens)));
  }
  return chunks;
}

export function countEmbeddingTokens(text: string): number {
  return getEncoder().encode(prepareForEmbedding(text)).length;
}

function meanPool(vectors: number[][]): number[] {
  const dim = vectors[0].length;
  const sum = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) sum[i] += v[i];
  }
  for (let i = 0; i < dim; i++) sum[i] /= vectors.length;
  let mag = 0;
  for (const x of sum) mag += x * x;
  mag = Math.sqrt(mag) || 1;
  return sum.map((x) => x / mag);
}

/**
 * Generate a single 1536-dim embedding for arbitrary-length text.
 * Long inputs are chunked on token boundaries and mean-pooled into one
 * vector. Inline base64 assets and oversized code blocks are stripped
 * from the embedding input only.
 */
export async function embed(text: string): Promise<number[]> {
  const client = getClient();
  const prepared = prepareForEmbedding(text);
  const chunks = chunkByTokens(prepared, EMBED_MAX_TOKENS);
  const res = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: chunks,
  });
  const vectors = res.data.map((d) => d.embedding);
  return vectors.length === 1 ? vectors[0] : meanPool(vectors);
}

/**
 * Generate embeddings for multiple texts. Each text is chunked and
 * pooled independently; callers concerned about throughput should
 * parallelize across embedBatch invocations.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  return Promise.all(texts.map((t) => embed(t)));
}
