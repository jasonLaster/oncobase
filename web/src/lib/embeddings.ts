import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Generate an embedding for a text string using OpenAI text-embedding-3-small.
 * Returns a 1536-dimensional float64 array.
 */
export async function embed(text: string): Promise<number[]> {
  // Truncate to ~8000 tokens worth of text (~32k chars) to stay within limits
  const truncated = text.slice(0, 24000);
  const res = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: truncated,
  });
  return res.data[0].embedding;
}

/**
 * Generate embeddings for multiple texts in a single batch request.
 * Returns an array of 1536-dimensional float64 arrays.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const truncated = texts.map((t) => t.slice(0, 32000));
  const res = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: truncated,
  });
  return res.data.map((d) => d.embedding);
}
