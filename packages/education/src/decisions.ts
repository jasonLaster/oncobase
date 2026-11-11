/** Deciding what to show with an answer. Search proposes candidates; a decision
 * model scores each one against the reader's message in a single fast request;
 * fixed rules turn the scores into what appears. The writing model never chooses. */
import { z } from "zod";
import type { EducationSection } from "./chat";
import { visualForModel, type EducationVisual } from "./visuals";

export type DecisionQuestion =
  | { type: "predicate"; name: string; instructions: string }
  | { type: "score"; name: string; instructions: string; levels: Array<{ label: string; description?: string }> };
export type DecisionAnswer = { type: string; name: string | null; probability?: number; score?: number };
export type Decision = { model: string; answers: Map<string, DecisionAnswer> };
/** Asks every question about one input. Rejects when no model could answer. */
export type Decide = (input: Record<string, unknown>, questions: DecisionQuestion[], signal?: AbortSignal) => Promise<Decision>;

/** Decision models through the AI Gateway, in order of preference. */
export const DECISION_MODELS = ["typesafe-ai/jev", "openai/gpt-6-luna-decisions"];
const DECISIONS_URL = "https://ai-gateway.vercel.sh/v1/decisions";
const ResponseSchema = z.object({
  model: z.string().optional(),
  answers: z.array(z.object({ type: z.string(), name: z.string().nullable().optional(), probability: z.number().optional(), score: z.number().optional() })),
});

/** Tries each model in turn, so a model that is down, slow or refusing costs
 * one timeout and the next one answers. */
export function createDecider({ token, models = DECISION_MODELS, fetch: send = fetch, timeoutMs = 1500 }: {
  token: () => Promise<string | undefined> | string | undefined; models?: string[]; fetch?: typeof fetch; timeoutMs?: number;
}): Decide {
  return async (input, questions, signal) => {
    const bearer = await token();
    if (!bearer) throw Error("No AI Gateway credentials for decisions");
    let failure: unknown = Error("No decision model is configured");
    for (const model of models) {
      try {
        const response = await send(DECISIONS_URL, {
          method: "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, input: [{ role: "user", content: [{ type: "input_json", data: input }] }], questions }),
          signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]),
        });
        if (!response.ok) throw Error(`${model} answered ${response.status}`);
        const body = ResponseSchema.parse(await response.json());
        const answers = new Map(body.answers.flatMap(answer => answer.name && answer.type !== "refusal" ? [[answer.name, { ...answer, name: answer.name }] as const] : []));
        if (answers.size < questions.length) throw Error(`${model} left ${questions.length - answers.size} questions unanswered`);
        return { model: body.model ?? model, answers };
      } catch (error) {
        if (signal?.aborted) throw error;
        failure = error;
      }
    }
    throw failure;
  };
}

const FIGURE_LEVELS = [
  { label: "unrelated", description: "About a different topic." },
  { label: "related", description: "Same area, but does not show what was asked." },
  { label: "useful", description: "Shows part of what was asked." },
  { label: "exact", description: "Shows exactly what was asked." },
];
const SECTION_LEVELS = [
  { label: "unrelated", description: "About a different topic." },
  { label: "related", description: "Same area, but does not answer what was asked." },
  { label: "useful", description: "Answers part of what was asked." },
  { label: "exact", description: "Answers exactly what was asked." },
];

export const describeVisual = (visual: EducationVisual) => {
  const { id: _id, ...rest } = visualForModel(visual);
  return `${visual.pageTitle} — ${JSON.stringify(rest)}`.slice(0, 700);
};

/** One score per candidate figure and section, and whether a figure was asked for. */
export function contentQuestions(visuals: EducationVisual[], sections: EducationSection[]): DecisionQuestion[] {
  return [
    { type: "predicate", name: "asked", instructions: "Did the reader's latest message ask to be shown a picture, cartoon, diagram, table or other figure?" },
    ...visuals.map((visual, position) => ({ type: "score" as const, name: `v${position}`, levels: FIGURE_LEVELS, instructions: `How well does this figure show what the reader's latest message asks about? Figure: ${describeVisual(visual)}` })),
    ...sections.map((section, position) => ({ type: "score" as const, name: `s${position}`, levels: SECTION_LEVELS, instructions: `How well does this lesson section answer the reader's latest message? Section: ${section.pageTitle} — ${section.heading}: ${section.text.slice(0, 300)}` })),
  ];
}
export const decisionInput = (latest: string, earlier?: string) => ({ reader_asked: latest.slice(0, 1000), ...(earlier ? { their_earlier_question: earlier.slice(0, 500) } : {}) });

/** Scores run from 0 (unrelated) to 3 (exact). */
export const SHOW_AT = 2;
/** A reader who asked for a figure gets the best one even if it is only close. */
export const SHOW_WHEN_ASKED_AT = 1.5;
/** A second figure must be a strong match of a different kind. */
export const SECOND_AT = 2.5;
/** Section cards keep search order, which measured better than the model's order from short excerpts.
 * The scores only withhold the cards when no section is even related. */
export const CARDS_AT = 1.25;
export const MAX_SHOWN = 2;

export type ContentPlan = {
  model: string; asked: boolean;
  /** What to show, best first: at most two, never two of one kind. */
  visuals: EducationVisual[];
  /** The sections for a card under the answer, in search order: none when the message is about something else. */
  cards: EducationSection[];
  scores: { visuals: Array<{ id: string; score: number }>; sections: Array<{ id: string; score: number }> };
};
export function planContent(visuals: EducationVisual[], sections: EducationSection[], decision: Decision): ContentPlan {
  const score = (name: string) => decision.answers.get(name)?.score ?? 0;
  const asked = (decision.answers.get("asked")?.probability ?? 0) >= 0.5;
  // A stable sort keeps search order between equal scores.
  const rankedVisuals = visuals.map((visual, position) => ({ visual, score: score(`v${position}`) })).sort((a, b) => b.score - a.score);
  const sectionScores = sections.map((section, position) => ({ id: section.id, score: score(`s${position}`) }));
  const [best] = rankedVisuals;
  const shown = best && best.score >= (asked ? SHOW_WHEN_ASKED_AT : SHOW_AT) ? [best.visual] : [];
  const second = shown.length ? rankedVisuals.slice(1).find(row => row.score >= SECOND_AT && row.visual.kind !== best!.visual.kind) : undefined;
  if (second) shown.push(second.visual);
  return {
    model: decision.model, asked, visuals: shown.slice(0, MAX_SHOWN),
    cards: sectionScores.some(row => row.score >= CARDS_AT) ? sections.slice(0, 3) : [],
    scores: { visuals: rankedVisuals.map(row => ({ id: row.visual.id, score: row.score })), sections: sectionScores },
  };
}
