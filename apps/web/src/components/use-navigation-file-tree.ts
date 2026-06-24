"use client";

import { useEffect, useMemo } from "react";
import useSWR, { mutate } from "swr";
import type { FileNode } from "@/lib/markdown";
import {
  expandCompactFileTree,
  type CompactFileNode,
} from "@/lib/file-tree-compact";
import { useHasHydrated } from "@/components/use-has-hydrated";
import {
  fileTreeCacheKey,
  readCachedCompactTree,
  writeCachedCompactTree,
} from "@/components/navigation-file-tree-cache";

type FileTreeScope = "public" | "session";
type FileTreeSWRKey = readonly [
  "file-tree",
  scope: FileTreeScope,
  storageKey: string,
];

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
    writeCachedCompactTree(storageKey, compactTree, { persist: true });
  } else {
    writeCachedCompactTree(storageKey, compactTree);
  }
  return compactTree;
}

export function useNavigationFileTree({
  enabled,
  initialTree,
  treeVersion,
}: {
  enabled: boolean;
  initialTree: FileNode[];
  treeVersion: string;
}) {
  const hasHydrated = useHasHydrated();
  const shouldLoadFileTree = hasHydrated && enabled;
  const publicStorageKey = fileTreeCacheKey("public", treeVersion);
  const sessionStorageKey = fileTreeCacheKey("session", treeVersion);
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
    const publicResolved = publicCompactTree !== undefined || Boolean(publicError);
    const sessionResolved = sessionCompactTree !== undefined || Boolean(sessionError);
    const ready =
      shouldLoadFileTree &&
      (Array.isArray(compactTree) || (publicResolved && sessionResolved));

    return {
      ready,
      tree: Array.isArray(compactTree)
        ? expandCompactFileTree(compactTree)
        : initialTree,
    };
  }, [
    initialTree,
    publicCompactTree,
    publicError,
    sessionCompactTree,
    sessionError,
    shouldLoadFileTree,
  ]);
}
