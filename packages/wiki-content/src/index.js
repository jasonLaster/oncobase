function splitSlug(slug) {
  return slug.split("/").filter(Boolean);
}

const HIDDEN_FILE_TREE_DIRECTORIES = new Set(["images"]);
const HIDDEN_FILE_TREE_FILE_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);

export function isHiddenFileTreePath(path) {
  return splitSlug(path).some((segment) => HIDDEN_FILE_TREE_DIRECTORIES.has(segment));
}

export function isHiddenFileTreeAssetPath(path) {
  if (isHiddenFileTreePath(path)) return true;
  const lower = path.toLowerCase();
  return Array.from(HIDDEN_FILE_TREE_FILE_EXTENSIONS).some((extension) =>
    lower.endsWith(extension),
  );
}
