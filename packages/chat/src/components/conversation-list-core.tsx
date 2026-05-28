"use client";

import { type ComponentProps, type MouseEvent, type ReactNode } from "react";
import type { ChatRoutes } from "../routes";
import type { ResolvedChatCopy } from "../types";

export type ConversationListConversation = {
  _id: string;
  title: string;
};

export type ConversationListLinkRenderProps = Omit<ComponentProps<"a">, "children" | "ref"> & {
  "data-conversation-id"?: string;
  "data-test-id"?: string;
  children: ReactNode;
  href: string;
};

export type ConversationListCoreProps = {
  activeConversationId: string | null;
  className?: string;
  conversations: ConversationListConversation[] | undefined;
  copy: Pick<
    ResolvedChatCopy,
    "loadingConversations" | "newChatLabel" | "noConversations" | "viewArchivedLabel"
  >;
  currentPathname: string;
  renderActions?: (conversation: ConversationListConversation) => ReactNode;
  renderLink?: (props: ConversationListLinkRenderProps) => ReactNode;
  routes: Pick<ChatRoutes, "archivedPath" | "conversationPath" | "isArchivedPath" | "isNewChatPath" | "newChatPath">;
};

function ChatBubbleIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      aria-hidden="true"
    >
      <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.7.7 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
      <path d="m9 11 2 2 4-4" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="12" height="4" rx="1" />
      <path d="M2 6v7a1 1 0 001 1h10a1 1 0 001-1V6" />
      <path d="M6.5 9.5h3" />
    </svg>
  );
}

function DefaultLink({ children, href, ...props }: ConversationListLinkRenderProps) {
  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}

export function ConversationListCore({
  activeConversationId,
  className,
  conversations,
  copy,
  currentPathname,
  renderActions,
  renderLink = DefaultLink,
  routes,
}: ConversationListCoreProps) {
  const isNewChat = routes.isNewChatPath(currentPathname) && activeConversationId === null;
  const isArchived = routes.isArchivedPath(currentPathname);

  const renderListLink = (props: ConversationListLinkRenderProps) => renderLink(props);

  return (
    <div className={className ?? "flex min-h-full flex-col"} data-test-id="conversation-list">
      <div className="space-y-0.5">
        {renderListLink({
          href: routes.newChatPath,
          "data-test-id": "conversation-list-new-chat",
          className: `flex items-center gap-1.5 px-2 py-1.5 text-sm rounded transition-colors ${
            isNewChat
              ? "bg-[var(--accent-light)] text-[var(--brand)] font-medium"
              : "hover:bg-[var(--accent-light)] text-[var(--brand)] font-medium"
          }`,
          children: (
            <>
              <ChatBubbleIcon />
              {copy.newChatLabel}
            </>
          ),
        })}

        {conversations === undefined ? (
          <div
            aria-label="Loading conversations"
            className="px-2 py-1 text-xs text-[var(--text-muted)]"
            data-test-id="conversation-list-loading"
            role="status"
          >
            {copy.loadingConversations}
          </div>
        ) : null}

        {conversations?.map((conversation) => {
          const isActive = conversation._id === activeConversationId;
          const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
            if (isActive) event.preventDefault();
          };

          return (
            <div
              className="group/item flex items-center rounded hover:bg-[var(--accent-light)] transition-colors"
              key={conversation._id}
            >
              {renderListLink({
                href: routes.conversationPath(conversation._id),
                onClick,
                className: `flex-1 min-w-0 px-2 py-1 text-sm rounded truncate transition-colors ${
                  isActive
                    ? "text-[var(--brand)] font-medium"
                    : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
                }`,
                title: conversation.title,
                "data-test-id": "conversation-list-item",
                "data-conversation-id": conversation._id,
                children: conversation.title,
              })}
              {renderActions ? (
                <div className="shrink-0 opacity-0 group-hover/item:opacity-100 transition-opacity pr-1">
                  {renderActions(conversation)}
                </div>
              ) : null}
            </div>
          );
        })}

        {conversations?.length === 0 ? (
          <div className="px-2 py-1 text-xs text-[var(--text-muted)]" data-test-id="conversation-list-empty">
            {copy.noConversations}
          </div>
        ) : null}
      </div>

      <div className="mt-auto pt-2 border-t border-[var(--sidebar-border)]">
        {renderListLink({
          href: routes.archivedPath,
          "data-test-id": "conversation-list-archived",
          className: `flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors ${
            isArchived
              ? "text-[var(--brand)] bg-[var(--accent-light)]"
              : "text-[var(--text-muted)] hover:text-[var(--foreground)] hover:bg-[var(--accent-light)]"
          }`,
          children: (
            <>
              <ArchiveIcon />
              {copy.viewArchivedLabel}
            </>
          ),
        })}
      </div>
    </div>
  );
}
