import { Header } from "@/components/header";
import { Sidebar } from "@/components/sidebar";
import { ResizableLayout } from "@/components/resizable-layout";
import { getFileTree } from "@/lib/markdown";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tree = getFileTree();

  return (
    <div className="grid grid-rows-[auto_1fr] h-dvh overflow-hidden">
      <Header />
      <ResizableLayout sidebar={<Sidebar tree={tree} />}>
        {children}
      </ResizableLayout>
    </div>
  );
}
