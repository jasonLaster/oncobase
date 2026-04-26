import { redirect } from "next/navigation";
import { ChatInterface } from "../components/chat-interface";

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
