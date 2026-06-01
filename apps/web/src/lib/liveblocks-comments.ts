import type { ThreadData } from "@liveblocks/client";
import {
  buildCommentListItems as sharedBuildCommentListItems,
  type CommentListItem,
  type CommentThreadMetadata,
  type SelectionAnchor,
} from "@oncobase/wiki-comments/threads";

// Comment-thread logic now lives in the shared @oncobase/wiki-comments package
// (one source for both readers). Re-export the shared helpers; the only legacy
// difference is that page-level (unanchored) threads render on a separate path,
// so this reader's `buildCommentListItems` excludes them — a thin wrapper.
export {
  isSelectionAnchor,
  getThreadMetadata,
  getThreadAnchor,
  createThreadMetadata,
  sortThreads,
  getCommentPlainText,
} from "@oncobase/wiki-comments/threads";
export type { CommentListItem, CommentThreadMetadata, SelectionAnchor };

export function buildCommentListItems(
  threads: ThreadData[],
  draftAnchor?: SelectionAnchor | null,
): CommentListItem[] {
  return sharedBuildCommentListItems(threads, draftAnchor, {
    includeUnanchored: false,
  });
}
