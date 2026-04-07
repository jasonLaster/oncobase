"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import type { FileNode } from "@/lib/markdown";

const ConversationList = lazy(() => import("./conversation-list"));

function hasActiveDescendant(node: FileNode, pathname: string): boolean {
  if (node.type === "file") return pathname === `/${node.slug}`;
  return node.children?.some((child) => hasActiveDescendant(child, pathname)) ?? false;
}

function TreeNode({ node, depth = 0 }: { node: FileNode; depth?: number }) {
  const pathname = usePathname();
  const hasActive = hasActiveDescendant(node, pathname);
  const shouldOpen = depth === 0 || hasActive;
  // Reset user toggle when pathname changes by keying on pathname
  const [userToggle, setUserToggle] = useState<{ path: string; open: boolean } | null>(null);
  const open = userToggle?.path === pathname ? userToggle.open : shouldOpen;
  const isActive = pathname === `/${node.slug}`;

  if (node.type === "directory") {
    return (
      <div>
        <button
          onClick={() => setUserToggle({ path: pathname, open: !open })}
          className="flex items-center gap-1.5 w-full text-left px-2 py-1 text-sm rounded hover:bg-[var(--accent-light)] transition-colors"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <span className="text-xs opacity-60">{open ? "▼" : "▶"}</span>
          <span className="font-medium truncate">{node.name}</span>
        </button>
        {open && node.children && (
          <div>
            {node.children.map((child) => (
              <TreeNode key={child.slug} node={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Link
      href={`/${node.slug}`}
      className={`block px-2 py-1 text-sm rounded truncate transition-colors ${
        isActive
          ? "bg-[var(--accent-light)] text-[var(--brand)] font-medium"
          : "text-[var(--text-muted)] hover:bg-[var(--accent-light)] hover:text-[var(--foreground)]"
      }`}
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
      title={node.name}
    >
      {node.name}
    </Link>
  );
}



export function Sidebar({ tree }: { tree: FileNode[] }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const isChat = pathname.startsWith("/chat");

  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const openMobile = useCallback(() => setMobileOpen(true), []);

  useEffect(() => {
    queueMicrotask(() => setMobileOpen(false));
  }, [pathname]);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [mobileOpen]);

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__openSidebar = openMobile;
    return () => {
      delete (window as unknown as Record<string, unknown>).__openSidebar;
    };
  }, [openMobile]);

  return (
    <>
      {/* Mobile drawer overlay */}
      <div
        className={`md:hidden fixed inset-0 z-40 transition-opacity duration-300 ${
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={closeMobile} />
        <aside
          className={`absolute top-0 left-0 bottom-0 w-[280px] max-w-[85vw] bg-[var(--sidebar-bg)] shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-[var(--sidebar-border)]">
            <Link href="/" className="text-base font-semibold tracking-tight" onClick={closeMobile}>
              Diana&apos;s TNBC
            </Link>
            <button
              onClick={closeMobile}
              aria-label="Close menu"
              className="p-1.5 -mr-1.5 rounded-md hover:bg-[var(--accent-light)] transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="4" y1="4" x2="12" y2="12" />
                <line x1="12" y1="4" x2="4" y2="12" />
              </svg>
            </button>
          </div>
          <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2 space-y-0.5">
            {isChat ? <Suspense fallback={<div className="px-2 py-1 text-xs text-[var(--text-muted)]">Loading...</div>}><ConversationList /></Suspense> : tree.map((node) => (
              <TreeNode key={node.slug} node={node} />
            ))}
          </nav>
        </aside>
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col h-full min-h-0 overflow-hidden bg-[var(--sidebar-bg)]">
        <nav className="flex-1 min-h-0 overflow-y-auto p-2 space-y-0.5">
          {isChat ? <Suspense fallback={<div className="px-2 py-1 text-xs text-[var(--text-muted)]">Loading...</div>}><ConversationList /></Suspense> : tree.map((node) => (
            <TreeNode key={node.slug} node={node} />
          ))}
        </nav>
      </aside>
    </>
  );
}
