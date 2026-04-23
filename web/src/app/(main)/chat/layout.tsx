import { redirect } from "next/navigation";
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

  return <>{children}</>;
}
