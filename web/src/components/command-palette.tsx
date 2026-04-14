"use client";

import { useEffect, useState, useCallback, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { FileTextIcon, Loader2Icon } from "lucide-react";
import { themeEffect } from "@/lib/theme-effect";

interface PageEntry {
  name: string;
  slug: string;
  path: string;
}

// ─── Theme store ──────────────────────────────────────────────────────────────

let themeListeners: Array<() => void> = [];
function subscribeTheme(cb: () => void) {
  themeListeners.push(cb);
  return () => { themeListeners = themeListeners.filter((l) => l !== cb); };
}
function notifyTheme() { themeListeners.forEach((l) => l()); }
function getThemePref() { return localStorage.getItem("theme"); }
function getThemePrefServer() { return null; }

// ─── Icons ────────────────────────────────────────────────────────────────────

const SunIcon = () => (
  <svg width="14" height="14" viewBox="0 0 56 56" fill="currentColor" className="shrink-0">
    <path d="M30 4.6c0-1-.9-2-2-2a2 2 0 00-2 2v5c0 1 .9 2 2 2s2-1 2-2zm9.6 9a2 2 0 000 2.8c.8.8 2 .8 2.9 0L46 13a2 2 0 000-2.9 2 2 0 00-3 0zm-26 2.8c.7.8 2 .8 2.8 0 .8-.7.8-2 0-2.9L13 10c-.7-.7-2-.8-2.9 0-.7.8-.7 2.1 0 3zM28 16a12 12 0 00-12 12 12 12 0 0012 12 12 12 0 0012-12 12 12 0 00-12-12zm0 3.6c4.6 0 8.4 3.8 8.4 8.4 0 4.6-3.8 8.4-8.4 8.4a8.5 8.5 0 01-8.4-8.4c0-4.6 3.8-8.4 8.4-8.4zM51.3 30c1.1 0 2-.9 2-2s-.9-2-2-2h-4.9a2 2 0 00-2 2c0 1.1 1 2 2 2zM4.7 26a2 2 0 00-2 2c0 1.1.9 2 2 2h4.9c1 0 2-.9 2-2s-1-2-2-2zm37.8 13.6a2 2 0 00-3 0 2 2 0 000 2.9l3.6 3.5a2 2 0 002.9 0c.8-.8.8-2.1 0-3zM10 43.1a2 2 0 000 2.9c.8.7 2.1.8 3 0l3.4-3.5c.8-.8.8-2.1 0-2.9-.8-.8-2-.8-2.9 0zm20 3.4c0-1.1-.9-2-2-2a2 2 0 00-2 2v4.9c0 1 .9 2 2 2s2-1 2-2z" />
  </svg>
);
const MoonIcon = () => (
  <svg width="14" height="14" viewBox="0 0 56 56" fill="currentColor" className="shrink-0">
    <path d="M41.2 36.1c-12.9 0-21-7.8-21-20.3 0-3.5.7-6.7 1.6-8.3.3-.7.4-1 .4-1.5 0-.8-.7-1.7-1.7-1.7-.2 0-.7 0-1.3.3A24.5 24.5 0 004.4 27.1 23.8 23.8 0 0029 51.7c10.2 0 18.4-5.3 22.3-14.1l.3-1.4c0-1-.9-1.6-1.6-1.6a3 3 0 00-1.2.2c-2 .8-4.8 1.3-7.6 1.3zM8.1 27c0-7.3 3.8-14.3 9.9-18-.8 2-1.2 4.5-1.2 7.2 0 14.6 9 23.3 23.9 23.3 2.4 0 4.5-.2 6.4-1a20.8 20.8 0 01-18 9.6C17 48 8.1 39 8.1 27z" />
  </svg>
);
const MonitorIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
    <rect x="1" y="2" width="14" height="10" rx="1.5" />
    <path d="M5 14h6M8 12v2" />
  </svg>
);
const DownloadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
    <path d="M8 2v9m0 0L5 8m3 3l3-3" />
    <path d="M2 12v1.5a.5.5 0 00.5.5h11a.5.5 0 00.5-.5V12" />
  </svg>
);
const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
    <circle cx="6.5" cy="6.5" r="4" />
    <path d="M11 11l3 3" />
  </svg>
);

// ─── File palette (Cmd+K) ─────────────────────────────────────────────────────

let globalOpenFiles: (() => void) | null = null;
export function openCommandPalette() {
  globalOpenFiles?.();
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [pages, setPages] = useState<PageEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    globalOpenFiles = () => setOpen(true);
    return () => { globalOpenFiles = null; };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === "k" || e.key === "o")) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open && pages.length === 0) {
      setLoading(true);
      fetch("/api/pages")
        .then((r) => r.json())
        .then(setPages)
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [open, pages.length]);

  const handleSelect = useCallback(
    (slug: string) => {
      setOpen(false);
      router.push(`/${slug}`);
    },
    [router]
  );

  // Group pages by their top-level parent directory.
  // slug format: "wiki/research/paper-catalog" → group "research"
  // Top-level files (no parent dir) go into "" group rendered last.
  const grouped = useCallback((): [string, PageEntry[]][] => {
    const map = new Map<string, PageEntry[]>();
    for (const page of pages) {
      const parts = page.slug.split("/");
      // Use second segment if available (e.g. "research" from "wiki/research/foo"),
      // otherwise the first segment, otherwise "".
      const group = parts.length >= 3 ? parts[1] : parts.length === 2 ? parts[0] : "";
      if (!map.has(group)) map.set(group, []);
      map.get(group)!.push(page);
    }
    // Sort: named groups first (alphabetically), then the catch-all ""
    return [...map.entries()].sort(([a], [b]) => {
      if (a === "") return 1;
      if (b === "") return -1;
      return a.localeCompare(b);
    });
  }, [pages]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Go to page" description="Search pages">
      <Command>
        <CommandInput
          placeholder="Search pages…"
          onValueChange={() => {
            requestAnimationFrame(() => listRef.current?.scrollTo(0, 0));
          }}
        />
        <CommandList ref={listRef}>
          {loading ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin mr-2" />
              <span className="text-sm">Loading pages…</span>
            </div>
          ) : (
            <>
              <CommandEmpty>No pages found.</CommandEmpty>
              {grouped().map(([group, entries]) => (
                <CommandGroup
                  key={group || "__root__"}
                  heading={group ? group.replace(/-/g, " ") : undefined}
                >
                  {entries.map((page) => (
                    <CommandItem
                      key={page.slug}
                      value={`${page.name} ${page.path} ${group}`}
                      onSelect={() => handleSelect(page.slug)}
                    >
                      <FileTextIcon className="mr-2 size-4 shrink-0 opacity-50" />
                      <span className="truncate">{page.name.replace(/-/g, " ")}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

// ─── Action palette (Cmd+Shift+P) ────────────────────────────────────────────

export function ActionPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const preference = useSyncExternalStore(subscribeTheme, getThemePref, getThemePrefServer);
  const currentTheme = useSyncExternalStore(
    useCallback((cb: () => void) => {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    }, []),
    () => themeEffect(),
    () => "light",
  );

  const themeLabel = preference === null ? "System" : preference === "dark" ? "Dark" : "Light";

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "K") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function cycleTheme() {
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    let newPref: string | null;
    if (preference === null) {
      newPref = systemTheme === "dark" ? "light" : "dark";
    } else if (preference === "dark") {
      newPref = "light";
    } else {
      newPref = null;
    }
    newPref === null ? localStorage.removeItem("theme") : localStorage.setItem("theme", newPref);
    notifyTheme();
    setOpen(false);
  }

  function useSystemTheme() {
    localStorage.removeItem("theme");
    notifyTheme();
    setOpen(false);
  }

  function download(type: "full" | "markdown") {
    setOpen(false);
    window.location.href = `/api/download?type=${type}`;
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Commands" description="Run an action">
      <Command>
        <CommandInput placeholder="Search commands…" />
        <CommandList>
          <CommandEmpty>No commands found.</CommandEmpty>
          <CommandGroup heading="Theme">
            <CommandItem
              value={`theme toggle ${currentTheme === "dark" ? "light" : "dark"}`}
              onSelect={cycleTheme}
            >
              {currentTheme === "dark" ? <SunIcon /> : <MoonIcon />}
              <span className="ml-2">
                Switch to {currentTheme === "dark" ? "Light" : "Dark"} theme
              </span>
              <span className="ml-auto text-xs text-muted-foreground">Current: {themeLabel}</span>
            </CommandItem>
            <CommandItem value="theme system auto" onSelect={useSystemTheme}>
              <MonitorIcon />
              <span className="ml-2">Use system theme</span>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Download">
            <CommandItem value="download wiki full zip archive" onSelect={() => download("full")}>
              <DownloadIcon />
              <span className="ml-2">Download wiki — full zip</span>
            </CommandItem>
            <CommandItem value="download wiki markdown md files" onSelect={() => download("markdown")}>
              <DownloadIcon />
              <span className="ml-2">Download wiki — markdown only</span>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Navigate">
            <CommandItem value="search full text" onSelect={() => { setOpen(false); router.push("/search"); }}>
              <SearchIcon />
              <span className="ml-2">Open search</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
