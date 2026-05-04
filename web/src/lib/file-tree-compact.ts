export interface FileNode {
  name: string;
  slug: string;
  type: "file" | "directory" | "pdf";
  badge?: string;
  /** Asset path within the site's vault — only set for type === "pdf" */
  pdfPath?: string;
  children?: FileNode[];
}

export type CompactFileNode =
  | ["d", string, CompactFileNode[], (string | null)?, string?]
  | ["f", string, string?]
  | ["p", string, string?];

function childSlug(parentSlug: string, name: string) {
  return parentSlug ? `${parentSlug}/${name}` : name;
}

function defaultPdfPath(parentSlug: string, name: string) {
  return `${childSlug(parentSlug, name)}.pdf`;
}

function compactSlugOverride(parentSlug: string, name: string, slug: string) {
  const expectedSlug = childSlug(parentSlug, name);
  if (slug === expectedSlug) return undefined;

  const parentPrefix = parentSlug ? `${parentSlug}/` : "";
  return parentPrefix && slug.startsWith(parentPrefix)
    ? slug.slice(parentPrefix.length)
    : slug;
}

function expandSlugOverride(parentSlug: string, name: string, override?: string) {
  if (!override) return childSlug(parentSlug, name);
  return override.includes("/") ? override : childSlug(parentSlug, override);
}

export function compactFileTree(
  nodes: FileNode[],
  parentSlug = "",
): CompactFileNode[] {
  return nodes.map((node) => {
    if (node.type === "directory") {
      const compactChildren = compactFileTree(node.children ?? [], node.slug);
      const badge = node.badge ?? null;
      const slugOverride = compactSlugOverride(parentSlug, node.name, node.slug);

      if (slugOverride) return ["d", node.name, compactChildren, badge, slugOverride];
      if (badge) return ["d", node.name, compactChildren, badge];
      return ["d", node.name, compactChildren];
    }

    if (node.type === "pdf") {
      const pdfPath = node.pdfPath ?? node.slug;
      const expectedPdfPath = defaultPdfPath(parentSlug, node.name);
      return pdfPath === expectedPdfPath
        ? ["p", node.name]
        : ["p", node.name, pdfPath];
    }

    const expectedSlug = childSlug(parentSlug, node.name);
    return node.slug === expectedSlug ? ["f", node.name] : ["f", node.name, node.slug];
  });
}

export function expandCompactFileTree(
  nodes: CompactFileNode[],
  parentSlug = "",
): FileNode[] {
  return nodes.map((node) => {
    const [type, name] = node;

    if (type === "d") {
      const children = node[2];
      const badge = node[3] ?? undefined;
      const slug = expandSlugOverride(parentSlug, name, node[4]);
      return {
        name,
        slug,
        type: "directory",
        ...(badge ? { badge } : {}),
        children: expandCompactFileTree(children, slug),
      };
    }

    if (type === "p") {
      const pdfPath = node[2] ?? defaultPdfPath(parentSlug, name);
      return { name, slug: pdfPath, type: "pdf", pdfPath };
    }

    const slug = node[2] ?? childSlug(parentSlug, name);
    return { name, slug, type: "file" };
  });
}
