import { createHash } from "node:crypto";
import { fromHtml } from "hast-util-from-html";
import { toText } from "hast-util-to-text";
import type { Element, ElementContent, RootContent } from "hast";
import { EducationVisualCatalogSchema, type EducationLesson, type EducationVisual, type EducationVisualCatalog } from "./visuals";

/** Headings whose diagrams show progress through a guide, not a concept. */
const NAVIGATION_HEADING = /^where this step sits$/i;
/** Register pages list every cartoon again, away from the lesson that explains it. */
const REGISTER_TITLE = /illustration register/i;
const MAX_LABEL = 400;
const MAX_CAPTION = 600;
const MAX_WORDS = 500;
const MAX_BRIEF = 1200;
const MAX_ANSWER = 500;

/** The labels drawn on an SVG cartoon, in drawing order, each once. */
export function svgWords(svg: string): string {
  const seen = new Set<string>();
  for (const [, inner] of svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) {
    const words = inner!.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x?[0-9a-f]+;|&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
    if (words) seen.add(words);
  }
  return [...seen].join(" · ");
}

/** A table told as its columns and row names, which says more than its first cells. */
function tableLabel(table: Element): string {
  const rows: string[][] = [];
  const visit = (node: ElementContent) => {
    if (node.type !== "element") return;
    if (node.tagName === "tr") rows.push(node.children.filter((cell): cell is Element => cell.type === "element" && ["th", "td"].includes(cell.tagName)).map(cell => toText(cell).replace(/\s+/g, " ").trim()));
    else node.children.forEach(visit);
  };
  visit(table);
  const [header = [], ...body] = rows;
  const names = body.map(row => row[0]).filter(Boolean);
  return `Columns: ${header.join(", ")}.${names.length ? ` Rows: ${names.join(", ")}.` : ""} ${body.map(row => row.slice(1).join(" ")).join(" ")}`;
}

const startsWith = (node: ElementContent | undefined, lead: RegExp): string | null => {
  if (node?.type !== "element" || node.tagName !== "p") return null;
  const first = node.children.find(child => child.type !== "text" || child.value.trim());
  if (first?.type !== "element" || first.tagName !== "strong" || !lead.test(toText(first))) return null;
  return toText(node).replace(lead, "").replace(/\s+/g, " ").trim();
};
/** Some lessons follow a visual with their own question about it and the answer. */
function authoredQuestion(siblings: ElementContent[], index: number): { question: string; answer: string } | null {
  const next = siblings.slice(index + 1).filter(node => node.type === "element").slice(0, 5);
  const at = next.findIndex(node => startsWith(node, /^\s*Read the illustration:?\s*/i) !== null);
  if (at < 0) return null;
  const question = startsWith(next[at], /^\s*Read the illustration:?\s*/i)!;
  const answer = startsWith(next[at + 1], /^\s*Answer:?\s*/i);
  return question && answer ? { question: clean(question, MAX_CAPTION), answer: clean(answer, MAX_ANSWER) } : null;
}
const clean = (text: string, max: number) => text.replace(/\s+/g, " ").trim().slice(0, max);

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

/** Lessons caption a visual in the paragraph straight after it: italic, or
 * marked with a caption class. */
function captionAfter(siblings: ElementContent[], index: number): string {
  for (const node of siblings.slice(index + 1)) {
    if (node.type === "text" && !node.value.trim()) continue;
    if (node.type !== "element") return "";
    if (node.tagName === "img" || node.tagName === "br") continue;
    if (node.tagName === "em") return clean(toText(node), MAX_CAPTION);
    if (node.tagName !== "p") return "";
    const classes = Array.isArray(node.properties.className) ? node.properties.className : [];
    const content = node.children.filter(child => child.type !== "text" || child.value.trim());
    const first = content[0];
    // Marked as a caption, wholly italic, or opening with an italic lead rather than a stray emphasised word.
    const marked = classes.includes("cartoon-caption") || (classes.includes("text-sm") && classes.includes("text-muted-foreground"));
    const italicLead = first?.type === "element" && first.tagName === "em" && (content.length === 1 || toText(first).trim().length >= 20);
    return marked || italicLead ? clean(toText(node), MAX_CAPTION) : "";
  }
  return "";
}

/** Reads the same rendered HTML that lessons show, so every id, caption and
 * image path matches the reader. Runs at content build time, never in the
 * client bundle. Returns the catalog plus the markup files it refers to. */
export function buildEducationVisuals(pages: Array<{ slug: string; title: string; html: string }>, contentCommit: string, source: {
  /** Reads a file from the content repository by its path, or returns undefined. */
  readText?: (path: string) => string | undefined;
  lessons?: EducationLesson[];
} = {}): {
  catalog: EducationVisualCatalog; fragments: Record<string, string>;
} {
  const visuals: EducationVisual[] = [];
  const fragments: Record<string, string> = {};
  for (const page of pages) {
    if (REGISTER_TITLE.test(page.title)) continue;
    const pageHref = `/education/${page.slug.slice("wiki/education/".length)}/`;
    let sectionId = pageHref;
    let heading = "Start here";
    let counts = { diagram: 0, table: 0 };
    // The sentence that introduces a diagram or table usually says what it is for.
    let intro = "";
    const base = () => ({ sectionId, slug: page.slug, pageTitle: page.title, heading, href: sectionId, caption: "" });
    const addMarkup = (element: Element, kind: "diagram" | "table", label: string) => {
      const start = element.position?.start.offset;
      const end = element.position?.end.offset;
      if (start === undefined || end === undefined || NAVIGATION_HEADING.test(heading)) return;
      // Lesson links are plain anchors that would reload the page and end a call.
      const html = page.html.slice(start, end).replace(/<a\b[^>]*>|<\/a>/g, "");
      const fragment = `/visuals/${createHash("sha256").update(html).digest("hex").slice(0, 16)}.json`;
      fragments[fragment] = html;
      // Counted per section and kind, so a new visual elsewhere on the page keeps these ids.
      visuals.push({ ...base(), id: `${sectionId}::${kind}-${counts[kind]++}`, kind, label: clean(`${intro.endsWith(":") ? `${intro.slice(-200)} ` : ""}${label}`, MAX_LABEL), fragment });
      intro = "";
    };
    const addCartoon = (element: Element) => {
      const src = String(element.properties.src);
      const light = visuals.slice().reverse().find(visual => visual.kind === "cartoon" && visual.sectionId === sectionId && visual.src?.replace(/-light(\.[^.]+)$/, "-dark$1") === src);
      if (light && light.src !== src) { light.darkSrc = src; return; }
      const id = `${sectionId}::${src.split("/").pop()!.replace(/\.[^.]+$/, "").replace(/-(?:light|dark)$/, "")}`;
      if (visuals.some(visual => visual.id === id)) return;
      const file = src.slice("/assets/".length);
      const stem = file.split("/").pop()!.replace(/\.[^.]+$/, "").replace(/-(?:light|dark)$/, "");
      const words = file.endsWith(".svg") ? clean(svgWords(source.readText?.(file) ?? ""), MAX_WORDS) : "";
      const brief = clean(source.readText?.(`${file.split("/").slice(0, -1).join("/")}/prompts/${stem}.txt`) ?? "", MAX_BRIEF);
      visuals.push({ ...base(), id, kind: "cartoon", label: clean(String(element.properties.alt ?? "") || "Lesson illustration", MAX_LABEL), src, ...(words ? { words } : {}), ...(brief ? { brief } : {}) });
    };
    const walk = (nodes: ElementContent[]) => {
      nodes.forEach((node, index) => {
        if (node.type !== "element") return;
        if (/^h[1-6]$/.test(node.tagName) && typeof node.properties.id === "string") {
          sectionId = `${pageHref}#${node.properties.id}`;
          heading = toText(node).trim();
          counts = { diagram: 0, table: 0 };
          intro = "";
          return;
        }
        const before = visuals.length;
        const classes = node.properties.className;
        let wrapper = false;
        if (node.tagName === "img") { if (typeof node.properties.src === "string" && node.properties.src.startsWith("/assets/wiki/education/")) addCartoon(node); }
        else if (Array.isArray(classes) && classes.includes("mermaid-diagram")) addMarkup(node, "diagram", svgLabel(node));
        // Tables on index pages list lessons rather than explain a concept.
        else if (node.tagName === "table") { if (!page.slug.endsWith("/index")) addMarkup(node, "table", tableLabel(node)); }
        else if (node.tagName === "p") { intro = toText(node).replace(/\s+/g, " ").trim(); wrapper = true; walk(node.children); }
        else if (!["script", "style", "svg"].includes(node.tagName)) { wrapper = true; walk(node.children); }
        if (["ul", "ol", "pre", "blockquote", "img", "figure"].includes(node.tagName)) intro = "";
        const uncaptioned = visuals.slice(before).filter(visual => !visual.caption);
        // A wrapper passes the caption that follows it down only when it holds nothing but the visual.
        if (!uncaptioned.length || (wrapper && toText(node).trim())) return;
        const caption = captionAfter(nodes, index);
        const asked = authoredQuestion(nodes, index);
        for (const visual of uncaptioned) { visual.caption = caption; if (asked) Object.assign(visual, asked); }
      });
    };
    walk(fromHtml(page.html, { fragment: true }).children as ElementContent[]);
  }
  return { catalog: EducationVisualCatalogSchema.parse({ version: 1, contentCommit, visuals, lessons: source.lessons ?? [] }), fragments };
}
