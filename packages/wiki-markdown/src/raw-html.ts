/**
 * rehype-raw (hast-util-raw and parse5, about 50 KiB gzip) only does work when
 * the tree holds `raw` nodes, which come from HTML in the prepared markdown:
 * authored tags, drug-term `<abbr>`, and the markup that the citation and
 * slides preprocessors write. A document without any, or with only comments,
 * renders the same through the light plugins (`raw-html-equivalent.ts`), so
 * the browser reader loads rehype-raw only for documents that need it.
 * renderer-raw-html.test.tsx proves the equivalence on the fixture and perf
 * vaults; it also held on every page of the production vault (9,896 pages).
 */

// The CommonMark constructs that produce HTML (`raw`) nodes, as a superset:
// - an open tag or HTML block start: `<` + tag name + whitespace, `/`, `>` or end;
// - a closing tag: `</` + letter;
// - a comment, declaration, CDATA or processing instruction: `<!`, `<?`.
// Autolinks (`<https://…>`, `<a@b.c>`) never match: a scheme or address is
// followed by `:` or `@`, not by whitespace, `/` or `>`. Matches inside code
// and escaped `\<` are false positives, which cost a download, never output.
const RAW_HTML_START = /<(?:[A-Za-z][A-Za-z0-9-]*(?=[\s/>]|$)|\/[A-Za-z]|[!?])/;

// A comment that parse5 reads exactly as written and that is a raw node of its
// own: no `--!>` (which also closes a comment), not the abrupt `<!-->` /
// `<!--->` forms, and nothing but whitespace after it on its line (an HTML
// block keeps the rest of its closing line, which would then print as text).
// The body may not hold `<`: the stripped span can then hide no other HTML,
// even when the `<!--` sits in a code span and the `-->` is lines later.
const COMMENT = String.raw`<!--(?!-?>)(?:(?!--!?>)[^<])*-->`;
const STRICT_COMMENT = new RegExp(`${COMMENT}(?=[ \t]*(?:\r?\n|$))`, "g");
const ONLY_STRICT_COMMENTS = new RegExp(`^\\s*(?:${COMMENT}\\s*)+$`);

/** True unless the document's only HTML is complete comments. Takes the
 * markdown after the reader's preprocessing (`prepareWikiMarkdown`). */
export function mayContainRawHtml(prepared: string): boolean {
  if (!RAW_HTML_START.test(prepared)) return false;
  return RAW_HTML_START.test(prepared.replace(STRICT_COMMENT, ""));
}

export type HastNode = { type: string; value?: string; children?: HastNode[] };

export function isRawComment(node: HastNode): boolean {
  return node.type === "raw" && typeof node.value === "string" && ONLY_STRICT_COMMENTS.test(node.value);
}

