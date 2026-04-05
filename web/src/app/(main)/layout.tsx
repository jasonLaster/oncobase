import { Sidebar } from "@/components/sidebar";
import { getFileTree } from "@/lib/markdown";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tree = getFileTree();

  return (
    <div className="flex flex-col md:flex-row min-h-full">
      <Sidebar tree={tree} />
      <main className="flex-1 min-w-0 px-4 py-4 md:px-8 md:py-8 max-w-4xl mx-auto overflow-x-hidden">
        {children}
      </main>
    </div>
  );
}
