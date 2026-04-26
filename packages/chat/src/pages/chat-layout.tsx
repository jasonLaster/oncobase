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
      {/* Toaster mounted only on the chat path so the (very-high-z-index)
          Sonner portal doesn't shadow Radix command-palette dialogs on
          wiki pages. */}
      <Toaster
        richColors
        closeButton
        position="bottom-right"
        theme="system"
      />
    </>
  );
}
