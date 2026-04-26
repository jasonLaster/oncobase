import type { FunctionReference } from "convex/server";
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
