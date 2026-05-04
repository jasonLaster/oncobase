import { Suspense } from "react";
import { Header } from "@/components/header";
import { NavigationShell } from "@/components/navigation-shell";
import { WebChatRuntimeProvider } from "@/components/chat-runtime-provider";
import { getFileTreeForSite, type FileNode } from "@/lib/markdown";
import { DEFAULT_SITE_SLUG, toSiteSlug } from "@/lib/site";

function MainContentFallback() {
  return (
    <div className="h-full overflow-y-auto" role="status" aria-label="Loading page">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-4 md:px-8 md:py-8">
        <div className="min-w-0 flex-1">
          <article className="relative mx-auto max-w-4xl overflow-visible pr-4 md:pr-8">
            <div className="mb-6 flex items-start justify-between gap-3">
              <div className="h-9 w-2/3 max-w-2xl animate-pulse rounded-md bg-[var(--accent-light)]" />
              <div className="h-8 w-8 shrink-0 animate-pulse rounded-md bg-[var(--accent-light)]" />
            </div>
            <div className="space-y-4">
              <div className="h-4 w-full animate-pulse rounded bg-[var(--accent-light)]" />
              <div className="h-4 w-[92%] animate-pulse rounded bg-[var(--accent-light)]" />
              <div className="h-4 w-[76%] animate-pulse rounded bg-[var(--accent-light)]" />
              <div className="h-28 w-full animate-pulse rounded-lg bg-[var(--accent-light)]" />
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}

function treeLabel(name: string) {
  return name.replace(/-/g, " ");
}

function fallbackHref(node: FileNode) {
  if (node.type === "pdf") {
    return `/api/file?path=${encodeURIComponent(node.pdfPath ?? node.slug)}`;
  }
  return `/${node.slug}`;
}

function pruneShellTree(nodes: FileNode[]): FileNode[] {
  return nodes
    .filter((node) => node.type !== "directory" || depthIsShellDirectory(node))
    .map((node) => {
      if (node.type !== "directory") return node;

      return {
        ...node,
        children:
          node.slug === "about"
            ? (node.children ?? []).filter((child) => child.type !== "directory")
            : [],
      };
    });
}

function depthIsShellDirectory(node: FileNode) {
  return node.slug === "about";
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
          <MainContentFallback />
        </div>
      </div>
      <div className="h-full min-h-0 overflow-hidden pb-12 md:hidden">
        <MainContentFallback />
      </div>
    </>
  );
}

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const initialTree = await getFileTreeForSite(
    toSiteSlug(process.env.SITE_SLUG ?? DEFAULT_SITE_SLUG)
  );
  const shellTree = pruneShellTree(initialTree);
  const shellFallback = <ShellFallback tree={shellTree} />;

  return (
    <WebChatRuntimeProvider>
      <div className="grid grid-rows-[auto_1fr] h-dvh overflow-hidden">
        <Suspense fallback={<div className="h-12 shrink-0 border-b border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]" />}>
          <Header />
        </Suspense>
        <Suspense fallback={shellFallback}>
          <NavigationShell initialTree={initialTree}>{children}</NavigationShell>
        </Suspense>
      </div>
    </WebChatRuntimeProvider>
  );
}
