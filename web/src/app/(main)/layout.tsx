import { Suspense } from "react";
import { Header } from "@/components/header";
import { Sidebar } from "@/components/sidebar";
import { ResizableLayout } from "@/components/resizable-layout";
import { BottomNav } from "@/components/bottom-nav";
import { getFileTree, getFileTreeWithPdfs } from "@/lib/markdown";

/**
 * Async component that fetches the full file tree (including Convex PDFs).
 * Wrapped in Suspense so the layout shell is static in the PPR cache.
 * On first render, the sync tree shows instantly; the PDF-merged tree
 * streams in once the Convex fetch resolves.
 */
async function SidebarWithPdfs() {
  const tree = await getFileTreeWithPdfs();
  return <Sidebar tree={tree} />;
}

async function BottomNavWithPdfs() {
  const tree = await getFileTreeWithPdfs();
  return <BottomNav tree={tree} />;
}

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Sync tree for the initial static render (no PDFs from Convex)
  const tree = getFileTree();

  return (
    <div className="grid grid-rows-[auto_1fr] h-dvh overflow-hidden">
      <Header />
      <ResizableLayout
        sidebar={
          <Suspense fallback={<Sidebar tree={tree} />}>
            <SidebarWithPdfs />
          </Suspense>
        }
      >
        {children}
      </ResizableLayout>
      <Suspense fallback={<BottomNav tree={tree} />}>
        <BottomNavWithPdfs />
      </Suspense>
    </div>
  );
}
