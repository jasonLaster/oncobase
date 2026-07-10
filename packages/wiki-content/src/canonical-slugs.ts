const PROJECT_MANAGEMENT_VIEW_FILES = new Set([
  "1-inbox",
  "2-urgent",
  "3-completed",
  "4-backlog",
]);

export function canonicalizePublishedSlug(slug: string): string {
  const prefix = "project-management/";
  if (!slug.startsWith(prefix)) return slug;
  const rest = slug.slice(prefix.length);
  if (!PROJECT_MANAGEMENT_VIEW_FILES.has(rest)) return slug;
  return `${prefix}views/${rest}`;
}

export function legacyPublishedSlug(slug: string): string | null {
  const prefix = "project-management/views/";
  if (!slug.startsWith(prefix)) return null;
  const rest = slug.slice(prefix.length);
  if (!PROJECT_MANAGEMENT_VIEW_FILES.has(rest)) return null;
  return `project-management/${rest}`;
}

function routeSlugAliasKey(slug: string): string {
  return slug.toLowerCase().replace(/\s+/g, "-");
}

export function canonicalSlugLookupEntriesFromSlugs(
  slugs: string[],
): Array<[string, string]> {
  const canonicalSlugs = slugs.map(canonicalizePublishedSlug);
  const entries: Array<[string, string]> = [];
  const seen = new Set<string>();

  for (const canonicalSlug of canonicalSlugs) {
    const lower = canonicalSlug.toLowerCase();
    if (seen.has(lower)) continue;
    entries.push([lower, canonicalSlug]);
    seen.add(lower);
  }

  for (const canonicalSlug of canonicalSlugs) {
    const lower = canonicalSlug.toLowerCase();
    const alias = routeSlugAliasKey(canonicalSlug);
    if (alias === lower || seen.has(alias)) continue;
    entries.push([alias, canonicalSlug]);
    seen.add(alias);
  }

  return entries;
}
