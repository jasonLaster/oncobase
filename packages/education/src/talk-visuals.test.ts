import { expect, test } from "bun:test";
import { buildEducationVisuals } from "./talk-visuals";

const page = (html: string) => [{ slug: "wiki/education/adcs", title: "ADCs", html }];
const diagram = '<div class="mermaid-diagram"><svg><style>text { color: red; }</style><g><text>Antibody</text><text>Payload</text></g></svg></div>';

test("records diagrams and tables under their real section, with text the model can choose by", () => {
  const visuals = buildEducationVisuals(page(`<p>Intro.</p>${diagram}<h2 id="how">How it works</h2><div>${diagram}</div><table><tr><th>Part</th><td>Job</td></tr></table>`));
  expect(visuals.map(visual => [visual.id, visual.kind, visual.heading])).toEqual([
    ["/education/adcs/::diagram-0", "diagram", "Start here"],
    ["/education/adcs/#how::diagram-1", "diagram", "How it works"],
    ["/education/adcs/#how::table-2", "table", "How it works"],
  ]);
  expect(visuals[0]!.label).toBe("Antibody · Payload");
  expect(visuals[0]!.label).not.toContain("color");
  expect(visuals[1]!.html).toBe(diagram);
  expect(visuals[2]!.label).toContain("Part");
  expect(visuals[2]!.href).toBe("/education/adcs/#how");
});

test("removes links, which would reload the page and hang up", () => {
  const [table] = buildEducationVisuals(page('<table><tr><td><a href="/education/x/">Term</a></td></tr></table>'));
  expect(table!.html).toBe("<table><tr><td>Term</td></tr></table>");
});

test("skips diagrams that only show progress through a guide", () => {
  expect(buildEducationVisuals(page(`<h2 id="step">Where this step sits</h2>${diagram}<h2 id="next">Next</h2>${diagram}`)).map(visual => visual.heading)).toEqual(["Next"]);
});

test("skips tables on index pages, which list lessons, but keeps their diagrams", () => {
  const visuals = buildEducationVisuals([{ slug: "wiki/education/concepts/index", title: "Concepts", html: `<table><tr><td>Lesson</td></tr></table>${diagram}` }]);
  expect(visuals.map(visual => visual.kind)).toEqual(["diagram"]);
});
