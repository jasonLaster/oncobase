// The single list of API routes. It drives matching, password-gate
// exemption, the public education fallback, response privatization and the
// fixed route names recorded by backend tracing. Feature code is loaded on
// first use so a cold start initializes only the router and the hot reader
// routes. Keep this module free of static runtime imports beyond tiny pure
// helpers: backend tracing (and so the HTML function) imports it.
import type { ConvexHttpClient } from "convex/browser";
import type { WikiApiContext } from "@oncobase/wiki-content/server";
import { isEducationSlug } from "../src/education-access";

export type ApiRouteRequest = {
  request: Request;
  pathname: string;
  client: ConvexHttpClient;
  siteSlug: string;
  /** Public education read: a dedicated /api/education alias or the default-site gate fallback. */
  educationOnly: boolean;
  passwordGateEnabled: boolean;
  wiki: WikiApiContext;
};

export type ApiRouteHandler = (route: ApiRouteRequest) => Promise<Response | null> | Response | null;

/**
 * - `required`: the site's password gate must pass.
 * - `exempt`: the route authenticates for itself (or is public by design).
 * - `default-site`: gated only on the default site.
 */
export type ApiGate = "required" | "exempt" | "default-site";

export type ApiRoute = {
  /** Exact pathname. */
  path?: string;
  /** Pathname prefix (ending in "/"); exact paths always win. */
  prefix?: string;
  gate: ApiGate;
  /** Omitted: the route is claimed (site, gate) but answers null. */
  load?: () => Promise<ApiRouteHandler>;
  /**
   * When the default site's gate denies an anonymous GET/HEAD, a route with
   * this predicate may still serve public education content instead.
   */
  educationRead?: (url: URL) => boolean;
  /** Mark the response private when the password gate is enabled. */
  privatize?: boolean;
  /** Fixed subpaths of a prefix route that tracing may name. */
  tracedSubpaths?: readonly string[];
};

/** Answered before site resolution; no gate, no wiki context. */
export type RawApiRoute = {
  path: string;
  load: () => Promise<(request: Request) => Promise<Response>>;
};

type LegacyHandler = (request: Request, client: ConvexHttpClient, siteSlug: string) => Promise<Response>;
const legacy = (handler: LegacyHandler): ApiRouteHandler =>
  ({ request, client, siteSlug }) => handler(request, client, siteSlug);
const always = () => true;
const educationParam = (name: string) => (url: URL) => isEducationSlug(url.searchParams.get(name) ?? "");

export const RAW_API_ROUTES: readonly RawApiRoute[] = [
  { path: "/api/telemetry/manifest", load: () => import("./manifest-telemetry").then(m => m.handleManifestTelemetry) },
  { path: "/api/wiki/telemetry", load: () => import("./reader-telemetry").then(m => m.handleReaderTelemetry) },
];

const PUBLISH_STEPS = [
  "begin", "document", "asset", "asset-hashes", "document-hashes", "finish", "abort",
  "sync/plan", "sync/documents", "sync/assets", "state", "scoped/begin", "scoped/abort", "scoped/finish", "scoped/complete", "status",
] as const;

export const API_ROUTES: readonly ApiRoute[] = [
  // Publisher and admin APIs authenticate with their own tokens/sessions.
  {
    prefix: "/api/publish/", gate: "exempt", tracedSubpaths: PUBLISH_STEPS,
    load: () => import("./publish-api").then(m => ({ request, client, pathname }: ApiRouteRequest) =>
      m.handlePublishRequest({ request, client, step: pathname.slice("/api/publish/".length) })),
  },
  {
    prefix: "/api/admin/", gate: "exempt", tracedSubpaths: ["access", "roles", "session", "users", "users/role"],
    load: () => import("./api/admin").then(m => legacy(m.handleAdminRequest)),
  },

  // Hot reader routes (statically imported by the router).
  { path: "/api/wiki/session", gate: "default-site", educationRead: always, load: () => import("./api/reader").then(m => m.handleWikiSession) },
  { path: "/api/wiki/convex-token", gate: "required", load: () => import("./api/convex-token").then(m => m.handleConvexTokenRequest) },
  { path: "/api/wiki/manifest", gate: "required", educationRead: always, load: () => import("./api/reader").then(m => m.handleWikiManifest) },
  {
    path: "/api/wiki/pages", gate: "required",
    educationRead: (url) => {
      const slugs = url.searchParams.get("slugs");
      return !slugs || slugs.split(",").every(slug => isEducationSlug(slug));
    },
    load: () => import("./api/reader").then(m => m.handleWikiPages),
  },
  { path: "/api/wiki/prefetch", gate: "required", educationRead: always, load: () => import("./api/reader").then(m => m.handleWikiPrefetch) },
  // Any other /api/wiki/* path still resolves the site and gate, then falls through.
  { prefix: "/api/wiki/", gate: "required" },

  { path: "/api/login", gate: "exempt", load: () => import("./api/auth").then(m => legacy(m.handleLoginRequest)) },
  { path: "/api/auth/session", gate: "exempt", load: () => import("./api/auth").then(m => legacy(m.handleAuthSessionRequest)) },
  { path: "/api/auth/signin", gate: "exempt", load: () => import("./api/auth").then(m => legacy(m.handleAuthSigninRequest)) },
  { path: "/api/auth/signup", gate: "exempt", load: () => import("./api/auth").then(m => legacy(m.handleAuthSignupRequest)) },
  { path: "/api/auth/signout", gate: "exempt", load: () => import("./api/auth").then(m => legacy(m.handleAuthSignoutRequest)) },

  {
    path: "/api/search", gate: "required", educationRead: always, privatize: true,
    load: () => import("./api/search").then(m => ({ request, client, siteSlug, educationOnly }: ApiRouteRequest) =>
      m.handleSearchRequest(request, client, siteSlug, educationOnly)),
  },

  { path: "/api/timeline", gate: "required", load: () => import("./api/diagnostics").then(m => legacy(m.handleTimelineRequest)) },
  { path: "/api/diagnostic-studies", gate: "required", load: () => import("./api/diagnostics").then(m => legacy(m.handleDiagnosticStudiesRequest)) },
  { prefix: "/api/pathology/", gate: "required", load: () => import("./pathology-api").then(m => legacy(m.handlePathologyRequest)) },
  // Link-preview bots carry no session; the handler returns metadata only.
  { path: "/api/share-preview", gate: "exempt", load: () => import("./api/share-preview").then(m => legacy(m.handleSharePreviewRequest)) },
  { path: "/api/dicom/file", gate: "required", load: () => import("./api/diagnostics").then(m => legacy(m.handleDicomFileRequest)) },
  { path: "/api/dicom/studies", gate: "required", load: () => import("./api/diagnostics").then(m => legacy(m.handleDicomStudiesRequest)) },
  { path: "/api/dicom/series", gate: "required", load: () => import("./api/diagnostics").then(m => legacy(m.handleDicomSeriesRequest)) },
  { path: "/api/dicom/annotations", gate: "required", load: () => import("./api/diagnostics").then(m => legacy(m.handleDicomAnnotationsRequest)) },
  {
    path: "/api/dicom/comparisons", prefix: "/api/dicom/comparisons/", gate: "required",
    load: () => import("./api/diagnostics").then(m => legacy(m.handleDicomComparisonsRequest)),
  },
  { path: "/api/test/diagnostic-studies", gate: "required", load: () => import("./api/diagnostics").then(m => legacy(m.handleTestDiagnosticStudiesRequest)) },
  { path: "/api/test/dicom-comparisons", gate: "required", load: () => import("./api/diagnostics").then(m => legacy(m.handleTestDicomComparisonsRequest)) },

  { path: "/api/ai-search", gate: "required", load: () => import("./api/ai-search-route").then(m => m.handleAiSearchRoute) },
  { path: "/api/chat", gate: "required", load: () => import("./api/chat").then(m => m.handleChatRoute) },
  { path: "/api/tools", gate: "required", load: () => import("./api/tools").then(m => legacy(m.handleToolsRequest)) },

  { path: "/api/liveblocks-auth", gate: "required", load: () => import("./api/comments").then(m => legacy(m.handleLiveblocksAuthRequest)) },
  { path: "/api/liveblocks-threads", gate: "required", load: () => import("./api/comments").then(m => legacy(m.handleLiveblocksThreadsRequest)) },
  { path: "/api/liveblocks-add-comment", gate: "required", load: () => import("./api/comments").then(m => legacy(m.handleLiveblocksAddCommentRequest)) },
  { path: "/api/liveblocks-delete-thread", gate: "required", load: () => import("./api/comments").then(m => legacy(m.handleLiveblocksDeleteThreadRequest)) },
  { path: "/api/liveblocks-users", gate: "required", load: () => import("./api/comments").then(m => legacy(m.handleLiveblocksUsersRequest)) },
  { path: "/api/liveblocks-guest", gate: "required", load: () => import("./api/comments").then(m => legacy(m.handleLiveblocksGuestRequest)) },
  // Signed by Liveblocks; resolves its own site from the event.
  {
    path: "/api/liveblocks-webhook", gate: "exempt",
    load: () => import("./api/comments").then(m => ({ request, client }: ApiRouteRequest) => m.handleLiveblocksWebhookRequest(request, client)),
  },

  { path: "/api/download", gate: "required", privatize: true, load: () => import("./api/download").then(m => legacy(m.handleDownloadRequest)) },
  {
    path: "/api/file", gate: "required", educationRead: educationParam("path"), privatize: true,
    load: () => import("./api/files").then(m => ({ request, client, siteSlug, educationOnly }: ApiRouteRequest) =>
      m.handleFileRequest(request, client, siteSlug, educationOnly)),
  },
  {
    path: "/api/page-copy", gate: "required", educationRead: educationParam("slug"), privatize: true,
    load: () => import("./api/page-copy").then(m => ({ request, client, siteSlug, educationOnly }: ApiRouteRequest) =>
      m.handlePageCopyRequest(request, client, siteSlug, educationOnly)),
  },

  { path: "/api/integrations/epic/authorize", gate: "exempt", load: () => import("./api/epic").then(m => m.handleEpicAuthorizeRoute) },
  { path: "/api/integrations/epic/callback", gate: "exempt", load: () => import("./api/epic").then(m => m.handleEpicCallbackRoute) },
  { path: "/api/integrations/epic/sync", gate: "exempt", load: () => import("./api/epic").then(m => m.handleEpicSyncRoute) },
];

/**
 * The public education reader's same-origin aliases. They skip the gate,
 * serve only public education content and exist only on the default site.
 */
export const EDUCATION_API_ALIASES: Readonly<Record<string, string>> = {
  "/api/education/manifest": "/api/wiki/manifest",
  "/api/education/pages": "/api/wiki/pages",
  "/api/education/search": "/api/search",
  "/api/education/file": "/api/file",
  // The markdown renderer appends /api/file to its API base path.
  "/api/education/api/file": "/api/file",
  "/api/education/page-copy": "/api/page-copy",
};

const rawRoutesByPath = new Map(RAW_API_ROUTES.map(route => [route.path, route]));
const routesByPath = new Map(API_ROUTES.filter(route => route.path).map(route => [route.path!, route]));
const prefixRoutes = API_ROUTES.filter(route => route.prefix);

export function matchRawApiRoute(pathname: string) {
  return rawRoutesByPath.get(pathname) ?? null;
}

export function matchApiRoute(pathname: string) {
  return routesByPath.get(pathname) ?? prefixRoutes.find(route => pathname.startsWith(route.prefix!)) ?? null;
}

/** Fixed route names only: never derived from a request path. */
export const TRACED_API_ROUTES: ReadonlySet<string> = new Set([
  ...RAW_API_ROUTES.map(route => route.path),
  ...API_ROUTES.flatMap(route => [
    ...(route.path ? [route.path] : []),
    ...(route.prefix ? (route.tracedSubpaths ?? []).map(subpath => `${route.prefix}${subpath}`) : []),
  ]),
]);

export const PUBLISH_API_ROUTES: ReadonlySet<string> = new Set(PUBLISH_STEPS.map(step => `/api/publish/${step}`));
