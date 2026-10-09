"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, BookOpen, ChevronDown, Menu, Search, X } from "lucide-react";
import { PublicThemeControl } from "@oncobase/education/theme-control";
import { educationHref, type GuidePage } from "../lib/routes";

type NavPage = Pick<GuidePage, "slug" | "title">;
type Topic = { key: string; title: string; pages: NavPage[] };
export function EducationFrame({ topics, children }: { topics: Topic[]; children: ReactNode }) {
  const pathname = usePathname();
  const activePath = pathname.replace(/^\/wiki\/education/, "/education").replace(/\/$/, "");
  const isActive = (page: NavPage) => activePath === educationHref(page.slug) || (page.slug.endsWith("/index") && activePath === educationHref(page.slug).slice(0, -6));
  const [menuOpen, setMenuOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); input.current?.focus();
      }
    };
    window.addEventListener("keydown", focus);
    return () => window.removeEventListener("keydown", focus);
  }, []);
  useEffect(() => { if (!window.location.hash) main.current?.scrollTo(0, 0); }, [pathname]);
  return <div className="education-app">
    <a className="edu-skip" href="#education-main">Skip to lesson</a>
    <header className="edu-header">
      <Link href="/" className="edu-brand"><BookOpen size={25} aria-hidden="true" /><span>OncoGuide<span className="edu-brand-section">education</span></span></Link>
      <form className="edu-search" role="search" action="/education/search/">
        <Search size={17} aria-hidden="true" />
        <input ref={input} type="search" name="q" aria-label="Search education" placeholder="Search education…" />
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
          <div className="edu-sidebar-label">THE CURRICULUM</div>
          {topics.map(topic => <details key={topic.key} open={topic.pages.some(isActive)}>
            <summary>{topic.title}<ChevronDown size={14} aria-hidden="true" /></summary>
            <div className="edu-nav-lessons">{topic.pages.map(page => <Link key={page.slug} href={educationHref(page.slug)} prefetch={false} aria-current={isActive(page) ? "page" : undefined}>{page.title}</Link>)}</div>
          </details>)}
        </nav>
        <div className="edu-sidebar-footer">Open lessons in cancer science.<br /><a href="https://github.com/jasonLaster/oncoguide">Explore the content on GitHub</a></div>
      </aside>
      <main id="education-main" ref={main} className="edu-main" tabIndex={-1}>{children}</main>
    </div>
  </div>;
}
