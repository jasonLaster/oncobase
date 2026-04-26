export { metadata } from "@diana-tnbc/chat/pages/new-chat-page";
import NewChatPage from "@diana-tnbc/chat/pages/new-chat-page";
import { chatConfigured } from "@/lib/chat-config";

export default function Page() {
  return <NewChatPage chatConfigured={chatConfigured} />;
}
