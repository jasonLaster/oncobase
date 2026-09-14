export type NoteBundlePart = "overview" | "formatted" | "raw";

export type NoteBundlePage = {
  label: string;
  part: NoteBundlePart;
  slug: string;
};

/** Resolve only sibling pages present in the reader's accessible page index. */
export function getNoteBundlePages(
  slug: string,
  availableSlugs: ReadonlySet<string>,
): NoteBundlePage[] {
  const match = slug.match(/^(.+?)-(transcript-formatted|overview|formatted|raw)$/);
  if (!match || !availableSlugs.has(slug)) return [];
  const base = match[1];
  return [
    { label: "Overview", part: "overview" as const, slug: `${base}-overview` },
    { label: "Formatted", part: "formatted" as const, slug: `${base}-formatted` },
    {
      label: availableSlugs.has(`${base}-formatted`) ? "Formatted transcript" : "Formatted",
      part: "formatted" as const,
      slug: `${base}-transcript-formatted`,
    },
    { label: "Raw", part: "raw" as const, slug: `${base}-raw` },
  ].filter((page) => availableSlugs.has(page.slug));
}
