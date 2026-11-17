"use client";

import {
  Children,
  createContext,
  isValidElement,
  memo,
  useContext,
  useMemo,
  type AnchorHTMLAttributes,
  type ComponentProps,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components, type UrlTransform } from "react-markdown";
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
import { markdownRemarkPlugins } from "./math-common.ts";
import { prepareWikiMarkdown } from "./prepare.ts";
import { PdfChipLink, isPdfChipHref } from "./pdf-chip.tsx";
import { SlidesViewer, SlidesViewerControls } from "./slides-viewer.tsx";
import { WikiMarkdownFrame } from "./frame.tsx";
import { AnnotatedTerm } from "./annotated-term.tsx";
import { EDUCATION_LAB_SANDBOX, resolveEducationLabSrc } from "./education-lab.ts";
import { WikiComponentFigure, type WikiMdxComponents } from "./wiki-component.tsx";
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
  /** React components MDX pages may import by name from "@oncobase/wiki-markdown", beyond the built-ins. */
  mdxComponents?: WikiMdxComponents;
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
const AnnotatedTermCell = withoutNode(AnnotatedTerm);

type MarkdownTableNode = {
  position?: {
    start?: {
      offset?: number;
    };
  };
};

const wikiUrlTransform: UrlTransform = (value) => {
  return sanitizeMarkdownUrl(value);
};

type MarkdownRenderContextValue = {
  currentSlug: WikiMarkdownProps["currentSlug"];
  apiBasePath: string;
  resolveLinkHref?: WikiMarkdownProps["resolveLinkHref"];
  isInternalHref: (href: string | undefined) => href is string;
  LinkComponent?: WikiMarkdownProps["LinkComponent"];
  tableLayoutAdapter?: SmartTableLayoutAdapter;
  ImageComponent?: WikiImageComponent;
  mdxComponents?: WikiMdxComponents;
};

// The component map below is one module-level constant, so React never sees a
// new component type. Anything that varies per page or per render (link
// resolution, which changes as asset hashes arrive, and the table adapter)
// comes through this context instead: a change re-renders links and images in
// place, while tables keep their DOM and the widths smart-table gave them.
// Rebuilding the map remounted every table on each data hand-off and shifted
// the layout once per remount.
const MarkdownRenderContext = createContext<MarkdownRenderContextValue>({
  currentSlug: "",
  apiBasePath: "",
  isInternalHref: isInternalWikiHref,
});

function MarkdownLink({
  href,
  children,
  node: _node,
  ...props
}: WikiMarkdownLinkProps & { node?: unknown }) {
  const { currentSlug, apiBasePath, resolveLinkHref, isInternalHref, LinkComponent } = useContext(MarkdownRenderContext);
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
}

function MarkdownTable({
  node,
  ...props
}: ComponentProps<typeof MdTable> & { node?: MarkdownTableNode }) {
  const { currentSlug, tableLayoutAdapter } = useContext(MarkdownRenderContext);
  return (
    <MdTable
      {...props}
      layoutAdapter={tableLayoutAdapter}
      persistenceKey={
        currentSlug && node?.position?.start?.offset !== undefined
          ? `${currentSlug}::prose-table-${node.position.start.offset}`
          : undefined
      }
    />
  );
}

function MarkdownImage(props: ComponentProps<typeof TheaterImage>) {
  const { currentSlug, apiBasePath, ImageComponent } = useContext(MarkdownRenderContext);
  return (
    <TheaterImage
      {...props}
      ImageComponent={ImageComponent}
      currentSlug={currentSlug}
      apiBasePath={apiBasePath}
    />
  );
}

const MarkdownImageCell = withoutNode(MarkdownImage);

const markdownComponents: Components = {
  pre: MarkdownPreCell,
  abbr: AnnotatedTermCell,
  a: MarkdownLink,
  table: MarkdownTable,
  thead: MdTheadCell,
  tbody: MdTbodyCell,
  tr: MdTrCell,
  th: MdThCell,
  td: MdTdCell,
  img: MarkdownImageCell,
  figure: function MarkdownFigure({ node, children, ...props }) {
    const { currentSlug, apiBasePath, mdxComponents } = useContext(MarkdownRenderContext);
    const properties = (node?.properties ?? {}) as Record<string, unknown>;
    if (!("dataWikiComponent" in properties)) return <figure {...props}>{children}</figure>;
    return (
      <WikiComponentFigure properties={properties} currentSlug={currentSlug} apiBasePath={apiBasePath} components={mdxComponents}>
        {children}
      </WikiComponentFigure>
    );
  },
  iframe: function MarkdownIframe({ node, src, srcDoc: _srcDoc, sandbox: _sandbox, allow: _allow, referrerPolicy: _referrerPolicy, ...props }) {
    const { currentSlug, apiBasePath } = useContext(MarkdownRenderContext);
    if (!node?.properties || !("dataEducationLab" in node.properties)) {
      return <iframe {...props} src={src} srcDoc={_srcDoc} sandbox={_sandbox} allow={_allow} referrerPolicy={_referrerPolicy} />;
    }
    const localSrc = resolveEducationLabSrc(src, currentSlug, apiBasePath);
    return <iframe {...props} src={localSrc} sandbox={EDUCATION_LAB_SANDBOX} referrerPolicy="no-referrer" />;
  },
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

export const WikiMarkdownRenderer = memo(function WikiMarkdownRenderer({
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
  mdxComponents,
  rehypePlugins,
  preparedContent,
}: WikiMarkdownProps & {
  /** The wrappers choose these: the full list (with rehype-raw) or, for a
   * document without raw HTML, the light list. */
  rehypePlugins: ComponentProps<typeof ReactMarkdown>["rehypePlugins"];
  /** `prepareWikiMarkdown(content, currentSlug, apiBasePath)`, when the caller already has it. */
  preparedContent?: string;
}) {
  const prepared = preparedContent ?? prepareWikiMarkdown(content, currentSlug, apiBasePath);

  const markdownContext = useMemo<MarkdownRenderContextValue>(() => ({
    currentSlug,
    apiBasePath,
    resolveLinkHref,
    isInternalHref,
    LinkComponent,
    tableLayoutAdapter,
    ImageComponent,
    mdxComponents,
  }), [currentSlug, apiBasePath, resolveLinkHref, isInternalHref, LinkComponent, tableLayoutAdapter, ImageComponent, mdxComponents]);

  return (
    <WikiMarkdownFrame className={className}>
      <MarkdownRenderContext.Provider value={markdownContext}>
        <ReactMarkdown
          remarkPlugins={markdownRemarkPlugins}
          rehypePlugins={rehypePlugins}
          urlTransform={wikiUrlTransform}
          components={markdownComponents}
        >
          {prepared}
        </ReactMarkdown>
      </MarkdownRenderContext.Provider>
      <MarkdownHeadingAnchors
        disableAnchors={disableAnchors}
        notification={notification}
        routeAdapter={routeAdapter}
        scopeKey={anchorScopeKey ?? currentSlug}
      />
      <SlidesViewerControls />
    </WikiMarkdownFrame>
  );
});

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
  markdownRemarkPlugins,
  prepareWikiMarkdown,
  preprocessCitationMarkdown,
  preprocessCitations,
  resolveAssetPath,
  resolveHref,
  resolveImageSrc,
  resolveWikilinks,
  sanitizeMarkdownUrl,
  splitWikilinkAlias,
};
export { BUILT_IN_WIKI_MDX_COMPONENTS, WikiComponentFigure } from "./wiki-component.tsx";
export { toPortableMarkdown } from "./mdx-components.ts";
export type {
  WikiMdxComponents,
  WikiImageComponent,
  WikiMarkdownNotificationAdapter,
  WikiMarkdownRouteAdapter,
};
export {
  normalizeMathValue,
  protectCurrencyFromMath,
  remarkCleanMath,
} from "./math-common.ts";
