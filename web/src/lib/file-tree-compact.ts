export interface FileNode {
  name: string;
  slug: string;
  type: "file" | "directory" | "pdf";
  badge?: string;
  /** Directory has children omitted from a shallow shell tree. */
  truncated?: boolean;
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

function splitSlug(slug: string) {
  return slug.split("/").filter(Boolean);
}

function relativeSlug(fromSlug: string, toSlug: string) {
  const from = splitSlug(fromSlug);
  const to = splitSlug(toSlug);
  let common = 0;

  while (common < from.length && common < to.length && from[common] === to[common]) {
    common += 1;
  }

  const up = Array.from({ length: from.length - common }, () => "..");
  const down = to.slice(common);
  return [...up, ...down].join("/") || ".";
}

function resolveRelativeSlug(fromSlug: string, override: string) {
  const segments = splitSlug(fromSlug);
  for (const part of override.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      segments.pop();
    } else {
      segments.push(part);
    }
  }
  return segments.join("/");
}

function compactPathOverride(
  parentSlug: string,
  name: string,
  slug: string,
  expectedSlug = childSlug(parentSlug, name),
) {
  if (slug === expectedSlug) return undefined;

  const relative = relativeSlug(parentSlug, slug);
  const safeRelative =
    relative.includes("/") && !relative.startsWith("../") ? `./${relative}` : relative;

  return safeRelative.length < slug.length ? safeRelative : slug;
}

function expandPathOverride(
  parentSlug: string,
  name: string,
  override?: string,
  defaultSlug = childSlug(parentSlug, name),
) {
  if (!override) return defaultSlug;
  if (
    override === "." ||
    override === ".." ||
    override.startsWith("../") ||
    override.startsWith("./")
  ) {
    return resolveRelativeSlug(parentSlug, override);
  }
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
      const slugOverride = compactPathOverride(parentSlug, node.name, node.slug);

      if (slugOverride) return ["d", node.name, compactChildren, badge, slugOverride];
      if (badge) return ["d", node.name, compactChildren, badge];
      return ["d", node.name, compactChildren];
    }

    if (node.type === "pdf") {
      const pdfPath = node.pdfPath ?? node.slug;
      const expectedPdfPath = defaultPdfPath(parentSlug, node.name);
      const pdfPathOverride = compactPathOverride(
        parentSlug,
        node.name,
        pdfPath,
        expectedPdfPath,
      );
      return pdfPath === expectedPdfPath
        ? ["p", node.name]
        : ["p", node.name, pdfPathOverride];
    }

    const expectedSlug = childSlug(parentSlug, node.name);
    const slugOverride = compactPathOverride(parentSlug, node.name, node.slug);
    return node.slug === expectedSlug ? ["f", node.name] : ["f", node.name, slugOverride];
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
      const slug = expandPathOverride(parentSlug, name, node[4]);
      return {
        name,
        slug,
        type: "directory",
        ...(badge ? { badge } : {}),
        children: expandCompactFileTree(children, slug),
      };
    }

    if (type === "p") {
      const pdfPath = expandPathOverride(
        parentSlug,
        name,
        node[2],
        defaultPdfPath(parentSlug, name),
      );
      return { name, slug: pdfPath, type: "pdf", pdfPath };
    }

    const slug = expandPathOverride(parentSlug, name, node[2]);
    return { name, slug, type: "file" };
  });
}
