"use client";

import Link from "next/link";
import { wikiChatCopy } from "@oncobase/wiki-content";
import { ChatRuntimeProvider } from "@oncobase/chat/runtime";
import { api } from "@convex/_generated/api";
import { WikiChatMarkdownRenderer } from "@/components/chat-markdown-renderer";
import {
  WikiChatToolRenderer,
  extractWikiChatSources,
} from "@/components/wiki-chat-tooling";


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
