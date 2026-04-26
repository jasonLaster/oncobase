import ArchivedChatsPage from "@diana-tnbc/chat/pages/archived-page";
import { chatConfigured } from "@/lib/chat-config";

export default function Page() {
  return <ArchivedChatsPage chatConfigured={chatConfigured} />;
}
