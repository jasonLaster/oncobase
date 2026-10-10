import { expect, test } from "bun:test";
import { compileEducation, localAssetPath } from "./content-format";
const page = { path: "wiki/education/course/index.md", raw: '# Course\n\n[[wiki/education/concepts/hla|HLA]]\n\n[Case](/wiki/care/index)\n\n<img data-theme-pair src="images/test-light.png" alt="Diagram">\n\n[Lab](tools/lab.zip)' };
const concept = { path: "wiki/education/concepts/hla.md", raw: "# HLA\n\nA concept." };
test("static diagrams inherit the app theme without remote font imports or source edits", () => {
  const raw = "# Diagram\n\n```mermaid\nflowchart TD\n A[Start] --> B[Finish]\n```";
  const [result] = compileEducation([{ path: "wiki/education/diagram.md", raw }], () => {});
  expect(result.html.match(/<svg\b/g)?.length).toBe(1);
  expect(result.html).toContain("--accent:var(--brand)");
  expect(result.html).toContain("--bg:var(--card)");
  expect(result.html).not.toContain("@import");
  expect(result.html).not.toContain("fonts.googleapis.com");
  expect(raw).toContain("A[Start] --> B[Finish]");
});
test("static host adapters preserve routes and map both theme assets and downloads", () => {
  const assets: string[] = [];
  const result = compileEducation([page, concept], path => assets.push(path));
  expect(result[0].html).toContain('href="/education/concepts/hla"');
  expect(result[0].html).toContain('href="https://diana-tnbc.com/wiki/care/index"');
  expect(assets).toContain("wiki/education/course/images/test-light.png");
  expect(assets).toContain("wiki/education/course/images/test-dark.png");
  expect(assets).toContain("wiki/education/course/tools/lab.zip");
  expect(result[0].html).not.toContain("/api/file");
  expect(page.raw).toContain('data-theme-pair src="images/test-light.png"');
});
test("legacy public Blob URLs resolve locally without mirroring other Diana assets", () => {
  expect(localAssetPath("https://public.blob.vercel-storage.com/sites/diana/files/wiki/education/images/a.png")).toBe("wiki/education/images/a.png");
  expect(() => localAssetPath("/api/file?path=wiki%2Fcare%2Fprivate.png")).toThrow("outside the public education corpus");
  expect(() => localAssetPath("/api/file?path=wiki%2Feducation%2F..%2Fcare.png")).toThrow();
  expect(() => localAssetPath("https://public.blob.vercel-storage.com/sites/diana/files/sources/private.png")).toThrow();
});
test("public source compilation rejects private markers and dangling education links", () => {
  for (const raw of ["---\nsensitive: true\n---\n# Private", "# Private\n<redact>Private</redact>"]) {
    expect(() => compileEducation([{ ...concept, raw }], () => {})).toThrow("Private content");
  }
  expect(() => compileEducation([{ ...concept, raw: "# HLA\n[[wiki/education/missing]]" }], () => {})).toThrow("Broken education link");
});
test("a missing inferred dark image fails the build even when the source names only the light image", () => {
  expect(() => compileEducation([page, concept], path => {
    if (path.endsWith("test-dark.png")) throw Error(`Missing asset: ${path}`);
  })).toThrow("Missing asset: wiki/education/course/images/test-dark.png");
});

test("learning lab frames and fallback links export one local HTML asset", () => {
  const assets = new Set<string>();
  const [result] = compileEducation([{ path: "wiki/education/tools/lab.md", raw: '# Learning lab\n\n<iframe data-education-lab title="Learning lab" src="../course/tools/lab.html" sandbox="allow-same-origin"></iframe>\n\n[Open lab](../course/tools/lab.html)' }], asset => assets.add(asset));
  expect([...assets]).toEqual(["wiki/education/course/tools/lab.html"]);
  expect(result.html).toContain('src="/assets/wiki/education/course/tools/lab.html"');
  expect(result.html).toContain('href="/assets/wiki/education/course/tools/lab.html"');
  expect(result.html).toContain('sandbox="allow-scripts allow-popups"');
  expect(result.html).not.toContain("/api/");
  expect(result.html).not.toContain("allow-same-origin");
  expect(() => compileEducation([{ path: "wiki/education/tools/lab.md", raw: '# Lab\n\n<iframe data-education-lab src="https://diana-tnbc.com/api/file?path=wiki/education/lab.html"></iframe>' }], () => {}))
    .toThrow("local HTML asset");
});
