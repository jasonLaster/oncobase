import { CommentsPageClient } from "@oncobase/wiki-comments/page-client";
import { Link } from "react-router";

export function CommentsPage() {
  return (
    <article className="page-shell comments-page-shell" data-test-id="comments-page">
      <header className="comments-page-header">
        <h1>Comments</h1>
      </header>
      <CommentsPageClient
        renderDocumentLink={(href, label) => (
          <Link className="shrink-0 text-[var(--brand)] hover:underline" to={href}>
            {label}
          </Link>
        )}
      />
    </article>
  );
}
