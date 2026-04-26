import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChatInterface } from "../components/chat-interface";

export const metadata: Metadata = {
  title: "Chat",
  description: "Ask questions about TNBC research and treatment",
  openGraph: { title: "Chat", description: "Ask questions about TNBC research and treatment" },
};

export default function NewChatPage({
  chatConfigured,
}: {
  chatConfigured: boolean;
}) {
  if (!chatConfigured) {
    redirect("/");
  }

  return <ChatInterface conversationId={null} />;
}
