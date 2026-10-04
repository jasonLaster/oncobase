import { expect, test } from "bun:test";
import { getFunctionName, type FunctionReference } from "convex/server";
import { handleAiSearchRequest } from "./ai-search";

delete process.env.OPENAI_API_KEY;

type Doc = { slug: string; title: string; content: string; tags: string[]; sensitive?: boolean };

const docs: Doc[] = [
  ...Array.from({ length: 10 }, (_, index) => ({ slug: `wiki/page-${index}`, title: `Page ${index}`, content: "body", tags: [] })),
  { slug: "private/allowed", title: "Allowed", content: "private body", tags: [], sensitive: true },
  { slug: "private/denied", title: "Denied", content: "denied body", tags: [], sensitive: true },
];

function fakeClient(calls: string[] = []) {
  return {
    async query(ref: FunctionReference<"query">, args: Record<string, unknown>) {
      const name = getFunctionName(ref);
      calls.push(name);
      if (name === "sites:getBySlug") return { config: {} };
      if (name === "documents:search") return docs.map(doc => ({ slug: doc.slug }));
      if (name === "documents:getBySlug") return docs.find(doc => doc.slug === args.slug) ?? null;
      throw new Error(`Unexpected query ${name}`);
    },
    async action() { throw new Error("Unexpected action"); },
  };
}

const aiRequest = () => new Request("http://127.0.0.1/api/ai-search?scope=session", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: "treatment" }),
});

type Generate = NonNullable<Parameters<typeof handleAiSearchRequest>[0]["generate"]>;

test("AI search scores every visible candidate concurrently after one batched access check", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const scoredSlugs: string[] = [];
  const accessChecks: string[][] = [];
  const generate = (async ({ prompt, abortSignal }: { prompt: string; abortSignal?: AbortSignal }) => {
    expect(abortSignal).toBeInstanceOf(AbortSignal);
    scoredSlugs.push(/\(([^)]+)\)\nTags/.exec(prompt)![1]!);
    maxInFlight = Math.max(maxInFlight, ++inFlight);
    await Bun.sleep(5);
    inFlight--;
    return { output: { relevance: 6, summary: "relevant" } };
  }) as unknown as Generate;

  const response = await handleAiSearchRequest({
    request: aiRequest(),
    client: fakeClient() as never,
    siteSlug: "test",
    includeSensitive: true,
    allowedSensitiveSlugs: async (slugs) => {
      accessChecks.push(slugs);
      return new Set(slugs.filter(slug => slug !== "private/denied"));
    },
    generate,
  });

  expect(response.status).toBe(200);
  const { results } = await response.json() as { results: Array<{ slug: string }> };
  expect(accessChecks).toEqual([["private/allowed", "private/denied"]]);
  expect(results).toHaveLength(11);
  expect(scoredSlugs).not.toContain("private/denied");
  // Eleven candidates in one round, not three sequential rounds of four.
  expect(maxInFlight).toBe(11);
});

test("an AI quota failure aborts sibling scoring calls and returns 402", async () => {
  const signals: AbortSignal[] = [];
  const generate = (async ({ prompt, abortSignal }: { prompt: string; abortSignal: AbortSignal }) => {
    signals.push(abortSignal);
    if (prompt.includes("(wiki/page-0)")) {
      await Bun.sleep(1);
      throw new Error("rate limit exceeded");
    }
    await new Promise((_, reject) => abortSignal.addEventListener("abort", () => reject(abortSignal.reason)));
    throw new Error("unreachable");
  }) as unknown as Generate;

  const originalError = console.error;
  console.error = () => undefined;
  const response = await handleAiSearchRequest({
    request: aiRequest(),
    client: fakeClient() as never,
    siteSlug: "test",
    includeSensitive: false,
    generate,
  }).finally(() => { console.error = originalError; });

  expect(response.status).toBe(402);
  expect(signals.length).toBe(10);
  expect(signals.every(signal => signal.aborted)).toBe(true);
});

test("ordinary scoring failures drop only that candidate", async () => {
  const generate = (async ({ prompt }: { prompt: string }) => {
    if (prompt.includes("(wiki/page-1)")) throw new Error("model returned invalid JSON");
    return { output: { relevance: 5, summary: "ok" } };
  }) as unknown as Generate;
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const response = await handleAiSearchRequest({
      request: aiRequest(),
      client: fakeClient() as never,
      siteSlug: "test",
      includeSensitive: false,
      generate,
    });
    const { results } = await response.json() as { results: Array<{ slug: string }> };
    expect(response.status).toBe(200);
    expect(results.map(result => result.slug)).not.toContain("wiki/page-1");
    expect(results).toHaveLength(9);
  } finally {
    console.error = originalError;
  }
});
