import { parseWikiPageBatch, parseWikiSessionIdentity, WIKI_READER_CACHE_VERSION, type WikiPageRecord, type WikiSessionIdentity } from "@oncobase/wiki-content";

export const PAGE_BOOTSTRAP_ID = "wiki-page-bootstrap";
export const NAVIGATION_BOOTSTRAP_ID = "wiki-navigation-bootstrap";
export const MAX_BOOTSTRAP_BYTES = 1_048_576;
/** A document's payload is as fresh as the document, never older. */
export const BOOTSTRAP_MAX_AGE_MS = 60_000;

export type PageBootstrap = {
  version: 1;
  readerVersion: string;
  origin: string;
  pathname: string;
  siteSlug: string;
  scope: "public";
  /** Only emitted after session verification in a private, no-store response. */
  publicSessionVerified?: true;
  publicAccessPartition?: "education";
  page: WikiPageRecord;
};

/**
 * A signed-in document: the session API's answer and the page API's answer
 * for this same request (same cookies, dispatched in-process by the shell),
 * in a private, no-store response. The page is usable only by a store opened
 * for exactly this identity.
 */
export type SessionPageBootstrap = {
  version: 2;
  readerVersion: string;
  origin: string;
  pathname: string;
  siteSlug: string;
  scope: "session";
  identity: WikiSessionIdentity;
  page: WikiPageRecord;
};

// Identity, presentation and seeding each read the same response payloads
// (page and navigation) during boot: parse each distinct string once. Callers
// treat the result as read-only.
const parsed = new Map<string, unknown>();
export function parseBootstrapJson(raw: string): unknown {
  if (parsed.has(raw)) return parsed.get(raw);
  const value: unknown = JSON.parse(raw);
  if (parsed.size >= 2) parsed.delete(parsed.keys().next().value!);
  parsed.set(raw, value);
  return value;
}
/** Seeding consumed the payloads; release their strings and parsed values. */
export function releaseBootstrapJson() { parsed.clear(); }

type Expected = { origin: string; pathname: string; siteSlug: string; apiOrigin: string };

function parsedPage(siteSlug: string, scope: "public" | "session", page: unknown) {
  const { pages } = parseWikiPageBatch({ siteSlug, scope, generatedAt: "", pages: [page], isDone: true, continueCursor: null });
  const record = pages[0];
  return record && record.contentHash && record.content && Number.isFinite(record.size) && record.size >= 0 ? record : null;
}

/** Public data only; this payload never selects or authorizes a session store. */
export function parsePageBootstrap(raw: string, expected: Expected): PageBootstrap | null {
  if (raw.length > MAX_BOOTSTRAP_BYTES || expected.apiOrigin !== expected.origin) return null;
  try {
    const value = parseBootstrapJson(raw) as PageBootstrap;
    if (value.version !== 1 || value.readerVersion !== WIKI_READER_CACHE_VERSION ||
        value.origin !== expected.origin || value.pathname !== expected.pathname ||
        value.siteSlug !== expected.siteSlug || value.scope !== "public" ||
        value.publicAccessPartition !== undefined && value.publicAccessPartition !== "education") return null;
    const page = parsedPage(value.siteSlug, "public", value.page);
    if (!page || page.sensitive) return null;
    return { ...value, page };
  } catch { return null; }
}

/** The session payload's identity, unverified against anything but the document itself. */
export function parseSessionPageBootstrap(raw: string, expected: Omit<Expected, "siteSlug"> & { siteSlug?: string }): SessionPageBootstrap | null {
  if (raw.length > MAX_BOOTSTRAP_BYTES || expected.apiOrigin !== expected.origin) return null;
  try {
    const value = parseBootstrapJson(raw) as SessionPageBootstrap;
    if (value.version !== 2 || value.readerVersion !== WIKI_READER_CACHE_VERSION || value.scope !== "session" ||
        value.origin !== expected.origin || value.pathname !== expected.pathname ||
        typeof value.siteSlug !== "string" || (expected.siteSlug !== undefined && value.siteSlug !== expected.siteSlug)) return null;
    const identity = parseWikiSessionIdentity(value.identity);
    if (identity.scope !== "session" || !identity.authenticated || !identity.userHash || identity.siteSlug !== value.siteSlug) return null;
    const page = parsedPage(value.siteSlug, "session", value.page);
    return page ? { ...value, identity, page } : null;
  } catch { return null; }
}

/** The session payload for exactly this store's identity: same site, scope and cache key. */
export function sessionPageBootstrapFor(raw: string, expected: Expected, identity: WikiSessionIdentity): SessionPageBootstrap | null {
  if (identity.scope !== "session") return null;
  const payload = parseSessionPageBootstrap(raw, expected);
  return payload && payload.identity.cacheKey === identity.cacheKey && payload.identity.userHash === identity.userHash ? payload : null;
}

/** Either payload, for the identity that will present or store it. */
export function pageBootstrapFor(raw: string, expected: Expected, identity: WikiSessionIdentity): WikiPageRecord | null {
  return sessionPageBootstrapFor(raw, expected, identity)?.page ?? parsePageBootstrap(raw, expected)?.page ?? null;
}

export function serializePageBootstrap(payload: PageBootstrap | SessionPageBootstrap | Record<string, unknown>) {
  // JSON inside a script data block still passes through the HTML parser.
  return JSON.stringify(payload).replace(/[<>&\u2028\u2029]/g, char =>
    `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
