/** Records a file-palette pick: what the reader typed and the page they
 * opened from it, so palette ranking can be judged against real searches
 * (scripts/eval-palette-judge.ts). Same rules as visit recording: same-origin
 * only, QA runs opt out, and only pages this reader may open are stored. */
import { z } from "zod";
import type { WikiApiContext } from "@oncobase/wiki-content/server";
import { api } from "../../convex/_generated/api.js";
import type { ApiRouteRequest } from "../api-routes";

const PickSchema = z.object({
  query: z.string().trim().min(1).max(200),
  slug: z.string().min(1).max(400),
  position: z.number().int().min(0).max(1000),
  recommended: z.boolean(),
  recommendedSlugs: z.array(z.string().max(400)).max(10),
});
export type PalettePick = z.infer<typeof PickSchema> & { signedIn: boolean };

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Host" };
const json = (body: unknown, status: number) => Response.json(body, { status, headers });

export async function handlePalettePickRequest(request: Request, context: WikiApiContext, record: (pick: PalettePick) => Promise<unknown>) {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: { ...headers, Allow: "POST" } });
  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") === "cross-site") return json({ error: "Forbidden" }, 403);
  if (request.headers.get("x-wiki-test-run") === "1") return new Response(null, { status: 204, headers });
  const text = await request.text();
  if (text.length > 8192) return json({ error: "Request too large" }, 413);
  let pick: z.infer<typeof PickSchema>;
  try { pick = PickSchema.parse(JSON.parse(text)); } catch { return json({ error: "Invalid pick" }, 400); }
  const user = url.searchParams.get("scope") === "session" ? await context.getSessionUser(request) : null;
  const page = await context.documents.getBySlug({ slug: pick.slug, includeSensitive: Boolean(user) });
  if (!page || (page.sensitive && (!user || !context.access || !await context.access.canUserAccessSlug(user, page.slug)))) return json({ error: "Not found" }, 404);
  await record({ ...pick, signedIn: Boolean(user) });
  return new Response(null, { status: 204, headers });
}

export function handlePalettePick({ request, client, siteSlug, wiki }: ApiRouteRequest) {
  return handlePalettePickRequest(request, wiki, pick => client.mutation(api.palettePicks.record, { siteSlug, ...pick }, { skipQueue: true }))
    .catch(() => json({ error: "Pick not recorded" }, 503));
}
