"use client";

import { ChatRuntimeProvider } from "@diana-tnbc/chat/runtime";
import { api } from "@convex/_generated/api";
import { DianaChatMarkdownRenderer } from "@/components/chat-markdown-renderer";

export function WebChatRuntimeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ChatRuntimeProvider
      convexApi={{ conversations: api.conversations }}
      MarkdownRenderer={DianaChatMarkdownRenderer}
    >
      {children}
    </ChatRuntimeProvider>
  );
}
