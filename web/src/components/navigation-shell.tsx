"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import type { FileNode } from "@/lib/markdown";
import {
  expandCompactFileTree,
  type CompactFileNode,
} from "@/lib/file-tree-compact";
import { shouldLoadFullFileTree } from "@/lib/file-tree-shell";
import { BottomNav } from "@/components/bottom-nav";
import { PageLoadingSkeleton } from "@/components/page-loading";
import { ResizableLayout } from "@/components/resizable-layout";
import { Sidebar } from "@/components/sidebar";
import { ConversationList } from "@diana-tnbc/chat";

type FileTreeScope = "public" | "session";

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
    window.sessionStorage.setItem(
      cacheKey,
      JSON.stringify({ version: FILE_TREE_CACHE_VERSION, tree }),
    );
  } catch {
    // Storage is a best-effort warm cache; quota/private mode failures
    // should never affect navigation.
  }
}

async function fetchCompactFileTree(scope: FileTreeScope, cacheKey: string) {
  const url = new URL("/api/file-tree", window.location.origin);
  url.searchParams.set("format", "compact");
  url.searchParams.set("scope", scope);
  url.searchParams.set("cacheKey", cacheKey);

  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });

  if (response.status === 204) return null;
  if (!response.ok) {
    throw new Error(`file tree request failed: ${response.status}`);
  }

  const compactTree = (await response.json()) as CompactFileNode[];
  if (scope === "public") {
    writeCachedCompactTree(cacheKey, compactTree);
  }
  return compactTree;
}

function SidebarFallback() {
  return (
    <aside
      className="hidden h-full min-h-0 flex-col overflow-hidden bg-[var(--sidebar-bg)] md:flex"
      data-test-id="sidebar-loading"
    >
      <nav className="flex-1 min-h-0 overflow-y-auto p-2" />
    </aside>
  );
}

export function NavigationShell({
  children,
  initialTree,
}: {
  children: ReactNode;
  initialTree: FileNode[];
}) {
  const pathname = usePathname();
  const [tree, setTree] = useState(initialTree);
  const fullTreeRequestedRef = useRef(false);
  const treeRef = useRef(tree);
  const authReloadCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  const startFullTreeLoad = useCallback(() => {
    if (pathname.startsWith("/chat")) {
      return () => {};
    }

    fullTreeRequestedRef.current = true;
    let cancelled = false;

    const applyCompactTree = (compactTree: CompactFileNode[] | null) => {
      if (!cancelled && compactTree) {
        setTree(expandCompactFileTree(compactTree));
      }
    };

    const publicCacheKey = fileTreeCacheKey("public");
    applyCompactTree(readCachedCompactTree(publicCacheKey));

    const sessionCacheKey = fileTreeCacheKey("session");
    Promise.allSettled([
      fetchCompactFileTree("public", publicCacheKey),
      fetchCompactFileTree("session", sessionCacheKey),
    ]).then(([publicResult, sessionResult]) => {
      if (publicResult.status === "fulfilled") {
        applyCompactTree(publicResult.value);
      } else {
        console.error(
          "[NavigationShell] Failed to load public file tree",
          publicResult.reason,
        );
      }

      if (sessionResult.status === "fulfilled") {
        applyCompactTree(sessionResult.value);
      } else {
        console.error(
          "[NavigationShell] Failed to load session file tree",
          sessionResult.reason,
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    if (
      fullTreeRequestedRef.current ||
      !shouldLoadFullFileTree(treeRef.current)
    ) {
      return;
    }

    return startFullTreeLoad();
  }, [startFullTreeLoad]);

  useEffect(() => {
    const handleAuthSessionChange = () => {
      authReloadCleanupRef.current?.();
      fullTreeRequestedRef.current = false;
      authReloadCleanupRef.current = startFullTreeLoad();
    };

    window.addEventListener("wiki-auth-session-change", handleAuthSessionChange);
    return () => {
      authReloadCleanupRef.current?.();
      window.removeEventListener(
        "wiki-auth-session-change",
        handleAuthSessionChange,
      );
    };
  }, [startFullTreeLoad]);

  const shouldRenderStaticContent =
    pathname === "/table-examples" || pathname === "/wiki/research/paper-catalog";
  const content = shouldRenderStaticContent ? (
    children
  ) : (
    <Suspense fallback={<PageLoadingSkeleton />}>{children}</Suspense>
  );

  if (pathname.startsWith("/admin")) {
    return <div className="h-full min-h-0 overflow-hidden">{content}</div>;
  }

  const sidebar = pathname.startsWith("/chat") ? (
    <aside
      className="hidden h-full min-h-0 flex-col overflow-hidden bg-[var(--sidebar-bg)] md:flex"
      data-test-id="chat-sidebar"
    >
      <nav className="flex-1 min-h-0 overflow-y-auto p-2">
        <ConversationList />
      </nav>
    </aside>
  ) : tree.length > 0 ? (
    <Sidebar tree={tree} />
  ) : (
    <SidebarFallback />
  );

  return (
    <>
      <ResizableLayout sidebar={sidebar}>{content}</ResizableLayout>
      <BottomNav tree={tree} />
    </>
  );
}
