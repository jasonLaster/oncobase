import type { ConvexHttpClient } from "convex/browser";
import { createWikiGateSession, matchesWikiPasswordHash } from "@oncobase/wiki-content/gate-session";
import { api } from "../../convex/_generated/api.js";
import type { Id } from "../../convex/_generated/dataModel.js";
import { safeLocalRedirect } from "../../src/safe-redirect.js";
import { isAdminSessionUser } from "../epic-fhir.js";
import {
  type PasswordGateEntry,
  authedCookieName,
  gateSessionSecret,
  gateVersionForConfig,
  getRequestPasswordGateConfig,
  getSessionUser,
  hasValidAuthCookie,
  passwordHashForSite,
  sessionTokenFromCookie,
  withSiteSlug,
} from "../reader-access";
import {
  USER_SESSION_COOKIE,
  USER_SESSION_TTL_MS,
  createPasswordSalt,
  createSessionToken,
  hashPassword as hashUserPassword,
  hashSessionToken,
  normalizeEmail,
  verifyPassword as verifyUserPassword,
} from "../user-auth";
import { publicSessionUser } from "./common";

export const GATE_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export function sessionCookieHeader(token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${USER_SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(USER_SESSION_TTL_MS / 1000)}${secure}`;
}

export function clearSessionCookieHeader() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${USER_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

export async function validatePassword(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
  password: string,
) {
  const config = await getRequestPasswordGateConfig(request, client, siteSlug);
  if (
    config.passwordHash &&
    await matchesWikiPasswordHash(password, config.passwordHash)
  ) {
    return config;
  }
  if (
    await matchesWikiPasswordHash(
      password,
      passwordHashForSite(siteSlug),
    )
  ) {
    return config;
  }
  if (!config.passwordHash && !config.enabled) {
    return config;
  }
  return null;
}

export async function authCookieHeader(
  siteSlug: string,
  config: Pick<PasswordGateEntry, "enabled" | "passwordHash">,
) {
  const secret = gateSessionSecret();
  if (!secret) throw new Error("WIKI_GATE_SESSION_SECRET is not configured");
  const token = await createWikiGateSession({
    gateVersion: gateVersionForConfig(siteSlug, config),
    secret,
    siteSlug,
    ttlSeconds: GATE_SESSION_TTL_SECONDS,
  });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${authedCookieName(siteSlug)}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${GATE_SESSION_TTL_SECONDS}${secure}`;
}

export async function handleLoginRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  const url = new URL(request.url);

  if (request.method === "GET") {
    const redirect = safeLocalRedirect(url.searchParams.get("redirect"));
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("redirect", redirect);
    return new Response(null, {
      status: 302,
      headers: {
        "Cache-Control": "private, no-store",
        Location: signInUrl.toString(),
        Vary: "Cookie, Host",
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

  const body: unknown = await request.json().catch(() => undefined);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const password = typeof (body as { password?: unknown }).password === "string"
    ? (body as { password: string }).password
    : undefined;
  const validation = password
    ? await validatePassword(request, client, siteSlug, password)
    : null;
  if (validation) {
    try {
      return Response.json(
        { ok: true },
        {
          headers: {
            "Cache-Control": "private, no-store",
            "Set-Cookie": await authCookieHeader(
              siteSlug,
              validation,
            ),
            Vary: "Cookie, Host",
          },
        },
      );
    } catch {
      return Response.json(
        { error: "Password gate session is not configured" },
        {
          status: 503,
          headers: {
            "Cache-Control": "private, no-store",
            Vary: "Cookie, Host",
          },
        },
      );
    }
  }

  return Response.json(
    { error: "Invalid password" },
    {
      status: 401,
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Cookie, Host",
      },
    },
  );
}

export async function createUserSessionResponse(
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
    { skipQueue: true },
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

export async function handleAuthSessionRequest(
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
  const isAdmin = user ? await isAdminSessionUser(client, siteSlug, user) : false;
  return Response.json(
    { user: user ? {
      ...publicSessionUser({ ...user, isAdmin }),
      _id: user._id,
      createdAt: user.createdAt,
    } : null },
    {
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Cookie, Host",
      },
    },
  );
}

export async function handleAuthSigninRequest(
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

export async function handleAuthSignupRequest(
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

  let gateConfig: PasswordGateEntry;
  try {
    gateConfig = await getRequestPasswordGateConfig(
      request,
      client,
      siteSlug,
    );
  } catch {
    return Response.json(
      { error: "Unable to verify signup access" },
      {
        status: 503,
        headers: {
          "Cache-Control": "private, no-store",
          Vary: "Cookie, Host",
        },
      },
    );
  }
  if (
    gateConfig.enabled &&
    !(await hasValidAuthCookie(request, client, siteSlug, gateConfig))
  ) {
    return Response.json(
      { error: "Password gate access is required to create an account" },
      {
        status: 403,
        headers: {
          "Cache-Control": "private, no-store",
          Vary: "Cookie, Host",
        },
      },
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
      { skipQueue: true },
    );
    return createUserSessionResponse(client, siteSlug, { _id: userId, email, name: name ?? null });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to create account" },
      { status: 400 },
    );
  }
}

export async function handleAuthSignoutRequest(
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
      { skipQueue: true },
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
