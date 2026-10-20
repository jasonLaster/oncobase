import { truncateLegacyDescription } from "./legacy-route-metadata";

/** Prefer authored copy; otherwise use readable prose from the published page. */
export function pageDescription(page: { description?: string | null; content?: string; title: string }, siteName: string) {
  const authored = truncateLegacyDescription(page.description ?? "");
  if (authored) return authored;
  const prose = (page.content ?? "")
    .replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, "")
    .replace(/<!--[^]*?-->/g, "")
    .replace(/^(?:`{3,}|~{3,})[^\n]*\n[\s\S]*?^(?:`{3,}|~{3,})[^\n]*$/gm, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/^\s*(?:#{1,6}\s.*|\|.*|\[[^\]]+\]:.*|[-*_]{3,})$/gm, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/^\s*(?:>\s*|[-*+]\s+|\d+\.\s+)/gm, "")
    .replace(/[*_`~]/g, "")
    .trim();
  return truncateLegacyDescription(prose) || `${page.title} notes in ${siteName}`;
}

/** Only the route is passed to the image endpoint; copy is resolved server-side. */
export function pageSocialImageUrl(requestUrl: string, pathname: string) {
  const image = new URL("/api/share-image", requestUrl);
  image.searchParams.set("path", pathname);
  return image.toString();
}
