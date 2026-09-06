export const WIKI_SITE_NAME = "TNBC Knowledge Base";
export const WIKI_SITE_DESCRIPTION =
  "Breast cancer research and treatment knowledge base";

export function wikiDocumentTitle(title?: string | null) {
  return title ? `${title} — ${WIKI_SITE_NAME}` : WIKI_SITE_NAME;
}

export type ClientRouteMetadata = {
  description: string;
  openGraphDescription: string;
  openGraphTitle: string;
  openGraphType?: "article" | "website";
  title: string;
  twitterDescription: string;
  twitterTitle: string;
};

export function truncateWikiDescription(description: string) {
  const trimmed = description.replace(/\s+/g, " ").trim();
  if (trimmed.length <= 155) return trimmed;
  const clipped = trimmed.slice(0, 156);
  const lastSpace = clipped.lastIndexOf(" ");
  const end = lastSpace > 80 ? lastSpace : 155;
  return `${clipped.slice(0, end).replace(/[.,;:!?-]+$/, "")}...`;
}

function setMetaContent(
  attribute: "name" | "property",
  key: string,
  content: string,
) {
  const meta =
    document.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`) ??
    document.head.appendChild(document.createElement("meta"));
  meta.setAttribute(attribute, key);
  meta.content = content;
}

export function updateClientRouteMetadata(metadata: ClientRouteMetadata) {
  document.title = metadata.title;
  setMetaContent("name", "description", metadata.description);
  setMetaContent("property", "og:title", metadata.openGraphTitle);
  setMetaContent("property", "og:description", metadata.openGraphDescription);
  setMetaContent("name", "twitter:title", metadata.twitterTitle);
  setMetaContent("name", "twitter:description", metadata.twitterDescription);

  const openGraphType = document.querySelector<HTMLMetaElement>(
    'meta[property="og:type"]',
  );
  if (metadata.openGraphType) {
    setMetaContent("property", "og:type", metadata.openGraphType);
  } else {
    openGraphType?.remove();
  }
}
