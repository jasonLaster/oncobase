import { expect, test } from "bun:test";
import { buildEducationCorpus } from "./chat-index";
import { lessonAtPath, normalizeEducationPath, runTalkLibraryTool, talkSessionConfig, TALK_TOOLS } from "./talk";

const corpus = buildEducationCorpus([
  { slug: "wiki/education/adcs", title: "Antibody-drug conjugates", html: '<p>Overview.</p><h2 id="payload">The payload</h2><p>An antibody drug conjugate delivers a toxic payload to a tumor cell.</p><img src="/assets/wiki/education/images/adc-light.png" alt="ADC cartoon">' },
  { slug: "wiki/education/dna", title: "DNA repair", html: `<h2 id="repair">Repair</h2><p>${"Cells repair damaged DNA. ".repeat(600)}</p>` },
], "commit-a");
const id = "/education/adcs/#payload";

test("search uses chat's ranking and expansions, and returns section ids", () => {
  const { results } = runTalkLibraryTool(corpus, "search_education", { query: "ADCs" }) as { results: Array<{ id: string; illustrations: string[] }> };
  expect(results[0]!.id).toBe(id);
  expect(results[0]!.illustrations).toEqual(["ADC cartoon"]);
});

test("search keeps spoken turns small and tells the model when nothing matches", () => {
  const { results } = runTalkLibraryTool(corpus, "search_education", { query: "damaged DNA repair" }) as { results: Array<{ text: string }> };
  expect(results[0]!.text.length).toBe(800);
  const empty = runTalkLibraryTool(corpus, "search_education", { query: "zebrafish" }) as { results: unknown[]; note: string };
  expect(empty.results).toEqual([]);
  expect(empty.note).toContain("not covered");
});

test("reads real sections and lessons only", () => {
  expect(runTalkLibraryTool(corpus, "read_section", { section_id: id })).toMatchObject({ heading: "The payload", pageTitle: "Antibody-drug conjugates" });
  expect(runTalkLibraryTool(corpus, "read_section", { section_id: "/education/secret/" })).toHaveProperty("error");
  expect(runTalkLibraryTool(corpus, "lesson_sections", { slug: "wiki/education/adcs" })).toEqual({ sections: [{ id: "/education/adcs/", heading: "Start here" }, { id, heading: "The payload" }] });
  expect(runTalkLibraryTool(corpus, "lesson_sections", { slug: "wiki/care/plan" })).toHaveProperty("error");
});

test("leaves page tools to the caller", () => {
  expect(runTalkLibraryTool(corpus, "open_page", { section_id: id })).toBeUndefined();
});

test("resolves reader paths, aliases and anchors to lessons", () => {
  expect(normalizeEducationPath("/wiki/education/adcs")).toBe("/education/adcs/");
  expect(normalizeEducationPath("/education/adcs/?x=1#payload")).toBe("/education/adcs/");
  expect(normalizeEducationPath("/")).toBe("/");
  expect(lessonAtPath(corpus, "/wiki/education/dna/")?.pageTitle).toBe("DNA repair");
  expect(lessonAtPath(corpus, "/education/search/")).toBeUndefined();
});

test("every tool in the session has a strict schema", () => {
  expect(talkSessionConfig().tools).toBe(TALK_TOOLS);
  for (const tool of TALK_TOOLS) expect(tool.parameters.additionalProperties).toBe(false);
});
