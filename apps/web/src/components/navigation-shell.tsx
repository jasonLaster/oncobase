"use client";

import { type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { FileNode } from "@/lib/markdown";
import { BottomNav } from "@/components/bottom-nav";
import {
  ActionPalette,
  CommandPalette,
  OutlinePalette,
} from "@/components/command-palette";
import { ResizableLayout } from "@/components/resizable-layout";
import { Sidebar } from "@/components/sidebar";
import { useNavigationFileTree } from "@/components/use-navigation-file-tree";
import { ConversationList } from "@oncobase/chat";
import type { CommandPaletteCompactFileNode } from "@oncobase/wiki-shell";

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
  initialCompactTree,
  initialTree,
  treeVersion,
}: {
  children: ReactNode;
  initialCompactTree?: CommandPaletteCompactFileNode[];
  initialTree: FileNode[];
  treeVersion: string;
}) {
  const pathname = usePathname();
  const tree = useNavigationFileTree({
    enabled: !pathname.startsWith("/chat"),
    initialTree,
    treeVersion,
  });

  if (pathname.startsWith("/admin")) {
    return <div className="h-full min-h-0 overflow-hidden">{children}</div>;
  }

  const hasFileTree = tree.length > 0 && !pathname.startsWith("/chat");
  const sidebar = pathname.startsWith("/chat") ? (
    <aside
      className="hidden h-full min-h-0 flex-col overflow-hidden bg-[var(--sidebar-bg)] md:flex"
      data-test-id="chat-sidebar"
    >
      <nav className="flex-1 min-h-0 overflow-y-auto p-2">
        <ConversationList />
      </nav>
    </aside>
  ) : hasFileTree ? (
    <Sidebar tree={tree} />
  ) : (
    <SidebarFallback />
  );

  return (
    <>
      <ResizableLayout sidebar={sidebar}>{children}</ResizableLayout>
      <BottomNav tree={tree} />
      {hasFileTree ? (
        <>
          <CommandPalette initialCompactTree={initialCompactTree} />
          <OutlinePalette />
          <ActionPalette />
        </>
      ) : null}
    </>
  );
}
