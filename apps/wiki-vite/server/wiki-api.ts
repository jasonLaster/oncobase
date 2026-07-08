import crypto from "node:crypto";
import path from "node:path";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import archiver from "archiver";
import { ConvexHttpClient } from "convex/browser";
import type { Plugin } from "vite";
import {
  createWikiManifestResponse,
  createWikiPagesResponse,
  createWikiSessionResponse,
  type PageWithContent,
  type WikiApiDocumentsGateway,
} from "@oncobase/wiki-content/server";
import { readChatPageFromDocuments } from "@oncobase/wiki-content/chat-tools";
import { applyPiiRedactions, parseSitePiiPatterns, type PiiPattern } from "@oncobase/wiki-content/pii";
import {
  prepareDiagnosticTimelineResponse,
  type DiagnosticTimelineData,
} from "@oncobase/diagnostics/timeline/data";
import {
  diagnosticStudiesMetaKeyForSet,
  normalizeDiagnosticStudiesPayload,
  normalizeDiagnosticStudySet,
  parseDiagnosticStudiesPayload,
} from "@oncobase/diagnostics/studies/data";
import {
  diagnosticComparisonsMetaKeyForSet,
  normalizeDiagnosticComparisonSet,
  normalizeDiagnosticComparisonsPayload,
  parseDiagnosticComparisonsPayload,
} from "@oncobase/diagnostics/dicom/comparisons";
import {
  resolveDicomPath,
  getDicomCatalog,
} from "@oncobase/diagnostics/dicom/local";
import { api } from "../../../apps/web/convex/_generated/api.js";
import type { Id } from "../../../apps/web/convex/_generated/dataModel.js";
import { handleAiSearchRequest } from "./ai-search.js";
import { handleChatRequest } from "./chat-route.js";
import {
  handleEpicAuthorizeRequest,
  handleEpicCallbackRequest,
  handleEpicSyncRequest,
  isAdminSessionUser,
} from "./epic-fhir.js";

const DEFAULT_SITE_SLUG = "diana";
const PROD_CONVEX_FALLBACK_URL = "https://youthful-cricket-560.convex.cloud";
const HOST_CACHE_TTL_MS = 15_000;
const VERCEL_PROJECT_HOST_PREFIX = "diana-tnbc";
const USER_SESSION_COOKIE = "wiki_user_session";
const USER_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const DIANA_PASSWORDS = new Set(["wallify", "diana"]);
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 50;
const TIMELINE_META_KEY = "diagnosticTimeline:data";
const DEFAULT_SITE_DESCRIPTION =
  "A patient-authored knowledge base for treatment history, diagnostics, and care decisions.";
const MANIFEST_PRIORITY_SLUGS = [
  "index",
  "wiki/logistics/insurance",
  "wiki/examples/smart-table",
  "sources/people/providers/stanford/telli",
];

type PageDownloadResult = {
  page: Array<{ slug: string; content: string }>;
  isDone: boolean;
  continueCursor: string | null;
};

type DownloadAsset = {
  blobUrl?: string;
  path: string;
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
  ".dcm": "application/dicom",
  ".dicom": "application/dicom",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gz": "application/gzip",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".rtf": "application/rtf",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".tar": "application/x-tar",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".tsv": "text/tab-separated-values; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xml": "application/xml",
  ".zip": "application/zip",
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

function hashSitePassword(password: string) {
  return `sha256:${crypto.createHash("sha256").update(password).digest("hex")}`;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function createPasswordSalt() {
  return crypto.randomBytes(16).toString("hex");
}

function hashUserPassword(password: string, salt: string) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function verifyUserPassword(password: string, salt: string, expectedHash: string) {
  const actual = Buffer.from(hashUserPassword(password, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function createSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function sessionCookieHeader(token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${USER_SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(USER_SESSION_TTL_MS / 1000)}${secure}`;
}

function clearSessionCookieHeader() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${USER_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

export function authedCookieName(siteSlug: string) {
  return siteSlug === DEFAULT_SITE_SLUG ? "authed" : `authed_${siteSlug}`;
}

function sessionTokenFromCookie(cookieHeader: string) {
  const rawToken = cookieHeader
    .split(/;\s*/)
    .find((part) => part.startsWith(`${USER_SESSION_COOKIE}=`))
    ?.slice(USER_SESSION_COOKIE.length + 1);
  return rawToken ? decodeURIComponent(rawToken) : undefined;
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

function blobRequestHeaders(request: Request) {
  const range = request.headers.get("Range");
  return range ? { Range: range } : undefined;
}

function assetPathToSiblingSlug(assetPath: string) {
  return assetPath.replace(/\.[^/.]+$/, "");
}

function contentDisposition(ext: string, filename: string) {
  const disposition = ext === ".zip" ? "attachment" : "inline";
  return `${disposition}; filename="${filename}"`;
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
  return hashSitePassword(password) === expected;
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

function publicSessionUser(user: { email: string; name?: string | null }) {
  return {
    email: user.email,
    name: user.name ?? null,
  };
}

async function createUserSessionResponse(
  client: ConvexHttpClient,
  siteSlug: string,
  user: { _id: Id<"users">; email: string; name?: string | null },
) {
  const token = createSessionToken();
  await client.mutation(
    api.users.createSession,
    withSiteSlug(siteSlug, {
      userId: user._id,
      tokenHash: hashSessionToken(token),
      expiresAt: Date.now() + USER_SESSION_TTL_MS,
    }),
  );

  return Response.json(
    { ok: true, user: publicSessionUser(user) },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "Set-Cookie": sessionCookieHeader(token),
        Vary: "Cookie, Host",
      },
    },
  );
}

async function handleAuthSessionRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (request.method !== "GET") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: "GET" } },
    );
  }

  const user = await getSessionUser(request, client, siteSlug);
  return Response.json(
    { user: user ? publicSessionUser(user) : null },
    {
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Cookie, Host",
      },
    },
  );
}

async function handleAuthSigninRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: "POST" } },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    email?: string;
    password?: string;
  } | null;
  const email = normalizeEmail(body?.email ?? "");
  const password = body?.password ?? "";
  if (!email || !password) {
    return Response.json({ error: "Email and password are required" }, { status: 400 });
  }

  const user = await client.query(
    api.users.getByEmailForAuth,
    withSiteSlug(siteSlug, { email }),
  );
  if (!user || !verifyUserPassword(password, user.passwordSalt, user.passwordHash)) {
    return Response.json({ error: "Invalid email or password" }, { status: 401 });
  }

  return createUserSessionResponse(client, siteSlug, user);
}

async function handleAuthSignupRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: "POST" } },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    email?: string;
    name?: string;
    password?: string;
  } | null;
  const email = normalizeEmail(body?.email ?? "");
  const password = body?.password ?? "";
  const name = body?.name?.trim() || undefined;

  if (!email || !email.includes("@")) {
    return Response.json({ error: "A valid email is required" }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const passwordSalt = createPasswordSalt();
  const passwordHash = hashUserPassword(password, passwordSalt);

  try {
    const userId = await client.mutation(
      api.users.create,
      withSiteSlug(siteSlug, {
        email,
        name,
        passwordHash,
        passwordSalt,
      }),
    );
    return createUserSessionResponse(client, siteSlug, { _id: userId, email, name: name ?? null });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to create account" },
      { status: 400 },
    );
  }
}

async function handleAuthSignoutRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: "POST" } },
    );
  }

  const token = sessionTokenFromCookie(request.headers.get("cookie") ?? "");
  if (token) {
    await client.mutation(
      api.users.deleteSession,
      withSiteSlug(siteSlug, { tokenHash: hashSessionToken(token) }),
    );
  }

  return Response.json(
    { ok: true },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "Set-Cookie": clearSessionCookieHeader(),
        Vary: "Cookie, Host",
      },
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
  const filename = path.basename(normalized);
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
  const upstream = await fetch(asset.blobUrl, {
    headers: blobRequestHeaders(request),
  });
  if (!upstream.ok) return new Response("Blob fetch failed", { status: 502 });

  const cacheScope = includeSensitive ? "session" : "public";
  const headers = new Headers({
      "Content-Type": mimeType,
      "Content-Disposition": contentDisposition(ext, filename),
      "Cache-Control": includeSensitive
        ? "private, max-age=300"
        : "public, max-age=86400",
      Vary: includeSensitive ? "Accept, Cookie, Host, Range" : "Accept, Host, Range",
      "X-Wiki-Cache-Scope": cacheScope,
    });
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) headers.set("Content-Length", contentLength);
  const acceptRanges = upstream.headers.get("accept-ranges");
  if (acceptRanges) headers.set("Accept-Ranges", acceptRanges);
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) headers.set("Content-Range", contentRange);

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

async function handleDicomStudiesRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  try {
    const rows = await client.query(api.dicom.listSeries, { siteSlug });
    if (rows.length) {
      return Response.json(
        {
          root: "vercel-blob",
          rootsTried: ["vercel-blob"],
          series: rows.map((series) => ({
            id: series._id,
            seriesKey: series.seriesKey,
            label: series.label,
            root: "vercel-blob",
            directory: series.relativeDirectory,
            relativeDirectory: series.relativeDirectory,
            modality: series.modality ?? null,
            studyDescription: series.studyDescription ?? null,
            seriesDescription: series.seriesDescription ?? null,
            studyDate: series.studyDate ?? null,
            seriesNumber: series.seriesNumber ?? null,
            images: series.images.map((image, index) => ({
              id: image._id,
              fileName: image.fileName,
              relativePath: image.path,
              byteLength: image.sizeBytes,
              modifiedAt: new Date(image.uploadedAt).toISOString(),
              imageId: `/api/dicom/file?path=${encodeURIComponent(image.path)}`,
              instanceNumber: image.instanceNumber ?? null,
              imagePosition: image.imagePosition ?? null,
              rows: image.rows ?? null,
              columns: image.columns ?? null,
              sortIndex: index,
            })),
          })),
        },
        {
          headers: {
            "Cache-Control": "no-store",
            Vary: "Host",
          },
        },
      );
    }
  } catch (error) {
    console.warn("[dicom] Blob-backed catalog unavailable; falling back to local files", error);
  }

  const catalog = await getDicomCatalog();
  return Response.json(catalog, {
    headers: {
      "Cache-Control": "no-store",
      Vary: "Host",
    },
  });
}

async function handleDicomFileRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  const relativePath = new URL(request.url).searchParams.get("path") ?? "";

  try {
    const row = await client.query(api.dicom.getImageByPath, {
      siteSlug,
      path: relativePath,
    });
    if (row?.blobUrl) {
      const upstream = await fetch(row.blobUrl, {
        headers: blobRequestHeaders(request),
      });
      if (upstream.ok) {
        const headers = new Headers({
          "Cache-Control": "private, no-store",
          "Content-Disposition": `inline; filename="${row.fileName}"`,
          "Content-Length": upstream.headers.get("content-length") ?? String(row.sizeBytes),
          "Content-Type": upstream.headers.get("content-type") ?? "application/dicom",
          Vary: "Host, Range",
        });
        const acceptRanges = upstream.headers.get("accept-ranges");
        if (acceptRanges) headers.set("Accept-Ranges", acceptRanges);
        const contentRange = upstream.headers.get("content-range");
        if (contentRange) headers.set("Content-Range", contentRange);
        return new Response(upstream.body, {
          status: upstream.status,
          headers,
        });
      }
    }
  } catch (error) {
    console.warn("[dicom] Blob-backed file unavailable; falling back to local file", error);
  }

  const resolved = await resolveDicomPath(relativePath);
  if (!resolved) {
    return Response.json({ error: "DICOM file not found" }, { status: 404 });
  }

  try {
    const data = await Bun.file(resolved.absolutePath).arrayBuffer();
    return new Response(data, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename="${path.basename(resolved.absolutePath)}"`,
        "Content-Length": String(data.byteLength),
        "Content-Type": "application/dicom",
        Vary: "Host",
      },
    });
  } catch {
    return Response.json({ error: "DICOM file not readable" }, { status: 404 });
  }
}

async function handleDiagnosticStudiesRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  const studySet = new URL(request.url).searchParams.get("studySet");
  const value = await client.query(
    api.documents.getMeta,
    withSiteSlug(siteSlug, { key: diagnosticStudiesMetaKeyForSet(studySet) }),
  );
  return Response.json(
    { studies: parseDiagnosticStudiesPayload(value) },
    {
      headers: {
        "Cache-Control": "no-store",
        Vary: "Host",
      },
    },
  );
}

async function handleDicomComparisonsRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  const url = new URL(request.url);
  const value = await client.query(
    api.documents.getMeta,
    withSiteSlug(siteSlug, {
      key: diagnosticComparisonsMetaKeyForSet(url.searchParams.get("studySet")),
    }),
  );
  const comparisons = parseDiagnosticComparisonsPayload(value);
  const id = dicomComparisonIdFromPath(url.pathname);

  if (id) {
    const comparison = comparisons.find((item) => item.id === id);
    if (!comparison) {
      return Response.json({ error: "Comparison not found" }, { status: 404 });
    }
    return Response.json(comparison, {
      headers: {
        "Cache-Control": "no-store",
        Vary: "Host",
      },
    });
  }

  return Response.json(
    { comparisons },
    {
      headers: {
        "Cache-Control": "no-store",
        Vary: "Host",
      },
    },
  );
}

function dicomComparisonIdFromPath(pathname: string) {
  const prefix = "/api/dicom/comparisons/";
  if (!pathname.startsWith(prefix)) return null;
  const raw = pathname.slice(prefix.length);
  return raw ? decodeURIComponent(raw) : null;
}

type AnnotationKind = "arrow" | "circle" | "box" | "text";

type DicomAnnotation = {
  id: string;
  kind: AnnotationKind;
  x: number;
  y: number;
  width?: number;
  height?: number;
  endX?: number;
  endY?: number;
  text?: string;
  color: string;
  thickness: number;
  fontSize: number;
};

const annotationKinds = new Set<AnnotationKind>(["arrow", "circle", "box", "text"]);
const MAX_ANNOTATIONS_PER_IMAGE = 250;

function isFiniteUnitNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function optionalUnitNumber(value: unknown) {
  return value === undefined || isFiniteUnitNumber(value);
}

function validateAnnotation(value: unknown): DicomAnnotation | null {
  if (!value || typeof value !== "object") return null;
  const annotation = value as Partial<DicomAnnotation>;
  const { color, fontSize, id, kind, thickness, x, y } = annotation;
  if (typeof id !== "string" || id.length > 96) return null;
  if (!annotationKinds.has(kind as AnnotationKind)) return null;
  if (!isFiniteUnitNumber(x) || !isFiniteUnitNumber(y)) return null;
  if (!optionalUnitNumber(annotation.width) || !optionalUnitNumber(annotation.height)) return null;
  if (!optionalUnitNumber(annotation.endX) || !optionalUnitNumber(annotation.endY)) return null;
  if (!isHexColor(color)) return null;
  if (!isFinitePositiveNumber(thickness) || thickness > 32) return null;
  if (!isFinitePositiveNumber(fontSize) || fontSize > 96) return null;
  if (annotation.text !== undefined && typeof annotation.text !== "string") return null;

  return {
    id,
    kind: kind as AnnotationKind,
    x,
    y,
    ...(annotation.width !== undefined ? { width: annotation.width } : {}),
    ...(annotation.height !== undefined ? { height: annotation.height } : {}),
    ...(annotation.endX !== undefined ? { endX: annotation.endX } : {}),
    ...(annotation.endY !== undefined ? { endY: annotation.endY } : {}),
    ...(annotation.text !== undefined ? { text: annotation.text.slice(0, 400) } : {}),
    color,
    thickness,
    fontSize,
  };
}

function validateAnnotations(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_ANNOTATIONS_PER_IMAGE) {
    return null;
  }
  const annotations = value.map(validateAnnotation);
  return annotations.every(Boolean) ? (annotations as DicomAnnotation[]) : null;
}

async function handleDicomAnnotationsRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  const url = new URL(request.url);

  if (request.method === "GET" || request.method === "HEAD") {
    const seriesKey = url.searchParams.get("seriesKey")?.trim();
    if (!seriesKey) {
      return Response.json({ error: "seriesKey is required" }, { status: 400 });
    }

    try {
      const images = await client.query(api.imageAnnotations.listForSeries, {
        siteSlug,
        seriesKey,
      });
      return Response.json(
        { images, seriesKey },
        {
          headers: {
            "Cache-Control": "private, no-store",
            Vary: "Host",
          },
        },
      );
    } catch {
      return Response.json(
        { images: [], seriesKey, storage: "unavailable" },
        {
          headers: {
            "Cache-Control": "private, no-store",
            Vary: "Host",
          },
        },
      );
    }
  }

  if (request.method !== "PUT") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD, PUT" },
    });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        annotations?: unknown;
        imageKey?: unknown;
        imagePath?: unknown;
        seriesKey?: unknown;
      }
    | null;

  if (!body) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const seriesKey = typeof body.seriesKey === "string" ? body.seriesKey.trim() : "";
  const imageKey = typeof body.imageKey === "string" ? body.imageKey.trim() : "";
  const imagePath = typeof body.imagePath === "string" ? body.imagePath.trim() : "";
  const annotations = validateAnnotations(body.annotations);

  if (!seriesKey || !imageKey || !imagePath || !annotations) {
    return Response.json({ error: "Invalid annotation payload" }, { status: 400 });
  }

  try {
    const result = await client.mutation(api.imageAnnotations.saveForImage, {
      annotations,
      imageKey,
      imagePath,
      seriesKey,
      siteSlug,
    });
    return Response.json(result, {
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Host",
      },
    });
  } catch (error) {
    console.warn("[dicom] Annotation save unavailable", error);
    return Response.json(
      { error: "Annotation storage unavailable" },
      {
        status: 503,
        headers: {
          "Cache-Control": "private, no-store",
          Vary: "Host",
        },
      },
    );
  }
}

async function handleSharePreviewRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  const url = new URL(request.url);
  const routePath =
    request.headers.get("x-share-preview-path") ??
    url.searchParams.get("path") ??
    "/";
  const slug = routePath.replace(/^\/+/, "") || "index";
  const [site, page] = await Promise.all([
    client.query(api.sites.getBySlug, { slug: siteSlug }).catch(() => null),
    client
      .query(api.documents.getBySlug, withSiteSlug(siteSlug, { slug }))
      .catch(() => null),
  ]);
  const siteName = site?.config.title ?? site?.name ?? "TNBC Knowledge Base";
  const description = site?.config.description ?? DEFAULT_SITE_DESCRIPTION;
  const ogTitle = page?.title ?? siteName;
  const title = page?.title ? `${page.title} - ${siteName}` : siteName;
  const canonicalPath = routePath.startsWith("/") ? routePath : `/${routePath}`;
  const canonicalUrl = new URL(canonicalPath, url.origin).toString();

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="robots" content="noindex,nofollow">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <meta property="og:title" content="${escapeHtml(ogTitle)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="${escapeHtml(siteName)}">
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="${escapeHtml(ogTitle)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  </head>
  <body></body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
      "x-site-slug": siteSlug,
      "Cache-Control": "private, no-store",
      Vary: "Host",
    },
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function handleTestDiagnosticStudiesRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  const body = (await request.json()) as {
    studies?: unknown;
    studySet?: string;
  };
  const studySet = normalizeDiagnosticStudySet(body.studySet);
  if (!studySet) {
    return Response.json({ error: "Invalid studySet" }, { status: 400 });
  }

  const payload = normalizeDiagnosticStudiesPayload({ studies: body.studies });
  await client.mutation(
    api.documents.setMeta,
    withSiteSlug(siteSlug, {
      key: diagnosticStudiesMetaKeyForSet(studySet),
      value: JSON.stringify(payload),
    }),
  );
  return Response.json(payload, {
    headers: {
      "Cache-Control": "no-store",
      Vary: "Host",
    },
  });
}

async function handleTestDicomComparisonsRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  const body = (await request.json()) as {
    comparisonSet?: string;
    comparisons?: unknown;
  };
  const comparisonSet = normalizeDiagnosticComparisonSet(body.comparisonSet);
  if (!comparisonSet) {
    return Response.json({ error: "Invalid comparisonSet" }, { status: 400 });
  }

  const payload = normalizeDiagnosticComparisonsPayload({
    comparisons: body.comparisons,
  });
  await client.mutation(
    api.documents.setMeta,
    withSiteSlug(siteSlug, {
      key: diagnosticComparisonsMetaKeyForSet(comparisonSet),
      value: JSON.stringify(payload),
    }),
  );
  return Response.json(payload, {
    headers: {
      "Cache-Control": "no-store",
      Vary: "Host",
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

function archiverToStream(
  label: string,
  fill: (arc: archiver.Archiver) => Promise<void>,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const arc = archiver("zip", { zlib: { level: 1 } });
      arc.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      arc.on("end", () => controller.close());
      arc.on("error", (error) => {
        console.error(`[download] ${label} archive stream error`, error);
        controller.error(error);
      });
      fill(arc).catch((error) => {
        console.error(`[download] ${label} archive fill error`, error);
        controller.error(error);
      });
    },
  });
}

function archiveFilename(type: "full" | "markdown", siteSlug: string) {
  const sitePart = siteSlug === DEFAULT_SITE_SLUG ? "diana-tnbc" : siteSlug;
  return `${sitePart}-wiki-${type}.zip`;
}

function archiveEntryPath(filePath: string) {
  return normalizeFilePath(filePath).replace(/^\/+/, "") || "file";
}

async function appendMarkdownToArchive(
  arc: archiver.Archiver,
  client: ConvexHttpClient,
  siteSlug: string,
  includeSensitive: boolean,
  maxPages: number,
) {
  let cursor: string | null = null;
  let isDone = false;
  let totalDocs = 0;

  while (!isDone && totalDocs < maxPages) {
    const numItems = Math.min(100, maxPages - totalDocs);
    const args = includeSensitive
      ? { cursor, numItems, includeSensitive: true as const }
      : { cursor, numItems };
    const result: PageDownloadResult = await client.query(
      api.documents.listPageWithContent,
      withSiteSlug(siteSlug, args),
    );

    for (const page of result.page) {
      if (!page.content) continue;
      const content = await redactText(client, siteSlug, page.content);
      arc.append(Buffer.from(content, "utf-8"), { name: `${page.slug}.md` });
      totalDocs++;
      if (totalDocs >= maxPages) break;
    }

    isDone = result.isDone;
    cursor = result.continueCursor;
    if (!isDone && !cursor) {
      throw new Error("Download pagination failed");
    }
  }
}

async function appendAssetsToArchive(
  arc: archiver.Archiver,
  client: ConvexHttpClient,
  siteSlug: string,
  includeSensitive: boolean,
  maxAssets: number,
) {
  const args = withSiteSlug(
    siteSlug,
    includeSensitive ? { includeSensitive: true as const } : {},
  );
  const [pdfAssets, fileAssets] = await Promise.all([
    client.query(api.documents.listPdfAssets, args) as Promise<DownloadAsset[]>,
    client.query(api.documents.listFileAssets, args) as Promise<DownloadAsset[]>,
  ]);
  const assets = [...pdfAssets, ...fileAssets];

  for (const asset of assets.slice(0, maxAssets)) {
    if (!asset.blobUrl) continue;
    try {
      const response = await fetch(asset.blobUrl);
      if (!response.ok) {
        console.warn(`[download] Failed to fetch asset ${asset.path}: ${response.status}`);
        continue;
      }
      arc.append(Buffer.from(await response.arrayBuffer()), {
        name: archiveEntryPath(asset.path),
      });
    } catch (error) {
      console.warn(`[download] Failed to fetch asset ${asset.path}`, error);
    }
  }
}

async function handleDownloadRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type") === "markdown" ? "markdown" : "full";
  const scope = url.searchParams.get("scope");
  const includeSensitive = scope === "public"
    ? false
    : Boolean(await getSessionUser(request, client, siteSlug));
  const rawLimit = Number(url.searchParams.get("limit") ?? 0);
  const maxPages = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(5000, Math.floor(rawLimit))
    : Number.POSITIVE_INFINITY;
  const rawAssetLimit = Number(url.searchParams.get("assetLimit") ?? 0);
  const maxAssets = Number.isFinite(rawAssetLimit) && rawAssetLimit > 0
    ? Math.min(5000, Math.floor(rawAssetLimit))
    : Number.POSITIVE_INFINITY;

  const stream = archiverToStream(type, async (arc) => {
    if (type === "full") {
      await appendAssetsToArchive(arc, client, siteSlug, includeSensitive, maxAssets);
    }
    await appendMarkdownToArchive(arc, client, siteSlug, includeSensitive, maxPages);
    await arc.finalize();
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${archiveFilename(type, siteSlug)}"`,
      "Cache-Control": includeSensitive
        ? "private, no-store"
        : "public, max-age=300, s-maxage=3600",
      Vary: includeSensitive ? "Accept, Cookie, Host" : "Accept, Host",
      "X-Wiki-Cache-Scope": includeSensitive ? "session" : "public",
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

async function handleTimelineRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  const url = new URL(request.url);
  const timelineValue = await client.query(
    api.documents.getMeta,
    withSiteSlug(siteSlug, { key: TIMELINE_META_KEY }),
  );

  if (!timelineValue) {
    return Response.json(
      { error: `Diagnostic timeline not found for site '${siteSlug}'` },
      {
        status: 404,
        headers: {
          "Cache-Control": "private, no-store",
          Vary: "Host",
        },
      },
    );
  }

  const diagnosticStudiesValue = await client.query(
    api.documents.getMeta,
    withSiteSlug(siteSlug, {
      key: diagnosticStudiesMetaKeyForSet(url.searchParams.get("studySet")),
    }),
  );
  const diagnosticStudies = parseDiagnosticStudiesPayload(diagnosticStudiesValue);
  const timeline = prepareDiagnosticTimelineResponse(
    timelineValue,
    diagnosticStudies,
  ) satisfies DiagnosticTimelineData;

  return Response.json(timeline, {
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Host",
    },
  });
}

export function createWikiApiHandler(client = createClient()) {
  return async function handleWikiApiRequest(request: Request): Promise<Response | null> {
    const pathname = new URL(request.url).pathname;
    const handled =
      pathname.startsWith("/api/wiki/") ||
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
      pathname === "/api/share-preview" ||
      pathname === "/api/dicom/file" ||
      pathname === "/api/dicom/studies" ||
      pathname === "/api/dicom/annotations" ||
      pathname === "/api/dicom/comparisons" ||
      pathname.startsWith("/api/dicom/comparisons/") ||
      pathname === "/api/test/diagnostic-studies" ||
      pathname === "/api/test/dicom-comparisons" ||
      pathname === "/api/tools" ||
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
    const context = {
      siteSlug,
      documents: createDocumentsGateway(client, siteSlug),
      getSessionUser: (nextRequest: Request) =>
        getSessionUser(nextRequest, client, siteSlug),
      manifestPrioritySlugs: MANIFEST_PRIORITY_SLUGS,
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
      return handleSearchRequest(request, client, siteSlug);
    }

    if (pathname === "/api/timeline") {
      return handleTimelineRequest(request, client, siteSlug);
    }

    if (pathname === "/api/diagnostic-studies") {
      return handleDiagnosticStudiesRequest(request, client, siteSlug);
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
