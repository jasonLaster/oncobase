import { ChatRuntimeProvider } from "@oncobase/chat/runtime";
import { wikiChatCopy } from "@oncobase/wiki-content";
import {
  WikiChatToolRenderer,
  extractWikiChatSources,
} from "@oncobase/wiki-shell/wiki-chat";
import { PROD_CONVEX_FALLBACK_URL } from "@oncobase/wiki-content/convex-url";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { Suspense, lazy, useEffect, useMemo, type ReactNode } from "react";
import { Link } from "react-router";
import { api } from "../../../../apps/web/convex/_generated/api.js";
import { publishChatPerfSnapshot } from "../observability";
import { useWikiSession } from "../wiki-context";
import { hrefForSlug } from "../wiki-utils";

let convexClient: ConvexReactClient | null = null;


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

// ChatProviders is part of the eager reader shell (the mobile navigation
// renders the chat sheet through it), so pulling WikiMarkdown in statically
// would drag react-markdown and its remark/vfile graph into the shell bundle.
// Chat transcripts only need the renderer once a conversation is on screen.
const LazyWikiMarkdown = lazy(() =>
  import("@oncobase/wiki-markdown").then((module) => ({
    default: module.WikiMarkdown,
  })),
);

function ChatMarkdownRenderer({
  content,
  disableAnchors,
}: {
  content: string;
  disableAnchors?: boolean;
  isStreaming?: boolean;
}) {
  return (
    <Suspense fallback={<p className="whitespace-pre-wrap">{content}</p>}>
      <LazyWikiMarkdown
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
    </Suspense>
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
      copy={wikiChatCopy}
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
