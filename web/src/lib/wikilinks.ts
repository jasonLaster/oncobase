/** Transform Obsidian [[wikilinks]] into standard markdown links */
function countTrailingBackslashes(value: string): number {
  let count = 0;
  for (let i = value.length - 1; i >= 0 && value[i] === "\\"; i--) {
    count++;
  }
  return count;
}

export function splitWikilinkAlias(inner: string): { target: string; display?: string } {
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

export function resolveWikilinks(content: string, currentSlug?: string): string {
  // Directory of the current page, used to resolve bare filenames (no path separator)
  const currentDir = currentSlug ? currentSlug.split("/").slice(0, -1).join("/") : "";

  // [[path/to/page|display text]], [[path/to/page\|display text]], or [[path/to/page]]
  return content.replace(/\[\[([^\]]+)\]\]/g, (_match, inner: string) => {
    const { target, display } = splitWikilinkAlias(inner);
    const isBare = !target.includes("/");

    if (target.endsWith(".pdf")) {
      // Bare PDF filenames resolve relative to the current page's directory
      const pdfPath = isBare && currentDir ? `${currentDir}/${target}` : target;
      // Use just the filename (no directory path, no .pdf) as the default label
      const baseName = target.split("/").pop()?.replace(/\.pdf$/i, "") ?? target;
      const label = display || baseName;
      return `[${label}](/api/file?path=${encodeURIComponent(pdfPath)})`;
    }

    // Strip .md extension, normalize spaces
    const slug = target.replace(/\.md$/, "").replace(/\s+/g, "-");
    const label = display || target.split("/").pop()?.replace(/\.md$/, "") || target;
    return `[${label}](/${slug})`;
  });
}
