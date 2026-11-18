import { expect, test } from "bun:test";
import type { Decide } from "@oncobase/education/decisions";
import type { ApiRouteRequest } from "../api-routes";
import { createPaletteRecommendHandler, WIKI_LAYOUT } from "./palette-recommend";

const post = (body: unknown, scope = "session") => ({
  request: new Request(`http://local/api/wiki/palette-recommend?scope=${scope}`, { method: "POST", body: JSON.stringify(body) }),
} as ApiRouteRequest);
const scores = (byName: Record<string, number>): Decide => async (_input, questions) => ({
  model: "typesafe-ai/jev",
  answers: new Map(questions.map(question => [question.name, { type: "score", name: question.name, score: byName[question.name] ?? 0 }])),
});
const candidates = [
  { slug: "sources/meeting-notes/05-13---tissue-sync-overview", title: "Tissue sync" },
  { slug: "wiki/care/tissue-and-data", title: "Tissue allocation plan", tags: ["tissue-allocation"] },
  { slug: "wiki/omics/specimen-to-sample-map", title: "Specimen-to-sample map" },
];

test("recommends the best page and its close neighbours, best first", async () => {
  let seen: Record<string, unknown> | undefined;
  const decide: Decide = async (input, questions, signal) => { seen = input; return scores({ p0: 1.0, p1: 1.4, p2: 1.3 })(input, questions, signal); };
  const response = await createPaletteRecommendHandler({ decide, semantic: async () => [] })(post({ query: "tissue overview", candidates }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ model: "typesafe-ai/jev", results: [{ slug: "wiki/care/tissue-and-data", score: 1.4 }, { slug: "wiki/omics/specimen-to-sample-map", score: 1.3 }] });
  expect(seen).toEqual({ reader_typed: "tissue overview", wiki_layout: WIKI_LAYOUT });
});

test("a clear winner leaves weaker matches out, and nothing related shows nothing", async () => {
  const winner = await createPaletteRecommendHandler({ decide: scores({ p0: 2.9, p1: 2.0 }), semantic: async () => [] })(post({ query: "mastectom path report", candidates }));
  expect((await winner.json()).results).toEqual([{ slug: candidates[0]!.slug, score: 2.9 }]);
  const none = await createPaletteRecommendHandler({ decide: scores({ p0: 1.1 }), semantic: async () => [] })(post({ query: "parking", candidates }));
  expect((await none.json()).results).toEqual([]);
});

test("semantic neighbours join the reader's candidates once each", async () => {
  let asked: string[] = [];
  const decide: Decide = async (input, questions, signal) => { asked = questions.map(question => question.instructions); return scores({ p3: 3 })(input, questions, signal); };
  const semantic = async () => [{ slug: candidates[1]!.slug, title: "dup" }, { slug: "wiki/omics/tissue-inventory", title: "Tissue inventory" }];
  const response = await createPaletteRecommendHandler({ decide, semantic })(post({ query: "tissue overview", candidates }));
  expect(asked).toHaveLength(4);
  expect(asked[3]).toContain("Tissue inventory");
  expect((await response.json()).results).toEqual([{ slug: "wiki/omics/tissue-inventory", score: 3 }]);
});

test("a slow semantic step is skipped rather than waited on", async () => {
  const semantic = () => new Promise<never>(() => {});
  const started = performance.now();
  const response = await createPaletteRecommendHandler({ decide: scores({ p1: 3 }), semantic })(post({ query: "tissue", candidates }));
  expect(response.status).toBe(200);
  expect(performance.now() - started).toBeLessThan(2_000);
});

test("off, malformed, oversized and failed requests", async () => {
  const off = await createPaletteRecommendHandler({ enabled: () => false })(post({ query: "tissue", candidates }));
  expect(off.status).toBe(404);
  const handler = createPaletteRecommendHandler({ decide: scores({}), semantic: async () => [] });
  expect((await handler(post({ query: "t", candidates }))).status).toBe(400);
  expect((await handler(post({ query: "tissue", candidates: Array.from({ length: 41 }, (_, i) => ({ slug: `p${i}` })) }))).status).toBe(400);
  expect((await handler({ request: new Request("http://local/api/wiki/palette-recommend") } as ApiRouteRequest)).status).toBe(405);
  const failed = await createPaletteRecommendHandler({ decide: async () => { throw Error("down"); }, semantic: async () => [] })(post({ query: "tissue", candidates }));
  expect(failed.status).toBe(503);
  expect(failed.headers.get("Cache-Control")).toBe("private, no-store");
});
