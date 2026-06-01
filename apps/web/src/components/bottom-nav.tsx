"use client";

import Link from "next/link";
import { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import type { FileNode } from "@/lib/markdown";
import { SidebarSignInPrompt } from "@/components/actions-menu";
import { WikiTree } from "@oncobase/wiki-shell";
import {
  CommentsTreeLink,
  formatName,
  useSidebarTreeProps,
} from "@/components/sidebar";
import { openCommandPalette } from "@/components/command-palette";
import { useNavigationPathname } from "@/lib/navigation-intent";
import { commentsFeatureEnabled } from "@/lib/comments-feature";

type NavTab = "pages" | "outline";

const MOBILE_COMMENTS_PANEL_EVENT = "mobile-comments-panel-open";

type OutlineItem = {
  id: string;
  text: string;
  level: number;
};

function getPageTitle(pathname: string): string {
  if (pathname === "/") return "Home";
  if (pathname.startsWith("/chat")) return "Chat with wiki";
  if (pathname.startsWith("/comments")) return "View comments";
  if (pathname.startsWith("/search")) return "Search";
  if (pathname.startsWith("/tags/")) {
    const tag = decodeURIComponent(pathname.split("/tags/")[1] || "");
    return `Tag: ${tag}`;
  }
  const segments = pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  return formatName(decodeURIComponent(last || ""));
}

function subscribePathnameSnapshot() {
  return () => {};
}

function getOutlineHeadingText(heading: HTMLHeadingElement) {
  return (
    heading.textContent
      ?.replace(/#\s*$/, "")
      .replace(/\s+/g, " ")
      .trim() ?? ""
  );
}

function getOutlineItems(): OutlineItem[] {
  if (typeof document === "undefined") return [];
  const root = document.querySelector<HTMLElement>('[data-test-id="document-article"]');
  if (!root) return [];

  return Array.from(root.querySelectorAll<HTMLHeadingElement>("h2[id], h3[id], h4[id]"))
    .map((heading) => ({
      id: heading.id,
      text: getOutlineHeadingText(heading),
      level: Number(heading.tagName.slice(1)),
    }))
    .filter((item) => item.text.length > 0);
}

export function BottomNav({ tree }: { tree: FileNode[] }) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<NavTab>("pages");
  const [outlineItems, setOutlineItems] = useState<OutlineItem[]>([]);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const routerPathname = usePathname();
  const activePathname = useNavigationPathname();
  const treeProps = useSidebarTreeProps(tree, activePathname);
  const pathname = useSyncExternalStore(
    subscribePathnameSnapshot,
    () => routerPathname,
    () => "/"
  );
  const title = getPageTitle(pathname);
  const isChatRoute = pathname.startsWith("/chat");
  const isDocumentRoute =
    !isChatRoute &&
    !pathname.startsWith("/comments") &&
    !pathname.startsWith("/search") &&
    !pathname.startsWith("/admin");
  const close = useCallback(() => setOpen(false), []);
  const openSheet = useCallback(() => {
    setActiveTab("pages");
    setOutlineItems(getOutlineItems());
    setOpen(true);
  }, []);
  const openCommentsPanel = useCallback(() => {
    document.documentElement.dataset.mobileCommentsPanelRequested = "true";
    window.dispatchEvent(new CustomEvent(MOBILE_COMMENTS_PANEL_EVENT));
  }, []);

  const jumpToHeading = useCallback((id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    close();
  }, [close]);

  // Close on route change
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setOpen(false);
    setActiveTab("pages");
  }

  // Lock body scroll when sheet is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [open]);

  useEffect(() => {
    const refresh = () => setOutlineItems(getOutlineItems());
    refresh();

    const root = document.querySelector<HTMLElement>('[data-test-id="document-article"]');
    if (!root) return;

    const observer = new MutationObserver(refresh);
    observer.observe(root, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [pathname]);

  useEffect(() => {
    if (outlineItems.length === 0) {
      return;
    }

    const headings = outlineItems
      .map((item) => document.getElementById(item.id))
      .filter((heading): heading is HTMLElement => Boolean(heading));

    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) {
          setActiveHeadingId(visible.target.id);
        }
      },
      { rootMargin: "-20% 0px -65% 0px", threshold: [0, 1] }
    );

    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [outlineItems]);

  return (
    <>
      <header
        className="fixed inset-x-0 top-0 z-40 flex h-12 items-center gap-2 border-b border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]/95 px-3 backdrop-blur-sm md:hidden"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
        data-test-id="mobile-page-header"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold leading-tight text-[var(--foreground)]">
            {title}
          </div>
        </div>
        <button
          type="button"
          onClick={openCommandPalette}
          aria-label="Search files"
          title="Search files"
          className="flex size-9 shrink-0 items-center justify-center rounded-md border border-[var(--sidebar-border)] bg-[var(--background)] text-[var(--text-muted)] transition-colors hover:border-[var(--brand)] hover:text-[var(--foreground)]"
          data-test-id="mobile-header-search"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="7" cy="7" r="4.25" />
            <path d="m10.25 10.25 3.5 3.5" />
          </svg>
        </button>
        {isDocumentRoute ? (
          <button
            type="button"
            onClick={openCommentsPanel}
            aria-label="Open comments"
            title="Open comments"
            className="flex size-9 shrink-0 items-center justify-center rounded-md border border-[var(--sidebar-border)] bg-[var(--background)] text-[var(--text-muted)] transition-colors hover:border-[var(--brand)] hover:text-[var(--foreground)]"
            data-test-id="mobile-header-comments"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2.5 3.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H6l-3.5 3v-10Z" />
            </svg>
          </button>
        ) : null}
        <button
          type="button"
          onClick={openSheet}
          aria-label="Open page navigation"
          title="Open page navigation"
          className="flex size-9 shrink-0 items-center justify-center rounded-md border border-[var(--sidebar-border)] bg-[var(--background)] text-[var(--text-muted)] transition-colors hover:border-[var(--brand)] hover:text-[var(--foreground)]"
          data-test-id="bottom-nav-trigger"
        >
          <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 4h10M3 8h10M3 12h7" />
          </svg>
        </button>
      </header>

      {!isChatRoute && (
        <Link
          href="/chat"
          aria-label="Ask wiki"
          title="Ask wiki"
          className="fixed bottom-[calc(2rem+env(safe-area-inset-bottom))] right-4 z-50 inline-flex size-12 items-center justify-center rounded-full border border-[var(--brand)]/25 bg-[var(--brand)] text-white shadow-lg shadow-black/15 transition-transform active:scale-[0.97] md:hidden"
          data-test-id="mobile-ask-wiki"
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
            <path d="M9 10h6M9 14h4" />
          </svg>
        </Link>
      )}

      {/* Bottom sheet overlay */}
      <div
        className={`md:hidden fixed inset-0 z-50 transition-opacity duration-300 ${
          open
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
        data-test-id="bottom-nav-sheet"
        data-state={open ? "open" : "closed"}
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
          onClick={close}
        />

        {/* Sheet */}
        <div
          className={`absolute bottom-0 left-0 right-0 h-[min(88dvh,46rem)] bg-[var(--sidebar-bg)] rounded-t-2xl shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
            open ? "translate-y-0" : "translate-y-full"
          }`}
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {/* Drag handle + close button */}
          <div className="shrink-0 pt-2 pb-1 px-4">
            <div className="w-8 h-1 rounded-full bg-[var(--text-muted)]/30 mx-auto mb-2" />
            <div className="flex justify-end">
              <button
                onClick={close}
                aria-label="Close navigation"
                className="p-1.5 -mr-1.5 rounded-md hover:bg-[var(--accent-light)] transition-colors text-[var(--text-muted)]"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <line x1="4" y1="4" x2="12" y2="12" />
                  <line x1="12" y1="4" x2="4" y2="12" />
                </svg>
              </button>
            </div>
            <div className="mt-3 flex rounded-md border border-[var(--sidebar-border)] bg-[var(--background)]/70 p-0.5">
              <button
                type="button"
                onClick={() => setActiveTab("pages")}
                className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === "pages"
                    ? "bg-[var(--accent-light)] text-[var(--brand)]"
                    : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
                }`}
              >
                Page nav
              </button>
              <button
                type="button"
                onClick={() => {
                  setOutlineItems(getOutlineItems());
                  setActiveTab("outline");
                }}
                className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === "outline"
                    ? "bg-[var(--accent-light)] text-[var(--brand)]"
                    : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
                }`}
              >
                Outline
              </button>
            </div>
          </div>

          {/* Scrollable navigation */}
          <nav
            className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain p-2"
            data-test-id={activeTab === "outline" ? "bottom-nav-outline" : "bottom-nav-page-tree"}
          >
            {activeTab === "pages" ? (
              <>
                {commentsFeatureEnabled() ? (
                  <CommentsTreeLink activePathname={activePathname} onNavigate={close} />
                ) : null}
                <SidebarSignInPrompt />
                <WikiTree {...treeProps} onNavigate={close} />
              </>
            ) : outlineItems.length > 0 ? (
              <div className="space-y-0.5">
                {outlineItems.map((item) => {
                  const active = item.id === activeHeadingId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-current={active ? "location" : undefined}
                      data-active-outline-heading={active ? "true" : undefined}
                      onClick={() => jumpToHeading(item.id)}
                      style={{ paddingLeft: `${Math.max(0, item.level - 2) * 14 + 12}px` }}
                      className={`block w-full rounded-md py-2 pr-2 text-left text-sm transition-colors ${
                        active
                          ? "bg-[var(--brand)]/10 font-medium text-[var(--brand)]"
                          : "text-[var(--text-muted)] hover:bg-[var(--accent-light)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      <span className="line-clamp-2">{item.text}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-[var(--sidebar-border)] px-4 py-6 text-sm text-[var(--text-muted)]">
                No headings found on this page.
              </div>
            )}
          </nav>
        </div>
      </div>
    </>
  );
}
