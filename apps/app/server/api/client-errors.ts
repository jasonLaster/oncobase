/** Records a browser-side failure in the server's runtime logs, so a reader's
 * phone that cannot render a PDF leaves evidence we can read in Vercel logs.
 * Same-origin only, QA runs opt out, payloads are small and schema-checked,
 * and nothing identifying beyond the user agent is kept. */
import { z } from "zod";
import type { ApiRouteRequest } from "../api-routes";

const text = (max: number) => z.string().max(max);
const ClientErrorSchema = z.object({
  source: z.enum(["pdf-viewer"]),
  stage: z.enum(["open", "render"]),
  path: text(400),
  page: z.number().int().min(0).max(100_000).optional(),
  error: z.object({ name: text(120), message: text(1000), stack: text(4000).optional() }),
  context: z.record(z.string().max(40), z.union([z.string().max(300), z.number(), z.boolean(), z.null()])).optional()
    .refine(value => !value || Object.keys(value).length <= 30, "Too many context fields"),
});
export type ClientErrorReport = z.infer<typeof ClientErrorSchema> & { userAgent: string };

const headers = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status: number) => Response.json(body, { status, headers });

export async function handleClientErrorRequest(request: Request, log: (report: ClientErrorReport) => void) {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: { ...headers, Allow: "POST" } });
  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") === "cross-site") return json({ error: "Forbidden" }, 403);
  if (request.headers.get("x-wiki-test-run") === "1") return new Response(null, { status: 204, headers });
  const body = await request.text();
  if (body.length > 8192) return json({ error: "Request too large" }, 413);
  let report: z.infer<typeof ClientErrorSchema>;
  try { report = ClientErrorSchema.parse(JSON.parse(body)); } catch { return json({ error: "Invalid report" }, 400); }
  log({ ...report, userAgent: (request.headers.get("user-agent") ?? "").slice(0, 300) });
  return new Response(null, { status: 204, headers });
}

export function handleClientErrors({ request, siteSlug }: ApiRouteRequest) {
  return handleClientErrorRequest(request, report => {
    console.error(JSON.stringify({ event: "client_error", siteSlug, ...report }));
  });
}
