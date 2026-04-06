"use client";

import { use } from "react";
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

  if (conversation === undefined) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-[var(--text-muted)]">
        Loading...
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
      conversationId={id}
      initialMessages={conversation.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }))}
    />
  );
}
