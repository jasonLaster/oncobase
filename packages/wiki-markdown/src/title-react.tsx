import { createElement, type AnchorHTMLAttributes, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  isInternalWikiHref,
  resolveHref,
  resolveWikilinks,
} from "./paths.ts";
export { markdownTitleToText } from "./title.ts";

export type MarkdownTitleLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  children: ReactNode;
};

export function MarkdownTitle({
  LinkComponent,
  currentSlug,
  title,
}: {
  LinkComponent?: (props: MarkdownTitleLinkProps) => ReactNode;
  currentSlug?: string;
  title: string;
}) {
  return createElement(
    ReactMarkdown as unknown as (props: Record<string, unknown>) => ReactNode,
    {
      allowedElements: ["p", "a", "strong", "em", "code", "del", "br"],
      components: {
        p: ({ children }: { children?: ReactNode }) => <>{children}</>,
        a: ({
          href,
          children,
          node: _node,
          ...props
        }: AnchorHTMLAttributes<HTMLAnchorElement> & {
          children?: ReactNode;
          node?: unknown;
        }) => {
          const resolvedHref = resolveHref(href, currentSlug);
          const className =
            "text-[var(--brand)] underline decoration-[var(--brand)]/30 underline-offset-4 transition-colors hover:decoration-[var(--brand)]";

          if (isInternalWikiHref(resolvedHref) && LinkComponent) {
            return (
              <LinkComponent href={resolvedHref} {...props} className={className}>
                {children}
              </LinkComponent>
            );
          }

          return (
            <a href={resolvedHref} {...props} className={className}>
              {children}
            </a>
          );
        },
      },
      remarkPlugins: [remarkGfm],
      skipHtml: true,
      unwrapDisallowed: true,
    },
    resolveWikilinks(title, currentSlug),
  );
}
