import { treeFromPaths, type TreeItemData } from "@oncobase/ui/tree";

export type WikiEditFileOperation = "edit" | "create";

export type WikiEditTreeFileInput = {
  slug: string;
  title: string;
  filePath: string;
  operation: WikiEditFileOperation;
  sensitive: boolean;
  stats: { additions: number; deletions: number };
};

export type WikiEditTree<T extends WikiEditTreeFileInput = WikiEditTreeFileInput> = {
  items: TreeItemData[];
  filesByPath: ReadonlyMap<string, T>;
  folderPaths: string[];
};

export function wikiEditFilePath(file: WikiEditTreeFileInput): string {
  return (file.filePath || `${file.slug}.md`).replace(/^\/+/, "");
}

// treeFromPaths keeps the given order within a level, so sorting the paths
// puts folders and files in alphabetical order.
export function buildWikiEditTree<T extends WikiEditTreeFileInput>(
  files: readonly T[],
): WikiEditTree<T> {
  const filesByPath = new Map<string, T>();
  for (const file of files) {
    const path = wikiEditFilePath(file);
    if (path) filesByPath.set(path, file);
  }
  const items = treeFromPaths([...filesByPath.keys()].sort((a, b) => a.localeCompare(b)));
  const folderPaths: string[] = [];
  const collect = (nodes: readonly TreeItemData[]) => {
    for (const node of nodes) {
      if (!node.children) continue;
      folderPaths.push(node.value);
      collect(node.children);
    }
  };
  collect(items);
  return { items, filesByPath, folderPaths };
}

export type ParsedUnifiedDiffRow =
  | { kind: "hunk"; text: string }
  | { kind: "context"; oldLine: number; newLine: number; text: string }
  | { kind: "add"; oldLine: null; newLine: number; text: string }
  | { kind: "del"; oldLine: number; newLine: null; text: string };

/**
 * Parse a unified diff (from `buildUnifiedDiff`) into line-numbered rows for the Raw view.
 */
export function parseUnifiedDiffRows(diff: string): ParsedUnifiedDiffRow[] {
  if (!diff.trim()) return [];
  const rows: ParsedUnifiedDiffRow[] = [];
  let oldLine = 1;
  let newLine = 1;

  for (const rawLine of diff.replace(/\r\n/g, "\n").split("\n")) {
    const hunkMatch = rawLine.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (hunkMatch) {
      oldLine = Number(hunkMatch[1]);
      newLine = Number(hunkMatch[2]);
      rows.push({ kind: "hunk", text: rawLine });
      continue;
    }
    if (rawLine.startsWith("+")) {
      rows.push({ kind: "add", oldLine: null, newLine: newLine++, text: rawLine.slice(1) });
    } else if (rawLine.startsWith("-")) {
      rows.push({ kind: "del", oldLine: oldLine++, newLine: null, text: rawLine.slice(1) });
    } else if (rawLine.startsWith(" ")) {
      rows.push({
        kind: "context",
        oldLine: oldLine++,
        newLine: newLine++,
        text: rawLine.slice(1),
      });
    } else if (rawLine.length > 0) {
      rows.push({
        kind: "context",
        oldLine: oldLine++,
        newLine: newLine++,
        text: rawLine,
      });
    }
  }
  return rows;
}
