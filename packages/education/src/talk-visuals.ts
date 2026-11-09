import { fromHtml } from "hast-util-from-html";
import { toText } from "hast-util-to-text";
import type { Element, RootContent } from "hast";

/** A diagram or table from a lesson, ready to show during a call. Cartoons are
 * already in chat-index.json. These live in their own file because the chat
 * replay fixtures pin that index's hash and readers of chat don't need them. */
export type TalkVisual = {
  id: string; sectionId: string; slug: string; pageTitle: string; heading: string; href: string;
  kind: "diagram" | "table"; label: string; html: string;
};

/** Headings whose diagrams show progress through a guide, not a concept. */
const NAVIGATION_HEADING = /^where this step sits$/i;
const MAX_LABEL = 400;

function svgLabel(element: Element): string {
  const words: string[] = [];
  const visit = (node: RootContent | Element) => {
    if (node.type !== "element") return;
    if (node.tagName === "text") { words.push(toText(node).trim()); return; }
    if (node.tagName !== "style") node.children.forEach(visit);
  };
  visit(element);
  return words.filter(Boolean).join(" · ");
}

/** Slices come from the same rendered HTML that lessons show. Runs at content
 * build time, never in the client bundle. */
export function buildEducationVisuals(pages: Array<{ slug: string; title: string; html: string }>): TalkVisual[] {
  const visuals: TalkVisual[] = [];
  for (const page of pages) {
    const pageHref = `/education/${page.slug.slice("wiki/education/".length)}/`;
    let sectionId = pageHref;
    let heading = "Start here";
    let count = 0;
    const add = (element: Element, kind: TalkVisual["kind"], label: string) => {
      const start = element.position?.start.offset;
      const end = element.position?.end.offset;
      if (start === undefined || end === undefined || NAVIGATION_HEADING.test(heading)) return;
      // Lesson links are plain anchors that would reload the page and end a call.
      const html = page.html.slice(start, end).replace(/<a\b[^>]*>|<\/a>/g, "");
      visuals.push({
        id: `${sectionId}::${kind}-${count++}`, sectionId, slug: page.slug, pageTitle: page.title, heading, href: sectionId,
        kind, label: label.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL), html,
      });
    };
    const visit = (node: RootContent) => {
      if (node.type !== "element") return;
      if (/^h[1-6]$/.test(node.tagName) && typeof node.properties.id === "string") {
        sectionId = `${pageHref}#${node.properties.id}`;
        heading = toText(node).trim();
        return;
      }
      const classes = node.properties.className;
      if (Array.isArray(classes) && classes.includes("mermaid-diagram")) { add(node, "diagram", svgLabel(node)); return; }
      // Tables on index pages list lessons rather than explain a concept.
      if (node.tagName === "table") { if (!page.slug.endsWith("/index")) add(node, "table", toText(node)); return; }
      node.children.forEach(visit);
    };
    fromHtml(page.html, { fragment: true }).children.forEach(visit);
  }
  return visuals;
}
