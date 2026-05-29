import type { Metadata } from "next";
import NewChatPage from "@oncobase/chat/pages/new-chat-page";
import { chatConfigured } from "@/lib/chat-config";

export const metadata: Metadata = {
  title: "Chat",
  description: "Ask questions about TNBC research and treatment",
  openGraph: {
    title: "Chat",
    description: "Ask questions about TNBC research and treatment",
  },
};

export default function Page() {
  return <NewChatPage chatConfigured={chatConfigured} />;
}
