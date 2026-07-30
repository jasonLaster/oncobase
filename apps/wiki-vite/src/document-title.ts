export const WIKI_SITE_NAME = "TNBC Knowledge Base";

export function wikiDocumentTitle(title?: string | null) {
  return title ? `${title} — ${WIKI_SITE_NAME}` : WIKI_SITE_NAME;
}
