import { expect, test } from "bun:test";
import { buildEducationCorpus } from "./chat-index";
import { EducationCorpusSchema, searchEducation } from "./chat";
const pages = [
  { slug: "wiki/education/dna", title: "DNA repair", html: '<p>Cells repair damaged DNA.</p><img src="/assets/wiki/education/images/dna-light.png" alt="DNA repair cartoon"><img src="/assets/wiki/education/images/dna-dark.png" alt="DNA repair cartoon"><h2 id="hrd">Homologous recombination deficiency</h2><p>HRD is a weakness in one DNA repair pathway.</p><h2 id="hrd-1">Homologous recombination deficiency</h2><p>A second section.</p>' },
  { slug: "wiki/education/ctdna", title: "Liquid biopsy", html: '<h2 id="what-it-measures">Circulating tumor DNA</h2><p>ctDNA detects tumor DNA in blood. A negative result cannot rule out all cancer.</p>' },
];
test("indexes exact rendered anchors, duplicate headings, plain text and image themes", () => {
  const corpus = buildEducationCorpus(pages, "commit-a");
  expect(corpus.sections.map(section => section.href)).toEqual(["/education/dna/", "/education/dna/#hrd", "/education/dna/#hrd-1", "/education/ctdna/#what-it-measures"]);
  expect(corpus.sections[0].images).toEqual([{ src: "/assets/wiki/education/images/dna-light.png", darkSrc: "/assets/wiki/education/images/dna-dark.png", alt: "DNA repair cartoon" }]);
  expect(corpus.sections[1].text).toContain("weakness");
  expect(JSON.stringify(corpus)).not.toContain("<p>");
});
test("natural questions and abbreviations retrieve specific source sections", () => {
  const { sections } = buildEducationCorpus(pages, "commit-a");
  expect(searchEducation(sections, "What can a ctDNA test tell us?")[0].href).toBe("/education/ctdna/#what-it-measures");
  expect(searchEducation(sections, "What is HRD?")[0].href).toBe("/education/dna/#hrd");
  expect(searchEducation(sections, "Explain DNA repair with a cartoon").some(section => section.images.length > 0)).toBe(true);
  expect(searchEducation(sections, "uncoveredtopic")).toEqual([]);
});
test("nested headings and text surrounding inline media remain searchable", () => {
  const corpus = buildEducationCorpus([{ slug: "wiki/education/nested", title: "Nested", html: '<div><h2 id="nested">A nested section</h2><p>Before <img src="/assets/wiki/education/images/a.png" alt="A cartoon"> after.</p></div>' }], "commit-a");
  expect(corpus.sections[0].href).toBe("/education/nested/#nested");
  expect(corpus.sections[0].text).toContain("Before");
  expect(corpus.sections[0].text).toContain("after.");
  expect(corpus.sections[0].images.length).toBe(1);
});
test("public corpus rejects care paths, traversal, remote media and malformed versions", () => {
  const corpus = buildEducationCorpus(pages, "commit-a");
  for (const href of ["/wiki/care/plan", "/education/../care", "/education/%2e%2e/care", "https://attacker.test/education/a"]) {
    expect(EducationCorpusSchema.safeParse({ ...corpus, sections: [{ ...corpus.sections[0], href }] }).success).toBe(false);
  }
  expect(EducationCorpusSchema.safeParse({ ...corpus, version: 2 }).success).toBe(false);
  expect(EducationCorpusSchema.safeParse({ ...corpus, sections: [{ ...corpus.sections[0], images: [{ src: "https://diana-tnbc.com/api/file?path=wiki/care/secret.png", alt: "secret" }] }] }).success).toBe(false);
});
