import { Header } from "@/components/header";
import { NavigationShell } from "@/components/navigation-shell";
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
      <NavigationShell initialTree={tree}>
        {children}
      </NavigationShell>
    </div>
  );
}
