import { ArrowRight, GitBranch } from "lucide-react";
import { useEffect, useRef, useState, type Ref } from "react";
import { PublicThemeControl } from "../PublicThemeControl";
import { DianaBrand, OncobaseBrand } from "./LandingBrands";
import { REPO_URL } from "./site";
import "./public-header.css";

/** The id of the section nearest the top of the screen, for the header. */
export function useActiveSection(ids: readonly string[]) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      let current: string | null = null;
      for (const id of ids) {
        const element = document.getElementById(id);
        if (element && element.getBoundingClientRect().top <= window.innerHeight * 0.35) current = id;
      }
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ids]);
  return active;
}

export type PublicPage = "features" | "compare";

/** oncobase.io's primary row. It never changes between that site's pages. */
const primaryPages: { id: PublicPage; href: string; label: string }[] = [
  { id: "features", href: "/features", label: "Features" },
  { id: "compare", href: "/compare", label: "Compare" },
];

/**
 * The header the public pages share, with one branding per site.
 *
 * - Oncobase (oncobase.io) has two rows. The primary row (brand, Features, Compare, theme, GitHub) is the
 *   same on every page; the sub header below it lists the sections of the current page and tracks the one
 *   in view. On phones the primary links join the sub header's single scrolling row, pinned at its left
 *   edge, so the header stays two rows tall.
 * - Diana's knowledge base is its own brand and has one row: the brand, the sections of the page
 *   (tracking the one in view), the theme toggle, and Sign in. It carries no Oncobase links up top. The
 *   sections hide on narrow screens, where the page is short enough to scroll.
 */
export function PublicHeader({
  ref,
  brand = "oncobase",
  action = "github",
  tone = "diana",
  current,
  navLabel,
  items,
}: {
  ref?: Ref<HTMLElement>;
  /** Diana's knowledge base (the landing page) or Oncobase (features and compare). */
  brand?: "diana" | "oncobase";
  action?: "github" | "sign-in";
  /** The landing page tints the header while the Oncobase band is under it. */
  tone?: "diana" | "oncobase";
  current?: PublicPage;
  navLabel: string;
  items: readonly (readonly [string, string])[];
}) {
  const active = useActiveSection(items.map(([id]) => id));
  const strip = useRef<HTMLElement>(null);
  // On a phone the links scroll sideways; keep the current one in view.
  useEffect(() => {
    const link = strip.current?.querySelector<HTMLElement>("[aria-current='location']");
    const bar = strip.current;
    if (link && bar && bar.scrollWidth > bar.clientWidth) {
      // On phones the primary links are pinned at the left; center the section in what is left.
      const pinned = bar.querySelector<HTMLElement>(".ft-sub-pages")?.offsetWidth ?? 0;
      bar.scrollTo({ left: link.offsetLeft - pinned - (bar.clientWidth - pinned - link.offsetWidth) / 2, behavior: "smooth" });
    }
  }, [active]);
  const actions = (
    <div className="lp-header-actions">
      <PublicThemeControl />
      {action === "sign-in" ? (
        <a className="lp-button lp-button-small" href="/sign-in">
          Sign in <ArrowRight size={15} />
        </a>
      ) : (
        <a className="lp-button lp-button-small" href={REPO_URL} rel="noopener noreferrer" target="_blank">
          <GitBranch size={15} /> GitHub
        </a>
      )}
    </div>
  );
  if (brand === "diana") {
    return (
      <header className="lp-header-shell ft-header" data-tone={tone} ref={ref}>
        <div className="ft-primary ft-single lp-container">
          <a className="lp-brand" href="/" aria-label="Diana TNBC home">
            <DianaBrand />
          </a>
          <nav aria-label={navLabel} className="ft-section-nav">
            {items.map(([id, label]) => (
              <a aria-current={active === id ? "location" : undefined} href={`#${id}`} key={id}>
                {label}
              </a>
            ))}
          </nav>
          {actions}
        </div>
      </header>
    );
  }
  return (
    <header className="lp-header-shell ft-header" data-tone={tone} ref={ref}>
      <div className="ft-primary lp-container">
        <a className="lp-brand" href="/" aria-label="Oncobase home">
          <OncobaseBrand />
        </a>
        <nav aria-label="Main navigation" className="ft-primary-nav">
          {primaryPages.map(({ id, href, label }) => (
            <a aria-current={current === id ? "page" : undefined} href={href} key={id}>
              {label}
            </a>
          ))}
        </nav>
        {actions}
      </div>
      <div className="ft-subheader">
        <nav aria-label={navLabel} className="lp-container" ref={strip}>
          <span className="ft-sub-pages">
            {primaryPages.map(({ id, href, label }) => (
              <a aria-current={current === id ? "page" : undefined} href={href} key={id}>
                {label}
              </a>
            ))}
          </span>
          {items.map(([id, label]) => (
            <a aria-current={active === id ? "location" : undefined} href={`#${id}`} key={id}>
              {label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
