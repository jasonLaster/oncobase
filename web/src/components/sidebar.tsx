"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import type { FileNode } from "@/lib/markdown";

function TreeNode({ node, depth = 0 }: { node: FileNode; depth?: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(depth === 0);
  const isActive = pathname === `/${node.slug}`;

  if (node.type === "directory") {
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
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

function usePersistedState(key: string, fallback: boolean) {
  const [value, setValue] = useState(fallback);

  useEffect(() => {
    const stored = localStorage.getItem(key);
    if (stored !== null) setValue(stored === "true");
  }, [key]);

  const set = useCallback(
    (next: boolean) => {
      setValue(next);
      localStorage.setItem(key, String(next));
    },
    [key]
  );

  return [value, set] as const;
}

export function Sidebar({ tree }: { tree: FileNode[] }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = usePersistedState("sidebar-collapsed", false);
  const pathname = usePathname();

  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const openMobile = useCallback(() => setMobileOpen(true), []);

  useEffect(() => {
    closeMobile();
  }, [pathname, closeMobile]);

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
            {tree.map((node) => (
              <TreeNode key={node.slug} node={node} />
            ))}
          </nav>
        </aside>
      </div>

      {/* Desktop sidebar */}
      <aside
        className={`hidden md:flex flex-col shrink-0 min-h-0 overflow-hidden border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] transition-[width] duration-200 ease-in-out ${
          collapsed ? "w-12" : "w-64 relative group"
        }`}
      >
        {collapsed ? (
          <div className="shrink-0 flex flex-col items-center pt-2">
            <button
              onClick={() => setCollapsed(false)}
              aria-label="Expand sidebar"
              className="p-1.5 rounded-md hover:bg-[var(--accent-light)] text-[var(--text-muted)] hover:text-[var(--foreground)] transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="3" y1="4.5" x2="15" y2="4.5" />
                <line x1="3" y1="9" x2="15" y2="9" />
                <line x1="3" y1="13.5" x2="15" y2="13.5" />
              </svg>
            </button>
          </div>
        ) : (
          <>
            <button
              onClick={() => setCollapsed(true)}
              aria-label="Collapse sidebar"
              className="absolute top-2 right-2 z-10 p-1 rounded-md bg-[var(--sidebar-bg)] border border-[var(--sidebar-border)] shadow-sm text-[var(--text-muted)] hover:text-[var(--foreground)] opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="11 4 7 8 11 12" />
              </svg>
            </button>
            <nav className="flex-1 min-h-0 overflow-y-auto p-2 space-y-0.5">
              {tree.map((node) => (
                <TreeNode key={node.slug} node={node} />
              ))}
            </nav>
          </>
        )}
      </aside>
    </>
  );
}
