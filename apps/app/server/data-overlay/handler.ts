// data.diana-tnbc.com: presigned redirects to S3, gated by diana-tnbc.com
// accounts and roles. See specs/data-overlay.md.

import type { DataOverlayConfig } from "./config";
import { createHandoffState, verifyHandoffToken } from "./handoff";
import { buildDataIndex, createManifestCache, renderDataIndexHtml, type ManifestDataset } from "./index-page";
import { parseDataPath, safeDataNext } from "./paths";
import { canAccessKey } from "./prefix-roles";
import type { DataOverlayStorage } from "./storage";

export const PUBLIC_URL_EXPIRY_SECONDS = 900;
export const PRIVATE_URL_EXPIRY_SECONDS = 300;
export const DATA_SESSION_COOKIE = "data_overlay_session";
export const DATA_STATE_COOKIE = "data_overlay_state";
/** Data-host sessions are short; roles are re-read on every request anyway. */
export const DATA_SESSION_TTL_SECONDS = 60 * 60 * 12;
/** Time allowed to finish signing in on diana-tnbc.com. */
export const DATA_STATE_TTL_SECONDS = 60 * 10;
export const MAIN_HANDOFF_PATH = "/api/data-overlay/handoff";

export type DataUser = { _id: string; email: string; name?: string | null };

/** The account system, as the overlay needs it. Production backs this with
 * the same Convex session table and role assignments as diana-tnbc.com. */
export interface DataOverlaySessions {
  userForToken(token: string): Promise<DataUser | null>;
  rolesFor(user: DataUser): Promise<string[]>;
  /** A new account session for `userId`; returns its bearer token. */
  createSession(userId: string, expiresAt: number): Promise<string>;
  revoke(token: string): Promise<void>;
}

export type DataViewer = { user: DataUser; roles: string[]; via: "cookie" | "bearer" };

export type DataAuditEntry = {
  event: "data_overlay.private_access";
  time: string;
  outcome: "granted" | "denied";
  userId: string;
  email: string;
  via: "cookie" | "bearer";
  key: string;
  expiresInSeconds: number | null;
};

export type DataOverlayDeps = {
  config: DataOverlayConfig;
  /** Resolved lazily so a misconfigured bucket fails only object requests. */
  storage: () => DataOverlayStorage | Promise<DataOverlayStorage>;
  sessions: DataOverlaySessions;
  now?: () => number;
  /** Where private-access audit entries go. Default: one JSON line on stdout
   * (Vercel runtime logs). */
  audit?: (entry: DataAuditEntry) => void;
  manifest?: () => Promise<ManifestDataset[]>;
};

/** Never cache at the Vercel edge or any shared cache. */
const EDGE_NO_STORE = { "CDN-Cache-Control": "no-store", "Vercel-CDN-Cache-Control": "no-store" };
const BASE_HEADERS = {
  ...EDGE_NO_STORE,
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  Vary: "Accept, Authorization, Cookie",
};
export const PRIVATE_HEADERS = { ...BASE_HEADERS, "Cache-Control": "private, no-store" };
// Signing is local (no S3 round trip), so caching the public redirect saves
// little, and a cached Location would keep handing out a URL that expires.
export const PUBLIC_HEADERS = { ...BASE_HEADERS, "Cache-Control": "no-store" };

export class StorageNotConfiguredError extends Error {
  constructor() {
    super("Data overlay storage is not configured");
    this.name = "StorageNotConfiguredError";
  }
}

function defaultAudit(entry: DataAuditEntry) {
  console.info(JSON.stringify(entry));
}

function cookieValue(request: Request, name: string) {
  const raw = (request.headers.get("cookie") ?? "")
    .split(/;\s*/)
    .find(part => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  if (!raw) return undefined;
  try { return decodeURIComponent(raw); }
  catch { return undefined; }
}

/** Only the Authorization header: unlike the wiki API, no `?access_token=`,
 * which would end up in logs and in shared links. */
function authorizationBearer(request: Request): { present: boolean; token: string | null } {
  const header = request.headers.get("authorization");
  if (header == null) return { present: false, token: null };
  const match = header.match(/^Bearer\s+(\S+)\s*$/i);
  return { present: true, token: match?.[1] ?? null };
}

function cookie(name: string, value: string, maxAge: number, { secure, path = "/" }: { secure: boolean; path?: string }) {
  // No Domain attribute: host-only on data.diana-tnbc.com.
  return `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=${path}; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function textResponse(status: number, body: string, headers: Record<string, string> = PRIVATE_HEADERS) {
  return new Response(body, { status, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } });
}

const notFound = () => textResponse(404, "Not found");
const badRequest = () => textResponse(400, "Bad request");

function wantsJson(request: Request) {
  const accept = request.headers.get("accept") ?? "";
  return /\bapplication\/json\b/i.test(accept) && !/\btext\/html\b/i.test(accept);
}

export function createDataOverlayHandler(deps: DataOverlayDeps) {
  const { config, sessions } = deps;
  const now = deps.now ?? (() => Date.now());
  const audit = deps.audit ?? defaultAudit;
  const storage = deps.storage;
  const manifest = deps.manifest ?? createManifestCache(storage, now);

  function redirect(location: string, headers: Record<string, string>, cookies: string[] = []) {
    const response = new Response(null, { status: 302, headers: { ...headers, Location: location } });
    for (const value of cookies) response.headers.append("Set-Cookie", value);
    return response;
  }

  /** Anonymous: send the visitor to diana-tnbc.com to sign in. The response
   * is identical for any path, so it says nothing about what exists. */
  function beginSignIn(next: string) {
    const state = createHandoffState();
    const target = new URL(MAIN_HANDOFF_PATH, config.mainOrigin);
    target.searchParams.set("next", safeDataNext(next));
    target.searchParams.set("state", state);
    return redirect(target.toString(), PRIVATE_HEADERS, [
      cookie(DATA_STATE_COOKIE, state, DATA_STATE_TTL_SECONDS, { secure: config.secureCookies, path: "/_auth/" }),
    ]);
  }

  /** The viewer, null when anonymous, or "invalid" for a bad bearer token. */
  async function resolveViewer(request: Request): Promise<DataViewer | null | "invalid"> {
    const bearer = authorizationBearer(request);
    if (bearer.present) {
      const user = bearer.token ? await sessions.userForToken(bearer.token) : null;
      if (!user) return "invalid";
      return { user, roles: await sessions.rolesFor(user), via: "bearer" };
    }
    const token = cookieValue(request, DATA_SESSION_COOKIE);
    if (!token) return null;
    const user = await sessions.userForToken(token);
    if (!user) return null;
    return { user, roles: await sessions.rolesFor(user), via: "cookie" };
  }

  function invalidBearer() {
    return new Response(JSON.stringify({ error: "Invalid or expired access token" }), {
      status: 401,
      headers: { ...PRIVATE_HEADERS, "Content-Type": "application/json", "WWW-Authenticate": 'Bearer realm="data.diana-tnbc.com"' },
    });
  }

  async function presign(key: string, expiresIn: number, isPrivate: boolean) {
    return (await storage()).presignGet(key, expiresIn, { private: isPrivate });
  }

  function storageFailure(error: unknown, headers: Record<string, string>) {
    if (error instanceof StorageNotConfiguredError) return textResponse(503, "Data storage is not configured", headers);
    console.error("[data-overlay] storage failed", error instanceof Error ? error.message : error);
    return textResponse(502, "Data storage is unavailable", headers);
  }

  async function serveIndex(request: Request, json: boolean) {
    const viewer = await resolveViewer(request);
    if (viewer === "invalid") return invalidBearer();
    let index;
    try {
      index = await buildDataIndex({
        manifest,
        storage,
        viewer: viewer ? { email: viewer.user.email, roles: viewer.roles } : null,
      });
    } catch (error) {
      return storageFailure(error, PRIVATE_HEADERS);
    }
    if (json) {
      return new Response(JSON.stringify(index), { headers: { ...PRIVATE_HEADERS, "Content-Type": "application/json; charset=utf-8" } });
    }
    const html = renderDataIndexHtml(index, { signInHref: "/_auth/signin?next=%2F", canSignOut: viewer?.via === "cookie" });
    return new Response(request.method === "HEAD" ? null : html, {
      headers: { ...PRIVATE_HEADERS, "Content-Type": "text/html; charset=utf-8" },
    });
  }

  async function finishSignIn(request: Request) {
    const url = new URL(request.url);
    const next = safeDataNext(url.searchParams.get("next"));
    const state = cookieValue(request, DATA_STATE_COOKIE);
    const claims = verifyHandoffToken(url.searchParams.get("token"), {
      secret: config.handoffSecret, site: config.siteSlug, aud: config.dataOrigin, state, nowMs: now(),
    });
    const clearState = cookie(DATA_STATE_COOKIE, "", 0, { secure: config.secureCookies, path: "/_auth/" });
    if (!claims) {
      const retry = `/_auth/signin?next=${encodeURIComponent(next)}`;
      const response = new Response(
        `<!doctype html><meta charset="utf-8"><title>Sign-in expired</title><p>This sign-in link is invalid or has expired. <a href="${retry.replace(/"/g, "&quot;")}">Try again</a>.</p>`,
        { status: 401, headers: { ...PRIVATE_HEADERS, "Content-Type": "text/html; charset=utf-8" } },
      );
      response.headers.append("Set-Cookie", clearState);
      return response;
    }
    let token: string;
    try {
      token = await sessions.createSession(claims.sub, now() + DATA_SESSION_TTL_SECONDS * 1000);
    } catch {
      return textResponse(401, "Sign-in failed");
    }
    return redirect(new URL(next, config.dataOrigin).toString(), PRIVATE_HEADERS, [
      cookie(DATA_SESSION_COOKIE, token, DATA_SESSION_TTL_SECONDS, { secure: config.secureCookies }),
      clearState,
    ]);
  }

  async function signOut(request: Request) {
    const token = cookieValue(request, DATA_SESSION_COOKIE);
    if (token) await sessions.revoke(token).catch(() => {});
    const response = new Response(null, { status: 303, headers: { ...PRIVATE_HEADERS, Location: "/" } });
    response.headers.append("Set-Cookie", cookie(DATA_SESSION_COOKIE, "", 0, { secure: config.secureCookies }));
    return response;
  }

  async function servePrivate(request: Request, rawPath: string, key: string | null) {
    const viewer = await resolveViewer(request);
    if (viewer === "invalid") return invalidBearer();
    if (!viewer) return beginSignIn(rawPath);
    if (key === null) return redirect("/", PRIVATE_HEADERS);
    const entry = {
      event: "data_overlay.private_access" as const,
      time: new Date(now()).toISOString(),
      userId: viewer.user._id,
      email: viewer.user.email,
      via: viewer.via,
      key,
    };
    // The role check happens before anything is signed.
    if (!canAccessKey(key, viewer.roles)) {
      audit({ ...entry, outcome: "denied", expiresInSeconds: null });
      return notFound();
    }
    let location: string;
    try {
      location = await presign(key, PRIVATE_URL_EXPIRY_SECONDS, true);
    } catch (error) {
      return storageFailure(error, PRIVATE_HEADERS);
    }
    audit({ ...entry, outcome: "granted", expiresInSeconds: PRIVATE_URL_EXPIRY_SECONDS });
    return redirect(location, PRIVATE_HEADERS);
  }

  return async function handleDataOverlayRequest(request: Request, rawPath: string | null): Promise<Response> {
    const route = parseDataPath(rawPath);
    const method = request.method;
    if (route.kind === "auth" && route.action === "signout") {
      return method === "POST" ? signOut(request) : new Response(null, { status: 405, headers: { ...PRIVATE_HEADERS, Allow: "POST" } });
    }
    if (method !== "GET" && method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { ...PRIVATE_HEADERS, Allow: "GET, HEAD" } });
    }
    switch (route.kind) {
      case "invalid":
        return badRequest();
      case "index":
        return serveIndex(request, wantsJson(request));
      case "index-json":
        return serveIndex(request, true);
      case "auth": {
        if (route.action === "callback") return finishSignIn(request);
        const next = new URL(request.url).searchParams.get("next");
        return beginSignIn(next ?? "/");
      }
      case "private-root":
        return servePrivate(request, rawPath!, null);
      case "object": {
        if (route.visibility === "private") return servePrivate(request, rawPath!, route.key);
        try {
          return redirect(await presign(route.key, PUBLIC_URL_EXPIRY_SECONDS, false), PUBLIC_HEADERS);
        } catch (error) {
          return storageFailure(error, PUBLIC_HEADERS);
        }
      }
    }
  };
}
