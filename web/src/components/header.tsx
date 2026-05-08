"use client";

import {
  Suspense,
  useEffect,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ActionsMenu } from "@/components/actions-menu";
import { openCommandPalette } from "@/components/command-palette";

function NewChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.7.7 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
      <path d="m9 11 2 2 4-4" />
    </svg>
  );
}

function NewChatButton() {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    if (pathname.startsWith("/chat")) {
      window.dispatchEvent(new CustomEvent("chat:new"));
    }
    startTransition(() => {
      router.push("/chat");
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="New chat"
      title="New chat"
      data-test-id="header-new-chat"
      data-pending={pending ? "" : undefined}
      className="flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-[var(--sidebar-border)] hover:bg-[var(--accent-light)] hover:text-[var(--foreground)] active:scale-[0.97] transition-all text-[var(--text-muted)] text-xs shrink-0 data-[pending]:opacity-60"
    >
      <NewChatIcon />
      <span className="hidden sm:inline">New chat</span>
    </button>
  );
}

export function Header() {
  return (
    <header
      className="z-30 flex h-12 shrink-0 items-center gap-3 border-b border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]/95 px-4 backdrop-blur-sm"
      data-test-id="app-header"
    >
      <Link href="/" aria-label="Home" className="shrink-0" data-test-id="header-home">
        <Logo />
      </Link>

      <div className="flex-1 flex justify-center">
        <div className="w-full max-w-xl flex items-center gap-1.5">
          <Suspense fallback={<HeaderSearchFallback />}>
            <HeaderSearch />
          </Suspense>
          <NewChatButton />
          <button
            type="button"
            onClick={openCommandPalette}
            aria-label="Find files (⌘P)"
            title="Find files (⌘P)"
            data-test-id="header-command-palette"
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-[var(--sidebar-border)] hover:bg-[var(--accent-light)] transition-colors text-[var(--text-muted)] text-xs shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
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

function subscribeHydrationSnapshot() {
  return () => {};
}

function HeaderSearch() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const hydrated = useSyncExternalStore(
    subscribeHydrationSnapshot,
    () => true,
    () => false
  );
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
      action="/search"
      method="get"
      data-test-id="header-search-form"
      data-hydrated={hydrated ? "true" : "false"}
      role="search"
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
        aria-label="Search wiki"
        data-test-id="header-search-form-input"
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
        data-test-id="header-search-fallback-input"
        className="w-full h-[30px] pl-9 pr-3 rounded-md border border-[var(--sidebar-border)] bg-[var(--background)] text-sm text-[var(--foreground)] placeholder:text-[var(--text-muted)] opacity-100 disabled:cursor-default"
      />
    </div>
  );
}
