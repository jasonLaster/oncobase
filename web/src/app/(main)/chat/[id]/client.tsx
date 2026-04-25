"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ChatInterface } from "../_components/chat-interface";

// Module-level cache: snapshot initial messages per conversation ID
const messageCache = new Map<
  string,
  Array<{ _id?: string; role: "user" | "assistant"; content: string; parts?: string | unknown[]; disabled?: boolean }>
>();

export function ConversationPageClient({ id }: { id: string }) {
  const conversation = useQuery(api.conversations.get, {
    id: id as Id<"conversations">,
  });

  // Cache initial messages on first load per ID
  const initialMessages = useMemo(() => {
    if (messageCache.has(id)) return messageCache.get(id)!;
    if (!conversation) return undefined;
    const snapshot = conversation.messages.map((m) => ({
      _id: m._id,
      role: m.role,
      content: m.content,
      parts: m.parts,
      disabled: m.disabled,
    }));
    messageCache.set(id, snapshot);
    return snapshot;
  }, [id, conversation]);

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

  return (
    <ChatInterface
      key={id}
      conversationId={id}
      initialMessages={initialMessages}
    />
  );
}
