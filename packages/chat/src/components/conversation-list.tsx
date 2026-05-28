"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useMemo } from "react";
import { useQuery } from "convex/react";
import { ConversationDropdown } from "./chat-actions";
import { ConversationListCore } from "./conversation-list-core";
import { useChatRuntime } from "../runtime";
import type { ChatRoutes } from "../routes";

function useActiveConversationId(routes: ChatRoutes): string | null {
  const pathname = usePathname();

  const pathnameId = useMemo(() => {
    return routes.matchConversationId(pathname);
  }, [pathname, routes]);

  const [replaceStateId, setReplaceStateId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const handler = () => {
      if (!mounted) return;
      setReplaceStateId(routes.matchConversationId(window.location.pathname));
    };
    window.addEventListener("popstate", handler);

    const origReplace = history.replaceState.bind(history);
    history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
      origReplace(...args);
      // Defer to avoid calling setState during render/hydration
      queueMicrotask(handler);
    };

    return () => {
      mounted = false;
      window.removeEventListener("popstate", handler);
      history.replaceState = origReplace;
    };
  }, [routes]);

  return replaceStateId ?? pathnameId;
}

function ConversationListContent() {
  const { convexApi, copy, routes, siteSlug } = useChatRuntime();
  const conversations = useQuery(
    convexApi.conversations.list,
    siteSlug ? { siteSlug } : {},
  );
  const pathname = usePathname();
  const activeId = useActiveConversationId(routes);

  return (
    <ConversationListCore
      activeConversationId={activeId}
      conversations={conversations}
      copy={copy}
      currentPathname={pathname}
      renderActions={(conversation) => <ConversationDropdown conversationId={conversation._id} />}
      renderLink={({ href, children, ...linkProps }) => (
        <Link {...linkProps} href={href}>
          {children}
        </Link>
      )}
      routes={routes}
    />
  );
}

export default function ConversationList() {
  return <ConversationListContent />;
}
