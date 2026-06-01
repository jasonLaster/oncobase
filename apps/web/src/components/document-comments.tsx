"use client";

import type { ReactNode } from "react";
import {
  ActiveDocumentComments as SharedActiveDocumentComments,
  OutlineShell,
} from "@oncobase/wiki-comments";
import { CommentsAuthProvider } from "@oncobase/wiki-comments/auth-context";
import { AuthDialog, useSessionUser } from "@/components/actions-menu";

// The document comments UI now lives in the shared @oncobase/wiki-comments
// package (one source for both readers). This reader bridges its session +
// sign-in dialog into the package's auth context; the Vite reader provides no
// bridge, so it falls back to anonymous Liveblocks guests.
export { OutlineShell };

function NextCommentsAuthBridge({ children }: { children: ReactNode }) {
  const { loadingUser, user, setUser } = useSessionUser();
  return (
    <CommentsAuthProvider value={{ loadingUser, user, setUser, AuthDialog }}>
      {children}
    </CommentsAuthProvider>
  );
}

export function ActiveDocumentComments(props: {
  documentSlug: string;
  documentTitle: string;
  children: ReactNode;
}) {
  return (
    <NextCommentsAuthBridge>
      <SharedActiveDocumentComments {...props} />
    </NextCommentsAuthBridge>
  );
}
