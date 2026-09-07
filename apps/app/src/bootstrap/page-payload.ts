import { parseWikiPageBatch, WIKI_READER_CACHE_VERSION, type WikiPageRecord } from "@oncobase/wiki-content";

export const PAGE_BOOTSTRAP_ID = "wiki-page-bootstrap";
export const MAX_BOOTSTRAP_BYTES = 1_048_576;

export type PageBootstrap = {
  version: 1;
  readerVersion: string;
  origin: string;
  pathname: string;
  siteSlug: string;
  scope: "public";
  page: WikiPageRecord;
};

/** Public data only; this payload never selects or authorizes a session store. */
export function parsePageBootstrap(raw: string, expected: {
  origin: string; pathname: string; siteSlug: string; apiOrigin: string;
}): PageBootstrap | null {
  if (raw.length > MAX_BOOTSTRAP_BYTES || expected.apiOrigin !== expected.origin) return null;
  try {
    const value = JSON.parse(raw) as PageBootstrap;
    if (value.version !== 1 || value.readerVersion !== WIKI_READER_CACHE_VERSION ||
        value.origin !== expected.origin || value.pathname !== expected.pathname ||
        value.siteSlug !== expected.siteSlug || value.scope !== "public") return null;
    const { pages } = parseWikiPageBatch({ siteSlug: value.siteSlug, scope: "public",
      generatedAt: "", pages: [value.page], isDone: true, continueCursor: null });
    const page = pages[0];
    if (page.sensitive || !page.contentHash || !page.content || !Number.isFinite(page.size) || page.size < 0) return null;
    return { ...value, page };
  } catch { return null; }
}

export function serializePageBootstrap(payload: PageBootstrap) {
  // JSON inside a script data block still passes through the HTML parser.
  return JSON.stringify(payload).replace(/[<>&\u2028\u2029]/g, char =>
    `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
