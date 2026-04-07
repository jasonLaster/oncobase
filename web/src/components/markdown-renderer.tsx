import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { resolveWikilinks } from "@/lib/wikilinks";
import { MdTable, MdThead, MdTbody, MdTr, MdTh, MdTd } from "@/components/markdown-table";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

function HeadingWithAnchor({
  level,
  children,
}: {
  level: number;
  children: React.ReactNode;
}) {
  const text =
    typeof children === "string"
      ? children
      : Array.isArray(children)
        ? children.map((c) => (typeof c === "string" ? c : "")).join("")
        : "";
  const id = slugify(text);
  const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

  return (
    <Tag id={id} className="group relative">
      <a
        href={`#${id}`}
        className="absolute -left-6 top-0 opacity-0 group-hover:opacity-100 text-[var(--text-muted)] no-underline hover:no-underline hover:text-[var(--brand)] transition-opacity cursor-pointer"
        aria-label={`Link to "${text}"`}
      >
        #
      </a>
      {children}
    </Tag>
  );
}

const components: Components = {
  h1: ({ children }) => <HeadingWithAnchor level={1}>{children}</HeadingWithAnchor>,
  h2: ({ children }) => <HeadingWithAnchor level={2}>{children}</HeadingWithAnchor>,
  h3: ({ children }) => <HeadingWithAnchor level={3}>{children}</HeadingWithAnchor>,
  h4: ({ children }) => <HeadingWithAnchor level={4}>{children}</HeadingWithAnchor>,
  table: MdTable,
  thead: MdThead,
  tbody: MdTbody,
  tr: MdTr,
  th: MdTh,
  td: MdTd,
};

export function MarkdownRenderer({ content, disableAnchors }: { content: string; disableAnchors?: boolean }) {
  const resolved = resolveWikilinks(content);

  return (
    <div className="prose max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={disableAnchors ? { table: MdTable, thead: MdThead, tbody: MdTbody, tr: MdTr, th: MdTh, td: MdTd } : components}
      >
        {resolved}
      </ReactMarkdown>
    </div>
  );
}
