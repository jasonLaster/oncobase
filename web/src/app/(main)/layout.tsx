import { Header } from "@/components/header";
import { NavigationShell } from "@/components/navigation-shell";
import { WebChatRuntimeProvider } from "@/components/chat-runtime-provider";
import { getFileTree } from "@/lib/markdown";

// Every page under (main) reads the active site from x-site-slug
// (set by the multi-tenant proxy) and pulls content from Convex per
// request. Force the segment dynamic so build-time prerender doesn't
// try to hit Convex without a request context.
export const dynamic = "force-dynamic";

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tree = await getFileTree();

  return (
    <WebChatRuntimeProvider>
      <div className="grid grid-rows-[auto_1fr] h-dvh overflow-hidden">
        <Header />
        <NavigationShell initialTree={tree}>
          {children}
        </NavigationShell>
      </div>
    </WebChatRuntimeProvider>
  );
}
