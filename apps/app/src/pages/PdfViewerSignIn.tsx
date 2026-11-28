import { useState } from "react";
import {
  WikiAuthDialog,
  type WikiActionsMenuAuthInput,
  type WikiActionsMenuUser,
} from "@oncobase/wiki-shell/actions-menu";

/** Account sign-in from the viewer: the shared password never unlocks restricted files. */
async function submitAuth(input: WikiActionsMenuAuthInput): Promise<WikiActionsMenuUser> {
  const response = await fetch(input.mode === "signup" ? "/api/auth/signup" : "/api/auth/signin", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input.mode === "signup"
      ? { name: input.name, email: input.email, password: input.password }
      : { email: input.email, password: input.password }),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({})) as { error?: unknown };
    throw new Error(typeof failure.error === "string" ? failure.error : "Something went wrong");
  }
  const data = await response.json().catch(() => ({})) as { user?: WikiActionsMenuUser };
  if (!data.user) throw new Error("The server did not return a user session");
  window.dispatchEvent(new CustomEvent("wiki-auth-session-change"));
  return data.user;
}

/** A "Sign in" button that opens the account dialog in place and reopens the PDF on success. */
export default function PdfViewerSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="pdf-viewer-action pdf-viewer-action-primary" onClick={() => setOpen(true)}>Sign in</button>
    <WikiAuthDialog
      initialMode="signin"
      open={open}
      onAuthSubmit={submitAuth}
      onClose={() => setOpen(false)}
      onSessionChange={user => { if (user) { setOpen(false); onSignedIn(); } }}
    />
  </>;
}
