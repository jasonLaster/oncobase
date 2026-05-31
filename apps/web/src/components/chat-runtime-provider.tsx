"use client";

import Link from "next/link";
import { ChatRuntimeProvider } from "@oncobase/chat/runtime";
import { api } from "@convex/_generated/api";
import { WikiChatMarkdownRenderer } from "@/components/chat-markdown-renderer";
import {
  WikiChatToolRenderer,
  extractWikiChatSources,
} from "@/components/wiki-chat-tooling";

const wikiChatCopy = {
  emptyStateTitle: "What questions do you have?",
  emptyStateDescription: "",
  suggestedPrompts: [
    { badge: "💊", label: "When does AC chemo start, and how long is the immune-suppression window after the last cycle?" },
    { badge: "🧬", label: "What's the optimal timing to start a personalized mRNA neoantigen vaccine relative to AC and pembrolizumab?" },
    { badge: "🧪", label: "Which mRNA vaccine trials (Moderna mRNA-4157, BNT122) are currently enrolling for TNBC, and when would the patient be eligible?" },
    { badge: "📊", label: "How does ctDNA clearance timing during NACT predict pCR and inform vaccine sequencing?" },
    { badge: "⏱️", label: "When should immune reconstitution be confirmed before starting neoantigen vaccination?" },
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
      LinkComponent={Link}
      MarkdownRenderer={WikiChatMarkdownRenderer}
      ToolCallRenderer={WikiChatToolRenderer}
      extractSources={extractWikiChatSources}
      copy={wikiChatCopy}
    >
      {children}
    </ChatRuntimeProvider>
  );
}
