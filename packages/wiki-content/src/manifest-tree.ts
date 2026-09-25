import type { CompactFileNode, WikiManifestPage, WikiManifestAsset } from "./index.ts";
import { compareFileTreeNodes, isHiddenFileTreeAssetPath, isHiddenFileTreePath } from "./index.ts";

type ApiFileNode = {
  name: string;
  slug: string;
  type: "directory" | "file" | "pdf";
  pdfPath?: string;
  children?: ApiFileNode[];
};

function splitSlug(slug: string) {
  return slug.split("/").filter(Boolean);
}

type TreeIndexes = WeakMap<ApiFileNode[], { first: Map<string, ApiFileNode>; directories: Map<string, ApiFileNode> }>;

function indexTreeNodes(indexes: TreeIndexes, nodes: ApiFileNode[]) {
  let index = indexes.get(nodes);
  if (!index) {
    index = { first: new Map(), directories: new Map() };
    for (const node of nodes) {
      if (!index.first.has(node.name)) index.first.set(node.name, node);
      if (node.type === "directory" && !index.directories.has(node.name)) index.directories.set(node.name, node);
    }
    indexes.set(nodes, index);
  }
  return index;
}

function insertFileNode(
  indexes: TreeIndexes,
  nodes: ApiFileNode[],
  segments: string[],
  type: "file" | "pdf",
  pdfPath?: string,
  parentSlug = "",
) {
  if (segments.length === 0) return;
  const [name, ...rest] = segments;
  const slug = parentSlug ? `${parentSlug}/${name}` : name;
  const index = indexTreeNodes(indexes, nodes);

  if (rest.length === 0) {
    const existing = index.first.get(name);
    const nextNode: ApiFileNode =
      type === "pdf"
        ? { name, slug: pdfPath ?? slug, type: "pdf", pdfPath: pdfPath ?? slug }
        : { name, slug, type: "file" };

    if (!existing) {
      nodes.push(nextNode);
      index.first.set(name, nextNode);
      return;
    }

    if (existing.type === "directory") {
      existing.children = existing.children ?? [];
      existing.children.unshift(nextNode);
      indexTreeNodes(indexes, existing.children).first.set(name, nextNode);
      return;
    }

    Object.assign(existing, nextNode);
    return;
  }

  let directory = index.directories.get(name);
  if (!directory) {
    directory = { name, slug, type: "directory", children: [] };
    nodes.push(directory);
    index.directories.set(name, directory);
    if (!index.first.has(name)) index.first.set(name, directory);
  }
  directory.children = directory.children ?? [];
  insertFileNode(indexes, directory.children, rest, type, pdfPath, slug);
}

function sortFileTree(nodes: ApiFileNode[]) {
  nodes.sort(compareFileTreeNodes);
  for (const node of nodes) sortFileTree(node.children ?? []);
}

function compactFileTree(nodes: ApiFileNode[], parentSlug = ""): CompactFileNode[] {
  return nodes.map((node) => {
    if (node.type === "directory") {
      return ["d", node.name, compactFileTree(node.children ?? [], node.slug)];
    }
    if (node.type === "pdf") {
      const expectedPath = `${parentSlug ? `${parentSlug}/` : ""}${node.name}.pdf`;
      return node.pdfPath === expectedPath ? ["p", node.name] : ["p", node.name, node.pdfPath];
    }
    const expectedSlug = `${parentSlug ? `${parentSlug}/` : ""}${node.name}`;
    return node.slug === expectedSlug ? ["f", node.name] : ["f", node.name, node.slug];
  });
}

export function buildCompactTreeFromManifest(
  pages: Array<Pick<WikiManifestPage, "slug">>,
  assets: Array<Pick<WikiManifestAsset, "kind" | "path">>,
) {
  const root: ApiFileNode[] = [];
  // Wide directories must not scan every sibling for every inserted path.
  const indexes: TreeIndexes = new WeakMap();
  for (const page of pages) {
    if (isHiddenFileTreePath(page.slug)) continue;
    insertFileNode(indexes, root, splitSlug(page.slug), "file");
  }
  for (const asset of assets) {
    if (isHiddenFileTreeAssetPath(asset.path)) continue;
    const segments = splitSlug(asset.path);
    if (segments.length === 0) continue;
    if (asset.kind === "pdf" || asset.path.toLowerCase().endsWith(".pdf")) {
      const name = segments[segments.length - 1]!.replace(/\.pdf$/i, "");
      insertFileNode(indexes, root, [...segments.slice(0, -1), name], "pdf", asset.path);
    } else {
      insertFileNode(indexes, root, segments, "file");
    }
  }
  sortFileTree(root);
  return compactFileTree(root);
}

