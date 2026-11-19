import { gfmFromMarkdown } from "mdast-util-gfm";
import { mathFromMarkdown } from "mdast-util-math";
import { gfm, type Options as GfmOptions } from "micromark-extension-gfm";
import { math } from "micromark-extension-math";

// remark-gfm and remark-math also register their markdown serializers
// (mdast-util-to-markdown, markdown-table and each extension's to-markdown
// half). Nothing here turns a tree back into markdown, so these plugins add
// only the parser and tree-building halves, which keeps the serializers out of
// the reader's paint bundle. Output is identical; the tests in
// remark-parse-only.test.ts compare against the full plugins.

type ParserData = {
  micromarkExtensions?: unknown[];
  fromMarkdownExtensions?: unknown[];
};

function addParser(processor: unknown, syntax: unknown, fromMarkdown: unknown) {
  const data = (processor as { data(): ParserData }).data();
  (data.micromarkExtensions ??= []).push(syntax);
  (data.fromMarkdownExtensions ??= []).push(fromMarkdown);
}

export function remarkGfmParse(this: unknown, options?: GfmOptions) {
  addParser(this, gfm(options), gfmFromMarkdown());
}

// apps/app aliases `remark-gfm` to this module so dependencies that render
// with remark-gfm (streamdown in chat) don't keep the serializer reachable.
export default remarkGfmParse;

export function remarkMathParse(this: unknown) {
  addParser(this, math(), mathFromMarkdown());
}
