import { conversationGateVersion } from "../convex/lib/conversationAuth";
import { ConvexHttpClient } from "convex/browser";
import { resolveServerConvexUrl } from "@oncobase/wiki-content/convex-url";
import { SERVICE_ISSUER, SERVICE_AUDIENCE, SERVICE_SUBJECT } from "../convex/lib/serviceAuth";

const encoder = new TextEncoder();
const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
let cached: { source: string; expires: number; token: Promise<string> } | undefined;
export function backendServiceToken(now = Date.now()): Promise<string> {
  const source = process.env.WIKI_BACKEND_SIGNING_KEY;
  if (!source) throw new Error("Backend authentication is not configured");
  if (cached?.source === source && cached.expires > now) return cached.token;
  const token = (async () => {
    const jwk = JSON.parse(source) as JsonWebKey & { kid: string };
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    const issued = Math.floor(now / 1000);
    const payload = encode({ alg: "RS256", typ: "JWT", kid: jwk.kid }) + "." + encode({
      iss: SERVICE_ISSUER, aud: SERVICE_AUDIENCE, sub: SERVICE_SUBJECT, role: "backend-service", iat: issued, exp: issued + 120,
    });
    const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(payload)));
    return payload + "." + btoa(String.fromCharCode(...signature)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  })();
  cached = { source, expires: now + 60_000, token };
  token.catch(() => { if (cached?.token === token) cached = undefined; });
  return token;
}

// Convex queries and mutations have a ~1s execution budget, so a call still
// pending after this long is a stuck connection, not slow work. Actions may
// legitimately run longer (OpenAI, full-corpus reads). "0" disables a limit.
const DEFAULT_BACKEND_TIMEOUT_MS = 15_000;
const DEFAULT_BACKEND_ACTION_TIMEOUT_MS = 60_000;

function configuredTimeout(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Timeout for one backend RPC, by Convex endpoint (`/api/action` vs others). */
export function backendRequestTimeoutMs(pathname: string, env: Record<string, string | undefined> = process.env) {
  return pathname.endsWith("/api/action")
    ? configuredTimeout(env.WIKI_BACKEND_ACTION_TIMEOUT_MS, DEFAULT_BACKEND_ACTION_TIMEOUT_MS)
    : configuredTimeout(env.WIKI_BACKEND_TIMEOUT_MS, DEFAULT_BACKEND_TIMEOUT_MS);
}

export function createBackendClient(url = resolveServerConvexUrl(), options: ConstructorParameters<typeof ConvexHttpClient>[1] = {}) {
  const origin = new URL(url).origin;
  const transport = options.fetch ?? globalThis.fetch;
  const authenticatedFetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const destination = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (destination.origin !== origin) throw new Error("Unexpected backend origin");
    const headers = new Headers(init?.headers);
    // Explicit operator admin authentication remains available for internal
    // maintenance functions; ordinary application calls use the service JWT.
    if (!headers.has("Authorization")) headers.set("Authorization", "Bearer " + await backendServiceToken());
    const timeoutMs = backendRequestTimeoutMs(destination.pathname);
    const signals = [init?.signal, timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined]
      .filter((signal): signal is AbortSignal => Boolean(signal));
    const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
    return transport(input, { ...init, headers, redirect: "error", ...(signal ? { signal } : {}) });
  }, { preconnect: transport.preconnect });
  return new ConvexHttpClient(url, { ...options, fetch: authenticatedFetch });
}

/**
 * Issued only after the HTTP route has verified the current wiki gate.
 * `ownerKey` is the hashed per-viewer owner (server/chat-owner.ts); Convex
 * limits the token to that owner's conversations.
 */
export async function browserConversationToken(site: Parameters<typeof conversationGateVersion>[0] & { slug: string }, ownerKey: string) {
  const source = process.env.WIKI_BACKEND_SIGNING_KEY;
  if (!source) throw new Error("Backend authentication is not configured");
  const jwk = JSON.parse(source) as JsonWebKey & { kid: string };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const issued = Math.floor(Date.now() / 1000);
  const payload = encode({ alg: "RS256", typ: "JWT", kid: jwk.kid }) + "." + encode({
    iss: SERVICE_ISSUER, aud: SERVICE_AUDIENCE, sub: "wiki-browser:" + site.slug,
    role: "wiki-conversations", siteSlug: site.slug, gateVersion: conversationGateVersion(site), ownerKey, iat: issued, exp: issued + 60,
  });
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(payload)));
  return payload + "." + btoa(String.fromCharCode(...signature)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
