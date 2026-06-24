const HIDDEN_FILE_TREE_DIRECTORIES = new Set(["images"]);
const HIDDEN_FILE_TREE_FILENAMES = new Set(["package.json"]);
const HIDDEN_FILE_TREE_FILE_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);

export function isHiddenFileTreePath(path: string): boolean {
  return path
    .split("/")
    .some((segment) => {
      const lower = segment.toLowerCase();
      return (
        HIDDEN_FILE_TREE_DIRECTORIES.has(lower) ||
        HIDDEN_FILE_TREE_FILENAMES.has(lower) ||
        lower === "tsconfig" ||
        lower.startsWith("tsconfig.")
      );
    });
}

export function isHiddenFileTreeAssetPath(path: string): boolean {
  if (isHiddenFileTreePath(path)) return true;
  const lower = path.toLowerCase();
  return Array.from(HIDDEN_FILE_TREE_FILE_EXTENSIONS).some((extension) =>
    lower.endsWith(extension),
  );
}
