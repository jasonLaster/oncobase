import {
  WIKI_PREVIOUS_READER_CACHE_VERSION,
  WIKI_READER_CACHE_VERSION,
} from "@oncobase/wiki-content";

const FIRST_FRAME_PREFIX = "wiki-vite:first-frame";
const MAX_FIRST_FRAME_BYTES = 2 * 1024 * 1024;

export type FirstFrameSnapshot = {
  html: string;
  pathname: string;
};

type PersistedFirstFrameSnapshot = FirstFrameSnapshot & {
  readerCacheVersion?: string;
  validatedAt?: number;
};

export type FirstFrameSnapshotFallback = FirstFrameSnapshot & {
  readerCacheVersion: string;
};

export function firstFrameSnapshotKey(
  origin: string,
  readerCacheVersion: string = WIKI_READER_CACHE_VERSION,
) {
  return `${FIRST_FRAME_PREFIX}:${readerCacheVersion}:${origin}`;
}

function readVersionedFirstFrameSnapshot(
  storage: Pick<Storage, "getItem">,
  origin: string,
  pathname: string,
  readerCacheVersion: string,
  requireValidation: boolean,
): FirstFrameSnapshot | null {
  try {
    const serialized = storage.getItem(
      firstFrameSnapshotKey(origin, readerCacheVersion),
    );
    if (!serialized) return null;
    const value = JSON.parse(serialized) as Partial<PersistedFirstFrameSnapshot>;
    const hasValidMetadata =
      value.readerCacheVersion === readerCacheVersion &&
      typeof value.validatedAt === "number" &&
      Number.isFinite(value.validatedAt) &&
      value.validatedAt > 0;
    if (
      (requireValidation && !hasValidMetadata) ||
      (value.readerCacheVersion !== undefined &&
        value.readerCacheVersion !== readerCacheVersion) ||
      value.pathname !== pathname ||
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
    };
  } catch {
    return null;
  }
}

export function readFirstFrameSnapshot(
  storage: Pick<Storage, "getItem">,
  origin: string,
  pathname: string,
): FirstFrameSnapshot | null {
  // Current-generation snapshots written before validation metadata was added
  // remain safe: they were already gated on a validated current projection.
  return readVersionedFirstFrameSnapshot(
    storage,
    origin,
    pathname,
    WIKI_READER_CACHE_VERSION,
    false,
  );
}

export function readFirstFrameSnapshotFallback(
  storage: Pick<Storage, "getItem">,
  origin: string,
  pathname: string,
): FirstFrameSnapshotFallback | null {
  const current = readFirstFrameSnapshot(storage, origin, pathname);
  if (current) {
    return {
      ...current,
      readerCacheVersion: WIKI_READER_CACHE_VERSION,
    };
  }
  const previous = readVersionedFirstFrameSnapshot(
    storage,
    origin,
    pathname,
    WIKI_PREVIOUS_READER_CACHE_VERSION,
    true,
  );
  return previous
    ? {
        ...previous,
        readerCacheVersion: WIKI_PREVIOUS_READER_CACHE_VERSION,
      }
    : null;
}

export function persistFirstFrameSnapshot(
  storage: Pick<Storage, "setItem">,
  origin: string,
  snapshot: FirstFrameSnapshot,
  {
    readerCacheVersion = WIKI_READER_CACHE_VERSION,
    validatedAt,
  }: {
    readerCacheVersion?: string;
    validatedAt: number;
  },
) {
  if (!Number.isFinite(validatedAt) || validatedAt <= 0) return false;
  const serialized = JSON.stringify({
    ...snapshot,
    readerCacheVersion,
    validatedAt,
  } satisfies PersistedFirstFrameSnapshot);
  if (new Blob([serialized]).size > MAX_FIRST_FRAME_BYTES) return false;
  try {
    storage.setItem(
      firstFrameSnapshotKey(origin, readerCacheVersion),
      serialized,
    );
    return true;
  } catch {
    return false;
  }
}

export function retirePreviousFirstFrameSnapshot(
  storage: Pick<Storage, "removeItem">,
  origin: string,
) {
  try {
    storage.removeItem(
      firstFrameSnapshotKey(origin, WIKI_PREVIOUS_READER_CACHE_VERSION),
    );
  } catch {
    // Current hydrated content remains authoritative if cleanup is blocked.
  }
}

export function dismissFirstFrameSnapshot(documentNode: Document = document) {
  documentNode.getElementById("wiki-first-frame-snapshot")?.remove();
  delete documentNode.documentElement.dataset.wikiFirstFrame;
  delete documentNode.documentElement.dataset.wikiFirstFrameVersion;
}
