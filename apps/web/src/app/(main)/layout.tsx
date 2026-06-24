import { Suspense } from "react";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { Toaster } from "sonner";
import { ConvexClientProvider } from "@/components/convex-provider";
import { NavigationShell } from "@/components/navigation-shell";
import { WebChatRuntimeProvider } from "@/components/chat-runtime-provider";
import { PageLoadingSkeleton } from "@/components/page-loading";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { SidebarTreeSkeleton } from "@/components/sidebar-tree-skeleton";
import type { FileNode } from "@/lib/markdown";
import { getSitePublishVersion } from "@/lib/site-publish-version";
import { DEFAULT_SITE_SLUG, toSiteSlug } from "@/lib/site";
import "../globals.css";
import "@liveblocks/react-ui/styles.css";
import "katex/dist/katex.min.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

function truncatedDirectory(name: string, slug: string): FileNode {
  return {
    name,
    slug,
    type: "directory",
    children: [],
    truncated: true,
  };
}

const STATIC_SHELL_TREE: FileNode[] = [
  { name: "index", slug: "index", type: "file" },
  {
    name: "about",
    slug: "about",
    type: "directory",
    children: [
      { name: "About", slug: "about/About", type: "file" },
      { name: "Journal", slug: "about/Journal", type: "file" },
      { name: "Log", slug: "about/Log", type: "file" },
      {
        name: "overview",
        slug: "about/overview",
        type: "directory",
        children: [],
        truncated: true,
      },
      { name: "Terminology", slug: "about/Terminology", type: "file" },
    ],
  },
  truncatedDirectory("asco", "asco"),
  truncatedDirectory("project management", "project-management"),
  truncatedDirectory("sources", "sources"),
  {
    name: "wiki",
    slug: "wiki",
    type: "directory",
    children: [
      { name: "index", slug: "wiki/index", type: "file" },
      truncatedDirectory("companies", "wiki/companies"),
      truncatedDirectory("diagnostics", "wiki/diagnostics"),
      truncatedDirectory("education", "wiki/education"),
      truncatedDirectory("logistics", "wiki/logistics"),
      truncatedDirectory("people", "wiki/people"),
      truncatedDirectory("prognosis", "wiki/prognosis"),
      truncatedDirectory("questions", "wiki/questions"),
      truncatedDirectory("treatment", "wiki/treatment"),
      truncatedDirectory("updates", "wiki/updates"),
    ],
  },
];

async function getInitialTreeVersion(siteSlug: string) {
  if (process.env.NODE_ENV === "development") {
    return "development";
  }

  return getSitePublishVersion(siteSlug);
}

function FallbackWorkspaceHeader() {
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 px-2">
      <button
        type="button"
        aria-label="Workspace menu"
        data-test-id="sidebar-workspace-trigger"
        className="group flex h-9 max-w-[calc(100%-2.5rem)] items-center gap-2 rounded-md px-2 text-left text-sm font-semibold text-[var(--foreground)]"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 32 32"
          className="shrink-0 rounded-md"
          aria-hidden="true"
        >
          <rect width="32" height="32" rx="6" fill="#4f46e5" />
          <text
            x="16"
            y="23"
            fontFamily="system-ui, -apple-system, sans-serif"
            fontSize="22"
            fontWeight="700"
            fill="white"
            textAnchor="middle"
          >
            D
          </text>
        </svg>
        <span className="min-w-0 flex-1 truncate">Diana TNBC</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 opacity-50"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </div>
  );
}

function FallbackSidebarFooter() {
  return (
    <div className="shrink-0 px-3 pb-3 pt-1">
      <div className="flex items-stretch overflow-hidden rounded-lg border border-[var(--sidebar-border)] bg-[var(--popover)] shadow-sm">
        <Link
          href="/chat"
          className="flex flex-1 items-center justify-center gap-2 px-3 py-2 text-[13px] text-[var(--text-muted)]"
          data-test-id="sidebar-ask-wiki"
        >
          Ask wiki
        </Link>
        <div
          aria-hidden="true"
          className="w-px shrink-0 self-stretch bg-[var(--sidebar-border)]"
        />
        <button
          type="button"
          className="flex flex-1 items-center justify-center gap-2 px-3 py-2 text-[13px] text-[var(--text-muted)]"
          data-test-id="sidebar-search"
        >
          Search
        </button>
      </div>
    </div>
  );
}

function ShellFallback() {
  return (
    <>
      <div
        className="hidden min-h-0 overflow-hidden md:flex"
        data-sidebar-layout
        data-sidebar-state="expanded"
      >
        <div
          data-sidebar-collapsed-rail
          className="hidden shrink-0 flex-col items-center border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] pt-2 md:w-12"
        >
          <button
            type="button"
            aria-label="Expand sidebar"
            className="rounded-md p-1.5 text-[var(--text-muted)]"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="3" y1="4.5" x2="15" y2="4.5" />
              <line x1="3" y1="9" x2="15" y2="9" />
              <line x1="3" y1="13.5" x2="15" y2="13.5" />
            </svg>
          </button>
        </div>
        <div
          data-sidebar-expanded-rail
          className="relative min-h-0 shrink-0 overflow-hidden"
          style={{ width: 256 }}
        >
          <button
            type="button"
            aria-label="Collapse sidebar"
            className="absolute right-2 top-2 z-10 rounded-md border border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] p-1 text-[var(--text-muted)] shadow-sm"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="11 4 7 8 11 12" />
            </svg>
          </button>
          <aside
            className="hidden h-full min-h-0 flex-col overflow-hidden bg-[var(--sidebar-bg)] md:flex"
            data-test-id="sidebar"
          >
            <FallbackWorkspaceHeader />
            <SidebarTreeSkeleton />
            <FallbackSidebarFooter />
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
  const shellTree = STATIC_SHELL_TREE;
  const treeVersion = await getInitialTreeVersion(siteSlug);
  const shellFallback = <ShellFallback />;

  return (
    <ConvexClientProvider>
      <div className={`${geistSans.variable} ${geistMono.variable}`}>
        <WebChatRuntimeProvider>
          <div
            className="grid h-dvh grid-rows-[1fr] overflow-hidden"
            data-test-id="app-shell"
          >
            <Suspense fallback={shellFallback}>
              <NavigationShell
                initialTree={shellTree}
                treeVersion={treeVersion}
              >
                {children}
              </NavigationShell>
            </Suspense>
          </div>
          <Toaster richColors closeButton position="bottom-right" theme="system" />
          <Analytics />
          <ServiceWorkerRegistration />
        </WebChatRuntimeProvider>
      </div>
    </ConvexClientProvider>
  );
}
