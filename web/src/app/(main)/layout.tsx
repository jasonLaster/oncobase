import { Suspense } from "react";
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
  const t0 = performance.now();
  const tree = getFileTree();
  console.log(`[perf] getFileTree ${(performance.now() - t0).toFixed(1)}ms`);

  return (
    <div className="grid grid-rows-[auto_1fr] h-dvh overflow-hidden">
      <Suspense>
        <Header />
      </Suspense>
      <ResizableLayout sidebar={<Suspense><Sidebar tree={tree} /></Suspense>}>
        {children}
      </ResizableLayout>
      <Suspense>
        <BottomNav tree={tree} />
      </Suspense>
    </div>
  );
}
