import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router";
import {
  collectOutline,
  scrollToOutlineItem,
  type OutlineItem,
} from "../shell/outline";

function usePageOutline(contentKey: string) {
  const [items, setItems] = useState<OutlineItem[]>([]);
  const [activeId, setActiveId] = useState(() => window.location.hash.replace(/^#/, ""));

  useEffect(() => {
    const update = () => setItems(collectOutline());
    update();

    const article = document.querySelector('[data-test-id="document-article"]');
    const observer = new MutationObserver(update);
    if (article) observer.observe(article, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [contentKey]);

  useEffect(() => {
    const onHashChange = () => setActiveId(window.location.hash.replace(/^#/, ""));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const headings = items
      .map((item) => document.getElementById(item.id))
      .filter((heading): heading is HTMLElement => Boolean(heading));
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top);
        const next = visible[0]?.target.id;
        if (next) setActiveId(next);
      },
      {
        root: document.querySelector(".content-shell"),
        rootMargin: "-15% 0px -70% 0px",
        threshold: [0, 1],
      },
    );

    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [items]);

  return useMemo(() => ({ activeId, items }), [activeId, items]);
}

export function PageOutline({ contentKey }: { contentKey: string }) {
  const location = useLocation();
  const { activeId, items } = usePageOutline(contentKey);

  if (items.length === 0) return null;

  return (
    <aside className="page-outline" data-test-id="page-outline" aria-label="Page outline">
      <div className="page-outline-title">Outline</div>
      <nav>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={activeId === item.id ? "active" : ""}
            style={
              {
                "--outline-depth": Math.max(0, item.level - 1),
              } as CSSProperties
            }
            onClick={() => scrollToOutlineItem(item, location.pathname)}
          >
            {item.text}
          </button>
        ))}
      </nav>
    </aside>
  );
}
