"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
import { FileTextIcon } from "lucide-react";

interface PageEntry {
  name: string;
  slug: string;
  path: string;
}

// Global trigger so other components can open the palette
let globalOpen: (() => void) | null = null;
export function openCommandPalette() {
  globalOpen?.();
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [pages, setPages] = useState<PageEntry[]>([]);
  const router = useRouter();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    globalOpen = () => setOpen(true);
    return () => { globalOpen = null; };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "p" || e.key === "k")) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Fetch pages when opened
  useEffect(() => {
    if (open && pages.length === 0) {
      fetch("/api/pages")
        .then((r) => r.json())
        .then(setPages)
        .catch(() => {});
    }
  }, [open, pages.length]);

  const handleSelect = useCallback(
    (slug: string) => {
      setOpen(false);
      router.push(`/${slug}`);
    },
    [router]
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Go to page" description="Search for a page to navigate to">
      <Command>
        <CommandInput
          placeholder="Search pages..."
          onValueChange={() => {
            requestAnimationFrame(() => {
              listRef.current?.scrollTo(0, 0);
            });
          }}
        />
        <CommandList ref={listRef}>
          <CommandEmpty>No pages found.</CommandEmpty>
          <CommandGroup>
            {pages.map((page) => (
              <CommandItem
                key={page.slug}
                value={`${page.name} ${page.path}`}
                onSelect={() => handleSelect(page.slug)}
              >
                <FileTextIcon className="mr-2 size-4 shrink-0 opacity-50" />
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="truncate">{page.name}</span>
                  {page.path !== page.name && (
                    <span className="text-xs text-muted-foreground truncate">
                      {page.path}
                    </span>
                  )}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
