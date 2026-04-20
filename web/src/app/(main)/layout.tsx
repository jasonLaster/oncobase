import { Header } from "@/components/header";
import { NavigationShell } from "@/components/navigation-shell";
import { getFileTree } from "@/lib/markdown";

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  "use cache";

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
