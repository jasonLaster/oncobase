import { expect, test } from "bun:test";
import { buildEducationCorpus } from "./chat-index";
import { namesALesson, rankEducation, searchEducation } from "./chat";
import { blendSections, encodeVectors, nearestSections, parseSemanticIndex } from "./semantic";
import { followUps, lessonCard } from "./tutor";
import { rankVisuals, type EducationLesson, type EducationVisual } from "./visuals";

const lesson = (slug: string, title: string, more: Partial<EducationLesson> = {}): EducationLesson => ({ slug: `wiki/education/${slug}`, title, href: `/education/${slug}/`, aliases: [], prerequisites: [], usedBy: [], objectives: [], ...more });
const lessons = [
  lesson("adc", "Antibody-drug conjugate", { aliases: ["ADC", "T-DXd"], summary: "An antibody that carries a drug.", level: "intermediate", prerequisites: ["wiki/education/antibody"], usedBy: ["wiki/education/guides/aim/02-pick"] }),
  lesson("antibody", "Antibody"),
  lesson("guides/aim/index", "Aiming a drug"),
  lesson("guides/aim/01-find", "Find a target", { guide: "aim", step: 1, minutes: 8 }),
  lesson("guides/aim/02-pick", "Pick a payload", { guide: "aim", step: 2, minutes: 10 }),
];
const visual = (id: string, kind: EducationVisual["kind"], more: Partial<EducationVisual> = {}): EducationVisual => ({
  id, kind, sectionId: "/education/adc/#how", slug: "wiki/education/adc", pageTitle: "Antibody-drug conjugate", heading: "How it works", href: "/education/adc/#how", label: "", caption: "",
  ...(kind === "cartoon" ? { src: "/assets/wiki/education/images/a-light.svg" } : { fragment: "/visuals/0123456789abcdef.json" }), ...more,
});

test("a lesson's other names find it even when its text never uses them", () => {
  const { sections } = buildEducationCorpus([
    { slug: "wiki/education/adc", title: "Antibody-drug conjugate", html: '<h2 id="one">In one sentence</h2><p>An antibody carries a toxic drug to cells that display its target, then releases it inside them.</p>' },
    { slug: "wiki/education/other", title: "Trials", html: '<h2 id="t">A trial</h2><p>One trial compared T-DXd with chemotherapy and reported response rates across several groups.</p>' },
  ], "c");
  expect(searchEducation(sections, "What is T-DXd?")[0]!.slug).toBe("wiki/education/other");
  expect(searchEducation(sections, "What is T-DXd?", 6, { lessons })[0]!.slug).toBe("wiki/education/adc");
  expect(namesALesson(lessons, "how does an ADC work")).toBe(true);
  expect(namesALesson(lessons, "why does chemo hit dividing cells")).toBe(false);
  expect(rankEducation(sections, "zebrafish", 6, { lessons })).toEqual([]);
});

test("visual search weighs what a picture shows over the brief it was drawn from, and reports how well it matches", () => {
  const visuals = [
    visual("drawn", "cartoon", { label: "A linker releases the payload", words: "Bystander killing" }),
    visual("planned", "cartoon", { label: "A trial timeline", brief: "Consider bystander killing of a neighbouring cell" }),
    visual("table", "table", { label: "Columns: Payload, Linker." }),
  ];
  const ranked = rankVisuals(visuals, "bystander killing");
  expect(ranked.map(row => row.visual.id)).toEqual(["drawn", "planned"]);
  expect(ranked[0]!.coverage).toBe(1);
  expect(rankVisuals(visuals, "bystander killing in zebrafish embryos")[0]!.coverage).toBeLessThan(0.7);
  expect(rankVisuals(visuals, "payload linker", { kind: "table" }).map(row => row.visual.id)).toEqual(["table"]);
  expect(rankVisuals(visuals, "what is an ADC", { lessons }).length).toBe(3);
});

test("a lesson card carries the summary, level, what to learn first, where it is used and its place in a guide", () => {
  expect(lessonCard(lessons, "wiki/education/adc")).toEqual({
    slug: "wiki/education/adc", title: "Antibody-drug conjugate", href: "/education/adc/", summary: "An antibody that carries a drug.", level: "intermediate",
    learnFirst: [{ title: "Antibody", href: "/education/antibody/" }], usedIn: [{ title: "Pick a payload", href: "/education/guides/aim/02-pick/" }], path: undefined,
  });
  expect(lessonCard(lessons, "wiki/education/guides/aim/01-find")!.path).toEqual({ guide: "Aiming a drug", guideHref: "/education/guides/aim/index/", step: 1, of: 2, minutes: 8, next: { title: "Pick a payload", href: "/education/guides/aim/02-pick/" } });
  expect(lessonCard(lessons, "wiki/education/guides/aim/02-pick")!.path!.next).toBeUndefined();
  expect(lessonCard(lessons, "wiki/education/missing")).toBeNull();
});

test("next steps offer the visuals not yet shown, a quiz on the cartoon that was, and the lesson's own links", () => {
  const cartoon = visual("c", "cartoon"), diagram = visual("d", "diagram"), table = visual("t", "table");
  const steps = followUps({ lesson: lessonCard(lessons, "wiki/education/adc"), shown: [cartoon], available: [cartoon, diagram, table] });
  expect(steps.map(step => [step.label, step.visualId, step.mode])).toEqual([
    ["Quiz me on this picture", "c", "quiz"], ["Show the diagram", "d", "explain"], ["Show the table", "t", "explain"], ["Go simpler: Antibody", undefined, undefined],
  ]);
  expect(followUps({ lesson: lessonCard(lessons, "wiki/education/guides/aim/01-find"), shown: [], available: [] }).map(step => step.label)).toEqual(["Next: Pick a payload"]);
  expect(followUps({ lesson: null, shown: [], available: [] })).toEqual([]);
});

test("meaning search reads compact vectors and leads only when the question names no lesson", () => {
  const index = parseSemanticIndex({ version: 1, contentCommit: "c", model: "m", dimensions: 16, ids: ["a", "b"], vectors: encodeVectors([[1, ...Array(15).fill(0)], [0, 1, ...Array(14).fill(0)]]) });
  expect(nearestSections(index, [0.1, 0.9, ...Array(14).fill(0)], 2)).toEqual(["b", "a"]);
  expect(nearestSections(index, [1, 0], 2)).toEqual([]);
  expect(() => parseSemanticIndex({ version: 1, contentCommit: "c", model: "m", dimensions: 16, ids: ["a", "b", "c"], vectors: encodeVectors([[1, ...Array(15).fill(0)]]) })).toThrow();
  const section = (id: string, heading = "How it works") => ({ id, slug: `wiki/education/${id}`, pageTitle: id, heading, href: `/education/${id}/`, text: "x".repeat(100), images: [] });
  const keyword = [section("k1"), section("k2")], meaning = [section("m0", "Sources and scope"), section("m1"), section("k1")];
  expect(blendSections(keyword, meaning, false).map(row => row.id)).toEqual(["m1", "k1", "k2"]);
  expect(blendSections(keyword, meaning, true).map(row => row.id)).toEqual(["k1", "m1", "k2"]);
});
