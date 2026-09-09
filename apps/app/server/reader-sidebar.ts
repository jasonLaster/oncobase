import { formatFileLabel } from "@oncobase/wiki-content/file-labels";
import { createElement } from "react";
import type { FileNode } from "@oncobase/wiki-content";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ChevronDown,
  ClipboardCheck,
  LogIn,
  MessageSquareText,
  MessageSquare,
  AlignLeft,
  Search,
  WandSparkles,
} from "lucide-react";
import { MobileChatIcon, nodeIcon } from "../src/shell/navigation-icons";
const iconMarkup = new Map<unknown, Map<boolean, string>>();
export function renderSidebarIcon(
  node: FileNode,
  active = false,
  open = false,
) {
  const icon = nodeIcon({ node, active, open, depth: 0 });
  let variants = iconMarkup.get(icon.type);
  if (!variants) {
    variants = new Map<boolean, string>();
    iconMarkup.set(icon.type, variants);
  }
  let html = variants.get(active);
  if (!html) {
    html = renderToStaticMarkup(icon);
    variants.set(active, html);
  }
  return html;
}
export function renderReaderSidebar(treeHtml: string, url: URL) {
  let name = url.pathname.split("/").filter(Boolean).at(-1) ?? "Home";
  try { name = decodeURIComponent(name); } catch { /* Preserve malformed display paths. */ }
  const mobileTitle = formatFileLabel(name);
  const signin = new URL(url);
  signin.searchParams.set("html-first", "off");
  signin.searchParams.set("reader-action", "signin");
  return renderToStaticMarkup(
    createElement(
      "aside",
      {
        className: "html-first-navigation wiki-shell-sidebar sidebar",
        "aria-label": "Site navigation",
      },
      createElement(
        "div",
        {
          className: "wiki-shell-sidebar-heading",
        },
        createElement(
          "div",
          {
            className: "wiki-vite-sidebar-workspace-row",
          },
          createElement(
            "a",
            {
              className: "wiki-vite-sidebar-workspace",
              href: "/",
              "aria-label": "Home",
            },
            createElement(
              "svg",
              {
                "aria-hidden": "true",
                className: "wiki-vite-sidebar-logo",
                width: "22",
                height: "22",
                viewBox: "0 0 32 32",
              },
              createElement("rect", {
                width: "32",
                height: "32",
                rx: "6",
                fill: "#4f46e5",
              }),
              createElement(
                "text",
                {
                  x: "16",
                  y: "23",
                  fill: "white",
                  fontFamily: "system-ui, -apple-system, sans-serif",
                  fontSize: "22",
                  fontWeight: "700",
                  textAnchor: "middle",
                },
                "D",
              ),
            ),
            createElement("span", null, "Diana TNBC"),
            createElement(ChevronDown, {
              size: 14,
              "aria-hidden": "true",
            }),
          ),
        ),
      ),
      createElement("div", { className: "html-first-mobile-title wiki-vite-mobile-title" }, mobileTitle),
      createElement("a", { className: "html-first-mobile-action", href: "/search", "aria-label": "Search files" }, createElement(Search, { size: 18, "aria-hidden": true })),
      createElement("a", { className: "html-first-mobile-action", href: "/comments", "aria-label": "Open comments" }, createElement(MessageSquare, { size: 18, "aria-hidden": true })),
      createElement(
        "details",
        {
          className: "html-first-files",
          open: true,
        },
        createElement("summary", { "aria-label": "Open page navigation" }, createElement(AlignLeft, { size: 17, "aria-hidden": true }), createElement("span", { className: "sr-only" }, "Files")),
        createElement(
          "nav",
          {
            className: "wiki-shell-sidebar-nav",
            "aria-label": "Files",
          },
          createElement(
            "a",
            {
              href: "/comments",
              className: "wiki-shell-tree-link comments-tree-link",
              style: { paddingLeft: 12 },
            },
            createElement(MessageSquareText, {
              size: 16,
              "aria-hidden": "true",
            }),
            createElement(
              "span",
              {
                className: "wiki-shell-tree-label",
              },
              "Comments",
            ),
          ),
          createElement(
            "a",
            {
              href: "/diagnostics",
              className: "wiki-shell-tree-link diagnostics-tree-link",
              style: { paddingLeft: 12 },
            },
            createElement(ClipboardCheck, {
              size: 16,
              "aria-hidden": "true",
            }),
            createElement(
              "span",
              {
                className: "wiki-shell-tree-label",
              },
              "Diagnostics",
            ),
          ),
          createElement("div", {
            className: "html-first-tree wiki-shell-tree-root",
            dangerouslySetInnerHTML: { __html: treeHtml },
          }),
        ),
      ),
      createElement(
        "div",
        {
          className: "wiki-shell-sidebar-footer",
        },
        createElement(
          "div",
          {
            className: "wiki-vite-sidebar-footer",
          },
          createElement(
            "div",
            {
              className: "wiki-shell-sidebar-sign-in",
            },
            createElement(
              "p",
              null,
              "Sign in to comment and view additional content",
            ),
            createElement(
              "a",
              {
                className: "html-first-sign-in",
                href: signin.pathname + signin.search,
              },
              createElement(LogIn, {
                size: 16,
                "aria-hidden": "true",
              }),
              createElement("span", null, "Sign in"),
            ),
          ),
          createElement(
            "div",
            {
              className: "wiki-vite-sidebar-footer-pills",
            },
            createElement(
              "a",
              {
                href: "/chat",
              },
              createElement(WandSparkles, {
                size: 16,
                "aria-hidden": "true",
              }),
              createElement("span", null, "Ask wiki"),
            ),
            createElement("span", {
              className: "wiki-vite-sidebar-footer-separator",
              "aria-hidden": true,
            }),
            createElement(
              "a",
              {
                className: "html-first-search",
                href: "/search",
              },
              createElement(Search, {
                size: 16,
                "aria-hidden": "true",
              }),
              createElement("span", null, "Search"),
              createElement("kbd", null, "⌘K"),
            ),
          ),
        ),
      ),
      createElement("a", { href: "/chat", className: "wiki-vite-mobile-ask", "aria-label": "Ask wiki" }, createElement(MobileChatIcon)),
    ),
  );
}
