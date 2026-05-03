import ChatLayout from "@diana-tnbc/chat/pages/chat-layout";
import { chatConfigured } from "@/lib/chat-config";

// Chat routes call Convex queries that require an authenticated
// session; prerendering them at build time fails with a Server
// Error. Force the entire /chat segment dynamic.
export const dynamic = "force-dynamic";

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
