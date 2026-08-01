import { ConversationActionsMenu } from "@oncobase/chat/components/conversation-actions-core";
import { ConversationListCore } from "@oncobase/chat/components/conversation-list-core";
import { useChatRuntime } from "@oncobase/chat/runtime";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState, type MouseEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { api } from "../../../../apps/web/convex/_generated/api.js";
import type { Id } from "../../../../apps/web/convex/_generated/dataModel.js";
import { useWikiSession } from "../wiki-context";

export function ChatConversationList() {
  const identity = useWikiSession();
  const siteArgs = identity?.siteSlug ? { siteSlug: identity.siteSlug } : {};
  const conversations = useQuery(api.conversations.list, siteArgs);
  const archiveConversation = useMutation(api.conversations.archive);
  const { copy, routes } = useChatRuntime();
  const location = useLocation();
  const navigate = useNavigate();
  const [browserPathname, setBrowserPathname] = useState(location.pathname);
  useEffect(() => {
    setBrowserPathname(location.pathname);
  }, [location.pathname]);
  useEffect(() => {
    const syncBrowserPathname = () => setBrowserPathname(window.location.pathname);
    window.addEventListener("chat:route-replaced", syncBrowserPathname);
    window.addEventListener("popstate", syncBrowserPathname);
    return () => {
      window.removeEventListener("chat:route-replaced", syncBrowserPathname);
      window.removeEventListener("popstate", syncBrowserPathname);
    };
  }, []);
  const activeId = routes.matchConversationId(browserPathname);

  return (
    <ConversationListCore
      activeConversationId={activeId}
      conversations={conversations}
      copy={copy}
      currentPathname={location.pathname}
      renderActions={(conversation) => (
        <ConversationActionsMenu
          onArchive={async () => {
            await archiveConversation({
              id: conversation._id as Id<"conversations">,
              ...siteArgs,
            });
            if (activeId === conversation._id) {
              window.dispatchEvent(new Event("chat:new"));
            }
            navigate(routes.newChatPath);
          }}
          onCopyUrl={() =>
            navigator.clipboard.writeText(
              routes.conversationUrl(conversation._id, window.location.origin),
            )
          }
        />
      )}
      renderLink={({ href, children, onClick, ...linkProps }) => (
        <Link
          {...linkProps}
          onClick={(event: MouseEvent<HTMLAnchorElement>) => {
            onClick?.(event);
            if (
              !event.defaultPrevented &&
              href === routes.newChatPath &&
              activeId
            ) {
              window.dispatchEvent(new Event("chat:new"));
            }
          }}
          to={href}
        >
          {children}
        </Link>
      )}
      routes={routes}
    />
  );
}
