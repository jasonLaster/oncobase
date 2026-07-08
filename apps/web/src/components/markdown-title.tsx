import Link from "next/link";
import {
  MarkdownTitle as SharedMarkdownTitle,
  type MarkdownTitleLinkProps,
} from "@oncobase/wiki-markdown/title-react";

export function MarkdownTitle({
  title,
  currentSlug,
}: {
  title: string;
  currentSlug?: string;
}) {
  return (
    <SharedMarkdownTitle
      title={title}
      currentSlug={currentSlug}
      LinkComponent={({ href, children, ...props }: MarkdownTitleLinkProps) => (
        <Link href={href} {...props}>
          {children}
        </Link>
      )}
    />
  );
}
