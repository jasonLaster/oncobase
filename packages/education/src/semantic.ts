import { z } from "zod";
import type { EducationSection } from "./chat.ts";

/** Meaning-based search over lesson sections, as an optional layer on keyword
 * search. The content build writes one short vector per section when it has
 * credentials; the chat server embeds the question and compares. Server and
 * build only: nothing here ships to the browser. */
export const SemanticIndexSchema = z.object({
  version: z.literal(1), contentCommit: z.string(), model: z.string(), dimensions: z.number().int().min(16).max(1024),
  /** Section ids, in the order of the vectors. */
  ids: z.array(z.string()),
  /** One signed byte per dimension, base64. */
  vectors: z.string(),
});
export type SemanticIndex = { contentCommit: string; model: string; dimensions: number; ids: string[]; vectors: Int8Array };

export const SEMANTIC_MODEL = "openai/text-embedding-3-small";
export const SEMANTIC_DIMENSIONS = 256;
/** What is embedded for a section: its lesson, heading and opening text. */
export const semanticText = (section: EducationSection) => `${section.pageTitle} — ${section.heading}\n${section.text.slice(0, 1200)}`;

export function encodeVectors(vectors: number[][]): string {
  const dimensions = vectors[0]?.length ?? 0;
  const bytes = new Int8Array(vectors.length * dimensions);
  vectors.forEach((vector, row) => vector.forEach((value, column) => { bytes[row * dimensions + column] = Math.max(-127, Math.min(127, Math.round(value * 127))); }));
  return Buffer.from(bytes.buffer).toString("base64");
}

export function parseSemanticIndex(value: unknown): SemanticIndex {
  const { contentCommit, model, dimensions, ids, vectors } = SemanticIndexSchema.parse(value);
  const bytes = Buffer.from(vectors, "base64");
  if (bytes.length !== ids.length * dimensions) throw Error("Search vectors do not match their section list");
  return { contentCommit, model, dimensions, ids, vectors: new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length) };
}

/** The sections whose meaning is closest to the question. */
export function nearestSections(index: SemanticIndex, query: number[], limit: number): string[] {
  if (query.length !== index.dimensions) return [];
  const scores = index.ids.map((id, row) => {
    let score = 0;
    const offset = row * index.dimensions;
    for (let column = 0; column < index.dimensions; column++) score += index.vectors[offset + column]! * query[column]!;
    return { id, score };
  });
  return scores.sort((a, b) => b.score - a.score).slice(0, limit).map(row => row.id);
}

const WEAK_HEADING = /^(sources|scope|used in|related|further reading|credits|concepts you|what you|where to|try it|applied to)/i;
/** Joins the two rankings. On questions with known answers, keyword search was
 * right 97% of the time when the question used a lesson's own name and meaning
 * search 93% of the time when it didn't, so each leads where it is stronger and
 * the other fills in: a named lesson comes first and the two then alternate. At most two sections per lesson, as in keyword search. */
export function blendSections(keyword: EducationSection[], meaning: EducationSection[], namesALesson: boolean, limit = 6): EducationSection[] {
  const usable = meaning.filter(section => !WEAK_HEADING.test(section.heading) && section.text.length >= 80 && !/illustration register|sources and/i.test(section.pageTitle));
  const perLesson = new Map<string, number>();
  const picked = new Map<string, EducationSection>();
  const take = (section: EducationSection | undefined) => {
    if (!section || picked.size >= limit || picked.has(section.id) || (perLesson.get(section.slug) ?? 0) >= 2) return;
    perLesson.set(section.slug, (perLesson.get(section.slug) ?? 0) + 1);
    picked.set(section.id, section);
  };
  if (namesALesson) {
    // The named lesson first, then the two rankings in turn.
    take(keyword[0]);
    for (let index = 0; index < Math.max(keyword.length, usable.length); index++) { take(usable[index]); take(keyword[index + 1]); }
  } else {
    usable.slice(0, limit - 2).forEach(take); keyword.forEach(take); usable.forEach(take);
  }
  return [...picked.values()];
}
