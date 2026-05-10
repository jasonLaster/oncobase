export type OutlineItem = {
  id: string;
  text: string;
  level: number;
};

export function outlineHeadingText(heading: HTMLElement) {
  return Array.from(heading.childNodes)
    .filter(
      (node) =>
        !(node instanceof HTMLElement && node.classList.contains("heading-anchor")),
    )
    .map((node) => node.textContent ?? "")
    .join("")
    .trim();
}

export function collectOutline(root: ParentNode = document) {
  const headings = root.querySelectorAll<HTMLElement>(
    '[data-test-id="document-article"] .wiki-markdown h1, [data-test-id="document-article"] .wiki-markdown h2, [data-test-id="document-article"] .wiki-markdown h3, [data-test-id="document-article"] .wiki-markdown h4',
  );

  return Array.from(headings)
    .map((heading) => ({
      id: heading.id,
      text: outlineHeadingText(heading),
      level: Number(heading.tagName.replace("H", "")),
    }))
    .filter((item) => item.id && item.text);
}

export function scrollToOutlineItem(
  item: OutlineItem,
  pathname = window.location.pathname,
) {
  const heading = document.getElementById(item.id);
  window.history.replaceState(null, "", `${pathname}#${item.id}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  heading?.scrollIntoView({ block: "start", behavior: "smooth" });
}
