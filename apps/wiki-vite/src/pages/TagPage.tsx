import { useStore } from "@livestore/react";
import { WikiBreadcrumbs, WikiEmptyState } from "@oncobase/wiki-shell";
import { Link, useParams } from "react-router";
import { pageIndex$ } from "../livestore/queries";
import type { PageIndexRow } from "../types";
import { hrefForSlug, parseJsonArray } from "../wiki-utils";

function formatCount(count: number) {
  return `${count} ${count === 1 ? "page" : "pages"}`;
}

export function TagPage() {
  const { tag = "" } = useParams();
  const decodedTag = decodeURIComponent(tag);
  const pageIndex = useStore().store.useQuery(pageIndex$) as PageIndexRow[];
  const pages = pageIndex
    .filter((page) => parseJsonArray<string>(page.tagsJson).includes(decodedTag))
    .sort((a, b) => a.title.localeCompare(b.title));

  return (
    <article className="page-shell" data-test-id="document-article">
      <WikiBreadcrumbs
        items={[
          { href: "/", key: "home", label: "Home" },
          { current: true, key: "tag", label: `Tag: ${decodedTag}` },
        ]}
        renderLink={(item) => <Link to={item.href ?? "#"}>{item.label}</Link>}
      />
      <header className="page-header">
        <div className="wiki-shell-page-header-main">
          <div className="wiki-shell-page-title-row">
            <h1>Tag: {decodedTag}</h1>
          </div>
          <p>{formatCount(pages.length)}</p>
        </div>
      </header>
      {pages.length === 0 ? (
        <WikiEmptyState
          title="No pages found"
          description={`No visible pages are tagged ${decodedTag}.`}
        />
      ) : (
        <ul className="wiki-vite-tag-page-list">
          {pages.map((page) => (
            <li key={page.slug}>
              <Link to={hrefForSlug(page.slug)}>{page.title}</Link>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
