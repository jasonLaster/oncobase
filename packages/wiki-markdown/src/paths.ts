const PROXIED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".svg",
  ".csv",
  ".pdf",
]);

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

export function resolveWikilinks(
  content: string,
  currentSlug?: string,
  apiBasePath = "",
): string {
  const currentDir = currentDirectory(currentSlug);

  return content.replace(/\[\[([^\]]+)]]/g, (_match, inner: string) => {
    const { target, display } = splitWikilinkAlias(inner);
    const isBare = !target.includes("/");

    if (target.endsWith(".pdf")) {
      const pdfPath = isBare && currentDir ? `${currentDir}/${target}` : target;
      const baseName = target.split("/").pop()?.replace(/\.pdf$/i, "") ?? target;
      const label = display || baseName;
      return `[${label}](${encodeFilePath(pdfPath, apiBasePath)})`;
    }

    const slug = target.replace(/\.md$/i, "").replace(/\s+/g, "-");
    const label = display || target.split("/").pop()?.replace(/\.md$/i, "") || target;
    return `[${label}](/${slug})`;
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

  const ext = src.includes(".") ? src.slice(src.lastIndexOf(".")).toLowerCase() : "";
  if (!PROXIED_EXTENSIONS.has(ext)) {
    return src;
  }

  if (!currentSlug || src.startsWith("/")) return src.replace(/^\/+/, "");
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
  if (href.endsWith(".md") || href.includes(".md#")) {
    return href.replace(/\.md(#|$)/, "$1");
  }
  if (href.endsWith(".pdf")) {
    return encodeFilePath(resolveAssetPath(href, currentSlug), apiBasePath);
  }
  return href;
}

export function isInternalWikiHref(href: string | undefined): href is string {
  return Boolean(href?.startsWith("/") && !href.startsWith("/api/") && !href.startsWith("//"));
}
