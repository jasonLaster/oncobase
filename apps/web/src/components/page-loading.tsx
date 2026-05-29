"use client";

import { WikiPageSkeleton } from "@oncobase/wiki-shell";

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
    <div
      aria-label={label}
      className="h-full overflow-y-auto"
      data-test-id={testId}
      role="status"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-4 md:px-8 md:py-8">
        <div className="min-w-0 flex-1">
          <WikiPageSkeleton
            data-test-id={`${testId}-article`}
            includeTags={includeTags}
            label={label}
          />
        </div>
      </div>
    </div>
  );
}
