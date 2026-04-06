import { Header } from "@/components/header";
import { Sidebar } from "@/components/sidebar";
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
      <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] min-h-0 overflow-hidden">
        <Sidebar tree={tree} />
        <div className="min-w-0 min-h-0 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
