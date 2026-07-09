"use client";

import { type ReactNode, useEffect, useState, lazy, Suspense } from "react";
import { DocumentOutlineShell } from "@oncobase/wiki-shell";
import { commentsEnabled } from "./feature.ts";
import type { LiveblocksProviderShellProps } from "./provider.tsx";

const ActiveComments = lazy(() => import("./active-comments.tsx"));

export function DocumentComments({
  articleClassName,
  contentKey,
  documentSlug,
  documentTitle,
  pathname,
  provider,
  children,
}: {
  articleClassName?: string;
  contentKey?: string;
  documentSlug: string;
  documentTitle: string;
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

  if (!commentsEnabled) {
    return (
      <DocumentOutlineShell
        articleClassName={articleClassName}
        contentKey={contentKey ?? documentSlug}
        documentSlug={documentSlug}
        documentTitle={documentTitle}
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
