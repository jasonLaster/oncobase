import { Tiktoken } from "js-tiktoken/lite";
import cl100k_base from "js-tiktoken/ranks/cl100k_base";

// text-embedding-3-* caps each input at 8192 tokens. Stay safely under that
// for the input itself plus any tokenizer drift between js-tiktoken and
// OpenAI's server.
export const EMBEDDING_MAX_TOKENS = 7_500;
const CODE_BLOCK_MAX_CHARS = 2_000;

let encoder: Tiktoken | null = null;
function getEncoder() {
  if (!encoder) encoder = new Tiktoken(cl100k_base);
  return encoder;
}

/**
 * Strip embedding-irrelevant noise. The full markdown still goes to the
 * publish pipeline — only the embedding input is cleaned. The big offender
 * is base64-encoded inline images, where each char is ~1 token.
 */
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

export function countEmbeddingTokens(text: string): number {
  return getEncoder().encode(prepareForEmbedding(text)).length;
}

export function chunkByTokens(text: string, maxTokens = EMBEDDING_MAX_TOKENS): string[] {
  const enc = getEncoder();
  const tokens = enc.encode(text);
  if (tokens.length <= maxTokens) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < tokens.length; i += maxTokens) {
    chunks.push(enc.decode(tokens.slice(i, i + maxTokens)));
  }
  return chunks;
}

function meanPool(vectors: number[][]): number[] {
  const dim = vectors[0].length;
  const sum = new Array<number>(dim).fill(0);
  for (const vector of vectors) {
    for (let i = 0; i < dim; i++) sum[i] += vector[i];
  }
  for (let i = 0; i < dim; i++) sum[i] /= vectors.length;
  let mag = 0;
  for (const value of sum) mag += value * value;
  mag = Math.sqrt(mag) || 1;
  return sum.map((value) => value / mag);
}

/**
 * Adapter callable supplied by the host. Receives one or more
 * pre-chunked, prepared text inputs and returns one embedding vector per
 * input. The host owns the OpenAI / Vercel AI Gateway client and is
 * responsible for picking the embedding model.
 */
export type EmbeddingsCreate = (input: string | string[]) => Promise<number[][]>;

/**
 * Generate a single embedding vector for arbitrary-length text. Long inputs
 * are chunked on token boundaries and mean-pooled into one vector. Inline
 * base64 assets and oversized code blocks are stripped before tokenization
 * to keep the input under the model's max-token cap.
 */
export async function embedWithChunking(
  text: string,
  createEmbeddings: EmbeddingsCreate,
): Promise<number[]> {
  const prepared = prepareForEmbedding(text);
  const chunks = chunkByTokens(prepared, EMBEDDING_MAX_TOKENS);
  const vectors = await createEmbeddings(chunks);
  if (vectors.length === 0) {
    throw new Error("Embedding host returned no vectors");
  }
  return vectors.length === 1 ? vectors[0] : meanPool(vectors);
}
