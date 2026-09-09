import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { markdownTitleToText } from "@oncobase/wiki-markdown/title";
import { CopyPageIcon } from "../src/shell/copy-page-icon";

/** The same header structure and CSS classes as WikiPageHeader, before React boots. */
export function renderReaderPageHeader(page: { slug: string; title: string; tags?: string[] }) {
  if (page.slug === "index") return "";
  return renderToStaticMarkup(h("header", { className: "wiki-shell-page-header" },
    h("div", { className: "wiki-shell-page-header-main" },
      h("div", { className: "wiki-shell-page-title-row" },
        h("h1", null, markdownTitleToText(page.title)),
        h("div", { className: "wiki-shell-page-inline-actions" },
          h("div", { className: "wiki-vite-title-copy" },
            h("button", { className: "wiki-shell-page-action page-action", "data-reader-copy": true,
              disabled: true, "aria-label": "Copy page as markdown", title: "Available when the interactive reader loads" }, h(CopyPageIcon))))),
      page.tags?.length ? h("div", { className: "wiki-shell-page-metadata" },
        h("div", { className: "wiki-shell-tag-row tag-row" }, page.tags.map(tag =>
          h("a", { key: tag, href: `/tags/${encodeURIComponent(tag)}` }, tag)))) : null)));
}
