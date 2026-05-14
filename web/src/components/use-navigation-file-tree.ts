"use client";

import { useEffect, useMemo } from "react";
import useSWR, { mutate } from "swr";
import type { FileNode } from "@/lib/markdown";
import {
  expandCompactFileTree,
  type CompactFileNode,
} from "@/lib/file-tree-compact";
import { useHasHydrated } from "@/components/use-has-hydrated";

type FileTreeScope = "public" | "session";
type FileTreeSWRKey = readonly [
  "file-tree",
  scope: FileTreeScope,
  storageKey: string,
];

const FILE_TREE_CACHE_VERSION = "v1";
const fileTreeMemoryCache = new Map<string, CompactFileNode[]>();

function fileTreeCacheKey(scope: FileTreeScope) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}:file-tree:${FILE_TREE_CACHE_VERSION}:${scope}`;
}

function readCachedCompactTree(cacheKey: string) {
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

function writeCachedCompactTree(cacheKey: string, tree: CompactFileNode[]) {
  fileTreeMemoryCache.set(cacheKey, tree);

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

async function fetchCompactFileTree([
  ,
  scope,
  storageKey,
]: FileTreeSWRKey) {
  const url = new URL("/api/file-tree", window.location.origin);
  url.searchParams.set("format", "compact");
  url.searchParams.set("scope", scope);
  url.searchParams.set("cacheKey", storageKey);

  const response = await fetch(url, {
    cache: "no-cache",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });

  if (response.status === 204) return null;
  if (!response.ok) {
    throw new Error(`file tree request failed: ${response.status}`);
  }

  const compactTree = (await response.json()) as CompactFileNode[];
  if (scope === "public") {
    writeCachedCompactTree(storageKey, compactTree);
  }
  return compactTree;
}

export function useNavigationFileTree({
  enabled,
  initialTree,
}: {
  enabled: boolean;
  initialTree: FileNode[];
}) {
  const hasHydrated = useHasHydrated();
  const shouldLoadFileTree = hasHydrated && enabled;
  const publicStorageKey = fileTreeCacheKey("public");
  const sessionStorageKey = fileTreeCacheKey("session");
  const publicKey = useMemo(
    () =>
      shouldLoadFileTree
        ? (["file-tree", "public", publicStorageKey] as const)
        : null,
    [publicStorageKey, shouldLoadFileTree],
  );
  const sessionKey = useMemo(
    () =>
      shouldLoadFileTree
        ? (["file-tree", "session", sessionStorageKey] as const)
        : null,
    [sessionStorageKey, shouldLoadFileTree],
  );
  const cachedPublicTree = useMemo(
    () => (shouldLoadFileTree ? readCachedCompactTree(publicStorageKey) : null),
    [publicStorageKey, shouldLoadFileTree],
  );

  const { data: publicCompactTree, error: publicError } = useSWR(
    publicKey,
    fetchCompactFileTree,
    {
      fallbackData: cachedPublicTree,
      revalidateOnMount: true,
    },
  );
  const { data: sessionCompactTree, error: sessionError } = useSWR(
    sessionKey,
    fetchCompactFileTree,
    {
      revalidateOnMount: true,
    },
  );

  useEffect(() => {
    const handleAuthSessionChange = () => {
      if (publicKey) void mutate(publicKey);
      if (sessionKey) void mutate(sessionKey);
    };

    window.addEventListener("wiki-auth-session-change", handleAuthSessionChange);
    return () => {
      window.removeEventListener(
        "wiki-auth-session-change",
        handleAuthSessionChange,
      );
    };
  }, [publicKey, sessionKey]);

  useEffect(() => {
    if (publicError) {
      console.error(
        "[NavigationShell] Failed to load public file tree",
        publicError,
      );
    }
  }, [publicError]);

  useEffect(() => {
    if (sessionError) {
      console.error(
        "[NavigationShell] Failed to load session file tree",
        sessionError,
      );
    }
  }, [sessionError]);

  return useMemo(() => {
    const compactTree = sessionCompactTree ?? publicCompactTree;
    return compactTree ? expandCompactFileTree(compactTree) : initialTree;
  }, [initialTree, publicCompactTree, sessionCompactTree]);
}
