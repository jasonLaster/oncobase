/** Transform Obsidian [[wikilinks]] into standard markdown links */
export function resolveWikilinks(content: string): string {
  // [[path/to/page|display text]] or [[path/to/page]]
  return content.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, display?: string) => {
    // Strip .md extension if present, normalize path
    const slug = target.replace(/\.md$/, "").replace(/\s+/g, "-");
    const label = display || target.split("/").pop()?.replace(/\.md$/, "") || target;
    return `[${label}](/${slug})`;
  });
}
