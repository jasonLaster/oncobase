"use client";

import { type ReactNode, useEffect, useState, lazy, Suspense } from "react";
import { OutlineShell, commentsEnabled } from "./index";

const ActiveComments = lazy(
  () => import("./index").then((m) => ({ default: m.ActiveDocumentComments }))
);

export function DocumentComments({
  documentSlug,
  documentTitle,
  children,
}: {
  documentSlug: string;
  documentTitle: string;
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
      <OutlineShell documentSlug={documentSlug} documentTitle={documentTitle}>
        {children}
      </OutlineShell>
    );
  }

  if (!liveblocksActive) {
    return (
      <OutlineShell
        documentSlug={documentSlug}
        documentTitle={documentTitle}
        onActivate={() => setLiveblocksActive(true)}
      >
        {children}
      </OutlineShell>
    );
  }

  return (
    <Suspense
      fallback={
        <OutlineShell documentSlug={documentSlug} documentTitle={documentTitle}>
          {children}
        </OutlineShell>
      }
    >
      <ActiveComments
        documentSlug={documentSlug}
        documentTitle={documentTitle}
      >
        {children}
      </ActiveComments>
    </Suspense>
  );
}
