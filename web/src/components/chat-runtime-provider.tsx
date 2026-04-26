"use client";

import { ChatRuntimeProvider } from "@diana-tnbc/chat/runtime";
import { api } from "@convex/_generated/api";
import { DianaChatMarkdownRenderer } from "@/components/chat-markdown-renderer";
import {
  DianaChatToolRenderer,
  extractDianaChatSources,
} from "@/components/diana-chat-tooling";

const dianaChatCopy = {
  emptyStateTitle: "Research Assistant",
  emptyStateDescription:
    "Ask questions about the diagnosis, treatment, and research",
  suggestedPrompts: [
    "What is the treatment plan?",
    "Explain ctDNA monitoring options",
    "What clinical trials are relevant?",
    "Summarize the prognosis",
  ],
  promptPlaceholder: "Ask a question...",
};

export function WebChatRuntimeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ChatRuntimeProvider
      convexApi={{ conversations: api.conversations }}
      MarkdownRenderer={DianaChatMarkdownRenderer}
      ToolCallRenderer={DianaChatToolRenderer}
      extractSources={extractDianaChatSources}
      copy={dianaChatCopy}
    >
      {children}
    </ChatRuntimeProvider>
  );
}
