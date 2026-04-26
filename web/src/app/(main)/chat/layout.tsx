import ChatLayout from "@diana-tnbc/chat/pages/chat-layout";
import { chatConfigured } from "@/lib/chat-config";

export const unstable_instant = false;
export const chatEnabled = chatConfigured;

export default function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ChatLayout chatConfigured={chatConfigured}>
      {children}
    </ChatLayout>
  );
}
