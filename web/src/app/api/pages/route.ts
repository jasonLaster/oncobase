import { getFileTree, type FileNode } from "@/lib/markdown";

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

export function GET() {
  const tree = getFileTree();
  const pages = flatten(tree);
  return Response.json(pages);
}
