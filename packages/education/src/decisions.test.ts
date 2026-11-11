import { expect, test } from "bun:test";
import { buildEducationCorpus } from "./chat-index";
import { contentQuestions, createDecider, planContent, type Decision, type DecisionAnswer } from "./decisions";
import { buildEducationVisuals } from "./visual-index";

const pages = [{ slug: "wiki/education/dna", title: "DNA repair", html: [
  '<h2 id="repair">DNA repair</h2><p>Cells repair damaged DNA.</p><img src="/assets/wiki/education/images/dna-light.png" alt="Repair cartoon">',
  '<h2 id="routes">Repair routes</h2><p>Routes differ in accuracy.</p><table><tr><th>Route</th><td>Accuracy</td></tr></table>',
  '<h2 id="other">Chromatin</h2><p>Chromatin packs the genome.</p><img src="/assets/wiki/education/images/other-light.png" alt="Chromatin cartoon">',
].join("") }];
const { sections } = buildEducationCorpus(pages, "c");
const { visuals } = buildEducationVisuals(pages, "c").catalog;
const [cartoon, table, chromatin] = [visuals.find(visual => visual.id.endsWith("::dna"))!, visuals.find(visual => visual.kind === "table")!, visuals.find(visual => visual.id.endsWith("::other"))!];
const candidates = [cartoon, chromatin, table];
const decision = (scores: Record<string, number>, asked = 0): Decision => ({ model: "test", answers: new Map<string, DecisionAnswer>([["asked", { type: "predicate", name: "asked", probability: asked }], ...Object.entries(scores).map(([name, score]) => [name, { type: "score", name, score }] as const)]) });

test("asks one question per candidate and never sends file paths or briefs", () => {
  const questions = contentQuestions(candidates, sections);
  expect(questions.map(question => question.name)).toEqual(["asked", "v0", "v1", "v2", "s0", "s1", "s2"]);
  expect(JSON.stringify(questions)).not.toContain(".png");
  expect(JSON.stringify(questions)).toContain("Repair cartoon");
});

test("shows the best figure only when it fits, a second only when strong and of another kind", () => {
  const show = (scores: Record<string, number>, asked = 0) => planContent(candidates, sections, decision(scores, asked)).visuals.map(visual => visual.id);
  expect(show({ v0: 2.4, v1: 2.9, v2: 1 })).toEqual([chromatin.id]);
  // Two cartoons never show together, however well both score.
  expect(show({ v0: 2.9, v1: 2.8, v2: 2.4 })).toEqual([cartoon.id]);
  expect(show({ v0: 2.9, v1: 2.8, v2: 2.6 })).toEqual([cartoon.id, table.id]);
  // Nothing close enough: show nothing, unless the reader asked for a figure.
  expect(show({ v0: 1.7, v1: 0.2, v2: 0.1 })).toEqual([]);
  expect(show({ v0: 1.7, v1: 0.2, v2: 0.1 }, 0.9)).toEqual([cartoon.id]);
  expect(show({ v0: 1.2 }, 0.9)).toEqual([]);
});

test("cards keep search order and are withheld only when no section is related", () => {
  expect(planContent(candidates, sections, decision({ s0: 0.4, s1: 2.7, s2: 0.1 })).cards.map(section => section.heading)).toEqual(["DNA repair", "Repair routes", "Chromatin"]);
  expect(planContent(candidates, sections, decision({ s0: 0.9, s1: 0.2 })).cards).toEqual([]);
});

test("falls back to the next model when the first is down, slow, refusing or incomplete", async () => {
  const questions = contentQuestions([cartoon], []);
  const good = { model: "luna", answers: [{ type: "predicate", name: "asked", probability: 0.1 }, { type: "score", name: "v0", score: 2.5 }] };
  const run = async (first: (signal: AbortSignal) => Response | Promise<Response>) => {
    const calls: string[] = [];
    const decide = createDecider({ token: () => "key", models: ["jev", "luna"], timeoutMs: 30, fetch: (async (_url: unknown, init: RequestInit) => {
      const { model } = JSON.parse(String(init.body)); calls.push(model);
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer key");
      return model === "jev" ? first(init.signal!) : Response.json(good);
    }) as never });
    return { result: await decide({ reader_asked: "x" }, questions), calls };
  };
  for (const first of [
    () => new Response("down", { status: 503 }),
    (signal: AbortSignal) => new Promise<Response>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
    () => Response.json({ answers: [{ type: "predicate", name: "asked", probability: 0 }, { type: "refusal", name: "v0" }] }),
    () => Response.json({ answers: [] }),
  ]) {
    const { result, calls } = await run(first);
    expect(calls).toEqual(["jev", "luna"]);
    expect(result.model).toBe("luna");
    expect(result.answers.get("v0")?.score).toBe(2.5);
  }
  const direct = await run(() => Response.json({ ...good, model: "jev-1" }));
  expect(direct.calls).toEqual(["jev"]);
  // With every model failing, or no credentials, the caller hears about it.
  await expect(createDecider({ token: () => "key", models: ["jev"], fetch: (async () => new Response("", { status: 500 })) as never })({}, questions)).rejects.toThrow("500");
  await expect(createDecider({ token: () => undefined })({}, questions)).rejects.toThrow("credentials");
});
