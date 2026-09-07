import type { ReactNode } from "react";
import { Link } from "react-router";
import { WikiPageActionButton } from "@oncobase/wiki-shell";
import { WikiEmptyState, WikiSensitiveUnavailable } from "@oncobase/wiki-shell/page-states";
import { RETRY_PAGE_EVENT } from "../sync/WikiSync";

export default function UnavailablePage({ before, publicView, signInHref, restricted = false, slug }: {
  before?: ReactNode;
  restricted?: boolean;
  slug?: string;
  publicView: boolean;
  signInHref: string;
}) {
  if (restricted) return (
    <WikiSensitiveUnavailable
      data-test-id="document-article"
      data-reader-unavailable="true"
      slug={slug}
      description={publicView
        ? "This page is restricted to readers with access. Sign in to continue to this page."
        : "This page is restricted. Your account does not currently have access."}
      actions={<>
        {publicView ? <Link className="wiki-shell-page-action page-action" to={signInHref}>Sign in</Link> : null}
        <Link className="wiki-shell-page-action page-action" to="/">Back to the wiki</Link>
      </>}
    />
  );
  return (
      <WikiEmptyState
        before={before}
        data-test-id="document-article"
      data-reader-unavailable="true"
        title={publicView ? "This page may be restricted" : "Page not found"}
        description={publicView
          ? "This page isn't available in the public wiki. It may be restricted to readers with access. Sign in to check access and return to this page. If it still isn't available, the link may have moved or the page may have been removed."
          : "This page isn't available to your account. It may have moved, been removed, or require additional access."}
        actions={
          <>
            {publicView ? (
              <Link className="wiki-shell-page-action page-action" to={signInHref}>Sign in</Link>
            ) : null}
            <Link className="wiki-shell-page-action page-action" to="/">
              Go home
            </Link>
            <WikiPageActionButton
              onClick={() => window.dispatchEvent(new Event(RETRY_PAGE_EVENT))}
            >
              Retry
            </WikiPageActionButton>
          </>
        }
      />
  );
}
