import { ConversationActionsMenu } from "@diana-tnbc/chat/components/conversation-actions-core";
import { ConversationListCore } from "@diana-tnbc/chat/components/conversation-list-core";
import { useChatRuntime } from "@diana-tnbc/chat/runtime";
import { useMutation, useQuery } from "convex/react";
import { Link, useLocation, useNavigate } from "react-router";
import { api } from "../../../../web/convex/_generated/api.js";
import type { Id } from "../../../../web/convex/_generated/dataModel.js";
import { useWikiSession } from "../wiki-context";

export function ChatConversationList() {
  const identity = useWikiSession();
  const siteArgs = identity?.siteSlug ? { siteSlug: identity.siteSlug } : {};
  const conversations = useQuery(api.conversations.list, siteArgs);
  const archiveConversation = useMutation(api.conversations.archive);
  const { copy, routes } = useChatRuntime();
  const location = useLocation();
  const navigate = useNavigate();
  const activeId = routes.matchConversationId(location.pathname);

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
            navigate(routes.newChatPath);
          }}
          onCopyUrl={() =>
            navigator.clipboard.writeText(
              routes.conversationUrl(conversation._id, window.location.origin),
            )
          }
        />
      )}
      renderLink={({ href, children, ...linkProps }) => (
        <Link {...linkProps} to={href}>
          {children}
        </Link>
      )}
      routes={routes}
    />
  );
}
