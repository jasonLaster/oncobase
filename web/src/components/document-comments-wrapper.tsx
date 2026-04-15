"use client";

import { type ReactNode, useState, lazy, Suspense } from "react";
import { OutlineShell, commentsEnabled } from "@/components/document-comments";

const ActiveComments = lazy(
  () => import("@/components/document-comments").then((m) => ({ default: m.ActiveDocumentComments }))
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

  if (!commentsEnabled) {
    return <OutlineShell>{children}</OutlineShell>;
  }

  if (!liveblocksActive) {
    return <OutlineShell onActivate={() => setLiveblocksActive(true)}>{children}</OutlineShell>;
  }

  return (
    <Suspense
      fallback={<OutlineShell>{children}</OutlineShell>}
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
