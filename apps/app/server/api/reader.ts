// Hot reader routes. The router imports this module statically so these
// handlers are part of the API function's startup graph.
import { createWikiManifestResponse, createWikiPagesResponse, createWikiSessionResponse } from "@oncobase/wiki-content/server";
import { api } from "../../convex/_generated/api.js";
import type { ApiRouteRequest } from "../api-routes";
import { traceBackendAttributes } from "../backend-tracing";
import { handlePrefetchRequest } from "../prefetch";

export function handleWikiSession({ request, wiki }: ApiRouteRequest) {
  return createWikiSessionResponse(request, wiki);
}

export async function handleWikiManifest({ request, wiki, passwordGateEnabled }: ApiRouteRequest) {
  const response = await createWikiManifestResponse(request, wiki);
  traceBackendAttributes({ "manifest.scope": new URL(request.url).searchParams.get("scope") === "session" ? "session" : "public",
    "manifest.strategy": response.headers.get("X-Wiki-Manifest-Source") ?? "validator",
    "manifest.partial": response.headers.get("X-Wiki-Manifest-Partial") === "true",
    // Snapshot responses are never 304 at the origin in production. Public
    // snapshots are CDN-cacheable, so the edge most likely answers matching
    // validators itself and fills its cache with unconditional requests;
    // private (gated/session) responses reach the origin with the validator.
    "http.request.conditional": request.headers.has("if-none-match"),
    "manifest.validator": !request.headers.has("if-none-match") ? "absent" : response.status === 304 ? "match" : "mismatch",
    "manifest.password_gate": passwordGateEnabled });
  return response;
}

export function handleWikiPages({ request, wiki }: ApiRouteRequest) {
  return createWikiPagesResponse(request, wiki);
}

export function handleWikiPrefetch({ request, client, siteSlug, educationOnly, wiki }: ApiRouteRequest) {
  const serverSecret = process.env.WIKI_PREFETCH_SECRET;
  return handlePrefetchRequest(request, wiki, serverSecret && !educationOnly ? {
    // Authenticated by the service JWT; WIKI_PREFETCH_SECRET only gates the feature.
    priorities: () => client.query(api.prefetch.priorities, { siteSlug }),
    recordVisit: (slug) => client.mutation(api.prefetch.recordVisit, { siteSlug, slug }, { skipQueue: true }),
  } : null).catch(() => Response.json({ error: "Prefetch unavailable" }, { status: 503, headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Host" } }));
}
