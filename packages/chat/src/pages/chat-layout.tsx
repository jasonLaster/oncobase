import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Toaster } from "sonner";

export const unstable_instant = false;

export default function ChatLayout({
  chatConfigured,
  children,
}: {
  chatConfigured: boolean;
  children: ReactNode;
}) {
  if (!chatConfigured) {
    redirect("/");
  }

  return (
    <>
      {children}
      {/* Keep the Sonner portal scoped to the chat feature so host-level
          dialogs do not inherit its z-index behavior. */}
      <Toaster
        richColors
        closeButton
        position="bottom-right"
        theme="system"
      />
    </>
  );
}
