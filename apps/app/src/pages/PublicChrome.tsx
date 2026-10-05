import { GitBranch } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PublicThemeControl } from "../PublicThemeControl";
import { OncobaseBrand } from "./LandingBrands";
import { REPO_URL } from "./features-data";

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

/** The header the public Oncobase pages share: brand, in-page links that track the current section, theme, and GitHub. */
export function PublicHeader({
  brandHref,
  brandLabel,
  navLabel,
  items,
}: {
  brandHref: string;
  brandLabel: string;
  navLabel: string;
  items: readonly (readonly [string, string])[];
}) {
  const active = useActiveSection(items.map(([id]) => id));
  const strip = useRef<HTMLElement>(null);
  // On a phone the links scroll sideways; keep the current one in view.
  useEffect(() => {
    const link = strip.current?.querySelector<HTMLElement>("[aria-current]");
    const bar = strip.current;
    if (link && bar && bar.scrollWidth > bar.clientWidth) {
      bar.scrollTo({ left: link.offsetLeft - (bar.clientWidth - link.offsetWidth) / 2, behavior: "smooth" });
    }
  }, [active]);
  return (
    <header className="lp-header-shell ft-header" data-tone="diana">
      <div className="lp-header lp-container">
        <a className="lp-brand" href={brandHref} aria-label={brandLabel}>
          <OncobaseBrand />
        </a>
        <nav aria-label={navLabel} ref={strip}>
          {items.map(([id, label]) => (
            <a aria-current={active === id ? "location" : undefined} href={`#${id}`} key={id}>
              {label}
            </a>
          ))}
        </nav>
        <div className="lp-header-actions">
          <PublicThemeControl />
          <a className="lp-button lp-button-small" href={REPO_URL} rel="noopener noreferrer" target="_blank">
            <GitBranch size={15} /> GitHub
          </a>
        </div>
      </div>
    </header>
  );
}
