import { Header } from "@/components/header";
import { NavigationShell } from "@/components/navigation-shell";
import { getFileTree } from "@/lib/markdown";

async function getInitialFileTree() {
  "use cache";

  return getFileTree();
}

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tree = await getInitialFileTree();

  return (
    <div className="grid grid-rows-[auto_1fr] h-dvh overflow-hidden">
      <Header />
      <NavigationShell initialTree={tree}>
        {children}
      </NavigationShell>
    </div>
  );
}
