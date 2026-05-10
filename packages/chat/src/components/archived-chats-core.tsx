"use client";

import { type ReactNode } from "react";
import type { ChatRoutes } from "../routes";
import type { ResolvedChatCopy } from "../types";
import type { ConversationListLinkRenderProps } from "./conversation-list-core";

export type ArchivedConversation = {
  _id: string;
  createdAt: number;
  title: string;
};

export type ArchivedChatsCoreProps = {
  archived: ArchivedConversation[] | undefined;
  copy: Pick<
    ResolvedChatCopy,
    "archivedTitle" | "loadingConversations" | "noArchivedConversations" | "restoreLabel"
  >;
  onRestore: (conversation: ArchivedConversation) => Promise<void> | void;
  renderLink?: (props: ConversationListLinkRenderProps) => ReactNode;
  routes: Pick<ChatRoutes, "conversationPath" | "newChatPath">;
};

function DefaultLink({ children, href, ...props }: ConversationListLinkRenderProps) {
  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}

function BackIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <polyline points="10 3 5 8 10 13" />
    </svg>
  );
}

function RestoreIcon() {
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
      <path d="M3 8a5 5 0 019.54-2" />
      <polyline points="12 2 12.5 6 8.5 6" />
      <path d="M13 8a5 5 0 01-9.54 2" />
      <polyline points="4 14 3.5 10 7.5 10" />
    </svg>
  );
}

export function ArchivedChatsCore({
  archived,
  copy,
  onRestore,
  renderLink = DefaultLink,
  routes,
}: ArchivedChatsCoreProps) {
  const renderChatLink = (props: ConversationListLinkRenderProps) => renderLink(props);

  return (
    <div className="overflow-y-auto h-full" data-test-id="chat-archived-page">
      <div className="px-4 py-4 md:px-8 md:py-8 max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          {renderChatLink({
            href: routes.newChatPath,
            "aria-label": "Back to new chat",
            className: "p-1.5 rounded-md hover:bg-[var(--accent-light)] text-[var(--text-muted)] hover:text-[var(--foreground)] transition-colors",
            children: <BackIcon />,
          })}
          <h1 className="text-xl font-semibold">{copy.archivedTitle}</h1>
        </div>

        {archived === undefined ? (
          <p className="text-sm text-[var(--text-muted)]" role="status">
            {copy.loadingConversations}
          </p>
        ) : null}

        {archived?.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">{copy.noArchivedConversations}</p>
        ) : null}

        {archived && archived.length > 0 ? (
          <div className="space-y-2">
            {archived.map((conversation) => (
              <div
                className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-[var(--sidebar-border)] bg-[var(--background)]"
                data-test-id="chat-archived-item"
                key={conversation._id}
              >
                <div className="min-w-0">
                  {renderChatLink({
                    href: routes.conversationPath(conversation._id),
                    className: "text-sm font-medium text-[var(--foreground)] hover:text-[var(--brand)] transition-colors truncate block",
                    children: conversation.title,
                  })}
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    {new Date(conversation.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <button
                  type="button"
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-[var(--sidebar-border)] text-[var(--foreground)] hover:bg-[var(--accent-light)] transition-colors"
                  onClick={() => void onRestore(conversation)}
                >
                  <RestoreIcon />
                  {copy.restoreLabel}
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
