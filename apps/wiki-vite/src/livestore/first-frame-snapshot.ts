import { WIKI_READER_CACHE_VERSION } from "@oncobase/wiki-content";

const FIRST_FRAME_PREFIX = "wiki-vite:first-frame";
const MAX_FIRST_FRAME_BYTES = 2 * 1024 * 1024;

export type FirstFrameSnapshot = {
  html: string;
  pathname: string;
  title: string;
};

export function firstFrameSnapshotKey(origin: string) {
  return `${FIRST_FRAME_PREFIX}:${WIKI_READER_CACHE_VERSION}:${origin}`;
}

export function readFirstFrameSnapshot(
  storage: Pick<Storage, "getItem">,
  origin: string,
  pathname: string,
): FirstFrameSnapshot | null {
  try {
    const serialized = storage.getItem(firstFrameSnapshotKey(origin));
    if (!serialized) return null;
    const value = JSON.parse(serialized) as Partial<FirstFrameSnapshot>;
    if (
      value.pathname !== pathname ||
      typeof value.title !== "string" ||
      typeof value.html !== "string" ||
      !value.html.includes("data-test-id=\"document-article\"") ||
      !value.html.includes("data-test-id=\"wiki-sidebar\"") ||
      !value.html.includes("<h1")
    ) {
      return null;
    }
    return {
      html: value.html,
      pathname,
      title: value.title,
    };
  } catch {
    return null;
  }
}

export function persistFirstFrameSnapshot(
  storage: Pick<Storage, "setItem">,
  origin: string,
  snapshot: FirstFrameSnapshot,
) {
  const serialized = JSON.stringify(snapshot);
  if (new Blob([serialized]).size > MAX_FIRST_FRAME_BYTES) return false;
  try {
    storage.setItem(
      firstFrameSnapshotKey(origin),
      serialized,
    );
    return true;
  } catch {
    return false;
  }
}

export function dismissFirstFrameSnapshot(documentNode: Document = document) {
  documentNode.getElementById("wiki-first-frame-snapshot")?.remove();
  delete documentNode.documentElement.dataset.wikiFirstFrame;
}
