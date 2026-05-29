"use client";

import { Suspense, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { FileNode } from "@/lib/markdown";
import { BottomNav } from "@/components/bottom-nav";
import { PageLoadingSkeleton } from "@/components/page-loading";
import { ResizableLayout } from "@/components/resizable-layout";
import { Sidebar } from "@/components/sidebar";
import { useNavigationFileTree } from "@/components/use-navigation-file-tree";
import { ConversationList } from "@oncobase/chat";

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
  treeVersion,
}: {
  children: ReactNode;
  initialTree: FileNode[];
  treeVersion: string;
}) {
  const pathname = usePathname();
  const tree = useNavigationFileTree({
    enabled: !pathname.startsWith("/chat"),
    initialTree,
    treeVersion,
  });

  const shouldRenderStaticContent =
    pathname === "/table-examples" || pathname === "/sources/research/paper-catalog";
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
