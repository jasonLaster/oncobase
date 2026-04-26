import { redirect } from "next/navigation";
import { Toaster } from "sonner";
import { chatConfigured } from "@/lib/chat-config";

export const unstable_instant = false;

export const chatEnabled = chatConfigured;

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!chatEnabled) {
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
