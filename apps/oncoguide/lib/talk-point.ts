/** During a call on a lesson page, the page itself is the board: scroll to the
 * section the voice is reading and mark its first picture, diagram or table.
 * Works from the page's own headings, so it needs no catalog download. */
const POINTED = "edu-talk-pointed";
let clear: ReturnType<typeof setTimeout> | undefined;

export function pointAtSection(href: string): "visual" | "section" | null {
  const id = decodeURIComponent(href.split("#")[1] ?? "");
  const article = document.querySelector('[data-test-id="education-article"]');
  const heading = id ? document.getElementById(id) : null;
  if (!article || !heading || !article.contains(heading)) return null;
  // The visual belongs to this section only if it comes before the next heading.
  let visual: Element | null = null;
  for (let node = heading.nextElementSibling; node && !/^H[1-6]$/.test(node.tagName); node = node.nextElementSibling) {
    visual = node.matches("img, table, .mermaid-diagram") ? node : node.querySelector("img, table, .mermaid-diagram");
    if (visual instanceof HTMLImageElement && visual.offsetParent === null) visual = visual.parentElement?.querySelector<HTMLImageElement>("img:not([hidden])") ?? visual;
    if (visual) break;
  }
  document.querySelectorAll(`.${POINTED}`).forEach(element => element.classList.remove(POINTED));
  const target = visual?.closest("figure, .cartoon-frame, .mermaid-diagram, table") ?? visual ?? heading;
  target.classList.add(POINTED);
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  (visual ? target : heading).scrollIntoView({ behavior: calm ? "auto" : "smooth", block: visual ? "center" : "start" });
  clearTimeout(clear);
  clear = setTimeout(() => target.classList.remove(POINTED), 12_000);
  return visual ? "visual" : "section";
}
