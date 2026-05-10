import { ChatInterface } from "@diana-tnbc/chat/components/chat-interface";
import { ChatRuntimeProvider } from "@diana-tnbc/chat/runtime";
import { WikiMarkdown } from "@diana-tnbc/wiki-markdown";
import { ConvexProvider, ConvexReactClient, useQuery } from "convex/react";
import { useMemo, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router";
import { api } from "../../../../web/convex/_generated/api.js";
import { useWikiSession } from "../wiki-context";
import { hrefForSlug } from "../wiki-utils";

const PROD_CONVEX_FALLBACK_URL = "https://youthful-cricket-560.convex.cloud";

let convexClient: ConvexReactClient | null = null;

const chatCopy = {
  emptyStateTitle: "What questions do you have?",
  emptyStateDescription: "",
  suggestedPrompts: [
    {
      badge: "Rx",
      label: "When does AC chemo start, and how long is the immune-suppression window after the last cycle?",
    },
    {
      badge: "DNA",
      label: "What's the optimal timing to start a personalized mRNA neoantigen vaccine relative to AC and pembrolizumab?",
    },
    {
      badge: "Trial",
      label: "Which mRNA vaccine trials are currently enrolling for TNBC, and when would Diana be eligible?",
    },
    {
      badge: "MRD",
      label: "How does ctDNA clearance timing during NACT predict pCR and inform vaccine sequencing?",
    },
  ],
  promptPlaceholder: "Ask a question...",
};

function convexUrl() {
  return (
    import.meta.env.VITE_CONVEX_URL ??
    import.meta.env.VITE_NEXT_PUBLIC_CONVEX_URL ??
    PROD_CONVEX_FALLBACK_URL
  );
}

function getConvexClient() {
  const url = convexUrl();
  if (!convexClient || convexClient.url !== url) {
    convexClient = new ConvexReactClient(url);
  }
  return convexClient;
}

function ChatLink({
  children,
  className,
  href,
  title,
}: {
  children: ReactNode;
  className?: string;
  href: string;
  title?: string;
}) {
  return (
    <Link className={className} title={title} to={href}>
      {children}
    </Link>
  );
}

function ChatMarkdownRenderer({
  content,
  disableAnchors,
}: {
  content: string;
  disableAnchors?: boolean;
  isStreaming?: boolean;
}) {
  return (
    <WikiMarkdown
      content={content}
      disableAnchors={disableAnchors}
      LinkComponent={({ href = "", children, ...props }) => (
        <Link to={hrefForSlug(href.replace(/^\/+/, ""))} {...props}>
          {children}
        </Link>
      )}
      resolveLinkHref={(href) => {
        if (!href) return href;
        if (href.startsWith("/wiki/") || href.startsWith("/sources/") || href.startsWith("/about/")) {
          return href;
        }
        return href;
      }}
    />
  );
}

function ChatRuntime({ children }: { children: ReactNode }) {
  const identity = useWikiSession();
  const routes = useMemo(
    () => ({
      newChatPath: "/chat",
      archivedPath: "/chat/archived",
      conversationPath: (conversationId: string) => `/chat/${conversationId}`,
      conversationUrl: (conversationId: string, origin: string) =>
        `${origin}/chat/${conversationId}`,
      matchConversationId: (pathname: string) => {
        const match = pathname.match(/^\/chat\/([^/?#]+)$/);
        const id = match?.[1] ?? null;
        return id && id !== "archived" ? id : null;
      },
    }),
    [],
  );

  return (
    <ChatRuntimeProvider
      apiPath="/api/chat"
      convexApi={{ conversations: api.conversations }}
      copy={chatCopy}
      LinkComponent={ChatLink}
      MarkdownRenderer={ChatMarkdownRenderer}
      routes={routes}
      siteSlug={identity?.siteSlug}
      storageKeyPrefix="wiki-vite-chat"
    >
      {children}
    </ChatRuntimeProvider>
  );
}

function ConversationList() {
  const identity = useWikiSession();
  const siteArgs = identity?.siteSlug ? { siteSlug: identity.siteSlug } : {};
  const conversations = useQuery(api.conversations.list, siteArgs);
  const location = useLocation();
  const activeId = location.pathname.match(/^\/chat\/([^/?#]+)$/)?.[1] ?? null;

  return (
    <nav className="vite-chat-list" data-test-id="conversation-list" aria-label="Conversations">
      <Link
        className={activeId ? "vite-chat-list-new" : "vite-chat-list-new active"}
        data-test-id="conversation-list-new-chat"
        to="/chat"
      >
        New chat
      </Link>
      {conversations === undefined ? (
        <p className="vite-chat-muted" data-test-id="conversation-list-loading">Loading...</p>
      ) : null}
      {conversations?.length === 0 ? (
        <p className="vite-chat-muted" data-test-id="conversation-list-empty">No conversations yet</p>
      ) : null}
      {conversations?.map((conversation: { _id: string; title: string }) => (
        <Link
          className={conversation._id === activeId ? "vite-chat-list-item active" : "vite-chat-list-item"}
          data-conversation-id={conversation._id}
          data-test-id="conversation-list-item"
          key={conversation._id}
          title={conversation.title}
          to={`/chat/${conversation._id}`}
        >
          {conversation.title}
        </Link>
      ))}
    </nav>
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
    return (
      <section className="vite-chat-placeholder" data-test-id="chat-archived-placeholder">
        <h1>Archived chats</h1>
        <p>Archived conversation management is still owned by the current app during this migration pass.</p>
      </section>
    );
  }
  if (!id) return <ChatInterface conversationId={null} />;
  if (conversation === undefined) {
    return (
      <div className="vite-chat-loading" data-test-id="chat-conversation-loading">
        Loading conversation...
      </div>
    );
  }
  if (conversation === null) {
    return (
      <div className="vite-chat-loading" data-test-id="chat-conversation-not-found">
        Conversation not found
      </div>
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
    <ConvexProvider client={getConvexClient()}>
      <ChatRuntime>
        <section className="vite-chat-page" data-test-id="chat-page">
          <aside className="vite-chat-sidebar">
            <ConversationList />
          </aside>
          <div className="vite-chat-main">
            <ChatRouteContent />
          </div>
        </section>
      </ChatRuntime>
    </ConvexProvider>
  );
}
