"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Search } from "lucide-react";
import { WikiFilePalette, type WikiFilePalettePage } from "@oncobase/wiki-shell/file-palette";
import { educationHref, type GuidePage } from "../lib/routes";

const RECENT_KEY = "oncoguide-recent-pages-v1";
const MAX_RECENT = 8;

function readRecentPages(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((slug): slug is string => typeof slug === "string").slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export function EducationFilePalette({ pages, onOpenChange }: {
  pages: Pick<GuidePage, "slug" | "title">[];
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [recentSlugs] = useState(readRecentPages);
  const entries = useMemo<WikiFilePalettePage[]>(() => pages.map(page => ({
    name: page.title,
    title: page.title,
    slug: page.slug,
    path: page.slug.replace(/^wiki\/education\//, "").split("/").join(" / "),
  })), [pages]);

  return <WikiFilePalette
    open
    pages={entries}
    recentSlugs={recentSlugs}
    onOpenChange={onOpenChange}
    onSelectPage={page => {
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify([page.slug, ...recentSlugs.filter(slug => slug !== page.slug)].slice(0, MAX_RECENT)));
      } catch { /* Finding pages still works when storage is unavailable. */ }
      onOpenChange(false);
      router.push(educationHref(page.slug));
    }}
    pageIcon={<BookOpen size={16} aria-hidden="true" />}
    searchIcon={<Search size={18} aria-hidden="true" />}
    footer={<span>↑↓ to navigate · Enter to open · Esc to close</span>}
  />;
}
