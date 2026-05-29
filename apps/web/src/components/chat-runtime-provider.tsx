"use client";

import Link from "next/link";
import { ChatRuntimeProvider } from "@diana-tnbc/chat/runtime";
import { api } from "@convex/_generated/api";
import { DianaChatMarkdownRenderer } from "@/components/chat-markdown-renderer";
import {
  DianaChatToolRenderer,
  extractDianaChatSources,
} from "@/components/diana-chat-tooling";

const dianaChatCopy = {
  emptyStateTitle: "What questions do you have?",
  emptyStateDescription: "",
  suggestedPrompts: [
    { badge: "💊", label: "When does AC chemo start, and how long is the immune-suppression window after the last cycle?" },
    { badge: "🧬", label: "What's the optimal timing to start a personalized mRNA neoantigen vaccine relative to AC and pembrolizumab?" },
    { badge: "🧪", label: "Which mRNA vaccine trials (Moderna mRNA-4157, BNT122) are currently enrolling for TNBC, and when would Diana be eligible?" },
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
      MarkdownRenderer={DianaChatMarkdownRenderer}
      ToolCallRenderer={DianaChatToolRenderer}
      extractSources={extractDianaChatSources}
      copy={dianaChatCopy}
    >
      {children}
    </ChatRuntimeProvider>
  );
}
