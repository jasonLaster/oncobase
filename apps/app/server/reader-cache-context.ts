import type { FunctionReturnType } from "convex/server";
import type { api } from "../convex/_generated/api";

export type ReaderSnapshot = NonNullable<FunctionReturnType<typeof api.documents.getReaderPage>>;
export const READER_CACHE_PREFIX = "/__reader/html/";
export const READER_CONTEXT_HEADER = "x-wiki-reader-context";
export const READER_VERSION_HEADER = "x-wiki-reader-version";
const encoder = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
const hash = async (value: string) => b64(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
const signingKey = (secret: string) => crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

export function gateVersion(snapshot: Pick<ReaderSnapshot, "siteSlug" | "gate">) {
  return JSON.stringify([snapshot.gate.enabled, snapshot.gate.passwordHash ||
    (snapshot.siteSlug === "diana" ? process.env.DIANA_WIKI_PASSWORD_HASH?.trim() : null) || "passwordless"]);
}

export function readerFingerprint(snapshot: ReaderSnapshot) {
  const p = snapshot.page;
  // HTML includes the public file tree, so every manifest change invalidates it.
  // Actual body bytes and all public presentation/policy fields participate.
  return hash(JSON.stringify(["reader-navigation-v1", process.env.VERCEL_URL ?? "local", snapshot.siteSlug, snapshot.contentRevision, gateVersion(snapshot), snapshot.piiPatterns ?? [],
    p ? [p.slug, p.bodyDigest, p.contentHash, p.title, p.description ?? null, p.tags, p.sensitive] : null]));
}

export const readerCachePath = async (url: string, fingerprint: string) => READER_CACHE_PREFIX + fingerprint + "/" + await hash(url);

export async function signReaderContext(url: string, fingerprint: string, secret: string, now = Date.now()) {
  const payload = b64(encoder.encode(JSON.stringify([1, now + 15_000, url, fingerprint])));
  const signature = b64(new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(secret), encoder.encode(payload))));
  return payload + "." + signature;
}

export async function verifyReaderContext(request: Request, secret: string | undefined, now = Date.now()) {
  try {
    const token = request.headers.get(READER_CONTEXT_HEADER);
    if (!secret || !token || token.length > 12_000) return null;
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra !== undefined || !await crypto.subtle.verify("HMAC", await signingKey(secret), unb64(signature), encoder.encode(payload))) return null;
    const [version, expires, original, fingerprint] = JSON.parse(new TextDecoder().decode(unb64(payload)));
    if (version !== 1 || !Number.isSafeInteger(expires) || expires <= now || expires > now + 15_000 ||
      typeof original !== "string" || typeof fingerprint !== "string") return null;
    const url = new URL(original), incoming = new URL(request.url);
    if (url.origin !== incoming.origin || incoming.pathname !== await readerCachePath(original, fingerprint)) return null;
    return { url, fingerprint };
  } catch { return null; }
}

export function isInternalReaderPath(pathname: string) {
  try { return decodeURIComponent(pathname).toLowerCase().startsWith("/__reader/"); }
  catch { return true; }
}
