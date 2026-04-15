import type { ThreadData } from "@liveblocks/client";

export type CommentThreadMetadata = {
  anchorStart?: number;
  anchorEnd?: number;
  anchorQuote?: string;
  anchorPrefix?: string;
  anchorSuffix?: string;
  documentSlug?: string;
  documentTitle?: string;
};

export type SelectionAnchor = {
  start: number;
  end: number;
  quote: string;
  prefix: string;
  suffix: string;
};

export function isSelectionAnchor(value: unknown): value is SelectionAnchor {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.start === "number" &&
    typeof candidate.end === "number" &&
    typeof candidate.quote === "string" &&
    typeof candidate.prefix === "string" &&
    typeof candidate.suffix === "string"
  );
}

export function getThreadMetadata(thread: ThreadData): CommentThreadMetadata | undefined {
  if (!thread.metadata || typeof thread.metadata !== "object") return undefined;
  return thread.metadata as CommentThreadMetadata;
}

export function getThreadAnchor(thread: ThreadData) {
  const metadata = getThreadMetadata(thread);
  const anchor = {
    start: metadata?.anchorStart,
    end: metadata?.anchorEnd,
    quote: metadata?.anchorQuote,
    prefix: metadata?.anchorPrefix,
    suffix: metadata?.anchorSuffix,
  };
  return isSelectionAnchor(anchor) ? anchor : null;
}

export function createThreadMetadata({
  anchor,
  documentSlug,
  documentTitle,
}: {
  anchor?: SelectionAnchor | null;
  documentSlug: string;
  documentTitle: string;
}): CommentThreadMetadata {
  return {
    documentSlug,
    documentTitle,
    anchorStart: anchor?.start,
    anchorEnd: anchor?.end,
    anchorQuote: anchor?.quote,
    anchorPrefix: anchor?.prefix,
    anchorSuffix: anchor?.suffix,
  };
}

export function sortThreads(threads: ThreadData[]) {
  return [...threads].sort((a, b) => {
    const aAnchor = getThreadAnchor(a);
    const bAnchor = getThreadAnchor(b);
    if (aAnchor && bAnchor && aAnchor.start !== bAnchor.start) {
      return aAnchor.start - bAnchor.start;
    }
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

export function getCommentPlainText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const content = (body as { content?: Array<{ children?: Array<{ text?: string }> }> }).content;
  if (!Array.isArray(content)) return "";

  return content
    .flatMap((block) =>
      Array.isArray(block.children)
        ? block.children.map((child) => child.text ?? "")
        : []
    )
    .join("")
    .trim();
}
