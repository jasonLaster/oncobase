import type { Metadata } from "next";
import { ChatInterface } from "./_components/chat-interface";

export const metadata: Metadata = {
  title: "Chat",
  description: "Ask questions about TNBC research and treatment",
  openGraph: { title: "Chat", description: "Ask questions about TNBC research and treatment" },
};

export default function NewChatPage() {
  return <ChatInterface conversationId={null} />;
}
