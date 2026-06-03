"use client";

import {
  createContext,
  useContext,
  type ComponentType,
  type ReactNode,
} from "react";

/**
 * Comments auth is host-app-specific: the Next.js reader has a full session +
 * sign-in dialog, while the Vite reader uses anonymous Liveblocks guests. The
 * shared comments UI reads auth through this context so it stays decoupled from
 * either app. The default is a read-only guest with no sign-in affordance.
 */
export type CommentsSessionUser = {
  _id?: string;
  email: string;
  name: string | null;
};

export type CommentsAuthDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAuthSuccess: (user: CommentsSessionUser) => void;
};

export type CommentsAuthAdapter = {
  loadingUser: boolean;
  user: CommentsSessionUser | null;
  setUser: (user: CommentsSessionUser) => void;
  /** Sign-in dialog. When null (e.g. Vite guests) no sign-in prompt is shown. */
  AuthDialog: ComponentType<CommentsAuthDialogProps> | null;
};

const GUEST_ADAPTER: CommentsAuthAdapter = {
  loadingUser: false,
  user: null,
  setUser: () => {},
  AuthDialog: null,
};

const CommentsAuthContext = createContext<CommentsAuthAdapter>(GUEST_ADAPTER);

export function CommentsAuthProvider({
  value,
  children,
}: {
  value: CommentsAuthAdapter;
  children: ReactNode;
}) {
  return (
    <CommentsAuthContext.Provider value={value}>
      {children}
    </CommentsAuthContext.Provider>
  );
}

export function useCommentsAuth(): CommentsAuthAdapter {
  return useContext(CommentsAuthContext);
}
