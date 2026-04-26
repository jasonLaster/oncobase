"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ChatConvexApi, ChatMarkdownRenderer } from "./types";

interface ChatRuntimeValue {
  apiPath: string;
  convexApi: ChatConvexApi;
  MarkdownRenderer?: ChatMarkdownRenderer;
}

const ChatRuntimeContext = createContext<ChatRuntimeValue | null>(null);

export function ChatRuntimeProvider({
  apiPath = "/api/chat",
  children,
  convexApi,
  MarkdownRenderer,
}: {
  apiPath?: string;
  children: ReactNode;
  convexApi: ChatConvexApi;
  MarkdownRenderer?: ChatMarkdownRenderer;
}) {
  return (
    <ChatRuntimeContext.Provider value={{ apiPath, convexApi, MarkdownRenderer }}>
      {children}
    </ChatRuntimeContext.Provider>
  );
}

export function useChatRuntime(): ChatRuntimeValue {
  const value = useContext(ChatRuntimeContext);
  if (!value) {
    throw new Error("Chat components must be wrapped in <ChatRuntimeProvider>.");
  }
  return value;
}
