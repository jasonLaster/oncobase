import { describe, expect, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  preprocessCitations,
  resolveAssetPath,
  resolveHref,
  resolveWikilinks,
  splitWikilinkAlias,
  WikiMarkdown,
} from "./index";

describe("wiki markdown helpers", () => {
  test("splits wikilink aliases", () => {
    expect(splitWikilinkAlias("wiki/foo|Foo")).toEqual({
      target: "wiki/foo",
      display: "Foo",
    });
  });

  test("resolves wikilinks and pdfs", () => {
    expect(resolveWikilinks("[[wiki/foo|Foo]] and [[paper.pdf]]", "wiki/current")).toBe(
      "[Foo](/wiki/foo) and [paper](/api/file?path=wiki%2Fpaper.pdf)",
    );
  });

  test("rewrites relative asset paths", () => {
    expect(resolveAssetPath("images/scan.png", "wiki/diagnostics/index")).toBe(
      "wiki/diagnostics/images/scan.png",
    );
  });

  test("normalizes markdown and pdf hrefs", () => {
    expect(resolveHref("foo.md#bar")).toBe("foo#bar");
    expect(resolveHref("paper.pdf", "wiki/research/index")).toBe(
      "/api/file?path=wiki%2Fresearch%2Fpaper.pdf",
    );
  });

  test("turns citations into markdown links", () => {
    expect(preprocessCitations("Finding [1] and gene^{2-3}")).toContain(
      "[[1]](#references)",
    );
  });

  test("renders Mermaid fences with a client-safe fallback", () => {
    const html = renderToStaticMarkup(
      createElement(WikiMarkdown, {
        content: `# Timeline

\`\`\`mermaid
gantt
  title Care Timeline
  dateFormat  YYYY-MM-DD
  section Treatment
  Chemo :done, 2026-04-01, 7d
\`\`\`
`,
      }),
    );

    expect(html).toContain('data-test-id="mermaid-diagram"');
    expect(html).toContain("Care Timeline");
    expect(html).toContain("Chemo");
    expect(html).toContain("gantt");
  });

  test("uses the route-link adapter for internal wiki links only", () => {
    const LinkComponent = ({
      children,
      href,
    }: {
      children?: ReactNode;
      href?: string;
    }) => createElement("router-link", { href }, children);
    const html = renderToStaticMarkup(
      createElement(WikiMarkdown, {
        content: "[Diagnosis](/wiki/diagnostics/diagnosis) and [PDF](paper.pdf)",
        currentSlug: "wiki/research/index",
        LinkComponent,
      }),
    );

    expect(html).toContain('<router-link href="/wiki/diagnostics/diagnosis">Diagnosis</router-link>');
    expect(html).toContain('href="/api/file?path=wiki%2Fresearch%2Fpaper.pdf"');
  });
});
