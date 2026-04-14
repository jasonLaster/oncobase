/** Transform Obsidian [[wikilinks]] into standard markdown links */
export function resolveWikilinks(content: string, currentSlug?: string): string {
  // Directory of the current page, used to resolve bare filenames (no path separator)
  const currentDir = currentSlug ? currentSlug.split("/").slice(0, -1).join("/") : "";

  // [[path/to/page|display text]] or [[path/to/page]]
  return content.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, display?: string) => {
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
