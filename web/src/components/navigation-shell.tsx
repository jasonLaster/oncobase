"use client";

import { startTransition, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { FileNode } from "@/lib/markdown";
import { BottomNav } from "@/components/bottom-nav";
import { ResizableLayout } from "@/components/resizable-layout";
import { Sidebar } from "@/components/sidebar";
import { ConversationList } from "@diana-tnbc/chat";

function SidebarFallback() {
  return (
    <aside className="hidden md:flex flex-col h-full min-h-0 overflow-hidden bg-[var(--sidebar-bg)]">
      <nav className="flex-1 min-h-0 overflow-y-auto p-2" />
    </aside>
  );
}

async function fetchFileTree(signal: AbortSignal): Promise<FileNode[]> {
  const response = await fetch("/api/file-tree", {
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error(`Failed to load file tree: ${response.status}`);
  }

  return (await response.json()) as FileNode[];
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

  useEffect(() => {
    const controller = new AbortController();

    async function loadTree() {
      try {
        const nextTree = await fetchFileTree(controller.signal);
        startTransition(() => {
          setTree(nextTree);
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("[navigation-shell] Failed to refresh file tree", error);
      }
    }

    loadTree();

    return () => {
      controller.abort();
    };
  }, [pathname]);

  const isChat = pathname.startsWith("/chat");

  const sidebar = isChat ? (
    <aside className="hidden md:flex flex-col h-full min-h-0 overflow-hidden bg-[var(--sidebar-bg)]">
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
      <ResizableLayout sidebar={sidebar}>{children}</ResizableLayout>
      <BottomNav tree={tree} />
    </>
  );
}
