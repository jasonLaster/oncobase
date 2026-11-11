import { expect, test } from "bun:test";
import { buildEducationVisuals, svgWords } from "./visual-index";
import { searchVisuals, visualCaption, visualForModel } from "./visuals";

const build = (html: string, slug = "wiki/education/adcs", title = "ADCs") => buildEducationVisuals([{ slug, title, html }], "commit-a");
const diagram = '<div class="mermaid-diagram"><svg><style>text { color: red; }</style><g><text>Antibody</text><text>Payload</text></g></svg></div>';
const cartoon = (name: string, alt = "A cartoon") => `<img src="/assets/wiki/education/images/${name}-light.svg" alt="${alt}"><img src="/assets/wiki/education/images/${name}-dark.svg" alt="${alt}">`;

test("records diagrams and tables under their real section, with text the model can choose by", () => {
  const { catalog, fragments } = build(`<p>Intro.</p>${diagram}<h2 id="how">How it works</h2><div>${diagram}</div><table><tr><th>Part</th><td>Job</td></tr></table>`);
  expect(catalog.contentCommit).toBe("commit-a");
  expect(catalog.visuals.map(visual => [visual.id, visual.kind, visual.heading])).toEqual([
    ["/education/adcs/::diagram-0", "diagram", "Start here"],
    ["/education/adcs/#how::diagram-0", "diagram", "How it works"],
    ["/education/adcs/#how::table-0", "table", "How it works"],
  ]);
  expect(catalog.visuals[0]!.label).toBe("Antibody · Payload");
  expect(catalog.visuals[0]!.label).not.toContain("color");
  expect(catalog.visuals[2]!.label).toContain("Part");
  expect(catalog.visuals[2]!.href).toBe("/education/adcs/#how");
  // The same diagram twice is one file. Markup stays out of the catalog.
  expect(catalog.visuals[0]!.fragment).toBe(catalog.visuals[1]!.fragment);
  expect(fragments[catalog.visuals[0]!.fragment!]).toBe(diagram);
  expect(Object.keys(fragments)).toHaveLength(2);
  expect(JSON.stringify(catalog)).not.toContain("<svg");
});

test("a visual added in another section does not change existing ids", () => {
  const before = build(`<h2 id="a">A</h2><p>Text.</p><h2 id="b">B</h2>${diagram}`).catalog.visuals.map(visual => visual.id);
  const after = build(`<h2 id="a">A</h2>${diagram}<table><tr><td>x</td></tr></table><h2 id="b">B</h2>${diagram}`).catalog.visuals.map(visual => visual.id);
  expect(after).toContain(before[0]!);
});

test("cartoons pair their dark version, are named by their file and carry the lesson's caption", () => {
  const { catalog } = build(`<h2 id="how">How it works</h2>${cartoon("marker-recovery-v1", "Blood sample split by marker")}\n<p><em>This cartoon shows one workflow, not a measured proportion.</em></p><p>Blood contains many cells.</p>`);
  expect(catalog.visuals).toEqual([expect.objectContaining({
    id: "/education/adcs/#how::marker-recovery-v1", kind: "cartoon", label: "Blood sample split by marker",
    caption: "This cartoon shows one workflow, not a measured proportion.",
    src: "/assets/wiki/education/images/marker-recovery-v1-light.svg", darkSrc: "/assets/wiki/education/images/marker-recovery-v1-dark.svg",
  })]);
  expect(visualCaption(catalog.visuals[0]!)).toBe("This cartoon shows one workflow, not a measured proportion.");
  expect(visualForModel(catalog.visuals[0]!)).toEqual({ id: "/education/adcs/#how::marker-recovery-v1", kind: "cartoon", shows: "Blood sample split by marker", caption: "This cartoon shows one workflow, not a measured proportion." });
});

test("finds a caption outside a frame around the visual, but never takes ordinary prose", () => {
  const framed = build(`<div class="cartoon-frame"><p>${cartoon("framed")}</p></div><p><em>Framed caption.</em></p>${diagram}<p><em>Diagram caption.</em></p>`).catalog.visuals;
  expect(framed.map(visual => visual.caption)).toEqual(["Framed caption.", "Diagram caption."]);
  const plain = build(`${cartoon("plain", "Alt text")}<p>The next paragraph, with <em>emphasis</em>.</p>${diagram}<p>More prose.</p>`).catalog.visuals;
  expect(plain.map(visual => visual.caption)).toEqual(["", ""]);
  expect(plain.map(visualCaption)).toEqual(["Alt text", "Start here"]);
  const marked = build(`<div class="cartoon-frame">${cartoon("marked")}<p class="cartoon-caption">Glyphs show relative material.</p></div>${cartoon("lead")}<p><em>Four physical problems, selected repair jobs.</em> DNA is drawn uncoiled.</p>${cartoon("word")}<p><em>Note</em> the next step.</p>`).catalog.visuals;
  expect(marked.map(visual => visual.caption)).toEqual(["Glyphs show relative material.", "Four physical problems, selected repair jobs. DNA is drawn uncoiled.", ""]);
  const inside = build(`<div><p>Explanation beside the picture.</p>${cartoon("inside")}</div><p><em>Not this picture's caption.</em></p>`).catalog.visuals;
  expect(inside[0]!.caption).toBe("");
});

test("skips progress diagrams, index-page tables, register pages and images from elsewhere", () => {
  expect(build(`<h2 id="step">Where this step sits</h2>${diagram}<h2 id="next">Next</h2>${diagram}`).catalog.visuals.map(visual => visual.heading)).toEqual(["Next"]);
  expect(build(`<table><tr><td>Lesson</td></tr></table>${diagram}`, "wiki/education/concepts/index", "Concepts").catalog.visuals.map(visual => visual.kind)).toEqual(["diagram"]);
  expect(build(cartoon("listed"), "wiki/education/images/index", "Education illustration register").catalog.visuals).toEqual([]);
  expect(build('<img src="https://example.com/x.png" alt="Remote">').catalog.visuals).toEqual([]);
});

test("removes links, which would reload the page and hang up", () => {
  const { catalog, fragments } = build('<table><tr><td><a href="/education/x/">Term</a></td></tr></table>');
  expect(fragments[catalog.visuals[0]!.fragment!]).toBe("<table><tr><td>Term</td></tr></table>");
});

test("searches visuals by what they show and by their caption", () => {
  const { visuals } = build(`<h2 id="a">Capture</h2>${cartoon("capture", "Marker enrichment of circulating cells")}<h2 id="b">Payload</h2>${cartoon("payload", "A linker releases the payload")}<p><em>Bystander killing of neighbouring cells.</em></p>`).catalog;
  expect(searchVisuals(visuals, "circulating cells enrichment")[0]!.id).toContain("capture");
  expect(searchVisuals(visuals, "bystander killing")[0]!.id).toContain("payload");
});

test("a cartoon is also described by the words drawn on it and the brief it was drawn from", () => {
  const files: Record<string, string> = {
    "wiki/education/images/payload-light.svg": '<svg><style>.a{}</style><text x="1">Antibody</text><text><tspan>Cleavable</tspan> <tspan>linker</tspan></text><text>Antibody</text><text>Bystander &amp; target</text></svg>',
    "wiki/education/images/prompts/payload.txt": "Draw   one antibody releasing its payload\nnear a neighbouring cell.",
  };
  const [visual] = buildEducationVisuals([{ slug: "wiki/education/adcs", title: "ADCs", html: cartoon("payload", "Payload release") }], "c", { readText: file => files[file] }).catalog.visuals;
  expect(visual!.words).toBe("Antibody · Cleavable linker · Bystander & target");
  expect(visual!.brief).toBe("Draw one antibody releasing its payload near a neighbouring cell.");
  expect(visualForModel(visual!)).toEqual(expect.objectContaining({ words_on_it: "Antibody · Cleavable linker · Bystander & target" }));
  // The brief states intent, so the tutor never reads it as a description.
  expect(JSON.stringify(visualForModel(visual!))).not.toContain("neighbouring");
  expect(searchVisuals([visual!], "neighbouring cell")[0]).toBe(visual!);
  expect(svgWords("<svg><rect/></svg>")).toBe("");
});

test("keeps the lesson's own question about a visual, with its answer", () => {
  const [asked, plain] = build(`${cartoon("asked")}<p><em>Caption.</em></p><p><strong>Read the illustration:</strong> Why are fragments drawn outside?</p><p><strong>Answer:</strong> They are another analyte.</p><h2 id="b">B</h2>${cartoon("plain")}<p><strong>Answer:</strong> Unrelated.</p>`).catalog.visuals;
  expect([asked!.caption, asked!.question, asked!.answer]).toEqual(["Caption.", "Why are fragments drawn outside?", "They are another analyte."]);
  expect(plain!.question).toBeUndefined();
});

test("describes a table by its columns, rows and the sentence that introduces it", () => {
  const [table] = build('<p>The families differ in what they read:</p><table><tr><th>Family</th><th>Recognition</th></tr><tr><td>CAR-T</td><td>Surface antigen</td></tr><tr><td>TCR-T</td><td>Peptide–HLA</td></tr></table>').catalog.visuals;
  expect(table!.label).toBe("The families differ in what they read: Columns: Family, Recognition. Rows: CAR-T, TCR-T. Surface antigen Peptide–HLA");
});

test("carries lessons into the catalog", () => {
  const lesson = { slug: "wiki/education/adcs", title: "ADCs", href: "/education/adcs/", summary: "An antibody that carries a drug.", level: "foundation" as const, aliases: ["ADC"], prerequisites: [], usedBy: [], objectives: [] };
  expect(buildEducationVisuals([], "c", { lessons: [lesson] }).catalog.lessons).toEqual([lesson]);
});
