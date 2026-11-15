import { expect, test } from "bun:test";
import { buildEducationCorpus } from "./chat-index";
import {
  educationLessonAtPath, educationLessonSections, educationLessonsFromCorpus, educationSearchApiResults,
  normalizeLessonSlug, readEducationMarkdown, readEducationSection, resolveEducationTarget, searchEducationSections,
} from "./webmcp";

const corpus = buildEducationCorpus([
  { slug: "wiki/education/dna", title: "DNA repair", html: '<p>Cells repair damaged DNA.</p><h2 id="hrd">Homologous recombination deficiency</h2><p>HRD is a weakness in one DNA repair pathway.</p>' },
  { slug: "wiki/education/immunology/index", title: "Immunology", html: '<p>T cells recognise antigens.</p><h2 id="checkpoints">Checkpoints</h2><p>PD-1 is a checkpoint that tumors exploit.</p>' },
], "commit-a");

test("normalizes the slug forms agents pass", () => {
  for (const input of ["dna", "wiki/education/dna", "/education/dna/", "https://oncoguide.cc/education/dna/#hrd", "/wiki/education/dna.md"])
    expect(normalizeLessonSlug(input)).toBe("wiki/education/dna");
});

test("search returns ids, hrefs and snippets; empty queries are errors", () => {
  const found = searchEducationSections(corpus, "homologous recombination", 3);
  expect("results" in found && found.results[0]).toMatchObject({ slug: "wiki/education/dna", href: "/education/dna/#hrd", heading: "Homologous recombination deficiency" });
  expect(searchEducationSections(corpus, "  ")).toEqual({ error: "Provide a query." });
});

test("reads sections and lists lesson sections, with /index tolerance", () => {
  const id = corpus.sections.find(section => section.href.endsWith("#checkpoints"))!.id;
  expect(readEducationSection(corpus, id)).toMatchObject({ text: expect.stringContaining("PD-1"), truncated: false });
  expect(readEducationSection(corpus, "nope")).toHaveProperty("error");
  const lesson = educationLessonSections(corpus, "immunology");
  expect(lesson).toMatchObject({ slug: "wiki/education/immunology/index", title: "Immunology" });
  expect("sections" in lesson && lesson.sections.map(section => section.heading)).toContain("Checkpoints");
  expect(educationLessonSections(corpus, "missing")).toHaveProperty("error");
});

test("lists lessons once each and resolves navigation targets", () => {
  expect(educationLessonsFromCorpus(corpus).map(lesson => lesson.slug)).toEqual(["wiki/education/dna", "wiki/education/immunology/index"]);
  const bySlug = resolveEducationTarget(corpus, { slug: "dna" });
  expect("section" in bySlug && bySlug.section.href).toBe("/education/dna/");
  expect(resolveEducationTarget(corpus, {})).toHaveProperty("error");
  expect(educationLessonAtPath(corpus, "/wiki/education/dna")?.sections.length).toBe(2);
  expect(educationLessonAtPath(corpus, "/education/search/")).toBeNull();
});

test("reads a markdown page or one of its sections", () => {
  const page = { slug: "wiki/education/dna", title: "DNA repair", content: "# DNA repair\n\nIntro.\n\n## How cells repair\n\nThey fix it.\n\n## Why it matters\n\nTumors.\n" };
  const section = readEducationMarkdown(page, "how-cells-repair");
  expect("text" in section && section.text).toBe("## How cells repair\n\nThey fix it.");
  expect(readEducationMarkdown(page, "Why it matters")).toMatchObject({ text: "## Why it matters\n\nTumors." });
  expect(readEducationMarkdown(page, "nothing")).toHaveProperty("error");
  expect(readEducationMarkdown(page)).toMatchObject({ outline: expect.arrayContaining([expect.objectContaining({ id: "why-it-matters" })]) });
});

test("filters and trims search API results", () => {
  const results = educationSearchApiResults([
    { slug: "wiki/education/dna", title: "DNA", matches: [{ lineContent: "repair  text" }] },
    { slug: "wiki/care/private", title: "Private" },
  ], slug => `/education/${slug.slice(15)}`);
  expect(results).toEqual([{ slug: "wiki/education/dna", title: "DNA", href: "/education/dna", snippet: "repair text" }]);
});
