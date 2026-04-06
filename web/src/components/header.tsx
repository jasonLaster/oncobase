"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { openCommandPalette } from "@/components/command-palette";
import { ThemeToggle } from "@/components/theme-toggle";

export function Header() {
  const pathname = usePathname();
  const isChat = pathname.startsWith("/chat");

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
        <button
          onClick={openCommandPalette}
          className="w-full max-w-sm flex items-center gap-2 px-3 py-1.5 rounded-md border border-[var(--sidebar-border)] bg-[var(--background)] text-xs text-[var(--text-muted)] hover:border-[var(--brand)] transition-colors cursor-pointer"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 opacity-40">
            <path d="M15.25 14.19l-4.06-4.06a5.5 5.5 0 1 0-1.06 1.06l4.06 4.06a.75.75 0 1 0 1.06-1.06zM2 6.5a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0z" />
          </svg>
          <span className="hidden sm:inline">Search...</span>
          <kbd className="hidden sm:inline ml-auto text-[10px] opacity-40 font-mono">⌘K</kbd>
        </button>
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-1 shrink-0">
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
        <ThemeToggle />
      </div>
    </header>
  );
}
