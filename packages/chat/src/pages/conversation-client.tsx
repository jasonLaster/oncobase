"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { ChatInterface } from "../components/chat-interface";
import { useChatRuntime } from "../runtime";

type CachedSnapshot = Array<{
  _id?: string;
  role: "user" | "assistant";
  content: string;
  parts?: string | unknown[];
  disabled?: boolean;
}>;

// Module-level LRU cache: snapshot initial messages per conversation ID.
// Phase 8 of the chat-performance plan: bounded so heavy navigators don't
// leak memory. Implemented as a Map (insertion-ordered) + delete-on-set,
// no library.
const MAX_CACHE_SIZE = 20;
const messageCache = new Map<string, CachedSnapshot>();

function lruGet(id: string): CachedSnapshot | undefined {
  const v = messageCache.get(id);
  if (v) {
    messageCache.delete(id);
    messageCache.set(id, v);
  }
  return v;
}

function lruSet(id: string, value: CachedSnapshot): void {
  if (messageCache.has(id)) messageCache.delete(id);
  messageCache.set(id, value);
  if (messageCache.size > MAX_CACHE_SIZE) {
    const oldest = messageCache.keys().next().value;
    if (oldest !== undefined) messageCache.delete(oldest);
  }
}

export function ConversationPageClient({ id }: { id: string }) {
  const { convexApi, copy } = useChatRuntime();
  const conversation = useQuery(convexApi.conversations.get, { id });

  // Cache initial messages on first load per ID.
  const initialMessages = useMemo(() => {
    const cached = lruGet(id);
    if (cached) return cached;
    if (!conversation) return undefined;
    const snapshot: CachedSnapshot = conversation.messages.map((m: CachedSnapshot[number]) => ({
      _id: m._id,
      role: m.role,
      content: m.content,
      parts: m.parts,
      disabled: m.disabled,
    }));
    lruSet(id, snapshot);
    return snapshot;
  }, [id, conversation]);

  if (conversation === undefined) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-[var(--text-muted)]">
        <span className="inline-block w-4 h-4 border-2 border-[var(--text-muted)] border-t-transparent rounded-full animate-spin mr-2" />
        {copy.loadingConversation}
      </div>
    );
  }

  if (conversation === null) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-[var(--text-muted)]">
        {copy.conversationNotFound}
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
