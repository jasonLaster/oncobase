import { expect, test } from "bun:test";
import type { Decide } from "@oncobase/education/decisions";
import type { ApiRouteRequest } from "../api-routes";
import { createPaletteRecommendHandler, selectRecommended, WIKI_LAYOUT } from "./palette-recommend";

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
  expect(await response.json()).toEqual({ model: "typesafe-ai/jev", results: [{ slug: "wiki/care/tissue-and-data", score: 1.4 }, { slug: "wiki/omics/specimen-to-sample-map", score: 1.3 }, { slug: candidates[0]!.slug, score: 1 }] });
  expect(seen).toEqual({ reader_typed: "tissue overview", wiki_layout: WIKI_LAYOUT });
});

test("a short list is topped up to five with related pages, and nothing related shows nothing", async () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ slug: `wiki/p${i}`, title: `Page ${i}` }));
  const handler = (byName: Record<string, number>) => createPaletteRecommendHandler({ decide: scores(byName), semantic: async () => [] });
  const slugs = async (byName: Record<string, number>) => (await (await handler(byName)(post({ query: "tissue overview", candidates: many }))).json()).results.map((row: { slug: string }) => row.slug);
  // One clear winner, then the best "related" pages; below related never fills.
  expect(await slugs({ p0: 2.9, p1: 1.0, p2: 1.1, p3: 0.4, p4: 0.9 })).toEqual(["wiki/p0", "wiki/p2", "wiki/p1"]);
  expect(await slugs({ p0: 1.4, p1: 1.0, p2: 1.0, p3: 1.0, p4: 1.0, p5: 1.0 })).toEqual(["wiki/p0", "wiki/p1", "wiki/p2", "wiki/p3", "wiki/p4"]);
  // Many close pages: up to ten, no fill.
  expect(await slugs(Object.fromEntries(many.map((_, i) => [`p${i}`, 2.5])))).toHaveLength(10);
  expect(await slugs({ p0: 1.1, p1: 1.0 })).toEqual([]);
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

test("the reader's own top matches lead near-ties but never pass the cut", async () => {
  const rows = [
    { slug: "wiki/topic", score: 2.0 },
    { slug: "sources/named-record", score: 1.8, rank: 1 },
    { slug: "sources/weak-match", score: 0.9, rank: 2 },
  ];
  expect(selectRecommended(rows).map(row => row.slug)).toEqual(["sources/named-record", "wiki/topic"]);
  expect(selectRecommended(rows, { matchPrior: 0 }).map(row => row.slug)).toEqual(["wiki/topic", "sources/named-record"]);
  // A clear winner stays first; ranks travel through the handler.
  const handler = createPaletteRecommendHandler({ decide: scores({ p0: 1.0, p1: 2.6, p2: 1.3 }), semantic: async () => [] });
  const ranked = candidates.map((page, position) => ({ ...page, rank: position + 1 }));
  expect((await (await handler(post({ query: "tissue overview", candidates: ranked }))).json()).results.map((row: { slug: string }) => row.slug))
    .toEqual(["wiki/care/tissue-and-data", "wiki/omics/specimen-to-sample-map", candidates[0]!.slug]);
});
