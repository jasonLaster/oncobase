import { describe, expect, test } from "bun:test";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified, type PluggableList } from "unified";
import { remarkGfmParse, remarkMathParse } from "./remark-parse-only.ts";

const fixture = `# Fixture

| Left | Center | Right |
|:-----|:------:|------:|
| a \\| pipe | **bold** | \`code\` |
| ~~struck~~ | $x^2$ | www.example.com |

- [ ] open task
- [x] done task

Visit https://example.org/path?q=1 or mail someone@example.com.

A footnote reference[^note] and a second[^2].

[^note]: The note with *emphasis*.
[^2]: Another note.

$$
\\int_0^1 f(x)\\,dx
$$

Inline $a + b$ and escaped \\$5.
`;

function parse(plugins: PluggableList) {
  return unified().use(remarkParse).use(plugins).runSync(unified().use(remarkParse).use(plugins).parse(fixture));
}

function html(plugins: PluggableList) {
  return String(unified().use(remarkParse).use(plugins).use(remarkRehype).use(rehypeStringify).processSync(fixture));
}

describe("parse-only remark plugins", () => {
  test("build the same tree as remark-gfm and remark-math", () => {
    expect(parse([remarkGfmParse, remarkMathParse])).toEqual(parse([remarkGfm, remarkMath]));
  });

  test("render the same HTML", () => {
    const rendered = html([remarkGfmParse, remarkMathParse]);
    expect(rendered).toBe(html([remarkGfm, remarkMath]));
    for (const fragment of ["<table>", "<del>", 'type="checkbox"', "data-footnote-ref", "math-display", 'href="https://example.org/path?q=1"']) {
      expect(rendered).toContain(fragment);
    }
  });
});
