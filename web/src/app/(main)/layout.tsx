import { Suspense } from "react";
import { Header } from "@/components/header";
import { Sidebar } from "@/components/sidebar";
import { ResizableLayout } from "@/components/resizable-layout";
import { BottomNav } from "@/components/bottom-nav";
import { getFileTreeWithPdfs } from "@/lib/markdown";

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tree = await getFileTreeWithPdfs();

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
