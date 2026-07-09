"use client";

import { WikiPageLoading } from "@oncobase/wiki-shell/page-states";

type PageLoadingSkeletonProps = {
  label?: string;
  testId?: string;
  includeTags?: boolean;
};

export function PageLoadingSkeleton({
  label = "Loading page",
  testId = "page-loading",
  includeTags = false,
}: PageLoadingSkeletonProps) {
  return (
    <WikiPageLoading
      data-test-id={testId}
      includeTags={includeTags}
      label={label}
    />
  );
}
