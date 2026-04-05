"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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

function SearchBox() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="px-3 pb-2">
      <div className="relative">
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="absolute left-2.5 top-1/2 -translate-y-1/2 opacity-40"
        >
          <path d="M15.25 14.19l-4.06-4.06a5.5 5.5 0 1 0-1.06 1.06l4.06 4.06a.75.75 0 1 0 1.06-1.06zM2 6.5a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0z" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search..."
          className="w-full pl-8 pr-3 py-1.5 rounded-md border border-[var(--sidebar-border)] bg-[var(--background)] text-[var(--foreground)] text-xs placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--brand)] transition-colors"
        />
      </div>
    </form>
  );
}

export function Sidebar({ tree }: { tree: FileNode[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const close = useCallback(() => setOpen(false), []);

  // Close on navigation
  useEffect(() => {
    close();
  }, [pathname, close]);

  // Lock body scroll when open on mobile
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
      {/* Mobile top bar */}
      <div className="md:hidden sticky top-0 z-30 flex items-center gap-3 border-b border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]/95 backdrop-blur-sm px-4 py-3">
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="p-1.5 -ml-1.5 rounded-md hover:bg-[var(--accent-light)] active:bg-[var(--accent-light)] transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="3" y1="4.5" x2="15" y2="4.5" />
            <line x1="3" y1="9" x2="15" y2="9" />
            <line x1="3" y1="13.5" x2="15" y2="13.5" />
          </svg>
        </button>
        <Link href="/" className="text-base font-semibold tracking-tight" onClick={close}>
          Diana&apos;s TNBC
        </Link>
      </div>

      {/* Overlay + drawer (mobile) */}
      <div
        className={`md:hidden fixed inset-0 z-40 transition-opacity duration-300 ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        {/* Scrim */}
        <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={close} />

        {/* Drawer panel */}
        <aside
          className={`absolute top-0 left-0 bottom-0 w-[280px] max-w-[85vw] bg-[var(--sidebar-bg)] shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
            open ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          {/* Drawer header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--sidebar-border)]">
            <Link href="/" className="text-base font-semibold tracking-tight" onClick={close}>
              Diana&apos;s TNBC
            </Link>
            <button
              onClick={close}
              aria-label="Close menu"
              className="p-1.5 -mr-1.5 rounded-md hover:bg-[var(--accent-light)] active:bg-[var(--accent-light)] transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="4" y1="4" x2="12" y2="12" />
                <line x1="12" y1="4" x2="4" y2="12" />
              </svg>
            </button>
          </div>

          {/* Search */}
          <div className="pt-2">
            <SearchBox />
          </div>

          {/* Nav tree */}
          <nav className="flex-1 overflow-y-auto overscroll-contain p-2 space-y-0.5">
            {tree.map((node) => (
              <TreeNode key={node.slug} node={node} />
            ))}
          </nav>
        </aside>
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden md:block w-72 shrink-0 border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] overflow-y-auto h-screen sticky top-0">
        <div className="p-4 border-b border-[var(--sidebar-border)]">
          <Link href="/" className="text-lg font-bold tracking-tight">
            Diana&apos;s TNBC
          </Link>
        </div>
        <div className="pt-2">
          <SearchBox />
        </div>
        <nav className="p-2 space-y-0.5">
          {tree.map((node) => (
            <TreeNode key={node.slug} node={node} />
          ))}
        </nav>
      </aside>
    </>
  );
}
