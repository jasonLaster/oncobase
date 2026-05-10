import crypto from "node:crypto";
import path from "node:path";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { ConvexHttpClient } from "convex/browser";
import type { Plugin } from "vite";
import {
  createWikiManifestResponse,
  createWikiPagesResponse,
  createWikiSessionResponse,
  type WikiApiDocumentsGateway,
} from "@diana-tnbc/wiki-content/server";
import { splitWikilinkAlias } from "@diana-tnbc/wiki-markdown/paths";
import { api } from "../../../web/convex/_generated/api.js";
import { applyPiiRedactions } from "../../../web/src/lib/pii-redaction";

const DEFAULT_SITE_SLUG = "diana";
const PROD_CONVEX_FALLBACK_URL = "https://youthful-cricket-560.convex.cloud";
const USER_SESSION_COOKIE = "wiki_user_session";
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 50;
const CHAT_UNAVAILABLE_CONTENT = "unavailable";

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

function siteSlugFromRequest(request: Request) {
  return request.headers.get("x-site-slug") ?? process.env.WIKI_SITE_SLUG ?? DEFAULT_SITE_SLUG;
}

function hashSessionToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
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

async function requestFromIncoming(req: IncomingMessage) {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(url, {
    method,
    headers: headersFromIncoming(req.headers),
    body: hasBody ? await readIncomingBody(req) : undefined,
  });
}

async function sendWebResponse(res: ServerResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  res.end(Buffer.from(await response.arrayBuffer()));
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

function splitSlugAnchor(value: string) {
  const normalized = value.replace(/^\/+/, "").replace(/\.md(?=#|$)/, "");
  const hashIndex = normalized.indexOf("#");
  if (hashIndex === -1) return { slug: normalized, anchor: undefined };
  return {
    slug: normalized.slice(0, hashIndex),
    anchor: normalized.slice(hashIndex + 1) || undefined,
  };
}

function hrefForSlug(slug: string, anchor?: string) {
  return `/${slug}${anchor ? `#${anchor}` : ""}`;
}

function createClient() {
  return new ConvexHttpClient(resolveConvexUrl());
}

function withSiteSlug<TArgs extends object>(siteSlug: string, args: TArgs): TArgs & { siteSlug: string } {
  return { ...args, siteSlug };
}

function createDocumentsGateway(
  client: ConvexHttpClient,
  siteSlug: string,
): WikiApiDocumentsGateway {
  return {
    listManifestPage: (args) =>
      client.query(api.documents.listManifestPage, withSiteSlug(siteSlug, args)),
    listPageWithContent: (args) =>
      client.query(api.documents.listPageWithContent, withSiteSlug(siteSlug, args)),
    listPdfAssetPathsPage: (args) =>
      client.query(api.documents.listPdfAssetPathsPage, withSiteSlug(siteSlug, args)),
    listFileAssetPathsPage: (args) =>
      client.query(api.documents.listFileAssetPathsPage, withSiteSlug(siteSlug, args)),
    getBySlug: (args) =>
      client.query(api.documents.getBySlug, withSiteSlug(siteSlug, args)),
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

  return new Response(await upstream.arrayBuffer(), {
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `inline; filename="${path.basename(normalized)}"`,
      "Cache-Control": "public, max-age=86400",
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
  if (!slug || slug.startsWith("/") || slug.split("/").some((part) => part === "..")) {
    return new Response("Invalid slug", { status: 400 });
  }

  const publicPage = await client.query(
    api.documents.getBySlug,
    withSiteSlug(siteSlug, { slug }),
  );
  if (publicPage) {
    return new Response(publicPage.content, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
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

  return new Response(privatePage.content, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "private, max-age=60, stale-while-revalidate=3600",
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

  return Response.json(
    { results },
    {
      headers: includeSensitive
        ? {
            "Cache-Control": "private, max-age=30, stale-while-revalidate=300",
            Vary: "Accept, Cookie, x-site-slug",
            "X-Wiki-Cache-Scope": "session",
          }
        : {
            "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
            Vary: "Accept, x-site-slug",
            "X-Wiki-Cache-Scope": "public",
          },
    },
  );
}

async function resolveToolLinkedPages(
  client: ConvexHttpClient,
  siteSlug: string,
  content: string,
  slug: string,
) {
  const linkRegex = /\[\[([^\]]+?)\]\]/g;
  const linkedSlugs = new Set<string>();
  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    const linked = splitSlugAnchor(splitWikilinkAlias(match[1]).target);
    if (linked.slug === "about/Terminology" || linked.slug === slug) continue;
    linkedSlugs.add(hrefForSlug(linked.slug, linked.anchor).slice(1));
  }

  const linkedPages = await Promise.all(
    Array.from(linkedSlugs)
      .slice(0, 10)
      .map(async (linkedSlug) => {
        const target = splitSlugAnchor(linkedSlug);
        const linked = await client.query(
          api.documents.getBySlug,
          withSiteSlug(siteSlug, { slug: target.slug }),
        );
        return linked
          ? {
              slug: linked.slug,
              title: applyPiiRedactions(linked.title),
              href: hrefForSlug(linked.slug, target.anchor),
              anchor: target.anchor,
            }
          : null;
      }),
  );

  return linkedPages.filter((page): page is NonNullable<typeof page> => page !== null);
}

async function readToolPage(
  client: ConvexHttpClient,
  siteSlug: string,
  slug: string,
) {
  const requested = splitSlugAnchor(slug);
  const publicDoc = await client.query(
    api.documents.getBySlug,
    withSiteSlug(siteSlug, { slug: requested.slug }),
  );
  if (!publicDoc) {
    const unavailableDoc = await client.query(
      api.documents.getBySlug,
      withSiteSlug(siteSlug, { slug: requested.slug, includeSensitive: true }),
    );
    if (!unavailableDoc) return { error: `Page not found: ${requested.slug}` };
    return {
      slug: unavailableDoc.slug,
      title: applyPiiRedactions(unavailableDoc.title),
      href: hrefForSlug(unavailableDoc.slug, requested.anchor),
      anchor: requested.anchor,
      tags: unavailableDoc.tags,
      content: CHAT_UNAVAILABLE_CONTENT,
      linked_pages: [],
      unavailable: true,
      sensitive: unavailableDoc.sensitive === true ? true : undefined,
    };
  }

  const content = applyPiiRedactions(publicDoc.content);
  return {
    slug: publicDoc.slug,
    title: applyPiiRedactions(publicDoc.title),
    href: hrefForSlug(publicDoc.slug, requested.anchor),
    anchor: requested.anchor,
    tags: publicDoc.tags,
    content: content.slice(0, 8000),
    linked_pages: await resolveToolLinkedPages(client, siteSlug, content, publicDoc.slug),
  };
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
      return Response.json(
        await client.query(
          api.documents.search,
          withSiteSlug(siteSlug, { query, limit: 8 }),
        ),
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
      pathname === "/api/search" ||
      pathname === "/api/tools" ||
      pathname === "/api/file" ||
      pathname === "/api/page-copy";
    if (!handled) return null;

    const siteSlug = siteSlugFromRequest(request);
    const context = {
      siteSlug,
      documents: createDocumentsGateway(client, siteSlug),
      getSessionUser: (nextRequest: Request) =>
        getSessionUser(nextRequest, client, siteSlug),
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

    if (pathname === "/api/search") {
      return handleSearchRequest(request, client, siteSlug);
    }

    if (pathname === "/api/tools") {
      return handleToolsRequest(request, client, siteSlug);
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
