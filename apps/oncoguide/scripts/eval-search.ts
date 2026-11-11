/** Measures lesson and visual search against questions with known answers.
 * Run after `bun run content:prepare`: `bun scripts/eval-search.ts`.
 * Pass `--min-lesson=0.8 --min-visual=0.7` to fail below a top-3 rate, and
 * `--semantic` to also measure search by meaning (needs AI Gateway credentials). */
import { EducationCorpusSchema, rankEducation } from "@oncobase/education/chat";
import { EducationVisualCatalogSchema, rankVisuals } from "@oncobase/education/visuals";
import { lessonQuestions, visualQuestions } from "./eval-questions";

const { sections } = EducationCorpusSchema.parse(await Bun.file("public/chat-index.json").json());
const { visuals, lessons } = EducationVisualCatalogSchema.parse(await Bun.file("public/visual-catalog.json").json());
const P = "wiki/education/";

const known = new Set(lessons.map(lesson => lesson.slug));
const illustrated = new Set(visuals.map(visual => visual.slug));
for (const [, slug] of lessonQuestions) if (!known.has(P + slug)) throw Error(`No such lesson: ${slug}`);
for (const [, slug] of visualQuestions) if (!illustrated.has(P + slug)) throw Error(`No visual in lesson: ${slug}`);

function report(name: string, rows: Array<{ question: string; rank: number }>, verbose: boolean) {
  const within = (n: number) => rows.filter(row => row.rank > 0 && row.rank <= n).length / rows.length;
  console.info(`${name}: ${rows.length} questions, top-1 ${(within(1) * 100).toFixed(0)}%, top-3 ${(within(3) * 100).toFixed(0)}%, top-6 ${(within(6) * 100).toFixed(0)}%`);
  if (verbose) for (const row of rows.filter(row => row.rank !== 1)) console.info(`  ${row.rank || "miss"}  ${row.question}`);
  return within(3);
}
const verbose = process.argv.includes("--verbose");
const lessonRank = (question: string, slug: string, options: Parameters<typeof rankEducation>[3]) => rankEducation(sections, question, 6, options).findIndex(row => row.section.slug === P + slug) + 1;
const started = performance.now();
report("Lesson search, text only", lessonQuestions.map(([question, slug]) => ({ question, rank: lessonRank(question, slug, {}) })), false);
const lessonScore = report("Lesson search, with lesson names", lessonQuestions.map(([question, slug]) => ({ question, rank: lessonRank(question, slug, { lessons }) })), verbose);
// Every other name a lesson gives itself should find that lesson.
const aliases = lessons.flatMap(lesson => lesson.aliases.map(alias => ({ question: `What is ${alias}?`, slug: lesson.slug })));
report("Lesson names, text only", aliases.map(({ question, slug }) => ({ question, rank: lessonRank(question, slug.slice(P.length), {}) })), false);
report("Lesson names, with lesson names", aliases.map(({ question, slug }) => ({ question, rank: lessonRank(question, slug.slice(P.length), { lessons }) })), false);
// With `--semantic`, also measure the blend the chat server uses when the build wrote vectors.
// This embeds each question through the AI Gateway, so it needs credentials and costs a little.
if (process.argv.includes("--semantic")) {
  const { embedMany } = await import("ai");
  const { blendSections, nearestSections, parseSemanticIndex } = await import("@oncobase/education/semantic");
  const { namesALesson, searchEducation } = await import("@oncobase/education/chat");
  const index = parseSemanticIndex(await Bun.file("public/search-vectors.json").json());
  const byId = new Map(sections.map(section => [section.id, section]));
  const sample = aliases.filter((_, position) => position % 8 === 0);
  const { embeddings } = await embedMany({ model: index.model, values: [...lessonQuestions.map(([question]) => question), ...sample.map(row => row.question)], providerOptions: { openai: { dimensions: index.dimensions } } });
  const blended = (question: string, slug: string, vector: number[]) => blendSections(searchEducation(sections, question, 12, { lessons }), nearestSections(index, vector, 24).map(id => byId.get(id)!).filter(Boolean), namesALesson(lessons, question))
    .findIndex(section => section.slug === slug) + 1;
  report("Lesson search, names and meaning blended", lessonQuestions.map(([question, slug], position) => ({ question, rank: blended(question, P + slug, embeddings[position]!) })), verbose);
  report(`Lesson names (${sample.length} sampled), names and meaning blended`, sample.map((row, position) => ({ question: row.question, rank: blended(row.question, row.slug, embeddings[lessonQuestions.length + position]!) })), false);
}
const bare = visuals.map(({ words: _words, brief: _brief, ...visual }) => visual);
const visualRank = (list: typeof visuals, question: string, slug: string, withNames: boolean) => rankVisuals(list, question, { limit: 6, lessons: withNames ? lessons : undefined }).findIndex(row => row.visual.slug === P + slug) + 1;
report("Visual search, alt text and caption only", visualQuestions.map(([question, slug]) => ({ question, rank: visualRank(bare, question, slug, false) })), false);
const visualScore = report("Visual search, with drawn words, briefs and lesson names", visualQuestions.map(([question, slug]) => ({ question, rank: visualRank(visuals, question, slug, true) })), verbose);
console.info(`${((performance.now() - started) / (2 * lessonQuestions.length + 2 * aliases.length + 2 * visualQuestions.length)).toFixed(2)} ms per search`);
const minimum = (flag: string) => Number(process.argv.find(argument => argument.startsWith(`--${flag}=`))?.split("=")[1] ?? 0);
if (lessonScore < minimum("min-lesson") || visualScore < minimum("min-visual")) { console.error("Search fell below the required top-3 rate"); process.exit(1); }
