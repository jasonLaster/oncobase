"use client";

import { Suspense, type ReactNode } from "react";
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

function MainContentFallback() {
  return (
    <div className="h-full overflow-y-auto" role="status" aria-label="Loading page">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-4 md:px-8 md:py-8">
        <div className="min-w-0 flex-1">
          <article className="relative mx-auto max-w-4xl overflow-visible pr-4 md:pr-8">
            <div className="mb-6 flex items-start justify-between gap-3">
              <div className="h-9 w-2/3 max-w-2xl animate-pulse rounded-md bg-[var(--accent-light)]" />
              <div className="h-8 w-8 shrink-0 animate-pulse rounded-md bg-[var(--accent-light)]" />
            </div>
            <div className="space-y-4">
              <div className="h-4 w-full animate-pulse rounded bg-[var(--accent-light)]" />
              <div className="h-4 w-[92%] animate-pulse rounded bg-[var(--accent-light)]" />
              <div className="h-4 w-[76%] animate-pulse rounded bg-[var(--accent-light)]" />
              <div className="h-28 w-full animate-pulse rounded-lg bg-[var(--accent-light)]" />
            </div>
          </article>
        </div>
      </div>
    </div>
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
  const tree = initialTree;

  const shouldRenderStaticContent =
    pathname === "/table-examples" || pathname === "/wiki/research/paper-catalog";
  const content = shouldRenderStaticContent ? (
    children
  ) : (
    <Suspense fallback={<MainContentFallback />}>{children}</Suspense>
  );

  const sidebar = pathname.startsWith("/chat") ? (
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
      <ResizableLayout sidebar={sidebar}>{content}</ResizableLayout>
      <BottomNav tree={tree} />
    </>
  );
}
