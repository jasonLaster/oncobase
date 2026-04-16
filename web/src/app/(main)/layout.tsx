import { Suspense } from "react";
import { Header } from "@/components/header";
import { Sidebar } from "@/components/sidebar";
import { ResizableLayout } from "@/components/resizable-layout";
import { BottomNav } from "@/components/bottom-nav";
import { getFileTree } from "@/lib/markdown";

function SidebarFallback() {
  return (
    <aside className="hidden md:flex flex-col h-full min-h-0 overflow-hidden bg-[var(--sidebar-bg)]">
      <nav className="flex-1 min-h-0 overflow-y-auto p-2" />
    </aside>
  );
}

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tree = getFileTree();

  return (
    <div className="grid grid-rows-[auto_1fr] h-dvh overflow-hidden">
      <Header />
      <ResizableLayout
        sidebar={
          <Suspense fallback={<SidebarFallback />}>
            <Sidebar tree={tree} />
          </Suspense>
        }
      >
        {children}
      </ResizableLayout>
      <Suspense fallback={null}>
        <BottomNav tree={tree} />
      </Suspense>
    </div>
  );
}
