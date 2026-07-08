import { describe, expect, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  preprocessCitations,
  resolveAssetPath,
  resolveHref,
  resolveWikilinks,
  SlidesViewer,
  splitWikilinkAlias,
  WikiMarkdown,
} from "./index.tsx";

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

  test("encodes route links with spaces instead of hyphenizing them", () => {
    expect(resolveWikilinks("[[about/log/June 2026|June 2026]]")).toBe(
      "[June 2026](/about/log/June%202026)",
    );
    expect(resolveWikilinks("[[about/log/April 16-30 2026|April]]")).toBe(
      "[April](/about/log/April%2016-30%202026)",
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

  test("renders a reusable slides viewer from an image list", () => {
    const html = renderToStaticMarkup(
      createElement(SlidesViewer, {
        currentSlug: "wiki/research/index",
        images: [
          { src: "images/first.png", alt: "First scan" },
          { src: "images/second.png", alt: "Second scan" },
        ],
      }),
    );

    expect(html).toContain('class="wiki-slides-viewer"');
    expect(html).toContain('data-wiki-slides=""');
    expect(html).toContain('aria-label="Previous slide"');
    expect(html).toContain('aria-label="Next slide"');
    expect(html).toContain('data-theater-image=""');
    expect(html).toContain("1 / 2");
    expect(html).toContain('src="/api/file?path=wiki%2Fresearch%2Fimages%2Ffirst.png"');
    expect(html).toContain('alt="Second scan"');
  });

  test("sorts reusable dated slides from newest to oldest", () => {
    const html = renderToStaticMarkup(
      createElement(SlidesViewer, {
        currentSlug: "wiki/diagnostics/index",
        images: [
          { src: "images/mri-04-10.png", alt: "MRI 04-10" },
          { src: "images/pet-2026-05-08.png", alt: "PET" },
          { src: "images/ct-march-28.png", alt: "CT March 28 2026" },
        ],
      }),
    );

    expect(html.indexOf("pet-2026-05-08.png")).toBeLessThan(
      html.indexOf("mri-04-10.png"),
    );
    expect(html.indexOf("mri-04-10.png")).toBeLessThan(
      html.indexOf("ct-march-28.png"),
    );
  });
});
