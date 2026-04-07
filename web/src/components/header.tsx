"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ActionsMenu } from "@/components/actions-menu";
import { openCommandPalette } from "@/components/command-palette";

const chatEnabled =
  process.env.NEXT_PUBLIC_ENABLE_CHAT === "true"

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
  const isChat = pathname.startsWith("/chat");
  const [query, setQuery] = useState("");

  // Sync search bar with URL query param
  useEffect(() => {
    if (pathname === "/search") {
      setQuery(searchParams.get("q") || "");
    } else {
      setQuery("");
    }
  }, [pathname, searchParams]);

  function openSidebar() {
    const fn = (window as unknown as Record<string, unknown>).__openSidebar;
    if (typeof fn === "function") fn();
  }

  return (
    <header className="shrink-0 z-30 flex items-center gap-3 border-b border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]/95 backdrop-blur-sm px-4 h-12">
      {/* Menu button — mobile only */}
      <button
        onClick={openSidebar}
        aria-label="Open menu"
        className="md:hidden p-1.5 -ml-1.5 rounded-md hover:bg-[var(--accent-light)] transition-colors"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <line x1="3" y1="4.5" x2="15" y2="4.5" />
          <line x1="3" y1="9" x2="15" y2="9" />
          <line x1="3" y1="13.5" x2="15" y2="13.5" />
        </svg>
      </button>

      {/* Logo */}
      <Link href="/" className="text-sm font-semibold tracking-tight shrink-0">
        Diana&apos;s TNBC
      </Link>

      {/* Search bar — centered */}
      <div className="flex-1 flex justify-center">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) {
              router.push(`/search?q=${encodeURIComponent(query.trim())}`);
            }
          }}
          className="w-full max-w-sm relative"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40 pointer-events-none">
            <path d="M15.25 14.19l-4.06-4.06a5.5 5.5 0 1 0-1.06 1.06l4.06 4.06a.75.75 0 1 0 1.06-1.06zM2 6.5a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0z" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Search..."
            className="w-full pl-8 pr-3 py-1.5 rounded-md border border-[var(--sidebar-border)] bg-[var(--background)] text-xs text-[var(--foreground)] placeholder:text-[var(--text-muted)] hover:border-[var(--brand)] focus:border-[var(--brand)] focus:outline-none focus:ring-1 focus:ring-[var(--brand)] transition-colors"
          />
        </form>
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={openCommandPalette}
          aria-label="Find files (⌘P)"
          title="Find files (⌘P)"
          className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-[var(--accent-light)] transition-colors text-[var(--text-muted)] text-xs"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 2a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h1v4H4a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V9h4v3a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2v0a2 2 0 0 0-2-2h-1V6h1a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h0a2 2 0 0 0-2 2v1H6V4a2 2 0 0 0-2-2z" />
            <line x1="6" y1="6" x2="10" y2="6" />
            <line x1="6" y1="10" x2="10" y2="10" />
          </svg>
          <span className="hidden sm:inline">Find files</span>
        </button>
        {chatEnabled && (
          <Link
            href="/chat"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              isChat
                ? "bg-[var(--brand)] text-white"
                : "bg-[var(--brand)]/10 text-[var(--brand)] hover:bg-[var(--brand)]/20"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v7a1 1 0 01-1 1H5l-3 3V3z" />
            </svg>
            Research
          </Link>
        )}
        <ActionsMenu />
      </div>
    </header>
  );
}
