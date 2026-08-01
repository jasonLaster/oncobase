import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WikiMarkdown } from "./index.tsx";
import {
  rendererParityFixtures,
  type RendererSemantics,
} from "./renderer-parity-fixtures.ts";
import { renderWikiMarkdownHtml } from "./server.ts";

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'");
}

function textContent(value: string) {
  return decodeHtml(
    value
      .replace(/<svg\b[\s\S]*?<\/svg>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function attribute(attributes: string, name: string) {
  return decodeHtml(
    attributes.match(new RegExp(`\\b${name}="([^"]*)"`, "i"))?.[1] ?? "",
  );
}

function cellText(rowHtml: string, cell: "td" | "th") {
  return Array.from(rowHtml.matchAll(new RegExp(`<${cell}\\b[^>]*>([\\s\\S]*?)<\\/${cell}>`, "gi")))
    .map((match) => textContent(match[1]));
}

function normalizeRendererSemantics(html: string): RendererSemantics {
  const headings = Array.from(
    html.matchAll(/<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi),
  ).map((match) => ({
    level: Number(match[1]),
    id: attribute(match[2], "id"),
    text: textContent(match[3]),
  }));
  const links = Array.from(html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)).map(
    (match) => ({
      href: attribute(match[1], "href"),
      pdf: /\bclass="[^"]*\bpdf-chip\b/.test(match[1]),
      target: attribute(match[1], "target"),
      text: textContent(match[2]),
    }),
  );
  const images = Array.from(html.matchAll(/<img\b([^>]*)\/?\s*>/gi)).map((match) => ({
    alt: attribute(match[1], "alt"),
    src: attribute(match[1], "src"),
    theater: /\bdata-theater-image(?:=|\s|$)/.test(match[1]),
  }));
  const redactions = Array.from(
    html.matchAll(/<redact\b([^>]*)>([\s\S]*?)<\/redact>/gi),
  ).map((match) => ({
    label: attribute(match[1], "label"),
    text: textContent(match[2]),
  }));
  const tables = Array.from(html.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi)).map(
    (match) => {
      const head = match[2].match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i)?.[1] ?? "";
      const body = match[2].match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] ?? "";
      return {
        headers: cellText(head, "th"),
        rows: Array.from(body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)).map(
          (row) => cellText(row[1], "td"),
        ),
        smart: /\bdata-smart-table(?:=|\s|$)/.test(match[1]),
      };
    },
  );

  return { headings, images, links, redactions, tables };
}

describe("server and React renderer parity", () => {
  for (const fixture of rendererParityFixtures) {
    test(fixture.name, () => {
      const server = normalizeRendererSemantics(
        renderWikiMarkdownHtml(fixture.markdown, fixture.currentSlug),
      );
      const react = normalizeRendererSemantics(
        renderToStaticMarkup(
          createElement(WikiMarkdown, {
            content: fixture.markdown,
            currentSlug: fixture.currentSlug,
          }),
        ),
      );

      expect(server).toEqual(fixture.expected);
      expect(react).toEqual(fixture.expected);
      expect(server).toEqual(react);
    });
  }
});
