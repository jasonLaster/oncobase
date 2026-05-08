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
      className="h-full overflow-y-auto"
      role="status"
      aria-label={label}
      data-test-id={testId}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-4 md:px-8 md:py-8">
        <div className="min-w-0 flex-1">
          <article
            className="relative mx-auto max-w-4xl overflow-visible pr-4 md:pr-8"
            data-test-id={`${testId}-article`}
          >
            <header className="mb-6">
              <div className="flex items-start justify-between gap-3">
                <div className="h-9 w-2/3 max-w-2xl animate-pulse rounded-md bg-[var(--accent-light)]" />
                <div className="h-8 w-8 shrink-0 animate-pulse rounded-md bg-[var(--accent-light)]" />
              </div>
              {includeTags ? (
                <div className="mt-3 flex gap-1.5">
                  <div className="h-5 w-16 animate-pulse rounded-full bg-[var(--accent-light)]" />
                  <div className="h-5 w-24 animate-pulse rounded-full bg-[var(--accent-light)]" />
                </div>
              ) : null}
            </header>

            <div className="space-y-4">
              <div className="h-4 w-full animate-pulse rounded bg-[var(--accent-light)]" />
              <div className="h-4 w-[92%] animate-pulse rounded bg-[var(--accent-light)]" />
              <div className="h-4 w-[76%] animate-pulse rounded bg-[var(--accent-light)]" />
              <div className="h-28 w-full animate-pulse rounded-lg bg-[var(--accent-light)]" />
              {includeTags ? (
                <>
                  <div className="h-4 w-[88%] animate-pulse rounded bg-[var(--accent-light)]" />
                  <div className="h-4 w-[64%] animate-pulse rounded bg-[var(--accent-light)]" />
                </>
              ) : null}
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}
