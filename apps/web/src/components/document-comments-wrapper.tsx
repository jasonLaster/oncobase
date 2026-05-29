"use client";

import { type ReactNode, lazy, Suspense } from "react";
import { OutlineShell } from "@/components/document-comments";
import { commentsFeatureEnabled } from "@/lib/comments-feature";

const ActiveComments = lazy(
  () => import("@/components/document-comments").then((m) => ({ default: m.ActiveDocumentComments }))
);
const commentsEnabled = commentsFeatureEnabled();

export function DocumentComments({
  documentSlug,
  documentTitle,
  children,
}: {
  documentSlug: string;
  documentTitle: string;
  children: ReactNode;
}) {
  if (!commentsEnabled) {
    return (
      <OutlineShell documentSlug={documentSlug} documentTitle={documentTitle}>
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
