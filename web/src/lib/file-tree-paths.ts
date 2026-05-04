const HIDDEN_FILE_TREE_DIRECTORIES = new Set(["images"]);

export function isHiddenFileTreePath(path: string): boolean {
  return path
    .split("/")
    .some((segment) => HIDDEN_FILE_TREE_DIRECTORIES.has(segment));
}
