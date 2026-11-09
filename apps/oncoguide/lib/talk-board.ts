import { searchEducation, type EducationCorpus, type EducationSection } from "@oncobase/education/chat";
import { normalizeEducationPath } from "@oncobase/education/talk";
import type { TalkVisual } from "@oncobase/education/talk-visuals";
import type { BoardCard, BoardSource } from "./talk-store";

/** What a call can put on the board beside the conversation. The board gets its
 * own text-only Realtime request after each spoken reply, so choosing a card
 * never delays the voice or makes it speak twice. */
const sourceId = { type: "string", description: "The id of a retrieved section that supports this card." };
const shortList = (description: string, maxItems: number) => ({ type: "array", items: { type: "string" }, minItems: 1, maxItems, description });
export const BOARD_TOOLS = [
  { type: "function", name: "show_visual", description: "Show a real cartoon, diagram or table from the lessons.",
    parameters: { type: "object", properties: { visual_id: { type: "string", description: "An id from CANDIDATE VISUALS, exactly as listed." } }, required: ["visual_id"], additionalProperties: false } },
  { type: "function", name: "show_key_points", description: "Show up to four short takeaways, as fragments rather than sentences.",
    parameters: { type: "object", properties: { title: { type: "string" }, points: shortList("Each under 12 words.", 4), source_section_id: sourceId }, required: ["title", "points", "source_section_id"], additionalProperties: false } },
  { type: "function", name: "show_steps", description: "Show a process as up to five ordered steps.",
    parameters: { type: "object", properties: { title: { type: "string" }, steps: shortList("Each under 10 words.", 5), source_section_id: sourceId }, required: ["title", "steps", "source_section_id"], additionalProperties: false } },
  { type: "function", name: "show_comparison", description: "Compare two or three things across up to four attributes.",
    parameters: { type: "object", properties: {
      title: { type: "string" }, columns: shortList("The attribute label first, then the things being compared.", 4),
      rows: { type: "array", maxItems: 4, items: shortList("One cell per column, each under 8 words.", 4) }, source_section_id: sourceId,
    }, required: ["title", "columns", "rows", "source_section_id"], additionalProperties: false } },
  { type: "function", name: "no_update", description: "Add nothing, because nothing would help the reader right now.",
    parameters: { type: "object", properties: {}, additionalProperties: false } },
] as const;

export const boardInstructions = ({ candidates, retrieved, onBoard, visualShowing }: {
  candidates: string[]; retrieved: string[]; onBoard: string[]; visualShowing: boolean;
}) => `You keep a visual board beside a live voice conversation about cancer science. The reader listens and sees the board. There is no transcript, so the board must help them follow along, not repeat what was said.
Look at what was just discussed and call the tools that would help most, at most two.
${visualShowing
    ? "A real visual for this topic is already showing. Add a written card only if it gives the reader something the visual doesn't: steps for a process, a comparison for a contrast, key points for several separate ideas."
    : "Nothing on the board illustrates this topic yet, so add something unless this is small talk. Use a candidate visual if one directly illustrates the concept, otherwise a written card: steps for a process, a comparison for a contrast, key points for several separate ideas."}
Write fragments, never full sentences or a copy of the spoken answer. Use only facts from the retrieved lesson text and cite the section you used. Call no_update only for small talk or if the topic is already covered on the board.

ALREADY ON THE BOARD
${onBoard.join("\n") || "Nothing yet."}

CANDIDATE VISUALS
${candidates.join("\n") || "None."}

RETRIEVED SECTION IDS
${retrieved.join("\n") || "None."}`;

export const boardRequest = (instructions: string) => ({
  type: "response.create",
  response: { conversation: "none", metadata: { talk_purpose: "board" }, output_modalities: ["text"], instructions, tools: BOARD_TOOLS, tool_choice: "required", max_output_tokens: 500 },
});

export const sourceOf = (section: EducationSection): BoardSource => ({ sectionId: section.id, href: section.href, pageTitle: section.pageTitle });

type AnyVisual = Pick<TalkVisual, "id" | "sectionId" | "pageTitle" | "heading" | "label"> & { kind: "image" | TalkVisual["kind"] };

/** Lesson visuals in one list: cartoons from the corpus plus the visuals file. */
export function allVisuals(corpus: EducationCorpus, visuals: TalkVisual[]): AnyVisual[] {
  const images = corpus.sections.flatMap(section => section.images.map(image => ({
    id: image.src, kind: "image" as const, sectionId: section.id, pageTitle: section.pageTitle, heading: section.heading, label: image.alt,
  })));
  return [...images, ...visuals];
}

/** The lesson's own visual for a section the model chose to read: its cartoon
 * or diagram first, then the rest of the page. A table counts only if it sits in
 * that section, since a table elsewhere on the page is often about something else. */
export function bestPageVisual(visuals: AnyVisual[], section: EducationSection, exclude: Set<string>): AnyVisual | undefined {
  const page = normalizeEducationPath(section.id);
  const rank = (visual: AnyVisual) => (visual.sectionId === section.id ? 0 : 4) + (visual.kind === "image" ? 0 : visual.kind === "diagram" ? 1 : 2) - (/^how it works/i.test(visual.heading) ? 1 : 0);
  return visuals
    .filter(visual => !exclude.has(visual.id) && normalizeEducationPath(visual.sectionId) === page && (visual.kind !== "table" || visual.sectionId === section.id))
    .sort((a, b) => rank(a) - rank(b))[0];
}

/** Visuals from the pages just retrieved come first, then the best matches for
 * what was asked. The model picks among these by their text descriptions. */
export function visualCandidates({ visuals, query, sectionIds, exclude, limit = 8 }: {
  visuals: AnyVisual[]; query: string; sectionIds: string[]; exclude: Set<string>; limit?: number;
}): AnyVisual[] {
  const fresh = visuals.filter(visual => !exclude.has(visual.id));
  const order = { image: 0, diagram: 1, table: 2 };
  const direct = [...new Set(sectionIds.map(normalizeEducationPath))].flatMap(page =>
    fresh.filter(visual => normalizeEducationPath(visual.sectionId) === page).sort((a, b) => order[a.kind] - order[b.kind]));
  const documents: EducationSection[] = fresh.map(visual => ({
    id: visual.id, slug: `wiki/education/${visual.sectionId.replace(/[^a-zA-Z0-9_/-]/g, "-")}`, pageTitle: visual.pageTitle, heading: visual.heading,
    href: "/education/", text: visual.label, images: [],
  }));
  const ranked = searchEducation(documents, query, limit).map(document => fresh.find(visual => visual.id === document.id)!);
  return [...new Map([...direct, ...ranked].map(visual => [visual.id, visual])).values()].slice(0, limit);
}

export const describeVisual = (visual: AnyVisual) =>
  `${visual.id} | ${visual.kind === "image" ? "cartoon" : visual.kind} in "${visual.pageTitle}", section "${visual.heading}": ${visual.label}`;

const text = (value: unknown, max: number) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
const list = (value: unknown, maxItems: number, maxText: number) => Array.isArray(value) ? value.map(item => text(item, maxText)).filter(Boolean).slice(0, maxItems) : [];

/** Turns a board tool call into a card, or null if it isn't grounded. Visuals
 * must exist in the library. Written cards must cite a section retrieved during
 * this call, so a card always links back to text the model actually received. */
export function cardFromTool(name: string, args: Record<string, unknown>, context: {
  corpus: EducationCorpus; visuals: TalkVisual[]; retrieved: Set<string>;
}): BoardCard | null {
  const section = (id: unknown) => context.corpus.sections.find(candidate => candidate.id === id);
  if (name === "show_visual") {
    const id = args.visual_id;
    const lesson = context.visuals.find(visual => visual.id === id);
    if (lesson) {
      const source = section(lesson.sectionId);
      return source ? { id: lesson.id, kind: lesson.kind, html: lesson.html, caption: lesson.heading, source: sourceOf(source) } : null;
    }
    for (const candidate of context.corpus.sections) {
      const image = candidate.images.find(item => item.src === id);
      if (image) return { id: image.src, kind: "image", src: image.src, darkSrc: image.darkSrc, caption: image.alt, source: sourceOf(candidate) };
    }
    return null;
  }
  if (!context.retrieved.has(String(args.source_section_id))) return null;
  const source = section(args.source_section_id);
  const title = text(args.title, 80);
  if (!source || !title) return null;
  const base = { id: `${name}:${title}`, title, source: sourceOf(source) };
  if (name === "show_key_points") {
    const points = list(args.points, 4, 120);
    return points.length ? { ...base, kind: "key_points", points } : null;
  }
  if (name === "show_steps") {
    const steps = list(args.steps, 5, 100);
    return steps.length >= 2 ? { ...base, kind: "steps", steps } : null;
  }
  if (name === "show_comparison") {
    const columns = list(args.columns, 4, 40);
    const rows = Array.isArray(args.rows) ? args.rows.slice(0, 4).map(row => list(row, columns.length, 70)).filter(row => row.length === columns.length) : [];
    return columns.length >= 2 && rows.length ? { ...base, kind: "comparison", columns, rows } : null;
  }
  return null;
}
