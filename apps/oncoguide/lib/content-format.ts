import matter from "gray-matter";
import { renderWikiMarkdownHtml } from "@oncobase/wiki-markdown/server";
import { markdownTitleToText } from "@oncobase/wiki-markdown/title";

import { PREFIX, DIANA_ORIGIN, type GuidePage, educationHref, staticAssetHref } from "./routes";
export { PREFIX, DIANA_ORIGIN, type GuidePage, educationHref, staticAssetHref } from "./routes";
export type SourcePage = { path: string; raw: string };

export function localAssetPath(value: string, currentSlug?: string): string | null {
  const url = new URL(value, `https://oncoguide.cc/${currentSlug?.split("/").slice(0, -1).join("/") || ""}/`);
  let path: string | null = null;
  if (["https://oncoguide.cc", DIANA_ORIGIN].includes(url.origin) && /^\/api\/(?:education\/)?(?:api\/)?file$/.test(url.pathname)) {
    path = url.searchParams.get("path");
  } else if (url.hostname.endsWith(".blob.vercel-storage.com")) {
    const match = url.pathname.match(/\/sites\/diana\/files\/(wiki\/education\/.*)$/);
    if (match) path = decodeURIComponent(match[1]!);
    else throw Error(`Diana asset outside education: ${value}`);
  } else if (url.origin === "https://oncoguide.cc" && /\.(?:png|avif|webp|jpe?g|gif|svg|pdf|zip|html|txt|json|csv)$/i.test(url.pathname)) path = decodeURIComponent(url.pathname);
  if (!path) return null;
  path = path.replace(/^\/+/, "");
  if (!path.startsWith(PREFIX) || path.split("/").some(part => part === ".." || part === "." || !part)) {
    throw Error(`Asset outside the public education corpus: ${path}`);
  }
  return path;
}

export function compileEducation(sources: SourcePage[], onAsset: (path: string) => void) {
  const parsed = sources.map(({ path, raw }) => {
    if (!path.startsWith(PREFIX) || !path.endsWith(".md")) throw Error(`Unexpected content path: ${path}`);
    const { data, content } = matter(raw);
    if (data.sensitive === true || String(data.sensitive).toLowerCase() === "true" || data["sensitive-include"]?.length || /<redact\b/i.test(raw)) {
      throw Error(`Private content cannot be committed to OncoGuide: ${path}`);
    }
    const heading = content.match(/^#\s+(.+)$/m);
    const title = markdownTitleToText(String(data.title || heading?.[1] || path.split("/").pop()));
    const body = heading ? content.replace(/^#\s+.+$/m, "").replace(/^\n+/, "") : content;
    return { slug: path.slice(0, -3), title, description: typeof data.description === "string" ? data.description : undefined, body };
  });
  if (!parsed.length) throw Error("Education corpus is empty");
  const aliases = new Map<string, string>();
  for (const page of parsed) {
    aliases.set(page.slug.toLowerCase(), page.slug);
    if (page.slug.endsWith("/index")) aliases.set(page.slug.slice(0, -6).toLowerCase(), page.slug);
  }
  // Bare Obsidian links resolve only when the basename is unambiguous.
  const basenames = new Map<string, string[]>();
  for (const page of parsed) {
    const name = page.slug.split("/").pop()!.toLowerCase();
    basenames.set(name, [...(basenames.get(name) ?? []), page.slug]);
  }
  for (const [name, slugs] of basenames) if (slugs.length === 1) aliases.set(name, slugs[0]!);
  function asset(value: string, currentSlug?: string) {
    const path = localAssetPath(value, currentSlug);
    if (!path) return value;
    onAsset(path);
    const url = new URL(value, "https://oncoguide.cc");
    return `${staticAssetHref(path)}${url.hash}`;
  }
  function link(href: string, currentSlug?: string) {
    const resolvedAsset = asset(href, currentSlug);
    if (resolvedAsset !== href) return resolvedAsset;
    if (/^(?:#|mailto:|tel:)/i.test(href)) return href;
    const url = new URL(href, `${DIANA_ORIGIN}/${currentSlug?.split("/").slice(0, -1).join("/")}/`);
    if (url.origin !== DIANA_ORIGIN) return href;
    const path = decodeURIComponent(url.pathname).replace(/^\/+|\/$/g, "").replace(/\.md$/i, "");
    const candidate = path.startsWith("education/") ? `wiki/${path}` : path;
    const canonical = aliases.get(candidate.toLowerCase());
    if (canonical) return `${educationHref(canonical)}${url.search}${url.hash}`;
    if (["education", "education/search"].includes(path)) return `/${path}${url.search}${url.hash}`;
    if (candidate.startsWith(PREFIX)) throw Error(`Broken education link in ${currentSlug}: ${href}`);
    return `${DIANA_ORIGIN}${url.pathname}${url.search}${url.hash}`;
  }
  const pages: GuidePage[] = parsed.map(page => ({
    slug: page.slug, title: page.title, description: page.description,
    html: renderWikiMarkdownHtml(page.body, page.slug, { resolveHref: link, resolveImageSrc: asset }),
    text: page.body.replace(/<[^>]+>/g, " ").replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, "$2 $1").replace(/[#*_`]/g, "").replace(/\s+/g, " ").trim(),
  }));
  return pages;
}
