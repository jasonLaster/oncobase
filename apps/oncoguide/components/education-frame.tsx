"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, BookOpen, ChevronDown, Menu, MessageCircle, Search, X } from "lucide-react";
import { TopicLogo } from "@oncobase/education/topic-logo";
import { PublicThemeControl } from "@oncobase/education/theme-control";
import { EducationFilePalette } from "./file-palette";
import { educationHref, type GuidePage } from "../lib/routes";

type NavPage = Pick<GuidePage, "slug" | "title">;
type Topic = { key: string; title: string; pages: NavPage[] };
export function EducationFrame({ topics, children }: { topics: Topic[]; children: ReactNode }) {
  const pathname = usePathname();
  const activePath = pathname.replace(/^\/wiki\/education/, "/education").replace(/\/$/, "");
  const isActive = (page: NavPage) => activePath === educationHref(page.slug) || (page.slug.endsWith("/index") && activePath === educationHref(page.slug).slice(0, -6));
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    const togglePalette = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.isComposing && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (event.repeat) return;
        setMenuOpen(false);
        setPaletteOpen(open => !open);
      }
    };
    window.addEventListener("keydown", togglePalette);
    return () => window.removeEventListener("keydown", togglePalette);
  }, []);
  useEffect(() => { if (!window.location.hash) main.current?.scrollTo(0, 0); }, [pathname]);
  return <div className="education-app">
    <a className="edu-skip" href="#education-main">Skip to lesson</a>
    <header className="edu-header">
      <Link href="/" className="edu-brand"><BookOpen size={25} aria-hidden="true" /><span>OncoGuide<span className="edu-brand-section">education</span></span></Link>
      <form className="edu-search" role="search" action="/education/search/">
        <Search size={17} aria-hidden="true" />
        <input type="search" name="q" aria-label="Search education" placeholder="Search education…" />
        <button className="edu-palette-trigger" type="button" aria-label="Find pages" aria-haspopup="dialog" aria-expanded={paletteOpen} aria-keyshortcuts="Meta+K Control+K" title="Find pages (⌘K / Ctrl+K)" onClick={() => { setMenuOpen(false); setPaletteOpen(true); }}><kbd>⌘K</kbd></button>
        <button type="submit" aria-label="Submit education search"><ArrowRight size={17} /></button>
      </form>
      <PublicThemeControl />
      <a className="edu-wiki-link" href="https://diana-tnbc.com/">Diana’s wiki <ArrowRight size={14} /></a>
      <button className="edu-menu-toggle" aria-label={menuOpen ? "Close education navigation" : "Open education navigation"} aria-expanded={menuOpen} aria-controls="education-navigation" onClick={() => setMenuOpen(open => !open)}>{menuOpen ? <X size={22} /> : <Menu size={22} />}</button>
    </header>
    <div className="edu-layout">
      <aside id="education-navigation" className={`edu-sidebar${menuOpen ? " edu-sidebar-open" : ""}`}>
        <nav aria-label="Education navigation" onClick={event => { if ((event.target as HTMLElement).closest("a")) setMenuOpen(false); }}>
          <Link href="/" className="edu-all-topics" aria-current={pathname === "/" || pathname === "/education/" ? "page" : undefined}><BookOpen size={16} />All topics</Link>
          <Link href="/education/chat/" className="edu-all-topics edu-ask-link" aria-current={pathname.startsWith("/education/chat") ? "page" : undefined}><MessageCircle size={16} />Ask OncoGuide</Link>
          <div className="edu-sidebar-label">THE CURRICULUM</div>
          {topics.map(topic => <details key={topic.key} open={topic.pages.some(isActive)}>
            <summary><span className="edu-topic-label"><TopicLogo topic={topic.key} size={14.4} /><span>{topic.title}</span></span><ChevronDown size={14} aria-hidden="true" /></summary>
            <div className="edu-nav-lessons">{topic.pages.map(page => <Link key={page.slug} href={educationHref(page.slug)} prefetch={false} aria-current={isActive(page) ? "page" : undefined}>{page.title}</Link>)}</div>
          </details>)}
        </nav>
        <div className="edu-sidebar-footer">Open lessons in cancer science.<br /><a href="https://github.com/jasonLaster/oncoguide">Explore the content on GitHub</a></div>
      </aside>
      <main id="education-main" ref={main} className="edu-main" tabIndex={-1}>{children}</main>
    </div>
    {paletteOpen ? <EducationFilePalette pages={topics.flatMap(topic => topic.pages)} onOpenChange={setPaletteOpen} /> : null}
  </div>;
}
