"use client";

import { use, useRef } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ChatInterface } from "../_components/chat-interface";

export default function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const conversation = useQuery(api.conversations.get, {
    id: id as Id<"conversations">,
  });

  // Cache initial messages per conversation ID to prevent
  // Convex reactive updates from resetting useChat state
  const cacheRef = useRef<
    Record<string, Array<{ role: "user" | "assistant"; content: string; parts?: string }>>
  >({});

  if (conversation === undefined) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-[var(--text-muted)]">
        <span className="inline-block w-4 h-4 border-2 border-[var(--text-muted)] border-t-transparent rounded-full animate-spin mr-2" />
        Loading conversation...
      </div>
    );
  }

  if (conversation === null) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-[var(--text-muted)]">
        Conversation not found
      </div>
    );
  }

  // Only cache on first load per ID
  if (!cacheRef.current[id]) {
    cacheRef.current[id] = conversation.messages.map((m) => ({
      role: m.role,
      content: m.content,
      parts: m.parts,
    }));
  }

  return (
    <ChatInterface
      key={id}
      conversationId={id}
      initialMessages={cacheRef.current[id]}
      serverStreamingText={conversation.streamingText}
    />
  );
}
