"use client";

import { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import type { FileNode } from "@/lib/markdown";
import { TreeNode, fileTreeNodeKey, formatName } from "@/components/sidebar";
import { useNavigationPathname } from "@/lib/navigation-intent";
import { ConversationList } from "@diana-tnbc/chat";

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

export function BottomNav({ tree }: { tree: FileNode[] }) {
  const [open, setOpen] = useState(false);
  const routerPathname = usePathname();
  const activePathname = useNavigationPathname();
  const pathname = useSyncExternalStore(
    subscribePathnameSnapshot,
    () => routerPathname,
    () => "/"
  );
  const title = getPageTitle(pathname);
  const isChatRoute = pathname.startsWith("/chat");

  const close = useCallback(() => setOpen(false), []);

  // Close on route change
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setOpen(false);
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

  return (
    <>
      {/* Bottom bar */}
      <button
        onClick={() => setOpen(true)}
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex items-center justify-between px-4 h-12 bg-[var(--sidebar-bg)]/95 backdrop-blur-sm border-t border-[var(--sidebar-border)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        data-test-id="bottom-nav-trigger"
      >
        <span className="truncate text-sm font-medium">{title}</span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-[var(--text-muted)]"
        >
          <polyline points="4 10 8 6 12 10" />
        </svg>
      </button>

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
          className={`absolute bottom-0 left-0 right-0 max-h-[85dvh] bg-[var(--sidebar-bg)] rounded-t-2xl shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
            open ? "translate-y-0" : "translate-y-full"
          }`}
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {/* Drag handle + header */}
          <div className="shrink-0 pt-2 pb-1 px-4">
            <div className="w-8 h-1 rounded-full bg-[var(--text-muted)]/30 mx-auto mb-2" />
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">
                {isChatRoute ? "Chats" : "Pages"}
              </span>
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
          </div>

          {/* Scrollable navigation */}
          <nav
            className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain p-2"
            data-test-id={isChatRoute ? "bottom-nav-chat-list" : "bottom-nav-page-tree"}
          >
            {isChatRoute ? (
              <ConversationList />
            ) : (
              tree.map((node) => (
                <TreeNode
                  activePathname={activePathname}
                  key={fileTreeNodeKey(node)}
                  node={node}
                  onNavigate={close}
                />
              ))
            )}
          </nav>
        </div>
      </div>
    </>
  );
}
