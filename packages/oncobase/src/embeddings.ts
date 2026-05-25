import OpenAI from "openai";
import { Tiktoken } from "js-tiktoken/lite";
import cl100k_base from "js-tiktoken/ranks/cl100k_base";

let client: OpenAI | null = null;

function getClient() {
  if (client) return client;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  client = new OpenAI({ apiKey });
  return client;
}

const EMBED_MAX_TOKENS = 7_500;
const CODE_BLOCK_MAX_CHARS = 2_000;

let encoder: Tiktoken | null = null;
function getEncoder() {
  if (!encoder) encoder = new Tiktoken(cl100k_base);
  return encoder;
}

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

export async function embedBatch(texts: string[]): Promise<number[][]> {
  return Promise.all(texts.map((t) => embed(t)));
}

