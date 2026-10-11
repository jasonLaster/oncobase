import { fromHtml } from "hast-util-from-html";
import { toText } from "hast-util-to-text";
import type { Element, RootContent } from "hast";
import { EducationCorpusSchema, type EducationCorpus, type EducationSection } from "./chat";

/** Use rendered headings so citations match the reader, including duplicate IDs.
 * This runs during the public-content build, never in the client bundle. */
export function buildEducationCorpus(pages: Array<{ slug: string; title: string; html: string }>, contentCommit: string): EducationCorpus {
  const sections: EducationSection[] = [];
  for (const page of pages) {
    const href = `/education/${page.slug.slice("wiki/education/".length)}/`;
    let current: EducationSection = { id: href, slug: page.slug, pageTitle: page.title, heading: "Start here", href, text: "", images: [] };
    const flush = () => { if (current.text.trim() || current.images.length) sections.push({ ...current, text: current.text.trim() }); };
    function visit(node: RootContent) {
      if (node.type === "text" && node.value.trim()) { current.text += `${node.value.trim()}\n`; return; }
      if (node.type !== "element") return;
      const element = node as Element;
      if (/^h[1-6]$/.test(element.tagName) && typeof element.properties.id === "string") {
        flush();
        const sectionHref = `${href}#${element.properties.id}`;
        current = { id: sectionHref, slug: page.slug, pageTitle: page.title, heading: toText(element), href: sectionHref, text: "", images: [] };
        return;
      }
      if (element.tagName === "img" && typeof element.properties.src === "string" && element.properties.src.startsWith("/assets/wiki/education/")) {
        const src = element.properties.src;
        const alt = String(element.properties.alt ?? "Lesson illustration");
        const light = current.images.find(image => image.src.replace(/-light(\.[^.]+)$/, "-dark$1") === src);
        if (light && light.src !== src) light.darkSrc = src;
        else if (!current.images.some(image => image.src === src)) current.images.push({ src, alt });
        return;
      }
      if (["script", "style", "svg"].includes(element.tagName)) return;
      // Traverse block containers to preserve headings and images at any depth.
      if (element.children.some(child => child.type === "element" && (/^h[1-6]$/.test(child.tagName) || ["img", "div", "section", "figure"].includes(child.tagName)))) {
        element.children.forEach(visit);
      } else {
        const text = toText(element).trim();
        if (text) current.text += `${text}\n\n`;
        const findImages = (child: RootContent) => {
          if (child.type !== "element") return;
          if (child.tagName === "img") visit(child);
          else child.children.forEach(findImages);
        };
        element.children.forEach(findImages);
      }
    }
    fromHtml(page.html, { fragment: true }).children.forEach(visit);
    flush();
  }
  return EducationCorpusSchema.parse({ version: 1, contentCommit, sections });
}
