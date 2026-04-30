import { NextRequest } from "next/server";
import { getFileTree, type FileNode } from "@/lib/markdown";
import { siteSlugFromRequest, DEFAULT_SITE_SLUG } from "@/lib/site";

interface PageEntry {
  name: string;
  slug: string;
  path: string;
}

function flatten(nodes: FileNode[], parentPath = ""): PageEntry[] {
  const pages: PageEntry[] = [];
  for (const node of nodes) {
    const path = parentPath ? `${parentPath} / ${node.name}` : node.name;
    if (node.type === "file") {
      pages.push({ name: node.name, slug: node.slug, path });
    } else if (node.children) {
      pages.push(...flatten(node.children, path));
    }
  }
  return pages;
}

// Same Diana-vs-other handling as /api/file-tree. Phase 7 swaps
// in a Convex-backed flattener.
export function GET(request: NextRequest) {
  const siteSlug = siteSlugFromRequest(request);
  if (siteSlug !== DEFAULT_SITE_SLUG) {
    return Response.json([]);
  }
  const tree = getFileTree();
  const pages = flatten(tree);
  return Response.json(pages);
}
