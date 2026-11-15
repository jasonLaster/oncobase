import { useNavigate } from "react-router";
import { collectHeadings, useWebMcpTools, webMcpError, type WebMcpTool } from "@oncobase/wiki-shell/webmcp";

/** The marketing site's markdown twins (public/*.md, llms.txt). */
const DOCS = {
  features: { href: "/features.md", page: "/features", about: "Every Oncobase feature, grouped, with the interface behind each one." },
  compare: { href: "/compare.md", page: "/compare", about: "How Oncobase compares with other ways to publish a research wiki." },
  overview: { href: "/llms.txt", page: "/", about: "A short overview of Oncobase for AI agents, with links." },
} as const;
type DocName = keyof typeof DOCS;
const PAGES = ["/", "/features", "/compare"] as const;

/** WebMCP tools for the Oncobase marketing pages (home, features, compare). */
export function MarketingWebMcp() {
  const navigate = useNavigate();
  const tools: WebMcpTool[] = [
    {
      name: "read_docs",
      title: "Read Oncobase docs",
      description: `Read Oncobase's product docs as markdown. doc is one of: ${Object.entries(DOCS).map(([name, doc]) => `"${name}" (${doc.about})`).join("; ")}.`,
      inputSchema: {
        type: "object",
        properties: { doc: { type: "string", enum: Object.keys(DOCS) } },
        required: ["doc"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: async (input, { signal }) => {
        const doc = DOCS[input.doc as DocName];
        if (!doc) return webMcpError(`doc must be one of ${Object.keys(DOCS).join(", ")}.`);
        const response = await fetch(doc.href, { signal });
        if (!response.ok) return webMcpError(`Could not load ${doc.href} (${response.status}).`);
        const content = await response.text();
        return { doc: input.doc, page: doc.page, content: content.slice(0, 30_000), truncated: content.length > 30_000 };
      },
    },
    {
      name: "get_current_view",
      title: "What the visitor is looking at",
      description: "The Oncobase page the visitor has open, with its headings.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: () => ({
        href: `${window.location.pathname}${window.location.hash}`,
        title: document.title,
        headings: collectHeadings(document.querySelector("main") ?? document, "h1, h2, h3").map(({ text, level }) => ({ text, level })),
        pages: PAGES,
      }),
    },
    {
      name: "open_page",
      title: "Open an Oncobase page",
      description: `Show the visitor one of the Oncobase pages: ${PAGES.join(", ")}.`,
      inputSchema: {
        type: "object",
        properties: { path: { type: "string", enum: [...PAGES] } },
        required: ["path"],
        additionalProperties: false,
      },
      execute: (input) => {
        const path = PAGES.find((candidate) => candidate === input.path);
        if (!path) return webMcpError(`path must be one of ${PAGES.join(", ")}.`);
        navigate(path);
        return { opened: true, href: path };
      },
    },
  ];
  useWebMcpTools(tools);
  return null;
}
