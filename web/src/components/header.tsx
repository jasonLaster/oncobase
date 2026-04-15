"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ActionsMenu } from "@/components/actions-menu";
import { openCommandPalette } from "@/components/command-palette";

export function Header() {
  return (
    <Suspense>
      <HeaderInner />
    </Suspense>
  );
}

function HeaderInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const derivedQuery = pathname === "/search" ? (searchParams.get("q") || "") : "";
  const [query, setQuery] = useState(derivedQuery);
  const [prevDerived, setPrevDerived] = useState(derivedQuery);

  if (derivedQuery !== prevDerived) {
    setPrevDerived(derivedQuery);
    setQuery(derivedQuery);
  }

  return (
    <header className="shrink-0 z-30 flex items-center gap-3 border-b border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]/95 backdrop-blur-sm px-4 h-12">
      {/* Logo */}
      <Link href="/" className="text-sm font-semibold tracking-tight shrink-0">
        Diana&apos;s TNBC
      </Link>

      {/* Search bar + find files */}
      <div className="flex-1 flex justify-center">
        <div className="w-full max-w-md flex items-center gap-1.5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (query.trim()) {
                router.push(`/search?q=${encodeURIComponent(query.trim())}`);
              }
            }}
            className="flex-1 relative"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40 pointer-events-none">
              <path d="M15.25 14.19l-4.06-4.06a5.5 5.5 0 1 0-1.06 1.06l4.06 4.06a.75.75 0 1 0 1.06-1.06zM2 6.5a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0z" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="Search wiki..."
              className="w-full pl-9 pr-3 py-1.5 rounded-md border border-[var(--sidebar-border)] bg-[var(--background)] text-sm text-[var(--foreground)] placeholder:text-[var(--text-muted)] hover:border-[var(--brand)] focus:border-[var(--brand)] focus:outline-none focus:ring-1 focus:ring-[var(--brand)] transition-colors"
            />
          </form>
          <button
            onClick={openCommandPalette}
            aria-label="Find files (⌘P)"
            title="Find files (⌘P)"
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-[var(--sidebar-border)] hover:bg-[var(--accent-light)] transition-colors text-[var(--text-muted)] text-xs shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 2a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h1v4H4a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V9h4v3a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2v0a2 2 0 0 0-2-2h-1V6h1a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h0a2 2 0 0 0-2 2v1H6V4a2 2 0 0 0-2-2z" />
              <line x1="6" y1="6" x2="10" y2="6" />
              <line x1="6" y1="10" x2="10" y2="10" />
            </svg>
            <span className="hidden sm:inline">Find files</span>
          </button>
        </div>
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-1 shrink-0">
        <ActionsMenu />
      </div>
    </header>
  );
}
