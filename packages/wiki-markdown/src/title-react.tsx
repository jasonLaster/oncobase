import { Suspense, lazy } from "react";
import { markdownTitleToText } from "./title.ts";
import type { MarkdownTitleProps } from "./title-react-impl.tsx";

export type {
  MarkdownTitleLinkProps,
  MarkdownTitleProps,
} from "./title-react-impl.tsx";
export { markdownTitleToText } from "./title.ts";

// Rendering markdown titles pulls in react-markdown and the remark/vfile
// dependency graph (~180 KiB gzip). Titles render in the eager reader shell
// (sidebar, mobile navigation), so the renderer loads lazily and falls back to
// the plain-text title until the chunk arrives.
const LazyMarkdownTitle = lazy(() =>
  import("./title-react-impl.tsx").then((module) => ({
    default: module.MarkdownTitle,
  })),
);

export function MarkdownTitle(props: MarkdownTitleProps) {
  return (
    <Suspense fallback={markdownTitleToText(props.title)}>
      <LazyMarkdownTitle {...props} />
    </Suspense>
  );
}
