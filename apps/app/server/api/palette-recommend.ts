/** Recommended pages for the file palette (flag: palette-jev-flag.ts).
 * The reader sends what it typed plus candidate pages from its own index;
 * semantic neighbours join them when embeddings are available; a decision
 * model (Jev first) scores every candidate in one request. Only slugs and
 * scores come back, so the reader shows pages from its own index. */
import { z } from "zod";
import { createDecider, DECISION_MODELS, type Decide, type DecisionQuestion } from "@oncobase/education/decisions";
import { api } from "../../convex/_generated/api.js";
import type { Id } from "../../convex/_generated/dataModel.js";
import type { ApiRouteRequest } from "../api-routes";
import { embedQuery as embedWithOpenAI } from "../ai-search";
import { traceBackendAttributes, traceBackendPhase } from "../backend-tracing";
import { getSessionUser, withSiteSlug } from "../reader-access";

export const MAX_CLIENT_CANDIDATES = 40;
export const MAX_SEMANTIC_CANDIDATES = 10;
export const MAX_CANDIDATES = 45;
/** Scores run from 0 (unrelated) to 3 (exactly the page). Short queries
 * rarely earn "exact", so the cut is relative: above "related", and close to
 * the best page, which keeps one clear winner from bringing its neighbours. */
export const RECOMMEND_AT = 1.25;
export const WITHIN_BEST = 0.75;
/** Up to ten close to the best; fewer than five are topped up with the next
 * pages rated at least "related", so the group usually holds about five. */
export const MAX_RECOMMENDED = 10;
export const FILL_TO = 5;
export const FILL_AT = 1;
const SEMANTIC_TIMEOUT_MS = 1_200;
const DECIDE_TIMEOUT_MS = 2_500;

const CandidateSchema = z.object({
  slug: z.string().min(1).max(400),
  title: z.string().max(300).optional(),
  tags: z.array(z.string().max(80)).max(12).optional(),
  description: z.string().max(400).nullable().optional(),
  /** Its place among the reader's own matches (1 = top), when it is one. */
  rank: z.number().int().min(1).max(100).optional(),
});
const RequestSchema = z.object({
  query: z.string().trim().min(2).max(200),
  candidates: z.array(CandidateSchema).max(MAX_CLIENT_CANDIDATES),
});
export type PaletteCandidate = z.infer<typeof CandidateSchema>;

const LEVELS = [
  { label: "unrelated", description: "About a different topic." },
  { label: "related", description: "Same area, but not the page they are looking for." },
  { label: "likely", description: "Probably the page they want, or one of a few." },
  { label: "exact", description: "Exactly the page they are looking for." },
];

/** How the wiki is laid out, so a topic word like "overview" is not read as a file name. */
export const WIKI_LAYOUT = "Pages under wiki/ are the curated reference pages for a topic: summaries, inventories, plans, maps and ledgers. Pages under sources/ are dated records: meeting-notes (every call has an -overview, -raw and -formatted file), emails, and diagnostics reports. A query that names a topic (for example \"tissue overview\" or \"treatment plan\") wants the wiki/ page that covers that topic, not a dated meeting about it. A query that names a kind of record (a call, an email, a report, a scan) or a person or a date wants that record. Queries are often abbreviated (\"path\" for pathology, \"mast\" for mastectomy, \"lump\" for lumpectomy).";

const describe = (page: PaletteCandidate) => [
  page.title || page.slug.split("/").at(-1),
  `path: ${page.slug}`,
  page.tags?.length ? `tags: ${page.tags.slice(0, 8).join(", ")}` : "",
  page.description ? `about: ${page.description.slice(0, 240)}` : "",
].filter(Boolean).join(" — ");

export const recommendQuestions = (candidates: PaletteCandidate[]): DecisionQuestion[] => candidates.map((page, position) => ({
  type: "score", name: `p${position}`, levels: LEVELS,
  instructions: `The reader typed a short query into a page finder to open one page of a patient's cancer-care wiki. How well does this page match what they are looking for? Page: ${describe(page)}`,
}));

/** `PALETTE_JEV_MODELS` replaces the model list; empty turns recommendations off on this deployment. */
/** The reader's own top matches lead near-ties: the first gets this much on
 * the 0–3 scale, falling to nothing by the tenth. It orders the group but never
 * lets a page in that the model rated below the cut. */
export const MATCH_PRIOR = 0.4;
const MATCH_PRIOR_DEPTH = 10;

/** Which candidates to show, best first: close to the best, then topped up. */
export function selectRecommended<Row extends { score: number; rank?: number }>(rows: Row[], { recommendAt = RECOMMEND_AT, withinBest = WITHIN_BEST, maxRecommended = MAX_RECOMMENDED, fillTo = FILL_TO, matchPrior = MATCH_PRIOR } = {}) {
  const order = (row: Row) => row.score + (row.rank && row.rank <= MATCH_PRIOR_DEPTH ? matchPrior * (1 - (row.rank - 1) / MATCH_PRIOR_DEPTH) : 0);
  // Stable: equal places keep the reader's own ranking, then semantic order.
  const ordered = [...rows].sort((a, b) => order(b) - order(a));
  const best = Math.max(0, ...rows.map(row => row.score));
  const close = ordered.filter(row => row.score >= recommendAt && row.score >= best - withinBest).slice(0, maxRecommended);
  if (!close.length || close.length >= fillTo) return close;
  const shown = new Set(close);
  return [...close, ...ordered.filter(row => !shown.has(row) && row.score >= FILL_AT).slice(0, fillTo - close.length)];
}

export const paletteModels = () => (process.env.PALETTE_JEV_MODELS ?? DECISION_MODELS.join(",")).split(",").map(model => model.trim()).filter(Boolean);

const gatewayDecide: Decide = (input, questions, signal) => createDecider({
  models: paletteModels(),
  timeoutMs: DECIDE_TIMEOUT_MS,
  token: async () => process.env.AI_GATEWAY_API_KEY || await import("@vercel/oidc").then(({ getVercelOidcToken }) => getVercelOidcToken()).catch(() => undefined),
  attempt: (model, run) => traceBackendPhase("palette.recommend.attempt", () => { traceBackendAttributes({ "palette.recommend.attempt.model": model }); return run(); }),
})(input, questions, signal);

type Semantic = (query: string, scope: "public" | "session", request: ApiRouteRequest) => Promise<PaletteCandidate[]>;

/** Nearest pages by embedding, limited to what this reader may open. */
const convexSemantic: Semantic = async (query, scope, { request, client, siteSlug }) => {
  const user = scope === "session" ? await getSessionUser(request, client, siteSlug) : null;
  const embedding = await embedWithOpenAI(query);
  if (!embedding) return [];
  const hits = await client.action(api.documents.vectorSearch, withSiteSlug(siteSlug, { embedding, limit: MAX_SEMANTIC_CANDIDATES, includeSensitive: Boolean(user) }));
  if (!user || hits.length === 0) return hits.map(({ slug, title, tags }) => ({ slug, title, tags }));
  const access = await client.query(api.access.filterAccessibleSlugs, withSiteSlug(siteSlug, { userId: user._id as Id<"users">, slugs: hits.map(hit => hit.slug) }));
  const allowed = new Set(access.filter(row => row.allowed).map(row => row.slug));
  return hits.filter(hit => allowed.has(hit.slug)).map(({ slug, title, tags }) => ({ slug, title, tags }));
};

const headers = { "Cache-Control": "private, no-store", Vary: "Accept, Cookie, Host" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });

export function createPaletteRecommendHandler({ decide = gatewayDecide, semantic = convexSemantic, enabled = () => paletteModels().length > 0, recommendAt = RECOMMEND_AT, withinBest = WITHIN_BEST, maxRecommended = MAX_RECOMMENDED, fillTo = FILL_TO }: {
  decide?: Decide; semantic?: Semantic; enabled?: () => boolean;
  /** Evaluation overrides: the lowest score shown and how many. */
  recommendAt?: number; withinBest?: number; maxRecommended?: number; fillTo?: number;
} = {}) {
  return async (route: ApiRouteRequest) => {
    const { request } = route;
    if (!enabled()) return fail("Page recommendations are off on this deployment", 404);
    if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: { ...headers, Allow: "POST" } });

    let body: z.infer<typeof RequestSchema>;
    try { body = RequestSchema.parse(await request.json()); }
    catch { return fail("Expected a query and up to 40 candidate pages", 400); }
    const scope = new URL(request.url).searchParams.get("scope") === "session" ? "session" : "public";

    const nearby = await traceBackendPhase("palette.semantic", () => Promise.race([
      semantic(body.query, scope, route),
      new Promise<PaletteCandidate[]>(resolve => setTimeout(() => resolve([]), SEMANTIC_TIMEOUT_MS)),
    ])).catch(() => []);
    const candidates = [...new Map([...body.candidates, ...nearby].map(page => [page.slug, page])).values()].slice(0, MAX_CANDIDATES);
    traceBackendAttributes({ "palette.recommend.candidates": candidates.length, "palette.recommend.semantic": nearby.length });
    if (candidates.length === 0) return Response.json({ model: null, results: [] }, { headers });

    try {
      const decision = await decide({ reader_typed: body.query, wiki_layout: WIKI_LAYOUT }, recommendQuestions(candidates), request.signal);
      const scored = candidates.map((page, position) => ({ slug: page.slug, rank: page.rank, score: decision.answers.get(`p${position}`)?.score ?? 0 }));
      const results = selectRecommended(scored, { recommendAt, withinBest, maxRecommended, fillTo }).map(({ slug, score }) => ({ slug, score }));
      traceBackendAttributes({ "palette.recommend.model": decision.model, "palette.recommend.results": results.length });
      return Response.json({ model: decision.model, results }, { headers });
    } catch (error) {
      if (request.signal.aborted) return fail("Cancelled", 499);
      console.error("[palette-recommend] decision failed:", error instanceof Error ? error.message : error);
      return fail("No decision model answered", 503);
    }
  };
}

export const handlePaletteRecommend = createPaletteRecommendHandler();
