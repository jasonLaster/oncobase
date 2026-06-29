import type { CompactFileNode } from "@/lib/file-tree-compact";

type FileTreeScope = "public" | "session";

const FILE_TREE_CACHE_VERSION = "v3";
const fileTreeMemoryCache = new Map<string, CompactFileNode[]>();

function originPrefix() {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}:file-tree:${FILE_TREE_CACHE_VERSION}:`;
}

export function fileTreeCacheKey(scope: FileTreeScope, version: string) {
  return `${originPrefix()}${version}:${scope}`;
}

function isFileTreeCacheKeyForScope(key: string, scope: FileTreeScope) {
  return key.startsWith(originPrefix()) && key.endsWith(`:${scope}`);
}

export function readCachedCompactTree(cacheKey: string) {
  const memoryHit = fileTreeMemoryCache.get(cacheKey);
  if (memoryHit) return memoryHit;

  try {
    if (typeof window === "undefined") return null;

    const raw = window.sessionStorage.getItem(cacheKey);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { tree?: CompactFileNode[] };
    if (!Array.isArray(parsed.tree)) return null;

    fileTreeMemoryCache.set(cacheKey, parsed.tree);
    return parsed.tree;
  } catch {
    return null;
  }
}

export function readLatestCachedCompactTree() {
  for (const scope of ["session", "public"] as const) {
    for (const [key, tree] of Array.from(fileTreeMemoryCache.entries()).reverse()) {
      if (isFileTreeCacheKeyForScope(key, scope)) return tree;
    }

    try {
      if (typeof window === "undefined") continue;

      for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
        const key = window.sessionStorage.key(index);
        if (!key || !isFileTreeCacheKeyForScope(key, scope)) continue;
        const cached = readCachedCompactTree(key);
        if (cached) return cached;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export function writeCachedCompactTree(
  cacheKey: string,
  tree: CompactFileNode[],
  options: { persist?: boolean } = {},
) {
  fileTreeMemoryCache.set(cacheKey, tree);

  if (!options.persist) return;

  try {
    if (typeof window === "undefined") return;

    window.sessionStorage.setItem(
      cacheKey,
      JSON.stringify({ version: FILE_TREE_CACHE_VERSION, tree }),
    );
  } catch {
    // Storage is a best-effort warm cache; quota/private mode failures
    // should never affect navigation.
  }
}
