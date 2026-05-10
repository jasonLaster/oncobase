"use client";

import { createContext, useContext, useMemo, type ComponentType, type ReactNode } from "react";
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
  LinkComponent?: ComponentType<{
    children: ReactNode;
    className?: string;
    href: string;
    title?: string;
  }>;
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
  LinkComponent,
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
  LinkComponent?: ComponentType<{
    children: ReactNode;
    className?: string;
    href: string;
    title?: string;
  }>;
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
        LinkComponent,
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
