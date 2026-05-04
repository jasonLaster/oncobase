import type { FileNode } from "@/lib/file-tree-compact";

export interface ShellFileTreeOptions {
  maxDepth?: number;
}

const DEFAULT_SHELL_MAX_DEPTH = 2;

function pruneNodeForShell(
  node: FileNode,
  depth: number,
  maxDepth: number,
): FileNode {
  if (node.type !== "directory") return node;

  const children = node.children ?? [];
  const atMaxDepth = depth >= maxDepth;

  if (atMaxDepth) {
    return {
      ...node,
      children: [],
      ...(children.length > 0 ? { truncated: true } : {}),
    };
  }

  return {
    ...node,
    children: children.map((child) =>
      pruneNodeForShell(child, depth + 1, maxDepth),
    ),
  };
}

export function pruneFileTreeForShell(
  nodes: FileNode[],
  options: ShellFileTreeOptions = {},
): FileNode[] {
  const maxDepth = Math.max(1, options.maxDepth ?? DEFAULT_SHELL_MAX_DEPTH);
  return nodes.map((node) => pruneNodeForShell(node, 1, maxDepth));
}

export function fileTreeHasTruncatedNodes(nodes: FileNode[]): boolean {
  for (const node of nodes) {
    if (node.truncated) return true;
    if (node.children && fileTreeHasTruncatedNodes(node.children)) return true;
  }
  return false;
}

export function shouldLoadFullFileTree(nodes: FileNode[]): boolean {
  return nodes.length === 0 || fileTreeHasTruncatedNodes(nodes);
}
