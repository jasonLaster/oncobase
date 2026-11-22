export type WikiEditFileOperation = "edit" | "create";

export type WikiEditTreeFileInput = {
  slug: string;
  title: string;
  filePath: string;
  operation: WikiEditFileOperation;
  sensitive: boolean;
  stats: { additions: number; deletions: number };
};

export type WikiEditTreeFolderNode<T extends WikiEditTreeFileInput = WikiEditTreeFileInput> = {
  kind: "folder";
  name: string;
  path: string;
  children: Array<WikiEditTreeNode<T>>;
};

export type WikiEditTreeFileNode<T extends WikiEditTreeFileInput = WikiEditTreeFileInput> = {
  kind: "file";
  name: string;
  path: string;
  file: T;
};

export type WikiEditTreeNode<T extends WikiEditTreeFileInput = WikiEditTreeFileInput> =
  | WikiEditTreeFolderNode<T>
  | WikiEditTreeFileNode<T>;

/**
 * Build a scoped folder/file tree from the changed files in a wiki edit proposal.
 * Folders are sorted before files, alphabetically within each level.
 */
export function buildWikiEditFileTree<T extends WikiEditTreeFileInput>(
  files: readonly T[],
): Array<WikiEditTreeNode<T>> {
  type MutableFolder = {
    name: string;
    path: string;
    folders: Map<string, MutableFolder>;
    files: Array<WikiEditTreeFileNode<T>>;
  };

  const root: MutableFolder = { name: "", path: "", folders: new Map(), files: [] };

  for (const file of files) {
    const cleanPath = (file.filePath || `${file.slug}.md`).replace(/^\/+/, "");
    const parts = cleanPath.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    let current = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const segment = parts[i]!;
      const folderPath = current.path ? `${current.path}/${segment}` : segment;
      let next = current.folders.get(segment);
      if (!next) {
        next = { name: segment, path: folderPath, folders: new Map(), files: [] };
        current.folders.set(segment, next);
      }
      current = next;
    }

    const fileName = parts[parts.length - 1]!;
    current.files.push({
      kind: "file",
      name: fileName,
      path: cleanPath,
      file,
    });
  }

  function finalize(folder: MutableFolder): Array<WikiEditTreeNode<T>> {
    const folderNodes: Array<WikiEditTreeFolderNode<T>> = Array.from(folder.folders.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((child) => ({
        kind: "folder",
        name: child.name,
        path: child.path,
        children: finalize(child),
      }));
    const fileNodes = [...folder.files].sort((a, b) => a.name.localeCompare(b.name));
    return [...folderNodes, ...fileNodes];
  }

  return finalize(root);
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
