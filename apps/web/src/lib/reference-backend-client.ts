// Local reference compatibility with the current backend identity. UI code is unchanged.
import { ConvexHttpClient } from "convex/browser";
import { resolveServerConvexUrl } from "@oncobase/wiki-content/convex-url";
export const SERVICE_ISSUER = "https://oncobase.app/backend";
export const SERVICE_AUDIENCE = "oncobase-backend";
export const SERVICE_SUBJECT = "wiki-application-server";

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
    return transport(input, { ...init, headers, redirect: "error" });
  }, { preconnect: transport.preconnect });
  return new ConvexHttpClient(url, { ...options, fetch: authenticatedFetch });
}


async function gateVersion(site: { _id: string; config: { passwordGate: boolean; passwordHash?: string } }) {
  const value = JSON.stringify([site._id, site.config.passwordGate, site.config.passwordHash ?? null]);
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Issued only after the HTTP route has verified the current wiki gate. */
export async function browserConversationToken(site: { _id: string; slug: string; config: { passwordGate: boolean; passwordHash?: string } }) {
  const source = process.env.WIKI_BACKEND_SIGNING_KEY;
  if (!source) throw new Error("Backend authentication is not configured");
  const jwk = JSON.parse(source) as JsonWebKey & { kid: string };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const issued = Math.floor(Date.now() / 1000);
  const payload = encode({ alg: "RS256", typ: "JWT", kid: jwk.kid }) + "." + encode({
    iss: SERVICE_ISSUER, aud: SERVICE_AUDIENCE, sub: "wiki-browser:" + site.slug,
    role: "wiki-conversations", siteSlug: site.slug, gateVersion: await gateVersion(site), iat: issued, exp: issued + 60,
  });
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(payload)));
  return payload + "." + btoa(String.fromCharCode(...signature)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
