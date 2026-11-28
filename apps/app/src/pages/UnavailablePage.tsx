import type { ReactNode } from "react";
import { Link } from "react-router";
import { openWikiAuthDialog, WikiPageActionButton } from "@oncobase/wiki-shell";
import { WikiEmptyState, WikiSensitiveUnavailable } from "@oncobase/wiki-shell/page-states";
import { emit } from "../reader-bus";

// Account sign-in, in place. A reader here is already past the shared
// password, so `/sign-in` would only send them straight back to this page.
// The reader reloads with the new session once the dialog signs in.
function openSignIn() {
  openWikiAuthDialog("signin");
}

export default function UnavailablePage({ before, publicView, restricted = false, slug }: {
  before?: ReactNode;
  restricted?: boolean;
  slug?: string;
  publicView: boolean;
}) {
  if (restricted) return (
    <WikiSensitiveUnavailable
      data-test-id="document-article"
      data-reader-unavailable="true"
      slug={slug}
      description={publicView
        ? "This page is restricted to readers with an account. The shared site password doesn't open it. Sign in with your account to continue."
        : "This page is restricted. Your account does not currently have access."}
      actions={<>
        {publicView ? <WikiPageActionButton className="wiki-shell-page-action-primary" onClick={openSignIn}>Sign in</WikiPageActionButton> : null}
        <Link className="wiki-shell-page-action page-action" to="/">Back to the wiki</Link>
      </>}
    />
  );
  return (
      <WikiEmptyState
        before={before}
        data-test-id="document-article"
      data-reader-unavailable="true"
        icon={publicView ? "lock" : "info"}
        title={publicView ? "This page may be restricted" : "Page not found"}
        description={publicView
          ? "This page isn't available with the shared site password. It may be restricted to readers with an account. Sign in with your account to check access. If it still isn't available, the link may have moved or the page may have been removed."
          : "This page isn't available to your account. It may have moved, been removed, or require additional access."}
        actions={
          <>
            {publicView ? (
              <WikiPageActionButton className="wiki-shell-page-action-primary" onClick={openSignIn}>Sign in</WikiPageActionButton>
            ) : null}
            <Link className="wiki-shell-page-action page-action" to="/">
              Go home
            </Link>
            <WikiPageActionButton
              onClick={() => emit("retry-page")}
            >
              Retry
            </WikiPageActionButton>
          </>
        }
      />
  );
}
