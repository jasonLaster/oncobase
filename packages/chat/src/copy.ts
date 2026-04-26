import type { ChatCopy, ResolvedChatCopy } from "./types";

export const defaultChatCopy: ResolvedChatCopy = {
  newChatLabel: "New chat",
  loadingConversations: "Loading...",
  noConversations: "No conversations yet",
  viewArchivedLabel: "View archived",
  archivedTitle: "Archived Chats",
  noArchivedConversations: "No archived conversations.",
  restoreLabel: "Restore",
  loadingConversation: "Loading conversation...",
  conversationNotFound: "Conversation not found",
  emptyStateTitle: "Assistant",
  emptyStateDescription: "Ask a question to start a conversation",
  suggestedPrompts: [],
  promptPlaceholder: "Ask a question...",
  generatingLabel: "Generating response",
  sourcesLabel: "Sources",
};

export function resolveChatCopy(copy: ChatCopy | undefined): ResolvedChatCopy {
  return {
    ...defaultChatCopy,
    ...copy,
    suggestedPrompts:
      copy?.suggestedPrompts ?? defaultChatCopy.suggestedPrompts,
  };
}
