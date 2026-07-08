import type { AnchorHTMLAttributes, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  isInternalWikiHref,
  resolveHref,
  resolveWikilinks,
} from "./paths";
export { markdownTitleToText } from "./title";

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
  return (
    <ReactMarkdown
      skipHtml
      unwrapDisallowed
      allowedElements={["p", "a", "strong", "em", "code", "del", "br"]}
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <>{children}</>,
        a: ({ href, children, node: _node, ...props }) => {
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
      }}
    >
      {resolveWikilinks(title, currentSlug)}
    </ReactMarkdown>
  );
}
