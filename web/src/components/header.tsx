"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ActionsMenu } from "@/components/actions-menu";
import { openCommandPalette } from "@/components/command-palette";

function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 3V3z" />
    </svg>
  );
}

export function Header() {
  return (
    <header className="shrink-0 z-30 flex items-center gap-3 border-b border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]/95 backdrop-blur-sm px-4 h-12">
      <Link href="/" aria-label="Home" className="shrink-0">
        <Logo />
      </Link>

      <div className="flex-1 flex justify-center">
        <div className="w-full max-w-xl flex items-center gap-1.5">
          <Suspense fallback={<HeaderSearchFallback />}>
            <HeaderSearch />
          </Suspense>
          <Link
            href="/chat"
            aria-label="New chat"
            title="New chat"
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-[var(--sidebar-border)] hover:bg-[var(--accent-light)] transition-colors text-[var(--text-muted)] text-xs shrink-0"
          >
            <ChatIcon />
            <span className="hidden sm:inline">New chat</span>
          </Link>
          <button
            type="button"
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

      <div className="flex items-center gap-1 shrink-0">
        <ActionsMenu />
      </div>
    </header>
  );
}

function Logo() {
  const isDev = process.env.NODE_ENV === "development";

  return (
    <svg width="24" height="24" viewBox="0 0 32 32" className="rounded-md">
      <rect width="32" height="32" rx="6" fill={isDev ? "#22c55e" : "#4f46e5"} />
      <text x="16" y="23" fontFamily="system-ui, -apple-system, sans-serif" fontSize="22" fontWeight="700" fill="white" textAnchor="middle">D</text>
    </svg>
  );
}

function HeaderSearch() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const derivedQuery = pathname === "/search" ? (searchParams.get("q") || "") : "";
  const [query, setQuery] = useState(derivedQuery);

  function navigateToSearch(rawQuery: string) {
    const trimmed = rawQuery.trim();
    if (trimmed) {
      router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    }
  }

  useEffect(() => {
    setQuery(derivedQuery);
  }, [derivedQuery]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        navigateToSearch(String(formData.get("q") ?? ""));
      }}
      className="flex-1 relative"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40 pointer-events-none">
        <path d="M15.25 14.19l-4.06-4.06a5.5 5.5 0 1 0-1.06 1.06l4.06 4.06a.75.75 0 1 0 1.06-1.06zM2 6.5a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0z" />
      </svg>
      <input
        name="q"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        placeholder="Search wiki..."
        className="w-full h-[30px] pl-9 pr-3 rounded-md border border-[var(--sidebar-border)] bg-[var(--background)] text-sm text-[var(--foreground)] placeholder:text-[var(--text-muted)] hover:border-[var(--brand)] focus:border-[var(--brand)] focus:outline-none focus:ring-1 focus:ring-[var(--brand)] transition-colors"
      />
    </form>
  );
}

function HeaderSearchFallback() {
  return (
    <div className="flex-1 relative">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40 pointer-events-none">
        <path d="M15.25 14.19l-4.06-4.06a5.5 5.5 0 1 0-1.06 1.06l4.06 4.06a.75.75 0 1 0 1.06-1.06zM2 6.5a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0z" />
      </svg>
      <input
        type="text"
        disabled
        placeholder="Search wiki..."
        aria-label="Search wiki"
        className="w-full h-[30px] pl-9 pr-3 rounded-md border border-[var(--sidebar-border)] bg-[var(--background)] text-sm text-[var(--foreground)] placeholder:text-[var(--text-muted)] opacity-100 disabled:cursor-default"
      />
    </div>
  );
}
