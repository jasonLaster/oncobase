import { z } from "zod";
import { localPath, queryTerms, searchTokens, type LessonNames } from "./chat";

/** One catalog of what lessons show: cartoons, diagrams and tables. Typed chat
 * and Talk both choose from it by id, so neither can invent a picture. Diagram
 * and table markup lives in its own small file, fetched only when shown. */
export const EducationVisualSchema = z.object({
  id: z.string().max(500), kind: z.enum(["cartoon", "diagram", "table"]),
  sectionId: z.string(), slug: z.string().regex(/^wiki\/education\/[a-zA-Z0-9_/-]+$/),
  pageTitle: z.string(), heading: z.string(), href: localPath("/education/"),
  /** What the visual contains, for search and for the model: alt text, the
   * diagram's node labels, or the table's cells. */
  label: z.string(),
  /** The lesson's own caption under the visual, when it has one. */
  caption: z.string(),
  /** The words drawn on a cartoon, read from its SVG. */
  words: z.string().optional(),
  /** The brief the cartoon was drawn from. For search only: it states intent, not the final picture. */
  brief: z.string().optional(),
  /** A question the lesson itself asks about this visual, with its answer. */
  question: z.string().optional(), answer: z.string().optional(),
  src: localPath("/assets/wiki/education/").optional(), darkSrc: localPath("/assets/wiki/education/").optional(),
  fragment: z.string().regex(/^\/visuals\/[a-f0-9]{16}\.json$/).optional(),
}).refine(visual => visual.kind === "cartoon" ? Boolean(visual.src) : Boolean(visual.fragment), "A cartoon needs an image and a diagram or table needs markup");
const lessonSlug = z.string().regex(/^wiki\/education\/[a-zA-Z0-9_/-]+$/);
/** What a lesson says about itself in its front matter. */
export const EducationLessonSchema = z.object({
  slug: lessonSlug, title: z.string(), href: localPath("/education/"),
  summary: z.string().optional(), level: z.enum(["foundation", "intermediate", "advanced"]).optional(),
  aliases: z.array(z.string()), prerequisites: z.array(lessonSlug), usedBy: z.array(lessonSlug),
  guide: z.string().optional(), step: z.number().int().optional(), minutes: z.number().optional(), objectives: z.array(z.string()),
});
export const EducationVisualCatalogSchema = z.object({
  version: z.literal(1), contentCommit: z.string(), visuals: z.array(EducationVisualSchema),
  lessons: z.array(EducationLessonSchema).default([]),
});
export type EducationLesson = z.infer<typeof EducationLessonSchema>;
export type EducationVisual = z.infer<typeof EducationVisualSchema>;
export type EducationVisualCatalog = z.infer<typeof EducationVisualCatalogSchema>;

/** The line shown under a visual: the lesson's caption, else what it depicts. */
export const visualCaption = (visual: Pick<EducationVisual, "kind" | "caption" | "label" | "heading">) =>
  visual.caption || (visual.kind === "cartoon" ? visual.label : visual.heading);

/** What a model needs to choose a visual. Never markup or a file path. */
export const visualForModel = ({ id, kind, label, caption, words }: EducationVisual) => ({
  id, kind, shows: label.slice(0, 300), ...(caption ? { caption: caption.slice(0, 300) } : {}), ...(words ? { words_on_it: words.slice(0, 300) } : {}),
});

const PICTURE_WORDS = new Set("picture pictures drawing drawn image visual visually look looks like figure sketch show shows".split(" "));
type PreparedVisual = { weights: Map<string, number>; length: number };
type PreparedVisuals = { documents: PreparedVisual[]; postings: Map<string, number[]> };
const preparedVisuals = new WeakMap<EducationVisual[], Map<LessonNames[] | undefined, PreparedVisuals>>();
/** How much a word counts by where it appears. The brief states intent, not
 * the final picture, so it only breaks ties. */
const FIELD_WEIGHTS = { title: 2, names: 2, heading: 1.5, label: 1, caption: 1, words: 0.8, brief: 0.3 };
function prepareVisuals(visuals: EducationVisual[], lessons?: LessonNames[]): PreparedVisuals {
  const byLessons = preparedVisuals.get(visuals) ?? new Map<LessonNames[] | undefined, PreparedVisuals>();
  preparedVisuals.set(visuals, byLessons);
  let prepared = byLessons.get(lessons);
  if (prepared) return prepared;
  const names = new Map((lessons ?? []).map(lesson => [lesson.slug, lesson.aliases.join(" ")]));
  const postings = new Map<string, number[]>();
  const documents = visuals.map((visual, index) => {
    const weights = new Map<string, number>();
    let length = 0;
    const add = (text: string | undefined, weight: number) => {
      for (const word of searchTokens(text ?? "")) { weights.set(word, (weights.get(word) ?? 0) + weight); length += weight; }
    };
    add(visual.pageTitle, FIELD_WEIGHTS.title); add(names.get(visual.slug), FIELD_WEIGHTS.names); add(visual.heading, FIELD_WEIGHTS.heading);
    add(visual.label, FIELD_WEIGHTS.label); add(visual.caption, FIELD_WEIGHTS.caption); add(visual.words, FIELD_WEIGHTS.words); add(visual.brief, FIELD_WEIGHTS.brief);
    for (const word of weights.keys()) { const list = postings.get(word); if (list) list.push(index); else postings.set(word, [index]); }
    return { weights, length };
  });
  prepared = { documents, postings };
  byLessons.set(lessons, prepared);
  return prepared;
}

/** Ranks visuals against a question by what they show: alt text, caption, the
 * words drawn on them, their lesson's names, and faintly the brief they were
 * drawn from. `coverage` is the share of the question's meaning the visual
 * matches, from 0 to 1, so a caller can decline a weak match. */
export function rankVisuals(visuals: EducationVisual[], query: string, options: { limit?: number; kind?: EducationVisual["kind"]; lessons?: LessonNames[] } = {}) {
  const asked = queryTerms(query);
  // Words that ask for a picture say nothing about which one.
  const original = asked.original.filter(term => !PICTURE_WORDS.has(term));
  const terms = asked.terms.filter(term => !PICTURE_WORDS.has(term));
  if (!terms.length) return [];
  const { documents, postings } = prepareVisuals(visuals, options.lessons);
  const idf = (term: string) => { const found = postings.get(term)?.length ?? 0; return Math.log(1 + (visuals.length - found + 0.5) / (found + 0.5)); };
  const known = original.filter(term => postings.has(term));
  const matchable = known.reduce((sum, term) => sum + idf(term), 0);
  // A word no visual mentions counts fully against the match, so an off-topic question scores low.
  const total = original.reduce((sum, term) => sum + idf(term), 0);
  const candidates = new Set<number>();
  for (const term of terms) for (const index of postings.get(term) ?? []) candidates.add(index);
  const rows: Array<{ visual: EducationVisual; score: number; coverage: number }> = [];
  for (const index of candidates) {
    const visual = visuals[index]!;
    if (options.kind && visual.kind !== options.kind) continue;
    const { weights, length } = documents[index]!;
    let score = 0;
    for (const term of terms) {
      const weight = weights.get(term);
      if (weight) score += idf(term) * (weight * 2.2) / (weight + 1.2 * (0.25 + 0.75 * length / 120)) * (original.includes(term) ? 1 : 0.45);
    }
    const matched = known.filter(term => weights.has(term)).reduce((sum, term) => sum + idf(term), 0);
    const coverage = total ? matched / total : 0;
    score *= matchable ? Math.pow(matched / matchable, 2) : 1;
    // A lesson's main picture sits where it explains the idea, not in its exercises.
    if (/^(try it|explain it back|sources|used in|related)/i.test(visual.heading)) score *= 0.6;
    if (score > 0) rows.push({ visual, score, coverage });
  }
  return rows.sort((a, b) => b.score - a.score || visuals.indexOf(a.visual) - visuals.indexOf(b.visual)).slice(0, options.limit ?? 8);
}
export const searchVisuals = (visuals: EducationVisual[], query: string, limit = 8, options: { kind?: EducationVisual["kind"]; lessons?: LessonNames[] } = {}) =>
  rankVisuals(visuals, query, { ...options, limit }).map(row => row.visual);
