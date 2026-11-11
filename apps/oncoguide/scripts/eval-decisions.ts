/** Measures the decision step the chat server uses: search proposes figures and
 * sections, a decision model scores them, and fixed rules pick what shows.
 * Run after `bun run content:prepare` with AI Gateway credentials:
 * `bun --env-file=<.env.local> scripts/eval-decisions.ts [--model=typesafe-ai/jev] [--verbose]`.
 * Each model makes about 90 small paid requests. */
import { EducationCorpusSchema, searchEducation } from "@oncobase/education/chat";
import { contentQuestions, createDecider, DECISION_MODELS, decisionInput, planContent } from "@oncobase/education/decisions";
import { EducationVisualCatalogSchema, rankVisuals, type EducationVisual } from "@oncobase/education/visuals";
import { lessonQuestions, visualQuestions } from "./eval-questions";

const { sections } = EducationCorpusSchema.parse(await Bun.file("public/chat-index.json").json());
const { visuals, lessons } = EducationVisualCatalogSchema.parse(await Bun.file("public/visual-catalog.json").json());
const P = "wiki/education/";
if (!process.env.AI_GATEWAY_API_KEY) throw Error("AI_GATEWAY_API_KEY is not set");
const models = process.argv.find(value => value.startsWith("--model="))?.slice(8).split(",") ?? DECISION_MODELS;
const verbose = process.argv.includes("--verbose");

/** Messages the library has no figure for; nothing should show. */
const noVisual = [
  "thanks, that makes sense", "can you say that again more simply?", "what should I eat during chemo?", "how much does a PET scan cost?",
  "who discovered penicillin?", "what's the weather like today", "is my oncologist right about my treatment plan?", "how do I appeal an insurance denial?",
  "ok", "what is the capital of France", "tell me a joke", "how long have you been a tutor?",
];
const bySection = new Map<string, EducationVisual[]>();
for (const visual of visuals) bySection.set(visual.sectionId, [...(bySection.get(visual.sectionId) ?? []), visual]);
const percent = (count: number, total: number) => `${((count / total) * 100).toFixed(0)}%`;
async function pooled<T, R>(items: T[], work: (item: T) => Promise<R>, width = 6) {
  const results: R[] = []; let next = 0;
  await Promise.all(Array.from({ length: width }, async () => { while (next < items.length) { const position = next++; results[position] = await work(items[position]!); } }));
  return results;
}

for (const model of models) {
  console.info(`\n== ${model}`);
  const latencies: number[] = [];
  const decide = createDecider({ token: () => process.env.AI_GATEWAY_API_KEY, models: [model], timeoutMs: 10_000 });
  // The same candidates the chat server gathers.
  const plan = async (question: string) => {
    const found = searchEducation(sections, question, 6, { lessons });
    const candidates = [...new Map([...rankVisuals(visuals, question, { limit: 8, lessons }).map(row => row.visual), ...found.slice(0, 3).flatMap(section => bySection.get(section.id) ?? [])].map(visual => [visual.id, visual])).values()].slice(0, 12);
    const started = performance.now();
    const decision = await decide(decisionInput(question), contentQuestions(candidates, found));
    latencies.push(performance.now() - started);
    return { ...planContent(candidates, found, decision), searchFirst: candidates[0], searchCard: found[0] };
  };
  const pictures = await pooled(visualQuestions, async ([question, slug]) => ({ question, slug: P + slug, ...await plan(question) }));
  console.info(`Picture requests (${pictures.length}): search's first figure is right ${percent(pictures.filter(row => row.searchFirst?.slug === row.slug).length, pictures.length)}; decision shows a figure for ${percent(pictures.filter(row => row.visuals.length).length, pictures.length)}, the right one first for ${percent(pictures.filter(row => row.visuals[0]?.slug === row.slug).length, pictures.length)}, a wrong one for ${percent(pictures.filter(row => row.visuals.length && row.visuals[0]!.slug !== row.slug).length, pictures.length)}; two figures ${pictures.filter(row => row.visuals.length > 1).length} times; read as a request for a figure ${percent(pictures.filter(row => row.asked).length, pictures.length)}`);
  if (verbose) for (const row of pictures.filter(row => row.visuals[0]?.slug !== row.slug)) console.info(`  ${row.visuals.length ? "wrong" : "none "}  best ${row.scores.visuals[0]?.score.toFixed(2)}  ${row.question}`);

  const concepts = await pooled(lessonQuestions, async ([question, slug]) => ({ question, slug: P + slug, ...await plan(question) }));
  const illustrated = concepts.filter(row => visuals.some(visual => visual.slug === row.slug));
  console.info(`Lesson questions (${concepts.length}): cards are withheld ${concepts.filter(row => !row.cards.length).length} times. Of ${illustrated.length} with a figure in the lesson: a figure shows for ${percent(illustrated.filter(row => row.visuals.length).length, illustrated.length)}, from the right lesson ${percent(illustrated.filter(row => row.visuals[0]?.slug === row.slug).length, illustrated.length)}, from another lesson ${percent(illustrated.filter(row => row.visuals.length && row.visuals[0]!.slug !== row.slug).length, illustrated.length)}`);
  if (verbose) for (const row of concepts.filter(row => !row.cards.length)) console.info(`  no cards  ${row.question}`);
  if (verbose) for (const row of illustrated.filter(row => row.visuals.length && row.visuals[0]!.slug !== row.slug)) console.info(`  figure from another lesson  ${row.question}  -> ${row.visuals[0]!.pageTitle}`);

  const off = await pooled(noVisual, async question => ({ question, ...await plan(question) }));
  console.info(`Off-topic messages (${off.length}): a figure shows ${off.filter(row => row.visuals.length).length} times, a card ${off.filter(row => row.cards.length).length} times`);
  if (verbose) for (const row of off.filter(row => row.visuals.length || row.cards.length)) console.info(`  ${row.visuals.length ? "figure" : "card"}  ${row.question}`);
  if (verbose) {
    const best = (row: { scores: { sections: Array<{ score: number }> } }) => Math.max(0, ...row.scores.sections.map(section => section.score));
    console.info(`  best section score, lesson questions (lowest five): ${concepts.map(best).sort((a, b) => a - b).slice(0, 5).map(score => score.toFixed(2)).join(" ")}`);
    console.info(`  best section score, off-topic: ${off.map(best).sort((a, b) => b - a).map(score => score.toFixed(2)).join(" ")}`);
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  console.info(`Latency per decision: median ${sorted[Math.floor(sorted.length / 2)]!.toFixed(0)} ms, p95 ${sorted[Math.floor(sorted.length * 0.95)]!.toFixed(0)} ms`);
}
