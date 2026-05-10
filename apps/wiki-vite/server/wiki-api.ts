import crypto from "node:crypto";
import path from "node:path";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { ConvexHttpClient } from "convex/browser";
import type { Plugin } from "vite";
import {
  createWikiManifestResponse,
  createWikiPagesResponse,
  createWikiSessionResponse,
  type PageWithContent,
  type WikiApiDocumentsGateway,
} from "../../../packages/wiki-content/src/server.js";
import { readChatPageFromDocuments } from "../../../packages/wiki-content/src/chat-tools.js";
import { applyPiiRedactions, parseSitePiiPatterns, type PiiPattern } from "../../../packages/wiki-content/src/pii.js";
import { api } from "../../../web/convex/_generated/api.js";
import { handleAiSearchRequest } from "./ai-search.js";
import { handleChatRequest } from "./chat-route.js";

const DEFAULT_SITE_SLUG = "diana";
const PROD_CONVEX_FALLBACK_URL = "https://youthful-cricket-560.convex.cloud";
const HOST_CACHE_TTL_MS = 15_000;
const VERCEL_PROJECT_HOST_PREFIX = "diana-tnbc";
const USER_SESSION_COOKIE = "wiki_user_session";
const DIANA_PASSWORDS = new Set(["wallify", "diana"]);
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 50;

type PageDownloadResult = {
  page: Array<{ slug: string; content: string }>;
  isDone: boolean;
  continueCursor: string | null;
};

type ResolvedSite = {
  slug: string | null;
  expires: number;
};

type PiiPatternEntry = {
  patterns: PiiPattern[] | undefined;
  expires: number;
};

const hostCache = new Map<string, ResolvedSite>();
const piiPatternCache = new Map<string, PiiPatternEntry>();

const MIME_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".csv": "text/csv; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function resolveConvexUrl() {
  return (
    process.env.NEXT_PUBLIC_CONVEX_URL?.trim() ||
    process.env.CONVEX_URL?.trim() ||
    PROD_CONVEX_FALLBACK_URL
  );
}

function normalizeHost(host: string | null) {
  return host?.trim().toLowerCase().split(":")[0] ?? null;
}

function hostFromRequest(request: Request) {
  return normalizeHost(request.headers.get("host")) ?? normalizeHost(new URL(request.url).host);
}

function explicitSiteSlug() {
  return process.env.WIKI_SITE_SLUG?.trim() || process.env.SITE_SLUG?.trim() || null;
}

function localSiteForHost(host: string) {
  const override = explicitSiteSlug();
  if (override) return override;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    return DEFAULT_SITE_SLUG;
  }
  if (host.endsWith(".localhost")) {
    return host.slice(0, -".localhost".length);
  }
  return null;
}

function previewSiteForHost(host: string) {
  const override = explicitSiteSlug();
  if (override) return override;
  if (process.env.VERCEL_ENV !== "preview") return null;
  if (!host.endsWith(".vercel.app")) return null;
  if (
    host === `${VERCEL_PROJECT_HOST_PREFIX}.vercel.app` ||
    host.startsWith(`${VERCEL_PROJECT_HOST_PREFIX}-`)
  ) {
    return DEFAULT_SITE_SLUG;
  }
  return null;
}

export async function resolveSiteSlug(request: Request, client: ConvexHttpClient) {
  const host = hostFromRequest(request);
  if (!host) return null;

  const now = Date.now();
  const cached = hostCache.get(host);
  if (cached && cached.expires > now) {
    return cached.slug;
  }

  const localSlug = process.env.NODE_ENV !== "production" ? localSiteForHost(host) : null;
  if (localSlug) {
    hostCache.set(host, { slug: localSlug, expires: now + HOST_CACHE_TTL_MS });
    return localSlug;
  }

  const previewSlug = previewSiteForHost(host);
  if (previewSlug) {
    hostCache.set(host, { slug: previewSlug, expires: now + HOST_CACHE_TTL_MS });
    return previewSlug;
  }

  const site = await client.query(api.sites.getByHost, { host });
  const slug = site?.slug ?? null;
  hostCache.set(host, { slug, expires: now + HOST_CACHE_TTL_MS });
  return slug;
}

function decorateViteHeaders(headers: HeadersInit) {
  const nextHeaders = new Headers(headers);
  const vary = nextHeaders.get("Vary");
  if (vary) {
    nextHeaders.set(
      "Vary",
      vary
        .split(",")
        .map((value: string) => (value.trim().toLowerCase() === "x-site-slug" ? "Host" : value.trim()))
        .join(", "),
    );
  }
  return nextHeaders;
}

function hashSessionToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashPassword(password: string) {
  return `sha256:${crypto.createHash("sha256").update(password).digest("hex")}`;
}

export function authedCookieName(siteSlug: string) {
  return siteSlug === DEFAULT_SITE_SLUG ? "authed" : `authed_${siteSlug}`;
}

function sessionTokenFromCookie(cookieHeader: string) {
  return cookieHeader
    .split(/;\s*/)
    .find((part) => part.startsWith(`${USER_SESSION_COOKIE}=`))
    ?.slice(USER_SESSION_COOKIE.length + 1);
}

function headersFromIncoming(headers: IncomingHttpHeaders) {
  const output = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) output.append(key, item);
    } else if (value != null) {
      output.set(key, value);
    }
  }
  return output;
}

async function readIncomingBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function requestFromIncoming(req: IncomingMessage) {
  const host = req.headers.host ?? "localhost";
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto || "http";
  const url = new URL(req.url ?? "/", `${protocol}://${host}`);
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(url, {
    method,
    headers: headersFromIncoming(req.headers),
    body: hasBody ? await readIncomingBody(req) : undefined,
  });
}

export async function sendWebResponse(res: ServerResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (response.body && response.status !== 204 && response.status !== 304) {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
  }
  res.end();
}

function normalizeFilePath(value: string) {
  return path.normalize(value).replace(/^(\.\.(\/|\\|$))+/, "");
}

function getMimeType(filePath: string) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? null;
}

function assetPathToSiblingSlug(assetPath: string) {
  return assetPath.replace(/\.[^/.]+$/, "");
}

function markdownFilename(slug: string) {
  const basename = slug.split("/").filter(Boolean).at(-1) || "index";
  return `${basename.replace(/[^a-z0-9._-]+/gi, "-")}.md`;
}

async function getPiiPatterns(client: ConvexHttpClient, siteSlug: string) {
  const now = Date.now();
  const cached = piiPatternCache.get(siteSlug);
  if (cached && cached.expires > now) return cached.patterns;

  const site = await client.query(api.sites.getBySlug, { slug: siteSlug }).catch(() => null);
  const configuredPatterns = parseSitePiiPatterns(site?.config?.piiPatterns);
  const patterns = configuredPatterns.length > 0
    ? configuredPatterns
    : siteSlug === DEFAULT_SITE_SLUG
      ? undefined
      : [];
  piiPatternCache.set(siteSlug, {
    patterns,
    expires: now + HOST_CACHE_TTL_MS,
  });
  return patterns;
}

async function redactText(client: ConvexHttpClient, siteSlug: string, text: string) {
  return applyPiiRedactions(text, {
    patterns: await getPiiPatterns(client, siteSlug),
  });
}

async function redactPageContent(
  client: ConvexHttpClient,
  siteSlug: string,
  page: PageWithContent,
): Promise<PageWithContent> {
  return {
    ...page,
    content: await redactText(client, siteSlug, page.content),
    description: page.description
      ? await redactText(client, siteSlug, page.description)
      : page.description,
  };
}

export function createClient() {
  return new ConvexHttpClient(resolveConvexUrl());
}

export function withSiteSlug<TArgs extends object>(siteSlug: string, args: TArgs): TArgs & { siteSlug: string } {
  return { ...args, siteSlug };
}

function createDocumentsGateway(
  client: ConvexHttpClient,
  siteSlug: string,
): WikiApiDocumentsGateway {
  return {
    listManifestPage: (args) =>
      client.query(api.documents.listManifestPage, withSiteSlug(siteSlug, args)),
    listPageWithContent: async (args) => {
      const result = await client.query(
        api.documents.listPageWithContent,
        withSiteSlug(siteSlug, args),
      );
      return {
        ...result,
        page: await Promise.all(
          result.page.map((page) => redactPageContent(client, siteSlug, page)),
        ),
      };
    },
    listPdfAssetPathsPage: (args) =>
      client.query(api.documents.listPdfAssetPathsPage, withSiteSlug(siteSlug, args)),
    listFileAssetPathsPage: (args) =>
      client.query(api.documents.listFileAssetPathsPage, withSiteSlug(siteSlug, args)),
    getBySlug: async (args) => {
      const page = await client.query(api.documents.getBySlug, withSiteSlug(siteSlug, args));
      return page ? redactPageContent(client, siteSlug, page) : null;
    },
  };
}

async function getSessionUser(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  const token = sessionTokenFromCookie(request.headers.get("cookie") ?? "");
  if (!token) return null;
  return await client.query(
    api.users.getSessionUser,
    withSiteSlug(siteSlug, { tokenHash: hashSessionToken(token) }),
  );
}

async function isValidPassword(
  client: ConvexHttpClient,
  siteSlug: string,
  password: string,
) {
  if (siteSlug === DEFAULT_SITE_SLUG && DIANA_PASSWORDS.has(password)) {
    return true;
  }
  const site = await client.query(api.sites.getBySlug, { slug: siteSlug });
  if (!site) return false;
  const expected = site.config?.passwordHash;
  if (!expected) {
    return !site.config?.passwordGate;
  }
  return hashPassword(password) === expected;
}

function authCookieHeader(siteSlug: string) {
  return `${authedCookieName(siteSlug)}=true; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`;
}

async function handleLoginRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  const url = new URL(request.url);

  if (request.method === "GET") {
    const token = url.searchParams.get("token") ?? "";
    const redirect = url.searchParams.get("redirect") || "/";
    if (!token || !(await isValidPassword(client, siteSlug, token))) {
      return Response.redirect(new URL("/login", request.url), 302);
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: new URL(redirect, request.url).toString(),
        "Set-Cookie": authCookieHeader(siteSlug),
      },
    });
  }

  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      {
        status: 405,
        headers: { Allow: "GET, POST" },
      },
    );
  }

  const { password } = (await request.json()) as { password?: string };
  if (password && (await isValidPassword(client, siteSlug, password))) {
    return Response.json(
      { ok: true },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "Set-Cookie": authCookieHeader(siteSlug),
        },
      },
    );
  }

  return Response.json(
    { error: "Invalid password" },
    {
      status: 401,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}

async function handleFileRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  const url = new URL(request.url);
  const filePath = url.searchParams.get("path");
  if (!filePath) return new Response("Missing path parameter", { status: 400 });

  const normalized = normalizeFilePath(filePath);
  const mimeType = getMimeType(normalized);
  if (!mimeType) return new Response("File type not supported", { status: 400 });

  const includeSensitive = Boolean(await getSessionUser(request, client, siteSlug));
  const siblingDoc = await client.query(
    api.documents.getBySlug,
    withSiteSlug(siteSlug, { slug: assetPathToSiblingSlug(normalized), includeSensitive: true }),
  );
  if (!includeSensitive && siblingDoc?.sensitive) {
    return new Response("File not found", { status: 404 });
  }

  const ext = path.extname(normalized).toLowerCase();
  const asset = await client.query(
    ext === ".pdf" ? api.documents.getPdfAssetByPath : api.documents.getFileAssetByPath,
    withSiteSlug(
      siteSlug,
      includeSensitive
        ? { path: normalized, includeSensitive: true }
        : { path: normalized },
    ),
  );

  if (!asset?.blobUrl) return new Response("File not found", { status: 404 });
  const upstream = await fetch(asset.blobUrl);
  if (!upstream.ok) return new Response("Blob fetch failed", { status: 502 });

  const cacheScope = includeSensitive ? "session" : "public";
  return new Response(await upstream.arrayBuffer(), {
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `inline; filename="${path.basename(normalized)}"`,
      "Cache-Control": includeSensitive
        ? "private, max-age=300"
        : "public, max-age=86400",
      Vary: includeSensitive ? "Accept, Cookie, Host" : "Accept, Host",
      "X-Wiki-Cache-Scope": cacheScope,
    },
  });
}

async function handlePageCopyRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug") ?? "";
  if (!slug || slug.startsWith("/") || slug.split("/").some((part: string) => part === "..")) {
    return new Response("Invalid slug", { status: 400 });
  }

  const publicPage = await client.query(
    api.documents.getBySlug,
    withSiteSlug(siteSlug, { slug }),
  );
  if (publicPage) {
    return new Response(await redactText(client, siteSlug, publicPage.content), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${markdownFilename(slug)}"`,
        "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
        Vary: "Accept, Host",
        "X-Wiki-Cache-Scope": "public",
      },
    });
  }

  if (url.searchParams.get("scope") === "public") {
    return new Response("Not found", { status: 404 });
  }

  const sessionUser = await getSessionUser(request, client, siteSlug);
  if (!sessionUser) return new Response("Not found", { status: 404 });

  const privatePage = await client.query(
    api.documents.getBySlug,
    withSiteSlug(siteSlug, { slug, includeSensitive: true }),
  );
  if (!privatePage) return new Response("Not found", { status: 404 });

  return new Response(await redactText(client, siteSlug, privatePage.content), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${markdownFilename(slug)}"`,
      "Cache-Control": "private, max-age=60, stale-while-revalidate=3600",
      Vary: "Accept, Cookie, Host",
      "X-Wiki-Cache-Scope": "session",
    },
  });
}

async function handleDownloadRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  const url = new URL(request.url);
  if (url.searchParams.get("type") !== "full") {
    return new Response("Unsupported download type", { status: 400 });
  }

  const includeSensitive = Boolean(await getSessionUser(request, client, siteSlug));
  const rawLimit = Number(url.searchParams.get("limit") ?? 0);
  const maxPages = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(5000, Math.floor(rawLimit))
    : Number.POSITIVE_INFINITY;
  let cursor: string | null = null;
  let isDone = false;
  const chunks: string[] = [];

  while (!isDone && chunks.length < maxPages) {
    const numItems = Math.min(100, maxPages - chunks.length);
    const args = includeSensitive
      ? { cursor, numItems, includeSensitive: true as const }
      : { cursor, numItems };
    const result: PageDownloadResult = await client.query(
      api.documents.listPageWithContent,
      withSiteSlug(siteSlug, args),
    );

    for (const page of result.page) {
      const content = await redactText(client, siteSlug, page.content);
      chunks.push(`<!-- ${page.slug} -->\n\n${content.trim()}\n`);
    }

    isDone = result.isDone;
    cursor = result.continueCursor;
    if (!isDone && !cursor) {
      return new Response("Download pagination failed", { status: 502 });
    }
  }

  return new Response(chunks.join("\n---\n\n"), {
    headers: includeSensitive
      ? {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="${siteSlug}-wiki.md"`,
          "Cache-Control": "private, no-store",
          Vary: "Accept, Cookie, Host",
          "X-Wiki-Cache-Scope": "session",
        }
      : {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="${siteSlug}-wiki.md"`,
          "Cache-Control": "public, max-age=300, s-maxage=3600",
          Vary: "Accept, Host",
          "X-Wiki-Cache-Scope": "public",
        },
  });
}

async function handleSearchRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const rawLimit = Number(url.searchParams.get("limit") ?? DEFAULT_SEARCH_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(MAX_SEARCH_LIMIT, Math.max(1, rawLimit))
    : DEFAULT_SEARCH_LIMIT;

  if (!query.trim()) {
    return Response.json(
      { results: [] },
      {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
          Vary: "Accept, Host",
          "X-Wiki-Cache-Scope": "public",
        },
      },
    );
  }

  const includeSensitive = Boolean(await getSessionUser(request, client, siteSlug));
  const results = await client.query(
    api.documents.search,
    withSiteSlug(siteSlug, { query, limit, includeSensitive }),
  );
  const patterns = await getPiiPatterns(client, siteSlug);
  const redact = (value: string | undefined) =>
    value == null ? value : applyPiiRedactions(value, { patterns });
  const redactedResults = results.map((result) => ({
    ...result,
    title: redact(result.title) ?? result.title,
    excerpt: redact(result.excerpt),
  }));

  return Response.json(
    { results: redactedResults },
    {
      headers: includeSensitive
        ? {
            "Cache-Control": "private, max-age=30, stale-while-revalidate=300",
            Vary: "Accept, Cookie, Host",
            "X-Wiki-Cache-Scope": "session",
          }
        : {
            "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
            Vary: "Accept, Host",
            "X-Wiki-Cache-Scope": "public",
          },
    },
  );
}

async function readToolPage(
  client: ConvexHttpClient,
  siteSlug: string,
  slug: string,
) {
  return readChatPageFromDocuments(
    {
      getBySlug: (args) =>
        client.query(api.documents.getBySlug, withSiteSlug(siteSlug, args)),
    },
    slug,
    { patterns: await getPiiPatterns(client, siteSlug) },
  );
}

async function handleToolsRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      {
        status: 405,
        headers: { Allow: "POST" },
      },
    );
  }

  const { tool, args = {} } = (await request.json()) as {
    tool?: string;
    args?: Record<string, unknown>;
  };

  switch (tool) {
    case "search_wiki": {
      const query = String(args.query ?? "");
      const patterns = await getPiiPatterns(client, siteSlug);
      return Response.json(
        (
          await client.query(
            api.documents.search,
            withSiteSlug(siteSlug, { query, limit: 8 }),
          )
        ).map((result) => ({
          ...result,
          title: applyPiiRedactions(result.title, { patterns }),
          excerpt: result.excerpt
            ? applyPiiRedactions(result.excerpt, { patterns })
            : result.excerpt,
        })),
        {
          headers: {
            "Cache-Control": "private, no-store",
            "X-Wiki-Cache-Scope": "session",
          },
        },
      );
    }
    case "read_page": {
      return Response.json(await readToolPage(client, siteSlug, String(args.slug ?? "")), {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Wiki-Cache-Scope": "session",
        },
      });
    }
    case "list_pages": {
      return Response.json(await client.action(api.documents.list, withSiteSlug(siteSlug, {})), {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Wiki-Cache-Scope": "session",
        },
      });
    }
    case "get_pages_by_tag": {
      return Response.json(
        await client.action(
          api.documents.getByTag,
          withSiteSlug(siteSlug, { tag: String(args.tag ?? "") }),
        ),
        {
          headers: {
            "Cache-Control": "private, no-store",
            "X-Wiki-Cache-Scope": "session",
          },
        },
      );
    }
    case "list_tags": {
      return Response.json(
        await client.action(api.documents.listTags, withSiteSlug(siteSlug, {})),
        {
          headers: {
            "Cache-Control": "private, no-store",
            "X-Wiki-Cache-Scope": "session",
          },
        },
      );
    }
    default:
      return Response.json({ error: `Unknown tool: ${tool}` }, { status: 400 });
  }
}

export function createWikiApiHandler(client = createClient()) {
  return async function handleWikiApiRequest(request: Request): Promise<Response | null> {
    const pathname = new URL(request.url).pathname;
    const handled =
      pathname.startsWith("/api/wiki/") ||
      pathname === "/api/login" ||
      pathname === "/api/ai-search" ||
      pathname === "/api/chat" ||
      pathname === "/api/search" ||
      pathname === "/api/tools" ||
      pathname === "/api/download" ||
      pathname === "/api/file" ||
      pathname === "/api/page-copy";
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
    const context = {
      siteSlug,
      documents: createDocumentsGateway(client, siteSlug),
      getSessionUser: (nextRequest: Request) =>
        getSessionUser(nextRequest, client, siteSlug),
      decorateHeaders: decorateViteHeaders,
      logger: console,
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }

    if (pathname === "/api/wiki/session") {
      return createWikiSessionResponse(request, context);
    }

    if (pathname === "/api/wiki/manifest") {
      return createWikiManifestResponse(request, context);
    }

    if (pathname === "/api/wiki/pages") {
      return createWikiPagesResponse(request, context);
    }

    if (pathname === "/api/login") {
      return handleLoginRequest(request, client, siteSlug);
    }

    if (pathname === "/api/search") {
      return handleSearchRequest(request, client, siteSlug);
    }

    if (pathname === "/api/ai-search") {
      return handleAiSearchRequest({
        request,
        client,
        siteSlug,
        includeSensitive: Boolean(await getSessionUser(request, client, siteSlug)),
      });
    }

    if (pathname === "/api/chat") {
      return handleChatRequest({
        request,
        client,
        siteSlug,
        includeSensitive: Boolean(await getSessionUser(request, client, siteSlug)),
      });
    }

    if (pathname === "/api/tools") {
      return handleToolsRequest(request, client, siteSlug);
    }

    if (pathname === "/api/download") {
      return handleDownloadRequest(request, client, siteSlug);
    }

    if (pathname === "/api/file") {
      return handleFileRequest(request, client, siteSlug);
    }

    if (pathname === "/api/page-copy") {
      return handlePageCopyRequest(request, client, siteSlug);
    }

    return null;
  };
}

export function wikiApiPlugin(): Plugin {
  const handleWikiApiRequest = createWikiApiHandler();

  return {
    name: "diana-wiki-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const request = await requestFromIncoming(req);
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
