import type { WikiApiContext } from "@oncobase/wiki-content/server";

type Candidate = { slug: string; sensitive: boolean };
export type PrefetchGateway = {
  priorities(): Promise<Candidate[]>;
  recordVisit(slug: string): Promise<unknown>;
};

// No content, counts, identities or visit timestamps are exposed. Even the
// ordered slugs are private and filtered through the reader's current scope.
export async function handlePrefetchRequest(request: Request, context: WikiApiContext, gateway: PrefetchGateway | null) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Host" };
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (!gateway) return json({ slugs: [], enabled: false });
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") ?? "public";
  if (scope !== "public" && scope !== "session") return json({ error: "Invalid scope" }, 400);
  const user = scope === "session" ? await context.getSessionUser(request) : null;
  if (scope === "session" && !user) return json({ error: "Unauthorized" }, 401);
  if (request.method === "GET") {
    const candidates = await gateway.priorities();
    const protectedSlugs = candidates.filter(page => page.sensitive).map(page => page.slug);
    const checks = user && context.access && protectedSlugs.length
      ? await context.access.filterAccessibleSlugs(user, protectedSlugs) : [];
    const allowed = new Set(checks.filter(check => check.allowed && check.hasDocument).map(check => check.slug));
    return json({ enabled: true, slugs: candidates.filter(page => !page.sensitive || allowed.has(page.slug)).slice(0, 200).map(page => page.slug) });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  // Cookie-authenticated writes must be same-origin; reject cross-site forms
  // and fetches before even parsing a slug.
  if (request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") === "cross-site") return json({ error: "Forbidden" }, 403);
  // A client may opt out of analytics, but this never bypasses authentication
  // or grants access. Real-backend QA uses it to avoid synthetic visit counts.
  if (request.headers.get("x-wiki-test-run") === "1") return new Response(null, { status: 204, headers });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "Expected JSON" }, 415);
  const text = await request.text();
  if (text.length > 2048) return json({ error: "Request too large" }, 413);
  let body: { slug?: unknown };
  try { body = JSON.parse(text); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!body || typeof body.slug !== "string" || !body.slug || body.slug.length > 512) return json({ error: "Invalid slug" }, 400);
  const page = await context.documents.getBySlug({ slug: body.slug, includeSensitive: scope === "session" });
  if (!page || (page.sensitive && (!user || !context.access || !await context.access.canUserAccessSlug(user, page.slug)))) return json({ error: "Not found" }, 404);
  await gateway.recordVisit(page.slug);
  return new Response(null, { status: 204, headers });
}
