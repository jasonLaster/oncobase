import { Sidebar } from "@/components/sidebar";
import { getFileTree } from "@/lib/markdown";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tree = getFileTree();

  return (
    <div className="flex min-h-full">
      <Sidebar tree={tree} />
      <main className="flex-1 min-w-0 p-4 md:p-8 max-w-4xl mx-auto">
        {children}
      </main>
    </div>
  );
}
