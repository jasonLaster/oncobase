import { Sidebar } from "@/components/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
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
      <div className="flex-1 min-w-0 relative">
        <div className="hidden md:block absolute top-6 right-6 z-10">
          <ThemeToggle />
        </div>
        <main className="px-4 py-4 md:px-8 md:py-8 max-w-4xl mx-auto overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
