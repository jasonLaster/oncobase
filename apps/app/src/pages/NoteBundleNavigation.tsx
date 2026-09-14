import { getNoteBundlePages } from "@oncobase/wiki-shell";
import { BookOpenIcon, FileTextIcon, FileCodeIcon } from "lucide-react";
import { Link } from "react-router";
import { hrefForSlug } from "../wiki-utils";

const partDetails = {
  overview: { icon: BookOpenIcon, description: "Summary" },
  formatted: { icon: FileTextIcon, description: "Readable notes" },
  raw: { icon: FileCodeIcon, description: "Original notes" },
};

export function NoteBundleNavigation({
  slug,
  pageSlugs,
}: {
  slug: string;
  pageSlugs: ReadonlySet<string>;
}) {
  const pages = getNoteBundlePages(slug, pageSlugs);
  if (pages.length < 2) return null;

  return (
    <nav aria-label="Note pages" className="note-bundle-nav" data-test-id="note-bundle-nav">
      {pages.map((page) => {
        const { icon: Icon, description } = partDetails[page.part];
        return (
          <Link
            aria-current={page.slug === slug ? "page" : undefined}
            className="note-bundle-link"
            key={page.slug}
            to={hrefForSlug(page.slug)}
          >
            <Icon aria-hidden="true" size={18} />
            <span>
              <strong>{page.label}</strong>
              <small>{description}</small>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
