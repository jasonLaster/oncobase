// API router. Routes, their gate rules and their lazily loaded handlers are
// declared once in ./api-routes; this module owns only the shared preamble
// (education aliases, site resolution, the wiki context and the password
// gate). Keep its static imports small: they load on every cold start.
import { recordRemoteSpan, traceBackendAttributes, traceBackendCache, traceBackendHandler, traceConvexClient, traceBackendPhase } from "./backend-tracing";
import {
  DEFAULT_SITE_SLUG,
  resolveSiteSlug,
  createClient,
  getSessionUser,
} from "./reader-access";
export {
  resolveSiteSlug,
  getRequestPasswordGateConfig,
  isDianaPreviewTestAuth,
  authedCookieName,
  hasValidAuthCookie,
  redactPageContent,
  createClient,
  withSiteSlug,
  getSessionUser,
  canUserAccessSlug
} from "./reader-access";
import { requestFromIncoming, sendWebResponse } from "./http-adapter";
import type { Plugin } from "vite";
import { legacyRedirectResponse } from "./redirects.ts";
import { createManifestBuildRequester } from "./manifest-build-requests";
import { createManifestSnapshotCache, type WikiApiContext } from "@oncobase/wiki-content/server";
import { api } from "../convex/_generated/api.js";
import { makePublicWikiSessionIdentity, type WikiSessionIdentity } from "@oncobase/wiki-content";
import { educationDocumentsGateway, educationManifestSubset } from "./education-access";
import { EDUCATION_ACCESS_PARTITION } from "../src/education-access";
import { decorateViteHeaders, enforceApiPasswordGate, privatePasswordGateHeaders, privatizePasswordGatedResponse } from "./api/gate";
import { createAccessAdapter, createDocumentsGateway } from "./api/documents";
import { EDUCATION_API_ALIASES, matchApiRoute, matchRawApiRoute } from "./api-routes";
// Hot reader routes stay in the startup graph; their table loaders resolve
// to this already-evaluated module.
import "./api/reader";
export { getPasswordGateConfig, isPasswordGateEnabled } from "./api/gate";

const MANIFEST_PRIORITY_SLUGS = [
  "index",
  "wiki/logistics/insurance",
  "wiki/examples/smart-table",
  "sources/people/providers/stanford/telli",
];

export { requestFromIncoming, sendWebResponse } from "./http-adapter";

export function createWikiApiHandler(client = createClient()) {
  client = traceConvexClient(client);
  // Per-instance: snapshot bytes are content-addressed, build requests throttled.
  const manifestSnapshotCache = createManifestSnapshotCache({ onLookup: hit => traceBackendCache("manifest-snapshot", hit) });
  const requestManifestBuild = createManifestBuildRequester();
  return traceBackendHandler(async function handleWikiApiRequest(request: Request): Promise<Response | null> {
    let pathname = new URL(request.url).pathname;
    const dedicatedEducation = pathname.startsWith("/api/education/");
    if (dedicatedEducation) {
      const target = EDUCATION_API_ALIASES[pathname];
      const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Host" };
      if (!target) return new Response("Not found", { status: 404, headers });
      if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { ...headers, Allow: "GET, HEAD" } });
      const url = new URL(request.url);
      url.pathname = target;
      request = new Request(url, request);
      pathname = target;
    }
    const rawRoute = matchRawApiRoute(pathname);
    if (rawRoute) return (await rawRoute.load())(request);
    const route = matchApiRoute(pathname);
    if (!route) return null;

    const siteSlug = await resolveSiteSlug(request, client);
    if (!siteSlug) {
      return Response.json(
        { error: "Unknown wiki site" },
        {
          status: 404,
          headers: {
            "Cache-Control": "private, no-store",
            Vary: "Host",
          },
        },
      );
    }
    if (dedicatedEducation && siteSlug !== DEFAULT_SITE_SLUG) return new Response("Not found", { status: 404,
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Host" } });
    let passwordGateEnabled = dedicatedEducation;
    let educationOnly = dedicatedEducation;
    const context = {
      siteSlug,
      publicIdentity: undefined as WikiSessionIdentity | undefined,
      documents: createDocumentsGateway(client, siteSlug),
      getSessionUser: (nextRequest: Request) =>
        educationOnly ? Promise.resolve(null) : getSessionUser(nextRequest, client, siteSlug),
      access: createAccessAdapter(client, siteSlug),
      manifestPrioritySlugs: MANIFEST_PRIORITY_SLUGS,
      onManifestFallback: (reason: string) => traceBackendAttributes({ "manifest.fallback_reason": reason }),
      onManifestPhase: (name: Parameters<NonNullable<WikiApiContext["onManifestPhase"]>>[0], ms: number) => recordRemoteSpan(`manifest.${name}`, Date.now() - ms, ms, { "telemetry.source": "api" }),
      manifestSnapshotCache,
      publicSubset: undefined as WikiApiContext["publicSubset"],
      getManifestSnapshot: process.env.WIKI_PREFETCH_SECRET ? async () => {
        // Authenticated by the service JWT; WIKI_PREFETCH_SECRET only gates the feature.
        const args = { siteSlug };
        const snapshot = await client.query(api.manifestCache.current, args);
        traceBackendAttributes({ "manifest.snapshot_hit": Boolean(snapshot) });
        // The reader is served from the live path either way; never await the build.
        if (!snapshot) { requestManifestBuild(siteSlug, () => client.mutation(api.manifestCache.requestBuild, args, { skipQueue: true })); return null; }
        // Storage is read only on a manifestSnapshotCache miss for this hash.
        return { hash: snapshot.hash, revision: snapshot.revision, read: async () => traceBackendPhase("manifest.snapshot-read", async () => {
          const response = await fetch(snapshot.url, { signal: AbortSignal.timeout(5000) });
          if (!response.ok) throw new Error("Manifest snapshot unavailable");
          // Buffer before responding so a broken storage read can use the live
          // fallback. Storage URLs never leave the server.
          return await response.arrayBuffer();
        }) };
      } : undefined,
      decorateHeaders: (headers: HeadersInit) =>
        passwordGateEnabled
          ? privatePasswordGateHeaders(headers)
          : decorateViteHeaders(headers),
      logger: console,
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }

    // The session lookup is memoized per request (reader-access), so starting it
    // beside the gate overlaps the two round trips without changing any rule:
    // the handler still awaits it, and a denied gate simply discards it.
    if (!dedicatedEducation && request.method !== "OPTIONS" && new URL(request.url).searchParams.get("scope") === "session") {
      void getSessionUser(request, client, siteSlug).catch(() => undefined);
    }
    const gated = route.gate === "required" || (route.gate === "default-site" && siteSlug === DEFAULT_SITE_SLUG);
    if (!dedicatedEducation && gated) {
      const gate = await traceBackendPhase("api.gate", () => enforceApiPasswordGate(
        request,
        client,
        siteSlug,
      ));
      passwordGateEnabled = gate.enabled;
      if (gate.response) {
        // The default site's public education pages remain readable without
        // the password: serve only those, with education-scoped documents.
        const readOnly = request.method === "GET" || request.method === "HEAD";
        if (gate.response.status !== 401 || siteSlug !== DEFAULT_SITE_SLUG || !readOnly ||
          !route.educationRead?.(new URL(request.url))) return gate.response;
        educationOnly = true;
      }
    }
    if (educationOnly) {
      context.documents = educationDocumentsGateway(context.documents);
      context.publicIdentity = makePublicWikiSessionIdentity(siteSlug, EDUCATION_ACCESS_PARTITION);
      context.publicSubset = educationManifestSubset;
    }

    if (!route.load) return null;
    const handler = await route.load();
    const response = await handler({ request, pathname, client, siteSlug, educationOnly, passwordGateEnabled, wiki: context });
    return response && route.privatize && passwordGateEnabled
      ? privatizePasswordGatedResponse(response)
      : response;
  });
}

export function wikiApiPlugin(): Plugin {
  const handleWikiApiRequest = createWikiApiHandler();

  return {
    name: "diana-wiki-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const request = await requestFromIncoming(req);
          const redirect = legacyRedirectResponse(request);
          if (redirect) return void (await sendWebResponse(res, redirect));
          const response = await handleWikiApiRequest(request);
          if (!response) return next();
          await sendWebResponse(res, response);
        } catch (error) {
          server.config.logger.error(`[wiki-api] ${String(error)}`);
          await sendWebResponse(res, Response.json({ error: "Wiki API failed" }, { status: 500 }));
        }
      });
    },
  };
}
