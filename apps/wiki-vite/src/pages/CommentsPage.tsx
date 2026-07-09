import { lazy, Suspense } from "react";
import { Link } from "react-router";

const LazyCommentsPageClient = lazy(() =>
  import("@oncobase/wiki-comments/page-client").then((module) => ({
    default: module.CommentsPageClient,
  })),
);

function CommentsPageFallback() {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--sidebar-border)] px-6 py-10 text-center text-sm text-[var(--text-muted)]">
      Loading comments...
    </div>
  );
}

export function CommentsPage() {
  return (
    <article className="page-shell comments-page-shell" data-test-id="comments-page">
      <header className="comments-page-header">
        <h1>Comments</h1>
      </header>
      <Suspense fallback={<CommentsPageFallback />}>
        <LazyCommentsPageClient
          renderDocumentLink={(href, label) => (
            <Link className="shrink-0 text-[var(--brand)] hover:underline" to={href}>
              {label}
            </Link>
          )}
        />
      </Suspense>
    </article>
  );
}
