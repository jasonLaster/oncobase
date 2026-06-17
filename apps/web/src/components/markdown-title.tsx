import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  isInternalWikiHref,
  resolveHref,
  resolveWikilinks,
} from "@oncobase/wiki-markdown/paths";

export function MarkdownTitle({
  title,
  currentSlug,
}: {
  title: string;
  currentSlug?: string;
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

          if (isInternalWikiHref(resolvedHref)) {
            return (
              <Link
                href={resolvedHref}
                {...props}
                className="text-[var(--brand)] underline decoration-[var(--brand)]/30 underline-offset-4 transition-colors hover:decoration-[var(--brand)]"
              >
                {children}
              </Link>
            );
          }

          return (
            <a
              href={resolvedHref}
              {...props}
              className="text-[var(--brand)] underline decoration-[var(--brand)]/30 underline-offset-4 transition-colors hover:decoration-[var(--brand)]"
            >
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
