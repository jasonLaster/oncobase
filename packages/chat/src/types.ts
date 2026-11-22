import type { FunctionReference } from "convex/server";
import type { UIMessage } from "ai";
import type { ComponentType } from "react";

export type ChatQueryRef = FunctionReference<"query", "public", any, any>;
export type ChatMutationRef = FunctionReference<"mutation", "public", any, any>;

export interface ChatConvexApi {
  conversations: {
    list: ChatQueryRef;
    listArchived: ChatQueryRef;
    get: ChatQueryRef;
    getMessages: ChatQueryRef;
    getStreamingState: ChatQueryRef;
    getCancelState: ChatQueryRef;
    create: ChatMutationRef;
    beginRun: ChatMutationRef;
    updateStreaming: ChatMutationRef;
    clearStreaming: ChatMutationRef;
    cancelStream: ChatMutationRef;
    clearCancel: ChatMutationRef;
    archive: ChatMutationRef;
    restore: ChatMutationRef;
    saveMessages: ChatMutationRef;
    sendMessage: ChatMutationRef;
    disableMessage: ChatMutationRef;
  };
}

export interface ChatMarkdownRendererProps {
  content: string;
  disableAnchors?: boolean;
  isStreaming?: boolean;
}

export type ChatMarkdownRenderer = ComponentType<ChatMarkdownRendererProps>;

export type SuggestedPrompt = string | { label: string; badge?: string };

export interface ChatCopy {
  newChatLabel?: string;
  loadingConversations?: string;
  noConversations?: string;
  viewArchivedLabel?: string;
  archivedTitle?: string;
  noArchivedConversations?: string;
  restoreLabel?: string;
  loadingConversation?: string;
  conversationNotFound?: string;
  emptyStateTitle?: string;
  emptyStateDescription?: string;
  suggestedPrompts?: SuggestedPrompt[];
  promptPlaceholder?: string;
  generatingLabel?: string;
  sourcesLabel?: string;
}

export type ResolvedChatCopy = Required<ChatCopy>;

export interface ChatToolCallRendererProps {
  toolName: string;
  state: string;
  done: boolean;
  output?: unknown;
  input?: unknown;
}

export type ChatToolCallRenderer = ComponentType<ChatToolCallRendererProps>;

/** Extra action rendered in an assistant message's action row (e.g. "Review updates"). */
export interface ChatMessageActionProps {
  parts: UIMessage["parts"];
}

export type ChatMessageAction = ComponentType<ChatMessageActionProps>;

export interface ChatSource {
  id?: string;
  title: string;
  href?: string;
}

export type ChatSourceExtractor = (parts: UIMessage["parts"]) => ChatSource[];
