import { useStore } from "@livestore/react";
import {
  WikiBreadcrumbs,
  WikiSearchHeader,
  WikiSearchPage,
  WikiSearchResultLink,
  WikiSearchResults,
} from "@oncobase/wiki-shell";
import { useEffect, useMemo } from "react";
import { Link, useParams } from "react-router";
import { pageIndex$ } from "../livestore/queries";
import type { PageIndexRow } from "../types";
import { hrefForSlug, parseJsonArray } from "../wiki-utils";

export function TagPage() {
  const { tag = "" } = useParams();
  const pageIndex = useStore().store.useQuery(pageIndex$) as PageIndexRow[];
  const normalizedTag = tag.trim().toLocaleLowerCase();
  const matchingPages = useMemo(
    () =>
      pageIndex.filter((page) =>
        parseJsonArray<string>(page.tagsJson).some(
          (pageTag) => pageTag.toLocaleLowerCase() === normalizedTag,
        ),
      ),
    [normalizedTag, pageIndex],
  );

  useEffect(() => {
    document.title = `Pages tagged ${tag} - Diana Wiki`;
  }, [tag]);

  return (
    <WikiSearchPage data-test-id="tag-page">
      <WikiBreadcrumbs
        items={[
          { href: "/", key: "home", label: "Home" },
          { current: true, key: tag, label: `#${tag}` },
        ]}
        renderLink={(item) => <Link to={item.href ?? "#"}>{item.label}</Link>}
      />
      <WikiSearchHeader eyebrow="Tag" heading={tag} />
      <WikiSearchResults
        aria-label={`Pages tagged ${tag}`}
        emptyMessage={matchingPages.length === 0 ? `No pages tagged ${tag}` : undefined}
        statusLabel={`${matchingPages.length} page${matchingPages.length === 1 ? "" : "s"}`}
      >
        {matchingPages.map((page) => (
          <WikiSearchResultLink
            href={hrefForSlug(page.slug)}
            key={page.slug}
            renderLink={({ href, children, ...linkProps }) => (
              <Link {...linkProps} to={href}>
                {children}
              </Link>
            )}
            sensitive={page.sensitive}
            slug={page.slug}
            summary={page.description}
            tags={parseJsonArray<string>(page.tagsJson)}
            title={page.title}
          />
        ))}
      </WikiSearchResults>
    </WikiSearchPage>
  );
}
