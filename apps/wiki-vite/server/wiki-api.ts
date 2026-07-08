import crypto from "node:crypto";
import path from "node:path";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import archiver from "archiver";
import { ConvexHttpClient } from "convex/browser";
import { Liveblocks, WebhookHandler } from "@liveblocks/node";
import type { Plugin } from "vite";
import { legacyRedirectResponse } from "./redirects.ts";
import {
  createWikiManifestResponse,
  createWikiPagesResponse,
  createWikiSessionResponse,
  type PageWithContent,
  type WikiApiAccessAdapter,
  type WikiApiDocumentsGateway,
} from "@oncobase/wiki-content/server";
import { resolveServerConvexUrl } from "@oncobase/wiki-content/convex-url";
import { readChatPageFromDocuments } from "@oncobase/wiki-content/chat-tools";
import { applyPiiRedactions, parseSitePiiPatterns, type PiiPattern } from "@oncobase/wiki-content/pii";
import {
  liveblocksDisabledResponse,
  resolveLiveblocksConfig,
} from "@oncobase/wiki-comments/site";
import {
  persistLiveblocksGuestName,
  resolveLiveblocksUsers,
} from "@oncobase/wiki-comments/user-resolution";
import {
  LIVEBLOCKS_GUEST_COOKIE,
  parseGuestUser,
} from "@oncobase/wiki-comments/guest-user";
import { api } from "../../../apps/web/convex/_generated/api.js";
import type { Id } from "../../../apps/web/convex/_generated/dataModel.js";
import { handleAiSearchRequest } from "./ai-search.js";
import { handleChatRequest } from "./chat-route.js";
import {
  createRole,
  deleteRole,
  deleteUsers,
  getAccessPagesData,
  getAccessUsersAndRoles,
  requireAdminUser,
  setUserRole,
  setUsersRole,
  updateRole,
} from "./admin-data.js";
import {
  handleEpicAuthorizeRequest,
  handleEpicCallbackRequest,
  handleEpicSyncRequest,
  isAdminSessionUser,
} from "./epic-fhir.js";
import { handlePostDeployRequest, handlePublishRequest } from "./publish-api.js";

const DEFAULT_SITE_SLUG = "diana";
const HOST_CACHE_TTL_MS = 15_000;
const VERCEL_PROJECT_HOST_PREFIX = "diana-tnbc";
const USER_SESSION_COOKIE = "wiki_user_session";
const USER_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const DIANA_PASSWORDS = new Set(["wallify", "diana"]);
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 50;
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

type SessionUser = {
  _id: Id<"users">;
  email: string;
  name?: string | null;
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
  return new ConvexHttpClient(resolveServerConvexUrl());
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

function createAccessAdapter(
  client: ConvexHttpClient,
  siteSlug: string,
): WikiApiAccessAdapter {
  return {
    canUserAccessSlug: (user, slug) =>
      client.query(
        api.access.canUserAccessSlug,
        withSiteSlug(siteSlug, { userId: user._id as Id<"users">, slug }),
      ),
    getAllowedSlugs: async (user) => {
      const allowed: string[] = [];
      let cursor: string | null = null;
      let isDone = false;

      while (!isDone) {
        const result = (await client.query(
          api.documents.listManifestPage,
          withSiteSlug(siteSlug, {
            cursor,
            numItems: 100,
            includeSensitive: true,
          }),
        )) as {
          page: Array<{ slug: string; sensitive?: boolean }>;
          isDone: boolean;
          continueCursor: string | null;
        };
        const checks = await Promise.all(
          result.page.map(async (page) => {
            if (page.sensitive !== true) return null;
            const canAccess = await client.query(
              api.access.canUserAccessSlug,
              withSiteSlug(siteSlug, {
                userId: user._id as Id<"users">,
                slug: page.slug,
              }),
            );
            return canAccess ? page.slug : null;
          }),
        );
        allowed.push(...checks.filter((slug): slug is string => slug !== null));
        isDone = result.isDone;
        cursor = result.continueCursor;
      }

      return allowed;
    },
  };
}

async function canUserAccessSlug(
  client: ConvexHttpClient,
  siteSlug: string,
  user: SessionUser | null,
  slug: string,
) {
  if (!user) return false;
  return client.query(
    api.access.canUserAccessSlug,
    withSiteSlug(siteSlug, { userId: user._id, slug }),
  );
}

async function filterAccessiblePages<T extends { slug: string; sensitive?: boolean }>(
  client: ConvexHttpClient,
  siteSlug: string,
  user: SessionUser | null,
  pages: Array<T | null>,
): Promise<T[]> {
  const visible: T[] = [];
  for (const page of pages) {
    if (!page) continue;
    if (page.sensitive !== true || (await canUserAccessSlug(client, siteSlug, user, page.slug))) {
      visible.push(page);
    }
  }
  return visible;
}

async function filterPotentiallySensitivePages<T extends { slug: string; sensitive?: boolean }>(
  client: ConvexHttpClient,
  siteSlug: string,
  user: SessionUser | null,
  pages: Array<T | null>,
): Promise<T[]> {
  const visible: T[] = [];
  for (const page of pages) {
    if (!page) continue;
    if (page.sensitive === false) {
      visible.push(page);
      continue;
    }
    const doc = page.sensitive === true
        ? page
        : await client.query(
            api.documents.getBySlug,
            withSiteSlug(siteSlug, {
              slug: page.slug,
              includeSensitive: true,
            }),
          );
    if (doc?.sensitive !== true || (await canUserAccessSlug(client, siteSlug, user, page.slug))) {
      visible.push(page);
    }
  }
  return visible;
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

  const sessionUser = await getSessionUser(request, client, siteSlug);
  const siblingDoc = await client.query(
    api.documents.getBySlug,
    withSiteSlug(siteSlug, { slug: assetPathToSiblingSlug(normalized), includeSensitive: true }),
  );
  const includeSensitive = Boolean(
    sessionUser &&
      siblingDoc?.sensitive === true &&
      (await canUserAccessSlug(client, siteSlug, sessionUser, siblingDoc.slug)),
  );
  if (siblingDoc?.sensitive && !includeSensitive) {
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
  if (
    privatePage.sensitive === true &&
    !(await canUserAccessSlug(client, siteSlug, sessionUser, privatePage.slug))
  ) {
    return new Response("Not found", { status: 404 });
  }

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
  sessionUser: SessionUser | null,
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

    const visiblePages = await filterAccessiblePages(client, siteSlug, sessionUser, result.page);
    for (const page of visiblePages) {
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
  sessionUser: SessionUser | null,
  maxAssets: number,
) {
  const args = withSiteSlug(
    siteSlug,
    includeSensitive ? { includeSensitive: true as const } : {},
  );
  const collected: DownloadAsset[] = [];
  for (const queryRef of [api.documents.listPdfAssetsPage, api.documents.listFileAssetsPage]) {
    let cursor: string | null = null;
    let isDone = false;
    while (!isDone && collected.length < maxAssets) {
      const result = (await client.query(queryRef, {
        ...args,
        cursor,
        numItems: Math.min(500, maxAssets - collected.length),
      })) as { page: DownloadAsset[]; isDone: boolean; continueCursor: string | null };
      collected.push(...result.page);
      isDone = result.isDone;
      cursor = result.continueCursor;
      if (!isDone && !cursor) break;
    }
  }
  const assets = await Promise.all(
    collected.map(async (asset) => {
      const sibling = await client.query(
        api.documents.getBySlug,
        withSiteSlug(siteSlug, {
          slug: asset.path.replace(/\.[^/.]+$/, ""),
          includeSensitive: true,
        }),
      );
      if (!sibling?.sensitive) return asset;
      return (await canUserAccessSlug(client, siteSlug, sessionUser, sibling.slug))
        ? asset
        : null;
    }),
  ).then((items) => items.filter((asset): asset is DownloadAsset => asset !== null));

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
  const sessionUser = scope === "public"
    ? null
    : await getSessionUser(request, client, siteSlug);
  const includeSensitive = Boolean(sessionUser);
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
      await appendAssetsToArchive(arc, client, siteSlug, includeSensitive, sessionUser, maxAssets);
    }
    await appendMarkdownToArchive(arc, client, siteSlug, includeSensitive, sessionUser, maxPages);
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

  const sessionUser = await getSessionUser(request, client, siteSlug);
  const includeSensitive = Boolean(sessionUser);
  const results = await client.query(
    api.documents.search,
    withSiteSlug(siteSlug, { query, limit, includeSensitive }),
  );
  const visibleResults = await filterPotentiallySensitivePages(
    client,
    siteSlug,
    sessionUser,
    results,
  );
  const patterns = await getPiiPatterns(client, siteSlug);
  const redact = (value: string | undefined) =>
    value == null ? value : applyPiiRedactions(value, { patterns });
  const redactedResults = visibleResults.map((result) => ({
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
  sessionUser: SessionUser | null,
) {
  return readChatPageFromDocuments(
    {
      getBySlug: async (args) => {
        const page = await client.query(api.documents.getBySlug, withSiteSlug(siteSlug, args));
        if (!page?.sensitive) return page;
        return (await canUserAccessSlug(client, siteSlug, sessionUser, page.slug))
          ? page
          : null;
      },
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
  const sessionUser = await getSessionUser(request, client, siteSlug);
  const includeSensitive = Boolean(sessionUser);

  switch (tool) {
    case "search_wiki": {
      const query = String(args.query ?? "");
      const patterns = await getPiiPatterns(client, siteSlug);
      const results = await client.query(
        api.documents.search,
        withSiteSlug(siteSlug, { query, limit: 8, includeSensitive }),
      );
      const visibleResults = await filterPotentiallySensitivePages(
        client,
        siteSlug,
        sessionUser,
        results,
      );
      return Response.json(
        visibleResults.map((result) => ({
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
      return Response.json(await readToolPage(client, siteSlug, String(args.slug ?? ""), sessionUser), {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Wiki-Cache-Scope": "session",
        },
      });
    }
    case "list_pages": {
      const pages = await client.action(
        api.documents.list,
        withSiteSlug(siteSlug, { includeSensitive }),
      );
      return Response.json(await filterAccessiblePages(client, siteSlug, sessionUser, pages), {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Wiki-Cache-Scope": "session",
        },
      });
    }
    case "get_pages_by_tag": {
      const pages = await client.action(
        api.documents.getByTag,
        withSiteSlug(siteSlug, {
          tag: String(args.tag ?? ""),
          includeSensitive,
        }),
      );
      return Response.json(
        await filterAccessiblePages(client, siteSlug, sessionUser, pages),
        {
          headers: {
            "Cache-Control": "private, no-store",
            "X-Wiki-Cache-Scope": "session",
          },
        },
      );
    }
    case "list_tags": {
      const pages = await client.action(
        api.documents.list,
        withSiteSlug(siteSlug, { includeSensitive }),
      );
      const visiblePages = await filterAccessiblePages(client, siteSlug, sessionUser, pages);
      return Response.json(
        Array.from(new Set(visiblePages.flatMap((page) => page.tags))).sort(),
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

type CachedLiveblocksThreadsResponse = {
  body: object;
  timestamp: number;
};

const LIVEBLOCKS_THREADS_RESPONSE_TTL_MS = 30_000;
const liveblocksThreadsResponseCache = new Map<string, CachedLiveblocksThreadsResponse>();

function commentsFeatureEnabled() {
  return process.env.NEXT_PUBLIC_ENABLE_COMMENTS !== "false";
}

function liveblocksUserAdapter(client: ConvexHttpClient, siteSlug: string) {
  return {
    getUsersByIds: (ids: string[]) =>
      client.query(
        api.users.getUsersByIds,
        withSiteSlug(siteSlug, { ids: ids as Id<"users">[] }),
      ),
    getGuestNamesByIds: (guestIds: string[]) =>
      client.query(api.guestNames.getByIds, withSiteSlug(siteSlug, { guestIds })),
    upsertGuestName: (guest: { id: string; name: string }) =>
      client.mutation(
        api.guestNames.upsert,
        withSiteSlug(siteSlug, { guestId: guest.id, name: guest.name }),
      ),
  };
}

async function getLiveblocksConfig(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  return resolveLiveblocksConfig(request, {
    defaultSiteSlug: DEFAULT_SITE_SLUG,
    getSiteBySlug: (slug) => client.query(api.sites.getBySlug, { slug }),
    isCommentsFeatureEnabled: commentsFeatureEnabled,
    siteSlugFromRequest: () => siteSlug,
  });
}

function parseGuestUserFromRequest(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const guestCookie = cookieHeader
    .split(/;\s*/)
    .find((part) => part.startsWith(`${LIVEBLOCKS_GUEST_COOKIE}=`))
    ?.slice(LIVEBLOCKS_GUEST_COOKIE.length + 1);
  return parseGuestUser(guestCookie);
}

async function isSensitiveCommentRoom(
  roomId: string,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (!roomId.startsWith("markdown:")) return false;
  const doc = await client.query(
    api.documents.getBySlug,
    withSiteSlug(siteSlug, {
      includeSensitive: true,
      slug: roomId.slice("markdown:".length),
    }),
  );
  return doc?.sensitive === true;
}

async function filterPublicCommentRooms(
  roomIds: string[],
  client: ConvexHttpClient,
  siteSlug: string,
) {
  const sensitive = await Promise.all(
    roomIds.map((roomId) => isSensitiveCommentRoom(roomId, client, siteSlug)),
  );
  return roomIds.filter((_, index) => !sensitive[index]);
}

function invalidateLiveblocksThreadsCache(siteSlug?: string) {
  if (!siteSlug) {
    liveblocksThreadsResponseCache.clear();
    return;
  }
  liveblocksThreadsResponseCache.delete(`${siteSlug}:public`);
  liveblocksThreadsResponseCache.delete(`${siteSlug}:private`);
}

async function seedCommentRoomsInBackground(
  liveblocks: Liveblocks,
  allRoomIds: string[],
  client: ConvexHttpClient,
  siteSlug: string,
) {
  try {
    const roomCounts: Array<{ roomId: string; threadCount: number }> = [];
    const results = await Promise.allSettled(
      allRoomIds.map(async (roomId) => {
        const { data } = await liveblocks.getThreads({ roomId });
        return { roomId, threadCount: data.length };
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value.threadCount > 0) {
        roomCounts.push(result.value);
      }
    }

    if (roomCounts.length > 0) {
      await client.mutation(
        api.commentRooms.syncRooms,
        withSiteSlug(siteSlug, { rooms: roomCounts }),
      );
      console.log(
        `[liveblocks-threads] Seeded ${roomCounts.length} active rooms into Convex`,
      );
    }
  } catch (error) {
    console.error("[liveblocks-threads] Background seed error:", error);
  }
}

async function handleLiveblocksAuthRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (request.method === "GET") {
    const config = await getLiveblocksConfig(request, client, siteSlug);
    return Response.json({
      configured: config.ok,
      siteSlug: config.ok ? config.creds.siteSlug : config.siteSlug,
      reason: config.ok ? null : config.reason,
    });
  }

  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: "GET, POST" } },
    );
  }

  const config = await getLiveblocksConfig(request, client, siteSlug);
  if (!config.ok) return liveblocksDisabledResponse(config);

  const { room } = (await request.json().catch(() => ({}))) as { room?: string };
  if (!room || typeof room !== "string") {
    return Response.json({ error: "room is required" }, { status: 400 });
  }

  const sessionUser = await getSessionUser(request, client, siteSlug);
  if (!sessionUser && (await isSensitiveCommentRoom(room, client, siteSlug))) {
    return Response.json({ error: "Room not found" }, { status: 404 });
  }

  const guestUser = sessionUser ? null : parseGuestUserFromRequest(request);
  if (guestUser) {
    await persistLiveblocksGuestName(
      guestUser,
      liveblocksUserAdapter(client, siteSlug),
    ).catch(() => {});
  }

  const liveblocks = new Liveblocks({ secret: config.creds.secretKey });
  const userId = sessionUser?._id ?? guestUser?.id ?? `guest:${room}`;
  const userInfo = {
    name: sessionUser?.name || sessionUser?.email || guestUser?.name || "Guest",
    email: sessionUser?.email,
  };

  const session = liveblocks.prepareSession(userId, { userInfo });
  session.allow(room, sessionUser ? session.FULL_ACCESS : session.READ_ACCESS);
  const { body, status } = await session.authorize();
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleLiveblocksThreadsRequest(
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

  const config = await getLiveblocksConfig(request, client, siteSlug);
  if (!config.ok) return liveblocksDisabledResponse(config);

  const liveblocks = new Liveblocks({ secret: config.creds.secretKey });
  const includeSensitive = Boolean(await getSessionUser(request, client, siteSlug));
  const cacheKey = `${siteSlug}:${includeSensitive ? "private" : "public"}`;
  const url = new URL(request.url);
  const bypassCache =
    url.searchParams.get("fresh") === "1" ||
    request.headers.get("cache-control")?.includes("no-cache") === true;
  const cached = liveblocksThreadsResponseCache.get(cacheKey);
  if (!bypassCache && cached && Date.now() - cached.timestamp < LIVEBLOCKS_THREADS_RESPONSE_TTL_MS) {
    return Response.json(cached.body);
  }

  const startedAt = Date.now();
  const timing: Record<string, number> = {};

  try {
    let roomsToQuery: string[];
    let mode: string;
    let activeRooms: string[] = [];

    if (!bypassCache) {
      try {
        activeRooms = await client.query(
          api.commentRooms.listActive,
          withSiteSlug(siteSlug, {}),
        );
      } catch {
        activeRooms = [];
      }
    }
    timing.convexLookup = Date.now() - startedAt;

    if (activeRooms.length > 0) {
      roomsToQuery = activeRooms;
      mode = "convex";
    } else {
      const rooms: string[] = [];
      let cursor: string | null = null;
      do {
        const page = await liveblocks.getRooms({
          query: { roomId: { startsWith: "markdown:" } },
          limit: 100,
          ...(cursor ? { startingAfter: cursor } : {}),
        });
        rooms.push(...page.data.map((room) => room.id));
        cursor = page.nextCursor;
      } while (cursor);

      roomsToQuery = rooms;
      mode = "full-scan";
      void seedCommentRoomsInBackground(liveblocks, roomsToQuery, client, siteSlug);
    }

    timing.listRooms = Date.now() - startedAt;
    if (!includeSensitive) {
      roomsToQuery = await filterPublicCommentRooms(roomsToQuery, client, siteSlug);
    }
    timing.roomCount = roomsToQuery.length;

    const fetchStartedAt = Date.now();
    const allThreads: Array<{
      id: string;
      roomId: string;
      createdAt: string;
      updatedAt: string;
      resolved: boolean;
      comments: Array<{
        id: string;
        userId: string;
        createdAt: string;
        body: unknown;
      }>;
      metadata: Record<string, unknown>;
    }> = [];

    const results = await Promise.allSettled(
      roomsToQuery.map(async (roomId) => {
        const { data } = await liveblocks.getThreads({ roomId });
        return { roomId, threads: data };
      }),
    );

    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      for (const thread of result.value.threads) {
        allThreads.push({
          id: thread.id,
          roomId: thread.roomId,
          createdAt: thread.createdAt.toISOString(),
          updatedAt:
            thread.updatedAt?.toISOString() ?? thread.createdAt.toISOString(),
          resolved: thread.resolved,
          comments: thread.comments.map((comment) => ({
            id: comment.id,
            userId: comment.userId,
            createdAt: comment.createdAt.toISOString(),
            body: comment.body,
          })),
          metadata: (thread.metadata ?? {}) as Record<string, unknown>,
        });
      }
    }
    timing.fetchThreads = Date.now() - fetchStartedAt;

    const resolveStartedAt = Date.now();
    const uniqueUserIds = [
      ...new Set(allThreads.flatMap((thread) => thread.comments.map((comment) => comment.userId))),
    ];
    const resolvedUsers = await resolveLiveblocksUsers(
      uniqueUserIds,
      liveblocksUserAdapter(client, siteSlug),
    );
    const userNames = Object.fromEntries(
      Object.entries(resolvedUsers).map(([id, user]) => [id, user.name]),
    );
    timing.resolveNames = Date.now() - resolveStartedAt;
    timing.total = Date.now() - startedAt;

    const body = {
      threads: allThreads,
      userNames,
      _timing: { ...timing, mode },
    };
    if (!bypassCache) {
      liveblocksThreadsResponseCache.set(cacheKey, { body, timestamp: Date.now() });
    }

    console.log(
      `[liveblocks-threads] ${mode} | ${roomsToQuery.length} rooms queried, ${allThreads.length} threads | convexLookup=${timing.convexLookup}ms fetchThreads=${timing.fetchThreads}ms resolveNames=${timing.resolveNames}ms total=${timing.total}ms`,
    );

    return Response.json(body, {
      headers: bypassCache ? { "Cache-Control": "no-store" } : undefined,
    });
  } catch (error) {
    console.error("[liveblocks-threads] Error:", error);
    return Response.json({ error: "Failed to fetch threads" }, { status: 500 });
  }
}

async function handleLiveblocksAddCommentRequest(
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

  const config = await getLiveblocksConfig(request, client, siteSlug);
  if (!config.ok) return liveblocksDisabledResponse(config);

  const { roomId, threadId, body: commentText } = (await request.json().catch(() => ({}))) as {
    roomId?: string;
    threadId?: string;
    body?: string;
  };
  if (!roomId || !threadId || !commentText?.trim()) {
    return Response.json(
      { error: "roomId, threadId, and body are required" },
      { status: 400 },
    );
  }

  const sessionUser = await getSessionUser(request, client, siteSlug);
  if (!sessionUser) {
    return Response.json({ error: "Sign in to comment" }, { status: 401 });
  }

  try {
    const liveblocks = new Liveblocks({ secret: config.creds.secretKey });
    const comment = await liveblocks.createComment({
      roomId,
      threadId,
      data: {
        userId: sessionUser._id,
        body: {
          version: 1,
          content: [
            {
              type: "paragraph",
              children: [{ text: commentText.trim() }],
            },
          ],
        },
      },
    });
    return Response.json({ ok: true, comment });
  } catch (error) {
    console.error("[liveblocks-add-comment] Error:", error);
    return Response.json({ error: "Failed to add comment" }, { status: 500 });
  }
}

async function handleLiveblocksDeleteThreadRequest(
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

  const { roomId, threadId } = (await request.json().catch(() => ({}))) as {
    roomId?: string;
    threadId?: string;
  };
  if (!roomId || !threadId) {
    return Response.json(
      { error: "roomId and threadId are required" },
      { status: 400 },
    );
  }

  const config = await getLiveblocksConfig(request, client, siteSlug);
  if (!config.ok) return liveblocksDisabledResponse(config);

  const sessionUser = await getSessionUser(request, client, siteSlug);
  if (!sessionUser) {
    return Response.json({ error: "Sign in to manage comments" }, { status: 401 });
  }

  try {
    const liveblocks = new Liveblocks({ secret: config.creds.secretKey });
    await liveblocks.deleteThread({ roomId, threadId });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[liveblocks-delete-thread] Error:", error);
    return Response.json({ error: "Failed to delete thread" }, { status: 500 });
  }
}

async function handleLiveblocksUsersRequest(
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

  const body = (await request.json().catch(() => null)) as { userIds?: unknown } | null;
  if (!Array.isArray(body?.userIds)) {
    return Response.json({ error: "userIds array is required" }, { status: 400 });
  }

  const userIds = body.userIds.filter(
    (userId): userId is string => typeof userId === "string",
  );
  if (userIds.length !== body.userIds.length) {
    return Response.json(
      { error: "userIds must only contain strings" },
      { status: 400 },
    );
  }
  if (userIds.length > 100) {
    return Response.json(
      { error: "userIds is limited to 100 entries" },
      { status: 400 },
    );
  }

  const users = await resolveLiveblocksUsers(
    userIds,
    liveblocksUserAdapter(client, siteSlug),
  );
  return Response.json({ users });
}

async function handleLiveblocksGuestRequest(
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

  const { guestId, name } = (await request.json().catch(() => ({}))) as {
    guestId?: string;
    name?: string;
  };
  if (!guestId || !name) {
    return Response.json({ error: "guestId and name required" }, { status: 400 });
  }

  try {
    await persistLiveblocksGuestName(
      { id: guestId, name },
      liveblocksUserAdapter(client, siteSlug),
    );
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Failed to save guest name" }, { status: 500 });
  }
}

async function resolveLiveblocksWebhookSiteSlug(
  event: { data?: { projectId?: string } },
  client: ConvexHttpClient,
) {
  const workspaceId = event.data?.projectId;
  if (!workspaceId) return DEFAULT_SITE_SLUG;
  try {
    const site = await client.query(api.sites.getByLiveblocksWorkspace, {
      workspaceId,
    });
    return site?.slug ?? DEFAULT_SITE_SLUG;
  } catch {
    return DEFAULT_SITE_SLUG;
  }
}

async function handleLiveblocksWebhookRequest(
  request: Request,
  client: ConvexHttpClient,
) {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: "POST" } },
    );
  }

  const webhookSecret = process.env.LIVEBLOCKS_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return Response.json(
      { error: "Webhook secret not configured" },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  let event: { type?: string; data?: { projectId?: string; roomId?: string } };
  try {
    event = new WebhookHandler(webhookSecret).verifyRequest({
      headers: Object.fromEntries(request.headers.entries()),
      rawBody,
    }) as typeof event;
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  const webhookSiteSlug = await resolveLiveblocksWebhookSiteSlug(event, client);

  try {
    switch (event.type) {
      case "threadCreated":
        if (event.data?.roomId) {
          await client.mutation(
            api.commentRooms.incrementRoom,
            withSiteSlug(webhookSiteSlug, { roomId: event.data.roomId }),
          );
          invalidateLiveblocksThreadsCache(webhookSiteSlug);
        }
        break;
      case "threadDeleted":
        if (event.data?.roomId) {
          await client.mutation(
            api.commentRooms.decrementRoom,
            withSiteSlug(webhookSiteSlug, { roomId: event.data.roomId }),
          );
          invalidateLiveblocksThreadsCache(webhookSiteSlug);
        }
        break;
      case "commentCreated":
      case "commentEdited":
      case "commentDeleted":
      case "threadMarkedAsResolved":
      case "threadMarkedAsUnresolved":
        invalidateLiveblocksThreadsCache(webhookSiteSlug);
        break;
    }
  } catch (error) {
    console.error("[liveblocks-webhook] Error processing event:", error);
    return Response.json(
      { error: "Failed to process webhook" },
      { status: 500 },
    );
  }

  return Response.json({ ok: true });
}

async function requireAdminForRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  return requireAdminUser({
    client,
    siteSlug,
    sessionUser: await getSessionUser(request, client, siteSlug),
  });
}

async function handleAdminRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  const adminUser = await requireAdminForRequest(request, client, siteSlug);
  if (!adminUser) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/admin/session") {
    return Response.json(
      {
        user: {
          _id: adminUser._id,
          ...publicSessionUser(adminUser),
        },
        isAdmin: true,
      },
      { headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Host" } },
    );
  }

  if (request.method === "GET" && url.pathname === "/api/admin/access") {
    const view = url.searchParams.get("view");
    if (view === "users") {
      return Response.json(await getAccessUsersAndRoles(client, siteSlug), {
        headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Host" },
      });
    }
    return Response.json(await getAccessPagesData(client, siteSlug), {
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Host" },
    });
  }

  if (request.method === "POST" && url.pathname === "/api/admin/roles") {
    const body = await request.json();
    if (typeof body.roleId === "string") {
      return Response.json(await updateRole(client, siteSlug, body.roleId, body.values));
    }
    return Response.json(await createRole(client, siteSlug, body.values));
  }

  if (request.method === "DELETE" && url.pathname === "/api/admin/roles") {
    const body = await request.json();
    return Response.json(await deleteRole(client, siteSlug, String(body.roleId ?? "")));
  }

  if (request.method === "POST" && url.pathname === "/api/admin/users/role") {
    const body = await request.json();
    if (Array.isArray(body.userIds)) {
      return Response.json(
        await setUsersRole(
          client,
          siteSlug,
          body.userIds.map(String),
          typeof body.roleId === "string" ? body.roleId : undefined,
        ),
      );
    }
    return Response.json(
      await setUserRole(
        client,
        siteSlug,
        String(body.userId ?? ""),
        typeof body.roleId === "string" ? body.roleId : undefined,
      ),
    );
  }

  if (request.method === "DELETE" && url.pathname === "/api/admin/users") {
    const body = await request.json();
    return Response.json(
      await deleteUsers(
        client,
        siteSlug,
        Array.isArray(body.userIds) ? body.userIds.map(String) : [],
      ),
    );
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/admin/pii/")) {
    const slug = decodeURIComponent(url.pathname.slice("/api/admin/pii/".length));
    const token = sessionTokenFromCookie(request.headers.get("cookie") ?? "");
    const page = await client.query(
      api.documents.getBySlug,
      withSiteSlug(siteSlug, {
        slug,
        includeSensitive: true,
        rawContentSessionTokenHash: token ? hashSessionToken(token) : undefined,
      }),
    );
    if (!page) return new Response("Not found", { status: 404 });
    return Response.json(page, {
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Host" },
    });
  }

  return new Response("Not found", { status: 404 });
}

export function createWikiApiHandler(client = createClient()) {
  return async function handleWikiApiRequest(request: Request): Promise<Response | null> {
    const pathname = new URL(request.url).pathname;
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
      pathname === "/api/post-deploy" ||
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
      access: createAccessAdapter(client, siteSlug),
      manifestPrioritySlugs: MANIFEST_PRIORITY_SLUGS,
      decorateHeaders: decorateViteHeaders,
      logger: console,
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }

    if (pathname.startsWith("/api/publish/")) {
      return handlePublishRequest({
        request,
        client,
        step: pathname.slice("/api/publish/".length),
      });
    }

    if (pathname === "/api/post-deploy") {
      return handlePostDeployRequest(request);
    }

    if (pathname.startsWith("/api/admin/")) {
      return handleAdminRequest(request, client, siteSlug);
    }

    if (pathname === "/api/wiki/session") {
      return createWikiSessionResponse(request, context);
    }

    if (pathname === "/api/wiki/manifest") {
      const response = await createWikiManifestResponse(request, context);
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "no-store");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
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

    if (pathname === "/api/ai-search") {
      const sessionUser = await getSessionUser(request, client, siteSlug);
      return handleAiSearchRequest({
        request,
        client,
        siteSlug,
        includeSensitive: Boolean(sessionUser),
        canAccessSlug: (slug) => canUserAccessSlug(client, siteSlug, sessionUser, slug),
      });
    }

    if (pathname === "/api/chat") {
      const sessionUser = await getSessionUser(request, client, siteSlug);
      return handleChatRequest({
        request,
        client,
        siteSlug,
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
