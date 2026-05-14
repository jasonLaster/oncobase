import { Suspense } from "react";
import { Header } from "@/components/header";
import { NavigationShell } from "@/components/navigation-shell";
import { WebChatRuntimeProvider } from "@/components/chat-runtime-provider";
import { PageLoadingSkeleton } from "@/components/page-loading";
import { getShellFileTreeForSite, type FileNode } from "@/lib/markdown";
import { getSitePublishVersion } from "@/lib/site-publish-version";
import { DEFAULT_SITE_SLUG, toSiteSlug } from "@/lib/site";

function treeLabel(name: string) {
  return name.replace(/-/g, " ");
}

function fallbackHref(node: FileNode) {
  if (node.type === "pdf") {
    return `/api/file?path=${encodeURIComponent(node.pdfPath ?? node.slug)}`;
  }
  return `/${node.slug}`;
}

function FallbackTree({
  nodes,
  depth = 0,
}: {
  nodes: FileNode[];
  depth?: number;
}) {
  return (
    <>
      {nodes.map((node) => {
        if (node.type === "directory") {
          const shouldRenderChildren = depth === 0 && node.slug === "about";

          return (
            <div key={node.slug}>
              <button className="flex w-full items-center gap-1 px-2 py-1 text-left text-sm">
                <span aria-hidden="true">▼</span>
                <span>{treeLabel(node.name)}</span>
              </button>
              {shouldRenderChildren ? (
                <div className="pl-3">
                  <FallbackTree nodes={node.children ?? []} depth={depth + 1} />
                </div>
              ) : null}
            </div>
          );
        }

        return (
          <a
            key={node.slug}
            href={fallbackHref(node)}
            className="block px-2 py-1 text-sm"
            target={node.type === "pdf" ? "_blank" : undefined}
            rel={node.type === "pdf" ? "noopener noreferrer" : undefined}
          >
            {treeLabel(node.name)}
          </a>
        );
      })}
    </>
  );
}

function ShellFallback({ tree }: { tree: FileNode[] }) {
  return (
    <>
      <div
        className="hidden min-h-0 overflow-hidden md:flex"
        data-sidebar-layout
        data-sidebar-state="expanded"
      >
        <div
          data-sidebar-expanded-rail
          className="relative min-h-0 shrink-0 overflow-hidden"
          style={{ width: 256 }}
        >
          <button
            aria-label="Collapse sidebar"
            className="absolute right-2 top-2 z-10 rounded-md border border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] p-1 text-[var(--text-muted)] shadow-sm"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="11 4 7 8 11 12" />
            </svg>
          </button>
          <aside className="hidden h-full min-h-0 flex-col overflow-hidden bg-[var(--sidebar-bg)] md:flex">
            <nav className="min-h-0 flex-1 overflow-y-auto p-2">
              <FallbackTree nodes={tree} />
            </nav>
          </aside>
        </div>
        <div data-sidebar-expanded-rail className="w-[3px] shrink-0 bg-[var(--sidebar-border)]" />
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <PageLoadingSkeleton />
        </div>
      </div>
      <div className="h-full min-h-0 overflow-hidden pb-12 md:hidden">
        <PageLoadingSkeleton />
      </div>
    </>
  );
}

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const siteSlug = toSiteSlug(process.env.SITE_SLUG ?? DEFAULT_SITE_SLUG);
  const [shellTree, treeVersion] = await Promise.all([
    getShellFileTreeForSite(siteSlug, { maxDepth: 2 }),
    getSitePublishVersion(siteSlug),
  ]);
  const shellFallback = <ShellFallback tree={shellTree} />;

  return (
    <WebChatRuntimeProvider>
      <div
        className="grid h-dvh grid-rows-[auto_1fr] overflow-hidden"
        data-test-id="app-shell"
      >
        <Suspense
          fallback={
            <div
              className="h-12 shrink-0 border-b border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]"
              role="status"
              aria-label="Loading header"
              data-test-id="header-loading"
            />
          }
        >
          <Header />
        </Suspense>
        <Suspense fallback={shellFallback}>
          <NavigationShell initialTree={shellTree} treeVersion={treeVersion}>
            {children}
          </NavigationShell>
        </Suspense>
      </div>
    </WebChatRuntimeProvider>
  );
}
