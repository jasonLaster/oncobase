import type { EducationLesson, EducationVisual } from "./visuals.ts";

/** What the tutor shows beside an answer besides visuals: a card about the
 * lesson, and next steps drawn from the lesson's own front matter and from the
 * visuals it has not shown yet. Nothing here is written by a model. */
type LessonLink = { title: string; href: string };
export type LessonCard = {
  slug: string; title: string; href: string; summary?: string; level?: EducationLesson["level"];
  learnFirst: LessonLink[]; usedIn: LessonLink[];
  path?: { guide: string; guideHref: string; step: number; of: number; minutes?: number; next?: LessonLink };
};
export type FollowUp = {
  label: string; question: string;
  /** A visual the follow-up is about, shown without a search. */
  visualId?: string; mode?: "explain" | "quiz";
};

const indexes = new WeakMap<EducationLesson[], Map<string, EducationLesson>>();
function bySlug(lessons: EducationLesson[]) {
  let index = indexes.get(lessons);
  if (!index) { index = new Map(lessons.map(lesson => [lesson.slug, lesson])); indexes.set(lessons, index); }
  return index;
}

export function lessonCard(lessons: EducationLesson[], slug: string): LessonCard | null {
  const index = bySlug(lessons);
  const lesson = index.get(slug);
  if (!lesson) return null;
  const links = (slugs: string[]) => slugs.map(other => index.get(other)).filter((other): other is EducationLesson => Boolean(other)).slice(0, 3).map(({ title, href }) => ({ title, href }));
  let path: LessonCard["path"];
  if (lesson.guide && lesson.step) {
    const steps = lessons.filter(other => other.guide === lesson.guide && other.step).sort((a, b) => a.step! - b.step!);
    const home = index.get(`${lesson.slug.split("/").slice(0, -1).join("/")}/index`);
    const next = steps.find(other => other.step! > lesson.step!);
    path = { guide: home?.title ?? lesson.guide, guideHref: home?.href ?? lesson.href, step: lesson.step, of: steps.at(-1)!.step!, minutes: lesson.minutes, next: next && { title: next.title, href: next.href } };
  }
  return { slug: lesson.slug, title: lesson.title, href: lesson.href, summary: lesson.summary, level: lesson.level, learnFirst: links(lesson.prerequisites), usedIn: links(lesson.usedBy), path };
}

const short = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
const NOUN = { cartoon: "picture", diagram: "diagram", table: "table" } as const;

/** Up to four next steps: visuals the lesson has that were not shown, a quiz on
 * the cartoon that was, and where the lesson says to go before and after. */
export function followUps({ lesson, shown, available }: { lesson?: LessonCard | null; shown: EducationVisual[]; available: EducationVisual[] }): FollowUp[] {
  const steps: FollowUp[] = [];
  const cartoon = shown.find(visual => visual.kind === "cartoon");
  if (cartoon) steps.push({ label: "Quiz me on this picture", question: `Quiz me on the picture from “${short(cartoon.pageTitle, 60)}”.`, visualId: cartoon.id, mode: "quiz" });
  const seen = new Set(shown.map(visual => visual.id));
  const shownKinds = new Set(shown.map(visual => visual.kind));
  for (const kind of ["cartoon", "diagram", "table"] as const) {
    const visual = available.find(candidate => candidate.kind === kind && !seen.has(candidate.id));
    if (!visual || steps.length >= 3) continue;
    steps.push({ label: `${shownKinds.has(kind) ? "Another" : "Show the"} ${NOUN[kind]}`.replace("Another", `Show another`), question: `Show me the ${NOUN[kind]} from “${short(visual.pageTitle, 60)}” and walk me through it.`, visualId: visual.id, mode: "explain" });
  }
  if (lesson?.path?.next) steps.push({ label: `Next: ${short(lesson.path.next.title, 40)}`, question: `Take me to the next step: ${lesson.path.next.title}.` });
  else if (lesson?.learnFirst[0]) steps.push({ label: `Go simpler: ${short(lesson.learnFirst[0].title, 36)}`, question: `Explain ${lesson.learnFirst[0].title} simply, as background for ${lesson.title}.` });
  if (lesson?.usedIn[0] && steps.length < 4) steps.push({ label: "Where is this used?", question: `Where does ${lesson.title} matter in practice?` });
  return steps.slice(0, 4);
}
