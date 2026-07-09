"use client";

import { type ReactNode, useEffect, useState, lazy, Suspense } from "react";
import { DocumentOutlineShell } from "@oncobase/wiki-shell";
import { commentsEnabled } from "./feature.ts";
import type { LiveblocksProviderShellProps } from "./provider.tsx";

const ActiveComments = lazy(() => import("./active-comments.tsx"));
const MOBILE_COMMENTS_PANEL_EVENT = "mobile-comments-panel-open";

export function DocumentComments({
  articleClassName,
  contentKey,
  documentSlug,
  documentTitle,
  mobileRail,
  pathname,
  provider,
  children,
}: {
  articleClassName?: string;
  contentKey?: string;
  documentSlug: string;
  documentTitle: string;
  mobileRail?: boolean;
  pathname?: string;
  provider?: Omit<LiveblocksProviderShellProps, "children" | "fallback">;
  children: ReactNode;
}) {
  const [liveblocksActive, setLiveblocksActive] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("thread")) {
      const frameId = window.requestAnimationFrame(() => {
        setLiveblocksActive(true);
      });

      return () => window.cancelAnimationFrame(frameId);
    }
  }, []);

  useEffect(() => {
    if (!commentsEnabled) return;

    const activateComments = () => {
      setLiveblocksActive(true);
    };

    window.addEventListener(MOBILE_COMMENTS_PANEL_EVENT, activateComments);
    if (document.documentElement.dataset.mobileCommentsPanelRequested === "true") {
      activateComments();
    }

    return () => {
      window.removeEventListener(MOBILE_COMMENTS_PANEL_EVENT, activateComments);
    };
  }, []);

  if (!commentsEnabled) {
    return (
      <DocumentOutlineShell
        articleClassName={articleClassName}
        contentKey={contentKey ?? documentSlug}
        documentSlug={documentSlug}
        documentTitle={documentTitle}
        mobileRail={mobileRail}
        pathname={pathname}
      >
        {children}
      </DocumentOutlineShell>
    );
  }

  if (!liveblocksActive) {
    return (
      <DocumentOutlineShell
        articleClassName={articleClassName}
        contentKey={contentKey ?? documentSlug}
        documentSlug={documentSlug}
        documentTitle={documentTitle}
        mobileRail={mobileRail}
        onActivateComments={() => setLiveblocksActive(true)}
        pathname={pathname}
      >
        {children}
      </DocumentOutlineShell>
    );
  }

  return (
    <Suspense
      fallback={
        <DocumentOutlineShell
          articleClassName={articleClassName}
          contentKey={contentKey ?? documentSlug}
          documentSlug={documentSlug}
          documentTitle={documentTitle}
          mobileRail={mobileRail}
          pathname={pathname}
        >
          {children}
        </DocumentOutlineShell>
      }
    >
      <ActiveComments
        documentSlug={documentSlug}
        documentTitle={documentTitle}
        provider={provider}
      >
        {children}
      </ActiveComments>
    </Suspense>
  );
}
