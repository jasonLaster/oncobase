import { useStore } from "@livestore/react";
import {
  buildTaggedPageTree,
  type TaggedPageTreeNode,
} from "@oncobase/wiki-content/tag-page-groups";
import { formatFileLabel } from "@oncobase/wiki-content/file-labels";
import { WikiPageFrame, WikiPageHeader } from "@oncobase/wiki-shell/page-chrome";
import { WikiPageLoading } from "@oncobase/wiki-shell/page-states";
import { Tree, TreeGroup, TreeItem, TreeItemIndicator, TreeItemLabel } from "@oncobase/ui/tree";
import { ChevronRight } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Link, useParams } from "react-router";
import { pageIndex$, siteState$ } from "../livestore/queries";
import type { PageIndexRow } from "../types";
import {
  updateClientRouteMetadata,
  WIKI_SITE_DESCRIPTION,
  WIKI_SITE_NAME,
} from "../document-title";
import { hrefForSlug, parseJsonArray } from "../wiki-utils";

function pageHasTag(page: PageIndexRow, tag: string) {
  return parseJsonArray<string>(page.tagsJson).some(
    (candidate) => candidate.toLowerCase() === tag.toLowerCase(),
  );
}

function folderPaths(node: TaggedPageTreeNode): string[] {
  return node.children.flatMap((child) => [`folder:${child.path}`, ...folderPaths(child)]);
}

function TaggedPageItems({ node }: { node: TaggedPageTreeNode }) {
  return (
    <>
      {node.pages.map((page) => (
        <TreeItem key={page.slug} label={page.title} value={`page:${page.slug}`}>
          <TreeItemLabel className="tag-tree-link" render={<Link to={hrefForSlug(page.slug)} />}>
            {page.title}
          </TreeItemLabel>
        </TreeItem>
      ))}
      {node.children.map((child) => (
        <TreeItem key={child.path} value={`folder:${child.path}`}>
          <TreeItemLabel className="tag-tree-folder">
            <TreeItemIndicator className="tag-tree-indicator">
              <ChevronRight size={14} aria-hidden="true" />
            </TreeItemIndicator>
            {formatFileLabel(child.name)}
          </TreeItemLabel>
          <TreeGroup className="tag-tree-branch">
            <TaggedPageItems node={child} />
          </TreeGroup>
        </TreeItem>
      ))}
    </>
  );
}

function TaggedPageTree({ node, tag }: { node: TaggedPageTreeNode; tag: string }) {
  const expanded = useMemo(() => folderPaths(node), [node]);
  return (
    <Tree
      aria-label={`Pages tagged ${tag}`}
      className="tag-tree-root"
      defaultExpanded={expanded}
      expandOnPress
      hiddenUntilFound
      mode="none"
    >
      <TaggedPageItems node={node} />
    </Tree>
  );
}

export function TagPage() {
  const { tag = "" } = useParams();
  const decodedTag = decodeURIComponent(tag);
  const pages = useStore().store.useQuery(pageIndex$) as PageIndexRow[];
  // An empty local page index means the manifest hasn't synced yet — show the
  // loading state, never a false "no pages found". (siteState can land before
  // the page-index rows, so it is not a reliable sync signal here.)
  const waitingForManifest = pages.length === 0;
  const taggedPages = useMemo(
    () =>
      pages
        .filter((page) => pageHasTag(page, decodedTag))
        .map((page) => ({ slug: page.slug, title: page.title })),
    [decodedTag, pages],
  );
  const pageTree = useMemo(() => buildTaggedPageTree(taggedPages), [taggedPages]);

  useEffect(() => {
    if (waitingForManifest) return;
    const routeTitle = `Tag: ${decodedTag}`;
    const description = `${taggedPages.length} pages tagged "${decodedTag}"`;
    updateClientRouteMetadata({
      description,
      openGraphDescription: description,
      openGraphTitle: routeTitle,
      title: `${routeTitle} — ${WIKI_SITE_NAME}`,
      twitterDescription: WIKI_SITE_DESCRIPTION,
      twitterTitle: WIKI_SITE_NAME,
    });
  }, [decodedTag, taggedPages.length, waitingForManifest]);

  if (waitingForManifest) {
    return (
      <WikiPageFrame className="page-shell tag-page-shell" data-test-id="tag-page">
        <WikiPageLoading
          data-test-id="page-loading"
          label="Loading page"
        />
      </WikiPageFrame>
    );
  }

  return (
    <WikiPageFrame className="page-shell tag-page-shell" data-test-id="tag-page">
      <WikiPageHeader
        title={`Tag: ${decodedTag}`}
        description={`${taggedPages.length} ${taggedPages.length === 1 ? "page" : "pages"}`}
      />
      {taggedPages.length === 0 ? (
        <p className="muted">No pages found with this tag.</p>
      ) : (
        <TaggedPageTree node={pageTree} tag={decodedTag} />
      )}
    </WikiPageFrame>
  );
}
