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
import ReactMarkdown, { type UrlTransform } from "react-markdown";
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
import { preprocessCitationMarkdown, preprocessCitations } from "./citations.ts";
import {
  MarkdownHeadingAnchors,
  RoutedAnchorLinks,
  type WikiMarkdownNotificationAdapter,
  type WikiMarkdownRouteAdapter,
} from "./heading-anchors.tsx";
import { ImageTheater } from "./image-theater.tsx";
import { type WikiImageComponent } from "./image-renderer.tsx";
import { TheaterImage } from "./theater-image.tsx";
import {
  markdownRehypePlugins,
  markdownRemarkPlugins,
  protectCurrencyFromMath,
} from "./math.ts";
import { PdfChipLink, isPdfChipHref } from "./pdf-chip.tsx";
import { expandSlidesMarkdown } from "./slides-markdown.ts";
import { SlidesViewer, SlidesViewerControls } from "./slides-viewer.tsx";
import { WikiMarkdownFrame } from "./frame.tsx";
import {
  isInternalWikiHref,
  resolveAssetPath,
  resolveHref,
  resolveImageSrc,
  resolveWikilinks,
  sanitizeMarkdownUrl,
  splitWikilinkAlias,
} from "./paths.ts";

export {
  MarkdownTitle,
  type MarkdownTitleLinkProps,
} from "./title-react.tsx";
export { markdownTitleToText } from "./title.ts";

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
  ImageComponent?: WikiImageComponent;
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

// react-markdown hands every custom component the hast `node`. Components that
// spread their props onto a DOM element would render it as node="[object Object]".
//
// These wrappers must stay module-level: building them inside the render would
// hand React a new component type on every pass, remounting the whole subtree
// and discarding DOM that later passes enhance in place (mermaid, tables).
function withoutNode<P extends object>(
  Component: (props: P) => ReactNode,
): (props: P & { node?: unknown }) => ReactNode {
  return function NodeFreeComponent({ node: _node, ...props }) {
    return Component(props as unknown as P);
  };
}

const MarkdownPreCell = withoutNode(MarkdownPre);
const MdTheadCell = withoutNode(MdThead);
const MdTbodyCell = withoutNode(MdTbody);
const MdTrCell = withoutNode(MdTr);
const MdThCell = withoutNode(MdTh);
const MdTdCell = withoutNode(MdTd);

const wikiUrlTransform: UrlTransform = (value) => {
  return sanitizeMarkdownUrl(value);
};

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
  ImageComponent,
  resolveLinkHref,
  isInternalHref = isInternalWikiHref,
}: WikiMarkdownProps) {
  const prepared = protectCurrencyFromMath(
    expandSlidesMarkdown(
      preprocessCitationMarkdown(
        resolveWikilinks(content, currentSlug, apiBasePath),
      ),
    ),
  );

  return (
    <WikiMarkdownFrame className={className}>
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
        urlTransform={wikiUrlTransform}
        components={{
          pre: MarkdownPreCell,
          a: ({
            href,
            children,
            node: _node,
            ...props
          }: WikiMarkdownLinkProps & { node?: unknown }) => {
            const defaultHref = resolveHref(href, currentSlug, apiBasePath);
            const nextHref = resolveLinkHref
              ? resolveLinkHref(defaultHref, {
                  rawHref: href,
                  currentSlug,
                  apiBasePath,
                })
              : defaultHref;

            if (isPdfChipHref(nextHref)) {
              return <PdfChipLink fallbackLabel={children} href={nextHref} />;
            }

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
          table: withoutNode((props) => (
            <MdTable {...props} layoutAdapter={tableLayoutAdapter} />
          )),
          thead: MdTheadCell,
          tbody: MdTbodyCell,
          tr: MdTrCell,
          th: MdThCell,
          td: MdTdCell,
          img: withoutNode((props) => (
            <TheaterImage
              {...props}
              ImageComponent={ImageComponent}
              currentSlug={currentSlug}
              apiBasePath={apiBasePath}
            />
          )),
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
      <SlidesViewerControls />
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
  SlidesViewer,
  SlidesViewerControls,
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
  sanitizeMarkdownUrl,
  splitWikilinkAlias,
};
export type {
  WikiImageComponent,
  WikiMarkdownNotificationAdapter,
  WikiMarkdownRouteAdapter,
};
export {
  normalizeMathValue,
  protectCurrencyFromMath,
  remarkCleanMath,
} from "./math.ts";
