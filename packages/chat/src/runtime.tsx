"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { resolveChatCopy } from "./copy";
import { createChatRoutes, type ChatRouteConfig, type ChatRoutes } from "./routes";
import type {
  ChatConvexApi,
  ChatCopy,
  ChatMarkdownRenderer,
  ChatSourceExtractor,
  ChatToolCallRenderer,
  ResolvedChatCopy,
} from "./types";

interface ChatRuntimeValue {
  apiPath: string;
  convexApi: ChatConvexApi;
  copy: ResolvedChatCopy;
  routes: ChatRoutes;
  storageKeyPrefix: string;
  MarkdownRenderer?: ChatMarkdownRenderer;
  ToolCallRenderer?: ChatToolCallRenderer;
  extractSources?: ChatSourceExtractor;
}

const ChatRuntimeContext = createContext<ChatRuntimeValue | null>(null);

export function ChatRuntimeProvider({
  apiPath = "/api/chat",
  children,
  convexApi,
  copy,
  routes,
  storageKeyPrefix = "chat",
  MarkdownRenderer,
  ToolCallRenderer,
  extractSources,
}: {
  apiPath?: string;
  children: ReactNode;
  convexApi: ChatConvexApi;
  copy?: ChatCopy;
  routes?: ChatRouteConfig;
  storageKeyPrefix?: string;
  MarkdownRenderer?: ChatMarkdownRenderer;
  ToolCallRenderer?: ChatToolCallRenderer;
  extractSources?: ChatSourceExtractor;
}) {
  const resolvedCopy = useMemo(() => resolveChatCopy(copy), [copy]);
  const resolvedRoutes = useMemo(() => createChatRoutes(routes), [routes]);

  return (
    <ChatRuntimeContext.Provider
      value={{
        apiPath,
        convexApi,
        copy: resolvedCopy,
        routes: resolvedRoutes,
        storageKeyPrefix,
        MarkdownRenderer,
        ToolCallRenderer,
        extractSources,
      }}
    >
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
