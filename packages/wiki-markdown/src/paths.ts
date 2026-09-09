import { slug as headingSlug } from "github-slugger";

export const PROXIED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".avif",
  ".svg",
  ".csv",
  ".pdf",
]);
const SAFE_MARKDOWN_PROTOCOL = /^(https?|ircs?|mailto|tel|xmpp)$/i;

export function sanitizeMarkdownUrl(value: string): string {
  const colon = value.indexOf(":");
  const questionMark = value.indexOf("?");
  const numberSign = value.indexOf("#");
  const slash = value.indexOf("/");

  if (
    colon === -1 ||
    (slash !== -1 && colon > slash) ||
    (questionMark !== -1 && colon > questionMark) ||
    (numberSign !== -1 && colon > numberSign) ||
    SAFE_MARKDOWN_PROTOCOL.test(value.slice(0, colon))
  ) {
    return value;
  }

  return "";
}

function countTrailingBackslashes(value: string): number {
  let count = 0;
  for (let i = value.length - 1; i >= 0 && value[i] === "\\"; i--) {
    count++;
  }
  return count;
}

function currentDirectory(currentSlug?: string) {
  return currentSlug ? currentSlug.split("/").slice(0, -1).join("/") : "";
}

function normalizePosixPath(value: string) {
  const output: string[] = [];

  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      output.pop();
      continue;
    }
    output.push(part);
  }

  return output.join("/");
}

export function splitWikilinkAlias(inner: string): {
  target: string;
  display?: string;
} {
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] !== "|") continue;

    const beforePipe = inner.slice(0, i);
    const isEscaped = countTrailingBackslashes(beforePipe) % 2 === 1;
    const target = (isEscaped ? beforePipe.slice(0, -1) : beforePipe).trim();
    const display = inner.slice(i + 1).replace(/\\\|/g, "|").trim();

    return { target, display };
  }

  return { target: inner.trim() };
}

export function encodeFilePath(path: string, apiBasePath = "") {
  return `${apiBasePath}/api/file?path=${encodeURIComponent(path)}`;
}

function decodeUrlPath(value: string) {
  try { return decodeURIComponent(value); }
  catch { return value; }
}

function splitTarget(target: string) {
  const hashIndex = target.indexOf("#");
  const beforeHash = hashIndex === -1 ? target : target.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : target.slice(hashIndex);
  const queryIndex = beforeHash.indexOf("?");
  return {
    path: queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex),
    query: queryIndex === -1 ? "" : beforeHash.slice(queryIndex),
    hash,
  };
}

function wikiRouteHref(target: string) {
  const { path, query, hash } = splitTarget(target);
  const slug = path.replace(/\.(?:md|mdx)$/i, "");
  const encodedPath = slug.split("/")
    .map(segment => encodeURIComponent(segment).replace(/[()]/g, c => c === "(" ? "%28" : "%29"))
    .join("/");
  // Obsidian fragments name headings, whose IDs use the renderer's slugger.
  // A fragment-only link must remain on this document rather than going to /.
  const fragment = hash ? `#${encodeURIComponent(headingSlug(decodeUrlPath(hash.slice(1))))}` : "";
  return `${path ? `/${encodedPath.replace(/^\/+/, "")}` : ""}${query}${fragment}`;
}

export function resolveWikilinks(
  content: string,
  currentSlug?: string,
  apiBasePath = "",
): string {
  const currentDir = currentDirectory(currentSlug);

  return content.replace(/\[\[([^\]]+)]](?!\()/g, (_match, inner: string) => {
    const { target, display } = splitWikilinkAlias(inner);
    const { path, query, hash } = splitTarget(target);
    const isBare = !path.includes("/");

    if (/\.pdf$/i.test(path)) {
      const pdfPath = isBare && currentDir ? `${currentDir}/${path}` : path.replace(/^\/+/, "");
      const baseName = path.split("/").pop()?.replace(/\.pdf$/i, "") ?? path;
      const label = display || baseName;
      return `[${label}](${encodeFilePath(pdfPath, apiBasePath)}${query ? `&${query.slice(1)}` : ""}${hash})`;
    }

    const label = display || target.split("/").pop()?.replace(/\.(?:md|mdx)$/i, "") || target;
    return `[${label}](${wikiRouteHref(target)})`;
  });
}

export function resolveAssetPath(src: string, currentSlug?: string) {
  if (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("//") ||
    src.startsWith("data:") ||
    src.startsWith("/api/")
  ) {
    return src;
  }

  // Markdown parsers already URI-encode local destinations. Decode that URL
  // once before encoding the file API query, including encoded spaces.
  src = decodeUrlPath(src);
  const ext = src.includes(".") ? src.slice(src.lastIndexOf(".")).toLowerCase() : "";
  if (!PROXIED_EXTENSIONS.has(ext)) {
    return src;
  }

  if (!currentSlug || src.startsWith("/")) return normalizePosixPath(src);
  const dir = currentDirectory(currentSlug);
  return normalizePosixPath(`${dir ? `${dir}/` : ""}${src}`);
}

export function resolveImageSrc(src: string, currentSlug?: string, apiBasePath = "") {
  const resolved = resolveAssetPath(src, currentSlug);
  if (
    resolved.startsWith("http://") ||
    resolved.startsWith("https://") ||
    resolved.startsWith("//") ||
    resolved.startsWith("data:") ||
    resolved.startsWith("/api/")
  ) {
    return resolved;
  }

  const ext = resolved.includes(".")
    ? resolved.slice(resolved.lastIndexOf(".")).toLowerCase()
    : "";
  return PROXIED_EXTENSIONS.has(ext) ? encodeFilePath(resolved, apiBasePath) : resolved;
}

export function resolveHref(href: string | undefined, currentSlug?: string, apiBasePath = "") {
  if (!href) return href;
  if (
    href.startsWith("http://") ||
    href.startsWith("https://") ||
    href.startsWith("//") ||
    href.startsWith("#") ||
    href.startsWith("/api/")
  ) {
    return href;
  }
  if (/\.(?:md|mdx)(?:#|$)/.test(href)) {
    return href.replace(/\.(?:md|mdx)(#|$)/, "$1");
  }

  const [rawPath, ...hashParts] = href.split("#");
  const ext = rawPath.includes(".")
    ? rawPath.slice(rawPath.lastIndexOf(".")).toLowerCase()
    : "";
  if (!PROXIED_EXTENSIONS.has(ext)) return href;

  const hash = hashParts.length > 0 ? `#${hashParts.join("#")}` : "";
  return `${encodeFilePath(resolveAssetPath(rawPath, currentSlug), apiBasePath)}${hash}`;
}

export function isInternalWikiHref(href: string | undefined): href is string {
  return Boolean(href?.startsWith("/") && !href.startsWith("/api/") && !href.startsWith("//"));
}
