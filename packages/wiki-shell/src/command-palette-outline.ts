export type CommandPaletteOutlineHeading = {
  key: string;
  id: string | null;
  index: number;
  level: number;
  text: string;
};

function isVisible(element: HTMLElement) {
  return element.offsetParent !== null || element.getClientRects().length > 0;
}

export function getCommandPaletteOutlineRoot(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const articles = Array.from(document.querySelectorAll<HTMLElement>("article"));
  return articles.find(isVisible) ?? null;
}

function getOutlineHeadingText(heading: HTMLHeadingElement) {
  const clone = heading.cloneNode(true) as HTMLHeadingElement;
  clone
    .querySelectorAll(
      'a[href^="#"], a[aria-hidden="true"], .anchor, .header-anchor, .hash-link, .heading-anchor',
    )
    .forEach((anchor) => anchor.remove());

  const text = clone.textContent ?? heading.textContent ?? "";
  return text
    .replace(/^#{1,6}\s*/, "")
    .replace(/(?:\s*#\s*)+$/, "")
    .trim();
}

function getCommandPaletteOutlineHeadingElements(
  root = getCommandPaletteOutlineRoot(),
): HTMLHeadingElement[] {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLHeadingElement>("h1, h2, h3, h4, h5, h6"),
  ).filter((heading) => getOutlineHeadingText(heading).length > 0);
}

export function getCommandPaletteOutlineHeadings(): CommandPaletteOutlineHeading[] {
  return getCommandPaletteOutlineHeadingElements().map((heading, index) => ({
    key: heading.id ? `id:${heading.id}` : `index:${index}`,
    id: heading.id || null,
    index,
    level: Number.parseInt(heading.tagName.slice(1), 10),
    text: getOutlineHeadingText(heading),
  }));
}

export function getCommandPaletteOutlineElement(
  item: CommandPaletteOutlineHeading,
): HTMLElement | null {
  const root = getCommandPaletteOutlineRoot();
  if (!root) return null;
  if (item.id) {
    return (
      root.querySelector<HTMLElement>(`#${CSS.escape(item.id)}`) ??
      document.getElementById(item.id)
    );
  }
  return getCommandPaletteOutlineHeadingElements(root)[item.index] ?? null;
}

function getScrollContainer(element: HTMLElement | null): HTMLElement | null {
  if (!element) return null;
  let current = element.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      current.scrollHeight > current.clientHeight
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return document.scrollingElement instanceof HTMLElement
    ? document.scrollingElement
    : document.documentElement;
}

export function scrollCommandPaletteHeadingIntoView(target: HTMLElement) {
  const scrollContainer = getScrollContainer(target);
  if (!scrollContainer) return;

  const offset = 24;
  const targetRect = target.getBoundingClientRect();

  if (
    scrollContainer === document.documentElement ||
    scrollContainer === document.body ||
    scrollContainer === document.scrollingElement
  ) {
    window.scrollTo({
      top: Math.max(0, window.scrollY + targetRect.top - offset),
      behavior: "smooth",
    });
    return;
  }

  const containerRect = scrollContainer.getBoundingClientRect();
  const nextTop =
    scrollContainer.scrollTop + targetRect.top - containerRect.top - offset;
  scrollContainer.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
}

/**
 * Observe outline-relevant mutations and call `onChange` when headings may
 * have changed. Returns a teardown function that disconnects the observer.
 */
export function observeCommandPaletteOutline(onChange: () => void): () => void {
  if (typeof MutationObserver === "undefined") return () => {};
  const root = getCommandPaletteOutlineRoot();
  if (!root) return () => {};

  const observer = new MutationObserver(onChange);
  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  return () => observer.disconnect();
}
