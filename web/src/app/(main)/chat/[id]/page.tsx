import ConversationPage from "@diana-tnbc/chat/pages/conversation-page";
import { chatConfigured } from "@/lib/chat-config";

export default function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <ConversationPage chatConfigured={chatConfigured} params={params} />;
}
