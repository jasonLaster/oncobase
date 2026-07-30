import type { WikiActionsMenuAuthMode } from "./actions-menu.tsx";

export const WIKI_AUTH_DIALOG_EVENT = "wiki-shell-open-auth-dialog";

export function openWikiAuthDialog(
  mode: WikiActionsMenuAuthMode = "signin",
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<{ mode: WikiActionsMenuAuthMode }>(
      WIKI_AUTH_DIALOG_EVENT,
      { detail: { mode } },
    ),
  );
}
