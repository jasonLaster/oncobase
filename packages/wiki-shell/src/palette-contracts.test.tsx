import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WikiFilePalette } from "./file-palette.tsx";
import { WikiSearchModeToggle } from "./search.tsx";

const pages = [
  { name: "Insurance", slug: "wiki/logistics/insurance", path: "wiki / logistics / insurance" },
  { name: "Medical Team", slug: "wiki/people/medical-team", path: "wiki / people / medical-team" },
];

describe("UI SDK palette contracts", () => {
  test("the file palette is a named dialog around the Search pages combobox", () => {
    const html = renderToStaticMarkup(
      <WikiFilePalette open onOpenChange={() => {}} onSelectPage={() => {}} pages={pages} />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('data-test-id="command-palette"');
    expect(html).toMatch(/<input[^>]*aria-label="Search pages"[^>]*data-test-id="command-palette-input"[^>]*role="combobox"/);
    expect(html).toContain('id="page-palette-list"');
    // The outline mode collects page headings, so the hidden title must not be one.
    expect(html).toMatch(/<div[^>]*data-slot="dialog-title"[^>]*>Go to page<\/div>/);
    expect(html).not.toMatch(/<h\d[^>]*>Go to page/);
  });

  test("a closed file palette renders nothing", () => {
    expect(
      renderToStaticMarkup(
        <WikiFilePalette open={false} onOpenChange={() => {}} onSelectPage={() => {}} pages={pages} />,
      ),
    ).toBe("");
  });

  test("the search mode toggle is a named radio group that checks the pressed option", () => {
    const html = renderToStaticMarkup(
      <WikiSearchModeToggle
        options={[
          { key: "ai", label: "AI Mode", onSelect: () => {}, pressed: false },
          { key: "text", label: "Text Search", onSelect: () => {}, pressed: true },
        ]}
      />,
    );
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Search mode"');
    expect(html).toMatch(/aria-checked="false"[^>]*>AI Mode/);
    expect(html).toMatch(/aria-checked="true"[^>]*>Text Search/);
  });
});
