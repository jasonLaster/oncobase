"use client";

import Link from "next/link";
import { useQuery, useMutation } from "convex/react";
import { useChatRuntime } from "../runtime";

export function ArchivedChatsClient() {
  const { convexApi, copy, routes, siteSlug } = useChatRuntime();
  const siteArgs = siteSlug ? { siteSlug } : {};
  const archived = useQuery(convexApi.conversations.listArchived, siteArgs);
  const restoreConversation = useMutation(convexApi.conversations.restore);

  async function handleRestore(id: string) {
    await restoreConversation({ id, ...siteArgs });
  }

  return (
    <div className="overflow-y-auto h-full">
      <div className="px-4 py-4 md:px-8 md:py-8 max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link
            href={routes.newChatPath}
            className="p-1.5 rounded-md hover:bg-[var(--accent-light)] text-[var(--text-muted)] hover:text-[var(--foreground)] transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="10 3 5 8 10 13" />
            </svg>
          </Link>
          <h1 className="text-xl font-semibold">{copy.archivedTitle}</h1>
        </div>

        {archived === undefined && (
          <p className="text-sm text-[var(--text-muted)]">
            {copy.loadingConversations}
          </p>
        )}

        {archived?.length === 0 && (
          <p className="text-sm text-[var(--text-muted)]">
            {copy.noArchivedConversations}
          </p>
        )}

        {archived && archived.length > 0 && (
          <div className="space-y-2">
            {archived.map((conv: { _id: string; title: string; createdAt: number }) => (
              <div
                key={conv._id}
                className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-[var(--sidebar-border)] bg-[var(--background)]"
              >
                <div className="min-w-0">
                  <Link
                    href={routes.conversationPath(conv._id)}
                    className="text-sm font-medium text-[var(--foreground)] hover:text-[var(--brand)] transition-colors truncate block"
                  >
                    {conv.title}
                  </Link>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    {new Date(conv.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <button
                  onClick={() => handleRestore(conv._id)}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-[var(--sidebar-border)] text-[var(--foreground)] hover:bg-[var(--accent-light)] transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 8a5 5 0 019.54-2" />
                    <polyline points="12 2 12.5 6 8.5 6" />
                    <path d="M13 8a5 5 0 01-9.54 2" />
                    <polyline points="4 14 3.5 10 7.5 10" />
                  </svg>
                  {copy.restoreLabel}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
