import type { AnchorHTMLAttributes, ComponentType, ImgHTMLAttributes, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import {
  MdTable,
  MdTbody,
  MdTd,
  MdTh,
  MdThead,
  MdTr,
} from "@diana-tnbc/smart-table";
import "@diana-tnbc/smart-table/styles.css";
import "./styles.css";

export type WikiMarkdownLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href?: string;
  children?: ReactNode;
};

export type WikiMarkdownProps = {
  content: string;
  currentSlug?: string;
  apiBasePath?: string;
  LinkComponent?: ComponentType<WikiMarkdownLinkProps>;
  className?: string;
};

function countTrailingBackslashes(value: string): number {
  let count = 0;
  for (let i = value.length - 1; i >= 0 && value[i] === "\\"; i--) {
    count++;
  }
  return count;
}

export function splitWikilinkAlias(inner: string): { target: string; display?: string } {
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] !== "|") continue;

    const beforePipe = inner.slice(0, i);
    const isEscaped = countTrailingBackslashes(beforePipe) % 2 === 1;
    const target = (isEscaped ? beforePipe.slice(0, -1) : beforePipe).trim();
    const display = inner.slice(i + 1).replace(/\\\|/g, "|").trim();

    return { target, display };
  }

  return { target: inner.trim() };
}

function currentDirectory(currentSlug?: string) {
  return currentSlug ? currentSlug.split("/").slice(0, -1).join("/") : "";
}

function encodeFilePath(path: string, apiBasePath = "") {
  return `${apiBasePath}/api/file?path=${encodeURIComponent(path)}`;
}

export function resolveWikilinks(content: string, currentSlug?: string, apiBasePath = ""): string {
  const currentDir = currentDirectory(currentSlug);

  return content.replace(/\[\[([^\]]+)]]/g, (_match, inner: string) => {
    const { target, display } = splitWikilinkAlias(inner);
    const isBare = !target.includes("/");

    if (target.endsWith(".pdf")) {
      const pdfPath = isBare && currentDir ? `${currentDir}/${target}` : target;
      const baseName = target.split("/").pop()?.replace(/\.pdf$/i, "") ?? target;
      const label = display || baseName;
      return `[${label}](${encodeFilePath(pdfPath, apiBasePath)})`;
    }

    const slug = target.replace(/\.md$/i, "").replace(/\s+/g, "-");
    const label = display || target.split("/").pop()?.replace(/\.md$/i, "") || target;
    return `[${label}](/${slug})`;
  });
}

function normalizeNumericCitationLabel(rawLabel: string): string {
  return rawLabel.replace(/\s+/g, "").replace(/--/g, "-").replace(/\u2013/g, "-");
}

export function preprocessCitations(markdown: string): string {
  return markdown
    .replace(/\\cite[a-zA-Z*]*\{([^}]+)\}/g, (_match, rawKeys: string) => {
      const label = rawKeys
        .split(/[,;]+/)
        .map((value) => value.trim())
        .filter(Boolean)
        .join(", ");
      return label ? `[[${label}](#references)]` : _match;
    })
    .replace(
      /\[(\d+(?:\s*[-\u2013]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-\u2013]\s*\d+)?)*)](?!\s*[:(])/g,
      (match) => `[${match}](#references)`,
    )
    .replace(
      /([a-z][a-z0-9'’_-]*)\^\{(\d+(?:\s*(?:,|--|[-\u2013])\s*\d+)*)}(?![A-Za-z0-9])/g,
      (_match, prefix: string, rawLabel: string) =>
        `${prefix}<sup>[${normalizeNumericCitationLabel(rawLabel)}](#references)</sup>`,
    );
}

export function resolveAssetPath(src: string, currentSlug?: string) {
  if (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("//") ||
    src.startsWith("data:") ||
    src.startsWith("/api/")
  ) {
    return src;
  }

  const ext = src.includes(".") ? src.slice(src.lastIndexOf(".")).toLowerCase() : "";
  if (![".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".csv", ".pdf"].includes(ext)) {
    return src;
  }

  if (!currentSlug || src.startsWith("/")) return src.replace(/^\/+/, "");
  const dir = currentDirectory(currentSlug);
  return new URL(src, `https://wiki.local/${dir ? `${dir}/` : ""}`).pathname.replace(/^\/+/, "");
}

export function resolveHref(href: string | undefined, currentSlug?: string, apiBasePath = "") {
  if (!href) return href;
  if (href.endsWith(".md") || href.includes(".md#")) {
    return href.replace(/\.md(#|$)/, "$1");
  }
  if (href.endsWith(".pdf")) {
    return encodeFilePath(resolveAssetPath(href, currentSlug), apiBasePath);
  }
  return href;
}

function TheaterImage({
  currentSlug,
  apiBasePath,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & {
  currentSlug?: string;
  apiBasePath?: string;
}) {
  const resolved = typeof props.src === "string" ? resolveAssetPath(props.src, currentSlug) : props.src;
  const src =
    typeof resolved === "string" &&
    !resolved.startsWith("http://") &&
    !resolved.startsWith("https://") &&
    !resolved.startsWith("//") &&
    !resolved.startsWith("data:") &&
    !resolved.startsWith("/api/")
      ? encodeFilePath(resolved, apiBasePath)
      : resolved;

  return <img {...props} src={src} data-theater-image="" />;
}

export function WikiMarkdown({
  content,
  currentSlug,
  apiBasePath = "",
  LinkComponent,
  className = "",
}: WikiMarkdownProps) {
  const prepared = preprocessCitations(resolveWikilinks(content, currentSlug, apiBasePath));

  return (
    <div className={`wiki-markdown prose ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeSlug, rehypeKatex]}
        components={{
          a: ({ href, children, ...props }: WikiMarkdownLinkProps) => {
            const nextHref = resolveHref(href, currentSlug, apiBasePath);
            const isInternal = nextHref?.startsWith("/") && !nextHref.startsWith("/api/");
            if (isInternal && LinkComponent) {
              return (
                <LinkComponent href={nextHref} {...props}>
                  {children}
                </LinkComponent>
              );
            }
            return (
              <a href={nextHref} {...props}>
                {children}
              </a>
            );
          },
          table: MdTable,
          thead: MdThead,
          tbody: MdTbody,
          tr: MdTr,
          th: MdTh,
          td: MdTd,
          img: (props) => (
            <TheaterImage
              {...props}
              currentSlug={currentSlug}
              apiBasePath={apiBasePath}
            />
          ),
        }}
      >
        {prepared}
      </ReactMarkdown>
    </div>
  );
}
