import { ArchivedChatsCore } from "@oncobase/chat/components/archived-chats-core";
import { ChatInterface } from "@oncobase/chat/components/chat-interface";
import { useChatRuntime } from "@oncobase/chat/runtime";
import {
  WikiChatMain,
  WikiChatLoadingSkeleton,
  WikiChatPage,
  WikiChatSidebar,
  WikiChatState,
} from "@oncobase/wiki-shell";
import { useMutation, useQuery } from "convex/react";
import { Link, useParams } from "react-router";
import { api } from "../../../../apps/web/convex/_generated/api.js";
import type { Id } from "../../../../apps/web/convex/_generated/dataModel.js";
import { useWikiSession } from "../wiki-context";
import { ChatConversationList } from "./ChatConversationList";
import { ChatProviders } from "./ChatProviders";

function ArchivedChatsRoute() {
  const identity = useWikiSession();
  const siteArgs = identity?.siteSlug ? { siteSlug: identity.siteSlug } : {};
  const archived = useQuery(api.conversations.listArchived, siteArgs);
  const restoreConversation = useMutation(api.conversations.restore);
  const { copy, routes } = useChatRuntime();

  return (
    <ArchivedChatsCore
      archived={archived}
      copy={copy}
      onRestore={async (conversation) => {
        await restoreConversation({
          id: conversation._id as Id<"conversations">,
          ...siteArgs,
        });
      }}
      renderLink={({ href, children, ...linkProps }) => (
        <Link {...linkProps} to={href}>
          {children}
        </Link>
      )}
      routes={routes}
    />
  );
}

function ChatRouteContent() {
  const { id } = useParams();
  const identity = useWikiSession();
  const siteArgs = identity?.siteSlug ? { siteSlug: identity.siteSlug } : {};
  const conversation = useQuery(
    api.conversations.get,
    id && id !== "archived" ? { id, ...siteArgs } : "skip",
  );
  if (id === "archived") {
    return <ArchivedChatsRoute />;
  }
  if (!id) return <ChatInterface conversationId={null} />;
  if (conversation === undefined) {
    return <WikiChatLoadingSkeleton data-test-id="chat-conversation-loading" />;
  }
  if (conversation === null) {
    return (
      <WikiChatState data-test-id="chat-conversation-not-found">
        Conversation not found
      </WikiChatState>
    );
  }
  return (
    <ChatInterface
      conversationId={id}
      initialMessages={conversation.messages.map((message) => ({
        _id: message._id,
        role: message.role,
        content: message.content,
        parts: message.parts,
        disabled: message.disabled,
      }))}
    />
  );
}

export function ChatPage() {
  return (
    <ChatProviders>
      <WikiChatPage data-test-id="chat-page">
        <WikiChatSidebar>
          <ChatConversationList />
        </WikiChatSidebar>
        <WikiChatMain>
          <ChatRouteContent />
        </WikiChatMain>
      </WikiChatPage>
    </ChatProviders>
  );
}
