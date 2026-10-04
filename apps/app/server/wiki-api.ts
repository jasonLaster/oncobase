import { recordRemoteSpan, traceBackendAttributes } from "./backend-tracing";
import { handleManifestTelemetry } from "./manifest-telemetry";
import { handleReaderTelemetry } from "./reader-telemetry";
import {
  DEFAULT_SITE_SLUG,
  resolveSiteSlug,
  createClient,
  withSiteSlug,
  getSessionUser,
  canUserAccessSlug
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
import { browserConversationToken } from "./backend-client";
import { resolveChatOwner } from "./chat-owner";
import { traceBackendCache, traceBackendHandler, traceConvexClient, traceBackendPhase } from "./backend-tracing";
import { requestFromIncoming, sendWebResponse } from "./http-adapter";
import type { Plugin } from "vite";
import { legacyRedirectResponse } from "./redirects.ts";
import { createManifestBuildRequester } from "./manifest-build-requests";
import { createManifestSnapshotCache, createWikiManifestResponse, createWikiPagesResponse, createWikiSessionResponse } from "@oncobase/wiki-content/server";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import { handleAiSearchRequest } from "./ai-search.js";
import { handleChatRequest } from "./chat-route.js";
import {
  handleEpicAuthorizeRequest,
  handleEpicCallbackRequest,
  handleEpicSyncRequest,
  isAdminSessionUser,
} from "./epic-fhir.js";
import { handlePublishRequest } from "./publish-api.js";
import { handlePathologyRequest } from "./pathology-api";
import { handlePrefetchRequest } from "./prefetch";
import { makePublicWikiSessionIdentity, type WikiSessionIdentity } from "@oncobase/wiki-content";
import { educationDocumentsGateway, isEducationSlug } from "./education-access";
import { EDUCATION_ACCESS_PARTITION } from "../src/education-access";
import { decorateViteHeaders, enforceApiPasswordGate, privatePasswordGateHeaders, privatizePasswordGatedResponse } from "./api/gate";
import { createAccessAdapter, createDocumentsGateway } from "./api/documents";
import { handleAdminRequest } from "./api/admin";
import {
  handleAuthSessionRequest,
  handleAuthSigninRequest,
  handleAuthSignoutRequest,
  handleAuthSignupRequest,
  handleLoginRequest,
} from "./api/auth";
import {
  handleLiveblocksAddCommentRequest,
  handleLiveblocksAuthRequest,
  handleLiveblocksDeleteThreadRequest,
  handleLiveblocksGuestRequest,
  handleLiveblocksThreadsRequest,
  handleLiveblocksUsersRequest,
  handleLiveblocksWebhookRequest,
} from "./api/comments";
import {
  handleDiagnosticStudiesRequest,
  handleDicomAnnotationsRequest,
  handleDicomComparisonsRequest,
  handleDicomFileRequest,
  handleDicomSeriesRequest,
  handleDicomStudiesRequest,
  handleTestDiagnosticStudiesRequest,
  handleTestDicomComparisonsRequest,
  handleTimelineRequest,
} from "./api/diagnostics";
import { handleDownloadRequest } from "./api/download";
import { handleFileRequest } from "./api/files";
import { handlePageCopyRequest } from "./api/page-copy";
import { handleSearchRequest } from "./api/search";
import { handleSharePreviewRequest } from "./api/share-preview";
import { handleToolsRequest } from "./api/tools";
export { getPasswordGateConfig, isPasswordGateEnabled } from "./api/gate";
export { handleSharePreviewRequest } from "./api/share-preview";

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
      const routes: Record<string, string> = {
        "/api/education/manifest": "/api/wiki/manifest",
        "/api/education/pages": "/api/wiki/pages",
        "/api/education/search": "/api/search",
        "/api/education/file": "/api/file",
        // The markdown renderer appends /api/file to its API base path.
        "/api/education/api/file": "/api/file",
        "/api/education/page-copy": "/api/page-copy",
      };
      const target = routes[pathname];
      const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Host" };
      if (!target) return new Response("Not found", { status: 404, headers });
      if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { ...headers, Allow: "GET, HEAD" } });
      const url = new URL(request.url);
      url.pathname = target;
      request = new Request(url, request);
      pathname = target;
    }
    if (pathname === "/api/telemetry/manifest") return handleManifestTelemetry(request);
    if (pathname === "/api/wiki/telemetry") return handleReaderTelemetry(request);
    const handled =
      pathname.startsWith("/api/wiki/") ||
      pathname.startsWith("/api/admin/") ||
      pathname.startsWith("/api/publish/") ||
      pathname === "/api/login" ||
      pathname === "/api/auth/session" ||
      pathname === "/api/auth/signin" ||
      pathname === "/api/auth/signup" ||
      pathname === "/api/auth/signout" ||
      pathname === "/api/ai-search" ||
      pathname === "/api/chat" ||
      pathname === "/api/search" ||
      pathname === "/api/timeline" ||
      pathname === "/api/diagnostic-studies" ||
      pathname.startsWith("/api/pathology/") ||
      pathname === "/api/share-preview" ||
      pathname === "/api/dicom/file" ||
      pathname === "/api/dicom/studies" ||
      pathname === "/api/dicom/series" ||
      pathname === "/api/dicom/annotations" ||
      pathname === "/api/dicom/comparisons" ||
      pathname.startsWith("/api/dicom/comparisons/") ||
      pathname === "/api/test/diagnostic-studies" ||
      pathname === "/api/test/dicom-comparisons" ||
      pathname === "/api/tools" ||
      pathname === "/api/liveblocks-auth" ||
      pathname === "/api/liveblocks-threads" ||
      pathname === "/api/liveblocks-add-comment" ||
      pathname === "/api/liveblocks-delete-thread" ||
      pathname === "/api/liveblocks-users" ||
      pathname === "/api/liveblocks-guest" ||
      pathname === "/api/liveblocks-webhook" ||
      pathname === "/api/download" ||
      pathname === "/api/file" ||
      pathname === "/api/page-copy" ||
      pathname === "/api/integrations/epic/authorize" ||
      pathname === "/api/integrations/epic/callback" ||
      pathname === "/api/integrations/epic/sync";
    if (!handled) return null;

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
      onManifestPhase: (name: "read" | "filter" | "tree" | "hash" | "serialize" | "snapshot-encode", ms: number) => recordRemoteSpan(`manifest.${name}`, Date.now() - ms, ms, { "telemetry.source": "api" }),
      manifestSnapshotCache,
      getManifestSnapshot: process.env.WIKI_PREFETCH_SECRET ? async () => {
        if (educationOnly) return null;
        const args = { siteSlug, serverSecret: process.env.WIKI_PREFETCH_SECRET! };
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

    const passwordGateExempt =
      pathname === "/api/login" ||
      pathname.startsWith("/api/auth/") ||
      pathname.startsWith("/api/admin/") ||
      pathname.startsWith("/api/publish/") ||
      pathname === "/api/wiki/session" ||
      pathname === "/api/share-preview" ||
      pathname === "/api/liveblocks-webhook" ||
      pathname.startsWith("/api/integrations/epic/");
    if (!dedicatedEducation && (!passwordGateExempt || (pathname === "/api/wiki/session" && siteSlug === DEFAULT_SITE_SLUG))) {
      const gate = await traceBackendPhase("api.gate", () => enforceApiPasswordGate(
        request,
        client,
        siteSlug,
      ));
      passwordGateEnabled = gate.enabled;
      if (gate.response) {
        const readOnly = request.method === "GET" || request.method === "HEAD";
        const educationRead = ["/api/wiki/session", "/api/wiki/manifest", "/api/wiki/pages",
          "/api/wiki/prefetch", "/api/search", "/api/file", "/api/page-copy"].includes(pathname);
        if (gate.response.status !== 401 || siteSlug !== DEFAULT_SITE_SLUG || !readOnly || !educationRead) return gate.response;
        if (pathname === "/api/file" && !isEducationSlug(new URL(request.url).searchParams.get("path") ?? "")) return gate.response;
        if (pathname === "/api/page-copy" && !isEducationSlug(new URL(request.url).searchParams.get("slug") ?? "")) return gate.response;
        const slugs = new URL(request.url).searchParams.get("slugs");
        if (pathname === "/api/wiki/pages" && slugs && slugs.split(",").some(slug => !isEducationSlug(slug))) return gate.response;
        educationOnly = true;
      }
    }
    if (educationOnly) {
      context.documents = educationDocumentsGateway(context.documents);
      context.publicIdentity = makePublicWikiSessionIdentity(siteSlug, EDUCATION_ACCESS_PARTITION);
    }

    if (pathname.startsWith("/api/publish/")) {
      return handlePublishRequest({
        request,
        client,
        step: pathname.slice("/api/publish/".length),
      });
    }

    if (pathname.startsWith("/api/admin/")) {
      return handleAdminRequest(request, client, siteSlug);
    }

    if (pathname === "/api/wiki/session") {
      return createWikiSessionResponse(request, context);
    }

    if (pathname === "/api/wiki/convex-token") {
      const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Host" };
      if (request.method !== "GET") return new Response(null, { status: 405, headers });
      const [site, sessionUser] = await Promise.all([
        client.query(api.sites.getBySlug, { slug: siteSlug }),
        getSessionUser(request, client, siteSlug),
      ]);
      // Conversation tokens exist only for chat; a site with chat disabled
      // never hands browsers a Convex credential.
      if (!site || !site.config.enableChat) return new Response(null, { status: 404, headers });
      const owner = resolveChatOwner(request, siteSlug, sessionUser, { issue: true });
      const token = await browserConversationToken(site, owner.ownerKey);
      return Response.json({ token }, { headers: owner.setCookie ? { ...headers, "Set-Cookie": owner.setCookie } : headers });
    }

    if (pathname === "/api/wiki/manifest") {
      const response = await createWikiManifestResponse(request, context);
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

    if (pathname === "/api/wiki/pages") {
      return createWikiPagesResponse(request, context);
    }

    if (pathname === "/api/wiki/prefetch") {
      const serverSecret = process.env.WIKI_PREFETCH_SECRET;
      return handlePrefetchRequest(request, context, serverSecret && !educationOnly ? {
        priorities: () => client.query(api.prefetch.priorities, { siteSlug, serverSecret }),
        recordVisit: (slug) => client.mutation(api.prefetch.recordVisit, { siteSlug, serverSecret, slug }, { skipQueue: true }),
      } : null).catch(() => Response.json({ error: "Prefetch unavailable" }, { status: 503, headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Host" } }));
    }

    if (pathname === "/api/login") {
      return handleLoginRequest(request, client, siteSlug);
    }

    if (pathname === "/api/auth/session") {
      return handleAuthSessionRequest(request, client, siteSlug);
    }

    if (pathname === "/api/auth/signin") {
      return handleAuthSigninRequest(request, client, siteSlug);
    }

    if (pathname === "/api/auth/signup") {
      return handleAuthSignupRequest(request, client, siteSlug);
    }

    if (pathname === "/api/auth/signout") {
      return handleAuthSignoutRequest(request, client, siteSlug);
    }

    if (pathname === "/api/search") {
      const response = await handleSearchRequest(request, client, siteSlug, educationOnly);
      return passwordGateEnabled
        ? privatizePasswordGatedResponse(response)
        : response;
    }

    if (pathname === "/api/timeline") {
      return handleTimelineRequest(request, client, siteSlug);
    }

    if (pathname === "/api/diagnostic-studies") {
      return handleDiagnosticStudiesRequest(request, client, siteSlug);
    }

    if (pathname.startsWith("/api/pathology/")) {
      return handlePathologyRequest(request, client, siteSlug);
    }

    if (pathname === "/api/share-preview") {
      return handleSharePreviewRequest(request, client, siteSlug);
    }

    if (pathname === "/api/dicom/file") {
      return handleDicomFileRequest(request, client, siteSlug);
    }

    if (pathname === "/api/dicom/studies") {
      return handleDicomStudiesRequest(request, client, siteSlug);
    }

    if (pathname === "/api/dicom/series") {
      return handleDicomSeriesRequest(request, client, siteSlug);
    }

    if (pathname === "/api/dicom/annotations") {
      return handleDicomAnnotationsRequest(request, client, siteSlug);
    }

    if (
      pathname === "/api/dicom/comparisons" ||
      pathname.startsWith("/api/dicom/comparisons/")
    ) {
      return handleDicomComparisonsRequest(request, client, siteSlug);
    }

    if (pathname === "/api/test/diagnostic-studies") {
      return handleTestDiagnosticStudiesRequest(request, client, siteSlug);
    }

    if (pathname === "/api/test/dicom-comparisons") {
      return handleTestDicomComparisonsRequest(request, client, siteSlug);
    }

    if (pathname === "/api/ai-search") {
      const scope = new URL(request.url).searchParams.get("scope") === "session"
        ? "session"
        : "public";
      const sessionUser = scope === "session"
        ? await getSessionUser(request, client, siteSlug)
        : null;
      if (request.method === "POST" && scope === "session" && !sessionUser) {
        return Response.json(
          { error: "Session scope requires a signed-in wiki session" },
          {
            status: 401,
            headers: {
              "Cache-Control": "private, no-store",
              Vary: "Accept, Cookie, Host",
              "X-Wiki-Cache-Scope": "session",
            },
          },
        );
      }
      return handleAiSearchRequest({
        request,
        client,
        siteSlug,
        includeSensitive: scope === "session" && Boolean(sessionUser),
        allowedSensitiveSlugs: async (slugs) => {
          if (!sessionUser) return new Set();
          const access = await client.query(
            api.access.filterAccessibleSlugs,
            withSiteSlug(siteSlug, { userId: sessionUser._id as Id<"users">, slugs }),
          );
          return new Set(access.filter(result => result.allowed).map(result => result.slug));
        },
      });
    }

    if (pathname === "/api/chat") {
      const sessionUser = await getSessionUser(request, client, siteSlug);
      return handleChatRequest({
        request,
        client,
        siteSlug,
        ownerKey: resolveChatOwner(request, siteSlug, sessionUser).ownerKey,
        includeSensitive: Boolean(sessionUser),
        canAccessSlug: (slug) => canUserAccessSlug(client, siteSlug, sessionUser, slug),
        accessCacheKey: sessionUser ? String(sessionUser._id) : "public",
      });
    }

    if (pathname === "/api/tools") {
      return handleToolsRequest(request, client, siteSlug);
    }

    if (pathname === "/api/liveblocks-auth") {
      return handleLiveblocksAuthRequest(request, client, siteSlug);
    }

    if (pathname === "/api/liveblocks-threads") {
      return handleLiveblocksThreadsRequest(request, client, siteSlug);
    }

    if (pathname === "/api/liveblocks-add-comment") {
      return handleLiveblocksAddCommentRequest(request, client, siteSlug);
    }

    if (pathname === "/api/liveblocks-delete-thread") {
      return handleLiveblocksDeleteThreadRequest(request, client, siteSlug);
    }

    if (pathname === "/api/liveblocks-users") {
      return handleLiveblocksUsersRequest(request, client, siteSlug);
    }

    if (pathname === "/api/liveblocks-guest") {
      return handleLiveblocksGuestRequest(request, client, siteSlug);
    }

    if (pathname === "/api/liveblocks-webhook") {
      return handleLiveblocksWebhookRequest(request, client);
    }

    if (pathname === "/api/download") {
      const response = await handleDownloadRequest(request, client, siteSlug);
      return passwordGateEnabled
        ? privatizePasswordGatedResponse(response)
        : response;
    }

    if (pathname === "/api/file") {
      const response = await handleFileRequest(request, client, siteSlug, educationOnly);
      return passwordGateEnabled
        ? privatizePasswordGatedResponse(response)
        : response;
    }

    if (pathname === "/api/page-copy") {
      const response = await handlePageCopyRequest(request, client, siteSlug, educationOnly);
      return passwordGateEnabled
        ? privatizePasswordGatedResponse(response)
        : response;
    }

    if (pathname === "/api/integrations/epic/authorize") {
      const sessionUser = await getSessionUser(request, client, siteSlug);
      const adminUser = (await isAdminSessionUser(client, siteSlug, sessionUser))
        ? sessionUser
        : null;
      return handleEpicAuthorizeRequest({
        request,
        client,
        siteSlug,
        adminUser,
      });
    }

    if (pathname === "/api/integrations/epic/callback") {
      return handleEpicCallbackRequest({ request, client, siteSlug });
    }

    if (pathname === "/api/integrations/epic/sync") {
      const sessionUser = await getSessionUser(request, client, siteSlug);
      const adminUser = (await isAdminSessionUser(client, siteSlug, sessionUser))
        ? sessionUser
        : null;
      return handleEpicSyncRequest({
        request,
        client,
        siteSlug,
        adminUser,
      });
    }

    return null;
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
