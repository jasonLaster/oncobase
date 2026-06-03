"use client";

import {
  Children,
  isValidElement,
  type AnchorHTMLAttributes,
  type ComponentProps,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import {
  MdTable,
  MdTbody,
  MdTd,
  MdTh,
  MdThead,
  MdTr,
  SmartTableEnhancer,
  type SmartTableLayoutAdapter,
} from "@oncobase/smart-table";
import "@oncobase/smart-table/styles.css";
import "./styles.css";
import { preprocessCitationMarkdown, preprocessCitations } from "./citations";
import { preprocessWikiMarkdownText } from "./preprocess";
import {
  MarkdownHeadingAnchors,
  RoutedAnchorLinks,
  type WikiMarkdownNotificationAdapter,
  type WikiMarkdownRouteAdapter,
} from "./heading-anchors";
import { ImageTheater, TheaterImage } from "./image-theater";
import { markdownRehypePlugins, markdownRemarkPlugins } from "./math";
import { WikiMarkdownFrame } from "./frame";
import {
  isInternalWikiHref,
  resolveAssetPath,
  resolveHref,
  resolveImageSrc,
  resolveWikilinks,
  splitWikilinkAlias,
} from "./paths";

export type WikiMarkdownLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href?: string;
  children?: ReactNode;
};

export type WikiMarkdownResolveHrefContext = {
  rawHref: string | undefined;
  currentSlug?: string;
  apiBasePath: string;
};

export type WikiMarkdownProps = {
  content: string;
  currentSlug?: string;
  apiBasePath?: string;
  LinkComponent?: ComponentType<WikiMarkdownLinkProps>;
  className?: string;
  disableAnchors?: boolean;
  anchorScopeKey?: string;
  routeAdapter?: WikiMarkdownRouteAdapter;
  notification?: WikiMarkdownNotificationAdapter;
  tableLayoutAdapter?: SmartTableLayoutAdapter;
  resolveLinkHref?: (
    href: string | undefined,
    context: WikiMarkdownResolveHrefContext,
  ) => string | undefined;
  isInternalHref?: (href: string | undefined) => href is string;
};

function mermaidTitle(source: string) {
  return source.match(/^\s*title\s+(.+?)\s*$/m)?.[1] ?? "Mermaid diagram";
}

function mermaidKind(source: string) {
  return source.trimStart().split(/\s+/)[0] ?? "diagram";
}

function mermaidTasks(source: string) {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^(gantt|title\s+|dateFormat\s+|section\s+)/.test(line))
    .map((line) => line.split(":")[0]?.trim())
    .filter((line): line is string => Boolean(line));
}

function encodeMermaidSource(source: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(source, "utf-8").toString("base64");
  }
  if (typeof btoa !== "undefined") {
    return btoa(unescape(encodeURIComponent(source)));
  }
  return source;
}

function MermaidFallback({ source }: { source: string }) {
  const title = mermaidTitle(source);
  const tasks = mermaidTasks(source);
  const encoded = encodeMermaidSource(source);

  return (
    <figure
      className="mermaid-diagram mermaid-fallback"
      data-graph={encoded}
      data-mermaid-kind={mermaidKind(source)}
      data-test-id="mermaid-diagram"
    >
      <figcaption>{title}</figcaption>
      {tasks.length > 0 ? (
        <ol className="mermaid-fallback-tasks">
          {tasks.map((task) => (
            <li key={task}>
              <span>{task}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <details>
        <summary>Source</summary>
        <pre>
          <code>{source}</code>
        </pre>
      </details>
    </figure>
  );
}

function isMermaidCodeElement(value: ReactNode): value is ReactElement<ComponentProps<"code">> {
  return isValidElement<ComponentProps<"code">>(value) &&
    typeof value.props.className === "string" &&
    value.props.className.includes("language-mermaid");
}

function MarkdownPre({ children, ...props }: ComponentProps<"pre">) {
  const onlyChild = Children.count(children) === 1 ? Children.only(children) : null;
  if (isMermaidCodeElement(onlyChild)) {
    return <MermaidFallback source={String(onlyChild.props.children ?? "").trimEnd()} />;
  }
  return <pre {...props}>{children}</pre>;
}

export function WikiMarkdownTableEnhancer({
  layoutAdapter,
  persistenceScope,
}: {
  layoutAdapter?: SmartTableLayoutAdapter;
  persistenceScope?: string;
}) {
  return (
    <SmartTableEnhancer
      layoutAdapter={layoutAdapter}
      getPersistenceKey={({ index }) =>
        persistenceScope ? `${persistenceScope}::prose-table-${index}` : undefined
      }
    />
  );
}

export function WikiMarkdown({
  content,
  currentSlug,
  apiBasePath = "",
  LinkComponent,
  className = "",
  disableAnchors,
  anchorScopeKey,
  routeAdapter,
  notification,
  tableLayoutAdapter,
  resolveLinkHref,
  isInternalHref = isInternalWikiHref,
}: WikiMarkdownProps) {
  const prepared = preprocessWikiMarkdownText(
    preprocessCitationMarkdown(resolveWikilinks(content, currentSlug, apiBasePath)),
  );

  return (
    <WikiMarkdownFrame className={className}>
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
        components={{
          pre: MarkdownPre,
          a: ({ href, children, ...props }: WikiMarkdownLinkProps) => {
            const defaultHref = resolveHref(href, currentSlug, apiBasePath);
            const nextHref = resolveLinkHref
              ? resolveLinkHref(defaultHref, {
                  rawHref: href,
                  currentSlug,
                  apiBasePath,
                })
              : defaultHref;

            if (isInternalHref(nextHref) && LinkComponent) {
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
          table: (props) => <MdTable {...props} layoutAdapter={tableLayoutAdapter} />,
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
      <MarkdownHeadingAnchors
        disableAnchors={disableAnchors}
        notification={notification}
        routeAdapter={routeAdapter}
        scopeKey={anchorScopeKey ?? currentSlug}
      />
    </WikiMarkdownFrame>
  );
}

export {
  ImageTheater,
  MdTable,
  MdTbody,
  MdTd,
  MdTh,
  MdThead,
  MdTr,
  MarkdownHeadingAnchors,
  MarkdownPre,
  MermaidFallback,
  RoutedAnchorLinks,
  TheaterImage,
  WikiMarkdownFrame,
  isInternalWikiHref,
  markdownRehypePlugins,
  markdownRemarkPlugins,
  preprocessCitationMarkdown,
  preprocessCitations,
  resolveAssetPath,
  resolveHref,
  resolveImageSrc,
  resolveWikilinks,
  splitWikilinkAlias,
};
export type { WikiMarkdownNotificationAdapter, WikiMarkdownRouteAdapter };
export { normalizeMathValue, remarkCleanMath } from "./math";
