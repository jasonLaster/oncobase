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
import { api } from "../../../web/convex/_generated/api.js";

const DEFAULT_SITE_SLUG = "diana";
const PROD_CONVEX_FALLBACK_URL = "https://youthful-cricket-560.convex.cloud";
const USER_SESSION_COOKIE = "wiki_user_session";

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

function requestFromIncoming(req: IncomingMessage) {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);
  return new Request(url, {
    method: req.method,
    headers: headersFromIncoming(req.headers),
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

export function wikiApiPlugin(): Plugin {
  const client = createClient();

  return {
    name: "diana-wiki-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
        const handled =
          pathname.startsWith("/api/wiki/") ||
          pathname === "/api/file" ||
          pathname === "/api/page-copy";
        if (!handled) return next();

        try {
          const request = requestFromIncoming(req);
          const siteSlug = siteSlugFromRequest(request);
          const context = {
            siteSlug,
            documents: createDocumentsGateway(client, siteSlug),
            getSessionUser: (nextRequest: Request) =>
              getSessionUser(nextRequest, client, siteSlug),
            logger: console,
          };

          if (req.method === "OPTIONS") {
            await sendWebResponse(res, new Response(null, { status: 204 }));
          } else if (pathname === "/api/wiki/session") {
            await sendWebResponse(res, await createWikiSessionResponse(request, context));
          } else if (pathname === "/api/wiki/manifest") {
            await sendWebResponse(res, await createWikiManifestResponse(request, context));
          } else if (pathname === "/api/wiki/pages") {
            await sendWebResponse(res, await createWikiPagesResponse(request, context));
          } else if (pathname === "/api/file") {
            await sendWebResponse(res, await handleFileRequest(request, client, siteSlug));
          } else if (pathname === "/api/page-copy") {
            await sendWebResponse(res, await handlePageCopyRequest(request, client, siteSlug));
          } else {
            return next();
          }
        } catch (error) {
          server.config.logger.error(`[wiki-api] ${String(error)}`);
          await sendWebResponse(res, Response.json({ error: "Wiki API failed" }, { status: 500 }));
        }
      });
    },
  };
}
