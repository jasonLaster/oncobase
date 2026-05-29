import { ChatRuntimeProvider } from "@diana-tnbc/chat/runtime";
import {
  WikiChatToolRenderer,
  extractWikiChatSources,
} from "@diana-tnbc/wiki-shell/wiki-chat";
import { WikiMarkdown } from "@diana-tnbc/wiki-markdown";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useEffect, useMemo, type ReactNode } from "react";
import { Link } from "react-router";
import { api } from "../../../../apps/web/convex/_generated/api.js";
import { publishChatPerfSnapshot } from "../observability";
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
  useEffect(() => {
    const publish = () => {
      if (window.__CHAT_PERF__?.events) {
        publishChatPerfSnapshot(window.__CHAT_PERF__.events);
      }
    };
    publish();
    const timer = window.setInterval(publish, 1000);
    return () => window.clearInterval(timer);
  }, []);
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
      ToolCallRenderer={WikiChatToolRenderer}
      routes={routes}
      extractSources={extractWikiChatSources}
      siteSlug={identity?.siteSlug}
      storageKeyPrefix="wiki-vite-chat"
    >
      {children}
    </ChatRuntimeProvider>
  );
}

export function ChatProviders({ children }: { children: ReactNode }) {
  return (
    <ConvexProvider client={getConvexClient()}>
      <ChatRuntime>{children}</ChatRuntime>
    </ConvexProvider>
  );
}
