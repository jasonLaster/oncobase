import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChatInterface } from "./_components/chat-interface";
import { chatConfigured } from "@/lib/chat-config";

export const metadata: Metadata = {
  title: "Chat",
  description: "Ask questions about TNBC research and treatment",
  openGraph: { title: "Chat", description: "Ask questions about TNBC research and treatment" },
};

export default function NewChatPage() {
  if (!chatConfigured) {
    redirect("/");
  }

  return <ChatInterface conversationId={null} />;
}
