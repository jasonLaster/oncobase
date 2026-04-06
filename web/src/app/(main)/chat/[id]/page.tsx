"use client";

import { use, useMemo, useRef } from "react";
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

  // Track which IDs we've already cached so we only snapshot on first load
  const cachedIds = useRef<Set<string>>(new Set());

  const initialMessages = useMemo(() => {
    if (!conversation || cachedIds.current.has(id)) return undefined;
    cachedIds.current.add(id);
    return conversation.messages.map((m) => ({
      _id: m._id,
      role: m.role,
      content: m.content,
      parts: m.parts,
      disabled: m.disabled,
    }));
  }, [id, conversation]);

  // Keep latest snapshot across re-renders
  const snapshotRef = useRef(initialMessages);
  if (initialMessages !== undefined) {
    snapshotRef.current = initialMessages;
  }

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
      initialMessages={snapshotRef.current}
    />
  );
}
