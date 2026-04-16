import { Header } from "@/components/header";
import { Sidebar } from "@/components/sidebar";
import { ResizableLayout } from "@/components/resizable-layout";
import { BottomNav } from "@/components/bottom-nav";
import { getFileTree } from "@/lib/markdown";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Sync file tree read — no async, no Suspense, fully static in PPR cache
  const tree = getFileTree();

  return (
    <div className="grid grid-rows-[auto_1fr] h-dvh overflow-hidden">
      <Header />
      <ResizableLayout sidebar={<Sidebar tree={tree} />}>
        {children}
      </ResizableLayout>
      <BottomNav tree={tree} />
    </div>
  );
}
