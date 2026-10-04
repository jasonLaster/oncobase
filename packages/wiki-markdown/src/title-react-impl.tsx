import { memo, useMemo, type AnchorHTMLAttributes, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  isInternalWikiHref,
  resolveHref,
  resolveWikilinks,
} from "./paths.ts";

export type MarkdownTitleLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  children: ReactNode;
};

export type MarkdownTitleProps = {
  LinkComponent?: (props: MarkdownTitleLinkProps) => ReactNode;
  currentSlug?: string;
  title: string;
};

const ALLOWED_ELEMENTS = ["p", "a", "strong", "em", "code", "del", "br"];
const REMARK_PLUGINS = [remarkGfm];
const LINK_CLASS_NAME =
  "text-[var(--brand)] underline decoration-[var(--brand)]/30 underline-offset-4 transition-colors hover:decoration-[var(--brand)]";

const TitleParagraph: Components["p"] = ({ children }) => <>{children}</>;

// Memoized so a parent re-render with the same title doesn't re-parse it, and
// `components` keeps stable element types so links aren't remounted.
export const MarkdownTitle = memo(function MarkdownTitle({
  LinkComponent,
  currentSlug,
  title,
}: MarkdownTitleProps) {
  const components = useMemo<Components>(() => ({
    p: TitleParagraph,
    a: ({ href, children, node: _node, ...props }) => {
      const resolvedHref = resolveHref(href, currentSlug);

      if (isInternalWikiHref(resolvedHref) && LinkComponent) {
        return (
          <LinkComponent href={resolvedHref} {...props} className={LINK_CLASS_NAME}>
            {children}
          </LinkComponent>
        );
      }

      return (
        <a href={resolvedHref} {...props} className={LINK_CLASS_NAME}>
          {children}
        </a>
      );
    },
  }), [LinkComponent, currentSlug]);

  return (
    <ReactMarkdown
      skipHtml
      unwrapDisallowed
      allowedElements={ALLOWED_ELEMENTS}
      remarkPlugins={REMARK_PLUGINS}
      components={components}
    >
      {resolveWikilinks(title, currentSlug)}
    </ReactMarkdown>
  );
});
