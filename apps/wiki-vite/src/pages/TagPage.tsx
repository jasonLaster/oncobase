import { useStore } from "@livestore/react";
import {
  buildTaggedPageTree,
  type TaggedPageTreeNode,
} from "@oncobase/wiki-content/tag-page-groups";
import { formatFileLabel } from "@oncobase/wiki-content/file-labels";
import { WikiPageLoading } from "@oncobase/wiki-shell/page-states";
import { ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { pageIndex$, siteState$ } from "../livestore/queries";
import type { PageIndexRow } from "../types";
import { hrefForSlug, parseJsonArray } from "../wiki-utils";

function pageHasTag(page: PageIndexRow, tag: string) {
  return parseJsonArray<string>(page.tagsJson).some(
    (candidate) => candidate.toLowerCase() === tag.toLowerCase(),
  );
}

function TaggedPageTree({
  node,
  level = 0,
}: {
  node: TaggedPageTreeNode;
  level?: number;
}) {
  return (
    <ul className={level === 0 ? "tag-tree-root" : "tag-tree-branch"}>
      {node.pages.map((page) => (
        <li key={page.slug}>
          <Link to={hrefForSlug(page.slug)}>{page.title}</Link>
        </li>
      ))}
      {node.children.map((child) => (
        <li key={child.path}>
          <details open className="tag-tree-folder">
            <summary>
              <ChevronRight size={14} aria-hidden="true" />
              {formatFileLabel(child.name)}
            </summary>
            <TaggedPageTree node={child} level={level + 1} />
          </details>
        </li>
      ))}
    </ul>
  );
}

export function TagPage() {
  const { tag = "" } = useParams();
  const decodedTag = decodeURIComponent(tag);
  const siteState = useStore().store.useQuery(siteState$);
  const pages = useStore().store.useQuery(pageIndex$) as PageIndexRow[];
  const waitingForManifest = pages.length === 0 && !siteState;
  const taggedPages = useMemo(
    () =>
      pages
        .filter((page) => pageHasTag(page, decodedTag))
        .map((page) => ({ slug: page.slug, title: page.title })),
    [decodedTag, pages],
  );
  const pageTree = useMemo(() => buildTaggedPageTree(taggedPages), [taggedPages]);

  if (waitingForManifest) {
    return (
      <article className="page-shell tag-page-shell" data-test-id="tag-page">
        <WikiPageLoading
          data-test-id="page-loading"
          label="Loading page"
        />
      </article>
    );
  }

  return (
    <article className="page-shell tag-page-shell" data-test-id="tag-page">
      <header className="page-header">
        <div className="wiki-shell-page-header-main">
          <div className="wiki-shell-page-title-row">
            <h1>Tag: {decodedTag}</h1>
          </div>
          <p>
            {taggedPages.length} {taggedPages.length === 1 ? "page" : "pages"}
          </p>
        </div>
      </header>
      {taggedPages.length === 0 ? (
        <p className="muted">No pages found with this tag.</p>
      ) : (
        <TaggedPageTree node={pageTree} />
      )}
    </article>
  );
}
