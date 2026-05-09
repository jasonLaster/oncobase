"use client";

import type { AnchorHTMLAttributes, ComponentType, ReactNode } from "react";
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
} from "@diana-tnbc/smart-table";
import "@diana-tnbc/smart-table/styles.css";
import "./styles.css";
import { preprocessCitationMarkdown, preprocessCitations } from "./citations";
import {
  MarkdownHeadingAnchors,
  RoutedAnchorLinks,
  type WikiMarkdownNotificationAdapter,
  type WikiMarkdownRouteAdapter,
} from "./heading-anchors";
import { ImageTheater, TheaterImage } from "./image-theater";
import { markdownRehypePlugins, markdownRemarkPlugins } from "./math";
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
  resolveLinkHref?: (
    href: string | undefined,
    context: WikiMarkdownResolveHrefContext,
  ) => string | undefined;
  isInternalHref?: (href: string | undefined) => href is string;
};

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
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
  resolveLinkHref,
  isInternalHref = isInternalWikiHref,
}: WikiMarkdownProps) {
  const prepared = preprocessCitationMarkdown(
    resolveWikilinks(content, currentSlug, apiBasePath),
  );

  return (
    <div className={classNames("wiki-markdown prose max-w-none", className)}>
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
        components={{
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
      <MarkdownHeadingAnchors
        disableAnchors={disableAnchors}
        notification={notification}
        routeAdapter={routeAdapter}
        scopeKey={anchorScopeKey ?? currentSlug}
      />
    </div>
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
  RoutedAnchorLinks,
  TheaterImage,
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
